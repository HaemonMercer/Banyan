import { monthShort } from "../journal/journal";
import {
  dateOfSerial,
  EMPTY,
  err,
  evalNode,
  generalNumber,
  parseFormula,
  parseNumber,
  str,
  bool,
  num,
  type ErrCode,
  type Ref,
  type Value,
} from "./formula";
import { key, resolveTable, type Align, type Sheet, type Style, type Table, type Workbook } from "./model";

/**
 * 算格子的值（公式、輸入的文字）與顯示的文字。一個 Calc 對應一本活頁簿的一個版本：
 * 值第一次讀到才算，算過的記住；公式互相參照的迴圈變成 #CIRC!。
 */

/** 不是公式的輸入 → 值（依格式：文字格式一律是文字、勾選格式是布林） */
export function literal(v: string, s?: Style): Value {
  if (!v) return EMPTY;
  if (s?.fmt === "text") return str(v);
  if (v.startsWith("'")) return str(v.slice(1));
  const u = v.trim().toUpperCase();
  if (u === "TRUE" || u === "FALSE") return bool(u === "TRUE");
  const p = parseNumber(v);
  if (p) return num(p.n, p.hint);
  return str(v);
}

export const isFormula = (v: string | undefined) => !!v && v.length > 1 && v.startsWith("=");

export class Calc {
  private memo = new Map<string, Value>();
  private busy = new Set<string>();
  readonly now: Date;

  constructor(
    readonly wb: Workbook,
    now: Date = new Date(),
  ) {
    this.now = now;
  }

  private where(tid: string): { sheet: Sheet; table: Table } | null {
    for (const sheet of this.wb.sheets) {
      const table = sheet.tables.find((t) => t.id === tid);
      if (table) return { sheet, table };
    }
    return null;
  }

  /** 表格 tid 第 r 列第 c 欄（從 0 開始）的值 */
  value(tid: string, r: number, c: number): Value {
    const k = `${tid}!${r},${c}`;
    const hit = this.memo.get(k);
    if (hit) return hit;
    const at = this.where(tid);
    if (!at || r >= at.table.rows || c >= at.table.cols) return err("#REF!");
    const cell = at.table.cells[key(r, c)];
    if (!cell?.v) return EMPTY;
    if (!isFormula(cell.v)) {
      const v = literal(cell.v, cell.s);
      this.memo.set(k, v);
      return v;
    }
    if (this.busy.has(k)) return err("#CIRC!");
    this.busy.add(k);
    let v: Value;
    const node = parseFormula(cell.v.slice(1));
    if ("error" in node) v = err("#ERROR!", node.error);
    else {
      const { sheet, table } = at;
      v = evalNode(node, {
        now: this.now,
        cell: (ref) => this.refValue(sheet, table, ref),
        range: (a, b) => this.rangeValue(sheet, table, a, b),
      });
      // 參照一個空格子：顯示 0（像 Excel）
      if (v.t === "empty") v = num(0);
      if (v.t === "s" && cell.s?.fmt === "checkbox") v = literal(v.s);
    }
    this.busy.delete(k);
    this.memo.set(k, v);
    return v;
  }

  private refValue(sheet: Sheet, table: Table, ref: Ref): Value {
    const t = resolveTable(this.wb, sheet, table, ref);
    if (!t) return err("#REF!", `No table named “${ref.table}”`);
    if (ref.row === null) return err("#VALUE!");
    return this.value(t.table.id, ref.row, ref.col);
  }

  private rangeValue(sheet: Sheet, table: Table, a: Ref, b: Ref): Value[][] | ErrCode {
    const t = resolveTable(this.wb, sheet, table, a)?.table;
    if (!t) return "#REF!";
    const c0 = Math.min(a.col, b.col);
    const c1 = Math.min(Math.max(a.col, b.col), t.cols - 1);
    let r0: number, r1: number;
    if (a.row === null || b.row === null) {
      // 整欄：只算內文列
      r0 = t.hr;
      r1 = t.rows - t.fr - 1;
    } else {
      r0 = Math.min(a.row, b.row);
      r1 = Math.min(Math.max(a.row, b.row), t.rows - 1);
    }
    if (c0 >= t.cols || r0 >= t.rows) return "#REF!";
    const out: Value[][] = [];
    for (let r = r0; r <= r1; r++) {
      const row: Value[] = [];
      for (let c = c0; c <= c1; c++) row.push(this.value(t.id, r, c));
      out.push(row);
    }
    return out;
  }
}

