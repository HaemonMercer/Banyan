/**
 * 試算表匯入常用的格式（`importer.ts` 處理 .xlsx 與 CSV 的拆欄，這裡處理其他的）：
 *
 * - 活頁簿（每張工作表變成新的工作表）：.xlsx／.xlsm、舊版 Excel 97–2003 的 .xls（只讀值：
 *   公式取 Excel 存的計算結果、日期、百分比、欄寬）、OpenDocument 的 .ods（LibreOffice、
 *   Google 試算表下載；保留公式）。
 * - 表格（放在目前工作表最下面）：.csv／.tsv／.txt（自動判斷編碼：BOM、UTF-8、UTF-16，
 *   不是 UTF-8 就當 Big5——繁體中文版 Excel 存的 CSV）、.json（物件陣列、陣列的陣列，
 *   或藏在 `data`、`records` 這類欄位裡的陣列）、.html（每個 `<table>` 一個表格）、
 *   .md（Markdown 的表格）。
 *
 * 都是純函式（只用 DOMParser 與瀏覽器內建的解壓縮），回傳 `ImportedSheet`，交給
 * `importer.ts` 的 `addImported`（活頁簿）或這裡的 `importTables`（表格）。
 */
import { generalNumber } from "./formula";
import { baseName, fromExcelFormula, gridToTable, iso, parseCsv, readXlsx, unzip, type ImportedSheet } from "./importer";
import { allTableNames, tableHeight, uniqueName, updSheet, type Cell, type Style, type Workbook } from "./model";

const MAX_ROWS = 5000;
const MAX_COLS = 200;

/** Import 按鈕接受的副檔名 */
export const IMPORT_ACCEPT = ".xlsx,.xlsm,.xls,.ods,.csv,.tsv,.tab,.txt,.json,.html,.htm,.md,.markdown";

export type Imported = { kind: "workbook"; sheets: ImportedSheet[] } | { kind: "tables"; tables: ImportedSheet[] };

const extOf = (name: string) => (/\.([^./\\]+)$/.exec(name)?.[1] ?? "").toLowerCase();

/** 依副檔名讀檔；不認得的副檔名當成分隔文字（CSV／Tab）。 */
export async function readSpreadsheet(name: string, bytes: Uint8Array): Promise<Imported> {
  const e = extOf(name);
  if (e === "xlsx" || e === "xlsm") return { kind: "workbook", sheets: await readXlsx(bytes) };
  if (e === "ods") return { kind: "workbook", sheets: await readOds(bytes) };
  if (e === "xls") {
    // 有些網站下載的 .xls 其實是 HTML 或 CSV（舊的「匯出成 Excel」常這樣做）
    if (!isCfb(bytes)) return readSpreadsheet(name.replace(/\.xls$/i, looksHtml(bytes) ? ".html" : ".csv"), bytes);
    return { kind: "workbook", sheets: readXls(bytes) };
  }
  const text = decodeTableText(bytes);
  const base = baseName(name);
  if (e === "json") return { kind: "tables", tables: [textSheet(base, parseJsonTable(text))] };
  if (e === "html" || e === "htm") {
    const ts = parseHtmlTables(text);
    if (!ts.length) throw new Error("There is no table in this web page.");
    return { kind: "tables", tables: ts.map((t, i) => textSheet(t.name || (ts.length > 1 ? `${base} ${i + 1}` : base), t.rows)) };
  }
  if (e === "md" || e === "markdown") {
    const ts = parseMarkdownTables(text);
    if (!ts.length) throw new Error("There is no Markdown table in this file.");
    return { kind: "tables", tables: ts.map((rows, i) => textSheet(ts.length > 1 ? `${base} ${i + 1}` : base, rows)) };
  }
  return { kind: "tables", tables: [textSheet(base, parseCsv(text))] };
}

const textSheet = (name: string, rows: string[][]): ImportedSheet => ({
  name,
  grid: rows.slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLS).map((v) => ({ v: v.trim() }))),
  colW: [],
});

