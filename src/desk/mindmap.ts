/**
 * 白板上的心智圖（參考 XMind）：一棵主題樹，位置由程式自動排，不用自己擺。
 *
 * - 中心主題放在 (x, y)（左上角），主要主題左右平均分配：前一半在右邊由上往下，
 *   其餘在左邊由下往上（順時針），子主題一層層往外長，父主題在子主題群的垂直中央。
 * - 樣式照 XMind 預設：中心主題深色實心、主要主題用分支顏色實心、子主題只有底線；
 *   連線是分支顏色的曲線，子主題的連線接在底線上。
 * - 可以調整：整張圖的結構（平衡、邏輯圖、組織圖、樹狀圖）與配色主題（`MapStyle`），
 *   每個主題的顏色（子主題跟著用）、外框形狀、粗體（`TopicLook`）。
 * - 主題是純文字（可以換行），不是 Markdown。
 *
 * 這裡都是純函式（只拿型別，不在執行時引用 `board.ts`）。主題的大小用 canvas 量字寬，
 * 沒有 canvas（測試）時用字數估計。
 */

export interface Topic {
  id: string;
  text: string;
  children: Topic[];
  /** 收起子主題 */
  collapsed: boolean;
  /** 自訂的顏色、形狀、粗體（沒有就照結構與配色主題的預設） */
  look?: TopicLook;
}

export interface MindMap {
  id: string;
  /** 中心主題的左上角 */
  x: number;
  y: number;
  root: Topic;
  /** 結構與配色主題（沒有就是平衡圖＋Classic） */
  style?: MapStyle;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Side = "right" | "left";

export const ROOT_TEXT = "Central Topic";
export const MAIN_TEXT = (n: number) => `Main Topic ${n}`;
export const SUB_TEXT = "Subtopic";

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const topic = (text: string, children: Topic[] = []): Topic => ({ id: newId(), text, children, collapsed: false });

/** XMind 的預設：中心主題＋四個主要主題 */
export function newMap(x: number, y: number, mains = 4): MindMap {
  return {
    id: newId(),
    x,
    y,
    root: topic(
      ROOT_TEXT,
      Array.from({ length: mains }, (_, i) => topic(MAIN_TEXT(i + 1))),
    ),
  };
}

/* ─── 讀寫 ─── */

function parseTopic(v: unknown, depth = 0): Topic | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || typeof o.id !== "string" || depth > 64) return null;
  const kids = Array.isArray(o.children) ? o.children.map((c) => parseTopic(c, depth + 1)).filter((c): c is Topic => !!c) : [];
  const look = parseLook(o.look);
  return { id: o.id, text: typeof o.text === "string" ? o.text : "", children: kids, collapsed: o.collapsed === true, ...(look ? { look } : {}) };
}

export function parseMaps(v: unknown): MindMap[] {
  if (!Array.isArray(v)) return [];
  const out: MindMap[] = [];
  for (const o of v as Record<string, unknown>[]) {
    if (!o || typeof o !== "object" || typeof o.id !== "string") continue;
    const root = parseTopic(o.root);
    if (!root) continue;
    const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
    const style = parseMapStyle(o.style);
    out.push({ id: o.id, x: num(o.x), y: num(o.y), root, ...(style ? { style } : {}) });
  }
  return out;
}

const round = (n: number) => Math.round(n * 10) / 10;

function topicData(t: Topic): unknown {
  return {
    id: t.id,
    text: t.text,
    ...(t.collapsed ? { collapsed: true } : {}),
    ...(t.look ? { look: t.look } : {}),
    ...(t.children.length ? { children: t.children.map(topicData) } : {}),
  };
}

export function mapsData(maps: MindMap[]) {
  return maps.map((m) => ({ id: m.id, x: round(m.x), y: round(m.y), ...(m.style ? { style: m.style } : {}), root: topicData(m.root) }));
}

/* ─── 找主題 ─── */

export interface Found {
  topic: Topic;
  parent: Topic | null;
  index: number;
  depth: number;
}

export function findTopic(m: MindMap, id: string): Found | null {
  const walk = (t: Topic, parent: Topic | null, index: number, depth: number): Found | null => {
    if (t.id === id) return { topic: t, parent, index, depth };
    for (let i = 0; i < t.children.length; i++) {
      const r = walk(t.children[i], t, i, depth + 1);
      if (r) return r;
    }
    return null;
  };
  return walk(m.root, null, 0, 0);
}

