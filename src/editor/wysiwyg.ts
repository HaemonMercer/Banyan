import DOMPurify from "dompurify";
import { PURIFY, resolveMedia } from "./media";
import { COLORS, type Color, type Marks } from "./inline";
import { md, type UnitKind } from "./markdown";

/**
 * 所見即所得（WYSIWYG）編輯的核心：
 *
 * 1. 把區塊原始碼拆成「區塊語法」（`# `、`- `、`> `…，畫面上不顯示）與「行內內容」。
 * 2. 行內內容用 markdown-it 渲染成 HTML 放進可編輯的元素。
 * 3. 使用者編輯後，把 DOM 轉回行內 Markdown（必要時跳脫特殊字元），再接回區塊語法。
 *
 * 游標位置以兩個私用區字元（\uE000、\uE001）標記，在 DOM 與原始碼之間對照。
 * 文件本體仍是 Markdown；只有被編輯的區塊會重新產生原始碼。
 */

export const SEL_A = "\uE000";
export const SEL_B = "\uE001";
const ZWSP = "\u200B";
const MARKERS = /[\uE000\uE001]/g;

// ─── 區塊語法與行內內容 ─────────────────────────────────────────

export interface Shape {
  kind: "paragraph" | "heading" | "item" | "quote";
  /** 原本每一行的前綴（第一行是區塊標記，之後是延續行的縮排或 `> `） */
  prefixes: string[];
  /** 新增行的前綴 */
  cont: string;
  /** 標題的結尾（閉合的 `#` 與空白） */
  suffix: string;
  /** 行內內容（不含區塊語法） */
  content: string;
}

/** 內容是不是只有一段行內文字（沒有其他區塊結構）。 */
function inlineOnly(content: string): boolean {
  if (!content.trim()) return true;
  const toks = md.parse(content, {});
  return toks.length === 3 && toks[0].type === "paragraph_open" && toks[2].type === "paragraph_close";
}

/** 行內內容裡有編輯器不認得的 HTML 標籤時，不用所見即所得編輯（避免轉換時遺失）。 */
const UNKNOWN_HTML = /<(?!\/?(?:s|u|span|mark|strong|em|b|i|br)\b)[a-zA-Z/!?]/;

/**
 * 拆開區塊原始碼。只處理單純的段落、ATX 標題、單段的清單項目與引用；
 * 其他（巢狀清單、多段落、程式碼…）回傳 null，改用原始碼編輯。
 */
export function decompose(text: string, kind: UnitKind | undefined): Shape | null {
  const lines = text.split("\n");
  let shape: Shape | null = null;
  switch (kind ?? "paragraph") {
    case "paragraph":
      shape = { kind: "paragraph", prefixes: lines.map(() => ""), cont: "", suffix: "", content: text };
      break;
    case "heading": {
      if (lines.length !== 1) return null;
      const m = /^ {0,3}#{1,6}(?:[ \t]+|$)/.exec(lines[0]);
      if (!m) return null;
      let rest = lines[0].slice(m[0].length);
      const close = /(?:^|[ \t]+)#+[ \t]*$|[ \t]+$/.exec(rest);
      const suffix = close ? close[0] : "";
      rest = rest.slice(0, rest.length - suffix.length);
      shape = { kind: "heading", prefixes: [m[0]], cont: "", suffix, content: rest };
      break;
    }
    case "item": {
      const m = /^( {0,3}(?:[-+*]|\d{1,9}[.)]))([ \t]{1,4}|$)/.exec(lines[0]);
      if (!m) return null;
      const first = m[1] + m[2];
      const indent = " ".repeat(Math.max(first.length, m[1].length + 1));
      const prefixes = [first];
      const body = [lines[0].slice(first.length)];
      for (const l of lines.slice(1)) {
        const p = l.startsWith(indent) ? indent : "";
        prefixes.push(p);
        body.push(l.slice(p.length));
      }
      shape = { kind: "item", prefixes, cont: indent, suffix: "", content: body.join("\n") };
      break;
    }
    case "quote": {
      const prefixes: string[] = [];
      const body: string[] = [];
      for (const l of lines) {
        const m = /^ {0,3}> ?/.exec(l);
        prefixes.push(m ? m[0] : "");
        body.push(m ? l.slice(m[0].length) : l);
      }
      if (!prefixes[0]) return null;
      shape = { kind: "quote", prefixes, cont: "> ", suffix: "", content: body.join("\n") };
      break;
    }
    default:
      return null;
  }
  if (!inlineOnly(shape.content) || UNKNOWN_HTML.test(shape.content)) return null;
  return shape;
}

interface LineLayout {
  pre: string;
  /** 這一行在行內內容中的起點與長度 */
  start: number;
  len: number;
}

function layout(shape: Shape, content: string): LineLayout[] {
  const lines = shape.kind === "heading" ? [content.replace(/\n/g, " ")] : content.split("\n");
  let pos = 0;
  return lines.map((l, i) => {
    let pre = i < shape.prefixes.length ? shape.prefixes[i] : shape.cont;
    // 區塊標記後面一定要有空白（例如原本是空項目 `-`，打字後要變成 `- 文字`）
    if (i === 0 && l && shape.kind !== "paragraph" && !/[ \t]$/.test(pre)) pre += " ";
    const out = { pre, start: pos, len: l.length };
    pos += l.length + 1;
    return out;
  });
}

