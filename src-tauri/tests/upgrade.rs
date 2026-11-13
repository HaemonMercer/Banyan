//! Opening databases after a Banyan update: backups, rollback of failed upgrades, newer files.

use std::fs;
use std::path::{Path, PathBuf};

use banyan_lib::db::{self, DbError, SCHEMA_VERSION};
use banyan_lib::library::Library;
use rusqlite::Connection;

fn temp_root() -> PathBuf {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("banyan-upgrade-{stamp}"));
    fs::create_dir_all(&root).unwrap();
    root
}

fn version(path: &Path) -> i32 {
    Connection::open(path).unwrap().query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap()
}

fn has_column(path: &Path, table: &str, column: &str) -> bool {
    Connection::open(path)
        .unwrap()
        .prepare(&format!("SELECT 1 FROM pragma_table_info('{table}') WHERE name = ?1"))
        .unwrap()
        .exists([column])
        .unwrap()
}

/// A current library with one item, turned back into a v15 database (as an older Banyan left it).
fn v15_library(dir: &Path) {
    drop(Library::open(dir).unwrap());
    let conn = Connection::open(dir.join("banyan.db")).unwrap();
    conn.execute_batch(
        "INSERT INTO items (item_type, title, created_at, updated_at) VALUES ('book', 'SICP', 1, 1);
         DROP TABLE card_annotations;
         DROP TABLE annotations;
         ALTER TABLE attachments DROP COLUMN mirror_of;
         ALTER TABLE board_cards DROP COLUMN collapsed;
         ALTER TABLE board_cards DROP COLUMN auto_height;
         DROP INDEX idx_items_cite_key;
         ALTER TABLE items DROP COLUMN cite_key;
         ALTER TABLE items DROP COLUMN cite_key_manual;
         PRAGMA user_version = 15;",
    )
    .unwrap();
}

