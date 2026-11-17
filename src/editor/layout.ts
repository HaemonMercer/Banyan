import {
  buildTree,
  leaves,
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

/**
 * 區塊在樹中的位置。區塊單獨包在背景色容器（`<div class="bg-…">`）裡時，
 * 背景色容器算是區塊的一部分：兄弟、父容器、所佔的行都以背景色容器為準。
 */
interface Slot {
  siblings: TreeNode[];
  index: number;
  /** 由外到內的父容器（不含區塊自己的背景色、對齊容器） */
  ancestors: Container[];
  /** 區塊自己的外層容器（背景色、對齊，由內到外），最外層的是 wrapper */
  wrappers: Container[];
  wrapper: Container | null;
  /** 區塊（連同背景色、對齊容器）所佔的行 */
  range: Range;
}

/** 單獨包住一個區塊時算是區塊一部分的容器 */
const OWN_WRAPPERS = new Set(["bg", "align", "cap", "size"]);

function slot(doc: ParsedDoc, r: Range): Slot | null {
  const { tree } = treeWith(doc, r);
  const at = locate(tree, r.start);
  if (!at) return null;
  let { siblings, index, ancestors } = at;
  const wrappers: Container[] = [];
  for (;;) {
    const parent = ancestors[ancestors.length - 1];
    if (!parent || !OWN_WRAPPERS.has(parent.kind) || parent.children.length !== 1) break;
    wrappers.push(parent);
    ancestors = ancestors.slice(0, -1);
    siblings = ancestors.length ? ancestors[ancestors.length - 1].children : tree;
    index = siblings.indexOf(parent);
  }
  const wrapper = wrappers[wrappers.length - 1] ?? null;
  const range = wrapper ? { start: wrapper.open.start, end: wrapper.close.end } : { start: r.start, end: r.end };
  return { siblings, index, ancestors, wrappers, wrapper, range };
}

/** 區塊的直接父容器（不含它自己的背景色容器）。 */
export function parentOf(doc: ParsedDoc, r: Range): Container | null {
  const s = slot(doc, r);
  return s?.ancestors[s.ancestors.length - 1] ?? null;
}

/** 區塊是不是在縮排裡（也就是某個區塊的子區塊）。 */
export function isIndented(doc: ParsedDoc, r: Range): boolean {
  return !!slot(doc, r)?.ancestors.some((a) => a.kind === "indent");
}

export function canOutdent(doc: ParsedDoc, r: Range): boolean {
  return parentOf(doc, r)?.kind === "indent";
}

/** 可以增加縮排：不在縮排裡、上方有可以當父區塊的區塊。 */
export function canIndent(doc: ParsedDoc, r: Range): boolean {
  const s = slot(doc, r);
  if (!s || s.ancestors.some((a) => a.kind === "indent")) return false;
  const prev = s.siblings[s.index - 1];
  if (!prev) return false;
  if (prev.type === "container") return prev.kind === "indent" || prev.kind === "bg";
  return !prev.unit.tag;
}

/** 區塊的子區塊：緊接在它（或它的背景色容器）後面的縮排區。 */
function childrenOf(doc: ParsedDoc, r: Range): Container | null {
  const s = slot(doc, r);
  const next = s?.siblings[s.index + 1];
  return next?.type === "container" && next.kind === "indent" ? next : null;
}

/** 區塊連同背景色與子區塊所佔的行範圍（搬移、刪除、複製都以此為單位）。 */
export function groupOf(doc: ParsedDoc, r: Range): Range {
  const s = slot(doc, r);
  const base = s?.range ?? { start: r.start, end: r.end };
  const kids = childrenOf(doc, r);
  return kids ? { start: base.start, end: kids.close.end } : base;
}

/** 區塊的背景顏色（沒有就是 null）。 */
export function blockBg(doc: ParsedDoc, r: Range): string | null {
  return slot(doc, wholeBlock(doc, r))?.wrappers.find((w) => w.kind === "bg")?.color ?? null;
}

export type Align = "left" | "center" | "right";

/** 區塊的對齊方式（沒有對齊容器就是靠左）。 */
export function blockAlign(doc: ParsedDoc, r: Range): Align {
  return (slot(doc, wholeBlock(doc, r))?.wrappers.find((w) => w.kind === "align")?.color as Align) ?? "left";
}

export type CaptionPos = "top" | "bottom";

/** 圖說的位置（沒有 caption-top 容器就是在下方）。 */
export function captionPos(doc: ParsedDoc, r: Range): CaptionPos {
  return slot(doc, wholeBlock(doc, r))?.wrappers.some((w) => w.kind === "cap") ? "top" : "bottom";
}

export type MediaSize = "25" | "50" | "75" | "100";

/** 圖片、影片的寬度（null 是原始大小）。 */
export function blockSize(doc: ParsedDoc, r: Range): MediaSize | null {
  return (slot(doc, wholeBlock(doc, r))?.wrappers.find((w) => w.kind === "size")?.color as MediaSize) ?? null;
}

/** 清單項目當作整份清單（欄位、縮排、背景色只能包整份清單）。 */
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
  const s = slot(doc, r)!;

  // 自己有子區塊：先拿掉子區塊的縮排標籤，連同子區塊一起縮排
  const kids = childrenOf(doc, r);
  if (kids) {
    if (s.wrapper) return null; // 有背景色又有子區塊：先不處理
    const buf = new LineBuf(source);
    const lastLeaf = Math.max(...kids.children.map((c) => (c.type === "leaf" ? c.unit.end : c.close.end)));
    const rows = unwrapLines(kids)
      .filter((l) => isBlank(buf.lines[l]) || l === kids.open.start || l === kids.close.start)
      .sort((a, b) => b - a);
    for (const l of rows) buf.splice(l, 1);
    const end = buf.map(lastLeaf - 1) + 1;
    return indentBlock(buf.source, { start: r.start, end });
  }

  const R = s.range;
  const offsetInBlock = r.start - R.start;
  const buf = new LineBuf(source);
  const prev = s.siblings[s.index - 1];
  let line: number;
  let count: number;

  if (prev?.type === "container" && prev.kind === "indent") {
    const text = cut(buf, R);
    count = text.length;
    line = insertBlock(buf, buf.map(prev.close.start), text, false);
  } else {
    const text = buf.lines.slice(R.start, R.end);
    count = text.length;
    const wrapped = [openTag("indent"), "", ...text, "", "</div>"];
    let offset = 2;
    if (R.start > 0 && !isBlank(buf.lines[R.start - 1])) {
      wrapped.unshift("");
      offset++;
    }
    if (R.end < buf.lines.length && !isBlank(buf.lines[R.end])) wrapped.push("");
    buf.splice(R.start, R.end - R.start, ...wrapped);
    line = R.start + offset;
  }
  const keep = buf.ids.slice(line, line + count);
  const id = buf.ids[line + offsetInBlock];
  normalize(buf, keep);
  return { source: buf.source, start: buf.indexOfId(id) };
}

