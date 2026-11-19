import { generalNumber, dateOfSerial } from "./formula";
import {
  allTableNames,
  COL_W,
  key,
  MIN_COL_W,
  newId,
  newTable,
  renameSheet,
  renameTable,
  shiftFormula,
  uniqueName,
  updSheet,
  type Cell,
  type Style,
  type Table,
  type Workbook,
} from "./model";

/**
 * 匯入 .csv／.tsv 與 .xlsx：
 * - CSV：自動判斷逗號或 Tab，支援引號；變成目前工作表上的一個新表格。
 * - XLSX：每張 Excel 工作表變成一張新工作表（裡面一個同名的表格），保留公式（`Sheet1!A1` 改成
 *   `Sheet1::A1`，共用公式展開）、文字、數字、布林、日期／百分比／貨幣格式、粗體斜體與欄寬。
 *   解壓縮用瀏覽器內建的 DecompressionStream，不用額外的套件。
 */

const MAX_ROWS = 5000;
const MAX_COLS = 200;

/* ─── CSV ─── */

export function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, "");
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = (first.match(/\t/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? "\t" : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && !cell) quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLS));
}

/** 一塊格子變成表格：第一列都是文字（而且下面還有資料）就當標題列 */
export function gridToTable(name: string, grid: Cell[][], colW?: number[]): Table {
  const rows = Math.max(2, grid.length);
  const cols = Math.max(1, ...grid.map((r) => r.length));
  const head = grid[0] ?? [];
  const textOnly = grid.length > 1 && head.some((c) => c?.v) && head.every((c) => !c?.v || (!/^[-+$€£¥.\d]/.test(c.v) && !c.v.startsWith("=")));
  const t = newTable(name, 40, 40, rows, cols, textOnly ? 1 : 0, 0);
  grid.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (cell && (cell.v || cell.s)) t.cells[key(r, c)] = cell;
    }),
  );
  t.colW = Array.from({ length: cols }, (_x, c) => {
    if (colW?.[c]) return Math.max(MIN_COL_W, Math.min(600, Math.round(colW[c])));
    const longest = Math.max(0, ...grid.map((r) => (r[c]?.v ?? "").length));
    return Math.max(COL_W, Math.min(320, longest * 7 + 24));
  });
  return t;
}

/** CSV 變成目前工作表最下面的新表格 */
export function importCsv(wb: Workbook, sid: string, fileName: string, text: string, y: number): { wb: Workbook; id: string } {
  const grid = parseCsv(text).map((r) => r.map((v) => ({ v: v.trim() })));
  const t = gridToTable(uniqueName(allTableNames(wb), baseName(fileName)), grid);
  t.y = y;
  return { wb: updSheet(wb, sid, (s) => ({ ...s, tables: [...s.tables, t] })), id: t.id };
}

export const baseName = (f: string) => f.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "").trim() || "Imported";

/* ─── zip ─── */

