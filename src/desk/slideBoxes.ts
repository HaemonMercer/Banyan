/**
 * 投影片上的物件（參考 PowerPoint、Keynote）：文字方塊、圖片、形狀，可以自由擺放、改大小、排上下層。
 *
 * 一張投影片 = 主文字方塊（Body：這張投影片的 Markdown，原本整張投影片的內容）＋其他物件。
 * 主文字方塊的位置大小存在 `main`（沒有就是預設的版面），其他物件存在 `boxes`（陣列順序＝上下層，後面的在上面）。
 * 兩者都跟動畫一起存在每張投影片的設定（`slideAnim.ts` 的 `SlideAnim`），所以新增、刪除、複製、
 * 搬移投影片時一起跟著走。座標是投影片的設計尺寸 960×540。這裡都是純函式。
 */

import { isInk, type Ink } from "../editor/inline";

export const SLIDE_W = 960;
export const SLIDE_H = 540;

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 主文字方塊的預設位置（跟原本投影片的內距一樣：上下 56、左右 72） */
export const MAIN_FRAME: Frame = { x: 72, y: 56, w: 816, h: 428 };
/** 主文字方塊的代號（選取、對齊時跟其他物件一起算） */
export const MAIN = "main";

export type BoxKind = "text" | "image" | "shape";
export type ShapeKind = "rect" | "round" | "ellipse" | "triangle" | "arrow" | "diamond" | "pentagon" | "hexagon" | "star" | "callout" | "line";
export type ImageFit = "contain" | "cover";

export interface SlideBox extends Frame {
  id: string;
  kind: BoxKind;
  /** 文字方塊、形狀裡的文字（Markdown） */
  text?: string;
  /** 圖片的路徑（`media/…`） */
  src?: string;
  alt?: string;
  shape?: ShapeKind;
  fit?: ImageFit;
  /** 旋轉（度，順時針；沒有是 0） */
  rot?: number;
  /** 填色、框線：色盤名稱，null 是沒有 */
  fill?: Ink | null;
  line?: Ink | null;
  /** 框線粗細（設計尺寸的 px，960 寬＝960pt，所以也是 pt；沒有是 `DEFAULT_LW`） */
  lw?: number;
  /** 框線樣式（沒有是實線） */
  dash?: LineDash;
  /** 不透明度 10～100（沒有是 100） */
  opacity?: number;
  /** 陰影 */
  shadow?: true;
}

export type LineDash = "dash" | "dot";
/** 框線的預設粗細 */
export const DEFAULT_LW = 3;
export const LINE_DASHES: { id: LineDash | null; label: string }[] = [
  { id: null, label: "Solid" },
  { id: "dash", label: "Dashed" },
  { id: "dot", label: "Dotted" },
];

/** SVG 的虛線（照粗細算） */
export const dashArray = (dash: LineDash | undefined, lw: number) => (dash === "dash" ? `${lw * 3} ${lw * 2}` : dash === "dot" ? `0 ${lw * 2}` : undefined);

/** 換形狀：換成線時沒有填色、一定有框線；從線換回來補上填色 */
export function withShape(b: SlideBox, shape: ShapeKind): SlideBox {
  if (b.kind !== "shape" || b.shape === shape) return b;
  const out: SlideBox = { ...b, shape };
  if (shape === "line") {
    out.fill = null;
    if (!out.line) out.line = "gray";
  } else if (b.shape === "line") out.fill = "blue";
  return out;
}

export const SHAPES: { id: ShapeKind; label: string }[] = [
  { id: "rect", label: "Rectangle" },
  { id: "round", label: "Rounded Rectangle" },
  { id: "ellipse", label: "Oval" },
  { id: "triangle", label: "Triangle" },
  { id: "arrow", label: "Arrow" },
  { id: "diamond", label: "Diamond" },
  { id: "pentagon", label: "Pentagon" },
  { id: "hexagon", label: "Hexagon" },
  { id: "star", label: "Star" },
  { id: "callout", label: "Speech Bubble" },
  { id: "line", label: "Line" },
];

const KINDS: BoxKind[] = ["text", "image", "shape"];
const SHAPE_IDS = SHAPES.map((s) => s.id);

