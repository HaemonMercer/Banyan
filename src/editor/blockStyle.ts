import { BLOCK_TYPES } from "./blockTypes";
import type { BlockType } from "./ops";

/**
 * 區塊樣式：每個區塊可以單獨調整外距、內距、字型、字級、行距、框線（參考 Pages 的段落設定與 CSS 的盒子）。
 *
 * 存法跟背景色、對齊一樣：包一層單行的 HTML 區塊標籤，裡面的 Markdown 一字不動：
 *
 *   <div class="box" style="margin: 12pt 0pt 12pt 0pt; padding: 6pt 9pt 6pt 9pt; font-family: Georgia, serif">
 *
 * style 只認得這裡列出的屬性與值（`parseBlockStyle` 丟掉其他的），寫回去一律用 `formatBlockStyle`，
 * 所以同樣的樣式永遠是同一串文字（編輯器狀態用字串比對）。長度一律是 pt（跟 Word 的字級一樣）。
 */

/** 上、右、下、左（pt） */
export type Sides = [number, number, number, number];

export interface BlockStyle {
  margin?: Sides;
  padding?: Sides;
  /** 字型：`BLOCK_FONTS` 的 css */
  font?: string;
  /** 字級（pt） */
  size?: number;
  /** 行距（倍數，1 是單行間距；跟 Word 一樣，畫面上是字高的 1.2 倍） */
  line?: number;
  /** 框線粗細（pt） */
  border?: number;
  /** 框線顏色：`BORDER_COLORS` 的 id */
  borderColor?: string;
  /** 圓角（pt） */
  radius?: number;
}

/** 字型選項（css 裡的引號用單引號：整串放在 style="…" 裡） */
export const BLOCK_FONTS: { label: string; css: string }[] = [
  { label: "Sans serif", css: "Calibri, Carlito, 'Segoe UI', sans-serif" },
  { label: "Serif", css: "Cambria, Georgia, 'Times New Roman', serif" },
  { label: "Monospace", css: "Consolas, 'Cascadia Mono', monospace" },
  { label: "Arial", css: "Arial, sans-serif" },
  { label: "Georgia", css: "Georgia, serif" },
  { label: "Times New Roman", css: "'Times New Roman', serif" },
  { label: "Segoe UI", css: "'Segoe UI', sans-serif" },
  { label: "Microsoft JhengHei", css: "'Microsoft JhengHei', sans-serif" },
  { label: "PMingLiU", css: "PMingLiU, serif" },
  { label: "DFKai-SB", css: "DFKai-SB, serif" },
];

/** 框線顏色（畫面上換成 CSS 變數，深色模式也看得清楚） */
export const BORDER_COLORS = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;

const borderVar = (c: string) => (c === "default" ? "var(--ed-faint)" : `var(--tc-${c})`);

const LIMIT = { space: 200, size: 200, border: 12, radius: 48 };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/** 小數最多兩位，去掉多餘的 0 */
const fmt = (n: number) => String(+n.toFixed(2));

function sides(v: string, max: number): Sides | undefined {
  const xs = v.trim().split(/\s+/).map((p) => /^(-?\d+(?:\.\d+)?)pt$/.exec(p));
  if (!xs.length || xs.length > 4 || xs.some((m) => !m)) return undefined;
  const n = xs.map((m) => clamp(Number(m![1]), 0, max));
  // CSS 的縮寫：1 個值四邊一樣；2 個是上下、左右；3 個是上、左右、下
  const [t, r = t, b = t, l = r] = n;
  return [t, r, b, l];
}

const zero = (s?: Sides) => !s || s.every((x) => x === 0);

/** style 屬性 → 樣式（不認得的屬性、值丟掉） */
export function parseBlockStyle(css: string): BlockStyle {
  const out: BlockStyle = {};
  for (const part of css.split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const key = part.slice(0, i).trim().toLowerCase();
    const val = part.slice(i + 1).trim();
    if (key === "margin") out.margin = sides(val, LIMIT.space);
    else if (key === "padding") out.padding = sides(val, LIMIT.space);
    else if (key === "font-family") {
      const f = BLOCK_FONTS.find((x) => x.css === val);
      if (f) out.font = f.css;
    } else if (key === "font-size") {
      const m = /^(\d+(?:\.\d+)?)pt$/.exec(val);
      if (m) out.size = clamp(Number(m[1]), 4, LIMIT.size);
    } else if (key === "line-height") {
      const n = Number(val);
      if (val && Number.isFinite(n)) out.line = clamp(+(n / 1.2).toFixed(2), 0.5, 5);
    } else if (key === "border") {
      const m = /^(\d+(?:\.\d+)?)pt solid var\(--(?:tc-([a-z]+)|ed-faint)\)$/.exec(val);
      if (m && (!m[2] || (BORDER_COLORS as readonly string[]).includes(m[2]))) {
        out.border = clamp(Number(m[1]), 0, LIMIT.border);
        out.borderColor = m[2] ?? "default";
      }
    } else if (key === "border-radius") {
      const m = /^(\d+(?:\.\d+)?)pt$/.exec(val);
      if (m) out.radius = clamp(Number(m[1]), 0, LIMIT.radius);
    }
  }
  return clean(out);
}

