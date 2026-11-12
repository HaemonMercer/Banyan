//! Where the library lives on disk: the SQLite file plus the attachment `storage` folder.
//! Users can move it, open another one, or start a new one; the choice is kept in `config.json`.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::db;
use crate::drawer::{DrawerState, Error, Result};

pub const DB_FILE: &str = "banyan.db";
const STORAGE_DIR: &str = "storage";

/// An open library folder.
pub struct Library {
    pub conn: Connection,
    pub dir: PathBuf,
    /// Set when the database was upgraded as it was opened (after a Banyan update). Kept for the
    /// whole session: Drawer shows it once, the settings page whenever it is open.
    pub notice: Option<String>,
}

impl From<db::DbError> for Error {
    fn from(e: db::DbError) -> Self {
        Error(e.to_string())
    }
}

impl Library {
    /// Opens (and if needed safely upgrades) the library in `dir`. See `db::open_with_report`.
    pub fn open(dir: &Path) -> Result<Self> {
        fs::create_dir_all(dir.join(STORAGE_DIR))?;
        let (conn, upgrade) = db::open_with_report(&dir.join(DB_FILE))?;
        let notice = upgrade.map(|u| {
            format!(
                "Banyan 已更新：資料庫已從第 {} 版升級到第 {} 版。升級前的資料另外備份在 {}。",
                u.from,
                u.to,
                u.backup.display()
            )
        });
        Ok(Library {
            conn,
            dir: dir.to_path_buf(),
            notice,
        })
    }

    pub fn storage_dir(&self) -> PathBuf {
        self.dir.join(STORAGE_DIR)
    }

    /// An empty in-memory library, only used while telling the user that theirs can't be opened.
    pub fn in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        db::create_schema(&conn)?;
        Ok(Library { conn, dir: std::env::temp_dir().join("banyan-unavailable"), notice: None })
    }

    /// Where the copies made before upgrades are kept.
    pub fn backup_dir(&self) -> PathBuf {
        self.dir.join(db::BACKUP_DIR)
    }
}

// ---------- config ----------

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    /// `None` means the default location.
    pub library_dir: Option<PathBuf>,
}

pub fn load_config(path: &Path) -> Config {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_config(path: &Path, config: &Config) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(config).map_err(|e| Error(e.to_string()))?;
    fs::write(path, json)?;
    Ok(())
}

/// Opens the configured library, falling back to the default location with a warning
/// when the configured folder is gone (e.g. an unplugged drive). Never silently creates
/// an empty library in place of a missing one.
pub fn open_startup_library(config: &Config, default_dir: &Path) -> Result<(Library, Option<String>)> {
    if let Some(dir) = &config.library_dir {
        if dir.join(DB_FILE).is_file() {
            match Library::open(dir) {
                Ok(lib) => return Ok((lib, None)),
                Err(e) => {
                    let warning = format!("無法開啟資料庫位置 {}（{}），暫時改用預設位置。", dir.display(), e.0);
                    return Ok((Library::open(default_dir)?, Some(warning)));
                }
            }
        }
        let warning = format!(
            "找不到資料庫位置 {}，暫時改用預設位置。接上磁碟後重新啟動，或在「資料庫位置」重新選擇。",
            dir.display()
        );
        return Ok((Library::open(default_dir)?, Some(warning)));
    }
    Ok((Library::open(default_dir)?, None))
}

// ---------- helpers ----------

/// Best-effort normalisation so `C:\a\..\b` and `c:/b` compare equal.
/// Works for folders that don't exist yet: canonicalizes the deepest existing ancestor and
/// re-appends the rest, so both sides of a comparison get the same `\\?\` prefix on Windows.
fn normalize(p: &Path) -> PathBuf {
    let mut existing = p;
    let mut rest = Vec::new();
    while !existing.exists() {
        match (existing.parent(), existing.file_name()) {
            (Some(parent), Some(name)) => {
                rest.push(name);
                existing = parent;
            }
            _ => break,
        }
    }
    let mut out = fs::canonicalize(existing).unwrap_or_else(|_| existing.to_path_buf());
    out.extend(rest.iter().rev());
    PathBuf::from(out.to_string_lossy().to_lowercase())
}

fn same_dir(a: &Path, b: &Path) -> bool {
    normalize(a) == normalize(b)
}

fn is_inside(child: &Path, parent: &Path) -> bool {
    normalize(child).starts_with(normalize(parent))
}

fn dir_is_empty_or_missing(dir: &Path) -> bool {
    match fs::read_dir(dir) {
        Ok(mut entries) => entries.next().is_none(),
        Err(_) => true,
    }
}

fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    if is_inside(dst, src) {
        return Err(std::io::Error::other("不能把資料夾複製到它自己裡面"));
    }
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let target = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

// ---------- commands ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryInfo {
    path: String,
    default_path: String,
    is_default: bool,
    /// Shown once, e.g. when the configured folder was missing at startup.
    warning: Option<String>,
    /// The database was upgraded (with a backup) when it was opened, this session.
    notice: Option<String>,
    /// Copies made before upgrades (`backups/`), at most `db::KEEP_BACKUPS`.
    backup_count: usize,
}