/* ─── 顯示 ─── */

export interface Shown {
  /** 下拉選單（格式 popup） */
  popup?: boolean;
  text: string;
  align: Align;
  /** 勾選格式：是否打勾；星等：幾顆 */
  check?: boolean;
  stars?: number;
  error?: string;
  negative?: boolean;
}

function grouped(n: number, dec: number | undefined, sep: boolean): string {
  const s = dec === undefined ? generalNumber(n) : n.toFixed(dec);
  if (!sep || /e/i.test(s)) return s;
  const [int, frac] = s.replace("-", "").split(".");
  const g = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (n < 0 ? "-" : "") + g + (frac !== undefined ? "." + frac : "");
}

export function dateText(n: number): string {
  const d = dateOfSerial(n);
  const base = `${monthShort(d.getUTCMonth() + 1)} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  const mins = Math.round((n - Math.floor(n)) * 1440);
  if (!mins) return base;
  const h = Math.floor(mins / 60) % 24;
  return `${base} ${h}:${String(mins % 60).padStart(2, "0")}`;
}

/** 值照格子的格式寫成文字 */
export function show(v: Value, s?: Style): Shown {
  const fmt = s?.fmt ?? "auto";
  const align = (a: Align) => s?.align ?? a;
  if (v.t === "e") return { text: v.e, align: align("center"), error: v.msg ?? v.e };
  if (fmt === "checkbox") {
    const on = v.t === "b" ? v.b : v.t === "n" ? v.n !== 0 : v.t === "s" ? v.s.trim().toUpperCase() === "TRUE" : false;
    return { text: on ? "TRUE" : "FALSE", align: align("center"), check: on };
  }
  if (fmt === "stars") {
    const n = v.t === "n" ? Math.max(0, Math.min(5, Math.round(v.n))) : 0;
    return { text: String(n), align: align("left"), stars: n };
  }
  // 下拉選單：顯示照 Automatic，多一個 ▾
  if (fmt === "popup") return { ...show(v, { ...s, fmt: "auto" }), popup: true };
  if (v.t === "empty") return { text: "", align: align("left") };
  if (v.t === "b") return { text: v.b ? "TRUE" : "FALSE", align: align("center") };
  if (v.t === "s") return { text: v.s, align: align("left") };
  const n = v.n;
  const kind = fmt === "auto" ? (v.hint === "date" ? "date" : v.hint === "pct" ? "percent" : v.hint === "cur" ? "currency" : "number") : fmt;
  let text: string;
  switch (kind) {
    case "date":
      text = dateText(n);
      break;
    case "percent":
      text = grouped(n * 100, s?.dec ?? (fmt === "auto" ? undefined : 0), !!s?.sep) + "%";
      break;
    case "currency": {
      const sym = s?.cur ?? "$";
      text = (n < 0 ? "-" : "") + sym + grouped(Math.abs(n), s?.dec ?? 2, s?.sep ?? true);
      break;
    }
    case "text":
      text = generalNumber(n);
      break;
    default:
      text = grouped(n, s?.dec, !!s?.sep);
  }
  return { text, align: align(kind === "text" ? "left" : "right"), negative: n < 0 };
}

/** 排序、圖表用：數字或文字 */
export function sortKey(v: Value): number | string | null {
  if (v.t === "n") return v.n;
  if (v.t === "b") return v.b ? 1 : 0;
  if (v.t === "s") return v.s;
  return null;
}

/** 數字（圖表、狀態列的加總）；不是數字回傳 null */
export const numberOf = (v: Value): number | null => (v.t === "n" ? v.n : v.t === "b" ? Number(v.b) : null);
