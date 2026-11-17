import {
  buildTree,
  locate,
  openTag,
  parseDoc,
  type Container,
  type ParsedDoc,
  type TreeNode,
  type Unit,
} from "./markdown";

/**
 * 版面操作：縮排、多欄、搬移、刪除。
 *
 * 一律以「行」為單位修改原始碼，區塊內容一字不動；改完後用 normalize()
 * 清掉空的容器、只剩一欄的多欄。
 */

export interface Range {
  start: number;
  end: number;
}

const isBlank = (line: string | undefined) => line !== undefined && /^[ \t]*$/.test(line);

// ─── 可追蹤行號的行陣列 ─────────────────────────────────────────

/** 一組行；記住每行原本的行號，插入、刪除後仍能把舊行號換成新行號。 */
export class LineBuf {
  lines: string[];
  /** 每行的識別碼：原本的行用原行號，新插入的行用遞增的新號碼 */
  ids: number[];
  private readonly size: number;
  private next: number;

  constructor(source: string) {
    this.lines = source === "" ? [] : source.split("\n");
    this.ids = this.lines.map((_, i) => i);
    this.size = this.lines.length;
    this.next = this.size;
  }

  splice(at: number, remove: number, ...insert: string[]) {
    this.lines.splice(at, remove, ...insert);
    this.ids.splice(at, remove, ...insert.map(() => this.next++));
  }

  /** 原本第 old 行現在在哪；那行被刪掉時回傳它後面第一個留下來的原有行。 */
  map(old: number): number {
    for (let i = 0; i < this.ids.length; i++) {
      if (this.ids[i] < this.size && this.ids[i] >= old) return i;
    }
    return this.lines.length;
  }

  /** 原本的範圍 [start, end) 現在的位置（範圍內的行沒有被刪）。 */
  mapRange(r: Range): Range {
    const start = this.map(r.start);
    return { start, end: start + (r.end - r.start) };
  }

  indexOfId(id: number): number {
    return this.ids.indexOf(id);
  }

  get source(): string {
    if (this.lines.length === 1 && this.lines[0] === "") return "";
    return this.lines.join("\n");
  }
}

/** 移除第 at 行附近多出來的空白行（刪掉區塊後兩個分隔空行會相鄰）。 */
export function collapse(buf: LineBuf, at: number): number {
  const lines = buf.lines;
  while (at > 0 && isBlank(lines[at - 1]) && (at >= lines.length || isBlank(lines[at]))) {
    // 文件結尾保留一個換行
    if (at >= lines.length && at - 1 === 0) break;
    if (at >= lines.length && lines.length >= 2 && !isBlank(lines[at - 2])) break;
    buf.splice(at - 1, 1);
    at--;
  }
  // 文件開頭的空白行沒有意義
  if (at === 0) while (lines.length > 1 && isBlank(lines[0])) buf.splice(0, 1);
  return at;
}

/** 在第 at 行插入一段區塊，必要時補上分隔空行；回傳區塊第一行的位置。 */
export function insertBlock(buf: LineBuf, at: number, text: string[], tight: boolean): number {
  if (tight) {
    buf.splice(at, 0, ...text);
    return at;
  }
  const insert = [...text];
  let line = at;
  if (at < buf.lines.length && !isBlank(buf.lines[at])) insert.push("");
  if (at > 0 && !isBlank(buf.lines[at - 1])) {
    insert.unshift("");
    line++;
  }
  buf.splice(at, 0, ...insert);
  return line;
}

/** 刪除一段行並收掉多餘空行。 */
function cut(buf: LineBuf, r: Range): string[] {
  const text = buf.lines.slice(r.start, r.end);
  buf.splice(r.start, r.end - r.start);
  collapse(buf, r.start);
  return text;
}

// ─── 清理 ───────────────────────────────────────────────────────

function hasContent(c: Container): boolean {
  return c.children.some((n) => n.type === "leaf" || hasContent(n));
}

/** 拿掉容器的開頭與結尾標籤（連同內側的空行），保留內容。 */
function unwrapLines(c: Container): number[] {
  return [c.open.start, c.open.start + 1, c.close.start - 1, c.close.start];
}

/**
 * 找出第一個需要清理的地方，回傳要刪掉的行。
 * keep：這些行雖然是空白，但正在編輯，所在的容器不能當成空的刪掉。
 */
