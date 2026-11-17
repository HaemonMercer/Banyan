import { COLORS, type Color } from "../editor/inline";
import { pageKey } from "../pages/pageRef";

/**
 * 白板（參考 Heptabase）：無限畫布上擺卡片、用箭頭連起來、用區段分組。
 *
 * 卡片不是另存的內容，而是指向一份既有的文件——頁面（`[[名稱]]` 的那種）或某天的日記。
 * 同一張卡片可以出現在好幾個白板上，在白板上編輯就是編輯那份 Markdown。
 * 白板本身只記版面（位置、大小、連線、區段），存成 JSON：App 資料夾的 `whiteboards/名稱.json`。
 * 畫面的平移、縮放是個人的瀏覽狀態，存在 localStorage，不寫進檔案（不然捲一下就要存檔）。
 *
 * 這裡都是純函式：輸入舊的白板、回傳新的白板，不改原本的物件。
 */

export type CardRef = { kind: "page"; name: string } | { kind: "day"; date: string };

export interface Card {
  id: string;
  ref: CardRef;
  x: number;
  y: number;
  w: number;
  /** null：高度跟著內容（有上限）；數字：使用者拉過的固定高度 */
  h: number | null;
  color: Color | null;
}

export interface Edge {
  id: string;
  from: string;
  to: string;
  label: string;
}

export interface Section {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: Color | null;
}

export interface Board {
  cards: Card[];
  edges: Edge[];
  sections: Section[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 畫面：螢幕座標 = 白板座標 × zoom + (x, y) */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const CARD_W = 340;
export const CARD_MIN_W = 200;
export const CARD_MIN_H = 80;
/** 高度跟著內容時，卡片最高多少（再長就在卡片裡捲動） */
export const CARD_AUTO_MAX_H = 440;
export const SECTION_MIN = 160;
export const ZOOM_MIN = 0.15;
export const ZOOM_MAX = 2.5;

export const emptyBoard = (): Board => ({ cards: [], edges: [], sections: [] });

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/* ─── 讀寫 ─── */

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const color = (v: unknown): Color | null => (COLORS as readonly string[]).includes(v as string) ? (v as Color) : null;

function parseRef(v: unknown): CardRef | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return null;
  if (o.kind === "page" && typeof o.name === "string" && o.name.trim()) return { kind: "page", name: o.name };
  if (o.kind === "day" && typeof o.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.date)) {
    return { kind: "day", date: o.date };
  }
  return null;
}

/** JSON → 白板；格式不對的項目略過（壞掉的檔案也能開，只是少了那些東西）。 */
export function parseBoard(json: string): Board {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json || "{}");
  } catch {
    return emptyBoard();
  }
  if (!raw || typeof raw !== "object") return emptyBoard();
  const list = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []).filter((o) => o && typeof o === "object");
  const cards: Card[] = [];
  for (const o of list(raw.cards)) {
    const ref = parseRef(o.ref);
    if (!ref || typeof o.id !== "string") continue;
    const h = o.h == null ? null : Math.max(CARD_MIN_H, num(o.h, CARD_MIN_H));
    cards.push({
      id: o.id,
      ref,
      x: num(o.x, 0),
      y: num(o.y, 0),
      w: Math.max(CARD_MIN_W, num(o.w, CARD_W)),
      h,
      color: color(o.color),
    });
  }
  const ids = new Set(cards.map((c) => c.id));
  const edges: Edge[] = list(raw.edges)
    .filter((o) => typeof o.id === "string" && ids.has(o.from as string) && ids.has(o.to as string) && o.from !== o.to)
    .map((o) => ({ id: o.id as string, from: o.from as string, to: o.to as string, label: str(o.label) }));
  const sections: Section[] = list(raw.sections)
    .filter((o) => typeof o.id === "string")
    .map((o) => ({
      id: o.id as string,
      title: str(o.title, "Section"),
      x: num(o.x, 0),
      y: num(o.y, 0),
      w: Math.max(SECTION_MIN, num(o.w, 600)),
      h: Math.max(SECTION_MIN, num(o.h, 400)),
      color: color(o.color),
    }));
  return { cards, edges, sections };
}

