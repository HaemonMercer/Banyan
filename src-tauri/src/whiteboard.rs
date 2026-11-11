//! Whiteboard: boards of cards, and two-way links between cards.
//!
//! A link is stored once (smaller card id first) and shows up on both cards. It may point one
//! way or both (`direction`) and carry a short note. Boards can be sorted into nested folders.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::drawer::{like_pattern, now_ms, DrawerState, Error, Result};
use crate::history;

pub const DEFAULT_CARD_WIDTH: f64 = 240.0;
pub const DEFAULT_CARD_HEIGHT: f64 = 160.0;
const MIN_CARD_WIDTH: f64 = 120.0;
const MIN_CARD_HEIGHT: f64 = 60.0;

/// What a card is on the board. `note` is a Markdown card; the others keep their own JSON in
/// `data` (see `src/whiteboard/objects.ts`).
pub const CARD_KINDS: &[&str] = &["note", "sticky", "image", "video", "pdf", "mindmap", "table", "chart"];

fn check_kind(kind: &str) -> Result<()> {
    if CARD_KINDS.contains(&kind) {
        Ok(())
    } else {
        Err(Error(format!("不支援的物件類型：{kind}")))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Whiteboard {
    id: i64,
    name: String,
    folder_id: Option<i64>,
    card_count: i64,
    updated_at: i64,
}

/// A card as placed on one board.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardCard {
    id: i64,
    /// "note", "sticky", "image", "video", "pdf" or "mindmap".
    kind: String,
    title: String,
    content: String,
    /// The kind's JSON ("" for notes).
    data: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    updated_at: i64,
    /// Drawer items this card refers to.
    items: Vec<ItemRef>,
    tags: Vec<String>,
}

/// A Drawer item referenced by a card.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ItemRef {
    item_id: i64,
    item_type: String,
    title: String,
    authors: String,
    date: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardLink {
    id: i64,
    card_a: i64,
    card_b: i64,
    /// 0 no arrow, 1 card_a → card_b, 2 card_b → card_a, 3 both ways.
    direction: i64,
    /// Short label shown on the line.
    note: String,
}

const LINK_COLUMNS: &str = "id, card_a, card_b, direction, note";

fn link_row(r: &rusqlite::Row) -> rusqlite::Result<CardLink> {
    Ok(CardLink { id: r.get(0)?, card_a: r.get(1)?, card_b: r.get(2)?, direction: r.get(3)?, note: r.get(4)? })
}

/// Direction value for a new link drawn from `from` to `to`.
fn pointing(from: i64, to: i64) -> i64 {
    if from < to { 1 } else { 2 }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardContents {
    board: Whiteboard,
    cards: Vec<BoardCard>,
    /// Links whose two cards are both on this board.
    links: Vec<CardLink>,
    sections: Vec<Section>,
}

/// The other end of a link, seen from one card.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedCard {
    link_id: i64,
    card_id: i64,
    title: String,
    /// Seen from the card asked about: "out" (it points to this one), "in", "both" or "none".
    direction: &'static str,
    note: String,
    /// A board the linked card is on (for jumping to it), if any.
    board_id: Option<i64>,
    /// Boards the linked card is on, by name.
    boards: Vec<String>,
}

fn clean_name(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error("白板名稱不能是空的".into()));
    }
    Ok(name.to_string())
}

fn load_board(conn: &Connection, id: i64) -> Result<Whiteboard> {
    conn.query_row(
        "SELECT w.id, w.name, w.updated_at,
                (SELECT COUNT(*) FROM board_cards bc WHERE bc.board_id = w.id), w.folder_id
         FROM whiteboards w WHERE w.id = ?1",
        [id],
        board_row,
    )
    .optional()?
    .ok_or_else(|| Error("找不到這個白板".into()))
}

fn board_row(r: &rusqlite::Row) -> rusqlite::Result<Whiteboard> {
    Ok(Whiteboard {
        id: r.get(0)?,
        name: r.get(1)?,
        updated_at: r.get(2)?,
        card_count: r.get(3)?,
        folder_id: r.get(4)?,
    })
}

fn touch_board(conn: &Connection, board_id: i64) -> Result<()> {
    conn.execute("UPDATE whiteboards SET updated_at = ?1 WHERE id = ?2", params![now_ms(), board_id])?;
    Ok(())
}

fn card_exists(conn: &Connection, id: i64) -> Result<bool> {
    Ok(conn.query_row("SELECT 1 FROM cards WHERE id = ?1", [id], |_| Ok(())).optional()?.is_some())
}

// ---------- boards ----------

