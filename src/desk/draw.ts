import { COLORS, type Color } from "../editor/inline";
import { boundsOf, newId, type Rect } from "./board";

/**
 * Draw：參考 draw.io 的圖表（流程圖、架構圖）。Dock 的一種文件（`kind: "draw"`）。
 *
 * - 圖形（`Shape`）：位置、大小、文字與樣式；陣列順序就是上下層（後面的在上面）。
 * - 連線（`Edge`）：兩端可以接在圖形上（`side` 是固定的邊，null 是自動選最近的邊），
 *   或是一個自由的點。路徑（直角、直線、曲線）都是算出來的，不存。
 * - 顏色用 App 的色盤名稱（`Paint`），畫面上換成 CSS 變數，跟著淺色／深色主題；
 *   匯出時才換成固定的顏色（`drawExport.ts`）。
 *
 * - 網頁設計（參考 Figma）：畫板（`frame`，裡面的圖形 `parent` 指向它、跟著搬、超出的裁掉）、圖片（`image`，
 *   `src` 是 `media/檔名` 或 data URL）、任意色碼（`#rrggbb`）、圓角、透明度、字型、字重、行高、字距、陰影、
 *   圖層（名稱、隱藏、鎖定、群組 `group`）。畫板裡一律用淺色主題的顏色（像一張紙），不跟著深色主題。
 *
 * 記憶體裡 `DockDoc.content` 是 `serializeDiagram` 的 JSON 字串，存檔時寫成 `draw` 物件。這裡都是純函式。
 */

export interface Pt {
  x: number;
  y: number;
}

export const SHAPE_KINDS = [
  "rect",
  "rounded",
  "ellipse",
  "diamond",
  "triangle",
  "hexagon",
  "parallelogram",
  "cylinder",
  "document",
  "cloud",
  "note",
  "actor",
  "text",
  "frame",
  "image",
] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export const SHAPE_INFO: Record<ShapeKind, { label: string; w: number; h: number }> = {
  rect: { label: "Rectangle", w: 120, h: 60 },
  rounded: { label: "Rounded rectangle", w: 120, h: 60 },
  ellipse: { label: "Ellipse", w: 120, h: 80 },
  diamond: { label: "Decision", w: 110, h: 90 },
  triangle: { label: "Triangle", w: 90, h: 80 },
  hexagon: { label: "Hexagon", w: 120, h: 70 },
  parallelogram: { label: "Input / output", w: 130, h: 60 },
  cylinder: { label: "Database", w: 70, h: 90 },
  document: { label: "Document", w: 120, h: 80 },
  cloud: { label: "Cloud", w: 140, h: 90 },
  note: { label: "Sticky note", w: 120, h: 110 },
  actor: { label: "Person", w: 40, h: 80 },
  text: { label: "Text", w: 120, h: 30 },
  frame: { label: "Frame", w: 390, h: 844 },
  image: { label: "Image", w: 240, h: 160 },
};

/** 圖形選單裡的種類（畫板與圖片在工具列上另外有按鈕） */
export const MENU_KINDS: ShapeKind[] = SHAPE_KINDS.filter((k) => k !== "frame" && k !== "image");

/** 畫板的尺寸 */
export const FRAME_PRESETS = [
  { label: "Desktop", w: 1440, h: 1024 },
  { label: "Laptop", w: 1280, h: 832 },
  { label: "Tablet", w: 768, h: 1024 },
  { label: "Phone", w: 390, h: 844 },
  { label: "Square", w: 1080, h: 1080 },
] as const;

/** 顏色：App 色盤的名稱、預設（跟著主題）、不填，或任意色碼 */
export type Hex = `#${string}`;
export type Paint = Color | "default" | "none" | Hex;
export const PAINTS: Paint[] = ["none", "default", ...COLORS];
export const isHex = (v: unknown): v is Hex => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
/** 使用者輸入的色碼（#abc、abcdef…）整理成 #rrggbb；不是色碼就是 null */
export function normalizeHex(v: string): Hex | null {
  let t = v.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(t)) t = t.replace(/./g, (c) => c + c);
  return /^[0-9a-f]{6}$/.test(t) ? (`#${t}` as Hex) : null;
}
export type Shadow = "none" | "sm" | "md" | "lg";
export const SHADOWS: Shadow[] = ["none", "sm", "md", "lg"];
export type Fit = "cover" | "contain";
/** 字型（空字串是 App 的字型） */
export const FONTS = ["", "Segoe UI", "Arial", "Helvetica", "Verdana", "Georgia", "Times New Roman", "Consolas", "Microsoft JhengHei"];
export type Dash = "solid" | "dashed" | "dotted";
export type HAlign = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";

export interface ShapeStyle {
  fill: Paint;
  stroke: Paint;
  /** 文字顏色 */
  color: Paint;
  width: number;
  dash: Dash;
  size: number;
  /** 字重 100～900 */
  weight: number;
  italic: boolean;
  align: HAlign;
  valign: VAlign;
  shadow: Shadow;
  /** 圓角（null 是這種圖形的預設：圓角矩形 12、其他 0） */
  radius: number | null;
  /** 不透明度 0～1 */
  opacity: number;
  font: string;
  lineHeight: number;
  /** 字距（px） */
  spacing: number;
  /** 圖片怎麼放進框裡 */
  fit: Fit;
}

export interface Shape {
  id: string;
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 圖形裡的文字；畫板是它的名稱 */
  text: string;
  style: ShapeStyle;
  /** 圖層名稱（沒有就用文字或種類） */
  name?: string;
  /** 所在的畫板 */
  parent?: string;
  hidden?: boolean;
  locked?: boolean;
  /** 群組：同一個 id 的一起選取、一起搬 */
  group?: string;
  /** 圖片：`media/檔名` 或 data URL */
  src?: string;
}

export type Side = "top" | "right" | "bottom" | "left";
export const SIDES: Side[] = ["top", "right", "bottom", "left"];
/** 連線的一端：接在圖形上（side 是 null 就自動選邊），或是自由的點 */
export type End = { shape: string; side: Side | null } | { x: number; y: number };
export type Route = "orthogonal" | "straight" | "curved";
export const ARROWS = ["none", "arrow", "open", "diamond", "circle"] as const;
export type Arrow = (typeof ARROWS)[number];

export interface EdgeStyle {
  stroke: Paint;
  width: number;
  dash: Dash;
  route: Route;
  start: Arrow;
  end: Arrow;
  size: number;
}

export interface Edge {
  id: string;
  from: End;
  to: End;
  label: string;
  style: EdgeStyle;
}

export interface Diagram {
  shapes: Shape[];
  edges: Edge[];
  /** 顯示格線（也是拖曳時對齊的格子） */
  grid: boolean;
}

export const GRID = 10;
export const MIN_SIZE = 10;

export const emptyDiagram = (): Diagram => ({ shapes: [], edges: [], grid: true });

