/**
 * 白板的表格卡片（`{ kind: "sheet" }`）：卡片的 `text` 是一份小活頁簿（`sheet/model.ts` 的 JSON），
 * 和 Dock 的 Excel 同一種資料，公式照算。這裡是純函式：新卡片的內容、白板上顯示的表格、卡片大小、
 * 貼上的試算表格子、送到 Markdown 文件時的表格。
 */
import { Calc, show } from "../sheet/calc";
import { gridToTable, parseCsv } from "../sheet/importer";
import { newWorkbook, parseWorkbook, rowHeight, serializeWorkbook, type Workbook } from "../sheet/model";
import { tableHtml } from "../editor/table";

/** 新的表格卡片：一張工作表、一個表格（grid 是格子的文字；沒有就是 3 欄 4 列、第一列是標題） */
export function newCardWorkbook(grid?: string[][]): string {
  const base = newWorkbook();
  const sheet = base.sheets[0];
  const rows = grid?.length ? grid : [["", "", ""], ["", "", ""], ["", "", ""], ["", "", ""]];
  const t = gridToTable("Table 1", rows.map((r) => r.map((v) => ({ v }))));
  if (!grid?.length) t.hr = 1;
  t.x = 0;
  t.y = 0;
  const wb: Workbook = { sheets: [{ ...sheet, tables: [t] }] };
  return serializeWorkbook(wb);
}

/** 白板上顯示的一格 */
export interface PreviewCell {
  text: string;
  align: "left" | "center" | "right";
  head: boolean;
  b?: boolean;
  i?: boolean;
}
export interface PreviewTable {
  name: string;
  showName: boolean;
  /** 每一欄的寬度（px） */
  widths: number[];
  rows: PreviewCell[][];
  /** 列或欄太多，只顯示前面的 */
  more: boolean;
}

const MAX_ROWS = 60;
const MAX_COLS = 20;

/** 第一張工作表的表格，照格式算好要顯示的文字（藏起來的列略過；圖表不顯示）。 */
export function sheetPreview(json: string): PreviewTable[] {
  const wb = parseWorkbook(json);
  const calc = new Calc(wb);
  const sheet = wb.sheets[0];
  if (!sheet) return [];
  return [...sheet.tables]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((t) => {
      const hidden = new Set(t.hideR ?? []);
      const hiddenC = new Set(t.hideC ?? []);
      const cols = Array.from({ length: t.cols }, (_x, c) => c).filter((c) => !hiddenC.has(c)).slice(0, MAX_COLS);
      const rowIdx = Array.from({ length: t.rows }, (_x, r) => r).filter((r) => !hidden.has(r));
      const rows = rowIdx.slice(0, MAX_ROWS).map((r) =>
        cols.map((c) => {
          const s = t.cells[`${r},${c}`]?.s;
          const shown = show(calc.value(t.id, r, c), s);
          const head = r < t.hr || c < t.hc || r >= t.rows - t.fr;
          return { text: shown.text, align: shown.align, head, ...(s?.b ? { b: true } : {}), ...(s?.i ? { i: true } : {}) };
        }),
      );
      return { name: t.name, showName: t.showName, widths: cols.map((c) => t.colW[c] ?? 110), rows, more: rowIdx.length > MAX_ROWS || t.cols - hiddenC.size > MAX_COLS };
    });
}

/** 卡片剛好放得下表格的大小（太大的有上限，超過的部分在卡片裡看不到） */
export function sheetCardSize(json: string): { w: number; h: number } {
  const wb = parseWorkbook(json);
  const sheet = wb.sheets[0];
  if (!sheet?.tables.length) return { w: 320, h: 160 };
  let w = 0;
  let h = 0;
  for (const t of sheet.tables) {
    const hidden = new Set(t.hideR ?? []);
    const hiddenC = new Set(t.hideC ?? []);
    let tw = 0;
    for (let c = 0; c < t.cols && c < MAX_COLS; c++) if (!hiddenC.has(c)) tw += t.colW[c] ?? 110;
    let th = 0;
    for (let r = 0, n = 0; r < t.rows && n < MAX_ROWS; r++) if (!hidden.has(r)) (th += rowHeight(t, r)), n++;
    w = Math.max(w, tw);
    h += th + (t.showName ? 26 : 0) + 12;
  }
  return { w: Math.round(Math.min(900, Math.max(200, w + 26))), h: Math.round(Math.min(640, Math.max(80, h + 14))) };
}

/**
 * 貼上的文字是不是從試算表複製的格子：至少兩列、每一列都有 Tab，而且欄數一樣
 * （Excel、Google 試算表、Numbers 複製格子時的純文字就是這樣）。是的話回傳格子。
 */
export function tabularClip(text: string): string[][] | null {
  const t = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  const lines = t.split("\n");
  if (lines.length < 2 || !lines.every((l) => l.includes("\t"))) return null;
  const rows = parseCsv(t);
  const n = rows[0]?.length ?? 0;
  if (n < 2 || !rows.every((r) => r.length === n)) return null;
  return rows;
}

/** 送到 Markdown 文件（Word、簡報、筆記）：每個表格變成編輯器的表格區塊（顯示的文字，不是公式） */
export function sheetMarkdown(json: string): string {
  return sheetPreview(json)
    .map((t) => tableHtml({ rows: t.rows.map((r) => r.map((c) => c.text)), header: t.rows[0]?.every((c) => c.head) ?? false }))
    .join("\n\n");
}