/**
 * 減少縮排：把區塊移到縮排區外面，接在父區塊（與前面的兄弟）後面；
 * 原本在它下面的兄弟區塊變成它的子區塊。
 */
export function outdentBlock(source: string, r: Range): Moved | null {
  const doc = parseDoc(source);
  const s = slot(doc, r);
  const parent = s?.ancestors[s.ancestors.length - 1];
  if (!s || parent?.kind !== "indent") return null;
  const R = s.range;
  const buf = new LineBuf(source);
  const text = buf.lines.slice(R.start, R.end);
  buf.splice(R.start, R.end - R.start, "</div>", "", ...text, "", doc.lines[parent.open.start]);
  const id = buf.ids[R.start + 2 + (r.start - R.start)];
  const kept = buf.ids.slice(R.start + 2, R.start + 2 + text.length);
  normalize(buf, kept);
  return { source: buf.source, start: buf.indexOfId(id) };
}

// ─── 背景顏色 ───────────────────────────────────────────────────

/**
 * 設定區塊的外層容器（背景色、對齊）：value 為 null 表示拿掉。
 * 已經有這種容器就只改標籤；沒有就在區塊（連同它現有的外層容器）外面再包一層。
 * 清單項目會套用到整份清單。回傳區塊第一行的新位置。
 */
