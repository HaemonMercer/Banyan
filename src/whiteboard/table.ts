/**
 * Tables on the whiteboard, drawn like an Excel sheet (column letters, row numbers, gridlines,
 * formula bar, fill handle) with Excel's "Format as Table" options: header row, first column,
 * total row, banded rows, colour styles. Formulas start with "=" (`=SUM(B2:B5)`, `=B2*C2`) and
 * use A1 addresses, the header row counted like any other row.
 */

import { newNodeId } from "./objects";

export interface TableColumn {
    id: string;
    width: number;
    align?: "left" | "center" | "right";
}

export interface TableRow {
    id: string;
    /** Raw input by column id: text, a number, or a formula starting with "=". */
    cells: Record<string, string>;
}

export type TableStyle = "gray" | "blue" | "green" | "orange" | "purple";
export const TABLE_STYLES: TableStyle[] = ["gray", "blue", "green", "orange", "purple"];
export const TABLE_STYLE_NAMES: Record<TableStyle, string> = { gray: "灰", blue: "藍", green: "綠", orange: "橘", purple: "紫" };
/** Excel's table colours (Office theme). */
export const TABLE_STYLE_COLORS: Record<TableStyle, string> = {
    gray: "#7f7f7f",
    blue: "#4472c4",
    green: "#70ad47",
    orange: "#ed7d31",
    purple: "#7a5ea8",
};

export interface TableData {
    cols: TableColumn[];
    rows: TableRow[];
    headerRows: number;
    headerCols: number;
    footerRows: number;
    style: TableStyle;
    /** Alternate row shading. */
    banded: boolean;
}

export const ROW_HEIGHT = 24;
export const DEFAULT_COL_WIDTH = 100;
export const MIN_COL_WIDTH = 32;
export const MAX_AUTOFIT_WIDTH = 480;
/** The table's name bar above the sheet. */
export const TABLE_TITLE_H = 26;
/** Excel-style headers: the column letters strip and the row numbers strip. */
export const COL_HEAD_H = 20;
export const ROW_HEAD_W = 36;

export function newTable(cols = 4, rows = 5): TableData {
    const columns = Array.from({ length: cols }, () => ({ id: newNodeId(), width: DEFAULT_COL_WIDTH }));
    return {
        cols: columns,
        rows: Array.from({ length: rows }, () => ({ id: newNodeId(), cells: {} })),
        headerRows: 1,
        headerCols: 0,
        footerRows: 0,
        style: "blue",
        banded: true,
    };
}

/** Reads a table from `data`, repairing what is missing. */
export function readTable(data: string): TableData {
    let d: Partial<TableData> = {};
    try {
        d = data ? JSON.parse(data) : {};
    } catch {
        /* broken: start over */
    }
    const base = newTable();
    const cols = Array.isArray(d.cols) && d.cols.length
        ? d.cols.map((c) => ({ id: String(c?.id || newNodeId()), width: Math.max(MIN_COL_WIDTH, Number(c?.width) || DEFAULT_COL_WIDTH), ...(c?.align ? { align: c.align } : {}) }))
        : base.cols;
    const rows = Array.isArray(d.rows) && d.rows.length
        ? d.rows.map((r) => ({ id: String(r?.id || newNodeId()), cells: r && typeof r.cells === "object" ? { ...r.cells } : {} }))
        : base.rows;
    const clampCount = (v: unknown, max: number) => Math.min(max, Math.max(0, Math.floor(Number(v) || 0)));
    return {
        cols,
        rows,
        headerRows: d.headerRows === undefined ? 1 : clampCount(d.headerRows, rows.length),
        headerCols: d.headerCols === undefined ? 1 : clampCount(d.headerCols, cols.length),
        footerRows: clampCount(d.footerRows, rows.length),
        style: TABLE_STYLES.includes(d.style as TableStyle) ? (d.style as TableStyle) : "gray",
        banded: !!d.banded,
    };
}

// ---------- addresses ----------

export function colName(i: number): string {
    let s = "";
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
}

export function colIndex(name: string): number {
    let n = 0;
    for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
}

export const cellName = (r: number, c: number) => `${colName(c)}${r + 1}`;

// ---------- values ----------

export type CellValue = { kind: "empty" } | { kind: "number"; n: number } | { kind: "text"; s: string } | { kind: "bool"; b: boolean } | { kind: "error"; code: string };

const NUMBER_RE = /^[-+]?(?:[$€£¥NT$]*)\s*(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:e[-+]?\d+)?%?$/i;

