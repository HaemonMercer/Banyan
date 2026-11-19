import { COLORS, type Color } from "../editor/inline";
import { pageKey } from "../pages/pageRef";
import { mapsData, moveMap, parseMaps, type MindMap, type Shape } from "./mindmap";

/**
 * Desk 檔案的白板（參考 Heptabase）：無限畫布上擺卡片、用箭頭連起來、用區段分組，不管順序。
 *
 * 卡片有兩種：便利貼（`note`，內容是 Markdown，存在白板裡）與指向既有文件的卡片——
 * 頁面（`[[名稱]]` 的那種）或某天的日記，在白板上編輯就是編輯那份 Markdown。
 * 白板存在 Desk 檔案的 JSON 裡（`desk/名稱.json` 的 `board`，見 `file.ts`）。
 * 畫面的平移、縮放是個人的瀏覽狀態，存在 localStorage，不寫進檔案（不然捲一下就要存檔）。
 *
 * 這裡都是純函式：輸入舊的白板、回傳新的白板，不改原本的物件。
 */

/**
 * 媒體卡片（貼上或拖進來的圖片、GIF、影片、嵌入影片）：
 * `image`／`video` 的 src 是 `media/檔名`（瀏覽器預覽時是 data URL）或 http 網址；
 * `embed` 的 src 是原本的網址（YouTube、Vimeo），顯示時才換成嵌入網址（`boardMedia.ts` 的 `embedUrl`）。
 */
export type MediaType = "image" | "video" | "embed";
export const MEDIA_TYPES: readonly MediaType[] = ["image", "video", "embed"];

export type CardRef =
  | { kind: "page"; name: string }
  | { kind: "day"; date: string }
  | { kind: "note" }
  | { kind: "media"; src: string; type: MediaType }
  /** 程式碼卡片：內容是卡片的 text，lang 是語言（``` 後面的字，`src/editor/codeHighlight.ts`） */
  | { kind: "code"; lang: string }
  /** 圖表卡片（Draw）：圖表存在卡片的 text（`draw.ts` 的 `serializeDiagram`），白板上顯示圖，連按兩下在白板上編輯 */
  | { kind: "draw" }
  /** 表格卡片：一份小活頁簿存在卡片的 text（`sheet/model.ts` 的 JSON，公式照算），白板上顯示表格，連按兩下用 Excel 編輯（`boardSheet.ts`） */
  | { kind: "sheet" };

/** 內容存在卡片自己的 text 裡（便利貼、程式碼、圖表、表格） */
export const ownsText = (r: CardRef) => r.kind === "note" || r.kind === "code" || r.kind === "draw" || r.kind === "sheet";

/** 大小固定的卡片（媒體、圖表、表格）：高度不跟著內容，可以縮得比一般卡片小 */
export const fixedSize = (r: CardRef) => r.kind === "media" || r.kind === "draw" || r.kind === "sheet";

/** 在白板上方用完整的編輯器編輯的卡片（圖表用 Draw、表格用 Excel） */
export const editsInPlace = (r: CardRef) => r.kind === "draw" || r.kind === "sheet";

/** 指向頁面或日記的卡片（可以打開、刪除那份文件） */
export type DocRef = Extract<CardRef, { kind: "page" | "day" }>;
export const isDocRef = (r: CardRef): r is DocRef => r.kind === "page" || r.kind === "day";

export interface Card {
  id: string;
  ref: CardRef;
  x: number;
  y: number;
  w: number;
  /** null：高度跟著內容（有上限）；數字：使用者拉過的固定高度 */
  h: number | null;
  color: Color | null;
  /** 便利貼的內容（Markdown）；其他卡片是空字串 */
  text: string;
  /** 外觀：填色、形狀、粗體（沒有就是預設：淡色底、圓角） */
  look?: CardLook;
}

