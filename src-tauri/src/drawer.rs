//! Drawer: a Zotero-style reference library — collections, items, tags and file attachments.

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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemSummary {
    id: i64,
    item_type: String,
    title: String,
    authors: String,
    date: String,
    attachment_count: i64,
    updated_at: i64,
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
}

impl Attachment {
    /// Expects columns: id, item_id, file_name, size, created_at, linked, stored_path.
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

const ATTACHMENT_COLUMNS: &str = "id, item_id, file_name, size, created_at, linked, stored_path";

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
}

// ---------- collections ----------

#[tauri::command]
pub fn list_collections(state: State<'_, DrawerState>) -> Result<Vec<Collection>> {
    let lib = state.lock();
    let conn = &lib.conn;
    let mut stmt =
        conn.prepare("SELECT id, name, parent_id FROM collections ORDER BY name COLLATE NOCASE")?;
    let rows = stmt.query_map([], |r| {
        Ok(Collection {
            id: r.get(0)?,
            name: r.get(1)?,
            parent_id: r.get(2)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

#[tauri::command]
pub fn create_collection(
    state: State<'_, DrawerState>,
    name: String,
    parent_id: Option<i64>,
) -> Result<Collection> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(Error("資料夾名稱不能是空的".into()));
    }
    let lib = state.lock();
    let conn = &lib.conn;
    conn.execute(
        "INSERT INTO collections (name, parent_id, created_at) VALUES (?1, ?2, ?3)",
        params![name, parent_id, now_ms()],
    )?;
    Ok(Collection {
        id: conn.last_insert_rowid(),
        name,
        parent_id,
    })
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
    let sql = format!(
        r"SELECT i.id, i.item_type, i.title, i.authors, i.date, i.updated_at,
                 (SELECT COUNT(*) FROM attachments a WHERE a.item_id = i.id)
          FROM items i
          WHERE (?1 IS NULL OR EXISTS (SELECT 1 FROM item_collections ic
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
    let rows = stmt.query_map(params![filter.collection_id, filter.unfiled, pattern, filter.tag_id], |r| {
        Ok(ItemSummary {
            id: r.get(0)?,
            item_type: r.get(1)?,
            title: r.get(2)?,
            authors: r.get(3)?,
            date: r.get(4)?,
            updated_at: r.get(5)?,
            attachment_count: r.get(6)?,
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

fn delete_item_in(lib: &crate::library::Library, id: i64) -> Result<()> {
    let conn = &lib.conn;
    // Note cards that belong only to this item (no board, no other item) go with it,
    // as the old free-text notes did. Cards on a board or shared with other items stay.
    conn.execute(
        "DELETE FROM cards WHERE id IN (SELECT card_id FROM card_items WHERE item_id = ?1)
           AND NOT EXISTS (SELECT 1 FROM board_cards bc WHERE bc.card_id = cards.id)
           AND NOT EXISTS (SELECT 1 FROM card_items o WHERE o.card_id = cards.id AND o.item_id <> ?1)",
        [id],
    )?;
    conn.execute("DELETE FROM items WHERE id = ?1", [id])?;
    delete_orphan_tags(&conn)?;
    remove_dir_if_exists(&lib.storage_dir().join(id.to_string()))?;
    Ok(())
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
pub fn list_tags(state: State<'_, DrawerState>) -> Result<Vec<TagInfo>> {
    let lib = state.lock();
    let rows = lib
        .conn
        .prepare(
            "SELECT t.id, t.name, COUNT(it.item_id) FROM tags t
             LEFT JOIN item_tags it ON it.tag_id = t.id
             GROUP BY t.id ORDER BY t.name COLLATE NOCASE",
        )?
        .query_map([], |r| Ok(TagInfo { id: r.get(0)?, name: r.get(1)?, count: r.get(2)? }))?
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
fn unique_target(dir: &Path, file_name: &str) -> PathBuf {
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
fn import_files(state: &DrawerState, item_id: i64, paths: &[PathBuf]) -> Result<Vec<Attachment>> {
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
        added.push(Attachment {
            id: conn.last_insert_rowid(),
            item_id,
            file_name: stored_name,
            size,
            created_at: now,
            linked,
            linked_path: linked.then_some(stored_path),
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
    import_files(&state, item_id, &paths)
}

/// Attaches files given by path (used for drag-and-drop).
#[tauri::command]
pub fn add_attachments(
    state: State<'_, DrawerState>,
    item_id: i64,
    paths: Vec<String>,
) -> Result<Vec<Attachment>> {
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    import_files(&state, item_id, &paths)
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

#[tauri::command]
pub fn delete_attachment(state: State<'_, DrawerState>, id: i64) -> Result<()> {
    let lib = state.lock();
    let conn = &lib.conn;
    let row: Option<(i64, String, bool)> = conn
        .query_row(
            "SELECT item_id, stored_path, linked FROM attachments WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let Some((item_id, stored, linked)) = row else {
        return Ok(());
    };
    conn.execute("DELETE FROM attachments WHERE id = ?1", [id])?;
    // A linked attachment only forgets the path: the user's original file is never deleted.
    if !linked {
        match fs::remove_file(lib.storage_dir().join(stored)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.into()),
            _ => {}
        }
    }
    touch_item(&conn, item_id)?;
    Ok(())
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