/** a 是不是 b 自己或 b 的子孫 */
export function isWithin(m: MindMap, id: string, ancestor: string): boolean {
  const a = findTopic(m, ancestor);
  if (!a) return false;
  const walk = (t: Topic): boolean => t.id === id || t.children.some(walk);
  return walk(a.topic);
}

export function countTopics(t: Topic): number {
  return 1 + t.children.reduce((n, c) => n + countTopics(c), 0);
}

/* ─── 修改（回傳新的陣列，不改原本的物件） ─── */

/** 把樹裡的某個主題換成 fn 的結果（fn 回傳 null 就刪掉） */
function mapTopic(t: Topic, id: string, fn: (t: Topic) => Topic | null): Topic | null {
  if (t.id === id) return fn(t);
  let changed = false;
  const kids: Topic[] = [];
  for (const c of t.children) {
    const n = mapTopic(c, id, fn);
    if (n !== c) changed = true;
    if (n) kids.push(n);
  }
  return changed ? { ...t, children: kids } : t;
}

function editMap(maps: MindMap[], mapId: string, fn: (m: MindMap) => MindMap | null): MindMap[] {
  const i = maps.findIndex((m) => m.id === mapId);
  if (i < 0) return maps;
  const n = fn(maps[i]);
  if (n === maps[i]) return maps;
  const out = [...maps];
  if (n) out[i] = n;
  else out.splice(i, 1);
  return out;
}

function editTopic(maps: MindMap[], mapId: string, id: string, fn: (t: Topic) => Topic | null): MindMap[] {
  return editMap(maps, mapId, (m) => {
    const root = mapTopic(m.root, id, fn);
    if (!root) return null;
    return root === m.root ? m : { ...m, root };
  });
}

export function setText(maps: MindMap[], mapId: string, id: string, text: string): MindMap[] {
  return editTopic(maps, mapId, id, (t) => (t.text === text ? t : { ...t, text }));
}

export function toggleCollapse(maps: MindMap[], mapId: string, id: string, collapsed?: boolean): MindMap[] {
  return editTopic(maps, mapId, id, (t) => {
    const c = collapsed ?? !t.collapsed;
    return !t.children.length || t.collapsed === c ? t : { ...t, collapsed: c };
  });
}

/** 在 parent 底下加一個子主題（index 省略就是最後面）；收起的會展開。 */
export function addChild(maps: MindMap[], mapId: string, parentId: string, text?: string, index?: number): { maps: MindMap[]; id: string | null } {
  const m = maps.find((x) => x.id === mapId);
  const f = m && findTopic(m, parentId);
  if (!m || !f) return { maps, id: null };
  const t = topic(text ?? (f.depth === 0 ? MAIN_TEXT(f.topic.children.length + 1) : SUB_TEXT));
  const next = editTopic(maps, mapId, parentId, (p) => {
    const kids = [...p.children];
    kids.splice(index ?? kids.length, 0, t);
    return { ...p, children: kids, collapsed: false };
  });
  return { maps: next, id: t.id };
}

/** 在主題的前面或後面加一個同層的主題；中心主題沒有同層，改成加子主題。 */
export function addSibling(maps: MindMap[], mapId: string, id: string, before = false): { maps: MindMap[]; id: string | null } {
  const m = maps.find((x) => x.id === mapId);
  const f = m && findTopic(m, id);
  if (!m || !f) return { maps, id: null };
  if (!f.parent) return addChild(maps, mapId, id);
  return addChild(maps, mapId, f.parent.id, f.depth === 1 ? MAIN_TEXT(f.parent.children.length + 1) : SUB_TEXT, f.index + (before ? 0 : 1));
}

/** 刪掉主題（連同子主題）；刪中心主題就是刪掉整張心智圖。 */
export function removeTopic(maps: MindMap[], mapId: string, id: string): MindMap[] {
  return editTopic(maps, mapId, id, () => null);
}

export type DropMode = "child" | "before" | "after";

/**
 * 把主題（連同子主題）搬到另一個主題底下（child）或前後（before／after），可以搬到別張心智圖。
 * 不能搬進自己的子孫；中心主題不能這樣搬（拖中心主題是搬整張圖）。
 */
