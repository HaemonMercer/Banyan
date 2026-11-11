//! Version Machine: the version history of cards.
//!
//! Every save of a card is recorded. Edits made within [`MERGE_WINDOW_MS`] of the latest
//! automatic version are folded into it, so one editing session leaves one version instead of
//! one per keystroke-burst. Named versions are made by the user, are never folded into and are
//! never pruned. The latest version always equals the card as saved, so restoring an older
//! version can itself be undone from the history.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::State;

use crate::drawer::{now_ms, DrawerState, Error, Result};
use crate::whiteboard::{load_card_detail, CardDetail};

/// Edits closer than this to the latest automatic version update it instead of adding one.
pub const MERGE_WINDOW_MS: i64 = 10 * 60 * 1000;
/// Automatic versions kept per card; the oldest beyond this are dropped.
pub const MAX_AUTO_VERSIONS: i64 = 100;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardVersion {
    id: i64,
    card_id: i64,
    title: String,
    content: String,
    /// The type's JSON (e.g. a mind map's tree); "" for notes.
    data: String,
    /// "" for an automatic version.
    name: String,
    created_at: i64,
    /// Last time edits were folded into this version.
    updated_at: i64,
}

const VERSION_COLUMNS: &str = "id, card_id, title, content, name, created_at, updated_at, data";

fn version_row(r: &rusqlite::Row) -> rusqlite::Result<CardVersion> {
    Ok(CardVersion {
        id: r.get(0)?,
        card_id: r.get(1)?,
        title: r.get(2)?,
        content: r.get(3)?,
        name: r.get(4)?,
        created_at: r.get(5)?,
        updated_at: r.get(6)?,
        data: r.get(7)?,
    })
}

fn load_version(conn: &Connection, id: i64) -> Result<CardVersion> {
    conn.query_row(&format!("SELECT {VERSION_COLUMNS} FROM card_versions WHERE id = ?1"), [id], version_row)
        .optional()?
        .ok_or_else(|| Error("找不到這個版本".into()))
}

fn latest_version(conn: &Connection, card_id: i64) -> rusqlite::Result<Option<CardVersion>> {
    conn.query_row(
        &format!("SELECT {VERSION_COLUMNS} FROM card_versions WHERE card_id = ?1 ORDER BY id DESC LIMIT 1"),
        [card_id],
        version_row,
    )
    .optional()
}

/// A card's saved title, content, data and last change.
struct CardState {
    title: String,
    content: String,
    data: String,
    updated_at: i64,
}

fn card_state(conn: &Connection, card_id: i64) -> Result<CardState> {
    conn.query_row("SELECT title, content, data, updated_at FROM cards WHERE id = ?1", [card_id], |r| {
        Ok(CardState { title: r.get(0)?, content: r.get(1)?, data: r.get(2)?, updated_at: r.get(3)? })
    })
    .optional()?
    .ok_or_else(|| Error("找不到這張卡片".into()))
}

/// Cards written before history existed (or never edited since) have no versions yet: record
/// their current state first, dated when it was saved, so the first edit can be undone.
pub(crate) fn ensure_baseline(conn: &Connection, card_id: i64) -> Result<()> {
    let has: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM card_versions WHERE card_id = ?1)", [card_id], |r| {
        r.get(0)
    })?;
    if has {
        return Ok(());
    }
    let c = card_state(conn, card_id)?;
    if c.title.is_empty() && c.content.trim().is_empty() && c.data.is_empty() {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO card_versions (card_id, title, content, data, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![card_id, c.title, c.content, c.data, c.updated_at],
    )?;
    Ok(())
}

