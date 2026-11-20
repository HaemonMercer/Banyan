/**
 * 試算表的公式（參考 Numbers／Excel）：純函式，沒有 DOM。
 *
 * - 公式是 `=` 後面的文字；這裡處理的都是去掉 `=` 的部分。
 * - 參照：`A1`、`$A$1`、範圍 `A1:B5`、整欄 `B:B`（只算內文列，不含標題列與表尾列）；
 *   別的表格 `Table 2::A1`、別的工作表 `Sheet 2::Table 1::A1`（名稱有特殊字元時用 `'…'` 包起來）。
 * - 值：數字（可以帶「日期／百分比／貨幣」提示，自動格式用）、文字、布林、空、錯誤（`#DIV/0!` 等）。
 * - `mapRefs` 改寫公式裡的參照（插入／刪除列欄、複製貼上、表格改名），其他文字照舊。
 */

/* ─── 值 ─── */

export type ErrCode = "#DIV/0!" | "#VALUE!" | "#REF!" | "#NAME?" | "#NUM!" | "#N/A" | "#CIRC!" | "#ERROR!";

export type Hint = "date" | "pct" | "cur";

export type Value =
  | { t: "n"; n: number; hint?: Hint }
  | { t: "s"; s: string }
  | { t: "b"; b: boolean }
  | { t: "e"; e: ErrCode; msg?: string }
  | { t: "empty" };

export const EMPTY: Value = { t: "empty" };
export const num = (n: number, hint?: Hint): Value => (Number.isFinite(n) ? (hint ? { t: "n", n, hint } : { t: "n", n }) : err("#NUM!"));
export const str = (s: string): Value => ({ t: "s", s });
export const bool = (b: boolean): Value => ({ t: "b", b });
export const err = (e: ErrCode, msg?: string): Value => (msg ? { t: "e", e, msg } : { t: "e", e });

/* ─── 日期：Excel 的序號（1899-12-30 是 0），小數是一天中的時間 ─── */

const EPOCH = Date.UTC(1899, 11, 30);
const DAY = 86_400_000;

export const serialOf = (y: number, m: number, d: number, hh = 0, mm = 0) => (Date.UTC(y, m - 1, d, hh, mm) - EPOCH) / DAY;
export const serialOfDate = (t: Date) => serialOf(t.getFullYear(), t.getMonth() + 1, t.getDate(), t.getHours(), t.getMinutes());
/** 序號 → UTC 的 Date（拿 getUTC… 讀年月日） */
export const dateOfSerial = (n: number) => new Date(EPOCH + Math.round(n * DAY));

/* ─── 欄名 ─── */

export function colName(c: number): string {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function colIndex(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export const cellName = (r: number, c: number) => `${colName(c)}${r + 1}`;

/* ─── 斷詞 ─── */

export interface Ref {
  sheet?: string;
  table?: string;
  col: number;
  /** null：整欄 */
  row: number | null;
  absC: boolean;
  absR: boolean;
}

type Tok =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "ref"; ref: Ref; s: number; e: number }
  /** 整欄範圍 B:B（兩端一起） */
  | { k: "cols"; a: Ref; b: Ref; s: number; e: number }
  | { k: "fn"; v: string }
  | { k: "name"; v: string }
  | { k: "err"; v: ErrCode }
  | { k: "op"; v: string }
  | { k: "("; v: "(" }
  | { k: ")"; v: ")" }
  | { k: ","; v: "," }
  | { k: ":"; v: ":" };

const BAD_QUAL = /['"()+\-*/^&,;<>=:!%{}]/;
const CELL = /^(\$?)([A-Za-z]{1,3})(\$?)([0-9]{1,7})(?![\w(.])/;
const COLS = /^(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})(?![\w(])/;
const ERRS: ErrCode[] = ["#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#CIRC!", "#ERROR!"];

class SyntaxError_ extends Error {}

/** 在 i 讀表格／工作表名稱（`名稱::`），最多兩層；讀不到參照就退回去。 */
function readQualified(src: string, i: number): { tok: Tok; end: number } | null {
  const quals: string[] = [];
  let j = i;
  for (let n = 0; n < 2; n++) {
    let name: string | null = null;
    let next = j;
    if (src[j] === "'") {
      const close = src.indexOf("'", j + 1);
      if (close > 0 && src.startsWith("::", close + 1)) {
        name = src.slice(j + 1, close);
        next = close + 3;
      }
    } else {
      const at = src.indexOf("::", j);
      if (at > j && !BAD_QUAL.test(src.slice(j, at)) && src.slice(j, at).trim()) {
        name = src.slice(j, at).trim();
        next = at + 2;
      }
    }
    if (name === null) break;
    quals.push(name);
    j = next;
  }
  const rest = src.slice(j);
  const q = quals.length === 2 ? { sheet: quals[0], table: quals[1] } : quals.length === 1 ? { table: quals[0] } : {};
  let m = COLS.exec(rest);
  if (m) {
    const a: Ref = { ...q, col: colIndex(m[2]), row: null, absC: !!m[1], absR: false };
    const b: Ref = { ...q, col: colIndex(m[4]), row: null, absC: !!m[3], absR: false };
    return { tok: { k: "cols", a, b, s: i, e: j + m[0].length }, end: j + m[0].length };
  }
  m = CELL.exec(rest);
  if (m) {
    const ref: Ref = { ...q, col: colIndex(m[2]), row: Number(m[4]) - 1, absC: !!m[1], absR: !!m[3] };
    if (ref.row! < 0) return null;
    return { tok: { k: "ref", ref, s: i, e: j + m[0].length }, end: j + m[0].length };
  }
  return null;
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      let s = "";
      let j = i + 1;
      for (;;) {
        if (j >= src.length) throw new SyntaxError_("A text value isn't closed with \"");
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            s += '"';
            j += 2;
            continue;
          }
          break;
        }
        s += src[j++];
      }
      out.push({ k: "str", v: s });
      i = j + 1;
      continue;
    }
    if (ch === "#") {
      const e = ERRS.find((x) => src.toUpperCase().startsWith(x, i));
      if (!e) throw new SyntaxError_("Unknown error value");
      out.push({ k: "err", v: e });
      i += e.length;
      continue;
    }
    const q = readQualified(src, i);
    if (q) {
      out.push(q.tok);
      i = q.end;
      continue;
    }
    const n = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
    if (n) {
      out.push({ k: "num", v: Number(n[0]) });
      i += n[0].length;
      continue;
    }
    const w = /^[A-Za-z_][\w.]*/.exec(src.slice(i));
    if (w) {
      let j = i + w[0].length;
      while (src[j] === " ") j++;
      if (src[j] === "(") out.push({ k: "fn", v: w[0].toUpperCase() });
      else out.push({ k: "name", v: w[0].toUpperCase() });
      i += w[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>" || two === "==" || two === "!=") {
      out.push({ k: "op", v: two === "==" ? "=" : two === "!=" ? "<>" : two });
      i += 2;
      continue;
    }
    if ("+-*/^&=<>%".includes(ch)) out.push({ k: "op", v: ch });
    else if (ch === "(" || ch === ")" || ch === ":") out.push({ k: ch, v: ch } as Tok);
    else if (ch === "," || ch === ";") out.push({ k: ",", v: "," });
    else throw new SyntaxError_(`Unexpected “${ch}”`);
    i++;
  }
  return out;
}

