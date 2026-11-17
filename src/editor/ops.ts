import { LineBuf, collapse as collapseBuf, deleteBlock, moveBlock, normalize } from "./layout";
import { parseDoc, type ParsedDoc, type Unit, type UnitKind } from "./markdown";

/**
 * 編輯操作：全部是純函式，輸入舊狀態、回傳新狀態。
 *
 * 「編輯區」(region) 是正在用 textarea 編輯的行範圍 [start, end)。
 * 所有操作只改動必要的行，其他原始碼保持逐字不變。
 */

export interface Region {
  start: number;
  end: number;
}

export interface EditorState {
  source: string;
  region: Region | null;
  /** 編輯區內的游標位置（字元偏移），套用到 textarea 後即可忽略 */
  caret: number;
}

export type BlockType =
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "bullet"
  | "ordered"
  | "quote"
  | "code"
  | "hr"
  | "image"
  | "video"
  | "table";

const isBlank = (line: string | undefined) => line !== undefined && /^[ \t]*$/.test(line);
const join = (lines: string[]) => lines.join("\n");

export function regionText(lines: string[], r: Region): string {
  return join(lines.slice(r.start, r.end));
}

function overlaps(u: Unit, r: Region) {
  return u.start < r.end && u.end > r.start;
}

/** 編輯區要涵蓋所有跟它重疊的區塊（例如打了 ``` 之後，後面的內容都變成程式碼）。 */
export function settle(doc: ParsedDoc, region: Region): Region {
  let { start, end } = region;
  for (let changed = true; changed; ) {
    changed = false;
    for (const u of doc.units) {
      if (overlaps(u, { start, end }) && (u.start < start || u.end > end)) {
        start = Math.min(start, u.start);
        end = Math.max(end, u.end);
        changed = true;
      }
    }
  }
  return { start, end };
}

/** 編輯區的區塊種類（決定 textarea 樣式與 Enter 行為）。 */
export function regionUnit(doc: ParsedDoc, r: Region): Unit | undefined {
  return doc.units.find((u) => overlaps(u, r));
}

function offsetOfLine(lines: string[], line: number) {
  let n = 0;
  for (let i = 0; i < line && i < lines.length; i++) n += lines[i].length + 1;
  return n;
}

/**
 * 空白區塊的存法。CommonMark 沒有空段落，用只有不換行空格的段落代替
 * （渲染成 `<p>&nbsp;</p>`，在任何 Markdown 軟體裡都是一個空行）。
 * 編輯時把它換成真正的空行，離開時再換回來。
 */
export const EMPTY_BLOCK = "&nbsp;";

export function isEmptyText(text: string): boolean {
  return /^\s*$/.test(text);
}

// ─── 進入／離開編輯 ───────────────────────────────────────────────

/** 舊行號 → 新行號 */
export type LineMap = (line: number) => number;
const identity: LineMap = (l) => l;

/**
 * 離開編輯區。空白的編輯區留下來成為空白區塊（存成 `&nbsp;`）；
 * 只有整份文件只剩這個空白區塊時才清掉。回傳行號對照。
 */
export function deactivate(state: EditorState): { state: EditorState; map: LineMap } {
  const { region } = state;
  const none = { state: { ...state, region: null }, map: identity };
  if (!region) return none;
  const buf = new LineBuf(state.source);
  if (!isEmptyText(regionText(buf.lines, region))) return none;
  const others = buf.lines.some((l, i) => (i < region.start || i >= region.end) && !isEmptyText(l));
  if (others) {
    // 原地改寫第一行（保留行號對照），多出來的空行刪掉
    buf.lines[region.start] = EMPTY_BLOCK;
    if (region.end - region.start > 1) buf.splice(region.start + 1, region.end - region.start - 1);
  } else {
    buf.splice(0, buf.lines.length);
  }
  normalize(buf);
  return { state: { source: buf.source, region: null, caret: 0 }, map: (l) => buf.map(l) };
}