function findFix(nodes: TreeNode[], keep: number[], parent: Container | null, inIndent: boolean): number[] | null {
  for (const n of nodes) {
    if (n.type !== "container") continue;
    const kept = keep.some((l) => l > n.open.start && l < n.close.start);
    // 空容器：整段刪掉
    if (!hasContent(n) && !kept) {
      const out: number[] = [];
      for (let l = n.open.start; l < n.close.end; l++) out.push(l);
      return out;
    }
    if (n.kind === "columns") {
      const cols = n.children.filter((c): c is Container => c.type === "container" && c.kind === "column");
      // 只剩一欄：多欄與那一欄的標籤都拿掉
      if (cols.length <= 1) return [...unwrapLines(n), ...(cols[0] ? unwrapLines(cols[0]) : [])];
    }
    // 欄位不在多欄裡：拿掉標籤
    if (n.kind === "column" && parent?.kind !== "columns") return unwrapLines(n);
    // 縮排只有一層：縮排裡的縮排拿掉標籤
    if (n.kind === "indent" && inIndent) return unwrapLines(n);
    const inner = findFix(n.children, keep, n, inIndent || n.kind === "indent");
    if (inner) return inner;
  }
  return null;
}

/**
 * 清掉空的容器、只剩一欄的多欄、第二層以上的縮排，直到沒有可清的。
 * keepIds：正在編輯的空白行（LineBuf 的行識別碼），不要因為它們是空的就刪掉所在容器。
 */
export function normalize(buf: LineBuf, keepIds: number[] = []): void {
  for (let guard = 0; guard < 200; guard++) {
    const doc = parseDoc(buf.source);
    const keep = keepIds.map((id) => buf.indexOfId(id)).filter((l) => l >= 0);
    const fix = findFix(doc.tree, keep, null, false);
    if (!fix) return;
    // 只刪空白行或標籤行，避免誤刪內容；也不刪正在編輯的行
    const rows = [...new Set(fix)]
      .filter((l) => l >= 0 && l < buf.lines.length && !keep.includes(l))
      .filter((l) => isBlank(buf.lines[l]) || doc.units.some((u) => u.tag && u.start === l))
      .sort((a, b) => b - a);
    if (!rows.length) return;
    for (const l of rows) buf.splice(l, 1);
    collapse(buf, Math.min(rows[rows.length - 1], buf.lines.length));
  }
}

// ─── 查詢 ───────────────────────────────────────────────────────

/** 把編輯區（可能是還沒成為區塊的空白行）放進樹裡，回傳樹與它的位置。 */
export function treeWith(doc: ParsedDoc, r: Range): { tree: TreeNode[]; self: Unit } {
  const overlapping = doc.units.filter((u) => u.start < r.end && u.end > r.start && !u.tag);
  const self: Unit = overlapping[0]
    ? { ...overlapping[0], start: r.start, end: r.end }
    : { kind: "paragraph", start: r.start, end: r.end, html: "" };
  const units = doc.units.filter((u) => !(u.start < r.end && u.end > r.start) || u.tag);
  units.push(self);
  units.sort((a, b) => a.start - b.start);
  return { tree: buildTree(units), self };
}

/** 區塊的直接父容器。 */
export function parentOf(doc: ParsedDoc, r: Range): Container | null {
  const { tree } = treeWith(doc, r);
  const at = locate(tree, r.start);
  return at?.ancestors[at.ancestors.length - 1] ?? null;
}

/** 區塊是不是在縮排裡（也就是某個區塊的子區塊）。 */
export function isIndented(doc: ParsedDoc, r: Range): boolean {
  const { tree } = treeWith(doc, r);
  return !!locate(tree, r.start)?.ancestors.some((a) => a.kind === "indent");
}

export function canOutdent(doc: ParsedDoc, r: Range): boolean {
  return parentOf(doc, r)?.kind === "indent";
}

/** 可以增加縮排：不在縮排裡、上方有可以當父區塊的區塊。 */
export function canIndent(doc: ParsedDoc, r: Range): boolean {
  const { tree } = treeWith(doc, r);
  const at = locate(tree, r.start);
  if (!at || at.ancestors.some((a) => a.kind === "indent")) return false;
  const prev = at.siblings[at.index - 1];
  if (!prev) return false;
  if (prev.type === "container") return prev.kind === "indent";
  return !prev.unit.tag;
}