/** 表格一個接一個（中間空 64px）放在目前工作表的 y 下面；回傳第一個表格的 id。 */
export function importTables(wb: Workbook, sid: string, tables: ImportedSheet[], y: number): { wb: Workbook; id: string } {
  const names = allTableNames(wb);
  let at = y;
  const made = tables.map((im) => {
    const name = uniqueName(names, im.name);
    names.push(name);
    const t = gridToTable(name, im.grid.length ? im.grid : [[{ v: "" }]], im.colW);
    t.y = at;
    // 表格名稱約 40px，加上表格本身，再空 64px
    at += 40 + tableHeight(t) + 64;
    return t;
  });
  return { wb: updSheet(wb, sid, (s) => ({ ...s, tables: [...s.tables, ...made] })), id: made[0]?.id ?? "" };
}

/* ─── 文字的編碼 ─── */

/**
 * 表格文字的編碼：有 BOM 照 BOM（UTF-8、UTF-16 LE／BE；Excel「Unicode 文字」是 UTF-16 LE），
 * 合法的 UTF-8 就是 UTF-8，否則當 Big5（繁體中文 Windows 的 Excel 存 CSV 用的編碼）。
 */
export function decodeTableText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("big5").decode(bytes);
    } catch {
      return new TextDecoder("utf-8").decode(bytes);
    }
  }
}

function looksHtml(bytes: Uint8Array): boolean {
  const head = decodeTableText(bytes.subarray(0, 2048)).trimStart().toLowerCase();
  return head.startsWith("<") && /<(html|table|!doctype|meta|head)/.test(head);
}

/* ─── JSON ─── */

const jsonText = (v: unknown): string =>
  v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : typeof v === "object" ? JSON.stringify(v) : String(v);

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** 找出 JSON 裡的表格：最外層的陣列，或物件裡（最多三層）第一個非空的陣列。 */
function findRows(v: unknown, depth = 0): unknown[] | null {
  if (Array.isArray(v)) return v;
  if (!isRecord(v) || depth > 3) return null;
  for (const x of Object.values(v)) if (Array.isArray(x) && x.length) return x;
  for (const x of Object.values(v)) {
    const r = findRows(x, depth + 1);
    if (r) return r;
  }
  return null;
}

/**
 * JSON → 一個表格：物件的陣列（欄位照第一次出現的順序當標題列）、陣列的陣列（照原樣），
 * 或每個值都是物件的物件（鍵放在第一欄）。巢狀的值寫成 JSON 文字。
 */
export function parseJsonTable(text: string): string[][] {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error("This isn't valid JSON.");
  }
  if (isRecord(v) && Object.values(v).length && Object.values(v).every(isRecord) && !findRows(v)) {
    const keys: string[] = [];
    for (const o of Object.values(v) as Record<string, unknown>[]) for (const k of Object.keys(o)) if (!keys.includes(k)) keys.push(k);
    return [["", ...keys], ...Object.entries(v as Record<string, Record<string, unknown>>).map(([k, o]) => [k, ...keys.map((x) => jsonText(o[x]))])];
  }
  const rows = findRows(v);
  if (!rows) throw new Error("There is no list of records in this JSON.");
  if (rows.every(Array.isArray)) return (rows as unknown[][]).map((r) => r.map(jsonText));
  if (rows.some(isRecord)) {
    const keys: string[] = [];
    for (const o of rows) if (isRecord(o)) for (const k of Object.keys(o)) if (!keys.includes(k)) keys.push(k);
    return [keys, ...rows.map((o) => (isRecord(o) ? keys.map((k) => jsonText(o[k])) : [jsonText(o)]))];
  }
  return rows.map((x) => [jsonText(x)]);
}

/* ─── HTML ─── */