export function moveTopic(
  maps: MindMap[],
  from: { map: string; topic: string },
  to: { map: string; topic: string; mode: DropMode },
): MindMap[] {
  const src = maps.find((m) => m.id === from.map);
  const f = src && findTopic(src, from.topic);
  if (!src || !f || !f.parent) return maps;
  if (from.map === to.map && isWithin(src, to.topic, from.topic)) return maps;
  const dst0 = maps.find((m) => m.id === to.map);
  const target = dst0 && findTopic(dst0, to.topic);
  if (!dst0 || !target) return maps;
  const mode: DropMode = target.parent ? to.mode : "child";
  // 放回原位就不動
  if (mode !== "child" && target.parent && target.parent.id === f.parent.id && from.map === to.map) {
    const at = target.index + (mode === "after" ? 1 : 0);
    if (at === f.index || at === f.index + 1) return maps;
  }
  if (mode === "child" && target.topic.id === f.parent.id && f.index === target.topic.children.length - 1 && from.map === to.map) return maps;
  const moved = f.topic;
  let out = removeTopic(maps, from.map, from.topic);
  const dst = out.find((m) => m.id === to.map)!;
  const t2 = findTopic(dst, to.topic)!;
  if (mode === "child") {
    out = editTopic(out, to.map, to.topic, (p) => ({ ...p, children: [...p.children, moved], collapsed: false }));
  } else {
    const at = t2.index + (mode === "after" ? 1 : 0);
    out = editTopic(out, to.map, t2.parent!.id, (p) => {
      const kids = [...p.children];
      kids.splice(at, 0, moved);
      return { ...p, children: kids };
    });
  }
  return out;
}

/** 把主題拉出來變成一張新的心智圖（中心主題在 (x, y)）。 */
export function detachTopic(maps: MindMap[], mapId: string, id: string, x: number, y: number): { maps: MindMap[]; id: string | null } {
  const m = maps.find((q) => q.id === mapId);
  const f = m && findTopic(m, id);
  if (!m || !f || !f.parent) return { maps, id: null };
  const map: MindMap = { id: newId(), x, y, root: f.topic };
  return { maps: [...removeTopic(maps, mapId, id), map], id: map.id };
}

export function moveMap(maps: MindMap[], mapId: string, dx: number, dy: number): MindMap[] {
  return editMap(maps, mapId, (m) => ({ ...m, x: m.x + dx, y: m.y + dy }));
}

/* ─── 匯出 ─── */

/** 心智圖 → Markdown：中心主題是粗體段落，其他是巢狀清單（送到 Dock 用）。 */
export function mapOutline(m: MindMap): string {
  const esc = (s: string) => s.replace(/\s*\n\s*/g, " ").trim() || "(empty)";
  const lines: string[] = [];
  const walk = (t: Topic, depth: number) => {
    lines.push(`${"  ".repeat(depth)}- ${esc(t.text)}`);
    t.children.forEach((c) => walk(c, depth + 1));
  };
  m.root.children.forEach((c) => walk(c, 0));
  return `**${esc(m.root.text)}**` + (lines.length ? "\n\n" + lines.join("\n") : "");
}

/* ─── 樣式 ─── */

/** 結構：左右平衡（XMind 的 Mind Map）、邏輯圖（只往右）、組織圖（往下）、樹狀圖（往右下縮排） */
export type Structure = "map" | "right" | "org" | "tree";
export type ThemeId = "classic" | "ocean" | "sunset" | "pastel" | "mono" | "ink";
/** 主題的外框：圓角、方角、膠囊、底線、純文字 */
export type Shape = "rounded" | "rect" | "pill" | "underline" | "plain";
export type TopicColor = "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "red";

export interface MapStyle {
  structure?: Structure;
  theme?: ThemeId;
}
export interface TopicLook {
  color?: TopicColor;
  shape?: Shape;
  bold?: boolean;
}