/** 開始編輯 target（以目前的行號表示）；會先關閉舊的編輯區。 */
export function activate(state: EditorState, target: Region, caret: number | "end"): EditorState {
  const { state: s, map } = deactivate(state);
  const start = map(target.start);
  let t: Region = { start, end: start + Math.max(1, target.end - target.start) };
  const lines = s.source.split("\n");
  if (s.source === "") {
    return { source: "", region: { start: 0, end: 1 }, caret: 0 };
  }
  t = settle(parseDoc(s.source), {
    start: Math.min(t.start, lines.length - 1),
    end: Math.min(t.end, lines.length),
  });
  // 空白區塊：編輯時是真正的空行
  if (t.end - t.start === 1 && lines[t.start].trim() === EMPTY_BLOCK) {
    lines[t.start] = "";
    return { source: lines.join("\n"), region: t, caret: 0 };
  }
  const text = regionText(lines, t);
  return { source: s.source, region: t, caret: caret === "end" ? text.length : Math.min(caret, text.length) };
}

/** 用 textarea 的新內容取代編輯區，並重新涵蓋重疊的區塊。 */
export function applyText(state: EditorState, text: string, caret: number): EditorState {
  const region = state.region;
  if (!region) return state;
  const lines = state.source.split("\n");
  const abs = offsetOfLine(lines, region.start) + caret;
  const newLines = text.split("\n");
  lines.splice(region.start, region.end - region.start, ...newLines);
  const source = join(lines);
  const r = settle(parseDoc(source), { start: region.start, end: region.start + newLines.length });
  return { source, region: r, caret: abs - offsetOfLine(lines, r.start) };
}

// ─── 新增區塊 ────────────────────────────────────────────────────

const MARKER = /^(\s*)([-+*]|(\d{1,9})([.)]))([ \t]+|$)/;

function nextMarker(firstLine: string): string {
  const m = MARKER.exec(firstLine);
  if (!m) return "- ";
  const [, indent, bullet, num, delim] = m;
  return num !== undefined ? `${indent}${Number(num) + 1}${delim} ` : `${indent}${bullet} `;
}

function isLooseAt(doc: ParsedDoc, unit: Unit): boolean {
  if (!unit.list) return false;
  const lines = doc.lines;
  const next = doc.units.find((u) => u.start >= unit.end);
  return (
    isBlank(lines[unit.end]) && !!next?.list && next.list.listStart === unit.list.listStart
  );
}

/** 在第 at 行插入一個新區塊，必要時補上分隔空行。回傳新區塊所在的行。 */
function insertBlock(lines: string[], at: number, text: string[], tight: boolean): number {
  if (tight) {
    lines.splice(at, 0, ...text);
    return at;
  }
  const insert = [...text];
  let line = at;
  if (at < lines.length && !isBlank(lines[at])) insert.push("");
  if (at > 0 && !isBlank(lines[at - 1])) {
    insert.unshift("");
    line++;
  }
  lines.splice(at, 0, ...insert);
  return line;
}

/** 在 afterLine 之後新增一個空白區塊並進入編輯。 */
export function insertEmptyAfter(state: EditorState, afterLine: number, initial = ""): EditorState {
  const { state: s, map } = deactivate(state);
  const lines = s.source === "" ? [] : s.source.split("\n");
  let at = afterLine > 0 ? map(afterLine - 1) + 1 : 0;
  at = Math.min(at, lines.length);
  const line = insertBlock(lines, at, [initial], false);
  return { source: join(lines), region: { start: line, end: line + 1 }, caret: initial.length };
}

// ─── Enter / Backspace ──────────────────────────────────────────