/* ─── 語法樹 ─── */

export type Node =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "err"; v: ErrCode }
  | { k: "ref"; ref: Ref }
  | { k: "range"; a: Ref; b: Ref }
  | { k: "neg"; x: Node }
  | { k: "pct"; x: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "call"; fn: string; args: Node[] };

const LEVELS = [["=", "<>", "<", ">", "<=", ">="], ["&"], ["+", "-"], ["*", "/"], ["^"]];

function parseTokens(toks: Tok[]): Node {
  let i = 0;
  const peek = () => toks[i];
  const take = () => toks[i++];
  const expect = (k: Tok["k"], what: string) => {
    const t = take();
    if (!t || t.k !== k) throw new SyntaxError_(t ? `Expected ${what}` : `The formula ends too early: expected ${what}`);
    return t;
  };

  const level = (n: number): Node => {
    if (n >= LEVELS.length) return unary();
    let a = level(n + 1);
    for (;;) {
      const t = peek();
      if (!t || t.k !== "op" || !LEVELS[n].includes(t.v)) return a;
      take();
      // ^ 是右結合
      const b = n === LEVELS.length - 1 ? level(n) : level(n + 1);
      a = { k: "bin", op: t.v, a, b };
    }
  };
  const unary = (): Node => {
    const t = peek();
    if (t && t.k === "op" && (t.v === "-" || t.v === "+")) {
      take();
      const x = unary();
      return t.v === "-" ? { k: "neg", x } : x;
    }
    return postfix();
  };
  const postfix = (): Node => {
    let x = primary();
    while ((peek() as { k: string; v?: unknown } | undefined)?.k === "op" && (peek() as { v?: unknown }).v === "%") {
      take();
      x = { k: "pct", x };
    }
    return x;
  };
  const primary = (): Node => {
    const t = take();
    if (!t) throw new SyntaxError_("The formula ends too early");
    switch (t.k) {
      case "num":
        return { k: "num", v: t.v };
      case "str":
        return { k: "str", v: t.v };
      case "err":
        return { k: "err", v: t.v };
      case "cols":
        return { k: "range", a: t.a, b: t.b };
      case "ref": {
        if (peek()?.k === ":") {
          take();
          const u = take();
          if (!u || u.k !== "ref") throw new SyntaxError_("A range needs a cell after “:”");
          const b = { ...u.ref, sheet: u.ref.sheet ?? t.ref.sheet, table: u.ref.table ?? t.ref.table };
          return { k: "range", a: t.ref, b };
        }
        return { k: "ref", ref: t.ref };
      }
      case "name":
        if (t.v === "TRUE" || t.v === "FALSE") return { k: "bool", v: t.v === "TRUE" };
        throw new SyntaxError_(`Unknown name “${t.v}”`);
      case "fn": {
        if (!FUNCS[t.v] && t.v !== "IF" && t.v !== "IFERROR" && t.v !== "IFNA" && t.v !== "TRUE" && t.v !== "FALSE")
          throw new SyntaxError_(`Unknown function ${t.v}`);
        take(); // (
        const args: Node[] = [];
        if (peek()?.k !== ")") {
          for (;;) {
            args.push(level(0));
            if (peek()?.k === ",") {
              take();
              continue;
            }
            break;
          }
        }
        expect(")", "“)”");
        if (t.v === "TRUE" || t.v === "FALSE") return { k: "bool", v: t.v === "TRUE" };
        const arity = t.v === "IF" ? [2, 3] : t.v === "IFERROR" || t.v === "IFNA" ? [2, 2] : FUNCS[t.v].arity;
        if (args.length < arity[0] || args.length > arity[1])
          throw new SyntaxError_(
            arity[0] === arity[1] ? `${t.v} takes ${arity[0]} ${arity[0] === 1 ? "value" : "values"}` : `${t.v} takes ${arity[0]} to ${arity[1] === Infinity ? "any number of" : arity[1]} values`,
          );
        return { k: "call", fn: t.v, args };
      }
      case "(": {
        const x = level(0);
        expect(")", "“)”");
        return x;
      }
      default:
        throw new SyntaxError_(`Unexpected “${t.v}”`);
    }
  };

  const node = level(0);
  if (i < toks.length) throw new SyntaxError_(`Unexpected “${(toks[i] as { v?: unknown }).v ?? "…"}”`);
  return node;
}

const cache = new Map<string, Node | { error: string }>();

/** 解析公式（不含 `=`）；語法錯誤回傳 `{ error }`（英文，給介面顯示）。 */
export function parseFormula(src: string): Node | { error: string } {
  const hit = cache.get(src);
  if (hit) return hit;
  let out: Node | { error: string };
  try {
    out = src.trim() ? parseTokens(tokenize(src)) : { error: "The formula is empty" };
  } catch (e) {
    out = { error: e instanceof SyntaxError_ ? e.message : String(e) };
  }
  if (cache.size > 5000) cache.clear();
  cache.set(src, out);
  return out;
}

export const formulaError = (src: string): string | null => {
  const r = parseFormula(src);
  return "error" in r ? r.error : null;
};

/* ─── 改寫參照 ─── */

const quoteName = (n: string) => (BAD_QUAL.test(n) || n !== n.trim() ? `'${n.replace(/'/g, "")}'` : n);

export function refText(r: Ref): string {
  const q = (r.sheet ? quoteName(r.sheet) + "::" : "") + (r.table ? quoteName(r.table) + "::" : "");
  return `${q}${r.absC ? "$" : ""}${colName(r.col)}${r.row === null ? "" : `${r.absR ? "$" : ""}${r.row + 1}`}`;
}

/**
 * 改寫公式裡的每個參照。fn 回傳新的參照、`null`（不動）或 `"#REF!"`（參照的格子沒了）。
 * 範圍的兩端一起交給 fnRange（沒給就各自用 fn）。語法錯誤的公式原樣回傳。
 */
