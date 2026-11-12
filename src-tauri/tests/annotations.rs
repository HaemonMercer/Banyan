//! Annotator: annotations shared by a file's copies, cards made from them, the overview.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use banyan_lib::annotations::*;
use banyan_lib::drawer::*;
use banyan_lib::library::*;
use serde_json::{json, Value};
use tauri::Manager;

fn setup() -> (tauri::App<tauri::test::MockRuntime>, PathBuf) {
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let root = std::env::temp_dir().join(format!("banyan-annot-{stamp}"));
    fs::create_dir_all(&root).unwrap();
    let default_dir = root.join("default");
    let lib = Library::open(&default_dir).unwrap();
    let app = tauri::test::mock_builder().build(tauri::test::mock_context(tauri::test::noop_assets())).unwrap();
    app.manage(DrawerState {
        lib: Mutex::new(lib),
        default_dir,
        config_path: root.join("config.json"),
        startup_warning: Mutex::new(None),
        link_threshold: 1 << 30,
    });
    (app, root)
}

fn j<T: serde::Serialize>(v: T) -> Value {
    serde_json::to_value(v).unwrap()
}

#[test]
fn annotations_follow_the_file() {
    let (app, root) = setup();
    let s = || app.state::<DrawerState>();
    let src = root.join("論文.pdf");
    fs::write(&src, b"%PDF-1.4").unwrap();
    fs::write(root.join("notes.docx"), b"x").unwrap();

    // A literature item with a PDF: the PDF also shows up in 檔案庫 (a copy sharing the file).
    let book = j(create_item(s(), "journalArticle".into(), None).unwrap())["id"].as_i64().unwrap();
    let mut f = j(get_item(s(), book).unwrap());
    f["title"] = json!("注意力就是一切");
    update_item(s(), book, serde_json::from_value(f).unwrap()).unwrap();
    let added = j(add_attachments(s(), book, vec![src.to_string_lossy().into(), root.join("notes.docx").to_string_lossy().into()]).unwrap());
    let original = added[0]["id"].as_i64().unwrap();
    let files = j(list_items(s(), serde_json::from_value(json!({ "library": "files" })).unwrap()).unwrap());
    let copy_item = files.as_array().unwrap().iter().find(|i| i["title"] == "論文").unwrap()["id"].as_i64().unwrap();
    let copy = j(get_item(s(), copy_item).unwrap())["attachments"][0]["id"].as_i64().unwrap();

    // Only PDFs and books are offered, each file once.
    let offered = j(list_annotatable_files(s()).unwrap());
    assert_eq!(offered.as_array().unwrap().len(), 1);
    assert_eq!(offered[0]["attachmentId"], original);
    assert_eq!(offered[0]["itemTitle"], "注意力就是一切");

    // Annotating through the copy stores it against the original: both see it.
    let loc = r#"{"page":3,"rects":[[0.1,0.2,0.5,0.03]]}"#;
    let a = j(create_annotation(s(), copy, "highlight".into(), "yellow".into(), " 重要的一句 ".into(), "".into(), loc.into(), 3.2).unwrap());
    assert_eq!(a["attachmentId"], original);
    assert_eq!(a["quote"], "重要的一句");
    let id = a["id"].as_i64().unwrap();
    create_annotation(s(), original, "bookmark".into(), "blue".into(), "".into(), "".into(), r#"{"page":1}"#.into(), 1.0).unwrap();
    let listed = |att: i64| j(list_annotations(s(), att).unwrap());
    assert_eq!(listed(copy), listed(original));
    assert_eq!(listed(original)[0]["kind"], "bookmark", "in file order (sort key)");
    assert_eq!(j(list_annotatable_files(s()).unwrap())[0]["annotationCount"], 2);

    // Validation.
    assert!(create_annotation(s(), original, "scribble".into(), "yellow".into(), "".into(), "".into(), "{}".into(), 0.0).is_err());
    assert!(create_annotation(s(), original, "highlight".into(), "orange".into(), "".into(), "".into(), "{}".into(), 0.0).is_err());
    assert!(create_annotation(s(), original, "highlight".into(), "yellow".into(), "".into(), "".into(), "page 3".into(), 0.0).is_err());
    assert!(create_annotation(s(), 9999, "highlight".into(), "yellow".into(), "".into(), "".into(), "{}".into(), 0.0).is_err());

    // Editing: only what's given changes.
    let u = j(update_annotation(s(), id, None, Some("  我的想法 ".into())).unwrap());
    assert_eq!((u["note"].as_str(), u["color"].as_str()), (Some("我的想法"), Some("yellow")));
    let u = j(update_annotation(s(), id, Some("green".into()), None).unwrap());
    assert_eq!((u["note"].as_str(), u["color"].as_str()), (Some("我的想法"), Some("green")));
    assert!(update_annotation(s(), id, Some("red".into()), None).is_err());

    // Overview and search.
    assert_eq!(j(search_annotations(s(), "".into()).unwrap()).as_array().unwrap().len(), 2);
    let hits = j(search_annotations(s(), "想法".into()).unwrap());
    assert_eq!(hits.as_array().unwrap().len(), 1);
    assert_eq!((hits[0]["fileName"].as_str(), hits[0]["itemId"].as_i64()), (Some("論文.pdf"), Some(book)));
    assert_eq!(j(get_annotation(s(), id).unwrap())["itemTitle"], "注意力就是一切");

    // A card from it: quote, source, note, link back; it cites the item; made once.
    let card = annotation_to_card(s(), id, "第 3 頁".into()).unwrap();
    assert_eq!(annotation_to_card(s(), id, "第 3 頁".into()).unwrap(), card, "the same card again");
    let (title, content, cites): (String, String, i64) = {
        let st = s();
        let lib = st.lock();
        lib.conn
            .query_row(
                "SELECT c.title, c.content, (SELECT COUNT(*) FROM card_items ci WHERE ci.card_id = c.id AND ci.item_id = ?2)
                 FROM cards c WHERE c.id = ?1",
                rusqlite::params![card, book],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap()
    };
    assert_eq!(title, "摘錄：重要的一句");
    assert_eq!(content, card_content("重要的一句", "我的想法", "《注意力就是一切》第 3 頁"));
    assert_eq!(content, "「重要的一句」\n— 《注意力就是一切》第 3 頁\n\n我的想法\n");
    assert_eq!(cites, 1);
    assert_eq!(j(get_annotation(s(), id).unwrap())["cardId"], card);

    // Deleting the literature item keeps the file in 檔案庫, with its annotations.
    delete_item(s(), book).unwrap();
    let kept = listed(copy);
    assert_eq!(kept.as_array().unwrap().len(), 2);
    assert_eq!(kept[0]["attachmentId"], copy);

    // Deleting an annotation keeps its card.
    delete_annotation(s(), id).unwrap();
    assert_eq!(listed(copy).as_array().unwrap().len(), 1);
    let card_left: bool = s().lock().conn.query_row("SELECT EXISTS (SELECT 1 FROM cards WHERE id = ?1)", [card], |r| r.get(0)).unwrap();
    assert!(card_left);

    // Deleting the file deletes its annotations.
    delete_attachment(s(), copy).unwrap();
    let n: i64 = s().lock().conn.query_row("SELECT COUNT(*) FROM annotations", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 0);
    drop(app);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn cards_cite_annotations() {
    let (app, root) = setup();
    let s = || app.state::<DrawerState>();
    let src = root.join("書.pdf");
    fs::write(&src, b"%PDF-1.4").unwrap();
    let item = j(create_item(s(), "book".into(), None).unwrap())["id"].as_i64().unwrap();
    let att = j(add_attachments(s(), item, vec![src.to_string_lossy().into()]).unwrap())[0]["id"].as_i64().unwrap();
    let new_annot = |q: &str| {
        j(create_annotation(s(), att, "highlight".into(), "pink".into(), q.into(), "".into(), r#"{"type":"pdf","page":1,"rects":[]}"#.into(), 1.0).unwrap())["id"]
            .as_i64()
            .unwrap()
    };
    let a = new_annot("第一段");
    let b = new_annot("第二段");

    // A card made from an annotation cites it.
    let made = annotation_to_card(s(), a, "第 1 頁".into()).unwrap();
    let count = |id: i64| j(list_annotations(s(), att).unwrap()).as_array().unwrap().iter().find(|x| x["id"] == id).unwrap()["cardCount"].as_i64().unwrap();
    assert_eq!(count(a), 1);

    // Any card can cite any annotation (once).
    let other: i64 = {
        let st = s();
        let lib = st.lock();
        lib.conn.execute("INSERT INTO cards (title, created_at, updated_at) VALUES ('我的想法', 1, 1)", []).unwrap();
        lib.conn.last_insert_rowid()
    };
    assert!(link_card_annotation(s(), other, a).unwrap());
    assert!(!link_card_annotation(s(), other, a).unwrap(), "already cited");
    assert!(link_card_annotation(s(), other, b).unwrap());
    assert!(link_card_annotation(s(), 9999, a).is_err());
    assert!(link_card_annotation(s(), other, 9999).is_err());
    assert_eq!(count(a), 2);

    let cards = j(list_annotation_cards(s(), a).unwrap());
    assert_eq!(cards.as_array().unwrap().iter().map(|c| c["cardId"].as_i64().unwrap()).collect::<Vec<_>>(), vec![made, other]);
    let detail = j(banyan_lib::whiteboard::get_card(s(), other).unwrap());
    let refs = detail["annotations"].as_array().unwrap();
    assert_eq!(refs.len(), 2);
    assert_eq!((refs[0]["quote"].as_str(), refs[0]["color"].as_str(), refs[0]["fileName"].as_str()), (Some("第一段"), Some("pink"), Some("書.pdf")));

    // Removing a citation, deleting an annotation or a card drops the citations only.
    unlink_card_annotation(s(), other, b).unwrap();
    assert_eq!(count(b), 0);
    delete_annotation(s(), a).unwrap();
    assert!(j(banyan_lib::whiteboard::get_card(s(), other).unwrap())["annotations"].as_array().unwrap().is_empty());
    link_card_annotation(s(), other, b).unwrap();
    s().lock().conn.execute("DELETE FROM cards WHERE id = ?1", [other]).unwrap();
    assert_eq!(count(b), 0);
    drop(app);

    // Upgrading from v17: cards made from annotations cite them.
    let db = root.join("default").join("banyan.db");
    {
        let conn = rusqlite::Connection::open(&db).unwrap();
        conn.execute_batch(
            "INSERT INTO cards (id, title, created_at, updated_at) VALUES (500, '摘錄', 1, 1);
             UPDATE annotations SET card_id = 500 WHERE id = (SELECT MIN(id) FROM annotations);
             DROP TABLE card_annotations;
             PRAGMA user_version = 17;",
        )
        .unwrap();
    }
    let conn = banyan_lib::db::open(&db).unwrap();
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM card_annotations WHERE card_id = 500", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 1);
    drop(conn);
    let _ = fs::remove_dir_all(root);
}