/** 網頁裡的每個 `<table>` → 列（`colspan`、`rowspan` 的格子只在第一格放文字）。巢狀的表格算外面那個的內容。 */
export function parseHtmlTables(html: string): { name: string; rows: string[][] }[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll("table")]
    .filter((t) => !t.parentElement?.closest("table"))
    .map((t) => {
      const rows: string[][] = [];
      /** 被上面的 rowspan 佔住的格子：列 → 欄 */
      const taken = new Map<number, Set<number>>();
      const trs = [...t.querySelectorAll("tr")].filter((tr) => tr.closest("table") === t);
      trs.forEach((tr, r) => {
        const row: string[] = [];
        let c = 0;
        for (const cell of [...tr.children].filter((x) => x.tagName === "TD" || x.tagName === "TH")) {
          while (taken.get(r)?.has(c)) row[c++] = "";
          const text = ((cell as HTMLElement).innerText ?? cell.textContent ?? "").replace(/\s+/g, " ").trim();
          const span = Math.max(1, Math.min(50, Number(cell.getAttribute("colspan")) || 1));
          const down = Math.max(1, Math.min(500, Number(cell.getAttribute("rowspan")) || 1));
          for (let k = 0; k < span; k++) {
            row[c + k] = k ? "" : text;
            for (let d = 1; d < down; d++) {
              if (!taken.has(r + d)) taken.set(r + d, new Set());
              taken.get(r + d)!.add(c + k);
            }
          }
          c += span;
        }
        while (taken.get(r)?.has(c)) row[c++] = "";
        rows.push(Array.from({ length: row.length }, (_x, i) => row[i] ?? ""));
      });
      const name = t.querySelector("caption")?.textContent?.trim() ?? "";
      return { name, rows: rows.filter((r) => r.length) };
    })
    .filter((t) => t.rows.length);
}

/* ─── Markdown ─── */

const SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function mdCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((x) => x.trim().replace(/\\\|/g, "|"));
}

/** Markdown（GFM）的表格：標題列、分隔列（`---`）、內容列；文件裡有幾個就回傳幾個。 */
export function parseMarkdownTables(md: string): string[][][] {
  const lines = md.split(/\r?\n/);
  const out: string[][][] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!lines[i].includes("|") || !SEP.test(lines[i + 1]) || !lines[i + 1].includes("-")) continue;
    const rows = [mdCells(lines[i])];
    let j = i + 2;
    for (; j < lines.length && lines[j].includes("|") && lines[j].trim(); j++) rows.push(mdCells(lines[j]));
    out.push(rows);
    i = j - 1;
  }
  return out;
}

/* ─── OpenDocument 試算表（.ods） ─── */

const T = "urn:oasis:names:tc:opendocument:xmlns:table:1.0";
const O = "urn:oasis:names:tc:opendocument:xmlns:office:1.0";
const X = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
const ST = "urn:oasis:names:tc:opendocument:xmlns:style:1.0";

/** ODF 的長度（`1.5in`、`2.258cm`、`64.01mm`、`72pt`）→ 螢幕像素（96 dpi） */
export function lengthPx(s: string): number {
  const m = /^([\d.]+)\s*(in|cm|mm|pt|pc|px)$/.exec(s.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  const per = { in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 96 / 72, pc: 16, px: 1 }[m[2] as "in"];
  return n * per;
}

/** OpenFormula → 這裡的公式：`of:=SUM([.B2:.B3])` → `=SUM(B2:B3)`、`[$Sheet1.A1]` → `Sheet1::A1`、`;` → `,` */
export function fromOdsFormula(f: string): string {
  let s = f.replace(/^(?:of|oooc|msoxl):/, "");
  if (!s.startsWith("=")) s = "=" + s;
  s = s.replace(/\[([^\]]+)\]/g, (_m, ref: string) =>
    ref
      .split(":")
      .map((part) => {
        const m = /^\$?(?:'((?:[^']|'')+)'|([^.]*))\.(.+)$/.exec(part);
        if (!m) return part;
        const sheet = (m[1] ?? m[2] ?? "").replace(/''/g, "'").replace(/^\$/, "");
        return sheet ? `'${sheet.replace(/'/g, "''")}'!${m[3]}` : m[3];
      })
      // `[.A1:.B2]` 的第二段沒有工作表名稱；`[$S.A1:$S.B2]` 第二段的工作表去掉
      .map((p, i) => (i ? p.replace(/^'(?:[^']|'')+'!/, "") : p))
      .join(":"),
  );
  // 字串外面的分號是參數分隔
  s = s.replace(/("(?:[^"]|"")*")|;/g, (_m, str: string | undefined) => str ?? ",");
  return fromExcelFormula(s);
}