/** 區塊的子區塊：緊接在它後面的縮排區。 */
function childrenOf(doc: ParsedDoc, r: Range): Container | null {
  const { tree } = treeWith(doc, r);
  const at = locate(tree, r.start);
  const next = at?.siblings[at.index + 1];
  return next?.type === "container" && next.kind === "indent" ? next : null;
}

/** 區塊連同它的子區塊所佔的行範圍（搬移、刪除、複製都以此為單位）。 */
export function groupOf(doc: ParsedDoc, r: Range): Range {
  const kids = childrenOf(doc, r);
  return kids ? { start: r.start, end: kids.close.end } : { start: r.start, end: r.end };
}

/** 清單項目當作整份清單（欄位與縮排只能包整份清單）。 */
function wholeBlock(doc: ParsedDoc, r: Range): Range {
  const u = doc.units.find((x) => x.start === r.start);
  if (!u?.list) return r;
  const items = doc.units.filter((x) => x.list?.listStart === u.list!.listStart);
  return { start: items[0].start, end: items[items.length - 1].end };
}

// ─── 縮排 ───────────────────────────────────────────────────────

export interface Moved {
  source: string;
  /** 區塊搬移後第一行的位置 */
  start: number;
}

/**
 * 增加縮排：成為上方區塊的子區塊（併入上方區塊的子區塊，或包一層 `<div class="indent">`）。
 * 縮排只有一層：已經縮排的區塊不能再縮；區塊自己的子區塊一起移進來，變成同層。
 */
export function indentBlock(source: string, r: Range): Moved | null {
  const doc = parseDoc(source);
  if (!canIndent(doc, r)) return null;

  // 自己有子區塊：先拿掉子區塊的縮排標籤，連同子區塊一起縮排
  const kids = childrenOf(doc, r);
  if (kids) {
    const buf = new LineBuf(source);
    const lastLeaf = Math.max(...kids.children.map((c) => (c.type === "leaf" ? c.unit.end : c.close.end)));
    const rows = unwrapLines(kids)
      .filter((l) => isBlank(buf.lines[l]) || l === kids.open.start || l === kids.close.start)
      .sort((a, b) => b - a);
    for (const l of rows) buf.splice(l, 1);
    const end = buf.map(lastLeaf - 1) + 1;
    return indentBlock(buf.source, { start: r.start, end });
  }

  const { tree } = treeWith(doc, r);
  const at = locate(tree, r.start)!;
  const buf = new LineBuf(source);
  const keep = buf.ids.slice(r.start, r.end);
  const prev = at.siblings[at.index - 1];
  let line: number;

  if (prev?.type === "container" && prev.kind === "indent") {
    const text = cut(buf, r);
    line = insertBlock(buf, buf.map(prev.close.start), text, false);
    keep.splice(0, keep.length, ...buf.ids.slice(line, line + text.length));
  } else {
    const text = buf.lines.slice(r.start, r.end);
    const wrapped = [openTag("indent"), "", ...text, "", "</div>"];
    let offset = 2;
    if (r.start > 0 && !isBlank(buf.lines[r.start - 1])) {
      wrapped.unshift("");
      offset++;
    }
    if (r.end < buf.lines.length && !isBlank(buf.lines[r.end])) wrapped.push("");
    buf.splice(r.start, r.end - r.start, ...wrapped);
    line = r.start + offset;
    keep.splice(0, keep.length, ...buf.ids.slice(line, line + text.length));
  }
  const id = buf.ids[line];
  normalize(buf, keep);
  return { source: buf.source, start: buf.indexOfId(id) };
}

/**
 * 減少縮排：把區塊移到縮排區外面，接在父區塊（與前面的兄弟）後面；
 * 原本在它下面的兄弟區塊變成它的子區塊。
 */
export function outdentBlock(source: string, r: Range): Moved | null {
  const doc = parseDoc(source);
  const { tree } = treeWith(doc, r);
  const at = locate(tree, r.start);
  const parent = at?.ancestors[at.ancestors.length - 1];
  if (!at || parent?.kind !== "indent") return null;
  const buf = new LineBuf(source);
  const keep = buf.ids.slice(r.start, r.end);
  const text = buf.lines.slice(r.start, r.end);
  buf.splice(r.start, r.end - r.start, "</div>", "", ...text, "", doc.lines[parent.open.start]);
  const id = buf.ids[r.start + 2];
  const kept = buf.ids.slice(r.start + 2, r.start + 2 + text.length);
  normalize(buf, keep.length ? kept : []);
  return { source: buf.source, start: buf.indexOfId(id) };
}