/** Enter：切分區塊。回傳 null 表示交給 textarea 自己換行（程式碼區塊等）。 */
export function splitBlock(state: EditorState, caret: number): EditorState | null {
  const region = state.region;
  if (!region) return null;
  const doc = parseDoc(state.source);
  const lines = doc.lines.slice();
  const unit = regionUnit(doc, region);
  const kind: UnitKind = unit?.kind ?? "paragraph";
  if (kind === "code" || kind === "html" || kind === "source") return null;

  const text = regionText(lines, region);
  const before = text.slice(0, caret);
  const after = text.slice(caret);

  if (kind === "item" && unit) {
    const marker = MARKER.exec(text);
    // 空項目按 Enter：離開清單
    if (marker && text.trim() === marker[0].trim()) {
      lines.splice(region.start, region.end - region.start, "");
      let line = region.start;
      if (line > 0 && !isBlank(lines[line - 1])) {
        lines.splice(line, 0, "");
        line++;
      }
      if (line + 1 < lines.length && !isBlank(lines[line + 1])) lines.splice(line + 1, 0, "");
      return { source: join(lines), region: { start: line, end: line + 1 }, caret: 0 };
    }
    const next = nextMarker(text.split("\n")[0]);
    const beforeLines = before.split("\n");
    lines.splice(region.start, region.end - region.start, ...beforeLines);
    const at = region.start + beforeLines.length;
    const newText = next + after.replace(/^[ \t]+/, "");
    const line = insertBlock(lines, at, newText.split("\n"), !isLooseAt(doc, unit));
    return { source: join(lines), region: { start: line, end: line + newText.split("\n").length }, caret: next.length };
  }

  // 留在上面的部分是空的：成為空白區塊
  const beforeLines = isEmptyText(before) ? [EMPTY_BLOCK] : before.replace(/[ \t]+$/, "").split("\n");
  lines.splice(region.start, region.end - region.start, ...beforeLines);
  const afterLines = after.replace(/^[ \t]+/, "").split("\n");
  const line = insertBlock(lines, region.start + beforeLines.length, afterLines, false);
  return { source: join(lines), region: { start: line, end: line + afterLines.length }, caret: 0 };
}