/** A number typed into a cell ("1,234.5", "12%", "$30"), or null. */
export function parseNumber(raw: string): number | null {
    const t = raw.trim();
    if (!t || !/\d/.test(t) || !NUMBER_RE.test(t)) return null;
    const pct = t.endsWith("%");
    const n = Number(t.replace(/[,%$€£¥\s]|NT/gi, ""));
    if (!Number.isFinite(n)) return null;
    return pct ? n / 100 : n;
}

class FormulaError extends Error {
    constructor(public code: string) {
        super(code);
    }
}

type Val = number | string | boolean;
type Arg = Val | Val[];

const toNumber = (v: Val): number => {
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (v === "") return 0;
    const n = parseNumber(v);
    if (n === null) throw new FormulaError("#VALUE!");
    return n;
};
const toText = (v: Val) => (typeof v === "number" ? formatNumber(v) : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : v);
const toBool = (v: Val) => (typeof v === "boolean" ? v : typeof v === "number" ? v !== 0 : v.toUpperCase() === "TRUE");

/** Numbers in arguments (ranges skip text and blanks, like spreadsheets do). */
function numbers(args: Arg[]): number[] {
    const out: number[] = [];
    for (const a of args) {
        if (Array.isArray(a)) {
            for (const v of a) if (typeof v === "number") out.push(v);
        } else out.push(toNumber(a));
    }
    return out;
}

const scalar = (a: Arg): Val => {
    if (Array.isArray(a)) {
        if (a.length === 1) return a[0];
        throw new FormulaError("#VALUE!");
    }
    return a;
};

const FUNCTIONS: Record<string, (args: Arg[]) => Val> = {
    SUM: (a) => numbers(a).reduce((s, n) => s + n, 0),
    AVERAGE: (a) => {
        const n = numbers(a);
        if (!n.length) throw new FormulaError("#DIV/0!");
        return n.reduce((s, x) => s + x, 0) / n.length;
    },
    MIN: (a) => (numbers(a).length ? Math.min(...numbers(a)) : 0),
    MAX: (a) => (numbers(a).length ? Math.max(...numbers(a)) : 0),
    COUNT: (a) => numbers(a).length,
    COUNTA: (a) => a.flat().filter((v) => v !== "").length,
    PRODUCT: (a) => numbers(a).reduce((s, n) => s * n, 1),
    MEDIAN: (a) => {
        const n = numbers(a).sort((x, y) => x - y);
        if (!n.length) throw new FormulaError("#NUM!");
        const m = Math.floor(n.length / 2);
        return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2;
    },
    ROUND: (a) => {
        const d = a.length > 1 ? toNumber(scalar(a[1])) : 0;
        const k = 10 ** d;
        return Math.round(toNumber(scalar(a[0])) * k) / k;
    },
    ABS: (a) => Math.abs(toNumber(scalar(a[0]))),
    SQRT: (a) => {
        const n = toNumber(scalar(a[0]));
        if (n < 0) throw new FormulaError("#NUM!");
        return Math.sqrt(n);
    },
    POWER: (a) => toNumber(scalar(a[0])) ** toNumber(scalar(a[1])),
    IF: (a) => (toBool(scalar(a[0])) ? (a.length > 1 ? scalar(a[1]) : true) : a.length > 2 ? scalar(a[2]) : false),
    AND: (a) => a.flat().every((v) => toBool(v)),
    OR: (a) => a.flat().some((v) => toBool(v)),
    NOT: (a) => !toBool(scalar(a[0])),
    CONCAT: (a) => a.flat().map(toText).join(""),
    LEN: (a) => toText(scalar(a[0])).length,
    UPPER: (a) => toText(scalar(a[0])).toUpperCase(),
    LOWER: (a) => toText(scalar(a[0])).toLowerCase(),
};
export const FUNCTION_NAMES = Object.keys(FUNCTIONS);

type Token =
    | { t: "num"; v: number }
    | { t: "str"; v: string }
    | { t: "ref"; r: number; c: number }
    | { t: "range"; r1: number; c1: number; r2: number; c2: number }
    | { t: "name"; v: string }
    | { t: "op"; v: string };

const REF = /^\$?([A-Za-z]{1,3})\$?(\d+)/;