export async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let e = bytes.length - 22;
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error("This file isn't a valid .xlsx (no zip directory).");
  const count = v.getUint16(e + 10, true);
  let at = v.getUint32(e + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    if (v.getUint32(at, true) !== 0x02014b50) throw new Error("This file isn't a valid .xlsx (broken zip directory).");
    const method = v.getUint16(at + 10, true);
    const size = v.getUint32(at + 20, true);
    const nameLen = v.getUint16(at + 28, true);
    const extra = v.getUint16(at + 30, true);
    const comment = v.getUint16(at + 32, true);
    const local = v.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extra + comment;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, await inflate(data));
    else throw new Error(`Unsupported compression in ${name}.`);
  }
  return out;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(data);
      c.close();
    },
  }).pipeThrough(ds as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ─── xlsx ─── */

export interface ImportedSheet {
  name: string;
  grid: Cell[][];
  colW: number[];
}

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function xml(files: Map<string, Uint8Array>, path: string): Document | null {
  const b = files.get(path);
  return b ? new DOMParser().parseFromString(new TextDecoder().decode(b), "application/xml") : null;
}

const els = (d: Document | Element, tag: string) => [...d.getElementsByTagNameNS(NS, tag)];
const textOf = (el: Element) =>
  // <si> 可能有好幾段 <r><t>…</t></r>；拼音 <rPh> 不算
  els(el, "t")
    .filter((t) => !t.closest("rPh"))
    .map((t) => t.textContent ?? "")
    .join("");

const BUILTIN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

interface Xf {
  kind: "date" | "pct" | "cur" | null;
  cur?: string;
  dec?: number;
  style?: Style;
}

function readStyles(d: Document | null): Xf[] {
  if (!d) return [];
  const custom = new Map<number, string>();
  for (const nf of els(d, "numFmt")) custom.set(Number(nf.getAttribute("numFmtId")), nf.getAttribute("formatCode") ?? "");
  const fonts = els(d, "font").map((f) => ({ b: els(f, "b").length > 0, i: els(f, "i").length > 0, u: els(f, "u").length > 0 }));
  const xfsEl = els(d, "cellXfs")[0];
  if (!xfsEl) return [];
  return els(xfsEl, "xf").map((xf) => {
    const id = Number(xf.getAttribute("numFmtId") ?? 0);
    const code = (custom.get(id) ?? (id === 9 || id === 10 ? (id === 9 ? "0%" : "0.00%") : id === 5 || id === 6 || id === 7 || id === 8 ? "$#,##0.00" : "")).replace(/"[^"]*"|\[[^\]]*\]|\\./g, (m) => (m.startsWith("[$") ? m.slice(2, 3) : m.startsWith('"') ? m : ""));
    const font = fonts[Number(xf.getAttribute("fontId") ?? 0)];
    const align = els(xf, "alignment")[0]?.getAttribute("horizontal");
    const style: Style = {};
    if (font?.b) style.b = true;
    if (font?.i) style.i = true;
    if (font?.u) style.u = true;
    if (align === "left" || align === "center" || align === "right") style.align = align;
    const dec = /0\.(0+)/.exec(code)?.[1].length ?? 0;
    let kind: Xf["kind"] = null;
    let cur: string | undefined;
    if (BUILTIN_DATES.has(id) || (/[dmyhs]/i.test(code.replace(/"[^"]*"/g, "")) && !/^general$/i.test(code))) kind = "date";
    else if (code.includes("%")) kind = "pct";
    else {
      const m = /([$€£¥])|"(NT\$|HK\$|[^"]+)"/.exec(code);
      if (m) {
        kind = "cur";
        cur = m[1] ?? m[2];
      }
    }
    return { kind, cur, dec, style: Object.keys(style).length ? style : undefined };
  });
}

const colIdx = (ref: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
  let c = 0;
  for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64;
  return { r: Number(m[2]) - 1, c: c - 1 };
};

const quoteName = (n: string) => (/['"()+\-*/^&,;<>=:!%{}]/.test(n) || n !== n.trim() ? `'${n.replace(/'/g, "")}'` : n);

/** Excel 的公式 → 這裡的公式：`Sheet1!A1`、`'My sheet'!A1` → `Sheet1::A1`；`$`、函式照舊 */
export function fromExcelFormula(f: string): string {
  return f
    .replace(/(?:'((?:[^']|'')+)'|([A-Za-z_\u0080-￿][\w.\u0080-￿]*))!/g, (_m, q: string | undefined, plain: string | undefined) => quoteName((q ?? plain ?? "").replace(/''/g, "'")) + "::")
    .replace(/_xlfn\./g, "");
}

/** Excel 的日期序號 → `2026-11-19`（有時間就加 `14:30`）；`formats.ts` 的 .xls、.ods 也用 */
export function iso(n: number): string {
  const d = dateOfSerial(n);
  const p = (x: number) => String(x).padStart(2, "0");
  const day = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  const mins = Math.round((n - Math.floor(n)) * 1440);
  return mins ? `${day} ${p(Math.floor(mins / 60) % 24)}:${p(mins % 60)}` : day;
}

export async function readXlsx(bytes: Uint8Array): Promise<ImportedSheet[]> {
  const files = await unzip(bytes);
  const book = xml(files, "xl/workbook.xml");
  if (!book) throw new Error("This file isn't an Excel workbook (no xl/workbook.xml).");
  const rels = xml(files, "xl/_rels/workbook.xml.rels");
  const target = new Map<string, string>();
  for (const r of rels ? [...rels.getElementsByTagName("Relationship")] : []) {
    const t = r.getAttribute("Target") ?? "";
    target.set(r.getAttribute("Id") ?? "", t.startsWith("/") ? t.slice(1) : `xl/${t}`);
  }
  const strings = (xml(files, "xl/sharedStrings.xml") ? els(xml(files, "xl/sharedStrings.xml")!, "si") : []).map(textOf);
  const xfs = readStyles(xml(files, "xl/styles.xml"));
  const out: ImportedSheet[] = [];
  for (const sh of els(book, "sheet")) {
    const name = sh.getAttribute("name") ?? `Sheet ${out.length + 1}`;
    const path = target.get(sh.getAttributeNS(REL, "id") ?? sh.getAttribute("r:id") ?? "");
    const doc = path ? xml(files, path) : null;
    if (!doc) continue;
    const grid: Cell[][] = [];
    const shared = new Map<string, { f: string; r: number; c: number }>();
    for (const c of els(doc, "c")) {
      const ref = c.getAttribute("r");
      if (!ref) continue;
      const { r, c: col } = colIdx(ref);
      if (r >= MAX_ROWS || col >= MAX_COLS) continue;
      const t = c.getAttribute("t");
      const xf = xfs[Number(c.getAttribute("s") ?? 0)];
      const vEl = els(c, "v")[0];
      const raw = vEl?.textContent ?? "";
      const fEl = els(c, "f")[0];
      let formula: string | null = null;
      if (fEl) {
        const si = fEl.getAttribute("si");
        const text = fEl.textContent ?? "";
        if (fEl.getAttribute("t") === "shared" && si !== null) {
          if (text) shared.set(si, { f: text, r, c: col });
          else {
            const m = shared.get(si);
            if (m) formula = shiftFormula(fromExcelFormula(m.f), r - m.r, col - m.c);
          }
        }
        if (text && formula === null) formula = fromExcelFormula(text);
      }
      let v = "";
      const style: Style | undefined = xf?.style ? { ...xf.style } : undefined;
      let s = style;
      if (formula !== null) {
        v = "=" + formula;
        if (xf?.kind === "pct") s = { ...s, fmt: "percent", dec: xf.dec };
        else if (xf?.kind === "cur") s = { ...s, fmt: "currency", dec: xf.dec, cur: xf.cur === "$" ? undefined : xf.cur };
        else if (xf?.kind === "date") s = { ...s, fmt: "date" };
      } else if (t === "s") v = strings[Number(raw)] ?? "";
      else if (t === "inlineStr") v = textOf(c);
      else if (t === "str") v = raw;
      else if (t === "b") v = raw === "1" ? "TRUE" : "FALSE";
      else if (t === "e") v = raw;
      else if (raw) {
        const n = Number(raw);
        if (xf?.kind === "date") v = iso(n);
        else if (xf?.kind === "pct") {
          v = generalNumber(Number((n * 100).toPrecision(12))) + "%";
          if (xf.dec) s = { ...s, fmt: "percent", dec: xf.dec };
        } else if (xf?.kind === "cur") {
          v = n.toString();
          s = { ...s, fmt: "currency", dec: xf.dec, cur: xf.cur === "$" ? undefined : xf.cur };
        } else v = raw;
      }
      // 文字看起來像數字或公式時加 '，保持是文字
      if (t === "s" || t === "inlineStr" || t === "str") if (formula === null && /^[=']/.test(v)) v = "'" + v;
      if (s) for (const k of Object.keys(s) as (keyof Style)[]) if (s[k] === undefined) delete s[k];
      if (!v && !s) continue;
      while (grid.length <= r) grid.push([]);
      grid[r][col] = s && Object.keys(s).length ? { v, s } : { v };
    }
    const colW: number[] = [];
    for (const col of els(doc, "col")) {
      const w = Number(col.getAttribute("width"));
      if (!w) continue;
      for (let i = Number(col.getAttribute("min")) - 1; i < Math.min(Number(col.getAttribute("max")), MAX_COLS); i++) colW[i] = w * 7 + 5;
    }
    // 補洞（稀疏陣列 → 空格）
    for (let r = 0; r < grid.length; r++) grid[r] = Array.from({ length: grid[r]?.length ?? 0 }, (_x, c) => grid[r]?.[c] ?? { v: "" });
    out.push({ name, grid, colW });
  }
  return out;
}

/**
 * 匯入的 Excel 工作表加成新的工作表（每張一個同名表格，公式的 `Sheet1::A1` 就指到它）。
 * 目前的試算表還是全新空白的話，直接換掉。回傳第一張新工作表的 id。
 */
export function addImported(wb: Workbook, sheets: ImportedSheet[]): { wb: Workbook; id: string } {
  // 先用檔案裡原本的名稱組成一份活頁簿（公式的 `Sheet1::A1` 指得到），再接到目前的活頁簿
  const own: Workbook = {
    sheets: sheets.map((im) => ({ id: newId(), name: im.name, tables: [gridToTable(im.name, im.grid.length ? im.grid : [[{ v: "" }]], im.colW)], charts: [] })),
  };
  return appendWorkbook(wb, own);
}

/** 活頁簿是不是全新空白的（只有一張工作表、沒有圖表、表格都沒有內容） */
export const isBlankWorkbook = (wb: Workbook) =>
  wb.sheets.length === 1 && wb.sheets[0].charts.length === 0 && wb.sheets[0].tables.every((t) => !Object.keys(t.cells).length);

/**
 * 把另一份活頁簿的工作表接在後面（目前的活頁簿還是全新空白就直接換掉）。工作表、表格、圖表都換新的 id
 * （同一份內容接兩次也不會撞 id）；跟目前活頁簿撞名的工作表與表格改名——renameSheet／renameTable
 * 會一起改寫公式，不會指到原本就有的同名工作表。回傳第一張接上的工作表。
 */
export function appendWorkbook(wb: Workbook, src: Workbook): { wb: Workbook; id: string } {
  const base: Workbook = isBlankWorkbook(wb) ? { sheets: [] } : wb;
  const tableIds = new Map<string, string>();
  let own: Workbook = {
    sheets: src.sheets.map((s) => ({
      ...s,
      id: newId(),
      tables: s.tables.map((t) => {
        const id = newId();
        tableIds.set(t.id, id);
        return { ...t, id };
      }),
      charts: [],
    })),
  };
  // 圖表指向表格的 id 跟著換
  own = { sheets: own.sheets.map((s, i) => ({ ...s, charts: src.sheets[i].charts.map((c) => ({ ...c, id: newId(), table: tableIds.get(c.table) ?? c.table })) })) };
  if (!own.sheets.length) return { wb, id: "" };
  const sheetNames = [...base.sheets.map((s) => s.name), ...own.sheets.map((s) => s.name)];
  const tableNames = [...allTableNames(base), ...allTableNames(own)];
  const taken = (names: string[], n: string) => names.filter((x) => x.toLowerCase() === n.toLowerCase()).length > 1;
  for (const s of own.sheets) {
    if (taken(sheetNames, s.name)) {
      const to = uniqueName(sheetNames, s.name);
      sheetNames.push(to);
      own = renameSheet(own, s.id, to);
    }
    for (const t of s.tables) {
      if (!taken(tableNames, t.name)) continue;
      const to = uniqueName(tableNames, t.name);
      tableNames.push(to);
      own = renameTable(own, t.id, to);
    }
  }
  return { wb: { sheets: [...base.sheets, ...own.sheets] }, id: own.sheets[0].id };
}