/** 把行內內容接回區塊語法。 */
export function recompose(shape: Shape, content: string): string {
  const text = shape.kind === "heading" ? content.replace(/\n/g, " ") : content;
  const rows = layout(shape, text);
  const lines = text.split("\n");
  return rows.map((r, i) => r.pre + lines[i]).join("\n") + shape.suffix;
}

/** 行內內容的位置 → 區塊原始碼的位置。 */
export function contentToRegion(shape: Shape, content: string, off: number): number {
  let region = 0;
  for (const r of layout(shape, content)) {
    if (off <= r.start + r.len) return region + r.pre.length + Math.max(0, off - r.start);
    region += r.pre.length + r.len + 1;
  }
  return region;
}

/** 區塊原始碼的位置 → 行內內容的位置（落在區塊語法裡時取該行開頭）。 */
export function regionToContent(shape: Shape, content: string, off: number): number {
  let region = 0;
  for (const r of layout(shape, content)) {
    const lineEnd = region + r.pre.length + r.len;
    if (off <= lineEnd) return r.start + Math.max(0, off - region - r.pre.length);
    region = lineEnd + 1;
  }
  return content.length;
}

// ─── Markdown → HTML ────────────────────────────────────────────

/** 渲染行內內容（給可編輯元素用）。軟換行保留成換行字元，硬換行後面不多一個換行。 */
export function contentHtml(content: string, env: Record<string, unknown> = {}): string {
  // 軟換行在 CommonMark 渲染成空白，編輯時也顯示成空白（所見即所得）；硬換行是 <br>
  const html = md
    .renderInline(content, env)
    .replace(/<br\s*\/?>\n/g, "<br>")
    .replace(/\n/g, " ");
  return DOMPurify.sanitize(resolveMedia(html), PURIFY) as string;
}

// ─── DOM → Markdown ─────────────────────────────────────────────

type FormatKey = string | null;

const PALETTE = COLORS as readonly string[];
const colorClass = (el: Element) => [...el.classList].find((c) => PALETTE.includes(c)) ?? null;

/** 元素代表的格式；相同格式的相鄰元素會合併。 */
function formatKey(el: Element): FormatKey {
  switch (el.tagName) {
    case "B":
    case "STRONG":
      return "b";
    case "I":
    case "EM":
      return "i";
    case "U":
      return "u";
    case "S":
    case "STRIKE":
    case "DEL":
      return "s";
    case "CODE":
      return "code";
    case "A":
      return "a:" + (el.getAttribute("href") ?? "");
    case "SPAN":
      return colorClass(el) ? "span:" + colorClass(el) : null;
    case "MARK":
      return "mark:" + (colorClass(el) ?? "yellow");
    default:
      return null;
  }
}

const visible = (n: Node) => (n.textContent ?? "").replace(MARKERS, "").replace(/\u200B/g, "");

/** 整理一份複本：去掉零寬空白、拆掉空的格式元素與不認得的元素、合併相鄰的同格式元素。 */
function tidy(root: Node) {
  for (const child of [...root.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) {
      const t = child as Text;
      t.data = t.data.replace(/\u200B/g, "").replace(/\u00a0/g, " ");
      if (!t.data) t.remove();
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      if (el.tagName === "BR" || el.tagName === "IMG") continue;
      tidy(el);
      const key = formatKey(el);
      // 不認得的元素、或格式元素裡沒有看得到的字：只留內容
      if (!key || (!visible(el) && el.tagName !== "CODE") || (el.tagName === "CODE" && !visible(el))) {
        el.replaceWith(...el.childNodes);
      }
    } else {
      child.remove();
    }
  }
  // 合併相鄰的同格式元素
  let prev: ChildNode | null = null;
  for (const child of [...root.childNodes]) {
    if (
      prev &&
      prev.nodeType === Node.ELEMENT_NODE &&
      child.nodeType === Node.ELEMENT_NODE &&
      formatKey(prev as Element) &&
      formatKey(prev as Element) === formatKey(child as Element)
    ) {
      (prev as Element).append(...child.childNodes);
      child.remove();
      tidy(prev);
      continue;
    }
    prev = child;
  }
  root.normalize?.();
}

