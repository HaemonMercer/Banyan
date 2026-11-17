/**
 * 表格。CommonMark 沒有表格語法（| 表格是 GFM 的擴充），所以存成 HTML 區塊：
 *
 *   <table>
 *   <tr><th>標題</th><th>標題</th></tr>
 *   <tr><td>內容</td><td>內容</td></tr>
 *   </table>
 *
 * 每一列一行、中間不能有空行（HTML 區塊遇到空行就結束）。任何 CommonMark 渲染器都會照樣輸出。
 * 儲存格內容是純文字（換行寫成 <br>）。
 */

export interface TableData {
  /** 每一列的儲存格文字 */
  rows: string[][];
  /** 第一列是標題列（<th>） */
  header: boolean;
}

export function isTableBlock(text: string): boolean {
  return /^\s*<table\b[^>]*>/i.test(text) && /<\/table>\s*$/i.test(text);
}

function cellText(cell: Element): string {
  const clone = cell.cloneNode(true) as Element;
  clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  return (clone.textContent ?? "").replace(/\r/g, "");
}

/** 讀出 HTML 表格；不是表格時回傳 null。 */
export function parseTable(text: string): TableData | null {
  if (!isTableBlock(text)) return null;
  const t = document.createElement("template");
  t.innerHTML = text;
  const table = t.content.querySelector("table");
  if (!table) return null;
  const trs = [...table.querySelectorAll("tr")];
  if (!trs.length) return { rows: [[""]], header: false };
  const rows = trs.map((tr) => [...tr.children].filter((c) => /^(TD|TH)$/.test(c.tagName)).map(cellText));
  const header = [...trs[0].children].some((c) => c.tagName === "TH");
  return { rows: normalize(rows), header };
}

/** 每一列補齊到同樣的欄數。 */
function normalize(rows: string[][]): string[][] {
  const cols = Math.max(1, ...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...Array(cols - r.length).fill("")]);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 寫成 HTML 區塊（每列一行，沒有空行）。 */
export function tableHtml(d: TableData): string {
  const rows = normalize(d.rows.length ? d.rows : [[""]]);
  const lines = rows.map((r, i) => {
    const tag = d.header && i === 0 ? "th" : "td";
    return "<tr>" + r.map((c) => `<${tag}>${esc(c).replace(/\n/g, "<br>")}</${tag}>`).join("") + "</tr>";
  });
  return ["<table>", ...lines, "</table>"].join("\n");
}

/** 新表格：3 欄 × 3 列，第一列是標題列。 */
export function newTable(): string {
  return tableHtml({ rows: [["", "", ""], ["", "", ""], ["", "", ""]], header: true });
}

// ─── 編輯操作 ───────────────────────────────────────────────────

export function addRow(d: TableData, at: number): TableData {
  const cols = d.rows[0]?.length ?? 1;
  const rows = d.rows.map((r) => [...r]);
  rows.splice(at, 0, Array(cols).fill(""));
  return { ...d, rows };
}

export function addColumn(d: TableData, at: number): TableData {
  return { ...d, rows: d.rows.map((r) => [...r.slice(0, at), "", ...r.slice(at)]) };
}

export function removeRow(d: TableData, at: number): TableData {
  if (d.rows.length <= 1) return d;
  return { ...d, rows: d.rows.filter((_, i) => i !== at) };
}

export function removeColumn(d: TableData, at: number): TableData {
  if ((d.rows[0]?.length ?? 0) <= 1) return d;
  return { ...d, rows: d.rows.map((r) => r.filter((_, i) => i !== at)) };
}

export function setCell(d: TableData, r: number, c: number, value: string): TableData {
  const rows = d.rows.map((row) => [...row]);
  rows[r][c] = value;
  return { ...d, rows };
}
