//! BibTeX-style citation keys (see `Design/Markdown Language.md`「引用鍵」「書目格式」).
//!
//! - Every item has `items.cite_key`: the first author's surname + year for literature
//!   (`kahneman2011`, `王2020`), the file name for files (`會議紀錄-2026-11`); duplicates get
//!   `a`, `b`, `c`…. Keys follow the item's data until the key is used in a card or set by hand
//!   (`cite_key_manual`); after that they never change by themselves.
//! - An annotation's key is its item's key + `:h<n>` (highlight) or `:b<n>` (bookmark), where `n` is
//!   `annotations.seq`, numbered per item and kind in creation order and never reused.
//! - Changing a key by hand rewrites `@old` in every card's text.

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::db::primary_role;
use crate::drawer::{is_file_type, like_pattern, now_ms, Creator, DrawerState, Error, Result};

// ---------- keys ----------

/// Characters a key may contain (besides the `:` of annotation keys).
pub fn is_key_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '-' || c == '.'
}

fn is_cjk(c: char) -> bool {
    matches!(c as u32,
        0x3040..=0x30FF | 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF | 0xAC00..=0xD7AF | 0x20000..=0x2FFFF)
}

/// Checks a key typed by hand.
pub fn check_key(key: &str) -> Result<()> {
    let ok = !key.is_empty()
        && key.chars().count() <= 80
        && key.chars().all(is_key_char)
        && key.chars().next().is_some_and(|c| c.is_alphanumeric() || c == '_')
        && key.chars().last().is_some_and(|c| c.is_alphanumeric() || c == '_');
    if ok {
        Ok(())
    } else {
        Err(Error("引用鍵只能有中英文、數字與 - _ .，開頭和結尾要是文字或數字".into()))
    }
}

/// Latin letters with accents → plain ASCII (`García` → `garcia`).
fn fold(c: char) -> char {
    match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' => 'a',
        'ç' | 'ć' | 'č' => 'c',
        'ď' | 'đ' => 'd',
        'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ė' | 'ę' | 'ě' => 'e',
        'ì' | 'í' | 'î' | 'ï' | 'ī' | 'į' | 'ı' => 'i',
        'ł' | 'ľ' | 'ĺ' => 'l',
        'ñ' | 'ń' | 'ň' => 'n',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' | 'ő' => 'o',
        'ŕ' | 'ř' => 'r',
        'ś' | 'š' | 'ş' | 'ș' => 's',
        'ť' | 'ţ' | 'ț' => 't',
        'ù' | 'ú' | 'û' | 'ü' | 'ū' | 'ů' | 'ű' | 'ų' => 'u',
        'ý' | 'ÿ' => 'y',
        'ź' | 'ż' | 'ž' => 'z',
        'ß' => 's',
        _ => c,
    }
}

/// Text → key characters: lower case, accents removed, anything else dropped.
fn key_part(s: &str) -> String {
    s.chars()
        .flat_map(|c| c.to_lowercase())
        .map(fold)
        .filter(|c| c.is_alphanumeric())
        .collect()
}

const COMPOUND_SURNAMES: &[&str] = &[
    "歐陽", "司馬", "上官", "諸葛", "東方", "皇甫", "夏侯", "司徒", "尉遲", "公孫", "令狐", "長孫", "慕容", "宇文", "軒轅", "端木", "澹臺", "申屠",
];

/// The family name: before a comma (`Kahneman, Daniel`), the last word (`Daniel Kahneman`), or,
/// for Chinese / Japanese / Korean names, the first character (two for compound surnames).
fn surname(name: &str) -> String {
    let n = name.trim();
    if let Some((family, _)) = n.split_once(',') {
        return family.trim().to_string();
    }
    if n.chars().next().is_some_and(is_cjk) {
        let two: String = n.chars().take(2).collect();
        if COMPOUND_SURNAMES.contains(&two.as_str()) {
            return two;
        }
        return n.chars().take(1).collect();
    }
    n.split_whitespace().last().unwrap_or("").to_string()
}

fn year_of(date: &str) -> String {
    let digits: Vec<char> = date.chars().collect();
    for i in 0..digits.len() {
        if i + 4 <= digits.len() && digits[i..i + 4].iter().all(|c| c.is_ascii_digit()) {
            let before = i > 0 && digits[i - 1].is_ascii_digit();
            let after = i + 4 < digits.len() && digits[i + 4].is_ascii_digit();
            if !before && !after {
                return digits[i..i + 4].iter().collect();
            }
        }
    }
    String::new()
}