const round = (n: number) => Math.round(n * 10) / 10;

/** 白板 → JSON（固定欄位順序、座標取到小數一位，方便比對與版本控制）。 */
export function serializeBoard(b: Board): string {
  const out = {
    version: 1,
    cards: b.cards.map((c) => ({
      id: c.id,
      ref: c.ref.kind === "page" ? { kind: "page", name: c.ref.name } : { kind: "day", date: c.ref.date },
      x: round(c.x),
      y: round(c.y),
      w: round(c.w),
      h: c.h === null ? null : round(c.h),
      color: c.color,
    })),
    edges: b.edges.map((e) => ({ id: e.id, from: e.from, to: e.to, label: e.label })),
    sections: b.sections.map((s) => ({
      id: s.id,
      title: s.title,
      x: round(s.x),
      y: round(s.y),
      w: round(s.w),
      h: round(s.h),
      color: s.color,
    })),
  };
  return JSON.stringify(out, null, 2) + "\n";
}

/* ─── 卡片 ─── */

export function sameRef(a: CardRef, b: CardRef): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "page" ? pageKey(a.name) === pageKey((b as { name: string }).name) : a.date === (b as { date: string }).date;
}

export function refLabel(r: CardRef): string {
  return r.kind === "page" ? r.name : r.date;
}

/** 這份文件在白板上的卡片（沒有就是 undefined）。 */
export function findCard(b: Board, ref: CardRef): Card | undefined {
  return b.cards.find((c) => sameRef(c.ref, ref));
}

/**
 * 在 (x, y)（卡片左上角）放一張卡片。同一份文件在白板上只放一張：已經有了就不加，
 * 回傳的 id 是原本那張。
 */
export function addCard(b: Board, ref: CardRef, x: number, y: number): { board: Board; id: string; added: boolean } {
  const had = findCard(b, ref);
  if (had) return { board: b, id: had.id, added: false };
  const card: Card = { id: newId(), ref, x: round(x), y: round(y), w: CARD_W, h: null, color: null };
  return { board: { ...b, cards: [...b.cards, card] }, id: card.id, added: true };
}