/** 跳脫會被當成 Markdown 語法的字元。 */
function escapeText(s: string): string {
  return s.replace(/[\\`*_[\]<]/g, "\\$&").replace(/&(?=#?[A-Za-z0-9]+;)/g, "\\&");
}

/** 行首會變成區塊語法的字元也要跳脫（例如段落文字以 `# `、`- `、`1. `、`> ` 開頭）。 */
function escapeLineStarts(s: string): string {
  return s
    .split("\n")
    .map((line, i, all) => {
      let l = line.replace(/^[ \t]+/, (ws) => (ws.length >= 4 || i === 0 ? "" : ws)); // 行首空白不顯示，避免變成程式碼區塊
      const m = /^([\uE000\uE001]*)(.*)$/.exec(l)!;
      const [, marks, rest] = m;
      let r = rest;
      if (/^(#{1,6})(\s|$)/.test(r) || /^>/.test(r)) r = "\\" + r;
      else if (/^[-+](\s|$)/.test(r)) r = "\\" + r;
      else if (/^\d{1,9}[.)](\s|$)/.test(r)) r = r.replace(/^(\d{1,9})([.)])/, "$1\\$2");
      else if (/^(=+|-+)\s*$/.test(r) && i > 0) r = "\\" + r;
      else if (/^(`{3,}|~{3,})/.test(r)) r = "\\" + r;
      l = marks + r;
      // 行尾兩個以上空白會變成硬換行
      if (i < all.length - 1) l = l.replace(/[ \t]+$/, "");
      return l;
    })
    .join("\n");
}

interface SerOptions {
  /** 用 HTML 標籤而不是 ** * 表示粗體、斜體（CommonMark 的強調規則在某些標點旁不成立時） */
  html: boolean;
}

function serializeChildren(node: Node, o: SerOptions): string {
  const kids = [...node.childNodes];
  let out = "";
  kids.forEach((k, i) => {
    if (k.nodeType === Node.ELEMENT_NODE && (k as Element).tagName === "BR") {
      // 最後面的換行沒有意義（Markdown 的段落結尾不能是硬換行）
      const rest = kids.slice(i + 1).some((n) => visible(n) || (n as Element).tagName === "BR");
      out += rest ? "\\\n" : "";
      return;
    }
    out += serializeNode(k, o);
  });
  return out;
}

/** 記號內側不能是空白：把頭尾空白搬到記號外面。 */
function wrap(inner: string, open: string, close = open): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  if (!m[2].replace(MARKERS, "")) return inner;
  return m[1] + open + m[2] + close + m[3];
}

function serializeNode(node: Node, o: SerOptions): string {
  // 文字裡的換行（Shift+Enter 在 pre-wrap 元素中插入的）是硬換行
  if (node.nodeType === Node.TEXT_NODE) return (node as Text).data.split("\n").map(escapeText).join("\\\n");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const inner = () => serializeChildren(el, o);
  switch (el.tagName) {
    case "B":
    case "STRONG":
      return o.html ? wrap(inner(), "<strong>", "</strong>") : wrap(inner(), "**");
    case "I":
    case "EM":
      return o.html ? wrap(inner(), "<em>", "</em>") : wrap(inner(), "*");
    case "U":
      return wrap(inner(), "<u>", "</u>");
    case "S":
    case "STRIKE":
    case "DEL":
      return wrap(inner(), "<s>", "</s>");
    case "SPAN": {
      const c = colorClass(el);
      return c ? wrap(inner(), `<span class="${c}">`, "</span>") : inner();
    }
    case "MARK": {
      const c = colorClass(el) ?? "yellow";
      return wrap(inner(), `<mark class="${c}">`, "</mark>");
    }
    case "CODE": {
      const code = (el.textContent ?? "").replace(/\u200B/g, "");
      const runs = code.replace(MARKERS, "").match(/`+/g) ?? [];
      const ticks = "`".repeat(Math.max(0, ...runs.map((r) => r.length)) + 1);
      const plain = code.replace(MARKERS, "");
      const pad = plain.startsWith("`") || plain.endsWith("`") || (plain.startsWith(" ") && plain.endsWith(" ") && plain.trim()) ? " " : "";
      return ticks + pad + code + pad + ticks;
    }
    case "A": {
      const href = el.getAttribute("href") ?? "";
      const dest = /[\s()<>]/.test(href) ? `<${href.replace(/[<>]/g, (c) => encodeURIComponent(c))}>` : href;
      const title = el.getAttribute("title");
      return `[${inner()}](${dest}${title ? ` "${title.replace(/"/g, '\\"')}"` : ""})`;
    }
    case "IMG": {
      const alt = escapeText(el.getAttribute("alt") ?? "");
      // 顯示用的網址換回原本的 media/… 路徑
      const src = el.getAttribute("data-src") ?? el.getAttribute("src") ?? "";
      return `![${alt}](${/[\s()<>]/.test(src) ? `<${src}>` : src})`;
    }
    default:
      return inner();
  }
}

// ─── 格式簽名：確認轉出來的 Markdown 渲染後與畫面一致 ────────────

function signature(root: Node): string {
  const out: string[] = [];
  const walk = (n: Node, fmt: string[]) => {
    if (n.nodeType === Node.TEXT_NODE) {
      for (const ch of (n as Text).data.replace(/[\u200B\uE000\uE001]/g, "").replace(/\u00a0/g, " ")) {
        // 空白上的格式看不出來，不比較
        out.push(/\s/.test(ch) ? ch : ch + fmt.join(","));
      }
      return;
    }
    if (n.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      for (const c of n.childNodes) walk(c, fmt);
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as Element;
    if (el.tagName === "BR") {
      out.push("\n" + fmt.join(","));
      return;
    }
    const key = formatKey(el);
    const next = key ? [...fmt, key].sort() : fmt;
    for (const c of el.childNodes) walk(c, next);
  };
  walk(root, []);
  // 頭尾空白與行尾空白不影響畫面
  let s = out.join("|");
  s = s.replace(/^(\s[^|]*\|)+/, "").replace(/(\|\s[^|]*)+$/, "");
  return s;
}

function htmlToNode(html: string): Node {
  const t = document.createElement("template");
  t.innerHTML = html;
  return t.content;
}

export interface Serialized {
  content: string;
  /** 選取在行內內容中的位置（沒有選取時為 null） */
  a: number | null;
  b: number | null;
}

/**
 * 把可編輯元素轉回行內 Markdown，同時算出選取的位置。
 * 先用 ** * 寫；渲染回來跟畫面不一致（例如中文標點旁的強調不成立）時改用 HTML 標籤。
 */
export function serialize(root: HTMLElement, env: Record<string, unknown> = {}): Serialized {
  const plain = root.cloneNode(true) as HTMLElement;
  tidy(plain);
  let o: SerOptions = { html: false };
  let content = escapeLineStarts(serializeChildren(plain, o));
  if (signature(htmlToNode(contentHtml(content, env))) !== signature(plain)) {
    o = { html: true };
    content = escapeLineStarts(serializeChildren(plain, o));
  }

  // 標記選取位置：在複本的選取處插入標記字元，再轉一次
  const marked = markSelection(root);
  if (!marked) return { content, a: null, b: null };
  tidy(marked);
  const withSel = escapeLineStarts(serializeChildren(marked, o));
  const ia = withSel.indexOf(SEL_A);
  const ib = withSel.indexOf(SEL_B);
  if (ia < 0) return { content, a: null, b: null };
  // 標記字元本身佔一格：B 在 A 後面，扣掉 A 那一格
  const a = ia;
  const b = ib < 0 ? a : ib - 1;
  return { content, a: Math.min(a, content.length), b: Math.min(Math.max(a, b), content.length) };
}

/** 從根到節點的路徑（子節點索引）。 */
function pathOf(root: Node, node: Node): number[] | null {
  const path: number[] = [];
  for (let n: Node | null = node; n && n !== root; n = n.parentNode) {
    const p: Node | null = n.parentNode;
    if (!p) return null;
    path.unshift([...p.childNodes].indexOf(n as ChildNode));
  }
  return path;
}

function follow(root: Node, path: number[]): Node | null {
  let n: Node | null = root;
  for (const i of path) n = n?.childNodes[i] ?? null;
  return n;
}

/** 在複本中對應的位置插入標記字元。 */
function insertMark(target: Node, offset: number, mark: string) {
  if (target.nodeType === Node.TEXT_NODE) {
    const t = target as Text;
    t.data = t.data.slice(0, offset) + mark + t.data.slice(offset);
  } else {
    target.insertBefore(target.ownerDocument!.createTextNode(mark), target.childNodes[offset] ?? null);
  }
}

function mapNode(root: Node, clone: Node, node: Node): Node {
  if (node === root) return clone;
  const path = pathOf(root, node);
  return (path && follow(clone, path)) ?? clone;
}

/** 複製元素並在選取的頭尾插入標記字元；選取不在元素裡時回傳 null。 */
function markSelection(root: HTMLElement): HTMLElement | null {
  const sel = root.ownerDocument.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null;
  const clone = root.cloneNode(true) as HTMLElement;
  // 先插後面的，前面的位置才不會跑掉
  if (!r.collapsed) insertMark(mapNode(root, clone, r.endContainer), r.endOffset, SEL_B);
  insertMark(mapNode(root, clone, r.startContainer), r.startOffset, SEL_A);
  return clone;
}

/** 把元素內容換成渲染後的 Markdown，並把選取放在行內內容的 [a, b)。 */
export function renderInto(
  root: HTMLElement,
  content: string,
  sel: [number, number] | null,
  env: Record<string, unknown> = {},
): void {
  if (!sel) {
    root.innerHTML = contentHtml(content, env);
    return;
  }
  const [a, b] = sel;
  const marked =
    a === b
      ? content.slice(0, a) + SEL_A + content.slice(a)
      : content.slice(0, a) + SEL_A + content.slice(a, b) + SEL_B + content.slice(b);
  root.innerHTML = contentHtml(marked, env);
  const found: Record<string, [Text, number]> = {};
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  for (const t of texts) {
    for (const m of [SEL_A, SEL_B]) {
      const i = t.data.indexOf(m);
      if (i >= 0) {
        t.data = t.data.slice(0, i) + t.data.slice(i + 1);
        found[m] = [t, i];
      }
    }
  }
  // 標記落在無法顯示的地方（例如連結網址裡）：重新渲染不帶標記，游標放最後
  if (!found[SEL_A]) {
    root.innerHTML = contentHtml(content, env);
    placeCaret(root, null);
    return;
  }
  const range = root.ownerDocument.createRange();
  range.setStart(found[SEL_A][0], found[SEL_A][1]);
  const end = found[SEL_B] ?? found[SEL_A];
  range.setEnd(end[0], end[1]);
  const s = root.ownerDocument.getSelection();
  s?.removeAllRanges();
  s?.addRange(range);
}

/** 游標放在元素最後（node 為 null）或指定位置。 */
export function placeCaret(root: HTMLElement, at: [Node, number] | null) {
  const range = root.ownerDocument.createRange();
  if (at) range.setStart(at[0], at[1]);
  else {
    range.selectNodeContents(root);
    range.collapse(false);
  }
  range.collapse(true);
  const s = root.ownerDocument.getSelection();
  s?.removeAllRanges();
  s?.addRange(range);
}

// ─── 游標處的格式（DOM） ─────────────────────────────────────────

/** 游標所在位置的格式，直接從 DOM 祖先元素判斷（包含剛按下、還沒打字的格式）。 */
export function domMarks(root: HTMLElement): Marks | null {
  const sel = root.ownerDocument.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
  const node = sel.anchorNode;
  if (!node || !root.contains(node)) return null;
  const m: Marks = {
    bold: false,
    italic: false,
    strike: false,
    underline: false,
    code: false,
    link: false,
    color: null,
    highlight: null,
  };
  for (let n: Node | null = node; n && n !== root; n = n.parentNode) {
    if (n.nodeType !== Node.ELEMENT_NODE) continue;
    const key = formatKey(n as Element);
    if (!key) continue;
    if (key === "b") m.bold = true;
    else if (key === "i") m.italic = true;
    else if (key === "u") m.underline = true;
    else if (key === "s") m.strike = true;
    else if (key === "code") m.code = true;
    else if (key.startsWith("a:")) m.link = true;
    else if (key.startsWith("span:") && !m.color) m.color = key.slice(5) as Color;
    else if (key.startsWith("mark:") && !m.highlight) m.highlight = key.slice(5) as Color;
  }
  return m;
}

// ─── 沒有選取時切換格式：讓接著打的字有（或沒有）這個格式 ─────────

export type FormatSpec =
  | { tag: "strong" | "em" | "u" | "s" | "code" }
  | { tag: "span" | "mark"; color: Color | null }
  | { tag: "a"; href: string };

function matches(el: Element, spec: FormatSpec): boolean {
  const key = formatKey(el);
  if (!key) return false;
  switch (spec.tag) {
    case "strong":
      return key === "b";
    case "em":
      return key === "i";
    case "u":
    case "s":
    case "code":
      return key === spec.tag;
    case "span":
      return key.startsWith("span:");
    case "mark":
      return key.startsWith("mark:");
    case "a":
      return key.startsWith("a:");
  }
}

function makeEl(doc: Document, spec: FormatSpec): HTMLElement | null {
  if ((spec.tag === "span" || spec.tag === "mark") && !spec.color) return null;
  const el = doc.createElement(spec.tag);
  if (spec.tag === "a") el.setAttribute("href", spec.href);
  if ((spec.tag === "span" || spec.tag === "mark") && spec.color) el.className = spec.color;
  return el;
}

/**
 * 游標處（沒有選取）切換格式：在格式裡就把格式在游標處斷開，游標放在兩段中間；
 * 不在就放一個空的格式元素（裡面是零寬空白），游標放進去。轉回 Markdown 時空元素會消失。
 */
export function toggleAtCaret(root: HTMLElement, spec: FormatSpec): boolean {
  const doc = root.ownerDocument;
  const sel = doc.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed || !root.contains(sel.anchorNode)) return false;
  const range = sel.getRangeAt(0);
  let host: Element | null = null;
  for (let n: Node | null = range.startContainer; n && n !== root; n = n.parentNode) {
    if (n.nodeType === Node.ELEMENT_NODE && matches(n as Element, spec)) {
      host = n as Element;
      break;
    }
  }
  const zw = doc.createTextNode(ZWSP);
  if (host) {
    // 斷開：游標後面的內容搬到一個新的同格式元素
    const tail = doc.createRange();
    tail.setStart(range.startContainer, range.startOffset);
    tail.setEndAfter(host.lastChild ?? host);
    const frag = tail.extractContents();
    const after = host.cloneNode(false) as Element;
    after.append(frag);
    host.after(zw);
    if (visible(after)) zw.after(after);
    // 換顏色：中間放新顏色的空元素
    const fresh = makeEl(doc, spec);
    if (fresh && (spec.tag === "span" || spec.tag === "mark") && !matchesColor(host, spec)) {
      fresh.append(zw.cloneNode());
      zw.replaceWith(fresh);
      placeCaret(root, [fresh.firstChild!, 1]);
      return true;
    }
    placeCaret(root, [zw, 1]);
    return true;
  }
  const el = makeEl(doc, spec);
  if (!el) return false;
  el.append(zw);
  range.insertNode(el);
  placeCaret(root, [zw, 1]);
  return true;
}

function matchesColor(el: Element, spec: FormatSpec): boolean {
  return (spec.tag === "span" || spec.tag === "mark") && colorClass(el) === spec.color;
}

/** 游標是否在第一行／最後一行（用來決定上下方向鍵要不要跳到別的區塊）。 */
export function caretLine(root: HTMLElement): { first: boolean; last: boolean } {
  const sel = root.ownerDocument.getSelection();
  if (!sel || !sel.rangeCount) return { first: true, last: true };
  const r = sel.getRangeAt(0).cloneRange();
  r.collapse(true);
  let rect = r.getClientRects()[0] ?? r.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    // 空行等量不到位置的情況：暫時插一個零寬字元量
    const probe = root.ownerDocument.createTextNode(ZWSP);
    r.insertNode(probe);
    const pr = root.ownerDocument.createRange();
    pr.selectNodeContents(probe);
    rect = pr.getBoundingClientRect();
    probe.remove();
    root.normalize();
    if (!rect.height) return { first: true, last: true };
  }
  const box = root.getBoundingClientRect();
  const line = parseFloat(getComputedStyle(root).lineHeight) || rect.height || 20;
  return { first: rect.top - box.top < line * 0.7, last: box.bottom - rect.bottom < line * 0.7 };
}

/** 給測試與除錯用：Markdown 渲染後的格式簽名是否與元素一致。 */
export function sameLook(root: HTMLElement, content: string, env: Record<string, unknown> = {}): boolean {
  const plain = root.cloneNode(true) as HTMLElement;
  tidy(plain);
  return signature(htmlToNode(contentHtml(content, env))) === signature(plain);
}

export function isPalette(c: string | null): c is Color {
  return !!c && PALETTE.includes(c);
}

/** 轉出一個節點的行內 Markdown（含格式一致性檢查）。 */
function toMarkdown(node: Node, env: Record<string, unknown>): string {
  tidy(node);
  let content = escapeLineStarts(serializeChildren(node, { html: false }));
  if (signature(htmlToNode(contentHtml(content, env))) !== signature(node)) {
    content = escapeLineStarts(serializeChildren(node, { html: true }));
  }
  return content;
}

/**
 * 在游標處把內容切成前後兩段（Enter 用）。在格式裡切開時兩段各自保有格式，
 * 例如在 **粗體** 中間按 Enter，前後都是粗體，不會把記號切壞。
 * 有選取時，選取的文字會被刪掉。
 */
export function splitAt(root: HTMLElement, env: Record<string, unknown> = {}): { before: string; after: string } | null {
  const sel = root.ownerDocument.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null;
  const clone = root.cloneNode(true) as HTMLElement;
  if (!r.collapsed) insertMark(mapNode(root, clone, r.endContainer), r.endOffset, SEL_B);
  insertMark(mapNode(root, clone, r.startContainer), r.startOffset, SEL_A);
  // 找到標記字元的位置
  const doc = root.ownerDocument;
  const find = (m: string): [Text, number] | null => {
    const w = doc.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const t = w.currentNode as Text;
      const i = t.data.indexOf(m);
      if (i >= 0) return [t, i];
    }
    return null;
  };
  const a = find(SEL_A);
  if (!a) return null;
  const b = find(SEL_B) ?? a;
  const tail = doc.createRange();
  tail.setStart(b[0], b[0] === a[0] && b !== a ? b[1] : b[1]);
  tail.setEndAfter(clone.lastChild!);
  const after = doc.createElement("div");
  after.append(tail.extractContents());
  // 選取的部分刪掉
  if (b !== a) {
    const mid = doc.createRange();
    mid.setStart(a[0], a[1]);
    mid.setEndAfter(clone.lastChild!);
    mid.deleteContents();
  }
  const strip = (n: Node) => {
    const w = doc.createTreeWalker(n, NodeFilter.SHOW_TEXT);
    const ts: Text[] = [];
    while (w.nextNode()) ts.push(w.currentNode as Text);
    for (const t of ts) t.data = t.data.replace(MARKERS, "");
  };
  strip(clone);
  strip(after);
  return { before: toMarkdown(clone, env), after: toMarkdown(after, env) };
}