export function mapRefs(
  src: string,
  fn: (r: Ref) => Ref | null | "#REF!",
  fnRange?: (a: Ref, b: Ref) => [Ref, Ref] | null | "#REF!",
): string {
  let toks: Tok[];
  try {
    toks = tokenize(src);
  } catch {
    return src;
  }
  const edits: { s: number; e: number; text: string }[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const u = toks[i + 2];
    const range =
      t.k === "cols" ? { a: t.a, b: t.b, s: t.s, e: t.e } : t.k === "ref" && toks[i + 1]?.k === ":" && u?.k === "ref" ? { a: t.ref, b: u.ref, s: t.s, e: u.e } : null;
    if (range) {
      if (t.k === "ref") i += 2;
      const b = { ...range.b, sheet: range.b.sheet ?? range.a.sheet, table: range.b.table ?? range.a.table };
      let out: [Ref, Ref] | null | "#REF!";
      if (fnRange) out = fnRange(range.a, b);
      else {
        const x = fn(range.a);
        const y = fn(b);
        out = x === "#REF!" || y === "#REF!" ? "#REF!" : x || y ? [x ?? range.a, y ?? b] : null;
      }
      if (out === null) continue;
      if (out === "#REF!") edits.push({ s: range.s, e: range.e, text: "#REF!" });
      else {
        // 第二端不重複寫表格名稱
        const second = { ...out[1], sheet: undefined, table: undefined };
        const sep = ":";
        edits.push({ s: range.s, e: range.e, text: refText(out[0]) + sep + refText(second) });
      }
      continue;
    }
    if (t.k === "ref") {
      const out = fn(t.ref);
      if (out === null) continue;
      edits.push({ s: t.s, e: t.e, text: out === "#REF!" ? "#REF!" : refText(out) });
    }
  }
  if (!edits.length) return src;
  let s = src;
  for (const e of edits.reverse()) s = s.slice(0, e.s) + e.text + s.slice(e.e);
  return s;
}

/** 公式裡所有參照（範圍兩端）；畫面上標出參照的格子用。 */
export function refsOf(src: string): { a: Ref; b: Ref }[] {
  const out: { a: Ref; b: Ref }[] = [];
  mapRefs(
    src,
    (r) => {
      out.push({ a: r, b: r });
      return null;
    },
    (a, b) => {
      out.push({ a, b });
      return null;
    },
  );
  return out;
}

/* ─── 計算 ─── */

export interface EvalCtx {
  /** 一格的值（表格不存在回傳 #REF!） */
  cell(ref: Ref): Value;
  /** 範圍的值（一列一列）；整欄的 row 是 null */
  range(a: Ref, b: Ref): Value[][] | ErrCode;
  now: Date;
}

const isErr = (v: Value): v is { t: "e"; e: ErrCode } => v.t === "e";

/** 文字 → 數字（「1,200」「$5」「15%」「2026-11-18」都算）；不是數字回傳 null。 */
export function parseNumber(s: string): { n: number; hint?: Hint } | null {
  const t = s.trim();
  if (!t) return null;
  const d = parseDateText(t);
  if (d !== null) return { n: d, hint: "date" };
  const m = /^([-+])?\s*(\$|€|£|¥|NT\$)?\s*([-+])?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?\s*(%)?$/i.exec(t);
  if (!m) return null;
  let n = Number(m[4].replace(/,/g, "")) * (m[5] ? Math.pow(10, Number(m[5])) : 1);
  if (m[1] === "-" || m[3] === "-") n = -n;
  if (m[6]) return { n: n / 100, hint: "pct" };
  if (m[2]) return { n, hint: "cur" };
  return { n };
}