/** .ods → 每張工作表的格子（值、公式、日期、百分比、貨幣；重複的列與欄展開，最後面的空白去掉）。 */
export async function readOds(bytes: Uint8Array): Promise<ImportedSheet[]> {
  const files = await unzip(bytes);
  const content = files.get("content.xml");
  if (!content) throw new Error("This file isn't an OpenDocument spreadsheet (no content.xml).");
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(content), "application/xml");
  const attr = (el: Element, ns: string, name: string) => el.getAttributeNS(ns, name);
  // 欄寬：欄的樣式（content.xml 的 automatic-styles）裡的 style:column-width
  const widths = new Map<string, number>();
  for (const st of [...doc.getElementsByTagNameNS(ST, "style")]) {
    const w = st.getElementsByTagNameNS(ST, "table-column-properties")[0]?.getAttributeNS(ST, "column-width");
    const px = w ? lengthPx(w) : 0;
    if (px) widths.set(st.getAttributeNS(ST, "name") ?? "", px);
  }
  const out: ImportedSheet[] = [];
  for (const tbl of [...doc.getElementsByTagNameNS(T, "table")]) {
    const grid: Cell[][] = [];
    const colW: number[] = [];
    let ci = 0;
    for (const col of [...tbl.getElementsByTagNameNS(T, "table-column")]) {
      const rep = Math.max(1, Number(attr(col, T, "number-columns-repeated")) || 1);
      const w = widths.get(attr(col, T, "style-name") ?? "");
      for (let k = 0; k < rep && ci < MAX_COLS; k++, ci++) if (w) colW[ci] = w;
      if (ci >= MAX_COLS) break;
    }
    let r = 0;
    const rowsOf = (parent: Element): Element[] =>
      [...parent.children].flatMap((ch) =>
        ch.namespaceURI === T && ch.localName === "table-row" ? [ch] : ch.namespaceURI === T && /^table-(header-)?rows$|^table-row-group$/.test(ch.localName) ? rowsOf(ch) : [],
      );
    for (const row of rowsOf(tbl)) {
      const rep = Math.max(1, Number(attr(row, T, "number-rows-repeated")) || 1);
      const cells: Cell[] = [];
      let c = 0;
      for (const cell of [...row.children]) {
        if (cell.namespaceURI !== T || (cell.localName !== "table-cell" && cell.localName !== "covered-table-cell")) continue;
        const crep = Math.max(1, Number(attr(cell, T, "number-columns-repeated")) || 1);
        const one = odsCell(cell, attr);
        if (one) for (let k = 0; k < crep && c + k < MAX_COLS; k++) cells[c + k] = one;
        c += crep;
        if (c >= MAX_COLS) break;
      }
      const has = cells.some(Boolean);
      for (let k = 0; k < rep && r < MAX_ROWS; k++, r++) if (has) grid[r] = Array.from({ length: cells.length }, (_x, i) => cells[i] ?? { v: "" });
      if (r >= MAX_ROWS) break;
    }
    for (let i = 0; i < grid.length; i++) grid[i] = grid[i] ?? [];
    out.push({ name: attr(tbl, T, "name") || `Sheet ${out.length + 1}`, grid, colW });
  }
  return out;
}