export const STRUCTURES: { id: Structure; label: string }[] = [
  { id: "map", label: "Mind map" },
  { id: "right", label: "Logic chart" },
  { id: "org", label: "Org chart" },
  { id: "tree", label: "Tree" },
];
export const SHAPES: { id: Shape; label: string }[] = [
  { id: "rounded", label: "Rounded" },
  { id: "rect", label: "Rectangle" },
  { id: "pill", label: "Pill" },
  { id: "underline", label: "Underline" },
  { id: "plain", label: "Text only" },
];
/** 主題顏色（覆蓋配色主題，子主題跟著用） */
export const TOPIC_COLORS: Record<TopicColor, string> = {
  gray: "#7d848f",
  brown: "#9a6b4f",
  orange: "#e07b20",
  yellow: "#c99a06",
  green: "#22a06b",
  blue: "#2f80ed",
  purple: "#8e4ec6",
  pink: "#d6457e",
  red: "#e5484d",
};
const COLOR_KEYS = Object.keys(TOPIC_COLORS) as TopicColor[];

/**
 * 配色主題。顏色可以是 CSS 變數（中心主題的預設跟著淺色／深色主題，定義在 `board.css`）。
 * mainFill：主要主題實心（solid）、淡色底（soft）或只有外框（outline）。
 */
export interface Theme {
  id: ThemeId;
  label: string;
  rootBg: string;
  rootFg: string;
  branches: string[];
  mainFill: "solid" | "soft" | "outline";
}
export const THEMES: Theme[] = [
  {
    id: "classic",
    label: "Classic",
    rootBg: "var(--mm-root-bg)",
    rootFg: "var(--mm-root-fg)",
    branches: ["#2f80ed", "#e5484d", "#22a06b", "#e07b20", "#8e4ec6", "#0a9396", "#d6457e", "#a07a12"],
    mainFill: "solid",
  },
  {
    id: "ocean",
    label: "Ocean",
    rootBg: "#0b3d63",
    rootFg: "#ffffff",
    branches: ["#1f77b4", "#0a9396", "#3d5a80", "#4895ef", "#2a9d8f", "#5e60ce"],
    mainFill: "solid",
  },
  {
    id: "sunset",
    label: "Sunset",
    rootBg: "#5c2a1e",
    rootFg: "#ffffff",
    branches: ["#e76f51", "#d62828", "#f08c00", "#c2185b", "#b5651d", "#e85d75"],
    mainFill: "solid",
  },
  {
    id: "pastel",
    label: "Pastel",
    rootBg: "var(--mm-root-bg)",
    rootFg: "var(--mm-root-fg)",
    branches: ["#2f80ed", "#e5484d", "#22a06b", "#e07b20", "#8e4ec6", "#0a9396", "#d6457e", "#a07a12"],
    mainFill: "soft",
  },
  {
    id: "mono",
    label: "Mono",
    rootBg: "#3b5bdb",
    rootFg: "#ffffff",
    branches: ["#4c6ef5"],
    mainFill: "soft",
  },
  {
    id: "ink",
    label: "Ink",
    rootBg: "var(--ed-text)",
    rootFg: "var(--board-bg)",
    branches: ["var(--ed-text)"],
    mainFill: "outline",
  },
];
export const themeOf = (id?: ThemeId): Theme => THEMES.find((t) => t.id === id) ?? THEMES[0];
export const structureOf = (m: MindMap): Structure => m.style?.structure ?? "map";

const STRUCTURE_IDS = STRUCTURES.map((s) => s.id);
const THEME_IDS = THEMES.map((t) => t.id);
const SHAPE_IDS = SHAPES.map((s) => s.id);

export function parseMapStyle(v: unknown): MapStyle | undefined {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return undefined;
  const s: MapStyle = {};
  if (STRUCTURE_IDS.includes(o.structure as Structure)) s.structure = o.structure as Structure;
  if (THEME_IDS.includes(o.theme as ThemeId)) s.theme = o.theme as ThemeId;
  return s.structure || s.theme ? s : undefined;
}

export function parseLook(v: unknown): TopicLook | undefined {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return undefined;
  const s: TopicLook = {};
  if (COLOR_KEYS.includes(o.color as TopicColor)) s.color = o.color as TopicColor;
  if (SHAPE_IDS.includes(o.shape as Shape)) s.shape = o.shape as Shape;
  if (o.bold === true) s.bold = true;
  return s.color || s.shape || s.bold ? s : undefined;
}

/** 改整張圖的結構或配色 */
export function setMapStyle(maps: MindMap[], mapId: string, patch: MapStyle): MindMap[] {
  return editMap(maps, mapId, (m) => {
    const style = parseMapStyle({ ...m.style, ...patch });
    return { ...m, style };
  });
}

