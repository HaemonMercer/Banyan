//! Annotator: highlights, notes and bookmarks in PDFs and books.
//!
//! An annotation belongs to a file (an attachment). A 文獻庫 attachment and its 檔案庫 copy share
//! one file, so they share annotations too: everything is stored against the original attachment
//! (`mirror_of`, or the attachment itself). Where in the file it is (`location`) is JSON written
//! by the reader (see `AnnotationLocation` in src/annotator/api.ts): PDF highlights keep their
//! rectangles as page fractions, book highlights character offsets in the chapter's text,
//! bookmarks a page or a chapter and how far into it.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::State;

use crate::drawer::{now_ms, DrawerState, Error, Result};

/// Highlight colors the reader offers.
pub const COLORS: [&str; 5] = ["yellow", "green", "blue", "pink", "purple"];
/// File extensions the Annotator can open (PDFs and books).
pub const EXTENSIONS: [&str; 9] = ["pdf", "epub", "mobi", "azw", "azw3", "prc", "fb2", "fbz", "txt"];

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    id: i64,
    /// The original attachment (shared by its 檔案庫 copy).
    attachment_id: i64,
    /// "highlight" or "bookmark".
    kind: String,
    color: String,
    quote: String,
    note: String,
    /// JSON, see the module comment.
    location: String,
    /// Orders annotations as they appear in the file.
    sort_key: f64,
    card_id: Option<i64>,
    created_at: i64,
    updated_at: i64,
    /// How many cards cite it.
    card_count: i64,
}

const COLUMNS: &str = "id, attachment_id, kind, color, quote, note, location, sort_key, card_id, created_at, updated_at,
     (SELECT COUNT(*) FROM card_annotations ca WHERE ca.annotation_id = annotations.id)";

impl Annotation {
    fn from_row(r: &rusqlite::Row) -> rusqlite::Result<Self> {
        Ok(Annotation {
            id: r.get(0)?,
            attachment_id: r.get(1)?,
            kind: r.get(2)?,
            color: r.get(3)?,
            quote: r.get(4)?,
            note: r.get(5)?,
            location: r.get(6)?,
            sort_key: r.get(7)?,
            card_id: r.get(8)?,
            created_at: r.get(9)?,
            updated_at: r.get(10)?,
            card_count: r.get(11)?,
        })
    }
}

/// The attachment whose file this is: the 文獻庫 original for a 檔案庫 copy.
pub(crate) fn original_attachment(conn: &Connection, attachment_id: i64) -> Result<i64> {
    conn.query_row("SELECT COALESCE(mirror_of, id) FROM attachments WHERE id = ?1", [attachment_id], |r| r.get(0))
        .optional()?
        .ok_or_else(|| Error("找不到這個檔案".into()))
}

fn load(conn: &Connection, id: i64) -> Result<Annotation> {
    conn.query_row(&format!("SELECT {COLUMNS} FROM annotations WHERE id = ?1"), [id], Annotation::from_row)
        .optional()?
        .ok_or_else(|| Error("找不到這個註解".into()))
}

fn check_color(color: &str) -> Result<()> {
    if COLORS.contains(&color) { Ok(()) } else { Err(Error(format!("未知的顏色：{color}"))) }
}