fn info(state: &DrawerState, warning: Option<String>) -> LibraryInfo {
    let lib = state.lock();
    LibraryInfo {
        path: lib.dir.display().to_string(),
        default_path: state.default_dir.display().to_string(),
        is_default: same_dir(&lib.dir, &state.default_dir),
        warning,
        notice: lib.notice.clone(),
        backup_count: db::list_backups(&lib.backup_dir()).len(),
    }
}

#[tauri::command]
pub fn get_library_info(state: State<'_, DrawerState>) -> LibraryInfo {
    let warning = state.startup_warning.lock().unwrap().take();
    info(&state, warning)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderCheck {
    path: String,
    /// The folder already holds a Banyan library.
    has_library: bool,
    is_current: bool,
    /// Why moving the current library here is not possible, if it isn't.
    move_blocked: Option<String>,
}

#[tauri::command]
pub fn inspect_library_dir(state: State<'_, DrawerState>, path: String) -> FolderCheck {
    inspect(&state, path)
}

fn inspect(state: &DrawerState, path: String) -> FolderCheck {
    let target = PathBuf::from(&path);
    let lib = state.lock();
    let has_library = target.join(DB_FILE).is_file();
    let move_blocked = if is_inside(&target, &lib.storage_dir()) {
        Some("不能放在附件資料夾裡面".into())
    } else if has_library {
        Some("這個資料夾已經有資料庫".into())
    } else if !dir_is_empty_or_missing(&target.join(STORAGE_DIR)) {
        Some("這個資料夾已有 storage 資料夾，為避免混在一起，請選擇其他資料夾".into())
    } else {
        None
    };
    FolderCheck {
        is_current: same_dir(&target, &lib.dir),
        path,
        has_library,
        move_blocked,
    }
}

/// Opens the system folder picker. Returns `None` when cancelled.
#[tauri::command]
pub async fn pick_library_dir(app: AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .set_title("選擇資料庫位置")
        .blocking_pick_folder()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.display().to_string())
}

#[derive(Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ChangeMode {
    /// Copy the current library to the new folder and switch to it. The old copy stays.
    Move,
    /// Switch to the library that already exists in the folder.
    Open,
    /// Start a new, empty library in the folder.
    New,
}

/// Async so a long copy runs off the main thread and doesn't freeze the window.
#[tauri::command]
pub async fn change_library_dir(
    state: State<'_, DrawerState>,
    path: String,
    mode: ChangeMode,
) -> Result<LibraryInfo> {
    let target = PathBuf::from(&path);
    if path.trim().is_empty() || !target.is_absolute() {
        return Err(Error("請選擇一個完整的資料夾路徑".into()));
    }
    let check = inspect(&state, path.clone());
    if check.is_current {
        return Err(Error("這已經是目前的資料庫位置".into()));
    }

    let mut lib = state.lock();
    match mode {
        ChangeMode::Open if !check.has_library => {
            return Err(Error("這個資料夾裡沒有資料庫".into()));
        }
        ChangeMode::New if check.has_library => {
            return Err(Error("這個資料夾已經有資料庫，請改用「開啟」".into()));
        }
        ChangeMode::Move => {
            if let Some(reason) = check.move_blocked {
                return Err(Error(reason));
            }
            fs::create_dir_all(&target)?;
            let db_path = target.join(DB_FILE);
            let storage = target.join(STORAGE_DIR);
            // VACUUM INTO writes a consistent copy even while the database is open.
            let copied = lib
                .conn
                .execute("VACUUM INTO ?1", [db_path.to_string_lossy()])
                .map_err(Error::from)
                .and_then(|_| copy_dir(&lib.storage_dir(), &storage).map_err(Error::from));
            if let Err(e) = copied {
                // Undo the partial copy; never touch the original library.
                let _ = fs::remove_file(&db_path);
                let _ = fs::remove_dir_all(&storage);
                return Err(Error(format!("搬移失敗，原本的資料庫沒有變動。{}", e.0)));
            }
        }
        _ => {}
    }

    let new_lib = Library::open(&target)?;
    let library_dir = (!same_dir(&target, &state.default_dir)).then(|| target.clone());
    save_config(&state.config_path, &Config { library_dir })?;
    *lib = new_lib;
    drop(lib);
    Ok(info(&state, None))
}

/// Opens the folder with the copies made before database upgrades.
#[tauri::command]
pub fn reveal_backups(app: AppHandle, state: State<'_, DrawerState>) -> Result<()> {
    let dir = state.lock().backup_dir();
    if !dir.is_dir() {
        return Err(Error("還沒有任何升級前的備份".into()));
    }
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| Error(format!("無法開啟資料夾：{e}")))
}

#[tauri::command]
pub fn reveal_library_dir(app: AppHandle, state: State<'_, DrawerState>) -> Result<()> {
    let dir = state.lock().dir.clone();
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| Error(format!("無法開啟資料夾：{e}")))
}