/** 改主題的顏色、形狀、粗體；值是 undefined 的欄位拿掉（回到預設），patch 是 null 就全部拿掉 */
export function setTopicLook(maps: MindMap[], mapId: string, id: string, patch: Partial<Record<keyof TopicLook, unknown>> | null): MindMap[] {
  return editTopic(maps, mapId, id, (t) => {
    const merged: Record<string, unknown> = patch ? { ...t.look } : {};
    for (const [k, v] of Object.entries(patch ?? {})) {
      if (v === undefined || v === false) delete merged[k];
      else merged[k] = v;
    }
    const look = parseLook(merged);
    return JSON.stringify(look) === JSON.stringify(t.look) ? t : { ...t, look };
  });
}

/* ─── 排版 ─── */

export interface TopicStyle {
  font: number;
  weight: number;
  padX: number;
  padY: number;
  minW: number;
}

/** 字級、粗細、內距（MindMapView 直接用這些數字畫，量字寬與畫面一定一致） */
export function styleOf(depth: number, look?: TopicLook): TopicStyle {
  const s =
    depth === 0
      ? { font: 20, weight: 700, padX: 24, padY: 14, minW: 90 }
      : depth === 1
        ? { font: 15, weight: 600, padX: 16, padY: 8, minW: 56 }
        : { font: 14, weight: 400, padX: 6, padY: 5, minW: 40 };
  if (look?.bold) s.weight = 700;
  if (look?.shape === "pill") s.padX += 8;
  return s;
}

export const lineHeight = (font: number) => Math.round(font * 1.4);

let canvas: CanvasRenderingContext2D | null | undefined;
let family = "";
/** 量字寬：有 canvas 就量，沒有就估計（中日韓字一個字寬、其他半個） */
export function measureText(text: string, font: number, weight: number): number {
  if (canvas === undefined) {
    try {
      canvas = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
    } catch {
      canvas = null;
    }
    if (canvas && typeof getComputedStyle === "function") family = getComputedStyle(document.body).fontFamily || "sans-serif";
  }
  if (canvas) {
    canvas.font = `${weight} ${font}px ${family}`;
    return canvas.measureText(text).width;
  }
  let w = 0;
  for (const ch of text) w += /[⺀-鿿가-힯＀-￯]/.test(ch) ? font : font * 0.56;
  return w;
}

/** 主題的大小（文字可以換行，空的主題保留一個字的寬度；多留 4px 給外框） */
export function topicSize(text: string, depth: number, look?: TopicLook): { w: number; h: number } {
  const s = styleOf(depth, look);
  const lines = text.split("\n");
  const tw = Math.max(...lines.map((l) => measureText(l, s.font, s.weight)), s.font);
  return { w: Math.max(s.minW, Math.ceil(tw) + s.padX * 2 + 4), h: lines.length * lineHeight(s.font) + s.padY * 2 };
}

export interface TopicNode extends Box {
  id: string;
  depth: number;
  side: Side;
  parent: string | null;
  /** 收起時藏了幾個主題 */
  hidden: number;
  hasChildren: boolean;
  /** 往子主題連線的出口 */
  out: { x: number; y: number };
  /** 從父主題連進來的入口 */
  in: { x: number; y: number };
  /** 收合鈕的位置 */
  fold: { x: number; y: number };
  /** 分支顏色（CSS 色彩，可能是變數） */
  color: string;
  /** 實心主題上的文字顏色 */
  on: string;
  shape: Shape;
  fill: "solid" | "soft" | "outline" | "none";
  style: TopicStyle;
}

export interface MapLayout {
  nodes: Map<string, TopicNode>;
  /** 畫的順序（父在前） */
  order: string[];
  links: { from: string; to: string; d: string; color: string; depth: number }[];
  bounds: Box;
  structure: Structure;
}

/** 子主題往外的距離、同層之間的距離 */
const H_GAP = (depth: number) => (depth === 0 ? 64 : 36);
const V_GAP = (depth: number) => (depth <= 1 ? 22 : 8);
const ORG_H_GAP = (depth: number) => (depth === 0 ? 28 : 16);
const ORG_V_GAP = (depth: number) => (depth === 0 ? 52 : 36);
const TREE_INDENT = 36;
const TREE_V_GAP = 12;

const cache = new WeakMap<MindMap, MapLayout>();