// ─── 打字時的格式（確保剛打的字有或沒有某個格式） ─────────────────

/** 包住某個位置、符合格式（不看顏色）的最外層祖先元素。 */
function hostOf(root: HTMLElement, node: Node, spec: FormatSpec): Element | null {
  let found: Element | null = null;
  for (let n: Node | null = node; n && n !== root; n = n.parentNode) {
    if (n.nodeType === Node.ELEMENT_NODE && matches(n as Element, spec)) found = n as Element;
  }
  return found;
}

/**
 * 讓 [start, end) 這段文字（通常是剛打的字）一定有或沒有某個格式：
 * on = false 時把它從格式元素裡搬出來（格式在前後斷開）；
 * on = true 時用新的格式元素包起來（顏色不同時先搬出舊顏色）。
 * 不管瀏覽器或輸入法把字插在哪裡，結果都一樣。回傳處理後這段文字的結尾位置。
 */
export function forceFormat(
  root: HTMLElement,
  start: [Node, number],
  end: [Node, number],
  spec: FormatSpec,
  on: boolean,
): [Node, number] | null {
  const doc = root.ownerDocument;
  const range = doc.createRange();
  range.setStart(...start);
  range.setEnd(...end);
  if (range.collapsed) return null;

  const host = hostOf(root, range.commonAncestorContainer, spec);
  const colored = spec.tag === "span" || spec.tag === "mark";
  if (on && host && (!colored || colorClass(host) === spec.color)) return null; // 已經是這個格式
  if (!on && !host) return null; // 本來就沒有

  let frag: DocumentFragment;
  let parent: Node;
  let before: Node | null;
  if (host) {
    // 從格式元素中拿出來：格式在前後斷開，後半段另做一個同樣的元素
    const tail = doc.createRange();
    tail.setStart(range.endContainer, range.endOffset);
    tail.setEnd(host, host.childNodes.length);
    const tailFrag = tail.extractContents();
    // 這段文字與格式元素之間的其他格式（例如粗體裡的斜體）要保留：取出後再包回去
    const between: Element[] = [];
    for (let n: Node | null = range.commonAncestorContainer; n && n !== host; n = n.parentNode) {
      if (n.nodeType === Node.ELEMENT_NODE) between.push(n as Element);
    }
    frag = range.extractContents();
    if (between.length && frag.firstChild) {
      let wrapped: Node = frag;
      for (const b of between) {
        const c = b.cloneNode(false);
        c.appendChild(wrapped);
        wrapped = c;
      }
      const f = doc.createDocumentFragment();
      f.append(wrapped);
      frag = f;
    }
    parent = host.parentNode!;
    before = host.nextSibling;
    const after = host.cloneNode(false) as Element;
    after.append(tailFrag);
    if (visible(after)) {
      parent.insertBefore(after, before);
      before = after;
    } else if (after.textContent) {
      // 只剩選取標記之類看不到的字：不要格式，但字要留著
      const keep = [...after.childNodes];
      for (const k of keep) parent.insertBefore(k, before);
      before = keep[0] ?? before;
    }
    if (!visible(host)) host.replaceWith(...host.childNodes);
  } else {
    frag = range.extractContents();
    const mark = doc.createTextNode("");
    range.insertNode(mark);
    parent = mark.parentNode!;
    before = mark;
  }

  let node: Node = frag;
  let last: Node | null = frag.lastChild;
  if (on) {
    const el = makeEl(doc, spec);
    if (el) {
      el.append(frag);
      node = el;
      last = el.lastChild;
    }
  }
  parent.insertBefore(node, before);
  if (before && before.nodeType === Node.TEXT_NODE && !(before as Text).data) (before as Text).remove();
  if (!last) return null;
  if (last.nodeType === Node.TEXT_NODE) return [last, (last as Text).data.length];
  return [last.parentNode!, [...last.parentNode!.childNodes].indexOf(last as ChildNode) + 1];
}

