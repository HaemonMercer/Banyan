/**
 * Whiteboard object types. Every object on a board is a card (so it can be linked, tagged,
 * opened in the side panel and kept in the card library); `kind` says how it is drawn and
 * `data` holds the kind's JSON:
 *
 * | kind      | data                                   | content                     |
 * |-----------|----------------------------------------|-----------------------------|
 * | note      | ""                                     | text                        |
 * | sticky    | { color }                              | text                        |
 * | image     | { file, width, height }                | notes                       |
 * | video     | { provider: "youtube", videoId, url, start } | notes                 |
 * | pdf       | { file, pages, page }                  | notes                       |
 * | mindmap   | { root: MindNode }                     | outline of the map (search) |
 * | table     | TableData (see table.ts)               | cells as tab-separated text |
 * | chart     | ChartData (see chart.ts)               | numbers as tab-separated text |
 *
 * Keep the list in sync with `CARD_KINDS` in `src-tauri/src/whiteboard.rs`.
 */

import type { IconName } from "../icons/icons";

export type CardKind = "note" | "sticky" | "image" | "video" | "pdf" | "mindmap" | "table" | "chart";

export interface KindInfo {
    label: string;
    icon: IconName;
    /** Size of a new object. */
    width: number;
    height: number;
}

export const KINDS: Record<CardKind, KindInfo> = {
    note: { label: "卡片", icon: "note", width: 240, height: 160 },
    sticky: { label: "便利貼", icon: "sticky", width: 200, height: 200 },
    image: { label: "圖片", icon: "image", width: 320, height: 240 },
    video: { label: "YouTube 影片", icon: "video", width: 480, height: 300 },
    pdf: { label: "PDF", icon: "pdf", width: 320, height: 440 },
    mindmap: { label: "心智圖", icon: "mindmap", width: 320, height: 160 },
    table: { label: "表格", icon: "table", width: 442, height: 168 },
    chart: { label: "圖表", icon: "chart", width: 440, height: 300 },
};

export const kindInfo = (k: string): KindInfo => KINDS[k as CardKind] ?? KINDS.note;

/** Parses a card's `data`, falling back to `{}` for empty or broken JSON. */
export function parseData<T extends object>(data: string): Partial<T> {
    if (!data) return {};
    try {
        const v = JSON.parse(data);
        return v && typeof v === "object" ? v : {};
    } catch {
        return {};
    }
}

// ---------- sticky notes ----------

export const STICKY_COLORS = ["yellow", "orange", "pink", "green", "blue", "purple", "gray"] as const;
export type StickyColor = (typeof STICKY_COLORS)[number];
export const STICKY_COLOR_NAMES: Record<StickyColor, string> = {
    yellow: "黃",
    orange: "橘",
    pink: "粉紅",
    green: "綠",
    blue: "藍",
    purple: "紫",
    gray: "灰",
};
export interface StickyData {
    color: StickyColor;
}

// ---------- images, PDFs ----------

export interface ImageData {
    file: string;
    /** Natural size of the image, for keeping its proportions. */
    width: number;
    height: number;
}

export interface PdfData {
    file: string;
    pages: number;
    /** Page shown on the board (1-based). */
    page: number;
}

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"];
export const extensionOf = (path: string) => path.split(/[\\/]/).pop()!.split(".").pop()!.toLowerCase();
export const fileNameOf = (path: string) => path.split(/[\\/]/).pop() ?? path;
/** Which object a dropped file becomes, if any. */
export function kindForFile(path: string): "image" | "pdf" | null {
    const ext = extensionOf(path);
    if (ext === "pdf") return "pdf";
    return IMAGE_EXTENSIONS.includes(ext) ? "image" : null;
}

/** Fits a natural size into a box (keeps the proportions; never upscales tiny images much). */
export function fitSize(w: number, h: number, maxW = 420, maxH = 360) {
    if (!(w > 0 && h > 0)) return { width: KINDS.image.width, height: KINDS.image.height };
    const k = Math.min(maxW / w, maxH / h, 1.5);
    return { width: Math.max(120, Math.round(w * k)), height: Math.max(60, Math.round(h * k)) };
}

