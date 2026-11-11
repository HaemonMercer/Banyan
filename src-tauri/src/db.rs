use std::path::Path;

use rusqlite::Connection;

/// Bump this and append a migration step whenever the schema changes.
const SCHEMA_VERSION: i32 = 9;

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;",
    )?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let version: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < 1 {
        conn.execute_batch(
            "BEGIN;
             CREATE TABLE collections (
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
             CREATE INDEX idx_attachments_item ON attachments(item_id);
             COMMIT;",
        )?;
    }
    if version < 2 {
        // Fields for music, films, artworks and other non-text collectibles.
        conn.execute_batch(
            "BEGIN;
             ALTER TABLE items ADD COLUMN running_time   TEXT NOT NULL DEFAULT '';
             ALTER TABLE items ADD COLUMN medium         TEXT NOT NULL DEFAULT '';
             ALTER TABLE items ADD COLUMN dimensions     TEXT NOT NULL DEFAULT '';
             ALTER TABLE items ADD COLUMN place          TEXT NOT NULL DEFAULT '';
             ALTER TABLE items ADD COLUMN catalog_number TEXT NOT NULL DEFAULT '';
             COMMIT;",
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
        let tx = conn.unchecked_transaction()?;
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
        tx.commit()?;
    }
    if version < 5 {
        // Whiteboard: cards placed on boards, and undirected (two-way) links between cards.
        // Cards live apart from boards so one card can later appear on several boards.
        conn.execute_batch(
            "BEGIN;
             CREATE TABLE whiteboards (
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
             CREATE INDEX idx_card_links_b ON card_links(card_b);
             COMMIT;",
        )?;
    }
    if version < 6 {
        // Cards can reference Drawer items (Heptabase-style). Item notes become cards linked
        // to their item, and the `notes` column goes away.
        let tx = conn.unchecked_transaction()?;
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
        tx.commit()?;
    }
    if version < 7 {
        // Whiteboard folders (nested, like Drawer collections); links get a direction and a note.
        // direction: 0 none, 1 card_a → card_b, 2 card_b → card_a, 3 both.
        conn.execute_batch(
            "BEGIN;
             CREATE TABLE whiteboard_folders (
                 id         INTEGER PRIMARY KEY,
                 name       TEXT    NOT NULL,
                 parent_id  INTEGER REFERENCES whiteboard_folders(id) ON DELETE CASCADE,
                 created_at INTEGER NOT NULL
             );
             CREATE INDEX idx_whiteboard_folders_parent ON whiteboard_folders(parent_id);
             ALTER TABLE whiteboards ADD COLUMN folder_id INTEGER
                 REFERENCES whiteboard_folders(id) ON DELETE SET NULL;
             ALTER TABLE card_links ADD COLUMN direction INTEGER NOT NULL DEFAULT 0;
             ALTER TABLE card_links ADD COLUMN note TEXT NOT NULL DEFAULT '';
             COMMIT;",
        )?;
    }
    if version < 8 {
        // Related items (Zotero's "Related"): undirected, stored once per pair with item_a < item_b.
        conn.execute_batch(
            "BEGIN;
             CREATE TABLE item_relations (
                 item_a     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                 item_b     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                 created_at INTEGER NOT NULL,
                 CHECK (item_a < item_b),
                 PRIMARY KEY (item_a, item_b)
             );
             CREATE INDEX idx_item_relations_b ON item_relations(item_b);
             COMMIT;",
        )?;
    }
    if version < 9 {
        // Heptabase-style whiteboards: sections (named regions on a board) and card tags.
        conn.execute_batch(
            "BEGIN;
             CREATE TABLE board_sections (
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
             CREATE INDEX idx_card_tags_name ON card_tags(name);
             COMMIT;",
        )?;
    }
    conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
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
