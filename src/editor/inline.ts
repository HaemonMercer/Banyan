import type { Token } from "markdown-it";
import { md } from "./markdown";

/**
 * 行內格式：判斷游標所在的文字有哪些格式，以及切換這些格式。
 *
 * CommonMark 只有粗體、斜體、程式碼、連結；刪除線、底線、文字顏色、螢光標記用
 * CommonMark 允許的行內 HTML 寫（標籤之間的文字仍照常當 Markdown 解析）：
 *   <s>刪除線</s>　<u>底線</u>　<span class="red">紅字</span>　<mark class="yellow">螢光</mark>
 *
 * 判斷方式：在游標（選取的頭尾）插入兩個不會出現在文件裡的字元，交給 markdown-it
 * 解析，看它們落在哪些格式裡——結果與 CommonMark 渲染出來的完全一致。
 */

export type Mark = "bold" | "italic" | "strike" | "underline" | "sup" | "sub" | "code" | "link";

/** 文字顏色與螢光標記的顏色（與 Notion 相同的十種，「預設」是沒有顏色） */
export const COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;
export type Color = (typeof COLORS)[number];

/** 色盤名稱或自訂的 `#rrggbb`（文字顏色、螢光、區塊背景、框線…都可以自己選顏色） */
export type Ink = Color | `#${string}`;
const HEX = /^#[0-9a-f]{6}$/i;
export const isInk = (v: unknown): v is Ink => typeof v === "string" && (HEX.test(v) || (COLORS as readonly string[]).includes(v));
export const isCustomInk = (v: unknown): v is `#${string}` => typeof v === "string" && HEX.test(v);
/** 顏色的 CSS 值：色盤名稱換成主題變數（tc 文字、hl 螢光、bg 背景），自訂的就是色碼 */
export const inkCss = (kind: "tc" | "hl" | "bg", c: Ink) => (isCustomInk(c) ? c : `var(--${kind === "tc" ? "tc" : "bg"}-${c})`); // 螢光的色盤跟區塊背景同一組（--bg-*）
/** 色盤的名稱（自訂顏色顯示色碼） */
export const inkLabel = (c: Ink) => (isCustomInk(c) ? c : COLOR_LABELS[c]);
/** 行內 HTML 的開始標籤：色盤是 class，自訂的寫 style */
export const inkTag = (name: "span" | "mark", c: Ink) =>
  isCustomInk(c) ? `<${name} style="${name === "span" ? "color" : "background-color"}: ${c.toLowerCase()}">` : `<${name} class="${c}">`;
/** 標籤屬性（或元素的 style 屬性文字）裡的自訂顏色 */
export function styleInk(style: string | null | undefined, name: "span" | "mark"): Ink | null {
  if (!style) return null;
  const m = (name === "span" ? /(?:^|;)\s*color:\s*(#[0-9a-f]{6})\s*(?:;|$)/i : /(?:^|;)\s*background(?:-color)?:\s*(#[0-9a-f]{6})\s*(?:;|$)/i).exec(style);
  return m ? (m[1].toLowerCase() as Ink) : null;
}

export const COLOR_LABELS: Record<Color, string> = {
  gray: "Gray",
  brown: "Brown",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
  red: "Red",
};

export interface Marks {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  underline: boolean;
  /** 上標 <sup> */
  sup: boolean;
  /** 下標 <sub> */
  sub: boolean;
  code: boolean;
  link: boolean;
  /** 文字顏色 */
  color: Ink | null;
  /** 螢光標記顏色 */
  highlight: Ink | null;
  /** 字元樣式（已存的樣式名稱，`<span data-cs>`；只有所見即所得編輯看得到） */
  charStyle: string | null;
}

const NONE: Marks = {
  bold: false,
  italic: false,
  strike: false,
  underline: false,
  sup: false,
  sub: false,
  code: false,
  link: false,
  color: null,
  highlight: null,
  charStyle: null,
};
const A = "\uE000";
const B = "\uE001";

const isColor = (c: string | undefined): c is Color => !!c && (COLORS as readonly string[]).includes(c);

type Entry = { mark: Exclude<Mark, "code"> | "color" | "highlight"; tag?: string; value?: Ink | null };

const HTML_TAG = /^<(\/?)([a-z]+)\b([^>]*)>$/i;
const CLASS = /\bclass="([^"]*)"/;

