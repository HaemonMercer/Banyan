use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};

// ─── 儲存位置 ────────────────────────────────────────────────────
//
// 所有資料（journals/、pages/、media/、desk/、drawer/、databases/）放在同一個資料夾。
// 預設是 App 資料夾；使用者在設定裡可以換成別的資料夾（例如同步資料夾），
// 位置記在 App 設定資料夾的 settings.json（`{"dataDir": "..."}`）。

/// 資料夾裡屬於 Banyan 的子資料夾（換位置時複製這些）。
const DATA_SUBDIRS: [&str; 9] = ["journals", "pages", "media", "desk", "desk-templates", "drawer", "databases", "history", "styles"];

fn settings_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("settings.json"))
}

fn default_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// settings.json 裡自訂的資料夾（沒設定、格式不對就是 None）。
fn custom_root(app: &AppHandle) -> Option<PathBuf> {
    let text = fs::read_to_string(settings_file(app).ok()?).ok()?;
    parse_data_dir(&text)
}

fn parse_data_dir(text: &str) -> Option<PathBuf> {
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    let dir = v.get("dataDir")?.as_str()?.trim();
    if dir.is_empty() { None } else { Some(PathBuf::from(dir)) }
}

/// 目前的資料夾：自訂的優先，否則是 App 資料夾。
fn data_root(app: &AppHandle) -> Result<PathBuf, String> {
    match custom_root(app) {
        Some(p) => Ok(p),
        None => default_root(app),
    }
}

