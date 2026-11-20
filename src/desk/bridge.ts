import { appendWorkbook } from "../sheet/importer";
import { gridTable, parseWorkbook, type Workbook } from "../sheet/model";
import { addNote, boundsOf, cardRect, NOTE_W, type Board, type Card } from "./board";
import type { CardSource } from "./file";

/**
 * 白板與 Dock 裡的試算表互通（純函式）：
 * - 卡片 → 列：便利貼的第一行當名稱，其餘放進「Notes」欄；頁面、日記的標題當名稱。
 * - 列 → 便利貼：試算表工具列的「To Whiteboard」（`SheetView.tsx` 組文字），這裡排在白板既有內容的右邊。
 */

const NOTES = "Notes";

/** Markdown 的一行 → 純文字（去掉標題、清單、任務、引言標記與行內格式） */
export function plainLine(line: string): string {
  return line
    .replace(/^\s{0,3}(#{1,6}\s+|>\s*|[-*+]\s+|\d{1,9}[.)]\s+)/, "")
    .replace(/^(\{[ xX<\-oO]?\}|\[[ xX]\])\s*/, "")
    .replace(/\[\[([^\]\n]+)\]\]/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/(\*\*|__|\*|_|`)/g, "")
    .trim();
}

/** 一張卡片 → [名稱, 備註] */
export function cardRow(c: Card, source: CardSource): [string, string] {
  const { title, content } = source(c);
  if (c.ref.kind !== "note") return [title, ""];
  const lines = content.trim().split("\n");
  const i = lines.findIndex((l) => plainLine(l));
  if (i < 0) return ["", ""];
  return [plainLine(lines[i]), lines.slice(i + 1).map(plainLine).filter(Boolean).join(" ")];
}

/**
 * 卡片接到試算表第一張工作表的第一個表格（一張卡片一列：第一欄名稱、第二欄備註），
 * 從最後一個有內容的內文列後面開始，不夠就加列（表尾往下搬）。沒有表格就建一個「Name、Notes」表格。
 */
export function cardsToSheet(wb: Workbook, cards: Card[], source: CardSource): Workbook {
  const rows = cards.map((c) => cardRow(c, source)).filter(([a, b]) => a || b);
  if (!rows.length) return wb;
  const [sheet, ...others] = wb.sheets;
  const t = sheet.tables[0];
  if (!t) return { sheets: [{ ...sheet, tables: [gridTable("Ideas", ["Name", NOTES], rows)] }, ...others] };
  const end = t.rows - t.fr;
  let last = t.hr - 1;
  for (const [k, cell] of Object.entries(t.cells)) {
    const r = Number(k.split(",")[0]);
    if (cell.v && r < end && r > last) last = r;
  }
  const start = last + 1;
  const need = Math.max(0, start + rows.length - end);
  const cells = { ...t.cells };
  if (need)
    for (const [k, cell] of Object.entries(t.cells)) {
      const [r, c] = k.split(",").map(Number);
      if (r >= end) {
        delete cells[k];
        cells[`${r + need},${c}`] = cell;
      }
    }
  // 有標題列而且是空的：寫上欄名
  if (t.hr && !t.cells["0,0"]?.v && !t.cells["0,1"]?.v) {
    cells["0,0"] = { ...cells["0,0"], v: "Name" };
    if (t.cols > 1) cells["0,1"] = { ...cells["0,1"], v: NOTES };
  }
  rows.forEach(([a, b], i) => {
    const r = start + i;
    if (a) cells[`${r},0`] = { ...cells[`${r},0`], v: a };
    if (b) {
      if (t.cols > 1) cells[`${r},1`] = { ...cells[`${r},1`], v: b };
      else cells[`${r},0`] = { ...cells[`${r},0`], v: a ? `${a} — ${b}` : b };
    }
  });
  return { sheets: [{ ...sheet, tables: [{ ...t, rows: t.rows + need, cells }, ...sheet.tables.slice(1)] }, ...others] };
}

/** 便利貼排在白板既有內容的右邊（一排四張）；回傳新的白板與新卡片的 id。 */
export function placeNotes(board: Board, texts: string[], perRow = 4): { board: Board; ids: string[] } {
  const b0 = boundsOf(board.cards.map((c) => cardRect(c)).concat(board.sections));
  const x0 = b0 ? b0.x + b0.w + 96 : 0;
  const y0 = b0 ? b0.y : 0;
  let out = board;
  const ids: string[] = [];
  texts.forEach((t, i) => {
    const r = addNote(out, x0 + (i % perRow) * (NOTE_W + 28), y0 + Math.floor(i / perRow) * 170, t);
    out = r.board;
    ids.push(r.id);
  });
  return { board: out, ids };
}

/**
 * 卡片送到試算表：表格卡片整份接上（它的工作表接在後面，撞名的改名；`appendWorkbook`），
 * 其他卡片照 `cardsToSheet` 一張一列。
 */
export function cardsIntoWorkbook(wb: Workbook, cards: Card[], source: CardSource): Workbook {
  const others = cards.filter((c) => c.ref.kind !== "sheet");
  let out = others.length ? cardsToSheet(wb, others, source) : wb;
  for (const c of cards) if (c.ref.kind === "sheet") out = appendWorkbook(out, parseWorkbook(c.text)).wb;
  return out;
}