/** 卡片的填色：淡色底（預設）、實心、只有外框 */
export type CardFill = "soft" | "solid" | "outline";
export interface CardLook {
  fill?: CardFill;
  shape?: Shape;
  bold?: boolean;
}
export const CARD_FILLS: { id: CardFill; label: string }[] = [
  { id: "soft", label: "Soft" },
  { id: "solid", label: "Solid" },
  { id: "outline", label: "Outline" },
];
const FILL_IDS: string[] = ["solid", "outline"];
const SHAPE_IDS: string[] = ["rect", "pill", "underline", "plain"];

function parseCardLook(v: unknown): CardLook | undefined {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return undefined;
  const l: CardLook = {};
  // 預設值（soft、rounded）不存
  if (FILL_IDS.includes(o.fill as string)) l.fill = o.fill as CardFill;
  if (SHAPE_IDS.includes(o.shape as string)) l.shape = o.shape as Shape;
  if (o.bold === true) l.bold = true;
  return l.fill || l.shape || l.bold ? l : undefined;
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
  /** 外觀：填色、形狀、標題粗體（和卡片同一種，沒有就是預設） */
  look?: CardLook;
}

export interface Board {
  cards: Card[];
  edges: Edge[];
  sections: Section[];
  /** 心智圖（`mindmap.ts`，參考 XMind，自動排版） */
  maps: MindMap[];
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
/** 便利貼的預設寬度與顏色 */
export const NOTE_W = 240;
export const NOTE_COLOR: Color = "yellow";
export const CARD_MIN_W = 200;
export const CARD_MIN_H = 80;
/** 媒體卡片最小的邊 */
export const MEDIA_MIN = 40;
/** 高度跟著內容時，卡片最高多少（再長就在卡片裡捲動） */
export const CARD_AUTO_MAX_H = 440;
export const SECTION_MIN = 160;
export const ZOOM_MIN = 0.15;
export const ZOOM_MAX = 2.5;

export const emptyBoard = (): Board => ({ cards: [], edges: [], sections: [], maps: [] });

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
  if (o.kind === "note") return { kind: "note" };
  if (o.kind === "code") return { kind: "code", lang: typeof o.lang === "string" ? o.lang.trim() : "" };
  if (o.kind === "draw") return { kind: "draw" };
  if (o.kind === "sheet") return { kind: "sheet" };
  if (o.kind === "media" && typeof o.src === "string" && o.src.trim() && MEDIA_TYPES.includes(o.type as MediaType)) {
    return { kind: "media", src: o.src, type: o.type as MediaType };
  }
  if (o.kind === "page" && typeof o.name === "string" && o.name.trim()) return { kind: "page", name: o.name };
  if (o.kind === "day" && typeof o.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.date)) {
    return { kind: "day", date: o.date };
  }
  return null;
}

/** JSON（字串或已解析的物件）→ 白板；格式不對的項目略過（壞掉的檔案也能開，只是少了那些東西）。 */
export function parseBoard(json: unknown): Board {
  let raw: Record<string, unknown>;
  if (typeof json === "string") {
    try {
      raw = JSON.parse(json || "{}");
    } catch {
      return emptyBoard();
    }
  } else raw = json as Record<string, unknown>;
  if (!raw || typeof raw !== "object") return emptyBoard();
  const list = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []).filter((o) => o && typeof o === "object");
  const cards: Card[] = [];
  for (const o of list(raw.cards)) {
    const ref = parseRef(o.ref);
    if (!ref || typeof o.id !== "string") continue;
    // 媒體、圖表卡片可以比較小，高度一律是固定的
    const media = fixedSize(ref);
    const w = Math.max(media ? MEDIA_MIN : CARD_MIN_W, num(o.w, editsInPlace(ref) ? DRAW_W : media ? MEDIA_W : CARD_W));
    const h = media
      ? Math.max(MEDIA_MIN, num(o.h, editsInPlace(ref) ? DRAW_H : Math.round(w * 0.5625)))
      : o.h == null
        ? null
        : Math.max(CARD_MIN_H, num(o.h, CARD_MIN_H));
    cards.push({
      id: o.id,
      ref,
      x: num(o.x, 0),
      y: num(o.y, 0),
      w,
      h,
      color: color(o.color),
      text: ownsText(ref) ? str(o.text) : "",
      ...(parseCardLook(o.look) ? { look: parseCardLook(o.look) } : {}),
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
      ...(parseCardLook(o.look) ? { look: parseCardLook(o.look) } : {}),
    }));
  return { cards, edges, sections, maps: parseMaps(raw.maps) };
}

