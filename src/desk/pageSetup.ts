/**
 * Word 文件的版面設定（功能區的 Design、Layout）：整份文件的字型、字級、行距、邊界。
 *
 * Markdown 沒有字型、字級，所以跟 Word 的「文件格式」一樣是整份文件一個設定，
 * 存在 `DockDoc.page`（沒改過就不寫），畫面與匯出 .docx 都照它。這裡都是純函式。
 */

export type FontKind = "sans" | "serif" | "mono";
export type MarginKind = "normal" | "narrow" | "moderate" | "wide";
export type PaperKind = "a4" | "letter" | "legal" | "a5";
export type PaperColorId = "white" | "cream" | "sepia" | "gray" | "mint" | "sky" | "rose" | "lavender";
/** 頁面顏色：內建的淺色或自訂的 `#rrggbb` */
export type PaperColor = PaperColorId | `#${string}`;

export interface PageSetup {
  font: FontKind;
  /** 內文字級（pt） */
  size: number;
  /** 行距（倍數，跟 Word 一樣 1.0 是單行間距） */
  spacing: number;
  margin: MarginKind;
  /** 紙張大小與方向（沒有是 A4 直向） */
  paper?: PaperKind;
  landscape?: boolean;
  /** 每頁上方、下方的文字（頁首、頁尾） */
  header?: string;
  footer?: string;
  /** 頁碼（沒有是顯示；false 才藏起來） */
  numbers?: boolean;
  /** 頁面背景顏色（Word 的 Design → Page Color；沒有是白色） */
  color?: PaperColor;
}

export const DEFAULT_PAGE: PageSetup = { font: "sans", size: 11, spacing: 1.15, margin: "normal" };

/** 紙張（96 dpi 的 px） */
export const PAPERS: { id: PaperKind; label: string; hint: string; w: number; h: number }[] = [
  { id: "a4", label: "A4", hint: "21 × 29.7 cm", w: 794, h: 1123 },
  { id: "letter", label: "US Letter", hint: '8.5 × 11"', w: 816, h: 1056 },
  { id: "legal", label: "US Legal", hint: '8.5 × 14"', w: 816, h: 1344 },
  { id: "a5", label: "A5", hint: "14.8 × 21 cm", w: 559, h: 794 },
];

/** 這份文件一頁的寬高（橫向就對調） */
export function paperOf(p: PageSetup): { w: number; h: number; label: string } {
  const k = PAPERS.find((x) => x.id === p.paper) ?? PAPERS[0];
  return p.landscape ? { w: k.h, h: k.w, label: `${k.label} · Landscape` } : { w: k.w, h: k.h, label: `${k.label} · Portrait` };
}

/**
 * 頁面顏色：內建的都是淺色，字一律維持深色（紙張不跟著深色主題），匯出 .docx 也是這個顏色。
 * 也可以自訂（`#rrggbb`）；自訂的深色頁面字會換成淺色（`paperIsDark`）。Word 文件與 Dock 的筆記共用。
 */
export const PAPER_COLORS: { id: PaperColorId; label: string; css: string }[] = [
  { id: "white", label: "White", css: "#ffffff" },
  { id: "cream", label: "Cream", css: "#fbf7ec" },
  { id: "sepia", label: "Sepia", css: "#f3e9d6" },
  { id: "gray", label: "Gray", css: "#eeeeec" },
  { id: "mint", label: "Mint", css: "#e8f4ec" },
  { id: "sky", label: "Sky", css: "#e7f0f9" },
  { id: "rose", label: "Rose", css: "#f9eaec" },
  { id: "lavender", label: "Lavender", css: "#efebf7" },
];
const PAPER_HEX = /^#[0-9a-f]{6}$/i;
const isPaperColor = (v: unknown): v is PaperColor => PAPER_COLORS.some((c) => c.id === v) || (typeof v === "string" && PAPER_HEX.test(v));
/** 存檔讀回來的頁面顏色（白色、#ffffff 都是沒有設定） */
const cleanPaperColor = (v: unknown): PaperColor | undefined => {
  if (!isPaperColor(v)) return undefined;
  const c = (v.startsWith("#") ? v.toLowerCase() : v) as PaperColor;
  return c === "white" || c === "#ffffff" ? undefined : c;
};
/** 頁面顏色的 CSS 值（沒有設定是白色） */
export const paperColorOf = (c: PaperColor | undefined) =>
  c && PAPER_HEX.test(c) ? c.toLowerCase() : (PAPER_COLORS.find((x) => x.id === c) ?? PAPER_COLORS[0]).css;