export function defaultShapeStyle(kind: ShapeKind): ShapeStyle {
  const base: ShapeStyle = {
    fill: "default",
    stroke: "default",
    color: "default",
    width: 1.5,
    dash: "solid",
    size: 14,
    weight: 400,
    italic: false,
    align: "center",
    valign: "middle",
    shadow: "none",
    radius: null,
    opacity: 1,
    font: "",
    lineHeight: 1.4,
    spacing: 0,
    fit: "cover",
  };
  if (kind === "text") return { ...base, fill: "none", stroke: "none" };
  if (kind === "note") return { ...base, fill: "yellow", stroke: "yellow", shadow: "sm" };
  if (kind === "actor") return { ...base, valign: "bottom" };
  if (kind === "frame") return { ...base, fill: "#ffffff", stroke: "none", valign: "top", align: "left" };
  if (kind === "image") return { ...base, fill: "none", stroke: "none" };
  return base;
}

export const defaultEdgeStyle = (): EdgeStyle => ({
  stroke: "default",
  width: 1.5,
  dash: "solid",
  route: "orthogonal",
  start: "none",
  end: "arrow",
  size: 13,
});

/* ─── 讀寫 ─── */

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const pick = <T extends string>(v: unknown, all: readonly T[], d: T): T => (all.includes(v as T) ? (v as T) : d);
const paint = (v: unknown, d: Paint): Paint => (isHex(v) ? (v.toLowerCase() as Hex) : pick(v, PAINTS, d));
const DASHES: Dash[] = ["solid", "dashed", "dotted"];
const ROUTES: Route[] = ["orthogonal", "straight", "curved"];

function parseShapeStyle(v: unknown, kind: ShapeKind): ShapeStyle {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const d = defaultShapeStyle(kind);
  return {
    fill: paint(o.fill, d.fill),
    stroke: paint(o.stroke, d.stroke),
    color: paint(o.color, d.color),
    width: Math.max(0.5, Math.min(12, num(o.width, d.width))),
    dash: pick(o.dash, DASHES, d.dash),
    size: Math.max(6, Math.min(400, num(o.size, d.size))),
    // 舊檔案是 bold: true
    weight: Math.round(Math.max(100, Math.min(900, num(o.weight, o.bold === true ? 600 : d.weight))) / 100) * 100,
    italic: typeof o.italic === "boolean" ? o.italic : d.italic,
    align: pick(o.align, ["left", "center", "right"] as const, d.align),
    valign: pick(o.valign, ["top", "middle", "bottom"] as const, d.valign),
    shadow: o.shadow === true ? "md" : pick(o.shadow, SHADOWS, d.shadow),
    radius: typeof o.radius === "number" && Number.isFinite(o.radius) ? Math.max(0, o.radius) : d.radius,
    opacity: Math.max(0, Math.min(1, num(o.opacity, d.opacity))),
    font: typeof o.font === "string" ? o.font : d.font,
    lineHeight: Math.max(0.5, Math.min(4, num(o.lineHeight, d.lineHeight))),
    spacing: Math.max(-20, Math.min(50, num(o.spacing, d.spacing))),
    fit: pick(o.fit, ["cover", "contain"] as const, d.fit),
  };
}

function parseEdgeStyle(v: unknown): EdgeStyle {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const d = defaultEdgeStyle();
  return {
    stroke: paint(o.stroke, d.stroke),
    width: Math.max(0.5, Math.min(12, num(o.width, d.width))),
    dash: pick(o.dash, DASHES, d.dash),
    route: pick(o.route, ROUTES, d.route),
    start: pick(o.start, ARROWS, d.start),
    end: pick(o.end, ARROWS, d.end),
    size: Math.max(6, Math.min(96, num(o.size, d.size))),
  };
}

function parseEnd(v: unknown, shapes: Set<string>): End | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return null;
  if (typeof o.shape === "string") return shapes.has(o.shape) ? { shape: o.shape, side: pick(o.side, SIDES, null as unknown as Side) ?? null } : null;
  if (typeof o.x === "number" && typeof o.y === "number" && Number.isFinite(o.x) && Number.isFinite(o.y)) return { x: o.x, y: o.y };
  return null;
}

export function parseDiagram(json: string): Diagram {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json || "{}");
  } catch {
    return emptyDiagram();
  }
  return diagramFrom(raw);
}

/** 從存檔的物件讀回圖表（壞掉的部分丟掉，接到不存在的圖形的連線也丟掉）。 */
export function diagramFrom(raw: unknown): Diagram {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const shapes: Shape[] = (Array.isArray(o.shapes) ? o.shapes : []).flatMap((v): Shape[] => {
    const s = v as Record<string, unknown> | null;
    if (!s || typeof s !== "object" || typeof s.id !== "string" || seen.has(s.id)) return [];
    seen.add(s.id);
    const kind = pick(s.kind, SHAPE_KINDS, "rect");
    const out: Shape = {
      id: s.id,
      kind,
      x: num(s.x, 0),
      y: num(s.y, 0),
      w: Math.max(MIN_SIZE, num(s.w, SHAPE_INFO[kind].w)),
      h: Math.max(MIN_SIZE, num(s.h, SHAPE_INFO[kind].h)),
      text: str(s.text),
      style: parseShapeStyle(s.style, kind),
    };
    if (typeof s.name === "string" && s.name.trim()) out.name = s.name;
    if (typeof s.parent === "string") out.parent = s.parent;
    if (s.hidden === true) out.hidden = true;
    if (s.locked === true) out.locked = true;
    if (typeof s.group === "string" && s.group) out.group = s.group;
    if (typeof s.src === "string" && s.src) out.src = s.src;
    return [out];
  });
  // 只能放在存在的畫板裡（畫板不能放進畫板）
  const frames = new Set(shapes.filter((s) => s.kind === "frame").map((s) => s.id));
  for (const s of shapes) if (s.parent !== undefined && (!frames.has(s.parent) || s.kind === "frame")) delete s.parent;
  const edges: Edge[] = (Array.isArray(o.edges) ? o.edges : []).flatMap((v): Edge[] => {
    const e = v as Record<string, unknown> | null;
    if (!e || typeof e !== "object" || typeof e.id !== "string" || seen.has(e.id)) return [];
    const from = parseEnd(e.from, seen);
    const to = parseEnd(e.to, seen);
    if (!from || !to) return [];
    seen.add(e.id);
    return [{ id: e.id, from, to, label: str(e.label), style: parseEdgeStyle(e.style) }];
  });
  return { shapes, edges, grid: typeof o.grid === "boolean" ? o.grid : true };
}

/** 存檔用的物件。 */
export const diagramData = (d: Diagram) => ({ shapes: d.shapes, edges: d.edges, grid: d.grid });
export const serializeDiagram = (d: Diagram) => JSON.stringify(diagramData(d));

/* ─── 幾何 ─── */

export const rectOf = (s: { x: number; y: number; w: number; h: number }): Rect => ({ x: s.x, y: s.y, w: s.w, h: s.h });
export const centerOf = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
const unit = (a: Pt, b: Pt): Pt => {
  const l = dist(a, b) || 1;
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
};

export const NORMAL: Record<Side, Pt> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

export function sidePoint(r: Rect, side: Side): Pt {
  if (side === "top") return { x: r.x + r.w / 2, y: r.y };
  if (side === "bottom") return { x: r.x + r.w / 2, y: r.y + r.h };
  if (side === "left") return { x: r.x, y: r.y + r.h / 2 };
  return { x: r.x + r.w, y: r.y + r.h / 2 };
}