/**
 * 排版。`draft` 是正在編輯的主題（用還沒存的文字排，打字時畫面跟著長）。
 */
export function layoutMap(m: MindMap, draft?: { id: string; text: string } | null): MapLayout {
  if (!draft) {
    const hit = cache.get(m);
    if (hit) return hit;
  }
  const structure = structureOf(m);
  const theme = themeOf(m.style?.theme);
  const textOf = (t: Topic) => (draft && draft.id === t.id ? draft.text : t.text);
  const shapeOf = (t: Topic, depth: number): Shape =>
    t.look?.shape ?? (depth >= 2 ? (structure === "map" || structure === "right" ? "underline" : "rounded") : "rounded");
  const sizes = new Map<string, { w: number; h: number }>();
  const size = (t: Topic, depth: number) => {
    let s = sizes.get(t.id);
    if (!s) sizes.set(t.id, (s = topicSize(textOf(t), depth, { ...t.look, shape: shapeOf(t, depth) })));
    return s;
  };
  const visible = (t: Topic) => (t.collapsed ? [] : t.children);

  const nodes = new Map<string, TopicNode>();
  const order: string[] = [];
  const links: MapLayout["links"] = [];

  const makeNode = (t: Topic, depth: number, x: number, y: number, side: Side, parent: TopicNode | null, branchColor: string): TopicNode => {
    const s = size(t, depth);
    const shape = shapeOf(t, depth);
    const own = t.look?.color ? TOPIC_COLORS[t.look.color] : null;
    const color = depth === 0 ? (own ?? theme.rootBg) : (own ?? branchColor);
    const on = depth === 0 && !own ? theme.rootFg : "#ffffff";
    const boxed = shape !== "underline" && shape !== "plain";
    const fill: TopicNode["fill"] = !boxed ? "none" : depth === 0 ? "solid" : depth === 1 ? theme.mainFill : "outline";
    const n: TopicNode = {
      id: t.id,
      x,
      y,
      w: s.w,
      h: s.h,
      depth,
      side,
      parent: parent?.id ?? null,
      hidden: t.collapsed ? countTopics(t) - 1 : 0,
      hasChildren: t.children.length > 0,
      out: { x: 0, y: 0 },
      in: { x: 0, y: 0 },
      fold: { x: 0, y: 0 },
      color,
      on,
      shape,
      fill,
      style: styleOf(depth, { ...t.look, shape }),
    };
    nodes.set(t.id, n);
    order.push(t.id);
    return n;
  };
  /** 主要主題的分支顏色 */
  const branchColor = (i: number) => theme.branches[i % theme.branches.length];

  const root = m.root;
  if (structure === "org") {
    // 組織圖：子主題排在父主題下方一排，父主題在子主題群的水平中央
    const widths = new Map<string, number>();
    const width = (t: Topic, depth: number): number => {
      const kids = visible(t);
      let sum = 0;
      kids.forEach((c, i) => (sum += width(c, depth + 1) + (i ? ORG_H_GAP(depth) : 0)));
      const w = Math.max(size(t, depth).w, sum);
      widths.set(t.id, w);
      return w;
    };
    const place = (t: Topic, depth: number, cx: number, top: number, parent: TopicNode | null, color: string) => {
      const s = size(t, depth);
      const n = makeNode(t, depth, cx - s.w / 2, top, "right", parent, color);
      n.out = { x: cx, y: top + s.h };
      n.in = { x: cx, y: top };
      n.fold = { x: cx, y: top + s.h + 9 };
      if (parent) {
        const midY = parent.out.y + (n.in.y - parent.out.y) / 2;
        links.push({ from: parent.id, to: t.id, d: elbowV(parent.out, n.in, midY), color: n.color, depth });
      }
      const kids = visible(t);
      if (!kids.length) return;
      let total = 0;
      kids.forEach((c, i) => (total += widths.get(c.id)! + (i ? ORG_H_GAP(depth) : 0)));
      let x = cx - total / 2;
      const childTop = top + s.h + ORG_V_GAP(depth);
      kids.forEach((c, i) => {
        const w = widths.get(c.id)!;
        place(c, depth + 1, x + w / 2, childTop, n, depth === 0 ? branchColor(i) : n.color);
        x += w + ORG_H_GAP(depth);
      });
    };
    width(root, 0);
    place(root, 0, m.x + size(root, 0).w / 2, m.y, null, theme.rootBg);
  } else if (structure === "tree") {
    // 樹狀圖：子主題往右縮排、由上往下排，從父主題左下方拉一條直線下來
    const place = (t: Topic, depth: number, x: number, y: number, parent: TopicNode | null, color: string): number => {
      const s = size(t, depth);
      const n = makeNode(t, depth, x, y, "right", parent, color);
      const lead = Math.min(TREE_INDENT / 2, s.w / 2);
      n.out = { x: x + lead, y: y + s.h };
      n.in = { x, y: n.shape === "underline" ? y + s.h : y + s.h / 2 };
      n.fold = { x: x + lead, y: y + s.h + 9 };
      if (parent) links.push({ from: parent.id, to: t.id, d: elbowTree(parent.out, n.in), color: n.color, depth });
      let bottom = y + s.h;
      visible(t).forEach((c, i) => {
        bottom = place(c, depth + 1, x + TREE_INDENT + (depth === 0 ? 8 : 0), bottom + TREE_V_GAP, n, depth === 0 ? branchColor(i) : n.color);
      });
      return bottom;
    };
    place(root, 0, m.x, m.y, null, theme.rootBg);
    // 同一個父主題的連線共用一段直線：後面的先畫，上面那段才是第一個子主題的顏色
    links.reverse();
  } else {
    // 左右平衡（map）或只往右（right）
    const heights = new Map<string, number>();
    const subtree = (t: Topic, depth: number): number => {
      const own = size(t, depth).h;
      const kids = visible(t);
      let sum = 0;
      kids.forEach((c, i) => (sum += subtree(c, depth + 1) + (i ? V_GAP(depth + 1) : 0)));
      const h = Math.max(own, sum);
      heights.set(t.id, h);
      return h;
    };
    const anchorY = (n: TopicNode) => (n.shape === "underline" ? n.y + n.h : n.y + n.h / 2);
    const place = (t: Topic, depth: number, side: Side, parent: TopicNode, parentOut: { x: number; y: number }, x: number, cy: number, color: string) => {
      const s = size(t, depth);
      const left = side === "right" ? x : x - s.w;
      const n = makeNode(t, depth, left, cy - s.h / 2, side, parent, color);
      const ay = anchorY(n);
      n.out = { x: side === "right" ? left + s.w : left, y: ay };
      n.in = { x: side === "right" ? left : left + s.w, y: ay };
      n.fold = { x: n.out.x + (side === "right" ? 9 : -9), y: ay };
      links.push({ from: parent.id, to: t.id, d: curve(parentOut, n.in), color: n.color, depth });
      placeKids(visible(t), depth, side, n, n.out, (_, i) => (depth === 0 ? branchColor(i) : n.color));
    };
    const placeKids = (
      kids: Topic[],
      depth: number,
      side: Side,
      parent: TopicNode,
      out: { x: number; y: number },
      colorOf: (c: Topic, i: number) => string,
      indexOf: (c: Topic, i: number) => number = (_, i) => i,
    ) => {
      if (!kids.length) return;
      let total = 0;
      kids.forEach((c, i) => (total += heights.get(c.id)! + (i ? V_GAP(depth + 1) : 0)));
      let y = parent.y + parent.h / 2 - total / 2;
      const x = side === "right" ? out.x + H_GAP(depth) : out.x - H_GAP(depth);
      kids.forEach((c, i) => {
        const h = heights.get(c.id)!;
        place(c, depth + 1, side, parent, out, x, y + h / 2, colorOf(c, indexOf(c, i)));
        y += h + V_GAP(depth + 1);
      });
    };
    subtree(root, 0);
    const rn = makeNode(root, 0, m.x, m.y, "right", null, theme.rootBg);
    rn.out = { x: rn.x + rn.w, y: rn.y + rn.h / 2 };
    rn.in = { x: rn.x, y: rn.y + rn.h / 2 };
    rn.fold = rn.out;
    const mains = visible(root);
    const nRight = structure === "right" ? mains.length : Math.ceil(mains.length / 2);
    const index = new Map(mains.map((c, i) => [c.id, i]));
    const colorOf = (c: Topic) => branchColor(index.get(c.id)!);
    placeKids(mains.slice(0, nRight), 0, "right", rn, rn.out, colorOf);
    // 左邊由下往上（順時針），畫的時候由上往下排，所以反過來
    placeKids(mains.slice(nRight).reverse(), 0, "left", rn, rn.in, colorOf);
  }

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const n of nodes.values()) {
    x0 = Math.min(x0, n.x);
    y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + n.w);
    y1 = Math.max(y1, n.y + n.h);
  }
  const out: MapLayout = { nodes, order, links, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, structure };
  if (!draft) cache.set(m, out);
  return out;
}