function tokenize(src: string): Token[] {
    const out: Token[] = [];
    let i = 0;
    while (i < src.length) {
        const ch = src[i];
        if (/\s/.test(ch)) {
            i++;
            continue;
        }
        if (ch === '"') {
            let j = i + 1;
            let s = "";
            while (j < src.length) {
                if (src[j] === '"' && src[j + 1] === '"') {
                    s += '"';
                    j += 2;
                } else if (src[j] === '"') break;
                else s += src[j++];
            }
            if (j >= src.length) throw new FormulaError("#ERROR!");
            out.push({ t: "str", v: s });
            i = j + 1;
            continue;
        }
        const num = /^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?%?/i.exec(src.slice(i));
        if (num) {
            const pct = num[0].endsWith("%");
            out.push({ t: "num", v: Number(pct ? num[0].slice(0, -1) : num[0]) / (pct ? 100 : 1) });
            i += num[0].length;
            continue;
        }
        const rest = src.slice(i);
        const ref = REF.exec(rest);
        if (ref && !/^[A-Za-z_(]/.test(rest.slice(ref[0].length))) {
            const r1 = Number(ref[2]) - 1;
            const c1 = colIndex(ref[1]);
            const after = rest.slice(ref[0].length);
            const second = after.startsWith(":") ? REF.exec(after.slice(1)) : null;
            if (second) {
                const r2 = Number(second[2]) - 1;
                const c2 = colIndex(second[1]);
                out.push({ t: "range", r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) });
                i += ref[0].length + 1 + second[0].length;
            } else {
                out.push({ t: "ref", r: r1, c: c1 });
                i += ref[0].length;
            }
            continue;
        }
        const name = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest);
        if (name) {
            out.push({ t: "name", v: name[0].toUpperCase() });
            i += name[0].length;
            continue;
        }
        const op = /^(<>|<=|>=|[-+*/^&=<>(),:;])/.exec(rest);
        if (op) {
            out.push({ t: "op", v: op[0] === ";" ? "," : op[0] });
            i += op[0].length;
            continue;
        }
        throw new FormulaError("#ERROR!");
    }
    return out;
}