/** 頁面顏色夠暗時字要換成淺色（相對亮度） */
export function paperIsDark(c: PaperColor | undefined): boolean {
  const n = parseInt(paperColorOf(c).slice(1), 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum < 140;
}

export const FONTS: { id: FontKind; label: string; css: string; docx: string }[] = [
  { id: "sans", label: "Sans serif", css: 'Calibri, Carlito, "Segoe UI", system-ui, sans-serif', docx: "Calibri" },
  { id: "serif", label: "Serif", css: 'Cambria, Georgia, "Times New Roman", serif', docx: "Cambria" },
  { id: "mono", label: "Monospace", css: 'Consolas, "Cascadia Mono", ui-monospace, monospace', docx: "Consolas" },
];
export const SIZES = [9, 10, 10.5, 11, 12, 14, 16, 18];
export const SPACINGS = [1, 1.15, 1.5, 2];

/** 邊界（px，96 dpi：1 吋 = 96 px）：上下、左右 */
export const MARGINS: { id: MarginKind; label: string; hint: string; tb: number; lr: number }[] = [
  { id: "normal", label: "Normal", hint: 'Top 1"  Sides 1"', tb: 96, lr: 96 },
  { id: "narrow", label: "Narrow", hint: 'Top 0.5"  Sides 0.5"', tb: 48, lr: 48 },
  { id: "moderate", label: "Moderate", hint: 'Top 1"  Sides 0.75"', tb: 96, lr: 72 },
  { id: "wide", label: "Wide", hint: 'Top 1"  Sides 2"', tb: 96, lr: 192 },
];

/** 存檔讀回來：不認得的值用預設 */
export function cleanPage(raw: unknown): PageSetup {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const num = (v: unknown, ok: number[], d: number) => (typeof v === "number" && ok.includes(v) ? v : d);
  return {
    font: FONTS.some((f) => f.id === r.font) ? (r.font as FontKind) : DEFAULT_PAGE.font,
    size: num(r.size, SIZES, DEFAULT_PAGE.size),
    spacing: num(r.spacing, SPACINGS, DEFAULT_PAGE.spacing),
    margin: MARGINS.some((m) => m.id === r.margin) ? (r.margin as MarginKind) : DEFAULT_PAGE.margin,
    ...(PAPERS.some((x) => x.id === r.paper) && r.paper !== "a4" ? { paper: r.paper as PaperKind } : {}),
    ...(r.landscape === true ? { landscape: true } : {}),
    ...(typeof r.header === "string" && r.header.trim() ? { header: r.header.slice(0, 300) } : {}),
    ...(typeof r.footer === "string" && r.footer.trim() ? { footer: r.footer.slice(0, 300) } : {}),
    ...(r.numbers === false ? { numbers: false } : {}),
    ...(cleanPaperColor(r.color) ? { color: cleanPaperColor(r.color) } : {}),
  };
}

export const isDefaultPage = (p: PageSetup) =>
  p.font === DEFAULT_PAGE.font &&
  p.size === DEFAULT_PAGE.size &&
  p.spacing === DEFAULT_PAGE.spacing &&
  p.margin === DEFAULT_PAGE.margin &&
  (p.paper ?? "a4") === "a4" &&
  !p.landscape &&
  !p.header?.trim() &&
  !p.footer?.trim() &&
  p.numbers !== false &&
  !cleanPaperColor(p.color);

export const marginOf = (p: PageSetup) => MARGINS.find((m) => m.id === p.margin) ?? MARGINS[0];
export const fontOf = (p: PageSetup) => FONTS.find((f) => f.id === p.font) ?? FONTS[0];

/** 畫面上的樣式：字級 pt → px（×4/3），行距 1.0 ≈ 字高的 1.2 倍 */
export function pageStyle(p: PageSetup): { fontFamily: string; fontSize: string; lineHeight: number } {
  return { fontFamily: fontOf(p).css, fontSize: `${Math.round(((p.size * 4) / 3) * 100) / 100}px`, lineHeight: Math.round(p.spacing * 1.2 * 100) / 100 };
}

/** 匯出 .docx：字型名稱、字級（半點）、行距（240 是單行）、邊界（twip，1 px = 15 twip） */
export function docxPage(p: PageSetup) {
  const m = marginOf(p);
  const k = PAPERS.find((x) => x.id === p.paper) ?? PAPERS[0];
  return {
    font: fontOf(p).docx,
    size: Math.round(p.size * 2),
    line: Math.round(p.spacing * 240),
    margin: { top: m.tb * 15, bottom: m.tb * 15, left: m.lr * 15, right: m.lr * 15 },
    // 紙張一律寫直向的寬高，橫向由 orientation 決定（docx 會對調）
    paper: { width: k.w * 15, height: k.h * 15, landscape: !!p.landscape },
    header: p.header?.trim() ?? "",
    footer: p.footer?.trim() ?? "",
    numbers: p.numbers !== false,
    /** 頁面顏色（十六進位，不含 #；白色不寫） */
    background: cleanPaperColor(p.color) ? paperColorOf(p.color).slice(1) : "",
  };
}

/**
 * Dock 筆記（`note`）的外觀：文字大小與頁面顏色，存在 `DockDoc.look`（沒改過就不寫）。
 * 筆記沒有紙張與版面設定，只有這兩個。字級是 px（編輯器預設 16px）。
 */
export interface NoteLook {
  size?: number;
  color?: PaperColor;
}
export const NOTE_SIZES = [12, 13, 14, 15, 16, 18, 20, 22, 24, 28];
export const NOTE_SIZE = 16;

export function cleanLook(raw: unknown): NoteLook {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    ...(typeof r.size === "number" && NOTE_SIZES.includes(r.size) && r.size !== NOTE_SIZE ? { size: r.size } : {}),
    ...(cleanPaperColor(r.color) ? { color: cleanPaperColor(r.color) } : {}),
  };
}
export const isDefaultLook = (l: NoteLook | undefined) => !l || ((l.size ?? NOTE_SIZE) === NOTE_SIZE && !cleanPaperColor(l.color));