/** 行內 HTML 標籤對應的格式。 */
function htmlEntry(name: string, attrs: string): Entry | null {
  const cls: Ink | undefined =
    (CLASS.exec(attrs)?.[1].split(/\s+/).find(isColor) as Color | undefined) ??
    (name === "span" || name === "mark" ? (styleInk(/\bstyle="([^"]*)"/.exec(attrs)?.[1], name) ?? undefined) : undefined);
  switch (name) {
    case "s":
    case "del":
    case "strike":
      return { mark: "strike", tag: name };
    case "u":
      return { mark: "underline", tag: name };
    case "sup":
      return { mark: "sup", tag: name };
    case "sub":
      return { mark: "sub", tag: name };
    case "b":
    case "strong":
      return { mark: "bold", tag: name };
    case "i":
    case "em":
      return { mark: "italic", tag: name };
    case "span":
      return { mark: "color", tag: name, value: cls ?? null };
    case "mark":
      return { mark: "highlight", tag: name, value: cls ?? "yellow" };
    default:
      return null;
  }
}

/** 找出記號字元所在的格式。 */
function marksOf(tokens: Token[], sentinel: string): Marks | null {
  const stack: Entry[] = [];
  const popLast = (pred: (e: Entry) => boolean) => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (pred(stack[i])) {
        stack.splice(i, 1);
        return;
      }
    }
  };
  for (const t of tokens) {
    switch (t.type) {
      case "strong_open":
        stack.push({ mark: "bold" });
        break;
      case "em_open":
        stack.push({ mark: "italic" });
        break;
      case "link_open":
        stack.push({ mark: "link" });
        break;
      case "strong_close":
        popLast((e) => e.mark === "bold");
        break;
      case "em_close":
        popLast((e) => e.mark === "italic");
        break;
      case "link_close":
        popLast((e) => e.mark === "link");
        break;
      case "html_inline": {
        const m = HTML_TAG.exec(t.content.trim());
        if (!m) break;
        const name = m[2].toLowerCase();
        if (m[1]) popLast((e) => e.tag === name);
        else {
          const e = htmlEntry(name, m[3]);
          if (e) stack.push(e);
        }
        break;
      }
      case "code_inline":
        if (t.content.includes(sentinel)) return toMarks(stack, true);
        break;
      default:
        if (t.content.includes(sentinel)) return toMarks(stack, false);
    }
  }
  return null;
}

function toMarks(stack: Entry[], code: boolean): Marks {
  const has = (m: Entry["mark"]) => stack.some((e) => e.mark === m);
  const last = (m: "color" | "highlight") => [...stack].reverse().find((e) => e.mark === m)?.value ?? null;
  return {
    bold: has("bold"),
    italic: has("italic"),
    strike: has("strike"),
    underline: has("underline"),
    sup: has("sup"),
    sub: has("sub"),
    link: has("link"),
    code,
    color: last("color"),
    highlight: last("highlight"),
    charStyle: null,
  };
}

/** 選取範圍 [a, b)（沒有選取時 a === b）的格式；有選取時頭尾都有的格式才算。 */
export function marksAt(text: string, a: number, b: number): Marks {
  const marked = a === b ? text.slice(0, a) + A + text.slice(a) : text.slice(0, a) + A + text.slice(a, b) + B + text.slice(b);
  const children = md.parseInline(marked, {})[0]?.children ?? [];
  const start = marksOf(children, A) ?? NONE;
  if (a === b) return start;
  const end = marksOf(children, B) ?? NONE;
  return {
    bold: start.bold && end.bold,
    italic: start.italic && end.italic,
    strike: start.strike && end.strike,
    underline: start.underline && end.underline,
    sup: start.sup && end.sup,
    sub: start.sub && end.sub,
    code: start.code && end.code,
    link: start.link && end.link,
    color: start.color === end.color ? start.color : null,
    highlight: start.highlight === end.highlight ? start.highlight : null,
    charStyle: null,
  };
}

export interface Edited {
  text: string;
  /** 編輯後的選取範圍 */
  a: number;
  b: number;
}

// ─── 粗體、斜體、行內程式碼（Markdown 記號） ──────────────────────

type Delim = "bold" | "italic" | "code";
const DELIM: Record<Delim, string> = { bold: "**", italic: "*", code: "`" };

/** 取消格式：在游標附近找出包住它的一對記號並刪掉。 */
function unwrapAround(text: string, a: number, b: number, mark: Delim): Edited | null {
  const candidates = mark === "bold" ? ["**", "__"] : mark === "italic" ? ["*", "_"] : ["`"];
  for (const d of candidates) {
    // 由近到遠試左邊的記號，配上右邊最近的記號，刪掉後游標不再有這個格式就對了
    for (let l = text.lastIndexOf(d, a - d.length); l >= 0; l = text.lastIndexOf(d, l - 1)) {
      const r = text.indexOf(d, Math.max(b, l + d.length));
      if (r < 0) break;
      const out = text.slice(0, l) + text.slice(l + d.length, r) + text.slice(r + d.length);
      const na = a - d.length;
      const nb = b - d.length;
      if (!marksAt(out, na, nb)[mark]) return { text: out, a: na, b: nb };
      if (l === 0) break;
    }
  }
  return null;
}