/// 讓 asset protocol 可以讀目前資料夾的 media/（預設位置已寫在 tauri.conf.json）。
fn allow_media(app: &AppHandle) {
    if let Ok(root) = data_root(app) {
        let _ = app.asset_protocol_scope().allow_directory(root.join("media"), true);
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageInfo {
    dir: String,
    default_dir: String,
    custom: bool,
}

#[tauri::command]
fn storage_info(app: AppHandle) -> Result<StorageInfo, String> {
    let default_dir = default_root(&app)?;
    let custom = custom_root(&app);
    Ok(StorageInfo {
        dir: custom.clone().unwrap_or_else(|| default_dir.clone()).to_string_lossy().into_owned(),
        default_dir: default_dir.to_string_lossy().into_owned(),
        custom: custom.is_some(),
    })
}

/// 把 from 底下的檔案複製到 to（遞迴）；to 已經有的檔案不覆蓋。
fn copy_missing(from: &Path, to: &Path) -> Result<(), String> {
    if !from.is_dir() {
        return Ok(());
    }
    fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(from).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let src = entry.path();
        let dst = to.join(entry.file_name());
        if src.is_dir() {
            copy_missing(&src, &dst)?;
        } else if !dst.exists() {
            fs::copy(&src, &dst).map_err(|e| format!("Couldn't copy {}: {e}", src.display()))?;
        }
    }
    Ok(())
}

/// 換資料夾。`dir` 是 None 就回到預設位置；`copy` 時把目前的資料複製過去（不覆蓋新位置已有的檔案，原檔留著）。
#[tauri::command]
fn storage_set(app: AppHandle, dir: Option<String>, copy: bool) -> Result<StorageInfo, String> {
    let target = match dir.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
        Some(d) => {
            let p = PathBuf::from(d);
            if !p.is_absolute() {
                return Err("Choose a full folder path".into());
            }
            fs::create_dir_all(&p).map_err(|e| format!("Couldn't use {d}: {e}"))?;
            Some(p)
        }
        None => None,
    };
    let old = data_root(&app)?;
    let new = match &target {
        Some(p) => p.clone(),
        None => default_root(&app)?,
    };
    if copy && !same_dir(&old, &new) {
        for sub in DATA_SUBDIRS {
            copy_missing(&old.join(sub), &new.join(sub))?;
        }
    }
    let file = settings_file(&app)?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut v: serde_json::Value = fs::read_to_string(&file)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .filter(|v: &serde_json::Value| v.is_object())
        .unwrap_or_else(|| serde_json::json!({}));
    match &target {
        Some(p) => v["dataDir"] = serde_json::Value::String(p.to_string_lossy().into_owned()),
        None => {
            v.as_object_mut().map(|o| o.remove("dataDir"));
        }
    }
    fs::write(&file, serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    allow_media(&app);
    storage_info(app)
}

fn same_dir(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

// ─── 媒體檔案（圖片、GIF、影片） ─────────────────────────────────
//
// 檔案複製到 App 資料夾的 media/ 底下，檔名是內容的雜湊值（同一個檔案只存一份）。
// Markdown 裡寫相對路徑 `media/檔名`，前端顯示時換成 asset protocol 的網址。

/// media 資料夾（不存在就建立）。
fn media_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_root(app)?
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
    let dir = data_root(app)?
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
    let dir = data_root(app)?
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
    Ok(format!("{}.{ext}", encoded_stem(name)?))
}

/// 名稱 → URL 編碼、沒有副檔名的檔名（版本歷史的資料夾名稱也用它）。
fn encoded_stem(name: &str) -> Result<String, String> {
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
    Ok(out)
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

// ─── 資料夾、讀寫的共用函式 ──────────────────────────────────────

fn data_dir(app: &AppHandle, sub: &str) -> Result<PathBuf, String> {
    let dir = data_root(app)?
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

// ─── Desk（白板發想＋Dock 整理） ──────────────────────────────────
//
// 每個檔案一個 desk/名稱.json（白板與 Dock 的文件），檔名編碼和頁面相同。

#[tauri::command]
fn desk_list(app: AppHandle) -> Result<Vec<String>, String> {
    let mut names: Vec<String> = fs::read_dir(data_dir(&app, "desk")?)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| decoded_name(&e.file_name().to_string_lossy(), ".json"))
        .collect();
    names.sort();
    Ok(names)
}

#[tauri::command]
fn desk_read(app: AppHandle, name: String) -> Result<String, String> {
    read_or_empty(&data_dir(&app, "desk")?.join(encoded_file(&name, "json")?))
}

/// 寫入 Desk 檔案；內容是空的就刪掉檔案。
#[tauri::command]
fn desk_write(app: AppHandle, name: String, content: String) -> Result<(), String> {
    write_or_remove(&data_dir(&app, "desk")?.join(encoded_file(&name, "json")?), &content)
}

/// 改名：搬 desk/舊.json → desk/新.json，版本歷史的資料夾 history/desk/舊 → history/desk/新 一起搬。
/// 只差大小寫也可以（Windows 檔名不分大小寫，同一個檔案直接改名）；新名稱已經有別的檔案就失敗。
#[tauri::command]
fn desk_rename(app: AppHandle, from: String, to: String) -> Result<(), String> {
    let (a, b) = (encoded_stem(&from)?, encoded_stem(&to)?);
    if a == b {
        return Ok(());
    }
    let same = a.to_lowercase() == b.to_lowercase();
    let dir = data_dir(&app, "desk")?;
    let (src, dst) = (dir.join(format!("{a}.json")), dir.join(format!("{b}.json")));
    if dst.exists() && !same {
        return Err(format!("A file named {to} already exists"));
    }
    if src.exists() {
        fs::rename(&src, &dst).map_err(|e| e.to_string())?;
    }
    let hist = data_dir(&app, "history")?.join("desk");
    let (hs, hd) = (hist.join(&a), hist.join(&b));
    if hs.exists() && (same || !hd.exists()) {
        fs::rename(&hs, &hd).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// 使用者存的 Desk 檔案範本：desk-templates/名稱.json，內容和 Desk 檔案相同。

#[tauri::command]
fn desk_template_list(app: AppHandle) -> Result<Vec<String>, String> {
    let mut names: Vec<String> = fs::read_dir(data_dir(&app, "desk-templates")?)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| decoded_name(&e.file_name().to_string_lossy(), ".json"))
        .collect();
    names.sort();
    Ok(names)
}

#[tauri::command]
fn desk_template_read(app: AppHandle, name: String) -> Result<String, String> {
    read_or_empty(&data_dir(&app, "desk-templates")?.join(encoded_file(&name, "json")?))
}

/// 寫入範本；內容是空的就刪掉。
#[tauri::command]
fn desk_template_write(app: AppHandle, name: String, content: String) -> Result<(), String> {
    write_or_remove(&data_dir(&app, "desk-templates")?.join(encoded_file(&name, "json")?), &content)
}

// ─── 版本歷史（參考 Google Docs 的 Version history） ──────────────────
//
// history/<種類>/<編碼後的名稱>/ 底下：index.json（版本清單，前端管理）與每個版本一個 <id>.txt。
// 種類是 journals、pages、desk；名稱的編碼和頁面檔名相同。合併、刪除舊版本的規則都在前端（src/history/）。

fn history_path(app: &AppHandle, kind: &str, key: &str, file: &str) -> Result<PathBuf, String> {
    if !matches!(kind, "journals" | "pages" | "desk") {
        return Err(format!("Unknown history kind: {kind}"));
    }
    if !history_file_ok(file) {
        return Err(format!("Bad history file name: {file}"));
    }
    let dir = data_dir(app, "history")?.join(kind).join(encoded_stem(key)?);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(file))
}

/// 只允許 `index.json` 與 `英數字-_.txt`（不能跳出資料夾）。
fn history_file_ok(file: &str) -> bool {
    if file == "index.json" {
        return true;
    }
    match file.strip_suffix(".txt") {
        Some(stem) => !stem.is_empty() && stem.len() <= 64 && stem.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
        None => false,
    }
}

#[tauri::command]
fn history_read(app: AppHandle, kind: String, key: String, file: String) -> Result<String, String> {
    read_or_empty(&history_path(&app, &kind, &key, &file)?)
}

/// 寫入版本歷史的一個檔案；內容是空的就刪掉。
#[tauri::command]
fn history_write(app: AppHandle, kind: String, key: String, file: String, content: String) -> Result<(), String> {
    let path = history_path(&app, &kind, &key, &file)?;
    if content.is_empty() {
        if path.exists() {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    fs::write(&path, content).map_err(|e| e.to_string())
}

// ─── Drawer（文獻庫，參考 Zotero） ────────────────────────────────
//
// 整個文獻庫是一份 drawer/library.json；附件和圖片一樣存在 media/。

fn drawer_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app, "drawer")?.join("library.json"))
}

#[tauri::command]
fn drawer_read(app: AppHandle) -> Result<String, String> {
    read_or_empty(&drawer_file(&app)?)
}

/// 寫入文獻庫；先寫暫存檔再改名，寫到一半當掉也不會弄壞原本的檔案。內容是空的就刪掉。
#[tauri::command]
fn drawer_write(app: AppHandle, content: String) -> Result<(), String> {
    let path = drawer_file(&app)?;
    if content.trim().is_empty() {
        return write_or_remove(&path, &content);
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

// ─── 區塊樣式（Word、簡報共用的已存樣式） ────────────────────────
//
// 所有文件共用一份 styles/block-styles.json（前端 `desk/styleLibrary.ts`）。

fn styles_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app, "styles")?.join("block-styles.json"))
}

