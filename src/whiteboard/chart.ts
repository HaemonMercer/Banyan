/**
 * Charts on the whiteboard, made from a range of a table (like inserting a chart in Excel).
 * A chart keeps a link to its table and the range (`source`), and a snapshot of the numbers so it
 * can still be drawn where the table is not at hand (card library, other boards). On a board that
 * has the table, the chart is redrawn from the table as it changes and the snapshot follows.
 */

import { cellName, colIndex, displayValue, evaluateTable, readTable, type TableData } from "./table";

export type ChartType = "column" | "bar" | "line" | "area" | "pie";

export const CHART_TYPES: { type: ChartType; label: string }[] = [
    { type: "column", label: "直條圖" },
    { type: "bar", label: "橫條圖" },
    { type: "line", label: "折線圖" },
    { type: "area", label: "區域圖" },
    { type: "pie", label: "圓形圖" },
];

export interface ChartSeries {
    name: string;
    values: (number | null)[];
}

export interface ChartSnapshot {
    labels: string[];
    series: ChartSeries[];
}

export interface ChartData {
    type: ChartType;
    /** The table card and the A1 range the numbers come from. */
    source: { cardId: number; range: string } | null;
    /** "col": each column is a series (Excel's default for tall ranges); "row": each row is. */
    seriesBy: "col" | "row";
    legend: boolean;
    snapshot: ChartSnapshot;
}

export function readChart(data: string): ChartData {
    let d: Partial<ChartData> = {};
    try {
        d = data ? JSON.parse(data) : {};
    } catch {
        /* start over */
    }
    const type = CHART_TYPES.some((t) => t.type === d.type) ? (d.type as ChartType) : "column";
    const snap = d.snapshot && Array.isArray(d.snapshot.labels) && Array.isArray(d.snapshot.series) ? d.snapshot : { labels: [], series: [] };
    return {
        type,
        source: d.source && typeof d.source.cardId === "number" && typeof d.source.range === "string" ? d.source : null,
        seriesBy: d.seriesBy === "row" ? "row" : "col",
        legend: d.legend !== false,
        snapshot: snap,
    };
}

