//! Drives the Drawer relation graph (`item_graph`) against a temporary database.

use std::fs;
use std::sync::Mutex;

use banyan_lib::annotations::*;
use banyan_lib::drawer::*;
use banyan_lib::item_graph::item_graph;
use banyan_lib::library::Library;
use banyan_lib::whiteboard::*;
use serde_json::Value;
use tauri::Manager;

fn setup() -> (tauri::App<tauri::test::MockRuntime>, std::path::PathBuf) {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("banyan-graph-test-{stamp}"));
    fs::create_dir_all(&root).unwrap();
    let default_dir = root.join("default");
    let lib = Library::open(&default_dir).unwrap();
    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
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

fn keys(g: &Value) -> Vec<String> {
    let mut k: Vec<String> = g["nodes"].as_array().unwrap().iter().map(|n| n["key"].as_str().unwrap().to_string()).collect();
    k.sort();
    k
}

fn edge<'a>(g: &'a Value, a: &str, b: &str) -> Option<&'a Value> {
    g["edges"].as_array().unwrap().iter().find(|e| (e["a"] == a && e["b"] == b) || (e["a"] == b && e["b"] == a))
}

fn node<'a>(g: &'a Value, key: &str) -> &'a Value {
    g["nodes"].as_array().unwrap().iter().find(|n| n["key"] == key).unwrap()
}

#[test]
fn graph_around_an_item() {
    let (app, root) = setup();
    let s = || app.state::<DrawerState>();
    let new_item = |title: &str| {
        let id = j(create_item(s(), "book".into(), None).unwrap())["id"].as_i64().unwrap();
        s().lock().conn.execute("UPDATE items SET title = ?1 WHERE id = ?2", rusqlite::params![title, id]).unwrap();
        id
    };
    let center = new_item("中心");
    let related = new_item("關聯");
    let far = new_item("遠方");
    let lonely = new_item("無關");
    add_related_items(s(), center, vec![related]).unwrap();

    // A PDF on the center item (its 檔案庫 copy becomes another item) with one highlight.
    let dir = root.join("src");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("a.pdf"), b"%PDF-1.4").unwrap();
    let att = j(add_attachments(s(), center, vec![dir.join("a.pdf").to_string_lossy().to_string()]).unwrap())[0]["id"]
        .as_i64()
        .unwrap();
    let loc = r#"{"type":"pdf","page":1,"rects":[]}"#.to_string();
    let hl = j(create_annotation(s(), att, "highlight".into(), "yellow".into(), "一段".into(), "".into(), loc, 0.0).unwrap())["id"]
        .as_i64()
        .unwrap();

    let board = j(create_whiteboard(s(), "研究".into(), None).unwrap())["id"].as_i64().unwrap();
    let cites = j(create_card(s(), board, 0.0, 0.0).unwrap())["id"].as_i64().unwrap(); // cites center
    let quotes = j(create_card(s(), board, 300.0, 0.0).unwrap())["id"].as_i64().unwrap(); // cites the highlight
    let linked = j(create_loose_card(s()).unwrap())["id"].as_i64().unwrap(); // linked to `cites`, cites `far`
    let other = j(create_loose_card(s()).unwrap())["id"].as_i64().unwrap(); // cites only `lonely`
    link_card_item(s(), cites, center).unwrap();
    link_card_annotation(s(), quotes, hl).unwrap();
    link_cards(s(), cites, linked, Some(true)).unwrap();
    update_link(s(), j(link_cards(s(), cites, linked, None).unwrap())["id"].as_i64().unwrap(), 1, "延伸".into()).unwrap();
    link_card_item(s(), linked, far).unwrap();
    link_card_item(s(), other, lonely).unwrap();

    // The PDF's 檔案庫 copy is related to the center item.
    let copy = j(get_item(s(), center).unwrap())["related"].as_array().unwrap().iter().map(|r| r["id"].as_i64().unwrap()).find(|&i| i != related).unwrap();

    // Depth 1: the item, its related items, the cards citing it or its highlight, their board
    // — but not the card linked to one of them.
    let g = j(item_graph(s(), center, None).unwrap());
    assert_eq!(g["center"], format!("i{center}"));
    assert_eq!(g["truncated"], false);
    let mut want = vec![format!("i{center}"), format!("i{related}"), format!("i{copy}"), format!("c{cites}"), format!("c{quotes}"), format!("b{board}")];
    want.sort();
    assert_eq!(keys(&g), want);
    let e = edge(&g, &format!("c{cites}"), &format!("i{center}")).unwrap();
    assert_eq!((e["kind"].as_str(), e["direct"].as_bool(), e["annotations"].as_i64()), (Some("cite"), Some(true), Some(0)));
    let e = edge(&g, &format!("c{quotes}"), &format!("i{center}")).unwrap();
    assert_eq!((e["direct"].as_bool(), e["annotations"].as_i64()), (Some(false), Some(1)));
    assert_eq!(edge(&g, &format!("i{center}"), &format!("i{related}")).unwrap()["kind"], "related");
    assert_eq!(edge(&g, &format!("c{cites}"), &format!("b{board}")).unwrap()["kind"], "board");
    assert_eq!(node(&g, &format!("c{cites}"))["boardId"], board);
    assert_eq!(node(&g, &format!("c{cites}"))["depth"], 1);
    assert_eq!(node(&g, &format!("b{board}"))["depth"], 2);
    assert_eq!(node(&g, &format!("b{board}"))["title"], "研究");
    // The highlight is on the shared file, so the card cites the copy too.
    assert_eq!(edge(&g, &format!("c{quotes}"), &format!("i{copy}")).unwrap()["annotations"], 1);

    // Depth 2 reaches the linked card (with the link's direction and note); depth 3 the item
    // the linked card cites.
    let g = j(item_graph(s(), center, Some(2)).unwrap());
    let ks = keys(&g);
    assert!(ks.contains(&format!("c{linked}")));
    assert!(!ks.contains(&format!("i{far}")));
    let l = edge(&g, &format!("c{cites}"), &format!("c{linked}")).unwrap();
    assert_eq!(l["kind"], "link");
    assert_eq!(l["note"], "延伸");
    assert_eq!(l["direction"], 1);
    assert_eq!(node(&g, &format!("c{linked}"))["boardId"], Value::Null);
    let g = j(item_graph(s(), center, Some(3)).unwrap());
    assert!(keys(&g).contains(&format!("i{far}")));
    assert!(!keys(&g).contains(&format!("i{lonely}")) && !keys(&g).contains(&format!("c{other}")));

    // Starting from the far item walks back.
    let g = j(item_graph(s(), far, Some(1)).unwrap());
    let mut want = vec![format!("i{far}"), format!("c{linked}")];
    want.sort();
    assert_eq!(keys(&g), want);

    assert!(item_graph(s(), 99999, None).is_err());

    drop(app);
    let _ = fs::remove_dir_all(root);
}
