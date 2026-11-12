//! Drawer: two libraries sharing one item table — 文獻庫, a Zotero-style reference library, and
//! 檔案庫, where every item is a file typed by its extension — with folders, tags and attachments.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use crate::library::Library;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

pub struct DrawerState {
    /// The open library; swapped out when the user changes its location.
    pub lib: Mutex<Library>,
    pub default_dir: PathBuf,
    pub config_path: PathBuf,
    pub startup_warning: Mutex<Option<String>>,
    /// Files larger than this are linked (path recorded) instead of copied.
    pub link_threshold: u64,
}

/// 5 GB. Attachments above this size are linked rather than copied into the library.
pub const LINK_THRESHOLD: u64 = 5 * 1024 * 1024 * 1024;

impl DrawerState {
    pub fn lock(&self) -> MutexGuard<'_, Library> {
        self.lib.lock().unwrap_or_else(|e| e.into_inner())
    }
}

// ---------- errors ----------

#[derive(Debug)]
pub struct Error(pub String);

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.0)
    }
}

impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Self {
        Error(format!("資料庫錯誤：{e}"))
    }
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error(format!("檔案錯誤：{e}"))
    }
}

pub type Result<T> = std::result::Result<T, Error>;

pub(crate) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ---------- models ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    id: i64,
    name: String,
    parent_id: Option<i64>,
    /// "list" or "gallery".
    view: String,
    /// "literature" (文獻庫) or "files" (檔案庫).
    library: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemSummary {
    id: i64,
    item_type: String,
    title: String,
    authors: String,
    date: String,
    publication: String,
    publisher: String,
    series: String,
    place: String,
    attachment_count: i64,
    /// First attachment that is a picture (shown in galleries).
    image_id: Option<i64>,
    /// Name of the first attachment (the file of a file-library item).
    file_name: Option<String>,
    /// Total size of the attachments in bytes.
    file_size: i64,
    created_at: i64,
    updated_at: i64,
}

/// Item types a gallery folder accepts (藝術與圖像, and 圖片 in the file library).
pub const IMAGE_TYPES: [&str; 5] = ["painting", "artwork", "photo", "map", "fileImage"];
const GALLERY_ONLY: &str = "畫廊只能放圖片類的條目（繪畫、藝術品、照片、地圖、圖片檔）";
/// Attachments with these extensions count as pictures.
const IMAGE_EXTS: [&str; 8] = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "svg"];

fn is_image_file(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| IMAGE_EXTS.contains(&e.to_ascii_lowercase().as_str()))
}

// ---------- the two libraries: 文獻庫 and 檔案庫 ----------

/// The bibliographic library (Zotero-style records).
pub const LITERATURE: &str = "literature";
/// The file library: every item is a file, typed by its extension.
pub const FILES: &str = "files";

/// File-library item types all start with "file" (fileDocument, fileImage…); no literature type does.
/// Keep in sync with the 檔案 group in `src/drawer/itemTypes.ts`.
pub fn is_file_type(item_type: &str) -> bool {
    item_type.starts_with("file")
}

/// Which library an item type belongs to.
pub fn library_of(item_type: &str) -> &'static str {
    if is_file_type(item_type) { FILES } else { LITERATURE }
}

fn check_library(library: &str) -> Result<()> {
    match library {
        LITERATURE | FILES => Ok(()),
        _ => Err(Error(format!("未知的資料庫：{library}"))),
    }
}

fn library_label(library: &str) -> &'static str {
    if library == FILES { "檔案庫" } else { "文獻庫" }
}

/// File-library type for a file name, from its extension.
pub fn file_type_for(name: &str) -> &'static str {
    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "pdf" | "doc" | "docx" | "odt" | "rtf" | "pages" | "djvu" | "xps" => "fileDocument",
        "epub" | "mobi" | "azw" | "azw3" | "kfx" | "prc" | "fb2" | "fbz" | "cbz" | "cbr" | "cb7" => "fileEbook",
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "avif" | "svg" | "heic" | "heif" | "tif"
        | "tiff" | "ico" | "psd" | "raw" | "cr2" | "nef" | "arw" | "dng" => "fileImage",
        "mp4" | "mov" | "mkv" | "avi" | "webm" | "m4v" | "wmv" | "flv" | "mpg" | "mpeg" | "3gp" => "fileVideo",
        "mp3" | "wav" | "flac" | "m4a" | "aac" | "ogg" | "oga" | "opus" | "wma" | "aiff" | "aif" | "mid"
        | "midi" => "fileAudio",
        "txt" | "md" | "markdown" | "log" | "rst" | "org" | "tex" | "bib" => "fileText",
        "xls" | "xlsx" | "xlsm" | "csv" | "tsv" | "ods" | "numbers" => "fileSpreadsheet",
        "ppt" | "pptx" | "odp" | "key" => "filePresentation",
        "js" | "mjs" | "ts" | "tsx" | "jsx" | "py" | "rs" | "c" | "h" | "cpp" | "hpp" | "cc" | "cs" | "java"
        | "kt" | "go" | "rb" | "php" | "swift" | "sh" | "bash" | "ps1" | "bat" | "html" | "htm" | "css"
        | "scss" | "json" | "yaml" | "yml" | "toml" | "xml" | "sql" | "lua" | "r" | "ipynb" => "fileCode",
        "zip" | "rar" | "7z" | "tar" | "gz" | "tgz" | "bz2" | "xz" | "zst" => "fileArchive",
        _ => "fileOther",
    }
}

/// The library a folder belongs to, or None when the folder doesn't exist.
fn collection_library(conn: &Connection, collection_id: i64) -> Result<Option<String>> {
    Ok(conn
        .query_row("SELECT library FROM collections WHERE id = ?1", [collection_id], |r| r.get(0))
        .optional()?)
}

/// Errors when an item of `item_type` may not go into the folder: the folder is in the other
/// library, or it is a gallery and the type isn't a picture type.
fn check_type_fits(conn: &Connection, item_type: &str, collection_id: i64) -> Result<()> {
    if let Some(lib) = collection_library(conn, collection_id)? {
        if lib != library_of(item_type) {
            return Err(Error(format!(
                "{}的條目只能放進{}的資料夾",
                library_label(library_of(item_type)),
                library_label(library_of(item_type))
            )));
        }
    }
    if is_gallery(conn, collection_id)? && !IMAGE_TYPES.contains(&item_type) {
        return Err(Error(GALLERY_ONLY.into()));
    }
    Ok(())
}

fn is_gallery(conn: &Connection, collection_id: i64) -> Result<bool> {
    Ok(conn
        .query_row("SELECT view = 'gallery' FROM collections WHERE id = ?1", [collection_id], |r| r.get(0))
        .optional()?
        .unwrap_or(false))
}

/// Errors when the item may not go into the collection (the other library's folder, or a
/// gallery for a non-picture item).
fn check_fits(conn: &Connection, item_id: i64, collection_id: i64) -> Result<()> {
    let item_type: Option<String> = conn
        .query_row("SELECT item_type FROM items WHERE id = ?1", [item_id], |r| r.get(0))
        .optional()?;
    match item_type {
        Some(t) => check_type_fits(conn, &t, collection_id),
        None => Ok(()),
    }
}

/// Errors when the new type would move the item to the other library, or when an item that is
/// in a gallery would get a type that isn't an image type.
fn check_type_change(conn: &Connection, item_id: i64, item_type: &str) -> Result<()> {
    let current: Option<String> = conn
        .query_row("SELECT item_type FROM items WHERE id = ?1", [item_id], |r| r.get(0))
        .optional()?;
    if let Some(current) = current {
        if library_of(&current) != library_of(item_type) {
            return Err(Error("不能把條目改成另一個資料庫的類型（文獻庫與檔案庫的類型不能互換）".into()));
        }
    }
    if IMAGE_TYPES.contains(&item_type) {
        return Ok(());
    }
    let gallery: Option<String> = conn
        .query_row(
            "SELECT c.name FROM item_collections ic JOIN collections c ON c.id = ic.collection_id
             WHERE ic.item_id = ?1 AND c.view = 'gallery' LIMIT 1",
            [item_id],
            |r| r.get(0),
        )
        .optional()?;
    match gallery {
        Some(name) => Err(Error(format!("條目在畫廊「{name}」裡，只能是圖片類的類型（繪畫、藝術品、照片、地圖、圖片檔）"))),
        None => Ok(()),
    }
}