/** 「2026-11-18」「2026/11/18」「11/18/2026」（可以加「 09:30」）→ 序號；不是日期回傳 null。 */
export function parseDateText(t: string): number | null {
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(t);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else {
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(t);
    if (!m) return null;
    [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const s = serialOf(y, mo, d, Number(m[4] ?? 0), Number(m[5] ?? 0));
  const back = dateOfSerial(s);
  if (back.getUTCDate() !== d) return null;
  return s;
}

export function toNum(v: Value): { n: number; hint?: Hint } | ErrCode {
  switch (v.t) {
    case "n":
      return { n: v.n, hint: v.hint };
    case "b":
      return { n: v.b ? 1 : 0 };
    case "empty":
      return { n: 0 };
    case "e":
      return v.e;
    case "s": {
      const p = parseNumber(v.s);
      return p ?? "#VALUE!";
    }
  }
}

/** 數字的一般寫法（最多 10 位有效數字，不要科學記號的小數尾巴） */
export function generalNumber(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const s = Number(n.toPrecision(10));
  return Math.abs(s) >= 1e15 || (Math.abs(s) < 1e-9 && s !== 0) ? s.toExponential(4) : String(s);
}

export function toText(v: Value): string | ErrCode {
  switch (v.t) {
    case "s":
      return v.s;
    case "n":
      if (v.hint === "date") {
        const d = dateOfSerial(v.n);
        const p = (x: number) => String(x).padStart(2, "0");
        return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
      }
      return generalNumber(v.n);
    case "b":
      return v.b ? "TRUE" : "FALSE";
    case "empty":
      return "";
    case "e":
      return v.e;
  }
}

function toBool(v: Value): boolean | ErrCode {
  switch (v.t) {
    case "b":
      return v.b;
    case "n":
      return v.n !== 0;
    case "empty":
      return false;
    case "e":
      return v.e;
    case "s": {
      const u = v.s.trim().toUpperCase();
      if (u === "TRUE") return true;
      if (u === "FALSE") return false;
      return "#VALUE!";
    }
  }
}

/** Excel 的比較：數字 < 文字 < 布林；文字不分大小寫 */
function compare(a: Value, b: Value): number {
  const rank = (v: Value) => (v.t === "n" ? 0 : v.t === "s" ? 1 : v.t === "b" ? 2 : 0);
  if (a.t === "empty") a = b.t === "s" ? str("") : b.t === "b" ? bool(false) : num(0);
  if (b.t === "empty") b = a.t === "s" ? str("") : a.t === "b" ? bool(false) : num(0);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (a.t === "n" && b.t === "n") return a.n - b.n;
  if (a.t === "s" && b.t === "s") return a.s.localeCompare(b.s, undefined, { sensitivity: "accent" });
  if (a.t === "b" && b.t === "b") return Number(a.b) - Number(b.b);
  return 0;
}

/** 函式收到的參數：範圍是 2D 陣列 */
type Arg = Value | Value[][];

const flat = (args: Arg[]): Value[] => args.flatMap((a) => (Array.isArray(a) ? a.flat() : [a]));
const one = (a: Arg): Value => (Array.isArray(a) ? (a[0]?.[0] ?? EMPTY) : a);

function nums(args: Arg[], strict = false): number[] | ErrCode {
  const out: number[] = [];
  for (const a of args) {
    if (Array.isArray(a)) {
      // 範圍裡只算數字（文字、空格跳過），錯誤會傳出去
      for (const v of a.flat()) {
        if (v.t === "e") return v.e;
        if (v.t === "n") out.push(v.n);
      }
    } else {
      if (a.t === "empty" && !strict) continue;
      const n = toNum(a);
      if (typeof n === "string") return n;
      out.push(n.n);
    }
  }
  return out;
}

const hintOf = (args: Arg[]): Hint | undefined => {
  for (const v of flat(args)) if (v.t === "n" && v.hint) return v.hint;
  return undefined;
};

/** COUNTIF 之類的條件：「>5」「<>x」「=a」或直接一個值 */
function matcher(crit: Value): (v: Value) => boolean {
  if (crit.t === "s") {
    const m = /^(<=|>=|<>|=|<|>)(.*)$/.exec(crit.s);
    if (m) {
      const p = parseNumber(m[2]);
      const target: Value = p ? num(p.n) : m[2] === "" ? EMPTY : str(m[2]);
      return (v) => {
        if (target.t === "n" && v.t !== "n") return m[1] === "<>";
        const c = compare(v, target);
        return m[1] === "=" ? c === 0 : m[1] === "<>" ? c !== 0 : m[1] === "<" ? c < 0 : m[1] === ">" ? c > 0 : m[1] === "<=" ? c <= 0 : c >= 0;
      };
    }
    const p = parseNumber(crit.s);
    if (p) return (v) => v.t === "n" && v.n === p.n;
    if (crit.s.includes("*") || crit.s.includes("?")) {
      const re = new RegExp("^" + crit.s.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
      return (v) => v.t === "s" && re.test(v.s);
    }
  }
  return (v) => v.t !== "empty" && v.t !== "e" && compare(v, crit) === 0 && (crit.t === "n" ? v.t === "n" : true);
}

type Fn = { arity: [number, number]; run: (args: Arg[], ctx: EvalCtx) => Value };

const numFn = (f: (n: number, ...rest: number[]) => number, arity: [number, number] = [1, 1], keepHint = false): Fn => ({
  arity,
  run: (args) => {
    const xs: number[] = [];
    for (const a of args) {
      const n = toNum(one(a));
      if (typeof n === "string") return err(n);
      xs.push(n.n);
    }
    const r = f(xs[0], ...xs.slice(1));
    return Number.isNaN(r) ? err("#NUM!") : num(r, keepHint ? hintOf(args) : undefined);
  },
});

const textFn = (f: (s: string, ...rest: Value[]) => Value, arity: [number, number] = [1, 1]): Fn => ({
  arity,
  run: (args) => {
    const s = toText(one(args[0]));
    if (ERRS.includes(s as ErrCode) && one(args[0]).t === "e") return err(s as ErrCode);
    return f(s, ...args.slice(1).map(one));
  },
});

const intArg = (v: Value): number | ErrCode => {
  const n = toNum(v);
  return typeof n === "string" ? n : Math.trunc(n.n);
};

const roundTo = (n: number, d: number, mode: "half" | "up" | "down") => {
  const f = Math.pow(10, d);
  const x = Math.abs(n) * f;
  const r = mode === "half" ? Math.round(x + 1e-9) : mode === "up" ? Math.ceil(x - 1e-9) : Math.floor(x + 1e-9);
  return (Math.sign(n) * r) / f;
};

const ymd = (v: Value): Date | ErrCode => {
  const n = toNum(v);
  return typeof n === "string" ? n : dateOfSerial(n.n);
};

const aggregate = (f: (xs: number[]) => number, empty?: ErrCode): Fn => ({
  arity: [1, Infinity],
  run: (args) => {
    const xs = nums(args);
    if (typeof xs === "string") return err(xs);
    if (!xs.length && empty) return err(empty);
    return num(f(xs), hintOf(args));
  },
});

const FUNCS: Record<string, Fn> = {
  SUM: aggregate((xs) => xs.reduce((a, b) => a + b, 0)),
  AVERAGE: aggregate((xs) => xs.reduce((a, b) => a + b, 0) / xs.length, "#DIV/0!"),
  MIN: aggregate((xs) => (xs.length ? Math.min(...xs) : 0)),
  MAX: aggregate((xs) => (xs.length ? Math.max(...xs) : 0)),
  PRODUCT: aggregate((xs) => xs.reduce((a, b) => a * b, 1)),
  MEDIAN: aggregate((xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }, "#NUM!"),
  COUNT: { arity: [1, Infinity], run: (args) => num(flat(args).filter((v) => v.t === "n").length) },
  COUNTA: { arity: [1, Infinity], run: (args) => num(flat(args).filter((v) => v.t !== "empty").length) },
  COUNTBLANK: { arity: [1, 1], run: (args) => num(flat(args).filter((v) => v.t === "empty" || (v.t === "s" && !v.s)).length) },
  COUNTIF: {
    arity: [2, 2],
    run: (args) => {
      const ok = matcher(one(args[1]));
      return num(flat([args[0]]).filter(ok).length);
    },
  },
  SUMIF: {
    arity: [2, 3],
    run: (args) => {
      const ok = matcher(one(args[1]));
      const test = Array.isArray(args[0]) ? args[0] : [[args[0]]];
      const sum = args[2] ? (Array.isArray(args[2]) ? args[2] : [[args[2]]]) : test;
      let total = 0;
      test.forEach((row, r) =>
        row.forEach((v, c) => {
          const s = sum[r]?.[c];
          if (ok(v) && s?.t === "n") total += s.n;
        }),
      );
      return num(total, hintOf([sum]));
    },
  },
  AVERAGEIF: {
    arity: [2, 3],
    run: (args) => {
      const ok = matcher(one(args[1]));
      const test = Array.isArray(args[0]) ? args[0] : [[args[0]]];
      const sum = args[2] ? (Array.isArray(args[2]) ? args[2] : [[args[2]]]) : test;
      const xs: number[] = [];
      test.forEach((row, r) =>
        row.forEach((v, c) => {
          const s = sum[r]?.[c];
          if (ok(v) && s?.t === "n") xs.push(s.n);
        }),
      );
      return xs.length ? num(xs.reduce((a, b) => a + b, 0) / xs.length) : err("#DIV/0!");
    },
  },
  AND: {
    arity: [1, Infinity],
    run: (args) => {
      for (const v of flat(args)) {
        if (v.t === "empty" || (v.t === "s" && Array.isArray(args[0]))) continue;
        const b = toBool(v);
        if (typeof b === "string") return err(b);
        if (!b) return bool(false);
      }
      return bool(true);
    },
  },
  OR: {
    arity: [1, Infinity],
    run: (args) => {
      let any = false;
      for (const v of flat(args)) {
        if (v.t === "empty") continue;
        const b = toBool(v);
        if (typeof b === "string") return err(b);
        any ||= b;
      }
      return bool(any);
    },
  },
  NOT: {
    arity: [1, 1],
    run: (args) => {
      const b = toBool(one(args[0]));
      return typeof b === "string" ? err(b) : bool(!b);
    },
  },
  ISBLANK: { arity: [1, 1], run: (args) => bool(one(args[0]).t === "empty") },
  ISNUMBER: { arity: [1, 1], run: (args) => bool(one(args[0]).t === "n") },
  ISTEXT: { arity: [1, 1], run: (args) => bool(one(args[0]).t === "s") },
  ISERROR: { arity: [1, 1], run: (args) => bool(one(args[0]).t === "e") },
  ROUND: numFn((n, d = 0) => roundTo(n, Math.trunc(d), "half"), [1, 2], true),
  ROUNDUP: numFn((n, d = 0) => roundTo(n, Math.trunc(d), "up"), [1, 2], true),
  ROUNDDOWN: numFn((n, d = 0) => roundTo(n, Math.trunc(d), "down"), [1, 2], true),
  INT: numFn(Math.floor, [1, 1], true),
  ABS: numFn(Math.abs, [1, 1], true),
  SIGN: numFn(Math.sign),
  SQRT: numFn((n) => (n < 0 ? NaN : Math.sqrt(n))),
  POWER: numFn((a, b) => Math.pow(a, b), [2, 2]),
  EXP: numFn(Math.exp),
  LN: numFn((n) => (n <= 0 ? NaN : Math.log(n))),
  LOG10: numFn((n) => (n <= 0 ? NaN : Math.log10(n))),
  PI: { arity: [0, 0], run: () => num(Math.PI) },
  MOD: {
    arity: [2, 2],
    run: (args) => {
      const a = toNum(one(args[0]));
      const b = toNum(one(args[1]));
      if (typeof a === "string") return err(a);
      if (typeof b === "string") return err(b);
      if (b.n === 0) return err("#DIV/0!");
      return num(a.n - b.n * Math.floor(a.n / b.n));
    },
  },
  CEILING: numFn((n, s = 1) => (s === 0 ? 0 : Math.ceil(n / s - 1e-9) * s), [1, 2], true),
  FLOOR: numFn((n, s = 1) => (s === 0 ? 0 : Math.floor(n / s + 1e-9) * s), [1, 2], true),
  CONCAT: {
    arity: [1, Infinity],
    run: (args) => {
      let s = "";
      for (const v of flat(args)) {
        const t = toText(v);
        if (v.t === "e") return v;
        s += t;
      }
      return str(s);
    },
  },
  LEN: textFn((s) => num([...s].length)),
  UPPER: textFn((s) => str(s.toUpperCase())),
  LOWER: textFn((s) => str(s.toLowerCase())),
  PROPER: textFn((s) => str(s.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase()))),
  TRIM: textFn((s) => str(s.trim().replace(/ {2,}/g, " "))),
  LEFT: textFn(
    (s, n) => {
      const k = n ? intArg(n) : 1;
      return typeof k === "string" ? err(k) : k < 0 ? err("#VALUE!") : str([...s].slice(0, k).join(""));
    },
    [1, 2],
  ),
  RIGHT: textFn(
    (s, n) => {
      const k = n ? intArg(n) : 1;
      return typeof k === "string" ? err(k) : k < 0 ? err("#VALUE!") : str(k ? [...s].slice(-k).join("") : "");
    },
    [1, 2],
  ),
  MID: textFn(
    (s, a, n) => {
      const i = intArg(a);
      const k = intArg(n);
      if (typeof i === "string") return err(i);
      if (typeof k === "string") return err(k);
      return i < 1 || k < 0 ? err("#VALUE!") : str([...s].slice(i - 1, i - 1 + k).join(""));
    },
    [3, 3],
  ),
  FIND: {
    arity: [2, 3],
    run: (args) => {
      const needle = toText(one(args[0]));
      const hay = toText(one(args[1]));
      const from = args[2] ? intArg(one(args[2])) : 1;
      if (typeof from === "string") return err(from);
      const i = hay.indexOf(needle, from - 1);
      return i < 0 ? err("#VALUE!") : num(i + 1);
    },
  },
  SEARCH: {
    arity: [2, 3],
    run: (args) => {
      const needle = toText(one(args[0])).toLowerCase();
      const hay = toText(one(args[1])).toLowerCase();
      const from = args[2] ? intArg(one(args[2])) : 1;
      if (typeof from === "string") return err(from);
      const i = hay.indexOf(needle, from - 1);
      return i < 0 ? err("#VALUE!") : num(i + 1);
    },
  },
  SUBSTITUTE: textFn((s, a, b) => str(s.split(toText(a)).join(toText(b))), [3, 3]),
  REPT: textFn((s, n) => {
    const k = intArg(n);
    return typeof k === "string" ? err(k) : k < 0 ? err("#VALUE!") : str(s.repeat(k));
  }, [2, 2]),
  VALUE: textFn((s) => {
    const p = parseNumber(s);
    return p ? num(p.n) : err("#VALUE!");
  }),
  TODAY: { arity: [0, 0], run: (_a, ctx) => num(Math.floor(serialOfDate(ctx.now)), "date") },
  NOW: { arity: [0, 0], run: (_a, ctx) => num(serialOfDate(ctx.now), "date") },
  DATE: {
    arity: [3, 3],
    run: (args) => {
      const [y, m, d] = args.map((a) => intArg(one(a)));
      for (const x of [y, m, d]) if (typeof x === "string") return err(x);
      // Date.UTC 會處理超出範圍的月與日（13 月＝隔年 1 月）
      return num(serialOf(y as number, m as number, d as number), "date");
    },
  },
  YEAR: { arity: [1, 1], run: (args) => { const d = ymd(one(args[0])); return typeof d === "string" ? err(d) : num(d.getUTCFullYear()); } },
  MONTH: { arity: [1, 1], run: (args) => { const d = ymd(one(args[0])); return typeof d === "string" ? err(d) : num(d.getUTCMonth() + 1); } },
  DAY: { arity: [1, 1], run: (args) => { const d = ymd(one(args[0])); return typeof d === "string" ? err(d) : num(d.getUTCDate()); } },
  WEEKDAY: { arity: [1, 1], run: (args) => { const d = ymd(one(args[0])); return typeof d === "string" ? err(d) : num(d.getUTCDay() + 1); } },
  DAYS: numFn((a, b) => Math.floor(a) - Math.floor(b), [2, 2]),
  EDATE: {
    arity: [2, 2],
    run: (args) => {
      const d = ymd(one(args[0]));
      const k = intArg(one(args[1]));
      if (typeof d === "string") return err(d);
      if (typeof k === "string") return err(k);
      const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 1));
      const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
      return num(serialOf(t.getUTCFullYear(), t.getUTCMonth() + 1, Math.min(d.getUTCDate(), last)), "date");
    },
  },
  VLOOKUP: {
    arity: [3, 4],
    run: (args) => {
      const key = one(args[0]);
      const table = Array.isArray(args[1]) ? args[1] : [[args[1]]];
      const col = intArg(one(args[2]));
      if (typeof col === "string") return err(col);
      if (col < 1 || col > (table[0]?.length ?? 0)) return err("#REF!");
      const exact = args[3] ? toBool(one(args[3])) === false : false;
      if (exact) {
        const row = table.find((r) => r[0] && r[0].t !== "empty" && compare(r[0], key) === 0);
        return row ? row[col - 1] ?? EMPTY : err("#N/A");
      }
      // 近似：已排序的第一欄裡，不大於 key 的最後一列
      let hit: Value[] | null = null;
      for (const r of table) {
        if (!r[0] || r[0].t === "empty") continue;
        if (compare(r[0], key) <= 0) hit = r;
        else break;
      }
      return hit ? hit[col - 1] ?? EMPTY : err("#N/A");
    },
  },
  INDEX: {
    arity: [2, 3],
    run: (args) => {
      const t = Array.isArray(args[0]) ? args[0] : [[args[0]]];
      const r = intArg(one(args[1]));
      const c = args[2] ? intArg(one(args[2])) : 1;
      if (typeof r === "string") return err(r);
      if (typeof c === "string") return err(c);
      // 只有一列時，第二個參數是欄
      if (t.length === 1 && !args[2]) return t[0][r - 1] ?? err("#REF!");
      return t[r - 1]?.[c - 1] ?? err("#REF!");
    },
  },
  MATCH: {
    arity: [2, 3],
    run: (args) => {
      const key = one(args[0]);
      const list = flat([args[1]]);
      const mode = args[2] ? intArg(one(args[2])) : 1;
      if (typeof mode === "string") return err(mode);
      if (mode === 0) {
        const i = list.findIndex((v) => v.t !== "empty" && compare(v, key) === 0);
        return i < 0 ? err("#N/A") : num(i + 1);
      }
      let hit = -1;
      list.forEach((v, i) => {
        if (v.t === "empty") return;
        const c = compare(v, key);
        if (mode > 0 ? c <= 0 : c >= 0) hit = i;
      });
      return hit < 0 ? err("#N/A") : num(hit + 1);
    },
  },
};
/* ─── Excel 與 Google 試算表共有的其他函式 ─── */

