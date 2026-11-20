import { mapRefs, parseNumber, type Ref } from "./formula";

/**
 * 試算表（參考 Numbers）：Dock 的一種文件（`kind: "sheet"`，介面叫 Excel）。純函式。
 *
 * - 活頁簿有好幾張工作表（上方分頁）；每張工作表是一張畫布，上面自由擺放表格與圖表。
 * - 表格有標題列（`hr`）、標題欄（`hc`）、表尾列（`fr`）；格子存使用者打的原始文字 `v`
 *   （`=` 開頭是公式，`'` 開頭強制當文字），值在 `calc.ts` 算。
 * - 格子的鍵是「列,欄」（從 0 開始）；沒有內容也沒有樣式的格子不存。
 * - 插入、刪除列欄時，整本活頁簿裡指向這個表格的公式參照一起改（`shiftRefs`）。
 */

export type Fmt = "auto" | "number" | "currency" | "percent" | "date" | "checkbox" | "stars" | "text" | "popup";
export type Align = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";
/** 框線：工具列的選項；存在格子上的是 `bd`（t、r、b、l 四邊的字母） */
export const BORDERS = ["all", "outer", "inner", "top", "bottom", "left", "right", "none"] as const;
export type BorderMode = (typeof BORDERS)[number];

export interface Style {
  fmt?: Fmt;
  /** 小數位數（沒有：自動） */
  dec?: number;
  /** 貨幣符號 */
  cur?: string;
  /** 千分位 */
  sep?: boolean;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  align?: Align;
  color?: string;
  fill?: string;
  /** 刪除線 */
  st?: boolean;
  /** 字級（px；沒有是預設 13） */
  fs?: number;
  /** 垂直對齊（沒有是置中） */
  va?: VAlign;
  /** 自動換行 */
  wrap?: boolean;
  /** 框線：有哪幾邊（"trbl" 的子集） */
  bd?: string;
  /** 下拉選單的選項（格式 popup，像 Excel／Google 試算表的資料驗證） */
  opts?: string[];
}

export interface Cell {
  v: string;
  s?: Style;
  /** 附註（滑過格子顯示，右上角有紅色三角形） */
  n?: string;
}

export const THEMES = ["gray", "blue", "green", "orange", "red", "purple"] as const;
export type Theme = (typeof THEMES)[number];

/** 篩選與醒目提示的條件 */
export const COND_OPS = ["gt", "gte", "lt", "lte", "eq", "neq", "between", "contains", "notContains", "begins", "empty", "notEmpty", "dup"] as const;
export type CondOp = (typeof COND_OPS)[number];

export interface Cond {
  op: CondOp;
  value: string;
  /** between 的上限 */
  value2?: string;
}

/** 篩選：這一欄符合條件的列才顯示 */
export interface Filter extends Cond {
  col: number;
}

export const LOOKS = ["red", "yellow", "green", "blue", "purple", "redText", "greenText", "bold"] as const;
export type Look = (typeof LOOKS)[number];

/** 條件式醒目提示：範圍裡符合條件的格子套用 look */
export interface Rule extends Cond, Rect {
  id: string;
  look: Look;
}

export interface Table {
  id: string;
  name: string;
  showName: boolean;
  x: number;
  y: number;
  rows: number;
  cols: number;
  /** 標題列、標題欄、表尾列的數目 */
  hr: number;
  hc: number;
  fr: number;
  colW: number[];
  cells: Record<string, Cell>;
  theme: Theme;
  /** 交錯的列底色 */
  banded: boolean;
  /** 改過的列高（鍵是列，沒有的是 ROW_H） */
  rowH: Record<string, number>;
  /** 篩選（全部符合才顯示，只看內文列）；filterOn 關掉時規則留著 */
  filters: Filter[];
  filterOn: boolean;
  /** 條件式醒目提示 */
  rules: Rule[];
  /** 合併的格子（左上角那格是內容） */
  merges?: Rect[];
  /** 藏起來的列、欄 */
  hideR?: number[];
  hideC?: number[];
}