/// Records the card's newly saved state at time `now`. With `force_new` the state always gets
/// a version of its own (used for restores) instead of being folded into a recent one.
pub(crate) fn record_version(
    conn: &Connection,
    card_id: i64,
    title: &str,
    content: &str,
    data: &str,
    now: i64,
    force_new: bool,
) -> Result<()> {
    match latest_version(conn, card_id)? {
        Some(v) if v.title == title && v.content == content && v.data == data => return Ok(()),
        Some(v) if !force_new && v.name.is_empty() && now - v.created_at < MERGE_WINDOW_MS => {
            conn.execute(
                "UPDATE card_versions SET title = ?1, content = ?2, data = ?3, updated_at = ?4 WHERE id = ?5",
                params![title, content, data, now, v.id],
            )?;
            return Ok(());
        }
        None if title.is_empty() && content.trim().is_empty() && data.is_empty() => return Ok(()),
        _ => {}
    }
    conn.execute(
        "INSERT INTO card_versions (card_id, title, content, data, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![card_id, title, content, data, now],
    )?;
    conn.execute(
        "DELETE FROM card_versions WHERE id IN (
             SELECT id FROM card_versions WHERE card_id = ?1 AND name = ''
             ORDER BY id DESC LIMIT -1 OFFSET ?2
         )",
        params![card_id, MAX_AUTO_VERSIONS],
    )?;
    Ok(())
}

fn clean_version_name(name: &str) -> Result<String> {
    let n = name.trim();
    if n.chars().count() > 100 {
        return Err(Error("版本名稱太長（最多 100 字）".into()));
    }
    Ok(n.to_string())
}