const round = (n: number) => Math.round(n * 10) / 10;

/** 白板 → 可以寫成 JSON 的物件（固定欄位順序、座標取到小數一位，方便比對與版本控制）。 */
export function boardData(b: Board) {
  return {
    cards: b.cards.map((c) => ({
      id: c.id,
      ref:
        c.ref.kind === "page"
          ? { kind: "page", name: c.ref.name }
          : c.ref.kind === "day"
            ? { kind: "day", date: c.ref.date }
            : c.ref.kind === "media"
              ? { kind: "media", type: c.ref.type, src: c.ref.src }
              : c.ref.kind === "code"
                ? { kind: "code", lang: c.ref.lang }
                : c.ref.kind === "draw"
                  ? { kind: "draw" }
                  : c.ref.kind === "sheet"
                    ? { kind: "sheet" }
                    : { kind: "note" },
      x: round(c.x),
      y: round(c.y),
      w: round(c.w),
      h: c.h === null ? null : round(c.h),
      color: c.color,
      ...(ownsText(c.ref) ? { text: c.text } : {}),
      ...(c.look ? { look: c.look } : {}),
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
      ...(s.look ? { look: s.look } : {}),
    })),
    ...(b.maps.length ? { maps: mapsData(b.maps) } : {}),
  };
}

/** 白板 → JSON 字串。 */
export function serializeBoard(b: Board): string {
  return JSON.stringify(boardData(b), null, 2) + "\n";
}

/* ─── 卡片 ─── */

/** 是不是同一份文件（便利貼、媒體各自獨立，永遠不算相同）。 */
export function sameRef(a: CardRef, b: CardRef): boolean {
  if (a.kind !== b.kind || !isDocRef(a)) return false;
  return a.kind === "page" ? pageKey(a.name) === pageKey((b as { name: string }).name) : (a as { date: string }).date === (b as { date: string }).date;
}

export function refLabel(r: CardRef): string {
  if (r.kind === "media") return r.type === "image" ? "Image" : "Video";
  if (r.kind === "code") return "Code";
  if (r.kind === "draw") return "Diagram";
  if (r.kind === "sheet") return "Table";
  return r.kind === "page" ? r.name : r.kind === "day" ? r.date : "Note";
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
  const card: Card = { id: newId(), ref, x: round(x), y: round(y), w: CARD_W, h: null, color: null, text: "" };
  return { board: { ...b, cards: [...b.cards, card] }, id: card.id, added: true };
}

/** 在 (x, y)（左上角）貼一張便利貼。 */
export function addNote(b: Board, x: number, y: number, text = "", color: Color | null = NOTE_COLOR): { board: Board; id: string } {
  const card: Card = { id: newId(), ref: { kind: "note" }, x: round(x), y: round(y), w: NOTE_W, h: null, color, text };
  return { board: { ...b, cards: [...b.cards, card] }, id: card.id };
}

/** 程式碼卡片的預設寬度 */
export const CODE_W = 440;

/** 在 (x, y)（左上角）放一張程式碼卡片（高度跟著內容）。 */
export function addCode(b: Board, x: number, y: number, code = "", lang = ""): { board: Board; id: string } {
  const card: Card = { id: newId(), ref: { kind: "code", lang }, x: round(x), y: round(y), w: CODE_W, h: null, color: null, text: code };
  return { board: { ...b, cards: [...b.cards, card] }, id: card.id };
}

/** 圖表卡片的預設大小 */
export const DRAW_W = 480;
export const DRAW_H = 320;

/** 在 (x, y)（左上角）放一張圖表卡片；json 是圖表（空字串是空白的圖表）。 */
export function addDraw(b: Board, x: number, y: number, json = "", w = DRAW_W, h = DRAW_H): { board: Board; id: string } {
  const card: Card = { id: newId(), ref: { kind: "draw" }, x: round(x), y: round(y), w: Math.max(MEDIA_MIN, round(w)), h: Math.max(MEDIA_MIN, round(h)), color: null, text: json };
  return { board: { ...b, cards: [...b.cards, card] }, id: card.id };
}

