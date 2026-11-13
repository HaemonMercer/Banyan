//! Drawer's relation graph: what is connected to one item.
//!
//! Starting from the item, a breadth-first walk follows three kinds of connections for up to
//! `depth` steps: cards citing an item (`card_items`, or an annotation on one of its files via
//! `card_annotations`), related items (`item_relations`) and card links (`card_links`). The
//! boards the reached cards are on are added as leaf nodes (they do not extend the walk). All
//! connections among the reached nodes are returned, not only the ones the walk used.

use std::collections::{HashMap, HashSet, VecDeque};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::State;

use crate::drawer::{DrawerState, Error, Result};

/// The walk stops adding items and cards past this many (boards not counted).
const MAX_NODES: usize = 150;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    /// "i5" item 5, "c3" card 3, "b2" board 2.
    key: String,
    /// "item", "card" or "board".
    kind: &'static str,
    id: i64,
    title: String,
    /// Items: their type (`item_type`). Cards: their kind (`note`, `sticky`, …).
    subtype: String,
    /// Steps from the center (boards: one more than their nearest card).
    depth: i64,
    /// Cards: a board the card is on (for opening it there).
    board_id: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    a: String,
    b: String,
    /// "cite" card → item, "related" item – item, "link" card – card, "board" card – board.
    kind: &'static str,
    /// "cite": the card cites the item itself (not only its annotations).
    direct: bool,
    /// "cite": how many of the item's annotations the card cites.
    annotations: i64,
    /// "link": 0 no arrow, 1 a → b, 2 b → a, 3 both ways.
    direction: i64,
    /// "link": the note on the line.
    note: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemGraph {
    center: String,
    nodes: Vec<GraphNode>,
    edges: Vec<GraphEdge>,
    /// Some nodes were left out (more than `MAX_NODES`).
    truncated: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Node {
    Item(i64),
    Card(i64),
}

/// card → (item → (direct, annotation count)) for the given cards.
type Cites = HashMap<i64, HashMap<i64, (bool, i64)>>;

/// Items whose files carry the annotation: the attachment's item, and items holding a 檔案庫
/// copy of it (`mirror_of`), so a literature item and its file copy both count.
const ANNOTATION_ITEMS: &str = "SELECT DISTINCT a.item_id FROM annotations n
     JOIN attachments a ON a.id = n.attachment_id OR a.mirror_of = n.attachment_id
     WHERE n.id = ?1";

fn ids(conn: &Connection, sql: &str, id: i64) -> rusqlite::Result<Vec<i64>> {
    conn.prepare_cached(sql)?.query_map([id], |r| r.get(0))?.collect()
}

/// Neighbours of a node for the walk.
fn neighbours(conn: &Connection, node: Node) -> rusqlite::Result<Vec<Node>> {
    let mut out = Vec::new();
    match node {
        Node::Item(id) => {
            for c in ids(
                conn,
                "SELECT card_id FROM card_items WHERE item_id = ?1
                 UNION
                 SELECT ca.card_id FROM card_annotations ca
                     JOIN annotations n ON n.id = ca.annotation_id
                     JOIN attachments a ON a.id = n.attachment_id
                     WHERE a.item_id = ?1
                        OR a.id IN (SELECT mirror_of FROM attachments WHERE item_id = ?1 AND mirror_of IS NOT NULL)
                 ORDER BY 1",
                id,
            )? {
                out.push(Node::Card(c));
            }
            for i in ids(
                conn,
                "SELECT item_b FROM item_relations WHERE item_a = ?1
                 UNION SELECT item_a FROM item_relations WHERE item_b = ?1 ORDER BY 1",
                id,
            )? {
                out.push(Node::Item(i));
            }
        }
        Node::Card(id) => {
            for i in ids(conn, "SELECT item_id FROM card_items WHERE card_id = ?1 ORDER BY 1", id)? {
                out.push(Node::Item(i));
            }
            for n in ids(conn, "SELECT annotation_id FROM card_annotations WHERE card_id = ?1 ORDER BY 1", id)? {
                for i in ids(conn, ANNOTATION_ITEMS, n)? {
                    out.push(Node::Item(i));
                }
            }
            for c in ids(
                conn,
                "SELECT card_b FROM card_links WHERE card_a = ?1
                 UNION SELECT card_a FROM card_links WHERE card_b = ?1 ORDER BY 1",
                id,
            )? {
                out.push(Node::Card(c));
            }
        }
    }
    Ok(out)
}

/// What each of the cards cites, directly or through annotations.
fn cites(conn: &Connection, cards: &[i64]) -> rusqlite::Result<Cites> {
    let mut out: Cites = HashMap::new();
    for &c in cards {
        let entry = out.entry(c).or_default();
        for i in ids(conn, "SELECT item_id FROM card_items WHERE card_id = ?1", c)? {
            entry.entry(i).or_default().0 = true;
        }
        for n in ids(conn, "SELECT annotation_id FROM card_annotations WHERE card_id = ?1", c)? {
            for i in ids(conn, ANNOTATION_ITEMS, n)? {
                entry.entry(i).or_default().1 += 1;
            }
        }
    }
    Ok(out)
}

/// The item at the center with everything connected to it within `depth` steps (1–3).
#[tauri::command]
pub fn item_graph(state: State<'_, DrawerState>, item_id: i64, depth: Option<i64>) -> Result<ItemGraph> {
    let lib = state.lock();
    let conn = &lib.conn;
    let depth = depth.unwrap_or(1).clamp(1, 3);
    let exists: Option<i64> = conn
        .query_row("SELECT id FROM items WHERE id = ?1", [item_id], |r| r.get(0))
        .optional()?;
    if exists.is_none() {
        return Err(Error("找不到這個條目".into()));
    }

    // Breadth-first walk.
    let mut seen: HashMap<Node, i64> = HashMap::new();
    let mut order: Vec<Node> = Vec::new();
    let mut queue = VecDeque::new();
    let mut truncated = false;
    let start = Node::Item(item_id);
    seen.insert(start, 0);
    order.push(start);
    queue.push_back(start);
    'walk: while let Some(node) = queue.pop_front() {
        let d = seen[&node];
        if d >= depth {
            continue;
        }
        for n in neighbours(conn, node)? {
            if seen.contains_key(&n) {
                continue;
            }
            if order.len() >= MAX_NODES {
                truncated = true;
                break 'walk;
            }
            seen.insert(n, d + 1);
            order.push(n);
            queue.push_back(n);
        }
    }

    let items: Vec<i64> = order.iter().filter_map(|n| if let Node::Item(i) = n { Some(*i) } else { None }).collect();
    let cards: Vec<i64> = order.iter().filter_map(|n| if let Node::Card(c) = n { Some(*c) } else { None }).collect();
    let item_set: HashSet<i64> = items.iter().copied().collect();
    let card_set: HashSet<i64> = cards.iter().copied().collect();

    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    for &i in &items {
        let (title, item_type): (String, String) =
            conn.query_row("SELECT title, item_type FROM items WHERE id = ?1", [i], |r| Ok((r.get(0)?, r.get(1)?)))?;
        nodes.push(GraphNode {
            key: format!("i{i}"),
            kind: "item",
            id: i,
            title,
            subtype: item_type,
            depth: seen[&Node::Item(i)],
            board_id: None,
        });
    }

    // Boards of the cards: leaf nodes one step further out.
    let mut boards: HashMap<i64, (String, i64)> = HashMap::new();
    let mut board_order = Vec::new();
    for &c in &cards {
        let (title, kind): (String, String) =
            conn.query_row("SELECT title, kind FROM cards WHERE id = ?1", [c], |r| Ok((r.get(0)?, r.get(1)?)))?;
        let on: Vec<(i64, String)> = conn
            .prepare_cached(
                "SELECT w.id, w.name FROM board_cards bc JOIN whiteboards w ON w.id = bc.board_id
                 WHERE bc.card_id = ?1 ORDER BY w.name COLLATE NOCASE, w.id",
            )?
            .query_map([c], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        let d = seen[&Node::Card(c)];
        nodes.push(GraphNode {
            key: format!("c{c}"),
            kind: "card",
            id: c,
            title,
            subtype: kind,
            depth: d,
            board_id: on.first().map(|b| b.0),
        });
        for (b, name) in on {
            let e = boards.entry(b).or_insert_with(|| {
                board_order.push(b);
                (name, d + 1)
            });
            e.1 = e.1.min(d + 1);
            edges.push(GraphEdge {
                a: format!("c{c}"),
                b: format!("b{b}"),
                kind: "board",
                direct: false,
                annotations: 0,
                direction: 0,
                note: String::new(),
            });
        }
    }
    for b in board_order {
        let (name, d) = boards.remove(&b).unwrap_or_default();
        nodes.push(GraphNode { key: format!("b{b}"), kind: "board", id: b, title: name, subtype: String::new(), depth: d, board_id: Some(b) });
    }

    // Every connection among the reached items and cards.
    let cited = cites(conn, &cards)?;
    for &c in &cards {
        let mut list: Vec<_> = cited.get(&c).map(|m| m.iter().collect()).unwrap_or_default();
        list.sort_by_key(|(i, _)| **i);
        for (&i, &(direct, annotations)) in list {
            if item_set.contains(&i) {
                edges.push(GraphEdge {
                    a: format!("c{c}"),
                    b: format!("i{i}"),
                    kind: "cite",
                    direct,
                    annotations,
                    direction: 0,
                    note: String::new(),
                });
            }
        }
    }
    let mut rel = conn.prepare("SELECT item_a, item_b FROM item_relations ORDER BY item_a, item_b")?;
    for row in rel.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))? {
        let (a, b) = row?;
        if item_set.contains(&a) && item_set.contains(&b) {
            edges.push(GraphEdge {
                a: format!("i{a}"),
                b: format!("i{b}"),
                kind: "related",
                direct: false,
                annotations: 0,
                direction: 0,
                note: String::new(),
            });
        }
    }
    for &c in &cards {
        let mut st = conn.prepare_cached("SELECT card_b, direction, note FROM card_links WHERE card_a = ?1 ORDER BY card_b")?;
        let links: Vec<(i64, i64, String)> =
            st.query_map(params![c], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<rusqlite::Result<_>>()?;
        for (b, direction, note) in links {
            if card_set.contains(&b) {
                edges.push(GraphEdge { a: format!("c{c}"), b: format!("c{b}"), kind: "link", direct: false, annotations: 0, direction, note });
            }
        }
    }

    Ok(ItemGraph { center: format!("i{item_id}"), nodes, edges, truncated })
}
