import { numberOf, show, type Calc } from "./calc";
import { key, type Chart, type Table } from "./model";

/**
 * 圖表的資料（純函式）：從表格的範圍取出類別與數列。
 * 範圍的第一列是標題列（或整列都不是數字）就當數列名稱；第一欄是標題欄（或都不是數字）就當類別名稱。
 */

export interface Series {
  name: string;
  values: (number | null)[];
}

export interface ChartData {
  categories: string[];
  series: Series[];
}

export function chartData(ch: Chart, t: Table, calc: Calc): ChartData {
  const r1 = Math.min(ch.r1, t.rows - 1);
  const c1 = Math.min(ch.c1, t.cols - 1);
  const { r0, c0 } = ch;
  const v = (r: number, c: number) => calc.value(t.id, r, c);
  const txt = (r: number, c: number) => show(v(r, c), t.cells[key(r, c)]?.s).text;
  const textOnly = (cells: [number, number][]) => cells.length > 0 && cells.every(([r, c]) => numberOf(v(r, c)) === null);
  const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_x, i) => a + i);
  const headRow = r1 > r0 && (r0 < t.hr || textOnly(range(c0 + 1, c1).map((c) => [r0, c])));
  const headCol = c1 > c0 && (c0 < t.hc || textOnly(range(r0 + 1, r1).map((r) => [r, c0])));
  const rows = range(r0 + (headRow ? 1 : 0), r1);
  const cols = range(c0 + (headCol ? 1 : 0), c1);
  if (ch.byRow) {
    return {
      categories: cols.map((c, i) => (headRow ? txt(r0, c) : String(i + 1))),
      series: rows.map((r, i) => ({ name: headCol ? txt(r, c0) : `Series ${i + 1}`, values: cols.map((c) => numberOf(v(r, c))) })),
    };
  }
  return {
    categories: rows.map((r, i) => (headCol ? txt(r, c0) : String(i + 1))),
    series: cols.map((c, i) => ({ name: headRow ? txt(r0, c) : `Series ${i + 1}`, values: rows.map((r) => numberOf(v(r, c))) })),
  };
}

/** 座標軸的刻度：涵蓋 [lo, hi]、大約 n 格的「好看」數字 */
export function niceTicks(lo: number, hi: number, n = 5): number[] {
  if (lo === hi) {
    if (lo === 0) return [0, 1];
    lo = Math.min(0, lo);
    hi = Math.max(0, hi);
  }
  const span = hi - lo;
  const raw = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? 10 * mag;
  const start = Math.floor(lo / step + 1e-9) * step;
  const out: number[] = [];
  for (let x = start; x <= hi + step * 1e-9; x += step) out.push(Number(x.toPrecision(12)));
  if (out[out.length - 1] < hi) out.push(Number((out[out.length - 1] + step).toPrecision(12)));
  return out;
}

export const CHART_COLORS = ["#2f7fd8", "#34a36d", "#f0a030", "#e0584f", "#8a63d2", "#2bb3b8", "#c77c3c", "#7a8899"];

export const shortNumber = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `${Number((n / 1e9).toPrecision(3))}B`;
  if (a >= 1e6) return `${Number((n / 1e6).toPrecision(3))}M`;
  if (a >= 1e4) return `${Number((n / 1e3).toPrecision(3))}K`;
  return String(Number(n.toPrecision(6)));
};