const grid = (a: Arg): Value[][] => (Array.isArray(a) ? a : [[a]]);

/** SUMIFS 這類：第一個（或沒有）是要算的範圍，後面一對一對是「範圍, 條件」；傳回符合的位置 */
function multiMatch(pairs: Arg[]): ((r: number, c: number) => boolean) | ErrCode {
  if (pairs.length % 2) return "#VALUE!";
  const tests: { g: Value[][]; ok: (v: Value) => boolean }[] = [];
  for (let i = 0; i < pairs.length; i += 2) tests.push({ g: grid(pairs[i]), ok: matcher(one(pairs[i + 1])) });
  return (r, c) => tests.every((t) => t.ok(t.g[r]?.[c] ?? EMPTY));
}

const ifsAgg = (f: (xs: number[]) => Value): Fn => ({
  arity: [3, Infinity],
  run: (args) => {
    const target = grid(args[0]);
    const test = multiMatch(args.slice(1));
    if (typeof test === "string") return err(test);
    const xs: number[] = [];
    target.forEach((row, r) =>
      row.forEach((v, c) => {
        if (v.t === "n" && test(r, c)) xs.push(v.n);
      }),
    );
    return f(xs);
  },
});

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);

function variance(xs: number[], sample: boolean): number {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  return xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (sample ? n - 1 : n);
}