/** 游標前面 len 個字的位置（剛打的字的開頭）；跨文字節點時往前找。 */
export function backBy(root: HTMLElement, node: Node, offset: number, len: number): [Node, number] | null {
  if (node.nodeType === Node.TEXT_NODE && offset >= len) return [node, offset - len];
  // 往前走文字節點
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  let i = texts.indexOf(node as Text);
  if (i < 0) return null;
  let remain = len - offset;
  while (remain > 0 && --i >= 0) {
    const n = texts[i].data.replace(/\u200B/g, "").length;
    if (n >= remain) return [texts[i], texts[i].data.length - remain];
    remain -= n;
  }
  return null;
}

// ─── 有選取時切換格式（以畫面上的文字為準） ─────────────────────

/** 範圍內所有看得到的文字節點（先在範圍邊界切開，每個節點都完整落在範圍內）。 */
function textSegments(root: Node, from: Node, to: Node): Text[] {
  const doc = root.ownerDocument ?? (root as Document);
  const range = doc.createRange();
  range.setStartAfter(from);
  range.setEndBefore(to);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out: Text[] = [];
  while (walker.nextNode()) {
    const t = walker.currentNode as Text;
    if (t === from || t === to) continue;
    if (!range.intersectsNode(t)) continue;
    if (!t.data.replace(/[\u200B\uE000\uE001]/g, "")) continue;
    out.push(t);
  }
  return out;
}