/** "B2:D7" -> rows / columns (0-based, inclusive); null when it is not a range. */
export function parseRange(range: string): { r1: number; c1: number; r2: number; c2: number } | null {
    const m = /^\s*\$?([A-Za-z]{1,3})\$?(\d+)\s*(?::\s*\$?([A-Za-z]{1,3})\$?(\d+))?\s*$/.exec(range);
    if (!m) return null;
    const a = { r: Number(m[2]) - 1, c: colIndex(m[1]) };
    const b = m[3] ? { r: Number(m[4]) - 1, c: colIndex(m[3]) } : a;
    return { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
}

export const rangeText = (r1: number, c1: number, r2: number, c2: number) => `${cellName(r1, c1)}:${cellName(r2, c2)}`;

/** The block of the table that has anything in it (what a chart uses by default). */
export function usedRange(t: TableData): string {
    let r1 = Infinity, c1 = Infinity, r2 = -1, c2 = -1;
    t.rows.forEach((row, r) =>
        t.cols.forEach((col, c) => {
            if ((row.cells[col.id] ?? "").trim()) {
                r1 = Math.min(r1, r);
                c1 = Math.min(c1, c);
                r2 = Math.max(r2, r);
                c2 = Math.max(c2, c);
            }
        }),
    );
    return r2 < 0 ? rangeText(0, 0, t.rows.length - 1, t.cols.length - 1) : rangeText(r1, c1, r2, c2);
}

/**
 * The chart's numbers from a range of a table, the way Excel reads it: when the top-left cell is
 * empty or the first row / column hold text, they are the series names and the category labels.
 */
export function snapshotFromTable(tableData: string, range: string, seriesBy: "col" | "row"): ChartSnapshot | null {
    const t = readTable(tableData);
    const rg = parseRange(range);
    if (!rg) return null;
    const r2 = Math.min(rg.r2, t.rows.length - 1);
    const c2 = Math.min(rg.c2, t.cols.length - 1);
    if (rg.r1 > r2 || rg.c1 > c2) return null;
    const values = evaluateTable(t);
    const text = (r: number, c: number) => displayValue(t.rows[r].cells[t.cols[c].id] ?? "", values[r][c]);
    const num = (r: number, c: number) => (values[r][c].kind === "number" ? (values[r][c] as { n: number }).n : null);
    const isLabel = (r: number, c: number) => values[r][c].kind !== "number";

    // Grid of the range; orient it so that series run along columns.
    const rows = r2 - rg.r1 + 1;
    const cols = c2 - rg.c1 + 1;
    const at = (i: number, j: number) => (seriesBy === "col" ? { r: rg.r1 + i, c: rg.c1 + j } : { r: rg.r1 + j, c: rg.c1 + i });
    const n = seriesBy === "col" ? rows : cols; // categories (+ header)
    const m = seriesBy === "col" ? cols : rows; // series (+ label column)

    // Header row: every cell after the first is text (or the range is one row deep).
    let header = false;
    if (n > 1) {
        header = true;
        for (let j = 0; j < m; j++) {
            const p = at(0, j);
            if (!isLabel(p.r, p.c) && !(j === 0 && m > 1)) header = false;
        }
    }
    // Label column: the first column holds text below the header.
    let labelCol = false;
    if (m > 1) {
        labelCol = true;
        for (let i = header ? 1 : 0; i < n; i++) {
            const p = at(i, 0);
            if (!isLabel(p.r, p.c)) labelCol = false;
        }
    }
    const i0 = header ? 1 : 0;
    const j0 = labelCol ? 1 : 0;
    const labels: string[] = [];
    for (let i = i0; i < n; i++) {
        const p = at(i, 0);
        labels.push(labelCol ? text(p.r, p.c) : String(i - i0 + 1));
    }
    const series: ChartSeries[] = [];
    for (let j = j0; j < m; j++) {
        const h = at(0, j);
        const vals: (number | null)[] = [];
        for (let i = i0; i < n; i++) {
            const p = at(i, j);
            vals.push(num(p.r, p.c));
        }
        series.push({ name: header ? text(h.r, h.c) || `數列 ${j - j0 + 1}` : `數列 ${j - j0 + 1}`, values: vals });
    }
    return { labels, series };
}

/** The chart's numbers, one row per line, separated by tabs (kept in `content` for search and history). */
export function chartText(s: ChartSnapshot): string {
    if (s.series.length === 0) return "";
    const lines = [["", ...s.series.map((x) => x.name)].join("\t")];
    s.labels.forEach((l, i) => lines.push([l, ...s.series.map((x) => String(x.values[i] ?? ""))].join("\t")));
    return lines.join("\n");
}

/** Clean axis ticks (1, 2, 2.5, 5 × 10ⁿ) covering [min, max], always including 0. */
export function niceTicks(min: number, max: number, target = 5): number[] {
    let lo = Math.min(0, min);
    let hi = Math.max(0, max);
    if (lo === hi) hi = lo + 1;
    const raw = (hi - lo) / target;
    const p = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= raw) ?? 10 * p;
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const out: number[] = [];
    for (let v = lo; v <= hi + step / 2; v += step) out.push(Number(v.toPrecision(12)));
    return out;
}

/** Axis label: in full under 10,000, compact above (10K, 2.5M). */
export function tickLabel(v: number, maxAbs: number): string {
    if (maxAbs >= 10000) {
        const units: [number, string][] = [[1e9, "B"], [1e6, "M"], [1e3, "K"]];
        for (const [u, s] of units) if (Math.abs(v) >= u) return `${Number((v / u).toPrecision(3))}${s}`;
    }
    return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export const valueText = (v: number | null) => (v === null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 6 }));
