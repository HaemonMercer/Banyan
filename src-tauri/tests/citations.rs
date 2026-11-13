//! Citation keys: generated from item data, fixed once cited, renamed by hand with the cards'
//! text rewritten; looked up for items and annotations; imported from BibTeX; cited by cards.

use std::fs;
use std::sync::Mutex;

use banyan_lib::annotations::create_annotation;
use banyan_lib::citations::*;
use banyan_lib::drawer::*;
use banyan_lib::library::Library;
use banyan_lib::whiteboard::{create_card, create_whiteboard, sync_wiki_links, update_card};
use serde_json::{json, Value};
use tauri::Manager;

fn setup() -> (tauri::App<tauri::test::MockRuntime>, std::path::PathBuf) {
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let root = std::env::temp_dir().join(format!("banyan-cite-test-{stamp}"));
    fs::create_dir_all(&root).unwrap();
    let default_dir = root.join("default");
    let lib = Library::open(&default_dir).unwrap();
    let app = tauri::test::mock_builder().build(tauri::test::mock_context(tauri::test::noop_assets())).unwrap();
    app.manage(DrawerState {
        lib: Mutex::new(lib),
        default_dir,
        config_path: root.join("config.json"),
        startup_warning: Mutex::new(None),
        link_threshold: 100,
    });
    (app, root)
}

fn j<T: serde::Serialize>(v: T) -> Value {
    serde_json::to_value(v).unwrap()
}