const STOP_WORDS: &[&str] = &["the", "a", "an", "on", "of", "in", "and", "to", "for"];

/// The first word of a title (CJK: up to four characters).
fn title_word(title: &str) -> String {
    let t = title.trim();
    if t.chars().next().is_some_and(is_cjk) {
        return t.chars().take_while(|c| c.is_alphanumeric()).take(4).collect();
    }
    t.split(|c: char| !c.is_alphanumeric())
        .map(key_part)
        .find(|w| !w.is_empty() && !STOP_WORDS.contains(&w.as_str()))
        .unwrap_or_default()
}

/// The key an item would get from its data (before making it unique).
pub fn base_key(item_type: &str, title: &str, first_creator: Option<&str>, date: &str) -> String {
    if is_file_type(item_type) {
        let mut out = String::new();
        for c in title.trim().chars() {
            if is_key_char(c) && c != '.' {
                out.push(c);
            } else if !out.ends_with('-') {
                out.push('-');
            }
        }
        let out = out.trim_matches(|c| c == '-' || c == '_').to_string();
        return if out.is_empty() { "file".into() } else { out };
    }
    let mut part = first_creator.map(|n| key_part(&surname(n))).unwrap_or_default();
    if part.is_empty() {
        part = title_word(title);
    }
    let key = format!("{part}{}", year_of(date));
    if key.is_empty() { "item".into() } else { key }
}

fn suffix(n: usize) -> String {
    // a … z, aa, ab …
    let mut n = n;
    let mut s = Vec::new();
    loop {
        s.push((b'a' + (n % 26) as u8) as char);
        if n < 26 {
            break;
        }
        n = n / 26 - 1;
    }
    s.iter().rev().collect()
}

fn key_taken(conn: &Connection, key: &str, except: i64) -> rusqlite::Result<bool> {
    conn.query_row("SELECT EXISTS (SELECT 1 FROM items WHERE cite_key = ?1 AND id <> ?2)", params![key, except], |r| r.get(0))
}

/// `base`, or `base` + a, b, c… — the first one no other item has.
fn unique_key(conn: &Connection, base: &str, except: i64) -> rusqlite::Result<String> {
    if !key_taken(conn, base, except)? {
        return Ok(base.to_string());
    }
    for i in 0.. {
        let k = format!("{base}{}", suffix(i));
        if !key_taken(conn, &k, except)? {
            return Ok(k);
        }
    }
    unreachable!()
}

/// Whether any card's text mentions `@key`.
fn key_used(conn: &Connection, key: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        r"SELECT EXISTS (SELECT 1 FROM cards WHERE content LIKE ?1 ESCAPE '\')
                OR EXISTS (SELECT 1 FROM desk_documents WHERE markdown LIKE ?1 ESCAPE '\')",
        [like_pattern(&format!("@{key}"))],
        |r| r.get(0),
    )
}

fn first_creator(conn: &Connection, id: i64, item_type: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT name FROM item_creators WHERE item_id = ?1 ORDER BY role <> ?2, position, id LIMIT 1",
        params![id, primary_role(item_type)],
        |r| r.get(0),
    )
    .optional()
}

/// Gives the item a key, or updates an automatic key that no card uses yet to follow the
/// item's data. Hand-set keys and keys already cited stay.
pub fn refresh_cite_key(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    let row: Option<(String, String, String, String, bool)> = conn
        .query_row(
            "SELECT item_type, title, date, cite_key, cite_key_manual FROM items WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get::<_, i64>(4)? != 0)),
        )
        .optional()?;
    let Some((item_type, title, date, current, manual)) = row else { return Ok(()) };
    if manual {
        return Ok(());
    }
    let base = base_key(&item_type, &title, first_creator(conn, id, &item_type)?.as_deref(), &date);
    if !current.is_empty() {
        let rest = current.strip_prefix(base.as_str());
        let fits = rest.is_some_and(|r| r.chars().all(|c| c.is_ascii_lowercase()) && r.len() <= 2);
        if fits || key_used(conn, &current)? {
            return Ok(());
        }
    }
    let key = unique_key(conn, &base, id)?;
    conn.execute("UPDATE items SET cite_key = ?1 WHERE id = ?2", params![key, id])?;
    Ok(())
}

