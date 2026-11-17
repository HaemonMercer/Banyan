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
  | "hr";

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

/** 移除第 at 行附近多出來的空白行（刪掉區塊後兩個分隔空行會相鄰）。 */
function collapse(lines: string[], at: number): number {
  while (at > 0 && isBlank(lines[at - 1]) && (at >= lines.length || isBlank(lines[at]))) {
    // 文件結尾保留一個換行
    if (at >= lines.length && at - 1 === 0) break;
    if (at >= lines.length && lines.length >= 2 && !isBlank(lines[at - 2])) break;
    lines.splice(at - 1, 1);
    at--;
  }
  // 文件開頭的空白行沒有意義
  if (at === 0) while (lines.length > 1 && isBlank(lines[0])) lines.shift();
  return at;
}

/** 空白、或只有清單標記（如 Enter 產生的 `- `）的區塊，離開時會被刪掉。 */
export function isEmptyBlock(text: string): boolean {
  return /^\s*$/.test(text) || /^[ \t]*([-+*]|\d{1,9}[.)])[ \t]*$/.test(text);
}

// ─── 進入／離開編輯 ───────────────────────────────────────────────

/** 離開編輯區；若編輯區是空的就把它刪掉。回傳被刪掉的行（供呼叫端位移其他行號）。 */
export function deactivate(state: EditorState): { state: EditorState; removedAt: number; removed: number } {
  const { region } = state;
  const none = { state: { ...state, region: null }, removedAt: 0, removed: 0 };
  if (!region) return none;
  const lines = state.source.split("\n");
  if (!isEmptyBlock(regionText(lines, region))) return none;
  const before = lines.length;
  lines.splice(region.start, region.end - region.start);
  collapse(lines, region.start);
  if (lines.length === 1 && lines[0] === "") lines.length = 0;
  const removed = before - lines.length;
  return {
    state: { source: join(lines), region: null, caret: 0 },
    removedAt: Math.max(0, region.start - (removed - (region.end - region.start))),
    removed,
  };
}

/** 開始編輯 target（以目前的行號表示）；會先關閉舊的編輯區。 */
export function activate(state: EditorState, target: Region, caret: number | "end"): EditorState {
  const { state: s, removedAt, removed } = deactivate(state);
  let t = target;
  if (removed && target.start >= removedAt) t = { start: target.start - removed, end: target.end - removed };
  const lines = s.source.split("\n");
  if (s.source === "") {
    return { source: "", region: { start: 0, end: 1 }, caret: 0 };
  }
  t = settle(parseDoc(s.source), {
    start: Math.min(t.start, lines.length - 1),
    end: Math.min(Math.max(t.end, t.start + 1), lines.length),
  });
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
  const { state: s, removedAt, removed } = deactivate(state);
  const lines = s.source === "" ? [] : s.source.split("\n");
  let at = afterLine;
  if (removed && at > removedAt) at -= removed;
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

  const beforeLines = before.replace(/[ \t]+$/, "").split("\n");
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
  const prev = [...doc.units].reverse().find((u) => u.end <= region.start);

  if (/^\s*$/.test(text)) {
    if (!prev) return null;
    lines.splice(prev.end, region.end - prev.end);
    const source = join(lines);
    return activate({ source, region: null, caret: 0 }, { start: prev.start, end: prev.end }, "end");
  }

  const unit = regionUnit(doc, region);
  if (unit?.kind === "hr" || unit?.kind === "code") return null;
  if (unit && unit.kind !== "paragraph" && PREFIX.test(text)) {
    return applyText(state, plainContent(text), 0);
  }

  if (!prev) return null;
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
  const lines = source.split("\n");
  lines.splice(unit.start, unit.end - unit.start);
  collapse(lines, unit.start);
  if (lines.length === 1 && lines[0] === "") return "";
  return join(lines);
}

export function duplicateUnit(source: string, unit: Unit): string {
  const doc = parseDoc(source);
  const lines = doc.lines.slice();
  const block = lines.slice(unit.start, unit.end);
  insertBlock(lines, unit.end, block, unit.kind === "item" && !isLooseAt(doc, unit));
  return join(lines);
}

/** 把 unit 搬到 target 之前（target 為 null 表示搬到文件最後）。 */
export function moveUnit(source: string, unit: Unit, target: Unit | null): string {
  if (target && target.start === unit.start) return source;
  const doc = parseDoc(source);
  const lines = doc.lines.slice();
  const block = lines.slice(unit.start, unit.end);
  const count = unit.end - unit.start;
  lines.splice(unit.start, count);
  collapse(lines, unit.start);
  const removed = doc.lines.length - lines.length;
  const shift = (l: number) => (l >= unit.end ? l - removed : l);

  if (!target) {
    let end = lines.length;
    while (end > 0 && isBlank(lines[end - 1])) end--;
    lines.splice(end, 0, "", ...block);
    return join(lines);
  }
  const at = shift(target.start);
  insertBlock(lines, at, block, unit.kind === "item" && target.kind === "item");
  return join(lines);
}

// ─── 導覽 ────────────────────────────────────────────────────────

export function prevUnit(doc: ParsedDoc, r: Region): Unit | undefined {
  return [...doc.units].reverse().find((u) => u.end <= r.start);
}

export function nextUnit(doc: ParsedDoc, r: Region): Unit | undefined {
  return doc.units.find((u) => u.start >= r.end);
}
