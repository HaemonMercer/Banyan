//! Files of whiteboard objects (images and PDFs), kept in the library's storage folder at
//! `storage/cards/<card id>/<file name>`. A card's `data` names its file; the file goes away
//! with the card.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::OptionalExtension;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::drawer::{unique_target, DrawerState, Error, Result};
use crate::library::Library;

/// Largest file that can be put on a board (images and PDFs are read whole into the page).
pub const MAX_CARD_FILE: u64 = 200 * 1024 * 1024;

pub const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"];

fn card_dir(lib: &Library, card_id: i64) -> PathBuf {
    lib.storage_dir().join("cards").join(card_id.to_string())
}

/// Deletes a card's files (after the card itself was deleted). Errors are ignored: a leftover
/// folder is harmless.
pub fn remove_card_files(lib: &Library, card_id: i64) {
    let _ = fs::remove_dir_all(card_dir(lib, card_id));
}

/// Only a plain file name (no folders, no `..`) is accepted.
fn clean_file_name(name: &str) -> Result<String> {
    let base = name.trim().rsplit(['/', '\\']).next().unwrap_or("").trim();
    if base.is_empty() || base == "." || base == ".." || base.contains(':') {
        return Err(Error("檔案名稱無效".into()));
    }
    Ok(base.to_string())
}

fn check_card(lib: &Library, card_id: i64) -> Result<()> {
    lib.conn
        .query_row("SELECT 1 FROM cards WHERE id = ?1", [card_id], |_| Ok(()))
        .optional()?
        .ok_or_else(|| Error("找不到這張卡片".into()))
}

/// Writes `bytes` as a new file of the card; returns the stored name (made unique).
pub fn store_bytes(lib: &Library, card_id: i64, name: &str, bytes: &[u8]) -> Result<String> {
    check_card(lib, card_id)?;
    if bytes.len() as u64 > MAX_CARD_FILE {
        return Err(Error("檔案太大（白板上的檔案最多 200 MB）".into()));
    }
    let dir = card_dir(lib, card_id);
    fs::create_dir_all(&dir)?;
    let target = unique_target(&dir, &clean_file_name(name)?);
    fs::write(&target, bytes)?;
    Ok(target.file_name().unwrap().to_string_lossy().to_string())
}

/// Copies a file into the card's folder; returns the stored name.
pub fn import_path(lib: &Library, card_id: i64, path: &Path) -> Result<String> {
    check_card(lib, card_id)?;
    let meta = fs::metadata(path).map_err(|_| Error(format!("找不到檔案：{}", path.display())))?;
    if !meta.is_file() {
        return Err(Error("只能放入檔案，不能放入資料夾".into()));
    }
    if meta.len() > MAX_CARD_FILE {
        return Err(Error("檔案太大（白板上的檔案最多 200 MB）".into()));
    }
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let dir = card_dir(lib, card_id);
    fs::create_dir_all(&dir)?;
    let target = unique_target(&dir, &clean_file_name(name)?);
    fs::copy(path, &target)?;
    Ok(target.file_name().unwrap().to_string_lossy().to_string())
}

pub fn file_path(lib: &Library, card_id: i64, name: &str) -> Result<PathBuf> {
    let path = card_dir(lib, card_id).join(clean_file_name(name)?);
    if !path.is_file() {
        return Err(Error("檔案不見了（可能已被刪除）".into()));
    }
    Ok(path)
}

/// Copies a file (chosen in the picker or dropped on the board) into the card's folder.
#[tauri::command]
pub fn import_card_file(state: State<'_, DrawerState>, card_id: i64, path: String) -> Result<String> {
    let lib = state.lock();
    import_path(&lib, card_id, Path::new(&path))
}

/// Saves pasted bytes (e.g. a screenshot) as a file of the card. The body is the raw bytes;
/// headers `x-card-id` and `x-file-name` (URI-encoded) say where.
#[tauri::command]
pub fn save_card_file(state: State<'_, DrawerState>, request: Request<'_>) -> Result<String> {
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let card_id: i64 = header("x-card-id").parse().map_err(|_| Error("缺少卡片編號".into()))?;
    let name = decode_uri(&header("x-file-name"));
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(Error("沒有收到檔案內容".into()));
    };
    let lib = state.lock();
    store_bytes(&lib, card_id, &name, bytes)
}

/// The file's bytes, sent to the page without JSON encoding.
#[tauri::command]
pub fn read_card_file(state: State<'_, DrawerState>, card_id: i64, name: String) -> Result<Response> {
    let path = {
        let lib = state.lock();
        file_path(&lib, card_id, &name)?
    };
    Ok(Response::new(fs::read(path)?))
}

/// Opens the system file picker for an image or a PDF; returns the chosen path.
#[tauri::command]
pub async fn pick_card_file(app: AppHandle, kind: String) -> Option<String> {
    let dialog = app.dialog().file();
    let dialog = match kind.as_str() {
        "pdf" => dialog.set_title("選擇 PDF").add_filter("PDF", &["pdf"]),
        _ => dialog.set_title("選擇圖片").add_filter("圖片", IMAGE_EXTENSIONS),
    };
    dialog.blocking_pick_file().and_then(|f| f.into_path().ok()).map(|p| p.to_string_lossy().to_string())
}

/// Opens the file in its default app (e.g. a PDF reader).
#[tauri::command]
pub fn open_card_file(app: AppHandle, state: State<'_, DrawerState>, card_id: i64, name: String) -> Result<()> {
    let path = {
        let lib = state.lock();
        file_path(&lib, card_id, &name)?
    };
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| Error(format!("無法開啟檔案：{e}")))
}

/// Shows the file in the system file manager.
#[tauri::command]
pub fn reveal_card_file(app: AppHandle, state: State<'_, DrawerState>, card_id: i64, name: String) -> Result<()> {
    let path = {
        let lib = state.lock();
        file_path(&lib, card_id, &name)?
    };
    app.opener().reveal_item_in_dir(path).map_err(|e| Error(format!("無法顯示檔案位置：{e}")))
}

/// Minimal `decodeURIComponent` for the file-name header.
fn decode_uri(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        let hex = |c: u8| (c as char).to_digit(16);
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_uri_components() {
        assert_eq!(decode_uri("%E5%9C%96%20a.png"), "圖 a.png");
        assert_eq!(decode_uri("plain.png"), "plain.png");
        assert_eq!(decode_uri("bad%zz%"), "bad%zz%");
    }

    #[test]
    fn file_names_cannot_leave_the_folder() {
        assert_eq!(clean_file_name("../../x.png").unwrap(), "x.png");
        assert_eq!(clean_file_name("C:\\a\\b.pdf").unwrap(), "b.pdf");
        assert!(clean_file_name("..").is_err());
        assert!(clean_file_name("  ").is_err());
    }
}