/** 面向某一點的邊（依寬高比例算，扁的圖形左右邊比較容易選到）。 */
export function facingSide(r: Rect, toward: Pt): Side {
  const c = centerOf(r);
  const dx = (toward.x - c.x) / Math.max(r.w, 1);
  const dy = (toward.y - c.y) / Math.max(r.h, 1);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

/** 離某一點最近的邊的中點；距離在 tol 以內才算（拖曳連線時吸附到邊上）。 */
export function nearSide(r: Rect, p: Pt, tol: number): Side | null {
  let best: Side | null = null;
  let bd = tol;
  for (const s of SIDES) {
    const d = dist(sidePoint(r, s), p);
    if (d <= bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

/** 從圖形中心往 toward 的射線碰到外框的點（橢圓、菱形算真的外框，其他用方框）。 */
export function boundaryPoint(s: Shape, toward: Pt): Pt {
  const c = centerOf(s);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (!dx && !dy) return c;
  const rx = s.w / 2;
  const ry = s.h / 2;
  let t: number;
  if (s.kind === "ellipse") t = 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2);
  else if (s.kind === "diamond") t = 1 / (Math.abs(dx) / rx + Math.abs(dy) / ry);
  else t = Math.min(dx ? rx / Math.abs(dx) : Infinity, dy ? ry / Math.abs(dy) : Infinity);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/** 去掉重複的點與共線的中間點。 */
export function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    out.push(p);
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3);
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      const back = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0;
      if (Math.abs(cross) < 0.5 && !back) out.splice(out.length - 2, 1);
      else break;
    }
  }
  return out;
}

const STUB = 20;

/**
 * 直角連線：a 沿 da 方向出去、從 db 方向進到 b（da、db 是邊的法線；null 是自由端，依位置推）。
 * 兩端先各伸出一小段，再用一到兩個轉角接起來。
 */
export function orthogonal(a: Pt, da: Pt | null, b: Pt, db: Pt | null): Pt[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const horiz = Math.abs(dx) >= Math.abs(dy);
  const ax = da ?? (horiz ? { x: Math.sign(dx) || 1, y: 0 } : { x: 0, y: Math.sign(dy) || 1 });
  const bx = db ?? (horiz ? { x: -(Math.sign(dx) || 1), y: 0 } : { x: 0, y: -(Math.sign(dy) || 1) });
  const p1 = { x: a.x + ax.x * STUB, y: a.y + ax.y * STUB };
  const p2 = { x: b.x + bx.x * STUB, y: b.y + bx.y * STUB };
  const aH = ax.x !== 0;
  const bH = bx.x !== 0;
  if (aH && bH) {
    if (ax.x !== bx.x) {
      const facing = ax.x > 0 ? p1.x <= p2.x : p1.x >= p2.x;
      if (facing) {
        const mx = (a.x + b.x) / 2;
        return simplify([a, { x: mx, y: a.y }, { x: mx, y: b.y }, b]);
      }
      const my = (a.y + b.y) / 2;
      return simplify([a, p1, { x: p1.x, y: my }, { x: p2.x, y: my }, p2, b]);
    }
    const mx = ax.x > 0 ? Math.max(p1.x, p2.x) : Math.min(p1.x, p2.x);
    return simplify([a, { x: mx, y: a.y }, { x: mx, y: b.y }, b]);
  }
  if (!aH && !bH) {
    if (ax.y !== bx.y) {
      const facing = ax.y > 0 ? p1.y <= p2.y : p1.y >= p2.y;
      if (facing) {
        const my = (a.y + b.y) / 2;
        return simplify([a, { x: a.x, y: my }, { x: b.x, y: my }, b]);
      }
      const mx = (a.x + b.x) / 2;
      return simplify([a, p1, { x: mx, y: p1.y }, { x: mx, y: p2.y }, p2, b]);
    }
    const my = ax.y > 0 ? Math.max(p1.y, p2.y) : Math.min(p1.y, p2.y);
    return simplify([a, { x: a.x, y: my }, { x: b.x, y: my }, b]);
  }
  if (aH) {
    if ((b.x - a.x) * ax.x > 0 && (a.y - b.y) * bx.y > 0) return simplify([a, { x: b.x, y: a.y }, b]);
    return simplify([a, p1, { x: p1.x, y: p2.y }, p2, b]);
  }
  if ((b.y - a.y) * ax.y > 0 && (a.x - b.x) * bx.x > 0) return simplify([a, { x: a.x, y: b.y }, b]);
  return simplify([a, p1, { x: p2.x, y: p1.y }, p2, b]);
}

/** 箭頭的長度（線粗一點，箭頭跟著大一點）。 */
export const arrowLen = (width: number) => 7 + width * 2.5;

/** 箭頭蓋住的長度：線要縮回這麼多，才不會從實心箭頭裡穿出來。 */
function arrowInset(a: Arrow, width: number): number {
  const L = arrowLen(width);
  return a === "arrow" ? L * 0.85 : a === "diamond" ? L * 1.6 : a === "circle" ? L * 0.7 : 0;
}