#[tauri::command]
fn styles_read(app: AppHandle) -> Result<String, String> {
    read_or_empty(&styles_file(&app)?)
}

/// 寫入已存的樣式；跟文獻庫一樣先寫暫存檔再改名。內容是空的就刪掉。
#[tauri::command]
fn styles_write(app: AppHandle, content: String) -> Result<(), String> {
    let path = styles_file(&app)?;
    if content.trim().is_empty() {
        return write_or_remove(&path, &content);
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

// ─── 匯出（Word、PowerPoint） ─────────────────────────────────────
//
// 前端產生檔案內容，這裡存到使用者的「下載」資料夾；已經有同名的檔案就加上 (1)、(2)…

/// 匯出的檔名：去掉路徑與 Windows 不允許的字元，副檔名只留英數字。
fn export_name(name: &str) -> (String, String) {
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.trim().is_empty() => (s, clean_ext(e)),
        _ => (name, "bin".to_string()),
    };
    let mut out: String = stem
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() { '_' } else { c })
        .take(120)
        .collect();
    out = out.trim().trim_end_matches('.').trim_start_matches('.').to_string();
    if out.is_empty() {
        out = "Untitled".into();
    }
    (out, ext)
}

/// 資料夾裡還沒有人用的檔名：`名稱.ext`、`名稱 (1).ext`…
fn free_path(dir: &PathBuf, stem: &str, ext: &str) -> PathBuf {
    let first = dir.join(format!("{stem}.{ext}"));
    if !first.exists() {
        return first;
    }
    (1..)
        .map(|i| dir.join(format!("{stem} ({i}).{ext}")))
        .find(|p| !p.exists())
        .unwrap()
}

