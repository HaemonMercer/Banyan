use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;

use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};

// ─── 媒體檔案（圖片、GIF、影片） ─────────────────────────────────
//
// 檔案複製到 App 資料夾的 media/ 底下，檔名是內容的雜湊值（同一個檔案只存一份）。
// Markdown 裡寫相對路徑 `media/檔名`，前端顯示時換成 asset protocol 的網址。

/// media 資料夾（不存在就建立）。
fn media_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("media");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// 副檔名只留英數字、轉小寫、最多 8 個字。
fn clean_ext(ext: &str) -> String {
    let e: String = ext
        .trim_start_matches('.')
        .to_ascii_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect();
    if e.is_empty() { "bin".into() } else { e }
}

/// 以內容雜湊值命名的檔名。
fn media_name(bytes: &[u8], ext: &str) -> String {
    let mut h = DefaultHasher::new();
    bytes.hash(&mut h);
    format!("{:016x}.{}", h.finish(), clean_ext(ext))
}

fn store(app: &AppHandle, bytes: &[u8], ext: &str) -> Result<String, String> {
    let name = media_name(bytes, ext);
    let path = media_root(app)?.join(&name);
    if !path.exists() {
        fs::write(&path, bytes).map_err(|e| e.to_string())?;
    }
    Ok(format!("media/{name}"))
}

/// media 資料夾的絕對路徑（前端用來組 asset 網址）。
#[tauri::command]
fn media_dir(app: AppHandle) -> Result<String, String> {
    media_root(&app).map(|p| p.to_string_lossy().into_owned())
}

/// 儲存前端傳來的檔案內容（原始位元組，標頭 `x-ext` 是副檔名），回傳 `media/檔名`。
#[tauri::command]
fn save_media(app: AppHandle, request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("需要檔案的原始位元組".into());
    };
    let ext = request
        .headers()
        .get("x-ext")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("bin");
    store(&app, bytes, ext)
}

/// 從磁碟上的檔案（例如從檔案總管拖進來的）複製一份，回傳 `media/檔名`。
#[tauri::command]
fn import_media(app: AppHandle, path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    let bytes = fs::read(&p).map_err(|e| format!("讀不到 {path}：{e}"))?;
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("bin");
    store(&app, &bytes, ext)
}

// ─── 日記 ────────────────────────────────────────────────────────
//
// 每天一個 Markdown 檔，存在 App 資料夾的 journals/ 底下，檔名和 Logseq 相同：
// `2026_11_17.md`。前端用 `2026-11-17` 表示日期。內容是空的就刪掉檔案。
// journals/ 與 media/ 在同一層，所以日記裡的 `media/檔名` 不用改。

fn journals_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("journals");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// `2026-11-17` → `2026_11_17.md`；格式不對就是錯誤（不讓路徑跑出資料夾）。
fn journal_file(date: &str) -> Result<String, String> {
    let b = date.as_bytes();
    let ok = b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit());
    if !ok {
        return Err(format!("日期格式不對：{date}"));
    }
    Ok(format!("{}.md", date.replace('-', "_")))
}

/// 檔名 `2026_11_17.md` → `2026-11-17`；不是日記檔就是 None。
fn journal_date(file: &str) -> Option<String> {
    let date = file.strip_suffix(".md")?.replace('_', "-");
    journal_file(&date).ok().map(|_| date)
}

/// 有寫日記的日期，新的在前。
#[tauri::command]
fn journal_list(app: AppHandle) -> Result<Vec<String>, String> {
    let mut dates: Vec<String> = fs::read_dir(journals_root(&app)?)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| journal_date(&e.file_name().to_string_lossy()))
        .collect();
    dates.sort_unstable_by(|a, b| b.cmp(a));
    Ok(dates)
}

/// 讀一天的日記（沒有就是空字串）。
#[tauri::command]
fn journal_read(app: AppHandle, date: String) -> Result<String, String> {
    let path = journals_root(&app)?.join(journal_file(&date)?);
    match fs::read_to_string(&path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

/// 寫一天的日記；內容只有空白就刪掉檔案。
#[tauri::command]
fn journal_write(app: AppHandle, date: String, content: String) -> Result<(), String> {
    let path = journals_root(&app)?.join(journal_file(&date)?);
    if content.trim().is_empty() {
        if path.exists() {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            media_dir,
            save_media,
            import_media,
            journal_list,
            journal_read,
            journal_write
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ext_is_cleaned() {
        assert_eq!(clean_ext(".PNG"), "png");
        assert_eq!(clean_ext("g?i/f"), "gif");
        assert_eq!(clean_ext(""), "bin");
        assert_eq!(clean_ext("averyverylongext"), "averyver");
    }

    #[test]
    fn same_content_same_name() {
        assert_eq!(media_name(b"abc", "png"), media_name(b"abc", "PNG"));
        assert_ne!(media_name(b"abc", "png"), media_name(b"abd", "png"));
        assert!(media_name(b"abc", "gif").ends_with(".gif"));
    }

    #[test]
    fn journal_names() {
        assert_eq!(journal_file("2026-11-17").unwrap(), "2026_11_17.md");
        assert!(journal_file("../etc/pwd").is_err());
        assert!(journal_file("2026-1-17").is_err());
        assert!(journal_file("2026-11-1x").is_err());
        assert_eq!(journal_date("2026_11_17.md").as_deref(), Some("2026-11-17"));
        assert_eq!(journal_date("notes.md"), None);
        assert_eq!(journal_date("2026_11_17.txt"), None);
    }
}
