use std::sync::Mutex;

use banyan_lib::desk::*;
use banyan_lib::drawer::{DrawerState, LINK_THRESHOLD};
use banyan_lib::library::Library;
use tauri::Manager;

#[test]
fn desk_documents_survive_reopening_the_library() {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("banyan-desk-{stamp}"));
    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    app.manage(DrawerState {
        lib: Mutex::new(Library::open(&root).unwrap()),
        default_dir: root.clone(),
        config_path: root.join("config.json"),
        startup_warning: Mutex::new(None),
        link_threshold: LINK_THRESHOLD,
    });
    let state = || app.state::<DrawerState>();

    let id = "desk-document";
    let markdown = "| 數量 | 小計 |\n| --- | --- |\n| 2 | =A2*50 |\n";
    let created = create_desk_document(
        state(),
        id.into(),
        "document".into(),
        " 草稿 ".into(),
        "".into(),
    )
    .unwrap();
    assert_eq!(serde_json::to_value(created).unwrap()["title"], "草稿");
    let updated_at =
        update_desk_document(state(), id.into(), "預算".into(), markdown.into()).unwrap();
    *state().lock() = Library::open(&root).unwrap();

    let list = serde_json::to_value(list_desk_documents(state()).unwrap()).unwrap();
    assert_eq!(list[0]["id"], id);
    assert_eq!(list[0]["kind"], "document");
    assert_eq!(list[0]["title"], "預算");
    assert_eq!(list[0]["markdown"], markdown);
    assert_eq!(list[0]["updatedAt"], updated_at);

    delete_desk_document(state(), id.into()).unwrap();
    assert!(list_desk_documents(state()).unwrap().is_empty());
    assert!(update_desk_document(state(), id.into(), "預算".into(), markdown.into()).is_err());

    assert!(
        create_desk_document(
            state(),
            "new-sheet".into(),
            "sheet".into(),
            "預算".into(),
            markdown.into()
        )
        .is_err()
    );
    state().lock().conn.execute(
        "INSERT INTO desk_documents (id, kind, title, markdown, updated_at) VALUES ('old-sheet', 'sheet', '預算', ?1, 1)",
        [markdown],
    ).unwrap();
    let list = serde_json::to_value(list_desk_documents(state()).unwrap()).unwrap();
    assert_eq!(list[0]["kind"], "document");
    assert_eq!(list[0]["markdown"], markdown);
    drop(app);
    let _ = std::fs::remove_dir_all(root);
}