// ---------- YouTube ----------

export interface VideoData {
    provider: "youtube";
    videoId: string;
    url: string;
    /** Start time in seconds. */
    start: number;
}

/** Seconds from "90", "1m30s", "1h2m3s". */
function parseTime(t: string | null): number {
    if (!t) return 0;
    if (/^\d+$/.test(t)) return Number(t);
    const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
    return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

/**
 * Recognises YouTube links: watch?v=, youtu.be/, shorts/, embed/, live/ and music.youtube.com.
 * Returns null for anything else.
 */
export function parseYouTube(input: string): VideoData | null {
    const text = input.trim();
    if (/^[\w-]{11}$/.test(text)) return { provider: "youtube", videoId: text, url: `https://www.youtube.com/watch?v=${text}`, start: 0 };
    let u: URL;
    try {
        u = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    } catch {
        return null;
    }
    const host = u.hostname.replace(/^(www|m|music)\./, "");
    let id: string | null = null;
    if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
    else if (host === "youtube.com" || host === "youtube-nocookie.com") {
        if (u.pathname === "/watch") id = u.searchParams.get("v");
        else {
            const m = /^\/(?:shorts|embed|live|v)\/([\w-]{11})/.exec(u.pathname);
            id = m?.[1] ?? null;
        }
    }
    if (!id || !/^[\w-]{11}$/.test(id)) return null;
    const start = parseTime(u.searchParams.get("t") ?? u.searchParams.get("start"));
    return { provider: "youtube", videoId: id, url: `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}s` : ""}`, start };
}

export const youTubeThumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
export const youTubeEmbed = (v: VideoData, autoplay: boolean) =>
    `https://www.youtube-nocookie.com/embed/${v.videoId}?rel=0${v.start ? `&start=${v.start}` : ""}${autoplay ? "&autoplay=1" : ""}`;

/** The video's title from YouTube's oEmbed endpoint (null when offline or blocked). */
export async function fetchYouTubeTitle(v: VideoData): Promise<string | null> {
    try {
        const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${v.videoId}`)}`);
        if (!r.ok) return null;
        const j = await r.json();
        return typeof j.title === "string" ? j.title : null;
    } catch {
        return null;
    }
}

// ---------- mind maps ----------

export interface MindNode {
    id: string;
    text: string;
    children: MindNode[];
    collapsed?: boolean;
    /** Only for the root's children: which side of the root the branch grows on. */
    side?: "left" | "right";
}

export interface MindMapData {
    root: MindNode;
}

let idSeq = 0;
export const newNodeId = () => `${Date.now().toString(36)}${(idSeq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function newMindMap(title = "中心主題"): MindMapData {
    return {
        root: {
            id: newNodeId(),
            text: title,
            children: [
                { id: newNodeId(), text: "想法 1", children: [], side: "right" },
                { id: newNodeId(), text: "想法 2", children: [], side: "right" },
                { id: newNodeId(), text: "想法 3", children: [], side: "right" },
            ],
        },
    };
}

/** Reads a mind map from `data`, repairing what is missing. */
export function readMindMap(data: string, fallbackTitle = ""): MindMapData {
    const d = parseData<MindMapData>(data);
    const fix = (n: Partial<MindNode> | undefined, depth: number): MindNode => ({
        id: typeof n?.id === "string" && n.id ? n.id : newNodeId(),
        text: typeof n?.text === "string" ? n.text : "",
        children: Array.isArray(n?.children) ? n!.children.map((c) => fix(c, depth + 1)) : [],
        ...(n?.collapsed ? { collapsed: true } : {}),
        ...(depth === 1 && n?.side === "left" ? { side: "left" as const } : depth === 1 ? { side: "right" as const } : {}),
    });
    const root = fix(d.root, 0);
    if (!d.root) root.text = fallbackTitle || "中心主題";
    return { root };
}

/** The map as an indented outline (stored in `content` so it is searchable and diffable). */
export function mindMapOutline(m: MindMapData): string {
    const lines: string[] = [];
    const walk = (n: MindNode, depth: number) => {
        lines.push(`${"  ".repeat(depth)}${n.text.replace(/\n/g, " ").trim() || "（空白）"}`);
        n.children.forEach((c) => walk(c, depth + 1));
    };
    walk(m.root, 0);
    return lines.join("\n");
}

export function findNode(root: MindNode, id: string): { node: MindNode; parent: MindNode | null; depth: number } | null {
    const walk = (n: MindNode, parent: MindNode | null, depth: number): ReturnType<typeof findNode> => {
        if (n.id === id) return { node: n, parent, depth };
        for (const c of n.children) {
            const r = walk(c, n, depth + 1);
            if (r) return r;
        }
        return null;
    };
    return walk(root, null, 0);
}

/** Returns a copy of the tree with `fn` applied to the node with that id. */
export function updateNode(root: MindNode, id: string, fn: (n: MindNode) => MindNode): MindNode {
    if (root.id === id) return fn(root);
    let changed = false;
    const children = root.children.map((c) => {
        const u = updateNode(c, id, fn);
        if (u !== c) changed = true;
        return u;
    });
    return changed ? { ...root, children } : root;
}

export function removeNode(root: MindNode, id: string): MindNode {
    if (!root.children.some((c) => c.id === id)) {
        let changed = false;
        const children = root.children.map((c) => {
            const u = removeNode(c, id);
            if (u !== c) changed = true;
            return u;
        });
        return changed ? { ...root, children } : root;
    }
    return { ...root, children: root.children.filter((c) => c.id !== id) };
}

export function countNodes(n: MindNode): number {
    return 1 + n.children.reduce((s, c) => s + countNodes(c), 0);
}

/** Branch colours (Miro-style): each branch of the root gets one, its descendants share it. */
export const BRANCH_COLORS = ["#3b7dd8", "#d0533f", "#3a9a5c", "#c99a14", "#8a5cc7", "#d0698a", "#2a9d9d", "#c0612b"];

export interface LaidNode {
    node: MindNode;
    depth: number;
    /** Top-left in map coordinates (the root's center is at 0, 0). */
    x: number;
    y: number;
    width: number;
    height: number;
    side: "left" | "right" | "root";
    color: string;
    parentId: string | null;
    /** Children hidden by collapsing. */
    hidden: number;
}

export interface MindLayout {
    nodes: LaidNode[];
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

const H_GAP = 44;
const V_GAP = 10;
const PAD_X = { 0: 18, 1: 12, other: 6 };
const LINE_H = { 0: 24, 1: 20, other: 19 };
const FONT = { 0: 17, 1: 14, other: 13 };
const MAX_TEXT_W = { 0: 260, 1: 220, other: 220 };

const ctx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;

function level<T>(table: { 0: T; 1: T; other: T }, depth: number): T {
    return depth === 0 ? table[0] : depth === 1 ? table[1] : table.other;
}

/** Wraps text into lines no wider than `max` (by character for CJK, at spaces when possible). */
function wrapLines(text: string, font: string, max: number): { lines: string[]; width: number } {
    if (!ctx) return { lines: [text], width: text.length * 8 };
    ctx.font = font;
    const out: string[] = [];
    let widest = 0;
    for (const para of (text || " ").split("\n")) {
        let line = "";
        for (const ch of para) {
            const next = line + ch;
            if (line && ctx.measureText(next).width > max) {
                const sp = line.lastIndexOf(" ");
                if (sp > 0 && ch !== " ") {
                    out.push(line.slice(0, sp));
                    line = line.slice(sp + 1) + ch;
                } else {
                    out.push(line);
                    line = ch === " " ? "" : ch;
                }
            } else line = next;
        }
        out.push(line);
    }
    for (const l of out) widest = Math.max(widest, ctx.measureText(l || " ").width);
    return { lines: out, width: widest };
}

export function nodeFont(depth: number) {
    const weight = depth === 0 ? 700 : depth === 1 ? 600 : 400;
    return `${weight} ${level(FONT, depth)}px "Segoe UI Variable Text", "Segoe UI", "Microsoft JhengHei UI", "Microsoft JhengHei", sans-serif`;
}

export function nodeBox(text: string, depth: number) {
    const { lines, width } = wrapLines(text, nodeFont(depth), level(MAX_TEXT_W, depth));
    const padX = level(PAD_X, depth);
    const lh = level(LINE_H, depth);
    return {
        width: Math.max(depth === 0 ? 90 : 36, Math.ceil(width) + padX * 2 + 2),
        height: lines.length * lh + (depth === 0 ? 20 : depth === 1 ? 12 : 8),
        lineHeight: lh,
    };
}

/** Horizontal tree layout: branches grow left or right of the root, subtrees stacked and centered. */
export function layoutMindMap(m: MindMapData): MindLayout {
    const nodes: LaidNode[] = [];
    const size = new Map<string, { width: number; height: number }>();
    const span = new Map<string, number>();
    const measure = (n: MindNode, depth: number): number => {
        const b = nodeBox(n.text, depth);
        size.set(n.id, b);
        const kids = n.collapsed ? [] : n.children;
        const h = kids.length ? kids.reduce((s, c) => s + measure(c, depth + 1), 0) + V_GAP * (kids.length - 1) : 0;
        const total = Math.max(b.height, h);
        span.set(n.id, total);
        return total;
    };
    const place = (n: MindNode, depth: number, side: "left" | "right", anchorX: number, top: number, color: string, parentId: string) => {
        const b = size.get(n.id)!;
        const total = span.get(n.id)!;
        const x = side === "right" ? anchorX : anchorX - b.width;
        const y = top + (total - b.height) / 2;
        nodes.push({ node: n, depth, x, y, width: b.width, height: b.height, side, color, parentId, hidden: n.collapsed ? countNodes(n) - 1 : 0 });
        if (n.collapsed) return;
        const kidsH = n.children.reduce((s, c) => s + span.get(c.id)!, 0) + V_GAP * Math.max(0, n.children.length - 1);
        let cy = top + (total - kidsH) / 2;
        const nextX = side === "right" ? x + b.width + H_GAP : x - H_GAP;
        for (const c of n.children) {
            place(c, depth + 1, side, nextX, cy, color, n.id);
            cy += span.get(c.id)! + V_GAP;
        }
    };

    const root = m.root;
    const rb = nodeBox(root.text, 0);
    size.set(root.id, rb);
    nodes.push({
        node: root,
        depth: 0,
        x: -rb.width / 2,
        y: -rb.height / 2,
        width: rb.width,
        height: rb.height,
        side: "root",
        color: "",
        parentId: null,
        hidden: root.collapsed ? countNodes(root) - 1 : 0,
    });
    if (!root.collapsed) {
        root.children.forEach((c) => measure(c, 1));
        for (const side of ["right", "left"] as const) {
            const kids = root.children.map((c, i) => ({ c, i })).filter(({ c }) => (c.side ?? "right") === side);
            const total = kids.reduce((s, k) => s + span.get(k.c.id)!, 0) + V_GAP * 2 * Math.max(0, kids.length - 1);
            let top = -total / 2;
            const ax = side === "right" ? rb.width / 2 + H_GAP + 10 : -rb.width / 2 - H_GAP - 10;
            for (const { c, i } of kids) {
                place(c, 1, side, ax, top, BRANCH_COLORS[i % BRANCH_COLORS.length], root.id);
                top += span.get(c.id)! + V_GAP * 2;
            }
        }
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + n.width + (n.node.children.length ? 18 : 0));
        maxY = Math.max(maxY, n.y + n.height);
    }
    // Room for the collapse buttons on the left side too.
    if (nodes.some((n) => n.side === "left" && n.node.children.length)) minX -= 18;
    return { nodes, minX, minY, maxX, maxY };
}