/** 在複本裡把選取的頭尾標記拆成獨立的文字節點（方便當範圍的邊界）。 */
function isolateMarkers(root: Node): { a: Text | null; b: Text | null } {
  const doc = root.ownerDocument!;
  const found: { a: Text | null; b: Text | null } = { a: null, b: null };
  for (const m of [SEL_A, SEL_B]) {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const t = walker.currentNode as Text;
      const i = t.data.indexOf(m);
      if (i < 0) continue;
      const rest = t.splitText(i); // rest 以標記開頭
      if (rest.data.length > 1) rest.splitText(1);
      if (m === SEL_A) found.a = rest;
      else found.b = rest;
      break;
    }
  }
  return found;
}

function hasFormat(root: Node, node: Node, spec: FormatSpec): boolean {
  for (let n: Node | null = node.parentNode; n && n !== root; n = n.parentNode) {
    if (n.nodeType !== Node.ELEMENT_NODE || !matches(n as Element, spec)) continue;
    if ((spec.tag === "span" || spec.tag === "mark") && colorClass(n as Element) !== spec.color) return false;
    return true;
  }
  return false;
}

/** 帶著選取標記轉成 Markdown，回傳內容與選取位置。 */
function serializeMarked(node: HTMLElement, env: Record<string, unknown>): { content: string; a: number; b: number } {
  tidy(node);
  let o: SerOptions = { html: false };
  let marked = escapeLineStarts(serializeChildren(node, o));
  if (signature(htmlToNode(contentHtml(marked.replace(MARKERS, ""), env))) !== signature(node)) {
    o = { html: true };
    marked = escapeLineStarts(serializeChildren(node, o));
  }
  const ia = marked.indexOf(SEL_A);
  const ib = marked.indexOf(SEL_B);
  const content = marked.replace(MARKERS, "");
  const a = ia < 0 ? content.length : ia;
  const b = ib < 0 ? a : ib - (ia >= 0 && ia < ib ? 1 : 0);
  return { content, a: Math.min(a, b), b: Math.max(a, b) };
}

