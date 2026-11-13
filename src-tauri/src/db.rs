//! The SQLite file: opening it, and upgrading its schema safely when a new Banyan version starts.
//!
//! An upgrade (1) refuses databases made by a newer Banyan, (2) checks the file's integrity,
//! (3) writes a backup copy into `backups/` next to the database, and (4) runs every step in one
//! transaction, so a failing step leaves the file exactly as it was.

use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

/// Bump this and append a migration step whenever the schema changes.
pub const SCHEMA_VERSION: i32 = 20;
/// Folder next to the database file that holds the copies made before upgrades.
pub const BACKUP_DIR: &str = "backups";
/// How many pre-upgrade copies are kept (the oldest are removed).
pub const KEEP_BACKUPS: usize = 5;

/// Why a database couldn't be opened. Apart from `Sqlite`, the file is left untouched.
#[derive(Debug)]
pub enum DbError {
    /// Made by a newer Banyan: an older version could misread or damage what it doesn't know.
    TooNew { found: i32, supported: i32 },
    /// The integrity check before an upgrade failed, so the upgrade wasn't attempted.
    Damaged(String),
    /// The copy made before an upgrade couldn't be written, so the upgrade wasn't attempted.
    Backup(String),
    /// An upgrade step failed; everything was rolled back.
    UpgradeFailed { from: i32, error: String, backup: Option<PathBuf> },
    Sqlite(rusqlite::Error),
}

impl From<rusqlite::Error> for DbError {
    fn from(e: rusqlite::Error) -> Self {
        DbError::Sqlite(e)
    }
}

impl fmt::Display for DbError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DbError::TooNew { found, supported } => write!(
                f,
                "這個資料庫是由較新版的 Banyan 建立的（資料庫第 {found} 版，這個版本只支援到第 {supported} 版）。\
                 為了避免損壞資料，沒有開啟它。請把 Banyan 更新到最新版本。"
            ),
            DbError::Damaged(detail) => write!(
                f,
                "資料庫檔案可能已經損壞（完整性檢查未通過：{detail}），沒有進行升級，檔案沒有變動。"
            ),
            DbError::Backup(detail) => write!(
                f,
                "升級資料庫前無法建立備份（{detail}），沒有進行升級，檔案沒有變動。請確認磁碟空間與資料夾權限。"
            ),
            DbError::UpgradeFailed { from, error, backup } => {
                write!(f, "資料庫從第 {from} 版升級到第 {SCHEMA_VERSION} 版時失敗（{error}），已全部還原，檔案沒有變動。")?;
                if let Some(b) = backup {
                    write!(f, "升級前的備份在 {}。", b.display())?;
                }
                Ok(())
            }
            DbError::Sqlite(e) => write!(f, "資料庫錯誤：{e}"),
        }
    }
}

/// A schema upgrade that happened while opening.
#[derive(Debug, Clone)]
pub struct Upgrade {
    pub from: i32,
    pub to: i32,
    /// The copy made before upgrading.
    pub backup: PathBuf,
}

pub fn open(path: &Path) -> Result<Connection, DbError> {
    open_with_report(path).map(|(conn, _)| conn)
}

/// Creates the current schema in an empty database (e.g. in memory).
pub fn create_schema(conn: &Connection) -> Result<(), DbError> {
    upgrade(conn, 0).map_err(|error| DbError::UpgradeFailed { from: 0, error, backup: None })
}

/// Opens the database, upgrading it if it comes from an older Banyan. Reports the upgrade.
pub fn open_with_report(path: &Path) -> Result<(Connection, Option<Upgrade>), DbError> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;",
    )?;
    let version: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version > SCHEMA_VERSION {
        return Err(DbError::TooNew { found: version, supported: SCHEMA_VERSION });
    }
    if version == SCHEMA_VERSION {
        return Ok((conn, None));
    }
    if version == 0 {
        // A new, empty database: nothing to protect.
        upgrade(&conn, 0).map_err(|error| DbError::UpgradeFailed { from: 0, error, backup: None })?;
        return Ok((conn, None));
    }
    check_integrity(&conn)?;
    let backup = backup(&conn, path, version)?;
    upgrade(&conn, version).map_err(|error| DbError::UpgradeFailed {
        from: version,
        error,
        backup: Some(backup.clone()),
    })?;
    Ok((conn, Some(Upgrade { from: version, to: SCHEMA_VERSION, backup })))
}