let seq = 0;
/** 新物件的代號（只要在同一張投影片裡不重複） */
export const newBoxId = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`;

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : d);
/** 色盤名稱或自訂的 #rrggbb（自訂的存成小寫） */
const color = (v: unknown): Ink | null | undefined => (v === null ? null : isInk(v) ? (v.startsWith("#") ? (v.toLowerCase() as Ink) : v) : undefined);

/** 存檔讀回來：不認得的物件丟掉，數字補預設 */
export function cleanBoxes(raw: unknown): SlideBox[] {
  if (!Array.isArray(raw)) return [];
  const used = new Set<string>();
  const out: SlideBox[] = [];
  for (const o of raw) {
    if (!o || typeof o !== "object") continue;
    const r = o as Record<string, unknown>;
    if (!KINDS.includes(r.kind as BoxKind)) continue;
    const kind = r.kind as BoxKind;
    if (kind === "image" && typeof r.src !== "string") continue;
    let id = typeof r.id === "string" && r.id ? r.id : newBoxId();
    if (used.has(id)) id = newBoxId();
    used.add(id);
    const b: SlideBox = { id, kind, x: num(r.x, 100), y: num(r.y, 100), w: Math.max(8, num(r.w, 200)), h: Math.max(8, num(r.h, 80)) };
    if (typeof r.text === "string" && (kind === "text" || kind === "shape")) b.text = r.text;
    if (kind === "image") {
      b.src = r.src as string;
      if (typeof r.alt === "string" && r.alt) b.alt = r.alt;
      if (r.fit === "cover") b.fit = "cover";
    }
    if (kind === "shape") b.shape = SHAPE_IDS.includes(r.shape as ShapeKind) ? (r.shape as ShapeKind) : "rect";
    if (typeof r.rot === "number" && Number.isFinite(r.rot)) {
      const rot = ((Math.round(r.rot) % 360) + 360) % 360;
      if (rot) b.rot = rot;
    }
    const fill = color(r.fill);
    const line = color(r.line);
    if (fill !== undefined) b.fill = fill;
    if (line !== undefined) b.line = line;
    if (typeof r.lw === "number" && Number.isFinite(r.lw)) {
      const lw = Math.min(40, Math.max(0.5, Math.round(r.lw * 2) / 2));
      if (lw !== DEFAULT_LW) b.lw = lw;
    }
    if (r.dash === "dash" || r.dash === "dot") b.dash = r.dash;
    if (typeof r.opacity === "number" && Number.isFinite(r.opacity)) {
      const o = Math.min(100, Math.max(10, Math.round(r.opacity)));
      if (o < 100) b.opacity = o;
    }
    if (r.shadow === true) b.shadow = true;
    out.push(b);
  }
  return out;
}

export function cleanFrame(raw: unknown): Frame | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const f = { x: num(r.x, MAIN_FRAME.x), y: num(r.y, MAIN_FRAME.y), w: Math.max(40, num(r.w, MAIN_FRAME.w)), h: Math.max(20, num(r.h, MAIN_FRAME.h)) };
  return sameFrame(f, MAIN_FRAME) ? undefined : f;
}

export const sameFrame = (a: Frame, b: Frame) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/** 新的文字方塊：放在投影片中間偏下，避開同位置已經有的（每多一個往右下錯開 20） */
export function newTextBox(boxes: SlideBox[]): SlideBox {
  const at = freeSpot(boxes, { x: 280, y: 230, w: 400, h: 80 });
  return { id: newBoxId(), kind: "text", ...at, text: "" };
}

export function newShapeBox(boxes: SlideBox[], shape: ShapeKind): SlideBox {
  const size = shape === "arrow" ? { w: 240, h: 100 } : shape === "line" ? { w: 300, h: 20 } : shape === "callout" ? { w: 240, h: 160 } : { w: 200, h: shape === "rect" || shape === "round" ? 140 : 200 };
  const at = freeSpot(boxes, { x: (SLIDE_W - size.w) / 2, y: (SLIDE_H - size.h) / 2, ...size });
  // 線只有框線
  return shape === "line" ? { id: newBoxId(), kind: "shape", ...at, shape, fill: null, line: "gray" } : { id: newBoxId(), kind: "shape", ...at, shape, fill: "blue", line: null };
}

/** 新的圖片：照原圖比例，放得進投影片的一半大小，置中 */
export function newImageBox(boxes: SlideBox[], src: string, natural: { w: number; h: number } | null, alt = ""): SlideBox {
  const nw = natural?.w || 400;
  const nh = natural?.h || 300;
  const k = Math.min(1, (SLIDE_W * 0.6) / nw, (SLIDE_H * 0.6) / nh);
  const w = Math.round(nw * k);
  const h = Math.round(nh * k);
  const at = freeSpot(boxes, { x: Math.round((SLIDE_W - w) / 2), y: Math.round((SLIDE_H - h) / 2), w, h });
  const b: SlideBox = { id: newBoxId(), kind: "image", ...at, src };
  if (alt) b.alt = alt;
  return b;
}

function freeSpot(boxes: SlideBox[], f: Frame): Frame {
  let r = { ...f };
  while (boxes.some((b) => Math.abs(b.x - r.x) < 4 && Math.abs(b.y - r.y) < 4)) r = { ...r, x: r.x + 20, y: r.y + 20 };
  return r;
}

/** 改幾個物件（主文字方塊另外用 frame） */
export function updateBoxes(boxes: SlideBox[], ids: string[], fn: (b: SlideBox) => SlideBox): SlideBox[] {
  const set = new Set(ids);
  return boxes.map((b) => (set.has(b.id) ? fn(b) : b));
}

/** 位移好幾個物件 */
export const moveBoxes = (boxes: SlideBox[], ids: string[], dx: number, dy: number) =>
  updateBoxes(boxes, ids, (b) => ({ ...b, x: Math.round(b.x + dx), y: Math.round(b.y + dy) }));

export const removeBoxes = (boxes: SlideBox[], ids: string[]) => boxes.filter((b) => !ids.includes(b.id));

/** 複製好幾個物件：放在最上層、往右下錯開 20；回傳新的陣列與複本的代號 */
export function duplicateBoxes(boxes: SlideBox[], ids: string[]): { boxes: SlideBox[]; added: string[] } {
  const copies = boxes.filter((b) => ids.includes(b.id)).map((b) => ({ ...b, id: newBoxId(), x: b.x + 20, y: b.y + 20 }));
  return { boxes: [...boxes, ...copies], added: copies.map((c) => c.id) };
}

/** 上下層：front 最上層、back 最下層、forward／backward 一層 */
export function arrange(boxes: SlideBox[], ids: string[], how: "front" | "back" | "forward" | "backward"): SlideBox[] {
  const set = new Set(ids);
  const picked = boxes.filter((b) => set.has(b.id));
  const rest = boxes.filter((b) => !set.has(b.id));
  if (how === "front") return [...rest, ...picked];
  if (how === "back") return [...picked, ...rest];
  const out = [...boxes];
  if (how === "forward") {
    for (let i = out.length - 2; i >= 0; i--) if (set.has(out[i].id) && !set.has(out[i + 1].id)) [out[i], out[i + 1]] = [out[i + 1], out[i]];
  } else {
    for (let i = 1; i < out.length; i++) if (set.has(out[i].id) && !set.has(out[i - 1].id)) [out[i], out[i - 1]] = [out[i - 1], out[i]];
  }
  return out;
}

/** 對齊（單一物件對投影片，好幾個對它們的外框） */
export type AlignTo = "left" | "center" | "right" | "top" | "middle" | "bottom";
export function alignFrames(frames: (Frame & { id: string })[], how: AlignTo): Map<string, Frame> {
  const box =
    frames.length === 1
      ? { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H }
      : (() => {
          const x0 = Math.min(...frames.map((f) => f.x));
          const y0 = Math.min(...frames.map((f) => f.y));
          return { x: x0, y: y0, w: Math.max(...frames.map((f) => f.x + f.w)) - x0, h: Math.max(...frames.map((f) => f.y + f.h)) - y0 };
        })();
  const out = new Map<string, Frame>();
  for (const f of frames) {
    const n = { x: f.x, y: f.y, w: f.w, h: f.h };
    if (how === "left") n.x = box.x;
    if (how === "center") n.x = Math.round(box.x + (box.w - f.w) / 2);
    if (how === "right") n.x = box.x + box.w - f.w;
    if (how === "top") n.y = box.y;
    if (how === "middle") n.y = Math.round(box.y + (box.h - f.h) / 2);
    if (how === "bottom") n.y = box.y + box.h - f.h;
    out.set(f.id, n);
  }
  return out;
}

/** 形狀的路徑（在 w×h 的框裡） */
export function shapePath(shape: ShapeKind, w: number, h: number): string {
  switch (shape) {
    case "ellipse":
      return `M${w / 2} 0A${w / 2} ${h / 2} 0 1 1 ${w / 2} ${h}A${w / 2} ${h / 2} 0 1 1 ${w / 2} 0Z`;
    case "triangle":
      return `M${w / 2} 0L${w} ${h}L0 ${h}Z`;
    case "arrow": {
      const t = h * 0.3;
      const head = Math.min(w * 0.4, h);
      return `M0 ${t}H${w - head}V0L${w} ${h / 2}L${w - head} ${h}V${h - t}H0Z`;
    }
    case "diamond":
      return `M${w / 2} 0L${w} ${h / 2}L${w / 2} ${h}L0 ${h / 2}Z`;
    case "pentagon":
      return `M${w / 2} 0L${w} ${h * 0.38}L${w * 0.81} ${h}H${w * 0.19}L0 ${h * 0.38}Z`;
    case "hexagon":
      return `M${w * 0.25} 0H${w * 0.75}L${w} ${h / 2}L${w * 0.75} ${h}H${w * 0.25}L0 ${h / 2}Z`;
    case "star": {
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 0.4 : 1;
        pts.push(`${(w / 2 + (w / 2) * r * Math.cos(a)).toFixed(1)} ${(h / 2 + (h / 2) * r * Math.sin(a)).toFixed(1)}`);
      }
      return `M${pts.join("L")}Z`;
    }
    case "callout": {
      const b = h * 0.75;
      const r = Math.min(w, b) * 0.12;
      return `M${r} 0H${w - r}Q${w} 0 ${w} ${r}V${b - r}Q${w} ${b} ${w - r} ${b}H${w * 0.4}L${w * 0.22} ${h}L${w * 0.25} ${b}H${r}Q0 ${b} 0 ${b - r}V${r}Q0 0 ${r} 0Z`;
    }
    case "line":
      return `M0 ${h / 2}H${w}`;
    case "round": {
      const r = Math.min(w, h) * 0.15;
      return `M${r} 0H${w - r}Q${w} 0 ${w} ${r}V${h - r}Q${w} ${h} ${w - r} ${h}H${r}Q0 ${h} 0 ${h - r}V${r}Q0 0 ${r} 0Z`;
    }
    default:
      return `M0 0H${w}V${h}H0Z`;
  }
}
