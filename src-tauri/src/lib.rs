pub mod db;
pub mod drawer;
pub mod library;
pub mod whiteboard;

use std::sync::Mutex;

use tauri::Manager;

/// The update endpoints from `tauri.conf.json` (`plugins.updater.endpoints`), shown in the
/// "check for updates" dialog so an unconfigured placeholder can be reported instead of a 404.
#[tauri::command]
fn update_endpoints(app: tauri::AppHandle) -> Vec<String> {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|u| u.get("endpoints"))
        .and_then(|e| e.as_array())
        .map(|list| list.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Manual "check for updates" (rail button). Desktop only; mobile apps update through their stores.
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;

            let default_dir = app.path().app_data_dir()?;
            let config_path = app.path().app_config_dir()?.join("config.json");
            let config = library::load_config(&config_path);
            let (lib, warning) = library::open_startup_library(&config, &default_dir)
                .map_err(|e| e.0)?;
            app.manage(drawer::DrawerState {
                lib: Mutex::new(lib),
                default_dir,
                config_path,
                startup_warning: Mutex::new(warning),
                link_threshold: drawer::LINK_THRESHOLD,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            update_endpoints,
            drawer::list_collections,
            drawer::create_collection,
            drawer::rename_collection,
            drawer::delete_collection,
            drawer::list_items,
            drawer::get_item,
            drawer::create_item,
            drawer::update_item,
            drawer::delete_item,
            drawer::set_item_tags,
            drawer::list_tags,
            drawer::rename_tag,
            drawer::delete_tag,
            drawer::add_tag_to_items,
            drawer::bulk_info,
            drawer::bulk_add_tag,
            drawer::bulk_remove_tag,
            drawer::remove_items_from_collection,
            drawer::bulk_set_type,
            drawer::bulk_set_field,
            drawer::bulk_add_creator,
            drawer::delete_items,
            drawer::set_item_creators,
            drawer::set_item_collections,
            drawer::add_items_to_collection,
            drawer::add_related_items,
            drawer::remove_related_item,
            drawer::relate_items,
            drawer::list_attachments,
            drawer::pick_attachments,
            drawer::add_attachments,
            drawer::open_attachment,
            drawer::reveal_attachment,
            drawer::delete_attachment,
            library::get_library_info,
            library::inspect_library_dir,
            library::pick_library_dir,
            library::change_library_dir,
            library::reveal_library_dir,
            whiteboard::list_whiteboards,
            whiteboard::create_whiteboard,
            whiteboard::rename_whiteboard,
            whiteboard::delete_whiteboard,
            whiteboard::get_whiteboard,
            whiteboard::create_card,
            whiteboard::update_card,
            whiteboard::place_card,
            whiteboard::delete_card,
            whiteboard::link_cards,
            whiteboard::unlink_cards,
            whiteboard::sync_wiki_links,
            whiteboard::list_card_links,
            whiteboard::search_cards,
            whiteboard::update_link,
            whiteboard::list_whiteboard_folders,
            whiteboard::create_whiteboard_folder,
            whiteboard::rename_whiteboard_folder,
            whiteboard::delete_whiteboard_folder,
            whiteboard::move_whiteboard_folder,
            whiteboard::move_whiteboard,
            whiteboard::get_graph,
            whiteboard::create_section,
            whiteboard::update_section,
            whiteboard::delete_section,
            whiteboard::place_cards,
            whiteboard::delete_cards,
            whiteboard::set_card_tags,
            whiteboard::list_card_tags,
            whiteboard::get_card,
            whiteboard::create_loose_card,
            whiteboard::list_cards,
            whiteboard::list_card_items,
            whiteboard::link_card_item,
            whiteboard::unlink_card_item,
            whiteboard::list_item_cards,
            whiteboard::create_item_card,
            whiteboard::add_card_to_board,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