// ─── 搬移與多欄 ─────────────────────────────────────────────────

export type DropPos = "before" | "after" | "left" | "right";

const inside = (r: Range, line: number) => line >= r.start && line < r.end;

/**
 * 能不能把 x 放到 target 旁邊：不能放進自己的子區塊裡；
 * 有子區塊的區塊不能放進縮排裡（縮排只有一層）。
 */
export function canDrop(doc: ParsedDoc, x: Range, target: Range): boolean {
  if (inside(groupOf(doc, x), target.start)) return false;
  return !(childrenOf(doc, x) && isIndented(doc, target));
}

/** 把區塊 x（連同子區塊）搬到 target 的前面或後面（target 為 null 表示文件最後）。 */
export function moveBlock(source: string, x: Unit, target: Unit | null, pos: "before" | "after" = "before"): string {
  if (target && target.start === x.start) return source;
  const doc = parseDoc(source);
  if (target && !canDrop(doc, x, target)) return source;
  const group = groupOf(doc, x);
  // 放在有子區塊的區塊後面時，放到子區塊之後
  const dest = target && pos === "after" ? groupOf(doc, target) : target;
  const buf = new LineBuf(source);
  const text = cut(buf, group);
  if (!target || !dest) {
    let end = buf.lines.length;
    while (end > 0 && isBlank(buf.lines[end - 1])) end--;
    buf.splice(end, 0, ...(end > 0 ? [""] : []), ...text);
  } else {
    const t = { start: buf.map(dest.start), end: buf.map(dest.end - 1) + 1 };
    insertBlock(buf, pos === "before" ? t.start : t.end, text, x.kind === "item" && target.kind === "item");
  }
  normalize(buf);
  return buf.source;
}

const column = (text: string[]) => [openTag("column"), "", ...text, "", "</div>"];

/** 把區塊 x（連同子區塊）放到 target 的左邊或右邊，形成多欄（或在既有的多欄中加一欄）。 */
export function placeBeside(source: string, x: Unit, target: Unit, side: "left" | "right"): string {
  if (target.start === x.start) return source;
  const doc = parseDoc(source);
  if (inside(groupOf(doc, x), target.start)) return source;
  const group = groupOf(doc, x);
  const buf = new LineBuf(source);
  const text = cut(buf, group);
  const mid = parseDoc(buf.source);
  const tStart = buf.map(target.start);
  const whole = wholeBlock(mid, { start: tStart, end: tStart + (target.end - target.start) });
  const t = groupOf(mid, whole);
  const parent = parentOf(mid, whole);

  if (parent?.kind === "column") {
    if (side === "right") buf.splice(parent.close.start + 1, 0, "", ...column(text));
    else buf.splice(parent.open.start, 0, ...column(text), "");
  } else {
    const own = buf.lines.slice(t.start, t.end);
    const cols = side === "right" ? [column(own), column(text)] : [column(text), column(own)];
    const block = [openTag("columns"), "", ...cols[0], "", ...cols[1], "", "</div>"];
    if (t.end < buf.lines.length && !isBlank(buf.lines[t.end])) block.push("");
    if (t.start > 0 && !isBlank(buf.lines[t.start - 1])) block.unshift("");
    buf.splice(t.start, t.end - t.start, ...block);
  }
  normalize(buf);
  return buf.source;
}

/** 刪除區塊並清理容器。 */
export function deleteBlock(source: string, x: Range): string {
  const buf = new LineBuf(source);
  cut(buf, x);
  normalize(buf);
  return buf.source;
}

/** 改寫欄位寬度（只動欄位的開頭標籤行）。 */
export function setColumnWidths(source: string, widths: { line: number; width: number }[]): string {
  const lines = source.split("\n");
  for (const { line, width } of widths) {
    if (/^<div class="column"/.test(lines[line] ?? "")) lines[line] = openTag("column", width);
  }
  return lines.join("\n");
}