/// Next free number for a new annotation of `kind` on the item the attachment belongs to.
pub fn next_annotation_seq(conn: &Connection, attachment_id: i64, kind: &str) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COALESCE(MAX(a.seq), 0) + 1 FROM annotations a JOIN attachments t ON t.id = a.attachment_id
         WHERE t.item_id = (SELECT item_id FROM attachments WHERE id = ?1) AND a.kind = ?2",
        params![attachment_id, kind],
        |r| r.get(0),
    )
}

/// Gives keys to items without one and numbers annotations without a number.
pub fn fill_missing(conn: &Connection) -> rusqlite::Result<()> {
    let ids = conn
        .prepare("SELECT id FROM items WHERE cite_key = '' ORDER BY id")?
        .query_map([], |r| r.get::<_, i64>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for id in ids {
        refresh_cite_key(conn, id)?;
    }
    let pending = conn
        .prepare("SELECT id, attachment_id, kind FROM annotations WHERE seq = 0 ORDER BY created_at, id")?
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (id, attachment, kind) in pending {
        let seq = next_annotation_seq(conn, attachment, &kind)?;
        conn.execute("UPDATE annotations SET seq = ?1 WHERE id = ?2", params![seq, id])?;
    }
    Ok(())
}

/// `kahneman2011` → (item, None); `kahneman2011:h3` → (item, Some(annotation)).
pub fn lookup(conn: &Connection, key: &str) -> rusqlite::Result<Option<(i64, Option<i64>)>> {
    let key = key.trim().trim_start_matches('@');
    if let Some((base, tail)) = key.rsplit_once(':') {
        let kind = match tail.chars().next() {
            Some('h') => "highlight",
            Some('b') => "bookmark",
            _ => return Ok(None),
        };
        let Ok(seq) = tail[1..].parse::<i64>() else { return Ok(None) };
        return conn
            .query_row(
                "SELECT i.id, a.id FROM annotations a JOIN attachments t ON t.id = a.attachment_id JOIN items i ON i.id = t.item_id
                 WHERE i.cite_key = ?1 AND a.kind = ?2 AND a.seq = ?3",
                params![base, kind, seq],
                |r| Ok((r.get(0)?, Some(r.get(1)?))),
            )
            .optional();
    }
    conn.query_row("SELECT id FROM items WHERE cite_key = ?1", [key], |r| Ok((r.get(0)?, None))).optional()
}

// ---------- what the frontend gets ----------

/// An item as citations and BibTeX need it.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CiteItem {
    id: i64,
    cite_key: String,
    item_type: String,
    /// Role whose names are the item's "authors" for this type (author, director…).
    primary_role: String,
    title: String,
    creators: Vec<Creator>,
    date: String,
    publication: String,
    volume: String,
    issue: String,
    pages: String,
    publisher: String,
    place: String,
    doi: String,
    isbn: String,
    url: String,
    series: String,
    series_number: String,
    running_time: String,
    medium: String,
    dimensions: String,
    catalog_number: String,
    abstract_note: String,
    tags: Vec<String>,
}

const ITEM_COLUMNS: &str = "id, cite_key, item_type, title, date, publication, volume, issue, pages, publisher, place, doi, isbn, url,
     series, series_number, running_time, medium, dimensions, catalog_number, abstract_note";