#[tauri::command]
pub fn list_whiteboards(state: State<'_, DrawerState>) -> Result<Vec<Whiteboard>> {
    let lib = state.lock();
    let mut stmt = lib.conn.prepare(
        "SELECT w.id, w.name, w.updated_at,
                (SELECT COUNT(*) FROM board_cards bc WHERE bc.board_id = w.id), w.folder_id
         FROM whiteboards w ORDER BY w.name COLLATE NOCASE, w.id",
    )?;
    let rows = stmt.query_map([], board_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

#[tauri::command]
pub fn create_whiteboard(state: State<'_, DrawerState>, name: String, folder_id: Option<i64>) -> Result<Whiteboard> {
    let name = clean_name(&name)?;
    let lib = state.lock();
    if let Some(f) = folder_id {
        if !folder_exists(&lib.conn, f)? {
            return Err(Error("找不到這個資料夾".into()));
        }
    }
    let now = now_ms();
    lib.conn.execute(
        "INSERT INTO whiteboards (name, folder_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
        params![name, folder_id, now],
    )?;
    load_board(&lib.conn, lib.conn.last_insert_rowid())
}

#[tauri::command]
pub fn rename_whiteboard(state: State<'_, DrawerState>, id: i64, name: String) -> Result<()> {
    let name = clean_name(&name)?;
    let lib = state.lock();
    lib.conn.execute(
        "UPDATE whiteboards SET name = ?1, updated_at = ?2 WHERE id = ?3",
        params![name, now_ms(), id],
    )?;
    Ok(())
}

/// Deletes the board, and the cards that are on no other board (with their links).
#[tauri::command]
pub fn delete_whiteboard(state: State<'_, DrawerState>, id: i64) -> Result<()> {
    let mut lib = state.lock();
    let tx = lib.conn.transaction()?;
    let doomed = tx
        .prepare(
            "SELECT card_id FROM board_cards bc WHERE board_id = ?1
               AND NOT EXISTS (SELECT 1 FROM board_cards o WHERE o.card_id = bc.card_id AND o.board_id <> ?1)",
        )?
        .query_map([id], |r| r.get::<_, i64>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for card in &doomed {
        tx.execute("DELETE FROM cards WHERE id = ?1", [card])?;
    }
    tx.execute("DELETE FROM whiteboards WHERE id = ?1", [id])?;
    tx.commit()?;
    for card in doomed {
        crate::card_files::remove_card_files(&lib, card);
    }
    Ok(())
}

#[tauri::command]
pub fn get_whiteboard(state: State<'_, DrawerState>, id: i64) -> Result<BoardContents> {
    let lib = state.lock();
    let conn = &lib.conn;
    let board = load_board(conn, id)?;
    let cards = conn
        .prepare(
            "SELECT c.id, c.title, c.content, bc.x, bc.y, bc.width, bc.height, c.updated_at, c.kind, c.data
             FROM board_cards bc JOIN cards c ON c.id = bc.card_id
             WHERE bc.board_id = ?1 ORDER BY c.id",
        )?
        .query_map([id], |r| {
            Ok(BoardCard {
                id: r.get(0)?,
                kind: r.get(8)?,
                title: r.get(1)?,
                content: r.get(2)?,
                data: r.get(9)?,
                x: r.get(3)?,
                y: r.get(4)?,
                width: r.get(5)?,
                height: r.get(6)?,
                updated_at: r.get(7)?,
                items: Vec::new(),
                tags: Vec::new(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut cards = cards;
    let refs = conn
        .prepare(
            "SELECT ci.card_id, i.id, i.item_type, i.title, i.authors, i.date
             FROM card_items ci
             JOIN board_cards bc ON bc.card_id = ci.card_id AND bc.board_id = ?1
             JOIN items i ON i.id = ci.item_id
             ORDER BY ci.created_at, i.id",
        )?
        .query_map([id], |r| Ok((r.get::<_, i64>(0)?, item_ref(r, 1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (card_id, item) in refs {
        if let Some(c) = cards.iter_mut().find(|c| c.id == card_id) {
            c.items.push(item);
        }
    }
    let links = conn
        .prepare(
            "SELECT l.id, l.card_a, l.card_b, l.direction, l.note FROM card_links l
             WHERE EXISTS (SELECT 1 FROM board_cards a WHERE a.board_id = ?1 AND a.card_id = l.card_a)
               AND EXISTS (SELECT 1 FROM board_cards b WHERE b.board_id = ?1 AND b.card_id = l.card_b)
             ORDER BY l.id",
        )?
        .query_map([id], link_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for c in cards.iter_mut() {
        c.tags = card_tags(conn, c.id)?;
    }
    let sections = conn
        .prepare(&format!("SELECT {SECTION_COLUMNS} FROM board_sections WHERE board_id = ?1 ORDER BY id"))?
        .query_map([id], section_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(BoardContents { board, cards, links, sections })
}

// ---------- cards ----------

/// Creates an empty card on the board, with its top-left corner at (x, y).
#[tauri::command]
pub fn create_card(state: State<'_, DrawerState>, board_id: i64, x: f64, y: f64) -> Result<BoardCard> {
    let mut lib = state.lock();
    load_board(&lib.conn, board_id)?;
    let tx = lib.conn.transaction()?;
    let now = now_ms();
    tx.execute("INSERT INTO cards (created_at, updated_at) VALUES (?1, ?1)", [now])?;
    let id = tx.last_insert_rowid();
    tx.execute(
        "INSERT INTO board_cards (board_id, card_id, x, y, width, height) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![board_id, id, x, y, DEFAULT_CARD_WIDTH, DEFAULT_CARD_HEIGHT],
    )?;
    touch_board(&tx, board_id)?;
    tx.commit()?;
    Ok(BoardCard {
        id,
        kind: "note".into(),
        title: String::new(),
        content: String::new(),
        data: String::new(),
        x,
        y,
        width: DEFAULT_CARD_WIDTH,
        height: DEFAULT_CARD_HEIGHT,
        updated_at: now,
        items: Vec::new(),
        tags: Vec::new(),
    })
}

/// Creates a board object of any kind (sticky note, image, video, PDF, mind map…) at the given
/// rectangle. Files of images and PDFs are added afterwards with `import_card_file`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn create_board_object(
    state: State<'_, DrawerState>,
    board_id: i64,
    kind: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    title: String,
    content: String,
    data: String,
) -> Result<BoardCard> {
    check_kind(&kind)?;
    check_rect(&[x, y, width, height])?;
    let mut lib = state.lock();
    load_board(&lib.conn, board_id)?;
    let tx = lib.conn.transaction()?;
    let now = now_ms();
    let title = title.trim().to_string();
    tx.execute(
        "INSERT INTO cards (kind, title, content, data, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![kind, title, content, data, now],
    )?;
    let id = tx.last_insert_rowid();
    let (width, height) = (width.max(MIN_CARD_WIDTH), height.max(MIN_CARD_HEIGHT));
    tx.execute(
        "INSERT INTO board_cards (board_id, card_id, x, y, width, height) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![board_id, id, x, y, width, height],
    )?;
    touch_board(&tx, board_id)?;
    tx.commit()?;
    Ok(BoardCard {
        id,
        kind,
        title,
        content,
        data,
        x,
        y,
        width,
        height,
        updated_at: now,
        items: Vec::new(),
        tags: Vec::new(),
    })
}

/// Saves a card's title, content and kind data together (e.g. a mind map: its tree in `data`
/// and an outline of it in `content`, so it can be searched and compared in the history).
#[tauri::command]
pub fn update_card_data(state: State<'_, DrawerState>, id: i64, title: String, content: String, data: String) -> Result<()> {
    let lib = state.lock();
    let tx = lib.conn.unchecked_transaction()?;
    if !card_exists(&tx, id)? {
        return Err(Error("找不到這張卡片".into()));
    }
    history::ensure_baseline(&tx, id)?;
    let now = now_ms();
    let title = title.trim();
    tx.execute(
        "UPDATE cards SET title = ?1, content = ?2, data = ?3, updated_at = ?4 WHERE id = ?5",
        params![title, content, data, now, id],
    )?;
    history::record_version(&tx, id, title, &content, &data, now, false)?;
    tx.commit()?;
    Ok(())
}

#[tauri::command]
pub fn update_card(state: State<'_, DrawerState>, id: i64, title: String, content: String) -> Result<()> {
    let lib = state.lock();
    let tx = lib.conn.unchecked_transaction()?;
    if !card_exists(&tx, id)? {
        return Err(Error("找不到這張卡片".into()));
    }
    // Version history: keep the state before the first recorded edit, then record this save.
    history::ensure_baseline(&tx, id)?;
    let now = now_ms();
    let title = title.trim();
    tx.execute(
        "UPDATE cards SET title = ?1, content = ?2, updated_at = ?3 WHERE id = ?4",
        params![title, content, now, id],
    )?;
    let data: String = tx.query_row("SELECT data FROM cards WHERE id = ?1", [id], |r| r.get(0))?;
    history::record_version(&tx, id, title, &content, &data, now, false)?;
    tx.commit()?;
    Ok(())
}

/// Moves or resizes a card on a board.
#[tauri::command]
pub fn place_card(
    state: State<'_, DrawerState>,
    board_id: i64,
    card_id: i64,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<()> {
    if ![x, y, width, height].iter().all(|v| v.is_finite()) {
        return Err(Error("卡片位置無效".into()));
    }
    let lib = state.lock();
    lib.conn.execute(
        "UPDATE board_cards SET x = ?1, y = ?2, width = ?3, height = ?4
         WHERE board_id = ?5 AND card_id = ?6",
        params![x, y, width.max(MIN_CARD_WIDTH), height.max(MIN_CARD_HEIGHT), board_id, card_id],
    )?;
    touch_board(&lib.conn, board_id)?;
    Ok(())
}

/// Deletes the card everywhere, with all its links.
#[tauri::command]
pub fn delete_card(state: State<'_, DrawerState>, id: i64) -> Result<()> {
    let lib = state.lock();
    lib.conn.execute(
        "UPDATE whiteboards SET updated_at = ?1
         WHERE id IN (SELECT board_id FROM board_cards WHERE card_id = ?2)",
        params![now_ms(), id],
    )?;
    lib.conn.execute("DELETE FROM cards WHERE id = ?1", [id])?;
    crate::card_files::remove_card_files(&lib, id);
    Ok(())
}

// ---------- links ----------

/// Links two cards. With `directed`, a new link points from `a` to `b`; otherwise it has no
/// arrow. Linking an already linked pair returns the existing link unchanged.
#[tauri::command]
pub fn link_cards(state: State<'_, DrawerState>, a: i64, b: i64, directed: Option<bool>) -> Result<CardLink> {
    if a == b {
        return Err(Error("卡片不能連結到自己".into()));
    }
    let (card_a, card_b) = if a < b { (a, b) } else { (b, a) };
    let lib = state.lock();
    let conn = &lib.conn;
    if !card_exists(conn, card_a)? || !card_exists(conn, card_b)? {
        return Err(Error("找不到這張卡片".into()));
    }
    let direction = if directed.unwrap_or(false) { pointing(a, b) } else { 0 };
    conn.execute(
        "INSERT OR IGNORE INTO card_links (card_a, card_b, direction, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![card_a, card_b, direction, now_ms()],
    )?;
    Ok(conn.query_row(
        &format!("SELECT {LINK_COLUMNS} FROM card_links WHERE card_a = ?1 AND card_b = ?2"),
        params![card_a, card_b],
        link_row,
    )?)
}

#[tauri::command]
pub fn unlink_cards(state: State<'_, DrawerState>, a: i64, b: i64) -> Result<()> {
    let (card_a, card_b) = if a < b { (a, b) } else { (b, a) };
    let lib = state.lock();
    lib.conn.execute(
        "DELETE FROM card_links WHERE card_a = ?1 AND card_b = ?2",
        params![card_a, card_b],
    )?;
    Ok(())
}

/// Turns `[[wiki links]]` into two-way links, after `card_id` was saved:
///
/// 1. Forward: links `card_id` to the cards named by its own `[[...]]` (`titles`, parsed by the
///    frontend). A title matches a card with the same title (trimmed, ASCII case-insensitive);
///    when several cards share it, one on a board with `card_id` wins, then the most recently
///    edited. Titles that match nothing, or only the card itself, are skipped.
/// 2. Backward: links `card_id` to other cards whose text already contains `[[its title]]` or
///    `[[its title|...]]` (so writing `[[X]]` before card X exists still links them later).
///
/// New links point from the card that mentions to the card mentioned.
/// Links are only added, never removed: deleting `[[...]]` from the text leaves the link (it may
/// also have been made by hand). Returns only the links that did not exist before.
#[tauri::command]
pub fn sync_wiki_links(state: State<'_, DrawerState>, card_id: i64, titles: Vec<String>) -> Result<Vec<CardLink>> {
    let lib = state.lock();
    let conn = &lib.conn;
    let own_title: String = conn
        .query_row("SELECT title FROM cards WHERE id = ?1", [card_id], |r| r.get(0))
        .optional()?
        .ok_or_else(|| Error("找不到這張卡片".into()))?;
    let mut created = Vec::new();
    let mut add = |from: i64, to: i64| -> Result<()> {
        let (card_a, card_b) = if from < to { (from, to) } else { (to, from) };
        let direction = pointing(from, to);
        let n = conn.execute(
            "INSERT OR IGNORE INTO card_links (card_a, card_b, direction, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![card_a, card_b, direction, now_ms()],
        )?;
        if n > 0 {
            created.push(CardLink { id: conn.last_insert_rowid(), card_a, card_b, direction, note: String::new() });
        }
        Ok(())
    };
    let mut find = conn.prepare(
        "SELECT c.id FROM cards c
         WHERE c.title = ?1 COLLATE NOCASE AND c.id <> ?2
         ORDER BY EXISTS (SELECT 1 FROM board_cards x JOIN board_cards y ON x.board_id = y.board_id
                          WHERE x.card_id = c.id AND y.card_id = ?2) DESC,
                  c.updated_at DESC, c.id DESC
         LIMIT 1",
    )?;
    let mut seen = std::collections::HashSet::new();
    for title in &titles {
        let title = title.trim();
        if title.is_empty() {
            continue;
        }
        let Some(other) = find.query_row(params![title, card_id], |r| r.get::<_, i64>(0)).optional()? else {
            continue;
        };
        if seen.insert(other) {
            add(card_id, other)?;
        }
    }

    let own_title = own_title.trim();
    if !own_title.is_empty() {
        let mentions = conn
            .prepare(
                r"SELECT id FROM cards
                  WHERE id <> ?1 AND (content LIKE ?2 ESCAPE '\' OR content LIKE ?3 ESCAPE '\')",
            )?
            .query_map(
                params![card_id, like_pattern(&format!("[[{own_title}]]")), like_pattern(&format!("[[{own_title}|"))],
                |r| r.get::<_, i64>(0),
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for other in mentions {
            if seen.insert(other) {
                add(other, card_id)?;
            }
        }
    }
    Ok(created)
}

/// Every card linked to this one, whichever side the link was made from, on any board.
#[tauri::command]
pub fn list_card_links(state: State<'_, DrawerState>, card_id: i64) -> Result<Vec<LinkedCard>> {
    let lib = state.lock();
    let conn = &lib.conn;
    let others = conn
        .prepare(
            "SELECT l.id, c.id, c.title, l.card_a = ?1, l.direction, l.note FROM card_links l
             JOIN cards c ON c.id = CASE WHEN l.card_a = ?1 THEN l.card_b ELSE l.card_a END
             WHERE l.card_a = ?1 OR l.card_b = ?1
             ORDER BY c.title COLLATE NOCASE, c.id",
        )?
        .query_map([card_id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, bool>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, String>(5)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut boards_stmt = conn.prepare(
        "SELECT w.id, w.name FROM board_cards bc JOIN whiteboards w ON w.id = bc.board_id
         WHERE bc.card_id = ?1 ORDER BY w.name COLLATE NOCASE",
    )?;
    let mut out = Vec::with_capacity(others.len());
    for (link_id, id, title, is_a, dir, note) in others {
        let boards = boards_stmt
            .query_map([id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        // From card_id's side: when it is card_a, direction 1 points away from it.
        let direction = match (dir, is_a) {
            (3, _) => "both",
            (1, true) | (2, false) => "out",
            (1, false) | (2, true) => "in",
            _ => "none",
        };
        out.push(LinkedCard {
            link_id,
            card_id: id,
            title,
            direction,
            note,
            board_id: boards.first().map(|b| b.0),
            boards: boards.into_iter().map(|b| b.1).collect(),
        });
    }
    Ok(out)
}

/// A card found by `search_cards`, with the boards it is on.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardHit {
    card_id: i64,
    kind: String,
    title: String,
    /// The card's Markdown, for showing a preview in lists.
    content: String,
    board_id: Option<i64>,
    boards: Vec<String>,
}

/// Cards whose title or content contains `query` (all cards when empty), newest first.
/// `exclude` (the card being linked from) is left out.
#[tauri::command]
pub fn search_cards(state: State<'_, DrawerState>, query: String, exclude: Option<i64>) -> Result<Vec<CardHit>> {
    let lib = state.lock();
    let conn = &lib.conn;
    let q = query.trim();
    let pattern = like_pattern(q);
    let hits = conn
        .prepare(
            r"SELECT c.id, c.title, c.content, c.kind FROM cards c
              WHERE (?1 IS NULL OR c.id <> ?1)
                AND (?2 = '' OR c.title LIKE ?3 ESCAPE '\' OR c.content LIKE ?3 ESCAPE '\')
              ORDER BY c.updated_at DESC, c.id DESC LIMIT 50",
        )?
        .query_map(params![exclude, q, pattern], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut boards_stmt = conn.prepare(
        "SELECT w.id, w.name FROM board_cards bc JOIN whiteboards w ON w.id = bc.board_id
         WHERE bc.card_id = ?1 ORDER BY w.name COLLATE NOCASE",
    )?;
    let mut out = Vec::with_capacity(hits.len());
    for (card_id, title, content, kind) in hits {
        let boards = boards_stmt
            .query_map([card_id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        out.push(CardHit {
            card_id,
            kind,
            title,
            content,
            board_id: boards.first().map(|b| b.0),
            boards: boards.into_iter().map(|b| b.1).collect(),
        });
    }
    Ok(out)
}

// ---------- cards ↔ Drawer items ----------

/// Reads an `ItemRef` from columns `offset..offset + 5` (id, item_type, title, authors, date).
fn item_ref(r: &rusqlite::Row, offset: usize) -> rusqlite::Result<ItemRef> {
    Ok(ItemRef {
        item_id: r.get(offset)?,
        item_type: r.get(offset + 1)?,
        title: r.get(offset + 2)?,
        authors: r.get(offset + 3)?,
        date: r.get(offset + 4)?,
    })
}

fn item_exists(conn: &Connection, id: i64) -> Result<bool> {
    Ok(conn.query_row("SELECT 1 FROM items WHERE id = ?1", [id], |_| Ok(())).optional()?.is_some())
}

/// Drawer items a card refers to, in the order they were linked.
#[tauri::command]
pub fn list_card_items(state: State<'_, DrawerState>, card_id: i64) -> Result<Vec<ItemRef>> {
    let lib = state.lock();
    let rows = lib
        .conn
        .prepare(
            "SELECT i.id, i.item_type, i.title, i.authors, i.date
             FROM card_items ci JOIN items i ON i.id = ci.item_id
             WHERE ci.card_id = ?1 ORDER BY ci.created_at, i.id",
        )?
        .query_map([card_id], |r| item_ref(r, 0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn link_card_item(state: State<'_, DrawerState>, card_id: i64, item_id: i64) -> Result<()> {
    let lib = state.lock();
    let conn = &lib.conn;
    if !card_exists(conn, card_id)? {
        return Err(Error("找不到這張卡片".into()));
    }
    if !item_exists(conn, item_id)? {
        return Err(Error("找不到這個條目".into()));
    }
    conn.execute(
        "INSERT OR IGNORE INTO card_items (card_id, item_id, created_at) VALUES (?1, ?2, ?3)",
        params![card_id, item_id, now_ms()],
    )?;
    Ok(())
}

#[tauri::command]
pub fn unlink_card_item(state: State<'_, DrawerState>, card_id: i64, item_id: i64) -> Result<()> {
    let lib = state.lock();
    lib.conn.execute(
        "DELETE FROM card_items WHERE card_id = ?1 AND item_id = ?2",
        params![card_id, item_id],
    )?;
    Ok(())
}

/// A card that refers to a Drawer item, as shown in the item's detail pane.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemCard {
    card_id: i64,
    title: String,
    content: String,
    /// A board the card is on (for opening it there), if any.
    board_id: Option<i64>,
    boards: Vec<String>,
    updated_at: i64,
}

fn load_item_card(conn: &Connection, card_id: i64) -> Result<ItemCard> {
    let (title, content, updated_at): (String, String, i64) = conn
        .query_row("SELECT title, content, updated_at FROM cards WHERE id = ?1", [card_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()?
        .ok_or_else(|| Error("找不到這張卡片".into()))?;
    let boards = conn
        .prepare(
            "SELECT w.id, w.name FROM board_cards bc JOIN whiteboards w ON w.id = bc.board_id
             WHERE bc.card_id = ?1 ORDER BY w.name COLLATE NOCASE",
        )?
        .query_map([card_id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(ItemCard {
        card_id,
        title,
        content,
        board_id: boards.first().map(|b| b.0),
        boards: boards.into_iter().map(|b| b.1).collect(),
        updated_at,
    })
}

/// Cards that refer to the item, oldest link first.
#[tauri::command]
pub fn list_item_cards(state: State<'_, DrawerState>, item_id: i64) -> Result<Vec<ItemCard>> {
    let lib = state.lock();
    let conn = &lib.conn;
    let ids = conn
        .prepare("SELECT card_id FROM card_items WHERE item_id = ?1 ORDER BY created_at, card_id")?
        .query_map([item_id], |r| r.get::<_, i64>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    ids.into_iter().map(|id| load_item_card(conn, id)).collect()
}

/// Creates a note card about the item ("筆記：<title>"), linked to it and not yet on any board.
#[tauri::command]
pub fn create_item_card(state: State<'_, DrawerState>, item_id: i64) -> Result<ItemCard> {
    let mut lib = state.lock();
    let title: String = lib
        .conn
        .query_row("SELECT title FROM items WHERE id = ?1", [item_id], |r| r.get(0))
        .optional()?
        .ok_or_else(|| Error("找不到這個條目".into()))?;
    let tx = lib.conn.transaction()?;
    let now = now_ms();
    tx.execute(
        "INSERT INTO cards (title, created_at, updated_at) VALUES (?1, ?2, ?2)",
        params![crate::db::note_card_title(&title), now],
    )?;
    let card_id = tx.last_insert_rowid();
    tx.execute(
        "INSERT INTO card_items (card_id, item_id, created_at) VALUES (?1, ?2, ?3)",
        params![card_id, item_id, now],
    )?;
    tx.commit()?;
    load_item_card(&lib.conn, card_id)
}

/// Puts an existing card on a board: at (`x`, `y`) when given (e.g. where it was dropped),
/// otherwise to the right of the cards already there.
#[tauri::command]
pub fn add_card_to_board(
    state: State<'_, DrawerState>,
    board_id: i64,
    card_id: i64,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<()> {
    let lib = state.lock();
    let conn = &lib.conn;
    load_board(conn, board_id)?;
    if !card_exists(conn, card_id)? {
        return Err(Error("找不到這張卡片".into()));
    }
    let already = conn
        .query_row(
            "SELECT 1 FROM board_cards WHERE board_id = ?1 AND card_id = ?2",
            params![board_id, card_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if already {
        return Err(Error("這張卡片已經在這個白板上".into()));
    }
    let (x, y): (f64, f64) = match (x, y) {
        (Some(x), Some(y)) if x.is_finite() && y.is_finite() => (x, y),
        _ => conn.query_row(
            "SELECT COALESCE(MAX(x + width) + 40, 0), COALESCE(MIN(y), 0) FROM board_cards WHERE board_id = ?1",
            [board_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?,
    };
    conn.execute(
        "INSERT INTO board_cards (board_id, card_id, x, y, width, height) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![board_id, card_id, x, y, DEFAULT_CARD_WIDTH, DEFAULT_CARD_HEIGHT],
    )?;
    touch_board(conn, board_id)?;
    Ok(())
}

// ---------- link direction and note ----------

/// Sets how a link points and its note. `direction`: 0 no arrow, 1 cardA → cardB,
/// 2 cardB → cardA, 3 both ways.
#[tauri::command]
pub fn update_link(state: State<'_, DrawerState>, id: i64, direction: i64, note: String) -> Result<CardLink> {
    if !(0..=3).contains(&direction) {
        return Err(Error("連結方向無效".into()));
    }
    let lib = state.lock();
    let n = lib.conn.execute(
        "UPDATE card_links SET direction = ?1, note = ?2 WHERE id = ?3",
        params![direction, note.trim(), id],
    )?;
    if n == 0 {
        return Err(Error("找不到這條連結".into()));
    }
    Ok(lib.conn.query_row(
        &format!("SELECT {LINK_COLUMNS} FROM card_links WHERE id = ?1"),
        [id],
        link_row,
    )?)
}

// ---------- folders ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardFolder {
    id: i64,
    name: String,
    parent_id: Option<i64>,
}

fn clean_folder_name(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error("資料夾名稱不能是空的".into()));
    }
    Ok(name.to_string())
}

fn folder_exists(conn: &Connection, id: i64) -> Result<bool> {
    Ok(conn
        .query_row("SELECT 1 FROM whiteboard_folders WHERE id = ?1", [id], |_| Ok(()))
        .optional()?
        .is_some())
}

#[tauri::command]
pub fn list_whiteboard_folders(state: State<'_, DrawerState>) -> Result<Vec<BoardFolder>> {
    let lib = state.lock();
    let rows = lib
        .conn
        .prepare("SELECT id, name, parent_id FROM whiteboard_folders ORDER BY name COLLATE NOCASE, id")?
        .query_map([], |r| Ok(BoardFolder { id: r.get(0)?, name: r.get(1)?, parent_id: r.get(2)? }))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn create_whiteboard_folder(
    state: State<'_, DrawerState>,
    name: String,
    parent_id: Option<i64>,
) -> Result<BoardFolder> {
    let name = clean_folder_name(&name)?;
    let lib = state.lock();
    if let Some(p) = parent_id {
        if !folder_exists(&lib.conn, p)? {
            return Err(Error("找不到上層資料夾".into()));
        }
    }
    lib.conn.execute(
        "INSERT INTO whiteboard_folders (name, parent_id, created_at) VALUES (?1, ?2, ?3)",
        params![name, parent_id, now_ms()],
    )?;
    Ok(BoardFolder { id: lib.conn.last_insert_rowid(), name, parent_id })
}

#[tauri::command]
pub fn rename_whiteboard_folder(state: State<'_, DrawerState>, id: i64, name: String) -> Result<()> {
    let name = clean_folder_name(&name)?;
    let lib = state.lock();
    lib.conn.execute("UPDATE whiteboard_folders SET name = ?1 WHERE id = ?2", params![name, id])?;
    Ok(())
}

/// Deletes the folder and its sub-folders. Their boards are kept and move to the top level.
#[tauri::command]
pub fn delete_whiteboard_folder(state: State<'_, DrawerState>, id: i64) -> Result<()> {
    let lib = state.lock();
    lib.conn.execute("DELETE FROM whiteboard_folders WHERE id = ?1", [id])?;
    Ok(())
}

/// Moves a folder under another one (`None`: top level). A folder can't go inside itself.
#[tauri::command]
pub fn move_whiteboard_folder(state: State<'_, DrawerState>, id: i64, parent_id: Option<i64>) -> Result<()> {
    let lib = state.lock();
    let conn = &lib.conn;
    if let Some(p) = parent_id {
        // Walk up from the new parent; meeting `id` means a cycle.
        let mut cur = Some(p);
        while let Some(c) = cur {
            if c == id {
                return Err(Error("不能把資料夾移到它自己裡面".into()));
            }
            cur = conn
                .query_row("SELECT parent_id FROM whiteboard_folders WHERE id = ?1", [c], |r| r.get(0))
                .optional()?
                .ok_or_else(|| Error("找不到上層資料夾".into()))?;
        }
    }
    conn.execute("UPDATE whiteboard_folders SET parent_id = ?1 WHERE id = ?2", params![parent_id, id])?;
    Ok(())
}

/// Moves a board into a folder (`None`: top level).
#[tauri::command]
pub fn move_whiteboard(state: State<'_, DrawerState>, id: i64, folder_id: Option<i64>) -> Result<()> {
    let lib = state.lock();
    if let Some(f) = folder_id {
        if !folder_exists(&lib.conn, f)? {
            return Err(Error("找不到這個資料夾".into()));
        }
    }
    lib.conn.execute("UPDATE whiteboards SET folder_id = ?1 WHERE id = ?2", params![folder_id, id])?;
    Ok(())
}

// ---------- graph ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    id: i64,
    kind: String,
    title: String,
    tags: Vec<String>,
    /// Boards the card is on.
    board_ids: Vec<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRef {
    card_id: i64,
    item_id: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Graph {
    cards: Vec<GraphNode>,
    /// Links between two of the cards.
    links: Vec<CardLink>,
    /// Drawer items the cards refer to.
    items: Vec<ItemRef>,
    refs: Vec<GraphRef>,
}

/// The relationship graph: cards on the given boards (all cards when `board_ids` is `None`),
/// the links among them, and the Drawer items they refer to.
#[tauri::command]
pub fn get_graph(state: State<'_, DrawerState>, board_ids: Option<Vec<i64>>, tag: Option<String>) -> Result<Graph> {
    let lib = state.lock();
    let conn = &lib.conn;
    let mut placements = std::collections::HashMap::<i64, Vec<i64>>::new();
    for row in conn
        .prepare("SELECT card_id, board_id FROM board_cards ORDER BY board_id")?
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?
    {
        let (card, board) = row?;
        placements.entry(card).or_default().push(board);
    }
    let wanted: Option<std::collections::HashSet<i64>> = board_ids.map(|v| v.into_iter().collect());
    let cards: Vec<GraphNode> = conn
        .prepare("SELECT id, title, kind FROM cards ORDER BY id")?
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .map(|(id, title, kind)| GraphNode { id, kind, title, tags: Vec::new(), board_ids: placements.remove(&id).unwrap_or_default() })
        .filter(|n| wanted.as_ref().is_none_or(|w| n.board_ids.iter().any(|b| w.contains(b))))
        .collect();
    let mut cards = cards;
    for c in cards.iter_mut() {
        c.tags = card_tags(conn, c.id)?;
    }
    // Only cards with the tag (case-insensitive), when one is given.
    if let Some(tag) = tag.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
        let tag = tag.to_lowercase();
        cards.retain(|c| c.tags.iter().any(|t| t.to_lowercase() == tag));
    }
    let ids: std::collections::HashSet<i64> = cards.iter().map(|c| c.id).collect();
    let links = conn
        .prepare(&format!("SELECT {LINK_COLUMNS} FROM card_links ORDER BY id"))?
        .query_map([], link_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .filter(|l| ids.contains(&l.card_a) && ids.contains(&l.card_b))
        .collect();
    let mut items = Vec::new();
    let mut refs = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for row in conn
        .prepare(
            "SELECT ci.card_id, i.id, i.item_type, i.title, i.authors, i.date
             FROM card_items ci JOIN items i ON i.id = ci.item_id ORDER BY i.id",
        )?
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, item_ref(r, 1)?)))?
    {
        let (card_id, item) = row?;
        if !ids.contains(&card_id) {
            continue;
        }
        refs.push(GraphRef { card_id, item_id: item.item_id });
        if seen.insert(item.item_id) {
            items.push(item);
        }
    }
    Ok(Graph { cards, links, items, refs })
}

// ---------- sections ----------

/// A named region on a board that groups the cards inside it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    id: i64,
    board_id: i64,
    title: String,
    /// Colour key ("" = default, "blue", "green", "yellow", "red", "purple").
    color: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

const SECTION_COLUMNS: &str = "id, board_id, title, color, x, y, width, height";

fn section_row(r: &rusqlite::Row) -> rusqlite::Result<Section> {
    Ok(Section {
        id: r.get(0)?,
        board_id: r.get(1)?,
        title: r.get(2)?,
        color: r.get(3)?,
        x: r.get(4)?,
        y: r.get(5)?,
        width: r.get(6)?,
        height: r.get(7)?,
    })
}

const MIN_SECTION_SIZE: f64 = 120.0;

fn check_rect(values: &[f64]) -> Result<()> {
    if values.iter().all(|v| v.is_finite()) {
        Ok(())
    } else {
        Err(Error("位置無效".into()))
    }
}

#[tauri::command]
pub fn create_section(
    state: State<'_, DrawerState>,
    board_id: i64,
    title: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<Section> {
    check_rect(&[x, y, width, height])?;
    let lib = state.lock();
    load_board(&lib.conn, board_id)?;
    lib.conn.execute(
        "INSERT INTO board_sections (board_id, title, x, y, width, height, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            board_id,
            title.trim(),
            x,
            y,
            width.max(MIN_SECTION_SIZE),
            height.max(MIN_SECTION_SIZE),
            now_ms()
        ],
    )?;
    let id = lib.conn.last_insert_rowid();
    touch_board(&lib.conn, board_id)?;
    Ok(lib.conn.query_row(
        &format!("SELECT {SECTION_COLUMNS} FROM board_sections WHERE id = ?1"),
        [id],
        section_row,
    )?)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn update_section(
    state: State<'_, DrawerState>,
    id: i64,
    title: String,
    color: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<()> {
    check_rect(&[x, y, width, height])?;
    let lib = state.lock();
    let n = lib.conn.execute(
        "UPDATE board_sections SET title = ?1, color = ?2, x = ?3, y = ?4, width = ?5, height = ?6 WHERE id = ?7",
        params![title.trim(), color, x, y, width.max(MIN_SECTION_SIZE), height.max(MIN_SECTION_SIZE), id],
    )?;
    if n == 0 {
        return Err(Error("找不到這個區塊".into()));
    }
    Ok(())
}

/// Deletes the section only; the cards inside stay on the board.
#[tauri::command]
pub fn delete_section(state: State<'_, DrawerState>, id: i64) -> Result<()> {
    let lib = state.lock();
    lib.conn.execute("DELETE FROM board_sections WHERE id = ?1", [id])?;
    Ok(())
}

// ---------- several cards at once ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    card_id: i64,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Moves or resizes several cards on a board in one go (e.g. a multi-selection or a section's cards).
#[tauri::command]
pub fn place_cards(state: State<'_, DrawerState>, board_id: i64, places: Vec<Placement>) -> Result<()> {
    for p in &places {
        check_rect(&[p.x, p.y, p.width, p.height])?;
    }
    let mut lib = state.lock();
    let tx = lib.conn.transaction()?;
    {
        let mut stmt = tx.prepare(
            "UPDATE board_cards SET x = ?1, y = ?2, width = ?3, height = ?4 WHERE board_id = ?5 AND card_id = ?6",
        )?;
        for p in &places {
            stmt.execute(params![
                p.x,
                p.y,
                p.width.max(MIN_CARD_WIDTH),
                p.height.max(MIN_CARD_HEIGHT),
                board_id,
                p.card_id
            ])?;
        }
    }
    touch_board(&tx, board_id)?;
    tx.commit()?;
    Ok(())
}

/// Takes cards off one board only. The cards themselves, their links, tags and cited items stay
/// (they remain in the card library and on any other board). Returns how many were removed.
#[tauri::command]
pub fn remove_cards_from_board(state: State<'_, DrawerState>, board_id: i64, ids: Vec<i64>) -> Result<usize> {
    let mut lib = state.lock();
    let tx = lib.conn.transaction()?;
    let mut removed = 0;
    for id in &ids {
        removed += tx.execute(
            "DELETE FROM board_cards WHERE board_id = ?1 AND card_id = ?2",
            params![board_id, id],
        )?;
    }
    if removed > 0 {
        touch_board(&tx, board_id)?;
    }
    tx.commit()?;
    Ok(removed)
}

/// Deletes several cards everywhere (every board and the card library), with their links.
#[tauri::command]
pub fn delete_cards(state: State<'_, DrawerState>, ids: Vec<i64>) -> Result<()> {
    let mut lib = state.lock();
    let tx = lib.conn.transaction()?;
    for id in &ids {
        tx.execute(
            "UPDATE whiteboards SET updated_at = ?1 WHERE id IN (SELECT board_id FROM board_cards WHERE card_id = ?2)",
            params![now_ms(), id],
        )?;
        tx.execute("DELETE FROM cards WHERE id = ?1", [id])?;
    }
    tx.commit()?;
    for id in ids {
        crate::card_files::remove_card_files(&lib, id);
    }
    Ok(())
}

// ---------- tags ----------

fn card_tags(conn: &Connection, card_id: i64) -> rusqlite::Result<Vec<String>> {
    conn.prepare_cached("SELECT name FROM card_tags WHERE card_id = ?1 ORDER BY name COLLATE NOCASE")?
        .query_map([card_id], |r| r.get(0))?
        .collect()
}

/// Replaces a card's tags. Names are trimmed, a leading "#" is dropped, and duplicates
/// (ignoring case) are merged. Returns the tags as stored.
#[tauri::command]
pub fn set_card_tags(state: State<'_, DrawerState>, card_id: i64, tags: Vec<String>) -> Result<Vec<String>> {
    let mut lib = state.lock();
    if !card_exists(&lib.conn, card_id)? {
        return Err(Error("找不到這張卡片".into()));
    }
    let tx = lib.conn.transaction()?;
    tx.execute("DELETE FROM card_tags WHERE card_id = ?1", [card_id])?;
    for t in &tags {
        let name = t.trim().trim_start_matches('#').trim();
        if !name.is_empty() {
            tx.execute("INSERT OR IGNORE INTO card_tags (card_id, name) VALUES (?1, ?2)", params![card_id, name])?;
        }
    }
    tx.execute("UPDATE cards SET updated_at = ?1 WHERE id = ?2", params![now_ms(), card_id])?;
    let out = card_tags(&tx, card_id)?;
    tx.commit()?;
    Ok(out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagCount {
    name: String,
    count: i64,
}

/// Every card tag with how many cards use it, most used first.
#[tauri::command]
pub fn list_card_tags(state: State<'_, DrawerState>) -> Result<Vec<TagCount>> {
    let lib = state.lock();
    let rows = lib
        .conn
        .prepare(
            "SELECT MIN(name), COUNT(*) FROM card_tags GROUP BY name COLLATE NOCASE
             ORDER BY COUNT(*) DESC, MIN(name) COLLATE NOCASE",
        )?
        .query_map([], |r| Ok(TagCount { name: r.get(0)?, count: r.get(1)? }))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

// ---------- one card / the card library ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardRef {
    id: i64,
    name: String,
}

/// Everything about one card, for the side panel.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardDetail {
    id: i64,
    kind: String,
    title: String,
    content: String,
    data: String,
    tags: Vec<String>,
    items: Vec<ItemRef>,
    boards: Vec<BoardRef>,
    created_at: i64,
    updated_at: i64,
}

fn card_boards(conn: &Connection, card_id: i64) -> rusqlite::Result<Vec<BoardRef>> {
    conn.prepare_cached(
        "SELECT w.id, w.name FROM board_cards bc JOIN whiteboards w ON w.id = bc.board_id
         WHERE bc.card_id = ?1 ORDER BY w.name COLLATE NOCASE",
    )?
    .query_map([card_id], |r| Ok(BoardRef { id: r.get(0)?, name: r.get(1)? }))?
    .collect()
}

pub(crate) fn load_card_detail(conn: &Connection, id: i64) -> Result<CardDetail> {
    let (title, content, created_at, updated_at, kind, data) = conn
        .query_row("SELECT title, content, created_at, updated_at, kind, data FROM cards WHERE id = ?1", [id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
            ))
        })
        .optional()?
        .ok_or_else(|| Error("找不到這張卡片".into()))?;
    let items = conn
        .prepare(
            "SELECT i.id, i.item_type, i.title, i.authors, i.date
             FROM card_items ci JOIN items i ON i.id = ci.item_id
             WHERE ci.card_id = ?1 ORDER BY ci.created_at, i.id",
        )?
        .query_map([id], |r| item_ref(r, 0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(CardDetail {
        id,
        kind,
        title,
        content,
        data,
        tags: card_tags(conn, id)?,
        items,
        boards: card_boards(conn, id)?,
        created_at,
        updated_at,
    })
}

#[tauri::command]
pub fn get_card(state: State<'_, DrawerState>, id: i64) -> Result<CardDetail> {
    let lib = state.lock();
    load_card_detail(&lib.conn, id)
}

/// A new empty card that is not on any board (made from the card library).
#[tauri::command]
pub fn create_loose_card(state: State<'_, DrawerState>) -> Result<CardDetail> {
    let lib = state.lock();
    lib.conn.execute("INSERT INTO cards (created_at, updated_at) VALUES (?1, ?1)", [now_ms()])?;
    load_card_detail(&lib.conn, lib.conn.last_insert_rowid())
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CardQuery {
    /// Matches title or content.
    query: String,
    /// Only cards with this tag (case-insensitive).
    tag: Option<String>,
    /// "all" (default), "placed" (on some board) or "unplaced" (on no board).
    placement: String,
    /// "updated" (default, newest first), "created" (newest first) or "title".
    sort: String,
}

/// A row in the card library.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCard {
    id: i64,
    kind: String,
    title: String,
    content: String,
    data: String,
    tags: Vec<String>,
    boards: Vec<BoardRef>,
    /// Sections the card sits in (entirely inside), on any board.
    sections: Vec<SectionRef>,
    /// Drawer items it cites (shown on the card face).
    items: Vec<ItemRef>,
    /// Size on its first board (by name), so the library can draw it as it looks there;
    /// `None` when it is on no board.
    width: Option<f64>,
    height: Option<f64>,
    link_count: i64,
    item_count: i64,
    created_at: i64,
    updated_at: i64,
}

/// A section a card is in, for the card library.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionRef {
    id: i64,
    title: String,
    color: String,
    board_id: i64,
    board_name: String,
}

/// Sections that contain the card on any board. Like moving a section, membership is geometric:
/// the card must be entirely inside the section's rectangle (half a unit of slack for rounding).
pub fn card_sections(conn: &Connection, card_id: i64) -> rusqlite::Result<Vec<SectionRef>> {
    conn.prepare_cached(
        "SELECT s.id, s.title, s.color, w.id, w.name
         FROM board_cards bc
         JOIN board_sections s ON s.board_id = bc.board_id
         JOIN whiteboards w ON w.id = bc.board_id
         WHERE bc.card_id = ?1
           AND bc.x >= s.x - 0.5 AND bc.y >= s.y - 0.5
           AND bc.x + bc.width <= s.x + s.width + 0.5 AND bc.y + bc.height <= s.y + s.height + 0.5
         ORDER BY w.name COLLATE NOCASE, s.title COLLATE NOCASE, s.id",
    )?
    .query_map([card_id], |r| {
        Ok(SectionRef { id: r.get(0)?, title: r.get(1)?, color: r.get(2)?, board_id: r.get(3)?, board_name: r.get(4)? })
    })?
    .collect()
}

/// The card library: every card matching the filters (at most 1000).
#[tauri::command]
pub fn list_cards(state: State<'_, DrawerState>, filter: CardQuery) -> Result<Vec<LibraryCard>> {
    let lib = state.lock();
    let conn = &lib.conn;
    let q = filter.query.trim();
    let order = match filter.sort.as_str() {
        "created" => "c.created_at DESC, c.id DESC",
        "title" => "c.title = '' , c.title COLLATE NOCASE, c.id",
        _ => "c.updated_at DESC, c.id DESC",
    };
    let placement = match filter.placement.as_str() {
        "placed" => "AND EXISTS (SELECT 1 FROM board_cards bc WHERE bc.card_id = c.id)",
        "unplaced" => "AND NOT EXISTS (SELECT 1 FROM board_cards bc WHERE bc.card_id = c.id)",
        _ => "",
    };
    let sql = format!(
        r"SELECT c.id, c.title, c.content, c.created_at, c.updated_at,
                 (SELECT COUNT(*) FROM card_links l WHERE l.card_a = c.id OR l.card_b = c.id),
                 (SELECT COUNT(*) FROM card_items ci WHERE ci.card_id = c.id), c.kind, c.data
          FROM cards c
          WHERE (?1 = '' OR c.title LIKE ?2 ESCAPE '\' OR c.content LIKE ?2 ESCAPE '\')
            AND (?3 IS NULL OR EXISTS (SELECT 1 FROM card_tags t WHERE t.card_id = c.id AND t.name = ?3))
            {placement}
          ORDER BY {order} LIMIT 1000"
    );
    let rows = conn
        .prepare(&sql)?
        .query_map(params![q, like_pattern(q), filter.tag.as_deref().map(str::trim)], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, i64>(6)?,
                r.get::<_, String>(7)?,
                r.get::<_, String>(8)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut out = Vec::with_capacity(rows.len());
    let mut size_stmt = conn.prepare_cached(
        "SELECT bc.width, bc.height FROM board_cards bc JOIN whiteboards w ON w.id = bc.board_id
         WHERE bc.card_id = ?1 ORDER BY w.name COLLATE NOCASE, w.id LIMIT 1",
    )?;
    let mut items_stmt = conn.prepare_cached(
        "SELECT i.id, i.item_type, i.title, i.authors, i.date
         FROM card_items ci JOIN items i ON i.id = ci.item_id
         WHERE ci.card_id = ?1 ORDER BY ci.created_at, i.id",
    )?;
    for (id, title, content, created_at, updated_at, link_count, item_count, kind, data) in rows {
        let size: Option<(f64, f64)> = size_stmt.query_row([id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
        let items = items_stmt.query_map([id], |r| item_ref(r, 0))?.collect::<rusqlite::Result<Vec<_>>>()?;
        out.push(LibraryCard {
            id,
            kind,
            title,
            content,
            data,
            tags: card_tags(conn, id)?,
            boards: card_boards(conn, id)?,
            sections: card_sections(conn, id)?,
            items,
            width: size.map(|s| s.0),
            height: size.map(|s| s.1),
            link_count,
            item_count,
            created_at,
            updated_at,
        });
    }
    Ok(out)
}