/** 箭頭的路徑；dir 是指向尖端的單位向量。 */
export function arrowHead(a: Arrow, tip: Pt, dir: Pt, width: number): { d: string; filled: boolean } | null {
  if (a === "none") return null;
  const L = arrowLen(width);
  const W = L * 0.5;
  const n = { x: -dir.y, y: dir.x };
  const at = (back: number, side: number) => `${r2(tip.x - dir.x * back + n.x * side)} ${r2(tip.y - dir.y * back + n.y * side)}`;
  if (a === "arrow") return { d: `M${at(0, 0)}L${at(L, W)}L${at(L * 0.8, 0)}L${at(L, -W)}Z`, filled: true };
  if (a === "open") return { d: `M${at(L, W)}L${at(0, 0)}L${at(L, -W)}`, filled: false };
  if (a === "diamond") return { d: `M${at(0, 0)}L${at(L * 0.8, W * 0.9)}L${at(L * 1.6, 0)}L${at(L * 0.8, -W * 0.9)}Z`, filled: true };
  const rr = L * 0.35;
  const c = { x: tip.x - dir.x * rr, y: tip.y - dir.y * rr };
  return { d: `M${r2(c.x - rr)} ${r2(c.y)}a${r2(rr)} ${r2(rr)} 0 1 0 ${r2(rr * 2)} 0a${r2(rr)} ${r2(rr)} 0 1 0 ${r2(-rr * 2)} 0Z`, filled: true };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export interface EdgeGeo {
  /** 直角、直線：折線的點；曲線：起點、兩個控制點、終點 */
  pts: Pt[];
  /** 畫線用的 SVG 路徑（兩端已經縮回箭頭的長度） */
  path: string;
  /** 點選用的路徑（不縮回） */
  hit: string;
  mid: Pt;
  start: { tip: Pt; dir: Pt };
  end: { tip: Pt; dir: Pt };
}

type ShapeMap = Map<string, Shape>;
export const shapeMap = (d: Diagram): ShapeMap => new Map(d.shapes.map((s) => [s.id, s]));

/** 連線一端在畫面上的參考點（接在圖形上就是圖形中心）。 */
function refPoint(end: End, map: ShapeMap): Pt | null {
  if ("shape" in end) {
    const s = map.get(end.shape);
    if (!s) return null;
    return end.side ? sidePoint(s, end.side) : centerOf(s);
  }
  return { x: end.x, y: end.y };
}

function resolve(end: End, other: Pt, route: Route, map: ShapeMap): { p: Pt; dir: Pt | null } | null {
  if (!("shape" in end)) return { p: { x: end.x, y: end.y }, dir: null };
  const s = map.get(end.shape);
  if (!s) return null;
  if (end.side) return { p: sidePoint(s, end.side), dir: NORMAL[end.side] };
  if (route === "straight") return { p: boundaryPoint(s, other), dir: null };
  const side = facingSide(s, other);
  return { p: sidePoint(s, side), dir: NORMAL[side] };
}

/** 把點列畫成路徑，轉角圓一點。 */
export function roundedPath(pts: Pt[], r: number): string {
  if (!pts.length) return "";
  let d = `M${r2(pts[0].x)} ${r2(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const prev = pts[i - 1];
    const next = pts[i + 1];
    const rr = Math.min(r, dist(prev, p) / 2, dist(p, next) / 2);
    const u1 = unit(prev, p);
    const u2 = unit(p, next);
    d += `L${r2(p.x - u1.x * rr)} ${r2(p.y - u1.y * rr)}Q${r2(p.x)} ${r2(p.y)} ${r2(p.x + u2.x * rr)} ${r2(p.y + u2.y * rr)}`;
  }
  const last = pts[pts.length - 1];
  if (pts.length > 1) d += `L${r2(last.x)} ${r2(last.y)}`;
  return d;
}

/** 折線上走到一半的點（放標籤）。 */
export function halfway(pts: Pt[]): Pt {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  let left = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const l = dist(pts[i - 1], pts[i]);
    if (left <= l && l > 0) {
      const t = left / l;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
    }
    left -= l;
  }
  return pts[0] ?? { x: 0, y: 0 };
}

const bez = (p: Pt[], t: number): Pt => {
  const u = 1 - t;
  return {
    x: u * u * u * p[0].x + 3 * u * u * t * p[1].x + 3 * u * t * t * p[2].x + t * t * t * p[3].x,
    y: u * u * u * p[0].y + 3 * u * u * t * p[1].y + 3 * u * t * t * p[2].y + t * t * t * p[3].y,
  };
};

/** 連線的形狀（接的圖形不在了就是 null）。 */
export function edgeGeometry(e: Edge, map: ShapeMap): EdgeGeo | null {
  const ra = refPoint(e.from, map);
  const rb = refPoint(e.to, map);
  if (!ra || !rb) return null;
  const route = e.style.route;
  const a = resolve(e.from, rb, route, map);
  const b0 = resolve(e.to, a?.p ?? ra, route, map);
  // 直線的起點也要看終點實際的位置
  const a2 = a && b0 && route === "straight" && "shape" in e.from && !e.from.side ? resolve(e.from, b0.p, route, map) : a;
  if (!a2 || !b0) return null;
  const A = a2.p;
  const B = b0.p;
  const w = e.style.width;
  const inA = arrowInset(e.style.start, w);
  const inB = arrowInset(e.style.end, w);

  if (route === "curved") {
    const k = Math.max(30, dist(A, B) / 2.5);
    const da = a2.dir ?? unit(A, B);
    const db = b0.dir ?? unit(B, A);
    const pts = [A, { x: A.x + da.x * k, y: A.y + da.y * k }, { x: B.x + db.x * k, y: B.y + db.y * k }, B];
    const sDir = unit(pts[1], A);
    const eDir = unit(pts[2], B);
    const A1 = { x: A.x - sDir.x * inA, y: A.y - sDir.y * inA };
    const B1 = { x: B.x - eDir.x * inB, y: B.y - eDir.y * inB };
    const c = (p: Pt) => `${r2(p.x)} ${r2(p.y)}`;
    return {
      pts,
      path: `M${c(A1)}C${c(pts[1])} ${c(pts[2])} ${c(B1)}`,
      hit: `M${c(A)}C${c(pts[1])} ${c(pts[2])} ${c(B)}`,
      mid: bez(pts, 0.5),
      start: { tip: A, dir: sDir },
      end: { tip: B, dir: eDir },
    };
  }

  const pts = route === "straight" ? [A, B] : orthogonal(A, a2.dir, B, b0.dir);
  const n = pts.length;
  const sDir = n > 1 ? unit(pts[1], pts[0]) : { x: -1, y: 0 };
  const eDir = n > 1 ? unit(pts[n - 2], pts[n - 1]) : { x: 1, y: 0 };
  const drawn = pts.map((p) => ({ ...p }));
  if (n > 1) {
    drawn[0] = { x: A.x - sDir.x * inA, y: A.y - sDir.y * inA };
    drawn[n - 1] = { x: B.x - eDir.x * inB, y: B.y - eDir.y * inB };
  }
  return {
    pts,
    path: route === "straight" ? roundedPath(drawn, 0) : roundedPath(drawn, 8),
    hit: roundedPath(pts, 0),
    mid: halfway(pts),
    start: { tip: A, dir: sDir },
    end: { tip: B, dir: eDir },
  };
}

/* ─── 圖形的外框（局部座標 0..w × 0..h） ─── */

/** 這個圖形實際的圓角 */
export const radiusOf = (s: { kind: ShapeKind; style: { radius: number | null } }) => s.style.radius ?? (s.kind === "rounded" ? 12 : 0);

export function shapePath(kind: ShapeKind, w: number, h: number, radius?: number): string {
  const c = (x: number, y: number) => `${r2(x)} ${r2(y)}`;
  const roundRect = (rr: number) => {
    const r = Math.max(0, Math.min(rr, w / 2, h / 2));
    if (!r) return `M0 0H${r2(w)}V${r2(h)}H0Z`;
    const k = r * 0.4477; // 用三次曲線畫四分之一圓
    return `M${c(r, 0)}H${r2(w - r)}C${c(w - k, 0)} ${c(w, k)} ${c(w, r)}V${r2(h - r)}C${c(w, h - k)} ${c(w - k, h)} ${c(w - r, h)}H${r2(r)}C${c(k, h)} ${c(0, h - k)} ${c(0, h - r)}V${r2(r)}C${c(0, k)} ${c(k, 0)} ${c(r, 0)}Z`;
  };
  switch (kind) {
    case "rounded":
      return roundRect(radius ?? Math.min(12, w / 4, h / 4));
    case "rect":
    case "frame":
    case "image":
    case "text":
      return roundRect(radius ?? 0);
    case "ellipse":
      return `M${c(0, h / 2)}A${c(w / 2, h / 2)} 0 1 0 ${c(w, h / 2)}A${c(w / 2, h / 2)} 0 1 0 ${c(0, h / 2)}Z`;
    case "diamond":
      return `M${c(w / 2, 0)}L${c(w, h / 2)}L${c(w / 2, h)}L${c(0, h / 2)}Z`;
    case "triangle":
      return `M${c(w / 2, 0)}L${c(w, h)}L${c(0, h)}Z`;
    case "hexagon": {
      const k = Math.min(w / 4, h / 2);
      return `M${c(k, 0)}H${r2(w - k)}L${c(w, h / 2)}L${c(w - k, h)}H${r2(k)}L${c(0, h / 2)}Z`;
    }
    case "parallelogram": {
      const k = Math.min(w / 5, 24);
      return `M${c(k, 0)}H${r2(w)}L${c(w - k, h)}H0Z`;
    }
    case "cylinder": {
      const e = Math.min(h / 5, 14);
      return `M0 ${r2(e)}A${c(w / 2, e)} 0 0 1 ${c(w, e)}V${r2(h - e)}A${c(w / 2, e)} 0 0 1 ${c(0, h - e)}ZM0 ${r2(e)}A${c(w / 2, e)} 0 0 0 ${c(w, e)}`;
    }
    case "document": {
      const k = Math.min(h / 7, 12);
      return `M0 0H${r2(w)}V${r2(h - k)}C${c(w * 0.75, h - k * 3)} ${c(w * 0.5, h + k)} ${c(0, h - k * 0.6)}Z`;
    }
    case "cloud":
      return (
        `M${c(w * 0.25, h * 0.8)}` +
        `C${c(w * 0.02, h * 0.8)} ${c(w * 0.02, h * 0.45)} ${c(w * 0.2, h * 0.43)}` +
        `C${c(w * 0.18, h * 0.12)} ${c(w * 0.5, h * 0.05)} ${c(w * 0.55, h * 0.27)}` +
        `C${c(w * 0.65, h * 0.05)} ${c(w * 0.9, h * 0.15)} ${c(w * 0.82, h * 0.42)}` +
        `C${c(w * 1.02, h * 0.45)} ${c(w * 1.0, h * 0.82)} ${c(w * 0.78, h * 0.8)}Z`
      );
    case "note": {
      const k = Math.min(16, w / 4, h / 4);
      return `M0 0H${r2(w - k)}L${c(w, k)}V${r2(h)}H0ZM${c(w - k, 0)}V${r2(k)}H${r2(w)}`;
    }
    case "actor": {
      const r = Math.min(w / 3, h / 8);
      const neck = r * 2;
      const hip = h * 0.62;
      return (
        `M${c(w / 2 - r, r)}A${c(r, r)} 0 1 0 ${c(w / 2 + r, r)}A${c(r, r)} 0 1 0 ${c(w / 2 - r, r)}Z` +
        `M${c(w / 2, neck)}V${r2(hip)}M${c(0, h * 0.36)}H${r2(w)}M${c(w / 2, hip)}L${c(0, h)}M${c(w / 2, hip)}L${c(w, h)}`
      );
    }
    default:
      return `M0 0H${r2(w)}V${r2(h)}H0Z`;
  }
}

/** 圖形裡放文字的範圍（局部座標）：菱形、三角形等要往內縮；人形的文字在下面。 */
export function textBox(kind: ShapeKind, w: number, h: number): Rect {
  const pad = 6;
  switch (kind) {
    case "diamond":
      return { x: w / 4, y: h / 4, w: w / 2, h: h / 2 };
    case "triangle":
      return { x: w / 4, y: h * 0.45, w: w / 2, h: h * 0.5 };
    case "hexagon":
      return { x: Math.min(w / 4, h / 2), y: pad, w: w - Math.min(w / 4, h / 2) * 2, h: h - pad * 2 };
    case "parallelogram": {
      const k = Math.min(w / 5, 24);
      return { x: k, y: pad, w: w - k * 2, h: h - pad * 2 };
    }
    case "ellipse":
      return { x: w * 0.15, y: h * 0.15, w: w * 0.7, h: h * 0.7 };
    case "cylinder": {
      const e = Math.min(h / 5, 14);
      return { x: pad, y: e * 2, w: w - pad * 2, h: h - e * 3 };
    }
    case "document":
      return { x: pad, y: pad, w: w - pad * 2, h: h * 0.8 - pad };
    case "cloud":
      return { x: w * 0.18, y: h * 0.3, w: w * 0.64, h: h * 0.45 };
    case "actor":
      return { x: -40, y: h + 2, w: w + 80, h: 40 };
    case "frame":
    case "image":
      return { x: 0, y: 0, w, h };
    default:
      return { x: pad, y: pad, w: Math.max(0, w - pad * 2), h: Math.max(0, h - pad * 2) };
  }
}

/* ─── 編輯 ─── */

export function addShape(d: Diagram, kind: ShapeKind, x: number, y: number, extra?: Partial<Omit<Shape, "id" | "kind">>): { diagram: Diagram; id: string } {
  const info = SHAPE_INFO[kind];
  const s: Shape = {
    id: newId(),
    kind,
    x,
    y,
    w: info.w,
    h: info.h,
    text: kind === "text" ? "Text" : "",
    style: defaultShapeStyle(kind),
    ...extra,
  };
  return { diagram: { ...d, shapes: [...d.shapes, s] }, id: s.id };
}

export function addEdge(d: Diagram, from: End, to: End, style?: Partial<EdgeStyle>): { diagram: Diagram; id: string } {
  const e: Edge = { id: newId(), from, to, label: "", style: { ...defaultEdgeStyle(), ...style } };
  return { diagram: { ...d, edges: [...d.edges, e] }, id: e.id };
}

export function patchShapes(d: Diagram, ids: Iterable<string>, fn: (s: Shape) => Shape): Diagram {
  const set = new Set(ids);
  if (!d.shapes.some((s) => set.has(s.id))) return d;
  return { ...d, shapes: d.shapes.map((s) => (set.has(s.id) ? fn(s) : s)) };
}

export function patchEdges(d: Diagram, ids: Iterable<string>, fn: (e: Edge) => Edge): Diagram {
  const set = new Set(ids);
  if (!d.edges.some((e) => set.has(e.id))) return d;
  return { ...d, edges: d.edges.map((e) => (set.has(e.id) ? fn(e) : e)) };
}

export const setShapeStyle = (d: Diagram, ids: Iterable<string>, patch: Partial<ShapeStyle>) =>
  patchShapes(d, ids, (s) => ({ ...s, style: { ...s.style, ...patch } }));
export const setEdgeStyle = (d: Diagram, ids: Iterable<string>, patch: Partial<EdgeStyle>) =>
  patchEdges(d, ids, (e) => ({ ...e, style: { ...e.style, ...patch } }));

/** 換圖形的種類（位置、大小、文字照舊；文字方塊與便利貼的預設顏色跟著換）。 */
export function setKind(d: Diagram, ids: Iterable<string>, kind: ShapeKind): Diagram {
  return patchShapes(d, ids, (s) => {
    if (s.kind === kind) return s;
    const was = defaultShapeStyle(s.kind);
    const now = defaultShapeStyle(kind);
    const style = { ...s.style };
    for (const k of ["fill", "stroke", "valign", "shadow"] as const) if (style[k] === was[k]) (style as Record<string, unknown>)[k] = now[k];
    return { ...s, kind, style };
  });
}

/** 加上選取的畫板裡的圖形。 */
export function withChildren(d: Diagram, ids: Iterable<string>): Set<string> {
  const set = new Set(ids);
  for (const s of d.shapes) if (s.parent && set.has(s.parent)) set.add(s.id);
  return set;
}

/** 加上同一個群組的圖形。 */
export function withGroups(d: Diagram, ids: Iterable<string>): string[] {
  const set = new Set(ids);
  const groups = new Set(d.shapes.filter((s) => set.has(s.id) && s.group).map((s) => s.group!));
  if (!groups.size) return [...set];
  for (const s of d.shapes) if (s.group && groups.has(s.group)) set.add(s.id);
  return [...set];
}

/** 搬移選取的圖形（畫板裡的一起搬）；選取的連線，自由的端點也一起搬。 */
export function moveItems(d: Diagram, ids: Iterable<string>, dx: number, dy: number): Diagram {
  const set = withChildren(d, ids);
  if (!dx && !dy) return d;
  const mv = (end: End): End => ("shape" in end ? end : { x: end.x + dx, y: end.y + dy });
  return {
    ...d,
    shapes: d.shapes.map((s) => (set.has(s.id) ? { ...s, x: s.x + dx, y: s.y + dy } : s)),
    edges: d.edges.map((e) => (set.has(e.id) ? { ...e, from: mv(e.from), to: mv(e.to) } : e)),
  };
}

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** 拖曳控制點改大小；keep 是維持比例（Shift）。 */
export function resizeRect(r: Rect, h: Handle, dx: number, dy: number, keep = false, min = MIN_SIZE): Rect {
  let { x, y, w, h: hh } = r;
  const E = h.includes("e");
  const W = h.includes("w");
  const N = h.includes("n");
  const S = h.includes("s");
  if (E) w = r.w + dx;
  if (W) w = r.w - dx;
  if (S) hh = r.h + dy;
  if (N) hh = r.h - dy;
  if (keep && r.w > 0 && r.h > 0) {
    const ratio = r.w / r.h;
    if ((E || W) && (N || S)) {
      if (Math.abs(w / r.w) > Math.abs(hh / r.h)) hh = w / ratio;
      else w = hh * ratio;
    } else if (E || W) hh = w / ratio;
    else w = hh * ratio;
  }
  w = Math.max(min, w);
  hh = Math.max(min, hh);
  if (W) x = r.x + r.w - w;
  if (N) y = r.y + r.h - hh;
  if (keep && !(E || W)) x = r.x + (r.w - w) / 2;
  if (keep && !(N || S)) y = r.y + (r.h - hh) / 2;
  return { x, y, w, h: hh };
}

export function setRect(d: Diagram, id: string, r: Rect): Diagram {
  return patchShapes(d, [id], (s) => ({ ...s, x: r.x, y: r.y, w: Math.max(MIN_SIZE, r.w), h: Math.max(MIN_SIZE, r.h) }));
}

/** 刪掉選取的圖形與連線（接在刪掉的圖形上的連線也一起刪）。 */
export function removeItems(d: Diagram, ids: Iterable<string>): Diagram {
  const set = withChildren(d, ids);
  const shapes = d.shapes.filter((s) => !set.has(s.id));
  const left = new Set(shapes.map((s) => s.id));
  const ok = (end: End) => !("shape" in end) || left.has(end.shape);
  const edges = d.edges.filter((e) => !set.has(e.id) && ok(e.from) && ok(e.to));
  if (shapes.length === d.shapes.length && edges.length === d.edges.length) return d;
  return { ...d, shapes, edges };
}

/** 複製用的內容。 */
export interface Clip {
  shapes: Shape[];
  edges: Edge[];
}

/**
 * 複製選取的項目：選取的圖形，加上兩端都在選取裡的連線與選取的連線；
 * 連線接在沒選的圖形上的那一端改成自由的點（留在原來的位置）。
 */
export function copyItems(d: Diagram, ids: Iterable<string>): Clip {
  const set = withChildren(d, ids);
  const shapes = d.shapes.filter((s) => set.has(s.id));
  const inSet = new Set(shapes.map((s) => s.id));
  const map = shapeMap(d);
  const attached = (end: End) => "shape" in end && inSet.has(end.shape);
  const edges: Edge[] = [];
  for (const e of d.edges) {
    const both = attached(e.from) && attached(e.to);
    if (!both && !set.has(e.id)) continue;
    const geo = edgeGeometry(e, map);
    if (!geo) continue;
    const free = (end: End, p: Pt): End => ("shape" in end && !inSet.has(end.shape) ? { x: p.x, y: p.y } : end);
    edges.push({ ...e, from: free(e.from, geo.start.tip), to: free(e.to, geo.end.tip) });
  }
  return { shapes, edges };
}

/** 貼上（每個項目換新的 id，位移 dx、dy）；回傳新項目的 id。 */
export function pasteClip(d: Diagram, clip: Clip, dx: number, dy: number): { diagram: Diagram; ids: string[] } {
  const ids = new Map<string, string>();
  for (const s of clip.shapes) ids.set(s.id, newId());
  const groups = new Map<string, string>();
  const frames = new Set(d.shapes.filter((s) => s.kind === "frame").map((s) => s.id));
  const shapes = clip.shapes.map((s) => {
    const out: Shape = { ...s, id: ids.get(s.id)!, x: s.x + dx, y: s.y + dy };
    if (s.parent) {
      // 畫板一起複製就放進新的畫板；否則留在原本的畫板裡（畫板不在了就拿掉）
      const p = ids.get(s.parent) ?? (frames.has(s.parent) ? s.parent : undefined);
      if (p) out.parent = p;
      else delete out.parent;
    }
    if (s.group) {
      if (!groups.has(s.group)) groups.set(s.group, newId());
      out.group = groups.get(s.group);
    }
    return out;
  });
  const mv = (end: End): End => ("shape" in end ? { shape: ids.get(end.shape) ?? end.shape, side: end.side } : { x: end.x + dx, y: end.y + dy });
  const known = new Set([...d.shapes.map((s) => s.id), ...shapes.map((s) => s.id)]);
  const edges = clip.edges
    .map((e) => ({ ...e, id: newId(), from: mv(e.from), to: mv(e.to) }))
    .filter((e) => (!("shape" in e.from) || known.has(e.from.shape)) && (!("shape" in e.to) || known.has(e.to.shape)));
  return {
    diagram: { ...d, shapes: [...d.shapes, ...shapes], edges: [...d.edges, ...edges] },
    ids: [...shapes.map((s) => s.id), ...edges.map((e) => e.id)],
  };
}

/** 移到最上層／最下層（照原本的相對順序）。 */
export function reorder(d: Diagram, ids: Iterable<string>, front: boolean): Diagram {
  const set = new Set(ids);
  const sort = <T extends { id: string }>(all: T[]) => {
    const on = all.filter((x) => set.has(x.id));
    const off = all.filter((x) => !set.has(x.id));
    return front ? [...off, ...on] : [...on, ...off];
  };
  return { ...d, shapes: sort(d.shapes), edges: sort(d.edges) };
}

export type AlignHow = "left" | "center" | "right" | "top" | "middle" | "bottom";

/** 對齊選取的圖形（以全部的外框為準）。 */
export function alignItems(d: Diagram, ids: Iterable<string>, how: AlignHow): Diagram {
  const set = new Set(ids);
  const picked = d.shapes.filter((s) => set.has(s.id));
  const b = boundsOf(picked.map(rectOf));
  if (!b || picked.length < 2) return d;
  return patchShapes(d, set, (s) => {
    switch (how) {
      case "left":
        return { ...s, x: b.x };
      case "center":
        return { ...s, x: b.x + (b.w - s.w) / 2 };
      case "right":
        return { ...s, x: b.x + b.w - s.w };
      case "top":
        return { ...s, y: b.y };
      case "middle":
        return { ...s, y: b.y + (b.h - s.h) / 2 };
      case "bottom":
        return { ...s, y: b.y + b.h - s.h };
    }
  });
}

/** 平均分布（間距相等；頭尾不動）。 */
export function distribute(d: Diagram, ids: Iterable<string>, axis: "x" | "y"): Diagram {
  const set = new Set(ids);
  const picked = d.shapes.filter((s) => set.has(s.id));
  if (picked.length < 3) return d;
  const len = (s: Shape) => (axis === "x" ? s.w : s.h);
  const pos = (s: Shape) => (axis === "x" ? s.x : s.y);
  const sorted = [...picked].sort((a, b) => pos(a) - pos(b));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = pos(last) + len(last) - pos(first);
  const gap = (span - sorted.reduce((n, s) => n + len(s), 0)) / (sorted.length - 1);
  const at = new Map<string, number>();
  let cur = pos(first);
  for (const s of sorted) {
    at.set(s.id, cur);
    cur += len(s) + gap;
  }
  return patchShapes(d, set, (s) => (axis === "x" ? { ...s, x: at.get(s.id)! } : { ...s, y: at.get(s.id)! }));
}

/** 反轉連線方向。 */
export const flipEdges = (d: Diagram, ids: Iterable<string>) =>
  patchEdges(d, ids, (e) => ({ ...e, from: e.to, to: e.from, style: { ...e.style, start: e.style.end, end: e.style.start } }));

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

/**
 * 參考 draw.io 圖形旁的藍色箭頭：在 side 那一邊複製一個同樣的圖形（不帶文字）並連起來。
 * 那個位置已經有圖形就再往外放。
 */
export function cloneTo(d: Diagram, id: string, side: Side, gap = 60): { diagram: Diagram; id: string } | null {
  const s = d.shapes.find((x) => x.id === id);
  if (!s) return null;
  const n = NORMAL[side];
  let x = s.x + n.x * (s.w + gap);
  let y = s.y + n.y * (s.h + gap);
  const hit = (px: number, py: number) => d.shapes.some((o) => o.id !== s.id && px < o.x + o.w && px + s.w > o.x && py < o.y + o.h && py + s.h > o.y);
  for (let i = 0; i < 20 && hit(x, y); i++) {
    x += n.x ? 0 : s.w + gap / 2;
    y += n.y ? 0 : s.h + gap / 2;
  }
  const made = addShape(d, s.kind, x, y, { w: s.w, h: s.h, style: { ...s.style }, text: "" });
  const linked = addEdge(made.diagram, { shape: s.id, side }, { shape: made.id, side: OPPOSITE[side] });
  return { diagram: linked.diagram, id: made.id };
}

/* ─── 畫板、圖層、群組 ─── */

/** 畫的順序：每個畫板後面緊接著它裡面的圖形（照陣列順序）；藏起來的不畫。 */
export function renderOrder(d: Diagram): Shape[] {
  const kids = new Map<string, Shape[]>();
  for (const s of d.shapes) if (s.parent) kids.set(s.parent, [...(kids.get(s.parent) ?? []), s]);
  const out: Shape[] = [];
  for (const s of d.shapes) {
    if (s.parent || s.hidden) continue;
    out.push(s);
    if (s.kind === "frame") for (const k of kids.get(s.id) ?? []) if (!k.hidden) out.push(k);
  }
  return out;
}

/** 圖形中心落在哪個畫板裡（最上面的那個）。 */
export function frameAt(d: Diagram, p: Pt, exclude?: string): Shape | null {
  for (let i = d.shapes.length - 1; i >= 0; i--) {
    const f = d.shapes[i];
    if (f.kind !== "frame" || f.hidden || f.id === exclude) continue;
    if (p.x >= f.x && p.x <= f.x + f.w && p.y >= f.y && p.y <= f.y + f.h) return f;
  }
  return null;
}

/** 搬移或新增之後，重新決定圖形在哪個畫板裡（中心在畫板裡就放進去，拖出去就拿出來）。 */
export function reparent(d: Diagram, ids: Iterable<string>): Diagram {
  const set = new Set(ids);
  let changed = false;
  const shapes = d.shapes.map((s) => {
    if (!set.has(s.id) || s.kind === "frame") return s;
    const f = frameAt(d, centerOf(s), s.id);
    if ((f?.id ?? undefined) === s.parent) return s;
    changed = true;
    const out = { ...s };
    if (f) out.parent = f.id;
    else delete out.parent;
    return out;
  });
  if (!changed) return d;
  // 放進畫板的圖形要排在畫板後面（才會畫在畫板上面）
  const next = { ...d, shapes };
  const order = new Map(next.shapes.map((s, i) => [s.id, i]));
  const sorted = [...next.shapes].sort((a, b) => {
    const pa = a.parent ? order.get(a.parent)! : -1;
    const pb = b.parent ? order.get(b.parent)! : -1;
    const ka = a.parent && order.get(a.id)! < pa ? pa + 0.5 : order.get(a.id)!;
    const kb = b.parent && order.get(b.id)! < pb ? pb + 0.5 : order.get(b.id)!;
    return ka - kb;
  });
  return { ...next, shapes: sorted };
}

/** 新的畫板：放在既有內容的右邊，名稱是尺寸名（重複就加號碼）。 */
export function addFrame(d: Diagram, preset: { label: string; w: number; h: number }, at?: Pt): { diagram: Diagram; id: string } {
  const b = contentBounds(d);
  const x = at ? snap(at.x) : b ? snap(b.x + b.w + 80) : 0;
  const y = at ? snap(at.y) : b ? snap(b.y) : 0;
  const used = new Set(d.shapes.filter((s) => s.kind === "frame").map((s) => s.text));
  let name = preset.label;
  for (let i = 2; used.has(name); i++) name = `${preset.label} ${i}`;
  return addShape(d, "frame", x, y, { w: preset.w, h: preset.h, text: name });
}

/** 群組：至少兩個圖形；回傳群組 id。 */
export function groupItems(d: Diagram, ids: Iterable<string>): { diagram: Diagram; group: string | null } {
  const set = new Set(ids);
  const picked = d.shapes.filter((s) => set.has(s.id) && s.kind !== "frame");
  if (picked.length < 2) return { diagram: d, group: null };
  const g = newId();
  return { diagram: patchShapes(d, picked.map((s) => s.id), (s) => ({ ...s, group: g })), group: g };
}

export function ungroupItems(d: Diagram, ids: Iterable<string>): Diagram {
  return patchShapes(d, ids, (s) => {
    if (!s.group) return s;
    const out = { ...s };
    delete out.group;
    return out;
  });
}

/** 圖層清單上顯示的名稱。 */
export function layerName(s: Shape): string {
  if (s.name) return s.name;
  const t = s.text.trim().split("\n")[0];
  if (t) return t.length > 40 ? t.slice(0, 39) + "…" : t;
  return SHAPE_INFO[s.kind].label;
}

/**
 * 圖層拖曳：把圖形搬到 target 的上面（above）或下面，並放進 target 所在的畫板；
 * target 是畫板、放在它「裡面」（into）就變成那個畫板最上面的圖形。
 */
export function moveLayer(d: Diagram, id: string, target: string, place: "above" | "below" | "into"): Diagram {
  if (id === target) return d;
  const s = d.shapes.find((x) => x.id === id);
  const t = d.shapes.find((x) => x.id === target);
  if (!s || !t) return d;
  if (place === "into" && t.kind !== "frame") return d;
  const moving = [s, ...(s.kind === "frame" ? d.shapes.filter((x) => x.parent === s.id) : [])];
  const ids = new Set(moving.map((x) => x.id));
  if (ids.has(target)) return d;
  const rest = d.shapes.filter((x) => !ids.has(x.id));
  const moved = { ...s };
  const parent = s.kind === "frame" ? undefined : place === "into" ? t.id : t.parent;
  if (parent) moved.parent = parent;
  else delete moved.parent;
  // 上面＝陣列後面；畫板的上面要越過它裡面的圖形
  let at = rest.findIndex((x) => x.id === target);
  if (place === "into") {
    let last = at;
    rest.forEach((x, i) => {
      if (x.parent === t.id) last = i;
    });
    at = last + 1;
  } else if (place === "above") {
    let last = at;
    if (t.kind === "frame" && !moved.parent) rest.forEach((x, i) => x.parent === t.id && (last = i));
    at = last + 1;
  }
  rest.splice(at, 0, moved, ...moving.slice(1));
  return { ...d, shapes: rest };
}

/* ─── 輔助對齊（共用的 src/align/align.ts，Draw、白板、試算表都用） ─── */

export { measureBetween, measureGaps, snapGuides, snapSpacing, type Guide, type Measure } from "../align/align";
import { snapResize as snapResizeShared } from "../align/align";
/** 改大小時動的邊吸到其他圖形的邊或中線（最小 MIN_SIZE）。 */
export const snapResize = (r: Rect, h: string, others: Rect[], tol: number) => snapResizeShared(r, h, others, tol, MIN_SIZE);

export const snap = (v: number, grid = GRID) => Math.round(v / grid) * grid;

/** 全部內容的範圍（圖形與連線）。 */
export function contentBounds(d: Diagram): Rect | null {
  const map = shapeMap(d);
  const rects: Rect[] = d.shapes
    .filter((s) => !s.hidden)
    .map((s) => (s.kind === "actor" ? { x: s.x - 40, y: s.y, w: s.w + 80, h: s.h + 30 } : s.kind === "frame" ? { x: s.x, y: s.y - 24, w: s.w, h: s.h + 24 } : rectOf(s)));
  for (const e of d.edges) {
    const g = edgeGeometry(e, map);
    if (g) for (const p of g.pts) rects.push({ x: p.x, y: p.y, w: 0, h: 0 });
  }
  return boundsOf(rects);
}

/** 框選：完全在框裡的圖形與連線。 */
export function itemsIn(d: Diagram, box: Rect): string[] {
  const map = shapeMap(d);
  const inside = (r: Rect) => r.x >= box.x && r.y >= box.y && r.x + r.w <= box.x + box.w && r.y + r.h <= box.y + box.h;
  const out = d.shapes.filter((s) => !s.hidden && !s.locked && inside(rectOf(s))).map((s) => s.id);
  for (const e of d.edges) {
    const g = edgeGeometry(e, map);
    if (g && g.pts.every((p) => inside({ x: p.x, y: p.y, w: 0, h: 0 }))) out.push(e.id);
  }
  return out;
}

/* ─── 文字換行（匯出用；畫面上由瀏覽器排） ─── */

/** 依寬度斷行：英文照字斷，中日韓文字可以在任何字之間斷。 */
export function wrapText(text: string, maxW: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r\n?/g, "\n").split("\n")) {
    const tokens = para.match(/[⺀-鿿가-힯豈-﫿＀-￯]|[^\s⺀-鿿가-힯豈-﫿＀-￯]+|\s+/g) ?? [];
    let line = "";
    for (const t of tokens) {
      const next = line + t;
      if (!line || measure(next.trimEnd()) <= maxW) {
        line = next;
        continue;
      }
      out.push(line.trimEnd());
      line = /^\s+$/.test(t) ? "" : t;
    }
    out.push(line.trimEnd());
  }
  return out;
}

/* ─── 白板的卡片送過來 ─── */

/** 每一項變成一個圖形（便利貼變成黃色便利貼），排在既有內容下面，一列四個。 */
export function cardsToShapes(d: Diagram, items: { text: string; note: boolean }[]): Diagram {
  const b = contentBounds(d);
  const x0 = b ? b.x : 40;
  const y0 = b ? b.y + b.h + 60 : 40;
  let out = d;
  items.forEach((it, i) => {
    const kind: ShapeKind = it.note ? "note" : "rounded";
    const text = it.text.trim().length > 160 ? it.text.trim().slice(0, 157) + "…" : it.text.trim();
    const w = 160;
    const h = it.note ? 120 : 70;
    out = addShape(out, kind, snap(x0 + (i % 4) * (w + 40)), snap(y0 + Math.floor(i / 4) * 160), { w, h, text }).diagram;
  });
  return out;
}

/** 把另一張圖表整張貼在既有內容下面（白板的圖表卡片送到 Draw 文件）；每個項目換新的 id。 */
export function appendDiagram(d: Diagram, src: Diagram): Diagram {
  const from = contentBounds(src);
  if (!from) return d;
  const to = contentBounds(d);
  const x0 = to ? to.x : 40;
  const y0 = to ? to.y + to.h + 60 : 40;
  const clip = copyItems(src, [...src.shapes.map((s) => s.id), ...src.edges.map((e) => e.id)]);
  return pasteClip(d, clip, snap(x0 - from.x), snap(y0 - from.y)).diagram;
}

/** 圖表上的文字（照上下層順序、不重複），送到 Markdown 文件時用：一個圖形一個清單項目。 */
export function diagramText(json: string): string {
  const d = parseDiagram(json);
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const s of d.shapes) {
    const t = (s.text ?? "").replace(/\s+/g, " ").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    lines.push(`- ${t}`);
  }
  return lines.join("\n");
}

/* ─── 範例（新文件） ─── */

/** 新的 Draw 文件：一個小流程圖，看得出怎麼用。 */
export function starterDiagram(): Diagram {
  let d = emptyDiagram();
  const a = addShape(d, "rounded", 40, 40, { text: "Start" });
  d = a.diagram;
  const b = addShape(d, "diamond", 45, 160, { text: "Ready?" });
  d = b.diagram;
  const c = addShape(d, "rect", 220, 175, { text: "Do the thing" });
  d = c.diagram;
  d = addEdge(d, { shape: a.id, side: "bottom" }, { shape: b.id, side: "top" }).diagram;
  const yes = addEdge(d, { shape: b.id, side: "right" }, { shape: c.id, side: "left" });
  d = patchEdges(yes.diagram, [yes.id], (e) => ({ ...e, label: "Yes" }));
  return d;
}