/** Evaluates every cell of a table (formulas included). */
export function evaluateTable(t: TableData): CellValue[][] {
    const nR = t.rows.length;
    const nC = t.cols.length;
    const cache: (CellValue | undefined)[][] = Array.from({ length: nR }, () => new Array(nC));
    const visiting = new Set<string>();

    const raw = (r: number, c: number) => t.rows[r]?.cells[t.cols[c]?.id] ?? "";

    const valueAt = (r: number, c: number): Val => {
        if (r < 0 || c < 0 || r >= nR || c >= nC) throw new FormulaError("#REF!");
        const v = cell(r, c);
        if (v.kind === "error") throw new FormulaError(v.code);
        return v.kind === "number" ? v.n : v.kind === "bool" ? v.b : v.kind === "text" ? v.s : "";
    };

    const formula = (src: string): Val => {
        const toks = tokenize(src);
        let p = 0;
        const peek = () => toks[p];
        const isOp = (v: string) => peek()?.t === "op" && (peek() as { v: string }).v === v;
        const expect = (v: string) => {
            if (!isOp(v)) throw new FormulaError("#ERROR!");
            p++;
        };

        const arg = (): Arg => {
            const tk = peek();
            if (tk?.t === "range" && (toks[p + 1] === undefined || (toks[p + 1].t === "op" && [",", ")"].includes((toks[p + 1] as { v: string }).v)))) {
                p++;
                const vals: Val[] = [];
                for (let r = tk.r1; r <= tk.r2; r++) for (let c = tk.c1; c <= tk.c2; c++) vals.push(valueAt(r, c));
                return vals;
            }
            return comparison();
        };
        const primary = (): Val => {
            const tk = peek();
            if (!tk) throw new FormulaError("#ERROR!");
            p++;
            if (tk.t === "num") return tk.v;
            if (tk.t === "str") return tk.v;
            if (tk.t === "ref") return valueAt(tk.r, tk.c);
            if (tk.t === "range") throw new FormulaError("#VALUE!");
            if (tk.t === "name") {
                if (tk.v === "TRUE") return true;
                if (tk.v === "FALSE") return false;
                const fn = FUNCTIONS[tk.v];
                if (!fn) throw new FormulaError("#NAME?");
                expect("(");
                const args: Arg[] = [];
                if (!isOp(")")) {
                    args.push(arg());
                    while (isOp(",")) {
                        p++;
                        args.push(arg());
                    }
                }
                expect(")");
                return fn(args);
            }
            if (tk.v === "(") {
                const v = comparison();
                expect(")");
                return v;
            }
            if (tk.v === "-") return -toNumber(power());
            if (tk.v === "+") return toNumber(power());
            throw new FormulaError("#ERROR!");
        };
        const power = (): Val => {
            let v = primary();
            while (isOp("^")) {
                p++;
                v = toNumber(v) ** toNumber(primary());
            }
            return v;
        };
        const product = (): Val => {
            let v = power();
            while (isOp("*") || isOp("/")) {
                const op = (toks[p++] as { v: string }).v;
                const b = toNumber(power());
                if (op === "/" && b === 0) throw new FormulaError("#DIV/0!");
                v = op === "*" ? toNumber(v) * b : toNumber(v) / b;
            }
            return v;
        };
        const sum = (): Val => {
            let v = product();
            while (isOp("+") || isOp("-")) {
                const op = (toks[p++] as { v: string }).v;
                const b = toNumber(product());
                v = op === "+" ? toNumber(v) + b : toNumber(v) - b;
            }
            return v;
        };
        const concat = (): Val => {
            let v = sum();
            while (isOp("&")) {
                p++;
                v = toText(v) + toText(sum());
            }
            return v;
        };
        const comparison = (): Val => {
            const a = concat();
            for (const op of ["=", "<>", "<=", ">=", "<", ">"]) {
                if (isOp(op)) {
                    p++;
                    const b = concat();
                    const both = typeof a === "number" && typeof b === "number";
                    const x = both ? a : toText(a).toLowerCase();
                    const y = both ? b : toText(b).toLowerCase();
                    switch (op) {
                        case "=": return x === y;
                        case "<>": return x !== y;
                        case "<=": return x <= y;
                        case ">=": return x >= y;
                        case "<": return x < y;
                        default: return x > y;
                    }
                }
            }
            return a;
        };
        const v = comparison();
        if (p < toks.length) throw new FormulaError("#ERROR!");
        return v;
    };

    const cell = (r: number, c: number): CellValue => {
        const have = cache[r][c];
        if (have) return have;
        const key = `${r},${c}`;
        if (visiting.has(key)) return { kind: "error", code: "#CIRC!" };
        const text = raw(r, c);
        let out: CellValue;
        if (!text.trim()) out = { kind: "empty" };
        else if (text.startsWith("=")) {
            visiting.add(key);
            try {
                const v = formula(text.slice(1));
                out = typeof v === "number"
                    ? Number.isFinite(v) ? { kind: "number", n: v } : { kind: "error", code: "#NUM!" }
                    : typeof v === "boolean" ? { kind: "bool", b: v } : { kind: "text", s: v };
            } catch (e) {
                out = { kind: "error", code: e instanceof FormulaError ? e.code : "#ERROR!" };
            } finally {
                visiting.delete(key);
            }
        } else {
            const n = parseNumber(text);
            out = n === null ? { kind: "text", s: text } : { kind: "number", n };
        }
        cache[r][c] = out;
        return out;
    };

    return t.rows.map((_, r) => t.cols.map((_, c) => cell(r, c)));
}

export function formatNumber(n: number): string {
    if (Number.isInteger(n)) return String(n);
    return String(Number.parseFloat(n.toPrecision(12)));
}

/** What a cell shows: typed text as typed, formula results formatted. */
export function displayValue(raw: string, v: CellValue): string {
    if (v.kind === "error") return v.code;
    if (!raw.startsWith("=")) return raw;
    if (v.kind === "number") return formatNumber(v.n);
    if (v.kind === "bool") return v.b ? "TRUE" : "FALSE";
    return v.kind === "text" ? v.s : "";
}

// ---------- editing helpers ----------

/**
 * Rewrites the A1 references in a formula after a row or column was inserted (`delta` 1 at
 * `at`) or deleted (`delta` -1 at `at`); references to a deleted cell become #REF!.
 */
