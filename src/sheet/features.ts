import { show, type Calc } from "./calc";
import { dateOfSerial, generalNumber, parseNumber, type Value } from "./formula";
import { key, shiftFormula, updTable, type Cell, type Cond, type CondOp, type Look, type Rect, type Sheet, type Table, type Workbook } from "./model";

/**
 * 試算表的進階功能（純函式）：
 * - 條件（篩選與條件式醒目提示共用）、篩選掉的列、每一格套用的醒目提示。
 * - 自動填滿：拖選取範圍右下角的填滿控點，數字、日期、「Item 1」、月份與星期接著往下編。
 * - 尋找與取代。
 */

/* ─── 條件 ─── */

export const COND_LABEL: Record<CondOp, string> = {
  gt: "is greater than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  eq: "is equal to",
  neq: "is not equal to",
  between: "is between",
  contains: "contains",
  notContains: "doesn't contain",
  begins: "starts with",
  empty: "is blank",
  notEmpty: "is not blank",
  dup: "is a duplicate",
};

/** 不用填值的條件 */
export const NO_VALUE: CondOp[] = ["empty", "notEmpty", "dup"];

const num = (v: Value): number | null => (v.t === "n" ? v.n : v.t === "b" ? Number(v.b) : v.t === "s" ? (parseNumber(v.s)?.n ?? null) : null);

/**
 * 值是否符合條件。text 是格子顯示的文字（文字比對用，不分大小寫）；
 * 數字比較時條件值可以寫「1,200」「15%」「2026-11-18」。dup 要另外給 dupes。
 */
export function matches(c: Cond, v: Value, text: string, dupes?: Set<string>): boolean {
  const t = text.trim().toLowerCase();
  const want = c.value.trim().toLowerCase();
  switch (c.op) {
    case "empty":
      return v.t === "empty" || !t;
    case "notEmpty":
      return v.t !== "empty" && !!t;
    case "dup":
      return !!t && !!dupes?.has(t);
    // 還沒填值的文字條件：全部算符合（剛加的篩選不會一下子藏掉所有列）
    case "contains":
      return t.includes(want);
    case "notContains":
      return !want || !t.includes(want);
    case "begins":
      return t.startsWith(want);
  }
  const a = num(v);
  const b = parseNumber(c.value)?.n ?? null;
  if (c.op === "eq" || c.op === "neq") {
    const same = a !== null && b !== null ? a === b : t === want;
    return c.op === "eq" ? same : !same;
  }
  if (a === null || b === null || v.t === "empty") return false;
  switch (c.op) {
    case "gt":
      return a > b;
    case "gte":
      return a >= b;
    case "lt":
      return a < b;
    case "lte":
      return a <= b;
    case "between": {
      const b2 = parseNumber(c.value2 ?? "")?.n;
      if (b2 === undefined) return false;
      return a >= Math.min(b, b2) && a <= Math.max(b, b2);
    }
  }
  return false;
}

const cellText = (t: Table, calc: Calc, r: number, c: number) => show(calc.value(t.id, r, c), t.cells[key(r, c)]?.s).text;

/** 篩選開著時，不符合的內文列（標題列、表尾列永遠顯示） */
export function hiddenRows(t: Table, calc: Calc): Set<number> {
  const out = new Set<number>();
  if (!t.filterOn || !t.filters.length) return out;
  const dupes = new Map<number, Set<string>>();
  for (const f of t.filters) if (f.op === "dup" && !dupes.has(f.col)) dupes.set(f.col, dupSet(t, calc, { r0: t.hr, r1: t.rows - t.fr - 1, c0: f.col, c1: f.col }));
  for (let r = t.hr; r < t.rows - t.fr; r++) {
    const ok = t.filters.every((f) => f.col < t.cols && matches(f, calc.value(t.id, r, f.col), cellText(t, calc, r, f.col), dupes.get(f.col)));
    if (!ok) out.add(r);
  }
  return out;
}

/** 範圍裡出現兩次以上的文字（不分大小寫） */
function dupSet(t: Table, calc: Calc, rect: Rect): Set<string> {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (let r = rect.r0; r <= Math.min(rect.r1, t.rows - 1); r++)
    for (let c = rect.c0; c <= Math.min(rect.c1, t.cols - 1); c++) {
      const x = cellText(t, calc, r, c).trim().toLowerCase();
      if (!x) continue;
      if (seen.has(x)) dup.add(x);
      seen.add(x);
    }
  return dup;
}