export const CHART_TYPES = ["column", "bar", "line", "area", "pie"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export interface Chart {
  id: string;
  type: ChartType;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 資料來源：表格與範圍（含端點） */
  table: string;
  r0: number;
  c0: number;
  r1: number;
  c1: number;
  legend: boolean;
  /** true：每一列是一組數列；false：每一欄是一組 */
  byRow: boolean;
}

export interface Sheet {
  id: string;
  name: string;
  tables: Table[];
  charts: Chart[];
}

export interface Workbook {
  sheets: Sheet[];
}

export interface Rect {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

export const ROW_H = 28;
export const MIN_ROW_H = 18;
export const COL_W = 110;
export const MIN_COL_W = 36;

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const key = (r: number, c: number) => `${r},${c}`;
export const unkey = (k: string): [number, number] => {
  const [r, c] = k.split(",").map(Number);
  return [r, c];
};
export const norm = (a: { r: number; c: number }, b: { r: number; c: number }): Rect => ({
  r0: Math.min(a.r, b.r),
  c0: Math.min(a.c, b.c),
  r1: Math.max(a.r, b.r),
  c1: Math.max(a.c, b.c),
});

/* ─── 建立 ─── */

export function newTable(name: string, x = 40, y = 40, rows = 10, cols = 5, hr = 1, hc = 1): Table {
  return {
    id: newId(),
    name,
    showName: true,
    x,
    y,
    rows,
    cols,
    hr: Math.min(hr, rows),
    hc: Math.min(hc, cols),
    fr: 0,
    colW: Array.from({ length: cols }, () => COL_W),
    cells: {},
    theme: "blue",
    banded: false,
    rowH: {},
    filters: [],
    filterOn: false,
    rules: [],
  };
}

export const newSheet = (name: string): Sheet => ({ id: newId(), name, tables: [newTable("Table 1")], charts: [] });

export const newWorkbook = (): Workbook => ({ sheets: [newSheet("Sheet 1")] });

/** 一張表：第一列是欄名，下面是資料（轉換舊資料、白板卡片用） */
export function gridTable(name: string, header: string[], rows: string[][], styles: (Style | undefined)[] = []): Table {
  const cols = Math.max(1, header.length, ...rows.map((r) => r.length));
  const t = newTable(name, 40, 40, Math.max(2, rows.length + 1), cols, 1, 0);
  header.forEach((h, c) => h && (t.cells[key(0, c)] = { v: h }));
  rows.forEach((row, r) =>
    row.forEach((v, c) => {
      const s = styles[c];
      if (v || s) t.cells[key(r + 1, c)] = s ? { v, s } : { v };
    }),
  );
  t.colW = Array.from({ length: cols }, (_x, c) => Math.min(320, Math.max(COL_W, ...[header[c] ?? "", ...rows.map((r) => r[c] ?? "")].map((v) => v.length * 7 + 24))));
  return t;
}

/* ─── 讀寫 ─── */

const numOr = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const intIn = (v: unknown, d: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(numOr(v, d))));
const strOr = (v: unknown, d: string) => (typeof v === "string" ? v : d);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

const FMTS: Fmt[] = ["auto", "number", "currency", "percent", "date", "checkbox", "stars", "text", "popup"];

function parseStyle(raw: unknown): Style | undefined {
  const o = obj(raw);
  const s: Style = {};
  if (FMTS.includes(o.fmt as Fmt) && o.fmt !== "auto") s.fmt = o.fmt as Fmt;
  if (typeof o.dec === "number") s.dec = intIn(o.dec, 2, 0, 10);
  if (typeof o.cur === "string" && o.cur) s.cur = o.cur.slice(0, 4);
  if (o.sep === true) s.sep = true;
  if (o.b === true) s.b = true;
  if (o.i === true) s.i = true;
  if (o.u === true) s.u = true;
  if (o.align === "left" || o.align === "center" || o.align === "right") s.align = o.align;
  if (typeof o.color === "string" && o.color) s.color = o.color;
  if (typeof o.fill === "string" && o.fill) s.fill = o.fill;
  if (o.st === true) s.st = true;
  if (typeof o.fs === "number") s.fs = intIn(o.fs, 13, 8, 48);
  if (o.va === "top" || o.va === "bottom") s.va = o.va;
  if (o.wrap === true) s.wrap = true;
  if (typeof o.bd === "string") {
    const bd = [..."trbl"].filter((x) => (o.bd as string).includes(x)).join("");
    if (bd) s.bd = bd;
  }
  if (Array.isArray(o.opts)) {
    const opts = o.opts.filter((x): x is string => typeof x === "string").slice(0, 200);
    if (opts.length) s.opts = opts;
  }
  return Object.keys(s).length ? s : undefined;
}

function parseTable(raw: unknown, i: number): Table {
  const o = obj(raw);
  const rows = intIn(o.rows, 10, 1, 5000);
  const cols = intIn(o.cols, 5, 1, 200);
  const colW = Array.isArray(o.colW) ? o.colW : [];
  const cells: Record<string, Cell> = {};
  for (const [k, v] of Object.entries(obj(o.cells))) {
    const m = /^(\d+),(\d+)$/.exec(k);
    if (!m || Number(m[1]) >= rows || Number(m[2]) >= cols) continue;
    const c = obj(v);
    const cell: Cell = { v: strOr(c.v, "") };
    const s = parseStyle(c.s);
    if (s) cell.s = s;
    if (typeof c.n === "string" && c.n.trim()) cell.n = c.n;
    if (cell.v || cell.s || cell.n) cells[k] = cell;
  }
  const hr = intIn(o.hr, 1, 0, Math.min(5, rows));
  return {
    id: strOr(o.id, "") || newId(),
    name: strOr(o.name, "").trim() || `Table ${i + 1}`,
    showName: o.showName !== false,
    x: numOr(o.x, 40),
    y: numOr(o.y, 40),
    rows,
    cols,
    hr,
    hc: intIn(o.hc, 0, 0, Math.min(5, cols)),
    fr: intIn(o.fr, 0, 0, Math.min(5, rows - hr)),
    colW: Array.from({ length: cols }, (_x, c) => intIn(colW[c], COL_W, MIN_COL_W, 1200)),
    cells,
    theme: THEMES.includes(o.theme as Theme) ? (o.theme as Theme) : "blue",
    banded: o.banded === true,
    rowH: Object.fromEntries(
      Object.entries(obj(o.rowH))
        .filter(([k, h]) => /^\d+$/.test(k) && Number(k) < rows && typeof h === "number")
        .map(([k, h]) => [k, intIn(h, ROW_H, MIN_ROW_H, 400)]),
    ),
    filters: (Array.isArray(o.filters) ? o.filters : [])
      .map(obj)
      .map((f) => ({ ...parseCond(f), col: intIn(f.col, 0, 0, cols - 1) }))
      .filter((f): f is Filter => f.op !== null) as Filter[],
    filterOn: o.filterOn === true,
    rules: (Array.isArray(o.rules) ? o.rules : [])
      .map(obj)
      .map((r) => ({
        ...parseCond(r),
        id: strOr(r.id, "") || newId(),
        r0: intIn(r.r0, 0, 0, rows - 1),
        c0: intIn(r.c0, 0, 0, cols - 1),
        r1: intIn(r.r1, 0, 0, rows - 1),
        c1: intIn(r.c1, 0, 0, cols - 1),
        look: LOOKS.includes(r.look as Look) ? (r.look as Look) : "red",
      }))
      .filter((r): r is Rule => r.op !== null) as Rule[],
    ...extras(o, rows, cols),
  };
}

/** 合併、藏起來的列欄（沒有就不寫，舊檔案照樣讀） */
function extras(o: Record<string, unknown>, rows: number, cols: number): Pick<Table, "merges" | "hideR" | "hideC"> {
  const out: Pick<Table, "merges" | "hideR" | "hideC"> = {};
  const merges = (Array.isArray(o.merges) ? o.merges : [])
    .map(obj)
    .map((m) => ({ r0: intIn(m.r0, 0, 0, rows - 1), c0: intIn(m.c0, 0, 0, cols - 1), r1: intIn(m.r1, 0, 0, rows - 1), c1: intIn(m.c1, 0, 0, cols - 1) }))
    .filter((m) => m.r1 >= m.r0 && m.c1 >= m.c0 && (m.r1 > m.r0 || m.c1 > m.c0));
  if (merges.length) out.merges = merges;
  const idx = (v: unknown, n: number) => [...new Set((Array.isArray(v) ? v : []).filter((x): x is number => Number.isInteger(x) && x >= 0 && x < n))].sort((a, b) => a - b);
  const hr = idx(o.hideR, rows);
  const hc = idx(o.hideC, cols);
  if (hr.length) out.hideR = hr;
  if (hc.length && hc.length < cols) out.hideC = hc;
  return out;
}

function parseCond(o: Record<string, unknown>): { op: CondOp | null; value: string; value2?: string } {
  const out: { op: CondOp | null; value: string; value2?: string } = {
    op: COND_OPS.includes(o.op as CondOp) ? (o.op as CondOp) : null,
    value: strOr(o.value, ""),
  };
  if (typeof o.value2 === "string") out.value2 = o.value2;
  return out;
}

function parseChart(raw: unknown): Chart | null {
  const o = obj(raw);
  if (typeof o.table !== "string") return null;
  return {
    id: strOr(o.id, "") || newId(),
    type: CHART_TYPES.includes(o.type as ChartType) ? (o.type as ChartType) : "column",
    title: strOr(o.title, ""),
    x: numOr(o.x, 40),
    y: numOr(o.y, 40),
    w: intIn(o.w, 420, 160, 2000),
    h: intIn(o.h, 280, 120, 2000),
    table: o.table,
    r0: intIn(o.r0, 0, 0, 5000),
    c0: intIn(o.c0, 0, 0, 200),
    r1: intIn(o.r1, 0, 0, 5000),
    c1: intIn(o.c1, 0, 0, 200),
    legend: o.legend !== false,
    byRow: o.byRow === true,
  };
}

export function parseWorkbook(json: string): Workbook {
  let raw: unknown;
  try {
    raw = JSON.parse(json || "null");
  } catch {
    return newWorkbook();
  }
  const sheets = Array.isArray(obj(raw).sheets) ? (obj(raw).sheets as unknown[]) : [];
  if (!sheets.length) return newWorkbook();
  return {
    sheets: sheets.map((s, i) => {
      const o = obj(s);
      return {
        id: strOr(o.id, "") || newId(),
        name: strOr(o.name, "").trim() || `Sheet ${i + 1}`,
        tables: (Array.isArray(o.tables) ? o.tables : []).map(parseTable),
        charts: (Array.isArray(o.charts) ? o.charts : []).map(parseChart).filter((c): c is Chart => !!c),
      };
    }),
  };
}

export const serializeWorkbook = (wb: Workbook) => JSON.stringify(wb);

/* ─── 找東西 ─── */

export function findTable(wb: Workbook, id: string): { sheet: Sheet; table: Table } | null {
  for (const sheet of wb.sheets) {
    const table = sheet.tables.find((t) => t.id === id);
    if (table) return { sheet, table };
  }
  return null;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** 公式裡的參照指向哪個表格（從公式所在的工作表、表格出發）；找不到回傳 null。 */
export function resolveTable(wb: Workbook, sheet: Sheet, table: Table, ref: Ref): { sheet: Sheet; table: Table } | null {
  if (!ref.table) return { sheet, table };
  if (ref.sheet) {
    const s = wb.sheets.find((x) => same(x.name, ref.sheet!));
    const t = s?.tables.find((x) => same(x.name, ref.table!));
    return s && t ? { sheet: s, table: t } : null;
  }
  const here = sheet.tables.find((x) => same(x.name, ref.table!));
  if (here) return { sheet, table: here };
  // 表格名稱在整本活頁簿裡找（Numbers 的表格名稱通常不重複）
  for (const s of wb.sheets) {
    const t = s.tables.find((x) => same(x.name, ref.table!));
    if (t) return { sheet: s, table: t };
  }
  return null;
}

/** 表格名稱不重複：「Table 1」、「Table 2」… */
export function freeName(names: string[], base: string): string {
  const used = new Set(names.map((n) => n.toLowerCase()));
  for (let i = 1; ; i++) if (!used.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

/** 沒用過就用 base，否則「base 2」、「base 3」… */
export function uniqueName(names: string[], base: string): string {
  const used = new Set(names.map((n) => n.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!used.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

export const allTableNames = (wb: Workbook) => wb.sheets.flatMap((s) => s.tables.map((t) => t.name));

/* ─── 改東西 ─── */

export function mapTables(wb: Workbook, fn: (t: Table, s: Sheet) => Table): Workbook {
  return { sheets: wb.sheets.map((s) => ({ ...s, tables: s.tables.map((t) => fn(t, s)) })) };
}

export const updTable = (wb: Workbook, id: string, fn: (t: Table) => Table) => mapTables(wb, (t) => (t.id === id ? fn(t) : t));

export const updSheet = (wb: Workbook, id: string, fn: (s: Sheet) => Sheet): Workbook => ({ sheets: wb.sheets.map((s) => (s.id === id ? fn(s) : s)) });

export const patchTable = (wb: Workbook, id: string, patch: Partial<Omit<Table, "id">>) => updTable(wb, id, (t) => fixTable({ ...t, ...patch }));

/** 標題、表尾的數目不超過表格大小 */
function fixTable(t: Table): Table {
  const hr = Math.max(0, Math.min(t.hr, t.rows, 5));
  return { ...t, hr, hc: Math.max(0, Math.min(t.hc, t.cols, 5)), fr: Math.max(0, Math.min(t.fr, t.rows - hr, 5)) };
}

function withCell(t: Table, r: number, c: number, cell: Cell | null): Table {
  const k = key(r, c);
  const cells = { ...t.cells };
  if (cell && (cell.v || cell.n || (cell.s && Object.keys(cell.s).length))) cells[k] = cell;
  else delete cells[k];
  return { ...t, cells };
}

/** 改一格的文字（保留樣式） */
export function setCell(wb: Workbook, tid: string, r: number, c: number, v: string): Workbook {
  return updTable(wb, tid, (t) => {
    if (r >= t.rows || c >= t.cols) return t;
    const old = t.cells[key(r, c)];
    return withCell(t, r, c, { ...old, v });
  });
}

/**
 * 從 (r, c) 開始貼上一塊文字（表格不夠大就長大）。
 * from：複製來源的左上角，公式的相對參照照位移調整（像 Excel）。
 */
export function pasteGrid(
  wb: Workbook,
  tid: string,
  r: number,
  c: number,
  grid: { v: string; s?: Style }[][],
  from?: { r: number; c: number },
): Workbook {
  return updTable(wb, tid, (t0) => {
    const rows = Math.max(t0.rows, r + grid.length);
    const cols = Math.max(t0.cols, c + Math.max(0, ...grid.map((g) => g.length)));
    let t: Table = { ...t0, rows, cols, colW: Array.from({ length: cols }, (_x, i) => t0.colW[i] ?? COL_W) };
    grid.forEach((row, dr) =>
      row.forEach((cell, dc) => {
        let v = cell.v;
        if (from && v.startsWith("=")) v = "=" + shiftFormula(v.slice(1), r - from.r, c - from.c);
        const keepStyle = cell.s ?? (from ? undefined : t.cells[key(r + dr, c + dc)]?.s);
        t = withCell(t, r + dr, c + dc, keepStyle ? { v, s: keepStyle } : { v });
      }),
    );
    return t;
  });
}

/** 清掉範圍的內容（styles：連樣式一起） */
export function clearRange(wb: Workbook, tid: string, rect: Rect, styles = false): Workbook {
  return updTable(wb, tid, (t) => {
    const cells = { ...t.cells };
    for (let r = rect.r0; r <= rect.r1; r++)
      for (let c = rect.c0; c <= rect.c1; c++) {
        const k = key(r, c);
        if (!cells[k]) continue;
        if (styles || (!cells[k].s && !cells[k].n)) delete cells[k];
        else cells[k] = { v: "", ...(cells[k].s ? { s: cells[k].s } : {}), ...(cells[k].n ? { n: cells[k].n } : {}) };
      }
    return { ...t, cells };
  });
}

/** 範圍套用樣式；patch 裡值是 undefined 的鍵拿掉 */
export function styleRange(wb: Workbook, tid: string, rect: Rect, patch: Partial<Record<keyof Style, unknown>>): Workbook {
  return updTable(wb, tid, (t) => {
    let out = t;
    for (let r = rect.r0; r <= Math.min(rect.r1, t.rows - 1); r++)
      for (let c = rect.c0; c <= Math.min(rect.c1, t.cols - 1); c++) {
        const old = out.cells[key(r, c)];
        const s: Record<string, unknown> = { ...old?.s };
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined || v === false || v === "") delete s[k];
          else s[k] = v;
        }
        if (s.fmt === "auto") delete s.fmt;
        out = withCell(out, r, c, { ...old, v: old?.v ?? "", s: Object.keys(s).length ? (s as Style) : undefined });
      }
    return out;
  });
}

/** 公式的相對參照位移 dr 列、dc 欄（複製、填滿、排序用）；超出表格左上就 #REF! */
export function shiftFormula(src: string, dr: number, dc: number): string {
  if (!dr && !dc) return src;
  return mapRefs(src, (ref) => {
    const col = ref.absC ? ref.col : ref.col + dc;
    const row = ref.row === null || ref.absR ? ref.row : ref.row + dr;
    if (col < 0 || (row !== null && row < 0)) return "#REF!";
    return { ...ref, col, row };
  });
}

/** 往下（或往右）填滿：用範圍第一列（或第一欄）的內容 */
export function fill(wb: Workbook, tid: string, rect: Rect, dir: "down" | "right"): Workbook {
  return updTable(wb, tid, (t) => {
    let out = t;
    for (let r = rect.r0; r <= rect.r1; r++)
      for (let c = rect.c0; c <= rect.c1; c++) {
        const sr = dir === "down" ? rect.r0 : r;
        const sc = dir === "right" ? rect.c0 : c;
        if (sr === r && sc === c) continue;
        const src = t.cells[key(sr, sc)];
        let v = src?.v ?? "";
        if (v.startsWith("=")) v = "=" + shiftFormula(v.slice(1), r - sr, c - sc);
        out = withCell(out, r, c, src ? { ...src, v } : null);
      }
    return out;
  });
}

/* ─── 插入、刪除列欄（連公式參照與圖表一起改） ─── */

/**
 * 整本活頁簿裡，指向表格 tid 的參照沿著 axis 調整：插入（n > 0）時 at 以後的往後移；
 * 刪除（n < 0，刪 [at, at−n)）時指向被刪格子的變成 #REF!，範圍縮小。
 */
function shiftRefs(wb: Workbook, tid: string, axis: "row" | "col", at: number, n: number): Workbook {
  const move = (i: number): number | null => (n > 0 ? (i >= at ? i + n : i) : i < at ? i : i < at - n ? null : i + n);
  return mapTables(wb, (t, s) => {
    let changed = false;
    const cells: Record<string, Cell> = {};
    for (const [k, cell] of Object.entries(t.cells)) {
      if (!cell.v.startsWith("=")) {
        cells[k] = cell;
        continue;
      }
      const hits = (ref: Ref) => resolveTable(wb, s, t, ref)?.table.id === tid;
      const v =
        "=" +
        mapRefs(
          cell.v.slice(1),
          (ref) => {
            if (!hits(ref)) return null;
            const i = axis === "row" ? ref.row : ref.col;
            if (i === null) return null;
            const j = move(i);
            if (j === null) return "#REF!";
            if (j === i) return null;
            return axis === "row" ? { ...ref, row: j } : { ...ref, col: j };
          },
          (a, b) => {
            if (!hits(a)) return null;
            const ia = axis === "row" ? a.row : a.col;
            const ib = axis === "row" ? b.row : b.col;
            if (ia === null || ib === null) return null;
            let ja: number, jb: number;
            if (n > 0) {
              ja = ia >= at ? ia + n : ia;
              jb = ib >= at ? ib + n : ib;
            } else {
              const end = at - n;
              ja = ia < at ? ia : ia < end ? at : ia + n;
              jb = ib < at ? ib : ib < end ? at - 1 : ib + n;
              if (jb < ja) return "#REF!";
            }
            if (ja === ia && jb === ib) return null;
            return axis === "row" ? [{ ...a, row: ja }, { ...b, row: jb }] : [{ ...a, col: ja }, { ...b, col: jb }];
          },
        );
      if (v !== cell.v) changed = true;
      cells[k] = v === cell.v ? cell : { ...cell, v };
    }
    return changed ? { ...t, cells } : t;
  });
}

/** 列高的鍵跟著插入（n > 0）或刪除（n < 0）搬 */
function shiftKeys(m: Record<string, number>, at: number, n: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, h] of Object.entries(m)) {
    const i = Number(k);
    if (n > 0) out[i >= at ? i + n : i] = h;
    else if (i < at) out[i] = h;
    else if (i >= at - n) out[i + n] = h;
  }
  return out;
}

/** 醒目提示的範圍跟著插入、刪除列欄調整（整個被刪掉就拿掉） */
function shiftRules(rules: Rule[], axis: "row" | "col", at: number, n: number): Rule[] {
  const f = (i: number, end: boolean) => {
    if (n > 0) return i >= at ? i + n : i;
    const stop = at - n;
    return i < at ? i : i < stop ? (end ? at - 1 : at) : i + n;
  };
  return rules
    .map((r) => (axis === "row" ? { ...r, r0: f(r.r0, false), r1: f(r.r1, true) } : { ...r, c0: f(r.c0, false), c1: f(r.c1, true) }))
    .filter((r) => r.r1 >= r.r0 && r.c1 >= r.c0);
}

/** 合併的範圍跟著插入、刪除列欄調整（只剩一格就不算合併） */
function shiftMerges(ms: Rect[] | undefined, axis: "row" | "col", at: number, n: number): Rect[] | undefined {
  if (!ms?.length) return ms;
  const out = shiftRules(ms.map((m) => ({ ...m, id: "", look: "red", op: "eq", value: "" }) as Rule), axis, at, n)
    .map(({ r0, c0, r1, c1 }) => ({ r0, c0, r1, c1 }))
    .filter((m) => m.r1 > m.r0 || m.c1 > m.c0);
  return out.length ? out : undefined;
}

/** 藏起來的列（欄）號跟著插入、刪除調整 */
function shiftIdx(xs: number[] | undefined, at: number, n: number): number[] | undefined {
  if (!xs?.length) return xs;
  const out = xs.flatMap((i) => (n > 0 ? [i >= at ? i + n : i] : i < at ? [i] : i < at - n ? [] : [i + n]));
  return out.length ? out : undefined;
}

function moveCells(t: Table, axis: "row" | "col", at: number, n: number): Record<string, Cell> {
  const out: Record<string, Cell> = {};
  for (const [k, cell] of Object.entries(t.cells)) {
    const [r, c] = unkey(k);
    const i = axis === "row" ? r : c;
    let j = i;
    if (n > 0) j = i >= at ? i + n : i;
    else if (i >= at && i < at - n) continue;
    else if (i >= at - n) j = i + n;
    out[axis === "row" ? key(j, c) : key(r, j)] = cell;
  }
  return out;
}

function shiftCharts(wb: Workbook, tid: string, axis: "row" | "col", at: number, n: number): Workbook {
  const f = (i: number, end: boolean) => {
    if (n > 0) return i >= at ? i + n : i;
    const stop = at - n;
    return i < at ? i : i < stop ? (end ? at - 1 : at) : i + n;
  };
  return {
    sheets: wb.sheets.map((s) => ({
      ...s,
      charts: s.charts
        .map((ch) => {
          if (ch.table !== tid) return ch;
          const out =
            axis === "row" ? { ...ch, r0: f(ch.r0, false), r1: f(ch.r1, true) } : { ...ch, c0: f(ch.c0, false), c1: f(ch.c1, true) };
          return out;
        })
        .filter((ch) => ch.r1 >= ch.r0 && ch.c1 >= ch.c0),
    })),
  };
}

export function insertRows(wb: Workbook, tid: string, at: number, n = 1): Workbook {
  const hit = findTable(wb, tid);
  if (!hit || n <= 0) return wb;
  const t = hit.table;
  let out = shiftRefs(wb, tid, "row", at, n);
  out = shiftCharts(out, tid, "row", at, n);
  return updTable(out, tid, (x) => ({
    ...x,
    rows: x.rows + n,
    cells: moveCells(x, "row", at, n),
    rowH: shiftKeys(x.rowH, at, n),
    rules: shiftRules(x.rules, "row", at, n),
    merges: shiftMerges(x.merges, "row", at, n),
    hideR: shiftIdx(x.hideR, at, n),
    // 插在標題列裡面：標題列變多；插在表尾裡面：表尾變多
    hr: at < t.hr ? x.hr + n : x.hr,
    fr: t.fr && at > t.rows - t.fr ? x.fr + n : x.fr,
  }));
}

export function deleteRows(wb: Workbook, tid: string, at: number, n = 1): Workbook {
  const hit = findTable(wb, tid);
  if (!hit) return wb;
  const t = hit.table;
  n = Math.min(n, t.rows - at, t.rows - 1);
  if (n <= 0) return wb;
  const overlap = (lo: number, hi: number) => Math.max(0, Math.min(hi, at + n) - Math.max(lo, at));
  let out = shiftRefs(wb, tid, "row", at, -n);
  out = shiftCharts(out, tid, "row", at, -n);
  return updTable(out, tid, (x) => ({
    ...x,
    rows: x.rows - n,
    cells: moveCells(x, "row", at, -n),
    rowH: shiftKeys(x.rowH, at, -n),
    rules: shiftRules(x.rules, "row", at, -n),
    merges: shiftMerges(x.merges, "row", at, -n),
    hideR: shiftIdx(x.hideR, at, -n),
    hr: x.hr - overlap(0, t.hr),
    fr: x.fr - overlap(t.rows - t.fr, t.rows),
  }));
}

export function insertCols(wb: Workbook, tid: string, at: number, n = 1): Workbook {
  const hit = findTable(wb, tid);
  if (!hit || n <= 0) return wb;
  const t = hit.table;
  let out = shiftRefs(wb, tid, "col", at, n);
  out = shiftCharts(out, tid, "col", at, n);
  return updTable(out, tid, (x) => {
    const colW = [...x.colW];
    colW.splice(at, 0, ...Array.from({ length: n }, () => x.colW[Math.min(at, x.cols - 1)] ?? COL_W));
    return {
      ...x,
      cols: x.cols + n,
      colW,
      cells: moveCells(x, "col", at, n),
      hc: at < t.hc ? x.hc + n : x.hc,
      filters: x.filters.map((f) => (f.col >= at ? { ...f, col: f.col + n } : f)),
      rules: shiftRules(x.rules, "col", at, n),
      merges: shiftMerges(x.merges, "col", at, n),
      hideC: shiftIdx(x.hideC, at, n),
    };
  });
}

export function deleteCols(wb: Workbook, tid: string, at: number, n = 1): Workbook {
  const hit = findTable(wb, tid);
  if (!hit) return wb;
  const t = hit.table;
  n = Math.min(n, t.cols - at, t.cols - 1);
  if (n <= 0) return wb;
  let out = shiftRefs(wb, tid, "col", at, -n);
  out = shiftCharts(out, tid, "col", at, -n);
  return updTable(out, tid, (x) => {
    const colW = [...x.colW];
    colW.splice(at, n);
    return {
      ...x,
      cols: x.cols - n,
      colW,
      cells: moveCells(x, "col", at, -n),
      hc: x.hc - Math.max(0, Math.min(t.hc, at + n) - at),
      filters: x.filters.filter((f) => f.col < at || f.col >= at + n).map((f) => (f.col >= at + n ? { ...f, col: f.col - n } : f)),
      rules: shiftRules(x.rules, "col", at, -n),
      merges: shiftMerges(x.merges, "col", at, -n),
      hideC: shiftIdx(x.hideC, at, -n),
    };
  });
}

/** 拖右下角改表格大小：在最後面加或刪列欄（刪的時候連內容一起刪） */
export function resizeTable(wb: Workbook, tid: string, rows: number, cols: number): Workbook {
  const hit = findTable(wb, tid);
  if (!hit) return wb;
  const t = hit.table;
  rows = Math.max(1, Math.min(5000, rows));
  cols = Math.max(1, Math.min(200, cols));
  let out = wb;
  // 有表尾的話，新的列加在表尾前面
  const bodyEnd = t.rows - t.fr;
  if (rows > t.rows) out = insertRows(out, tid, bodyEnd, rows - t.rows);
  else if (rows < t.rows) out = deleteRows(out, tid, Math.max(t.hr, bodyEnd - (t.rows - rows)), t.rows - rows);
  if (cols > t.cols) out = insertCols(out, tid, t.cols, cols - t.cols);
  else if (cols < t.cols) out = deleteCols(out, tid, cols, t.cols - cols);
  return out;
}

/** 內文列（不含標題、表尾）排序；valueOf 是每一列算好的排序鍵（數字排在文字前、空的排最後） */
export function sortBody(wb: Workbook, tid: string, desc: boolean, valueOf: (r: number) => number | string | null): Workbook {
  return updTable(wb, tid, (t) => {
    const start = t.hr;
    const end = t.rows - t.fr;
    const idx = Array.from({ length: end - start }, (_x, i) => start + i);
    const keyOf = new Map(idx.map((r) => [r, valueOf(r)]));
    idx.sort((a, b) => {
      const x = keyOf.get(a)!;
      const y = keyOf.get(b)!;
      if (x === null || x === "") return y === null || y === "" ? a - b : 1;
      if (y === null || y === "") return -1;
      let d: number;
      if (typeof x === "number" && typeof y === "number") d = x - y;
      else if (typeof x === "number") d = -1;
      else if (typeof y === "number") d = 1;
      else d = x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
      return (desc ? -d : d) || a - b;
    });
    const cells: Record<string, Cell> = {};
    for (const [k, cell] of Object.entries(t.cells)) {
      const [r] = unkey(k);
      if (r < start || r >= end) cells[k] = cell;
    }
    idx.forEach((from, i) => {
      const to = start + i;
      for (let c = 0; c < t.cols; c++) {
        const cell = t.cells[key(from, c)];
        if (!cell) continue;
        // 同一列的相對參照跟著搬（=B3*C3 搬到第 5 列變 =B5*C5）
        cells[key(to, c)] = cell.v.startsWith("=") ? { ...cell, v: "=" + shiftFormula(cell.v.slice(1), to - from, 0) } : cell;
      }
    });
    return { ...t, cells };
  });
}

/* ─── 表格、圖表、工作表 ─── */

export function addTable(wb: Workbook, sid: string, x: number, y: number, opts: { rows?: number; cols?: number; hr?: number; hc?: number; fr?: number } = {}): { wb: Workbook; id: string } {
  const t = newTable(freeName(allTableNames(wb), "Table"), x, y, opts.rows ?? 10, opts.cols ?? 5, opts.hr ?? 1, opts.hc ?? 1);
  t.fr = Math.min(opts.fr ?? 0, t.rows - t.hr);
  return { wb: updSheet(wb, sid, (s) => ({ ...s, tables: [...s.tables, t] })), id: t.id };
}

export function removeTable(wb: Workbook, tid: string): Workbook {
  return { sheets: wb.sheets.map((s) => ({ ...s, tables: s.tables.filter((t) => t.id !== tid), charts: s.charts.filter((c) => c.table !== tid) })) };
}

/** 表格改名：指向它的公式一起改 */
export function renameTable(wb: Workbook, tid: string, name: string): Workbook {
  const hit = findTable(wb, tid);
  name = name.trim().replace(/::/g, ":");
  if (!hit || !name || hit.table.name === name) return wb;
  const out = mapTables(wb, (t, s) => {
    let changed = false;
    const cells: Record<string, Cell> = {};
    for (const [k, cell] of Object.entries(t.cells)) {
      if (!cell.v.startsWith("=")) {
        cells[k] = cell;
        continue;
      }
      const v = "=" + mapRefs(cell.v.slice(1), (ref) => (ref.table && resolveTable(wb, s, t, ref)?.table.id === tid ? { ...ref, table: name } : null));
      if (v !== cell.v) changed = true;
      cells[k] = v === cell.v ? cell : { ...cell, v };
    }
    return changed ? { ...t, cells } : t;
  });
  return updTable(out, tid, (t) => ({ ...t, name }));
}

export function addChart(wb: Workbook, sid: string, chart: Omit<Chart, "id">): { wb: Workbook; id: string } {
  const c: Chart = { ...chart, id: newId() };
  return { wb: updSheet(wb, sid, (s) => ({ ...s, charts: [...s.charts, c] })), id: c.id };
}

export const patchChart = (wb: Workbook, cid: string, patch: Partial<Omit<Chart, "id">>): Workbook => ({
  sheets: wb.sheets.map((s) => ({ ...s, charts: s.charts.map((c) => (c.id === cid ? { ...c, ...patch } : c)) })),
});

export const removeChart = (wb: Workbook, cid: string): Workbook => ({ sheets: wb.sheets.map((s) => ({ ...s, charts: s.charts.filter((c) => c.id !== cid) })) });

export function addSheet(wb: Workbook): { wb: Workbook; id: string } {
  const s = newSheet(freeName(wb.sheets.map((x) => x.name), "Sheet"));
  s.tables[0].name = freeName(allTableNames(wb), "Table");
  return { wb: { sheets: [...wb.sheets, s] }, id: s.id };
}

export function renameSheet(wb: Workbook, sid: string, name: string): Workbook {
  const old = wb.sheets.find((s) => s.id === sid);
  name = name.trim().replace(/::/g, ":");
  if (!old || !name || old.name === name) return wb;
  const out = mapTables(wb, (t, s) => {
    let changed = false;
    const cells: Record<string, Cell> = {};
    for (const [k, cell] of Object.entries(t.cells)) {
      const v = cell.v.startsWith("=")
        ? "=" + mapRefs(cell.v.slice(1), (ref) => (ref.sheet && same(ref.sheet, old.name) && resolveTable(wb, s, t, ref) ? { ...ref, sheet: name } : null))
        : cell.v;
      if (v !== cell.v) changed = true;
      cells[k] = v === cell.v ? cell : { ...cell, v };
    }
    return changed ? { ...t, cells } : t;
  });
  return updSheet(out, sid, (s) => ({ ...s, name }));
}

export function removeSheet(wb: Workbook, sid: string): Workbook {
  if (wb.sheets.length <= 1) return wb;
  return { sheets: wb.sheets.filter((s) => s.id !== sid) };
}

export function moveSheet(wb: Workbook, sid: string, to: number): Workbook {
  const from = wb.sheets.findIndex((s) => s.id === sid);
  if (from < 0) return wb;
  const sheets = [...wb.sheets];
  const [s] = sheets.splice(from, 1);
  sheets.splice(Math.max(0, Math.min(to, sheets.length)), 0, s);
  return { sheets };
}

/* ─── 輸入的文字 ─── */

/** 打字時依內容猜格式：「$5」→ 貨幣、「15%」→ 百分比、「2026-11-18」→ 日期（自動格式的格子才顯示成那樣） */
export const looksNumeric = (v: string) => parseNumber(v) !== null;

/* ─── 舊的資料庫轉成試算表 ─── */

/**
 * 舊的資料庫（參考 Notion，已經拿掉）→ 一張表格：欄名是標題列，選項存名稱，
 * 核取方塊用勾選格式；公式欄位沒辦法照搬（語法不同），留空。
 */
export function fromDatabase(raw: unknown, name = "Table 1"): Workbook {
  const o = obj(raw);
  const props = (Array.isArray(o.props) ? o.props : []).map(obj).filter((p) => typeof p.id === "string");
  const rows = (Array.isArray(o.rows) ? o.rows : []).map(obj);
  if (!props.length) return newWorkbook();
  const optName = (p: Record<string, unknown>, id: unknown) => {
    const opt = (Array.isArray(p.options) ? p.options : []).map(obj).find((x) => x.id === id);
    return typeof opt?.name === "string" ? opt.name : typeof id === "string" ? id : "";
  };
  const stamp = (ms: unknown) => {
    if (typeof ms !== "number") return "";
    const d = new Date(ms);
    const p = (x: number) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const text = (p: Record<string, unknown>, row: Record<string, unknown>): string => {
    if (p.type === "created") return stamp(row.created);
    if (p.type === "edited") return stamp(row.edited);
    const v = obj(row.cells)[p.id as string];
    if (v === null || v === undefined) return "";
    if (p.type === "checkbox") return v === true ? "TRUE" : "FALSE";
    if (p.type === "select") return optName(p, v);
    if (p.type === "multi") return (Array.isArray(v) ? v : []).map((x) => optName(p, x)).join(", ");
    if (p.type === "relation") return "";
    if (Array.isArray(v)) return v.map(String).join(", ");
    if (typeof v === "string") return v.startsWith("=") || v.startsWith("'") ? "'" + v : v;
    return String(v);
  };
  const styles = props.map((p): Style | undefined => (p.type === "checkbox" ? { fmt: "checkbox" } : p.type === "number" ? { align: "right" } : undefined));
  const t = gridTable(
    name,
    props.map((p) => (typeof p.name === "string" ? p.name : "")),
    rows.map((row) => props.map((p) => text(p, row))),
    styles,
  );
  t.hc = 1;
  return { sheets: [{ id: newId(), name: "Sheet 1", tables: [t], charts: [] }] };
}

/* ─── 列高、篩選、醒目提示 ─── */

export const rowHeight = (t: Table, r: number) => t.rowH[r] ?? ROW_H;

/** 設定幾列的列高（等於預設就拿掉） */
export function setRowHeights(wb: Workbook, tid: string, rows: number[], h: number): Workbook {
  h = Math.max(MIN_ROW_H, Math.min(400, Math.round(h)));
  return updTable(wb, tid, (t) => {
    const rowH = { ...t.rowH };
    for (const r of rows) {
      if (h === ROW_H) delete rowH[r];
      else rowH[r] = h;
    }
    return { ...t, rowH };
  });
}

export function addRule(wb: Workbook, tid: string, rule: Omit<Rule, "id">): { wb: Workbook; id: string } {
  const r: Rule = { ...rule, id: newId() };
  return { wb: updTable(wb, tid, (t) => ({ ...t, rules: [...t.rules, r] })), id: r.id };
}

export const patchRule = (wb: Workbook, tid: string, id: string, patch: Partial<Omit<Rule, "id">>) =>
  updTable(wb, tid, (t) => ({ ...t, rules: t.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));

export const removeRule = (wb: Workbook, tid: string, id: string) => updTable(wb, tid, (t) => ({ ...t, rules: t.rules.filter((r) => r.id !== id) }));

/* ─── 複製表格、工作表 ─── */

/** 複製表格：放在原本的下面，名稱加「copy」；公式照搬（指向自己的不用改） */
export function duplicateTable(wb: Workbook, tid: string): { wb: Workbook; id: string } {
  const hit = findTable(wb, tid);
  if (!hit) return { wb, id: "" };
  const t = hit.table;
  const copy: Table = {
    ...structuredClone(t),
    id: newId(),
    name: uniqueName(allTableNames(wb), `${t.name} copy`),
    y: t.y + (t.showName ? 26 : 0) + 22 + tableHeight(t) + 56,
    rules: t.rules.map((r) => ({ ...r, id: newId() })),
  };
  return { wb: updSheet(wb, hit.sheet.id, (s) => ({ ...s, tables: [...s.tables, copy] })), id: copy.id };
}

/** 整張工作表複製一份（表格、圖表換新的 id，表格名稱不重複；複本裡互相參照的公式改成新名稱） */
export function duplicateSheet(wb: Workbook, sid: string): { wb: Workbook; id: string } {
  const src = wb.sheets.find((s) => s.id === sid);
  if (!src) return { wb, id: "" };
  const used = allTableNames(wb);
  const ids = new Map<string, string>();
  const names = new Map<string, string>();
  const tables = src.tables.map((t) => {
    const name = uniqueName(used, `${t.name} copy`);
    used.push(name);
    const id = newId();
    ids.set(t.id, id);
    names.set(t.name.toLowerCase(), name);
    return { ...structuredClone(t), id, name, rules: t.rules.map((r) => ({ ...r, id: newId() })) };
  });
  const sheet: Sheet = {
    id: newId(),
    name: uniqueName(
      wb.sheets.map((x) => x.name),
      `${src.name} copy`,
    ),
    tables,
    charts: src.charts.filter((c) => ids.has(c.table)).map((c) => ({ ...c, id: newId(), table: ids.get(c.table)! })),
  };
  // 複本裡寫明表格名稱的參照，改指向複本的表格
  sheet.tables = sheet.tables.map((t) => {
    const cells: Record<string, Cell> = {};
    for (const [k, cell] of Object.entries(t.cells))
      cells[k] = cell.v.startsWith("=")
        ? { ...cell, v: "=" + mapRefs(cell.v.slice(1), (ref) => (ref.table && !ref.sheet && names.has(ref.table.toLowerCase()) ? { ...ref, table: names.get(ref.table.toLowerCase()) } : null)) }
        : cell;
    return { ...t, cells };
  });
  const at = wb.sheets.findIndex((s) => s.id === sid);
  const sheets = [...wb.sheets];
  sheets.splice(at + 1, 0, sheet);
  return { wb: { sheets }, id: sheet.id };
}

export const tableHeight = (t: Table) => {
  let h = 0;
  for (let r = 0; r < t.rows; r++) h += rowHeight(t, r);
  return h;
};

/* ─── 合併格子、藏起來的列欄、框線、附註 ─── */

const overlaps = (a: Rect, b: Rect) => a.r0 <= b.r1 && b.r0 <= a.r1 && a.c0 <= b.c1 && b.c0 <= a.c1;

/** 包含 (r, c) 的合併範圍 */
export const mergeAt = (t: Table, r: number, c: number): Rect | undefined => t.merges?.find((m) => r >= m.r0 && r <= m.r1 && c >= m.c0 && c <= m.c1);

/** 範圍往外擴到完整包住碰到的合併格子 */
export function growToMerges(t: Table, rect: Rect): Rect {
  let out = rect;
  for (let again = true; again; ) {
    again = false;
    for (const m of t.merges ?? []) {
      if (!overlaps(m, out)) continue;
      const next = { r0: Math.min(out.r0, m.r0), c0: Math.min(out.c0, m.c0), r1: Math.max(out.r1, m.r1), c1: Math.max(out.c1, m.c1) };
      if (next.r0 !== out.r0 || next.c0 !== out.c0 || next.r1 !== out.r1 || next.c1 !== out.c1) {
        out = next;
        again = true;
      }
    }
  }
  return out;
}

/**
 * 合併格子（像 Excel 的 Merge & Center 與 Google 試算表的 Merge all）：
 * 留下左上角的內容（左上是空的就用範圍裡第一個有內容的），其他格子的內容清掉；碰到的舊合併併進來。
 */
export function mergeCells(wb: Workbook, tid: string, rect: Rect): Workbook {
  return updTable(wb, tid, (t) => {
    const m = growToMerges(t, rect);
    if (m.r0 === m.r1 && m.c0 === m.c1) return t;
    const cells = { ...t.cells };
    let first: Cell | undefined;
    for (let r = m.r0; r <= m.r1; r++)
      for (let c = m.c0; c <= m.c1; c++) {
        const k = key(r, c);
        if (!first && cells[k]?.v) first = cells[k];
        if (r === m.r0 && c === m.c0) continue;
        if (cells[k]?.s) cells[k] = { v: "", s: cells[k].s };
        else delete cells[k];
      }
    const tl = key(m.r0, m.c0);
    if (first && !cells[tl]?.v) cells[tl] = { ...cells[tl], v: first.v, ...(first.s && !cells[tl]?.s ? { s: first.s } : {}) };
    return { ...t, cells, merges: [...(t.merges ?? []).filter((x) => !overlaps(x, m)), m] };
  });
}

/** 取消範圍碰到的合併 */
export function unmergeCells(wb: Workbook, tid: string, rect: Rect): Workbook {
  return updTable(wb, tid, (t) => {
    const merges = (t.merges ?? []).filter((m) => !overlaps(m, rect));
    return merges.length === (t.merges ?? []).length ? t : { ...t, merges: merges.length ? merges : undefined };
  });
}

/** 藏起來（或顯示）幾列、幾欄；至少留一欄 */
export function setHidden(wb: Workbook, tid: string, axis: "row" | "col", idx: number[], hide: boolean): Workbook {
  return updTable(wb, tid, (t) => {
    const k = axis === "row" ? "hideR" : "hideC";
    const cur = new Set(t[k] ?? []);
    for (const i of idx) (hide ? cur.add(i) : cur.delete(i));
    if (axis === "col" && cur.size >= t.cols) return t;
    const list = [...cur].filter((i) => i < (axis === "row" ? t.rows : t.cols)).sort((a, b) => a - b);
    return { ...t, [k]: list.length ? list : undefined };
  });
}

/** 框線（每格存有哪幾邊；外框只加在範圍的邊上，內框只加在格子之間） */
export function setBorders(wb: Workbook, tid: string, rect: Rect, mode: BorderMode): Workbook {
  return updTable(wb, tid, (t) => {
    let out = t;
    for (let r = rect.r0; r <= Math.min(rect.r1, t.rows - 1); r++)
      for (let c = rect.c0; c <= Math.min(rect.c1, t.cols - 1); c++) {
        const old = out.cells[key(r, c)];
        const has = new Set(old?.s?.bd ?? "");
        const edge = { t: r === rect.r0, b: r === rect.r1, l: c === rect.c0, r: c === rect.c1 };
        const add = (x: string) => has.add(x);
        switch (mode) {
          case "all":
            [..."trbl"].forEach(add);
            break;
          case "outer":
            if (edge.t) add("t");
            if (edge.b) add("b");
            if (edge.l) add("l");
            if (edge.r) add("r");
            break;
          case "inner":
            if (!edge.t) add("t");
            if (!edge.b) add("b");
            if (!edge.l) add("l");
            if (!edge.r) add("r");
            break;
          case "top":
            if (edge.t) add("t");
            break;
          case "bottom":
            if (edge.b) add("b");
            break;
          case "left":
            if (edge.l) add("l");
            break;
          case "right":
            if (edge.r) add("r");
            break;
          case "none":
            has.clear();
            break;
        }
        const bd = [..."trbl"].filter((x) => has.has(x)).join("");
        const s: Style = { ...old?.s };
        if (bd) s.bd = bd;
        else delete s.bd;
        out = withCell(out, r, c, { ...old, v: old?.v ?? "", s: Object.keys(s).length ? s : undefined });
      }
    return out;
  });
}

/** 格子的附註（空的拿掉） */
export function setNote(wb: Workbook, tid: string, r: number, c: number, note: string): Workbook {
  return updTable(wb, tid, (t) => {
    const old = t.cells[key(r, c)];
    const next: Cell = { ...old, v: old?.v ?? "" };
    if (note.trim()) next.n = note;
    else delete next.n;
    return withCell(t, r, c, next);
  });
}

/** 範圍裡（照某幾欄）重複的內文列拿掉，留下第一次出現的；傳回拿掉幾列 */
export function removeDuplicates(wb: Workbook, tid: string, cols: number[], textOf: (r: number, c: number) => string): { wb: Workbook; removed: number } {
  const hit = findTable(wb, tid);
  if (!hit) return { wb, removed: 0 };
  const t = hit.table;
  const seen = new Set<string>();
  const drop: number[] = [];
  for (let r = t.hr; r < t.rows - t.fr; r++) {
    const k = cols.map((c) => textOf(r, c).trim().toLowerCase()).join("\u0001");
    if (cols.every((c) => !textOf(r, c).trim())) continue;
    if (seen.has(k)) drop.push(r);
    else seen.add(k);
  }
  let out = wb;
  // 從下面往上刪，列號才不會跑掉
  for (const r of drop.reverse()) out = deleteRows(out, tid, r, 1);
  return { wb: out, removed: drop.length };
}