fn load_item(conn: &Connection, id: i64) -> rusqlite::Result<Option<CiteItem>> {
    let item = conn
        .query_row(&format!("SELECT {ITEM_COLUMNS} FROM items WHERE id = ?1"), [id], |r| {
            let item_type: String = r.get(2)?;
            Ok(CiteItem {
                id: r.get(0)?,
                cite_key: r.get(1)?,
                primary_role: primary_role(&item_type).to_string(),
                item_type,
                title: r.get(3)?,
                creators: Vec::new(),
                date: r.get(4)?,
                publication: r.get(5)?,
                volume: r.get(6)?,
                issue: r.get(7)?,
                pages: r.get(8)?,
                publisher: r.get(9)?,
                place: r.get(10)?,
                doi: r.get(11)?,
                isbn: r.get(12)?,
                url: r.get(13)?,
                series: r.get(14)?,
                series_number: r.get(15)?,
                running_time: r.get(16)?,
                medium: r.get(17)?,
                dimensions: r.get(18)?,
                catalog_number: r.get(19)?,
                abstract_note: r.get(20)?,
                tags: Vec::new(),
            })
        })
        .optional()?;
    let Some(mut item) = item else { return Ok(None) };
    item.creators = conn
        .prepare("SELECT role, name FROM item_creators WHERE item_id = ?1 ORDER BY position, id")?
        .query_map([id], |r| Ok(Creator { role: r.get(0)?, name: r.get(1)? }))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    item.tags = conn
        .prepare("SELECT t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = ?1 ORDER BY t.name")?
        .query_map([id], |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Some(item))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CiteAnnotation {
    id: i64,
    kind: String,
    color: String,
    quote: String,
    note: String,
    location: String,
    attachment_id: i64,
    file_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CiteEntry {
    /// The key as asked (`kahneman2011` or `kahneman2011:h3`).
    key: String,
    item: CiteItem,
    annotation: Option<CiteAnnotation>,
}

/// An annotation's key (`kahneman2011:h3`), e.g. to write `[@…]` when it is dragged onto a card.
/// None when the annotation is unknown or its item has no key yet.
#[tauri::command]
pub fn annotation_cite_key(state: State<'_, DrawerState>, id: i64) -> Result<Option<String>> {
    let lib = state.lock();
    let row = lib
        .conn
        .query_row(
            "SELECT i.cite_key, a.kind, a.seq FROM annotations a
             JOIN attachments t ON t.id = a.attachment_id JOIN items i ON i.id = t.item_id
             WHERE a.id = ?1",
            [id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?)),
        )
        .optional()?;
    Ok(row.and_then(|(key, kind, seq)| {
        (!key.is_empty() && seq > 0).then(|| format!("{key}:{}{seq}", if kind == "bookmark" { "b" } else { "h" }))
    }))
}

/// What each key cites. Unknown keys are left out.
#[tauri::command]
pub fn resolve_cite_keys(state: State<'_, DrawerState>, keys: Vec<String>) -> Result<Vec<CiteEntry>> {
    let lib = state.lock();
    let conn = &lib.conn;
    fill_missing(conn)?;
    let mut out = Vec::new();
    let mut items: HashMap<i64, CiteItem> = HashMap::new();
    for key in keys {
        let key = key.trim().trim_start_matches('@').to_string();
        let Some((item_id, annotation_id)) = lookup(conn, &key)? else { continue };
        let item = match items.get(&item_id) {
            Some(i) => i.clone(),
            None => {
                let Some(i) = load_item(conn, item_id)? else { continue };
                items.insert(item_id, i.clone());
                i
            }
        };
        let annotation = match annotation_id {
            Some(aid) => conn
                .query_row(
                    "SELECT a.id, a.kind, a.color, a.quote, a.note, a.location, a.attachment_id, t.file_name
                     FROM annotations a JOIN attachments t ON t.id = a.attachment_id WHERE a.id = ?1",
                    [aid],
                    |r| {
                        Ok(CiteAnnotation {
                            id: r.get(0)?,
                            kind: r.get(1)?,
                            color: r.get(2)?,
                            quote: r.get(3)?,
                            note: r.get(4)?,
                            location: r.get(5)?,
                            attachment_id: r.get(6)?,
                            file_name: r.get(7)?,
                        })
                    },
                )
                .optional()?,
            None => None,
        };
        out.push(CiteEntry { key, item, annotation });
    }
    Ok(out)
}

/// One suggestion while typing `@`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CiteHit {
    key: String,
    item_id: i64,
    item_type: String,
    title: String,
    authors: String,
    date: String,
    /// For an annotation: its quote, kind and colour.
    quote: Option<String>,
    kind: Option<String>,
    color: Option<String>,
}