const PREFIX = /^ {0,3}(#{1,6}[ \t]+|#{1,6}$|[-+*][ \t]+|\d{1,9}[.)][ \t]+|>[ \t]?)/;

/** 游標在區塊開頭按 Backspace：先去掉區塊前綴（變回段落），再與上一個區塊合併。 */
export function backspaceAtStart(state: EditorState): EditorState | null {
  const region = state.region;
  if (!region) return null;
  const doc = parseDoc(state.source);
  const lines = doc.lines.slice();
  const text = regionText(lines, region);
  const prev = prevUnit(doc, region);
  // 中間隔著欄位或縮排的標籤：不能直接合併
  const apart = !!prev && doc.units.some((u) => u.tag && u.start >= prev.end && u.start < region.start);

  if (/^\s*$/.test(text)) {
    if (!prev) return null;
    if (apart) {
      const buf = new LineBuf(state.source);
      buf.splice(region.start, region.end - region.start);
      collapseBuf(buf, region.start);
      normalize(buf);
      const start = buf.map(prev.start);
      return activate({ source: buf.source, region: null, caret: 0 }, { start, end: start + prev.end - prev.start }, "end");
    }
    lines.splice(prev.end, region.end - prev.end);
    const source = join(lines);
    return activate({ source, region: null, caret: 0 }, { start: prev.start, end: prev.end }, "end");
  }

  const unit = regionUnit(doc, region);
  if (unit?.kind === "hr" || unit?.kind === "code") return null;
  if (unit && unit.kind !== "paragraph" && PREFIX.test(text)) {
    return applyText(state, plainContent(text), 0);
  }

  if (!prev || apart) return null;
  if (prev.kind === "hr") {
    lines.splice(prev.start, region.start - prev.start);
    const shift = region.start - prev.start;
    return { source: join(lines), region: { start: region.start - shift, end: region.end - shift }, caret: 0 };
  }
  if (prev.kind === "code" || prev.kind === "html" || prev.kind === "source") return null;

  const prevText = regionText(lines, prev);
  lines.splice(prev.start, region.end - prev.start, ...(prevText + text).split("\n"));
  const source = join(lines);
  const r = settle(parseDoc(source), { start: prev.start, end: prev.start + (prevText + text).split("\n").length });
  const abs = offsetOfLine(lines, prev.start) + prevText.length;
  return { source, region: r, caret: abs - offsetOfLine(lines, r.start) };
}

// ─── 轉換區塊類型 ────────────────────────────────────────────────

/** 去掉區塊語法，只留內容文字。 */
export function plainContent(text: string): string {
  const lines = text.split("\n");
  const fence = /^ {0,3}(`{3,}|~{3,})/.exec(lines[0]);
  if (fence) {
    const body = lines.slice(1);
    if (body.length && /^ {0,3}(`{3,}|~{3,})\s*$/.test(body[body.length - 1])) body.pop();
    return body.join("\n");
  }
  if (/^ {0,3}>/.test(lines[0])) return lines.map((l) => l.replace(/^ {0,3}>[ \t]?/, "")).join("\n");
  const first = PREFIX.exec(lines[0]);
  if (!first) return text;
  const indent = " ".repeat(first[0].length);
  const rest = lines.slice(1).map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l.replace(/^[ \t]+/, "")));
  return [lines[0].slice(first[0].length).replace(/[ \t]+#+[ \t]*$/, ""), ...rest].join("\n");
}

/** 把一段區塊原始碼轉成指定類型；回傳新文字與游標位置。 */
export function turnInto(text: string, type: BlockType): { text: string; caret: number } {
  const content = plainContent(text);
  const lines = content.split("\n");
  let out: string;
  switch (type) {
    case "paragraph":
      out = content;
      break;
    case "h1":
    case "h2":
    case "h3":
      out = "#".repeat(Number(type[1])) + " " + lines.map((l) => l.trim()).join(" ");
      break;
    case "bullet":
      out = lines.map((l, i) => (i === 0 ? "- " : l ? "  " : "") + l).join("\n");
      break;
    case "ordered":
      out = lines.map((l, i) => (i === 0 ? "1. " : l ? "   " : "") + l).join("\n");
      break;
    case "quote":
      out = lines.map((l) => (l ? "> " + l : ">")).join("\n");
      if (out === ">") out = "> ";
      break;
    case "code": {
      const longest = Math.max(2, ...(content.match(/`+/g) ?? []).map((s) => s.length));
      const fence = "`".repeat(longest + 1);
      out = `${fence}\n${content}\n${fence}`;
      return { text: out, caret: fence.length + 1 + content.length };
    }
    case "hr":
      out = content.trim() ? `${content}\n\n---` : "---";
      break;
    default:
      // 圖片、影片、表格是插入用的，不轉換
      out = text;
  }
  return { text: out, caret: out.length };
}

/** 把編輯區轉成指定類型。分隔線會在下方再開一個空白區塊。 */
export function turnRegionInto(state: EditorState, text: string, type: BlockType): EditorState {
  const t = turnInto(text, type);
  let s = applyText(state, t.text, t.caret);
  if (type === "hr" && s.region) s = insertEmptyAfter({ ...s, region: null }, s.region.end);
  return s;
}

// ─── 區塊操作（拖曳、刪除、複製）──────────────────────────────────

export function deleteUnit(source: string, unit: Region): string {
  return deleteBlock(source, unit);
}

export function duplicateUnit(source: string, unit: Unit): string {
  const doc = parseDoc(source);
  const lines = doc.lines.slice();
  const block = lines.slice(unit.start, unit.end);
  insertBlock(lines, unit.end, block, unit.kind === "item" && !isLooseAt(doc, unit));
  return join(lines);
}

/** 把 unit 搬到 target 之前或之後（target 為 null 表示搬到文件最後）。 */
export function moveUnit(source: string, unit: Unit, target: Unit | null, pos: "before" | "after" = "before"): string {
  return moveBlock(source, unit, target, pos);
}

// ─── 導覽 ────────────────────────────────────────────────────────

/** 上一個看得到的區塊（跳過版面標籤）。 */
export function prevUnit(doc: ParsedDoc, r: Region): Unit | undefined {
  return [...doc.blocks].reverse().find((u) => u.end <= r.start);
}

/** 下一個看得到的區塊（跳過版面標籤）。 */
export function nextUnit(doc: ParsedDoc, r: Region): Unit | undefined {
  return doc.blocks.find((u) => u.start >= r.end);
}