/** 每一格套用的醒目提示（後面的規則蓋過前面的） */
export function ruleLooks(t: Table, calc: Calc): Map<string, Look> {
  const out = new Map<string, Look>();
  for (const rule of t.rules) {
    const dupes = rule.op === "dup" ? dupSet(t, calc, rule) : undefined;
    for (let r = rule.r0; r <= Math.min(rule.r1, t.rows - 1); r++)
      for (let c = rule.c0; c <= Math.min(rule.c1, t.cols - 1); c++)
        if (matches(rule, calc.value(t.id, r, c), cellText(t, calc, r, c), dupes)) out.set(key(r, c), rule.look);
  }
  return out;
}

/* ─── 自動填滿 ─── */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const LISTS = [MONTHS, DAYS];

/** 名稱清單（月份、星期，全名或前三個字母）裡的位置 */
function listPos(s: string): { list: string[]; i: number; short: boolean; caseOf: (x: string) => string } | null {
  const w = s.trim();
  for (const list of LISTS) {
    const i = list.findIndex((x) => x.toLowerCase() === w.toLowerCase() || x.slice(0, 3).toLowerCase() === w.toLowerCase());
    if (i < 0) continue;
    const short = w.length === 3;
    const caseOf = w === w.toUpperCase() ? (x: string) => x.toUpperCase() : w === w.toLowerCase() ? (x: string) => x.toLowerCase() : (x: string) => x;
    return { list, i, short, caseOf };
  }
  return null;
}