/// Items (both libraries) whose key, title or creators match, then annotations whose quote or
/// note matches. An empty query lists recently edited items.
#[tauri::command]
pub fn search_citables(state: State<'_, DrawerState>, query: String, limit: Option<i64>) -> Result<Vec<CiteHit>> {
    let lib = state.lock();
    let conn = &lib.conn;
    fill_missing(conn)?;
    let limit = limit.unwrap_or(12).clamp(1, 100);
    let q = query.trim().trim_start_matches('@');
    let pattern = like_pattern(q);
    let prefix = format!("{}%", &pattern[1..]);
    let mut hits = conn
        .prepare(
            r"SELECT cite_key, id, item_type, title, authors, date FROM items
              WHERE cite_key <> '' AND (?1 = '' OR cite_key LIKE ?2 ESCAPE '\' OR title LIKE ?3 ESCAPE '\' OR authors LIKE ?3 ESCAPE '\')
              ORDER BY (cite_key LIKE ?2 ESCAPE '\') DESC, updated_at DESC LIMIT ?4",
        )?
        .query_map(params![q, prefix, pattern, limit], |r| {
            Ok(CiteHit {
                key: r.get(0)?,
                item_id: r.get(1)?,
                item_type: r.get(2)?,
                title: r.get(3)?,
                authors: r.get(4)?,
                date: r.get(5)?,
                quote: None,
                kind: None,
                color: None,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if !q.is_empty() {
        let annotations = conn
            .prepare(
                r"SELECT i.cite_key, a.kind, a.seq, i.id, i.item_type, i.title, i.authors, i.date, a.quote, a.color
                  FROM annotations a JOIN attachments t ON t.id = a.attachment_id JOIN items i ON i.id = t.item_id
                  WHERE i.cite_key <> '' AND (a.quote LIKE ?1 ESCAPE '\' OR a.note LIKE ?1 ESCAPE '\')
                  ORDER BY a.updated_at DESC LIMIT 6",
            )?
            .query_map([&pattern], |r| {
                let kind: String = r.get(1)?;
                let seq: i64 = r.get(2)?;
                let base: String = r.get(0)?;
                Ok(CiteHit {
                    key: format!("{base}:{}{seq}", if kind == "bookmark" { "b" } else { "h" }),
                    item_id: r.get(3)?,
                    item_type: r.get(4)?,
                    title: r.get(5)?,
                    authors: r.get(6)?,
                    date: r.get(7)?,
                    quote: Some(r.get(8)?),
                    kind: Some(kind),
                    color: Some(r.get(9)?),
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        hits.extend(annotations);
    }
    Ok(hits)
}

/// Rewrites `@old` (not followed by more key characters) as `@new` in `text`.
pub fn rewrite_key(text: &str, old: &str, new: &str) -> String {
    let needle = format!("@{old}");
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find(&needle) {
        let after = &rest[i + needle.len()..];
        let boundary = !after.chars().next().is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '-' || (c == '.' && after[1..].chars().next().is_some_and(char::is_alphanumeric)));
        let before_ok = rest[..i].chars().last().is_none_or(|c| !(c.is_ascii_alphanumeric()));
        out.push_str(&rest[..i]);
        if boundary && before_ok {
            out.push('@');
            out.push_str(new);
        } else {
            out.push_str(&needle);
        }
        rest = after;
    }
    out.push_str(rest);
    out
}

/// Sets an item's key by hand and rewrites `@old` in every card. Returns the key.
#[tauri::command]
pub fn set_cite_key(state: State<'_, DrawerState>, item_id: i64, key: String) -> Result<String> {
    let key = key.trim().trim_start_matches('@').to_string();
    check_key(&key)?;
    let mut lib = state.lock();
    let conn = &mut lib.conn;
    let old: String = conn
        .query_row("SELECT cite_key FROM items WHERE id = ?1", [item_id], |r| r.get(0))
        .optional()?
        .ok_or_else(|| Error("找不到這個條目".into()))?;
    if key_taken(conn, &key, item_id)? {
        return Err(Error(format!("引用鍵「{key}」已經有其他條目使用")));
    }
    let tx = conn.transaction()?;
    tx.execute("UPDATE items SET cite_key = ?1, cite_key_manual = 1 WHERE id = ?2", params![key, item_id])?;
    if !old.is_empty() && old != key {
        let pattern = like_pattern(&format!("@{old}"));
        let cards = tx
            .prepare(r"SELECT id, content FROM cards WHERE content LIKE ?1 ESCAPE '\'")?
            .query_map([&pattern], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (id, content) in cards {
            let updated = rewrite_key(&content, &old, &key);
            if updated != content {
                tx.execute("UPDATE cards SET content = ?1 WHERE id = ?2", params![updated, id])?;
            }
        }
        let documents = tx
            .prepare(r"SELECT id, markdown FROM desk_documents WHERE markdown LIKE ?1 ESCAPE '\'")?
            .query_map([&pattern], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (id, markdown) in documents {
            let updated = rewrite_key(&markdown, &old, &key);
            if updated != markdown {
                tx.execute("UPDATE desk_documents SET markdown = ?1 WHERE id = ?2", params![updated, id])?;
            }
        }
    }
    tx.commit()?;
    Ok(key)
}

/// Items for BibTeX export: the given ids, or every item of a library ("literature" / "files"),
/// or everything.
#[tauri::command]
pub fn list_cite_items(state: State<'_, DrawerState>, ids: Option<Vec<i64>>, library: Option<String>) -> Result<Vec<CiteItem>> {
    let lib = state.lock();
    let conn = &lib.conn;
    fill_missing(conn)?;
    let ids = match ids {
        Some(ids) => ids,
        None => conn
            .prepare("SELECT id, item_type FROM items ORDER BY cite_key")?
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?
            .into_iter()
            .filter(|(_, t)| library.as_deref().is_none_or(|l| crate::drawer::library_of(t) == l))
            .map(|(id, _)| id)
            .collect(),
    };
    let mut out = Vec::new();
    for id in ids {
        if let Some(item) = load_item(conn, id)? {
            out.push(item);
        }
    }
    Ok(out)
}

/// One entry from a `.bib` file, already mapped to Banyan's fields by the frontend.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportItem {
    item_type: String,
    cite_key: String,
    #[serde(default)]
    fields: HashMap<String, String>,
    #[serde(default)]
    creators: Vec<Creator>,
    #[serde(default)]
    tags: Vec<String>,
}

const IMPORT_FIELDS: &[&str] = &[
    "title", "date", "publication", "volume", "issue", "pages", "publisher", "place", "doi", "isbn", "url", "series",
    "series_number", "running_time", "medium", "dimensions", "catalog_number", "abstract_note",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    /// Keys of the new items, in order (renamed when taken: `smith2020` → `smith2020a`).
    keys: Vec<String>,
    /// How many keys had to change because another item had them.
    renamed: usize,
}

/// Creates literature items from BibTeX entries (into a folder when given). Keys are kept when free.
#[tauri::command]
pub fn import_items(state: State<'_, DrawerState>, entries: Vec<ImportItem>, collection_id: Option<i64>) -> Result<ImportResult> {
    let mut lib = state.lock();
    let conn = &mut lib.conn;
    let tx = conn.transaction()?;
    let now = now_ms();
    let mut keys = Vec::new();
    let mut renamed = 0;
    for e in entries {
        if is_file_type(&e.item_type) {
            return Err(Error("只能匯入文獻庫的條目".into()));
        }
        tx.execute("INSERT INTO items (item_type, created_at, updated_at) VALUES (?1, ?2, ?2)", params![e.item_type, now])?;
        let id = tx.last_insert_rowid();
        for (field, value) in &e.fields {
            if IMPORT_FIELDS.contains(&field.as_str()) {
                tx.execute(&format!("UPDATE items SET {field} = ?1 WHERE id = ?2"), params![value.trim(), id])?;
            }
        }
        for (pos, c) in e.creators.iter().filter(|c| !c.name.trim().is_empty()).enumerate() {
            let role = if c.role.trim().is_empty() { "author" } else { c.role.trim() };
            tx.execute(
                "INSERT INTO item_creators (item_id, position, role, name) VALUES (?1, ?2, ?3, ?4)",
                params![id, pos as i64, role, c.name.trim()],
            )?;
        }
        tx.execute(
            "UPDATE items SET authors = (SELECT COALESCE(group_concat(name, char(10)), '') FROM
                 (SELECT name FROM item_creators WHERE item_id = ?1 ORDER BY role <> ?2, position)) WHERE id = ?1",
            params![id, primary_role(&e.item_type)],
        )?;
        for tag in e.tags.iter().map(|t| t.trim()).filter(|t| !t.is_empty()) {
            tx.execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", [tag])?;
            tx.execute(
                "INSERT OR IGNORE INTO item_tags (item_id, tag_id) SELECT ?1, id FROM tags WHERE name = ?2 COLLATE NOCASE",
                params![id, tag],
            )?;
        }
        if let Some(cid) = collection_id {
            tx.execute("INSERT OR IGNORE INTO item_collections (item_id, collection_id) VALUES (?1, ?2)", params![id, cid])?;
        }
        let wanted = e.cite_key.trim().trim_start_matches('@');
        let key = if check_key(wanted).is_ok() {
            let k = unique_key(&tx, wanted, id)?;
            if k != wanted {
                renamed += 1;
            }
            tx.execute("UPDATE items SET cite_key = ?1, cite_key_manual = 1 WHERE id = ?2", params![k, id])?;
            k
        } else {
            refresh_cite_key(&tx, id)?;
            tx.query_row("SELECT cite_key FROM items WHERE id = ?1", [id], |r| r.get(0))?
        };
        keys.push(key);
    }
    tx.commit()?;
    Ok(ImportResult { keys, renamed })
}

/// Asks where to save and writes the text there (a `.bib` export). None when cancelled.
#[tauri::command]
pub async fn save_text_file(app: AppHandle, default_name: String, content: String) -> Result<Option<String>> {
    let Some(path) = app
        .dialog()
        .file()
        .set_title("匯出 BibTeX")
        .set_file_name(&default_name)
        .add_filter("BibTeX", &["bib"])
        .blocking_save_file()
        .and_then(|f| f.into_path().ok())
    else {
        return Ok(None);
    };
    std::fs::write(&path, content)?;
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Asks for a `.bib` file and returns its text (UTF-8; a BOM is dropped). None when cancelled.
#[tauri::command]
pub async fn open_bib_file(app: AppHandle) -> Result<Option<String>> {
    let Some(path) = app
        .dialog()
        .file()
        .set_title("匯入 BibTeX")
        .add_filter("BibTeX", &["bib", "bibtex", "txt"])
        .blocking_pick_file()
        .and_then(|f| f.into_path().ok())
    else {
        return Ok(None);
    };
    let bytes = std::fs::read(&path)?;
    let text = String::from_utf8(bytes).map_err(|_| Error("這個檔案不是 UTF-8 編碼的文字".into()))?;
    Ok(Some(text.trim_start_matches('\u{feff}').to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_keys() {
        assert_eq!(base_key("book", "Thinking, Fast and Slow", Some("Kahneman, Daniel"), "2011-10-25"), "kahneman2011");
        assert_eq!(base_key("book", "x", Some("Gabriel García Márquez"), "1967"), "marquez1967");
        assert_eq!(base_key("book", "x", Some("García Márquez, Gabriel"), "1967"), "garciamarquez1967");
        assert_eq!(base_key("book", "x", Some("王小明"), "2020 年"), "王2020");
        assert_eq!(base_key("book", "x", Some("歐陽修"), ""), "歐陽");
        assert_eq!(base_key("journalArticle", "The Nature of Things", None, "1999"), "nature1999");
        assert_eq!(base_key("book", "思考的藝術與方法", None, ""), "思考的藝");
        assert_eq!(base_key("book", "", None, ""), "item");
        assert_eq!(base_key("fileDocument", "會議紀錄 2026-11", None, ""), "會議紀錄-2026-11");
        assert_eq!(base_key("fileImage", "  ", None, ""), "file");
    }

    #[test]
    fn suffixes() {
        assert_eq!(suffix(0), "a");
        assert_eq!(suffix(25), "z");
        assert_eq!(suffix(26), "aa");
    }

    #[test]
    fn rewrites_only_whole_keys() {
        let t = "見 [@smith2020, p. 3] 與 @smith2020:h2，不是 @smith2020a 也不是 a@smith2020.com";
        assert_eq!(
            rewrite_key(t, "smith2020", "smith2021"),
            "見 [@smith2021, p. 3] 與 @smith2021:h2，不是 @smith2020a 也不是 a@smith2020.com"
        );
    }

    #[test]
    fn checks_keys() {
        assert!(check_key("kahneman2011").is_ok());
        assert!(check_key("王2020").is_ok());
        assert!(check_key("a.b-c_d").is_ok());
        assert!(check_key("").is_err());
        assert!(check_key("a b").is_err());
        assert!(check_key("a:b").is_err());
        assert!(check_key("-a").is_err());
    }
}
