//! Drives the Whiteboard commands against a temporary database.

use std::fs;
use std::sync::Mutex;

use banyan_lib::drawer::DrawerState;
use banyan_lib::library::Library;
use banyan_lib::whiteboard::*;
use serde_json::Value;
use tauri::Manager;

fn setup() -> (tauri::App<tauri::test::MockRuntime>, std::path::PathBuf) {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("banyan-wb-test-{stamp}"));
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

#[test]
fn cards_and_two_way_links() {
    let (app, root) = setup();
    let s = || app.state::<DrawerState>();

    assert!(create_whiteboard(s(), "  ".into(), None).is_err());
    let board = j(create_whiteboard(s(), "研究想法".into(), None).unwrap())["id"].as_i64().unwrap();
    let other = j(create_whiteboard(s(), "另一個".into(), None).unwrap())["id"].as_i64().unwrap();
    rename_whiteboard(s(), board, "研究".into()).unwrap();

    let a = j(create_card(s(), board, 0.0, 0.0).unwrap())["id"].as_i64().unwrap();
    let b = j(create_card(s(), board, 300.0, 0.0).unwrap())["id"].as_i64().unwrap();
    let c = j(create_card(s(), board, 0.0, 300.0).unwrap())["id"].as_i64().unwrap();
    let elsewhere = j(create_card(s(), other, 0.0, 0.0).unwrap())["id"].as_i64().unwrap();
    update_card(s(), a, " 甲 ".into(), "內容".into()).unwrap();
    update_card(s(), b, "乙".into(), String::new()).unwrap();
    update_card(s(), elsewhere, "丙".into(), String::new()).unwrap();
    place_card(s(), board, b, 400.0, 50.0, 10.0, 10.0).unwrap();

    // Links: either order, idempotent, no self-links.
    let l1 = j(link_cards(s(), b, a, None).unwrap());
    assert_eq!(l1["cardA"], a);
    assert_eq!(l1["cardB"], b);
    let l1_again = j(link_cards(s(), a, b, None).unwrap());
    assert_eq!(l1["id"], l1_again["id"]);
    assert!(link_cards(s(), a, a, None).is_err());
    assert!(link_cards(s(), a, 9999, None).is_err());
    link_cards(s(), a, elsewhere, None).unwrap();
    link_cards(s(), c, b, None).unwrap();

    let wb = j(get_whiteboard(s(), board).unwrap());
    assert_eq!(wb["board"]["name"], "研究");
    assert_eq!(wb["board"]["cardCount"], 3);
    assert_eq!(wb["cards"].as_array().unwrap().len(), 3);
    let card_b = wb["cards"].as_array().unwrap().iter().find(|x| x["id"] == b).unwrap().clone();
    assert_eq!(card_b["x"], 400.0);
    assert_eq!(card_b["width"], 120.0, "clamped to minimum width");
    assert_eq!(wb["cards"][0]["title"], "甲");
    // The link to the card on the other board is not drawn here.
    assert_eq!(wb["links"].as_array().unwrap().len(), 2);

    // Both sides see the link.
    let from_a = j(list_card_links(s(), a).unwrap());
    let titles: Vec<_> = from_a.as_array().unwrap().iter().map(|x| x["title"].clone()).collect();
    assert_eq!(titles, vec![Value::from("丙"), Value::from("乙")]);
    assert_eq!(from_a[0]["boards"][0], "另一個");
    let from_b = j(list_card_links(s(), b).unwrap());
    assert_eq!(from_b.as_array().unwrap().len(), 2);
    let from_elsewhere = j(list_card_links(s(), elsewhere).unwrap());
    assert_eq!(from_elsewhere[0]["cardId"], a);

    assert_eq!(from_a[0]["boardId"], other);

    // Search: title or content, excluding the card itself.
    let hits = j(search_cards(s(), "內容".into(), None).unwrap());
    assert_eq!(hits.as_array().unwrap().len(), 1);
    assert_eq!(hits[0]["cardId"], a);
    assert_eq!(hits[0]["content"], "內容", "search returns the text for previews");
    assert_eq!(hits[0]["boards"][0], "研究");
    assert_eq!(j(search_cards(s(), "".into(), Some(a)).unwrap()).as_array().unwrap().len(), 3);
    assert_eq!(j(search_cards(s(), "%".into(), None).unwrap()).as_array().unwrap().len(), 0);

    // Unlink in reverse order.
    unlink_cards(s(), b, a).unwrap();
    assert_eq!(j(list_card_links(s(), a).unwrap()).as_array().unwrap().len(), 1);
    assert_eq!(j(list_card_links(s(), b).unwrap()).as_array().unwrap().len(), 1);

    // Deleting a card removes its links.
    delete_card(s(), c).unwrap();
    assert_eq!(j(list_card_links(s(), b).unwrap()).as_array().unwrap().len(), 0);

    // Deleting a board deletes its cards and their links on other boards.
    delete_whiteboard(s(), board).unwrap();
    assert_eq!(j(list_whiteboards(s()).unwrap()).as_array().unwrap().len(), 1);
    assert_eq!(j(list_card_links(s(), elsewhere).unwrap()).as_array().unwrap().len(), 0);
    assert!(get_whiteboard(s(), board).is_err());
    assert!(create_card(s(), board, 0.0, 0.0).is_err());

    drop(app);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn cards_refer_to_drawer_items() {
    use banyan_lib::drawer::{create_item, delete_item, get_item, list_items, update_item, ItemFilter};
    let (app, root) = setup();
    let s = || app.state::<DrawerState>();

    let item = j(create_item(s(), "book".into(), None).unwrap())["id"].as_i64().unwrap();
    let mut fields = j(get_item(s(), item).unwrap());
    fields["title"] = "SICP".into();
    update_item(s(), item, serde_json::from_value(fields).unwrap()).unwrap();
    assert!(j(get_item(s(), item).unwrap()).get("notes").is_none(), "items no longer have notes");

    // A note card made from the item: linked, titled after it, on no board.
    let note = j(create_item_card(s(), item).unwrap());
    assert_eq!(note["title"], "筆記：SICP");
    assert!(note["boardId"].is_null());
    let note_id = note["cardId"].as_i64().unwrap();
    update_card(s(), note_id, "筆記：SICP".into(), "遞迴與閉包".into()).unwrap();

    // Search in the Drawer finds the item by its card's text.
    let f: ItemFilter = serde_json::from_value(serde_json::json!({ "query": "閉包" })).unwrap();
    assert_eq!(j(list_items(s(), f).unwrap())[0]["id"], item);

    // A card on a board links to the item too; the board shows the reference.
    let board = j(create_whiteboard(s(), "讀書".into(), None).unwrap())["id"].as_i64().unwrap();
    let card = j(create_card(s(), board, 0.0, 0.0).unwrap())["id"].as_i64().unwrap();
    link_card_item(s(), card, item).unwrap();
    link_card_item(s(), card, item).unwrap(); // idempotent
    assert!(link_card_item(s(), card, 9999).is_err());
    let wb = j(get_whiteboard(s(), board).unwrap());
    assert_eq!(wb["cards"][0]["items"][0]["title"], "SICP");
    assert_eq!(j(list_card_items(s(), card).unwrap()).as_array().unwrap().len(), 1);
    assert_eq!(j(list_item_cards(s(), item).unwrap()).as_array().unwrap().len(), 2);

    // Put the note card on the board, next to the existing card.
    add_card_to_board(s(), board, note_id, None, None).unwrap();
    assert!(add_card_to_board(s(), board, note_id, None, None).is_err());
    let wb = j(get_whiteboard(s(), board).unwrap());
    let placed = wb["cards"].as_array().unwrap().iter().find(|c| c["id"] == note_id).unwrap().clone();
    assert_eq!(placed["x"], DEFAULT_CARD_WIDTH + 40.0);

    assert_eq!(j(list_item_cards(s(), item).unwrap())[0]["boards"][0], "讀書");

    // Dropped at a position (e.g. dragged from the side list onto the board).
    let other_board = j(create_whiteboard(s(), "另一個".into(), None).unwrap())["id"].as_i64().unwrap();
    add_card_to_board(s(), other_board, note_id, Some(123.0), Some(-45.0)).unwrap();
    let wb = j(get_whiteboard(s(), other_board).unwrap());
    assert_eq!(wb["cards"][0]["x"], 123.0);
    assert_eq!(wb["cards"][0]["y"], -45.0);

    // Deleting the item keeps cards that are on a board; a note card on no board goes with it.
    let loose = j(create_item_card(s(), item).unwrap())["cardId"].as_i64().unwrap();
    unlink_card_item(s(), card, item).unwrap();
    assert_eq!(j(list_card_items(s(), card).unwrap()).as_array().unwrap().len(), 0);
    delete_item(s(), item).unwrap();
    assert!(j(search_cards(s(), "".into(), None).unwrap())
        .as_array()
        .unwrap()
        .iter()
        .all(|c| c["cardId"] != loose));
    assert_eq!(j(get_whiteboard(s(), board).unwrap())["cards"].as_array().unwrap().len(), 2);

    drop(app);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn wiki_links_create_two_way_links() {
    let (app, root) = setup();
    let s = || app.state::<DrawerState>();
    let board = j(create_whiteboard(s(), "主板".into(), None).unwrap())["id"].as_i64().unwrap();
    let other = j(create_whiteboard(s(), "別板".into(), None).unwrap())["id"].as_i64().unwrap();

    let src = j(create_card(s(), board, 0.0, 0.0).unwrap())["id"].as_i64().unwrap();
    let near = j(create_card(s(), board, 300.0, 0.0).unwrap())["id"].as_i64().unwrap();
    let far = j(create_card(s(), other, 0.0, 0.0).unwrap())["id"].as_i64().unwrap();
    let english = j(create_card(s(), other, 300.0, 0.0).unwrap())["id"].as_i64().unwrap();
    update_card(s(), src, "來源".into(), String::new()).unwrap();
    // Same title on two boards: the one sharing a board with `src` wins, even if older.
    update_card(s(), near, "同名".into(), String::new()).unwrap();
    update_card(s(), far, "同名".into(), String::new()).unwrap();
    update_card(s(), english, "Rust Notes".into(), String::new()).unwrap();

    let titles = vec![
        " 同名 ".to_string(),
        "rust notes".to_string(), // ASCII case-insensitive
        "同名".to_string(),       // duplicate target
        "來源".to_string(),       // itself: skipped
        "不存在".to_string(),     // no match: skipped
        "".to_string(),
    ];
    let created = j(sync_wiki_links(s(), src, titles.clone()).unwrap());
    let created = created.as_array().unwrap();
    assert_eq!(created.len(), 2);
    let pairs: Vec<(i64, i64)> = created
        .iter()
        .map(|l| (l["cardA"].as_i64().unwrap(), l["cardB"].as_i64().unwrap()))
        .collect();
    assert!(pairs.contains(&(src.min(near), src.max(near))));
    assert!(pairs.contains(&(src.min(english), src.max(english))));

    // Two-way: the target sees the link too.
    let back = j(list_card_links(s(), near).unwrap());
    assert_eq!(back.as_array().unwrap().len(), 1);
    assert_eq!(back[0]["cardId"], src);

    // Running again creates nothing new; existing hand-made links are not reported.
    assert_eq!(j(sync_wiki_links(s(), src, titles).unwrap()).as_array().unwrap().len(), 0);
    link_cards(s(), src, far, None).unwrap();
    assert_eq!(
        j(sync_wiki_links(s(), far, vec!["來源".into()]).unwrap()).as_array().unwrap().len(),
        0
    );

    // Backward: `[[後來]]` written before the card "後來" exists links once that card is saved.
    update_card(s(), src, "來源".into(), "先寫 [[後來]] 與 [[別名|顯示]]，`code` 不算".into()).unwrap();
    let later = j(create_card(s(), other, 600.0, 0.0).unwrap())["id"].as_i64().unwrap();
    update_card(s(), later, "後來".into(), String::new()).unwrap();
    let back = j(sync_wiki_links(s(), later, vec![]).unwrap());
    assert_eq!(back.as_array().unwrap().len(), 1);
    assert_eq!(back[0]["cardA"], src.min(later));
    let alias = j(create_card(s(), other, 900.0, 0.0).unwrap())["id"].as_i64().unwrap();
    update_card(s(), alias, "別名".into(), String::new()).unwrap();
    assert_eq!(j(sync_wiki_links(s(), alias, vec![]).unwrap()).as_array().unwrap().len(), 1);
    // A title that only appears as plain text (no brackets) does not link.
    let plain = j(create_card(s(), other, 0.0, 300.0).unwrap())["id"].as_i64().unwrap();
    update_card(s(), plain, "code".into(), String::new()).unwrap();
    assert_eq!(j(sync_wiki_links(s(), plain, vec![]).unwrap()).as_array().unwrap().len(), 0);

    assert!(sync_wiki_links(s(), 9999, vec!["同名".into()]).is_err());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn folders_directed_links_and_graph() {
    let (app, root) = setup();
    let s = || app.state::<DrawerState>();

    // Folders: nesting, no cycles, deleting keeps the boards.
    let top = j(create_whiteboard_folder(s(), "研究".into(), None).unwrap())["id"].as_i64().unwrap();
    let sub = j(create_whiteboard_folder(s(), "論文".into(), Some(top)).unwrap())["id"].as_i64().unwrap();
    assert!(create_whiteboard_folder(s(), " ".into(), None).is_err());
    assert!(create_whiteboard_folder(s(), "x".into(), Some(9999)).is_err());
    rename_whiteboard_folder(s(), sub, "論文筆記".into()).unwrap();
    assert!(move_whiteboard_folder(s(), top, Some(sub)).is_err(), "no cycles");
    assert!(move_whiteboard_folder(s(), top, Some(top)).is_err());
    let b1 = j(create_whiteboard(s(), "A".into(), Some(sub)).unwrap());
    assert_eq!(b1["folderId"], sub);
    let b1 = b1["id"].as_i64().unwrap();
    let b2 = j(create_whiteboard(s(), "B".into(), None).unwrap())["id"].as_i64().unwrap();
    move_whiteboard(s(), b2, Some(top)).unwrap();
    assert!(move_whiteboard(s(), b2, Some(9999)).is_err());
    let folders = j(list_whiteboard_folders(s()).unwrap());
    assert!(folders.as_array().unwrap().iter().any(|f| f["name"] == "論文筆記" && f["parentId"] == top));

    // Directed links: drawn a → b, then edited.
    let a = j(create_card(s(), b1, 0.0, 0.0).unwrap())["id"].as_i64().unwrap();
    let b = j(create_card(s(), b1, 300.0, 0.0).unwrap())["id"].as_i64().unwrap();
    let c = j(create_card(s(), b2, 0.0, 0.0).unwrap())["id"].as_i64().unwrap();
    let loose = j(create_card(s(), b2, 0.0, 300.0).unwrap())["id"].as_i64().unwrap();
    let l = j(link_cards(s(), b, a, Some(true)).unwrap()); // b → a, stored as (a, b)
    assert_eq!(l["cardA"], a);
    assert_eq!(l["direction"], 2);
    assert_eq!(j(list_card_links(s(), b).unwrap())[0]["direction"], "out");
    assert_eq!(j(list_card_links(s(), a).unwrap())[0]["direction"], "in");
    let lid = l["id"].as_i64().unwrap();
    let edited = j(update_link(s(), lid, 3, "  支持  ".into()).unwrap());
    assert_eq!(edited["note"], "支持");
    assert_eq!(j(list_card_links(s(), a).unwrap())[0]["direction"], "both");
    assert_eq!(j(list_card_links(s(), a).unwrap())[0]["note"], "支持");
    assert!(update_link(s(), lid, 7, String::new()).is_err());
    assert!(update_link(s(), 9999, 0, String::new()).is_err());
    let undirected = j(link_cards(s(), a, c, None).unwrap());
    assert_eq!(undirected["direction"], 0);
    assert_eq!(j(get_whiteboard(s(), b1).unwrap())["links"][0]["note"], "支持");

    // [[ ]] links point from the card that mentions.
    update_card(s(), c, "C".into(), String::new()).unwrap();
    update_card(s(), loose, "D".into(), "見 [[C]]".into()).unwrap();
    let made = j(sync_wiki_links(s(), loose, vec!["C".into()]).unwrap());
    let (from, to) = if made[0]["direction"] == 1 { (made[0]["cardA"].clone(), made[0]["cardB"].clone()) } else { (made[0]["cardB"].clone(), made[0]["cardA"].clone()) };
    assert_eq!((from, to), (serde_json::json!(loose), serde_json::json!(c)));

    // Graph: everything, or just some boards.
    let item = j(banyan_lib::drawer::create_item(s(), "book".into(), None).unwrap())["id"].as_i64().unwrap();
    link_card_item(s(), a, item).unwrap();
    let g = j(get_graph(s(), None, None).unwrap());
    assert_eq!(g["cards"].as_array().unwrap().len(), 4);
    assert_eq!(g["links"].as_array().unwrap().len(), 3);
    assert_eq!(g["items"].as_array().unwrap().len(), 1);
    assert_eq!(g["refs"][0]["cardId"], a);
    let g = j(get_graph(s(), Some(vec![b1]), None).unwrap());
    assert_eq!(g["cards"].as_array().unwrap().len(), 2);
    assert_eq!(g["links"].as_array().unwrap().len(), 1, "links leaving the boards are left out");
    assert_eq!(g["cards"][0]["boardIds"][0], b1);

    // Deleting a folder deletes its sub-folders; boards move to the top level.
    delete_whiteboard_folder(s(), top).unwrap();
    assert_eq!(j(list_whiteboard_folders(s()).unwrap()).as_array().unwrap().len(), 0);
    let boards = j(list_whiteboards(s()).unwrap());
    assert_eq!(boards.as_array().unwrap().len(), 2);
    assert!(boards.as_array().unwrap().iter().all(|b| b["folderId"].is_null()));

    drop(app);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn sections_tags_library_and_batches() {
    let (app, root) = setup();
    let s = || app.state::<DrawerState>();
    let board = j(create_whiteboard(s(), "讀書".into(), None).unwrap())["id"].as_i64().unwrap();

    // Sections: create, update (with minimum size), listed with the board, delete keeps cards.
    let sec = j(create_section(s(), board, " 第一章 ".into(), 0.0, 0.0, 500.0, 300.0).unwrap());
    assert_eq!(sec["title"], "第一章");
    let sid = sec["id"].as_i64().unwrap();
    update_section(s(), sid, "第 1 章".into(), "blue".into(), 10.0, 20.0, 50.0, 400.0).unwrap();
    assert!(update_section(s(), 9999, "x".into(), "".into(), 0.0, 0.0, 200.0, 200.0).is_err());
    assert!(create_section(s(), board, "x".into(), f64::NAN, 0.0, 200.0, 200.0).is_err());
    let a = j(create_card(s(), board, 30.0, 60.0).unwrap())["id"].as_i64().unwrap();
    let b = j(create_card(s(), board, 300.0, 60.0).unwrap())["id"].as_i64().unwrap();
    let c = j(create_card(s(), board, 600.0, 60.0).unwrap())["id"].as_i64().unwrap();
    let wb = j(get_whiteboard(s(), board).unwrap());
    assert_eq!(wb["sections"][0]["color"], "blue");
    assert_eq!(wb["sections"][0]["width"], 120.0, "clamped to the minimum");
    assert_eq!(wb["sections"][0]["x"], 10.0);

    // Several cards at once.
    let places: Vec<Placement> = serde_json::from_value(serde_json::json!([
        { "cardId": a, "x": 40.0, "y": 70.0, "width": 240.0, "height": 160.0 },
        { "cardId": b, "x": 310.0, "y": 70.0, "width": 10.0, "height": 10.0 },
    ]))
    .unwrap();
    place_cards(s(), board, places).unwrap();
    let wb = j(get_whiteboard(s(), board).unwrap());
    let card = |id: i64| wb["cards"].as_array().unwrap().iter().find(|x| x["id"] == id).unwrap().clone();
    assert_eq!(card(a)["x"], 40.0);
    assert_eq!(card(b)["width"], 120.0);
    delete_section(s(), sid).unwrap();
    assert_eq!(j(get_whiteboard(s(), board).unwrap())["cards"].as_array().unwrap().len(), 3);

    // Tags: trimmed, "#" dropped, duplicates merged ignoring case; shown on the board card.
    let tags = j(set_card_tags(s(), a, vec![" #研究 ".into(), "AI".into(), "ai".into(), "".into()]).unwrap());
    assert_eq!(tags, serde_json::json!(["AI", "研究"]));
    set_card_tags(s(), b, vec!["ai".into()]).unwrap();
    assert!(set_card_tags(s(), 9999, vec!["x".into()]).is_err());
    let counts = j(list_card_tags(s()).unwrap());
    assert_eq!(counts[0]["count"], 2);
    assert_eq!(j(get_whiteboard(s(), board).unwrap())["cards"][0]["tags"], serde_json::json!(["AI", "研究"]));

    // Library: loose cards, filters, sorting, detail.
    let loose = j(create_loose_card(s()).unwrap());
    let loose_id = loose["id"].as_i64().unwrap();
    assert_eq!(loose["boards"].as_array().unwrap().len(), 0);
    update_card(s(), c, "Alpha".into(), "".into()).unwrap();
    link_cards(s(), a, b, Some(true)).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(5));
    update_card(s(), loose_id, "Zeta".into(), "孤立的想法".into()).unwrap(); // edited last
    let f = |v: serde_json::Value| -> CardQuery { serde_json::from_value(v).unwrap() };
    let all = j(list_cards(s(), f(serde_json::json!({}))).unwrap());
    assert_eq!(all.as_array().unwrap().len(), 4);
    assert_eq!(all[0]["id"], loose_id, "newest edit first");
    let unplaced = j(list_cards(s(), f(serde_json::json!({ "placement": "unplaced" }))).unwrap());
    assert_eq!(unplaced.as_array().unwrap().len(), 1);
    let placed = j(list_cards(s(), f(serde_json::json!({ "placement": "placed" }))).unwrap());
    assert_eq!(placed.as_array().unwrap().len(), 3);
    let tagged = j(list_cards(s(), f(serde_json::json!({ "tag": "AI" }))).unwrap());
    assert_eq!(tagged.as_array().unwrap().len(), 2);
    let by_title = j(list_cards(s(), f(serde_json::json!({ "sort": "title" }))).unwrap());
    assert_eq!(by_title[0]["title"], "Alpha");
    assert_eq!(by_title[3]["title"], "", "untitled cards last");
    let hit = j(list_cards(s(), f(serde_json::json!({ "query": "孤立" }))).unwrap());
    assert_eq!(hit[0]["id"], loose_id);
    let row_a = all.as_array().unwrap().iter().find(|x| x["id"] == a).unwrap().clone();
    assert_eq!(row_a["linkCount"], 1);
    assert_eq!(row_a["boards"][0]["name"], "讀書");
    let detail = j(get_card(s(), a).unwrap());
    assert_eq!(detail["tags"], serde_json::json!(["AI", "研究"]));
    assert_eq!(detail["boards"][0]["id"], board);
    assert!(get_card(s(), 9999).is_err());

    // Graph filtered by tag.
    let g = j(get_graph(s(), None, Some("ai".into())).unwrap());
    assert_eq!(g["cards"].as_array().unwrap().len(), 2);
    assert_eq!(g["links"].as_array().unwrap().len(), 1);

    // Batch delete removes cards, links and tags.
    delete_cards(s(), vec![a, b]).unwrap();
    assert_eq!(j(get_whiteboard(s(), board).unwrap())["cards"].as_array().unwrap().len(), 1);
    assert_eq!(j(list_card_tags(s()).unwrap()).as_array().unwrap().len(), 0);

    drop(app);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn card_version_history() {
    use banyan_lib::history::*;
    let (app, root) = setup();
    let s = || app.state::<DrawerState>();

    let board = j(create_whiteboard(s(), "版本".into(), None).unwrap())["id"].as_i64().unwrap();
    let card = j(create_card(s(), board, 0.0, 0.0).unwrap())["id"].as_i64().unwrap();
    // An empty new card has no history yet.
    assert!(j(list_card_versions(s(), card).unwrap()).as_array().unwrap().is_empty());
    assert!(list_card_versions(s(), 9999).is_err());

    update_card(s(), card, "草稿".into(), "第一版".into()).unwrap();
    // A second save right away is folded into the same version.
    update_card(s(), card, "草稿".into(), "第一版，補充".into()).unwrap();
    let list = j(list_card_versions(s(), card).unwrap());
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["content"], "第一版，補充");
    assert_eq!(list[0]["name"], "");

    // Naming the current state names that version instead of copying it.
    assert!(create_card_version(s(), card, "  ".into()).is_err());
    let named = j(create_card_version(s(), card, " 初稿 ".into()).unwrap());
    assert_eq!(named["name"], "初稿");
    assert_eq!(named["id"], list[0]["id"]);
    assert_eq!(j(list_card_versions(s(), card).unwrap()).as_array().unwrap().len(), 1);

    // Edits after a named version start a new one.
    update_card(s(), card, "定稿".into(), "第二版".into()).unwrap();
    let list = j(list_card_versions(s(), card).unwrap());
    assert_eq!(list.as_array().unwrap().len(), 2);
    assert_eq!(list[0]["title"], "定稿");
    let first = list[1]["id"].as_i64().unwrap();

    // Restore: the card goes back, and the restore is a new version (so it can be undone).
    let restored = j(restore_card_version(s(), first).unwrap());
    assert_eq!(restored["title"], "草稿");
    assert_eq!(restored["content"], "第一版，補充");
    let list = j(list_card_versions(s(), card).unwrap());
    let contents: Vec<&str> = list.as_array().unwrap().iter().map(|v| v["content"].as_str().unwrap()).collect();
    assert_eq!(contents, ["第一版，補充", "第二版", "第一版，補充"]);

    // Rename / delete; the latest version cannot be deleted.
    assert_eq!(j(rename_card_version(s(), first, "初稿 A".into()).unwrap())["name"], "初稿 A");
    assert!(rename_card_version(s(), 9999, "x".into()).is_err());
    assert!(delete_card_version(s(), list[0]["id"].as_i64().unwrap()).is_err());
    delete_card_version(s(), list[1]["id"].as_i64().unwrap()).unwrap();
    assert_eq!(j(list_card_versions(s(), card).unwrap()).as_array().unwrap().len(), 2);

    // Deleting the card removes its history.
    delete_card(s(), card).unwrap();
    assert!(restore_card_version(s(), first).is_err());

    fs::remove_dir_all(root).ok();
}

#[test]
fn remove_from_board_keeps_the_card() {
    let (app, root) = setup();
    let s = || app.state::<DrawerState>();
    let one = j(create_whiteboard(s(), "一".into(), None).unwrap())["id"].as_i64().unwrap();
    let two = j(create_whiteboard(s(), "二".into(), None).unwrap())["id"].as_i64().unwrap();
    let a = j(create_card(s(), one, 0.0, 0.0).unwrap())["id"].as_i64().unwrap();
    let b = j(create_card(s(), one, 300.0, 0.0).unwrap())["id"].as_i64().unwrap();
    add_card_to_board(s(), two, a, None, None).unwrap();
    link_cards(s(), a, b, Some(true)).unwrap();
    set_card_tags(s(), a, vec!["保留".into()]).unwrap();

    // Off board one only: still on board two, still linked and tagged, still in the library.
    assert_eq!(remove_cards_from_board(s(), one, vec![a, 9999]).unwrap(), 1);
    let wb1 = j(get_whiteboard(s(), one).unwrap());
    assert_eq!(wb1["cards"].as_array().unwrap().len(), 1);
    assert_eq!(wb1["links"].as_array().unwrap().len(), 0, "the link is not drawn without both cards");
    let detail = j(get_card(s(), a).unwrap());
    assert_eq!(detail["boards"][0]["id"], two);
    assert_eq!(detail["tags"][0], "保留");
    assert_eq!(j(list_card_links(s(), a).unwrap()).as_array().unwrap().len(), 1);

    // Off its last board: the card is unplaced but not deleted.
    remove_cards_from_board(s(), two, vec![a]).unwrap();
    let f: CardQuery = serde_json::from_value(serde_json::json!({ "placement": "unplaced" })).unwrap();
    let unplaced = j(list_cards(s(), f).unwrap());
    assert_eq!(unplaced[0]["id"], a);
    assert_eq!(remove_cards_from_board(s(), two, vec![a]).unwrap(), 0);

    // Deleting removes it everywhere.
    delete_cards(s(), vec![a]).unwrap();
    assert!(get_card(s(), a).is_err());

    drop(app);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn board_objects_of_other_kinds() {
    use banyan_lib::card_files::*;
    use banyan_lib::history::*;
    let (app, root) = setup();
    let s = || app.state::<DrawerState>();
    let board = j(create_whiteboard(s(), "物件".into(), None).unwrap())["id"].as_i64().unwrap();

    // Unknown kinds and bad rectangles are refused; sizes are clamped to the minimum.
    assert!(create_board_object(s(), board, "diagram".into(), 0.0, 0.0, 200.0, 200.0, String::new(), String::new(), String::new()).is_err());
    assert!(create_board_object(s(), board, "image".into(), f64::NAN, 0.0, 200.0, 200.0, String::new(), String::new(), String::new()).is_err());
    let video = j(create_board_object(
        s(), board, "video".into(), 10.0, 20.0, 50.0, 10.0, " 演講 ".into(), String::new(),
        r#"{"videoId":"dQw4w9WgXcQ"}"#.into(),
    )
    .unwrap());
    assert_eq!(video["kind"], "video");
    assert_eq!(video["title"], "演講");
    assert_eq!(video["width"], 120.0);
    assert_eq!(video["height"], 60.0);

    // A mind map: tree in data, outline in content; both are versioned and restorable.
    let map = j(create_board_object(
        s(), board, "mindmap".into(), 0.0, 300.0, 300.0, 200.0, "主題".into(), "- 主題".into(),
        r#"{"root":{"id":"r","text":"主題","children":[]}}"#.into(),
    )
    .unwrap())["id"]
        .as_i64()
        .unwrap();
    let v1 = r#"{"root":{"id":"r","text":"主題","children":[{"id":"a","text":"甲","children":[]}]}}"#;
    update_card_data(s(), map, "主題".into(), "- 主題\n  - 甲".into(), v1.into()).unwrap();
    let first = j(create_card_version(s(), map, "一個分支".into()).unwrap())["id"].as_i64().unwrap();
    update_card_data(s(), map, "主題".into(), "- 主題".into(), r#"{"root":{"id":"r","text":"主題","children":[]}}"#.into()).unwrap();
    // A plain title/content save keeps the data.
    update_card(s(), map, "主題二".into(), "- 主題".into()).unwrap();
    assert_eq!(j(get_card(s(), map).unwrap())["data"], r#"{"root":{"id":"r","text":"主題","children":[]}}"#);
    let restored = j(restore_card_version(s(), first).unwrap());
    assert_eq!(restored["data"], v1);
    assert_eq!(restored["kind"], "mindmap");

    let wb = j(get_whiteboard(s(), board).unwrap());
    let kinds: Vec<&str> = wb["cards"].as_array().unwrap().iter().map(|c| c["kind"].as_str().unwrap()).collect();
    assert_eq!(kinds, ["video", "mindmap"]);
    let f: CardQuery = serde_json::from_value(serde_json::json!({ "query": "甲" })).unwrap();
    let hits = j(list_cards(s(), f).unwrap());
    assert_eq!(hits[0]["kind"], "mindmap", "mind maps are found by their outline");
    // Tables (Numbers-style): cells in data, a Markdown table in content.
    let table = j(create_board_object(s(), board, "table".into(), 0.0, 600.0, 400.0, 200.0, "預算".into(), "| A |
|---|
| 1 |".into(), r#"{"cols":[]}"#.into()).unwrap());
    assert_eq!(table["kind"], "table");
    let chart = j(create_board_object(s(), board, "chart".into(), 500.0, 600.0, 420.0, 280.0, "圖表".into(), String::new(), r#"{"type":"column"}"#.into()).unwrap());
    assert_eq!(chart["kind"], "chart");
    // Plain cards are notes.
    let note = j(create_card(s(), board, 0.0, 0.0).unwrap());
    assert_eq!(note["kind"], "note");

    // Files: stored per card, names kept inside the folder, removed with the card.
    let image = j(create_board_object(s(), board, "image".into(), 0.0, 0.0, 300.0, 200.0, String::new(), String::new(), String::new()).unwrap())["id"].as_i64().unwrap();
    let src = root.join("相片.png");
    fs::write(&src, b"PNGDATA").unwrap();
    let lib_guard = s();
    {
        let lib = lib_guard.lock();
        assert_eq!(import_path(&lib, image, &src).unwrap(), "相片.png");
        assert_eq!(import_path(&lib, image, &src).unwrap(), "相片 (2).png");
        assert_eq!(store_bytes(&lib, image, "../貼上.png", b"x").unwrap(), "貼上.png");
        assert!(store_bytes(&lib, 9999, "a.png", b"x").is_err());
        let path = file_path(&lib, image, "相片.png").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"PNGDATA");
        assert!(file_path(&lib, image, "沒有.png").is_err());
    }
    let folder = {
        let lib = lib_guard.lock();
        file_path(&lib, image, "相片.png").unwrap().parent().unwrap().to_path_buf()
    };
    delete_cards(s(), vec![image]).unwrap();
    assert!(!folder.exists(), "the card's files go with it");

    // Deleting the board deletes the files of cards that were only there.
    let pdf = j(create_board_object(s(), board, "pdf".into(), 0.0, 0.0, 300.0, 400.0, String::new(), String::new(), String::new()).unwrap())["id"].as_i64().unwrap();
    let pdf_folder = {
        let lib = lib_guard.lock();
        store_bytes(&lib, pdf, "a.pdf", b"%PDF").unwrap();
        file_path(&lib, pdf, "a.pdf").unwrap().parent().unwrap().to_path_buf()
    };
    delete_whiteboard(s(), board).unwrap();
    assert!(!pdf_folder.exists());
    assert!(get_card(s(), map).is_err());

    drop(app);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn library_shows_sections_and_board_size() {
    let (app, root) = setup();
    let s = || app.state::<DrawerState>();
    let board = j(create_whiteboard(s(), "區塊".into(), None).unwrap())["id"].as_i64().unwrap();
    let sec = j(create_section(s(), board, "讀書".into(), 0.0, 0.0, 500.0, 400.0).unwrap())["id"].as_i64().unwrap();
    let card = j(create_card(s(), board, 20.0, 60.0).unwrap())["id"].as_i64().unwrap();
    let loose = j(create_loose_card(s()).unwrap())["id"].as_i64().unwrap();
    let all = || j(list_cards(s(), serde_json::from_value(serde_json::json!({})).unwrap()).unwrap());

    let list = all();
    let row = |id: i64| list.as_array().unwrap().iter().find(|c| c["id"] == id).unwrap().clone();
    assert_eq!(row(card)["sections"][0]["id"], sec);
    assert_eq!(row(card)["sections"][0]["boardName"], "區塊");
    assert_eq!(row(card)["width"], 240.0);
    assert!(row(loose)["width"].is_null(), "a card on no board has no size");
    assert_eq!(row(loose)["sections"].as_array().unwrap().len(), 0);

    // Half outside: no longer in the section.
    place_card(s(), board, card, 400.0, 60.0, 240.0, 160.0).unwrap();
    let list = all();
    let moved = list.as_array().unwrap().iter().find(|c| c["id"] == card).unwrap();
    assert_eq!(moved["sections"].as_array().unwrap().len(), 0);

    drop(app);
    let _ = fs::remove_dir_all(root);
}