const statFn = (f: (xs: number[]) => number, min = 1): Fn => ({
  arity: [1, Infinity],
  run: (args) => {
    const xs = nums(args);
    if (typeof xs === "string") return err(xs);
    if (xs.length < min) return err("#DIV/0!");
    return num(f(xs));
  },
});

const kth = (largest: boolean): Fn => ({
  arity: [2, 2],
  run: (args) => {
    const xs = nums([args[0]]);
    const k = intArg(one(args[1]));
    if (typeof xs === "string") return err(xs);
    if (typeof k === "string") return err(k);
    if (k < 1 || k > xs.length) return err("#NUM!");
    const s = sorted(xs);
    return num(largest ? s[s.length - k] : s[k - 1], hintOf([args[0]]));
  },
});

/** 一個值的時、分、秒（日期序號的小數部分是一天裡的時間） */
const timePart = (unit: "h" | "m" | "s"): Fn => ({
  arity: [1, 1],
  run: (args) => {
    const v = one(args[0]);
    let n: number;
    if (v.t === "s") {
      const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(v.s.trim());
      if (!m) return err("#VALUE!");
      let h = Number(m[1]) % (m[4] ? 12 : 24);
      if (m[4]?.toLowerCase() === "pm") h += 12;
      n = (h * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0)) / 86400;
    } else {
      const x = toNum(v);
      if (typeof x === "string") return err(x);
      n = x.n;
    }
    const secs = Math.round((n - Math.floor(n)) * 86400);
    return num(unit === "h" ? Math.floor(secs / 3600) : unit === "m" ? Math.floor(secs / 60) % 60 : secs % 60);
  },
});

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** TEXT 的格式：常見的數字格式（0、0.00、#,##0、%、貨幣符號）與日期格式（yyyy、mm、dd、mmm、ddd、hh:mm） */
export function formatText(n: number, fmt: string): string {
  if (/[yd]|m{3,}|h/i.test(fmt.replace(/"[^"]*"/g, "")) || /^m{1,2}[/\-.]/i.test(fmt)) {
    const d = dateOfSerial(n);
    const secs = Math.round((n - Math.floor(n)) * 86400);
    const hh = Math.floor(secs / 3600);
    const pm = /am\/pm/i.test(fmt);
    const pad = (x: number, k = 2) => String(x).padStart(k, "0");
    let seenH = false;
    return fmt.replace(/"([^"]*)"|yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|am\/pm/gi, (tok, lit) => {
      if (lit !== undefined) return lit;
      const t = tok.toLowerCase();
      switch (t) {
        case "yyyy":
          return String(d.getUTCFullYear());
        case "yy":
          return pad(d.getUTCFullYear() % 100);
        case "mmmm":
          return MONTHS_LONG[d.getUTCMonth()];
        case "mmm":
          return MONTHS_SHORT[d.getUTCMonth()];
        case "mm":
        case "m":
          // h 後面的 m 是分鐘
          if (seenH) return t === "mm" ? pad(Math.floor(secs / 60) % 60) : String(Math.floor(secs / 60) % 60);
          return t === "mm" ? pad(d.getUTCMonth() + 1) : String(d.getUTCMonth() + 1);
        case "dddd":
          return DAYS_LONG[d.getUTCDay()];
        case "ddd":
          return DAYS_SHORT[d.getUTCDay()];
        case "dd":
          return pad(d.getUTCDate());
        case "d":
          return String(d.getUTCDate());
        case "hh":
        case "h": {
          seenH = true;
          const h = pm ? hh % 12 || 12 : hh;
          return t === "hh" ? pad(h) : String(h);
        }
        case "ss":
          return pad(secs % 60);
        case "s":
          return String(secs % 60);
        case "am/pm":
          return hh < 12 ? "AM" : "PM";
      }
      return tok;
    });
  }
  const pct = fmt.includes("%");
  const x = pct ? n * 100 : n;
  const m = /([#0,]*0?)(?:\.(0+|#+))?/.exec(fmt.replace(/"[^"]*"/g, ""));
  const decs = m?.[2]?.length ?? 0;
  const comma = (m?.[1] ?? "").includes(",");
  let body = Math.abs(x).toFixed(decs);
  if (comma) {
    const [i, f] = body.split(".");
    body = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? "." + f : "");
  }
  const prefix = /^[^#0.,%]*/.exec(fmt)?.[0].replace(/"/g, "") ?? "";
  return (x < 0 ? "-" : "") + prefix + body + (pct ? "%" : "");
}

const MORE: Record<string, Fn> = {
  SUMIFS: ifsAgg((xs) => num(xs.reduce((a, b) => a + b, 0))),
  AVERAGEIFS: ifsAgg((xs) => (xs.length ? num(xs.reduce((a, b) => a + b, 0) / xs.length) : err("#DIV/0!"))),
  MAXIFS: ifsAgg((xs) => num(xs.length ? Math.max(...xs) : 0)),
  MINIFS: ifsAgg((xs) => num(xs.length ? Math.min(...xs) : 0)),
  COUNTIFS: {
    arity: [2, Infinity],
    run: (args) => {
      const test = multiMatch(args);
      if (typeof test === "string") return err(test);
      const g = grid(args[0]);
      let n = 0;
      g.forEach((row, r) => row.forEach((_v, c) => test(r, c) && n++));
      return num(n);
    },
  },
  XLOOKUP: {
    arity: [3, 4],
    run: (args) => {
      const key = one(args[0]);
      const look = grid(args[1]);
      const back = grid(args[2]);
      const vertical = look.length > 1 || (look[0]?.length ?? 0) === 1;
      const list = vertical ? look.map((r) => r[0] ?? EMPTY) : (look[0] ?? []);
      const i = list.findIndex((v) => v.t !== "empty" && compare(v, key) === 0);
      if (i < 0) return args[3] !== undefined ? one(args[3]) : err("#N/A");
      return (vertical ? back[i]?.[0] : back[0]?.[i]) ?? EMPTY;
    },
  },
  HLOOKUP: {
    arity: [3, 4],
    run: (args) => {
      const key = one(args[0]);
      const t = grid(args[1]);
      const row = intArg(one(args[2]));
      if (typeof row === "string") return err(row);
      if (row < 1 || row > t.length) return err("#REF!");
      const exact = args[3] ? toBool(one(args[3])) === false : false;
      const first = t[0] ?? [];
      let hit = -1;
      if (exact) hit = first.findIndex((v) => v.t !== "empty" && compare(v, key) === 0);
      else
        for (let c = 0; c < first.length; c++) {
          if (first[c].t === "empty") continue;
          if (compare(first[c], key) <= 0) hit = c;
          else break;
        }
      return hit < 0 ? err("#N/A") : (t[row - 1][hit] ?? EMPTY);
    },
  },
  IFS: {
    arity: [2, Infinity],
    run: (args) => {
      for (let i = 0; i + 1 < args.length; i += 2) {
        const b = toBool(one(args[i]));
        if (typeof b === "string") return err(b);
        if (b) return one(args[i + 1]);
      }
      return err("#N/A");
    },
  },
  SWITCH: {
    arity: [3, Infinity],
    run: (args) => {
      const v = one(args[0]);
      let i = 1;
      for (; i + 1 < args.length; i += 2) if (compare(v, one(args[i])) === 0) return one(args[i + 1]);
      return i < args.length ? one(args[i]) : err("#N/A");
    },
  },
  CHOOSE: {
    arity: [2, Infinity],
    run: (args) => {
      const k = intArg(one(args[0]));
      if (typeof k === "string") return err(k);
      return k >= 1 && k < args.length ? one(args[k]) : err("#VALUE!");
    },
  },
  TEXTJOIN: {
    arity: [3, Infinity],
    run: (args) => {
      const sep = toText(one(args[0]));
      const skip = toBool(one(args[1]));
      if (typeof skip === "string") return err(skip);
      const parts: string[] = [];
      for (const v of flat(args.slice(2))) {
        if (v.t === "e") return v;
        const t = toText(v);
        if (skip && !t) continue;
        parts.push(t);
      }
      return str(parts.join(sep));
    },
  },
  TEXT: {
    arity: [2, 2],
    run: (args) => {
      const v = one(args[0]);
      const n = toNum(v);
      if (typeof n === "string") return v.t === "s" ? str(v.s) : err(n);
      return str(formatText(n.n, toText(one(args[1]))));
    },
  },
  LARGE: kth(true),
  SMALL: kth(false),
  RANK: {
    arity: [2, 3],
    run: (args) => {
      const x = toNum(one(args[0]));
      const xs = nums([args[1]]);
      const asc = args[2] ? intArg(one(args[2])) : 0;
      if (typeof x === "string") return err(x);
      if (typeof xs === "string") return err(xs);
      if (typeof asc === "string") return err(asc);
      if (!xs.includes(x.n)) return err("#N/A");
      return num(1 + xs.filter((y) => (asc ? y < x.n : y > x.n)).length);
    },
  },
  STDEV: statFn((xs) => Math.sqrt(variance(xs, true)), 2),
  STDEVP: statFn((xs) => Math.sqrt(variance(xs, false))),
  VAR: statFn((xs) => variance(xs, true), 2),
  VARP: statFn((xs) => variance(xs, false)),
  MODE: statFn((xs) => {
    const count = new Map<number, number>();
    for (const x of xs) count.set(x, (count.get(x) ?? 0) + 1);
    let best = xs[0];
    for (const x of xs) if ((count.get(x) ?? 0) > (count.get(best) ?? 0)) best = x;
    return (count.get(best) ?? 0) > 1 ? best : NaN;
  }),
  SUMPRODUCT: {
    arity: [1, Infinity],
    run: (args) => {
      const gs = args.map(grid);
      const rows = gs[0].length;
      const cols = gs[0][0]?.length ?? 0;
      if (gs.some((g) => g.length !== rows || (g[0]?.length ?? 0) !== cols)) return err("#VALUE!");
      let total = 0;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) total += gs.reduce((p, g) => p * (g[r][c].t === "n" ? (g[r][c] as { n: number }).n : 0), 1);
      return num(total);
    },
  },
  RAND: { arity: [0, 0], run: () => num(Math.random()) },
  RANDBETWEEN: numFn((a, b) => Math.floor(Math.random() * (Math.floor(b) - Math.ceil(a) + 1)) + Math.ceil(a), [2, 2]),
  TRUNC: numFn((n, d = 0) => roundTo(n, Math.trunc(d), "down"), [1, 2], true),
  LOG: numFn((n, b = 10) => (n <= 0 || b <= 0 || b === 1 ? NaN : Math.log(n) / Math.log(b)), [1, 2]),
  ISODD: { arity: [1, 1], run: (args) => { const n = toNum(one(args[0])); return typeof n === "string" ? err(n) : bool(Math.abs(Math.trunc(n.n)) % 2 === 1); } },
  ISEVEN: { arity: [1, 1], run: (args) => { const n = toNum(one(args[0])); return typeof n === "string" ? err(n) : bool(Math.abs(Math.trunc(n.n)) % 2 === 0); } },
  ISNA: { arity: [1, 1], run: (args) => bool(one(args[0]).t === "e" && (one(args[0]) as { e: ErrCode }).e === "#N/A") },
  NA: { arity: [0, 0], run: () => err("#N/A") },
  HOUR: timePart("h"),
  MINUTE: timePart("m"),
  SECOND: timePart("s"),
  TIME: numFn((h, m, s) => ((h * 3600 + m * 60 + s) / 86400) % 1, [3, 3]),
  EOMONTH: {
    arity: [2, 2],
    run: (args) => {
      const d = ymd(one(args[0]));
      const k = intArg(one(args[1]));
      if (typeof d === "string") return err(d);
      if (typeof k === "string") return err(k);
      const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k + 1, 0));
      return num(serialOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()), "date");
    },
  },
  NETWORKDAYS: {
    arity: [2, 2],
    run: (args) => {
      const a = toNum(one(args[0]));
      const b = toNum(one(args[1]));
      if (typeof a === "string") return err(a);
      if (typeof b === "string") return err(b);
      const lo = Math.floor(Math.min(a.n, b.n));
      const hi = Math.floor(Math.max(a.n, b.n));
      let n = 0;
      for (let x = lo; x <= hi; x++) {
        const w = dateOfSerial(x).getUTCDay();
        if (w !== 0 && w !== 6) n++;
      }
      return num(a.n <= b.n ? n : -n);
    },
  },
  EXACT: { arity: [2, 2], run: (args) => bool(toText(one(args[0])) === toText(one(args[1]))) },
  CODE: textFn((s) => (s ? num(s.codePointAt(0)!) : err("#VALUE!"))),
};
// CHAR／UNICHAR 傳回文字
MORE.CHAR = { arity: [1, 1], run: (args) => { const k = intArg(one(args[0])); return typeof k === "string" ? err(k) : k < 1 ? err("#VALUE!") : str(String.fromCodePoint(k)); } };
MORE.UNICHAR = MORE.CHAR;
Object.assign(FUNCS, MORE);
FUNCS.CONCATENATE = FUNCS.CONCAT;
FUNCS.AVG = FUNCS.AVERAGE;