/// The file's annotations, in the order they appear in it.
#[tauri::command]
pub fn list_annotations(state: State<'_, DrawerState>, attachment_id: i64) -> Result<Vec<Annotation>> {
    let lib = state.lock();
    let original = original_attachment(&lib.conn, attachment_id)?;
    let rows = lib
        .conn
        .prepare(&format!(
            "SELECT {COLUMNS} FROM annotations WHERE attachment_id = ?1 ORDER BY sort_key, created_at, id"
        ))?
        .query_map([original], Annotation::from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn create_annotation(
    state: State<'_, DrawerState>,
    attachment_id: i64,
    kind: String,
    color: String,
    quote: String,
    note: String,
    location: String,
    sort_key: f64,
) -> Result<Annotation> {
    if kind != "highlight" && kind != "bookmark" {
        return Err(Error(format!("未知的註解種類：{kind}")));
    }
    check_color(&color)?;
    if serde_json::from_str::<serde_json::Value>(&location).is_err() {
        return Err(Error("註解的位置格式不正確".into()));
    }
    let lib = state.lock();
    let conn = &lib.conn;
    let original = original_attachment(conn, attachment_id)?;
    let now = now_ms();
    conn.execute(
        "INSERT INTO annotations (attachment_id, kind, color, quote, note, location, sort_key, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![original, kind, color, quote.trim(), note.trim(), location, sort_key, now],
    )?;
    load(conn, conn.last_insert_rowid())
}

/// Changes the color and / or the note (only what's given).
#[tauri::command]
pub fn update_annotation(
    state: State<'_, DrawerState>,
    id: i64,
    color: Option<String>,
    note: Option<String>,
) -> Result<Annotation> {
    if let Some(c) = &color {
        check_color(c)?;
    }
    let lib = state.lock();
    let conn = &lib.conn;
    load(conn, id)?;
    conn.execute(
        "UPDATE annotations SET color = COALESCE(?1, color), note = COALESCE(?2, note), updated_at = ?3 WHERE id = ?4",
        params![color, note.map(|n| n.trim().to_string()), now_ms(), id],
    )?;
    load(conn, id)
}

/// Deletes the annotation. A card made from it stays (it is the user's own note by then).
#[tauri::command]
pub fn delete_annotation(state: State<'_, DrawerState>, id: i64) -> Result<()> {
    let lib = state.lock();
    lib.conn.execute("DELETE FROM annotations WHERE id = ?1", [id])?;
    Ok(())
}

/// A file the Annotator can open, with how many annotations it has.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotatableFile {
    attachment_id: i64,
    file_name: String,
    size: i64,
    item_id: i64,
    item_title: String,
    item_type: String,
    annotation_count: i64,
    /// When it was last annotated (0 = never).
    last_annotated: i64,
}

/// Every PDF and book in the library (files of both 文獻庫 and 檔案庫, each file once).
#[tauri::command]
pub fn list_annotatable_files(state: State<'_, DrawerState>) -> Result<Vec<AnnotatableFile>> {
    let lib = state.lock();
    let ext_match = EXTENSIONS.map(|e| format!("lower(a.file_name) LIKE '%.{e}'")).join(" OR ");
    let rows = lib
        .conn
        .prepare(&format!(
            "SELECT a.id, a.file_name, a.size, i.id, i.title, i.item_type,
                    (SELECT COUNT(*) FROM annotations n WHERE n.attachment_id = a.id),
                    (SELECT COALESCE(MAX(n.updated_at), 0) FROM annotations n WHERE n.attachment_id = a.id)
             FROM attachments a JOIN items i ON i.id = a.item_id
             WHERE a.mirror_of IS NULL AND ({ext_match})
             ORDER BY 8 DESC, i.updated_at DESC"
        ))?
        .query_map([], |r| {
            Ok(AnnotatableFile {
                attachment_id: r.get(0)?,
                file_name: r.get(1)?,
                size: r.get(2)?,
                item_id: r.get(3)?,
                item_title: r.get(4)?,
                item_type: r.get(5)?,
                annotation_count: r.get(6)?,
                last_annotated: r.get(7)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// An annotation with the file and item it belongs to (the overview, and jumping back from a card).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationInFile {
    #[serde(flatten)]
    annotation: Annotation,
    file_name: String,
    item_id: i64,
    item_title: String,
}

const IN_FILE: &str = "SELECT n.id, n.attachment_id, n.kind, n.color, n.quote, n.note, n.location, n.sort_key, n.card_id,
                              n.created_at, n.updated_at,
                              (SELECT COUNT(*) FROM card_annotations ca WHERE ca.annotation_id = n.id),
                              a.file_name, i.id, i.title
                       FROM annotations n JOIN attachments a ON a.id = n.attachment_id JOIN items i ON i.id = a.item_id";

fn in_file_row(r: &rusqlite::Row) -> rusqlite::Result<AnnotationInFile> {
    Ok(AnnotationInFile {
        annotation: Annotation::from_row(r)?,
        file_name: r.get(12)?,
        item_id: r.get(13)?,
        item_title: r.get(14)?,
    })
}

/// All annotations, newest first; with a query, those whose quote, note, file or item matches.
#[tauri::command]
pub fn search_annotations(state: State<'_, DrawerState>, query: String) -> Result<Vec<AnnotationInFile>> {
    let lib = state.lock();
    let q = query.trim();
    let pattern = crate::drawer::like_pattern(q);
    let rows = lib
        .conn
        .prepare(&format!(
            "{IN_FILE} WHERE ?1 = '' OR n.quote LIKE ?2 ESCAPE '\\' OR n.note LIKE ?2 ESCAPE '\\'
                 OR a.file_name LIKE ?2 ESCAPE '\\' OR i.title LIKE ?2 ESCAPE '\\'
             ORDER BY n.updated_at DESC LIMIT 2000"
        ))?
        .query_map(params![q, pattern], in_file_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn get_annotation(state: State<'_, DrawerState>, id: i64) -> Result<AnnotationInFile> {
    let lib = state.lock();
    lib.conn
        .query_row(&format!("{IN_FILE} WHERE n.id = ?1"), [id], in_file_row)
        .optional()?
        .ok_or_else(|| Error("找不到這個註解（可能已被刪除）".into()))
}

/// Text of a card made from an annotation: the quote, where it is from, and the note.
/// (The card also cites the annotation, so its references lead back to the place in the file.)
pub fn card_content(quote: &str, note: &str, source: &str) -> String {
    let mut text = String::new();
    if !quote.trim().is_empty() {
        text.push_str(&format!("「{}」\n", quote.trim()));
    }
    text.push_str(&format!("— {source}\n"));
    if !note.trim().is_empty() {
        text.push('\n');
        text.push_str(note.trim());
        text.push('\n');
    }
    text
}

/// Card title from a quote: its start, up to 24 characters.
fn card_title(quote: &str, item_title: &str) -> String {
    let q: String = quote.split_whitespace().collect::<Vec<_>>().join(" ");
    if q.is_empty() {
        return crate::db::note_card_title(item_title);
    }
    let short: String = q.chars().take(24).collect();
    format!("摘錄：{}{}", short, if q.chars().count() > 24 { "…" } else { "" })
}

/// Makes a card from the annotation (or returns the one made before): it quotes the passage,
/// cites the item, and links back to the place in the file. `place` says where, e.g. "第 3 頁".
#[tauri::command]
pub fn annotation_to_card(state: State<'_, DrawerState>, id: i64, place: String) -> Result<i64> {
    let mut lib = state.lock();
    let a = load(&lib.conn, id)?;
    if let Some(card) = a.card_id {
        let exists: bool = lib.conn.query_row("SELECT EXISTS (SELECT 1 FROM cards WHERE id = ?1)", [card], |r| r.get(0))?;
        if exists {
            return Ok(card);
        }
    }
    let (item_id, item_title): (i64, String) = lib.conn.query_row(
        "SELECT i.id, i.title FROM attachments a JOIN items i ON i.id = a.item_id WHERE a.id = ?1",
        [a.attachment_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let source = match (item_title.trim(), place.trim()) {
        ("", "") => "（未命名）".to_string(),
        (t, "") => format!("《{t}》"),
        ("", p) => p.to_string(),
        (t, p) => format!("《{t}》{p}"),
    };
    let title = card_title(&a.quote, &item_title);
    let content = card_content(&a.quote, &a.note, &source);
    let tx = lib.conn.transaction()?;
    let now = now_ms();
    tx.execute(
        "INSERT INTO cards (title, content, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
        params![title, content, now],
    )?;
    let card = tx.last_insert_rowid();
    tx.execute(
        "INSERT OR IGNORE INTO card_items (card_id, item_id, created_at) VALUES (?1, ?2, ?3)",
        params![card, item_id, now],
    )?;
    tx.execute("UPDATE annotations SET card_id = ?1 WHERE id = ?2", params![card, id])?;
    tx.execute(
        "INSERT OR IGNORE INTO card_annotations (card_id, annotation_id, created_at) VALUES (?1, ?2, ?3)",
        params![card, id, now],
    )?;
    tx.commit()?;
    Ok(card)
}

// ---------- cards citing annotations ----------

/// An annotation cited by a card (drawn on the card, listed in its panel).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationRef {
    annotation_id: i64,
    attachment_id: i64,
    kind: String,
    color: String,
    quote: String,
    note: String,
    location: String,
    file_name: String,
    item_id: i64,
    item_title: String,
}

/// Columns for `annotation_ref`, from `card_annotations ca` joined to the annotation's file and item.
pub(crate) const REF_SELECT: &str = "SELECT ca.card_id, n.id, n.attachment_id, n.kind, n.color, n.quote, n.note, n.location,
                                            a.file_name, i.id, i.title
                                     FROM card_annotations ca JOIN annotations n ON n.id = ca.annotation_id
                                     JOIN attachments a ON a.id = n.attachment_id JOIN items i ON i.id = a.item_id";

/// Reads (card id, reference) from a `REF_SELECT` row.
pub(crate) fn annotation_ref(r: &rusqlite::Row) -> rusqlite::Result<(i64, AnnotationRef)> {
    Ok((
        r.get(0)?,
        AnnotationRef {
            annotation_id: r.get(1)?,
            attachment_id: r.get(2)?,
            kind: r.get(3)?,
            color: r.get(4)?,
            quote: r.get(5)?,
            note: r.get(6)?,
            location: r.get(7)?,
            file_name: r.get(8)?,
            item_id: r.get(9)?,
            item_title: r.get(10)?,
        },
    ))
}

/// The annotations one card cites, in the order they were cited.
pub(crate) fn card_annotation_refs(conn: &Connection, card_id: i64) -> rusqlite::Result<Vec<AnnotationRef>> {
    conn.prepare_cached(&format!("{REF_SELECT} WHERE ca.card_id = ?1 ORDER BY ca.created_at, n.id"))?
        .query_map([card_id], annotation_ref)?
        .map(|r| r.map(|(_, a)| a))
        .collect()
}

#[tauri::command]
pub fn link_card_annotation(state: State<'_, DrawerState>, card_id: i64, annotation_id: i64) -> Result<bool> {
    let lib = state.lock();
    let conn = &lib.conn;
    let card: bool = conn.query_row("SELECT EXISTS (SELECT 1 FROM cards WHERE id = ?1)", [card_id], |r| r.get(0))?;
    if !card {
        return Err(Error("找不到這張卡片".into()));
    }
    load(conn, annotation_id)?;
    let added = conn.execute(
        "INSERT OR IGNORE INTO card_annotations (card_id, annotation_id, created_at) VALUES (?1, ?2, ?3)",
        params![card_id, annotation_id, now_ms()],
    )?;
    Ok(added > 0)
}

#[tauri::command]
pub fn unlink_card_annotation(state: State<'_, DrawerState>, card_id: i64, annotation_id: i64) -> Result<()> {
    let lib = state.lock();
    lib.conn.execute(
        "DELETE FROM card_annotations WHERE card_id = ?1 AND annotation_id = ?2",
        params![card_id, annotation_id],
    )?;
    Ok(())
}

/// A card that cites an annotation (listed under the annotation in the Annotator).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CitingCard {
    card_id: i64,
    title: String,
    /// Names of the boards it is on.
    boards: Vec<String>,
}

#[tauri::command]
pub fn list_annotation_cards(state: State<'_, DrawerState>, annotation_id: i64) -> Result<Vec<CitingCard>> {
    let lib = state.lock();
    let conn = &lib.conn;
    let cards: Vec<(i64, String)> = conn
        .prepare(
            "SELECT c.id, c.title FROM card_annotations ca JOIN cards c ON c.id = ca.card_id
             WHERE ca.annotation_id = ?1 ORDER BY ca.created_at, c.id",
        )?
        .query_map([annotation_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let mut boards = conn.prepare(
        "SELECT w.name FROM board_cards bc JOIN whiteboards w ON w.id = bc.board_id
         WHERE bc.card_id = ?1 ORDER BY w.name COLLATE NOCASE",
    )?;
    let mut out = Vec::new();
    for (card_id, title) in cards {
        let b = boards.query_map([card_id], |r| r.get(0))?.collect::<rusqlite::Result<Vec<String>>>()?;
        out.push(CitingCard { card_id, title, boards: b });
    }
    Ok(out)
}