/// All versions of a card, newest first.
#[tauri::command]
pub fn list_card_versions(state: State<'_, DrawerState>, card_id: i64) -> Result<Vec<CardVersion>> {
    let lib = state.lock();
    card_state(&lib.conn, card_id)?;
    let list = lib
        .conn
        .prepare(&format!("SELECT {VERSION_COLUMNS} FROM card_versions WHERE card_id = ?1 ORDER BY id DESC"))?
        .query_map([card_id], version_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(list)
}

/// Saves the card as it is now under a name. If the latest automatic version already holds
/// exactly this state, it is named instead of adding a copy.
#[tauri::command]
pub fn create_card_version(state: State<'_, DrawerState>, card_id: i64, name: String) -> Result<CardVersion> {
    let name = clean_version_name(&name)?;
    if name.is_empty() {
        return Err(Error("請輸入版本名稱".into()));
    }
    let lib = state.lock();
    let tx = lib.conn.unchecked_transaction()?;
    let c = card_state(&tx, card_id)?;
    let id = match latest_version(&tx, card_id)? {
        Some(v) if v.name.is_empty() && v.title == c.title && v.content == c.content && v.data == c.data => {
            tx.execute("UPDATE card_versions SET name = ?1 WHERE id = ?2", params![name, v.id])?;
            v.id
        }
        _ => {
            tx.execute(
                "INSERT INTO card_versions (card_id, title, content, data, name, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                params![card_id, c.title, c.content, c.data, name, now_ms()],
            )?;
            tx.last_insert_rowid()
        }
    };
    let v = load_version(&tx, id)?;
    tx.commit()?;
    Ok(v)
}

/// Renames a version; an empty name turns it back into an automatic version.
#[tauri::command]
pub fn rename_card_version(state: State<'_, DrawerState>, id: i64, name: String) -> Result<CardVersion> {
    let name = clean_version_name(&name)?;
    let lib = state.lock();
    let n = lib.conn.execute("UPDATE card_versions SET name = ?1 WHERE id = ?2", params![name, id])?;
    if n == 0 {
        return Err(Error("找不到這個版本".into()));
    }
    load_version(&lib.conn, id)
}

/// Deletes one version. The latest version is the card's current state and cannot be deleted.
#[tauri::command]
pub fn delete_card_version(state: State<'_, DrawerState>, id: i64) -> Result<()> {
    let lib = state.lock();
    let v = load_version(&lib.conn, id)?;
    if latest_version(&lib.conn, v.card_id)?.is_some_and(|l| l.id == id) {
        return Err(Error("最新的版本就是目前的內容，不能刪除".into()));
    }
    lib.conn.execute("DELETE FROM card_versions WHERE id = ?1", [id])?;
    Ok(())
}

/// Puts the card back to a version's title and content. The restore becomes a new version, so
/// the state before it stays in the history.
#[tauri::command]
pub fn restore_card_version(state: State<'_, DrawerState>, id: i64) -> Result<CardDetail> {
    let lib = state.lock();
    let tx = lib.conn.unchecked_transaction()?;
    let v = load_version(&tx, id)?;
    ensure_baseline(&tx, v.card_id)?;
    let c = card_state(&tx, v.card_id)?;
    let now = now_ms();
    record_version(&tx, v.card_id, &c.title, &c.content, &c.data, now, false)?;
    tx.execute(
        "UPDATE cards SET title = ?1, content = ?2, data = ?3, updated_at = ?4 WHERE id = ?5",
        params![v.title, v.content, v.data, now, v.card_id],
    )?;
    record_version(&tx, v.card_id, &v.title, &v.content, &v.data, now, true)?;
    let card = load_card_detail(&tx, v.card_id)?;
    tx.commit()?;
    Ok(card)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!("banyan-history-{stamp}.db"));
        let c = crate::db::open(&path).unwrap();
        c.execute("INSERT INTO cards (title, content, created_at, updated_at) VALUES ('舊', '舊內容', 5, 5)", [])
            .unwrap();
        c
    }

    fn versions(c: &Connection) -> Vec<(String, String, i64)> {
        c.prepare("SELECT content, name, created_at FROM card_versions WHERE card_id = 1 ORDER BY id")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    }

    #[test]
    fn edits_fold_into_recent_versions() {
        let c = conn();
        ensure_baseline(&c, 1).unwrap();
        ensure_baseline(&c, 1).unwrap();
        assert_eq!(versions(&c), vec![("舊內容".into(), String::new(), 5)]);

        // The baseline is long ago: the first edit gets its own version.
        let t = 1_000_000_000;
        record_version(&c, 1, "新", "一", "", t, false).unwrap();
        // Within the window: folded in.
        record_version(&c, 1, "新", "一二", "", t + 60_000, false).unwrap();
        // Unchanged: nothing.
        record_version(&c, 1, "新", "一二", "", t + 120_000, false).unwrap();
        assert_eq!(versions(&c).len(), 2);
        assert_eq!(versions(&c)[1].0, "一二");
        // Past the window: a new version.
        record_version(&c, 1, "新", "一二三", "", t + MERGE_WINDOW_MS, false).unwrap();
        // Forced (a restore): a new version even inside the window.
        record_version(&c, 1, "新", "舊內容", "", t + MERGE_WINDOW_MS + 1, true).unwrap();
        let v = versions(&c);
        assert_eq!(v.iter().map(|x| x.0.as_str()).collect::<Vec<_>>(), ["舊內容", "一二", "一二三", "舊內容"]);

        // A named latest version is never folded into.
        c.execute("UPDATE card_versions SET name = '定稿' WHERE id = (SELECT MAX(id) FROM card_versions)", [])
            .unwrap();
        record_version(&c, 1, "新", "改", "", t + MERGE_WINDOW_MS + 2, false).unwrap();
        assert_eq!(versions(&c).len(), 5);
        assert_eq!(versions(&c)[3].1, "定稿");
    }

    #[test]
    fn old_automatic_versions_are_pruned() {
        let c = conn();
        c.execute(
            "INSERT INTO card_versions (card_id, title, content, name, created_at, updated_at) VALUES (1, '', 'keep', '名', 1, 1)",
            [],
        )
        .unwrap();
        for i in 0..(MAX_AUTO_VERSIONS + 5) {
            record_version(&c, 1, "", &format!("v{i}"), "", 10 + i * MERGE_WINDOW_MS, false).unwrap();
        }
        let v = versions(&c);
        assert_eq!(v.len() as i64, MAX_AUTO_VERSIONS + 1);
        assert_eq!(v[0].0, "keep");
        assert_eq!(v[1].0, "v5");
        assert_eq!(v.last().unwrap().0, format!("v{}", MAX_AUTO_VERSIONS + 4));
    }
}