/** 在 (x, y)（左上角）放一張表格卡片；json 是活頁簿，大小由呼叫的人照表格算好（`boardSheet.ts` 的 `sheetCardSize`）。 */
export function addTableCard(b: Board, x: number, y: number, json: string, w = DRAW_W, h = 200): { board: Board; id: string } {
  const card: Card = { id: newId(), ref: { kind: "sheet" }, x: round(x), y: round(y), w: Math.max(MEDIA_MIN, round(w)), h: Math.max(MEDIA_MIN, round(h)), color: null, text: json };
  return { board: { ...b, cards: [...b.cards, card] }, id: card.id };
}

/** 媒體卡片的預設寬度（還不知道原始大小時） */
export const MEDIA_W = 480;

/** 在 (x, y)（左上角）放一張媒體卡片（大小由呼叫的人照原始比例算好，見 `boardMedia.ts` 的 `fitMediaSize`）。 */
export function addMedia(
  b: Board,
  src: string,
  type: MediaType,
  x: number,
  y: number,
  w = MEDIA_W,
  h = Math.round(MEDIA_W * 0.5625),
): { board: Board; id: string } {
  const card: Card = {
    id: newId(),
    ref: { kind: "media", src, type },
    x: round(x),
    y: round(y),
    w: Math.max(MEDIA_MIN, round(w)),
    h: Math.max(MEDIA_MIN, round(h)),
    color: null,
    text: "",
  };
  return { board: { ...b, cards: [...b.cards, card] }, id: card.id };
}

/* ─── 複製、貼上 ─── */

/** 系統剪貼簿裡的白板內容（純文字 JSON，開頭有這個標記） */
const CLIP_TAG = "banyan-board";

/**
 * 複製選取的東西：卡片、區段、心智圖，以及兩端都在選取裡的連線（選了區段就包含區段裡的東西）。
 * 回傳一份只有這些東西的白板。
 */
export function copyItems(b: Board, ids: Iterable<string>, heights: Record<string, number> = {}): Board {
  const set = new Set(ids);
  for (const s of b.sections) if (set.has(s.id)) for (const m of sectionMembers(b, s.id, heights)) set.add(m);
  const cards = b.cards.filter((c) => set.has(c.id));
  const kept = new Set(cards.map((c) => c.id));
  return {
    cards,
    edges: b.edges.filter((e) => kept.has(e.from) && kept.has(e.to)),
    sections: b.sections.filter((s) => set.has(s.id)),
    maps: b.maps.filter((m) => set.has(m.id)),
  };
}

/** 複製的內容 → 剪貼簿文字 */
export function clipText(clip: Board): string {
  return JSON.stringify({ [CLIP_TAG]: 1, ...boardData(clip) });
}

/** 剪貼簿文字 → 複製的內容；不是白板內容就是 null。 */
export function parseClip(text: string): Board | null {
  if (!text.includes(CLIP_TAG)) return null;
  try {
    const o = JSON.parse(text);
    if (!o || typeof o !== "object" || o[CLIP_TAG] !== 1) return null;
    const b = parseBoard(o);
    return b.cards.length || b.sections.length || b.maps.length ? b : null;
  } catch {
    return null;
  }
}

/**
 * 貼上複製的內容，整體移動 (dx, dy)，全部換新的 id。
 * 頁面、日記卡片在白板上只有一張：白板上已經有的不再加，連線改接到原本那張。
 */