export function shiftFormula(src: string, axis: "row" | "col", at: number, delta: 1 | -1): string {
    if (!src.startsWith("=")) return src;
    // Leave string literals alone.
    return src.replace(/("(?:[^"]|"")*")|(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![A-Za-z_(\d])/g, (m, str, d1, col, d2, row, offset: number, whole: string) => {
        if (str) return str;
        if (offset > 0 && /[A-Za-z_]/.test(whole[offset - 1])) return m;
        let r = Number(row) - 1;
        let c = colIndex(col);
        const idx = axis === "row" ? r : c;
        let next = idx;
        if (delta === 1 && idx >= at) next = idx + 1;
        if (delta === -1) {
            if (idx === at) {
                // The end of a range shrinks instead of breaking.
                const isRangeEnd = offset > 0 && whole[offset - 1] === ":";
                const isRangeStart = whole[offset + m.length] === ":";
                if (isRangeEnd && idx > 0) next = idx - 1;
                else if (isRangeStart) next = idx;
                else return "#REF!";
            } else if (idx > at) next = idx - 1;
        }
        if (axis === "row") r = next;
        else c = next;
        return `${d1}${colName(c)}${d2}${r + 1}`;
    });
}

export function shiftAllFormulas(t: TableData, axis: "row" | "col", at: number, delta: 1 | -1): TableData {
    return {
        ...t,
        rows: t.rows.map((row) => {
            const cells: Record<string, string> = {};
            for (const [k, v] of Object.entries(row.cells)) cells[k] = shiftFormula(v, axis, at, delta);
            return { ...row, cells };
        }),
    };
}

export function insertRow(t: TableData, at: number): TableData {
    const s = shiftAllFormulas(t, "row", at, 1);
    const rows = [...s.rows];
    rows.splice(at, 0, { id: newNodeId(), cells: {} });
    return { ...s, rows };
}

export function insertCol(t: TableData, at: number): TableData {
    const s = shiftAllFormulas(t, "col", at, 1);
    const cols = [...s.cols];
    cols.splice(at, 0, { id: newNodeId(), width: DEFAULT_COL_WIDTH });
    return { ...s, cols };
}

export function deleteRows(t: TableData, from: number, to: number): TableData {
    let s = t;
    for (let i = to; i >= from; i--) {
        if (s.rows.length <= 1) break;
        s = shiftAllFormulas(s, "row", i, -1);
        s = { ...s, rows: s.rows.filter((_, k) => k !== i) };
    }
    return clampHeaders(s);
}

export function deleteCols(t: TableData, from: number, to: number): TableData {
    let s = t;
    for (let i = to; i >= from; i--) {
        if (s.cols.length <= 1) break;
        const id = s.cols[i].id;
        s = shiftAllFormulas(s, "col", i, -1);
        s = {
            ...s,
            cols: s.cols.filter((_, k) => k !== i),
            rows: s.rows.map((r) => {
                const cells = { ...r.cells };
                delete cells[id];
                return { ...r, cells };
            }),
        };
    }
    return clampHeaders(s);
}

function clampHeaders(t: TableData): TableData {
    return {
        ...t,
        headerRows: Math.min(t.headerRows, t.rows.length),
        headerCols: Math.min(t.headerCols, t.cols.length),
        footerRows: Math.min(t.footerRows, Math.max(0, t.rows.length - t.headerRows)),
    };
}

/** Sets cells from a block of text (tab-separated rows, e.g. copied from a spreadsheet), growing the table as needed. */
export function pasteBlock(t: TableData, r0: number, c0: number, block: string[][]): TableData {
    let s = t;
    const needRows = r0 + block.length - s.rows.length;
    const needCols = c0 + Math.max(...block.map((l) => l.length)) - s.cols.length;
    for (let i = 0; i < needRows; i++) s = { ...s, rows: [...s.rows, { id: newNodeId(), cells: {} }] };
    for (let i = 0; i < needCols; i++) s = { ...s, cols: [...s.cols, { id: newNodeId(), width: DEFAULT_COL_WIDTH }] };
    const rows = s.rows.map((row, r) => {
        const line = block[r - r0];
        if (!line) return row;
        const cells = { ...row.cells };
        line.forEach((v, k) => {
            const col = s.cols[c0 + k];
            if (col) cells[col.id] = v;
        });
        return { ...row, cells };
    });
    return { ...s, rows };
}

/** Tab-separated text of a block (for copying). */
export function copyBlock(t: TableData, values: CellValue[][], r1: number, c1: number, r2: number, c2: number, asShown: boolean): string {
    const lines: string[] = [];
    for (let r = r1; r <= r2; r++) {
        const cells: string[] = [];
        for (let c = c1; c <= c2; c++) {
            const raw = t.rows[r].cells[t.cols[c].id] ?? "";
            cells.push((asShown ? displayValue(raw, values[r][c]) : raw).replace(/[\t\n]/g, " "));
        }
        lines.push(cells.join("\t"));
    }
    return lines.join("\n");
}