const f1 = (n: number) => Math.round(n * 10) / 10;

/** 父主題出口到子主題入口的曲線（水平方向的控制點，像 XMind） */
function curve(p: { x: number; y: number }, q: { x: number; y: number }): string {
  const dx = (q.x - p.x) * 0.5;
  return `M ${f1(p.x)} ${f1(p.y)} C ${f1(p.x + dx)} ${f1(p.y)}, ${f1(q.x - dx)} ${f1(q.y)}, ${f1(q.x)} ${f1(q.y)}`;
}

/** 組織圖的折線：往下、橫過去、再往下 */
function elbowV(p: { x: number; y: number }, q: { x: number; y: number }, midY: number): string {
  return `M ${f1(p.x)} ${f1(p.y)} V ${f1(midY)} H ${f1(q.x)} V ${f1(q.y)}`;
}

/** 樹狀圖的折線：從父主題左下往下，再往右接到子主題 */
function elbowTree(p: { x: number; y: number }, q: { x: number; y: number }): string {
  const r = Math.min(6, Math.abs(q.y - p.y), Math.abs(q.x - p.x));
  return `M ${f1(p.x)} ${f1(p.y)} V ${f1(q.y - r)} Q ${f1(p.x)} ${f1(q.y)} ${f1(p.x + r)} ${f1(q.y)} H ${f1(q.x)}`;
}