#[test]
fn upgrade_makes_a_backup_and_says_so() {
    let root = temp_root();
    v15_library(&root);
    let mut lib = Library::open(&root).unwrap();
    let notice = lib.notice.take().expect("upgrade is reported");
    assert!(notice.contains(&format!("第 15 版升級到第 {SCHEMA_VERSION} 版")), "{notice}");

    let backups = db::list_backups(&lib.backup_dir());
    assert_eq!(backups.len(), 1);
    let name = backups[0].file_name().unwrap().to_string_lossy().to_string();
    assert!(name.starts_with("banyan-v15-") && name.ends_with(".db"), "{name}");
    assert!(notice.contains(&backups[0].display().to_string()));
    // The backup is the database as it was before the upgrade.
    assert_eq!(version(&backups[0]), 15);
    assert!(!has_column(&backups[0], "attachments", "mirror_of"));
    let title: String = Connection::open(&backups[0])
        .unwrap()
        .query_row("SELECT title FROM items", [], |r| r.get(0))
        .unwrap();
    assert_eq!(title, "SICP");
    // The database itself is current.
    assert_eq!(version(&root.join("banyan.db")), SCHEMA_VERSION);
    assert!(!has_column(&backups[0], "board_cards", "collapsed"));
    assert!(has_column(&root.join("banyan.db"), "board_cards", "collapsed"));
    assert!(has_column(&root.join("banyan.db"), "board_cards", "auto_height"));
    // v20: existing items get citation keys.
    let key: String = Connection::open(root.join("banyan.db"))
        .unwrap()
        .query_row("SELECT cite_key FROM items", [], |r| r.get(0))
        .unwrap();
    assert_eq!(key, "sicp");
    drop(lib);

    // Opening an up-to-date database neither reports nor backs up anything.
    let lib = Library::open(&root).unwrap();
    assert!(lib.notice.is_none());
    assert_eq!(db::list_backups(&lib.backup_dir()).len(), 1);
    drop(lib);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn new_database_needs_no_backup() {
    let root = temp_root();
    let lib = Library::open(&root).unwrap();
    assert!(lib.notice.is_none());
    assert!(!lib.backup_dir().exists());
    drop(lib);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn only_the_newest_backups_are_kept() {
    let root = temp_root();
    for _ in 0..db::KEEP_BACKUPS + 2 {
        v15_library(&root);
        drop(Library::open(&root).unwrap());
    }
    assert_eq!(db::list_backups(&root.join("backups")).len(), db::KEEP_BACKUPS);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn failed_upgrade_is_rolled_back() {
    let root = temp_root();
    let path = root.join("banyan.db");
    drop(Library::open(&root).unwrap());
    // A v14 database where the v16 step will fail (mirror_of already exists),
    // after the v15 step has already added collections.library.
    Connection::open(&path)
        .unwrap()
        .execute_batch(
            "INSERT INTO items (item_type, title, created_at, updated_at) VALUES ('book', 'SICP', 1, 1);
             ALTER TABLE collections DROP COLUMN library;
             PRAGMA user_version = 14;",
        )
        .unwrap();

    let err = db::open(&path).unwrap_err();
    assert!(matches!(err, DbError::UpgradeFailed { from: 14, backup: Some(_), .. }), "{err:?}");
    let message = err.to_string();
    assert!(message.contains("已全部還原") && message.contains("banyan-v14-"), "{message}");

    // Nothing changed: still v14, and the v15 column added before the failure is gone again.
    assert_eq!(version(&path), 14);
    assert!(!has_column(&path, "collections", "library"));
    let n: i64 = Connection::open(&path).unwrap().query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 1);
    // Through Library::open the same message comes back as the error.
    assert_eq!(Library::open(&root).err().unwrap().0.contains("已全部還原"), true);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn newer_database_is_not_opened() {
    let root = temp_root();
    let path = root.join("banyan.db");
    drop(Library::open(&root).unwrap());
    Connection::open(&path).unwrap().execute_batch("PRAGMA user_version = 99;").unwrap();

    let err = db::open(&path).unwrap_err();
    assert!(matches!(err, DbError::TooNew { found: 99, supported: SCHEMA_VERSION }));
    assert!(err.to_string().contains("請把 Banyan 更新到最新版本"));
    assert_eq!(version(&path), 99, "left untouched");
    assert!(!root.join("backups").exists());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn stand_in_library_has_the_schema() {
    let lib = Library::in_memory().unwrap();
    let n: i64 = lib.conn.query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 0);
}

fn titles(lib: &Library) -> Vec<String> {
    lib.conn
        .prepare("SELECT title FROM items ORDER BY id")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
}

#[test]
fn restoring_a_backup_brings_back_the_old_data() {
    let root = temp_root();
    v15_library(&root);
    let mut lib = Library::open(&root).unwrap();
    // Work done after the upgrade, which the restore takes away.
    lib.conn
        .execute("INSERT INTO items (item_type, title, created_at, updated_at) VALUES ('book', 'TAOCP', 2, 2)", [])
        .unwrap();
    assert_eq!(titles(&lib), ["SICP", "TAOCP"]);

    let backups = lib.backups();
    assert_eq!(backups.len(), 1);
    assert_eq!(backups[0].version, 15);
    assert!(!backups[0].before_restore);
    let message = lib.restore_backup(&backups[0].name).unwrap();
    assert!(message.contains("第 15 版") && message.contains(&format!("升級到第 {SCHEMA_VERSION} 版")), "{message}");
    assert_eq!(lib.notice.as_deref(), Some(message.as_str()));

    // The backup's data, upgraded to the current schema.
    assert_eq!(titles(&lib), ["SICP"]);
    assert_eq!(version(&root.join("banyan.db")), SCHEMA_VERSION);
    assert!(!root.join("banyan.db.restoring").exists());

    // The database from before the restore was kept, and can itself be restored.
    let saved = lib.backups().into_iter().find(|b| b.before_restore).expect("pre-restore copy");
    assert_eq!(saved.version, SCHEMA_VERSION);
    assert!(message.contains(&saved.name));
    lib.restore_backup(&saved.name).unwrap();
    assert_eq!(titles(&lib), ["SICP", "TAOCP"]);
    drop(lib);

    // Still fine after reopening (no stale WAL got applied).
    let lib = Library::open(&root).unwrap();
    assert_eq!(titles(&lib), ["SICP", "TAOCP"]);
    drop(lib);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn unusable_backups_are_not_restored() {
    let root = temp_root();
    v15_library(&root);
    let mut lib = Library::open(&root).unwrap();
    lib.conn
        .execute("INSERT INTO items (item_type, title, created_at, updated_at) VALUES ('book', 'TAOCP', 2, 2)", [])
        .unwrap();

    // Only files in backups/ can be restored.
    assert!(lib.restore_backup("../banyan.db").is_err());
    assert!(lib.restore_backup("banyan-v1-nothing.db").is_err());

    // A backup from a newer Banyan.
    let name = lib.backups()[0].name.clone();
    let path = lib.backup_dir().join(&name);
    Connection::open(&path).unwrap().execute_batch("PRAGMA user_version = 99;").unwrap();
    let err = lib.restore_backup(&name).unwrap_err();
    assert!(err.0.contains("較新版"), "{}", err.0);

    // A file that isn't a database.
    fs::write(&path, b"not a database at all, just some text that is long enough").unwrap();
    assert!(lib.restore_backup(&name).is_err());

    // Nothing changed, and no pre-restore copy was made.
    assert_eq!(titles(&lib), ["SICP", "TAOCP"]);
    assert!(lib.backups().iter().all(|b| !b.before_restore));
    drop(lib);
    let _ = fs::remove_dir_all(root);
}