/// 存匯出的檔案（原始位元組，標頭 `x-name` 是 URL 編碼的檔名），回傳存好的完整路徑。
#[tauri::command]
fn export_save(app: AppHandle, request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("需要檔案的原始位元組".into());
    };
    let raw = request
        .headers()
        .get("x-name")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("Untitled.bin");
    let name = decoded_name(&format!("{raw}.x"), ".x").unwrap_or_else(|| raw.to_string());
    let (stem, ext) = export_name(&name);
    let dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().document_dir())
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = free_path(&dir, &stem, &ext);
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            allow_media(app.handle());
            Ok(())
        })
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
            desk_list,
            desk_read,
            desk_write,
            desk_rename,
            desk_template_list,
            desk_template_read,
            desk_template_write,
            drawer_read,
            drawer_write,
            styles_read,
            styles_write,
            history_read,
            history_write,
            export_save,
            storage_info,
            storage_set
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_dir_setting() {
        assert_eq!(parse_data_dir(r#"{"dataDir":"D:\\Notes"}"#), Some(PathBuf::from(r"D:\Notes")));
        assert_eq!(parse_data_dir(r#"{"dataDir":"  "}"#), None);
        assert_eq!(parse_data_dir(r#"{}"#), None);
        assert_eq!(parse_data_dir("not json"), None);
    }

    #[test]
    fn copies_without_overwriting() {
        let base = std::env::temp_dir().join(format!("banyan-copy-{}", std::process::id()));
        let (from, to) = (base.join("from"), base.join("to"));
        fs::create_dir_all(from.join("sub")).unwrap();
        fs::create_dir_all(&to).unwrap();
        fs::write(from.join("a.md"), "old a").unwrap();
        fs::write(from.join("sub").join("b.md"), "b").unwrap();
        fs::write(to.join("a.md"), "kept").unwrap();
        copy_missing(&from, &to).unwrap();
        assert_eq!(fs::read_to_string(to.join("a.md")).unwrap(), "kept");
        assert_eq!(fs::read_to_string(to.join("sub").join("b.md")).unwrap(), "b");
        let _ = fs::remove_dir_all(&base);
    }

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
    fn history_files() {
        assert!(history_file_ok("index.json"));
        assert!(history_file_ok("m3k9x2-ab_1.txt"));
        assert!(!history_file_ok("../x.txt"));
        assert!(!history_file_ok(".txt"));
        assert!(!history_file_ok("a.md"));
        assert_eq!(encoded_stem("a/b").unwrap(), "a%2Fb");
    }

    #[test]
    fn json_names() {
        assert_eq!(encoded_file("研究/計畫", "json").unwrap(), "研究%2F計畫.json");
        let file = encoded_file("a: b", "json").unwrap();
        assert_eq!(decoded_name(&file, ".json").as_deref(), Some("a: b"));
        assert_eq!(decoded_name("x.md", ".json"), None);
    }

    #[test]
    fn export_names() {
        assert_eq!(export_name("報告.docx"), ("報告".into(), "docx".into()));
        assert_eq!(export_name("a/b: c?.PPTX"), ("a_b_ c_".into(), "pptx".into()));
        assert_eq!(export_name("..docx"), ("Untitled".into(), "docx".into()));
        assert_eq!(export_name("noext"), ("noext".into(), "bin".into()));
    }

    #[test]
    fn free_paths() {
        let dir = std::env::temp_dir().join(format!("banyan-export-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let a = free_path(&dir, "x", "docx");
        assert!(a.ends_with("x.docx"));
        fs::write(&a, b"1").unwrap();
        assert!(free_path(&dir, "x", "docx").ends_with("x (1).docx"));
        fs::remove_dir_all(&dir).unwrap();
    }
}
