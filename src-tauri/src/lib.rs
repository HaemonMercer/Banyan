pub mod annotations;
pub mod card_files;
pub mod db;
pub mod drawer;
pub mod file_protocol;
pub mod history;
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
    file_protocol::register(tauri::Builder::default())
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
            let (lib, warning) = match library::open_startup_library(&config, &default_dir) {
                Ok(opened) => opened,
                Err(e) => {
                    // The library can't be opened safely (e.g. made by a newer Banyan, or an
                    // upgrade failed and was rolled back). Say why and quit instead of running
                    // on a stand-in database where new work could get lost.
                    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
                    // Nothing can be done in the window meanwhile: work done on the stand-in
                    // database would be thrown away when the app quits.
                    for window in app.webview_windows().values() {
                        let _ = window.hide();
                    }
                    let handle = app.handle().clone();
                    app.dialog()
                        .message(format!("{}\n\n資料庫位置：{}", e.0, default_dir.display()))
                        .title("Banyan 無法開啟資料庫")
                        .kind(MessageDialogKind::Error)
                        .show(move |_| handle.exit(1));
                    // Placeholder so the app's state exists while the message is up; nothing is saved.
                    (library::Library::in_memory().map_err(|e| e.0)?, None)
                }
            };
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
            drawer::set_collection_view,
            drawer::read_attachment,
            drawer::import_images,
            drawer::import_files,
            drawer::pick_import_files,
            drawer::add_items_to_collection,
            drawer::field_values,
            drawer::add_related_items,
            drawer::remove_related_item,
            drawer::relate_items,
            drawer::list_attachments,
            drawer::pick_attachments,
            drawer::add_attachments,
            drawer::open_attachment,
            drawer::reveal_attachment,
            library::reveal_backups,
            library::list_backups,
            library::restore_backup,
            annotations::list_annotations,
            annotations::create_annotation,
            annotations::update_annotation,
            annotations::delete_annotation,
            annotations::list_annotatable_files,
            annotations::search_annotations,
            annotations::get_annotation,
            annotations::annotation_to_card,
            annotations::link_card_annotation,
            annotations::unlink_card_annotation,
            annotations::list_annotation_cards,
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
            whiteboard::create_board_object,
            whiteboard::update_card_data,
            card_files::import_card_file,
            card_files::save_card_file,
            card_files::read_card_file,
            card_files::pick_card_file,
            card_files::open_card_file,
            card_files::reveal_card_file,
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
            whiteboard::create_section,
            whiteboard::update_section,
            whiteboard::delete_section,
            whiteboard::place_cards,
            whiteboard::delete_cards,
            whiteboard::remove_cards_from_board,
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
            history::list_card_versions,
            history::create_card_version,
            history::rename_card_version,
            history::delete_card_version,
            history::restore_card_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