function setWrapper(source: string, r: Range, kind: "bg" | "align" | "cap" | "size", value: string | null): Moved {
  const doc = parseDoc(source);
  const whole = wholeBlock(doc, r);
  const s = slot(doc, whole);
  const buf = new LineBuf(source);
  const id = buf.ids[r.start];
  const own = s?.wrappers.find((w) => w.kind === kind);
  if (own) {
    if (value) buf.lines[own.open.start] = openTag(kind, undefined, value);
    else {
      const rows = unwrapLines(own)
        .filter((l) => isBlank(buf.lines[l]) || l === own.open.start || l === own.close.start)
        .sort((a, b) => b - a);
      for (const l of rows) buf.splice(l, 1);
    }
  } else if (value) {
    // 只在前後插入標籤行，不動區塊本身的行
    const R = s?.range ?? whole;
    const after = R.end < buf.lines.length && !isBlank(buf.lines[R.end]) ? [""] : [];
    buf.splice(R.end, 0, "", "</div>", ...after);
    const before = R.start > 0 && !isBlank(buf.lines[R.start - 1]) ? [""] : [];
    buf.splice(R.start, 0, ...before, openTag(kind, undefined, value), "");
  }
  normalize(buf);
  return { source: buf.source, start: buf.indexOfId(id) };
}

/**
 * 設定區塊的背景顏色（color 為 null 表示拿掉）：包一層 `<div class="bg-顏色">`，
 * 已經有背景色就只改標籤。清單項目會套用到整份清單。回傳區塊第一行的新位置。
 */
export function setBlockBg(source: string, r: Range, color: string | null): Moved {
  return setWrapper(source, r, "bg", color);
}

/** 設定區塊的對齊（靠左就是拿掉對齊容器）：`<div class="align-center">`。 */
export function setBlockAlign(source: string, r: Range, align: Align): Moved {
  return setWrapper(source, r, "align", align === "left" ? null : align);
}

/** 設定圖說位置（下方就是拿掉容器）：`<div class="caption-top">`。 */
export function setCaptionPos(source: string, r: Range, pos: CaptionPos): Moved {
  return setWrapper(source, r, "cap", pos === "top" ? "top" : null);
}

/** 設定圖片、影片的寬度（null 是原始大小，拿掉容器）：`<div class="width-50">`。 */
export function setBlockSize(source: string, r: Range, size: MediaSize | null): Moved {
  return setWrapper(source, r, "size", size);
}

/** 多個區塊一起設定背景顏色（由後往前做，前面的行號不受影響）。 */
export function setBlocksBg(source: string, units: Range[], color: string | null): MovedMany {
  let doc = parseDoc(source);
  const xs = topLevel(doc, units).filter((x) => !x.whole);
  const texts = xs.map((x) => doc.lines.slice(x.start, x.end).join("\n"));
  let out = source;
  for (const x of [...xs].reverse()) {
    doc = parseDoc(out);
    const cur = doc.blocks.find((b) => b.start === x.start) ?? x;
    out = setBlockBg(out, cur, color).source;
  }
  return { source: out, starts: reselect(out, texts) };
}

// ─── 搬移與多欄 ─────────────────────────────────────────────────

export type DropPos = "before" | "after" | "left" | "right";

const inside = (r: Range, line: number) => line >= r.start && line < r.end;

/**
 * 能不能把 x 放到 target 旁邊：不能放進自己的子區塊裡；
 * 有子區塊的區塊不能放進縮排裡（縮排只有一層）。
 */
export function canDrop(doc: ParsedDoc, x: Range, target: Range): boolean {
  if (inside(rangeOf(doc, x), target.start)) return false;
  // 整組多欄不能放進欄位裡（不做巢狀多欄）
  if ((x as Picked).whole) return !inColumn(doc, target);
  return !(childrenOf(doc, x) && isIndented(doc, target));
}

function inColumn(doc: ParsedDoc, r: Range): boolean {
  const { tree } = treeWith(doc, r);
  return !!locate(tree, r.start)?.ancestors.some((a) => a.kind === "column");
}

/**
 * 選取的單位。一般是一個區塊（連同子區塊）；
 * 多欄裡的區塊全部被選取時，整組多欄當成一個單位（whole），搬移時排版不會被拆開。
 */
export interface Picked extends Unit {
  whole?: "columns";
}

/** 單位所佔的行範圍：整組多欄是標籤到標籤，一般區塊是區塊連同子區塊。 */
export function rangeOf(doc: ParsedDoc, x: Range): Range {
  return (x as Picked).whole ? { start: x.start, end: x.end } : groupOf(doc, x);
}

// ─── 多個區塊 ───────────────────────────────────────────────────