/// The editable metadata of an item.
/// Declares `ItemFields` together with its column list, so SQL and struct can't drift apart.
macro_rules! item_fields {
    ($($(#[$doc:meta])* $field:ident),* $(,)?) => {
        #[derive(Serialize, Deserialize, Default)]
        #[serde(rename_all = "camelCase", default)]
        pub struct ItemFields {
            $($(#[$doc])* $field: String,)*
        }

        impl ItemFields {
            /// Column names in `items`, in declaration order.
            const COLUMNS: &'static [&'static str] = &[$(stringify!($field)),*];

            fn values(&self) -> Vec<&str> {
                vec![$(self.$field.as_str()),*]
            }

            /// Reads the fields from consecutive columns starting at `offset`.
            fn from_row(r: &rusqlite::Row, offset: usize) -> rusqlite::Result<Self> {
                let mut i = offset;
                let mut next = || -> rusqlite::Result<String> {
                    let v = r.get(i)?;
                    i += 1;
                    Ok(v)
                };
                Ok(ItemFields { $($field: next()?,)* })
            }
        }
    };
}

item_fields! {
    item_type,
    title,
    date,
    publication,
    volume,
    issue,
    pages,
    publisher,
    doi,
    isbn,
    url,
    abstract_note,
    /// Length of a recording or film, e.g. "2:16:00".
    running_time,
    /// Format or material: "黑膠", "藍光", "油彩、畫布".
    medium,
    /// Physical size, e.g. "73 × 92 cm".
    dimensions,
    /// Location / country / holding institution.
    place,
    /// Catalogue or inventory number.
    catalog_number,
    /// Series the item belongs to: a book series, film franchise, series of paintings…
    series,
    /// Position within the series, e.g. "3", "第 2 部".
    series_number,
    /// The item's text pasted as-is, e.g. a news article (原文).
    full_text,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    id: i64,
    item_id: i64,
    file_name: String,
    size: i64,
    created_at: i64,
    /// True when only the original location is recorded (file too large to copy).
    linked: bool,
    /// Original location, for linked attachments.
    linked_path: Option<String>,
    /// 檔案庫 copy of a 文獻庫 attachment: the literature attachment whose file it shares.
    mirror_of: Option<i64>,
    /// 文獻庫 attachment that also shows up in 檔案庫 (some file item shares its file).
    mirrored: bool,
}

impl Attachment {
    /// Expects the columns of `ATTACHMENT_COLUMNS`.
    fn from_row(r: &rusqlite::Row) -> rusqlite::Result<Self> {
        let linked: bool = r.get(5)?;
        Ok(Attachment {
            id: r.get(0)?,
            item_id: r.get(1)?,
            file_name: r.get(2)?,
            size: r.get(3)?,
            created_at: r.get(4)?,
            linked,
            linked_path: if linked { Some(r.get(6)?) } else { None },
            mirror_of: r.get(7)?,
            mirrored: r.get(8)?,
        })
    }
}

/// A person credited on an item, with their role ("author", "editor", "translator"…).
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Creator {
    pub role: String,
    pub name: String,
}

/// Selected `FROM attachments` (unaliased: the last column looks for rows mirroring this one).
const ATTACHMENT_COLUMNS: &str = "id, item_id, file_name, size, created_at, linked, stored_path, mirror_of,
     EXISTS (SELECT 1 FROM attachments m WHERE m.mirror_of = attachments.id)";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemDetail {
    id: i64,
    #[serde(flatten)]
    fields: ItemFields,
    creators: Vec<Creator>,
    tags: Vec<String>,
    collection_ids: Vec<i64>,
    attachments: Vec<Attachment>,
    /// Related items (both directions), sorted by title.
    related: Vec<RelatedItem>,
    created_at: i64,
    updated_at: i64,
}

/// An item related to another one (Zotero's "Related").
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelatedItem {
    id: i64,
    item_type: String,
    title: String,
    authors: String,
    date: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ItemFilter {
    collection_id: Option<i64>,
    /// Only items carrying this tag.
    #[serde(default)]
    tag_id: Option<i64>,
    #[serde(default)]
    unfiled: bool,
    #[serde(default)]
    query: String,
    /// Only items of this library ("literature" or "files"); all items when absent.
    #[serde(default)]
    library: Option<String>,
}

// ---------- collections ----------

#[tauri::command]
pub fn list_collections(state: State<'_, DrawerState>) -> Result<Vec<Collection>> {
    let lib = state.lock();
    let conn = &lib.conn;
    let mut stmt =
        conn.prepare("SELECT id, name, parent_id, view, library FROM collections ORDER BY name COLLATE NOCASE")?;
    let rows = stmt.query_map([], |r| {
        Ok(Collection {
            id: r.get(0)?,
            name: r.get(1)?,
            parent_id: r.get(2)?,
            view: r.get(3)?,
            library: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

#[tauri::command]
pub fn create_collection(
    state: State<'_, DrawerState>,
    name: String,
    parent_id: Option<i64>,
    view: Option<String>,
    library: Option<String>,
) -> Result<Collection> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(Error("資料夾名稱不能是空的".into()));
    }
    let view = view.unwrap_or_else(|| "list".into());
    check_view(&view)?;
    let lib = state.lock();
    let conn = &lib.conn;
    // A sub-folder lives in its parent's library.
    let library = match parent_id {
        Some(pid) => collection_library(conn, pid)?.ok_or_else(|| Error("找不到上層資料夾".into()))?,
        None => library.unwrap_or_else(|| LITERATURE.into()),
    };
    check_library(&library)?;
    conn.execute(
        "INSERT INTO collections (name, parent_id, created_at, view, library) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![name, parent_id, now_ms(), view, library],
    )?;
    Ok(Collection {
        id: conn.last_insert_rowid(),
        name,
        parent_id,
        view,
        library,
    })
}

fn check_view(view: &str) -> Result<()> {
    match view {
        "list" | "gallery" => Ok(()),
        _ => Err(Error(format!("未知的顯示方式：{view}"))),
    }
}

/// Changes how a folder shows its items. A folder becomes a gallery only when everything in
/// it is an image item.
#[tauri::command]
pub fn set_collection_view(state: State<'_, DrawerState>, id: i64, view: String) -> Result<()> {
    check_view(&view)?;
    let lib = state.lock();
    let conn = &lib.conn;
    if view == "gallery" {
        let others: i64 = conn.query_row(
            &format!(
                "SELECT COUNT(*) FROM item_collections ic JOIN items i ON i.id = ic.item_id
                 WHERE ic.collection_id = ?1 AND i.item_type NOT IN ({})",
                IMAGE_TYPES.map(|t| format!("'{t}'")).join(", ")
            ),
            [id],
            |r| r.get(0),
        )?;
        if others > 0 {
            return Err(Error(format!(
                "資料夾裡有 {others} 個不是圖片類的條目，不能改成畫廊。畫廊只能放繪畫、藝術品、照片、地圖、圖片檔。"
            )));
        }
    }
    conn.execute("UPDATE collections SET view = ?1 WHERE id = ?2", params![view, id])?;
    Ok(())
}

#[tauri::command]
pub fn rename_collection(state: State<'_, DrawerState>, id: i64, name: String) -> Result<()> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error("資料夾名稱不能是空的".into()));
    }
    let lib = state.lock();
    let conn = &lib.conn;
    conn.execute("UPDATE collections SET name = ?1 WHERE id = ?2", params![name, id])?;
    Ok(())
}

/// Deletes the collection and its sub-collections. Items stay in the library.
#[tauri::command]
pub fn delete_collection(state: State<'_, DrawerState>, id: i64) -> Result<()> {
    let lib = state.lock();
    let conn = &lib.conn;
    conn.execute("DELETE FROM collections WHERE id = ?1", [id])?;
    Ok(())
}

// ---------- items ----------

pub(crate) fn like_pattern(q: &str) -> String {
    let escaped = q
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

#[tauri::command]
pub fn list_items(state: State<'_, DrawerState>, filter: ItemFilter) -> Result<Vec<ItemSummary>> {
    let lib = state.lock();
    let conn = &lib.conn;
    let query = filter.query.trim();
    let pattern = if query.is_empty() {
        String::new()
    } else {
        like_pattern(query)
    };
    // Every text field except the type is searchable.
    let field_matches: String = ItemFields::COLUMNS
        .iter()
        .filter(|c| **c != "item_type")
        .map(|c| format!("i.{c} LIKE ?3 ESCAPE '\\' OR "))
        .collect();
    let image_match: String = IMAGE_EXTS
        .iter()
        .map(|e| format!("lower(a.file_name) LIKE '%.{e}'"))
        .collect::<Vec<_>>()
        .join(" OR ");
    let sql = format!(
        r"SELECT i.id, i.item_type, i.title, i.authors, i.date, i.updated_at,
                 (SELECT COUNT(*) FROM attachments a WHERE a.item_id = i.id),
                 i.publication, i.publisher, i.series, i.place, i.created_at,
                 (SELECT a.id FROM attachments a WHERE a.item_id = i.id AND ({image_match})
                  ORDER BY a.created_at, a.id LIMIT 1),
                 (SELECT a.file_name FROM attachments a WHERE a.item_id = i.id ORDER BY a.created_at, a.id LIMIT 1),
                 (SELECT COALESCE(SUM(a.size), 0) FROM attachments a WHERE a.item_id = i.id)
          FROM items i
          WHERE (?5 IS NULL OR (substr(i.item_type, 1, 4) = 'file') = (?5 = 'files'))
            AND (?1 IS NULL OR EXISTS (SELECT 1 FROM item_collections ic
                                       WHERE ic.item_id = i.id AND ic.collection_id = ?1))
            AND (?2 = 0 OR NOT EXISTS (SELECT 1 FROM item_collections ic WHERE ic.item_id = i.id))
            AND (?4 IS NULL OR EXISTS (SELECT 1 FROM item_tags it WHERE it.item_id = i.id AND it.tag_id = ?4))
            AND (?3 = '' OR {field_matches}
                         EXISTS (SELECT 1 FROM item_creators c
                                 WHERE c.item_id = i.id AND c.name LIKE ?3 ESCAPE '\') OR
                         EXISTS (SELECT 1 FROM item_tags it JOIN tags t ON t.id = it.tag_id
                                 WHERE it.item_id = i.id AND t.name LIKE ?3 ESCAPE '\')
                         OR EXISTS (SELECT 1 FROM attachments a
                                    WHERE a.item_id = i.id AND a.file_name LIKE ?3 ESCAPE '\')
                         OR EXISTS (SELECT 1 FROM card_items ci JOIN cards c ON c.id = ci.card_id
                                    WHERE ci.item_id = i.id
                                      AND (c.title LIKE ?3 ESCAPE '\' OR c.content LIKE ?3 ESCAPE '\')))
          ORDER BY i.updated_at DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    if let Some(l) = &filter.library {
        check_library(l)?;
    }
    let rows = stmt.query_map(params![filter.collection_id, filter.unfiled, pattern, filter.tag_id, filter.library], |r| {
        Ok(ItemSummary {
            id: r.get(0)?,
            item_type: r.get(1)?,
            title: r.get(2)?,
            authors: r.get(3)?,
            date: r.get(4)?,
            updated_at: r.get(5)?,
            attachment_count: r.get(6)?,
            publication: r.get(7)?,
            publisher: r.get(8)?,
            series: r.get(9)?,
            place: r.get(10)?,
            created_at: r.get(11)?,
            image_id: r.get(12)?,
            file_name: r.get(13)?,
            file_size: r.get(14)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn load_item(conn: &Connection, id: i64) -> Result<ItemDetail> {
    let sql = format!(
        "SELECT {}, created_at, updated_at FROM items WHERE id = ?1",
        ItemFields::COLUMNS.join(", ")
    );
    let n = ItemFields::COLUMNS.len();
    let item = conn
        .query_row(&sql, [id], |r| {
            Ok((ItemFields::from_row(r, 0)?, r.get::<_, i64>(n)?, r.get::<_, i64>(n + 1)?))
        })
        .optional()?;
    let Some((fields, created_at, updated_at)) = item else {
        return Err(Error("找不到這個條目".into()));
    };

    let creators = conn
        .prepare("SELECT role, name FROM item_creators WHERE item_id = ?1 ORDER BY position, id")?
        .query_map([id], |r| Ok(Creator { role: r.get(0)?, name: r.get(1)? }))?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let tags = conn
        .prepare(
            "SELECT t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id
             WHERE it.item_id = ?1 ORDER BY t.name COLLATE NOCASE",
        )?
        .query_map([id], |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<String>>>()?;

    let collection_ids = conn
        .prepare("SELECT collection_id FROM item_collections WHERE item_id = ?1")?
        .query_map([id], |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<i64>>>()?;

    let attachments = conn
        .prepare(&format!(
            "SELECT {ATTACHMENT_COLUMNS} FROM attachments WHERE item_id = ?1 ORDER BY created_at, id"
        ))?
        .query_map([id], Attachment::from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let related = conn
        .prepare(
            "SELECT i.id, i.item_type, i.title, i.authors, i.date FROM item_relations r
             JOIN items i ON i.id = CASE WHEN r.item_a = ?1 THEN r.item_b ELSE r.item_a END
             WHERE r.item_a = ?1 OR r.item_b = ?1
             ORDER BY i.title = '', i.title COLLATE NOCASE, i.id",
        )?
        .query_map([id], |r| {
            Ok(RelatedItem {
                id: r.get(0)?,
                item_type: r.get(1)?,
                title: r.get(2)?,
                authors: r.get(3)?,
                date: r.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(ItemDetail {
        id,
        fields,
        creators,
        tags,
        collection_ids,
        attachments,
        related,
        created_at,
        updated_at,
    })
}

#[tauri::command]
pub fn get_item(state: State<'_, DrawerState>, id: i64) -> Result<ItemDetail> {
    let lib = state.lock();
    let conn = &lib.conn;
    load_item(&conn, id)
}

#[tauri::command]
pub fn create_item(
    state: State<'_, DrawerState>,
    item_type: String,
    collection_id: Option<i64>,
) -> Result<ItemDetail> {
    let mut lib = state.lock();
    let conn = &mut lib.conn;
    if let Some(cid) = collection_id {
        check_type_fits(conn, &item_type, cid)?;
    }
    let tx = conn.transaction()?;
    let now = now_ms();
    tx.execute(
        "INSERT INTO items (item_type, created_at, updated_at) VALUES (?1, ?2, ?2)",
        params![item_type, now],
    )?;
    let id = tx.last_insert_rowid();
    if let Some(cid) = collection_id {
        tx.execute(
            "INSERT INTO item_collections (item_id, collection_id) VALUES (?1, ?2)",
            params![id, cid],
        )?;
    }
    tx.commit()?;
    load_item(&conn, id)
}

#[tauri::command]
pub fn update_item(state: State<'_, DrawerState>, id: i64, fields: ItemFields) -> Result<()> {
    let lib = state.lock();
    let conn = &lib.conn;
    check_type_change(conn, id, &fields.item_type)?;
    let assignments: Vec<String> = ItemFields::COLUMNS.iter().map(|c| format!("{c} = ?")).collect();
    let sql = format!(
        "UPDATE items SET {}, updated_at = ? WHERE id = ?",
        assignments.join(", ")
    );
    let mut values: Vec<rusqlite::types::Value> =
        fields.values().into_iter().map(|v| v.to_string().into()).collect();
    values.push(now_ms().into());
    values.push(id.into());
    conn.execute(&sql, rusqlite::params_from_iter(values))?;
    // The type may have changed, which changes whose names come first in the summary.
    refresh_creator_summary(conn, id)?;
    Ok(())
}

/// Rebuilds `items.authors`, the one-name-per-line summary used by the item list:
/// creators with the type's main role first (e.g. authors before translators).
fn refresh_creator_summary(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    let item_type: Option<String> = conn
        .query_row("SELECT item_type FROM items WHERE id = ?1", [id], |r| r.get(0))
        .optional()?;
    let Some(item_type) = item_type else { return Ok(()) };
    let names = conn
        .prepare(
            "SELECT name FROM item_creators WHERE item_id = ?1
             ORDER BY role <> ?2, position, id",
        )?
        .query_map(params![id, crate::db::primary_role(&item_type)], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    conn.execute(
        "UPDATE items SET authors = ?1 WHERE id = ?2",
        params![names.join("\n"), id],
    )?;
    Ok(())
}

/// Replaces the item's creators, keeping the given order. Blank names are dropped.
#[tauri::command]
pub fn set_item_creators(state: State<'_, DrawerState>, id: i64, creators: Vec<Creator>) -> Result<()> {
    let mut lib = state.lock();
    let conn = &mut lib.conn;
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM item_creators WHERE item_id = ?1", [id])?;
    let kept = creators
        .iter()
        .map(|c| (c.role.trim(), c.name.trim()))
        .filter(|(_, name)| !name.is_empty());
    for (pos, (role, name)) in kept.enumerate() {
        let role = if role.is_empty() { "author" } else { role };
        tx.execute(
            "INSERT INTO item_creators (item_id, position, role, name) VALUES (?1, ?2, ?3, ?4)",
            params![id, pos as i64, role, name],
        )?;
    }
    refresh_creator_summary(&tx, id)?;
    touch_item(&tx, id)?;
    tx.commit()?;
    Ok(())
}

/// Deletes the item together with its attachment files on disk and its own note cards.
#[tauri::command]
pub fn delete_item(state: State<'_, DrawerState>, id: i64) -> Result<()> {
    let lib = state.lock();
    delete_item_in(&lib, id)
}

/// All or nothing: the database changes are made in one savepoint (so this also works inside
/// another operation's), and files handed over to 檔案庫 are moved back if anything fails. The
/// item's own folder is only removed once the database changes went through.
fn delete_item_in(lib: &crate::library::Library, id: i64) -> Result<()> {
    let conn = &lib.conn;
    let mut moved = Vec::new();
    let done = in_savepoint(conn, || {
        hand_over_shared_files(lib, id, &mut moved)?;
        // Note cards that belong only to this item (no board, no other item) go with it,
        // as the old free-text notes did. Cards on a board or shared with other items stay.
        conn.execute(
            "DELETE FROM cards WHERE id IN (SELECT card_id FROM card_items WHERE item_id = ?1)
               AND NOT EXISTS (SELECT 1 FROM board_cards bc WHERE bc.card_id = cards.id)
               AND NOT EXISTS (SELECT 1 FROM card_items o WHERE o.card_id = cards.id AND o.item_id <> ?1)",
            [id],
        )?;
        conn.execute("DELETE FROM items WHERE id = ?1", [id])?;
        delete_orphan_tags(conn)?;
        Ok(())
    });
    if let Err(e) = done {
        undo_moves(moved);
        return Err(e);
    }
    remove_dir_if_exists(&lib.storage_dir().join(id.to_string()))?;
    Ok(())
}

/// Runs `f` in a savepoint: its database changes are kept only if it succeeds. Savepoints nest,
/// so this works on its own (it then commits) and inside a transaction or another savepoint.
pub(crate) fn in_savepoint<T>(conn: &Connection, f: impl FnOnce() -> Result<T>) -> Result<T> {
    conn.execute_batch("SAVEPOINT drawer_op")?;
    match f() {
        Ok(v) => {
            conn.execute_batch("RELEASE drawer_op")?;
            Ok(v)
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK TO drawer_op; RELEASE drawer_op");
            Err(e)
        }
    }
}

/// Drops tags no item uses any more.
fn delete_orphan_tags(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM item_tags)",
        [],
    )?;
    Ok(())
}

fn touch_item(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE items SET updated_at = ?1 WHERE id = ?2",
        params![now_ms(), id],
    )?;
    Ok(())
}

#[tauri::command]
pub fn set_item_tags(state: State<'_, DrawerState>, id: i64, tags: Vec<String>) -> Result<()> {
    let mut lib = state.lock();
    let conn = &mut lib.conn;
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM item_tags WHERE item_id = ?1", [id])?;
    for tag in tags.iter().map(|t| t.trim()).filter(|t| !t.is_empty()) {
        tx.execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", [tag])?;
        tx.execute(
            "INSERT OR IGNORE INTO item_tags (item_id, tag_id)
             SELECT ?1, id FROM tags WHERE name = ?2",
            params![id, tag],
        )?;
    }
    delete_orphan_tags(&tx)?;
    touch_item(&tx, id)?;
    tx.commit()?;
    Ok(())
}

// ---------- tags (left pane) ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagInfo {
    id: i64,
    name: String,
    /// Number of items carrying the tag.
    count: i64,
}

#[tauri::command]
pub fn list_tags(state: State<'_, DrawerState>, library: Option<String>) -> Result<Vec<TagInfo>> {
    if let Some(l) = &library {
        check_library(l)?;
    }
    let lib = state.lock();
    // With a library, only its items are counted and tags none of them use are left out.
    let rows = lib
        .conn
        .prepare(
            "SELECT t.id, t.name, COUNT(i.id) FROM tags t
             LEFT JOIN item_tags it ON it.tag_id = t.id
             LEFT JOIN items i ON i.id = it.item_id
                AND (?1 IS NULL OR (substr(i.item_type, 1, 4) = 'file') = (?1 = 'files'))
             GROUP BY t.id
             HAVING ?1 IS NULL OR COUNT(i.id) > 0
             ORDER BY t.name COLLATE NOCASE",
        )?
        .query_map([library], |r| Ok(TagInfo { id: r.get(0)?, name: r.get(1)?, count: r.get(2)? }))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Renames a tag. If another tag already has that name (case-insensitive), the two are
/// merged into it. Returns the id of the resulting tag.
#[tauri::command]
pub fn rename_tag(state: State<'_, DrawerState>, id: i64, name: String) -> Result<i64> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error("標籤名稱不能是空的".into()));
    }
    let mut lib = state.lock();
    let conn = &mut lib.conn;
    let tx = conn.transaction()?;
    let other: Option<i64> = tx
        .query_row("SELECT id FROM tags WHERE name = ?1 AND id <> ?2", params![name, id], |r| r.get(0))
        .optional()?;
    let result = match other {
        Some(target) => {
            tx.execute(
                "INSERT OR IGNORE INTO item_tags (item_id, tag_id) SELECT item_id, ?2 FROM item_tags WHERE tag_id = ?1",
                params![id, target],
            )?;
            tx.execute("DELETE FROM tags WHERE id = ?1", [id])?;
            target
        }
        None => {
            tx.execute("UPDATE tags SET name = ?1 WHERE id = ?2", params![name, id])?;
            id
        }
    };
    tx.commit()?;
    Ok(result)
}

/// Removes a tag from every item.
#[tauri::command]
pub fn delete_tag(state: State<'_, DrawerState>, id: i64) -> Result<()> {
    let lib = state.lock();
    lib.conn.execute("DELETE FROM tags WHERE id = ?1", [id])?;
    Ok(())
}

/// Tags items (drag-and-drop onto a tag). Returns how many items newly got the tag.
#[tauri::command]
pub fn add_tag_to_items(state: State<'_, DrawerState>, item_ids: Vec<i64>, tag_id: i64) -> Result<usize> {
    let mut lib = state.lock();
    let conn = &mut lib.conn;
    let exists: bool =
        conn.query_row("SELECT EXISTS (SELECT 1 FROM tags WHERE id = ?1)", [tag_id], |r| r.get(0))?;
    if !exists {
        return Err(Error("找不到這個標籤".into()));
    }
    let tx = conn.transaction()?;
    let mut added = 0;
    for id in item_ids {
        let n = tx.execute(
            "INSERT OR IGNORE INTO item_tags (item_id, tag_id) SELECT id, ?2 FROM items WHERE id = ?1",
            params![id, tag_id],
        )?;
        if n > 0 {
            touch_item(&tx, id)?;
        }
        added += n;
    }
    tx.commit()?;
    Ok(added)
}

#[tauri::command]
pub fn set_item_collections(
    state: State<'_, DrawerState>,
    id: i64,
    collection_ids: Vec<i64>,
) -> Result<()> {
    let mut lib = state.lock();
    let conn = &mut lib.conn;
    for &cid in &collection_ids {
        check_fits(conn, id, cid)?;
    }
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM item_collections WHERE item_id = ?1", [id])?;
    for cid in collection_ids {
        tx.execute(
            "INSERT OR IGNORE INTO item_collections (item_id, collection_id) VALUES (?1, ?2)",
            params![id, cid],
        )?;
    }
    touch_item(&tx, id)?;
    tx.commit()?;
    Ok(())
}

/// Adds items to a collection (drag-and-drop onto a folder). With `remove_from`, the items
/// also leave that collection — i.e. a move. Returns how many items were newly added.
#[tauri::command]
pub fn add_items_to_collection(
    state: State<'_, DrawerState>,
    item_ids: Vec<i64>,
    collection_id: i64,
    remove_from: Option<i64>,
) -> Result<usize> {
    let mut lib = state.lock();
    let conn = &mut lib.conn;
    let exists: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM collections WHERE id = ?1)",
        [collection_id],
        |r| r.get(0),
    )?;
    if !exists {
        return Err(Error("找不到這個資料夾".into()));
    }
    for &id in &item_ids {
        check_fits(conn, id, collection_id)?;
    }
    let tx = conn.transaction()?;
    let mut added = 0;
    for &id in &item_ids {
        let n = tx.execute(
            "INSERT OR IGNORE INTO item_collections (item_id, collection_id)
             SELECT id, ?2 FROM items WHERE id = ?1",
            params![id, collection_id],
        )?;
        let mut changed = n > 0;
        if let Some(from) = remove_from.filter(|&from| from != collection_id) {
            changed |= tx.execute(
                "DELETE FROM item_collections WHERE item_id = ?1 AND collection_id = ?2",
                params![id, from],
            )? > 0;
        }
        if changed {
            touch_item(&tx, id)?;
        }
        added += n;
    }
    tx.commit()?;
    Ok(added)
}

/// Distinct non-empty values of one text field, most used first (for autocomplete, e.g. series).
#[tauri::command]
pub fn field_values(state: State<'_, DrawerState>, field: String) -> Result<Vec<String>> {
    if !ItemFields::COLUMNS.contains(&field.as_str()) || field == "item_type" {
        return Err(Error("無效的欄位".into()));
    }
    let lib = state.lock();
    let values = lib
        .conn
        .prepare(&format!(
            "SELECT {field} FROM items WHERE trim({field}) <> ''
             GROUP BY {field} ORDER BY COUNT(*) DESC, {field} COLLATE NOCASE LIMIT 200"
        ))?
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<String>>>()?;
    Ok(values)
}

// ---------- related items ----------

/// Relates the two items (both ways). Returns false when it is the same item, either item is
/// missing, or they are already related. Both items count as modified, as in Zotero.
fn relate(conn: &Connection, x: i64, y: i64, now: i64) -> rusqlite::Result<bool> {
    if x == y {
        return Ok(false);
    }
    let (a, b) = (x.min(y), x.max(y));
    let n = conn.execute(
        "INSERT OR IGNORE INTO item_relations (item_a, item_b, created_at)
         SELECT ?1, ?2, ?3
         WHERE EXISTS (SELECT 1 FROM items WHERE id = ?1) AND EXISTS (SELECT 1 FROM items WHERE id = ?2)",
        params![a, b, now],
    )?;
    if n > 0 {
        touch_item(conn, a)?;
        touch_item(conn, b)?;
    }
    Ok(n > 0)
}

/// Relates `item_id` to each of `related_ids`. Returns how many relations are new.
#[tauri::command]
pub fn add_related_items(state: State<'_, DrawerState>, item_id: i64, related_ids: Vec<i64>) -> Result<usize> {
    let mut lib = state.lock();
    let conn = &mut lib.conn;
    let exists: bool = conn.query_row("SELECT EXISTS (SELECT 1 FROM items WHERE id = ?1)", [item_id], |r| r.get(0))?;
    if !exists {
        return Err(Error("找不到這個條目".into()));
    }
    let tx = conn.transaction()?;
    let now = now_ms();
    let mut added = 0;
    for rid in related_ids {
        added += relate(&tx, item_id, rid, now)? as usize;
    }
    tx.commit()?;
    Ok(added)
}

/// Removes the relation between the two items (from both sides).
#[tauri::command]
pub fn remove_related_item(state: State<'_, DrawerState>, item_id: i64, related_id: i64) -> Result<()> {
    let lib = state.lock();
    let conn = &lib.conn;
    let (a, b) = (item_id.min(related_id), item_id.max(related_id));
    if conn.execute("DELETE FROM item_relations WHERE item_a = ?1 AND item_b = ?2", params![a, b])? > 0 {
        touch_item(conn, a)?;
        touch_item(conn, b)?;
    }
    Ok(())
}

/// Relates every pair of the given items to each other. Returns how many relations are new.
#[tauri::command]
pub fn relate_items(state: State<'_, DrawerState>, item_ids: Vec<i64>) -> Result<usize> {
    let mut lib = state.lock();
    let conn = &mut lib.conn;
    let tx = conn.transaction()?;
    let now = now_ms();
    let mut added = 0;
    for (i, &x) in item_ids.iter().enumerate() {
        for &y in &item_ids[i + 1..] {
            added += relate(&tx, x, y, now)? as usize;
        }
    }
    tx.commit()?;
    Ok(added)
}

// ---------- attachments ----------

fn remove_dir_if_exists(dir: &Path) -> std::io::Result<()> {
    match fs::remove_dir_all(dir) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

/// Picks a file name inside `dir` that does not exist yet: `a.pdf`, `a (2).pdf`, ...
pub(crate) fn unique_target(dir: &Path, file_name: &str) -> PathBuf {
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }
    let p = Path::new(file_name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = p.extension().and_then(|s| s.to_str());
    (2..)
        .map(|n| match ext {
            Some(ext) => dir.join(format!("{stem} ({n}).{ext}")),
            None => dir.join(format!("{stem} ({n})")),
        })
        .find(|p| !p.exists())
        .unwrap()
}

/// Copies the given files into the item's storage folder and records them.
/// Files larger than `link_threshold` are not copied; their original path is recorded instead.
fn attach_files(state: &DrawerState, item_id: i64, paths: &[PathBuf]) -> Result<Vec<Attachment>> {
    let lib = state.lock();
    let conn = &lib.conn;
    let exists: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM items WHERE id = ?1)",
        [item_id],
        |r| r.get(0),
    )?;
    if !exists {
        return Err(Error("找不到這個條目".into()));
    }

    let dir = lib.storage_dir().join(item_id.to_string());

    let mut added = Vec::new();
    for src in paths {
        let Ok(meta) = fs::metadata(src) else { continue }; // vanished path
        if !meta.is_file() {
            continue; // skip folders
        }
        let file_name = src
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("attachment")
            .to_string();
        let now = now_ms();

        let (stored_name, stored_path, size, linked) = if meta.len() > state.link_threshold {
            // Too large to duplicate: remember where it is.
            let original = std::path::absolute(src)?;
            (file_name, original.to_string_lossy().to_string(), meta.len() as i64, true)
        } else {
            fs::create_dir_all(&dir)?;
            let target = unique_target(&dir, &file_name);
            let size = fs::copy(src, &target)? as i64;
            let stored_name = target.file_name().unwrap().to_string_lossy().to_string();
            let stored_path = format!("{item_id}/{stored_name}");
            (stored_name, stored_path, size, false)
        };

        conn.execute(
            "INSERT INTO attachments (item_id, file_name, stored_path, size, created_at, linked)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![item_id, stored_name, stored_path, size, now, linked],
        )?;
        let id = conn.last_insert_rowid();
        // A 文獻庫 attachment also shows up in 檔案庫.
        let mirrored = mirror_attachment(conn, id)?.is_some();
        added.push(Attachment {
            id,
            item_id,
            file_name: stored_name,
            size,
            created_at: now,
            linked,
            linked_path: linked.then_some(stored_path),
            mirror_of: None,
            mirrored,
        });
    }
    if !added.is_empty() {
        touch_item(&conn, item_id)?;
    }
    Ok(added)
}

/// Attachments of one item, for the expandable rows in the item list.
#[tauri::command]
pub fn list_attachments(state: State<'_, DrawerState>, item_id: i64) -> Result<Vec<Attachment>> {
    let lib = state.lock();
    let rows = lib
        .conn
        .prepare(&format!(
            "SELECT {ATTACHMENT_COLUMNS} FROM attachments WHERE item_id = ?1 ORDER BY created_at, id"
        ))?
        .query_map([item_id], Attachment::from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Opens the system file picker and attaches the chosen files to the item.
#[tauri::command]
pub async fn pick_attachments(
    app: AppHandle,
    state: State<'_, DrawerState>,
    item_id: i64,
) -> Result<Vec<Attachment>> {
    // Async commands run off the main thread, so blocking on the dialog is fine here.
    let Some(picked) = app.dialog().file().set_title("加入附件").blocking_pick_files() else {
        return Ok(Vec::new());
    };
    let paths: Vec<PathBuf> = picked
        .into_iter()
        .filter_map(|f| f.into_path().ok())
        .collect();
    attach_files(&state, item_id, &paths)
}

/// Attaches files given by path (used for drag-and-drop).
#[tauri::command]
pub fn add_attachments(
    state: State<'_, DrawerState>,
    item_id: i64,
    paths: Vec<String>,
) -> Result<Vec<Attachment>> {
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    attach_files(&state, item_id, &paths)
}

/// The attachment's bytes, sent to the page without JSON encoding (gallery pictures).
#[tauri::command]
pub fn read_attachment(state: State<'_, DrawerState>, id: i64) -> Result<tauri::ipc::Response> {
    let path = attachment_path(&state, id)?;
    Ok(tauri::ipc::Response::new(fs::read(path)?))
}

/// Picture files dropped onto a gallery: each becomes a 照片 item (titled after the file) in the
/// gallery, with the file attached. Other files are skipped. Returns the new items' ids.
#[tauri::command]
pub fn import_images(state: State<'_, DrawerState>, collection_id: i64, paths: Vec<String>) -> Result<Vec<i64>> {
    let mut ids = Vec::new();
    for path in paths.iter().map(PathBuf::from) {
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !path.is_file() || !is_image_file(name) {
            continue;
        }
        let title = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
        let id = {
            let lib = state.lock();
            let conn = &lib.conn;
            if !is_gallery(conn, collection_id)? {
                return Err(Error("只能把圖片直接拖進畫廊".into()));
            }
            check_type_fits(conn, "photo", collection_id)?; // a 文獻庫 gallery
            let now = now_ms();
            conn.execute(
                "INSERT INTO items (item_type, title, created_at, updated_at) VALUES ('photo', ?1, ?2, ?2)",
                params![title, now],
            )?;
            let id = conn.last_insert_rowid();
            conn.execute(
                "INSERT INTO item_collections (item_id, collection_id) VALUES (?1, ?2)",
                params![id, collection_id],
            )?;
            id
        };
        attach_files(&state, id, &[path])?;
        ids.push(id);
    }
    Ok(ids)
}

/// Result of adding files to the file library.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    /// The new items, in the order of the files.
    item_ids: Vec<i64>,
    /// Folders and files a gallery doesn't take (non-pictures).
    skipped: usize,
    /// Files too large to copy that were linked instead.
    linked: Vec<String>,
    /// Files that couldn't be added, with the reason ("name: reason"). The others still are.
    failed: Vec<String>,
}

/// Files added to the file library (檔案庫): each file becomes an item whose type follows its
/// extension, titled after the file, with the file attached. `collection_id` must be a folder of
/// the file library; a gallery takes pictures only. Folders are skipped.
pub fn import_into_file_library(
    state: &DrawerState,
    collection_id: Option<i64>,
    paths: &[PathBuf],
) -> Result<ImportResult> {
    if let Some(cid) = collection_id {
        let lib = state.lock();
        match collection_library(&lib.conn, cid)? {
            None => return Err(Error("找不到這個資料夾".into())),
            Some(l) if l != FILES => return Err(Error("只能把檔案加進檔案庫的資料夾".into())),
            _ => {}
        }
    }
    let mut result = ImportResult { item_ids: Vec::new(), skipped: 0, linked: Vec::new(), failed: Vec::new() };
    for path in paths {
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        let item_type = file_type_for(&name);
        let fits = {
            let lib = state.lock();
            match collection_id {
                Some(cid) => check_type_fits(&lib.conn, item_type, cid).is_ok(),
                None => true,
            }
        };
        if !path.is_file() || !fits {
            result.skipped += 1;
            continue;
        }
        let title = path.file_stem().and_then(|s| s.to_str()).unwrap_or(&name).to_string();
        let id = {
            let mut lib = state.lock();
            let tx = lib.conn.transaction()?;
            let now = now_ms();
            tx.execute(
                "INSERT INTO items (item_type, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
                params![item_type, title, now],
            )?;
            let id = tx.last_insert_rowid();
            if let Some(cid) = collection_id {
                tx.execute(
                    "INSERT INTO item_collections (item_id, collection_id) VALUES (?1, ?2)",
                    params![id, cid],
                )?;
            }
            tx.commit()?;
            id
        };
        let added = match attach_files(state, id, std::slice::from_ref(path)) {
            Ok(a) => a,
            Err(e) => {
                // Don't leave an item without its file behind; go on with the other files, so
                // the ones already added are still reported.
                let lib = state.lock();
                let _ = delete_item_in(&lib, id);
                result.failed.push(format!("{name}：{}", e.0));
                continue;
            }
        };
        result.linked.extend(added.into_iter().filter(|a| a.linked).map(|a| a.file_name));
        result.item_ids.push(id);
    }
    Ok(result)
}

/// Files dropped onto the file library (see `import_into_file_library`).
#[tauri::command]
pub fn import_files(
    state: State<'_, DrawerState>,
    collection_id: Option<i64>,
    paths: Vec<String>,
) -> Result<ImportResult> {
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    import_into_file_library(&state, collection_id, &paths)
}

/// Opens the system file picker and adds the chosen files to the file library.
#[tauri::command]
pub async fn pick_import_files(
    app: AppHandle,
    state: State<'_, DrawerState>,
    collection_id: Option<i64>,
) -> Result<ImportResult> {
    let Some(picked) = app.dialog().file().set_title("加入檔案").blocking_pick_files() else {
        return Ok(ImportResult { item_ids: Vec::new(), skipped: 0, linked: Vec::new(), failed: Vec::new() });
    };
    let paths: Vec<PathBuf> = picked.into_iter().filter_map(|f| f.into_path().ok()).collect();
    import_into_file_library(&state, collection_id, &paths)
}

// ---------- 文獻庫 attachments in 檔案庫 ----------

/// Gives a 文獻庫 attachment a 檔案庫 copy: a new file item (typed by the file's extension,
/// titled after it, unfiled, related to the literature item) whose attachment row shares the
/// same file. Nothing happens for 檔案庫 items or attachments that already have a copy.
/// Returns the new file item's id.
pub(crate) fn mirror_attachment(conn: &Connection, attachment_id: i64) -> rusqlite::Result<Option<i64>> {
    let row: Option<(i64, String, String, String, i64, i64, bool)> = conn
        .query_row(
            "SELECT a.item_id, i.item_type, a.file_name, a.stored_path, a.size, a.created_at, a.linked
             FROM attachments a JOIN items i ON i.id = a.item_id
             WHERE a.id = ?1 AND a.mirror_of IS NULL
               AND NOT EXISTS (SELECT 1 FROM attachments m WHERE m.mirror_of = a.id)",
            [attachment_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
        )
        .optional()?;
    let Some((source_item, source_type, file_name, stored_path, size, created_at, linked)) = row else {
        return Ok(None);
    };
    if is_file_type(&source_type) {
        return Ok(None);
    }
    let title = Path::new(&file_name).file_stem().and_then(|s| s.to_str()).unwrap_or(&file_name).to_string();
    let now = now_ms();
    conn.execute(
        "INSERT INTO items (item_type, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![file_type_for(&file_name), title, created_at, now],
    )?;
    let file_item = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO attachments (item_id, file_name, stored_path, size, created_at, linked, mirror_of)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![file_item, file_name, stored_path, size, created_at, linked, attachment_id],
    )?;
    // Related both ways (without touching the literature item, so its place in the list stays).
    conn.execute(
        "INSERT OR IGNORE INTO item_relations (item_a, item_b, created_at) VALUES (?1, ?2, ?3)",
        params![source_item.min(file_item), source_item.max(file_item), now],
    )?;
    Ok(Some(file_item))
}

/// Gives every 文獻庫 attachment without one a 檔案庫 copy (database upgrade to v16).
pub fn mirror_all_literature_attachments(conn: &Connection) -> rusqlite::Result<usize> {
    let ids: Vec<i64> = conn
        .prepare(
            "SELECT a.id FROM attachments a JOIN items i ON i.id = a.item_id
             WHERE substr(i.item_type, 1, 4) <> 'file' AND a.mirror_of IS NULL
             ORDER BY a.created_at, a.id",
        )?
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let mut n = 0;
    for id in ids {
        n += mirror_attachment(conn, id)?.is_some() as usize;
    }
    Ok(n)
}

/// A file moved (or copied, when it couldn't be moved) while handing it over to 檔案庫.
struct FileMove {
    from: PathBuf,
    to: PathBuf,
    renamed: bool,
}

/// Puts files handed over by `hand_over_shared_files` back where they were (best effort).
fn undo_moves(moved: Vec<FileMove>) {
    for m in moved.into_iter().rev() {
        if m.renamed {
            if fs::rename(&m.to, &m.from).is_err() && fs::copy(&m.to, &m.from).is_ok() {
                let _ = fs::remove_file(&m.to);
            }
        } else {
            let _ = fs::remove_file(&m.to);
        }
    }
}

/// Before a 文獻庫 item is deleted: its files that also show up in 檔案庫 stay there. Each copied
/// file moves into the file item's own storage folder and stops being a shared copy. Every file
/// moved is recorded in `moved`, so the caller can put them back if the deletion fails.
fn hand_over_shared_files(lib: &crate::library::Library, item_id: i64, moved: &mut Vec<FileMove>) -> Result<()> {
    let conn = &lib.conn;
    let copies: Vec<(i64, i64, String, String, bool, i64)> = conn
        .prepare(
            "SELECT m.id, m.item_id, m.file_name, m.stored_path, m.linked, s.id
             FROM attachments m JOIN attachments s ON s.id = m.mirror_of
             WHERE s.item_id = ?1",
        )?
        .query_map([item_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?
        .collect::<rusqlite::Result<_>>()?;
    for (copy_id, copy_item, file_name, stored, linked, source_id) in copies {
        // The copy becomes the file's only attachment, so the file's annotations move to it, and
        // cards made from them cite the copy too (so they aren't deleted with the item's own notes).
        conn.execute("UPDATE annotations SET attachment_id = ?1 WHERE attachment_id = ?2", params![copy_id, source_id])?;
        conn.execute(
            "INSERT OR IGNORE INTO card_items (card_id, item_id, created_at)
             SELECT card_id, ?1, ?2 FROM annotations WHERE attachment_id = ?3 AND card_id IS NOT NULL",
            params![copy_item, now_ms(), copy_id],
        )?;
        if linked {
            // The file isn't in the library; the copy just keeps pointing at it.
            conn.execute("UPDATE attachments SET mirror_of = NULL WHERE id = ?1", [copy_id])?;
            continue;
        }
        let dir = lib.storage_dir().join(copy_item.to_string());
        fs::create_dir_all(&dir)?;
        let target = unique_target(&dir, &file_name);
        let from = lib.storage_dir().join(&stored);
        let renamed = fs::rename(&from, &target).is_ok();
        if !renamed {
            fs::copy(&from, &target)?;
        }
        moved.push(FileMove { from, to: target.clone(), renamed });
        let name = target.file_name().unwrap().to_string_lossy().to_string();
        conn.execute(
            "UPDATE attachments SET file_name = ?1, stored_path = ?2, mirror_of = NULL WHERE id = ?3",
            params![name, format!("{copy_item}/{name}"), copy_id],
        )?;
    }
    Ok(())
}

fn attachment_path(state: &DrawerState, id: i64) -> Result<PathBuf> {
    let lib = state.lock();
    let conn = &lib.conn;
    let row: Option<(String, bool)> = conn
        .query_row(
            "SELECT stored_path, linked FROM attachments WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let (stored, linked) = row.ok_or_else(|| Error("找不到這個附件".into()))?;
    if linked {
        let path = PathBuf::from(stored);
        if !path.exists() {
            return Err(Error(format!(
                "連結的檔案不在原來的位置了：{}（可能已被移動、刪除，或所在磁碟未連接）",
                path.display()
            )));
        }
        return Ok(path);
    }
    let path = lib.storage_dir().join(stored);
    if !path.exists() {
        return Err(Error(format!("附件檔案不見了：{}", path.display())));
    }
    Ok(path)
}

/// The attachment's file on disk (for the `attachment:` protocol the reader streams from).
pub fn attachment_file(state: &DrawerState, id: i64) -> Result<PathBuf> {
    attachment_path(state, id)
}

#[tauri::command]
pub fn open_attachment(app: AppHandle, state: State<'_, DrawerState>, id: i64) -> Result<()> {
    let path = attachment_path(&state, id)?;
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| Error(format!("無法開啟附件：{e}")))
}

#[tauri::command]
pub fn reveal_attachment(app: AppHandle, state: State<'_, DrawerState>, id: i64) -> Result<()> {
    let path = attachment_path(&state, id)?;
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|e| Error(format!("無法顯示附件位置：{e}")))
}

/// Deletes an attachment. A 檔案庫 item is a file, so one left without any file goes too.
/// Returns true when the attachment's own item was deleted with it.
#[tauri::command]
pub fn delete_attachment(state: State<'_, DrawerState>, id: i64) -> Result<bool> {
    let lib = state.lock();
    let conn = &lib.conn;
    let row: Option<(i64, String, bool, Option<i64>, String)> = conn
        .query_row(
            "SELECT a.item_id, a.stored_path, a.linked, a.mirror_of, i.item_type
             FROM attachments a JOIN items i ON i.id = a.item_id WHERE a.id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()?;
    let Some((item_id, stored, linked, mirror_of, item_type)) = row else {
        return Ok(false);
    };
    /// Deletes the file item when it has no attachment left; otherwise marks it as changed.
    fn drop_if_empty(lib: &Library, item: i64) -> Result<bool> {
        let empty: bool = lib.conn.query_row(
            "SELECT NOT EXISTS (SELECT 1 FROM attachments WHERE item_id = ?1)",
            [item],
            |r| r.get(0),
        )?;
        if empty {
            delete_item_in(lib, item)?;
        } else {
            touch_item(&lib.conn, item)?;
        }
        Ok(empty)
    }
    let item_removed = in_savepoint(conn, || {
        if mirror_of.is_none() {
            // The file goes away, so its 檔案庫 copies go too, with file items left without any file.
            let copies: Vec<i64> = conn
                .prepare("SELECT item_id FROM attachments WHERE mirror_of = ?1")?
                .query_map([id], |r| r.get(0))?
                .collect::<rusqlite::Result<_>>()?;
            conn.execute("DELETE FROM attachments WHERE mirror_of = ?1", [id])?;
            for copy in copies {
                drop_if_empty(&lib, copy)?;
            }
        }
        // A 檔案庫 copy only drops its row: the file belongs to the 文獻庫 item.
        conn.execute("DELETE FROM attachments WHERE id = ?1", [id])?;
        if is_file_type(&item_type) {
            drop_if_empty(&lib, item_id)
        } else {
            touch_item(conn, item_id)?;
            Ok(false)
        }
    })?;
    // A linked attachment only forgets the path: the user's original file is never deleted.
    if mirror_of.is_none() && !linked {
        match fs::remove_file(lib.storage_dir().join(stored)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.into()),
            _ => {}
        }
    }
    Ok(item_removed)
}


// ---------- bulk editing (several selected items) ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Counted<T> {
    value: T,
    /// How many of the selected items have it.
    count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkInfo {
    count: usize,
    item_types: Vec<Counted<String>>,
    tags: Vec<Counted<String>>,
    collection_ids: Vec<Counted<i64>>,
}

/// `?,?,?` for an IN (...) list of `n` values.
fn placeholders(n: usize) -> String {
    vec!["?"; n].join(",")
}

/// What the selected items have in common (for the bulk-edit panel).
#[tauri::command]
pub fn bulk_info(state: State<'_, DrawerState>, item_ids: Vec<i64>) -> Result<BulkInfo> {
    let lib = state.lock();
    let conn = &lib.conn;
    let ids = placeholders(item_ids.len().max(1));
    let args = rusqlite::params_from_iter(item_ids.iter());
    let item_types = conn
        .prepare(&format!(
            "SELECT item_type, COUNT(*) FROM items WHERE id IN ({ids}) GROUP BY item_type ORDER BY COUNT(*) DESC"
        ))?
        .query_map(args, |r| Ok(Counted { value: r.get(0)?, count: r.get(1)? }))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let tags = conn
        .prepare(&format!(
            "SELECT t.name, COUNT(*) FROM item_tags it JOIN tags t ON t.id = it.tag_id
             WHERE it.item_id IN ({ids}) GROUP BY t.id ORDER BY t.name COLLATE NOCASE"
        ))?
        .query_map(rusqlite::params_from_iter(item_ids.iter()), |r| Ok(Counted { value: r.get(0)?, count: r.get(1)? }))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let collection_ids = conn
        .prepare(&format!(
            "SELECT collection_id, COUNT(*) FROM item_collections WHERE item_id IN ({ids}) GROUP BY collection_id"
        ))?
        .query_map(rusqlite::params_from_iter(item_ids.iter()), |r| Ok(Counted { value: r.get(0)?, count: r.get(1)? }))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(BulkInfo { count: item_ids.len(), item_types, tags, collection_ids })
}

/// Adds a tag (by name, created if needed) to every item. Returns how many items newly got it.
#[tauri::command]
pub fn bulk_add_tag(state: State<'_, DrawerState>, item_ids: Vec<i64>, name: String) -> Result<usize> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(Error("標籤名稱不能是空的".into()));
    }
    let mut lib = state.lock();
    let tx = lib.conn.transaction()?;
    tx.execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", [&name])?;
    let mut added = 0;
    for &id in &item_ids {
        let n = tx.execute(
            "INSERT OR IGNORE INTO item_tags (item_id, tag_id)
             SELECT i.id, t.id FROM items i, tags t WHERE i.id = ?1 AND t.name = ?2",
            params![id, name],
        )?;
        if n > 0 {
            touch_item(&tx, id)?;
        }
        added += n;
    }
    delete_orphan_tags(&tx)?; // in case none of the ids existed
    tx.commit()?;
    Ok(added)
}

/// Removes a tag (by name) from every item.
#[tauri::command]
pub fn bulk_remove_tag(state: State<'_, DrawerState>, item_ids: Vec<i64>, name: String) -> Result<()> {
    let mut lib = state.lock();
    let tx = lib.conn.transaction()?;
    for &id in &item_ids {
        let n = tx.execute(
            "DELETE FROM item_tags WHERE item_id = ?1 AND tag_id IN (SELECT id FROM tags WHERE name = ?2)",
            params![id, name],
        )?;
        if n > 0 {
            touch_item(&tx, id)?;
        }
    }
    delete_orphan_tags(&tx)?;
    tx.commit()?;
    Ok(())
}

#[tauri::command]
pub fn remove_items_from_collection(
    state: State<'_, DrawerState>,
    item_ids: Vec<i64>,
    collection_id: i64,
) -> Result<()> {
    let mut lib = state.lock();
    let tx = lib.conn.transaction()?;
    for &id in &item_ids {
        let n = tx.execute(
            "DELETE FROM item_collections WHERE item_id = ?1 AND collection_id = ?2",
            params![id, collection_id],
        )?;
        if n > 0 {
            touch_item(&tx, id)?;
        }
    }
    tx.commit()?;
    Ok(())
}

#[tauri::command]
pub fn bulk_set_type(state: State<'_, DrawerState>, item_ids: Vec<i64>, item_type: String) -> Result<()> {
    let mut lib = state.lock();
    for &id in &item_ids {
        check_type_change(&lib.conn, id, &item_type)?;
    }
    let tx = lib.conn.transaction()?;
    for &id in &item_ids {
        tx.execute("UPDATE items SET item_type = ?1 WHERE id = ?2", params![item_type, id])?;
        refresh_creator_summary(&tx, id)?;
        touch_item(&tx, id)?;
    }
    tx.commit()?;
    Ok(())
}

/// Sets one metadata field (a column name such as "date" or "publisher") on every item.
/// An empty value clears the field. The type and title can't be set this way.
#[tauri::command]
pub fn bulk_set_field(
    state: State<'_, DrawerState>,
    item_ids: Vec<i64>,
    field: String,
    value: String,
) -> Result<()> {
    if !ItemFields::COLUMNS.contains(&field.as_str()) || field == "item_type" || field == "title" {
        return Err(Error(format!("不能大量修改這個欄位：{field}")));
    }
    let mut lib = state.lock();
    let tx = lib.conn.transaction()?;
    // `field` is checked against the column list above, so it is safe to splice in.
    let sql = format!("UPDATE items SET {field} = ?1, updated_at = ?2 WHERE id = ?3");
    for &id in &item_ids {
        tx.execute(&sql, params![value.trim(), now_ms(), id])?;
    }
    tx.commit()?;
    Ok(())
}

/// Appends a person (e.g. the same translator) to every item. Items that already list the
/// same name in the same role are skipped. Returns how many items got the person.
#[tauri::command]
pub fn bulk_add_creator(state: State<'_, DrawerState>, item_ids: Vec<i64>, creator: Creator) -> Result<usize> {
    let name = creator.name.trim().to_string();
    if name.is_empty() {
        return Err(Error("姓名不能是空的".into()));
    }
    let role = if creator.role.trim().is_empty() { "author".to_string() } else { creator.role.trim().to_string() };
    let mut lib = state.lock();
    let tx = lib.conn.transaction()?;
    let mut added = 0;
    for &id in &item_ids {
        let exists: bool = tx.query_row(
            "SELECT EXISTS (SELECT 1 FROM items WHERE id = ?1)
                AND NOT EXISTS (SELECT 1 FROM item_creators WHERE item_id = ?1 AND role = ?2 AND name = ?3)",
            params![id, role, name],
            |r| r.get(0),
        )?;
        if !exists {
            continue;
        }
        tx.execute(
            "INSERT INTO item_creators (item_id, position, role, name)
             VALUES (?1, (SELECT COALESCE(MAX(position) + 1, 0) FROM item_creators WHERE item_id = ?1), ?2, ?3)",
            params![id, role, name],
        )?;
        refresh_creator_summary(&tx, id)?;
        touch_item(&tx, id)?;
        added += 1;
    }
    tx.commit()?;
    Ok(added)
}

/// Deletes several items (same rules as deleting one: attachments and lone note cards go too).
#[tauri::command]
pub fn delete_items(state: State<'_, DrawerState>, item_ids: Vec<i64>) -> Result<()> {
    let lib = state.lock();
    for id in item_ids {
        delete_item_in(&lib, id)?;
    }
    Ok(())
}