/** 拿掉等於預設值的欄位（全部都是預設就是空物件） */
export function clean(s: BlockStyle): BlockStyle {
  const out: BlockStyle = {};
  if (!zero(s.margin)) out.margin = s.margin;
  if (!zero(s.padding)) out.padding = s.padding;
  if (s.font) out.font = s.font;
  if (s.size) out.size = s.size;
  if (s.line) out.line = s.line;
  if (s.border) {
    out.border = s.border;
    out.borderColor = s.borderColor ?? "default";
  }
  if (s.radius) out.radius = s.radius;
  return out;
}

export const isEmptyStyle = (s: BlockStyle) => Object.keys(clean(s)).length === 0;

/** 樣式 → style 屬性（固定的順序與寫法；空的樣式是空字串） */
export function formatBlockStyle(s: BlockStyle): string {
  const c = clean(s);
  const out: string[] = [];
  const four = (x: Sides) => x.map((n) => `${fmt(n)}pt`).join(" ");
  if (c.margin) out.push(`margin: ${four(c.margin)}`);
  if (c.padding) out.push(`padding: ${four(c.padding)}`);
  if (c.font) out.push(`font-family: ${c.font}`);
  if (c.size) out.push(`font-size: ${fmt(c.size)}pt`);
  if (c.line) out.push(`line-height: ${fmt(c.line * 1.2)}`);
  if (c.border) out.push(`border: ${fmt(c.border)}pt solid ${borderVar(c.borderColor ?? "default")}`);
  if (c.radius) out.push(`border-radius: ${fmt(c.radius)}pt`);
  return out.join("; ");
}

/** 改幾個欄位（undefined 是拿掉那一項）；回傳新的 style 文字 */
export function patchBlockStyle(css: string, patch: Partial<BlockStyle>): string {
  return formatBlockStyle({ ...parseBlockStyle(css), ...patch });
}

/** 畫面上用的 React style；`--box-inset` 是左內距＋框線，CSS 用它把區塊把手移到框外 */
export function blockStyleCss(css: string): Record<string, string> {
  const s = parseBlockStyle(css);
  const out: Record<string, string> = {};
  const inset = (s.padding?.[3] ?? 0) + (s.border ?? 0);
  if (inset) out["--box-inset"] = `${fmt(inset)}pt`;
  for (const part of formatBlockStyle(s).split("; ")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const key = part.slice(0, i).replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
    out[key] = part.slice(i + 1).trim();
  }
  return out;
}

// ─── 已存的樣式（參考 Pages 的段落樣式選單） ─────────────────────
//
// 每份 Word、簡報文件自己一份（`DockDoc.styles`）。套用時把樣式的 css 寫進區塊，並記住名稱
// （`<div class="box" data-style="名稱" style="…">`）：沒有樣式清單也照樣顯示；
// 區塊的 css 跟樣式不一樣就是「改過」（檢閱器出現 Update／Revert），Update 改整份文件用到它的區塊。

export interface SavedStyle {
  name: string;
  /** `formatBlockStyle` 寫出的 style 文字 */
  css: string;
  /** 段落類型（標題、內文、引言…）：套用時一起換；沒有就不換 */
  type?: BlockType;
}

const TYPES = new Set<string>(BLOCK_TYPES.map((t) => t.type));

/** 樣式名稱：去掉標籤裡不能有的字元、前後空白，最多 40 字 */
export const cleanStyleName = (name: string) => name.replace(/["<>&]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);

/** 不跟別的樣式撞名（不分大小寫）：「Callout」已經有了就「Callout 2」… */
export function freeStyleName(styles: SavedStyle[], base: string, except?: string): string {
  const name = cleanStyleName(base) || "Style";
  const used = new Set(styles.filter((s) => s.name !== except).map((s) => s.name.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) if (!used.has(`${name} ${i}`.toLowerCase())) return `${name} ${i}`;
}

/** 讀檔：丟掉壞掉的、重複的，css 重新整理過 */
export function cleanStyles(raw: unknown): SavedStyle[] {
  const out: SavedStyle[] = [];
  for (const o of Array.isArray(raw) ? raw : []) {
    if (!o || typeof o !== "object") continue;
    const name = cleanStyleName(typeof o.name === "string" ? o.name : "");
    if (!name || out.some((s) => s.name.toLowerCase() === name.toLowerCase())) continue;
    const css = formatBlockStyle(parseBlockStyle(typeof o.css === "string" ? o.css : ""));
    out.push(typeof o.type === "string" && TYPES.has(o.type) ? { name, css, type: o.type as BlockType } : { name, css });
  }
  return out;
}

/** 區塊跟它套用的樣式一不一樣（樣式不在清單裡不算改過） */
export function styleModified(styles: SavedStyle[], name: string, css: string): boolean {
  const s = styles.find((x) => x.name === name);
  return !!s && formatBlockStyle(parseBlockStyle(s.css)) !== formatBlockStyle(parseBlockStyle(css));
}