function odsCell(cell: Element, attr: (el: Element, ns: string, name: string) => string | null): Cell | null {
  const type = attr(cell, O, "value-type");
  const formula = attr(cell, T, "formula");
  const text = [...cell.getElementsByTagNameNS(X, "p")].map((p) => p.textContent ?? "").join("\n");
  const s: Style = {};
  let v = "";
  if (formula) {
    v = fromOdsFormula(formula);
    if (type === "percentage") s.fmt = "percent";
    else if (type === "currency") s.fmt = "currency";
    else if (type === "date") s.fmt = "date";
  } else if (type === "float" || type === "currency") {
    v = generalNumber(Number(attr(cell, O, "value")));
    if (type === "currency") {
      s.fmt = "currency";
      const cur = attr(cell, O, "currency");
      if (cur && cur !== "USD") s.cur = cur === "TWD" ? "NT$" : cur === "EUR" ? "€" : cur === "GBP" ? "£" : cur === "JPY" ? "¥" : cur;
    }
  } else if (type === "percentage") v = generalNumber(Number((Number(attr(cell, O, "value")) * 100).toPrecision(12))) + "%";
  else if (type === "date") {
    const d = attr(cell, O, "date-value") ?? "";
    v = d.length > 10 && !/T00:00:00/.test(d) ? d.slice(0, 16).replace("T", " ") : d.slice(0, 10);
  } else if (type === "time") v = text;
  else if (type === "boolean") v = attr(cell, O, "boolean-value") === "true" ? "TRUE" : "FALSE";
  else v = text;
  // 文字看起來像公式時加 '，保持是文字（公式本身不加，結果是文字的公式也一樣）
  if (!formula && (type === "string" || !type) && /^[=']/.test(v)) v = "'" + v;
  if (!v && !Object.keys(s).length) return null;
  return Object.keys(s).length ? { v, s } : { v };
}

/* ─── 舊版 Excel（.xls：OLE 複合文件裡的 BIFF8） ─── */

const CFB_SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
export const isCfb = (b: Uint8Array) => b.length >= 512 && CFB_SIG.every((x, i) => b[i] === x);

/** 從 OLE 複合文件（Compound File）讀出一個串流（名稱不分大小寫）；沒有就是 null。 */
export function cfbStream(b: Uint8Array, names: string[]): Uint8Array | null {
  if (!isCfb(b)) throw new Error("This file isn't an Excel 97–2003 workbook.");
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const ssz = 1 << v.getUint16(0x1e, true);
  const mssz = 1 << v.getUint16(0x20, true);
  const sector = (n: number) => b.subarray((n + 1) * ssz, (n + 2) * ssz);
  const END = 0xfffffffe;
  // FAT 的磁區：檔頭的 109 個，再接 DIFAT 鏈
  const fatSecs: number[] = [];
  for (let i = 0; i < 109; i++) {
    const s = v.getUint32(0x4c + i * 4, true);
    if (s < END) fatSecs.push(s);
  }
  let dif = v.getUint32(0x44, true);
  for (let guard = 0; dif < END && guard < 10000; guard++) {
    const d = new DataView(b.buffer, b.byteOffset + (dif + 1) * ssz, ssz);
    for (let i = 0; i < ssz / 4 - 1; i++) {
      const s = d.getUint32(i * 4, true);
      if (s < END) fatSecs.push(s);
    }
    dif = d.getUint32(ssz - 4, true);
  }
  const fat: number[] = [];
  for (const s of fatSecs) {
    const d = new DataView(b.buffer, b.byteOffset + (s + 1) * ssz, ssz);
    for (let i = 0; i < ssz / 4; i++) fat.push(d.getUint32(i * 4, true));
  }
  const chain = (start: number, table: number[]) => {
    const out: number[] = [];
    for (let s = start; s < END && out.length < table.length + 1; s = table[s]) out.push(s);
    return out;
  };
  const read = (start: number) => {
    const secs = chain(start, fat);
    const out = new Uint8Array(secs.length * ssz);
    secs.forEach((s, i) => out.set(sector(s), i * ssz));
    return out;
  };
  const dir = read(v.getUint32(0x30, true));
  const dv = new DataView(dir.buffer);
  const entries: { name: string; type: number; start: number; size: number }[] = [];
  for (let at = 0; at + 128 <= dir.length; at += 128) {
    const len = dv.getUint16(at + 0x40, true);
    const name = new TextDecoder("utf-16le").decode(dir.subarray(at, at + Math.max(0, len - 2)));
    entries.push({ name, type: dir[at + 0x42], start: dv.getUint32(at + 0x74, true), size: dv.getUint32(at + 0x78, true) });
  }
  const want = names.map((n) => n.toLowerCase());
  const e = entries.find((x) => x.type === 2 && want.includes(x.name.toLowerCase()));
  if (!e) return null;
  const cutoff = v.getUint32(0x38, true) || 4096;
  if (e.size >= cutoff) return read(e.start).subarray(0, e.size);
  // 小的串流在 mini stream 裡（根目錄的資料），用 mini FAT 找
  const root = entries.find((x) => x.type === 5);
  if (!root) return null;
  const mini = read(root.start);
  const mfat: number[] = [];
  const mf = read(v.getUint32(0x3c, true));
  const mfv = new DataView(mf.buffer);
  if (v.getUint32(0x40, true)) for (let i = 0; i < mf.length / 4; i++) mfat.push(mfv.getUint32(i * 4, true));
  const secs = chain(e.start, mfat);
  const out = new Uint8Array(secs.length * mssz);
  secs.forEach((s, i) => out.set(mini.subarray(s * mssz, (s + 1) * mssz), i * mssz));
  return out.subarray(0, e.size);
}

/** BIFF 的紀錄：類型、內容（CONTINUE 另外列出，讀 SST 時接起來） */
interface Rec {
  type: number;
  data: Uint8Array;
  at: number;
}

function records(s: Uint8Array, from = 0): Rec[] {
  const v = new DataView(s.buffer, s.byteOffset, s.byteLength);
  const out: Rec[] = [];
  for (let at = from; at + 4 <= s.length; ) {
    const type = v.getUint16(at, true);
    const len = v.getUint16(at + 2, true);
    out.push({ type, data: s.subarray(at + 4, at + 4 + len), at });
    at += 4 + len;
    if (type === 0x000a && from) break; // 工作表的 EOF
  }
  return out;
}

/** 跨好幾段（SST＋CONTINUE）讀資料；字串跨段時新的一段開頭有一個位元組說明編碼。 */
class Segs {
  i = 0;
  pos = 0;
  constructor(private segs: Uint8Array[]) {}
  private ensure() {
    while (this.i < this.segs.length && this.pos >= this.segs[this.i].length) {
      this.i++;
      this.pos = 0;
    }
  }
  get done() {
    this.ensure();
    return this.i >= this.segs.length;
  }
  u8(): number {
    this.ensure();
    return this.segs[this.i]?.[this.pos++] ?? 0;
  }
  u16 = () => this.u8() | (this.u8() << 8);
  u32 = () => (this.u16() | (this.u16() << 16)) >>> 0;
  skip(n: number) {
    for (; n > 0; ) {
      this.ensure();
      const seg = this.segs[this.i];
      if (!seg) return;
      const k = Math.min(n, seg.length - this.pos);
      this.pos += k;
      n -= k;
    }
  }
  /** cch 個字元；high：一開始是不是兩個位元組一個字 */
  chars(cch: number, high: boolean): string {
    let out = "";
    let left = cch;
    let wide = high;
    while (left > 0 && !this.done) {
      const seg = this.segs[this.i];
      const room = Math.floor((seg.length - this.pos) / (wide ? 2 : 1));
      const n = Math.min(left, room);
      const bytes = seg.subarray(this.pos, this.pos + n * (wide ? 2 : 1));
      out += wide ? new TextDecoder("utf-16le").decode(bytes) : String.fromCharCode(...bytes);
      this.pos += bytes.length;
      left -= n;
      if (left > 0) {
        this.i++;
        this.pos = 0;
        if (this.i >= this.segs.length) break;
        wide = (this.u8() & 1) === 1;
      }
    }
    return out;
  }
  /** XLUnicodeRichExtendedString（SST 裡的字串） */
  richString(): string {
    const cch = this.u16();
    const flags = this.u8();
    const runs = flags & 0x8 ? this.u16() : 0;
    const ext = flags & 0x4 ? this.u32() : 0;
    const s = this.chars(cch, (flags & 1) === 1);
    this.skip(runs * 4 + ext);
    return s;
  }
}

/** 一段紀錄裡的 XLUnicodeString（cch 2 或 1 個位元組） */
function xlString(d: Uint8Array, at: number, shortLen = false): string {
  const cch = shortLen ? d[at] : d[at] | (d[at + 1] << 8);
  const p = at + (shortLen ? 1 : 2);
  const high = (d[p] & 1) === 1;
  const body = d.subarray(p + 1, p + 1 + cch * (high ? 2 : 1));
  return high ? new TextDecoder("utf-16le").decode(body) : String.fromCharCode(...body);
}

/** RK 數值：整數或 IEEE 浮點數的高 30 位，可能要除以 100 */
export function rkValue(rk: number): number {
  let n: number;
  if (rk & 2) n = rk >> 2;
  else {
    const buf = new DataView(new ArrayBuffer(8));
    buf.setUint32(4, rk & 0xfffffffc, true);
    n = buf.getFloat64(0, true);
  }
  return rk & 1 ? n / 100 : n;
}

/** BIFF 的錯誤代碼 → Excel 顯示的錯誤 */
const XLS_ERRORS: Record<number, string> = { 0x00: "#NULL!", 0x07: "#DIV/0!", 0x0f: "#VALUE!", 0x17: "#REF!", 0x1d: "#NAME?", 0x24: "#NUM!", 0x2a: "#N/A" };
export const xlsError = (code: number) => XLS_ERRORS[code] ?? "#ERROR!";

const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const isDateCode = (id: number, code: string) =>
  BUILTIN_DATE.has(id) || (!!code && !/^general$/i.test(code) && /[dmyhs]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "")));