export function parseBlock(text: string): string[][] {
    const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
    return lines.map((l) => l.split("\t"));
}

/** What the cells show, one row per line, cells separated by tabs (kept in `content` for search and history). */
export function tableText(t: TableData): string {
    const values = evaluateTable(t);
    const clean = (s: string) => s.replace(/[\t\n]/g, " ");
    return t.rows
        .map((row, r) => t.cols.map((col, c) => clean(displayValue(row.cells[col.id] ?? "", values[r][c]))).join("\t"))
        .join("\n");
}

export const tableSize = (t: TableData) => ({
    width: ROW_HEAD_W + t.cols.reduce((s, c) => s + c.width, 0) + 2,
    height: TABLE_TITLE_H + COL_HEAD_H + t.rows.length * ROW_HEIGHT + 2,
});

// ---------- fill handle ----------

/**
 * A formula copied `dr` rows and `dc` columns away, like Excel: relative references move with it,
 * `$`-fixed parts stay; a reference moved off the sheet becomes #REF!.
 */
export function moveFormula(src: string, dr: number, dc: number): string {
    if (!src.startsWith("=") || (dr === 0 && dc === 0)) return src;
    return src.replace(/("(?:[^"]|"")*")|(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![A-Za-z_(\d])/g, (m, str, d1, col, d2, row, offset: number, whole: string) => {
        if (str) return str;
        if (offset > 0 && /[A-Za-z_]/.test(whole[offset - 1])) return m;
        const c = d1 ? colIndex(col) : colIndex(col) + dc;
        const r = d2 ? Number(row) - 1 : Number(row) - 1 + dr;
        if (c < 0 || r < 0) return "#REF!";
        return `${d1}${colName(c)}${d2}${r + 1}`;
    });
}

/**
 * Drags the fill handle of the block (r1, c1)–(r2, c2) down to row `to` (axis "row") or right to
 * column `to` (axis "col"), as Excel does: formulas are copied with their references moved, two
 * or more numbers in a line continue their series, anything else repeats.
 */
export function fillBlock(t: TableData, r1: number, c1: number, r2: number, c2: number, axis: "row" | "col", to: number): TableData {
    const raw = (r: number, c: number) => t.rows[r]?.cells[t.cols[c]?.id] ?? "";
    const rows = t.rows.map((row) => ({ ...row, cells: { ...row.cells } }));
    const lines = axis === "row" ? [c1, c2] : [r1, r2];
    const [from, last] = axis === "row" ? [r1, r2] : [c1, c2];
    const n = last - from + 1;
    for (let line = lines[0]; line <= lines[1]; line++) {
        const src = Array.from({ length: n }, (_, k) => (axis === "row" ? raw(from + k, line) : raw(line, from + k)));
        const nums = src.map((v) => (v.startsWith("=") ? null : parseNumber(v)));
        const series = n >= 2 && nums.every((x) => x !== null);
        const step = series ? ((nums[n - 1] as number) - (nums[0] as number)) / (n - 1) : 0;
        for (let i = last + 1; i <= to; i++) {
            const k = (i - from) % n;
            let v: string;
            if (series) v = formatNumber((nums[0] as number) + step * (i - from));
            else if (src[k].startsWith("=")) v = axis === "row" ? moveFormula(src[k], i - (from + k), 0) : moveFormula(src[k], 0, i - (from + k));
            else v = src[k];
            const [r, c] = axis === "row" ? [i, line] : [line, i];
            if (!rows[r] || !t.cols[c]) continue;
            if (v) rows[r].cells[t.cols[c].id] = v;
            else delete rows[r].cells[t.cols[c].id];
        }
    }
    return { ...t, rows };
}

/** Width that fits a column's widest shown value (Excel's double-click on the column edge). */
export function autofitWidth(t: TableData, values: CellValue[][], c: number, font: string): number {
    const ctx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
    if (!ctx) return DEFAULT_COL_WIDTH;
    ctx.font = font;
    let w = 0;
    t.rows.forEach((row, r) => {
        const text = displayValue(row.cells[t.cols[c].id] ?? "", values[r][c]);
        // Header cells are bold.
        ctx.font = r < t.headerRows || r >= t.rows.length - t.footerRows || c < t.headerCols ? `600 ${font}` : font;
        w = Math.max(w, ctx.measureText(text).width);
    });
    return Math.min(MAX_AUTOFIT_WIDTH, Math.max(MIN_COL_WIDTH, Math.ceil(w + 18)));
}