/** 依文件順序排好，並拿掉「已經是其他選取區塊的子區塊」的區塊（它們會跟著父區塊走）。 */
export function topLevel(doc: ParsedDoc, units: Range[]): Picked[] {
  const starts = new Set(units.map((u) => u.start));
  // 傳進來的已經是整組多欄：展開成裡面的區塊，下面再組回來
  for (const u of units as Picked[]) {
    if (u.whole) for (const b of doc.blocks) if (inside(u, b.start)) starts.add(b.start);
  }
  // 裡面每個區塊都被選取的多欄：整組當成一個單位
  const wholes: Picked[] = [];
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (n.type !== "container") continue;
      const inner = leaves(n.children);
      if (n.kind === "columns" && inner.length && inner.every((u) => starts.has(u.start))) {
        wholes.push({ kind: "html", start: n.open.start, end: n.close.end, html: "", whole: "columns" });
      } else {
        walk(n.children);
      }
    }
  };
  walk(doc.tree);
  const inWhole = (line: number) => wholes.some((w) => inside(w, line));
  const picked: Picked[] = [...doc.blocks.filter((b) => starts.has(b.start) && !inWhole(b.start)), ...wholes].sort(
    (a, b) => a.start - b.start,
  );
  const groups = picked.map((b) => rangeOf(doc, b));
  return picked.filter((b, i) => !groups.some((g, j) => j !== i && inside(g, b.start)));
}

/** 一段行範圍裡所有看得到的區塊（搬移、複製後重新選取用）。 */
function blocksIn(buf: LineBuf, firstId: number, lastId: number): number[] {
  const a = buf.indexOfId(firstId);
  const b = buf.indexOfId(lastId);
  if (a < 0 || b < 0) return [];
  return parseDoc(buf.source)
    .blocks.filter((u) => u.start >= a && u.start <= b)
    .map((u) => u.start);
}

/**
 * 相鄰兩個區塊之間要不要空行：同一份清單裡原本緊接著的項目不空行（保持緊湊清單），
 * 其他都空一行。回傳 pairs[i] 表示第 i-1 與第 i 個之間是否緊接。
 */
function tightPairs(doc: ParsedDoc, xs: Unit[]): boolean[] {
  return xs.map((x, i) => {
    const prev = xs[i - 1];
    return (
      !!prev &&
      !!prev.list &&
      !!x.list &&
      prev.list.listStart === x.list.listStart &&
      rangeOf(doc, prev).end === x.start
    );
  });
}

/** 被選取的區塊（連同子區塊）的 Markdown，用來複製到剪貼簿。 */
export function blocksMarkdown(source: string, units: Range[]): string {
  const doc = parseDoc(source);
  const xs = topLevel(doc, units);
  const texts = xs.map((u) => {
    const g = rangeOf(doc, u);
    return doc.lines.slice(g.start, g.end);
  });
  return joinTexts(texts, false, tightPairs(doc, xs)).lines.join("\n");
}

export interface MovedMany {
  source: string;
  /** 搬移後各區塊第一行的位置（供保留選取） */
  starts: number[];
}

/** 剪下多個區塊（由後往前剪，前面的行號不受影響），回傳各段文字與它們之間的接法。 */
function cutMany(
  buf: LineBuf,
  doc: ParsedDoc,
  xs: Unit[],
): { texts: string[][]; tight: boolean; pairs: boolean[] } {
  const groups = xs.map((x) => rangeOf(doc, x));
  const texts = groups.map((g) => buf.lines.slice(g.start, g.end));
  for (const g of [...groups].reverse()) cut(buf, g);
  return { texts, tight: xs.every((x) => x.kind === "item"), pairs: tightPairs(doc, xs) };
}

/** 把多段文字接成一塊；回傳接好的行與每段第一行的偏移。 */
function joinTexts(texts: string[][], tight: boolean, pairs: boolean[] = []): { lines: string[]; offsets: number[] } {
  const lines: string[] = [];
  const offsets: number[] = [];
  texts.forEach((t, i) => {
    if (i > 0 && !tight && !pairs[i]) lines.push("");
    offsets.push(lines.length);
    lines.push(...t);
  });
  return { lines, offsets };
}

/**
 * 把多個區塊（連同子區塊）依原本順序搬到 target 的前面或後面（target 為 null 表示文件最後）。
 * target 是其中一個區塊、在它們的子區塊裡、或規則不允許時，不做任何事。
 */