const isPctCode = (id: number, code: string) => id === 9 || id === 10 || code.replace(/"[^"]*"/g, "").includes("%");

/**
 * 舊版 Excel（.xls，BIFF8）→ 每張工作表的值。公式只拿 Excel 存的計算結果（BIFF 的公式是
 * 編譯過的格式）；依儲存格格式把日期換成 `YYYY-MM-DD`、百分比加 `%`；欄寬照 COLINFO。
 */
export function readXls(bytes: Uint8Array): ImportedSheet[] {
  const wbs = cfbStream(bytes, ["Workbook", "Book"]);
  if (!wbs) throw new Error("This file has no workbook stream (it may be corrupt).");
  const recs = records(wbs);
  const first = recs[0];
  if (!first || first.type !== 0x0809) throw new Error("This Excel file is too old to import (Excel 95 or earlier). Save it as .xlsx first.");
  const ver = first.data[0] | (first.data[1] << 8);
  if (ver !== 0x0600) throw new Error("This Excel file is too old to import (Excel 95 or earlier). Save it as .xlsx first.");
  const sheets: { name: string; pos: number }[] = [];
  const sst: string[] = [];
  const formats = new Map<number, string>();
  const xfFmt: number[] = [];
  for (let i = 1; i < recs.length; i++) {
    const r = recs[i];
    const d = r.data;
    if (r.type === 0x000a) break;
    if (r.type === 0x002f) throw new Error("This workbook is password-protected. Open it in Excel and save it without a password first.");
    if (r.type === 0x0085 && d[5] === 0) sheets.push({ pos: (d[0] | (d[1] << 8) | (d[2] << 16) | (d[3] << 24)) >>> 0, name: xlString(d, 6, true) });
    else if (r.type === 0x041e) formats.set(d[0] | (d[1] << 8), xlString(d, 2));
    else if (r.type === 0x00e0) xfFmt.push(d[2] | (d[3] << 8));
    else if (r.type === 0x00fc) {
      const segs = [d.subarray(8)];
      for (let j = i + 1; j < recs.length && recs[j].type === 0x003c; j++) segs.push(recs[j].data);
      const total = (d[4] | (d[5] << 8) | (d[6] << 16) | (d[7] << 24)) >>> 0;
      const rd = new Segs(segs);
      for (let k = 0; k < total && !rd.done; k++) sst.push(rd.richString());
    }
  }
  const kindOf = (ixfe: number): "date" | "pct" | null => {
    const id = xfFmt[ixfe] ?? 0;
    const code = formats.get(id) ?? "";
    return isDateCode(id, code) ? "date" : isPctCode(id, code) ? "pct" : null;
  };
  const num = (n: number, ixfe: number): string => {
    const k = kindOf(ixfe);
    if (k === "date") return iso(n);
    if (k === "pct") return generalNumber(Number((n * 100).toPrecision(12))) + "%";
    return generalNumber(n);
  };
  return sheets.map((sh) => {
    const grid: Cell[][] = [];
    const colW: number[] = [];
    const put = (r: number, c: number, v: string) => {
      if (r >= MAX_ROWS || c >= MAX_COLS || !v) return;
      while (grid.length <= r) grid.push([]);
      grid[r][c] = { v: /^[=']/.test(v) ? "'" + v : v };
    };
    const putNum = (r: number, c: number, n: number, ixfe: number) => {
      if (r < MAX_ROWS && c < MAX_COLS) {
        while (grid.length <= r) grid.push([]);
        grid[r][c] = { v: num(n, ixfe) };
      }
    };
    let pending: { r: number; c: number } | null = null;
    for (const rec of records(wbs, sh.pos)) {
      const d = rec.data;
      const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
      const rw = d.length >= 4 ? dv.getUint16(0, true) : 0;
      const col = d.length >= 4 ? dv.getUint16(2, true) : 0;
      switch (rec.type) {
        case 0x00fd:
          put(rw, col, sst[dv.getUint32(6, true)] ?? "");
          break;
        case 0x0204:
          put(rw, col, xlString(d, 6));
          break;
        case 0x0203:
          putNum(rw, col, dv.getFloat64(6, true), dv.getUint16(4, true));
          break;
        case 0x027e:
          putNum(rw, col, rkValue(dv.getUint32(6, true)), dv.getUint16(4, true));
          break;
        case 0x00bd: {
          const n = (d.length - 6) / 6;
          for (let k = 0; k < n; k++) putNum(rw, col + k, rkValue(dv.getUint32(4 + k * 6 + 2, true)), dv.getUint16(4 + k * 6, true));
          break;
        }
        case 0x0205:
          put(rw, col, d[7] ? xlsError(d[6]) : d[6] ? "TRUE" : "FALSE");
          break;
        case 0x0006: {
          // 計算結果：最後兩個位元組是 0xFFFF 時不是數字
          if (dv.getUint16(12, true) === 0xffff) {
            const t = d[6];
            if (t === 0) pending = { r: rw, c: col };
            else if (t === 1) put(rw, col, d[8] ? "TRUE" : "FALSE");
            else if (t === 2) put(rw, col, xlsError(d[8]));
          } else putNum(rw, col, dv.getFloat64(6, true), dv.getUint16(4, true));
          break;
        }
        case 0x0207:
          if (pending) put(pending.r, pending.c, xlString(d, 0));
          pending = null;
          break;
        case 0x007d: {
          const c0 = dv.getUint16(0, true);
          const c1 = Math.min(dv.getUint16(2, true), MAX_COLS - 1);
          const w = (dv.getUint16(4, true) / 256) * 7 + 5;
          for (let c = c0; c <= c1; c++) colW[c] = w;
          break;
        }
      }
    }
    for (let r = 0; r < grid.length; r++) grid[r] = Array.from({ length: grid[r]?.length ?? 0 }, (_x, c) => grid[r]?.[c] ?? { v: "" });
    return { name: sh.name, grid, colW };
  });
}