export const mapBounds = (m: MindMap): Box => layoutMap(m).bounds;

/** 拖曳主題時，放在目標主題的前後看哪個方向（組織圖的同層主題是左右排） */
export const siblingAxis = (m: MindMap): "x" | "y" => (structureOf(m) === "org" ? "x" : "y");

/* ─── 鍵盤移動 ─── */

type Arrow = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/**
 * 方向鍵：往外到最近的子主題、往內到父主題、另一個方向到畫面上最近的同層主題。
 * 平衡圖、邏輯圖、樹狀圖：←→ 是往內往外（看主題在哪一邊），↑↓ 是同層；中心主題按 ←→ 到那一邊。
 * 組織圖：↓ 子主題、↑ 父主題、←→ 同層。
 */
export function neighbor(m: MindMap, id: string, key: Arrow): string | null {
  const L = layoutMap(m);
  const n = L.nodes.get(id);
  if (!n) return null;
  const all = [...L.nodes.values()];
  const vertical = L.structure === "org";
  const along = (b: TopicNode) => (vertical ? b.x + b.w / 2 : b.y + b.h / 2);
  const closest = (cands: TopicNode[]) =>
    cands.length ? cands.reduce((a, b) => (Math.abs(along(a) - along(n)) <= Math.abs(along(b) - along(n)) ? a : b)).id : null;

  const isDepthKey = vertical ? key === "ArrowUp" || key === "ArrowDown" : key === "ArrowLeft" || key === "ArrowRight";
  if (isDepthKey) {
    if (vertical) {
      if (key === "ArrowUp") return n.parent;
      return closest(all.filter((k) => k.parent === n.id));
    }
    const outward: Side = key === "ArrowRight" ? "right" : "left";
    if (n.depth > 0 && outward !== n.side) return n.parent;
    return closest(all.filter((k) => k.parent === n.id && k.side === outward));
  }
  if (n.depth === 0) return null;
  const forward = vertical ? key === "ArrowRight" : key === "ArrowDown";
  // 先找同一個父主題底下的，再找同一層、同一邊的
  const pick = (cands: TopicNode[]) =>
    closest(cands.filter((k) => k.id !== n.id && (forward ? along(k) > along(n) : along(k) < along(n))));
  return (
    pick(all.filter((k) => k.parent === n.parent && k.side === n.side)) ??
    pick(all.filter((k) => k.depth === n.depth && k.side === n.side))
  );
}