export function moveBlocks(
  source: string,
  units: Range[],
  target: Unit | null,
  pos: "before" | "after" = "before",
): MovedMany {
  const doc = parseDoc(source);
  const xs = topLevel(doc, units);
  const unchanged = { source, starts: xs.map((x) => x.start) };
  if (!xs.length) return unchanged;
  if (target && !xs.every((x) => x.start !== target.start && canDrop(doc, x, target))) return unchanged;
  // 放在有子區塊的區塊後面時，放到子區塊之後
  const dest = target && pos === "after" ? groupOf(doc, target) : target;
  const buf = new LineBuf(source);
  const { texts, tight, pairs } = cutMany(buf, doc, xs);
  const joined = joinTexts(texts, tight && target?.kind === "item", pairs);
  let at: number;
  if (!target || !dest) {
    let end = buf.lines.length;
    while (end > 0 && isBlank(buf.lines[end - 1])) end--;
    const lead = end > 0 ? 1 : 0;
    buf.splice(end, 0, ...(lead ? [""] : []), ...joined.lines);
    at = end + lead;
  } else {
    const t = { start: buf.map(dest.start), end: buf.map(dest.end - 1) + 1 };
    at = insertBlock(buf, pos === "before" ? t.start : t.end, joined.lines, tight && target.kind === "item");
  }
  const first = buf.ids[at];
  const last = buf.ids[at + joined.lines.length - 1];
  normalize(buf);
  return { source: buf.source, starts: blocksIn(buf, first, last) };
}

/** 把區塊 x（連同子區塊）搬到 target 的前面或後面（target 為 null 表示文件最後）。 */
export function moveBlock(source: string, x: Unit, target: Unit | null, pos: "before" | "after" = "before"): string {
  return moveBlocks(source, [x], target, pos).source;
}

const column = (text: string[]) => [openTag("column"), "", ...text, "", "</div>"];