export function pasteItems(b: Board, clip: Board, dx: number, dy: number): { board: Board; ids: string[] } {
  const idMap = new Map<string, string>();
  const ids: string[] = [];
  const cards: Card[] = [];
  for (const c of clip.cards) {
    const had = isDocRef(c.ref) ? findCard(b, c.ref) ?? cards.find((x) => sameRef(x.ref, c.ref)) : undefined;
    if (had) {
      idMap.set(c.id, had.id);
      continue;
    }
    const id = newId();
    idMap.set(c.id, id);
    ids.push(id);
    cards.push({ ...c, id, x: round(c.x + dx), y: round(c.y + dy) });
  }
  const edges: Edge[] = [];
  for (const e of clip.edges) {
    const from = idMap.get(e.from);
    const to = idMap.get(e.to);
    if (!from || !to || from === to) continue;
    if ([...b.edges, ...edges].some((x) => x.from === from && x.to === to)) continue;
    const id = newId();
    ids.push(id);
    edges.push({ id, from, to, label: e.label });
  }
  const sections = clip.sections.map((s) => {
    const id = newId();
    ids.push(id);
    return { ...s, id, x: round(s.x + dx), y: round(s.y + dy) };
  });
  const maps = clip.maps.map((m) => {
    const id = newId();
    ids.push(id);
    return { ...m, id, x: m.x + dx, y: m.y + dy };
  });
  return {
    board: {
      cards: [...b.cards, ...cards],
      edges: [...b.edges, ...edges],
      // 區段放在最前面（畫在最底下），和 addSection 一樣
      sections: [...sections, ...b.sections],
      maps: [...b.maps, ...maps],
    },
    ids,
  };
}

/**
 * 閱讀順序：由上到下、同一列（上緣差不到半張卡片高）由左到右。
 * 「送到 Dock」照這個順序把卡片接起來。
 */
export function readingOrder(cards: Card[], heights: Record<string, number> = {}): Card[] {
  const rest = [...cards].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Card[] = [];
  while (rest.length) {
    const top = rest[0];
    const band = cardRect(top, heights).h / 2;
    const row = rest.filter((c) => c.y - top.y <= band).sort((a, b) => a.x - b.x);
    for (const c of row) rest.splice(rest.indexOf(c), 1);
    out.push(...row);
  }
  return out;
}

/**
 * 改卡片與區段的外觀（可以一次改好幾個）：值是 undefined 或 false 的欄位拿掉（回到預設），patch 是 null 就全部拿掉。
 * `color` 是原本的顏色欄位，也可以在這裡一起改。
 */
export function setCardLook(
  b: Board,
  ids: Iterable<string>,
  patch: (Partial<Record<keyof CardLook, unknown>> & { color?: Color | null }) | null,
): Board {
  const set = new Set(ids);
  let changed = false;
  const restyle = <T extends { id: string; color: Color | null; look?: CardLook }>(c: T): T => {
    if (!set.has(c.id)) return c;
    const merged: Record<string, unknown> = patch ? { ...c.look } : {};
    let col = c.color;
    for (const [k, v] of Object.entries(patch ?? {})) {
      if (k === "color") col = (v as Color | null) ?? null;
      else if (v === undefined || v === false) delete merged[k];
      else merged[k] = v;
    }
    const look = parseCardLook(merged);
    if (JSON.stringify(look) === JSON.stringify(c.look) && col === c.color) return c;
    changed = true;
    const next: T = { ...c, color: col };
    if (look) next.look = look;
    else delete next.look;
    return next;
  };
  const cards = b.cards.map(restyle);
  const sections = b.sections.map(restyle);
  return changed ? { ...b, cards, sections } : b;
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
  let maps = b.maps;
  for (const m of b.maps) if (set.has(m.id)) maps = moveMap(maps, m.id, dx, dy);
  return {
    ...b,
    cards: b.cards.map((c) => (set.has(c.id) ? { ...c, x: c.x + dx, y: c.y + dy } : c)),
    sections: b.sections.map((s) => (set.has(s.id) ? { ...s, x: s.x + dx, y: s.y + dy } : s)),
    maps,
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
    maps: b.maps.filter((m) => !set.has(m.id)),
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
 * 區段裡的東西：中心點落在區段範圍內的卡片、整個在範圍內的其他區段（不含自己）與心智圖。
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
  // 心智圖看中心主題的左上角
  for (const m of b.maps) if (inside(s, m.x, m.y)) out.push(m.id);
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