fn check_integrity(conn: &Connection) -> Result<(), DbError> {
    let problems: Vec<String> = conn
        .prepare("PRAGMA quick_check")?
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    if problems.len() == 1 && problems[0] == "ok" {
        Ok(())
    } else {
        Err(DbError::Damaged(problems.into_iter().take(3).collect::<Vec<_>>().join("；")))
    }
}

/// Number of foreign-key violations in the database.
fn foreign_key_problems(conn: &Connection) -> rusqlite::Result<usize> {
    let mut stmt = conn.prepare("PRAGMA foreign_key_check")?;
    let mut rows = stmt.query([])?;
    let mut n = 0;
    while rows.next()?.is_some() {
        n += 1;
    }
    Ok(n)
}

/// Runs the steps from `version` and records the new version, all in one transaction. The
/// upgrade must not leave more broken references than there were before.
fn upgrade(conn: &Connection, version: i32) -> Result<(), String> {
    let before = foreign_key_problems(conn).map_err(|e| e.to_string())?;
    conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
    let result = (|| -> Result<(), String> {
        migrate_steps(conn, version).map_err(|e| e.to_string())?;
        let after = foreign_key_problems(conn).map_err(|e| e.to_string())?;
        if after > before {
            return Err(format!("升級後有 {} 筆資料的關聯不一致", after - before));
        }
        conn.pragma_update(None, "user_version", SCHEMA_VERSION).map_err(|e| e.to_string())
    })();
    match result {
        Ok(()) => conn.execute_batch("COMMIT").map_err(|e| e.to_string()),
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

/// Writes a consistent copy of the database to `backups/banyan-v<version>-<UTC time>.db`
/// and removes the oldest copies beyond `KEEP_BACKUPS`.
fn backup(conn: &Connection, db_path: &Path, version: i32) -> Result<PathBuf, DbError> {
    let dir = db_path.parent().unwrap_or(Path::new(".")).join(BACKUP_DIR);
    let target = snapshot(conn, &dir, version, "")?;
    prune_backups(&dir, KEEP_BACKUPS);
    Ok(target)
}

/// Writes a consistent copy of the open database to `dir` as
/// `banyan-v<version>-<UTC time><suffix>.db` (never overwriting). Does not prune.
pub fn snapshot(conn: &Connection, dir: &Path, version: i32, suffix: &str) -> Result<PathBuf, DbError> {
    fs::create_dir_all(dir).map_err(|e| DbError::Backup(e.to_string()))?;
    let stamp = utc_stamp(SystemTime::now());
    let mut target = dir.join(format!("banyan-v{version}-{stamp}{suffix}.db"));
    let mut n = 2;
    while target.exists() {
        target = dir.join(format!("banyan-v{version}-{stamp}{suffix}-{n}.db"));
        n += 1;
    }
    conn.execute("VACUUM INTO ?1", [target.to_string_lossy()])
        .map_err(|e| DbError::Backup(e.to_string()))?;
    Ok(target)
}

/// Checks that a backup file can be restored: it is intact and not newer than this Banyan.
/// Returns its schema version. The file is opened read-only.
pub fn check_backup(path: &Path) -> Result<i32, DbError> {
    let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let version: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version > SCHEMA_VERSION {
        return Err(DbError::TooNew { found: version, supported: SCHEMA_VERSION });
    }
    if version < 1 {
        return Err(DbError::Damaged("不是 Banyan 的資料庫".into()));
    }
    check_integrity(&conn)?;
    Ok(version)
}

/// Pre-upgrade copies in `dir`, newest first.
pub fn list_backups(dir: &Path) -> Vec<PathBuf> {
    let mut found: Vec<(SystemTime, PathBuf)> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            name.starts_with("banyan-v") && name.ends_with(".db")
        })
        .map(|e| (e.metadata().and_then(|m| m.modified()).unwrap_or(UNIX_EPOCH), e.path()))
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)));
    found.into_iter().map(|(_, p)| p).collect()
}

fn prune_backups(dir: &Path, keep: usize) {
    for old in list_backups(dir).into_iter().skip(keep) {
        let _ = fs::remove_file(old);
    }
}

