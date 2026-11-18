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

// ─── 頁面 ────────────────────────────────────────────────────────
//
// `[[頁面名稱]]` 連到的頁面，每頁一個 Markdown 檔，存在 App 資料夾的 pages/ 底下。
// 檔名就是頁面名稱，Windows 不允許的字元（與 `%`）寫成 `%XX`（和 Logseq 一樣是 URL 編碼）。

fn pages_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("pages");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// 頁面名稱 → 檔名。
fn page_file(name: &str) -> Result<String, String> {
    encoded_file(name, "md")
}

/// 名稱 → URL 編碼的檔名（頁面 `.md`、白板 `.json` 共用）。
fn encoded_file(name: &str, ext: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 200 {
        return Err("頁面名稱不能是空的或太長".into());
    }
    let mut out = String::new();
    for (i, c) in name.chars().enumerate() {
        let bad = matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '%')
            || c.is_control()
            // 開頭的點（隱藏檔、`..`）
            || (i == 0 && c == '.');
        if bad {
            let mut buf = [0u8; 4];
            for b in c.encode_utf8(&mut buf).bytes() {
                out.push_str(&format!("%{b:02X}"));
            }
        } else {
            out.push(c);
        }
    }
    // Windows 會吃掉結尾的點
    if out.ends_with('.') {
        out.pop();
        out.push_str("%2E");
    }
    Ok(format!("{out}.{ext}"))
}

/// 檔名 → 頁面名稱（解開 `%XX`）。
fn page_name(file: &str) -> Option<String> {
    decoded_name(file, ".md")
}

fn decoded_name(file: &str, suffix: &str) -> Option<String> {
    let stem = file.strip_suffix(suffix)?;
    let bytes = stem.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    let name = String::from_utf8(out).ok()?;
    if name.trim().is_empty() { None } else { Some(name) }
}

/// 所有頁面的名稱。
#[tauri::command]
fn page_list(app: AppHandle) -> Result<Vec<String>, String> {
    let mut names: Vec<String> = fs::read_dir(pages_root(&app)?)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| page_name(&e.file_name().to_string_lossy()))
        .collect();
    names.sort();
    Ok(names)
}

#[tauri::command]
fn page_read(app: AppHandle, name: String) -> Result<String, String> {
    let path = pages_root(&app)?.join(page_file(&name)?);
    match fs::read_to_string(&path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

/// 寫入頁面；內容只有空白就刪掉檔案。
#[tauri::command]
fn page_write(app: AppHandle, name: String, content: String) -> Result<(), String> {
    let path = pages_root(&app)?.join(page_file(&name)?);
    if content.trim().is_empty() {
        if path.exists() {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    fs::write(&path, content).map_err(|e| e.to_string())
}

// ─── 資料庫（參考 Notion 的 Database） ────────────────────────────
//
// 每個資料庫一個 databases/名稱.json（欄位、資料列、檢視），檔名編碼和頁面相同。

fn data_dir(app: &AppHandle, sub: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(sub);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn read_or_empty(path: &PathBuf) -> Result<String, String> {
    match fs::read_to_string(path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

/// 寫入；內容只有空白就刪掉檔案。
fn write_or_remove(path: &PathBuf, content: &str) -> Result<(), String> {
    if content.trim().is_empty() {
        if path.exists() {
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn database_list(app: AppHandle) -> Result<Vec<String>, String> {
    let mut names: Vec<String> = fs::read_dir(data_dir(&app, "databases")?)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| decoded_name(&e.file_name().to_string_lossy(), ".json"))
        .collect();
    names.sort();
    Ok(names)
}

#[tauri::command]
fn database_read(app: AppHandle, name: String) -> Result<String, String> {
    read_or_empty(&data_dir(&app, "databases")?.join(encoded_file(&name, "json")?))
}

/// 寫入資料庫；內容是空的就刪掉檔案。
#[tauri::command]
fn database_write(app: AppHandle, name: String, content: String) -> Result<(), String> {
    write_or_remove(&data_dir(&app, "databases")?.join(encoded_file(&name, "json")?), &content)
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
            journal_write,
            page_list,
            page_read,
            page_write,
            database_list,
            database_read,
            database_write
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

    #[test]
    fn page_names() {
        assert_eq!(page_file("讀書筆記").unwrap(), "讀書筆記.md");
        assert_eq!(page_file("a/b: c?").unwrap(), "a%2Fb%3A c%3F.md");
        assert_eq!(page_file("..").unwrap(), "%2E%2E.md");
        assert_eq!(page_file("x.").unwrap(), "x%2E.md");
        assert!(page_file("  ").is_err());
        for name in ["讀書筆記", "a/b: c?", "..", "x.", "100%", "C#"] {
            let file = page_file(name).unwrap();
            assert_eq!(page_name(&file).as_deref(), Some(name), "{file}");
        }
        assert_eq!(page_name("notes.txt"), None);
    }

    #[test]
    fn json_names() {
        assert_eq!(encoded_file("研究/計畫", "json").unwrap(), "研究%2F計畫.json");
        let file = encoded_file("a: b", "json").unwrap();
        assert_eq!(decoded_name(&file, ".json").as_deref(), Some("a: b"));
        assert_eq!(decoded_name("x.md", ".json"), None);
    }
}