#[test]
fn keys_follow_data_until_cited_and_can_be_renamed() {
    let (app, root) = setup();
    let s = || app.state::<DrawerState>();

    let book = j(create_item(s(), "book".into(), None).unwrap())["id"].as_i64().unwrap();
    let set = |id: i64, title: &str, date: &str| {
        let mut f = j(get_item(s(), id).unwrap());
        f["title"] = json!(title);
        f["date"] = json!(date);
        update_item(s(), id, serde_json::from_value(f).unwrap()).unwrap();
    };
    set(book, "Thinking, Fast and Slow", "");
    assert_eq!(j(get_item(s(), book).unwrap())["citeKey"], "thinking");
    set(book, "Thinking, Fast and Slow", "2011");
    set_item_creators(s(), book, vec![Creator { role: "author".into(), name: "Kahneman, Daniel".into() }]).unwrap();
    assert_eq!(j(get_item(s(), book).unwrap())["citeKey"], "kahneman2011");

    // A second item with the same data gets a suffix.
    let other = j(create_item(s(), "book".into(), None).unwrap())["id"].as_i64().unwrap();
    set(other, "Attention and Effort", "2011");
    set_item_creators(s(), other, vec![Creator { role: "author".into(), name: "Daniel Kahneman".into() }]).unwrap();
    assert_eq!(j(get_item(s(), other).unwrap())["citeKey"], "kahneman2011a");

    // Once a card cites it, the key no longer follows the data.
    let board = j(create_whiteboard(s(), "板".into(), None).unwrap())["id"].as_i64().unwrap();
    let card = j(create_card(s(), board, 0.0, 0.0).unwrap())["id"].as_i64().unwrap();
    update_card(s(), card, "筆記".into(), "見 [@kahneman2011, p. 3] 與 [[@kahneman2011a]]".into()).unwrap();
    set(book, "Thinking, Fast and Slow", "2013");
    assert_eq!(j(get_item(s(), book).unwrap())["citeKey"], "kahneman2011");

    // Renaming by hand rewrites the cards; a taken or invalid key is refused.
    assert!(set_cite_key(s(), other, "kahneman2011".into()).is_err());
    assert!(set_cite_key(s(), other, "有 空格".into()).is_err());
    assert_eq!(set_cite_key(s(), book, "@tfs".into()).unwrap(), "tfs");
    let resolved = j(resolve_cite_keys(s(), vec!["tfs".into(), "@kahneman2011a".into(), "nope".into()]).unwrap());
    assert_eq!(resolved.as_array().unwrap().len(), 2);
    assert_eq!(resolved[0]["item"]["title"], "Thinking, Fast and Slow");
    assert_eq!(resolved[0]["item"]["creators"][0]["name"], "Kahneman, Daniel");

    // Card cites: `@key` targets add card_items.
    let content = "見 [@tfs, p. 3] 與 [[@kahneman2011a]]";
    let created = j(sync_wiki_links(s(), card, vec!["@tfs".into(), "@kahneman2011a".into(), "@nope".into()]).unwrap());
    assert_eq!(created.as_array().unwrap().len(), 0, "citations are not card links");
    let state = s();
    let cited: i64 = {
        let lib = state.lock();
        lib.conn.query_row("SELECT COUNT(*) FROM card_items WHERE card_id = ?1", [card], |r| r.get(0)).unwrap()
    };
    assert_eq!(cited, 2);
    let text: String = {
        let lib = state.lock();
        lib.conn.query_row("SELECT content FROM cards WHERE id = ?1", [card], |r| r.get(0)).unwrap()
    };
    assert_eq!(text, content);

    // Search: by key prefix, title or author.
    let hits = j(search_citables(s(), "kahn".into(), None).unwrap());
    assert_eq!(hits.as_array().unwrap().len(), 2);
    assert_eq!(j(search_citables(s(), "tf".into(), None).unwrap())[0]["key"], "tfs");

    drop(app);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn annotation_keys_and_import() {
    let (app, root) = setup();
    let s = || app.state::<DrawerState>();

    // A file attachment with two highlights and a bookmark.
    let book = j(create_item(s(), "book".into(), None).unwrap())["id"].as_i64().unwrap();
    let dir = root.join("src");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("b.pdf"), b"%PDF-1.4").unwrap();
    let att = j(add_attachments(s(), book, vec![dir.join("b.pdf").to_string_lossy().to_string()]).unwrap())[0]["id"].as_i64().unwrap();
    let key = j(get_item(s(), book).unwrap())["citeKey"].as_str().unwrap().to_string();
    let loc = r#"{"type":"pdf","page":3,"rects":[]}"#.to_string();
    let mk = |kind: &str, quote: &str| {
        j(create_annotation(s(), att, kind.into(), "yellow".into(), quote.into(), "".into(), loc.clone(), 0.0).unwrap())["id"].as_i64().unwrap()
    };
    let h1 = mk("highlight", "第一段");
    let b1 = mk("bookmark", "");
    let h2 = mk("highlight", "第二段");
    let got = j(resolve_cite_keys(s(), vec![format!("{key}:h2"), format!("{key}:b1"), format!("{key}:h9")]).unwrap());
    assert_eq!(got.as_array().unwrap().len(), 2);
    assert_eq!(got[0]["annotation"]["id"], h2);
    assert_eq!(got[0]["annotation"]["quote"], "第二段");
    assert_eq!(got[1]["annotation"]["id"], b1);
    // An annotation's own key (what dragging it onto a card writes).
    assert_eq!(annotation_cite_key(s(), h1).unwrap().as_deref(), Some(format!("{key}:h1").as_str()));
    assert_eq!(annotation_cite_key(s(), b1).unwrap().as_deref(), Some(format!("{key}:b1").as_str()));
    assert_eq!(annotation_cite_key(s(), 99999).unwrap(), None);
    // Quote search finds annotations with their keys.
    let hits = j(search_citables(s(), "第二".into(), None).unwrap());
    assert!(hits.as_array().unwrap().iter().any(|h| h["key"] == format!("{key}:h2")));

    // Import keeps free keys, renames taken ones, and maps fields and creators.
    let entries = serde_json::from_value(json!([
        { "itemType": "journalArticle", "citeKey": "smith2020",
          "fields": { "title": "A study", "date": "2020", "publication": "Nature", "volume": "3", "notAField": "x" },
          "creators": [{ "role": "author", "name": "Smith, John" }, { "role": "author", "name": "Doe, Jane" }],
          "tags": ["統計"] },
        { "itemType": "book", "citeKey": "smith2020", "fields": { "title": "Again" } },
        { "itemType": "book", "citeKey": "", "fields": { "title": "No key", "date": "1999" } }
    ]))
    .unwrap();
    let res = j(import_items(s(), entries, None).unwrap());
    assert_eq!(res["keys"], json!(["smith2020", "smith2020a", "no1999"]));
    assert_eq!(res["renamed"], 1);
    let items = j(list_cite_items(s(), None, Some("literature".into())).unwrap());
    let smith = items.as_array().unwrap().iter().find(|i| i["citeKey"] == "smith2020").unwrap();
    assert_eq!(smith["publication"], "Nature");
    assert_eq!(smith["creators"].as_array().unwrap().len(), 2);
    assert_eq!(smith["tags"], json!(["統計"]));
    // Imported keys are fixed (set by hand).
    let id = smith["id"].as_i64().unwrap();
    let mut f = j(get_item(s(), id).unwrap());
    f["date"] = json!("2024");
    update_item(s(), id, serde_json::from_value(f).unwrap()).unwrap();
    assert_eq!(j(get_item(s(), id).unwrap())["citeKey"], "smith2020");
    assert!(import_items(s(), serde_json::from_value(json!([{ "itemType": "fileImage", "citeKey": "x" }])).unwrap(), None).is_err());

    drop(app);
    let _ = fs::remove_dir_all(root);
}