/** 把多個區塊放到 target 的左邊或右邊，成為新的一欄（或在既有的多欄中加一欄）。 */
export function placeBesideMany(source: string, units: Range[], target: Unit, side: "left" | "right"): string {
  const doc = parseDoc(source);
  const xs = topLevel(doc, units);
  if (!xs.length || xs.some((x) => x.whole || x.start === target.start || inside(rangeOf(doc, x), target.start)))
    return source;
  const buf = new LineBuf(source);
  const { texts, tight, pairs } = cutMany(buf, doc, xs);
  const text = joinTexts(texts, tight, pairs).lines;
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

/** 把區塊 x（連同子區塊）放到 target 的左邊或右邊，形成多欄（或在既有的多欄中加一欄）。 */
export function placeBeside(source: string, x: Unit, target: Unit, side: "left" | "right"): string {
  return placeBesideMany(source, [x], target, side);
}

/** 刪除區塊並清理容器。 */
export function deleteBlock(source: string, x: Range): string {
  const buf = new LineBuf(source);
  cut(buf, x);
  normalize(buf);
  return buf.source;
}

/** 刪除多個區塊（連同子區塊）。 */
export function deleteBlocks(source: string, units: Range[]): string {
  const doc = parseDoc(source);
  const xs = topLevel(doc, units);
  if (!xs.length) return source;
  const buf = new LineBuf(source);
  cutMany(buf, doc, xs);
  normalize(buf);
  return buf.source;
}

/** 在最後一個選取區塊後面放一份所有選取區塊（連同子區塊）的副本；回傳副本的位置。 */
export function duplicateBlocks(source: string, units: Range[]): MovedMany {
  const doc = parseDoc(source);
  const xs = topLevel(doc, units);
  if (!xs.length) return { source, starts: [] };
  const groups = xs.map((x) => rangeOf(doc, x));
  const tight = xs.every((x) => x.kind === "item");
  const joined = joinTexts(
    groups.map((g) => doc.lines.slice(g.start, g.end)),
    tight,
    tightPairs(doc, xs),
  );
  const buf = new LineBuf(source);
  const last = groups[groups.length - 1];
  const at = insertBlock(buf, last.end, joined.lines, tight);
  const firstId = buf.ids[at];
  const lastId = buf.ids[at + joined.lines.length - 1];
  normalize(buf);
  return { source: buf.source, starts: blocksIn(buf, firstId, lastId) };
}

/**
 * 在選取區塊後面貼上一段 Markdown（剪貼簿內容）；回傳新區塊的位置。
 * after 為 null 時貼在文件最後。
 */
export function pasteAfter(source: string, after: Range | null, markdown: string): MovedMany {
  const text = markdown.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  if (!text.trim()) return { source, starts: [] };
  const doc = parseDoc(source);
  const buf = new LineBuf(source);
  const g = after ? rangeOf(doc, after) : null;
  let at: number;
  if (g) at = insertBlock(buf, g.end, text.split("\n"), false);
  else {
    let end = buf.lines.length;
    while (end > 0 && isBlank(buf.lines[end - 1])) end--;
    at = insertBlock(buf, end, text.split("\n"), false);
  }
  const first = buf.ids[at];
  const lastId = buf.ids[at + text.split("\n").length - 1];
  normalize(buf);
  const from = buf.indexOfId(first);
  const to = buf.indexOfId(lastId);
  const pasted = parseDoc(buf.source).blocks.filter((b) => b.start >= from && b.start <= to);
  return { source: buf.source, starts: pasted.map((b) => b.start) };
}

/** 對多個區塊依序（由後往前，前面的行號不受影響）縮排或減少縮排；不能縮的跳過。 */
export function indentBlocks(source: string, units: Range[], outdent: boolean): MovedMany {
  let doc = parseDoc(source);
  const xs = topLevel(doc, units).filter((x) => !x.whole);
  // 用內容追蹤選取：每次操作後依序找回這些區塊
  const texts = xs.map((x) => doc.lines.slice(x.start, x.end).join("\n"));
  let out = source;
  for (const x of [...xs].reverse()) {
    doc = parseDoc(out);
    const cur = doc.blocks.find((b) => b.start === x.start) ?? x;
    const res = outdent ? outdentBlock(out, cur) : indentBlock(out, cur);
    if (res) out = res.source;
  }
  return { source: out, starts: reselect(out, texts) };
}

/** 依內容依序找回區塊的位置（操作後保留選取用）。 */
export function reselect(source: string, texts: string[]): number[] {
  const doc = parseDoc(source);
  const starts: number[] = [];
  let i = 0;
  for (const b of doc.blocks) {
    if (i >= texts.length) break;
    if (doc.lines.slice(b.start, b.end).join("\n") === texts[i]) {
      starts.push(b.start);
      i++;
    }
  }
  return starts;
}

/** 改寫欄位寬度（只動欄位的開頭標籤行）。 */
export function setColumnWidths(source: string, widths: { line: number; width: number }[]): string {
  const lines = source.split("\n");
  for (const { line, width } of widths) {
    if (/^<div class="column"/.test(lines[line] ?? "")) lines[line] = openTag("column", width);
  }
  return lines.join("\n");
}

/**
 * 在編輯中的區塊裡貼上區塊：在游標處把區塊切開，貼上的區塊放在中間。
 * 游標前、後的文字各自成為區塊（空的就不留）；回傳貼上區塊的位置。
 */
export function pasteInto(source: string, region: Range, from: number, to: number, markdown: string): MovedMany {
  const buf = new LineBuf(source);
  const text = buf.lines.slice(region.start, region.end).join("\n");
  const before = text.slice(0, from).replace(/[ \t]+$/, "");
  const after = text.slice(to).replace(/^[ \t]+/, "");
  const pasted = markdown.replace(/\r\n?/g, "\n").replace(/^\n+|\n+$/g, "").split("\n");

  const out: string[] = [];
  if (before.trim()) out.push(...before.split("\n"), "");
  const offset = out.length;
  out.push(...pasted);
  if (after.trim()) out.push("", ...after.split("\n"));

  let at = region.start;
  if (at > 0 && !isBlank(buf.lines[at - 1])) {
    out.unshift("");
    at++;
  }
  if (region.end < buf.lines.length && !isBlank(buf.lines[region.end])) out.push("");
  buf.splice(region.start, region.end - region.start, ...out);
  const first = buf.ids[at + offset];
  const last = buf.ids[at + offset + pasted.length - 1];
  normalize(buf);
  const a = buf.indexOfId(first);
  const b = buf.indexOfId(last);
  const starts = parseDoc(buf.source)
    .blocks.filter((u) => u.start >= a && u.start <= b)
    .map((u) => u.start);
  return { source: buf.source, starts };
}