export function updateCard(b: Board, id: string, patch: Partial<Omit<Card, "id">>): Board {
  return { ...b, cards: b.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
}

export function updateSection(b: Board, id: string, patch: Partial<Omit<Section, "id">>): Board {
  return { ...b, sections: b.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

/** 頁面改名後，白板上指向舊名稱的卡片跟著改。 */
export function renameRef(b: Board, from: string, to: string): Board {
  const k = pageKey(from);
  if (!b.cards.some((c) => c.ref.kind === "page" && pageKey(c.ref.name) === k)) return b;
  return {
    ...b,
    cards: b.cards.map((c) => (c.ref.kind === "page" && pageKey(c.ref.name) === k ? { ...c, ref: { kind: "page", name: to } } : c)),
  };
}

/** 把卡片、區段一起移動 (dx, dy)。 */
export function moveItems(b: Board, ids: Iterable<string>, dx: number, dy: number): Board {
  const set = new Set(ids);
  if (!set.size || (dx === 0 && dy === 0)) return b;
  return {
    ...b,
    cards: b.cards.map((c) => (set.has(c.id) ? { ...c, x: c.x + dx, y: c.y + dy } : c)),
    sections: b.sections.map((s) => (set.has(s.id) ? { ...s, x: s.x + dx, y: s.y + dy } : s)),
  };
}

/** 從白板拿掉卡片、連線、區段（只是不放在白板上，頁面與日記不受影響）；連到被拿掉卡片的連線一起拿掉。 */
export function removeItems(b: Board, ids: Iterable<string>): Board {
  const set = new Set(ids);
  if (!set.size) return b;
  const cards = b.cards.filter((c) => !set.has(c.id));
  const left = new Set(cards.map((c) => c.id));
  return {
    cards,
    edges: b.edges.filter((e) => !set.has(e.id) && left.has(e.from) && left.has(e.to)),
    sections: b.sections.filter((s) => !set.has(s.id)),
  };
}

/* ─── 連線 ─── */

/** 連起兩張卡片；自己連自己、已經有同方向的連線就不加。 */
export function addEdge(b: Board, from: string, to: string): { board: Board; id: string | null } {
  if (from === to) return { board: b, id: null };
  if (!b.cards.some((c) => c.id === from) || !b.cards.some((c) => c.id === to)) return { board: b, id: null };
  const had = b.edges.find((e) => e.from === from && e.to === to);
  if (had) return { board: b, id: had.id };
  const edge: Edge = { id: newId(), from, to, label: "" };
  return { board: { ...b, edges: [...b.edges, edge] }, id: edge.id };
}

export function updateEdge(b: Board, id: string, patch: Partial<Pick<Edge, "label" | "from" | "to">>): Board {
  return { ...b, edges: b.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) };
}

/** 反轉箭頭方向。 */
export function flipEdge(b: Board, id: string): Board {
  return { ...b, edges: b.edges.map((e) => (e.id === id ? { ...e, from: e.to, to: e.from } : e)) };
}

/* ─── 區段 ─── */

export function addSection(b: Board, r: Rect, title = "Section"): { board: Board; id: string } {
  const s: Section = {
    id: newId(),
    title,
    x: round(r.x),
    y: round(r.y),
    w: Math.max(SECTION_MIN, round(r.w)),
    h: Math.max(SECTION_MIN, round(r.h)),
    color: null,
  };
  // 新的區段放在最前面（畫在最底下）：大區段不會蓋住已有的小區段
  return { board: { ...b, sections: [s, ...b.sections] }, id: s.id };
}

const inside = (r: Rect, px: number, py: number) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;

/**
 * 區段裡的東西：中心點落在區段範圍內的卡片，與整個在範圍內的其他區段（不含自己）。
 * 拖曳區段時這些一起移動。`heights` 是卡片實際的高度（高度跟著內容的卡片要量過才知道）。
 */
export function sectionMembers(b: Board, sectionId: string, heights: Record<string, number> = {}): string[] {
  const s = b.sections.find((x) => x.id === sectionId);
  if (!s) return [];
  const out: string[] = [];
  for (const c of b.cards) {
    const r = cardRect(c, heights);
    if (inside(s, r.x + r.w / 2, r.y + r.h / 2)) out.push(c.id);
  }
  for (const o of b.sections) {
    if (o.id !== s.id && inside(s, o.x, o.y) && inside(s, o.x + o.w, o.y + o.h)) out.push(o.id);
  }
  return out;
}

/** 把選取的卡片包成一個區段（四周留白）。 */
export function sectionAround(rects: Rect[], pad = 48): Rect | null {
  const b = boundsOf(rects);
  if (!b) return null;
  return { x: b.x - pad, y: b.y - pad - 24, w: b.w + pad * 2, h: b.h + pad * 2 + 24 };
}

/* ─── 幾何 ─── */

export function cardRect(c: Card, heights: Record<string, number> = {}): Rect {
  return { x: c.x, y: c.y, w: c.w, h: c.h ?? heights[c.id] ?? 120 };
}

export function boundsOf(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

export function contains(outer: Rect, r: Rect): boolean {
  return r.x >= outer.x && r.y >= outer.y && r.x + r.w <= outer.x + outer.w && r.y + r.h <= outer.y + outer.h;
}

export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/** 以螢幕上的 (sx, sy) 為中心縮放（滑鼠下的那一點不動）。 */
export function zoomAt(cam: Camera, zoom: number, sx: number, sy: number): Camera {
  const z = clampZoom(zoom);
  const wx = (sx - cam.x) / cam.zoom;
  const wy = (sy - cam.y) / cam.zoom;
  return { x: sx - wx * z, y: sy - wy * z, zoom: z };
}

export function toWorld(cam: Camera, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - cam.x) / cam.zoom, y: (sy - cam.y) / cam.zoom };
}

/** 讓整個範圍放進 w×h 的畫面（四周留白）；放大不超過 100%。 */
export function fitCamera(bounds: Rect | null, w: number, h: number, pad = 64): Camera {
  if (!bounds || w <= 0 || h <= 0) return { x: w / 2, y: h / 3, zoom: 1 };
  const zoom = clampZoom(Math.min(1, (w - pad * 2) / Math.max(bounds.w, 1), (h - pad * 2) / Math.max(bounds.h, 1)));
  return {
    x: w / 2 - (bounds.x + bounds.w / 2) * zoom,
    y: h / 2 - (bounds.y + bounds.h / 2) * zoom,
    zoom,
  };
}

type Side = "top" | "right" | "bottom" | "left";

function anchor(r: Rect, side: Side): { x: number; y: number; nx: number; ny: number } {
  switch (side) {
    case "top":
      return { x: r.x + r.w / 2, y: r.y, nx: 0, ny: -1 };
    case "bottom":
      return { x: r.x + r.w / 2, y: r.y + r.h, nx: 0, ny: 1 };
    case "left":
      return { x: r.x, y: r.y + r.h / 2, nx: -1, ny: 0 };
    case "right":
      return { x: r.x + r.w, y: r.y + r.h / 2, nx: 1, ny: 0 };
  }
}

/** 兩個矩形之間，連線從哪一邊出去、從哪一邊進來（看兩者的相對位置）。 */
function sides(a: Rect, b: Rect): [Side, Side] {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  // 水平方向有空隙就左右連；否則上下連
  const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  const horizontal = gapX > 0 && (gapX >= gapY || gapY <= 0) ? true : gapY > 0 ? false : Math.abs(dx) >= Math.abs(dy);
  if (horizontal) return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}

/**
 * 連線的路徑（SVG 的 `d`）：從 a 的一邊中點到 b 的一邊中點的三次貝茲曲線，
 * 控制點沿著邊的法線方向伸出去，看起來像 Heptabase 那樣柔和的弧線。
 * 也回傳曲線中點（放標籤）。
 */
export function edgePath(a: Rect, b: Rect): { d: string; mid: { x: number; y: number } } {
  const [sa, sb] = sides(a, b);
  const p = anchor(a, sa);
  const q = anchor(b, sb);
  const dist = Math.hypot(q.x - p.x, q.y - p.y);
  const k = Math.min(160, Math.max(36, dist * 0.4));
  const c1 = { x: p.x + p.nx * k, y: p.y + p.ny * k };
  const c2 = { x: q.x + q.nx * k, y: q.y + q.ny * k };
  const f = (n: number) => Math.round(n * 10) / 10;
  const mid = {
    x: 0.125 * p.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * q.x,
    y: 0.125 * p.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * q.y,
  };
  return {
    d: `M ${f(p.x)} ${f(p.y)} C ${f(c1.x)} ${f(c1.y)}, ${f(c2.x)} ${f(c2.y)}, ${f(q.x)} ${f(q.y)}`,
    mid,
  };
}

/** 從卡片拉到滑鼠位置的暫時連線（還沒放到另一張卡片上）。 */
export function dangling(a: Rect, x: number, y: number): string {
  return edgePath(a, { x, y, w: 0, h: 0 }).d;
}

/* ─── 統計 ─── */

/** 有放這份文件的白板名稱。 */
export function boardsWith(boards: Record<string, string>, ref: CardRef): string[] {
  const out: string[] = [];
  for (const [name, json] of Object.entries(boards)) {
    if (!json) continue;
    if (parseBoard(json).cards.some((c) => sameRef(c.ref, ref))) out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b));
}