/** 前後空白留在格式外面（CommonMark 的記號內側不能是空白）。 */
function trimSel(text: string, a: number, b: number): [number, number] {
  let s = a;
  let e = b;
  while (s < e && /\s/.test(text[s])) s++;
  while (e > s && /\s/.test(text[e - 1])) e--;
  return [s, e];
}

/** 切換粗體、斜體或行內程式碼。 */
function toggleDelim(text: string, a: number, b: number, mark: Delim, active: boolean): Edited {
  const d = DELIM[mark];
  // 沒有選取：在格式裡就取消；不在就放一對記號，游標在中間，接著打的字就有格式
  if (a === b) {
    if (active) return unwrapAround(text, a, b, mark) ?? { text, a, b };
    return { text: text.slice(0, a) + d + d + text.slice(a), a: a + d.length, b: a + d.length };
  }

  const [s, e] = trimSel(text, a, b);
  if (s === e) return { text, a, b };
  const sel = text.slice(s, e);

  // 選取本身就帶著記號：拿掉
  const own = mark === "code" ? /^(`+)\s?([\s\S]*?)\s?\1$/ : new RegExp(`^(${mark === "bold" ? "\\*\\*|__" : "\\*|_"})([\\s\\S]+)\\1$`);
  const m = own.exec(sel);
  if (m && (mark !== "italic" || !/^(\*\*|__)/.test(sel))) {
    const inner = m[2];
    return { text: text.slice(0, s) + inner + text.slice(e), a: s, b: s + inner.length };
  }

  if (active) {
    // 選取剛好是整段格式的內容：拿掉兩側記號
    for (const dd of mark === "bold" ? ["**", "__"] : mark === "italic" ? ["*", "_"] : ["`"]) {
      if (text.slice(s - dd.length, s) === dd && text.slice(e, e + dd.length) === dd) {
        const out = text.slice(0, s - dd.length) + sel + text.slice(e + dd.length);
        if (!marksAt(out, s - dd.length, e - dd.length)[mark]) {
          return { text: out, a: s - dd.length, b: e - dd.length };
        }
      }
    }
    // 選取是格式中間的一段：在選取前後把格式斷開
    if (mark !== "code") {
      const out = text.slice(0, s) + d + sel + d + text.slice(e);
      return { text: out, a: s + d.length, b: e + d.length };
    }
    return { text, a, b };
  }

  // 加上格式
  if (mark === "code") {
    const ticks = "`".repeat(Math.max(1, ...(sel.match(/`+/g) ?? [""]).map((x) => x.length + 1)));
    const pad = sel.startsWith("`") || sel.endsWith("`") ? " " : "";
    const out = text.slice(0, s) + ticks + pad + sel + pad + ticks + text.slice(e);
    const off = ticks.length + pad.length;
    return { text: out, a: s + off, b: e + off };
  }
  const out = text.slice(0, s) + d + sel + d + text.slice(e);
  return { text: out, a: s + d.length, b: e + d.length };
}

// ─── 刪除線、底線、顏色、螢光（行內 HTML 標籤） ─────────────────

type TagName = "s" | "u" | "sup" | "sub" | "span" | "mark";

interface Pair {
  name: TagName;
  /** 開頭標籤的範圍 [os, oe) 與結尾標籤的範圍 [cs, ce) */
  os: number;
  oe: number;
  cs: number;
  ce: number;
}

const TAG_SCAN = /<(\/?)(s|u|sup|sub|span|mark)\b[^>]*>/gi;

/** 找出文字中成對的標籤。 */
function tagPairs(text: string, name: TagName): Pair[] {
  const out: Pair[] = [];
  const stack: { os: number; oe: number }[] = [];
  for (const m of text.matchAll(TAG_SCAN)) {
    if (m[2].toLowerCase() !== name) continue;
    const at = m.index!;
    if (m[1]) {
      const open = stack.pop();
      if (open) out.push({ name, os: open.os, oe: open.oe, cs: at, ce: at + m[0].length });
    } else {
      stack.push({ os: at, oe: at + m[0].length });
    }
  }
  return out;
}

/** 包住 [a, b) 的最內層一對標籤。 */
function enclosing(text: string, a: number, b: number, name: TagName): Pair | null {
  let best: Pair | null = null;
  for (const p of tagPairs(text, name)) {
    if (p.oe <= a && b <= p.cs && (!best || p.os > best.os)) best = p;
  }
  return best;
}

/**
 * 把 [a, b) 設成某個標籤格式（open 為 null 表示拿掉這個格式）。
 * 選取在既有標籤中間時，前後各留一段原本的格式；選取裡面同名的標籤先拿掉，避免層層疊。
 */
function setTag(text: string, a: number, b: number, name: TagName, open: string | null): Edited {
  const close = `</${name}>`;
  const p0 = enclosing(text, a, b, name);

  if (a === b) {
    if (p0) {
      if (open) {
        // 游標在格式裡：只換開頭標籤（例如換顏色）
        const out = text.slice(0, p0.os) + open + text.slice(p0.oe);
        const d = open.length - (p0.oe - p0.os);
        return { text: out, a: a + d, b: b + d };
      }
      // 拿掉整段格式
      const out = text.slice(0, p0.os) + text.slice(p0.oe, p0.cs) + text.slice(p0.ce);
      const d = p0.oe - p0.os;
      return { text: out, a: a - d, b: b - d };
    }
    if (!open) return { text, a, b };
    return { text: text.slice(0, a) + open + close + text.slice(a), a: a + open.length, b: a + open.length };
  }

  let [s, e] = trimSel(text, a, b);
  if (s === e) return { text, a, b };

  // 選取裡面成對的同名標籤拿掉
  let work = text;
  const inner = tagPairs(work, name)
    .filter((p) => p.os >= s && p.ce <= e)
    .flatMap((p) => [
      [p.cs, p.ce],
      [p.os, p.oe],
    ])
    .sort((x, y) => y[0] - x[0]);
  for (const [from, to] of inner) {
    work = work.slice(0, from) + work.slice(to);
    e -= to - from;
  }
  // 選取剛好包含整段標籤（例如選到 <u>文字</u>）：當成選了裡面的文字
  const whole = tagPairs(work, name).find((p) => p.os === s && p.ce === e);
  if (whole) {
    work = work.slice(0, whole.os) + work.slice(whole.oe, whole.cs) + work.slice(whole.ce);
    e = s + (whole.cs - whole.oe);
  }

  const sel = work.slice(s, e);
  const p = enclosing(work, s, e, name);
  const mid = open ? open + sel + close : sel;
  const midOffset = open ? open.length : 0;
  if (!p) {
    return { text: work.slice(0, s) + mid + work.slice(e), a: s + midOffset, b: s + midOffset + sel.length };
  }
  // 在既有格式裡：前後留原本的格式，中間換掉
  const openText = work.slice(p.os, p.oe);
  const closeText = work.slice(p.cs, p.ce);
  const left = work.slice(p.oe, s);
  const right = work.slice(e, p.cs);
  const before = left ? openText + left + closeText : "";
  const after = right ? openText + right + closeText : "";
  const out = work.slice(0, p.os) + before + mid + after + work.slice(p.ce);
  const start = p.os + before.length + midOffset;
  return { text: out, a: start, b: start + sel.length };
}

// ─── 連結 ───────────────────────────────────────────────────────

const LINK = /\[([^\]\n]*)\]\(([^)\n]*)\)/g;

/** 切換連結：在連結裡就拿掉連結（保留文字）；否則把選取包成 [文字](網址)，並選取網址方便輸入。 */
function toggleLink(text: string, a: number, b: number, active: boolean): Edited {
  if (active) {
    for (const m of text.matchAll(LINK)) {
      const start = m.index!;
      const end = start + m[0].length;
      if (start <= a && b <= end) {
        const out = text.slice(0, start) + m[1] + text.slice(end);
        const na = Math.max(start, Math.min(a - 1, start + m[1].length));
        return { text: out, a: na, b: Math.max(na, Math.min(b - 1, start + m[1].length)) };
      }
    }
    return { text, a, b };
  }
  const sel = text.slice(a, b) || "Link";
  const url = "https://";
  const out = text.slice(0, a) + "[" + sel + "](" + url + ")" + text.slice(b);
  const ua = a + sel.length + 3;
  return { text: out, a: ua, b: ua + url.length };
}

// ─── 對外 ───────────────────────────────────────────────────────

/** 切換格式。active 是目前的狀態（marksAt 的結果）。 */
export function toggleMark(text: string, a: number, b: number, mark: Mark, active?: boolean): Edited {
  const on = active ?? marksAt(text, a, b)[mark];
  switch (mark) {
    case "link":
      return toggleLink(text, a, b, on);
    case "strike":
      return setTag(text, a, b, "s", on ? null : "<s>");
    case "underline":
      return setTag(text, a, b, "u", on ? null : "<u>");
    case "sup":
      return setTag(text, a, b, "sup", on ? null : "<sup>");
    case "sub":
      return setTag(text, a, b, "sub", on ? null : "<sub>");
    default:
      return toggleDelim(text, a, b, mark, on);
  }
}

/** 設定文字顏色或螢光標記（color 為 null 表示拿掉）。 */
export function setColor(text: string, a: number, b: number, kind: "color" | "highlight", color: Ink | null): Edited {
  const name = kind === "color" ? "span" : "mark";
  return setTag(text, a, b, name, color ? inkTag(name, color) : null);
}