const iso = (n: number) => {
  const d = dateOfSerial(n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
};

/**
 * 一串來源（同一欄往下、或同一列往右）接著填第 k 個（k 從 0 算，k ≥ 來源長度就是新的格子）。
 * 回傳原始文字；公式用 shiftFormula 位移。
 */
export function seriesAt(src: (Cell | undefined)[], k: number, along: "row" | "col"): Cell | null {
  const n = src.length;
  const base = src[k % n];
  const raw = src.map((c) => c?.v ?? "");
  const step = k - (k % n);
  // 有公式或空格：整組重複（公式的相對參照跟著位移）
  if (raw.some((v) => v.startsWith("=") || !v)) {
    if (!base) return null;
    return base.v.startsWith("=") ? { ...base, v: "=" + shiftFormula(base.v.slice(1), along === "row" ? step : 0, along === "col" ? step : 0) } : base;
  }
  const s = base?.s;
  const out = (v: string): Cell => (s ? { v, s } : { v });
  // 數字（含日期、百分比、貨幣）
  const nums = raw.map((v) => parseNumber(v));
  if (nums.every((x) => x !== null)) {
    const xs = nums.map((x) => x!.n);
    const hint = nums[0]!.hint;
    const d = n > 1 ? (xs[n - 1] - xs[0]) / (n - 1) : hint === "date" ? 1 : 0;
    const v = xs[0] + d * k;
    if (hint === "date") return out(iso(v));
    if (hint === "pct") return out(generalNumber(Number((v * 100).toPrecision(12))) + "%");
    if (hint === "cur") {
      const sym = /^[-+]?\s*([^\d\s.,-]+)/.exec(raw[0])?.[1] ?? "$";
      return out((v < 0 ? "-" : "") + sym + generalNumber(Number(Math.abs(v).toPrecision(12))));
    }
    return out(generalNumber(Number(v.toPrecision(12))));
  }
  // 月份、星期
  const pos = raw.map(listPos);
  if (pos.every((p) => p && p.list === pos[0]!.list)) {
    const p0 = pos[0]!;
    const d = n > 1 ? pos[1]!.i - p0.i : 1;
    const len = p0.list.length;
    const name = p0.list[(((p0.i + d * k) % len) + len) % len];
    return out(p0.caseOf(p0.short ? name.slice(0, 3) : name));
  }
  // 結尾是數字的文字：「Item 1」→「Item 2」
  const tails = raw.map((v) => /^(.*?)(\d+)$/.exec(v));
  if (tails.every((m) => m && m[1] === tails[0]![1])) {
    const xs = tails.map((m) => Number(m![2]));
    const d = n > 1 ? (xs[n - 1] - xs[0]) / (n - 1) : 1;
    const v = Math.round(xs[0] + d * k);
    const width = tails[0]![2].startsWith("0") ? tails[0]![2].length : 0;
    return out(tails[0]![1] + String(Math.max(0, v)).padStart(width, "0"));
  }
  return base ?? null;
}

/**
 * 從 src 範圍往下（to.r1 > src.r1）或往右（to.c1 > src.c1）填到 to。
 * 每一欄（或每一列）各自接著自己的數列。
 */
export function autofill(wb: Workbook, tid: string, src: Rect, to: Rect): Workbook {
  return updTable(wb, tid, (t) => {
    const cells = { ...t.cells };
    const put = (r: number, c: number, cell: Cell | null) => {
      if (cell && (cell.v || cell.s)) cells[key(r, c)] = cell;
      else delete cells[key(r, c)];
    };
    if (to.r1 > src.r1) {
      for (let c = src.c0; c <= src.c1; c++) {
        const seq = Array.from({ length: src.r1 - src.r0 + 1 }, (_x, i) => t.cells[key(src.r0 + i, c)]);
        for (let r = src.r1 + 1; r <= Math.min(to.r1, t.rows - 1); r++) put(r, c, seriesAt(seq, r - src.r0, "row"));
      }
    } else if (to.c1 > src.c1) {
      for (let r = src.r0; r <= src.r1; r++) {
        const seq = Array.from({ length: src.c1 - src.c0 + 1 }, (_x, i) => t.cells[key(r, src.c0 + i)]);
        for (let c = src.c1 + 1; c <= Math.min(to.c1, t.cols - 1); c++) put(r, c, seriesAt(seq, c - src.c0, "col"));
      }
    }
    return { ...t, cells };
  });
}

/* ─── 尋找與取代 ─── */

export interface Hit {
  tid: string;
  r: number;
  c: number;
}

export interface FindOpts {
  matchCase: boolean;
  /** 整格完全相同 */
  whole: boolean;
}

const norm = (s: string, o: FindOpts) => (o.matchCase ? s : s.toLowerCase());

/** 這張工作表裡顯示的文字符合的格子（照表格、列、欄的順序） */
export function findAll(sheet: Sheet, calc: Calc, q: string, o: FindOpts): Hit[] {
  if (!q) return [];
  const needle = norm(q, o);
  const out: Hit[] = [];
  for (const t of sheet.tables)
    for (let r = 0; r < t.rows; r++)
      for (let c = 0; c < t.cols; c++) {
        const cell = t.cells[key(r, c)];
        if (!cell?.v) continue;
        const text = norm(show(calc.value(t.id, r, c), cell.s).text, o);
        if (o.whole ? text === needle : text.includes(needle)) out.push({ tid: t.id, r, c });
      }
  return out;
}

/** 在格子的原始文字裡取代（公式不動）；回傳新的活頁簿與改了幾格 */
export function replaceIn(wb: Workbook, hits: Hit[], q: string, by: string, o: FindOpts): { wb: Workbook; count: number } {
  if (!q) return { wb, count: 0 };
  let count = 0;
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), o.matchCase ? "g" : "gi");
  let out = wb;
  const byTable = new Map<string, Hit[]>();
  for (const h of hits) byTable.set(h.tid, [...(byTable.get(h.tid) ?? []), h]);
  for (const [tid, list] of byTable)
    out = updTable(out, tid, (t) => {
      const cells = { ...t.cells };
      for (const h of list) {
        const cell = cells[key(h.r, h.c)];
        if (!cell || cell.v.startsWith("=")) continue;
        const v = o.whole ? (norm(cell.v, o) === norm(q, o) ? by : cell.v) : cell.v.replace(re, () => by);
        if (v !== cell.v) {
          cells[key(h.r, h.c)] = { ...cell, v };
          count++;
        }
      }
      return { ...t, cells };
    });
  return { wb: out, count };
}

export const LOOK_STYLE: Record<Look, { label: string; fill?: string; color?: string; bold?: boolean }> = {
  red: { label: "Red fill", fill: "#fbdcdb", color: "#a8231f" },
  yellow: { label: "Yellow fill", fill: "#fbf0c4", color: "#7a5a00" },
  green: { label: "Green fill", fill: "#d7f0df", color: "#1d6b3c" },
  blue: { label: "Blue fill", fill: "#dbe9fb", color: "#1d4f91" },
  purple: { label: "Purple fill", fill: "#e9e0f7", color: "#55309a" },
  redText: { label: "Red text", color: "#d0312d" },
  greenText: { label: "Green text", color: "#1e8a4c" },
  bold: { label: "Bold", bold: true },
};
