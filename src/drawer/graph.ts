import { invoke } from "@tauri-apps/api/core";

/** A node of Drawer's relation graph (`item_graph` in src-tauri/src/item_graph.rs). */
export interface GraphNode {
    /** "i5" item 5, "c3" card 3, "b2" board 2. */
    key: string;
    kind: "item" | "card" | "board";
    id: number;
    title: string;
    /** Items: their type. Cards: their kind (note, sticky, …). */
    subtype: string;
    /** Steps from the center item. */
    depth: number;
    /** Cards: a board the card is on. Boards: the board itself. */
    boardId: number | null;
}

export interface GraphEdge {
    a: string;
    b: string;
    /** cite card → item, related item – item, link card – card, board card – board. */
    kind: "cite" | "related" | "link" | "board";
    /** cite: the card cites the item itself. */
    direct: boolean;
    /** cite: how many of the item's annotations the card cites. */
    annotations: number;
    /** link: 0 no arrow, 1 a → b, 2 b → a, 3 both. */
    direction: number;
    note: string;
}

export interface ItemGraph {
    center: string;
    nodes: GraphNode[];
    edges: GraphEdge[];
    truncated: boolean;
}

export const graphApi = {
    itemGraph: (itemId: number, depth: number) => invoke<ItemGraph>("item_graph", { itemId, depth }),
};