/**
 * 對選取的文字切換格式，以畫面上看得到的字為準（不受 Markdown 記號位置影響）。
 * mode：toggle（全部都有就拿掉，否則全部加上）、on、off。
 * 回傳新的行內內容與選取位置；沒有選取或選取裡沒有字時回傳 null。
 */
export function formatSelection(
  root: HTMLElement,
  spec: FormatSpec,
  mode: "toggle" | "on" | "off",
  env: Record<string, unknown> = {},
): { content: string; a: number; b: number } | null {
  const sel = root.ownerDocument.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
  const clone = markSelection(root);
  if (!clone) return null;
  const { a, b } = isolateMarkers(clone);
  if (!a || !b) return null;
  const segs = textSegments(clone, a, b);
  if (!segs.length) return null;
  // 空白上的格式看不出來，判斷「是不是全部都有」時不算
  const solid = segs.filter((t) => t.data.replace(/[\s\u200B\uE000\uE001]/g, ""));
  const all = (solid.length ? solid : segs).every((t) => hasFormat(clone, t, spec));
  const on = mode === "toggle" ? !all : mode === "on";
  if (on && (spec.tag === "span" || spec.tag === "mark") && !spec.color) return null;
  // 由後往前處理，前面的節點不受影響
  for (const t of [...segs].reverse()) {
    if (!t.isConnected && !clone.contains(t)) continue;
    if (hasFormat(clone, t, spec) === on && !(on && (spec.tag === "span" || spec.tag === "mark"))) continue;
    forceFormat(clone, [t, 0], [t, t.data.length], spec, on);
  }
  return serializeMarked(clone, env);
}