/// "20261112-085300" (UTC), for backup file names.
fn utc_stamp(t: SystemTime) -> String {
    let secs = t.duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + (m <= 2) as i64;
    format!("{y:04}{m:02}{d:02}-{:02}{:02}{:02}", rem / 3600, rem % 3600 / 60, rem % 60)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn stamps_are_utc_dates() {
        assert_eq!(utc_stamp(UNIX_EPOCH), "19700101-000000");
        // 2024-02-29 12:34:56 UTC (leap day)
        assert_eq!(utc_stamp(UNIX_EPOCH + Duration::from_secs(1_709_210_096)), "20240229-123456");
    }
}

/// The schema changes from `version` up to `SCHEMA_VERSION`. Runs inside the transaction opened
/// by `upgrade`, so a step must never begin or commit one itself.
fn migrate_steps(conn: &Connection, version: i32) -> rusqlite::Result<()> {
    if version < 1 {
        conn.execute_batch(
            "CREATE TABLE collections (
                 id         INTEGER PRIMARY KEY,
                 name       TEXT    NOT NULL,
                 parent_id  INTEGER REFERENCES collections(id) ON DELETE CASCADE,
                 created_at INTEGER NOT NULL
             );
             CREATE TABLE items (
                 id            INTEGER PRIMARY KEY,
                 item_type     TEXT    NOT NULL,
                 title         TEXT    NOT NULL DEFAULT '',
                 authors       TEXT    NOT NULL DEFAULT '',
                 date          TEXT    NOT NULL DEFAULT '',
                 publication   TEXT    NOT NULL DEFAULT '',
                 volume        TEXT    NOT NULL DEFAULT '',
                 issue         TEXT    NOT NULL DEFAULT '',
                 pages         TEXT    NOT NULL DEFAULT '',
                 publisher     TEXT    NOT NULL DEFAULT '',
                 doi           TEXT    NOT NULL DEFAULT '',
                 isbn          TEXT    NOT NULL DEFAULT '',
                 url           TEXT    NOT NULL DEFAULT '',
                 abstract_note TEXT    NOT NULL DEFAULT '',
                 notes         TEXT    NOT NULL DEFAULT '',
                 created_at    INTEGER NOT NULL,
                 updated_at    INTEGER NOT NULL
             );
             CREATE TABLE item_collections (
                 item_id       INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                 collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
                 PRIMARY KEY (item_id, collection_id)
             );
             CREATE TABLE tags (
                 id   INTEGER PRIMARY KEY,
                 name TEXT NOT NULL UNIQUE COLLATE NOCASE
             );
             CREATE TABLE item_tags (
                 item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                 tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                 PRIMARY KEY (item_id, tag_id)
             );
             CREATE TABLE attachments (
                 id          INTEGER PRIMARY KEY,
                 item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                 file_name   TEXT    NOT NULL,
                 stored_path TEXT    NOT NULL,
                 size        INTEGER NOT NULL,
                 created_at  INTEGER NOT NULL
             );
             CREATE INDEX idx_collections_parent ON collections(parent_id);
             CREATE INDEX idx_item_collections_collection ON item_collections(collection_id);
             CREATE INDEX idx_item_tags_tag ON item_tags(tag_id);
             CREATE INDEX idx_attachments_item ON attachments(item_id);",
        )?;
    }
    if version < 2 {
        // Fields for music, films, artworks and other non-text collectibles.
        conn.execute_batch(
            "ALTER TABLE items ADD COLUMN running_time   TEXT NOT NULL DEFAULT '';
             ALTER TABLE items ADD COLUMN medium         TEXT NOT NULL DEFAULT '';
             ALTER TABLE items ADD COLUMN dimensions     TEXT NOT NULL DEFAULT '';
             ALTER TABLE items ADD COLUMN place          TEXT NOT NULL DEFAULT '';
             ALTER TABLE items ADD COLUMN catalog_number TEXT NOT NULL DEFAULT '';",
        )?;
    }
    if version < 3 {
        // Linked attachments: very large files are referenced at their original path
        // (stored_path is then absolute) instead of being copied into storage/.
        conn.execute_batch(
            "ALTER TABLE attachments ADD COLUMN linked INTEGER NOT NULL DEFAULT 0;",
        )?;
    }
    if version < 4 {
        // Creators with roles (author, editor, translator, director…) replace the free-text
        // `authors` column, which stays as a display/search summary kept in sync by the app.
        let tx = conn;
        tx.execute_batch(
            "CREATE TABLE item_creators (
                 id       INTEGER PRIMARY KEY,
                 item_id  INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                 position INTEGER NOT NULL,
                 role     TEXT    NOT NULL,
                 name     TEXT    NOT NULL
             );
             CREATE INDEX idx_item_creators_item ON item_creators(item_id, position);",
        )?;
        let old: Vec<(i64, String, String)> = tx
            .prepare("SELECT id, item_type, authors FROM items WHERE authors <> ''")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<rusqlite::Result<_>>()?;
        for (id, item_type, authors) in old {
            let names = authors.lines().map(str::trim).filter(|n| !n.is_empty());
            for (pos, name) in names.enumerate() {
                tx.execute(
                    "INSERT INTO item_creators (item_id, position, role, name) VALUES (?1, ?2, ?3, ?4)",
                    rusqlite::params![id, pos as i64, primary_role(&item_type), name],
                )?;
            }
        }
    }
    if version < 5 {
        // Whiteboard: cards placed on boards, and undirected (two-way) links between cards.
        // Cards live apart from boards so one card can later appear on several boards.
        conn.execute_batch(
            "CREATE TABLE whiteboards (
                 id         INTEGER PRIMARY KEY,
                 name       TEXT    NOT NULL,
                 created_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL
             );
             CREATE TABLE cards (
                 id         INTEGER PRIMARY KEY,
                 title      TEXT    NOT NULL DEFAULT '',
                 content    TEXT    NOT NULL DEFAULT '',
                 created_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL
             );
             CREATE TABLE board_cards (
                 board_id INTEGER NOT NULL REFERENCES whiteboards(id) ON DELETE CASCADE,
                 card_id  INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
                 x        REAL    NOT NULL,
                 y        REAL    NOT NULL,
                 width    REAL    NOT NULL,
                 height   REAL    NOT NULL,
                 PRIMARY KEY (board_id, card_id)
             );
             -- Stored once per pair with card_a < card_b; read from both sides.
             CREATE TABLE card_links (
                 id         INTEGER PRIMARY KEY,
                 card_a     INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
                 card_b     INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
                 created_at INTEGER NOT NULL,
                 CHECK (card_a < card_b),
                 UNIQUE (card_a, card_b)
             );
             CREATE INDEX idx_board_cards_card ON board_cards(card_id);
             CREATE INDEX idx_card_links_b ON card_links(card_b);",
        )?;
    }
    if version < 6 {
        // Cards can reference Drawer items (Heptabase-style). Item notes become cards linked
        // to their item, and the `notes` column goes away.
        let tx = conn;
        tx.execute_batch(
            "CREATE TABLE card_items (
                 card_id    INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
                 item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                 created_at INTEGER NOT NULL,
                 PRIMARY KEY (card_id, item_id)
             );
             CREATE INDEX idx_card_items_item ON card_items(item_id);",
        )?;
        let notes: Vec<(i64, String, String, i64, i64)> = tx
            .prepare("SELECT id, title, notes, created_at, updated_at FROM items WHERE trim(notes) <> '' ORDER BY id")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?
            .collect::<rusqlite::Result<_>>()?;
        for (item_id, title, text, created, updated) in notes {
            tx.execute(
                "INSERT INTO cards (title, content, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![note_card_title(&title), text, created, updated],
            )?;
            tx.execute(
                "INSERT INTO card_items (card_id, item_id, created_at) VALUES (?1, ?2, ?3)",
                rusqlite::params![tx.last_insert_rowid(), item_id, updated],
            )?;
        }
        tx.execute_batch("ALTER TABLE items DROP COLUMN notes;")?;
    }
    if version < 7 {
        // Whiteboard folders (nested, like Drawer collections); links get a direction and a note.
        // direction: 0 none, 1 card_a → card_b, 2 card_b → card_a, 3 both.
        conn.execute_batch(
            "CREATE TABLE whiteboard_folders (
                 id         INTEGER PRIMARY KEY,
                 name       TEXT    NOT NULL,
                 parent_id  INTEGER REFERENCES whiteboard_folders(id) ON DELETE CASCADE,
                 created_at INTEGER NOT NULL
             );
             CREATE INDEX idx_whiteboard_folders_parent ON whiteboard_folders(parent_id);
             ALTER TABLE whiteboards ADD COLUMN folder_id INTEGER
                 REFERENCES whiteboard_folders(id) ON DELETE SET NULL;
             ALTER TABLE card_links ADD COLUMN direction INTEGER NOT NULL DEFAULT 0;
             ALTER TABLE card_links ADD COLUMN note TEXT NOT NULL DEFAULT '';",
        )?;
    }
    if version < 8 {
        // Related items (Zotero's "Related"): undirected, stored once per pair with item_a < item_b.
        conn.execute_batch(
            "CREATE TABLE item_relations (
                 item_a     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                 item_b     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                 created_at INTEGER NOT NULL,
                 CHECK (item_a < item_b),
                 PRIMARY KEY (item_a, item_b)
             );
             CREATE INDEX idx_item_relations_b ON item_relations(item_b);",
        )?;
    }
    if version < 9 {
        // Heptabase-style whiteboards: sections (named regions on a board) and card tags.
        conn.execute_batch(
            "CREATE TABLE board_sections (
                 id         INTEGER PRIMARY KEY,
                 board_id   INTEGER NOT NULL REFERENCES whiteboards(id) ON DELETE CASCADE,
                 title      TEXT    NOT NULL DEFAULT '',
                 color      TEXT    NOT NULL DEFAULT '',
                 x          REAL    NOT NULL,
                 y          REAL    NOT NULL,
                 width      REAL    NOT NULL,
                 height     REAL    NOT NULL,
                 created_at INTEGER NOT NULL
             );
             CREATE INDEX idx_board_sections_board ON board_sections(board_id);
             CREATE TABLE card_tags (
                 card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
                 name    TEXT    NOT NULL COLLATE NOCASE,
                 PRIMARY KEY (card_id, name)
             );
             CREATE INDEX idx_card_tags_name ON card_tags(name);",
        )?;
    }
    if version < 10 {
        // Series (叢書／系列) and the item's number within it, as in Zotero.
        conn.execute_batch(
            "ALTER TABLE items ADD COLUMN series        TEXT NOT NULL DEFAULT '';
             ALTER TABLE items ADD COLUMN series_number TEXT NOT NULL DEFAULT '';",
        )?;
    }
    if version < 11 {
        // Version history of cards (Version Machine). Each row is a saved state of the card.
        // Automatic versions (name = '') absorb edits made shortly after them; named versions
        // are made by the user and never change or get pruned.
        conn.execute_batch(
            "CREATE TABLE card_versions (
                 id         INTEGER PRIMARY KEY,
                 card_id    INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
                 title      TEXT    NOT NULL,
                 content    TEXT    NOT NULL,
                 name       TEXT    NOT NULL DEFAULT '',
                 created_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL
             );
             CREATE INDEX idx_card_versions_card ON card_versions(card_id, id);",
        )?;
    }
    if version < 12 {
        // Whiteboard object types: a card is a note (text) by default, or a sticky note,
        // image, YouTube video, PDF or mind map. `data` holds the type's JSON (file name, video
        // id, the mind map's tree…); `content` stays searchable text. Versions keep `data` too.
        conn.execute_batch(
            "ALTER TABLE cards ADD COLUMN kind TEXT NOT NULL DEFAULT 'note';
             ALTER TABLE cards ADD COLUMN data TEXT NOT NULL DEFAULT '';
             ALTER TABLE card_versions ADD COLUMN data TEXT NOT NULL DEFAULT '';",
        )?;
    }
    if version < 13 {
        // How a folder shows its items: 'list' (the table) or 'gallery' (pictures only; the
        // folder then only accepts image items such as photos and paintings).
        conn.execute_batch(
            "ALTER TABLE collections ADD COLUMN view TEXT NOT NULL DEFAULT 'list';",
        )?;
    }
    if version < 14 {
        // Full text of an item pasted as-is, e.g. a news article (原文).
        conn.execute_batch("ALTER TABLE items ADD COLUMN full_text TEXT NOT NULL DEFAULT '';")?;
    }
    if version < 15 {
        // Drawer holds two libraries: 'literature' (文獻庫, the bibliographic types) and 'files'
        // (檔案庫, items that are a file). Each library has its own folder tree.
        conn.execute_batch(
            "ALTER TABLE collections ADD COLUMN library TEXT NOT NULL DEFAULT 'literature';",
        )?;
    }
    if version < 16 {
        // Attachments of 文獻庫 items show up in 檔案庫: each gets a file item whose attachment
        // row shares the same file (`mirror_of` = the literature attachment's id).
        let tx = conn;
        tx.execute_batch("ALTER TABLE attachments ADD COLUMN mirror_of INTEGER;")?;
        crate::drawer::mirror_all_literature_attachments(&tx)?;
    }
    if version < 17 {
        // Annotator: highlights and bookmarks in PDFs and books, kept against the file's original
        // attachment (shared with its 檔案庫 copy). See annotations.rs for `location`.
        conn.execute_batch(
            "CREATE TABLE annotations (
                 id            INTEGER PRIMARY KEY,
                 attachment_id INTEGER NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
                 kind          TEXT    NOT NULL,
                 color         TEXT    NOT NULL DEFAULT 'yellow',
                 quote         TEXT    NOT NULL DEFAULT '',
                 note          TEXT    NOT NULL DEFAULT '',
                 location      TEXT    NOT NULL,
                 sort_key      REAL    NOT NULL DEFAULT 0,
                 card_id       INTEGER REFERENCES cards(id) ON DELETE SET NULL,
                 created_at    INTEGER NOT NULL,
                 updated_at    INTEGER NOT NULL
             );
             CREATE INDEX idx_annotations_attachment ON annotations(attachment_id, sort_key);",
        )?;
    }
    if version < 18 {
        // Cards cite annotations (like they cite Drawer items). Cards made from an annotation
        // cite it from the start.
        conn.execute_batch(
            "CREATE TABLE card_annotations (
                 card_id       INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
                 annotation_id INTEGER NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
                 created_at    INTEGER NOT NULL,
                 PRIMARY KEY (card_id, annotation_id)
             );
             CREATE INDEX idx_card_annotations_annotation ON card_annotations(annotation_id);
             INSERT OR IGNORE INTO card_annotations (card_id, annotation_id, created_at)
                 SELECT n.card_id, n.id, n.updated_at FROM annotations n
                 WHERE n.card_id IS NOT NULL AND EXISTS (SELECT 1 FROM cards c WHERE c.id = n.card_id);",
        )?;
    }
    if version < 19 {
        // Per board: a card folded to its title bar, and a card whose height follows its content.
        conn.execute_batch(
            "ALTER TABLE board_cards ADD COLUMN collapsed   INTEGER NOT NULL DEFAULT 0;
             ALTER TABLE board_cards ADD COLUMN auto_height INTEGER NOT NULL DEFAULT 0;",
        )?;
    }
    if version < 20 {
        // BibTeX-style citation keys: items get `cite_key` (`kahneman2011`), annotations a number
        // per item and kind (`kahneman2011:h3`). See citations.rs.
        conn.execute_batch(
            "ALTER TABLE items ADD COLUMN cite_key        TEXT    NOT NULL DEFAULT '';
             ALTER TABLE items ADD COLUMN cite_key_manual INTEGER NOT NULL DEFAULT 0;
             ALTER TABLE annotations ADD COLUMN seq INTEGER NOT NULL DEFAULT 0;",
        )?;
        crate::citations::fill_missing(conn)?;
        conn.execute_batch("CREATE UNIQUE INDEX idx_items_cite_key ON items(cite_key) WHERE cite_key <> '';")?;
    }
    Ok(())
}

/// Title of a new note card about an item, e.g. "筆記：Attention Is All You Need".
pub fn note_card_title(item_title: &str) -> String {
    let t = item_title.trim();
    if t.is_empty() { "筆記".into() } else { format!("筆記：{t}") }
}

/// The main creator role of an item type (shown first in the list's "作者" column).
/// Keep in sync with `creatorRoles[0]` in `src/drawer/itemTypes.ts`.
pub fn primary_role(item_type: &str) -> &'static str {
    match item_type {
        "music" | "cd" | "concert" | "comedy" => "performer",
        "dvd" | "film" | "tvEpisode" | "theater" | "musical" => "director",
        "opera" => "composer",
        "dance" => "choreographer",
        "festival" => "organizer",
        "talk" => "speaker",
        "news" => "reporter",
        "podcast" => "host",
        "video" => "creator",
        "painting" => "painter",
        "artwork" => "artist",
        "photo" => "photographer",
        "map" => "cartographer",
        "software" => "programmer",
        _ => "author",
    }
}
