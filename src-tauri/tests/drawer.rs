//! Drives the Drawer commands against a temporary database, passing JSON the way the frontend does.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use banyan_lib::drawer::*;
use banyan_lib::library::*;
use serde_json::{json, Value};
use tauri::Manager;

fn temp_root() -> PathBuf {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("banyan-test-{stamp}"));
    fs::create_dir_all(&root).unwrap();
    root
}

/// App with a library in `<root>/default`; returns (app, root, storage dir).
fn setup() -> (tauri::App<tauri::test::MockRuntime>, PathBuf, PathBuf) {
    let root = temp_root();
    let default_dir = root.join("default");
    let lib = Library::open(&default_dir).unwrap();
    let storage_dir = lib.storage_dir();
    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    app.manage(DrawerState {
        lib: Mutex::new(lib),
        default_dir,
        config_path: root.join("config").join("config.json"),
        startup_warning: Mutex::new(None),
        // Tiny threshold so tests don't need a 5 GB file.
        link_threshold: 100,
    });
    (app, root, storage_dir)
}

fn j<T: serde::Serialize>(v: T) -> Value {
    serde_json::to_value(v).unwrap()
}

fn filter(v: Value) -> ItemFilter {
    serde_json::from_value(v).unwrap()
}

#[test]
fn library_round_trip() {
    let (app, root, storage) = setup();
    let s = || app.state::<DrawerState>();
    let count = |f: Value| list_items(s(), filter(f)).unwrap().len();

    // Collections: nesting, validation, rename.
    let ml = j(create_collection(s(), "機器學習".into(), None, None).unwrap())["id"].as_i64().unwrap();
    let nlp = j(create_collection(s(), "NLP".into(), Some(ml), None).unwrap())["id"].as_i64().unwrap();
    assert!(create_collection(s(), "  ".into(), None, None).is_err());
    rename_collection(s(), nlp, "自然語言".into()).unwrap();
    let cols = j(list_collections(s()).unwrap());
    assert_eq!(cols.as_array().unwrap().len(), 2);
    assert!(cols.as_array().unwrap().iter().any(|c| c["name"] == "自然語言" && c["parentId"] == ml));

    // Items.
    let a = j(create_item(s(), "journalArticle".into(), Some(nlp)).unwrap())["id"].as_i64().unwrap();
    let b = j(create_item(s(), "book".into(), None).unwrap())["id"].as_i64().unwrap();
    let mut fields = j(get_item(s(), a).unwrap());
    fields["title"] = json!("Attention Is All You Need");
    update_item(s(), a, serde_json::from_value(fields).unwrap()).unwrap();
    let creators = |v: Value| -> Vec<Creator> { serde_json::from_value(v).unwrap() };
    set_item_creators(
        s(),
        a,
        creators(json!([
            { "role": "translator", "name": "  王小明 " },
            { "role": "author", "name": "Ashish Vaswani" },
            { "role": "author", "name": "" },
            { "role": "author", "name": "Noam Shazeer" },
            { "role": "editor", "name": "Jane Editor" },
        ])),
    )
    .unwrap();
    set_item_tags(s(), a, vec!["transformer".into(), " ".into(), "Transformer".into()]).unwrap();

    let detail = j(get_item(s(), a).unwrap());
    assert_eq!(detail["title"], "Attention Is All You Need");
    assert_eq!(detail["tags"], json!(["transformer"])); // blank dropped, case-insensitive dedupe
    assert_eq!(detail["collectionIds"], json!([nlp]));
    // Order and roles kept, names trimmed, blanks dropped.
    assert_eq!(
        detail["creators"],
        json!([
            { "role": "translator", "name": "王小明" },
            { "role": "author", "name": "Ashish Vaswani" },
            { "role": "author", "name": "Noam Shazeer" },
            { "role": "editor", "name": "Jane Editor" },
        ])
    );
    // The list shows authors first, even though the translator was entered first.
    let summary = j(list_items(s(), filter(json!({ "query": "Attention" }))).unwrap());
    assert_eq!(summary[0]["authors"], "Ashish Vaswani\nNoam Shazeer\n王小明\nJane Editor");
    assert_eq!(count(json!({ "query": "王小明" })), 1); // translators are searchable
    // Changing the type re-ranks: for a film the main role is director.
    let mut film = j(get_item(s(), a).unwrap());
    film["itemType"] = json!("film");
    update_item(s(), a, serde_json::from_value(film.clone()).unwrap()).unwrap();
    set_item_creators(s(), a, creators(json!([
        { "role": "castMember", "name": "Peter O'Toole" },
        { "role": "director", "name": "David Lean" },
    ]))).unwrap();
    let summary = j(list_items(s(), filter(json!({ "query": "Attention" }))).unwrap());
    assert_eq!(summary[0]["authors"], "David Lean\nPeter O'Toole");
    film["itemType"] = json!("journalArticle");
    update_item(s(), a, serde_json::from_value(film).unwrap()).unwrap();
    set_item_creators(s(), a, creators(json!([
        { "role": "author", "name": "Ashish Vaswani" },
        { "role": "author", "name": "Noam Shazeer" },
    ]))).unwrap();

    // Filters and search; LIKE wildcards are matched literally.
    assert_eq!(count(json!({})), 2);
    assert_eq!(count(json!({ "collectionId": nlp })), 1);
    assert_eq!(count(json!({ "collectionId": ml })), 0); // sub-collections aren't included
    let unfiled = j(list_items(s(), filter(json!({ "unfiled": true }))).unwrap());
    assert_eq!(unfiled[0]["id"], b);
    assert_eq!(unfiled.as_array().unwrap().len(), 1);
    assert_eq!(count(json!({ "query": "shazeer" })), 1);
    assert_eq!(count(json!({ "query": "TRANSF" })), 1);
    assert_eq!(count(json!({ "query": "%" })), 0);

    // Non-literature types use the media/art columns, which are saved and searchable.
    let m = j(create_item(s(), "painting".into(), None).unwrap())["id"].as_i64().unwrap();
    let mut art = j(get_item(s(), m).unwrap());
    art["title"] = json!("星夜");
    art["medium"] = json!("油彩、畫布");
    art["dimensions"] = json!("73.7 × 92.1 cm");
    art["place"] = json!("紐約現代藝術博物館");
    art["catalogNumber"] = json!("472.1941");
    update_item(s(), m, serde_json::from_value(art).unwrap()).unwrap();
    let art = j(get_item(s(), m).unwrap());
    assert_eq!(art["itemType"], "painting");
    assert_eq!(art["dimensions"], "73.7 × 92.1 cm");
    assert_eq!(art["catalogNumber"], "472.1941");
    assert_eq!(count(json!({ "query": "油彩" })), 1);
    assert_eq!(count(json!({ "query": "472.19" })), 1);
    // Missing keys deserialize as empty strings (older callers keep working).
    update_item(s(), m, serde_json::from_value(json!({ "itemType": "painting", "title": "星夜" })).unwrap()).unwrap();
    assert_eq!(j(get_item(s(), m).unwrap())["medium"], "");
    delete_item(s(), m).unwrap();

    // Drag-and-drop onto a folder: add keeps other memberships, move leaves the source.
    let other = j(create_collection(s(), "其他".into(), None, None).unwrap())["id"].as_i64().unwrap();
    assert_eq!(add_items_to_collection(s(), vec![a, b, 999_999], other, None).unwrap(), 2);
    assert_eq!(add_items_to_collection(s(), vec![a], other, None).unwrap(), 0); // already there
    assert_eq!(j(get_item(s(), a).unwrap())["collectionIds"].as_array().unwrap().len(), 2);
    assert_eq!(add_items_to_collection(s(), vec![a], ml, Some(nlp)).unwrap(), 1);
    let ids = j(get_item(s(), a).unwrap())["collectionIds"].clone();
    assert!(ids.as_array().unwrap().contains(&json!(ml)) && !ids.as_array().unwrap().contains(&json!(nlp)));
    assert!(add_items_to_collection(s(), vec![a], 999_999, None).is_err());
    delete_collection(s(), other).unwrap();
    set_item_collections(s(), a, vec![nlp]).unwrap();
    set_item_collections(s(), b, vec![]).unwrap();

    // Membership edits.
    set_item_collections(s(), b, vec![ml, nlp]).unwrap();
    assert_eq!(count(json!({ "collectionId": nlp })), 2);

    // Attachments: copy, name collision, folders skipped, delete.
    let src = root.join("paper.pdf");
    fs::write(&src, b"%PDF-1.4 test").unwrap();
    let p = src.to_string_lossy().to_string();
    let added = j(add_attachments(s(), a, vec![p.clone(), p, root.to_string_lossy().into()]).unwrap());
    assert_eq!(added.as_array().unwrap().len(), 2);
    assert_eq!(added[0]["fileName"], "paper.pdf");
    assert_eq!(added[1]["fileName"], "paper (2).pdf");
    let item_dir = storage.join(a.to_string());
    assert!(item_dir.join("paper (2).pdf").is_file());
    let hit = j(list_items(s(), filter(json!({ "query": "paper" }))).unwrap());
    assert_eq!(hit[0]["attachmentCount"], 2);
    let listed = j(list_attachments(s(), a).unwrap());
    assert_eq!(listed.as_array().unwrap().len(), 2);
    assert_eq!(listed[1]["fileName"], "paper (2).pdf");
    delete_attachment(s(), added[1]["id"].as_i64().unwrap()).unwrap();
    assert!(!item_dir.join("paper (2).pdf").exists());

    // Files over the threshold are linked, not copied; deleting the link keeps the original.
    let big = root.join("big-video.mkv");
    fs::write(&big, vec![0u8; 150]).unwrap();
    let small = root.join("notes.txt");
    fs::write(&small, b"small").unwrap();
    let added = j(add_attachments(s(), a, vec![big.to_string_lossy().into(), small.to_string_lossy().into()]).unwrap());
    assert_eq!(added[0]["linked"], true);
    assert_eq!(added[0]["size"], 150);
    assert_eq!(added[0]["linkedPath"], big.to_string_lossy().as_ref());
    assert!(!item_dir.join("big-video.mkv").exists(), "large file must not be copied");
    assert_eq!(added[1]["linked"], false);
    assert!(added[1]["linkedPath"].is_null());
    assert!(item_dir.join("notes.txt").is_file());
    let detail = j(get_item(s(), a).unwrap());
    let linked = detail["attachments"].as_array().unwrap().iter().find(|x| x["fileName"] == "big-video.mkv").unwrap();
    assert_eq!(linked["linked"], true);
    let linked_id = linked["id"].as_i64().unwrap();
    delete_attachment(s(), linked_id).unwrap();
    assert!(big.is_file(), "deleting a linked attachment must never delete the original");
    // Re-link, then delete the whole item: the original still survives.
    add_attachments(s(), a, vec![big.to_string_lossy().into()]).unwrap();

    // Deleting a parent collection removes its children; items stay, now unfiled.
    delete_collection(s(), ml).unwrap();
    assert!(list_collections(s()).unwrap().is_empty());
    assert_eq!(count(json!({ "unfiled": true })), 2);

    // Deleting an item removes its files and orphaned tags.
    delete_item(s(), a).unwrap();
    assert!(!item_dir.exists());
    assert!(big.is_file(), "deleting an item must never delete a linked original");
    assert!(get_item(s(), a).is_err());
    let tags: i64 = s()
        .lock()
        .conn
        .query_row("SELECT COUNT(*) FROM tags", [], |r| r.get(0))
        .unwrap();
    assert_eq!(tags, 0);

    drop(app);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn change_library_location() {
    let (app, root, old_storage) = setup();
    let s = || app.state::<DrawerState>();
    let change = |path: &PathBuf, mode: &str| {
        tauri::async_runtime::block_on(change_library_dir(
            s(),
            path.to_string_lossy().into(),
            serde_json::from_value(json!(mode)).unwrap(),
        ))
        .map(j)
        .map_err(|e| e.0)
    };
    let titles = || -> Vec<String> {
        j(list_items(s(), filter(json!({})))
            .unwrap())
            .as_array()
            .unwrap()
            .iter()
            .map(|i| i["title"].as_str().unwrap().to_string())
            .collect()
    };

    // Seed the default library with an item and an attachment.
    let id = j(create_item(s(), "cd".into(), None).unwrap())["id"].as_i64().unwrap();
    let mut f = j(get_item(s(), id).unwrap());
    f["title"] = json!("Kind of Blue");
    update_item(s(), id, serde_json::from_value(f).unwrap()).unwrap();
    let src = root.join("cover.jpg");
    fs::write(&src, b"jpg").unwrap();
    add_attachments(s(), id, vec![src.to_string_lossy().into()]).unwrap();

    let info = j(get_library_info(s()));
    assert_eq!(info["isDefault"], true);

    // Guard rails.
    let default_dir = root.join("default");
    assert!(change(&default_dir, "move").unwrap_err().contains("目前"));
    assert!(change(&old_storage.join("x"), "move").unwrap_err().contains("附件"));
    assert!(change(&root.join("nothing"), "open").unwrap_err().contains("沒有資料庫"));
    assert!(change(&PathBuf::from("relative"), "new").is_err());

    // Move: data and files come along, the original stays untouched, config remembers it.
    let moved = root.join("Dropbox").join("Banyan");
    let info = change(&moved, "move").unwrap();
    assert_eq!(info["isDefault"], false);
    assert_eq!(titles(), vec!["Kind of Blue"]);
    assert!(moved.join("storage").join(id.to_string()).join("cover.jpg").is_file());
    assert!(old_storage.join(id.to_string()).join("cover.jpg").is_file());
    let cfg = load_config(&root.join("config").join("config.json"));
    assert_eq!(cfg.library_dir.as_deref(), Some(moved.as_path()));
    // Attachments resolve against the new location.
    delete_attachment(s(), j(get_item(s(), id).unwrap())["attachments"][0]["id"].as_i64().unwrap()).unwrap();
    assert!(!moved.join("storage").join(id.to_string()).join("cover.jpg").exists());
    assert!(old_storage.join(id.to_string()).join("cover.jpg").is_file());

    // New: empty library; can't "new" or "move" onto an existing one.
    let fresh = root.join("fresh");
    change(&fresh, "new").unwrap();
    assert!(titles().is_empty());
    assert!(change(&moved, "new").unwrap_err().contains("已經有資料庫"));
    assert!(change(&moved, "move").unwrap_err().contains("已經有資料庫"));

    // Open: switch back to an existing library; back to default clears the config entry.
    change(&moved, "open").unwrap();
    assert_eq!(titles(), vec!["Kind of Blue"]);
    let info = change(&default_dir, "open").unwrap();
    assert_eq!(info["isDefault"], true);
    assert!(load_config(&root.join("config").join("config.json")).library_dir.is_none());

    drop(app);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn missing_library_falls_back_with_warning() {
    let root = temp_root();
    let default_dir = root.join("default");
    let config = Config { library_dir: Some(root.join("unplugged-drive")) };
    let (lib, warning) = open_startup_library(&config, &default_dir).unwrap();
    assert_eq!(lib.dir, default_dir);
    assert!(warning.unwrap().contains("unplugged-drive"));
    // The missing folder is not created behind the user's back.
    assert!(!root.join("unplugged-drive").exists());
    drop(lib);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn old_authors_migrate_to_creators() {
    let root = temp_root();
    let db_path = root.join("old.db");
    {
        // Build a current DB, then turn it back into a v3 one with free-text authors.
        let conn = banyan_lib::db::open(&db_path).unwrap();
        conn.execute_batch(
            "ALTER TABLE items DROP COLUMN full_text;
             ALTER TABLE collections DROP COLUMN view;
             ALTER TABLE cards DROP COLUMN kind;
             ALTER TABLE cards DROP COLUMN data;
             DROP TABLE card_versions;
             ALTER TABLE items DROP COLUMN series;
             ALTER TABLE items DROP COLUMN series_number;
             DROP TABLE board_sections;
             DROP TABLE card_tags;
             DROP TABLE item_relations;
             DROP TABLE whiteboard_folders;
             ALTER TABLE whiteboards DROP COLUMN folder_id;
             ALTER TABLE card_links DROP COLUMN direction;
             ALTER TABLE card_links DROP COLUMN note;
             DROP TABLE item_creators;
             DROP TABLE card_items;
             ALTER TABLE items ADD COLUMN notes TEXT NOT NULL DEFAULT '';
             DROP TABLE card_links;
             DROP TABLE board_cards;
             DROP TABLE cards;
             DROP TABLE whiteboards;
             INSERT INTO items (id, item_type, authors, created_at, updated_at)
                  VALUES (1, 'film', 'David Lean\n\n  Robert Bolt ', 0, 0),
                         (2, 'book', 'Abelson\nSussman', 0, 0),
                         (3, 'book', '', 0, 0);
             PRAGMA user_version = 3;",
        )
        .unwrap();
    }
    let conn = banyan_lib::db::open(&db_path).unwrap();
    let rows: Vec<(i64, String, String)> = conn
        .prepare("SELECT item_id, role, name FROM item_creators ORDER BY item_id, position")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(
        rows,
        vec![
            (1, "director".into(), "David Lean".into()),
            (1, "director".into(), "Robert Bolt".into()),
            (2, "author".into(), "Abelson".into()),
            (2, "author".into(), "Sussman".into()),
        ]
    );
    let version: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(version, 14);
    drop(conn);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn old_notes_become_cards() {
    let root = temp_root();
    let db_path = root.join("old.db");
    {
        // Build a current DB, then turn it back into a v5 one with a notes column.
        let conn = banyan_lib::db::open(&db_path).unwrap();
        conn.execute_batch(
            "ALTER TABLE items DROP COLUMN full_text;
             ALTER TABLE collections DROP COLUMN view;
             ALTER TABLE cards DROP COLUMN kind;
             ALTER TABLE cards DROP COLUMN data;
             DROP TABLE card_versions;
             ALTER TABLE items DROP COLUMN series;
             ALTER TABLE items DROP COLUMN series_number;
             DROP TABLE board_sections;
             DROP TABLE card_tags;
             DROP TABLE item_relations;
             DROP TABLE whiteboard_folders;
             ALTER TABLE whiteboards DROP COLUMN folder_id;
             ALTER TABLE card_links DROP COLUMN direction;
             ALTER TABLE card_links DROP COLUMN note;
             DROP TABLE card_items;
             ALTER TABLE items ADD COLUMN notes TEXT NOT NULL DEFAULT '';
             INSERT INTO items (id, item_type, title, notes, created_at, updated_at)
                  VALUES (1, 'book', 'SICP', '第一章\n遞迴', 5, 7),
                         (2, 'film', '', '好看', 0, 0),
                         (3, 'book', 'Empty', '   ', 0, 0);
             PRAGMA user_version = 5;",
        )
        .unwrap();
    }
    let conn = banyan_lib::db::open(&db_path).unwrap();
    let rows: Vec<(i64, String, String, i64)> = conn
        .prepare(
            "SELECT ci.item_id, c.title, c.content, c.updated_at
             FROM card_items ci JOIN cards c ON c.id = ci.card_id ORDER BY ci.item_id",
        )
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(
        rows,
        vec![
            (1, "筆記：SICP".into(), "第一章\n遞迴".into(), 7),
            (2, "筆記".into(), "好看".into(), 0),
        ]
    );
    let has_notes: i64 = conn
        .query_row("SELECT COUNT(*) FROM pragma_table_info('items') WHERE name = 'notes'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(has_notes, 0);
    let version: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(version, 14);
    drop(conn);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn tags_in_left_pane() {
    let (app, root, _) = setup();
    let s = || app.state::<DrawerState>();
    let ids = |v: Value| -> Vec<i64> { v.as_array().unwrap().iter().map(|i| i["id"].as_i64().unwrap()).collect() };
    let tags = || j(list_tags(s()).unwrap());
    let tag_id = |name: &str| tags().as_array().unwrap().iter().find(|t| t["name"] == name).unwrap()["id"].as_i64().unwrap();

    let a = j(create_item(s(), "book".into(), None).unwrap())["id"].as_i64().unwrap();
    let b = j(create_item(s(), "book".into(), None).unwrap())["id"].as_i64().unwrap();
    let c = j(create_item(s(), "film".into(), None).unwrap())["id"].as_i64().unwrap();
    set_item_tags(s(), a, vec!["小說".into(), "日本".into()]).unwrap();
    set_item_tags(s(), b, vec!["小說".into()]).unwrap();
    set_item_tags(s(), c, vec!["Japan".into()]).unwrap();

    // Listed by name with item counts.
    let t = tags();
    assert_eq!(t.as_array().unwrap().len(), 3);
    assert_eq!(t.as_array().unwrap().iter().find(|x| x["name"] == "小說").unwrap()["count"], 2);

    // Filter by tag, also combined with search.
    let novel = tag_id("小說");
    let mut got = ids(j(list_items(s(), filter(json!({ "tagId": novel }))).unwrap()));
    got.sort();
    assert_eq!(got, vec![a, b]);
    assert_eq!(ids(j(list_items(s(), filter(json!({ "tagId": novel, "query": "日本" }))).unwrap())), vec![a]);

    // Drag an item onto a tag.
    assert_eq!(add_tag_to_items(s(), vec![c, 999_999], novel).unwrap(), 1);
    assert_eq!(add_tag_to_items(s(), vec![c], novel).unwrap(), 0);
    assert!(add_tag_to_items(s(), vec![c], 999_999).is_err());

    // Rename; renaming onto an existing name (any case) merges.
    let japan = tag_id("Japan");
    assert_eq!(rename_tag(s(), japan, "日本人".into()).unwrap(), japan);
    assert!(rename_tag(s(), japan, "  ".into()).is_err());
    let jp = tag_id("日本");
    let merged = rename_tag(s(), japan, "日本".into()).unwrap();
    assert_eq!(merged, jp);
    let mut got = ids(j(list_items(s(), filter(json!({ "tagId": jp }))).unwrap()));
    got.sort();
    assert_eq!(got, vec![a, c]);
    assert_eq!(tags().as_array().unwrap().len(), 2);

    // Delete removes it from every item.
    delete_tag(s(), novel).unwrap();
    assert_eq!(j(get_item(s(), a).unwrap())["tags"], json!(["日本"]));
    assert_eq!(tags().as_array().unwrap().len(), 1);

    drop(app);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn bulk_editing() {
    let (app, root, storage) = setup();
    let s = || app.state::<DrawerState>();
    let creators = |v: Value| -> Vec<Creator> { serde_json::from_value(v).unwrap() };
    let new_item = |t: &str| j(create_item(s(), t.into(), None).unwrap())["id"].as_i64().unwrap();
    let (a, b, c) = (new_item("book"), new_item("book"), new_item("film"));
    let all = vec![a, b, c];
    set_item_tags(s(), a, vec!["小說".into()]).unwrap();
    let folder = j(create_collection(s(), "文學".into(), None, None).unwrap())["id"].as_i64().unwrap();
    add_items_to_collection(s(), vec![a, b], folder, None).unwrap();

    // Summary of what the selection has in common.
    let info = j(bulk_info(s(), all.clone()).unwrap());
    assert_eq!(info["count"], 3);
    assert_eq!(info["itemTypes"][0], json!({ "value": "book", "count": 2 }));
    assert_eq!(info["tags"], json!([{ "value": "小說", "count": 1 }]));
    assert_eq!(info["collectionIds"], json!([{ "value": folder, "count": 2 }]));

    // Tags.
    assert_eq!(bulk_add_tag(s(), all.clone(), "小說".into()).unwrap(), 2);
    assert!(bulk_add_tag(s(), all.clone(), " ".into()).is_err());
    assert_eq!(j(bulk_info(s(), all.clone()).unwrap())["tags"], json!([{ "value": "小說", "count": 3 }]));
    bulk_remove_tag(s(), vec![a, b], "小說".into()).unwrap();
    assert_eq!(j(get_item(s(), a).unwrap())["tags"], json!([]));
    bulk_remove_tag(s(), vec![c], "小說".into()).unwrap();
    assert!(j(list_tags(s()).unwrap()).as_array().unwrap().is_empty(), "unused tag is dropped");

    // Folders.
    remove_items_from_collection(s(), vec![a, c], folder).unwrap();
    assert_eq!(j(bulk_info(s(), all.clone()).unwrap())["collectionIds"], json!([{ "value": folder, "count": 1 }]));

    // Fields and type.
    bulk_set_field(s(), all.clone(), "publisher".into(), " 時報出版 ".into()).unwrap();
    assert_eq!(j(get_item(s(), c).unwrap())["publisher"], "時報出版");
    bulk_set_field(s(), vec![a], "publisher".into(), "".into()).unwrap();
    assert_eq!(j(get_item(s(), a).unwrap())["publisher"], "");
    assert!(bulk_set_field(s(), all.clone(), "title".into(), "x".into()).is_err());
    assert!(bulk_set_field(s(), all.clone(), "id = 1; --".into(), "x".into()).is_err());
    bulk_set_type(s(), vec![c], "book".into()).unwrap();
    assert_eq!(j(bulk_info(s(), all.clone()).unwrap())["itemTypes"], json!([{ "value": "book", "count": 3 }]));

    // Add the same translator to all; existing same-role names are not duplicated.
    set_item_creators(s(), a, creators(json!([{ "role": "author", "name": "村上春樹" }]))).unwrap();
    set_item_creators(s(), b, creators(json!([{ "role": "translator", "name": "賴明珠" }]))).unwrap();
    let who = creators(json!([{ "role": "translator", "name": "賴明珠" }])).remove(0);
    assert_eq!(bulk_add_creator(s(), all.clone(), who).unwrap(), 2);
    assert_eq!(
        j(get_item(s(), a).unwrap())["creators"],
        json!([{ "role": "author", "name": "村上春樹" }, { "role": "translator", "name": "賴明珠" }])
    );
    assert_eq!(j(get_item(s(), b).unwrap())["creators"].as_array().unwrap().len(), 1);

    // Delete several at once, with their files.
    let f = root.join("x.pdf");
    fs::write(&f, b"x").unwrap();
    add_attachments(s(), a, vec![f.to_string_lossy().into()]).unwrap();
    delete_items(s(), vec![a, b]).unwrap();
    assert!(get_item(s(), a).is_err() && get_item(s(), b).is_err());
    assert!(get_item(s(), c).is_ok());
    assert!(!storage.join(a.to_string()).exists());

    drop(app);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn related_items() {
    let (app, root, _) = setup();
    let s = || app.state::<DrawerState>();
    let new_item = |t: &str, title: &str| {
        let id = j(create_item(s(), t.into(), None).unwrap())["id"].as_i64().unwrap();
        let mut f = j(get_item(s(), id).unwrap());
        f["title"] = json!(title);
        update_item(s(), id, serde_json::from_value(f).unwrap()).unwrap();
        id
    };
    let (a, b, c, d) = (new_item("book", "乙"), new_item("film", "甲"), new_item("book", ""), new_item("concert", "丙"));
    let related = |id: i64| -> Vec<i64> {
        j(get_item(s(), id).unwrap())["related"].as_array().unwrap().iter().map(|r| r["id"].as_i64().unwrap()).collect()
    };

    // Two-way; self, duplicates and missing items are skipped.
    assert_eq!(add_related_items(s(), a, vec![b, c, a, b, 9999]).unwrap(), 2);
    assert_eq!(related(a), vec![b, c], "sorted by title, untitled last");
    assert_eq!(related(b), vec![a]);
    assert_eq!(related(c), vec![a]);
    assert_eq!(j(get_item(s(), b).unwrap())["related"][0]["itemType"], "book");
    assert_eq!(add_related_items(s(), b, vec![a]).unwrap(), 0, "already related from the other side");
    assert!(add_related_items(s(), 9999, vec![a]).is_err());

    // Removing works from either side.
    remove_related_item(s(), c, a).unwrap();
    assert_eq!(related(a), vec![b]);
    assert!(related(c).is_empty());

    // Relate a whole selection to each other.
    assert_eq!(relate_items(s(), vec![a, b, c, d]).unwrap(), 5);
    assert_eq!(related(d), vec![a, b, c], "乙 (U+4E59) sorts before 甲 (U+7532)");
    assert_eq!(relate_items(s(), vec![a, b]).unwrap(), 0);

    // Deleting an item drops its relations.
    delete_items(s(), vec![b]).unwrap();
    assert_eq!(related(a), vec![d, c]);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn series_fields() {
    let (app, root, _) = setup();
    let s = || app.state::<DrawerState>();
    let new_book = |title: &str, series: &str, no: &str| {
        let id = j(create_item(s(), "book".into(), None).unwrap())["id"].as_i64().unwrap();
        let mut f = j(get_item(s(), id).unwrap());
        f["title"] = json!(title);
        f["series"] = json!(series);
        f["seriesNumber"] = json!(no);
        update_item(s(), id, serde_json::from_value(f).unwrap()).unwrap();
        id
    };
    let a = new_book("魔戒首部曲", "魔戒", "1");
    new_book("魔戒二部曲", "魔戒", "2");
    new_book("基地", "基地系列", "1");
    new_book("沒有系列", "", "");

    let item = j(get_item(s(), a).unwrap());
    assert_eq!((item["series"].as_str(), item["seriesNumber"].as_str()), (Some("魔戒"), Some("1")));

    // Searchable like other fields.
    assert_eq!(list_items(s(), filter(json!({ "query": "基地系列" }))).unwrap().len(), 1);

    // Autocomplete values: most used first, blanks left out; only real columns allowed.
    assert_eq!(field_values(s(), "series".into()).unwrap(), vec!["魔戒", "基地系列"]);
    assert!(field_values(s(), "id; DROP TABLE items".into()).is_err());
    assert!(field_values(s(), "item_type".into()).is_err());

    // Bulk-settable.
    bulk_set_field(s(), vec![a], "series_number".into(), "一".into()).unwrap();
    assert_eq!(j(get_item(s(), a).unwrap())["seriesNumber"], "一");
    let _ = fs::remove_dir_all(root);
}

#[test]
fn gallery_folders() {
    let (app, root, _) = setup();
    let s = || app.state::<DrawerState>();
    let new_item = |t: &str, cid: Option<i64>| create_item(s(), t.into(), cid).map(|v| j(v)["id"].as_i64().unwrap());
    let set_type = |id: i64, t: &str| {
        let mut f = j(get_item(s(), id).unwrap());
        f["itemType"] = json!(t);
        update_item(s(), id, serde_json::from_value(f).unwrap())
    };

    let gallery = j(create_collection(s(), "照片牆".into(), None, Some("gallery".into())).unwrap());
    assert_eq!(gallery["view"], "gallery");
    let g = gallery["id"].as_i64().unwrap();
    assert!(create_collection(s(), "x".into(), None, Some("grid".into())).is_err());
    let folder = j(create_collection(s(), "一般".into(), None, None).unwrap());
    assert_eq!(folder["view"], "list");
    let f = folder["id"].as_i64().unwrap();

    // Only image items go in.
    let photo = new_item("photo", Some(g)).unwrap();
    assert!(new_item("book", Some(g)).is_err());
    let book = new_item("book", Some(f)).unwrap();
    let painting = new_item("painting", None).unwrap();
    assert!(add_items_to_collection(s(), vec![painting, book], g, None).is_err());
    assert_eq!(list_items(s(), filter(json!({ "collectionId": g }))).unwrap().len(), 1, "nothing added on refusal");
    assert_eq!(add_items_to_collection(s(), vec![painting], g, None).unwrap(), 1);
    assert!(set_item_collections(s(), book, vec![f, g]).is_err());

    // An item in a gallery keeps an image type.
    assert!(set_type(photo, "book").is_err());
    set_type(photo, "painting").unwrap();
    assert!(bulk_set_type(s(), vec![photo, book], "film".into()).is_err());
    assert_eq!(j(get_item(s(), book).unwrap())["itemType"], "book", "refused bulk change changes nothing");

    // A folder becomes a gallery only when everything in it is an image item.
    assert!(set_collection_view(s(), f, "gallery".into()).is_err());
    bulk_set_type(s(), vec![book], "photo".into()).unwrap();
    set_collection_view(s(), f, "gallery".into()).unwrap();
    set_collection_view(s(), f, "list".into()).unwrap();
    assert!(set_collection_view(s(), f, "tiles".into()).is_err());

    // Dropped pictures become photo items; other files are skipped. The first picture is the cover.
    let dir = root.join("pics");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("海邊.JPG"), b"jpg").unwrap();
    fs::write(dir.join("readme.txt"), b"txt").unwrap();
    let paths = ["海邊.JPG", "readme.txt"].map(|n| dir.join(n).to_string_lossy().to_string()).to_vec();
    let ids = import_images(s(), g, paths.clone()).unwrap();
    assert_eq!(ids.len(), 1);
    assert!(import_images(s(), f, paths).is_err(), "folder is a list again");
    let items = j(list_items(s(), filter(json!({ "collectionId": g }))).unwrap());
    let new = items.as_array().unwrap().iter().find(|i| i["id"] == ids[0]).unwrap();
    assert_eq!((new["title"].as_str(), new["itemType"].as_str()), (Some("海邊"), Some("photo")));
    let image_id = new["imageId"].as_i64().unwrap();
    assert!(items.as_array().unwrap().iter().filter(|i| i["id"] != ids[0]).all(|i| i["imageId"].is_null()));
    assert!(read_attachment(s(), image_id).is_ok());
    drop(app);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn news_full_text() {
    let (app, root, _) = setup();
    let s = || app.state::<DrawerState>();
    let id = j(create_item(s(), "news".into(), None).unwrap())["id"].as_i64().unwrap();
    let text = "颱風今晚登陸\n\n  中央氣象署表示……\n第二段";
    let mut f = j(get_item(s(), id).unwrap());
    f["title"] = json!("颱風今晚登陸");
    f["fullText"] = json!(text);
    update_item(s(), id, serde_json::from_value(f).unwrap()).unwrap();
    assert_eq!(j(get_item(s(), id).unwrap())["fullText"], text, "kept exactly as pasted");
    // The full text is searchable.
    assert_eq!(list_items(s(), filter(json!({ "query": "中央氣象署" }))).unwrap().len(), 1);
    // A new reporter is the main role.
    set_item_creators(s(), id, serde_json::from_value(json!([{ "role": "reporter", "name": "王小明" }])).unwrap()).unwrap();
    assert_eq!(j(get_item(s(), id).unwrap())["creators"][0]["role"], "reporter");
    drop(app);
    let _ = fs::remove_dir_all(root);
}