/** 選取範圍（含沒有選取）的格式：選取裡每個字都有的格式才算。 */
export function selectionMarks(root: HTMLElement): Marks | null {
  const sel = root.ownerDocument.getSelection();
  if (!sel || !sel.rangeCount) return null;
  if (sel.isCollapsed) return domMarks(root);
  const r = sel.getRangeAt(0);
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const segs: Text[] = [];
  while (walker.nextNode()) {
    const t = walker.currentNode as Text;
    if (!r.intersectsNode(t)) continue;
    // 只碰到邊界、沒有選到任何字的節點不算
    const start = t === r.startContainer ? r.startOffset : 0;
    const end = t === r.endContainer ? r.endOffset : t.data.length;
    if (!t.data.slice(start, end).replace(/[\u200B]/g, "")) continue;
    segs.push(t);
  }
  if (!segs.length) return domMarks(root);
  const each = segs.map((t) => {
    const m: Marks = { bold: false, italic: false, strike: false, underline: false, code: false, link: false, color: null, highlight: null };
    for (let n: Node | null = t.parentNode; n && n !== root; n = n.parentNode) {
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      const key = formatKey(n as Element);
      if (!key) continue;
      if (key === "b") m.bold = true;
      else if (key === "i") m.italic = true;
      else if (key === "u") m.underline = true;
      else if (key === "s") m.strike = true;
      else if (key === "code") m.code = true;
      else if (key.startsWith("a:")) m.link = true;
      else if (key.startsWith("span:") && !m.color) m.color = key.slice(5) as Color;
      else if (key.startsWith("mark:") && !m.highlight) m.highlight = key.slice(5) as Color;
    }
    return m;
  });
  const first = each[0];
  return {
    bold: each.every((m) => m.bold),
    italic: each.every((m) => m.italic),
    strike: each.every((m) => m.strike),
    underline: each.every((m) => m.underline),
    code: each.every((m) => m.code),
    link: each.every((m) => m.link),
    color: each.every((m) => m.color === first.color) ? first.color : null,
    highlight: each.every((m) => m.highlight === first.highlight) ? first.highlight : null,
  };
}