/** 公式選單用：全部的函式名稱 */
export const FUNCTION_NAMES = [...Object.keys(FUNCS), "IF", "IFERROR", "IFNA"].sort();

export function evalNode(node: Node, ctx: EvalCtx): Value {
  const arg = (n: Node): Arg => {
    if (n.k === "range") {
      const r = ctx.range(n.a, n.b);
      return typeof r === "string" ? err(r) : r;
    }
    return evalNode(n, ctx);
  };
  switch (node.k) {
    case "num":
      return num(node.v);
    case "str":
      return str(node.v);
    case "bool":
      return bool(node.v);
    case "err":
      return err(node.v);
    case "ref":
      return ctx.cell(node.ref);
    case "range": {
      // 單獨一個範圍（不在函式裡）：只有一格才有值
      const r = ctx.range(node.a, node.b);
      if (typeof r === "string") return err(r);
      return r.length === 1 && r[0].length === 1 ? r[0][0] : err("#VALUE!", "A range can only be used inside a function like SUM");
    }
    case "neg": {
      const n = toNum(evalNode(node.x, ctx));
      return typeof n === "string" ? err(n) : num(-n.n, n.hint);
    }
    case "pct": {
      const n = toNum(evalNode(node.x, ctx));
      return typeof n === "string" ? err(n) : num(n.n / 100, "pct");
    }
    case "bin": {
      const a = evalNode(node.a, ctx);
      const b = evalNode(node.b, ctx);
      if (isErr(a)) return a;
      if (isErr(b)) return b;
      if (node.op === "&") {
        return str(`${toText(a)}${toText(b)}`);
      }
      if (["=", "<>", "<", ">", "<=", ">="].includes(node.op)) {
        const c = compare(a, b);
        return bool(
          node.op === "=" ? c === 0 : node.op === "<>" ? c !== 0 : node.op === "<" ? c < 0 : node.op === ">" ? c > 0 : node.op === "<=" ? c <= 0 : c >= 0,
        );
      }
      const x = toNum(a);
      const y = toNum(b);
      if (typeof x === "string") return err(x, a.t === "s" ? `“${a.s}” is not a number` : undefined);
      if (typeof y === "string") return err(y, b.t === "s" ? `“${b.s}” is not a number` : undefined);
      switch (node.op) {
        case "+":
          return num(x.n + y.n, x.hint ?? y.hint);
        case "-":
          // 日期減日期是天數
          return num(x.n - y.n, x.hint === "date" && y.hint === "date" ? undefined : (x.hint ?? y.hint));
        case "*":
          return num(x.n * y.n, x.hint === "date" || y.hint === "date" ? undefined : (x.hint ?? y.hint));
        case "/":
          return y.n === 0 ? err("#DIV/0!") : num(x.n / y.n, x.hint === "date" ? undefined : x.hint === y.hint ? undefined : x.hint);
        case "^":
          return num(Math.pow(x.n, y.n));
      }
      return err("#ERROR!");
    }
    case "call": {
      if (node.fn === "IF") {
        const c = evalNode(node.args[0], ctx);
        if (isErr(c)) return c;
        const b = toBool(c);
        if (typeof b === "string") return err(b);
        const pick = b ? node.args[1] : node.args[2];
        return pick ? evalNode(pick, ctx) : bool(false);
      }
      if (node.fn === "IFERROR") {
        const v = evalNode(node.args[0], ctx);
        return isErr(v) ? evalNode(node.args[1], ctx) : v;
      }
      if (node.fn === "IFNA") {
        const v = evalNode(node.args[0], ctx);
        return v.t === "e" && v.e === "#N/A" ? evalNode(node.args[1], ctx) : v;
      }
      const f = FUNCS[node.fn];
      const args = node.args.map(arg);
      // 單一值參數的錯誤直接傳出去（ISERROR 除外）
      if (node.fn !== "ISERROR" && node.fn !== "ISNA" && node.fn !== "COUNTA" && node.fn !== "COUNT") for (const a of args) if (!Array.isArray(a) && isErr(a)) return a;
      return f.run(args, ctx);
    }
  }
}

export const ERROR_HELP: Record<ErrCode, string> = {
  "#DIV/0!": "Division by zero",
  "#VALUE!": "A value has the wrong type",
  "#REF!": "Refers to a cell or table that doesn't exist",
  "#NAME?": "Unknown name",
  "#NUM!": "The number is out of range",
  "#N/A": "No match found",
  "#CIRC!": "The formula refers to itself",
  "#ERROR!": "The formula has a syntax error",
};