/** 文字大小往上或往下一級（A+／A−） */
export function stepNoteSize(size: number | undefined, dir: 1 | -1): number {
  const cur = size ?? NOTE_SIZE;
  const i = NOTE_SIZES.indexOf(cur);
  const at = i < 0 ? NOTE_SIZES.indexOf(NOTE_SIZE) : i;
  return NOTE_SIZES[Math.max(0, Math.min(NOTE_SIZES.length - 1, at + dir))];
}

/**
 * 字數（狀態列）：跟 Word 一樣，中日韓文字一個字算一個，其他文字以空白分開的詞來算；
 * 不算 Markdown 標記、HTML 標籤、圖片與連結網址。
 */
export function countWords(md: string): number {
  const text = md
    .replace(/<[^>]*>/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^ {0,3}(#{1,6}|>|[-*+]|\d+[.)])(?=\s)/gm, " ")
    .replace(/[{[][ xX<\-o]?[}\]]/g, " ")
    .replace(/[*_~`|#=-]+/g, " ")
    .replace(/&nbsp;/g, " ");
  const cjk = text.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/g)?.length ?? 0;
  const rest = text.replace(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af\u3000-\u303f\uff00-\uffef]/g, " ");
  const words = rest.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return cjk + words;
}

/** 字數統計（像 Word、Google 文件的 Word count 對話框）：字數、字元（含／不含空白）、段落 */
export function docStats(md: string): { words: number; chars: number; charsNoSpace: number; paragraphs: number } {
  const plain = md
    .replace(/^```.*$/gm, "")
    .replace(/<[^>]*>/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^ {0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/^\s*[{[][ xX<\-o]?[}\]]\s*/gm, "")
    .replace(/(\*\*|__|\*|_|~~|`)/g, "")
    .replace(/\\([\\`*_{}[\]()#+\-.!<>])/g, "$1")
    .replace(/&nbsp;/g, "")
    .replace(/^\s*(\*\*\*|---|___)\s*$/gm, "");
  const paras = plain.split(/\n\s*\n|\n(?=\s*\S)/).filter((p) => p.trim()).length;
  const text = plain.replace(/\n+/g, " ").trim();
  return { words: countWords(md), chars: [...text].length, charsNoSpace: [...text.replace(/\s/g, "")].length, paragraphs: paras };
}

/** 文件裡的標題（大綱、目錄）：程式碼區塊裡的不算 */
export function headingsOf(md: string): { level: number; text: string }[] {
  const out: { level: number; text: string }[] = [];
  let fence = false;
  for (const line of md.split("\n")) {
    if (/^ {0,3}(```|~~~)/.test(line)) fence = !fence;
    if (fence) continue;
    const m = /^ {0,3}(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2].replace(/<[^>]*>/g, "").replace(/(\*\*|__|\*|_|~~|`)/g, "").replace(/\\(.)/g, "$1").trim() });
  }
  return out;
}

/** 目錄（Insert → Table of Contents）：標題寫成巢狀清單 */
export function tocMarkdown(md: string): string {
  const hs = headingsOf(md).filter((h) => h.level <= 3);
  if (!hs.length) return "";
  const top = Math.min(...hs.map((h) => h.level));
  return ["**Contents**", "", ...hs.map((h) => `${"  ".repeat(h.level - top)}- ${h.text.replace(/([*_`[\]<>\\])/g, "\\$1")}`)].join("\n");
}
