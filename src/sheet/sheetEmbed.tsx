/**
 * 把 Excel 的表格或圖表放進 Word、簡報、Note：連結 `![[檔案/標題#^id|選項]]`（`editor/embed.ts` 顯示時呼叫）。
 *
 * 參考 Notion 的 Linked database：Excel 是本體，文件裡是它的一個「檢視」。
 * - 資料只有一份：顯示的永遠是活頁簿現在的樣子（值照公式算、格式照格子的格式），
 *   在文件裡改格子也是改 Excel（`embedEdit.ts`），所以兩邊永遠一樣。
 * - 樣子可以不一樣：`|` 後面的選項（`TableLook`）只影響這個位置，例如 `green banded large full`。
 * 表格畫成 HTML `<table>`（格子帶 `data-r`／`data-c`，篩選掉、藏起來的列欄不顯示，合併格子用 rowspan／colspan），
 * 圖表用試算表同一個 `Plot` 畫成 SVG（縮放到文件的寬度）。
 */
import { renderToStaticMarkup } from "react-dom/server";
import { Calc, show } from "./calc";
import { chartData } from "./chart";
import { Plot } from "./ChartView";
import { hiddenRows, LOOK_STYLE, ruleLooks } from "./features";
import { key, mergeAt, parseWorkbook, THEMES, type Chart, type Table, type Theme, type Workbook } from "./model";

export interface SheetObject {
  id: string;
  kind: "table" | "chart";
  /** 表格名稱；圖表是標題（沒有標題時「Column chart」之類） */
  name: string;
  sheet: string;
}

const CHART_LABEL: Record<Chart["type"], string> = { column: "Column chart", bar: "Bar chart", line: "Line chart", area: "Area chart", pie: "Pie chart" };

export const chartName = (ch: Chart) => ch.title.trim() || CHART_LABEL[ch.type];

/** 活頁簿裡可以嵌入的東西：照工作表的順序，每張工作表先表格後圖表。 */
export function sheetObjects(wb: Workbook): SheetObject[] {
  return wb.sheets.flatMap((s) => [
    ...s.tables.map((t): SheetObject => ({ id: t.id, kind: "table", name: t.name, sheet: s.name })),
    ...s.charts.map((c): SheetObject => ({ id: c.id, kind: "chart", name: chartName(c), sheet: s.name })),
  ]);
}

/* ─── 這個位置的樣子（不改 Excel） ─── */

export const TEXT_SIZES = ["small", "large"] as const;

/** 嵌入的表格在這個位置的樣子；沒寫的照 Excel 裡的表格 */
export interface TableLook {
  /** 主題色；plain 是不上色 */
  theme?: Theme | "plain";
  /** 交錯的列底色 */
  banded?: boolean;
  /** 字的大小（沒有是一般） */
  size?: (typeof TEXT_SIZES)[number];
  /** 撐滿文件的寬度（欄寬照比例） */
  full?: boolean;
}

/** `green banded large full` → TableLook（不認得的字略過） */
export function parseLook(opts: string): TableLook {
  const out: TableLook = {};
  for (const w of opts.toLowerCase().split(/\s+/).filter(Boolean)) {
    if ((THEMES as readonly string[]).includes(w) || w === "plain") out.theme = w as TableLook["theme"];
    else if (w === "banded") out.banded = true;
    else if (w === "unbanded") out.banded = false;
    else if ((TEXT_SIZES as readonly string[]).includes(w)) out.size = w as TableLook["size"];
    else if (w === "full") out.full = true;
  }
  return out;
}

/** TableLook → 選項文字（固定順序；都沒有是空字串） */
export function formatLook(l: TableLook): string {
  return [l.theme, l.banded === true ? "banded" : l.banded === false ? "unbanded" : "", l.size, l.full ? "full" : ""].filter(Boolean).join(" ");
}

/** 活頁簿 JSON 裡 id 的表格或圖表 → 顯示用的元素與名稱（找不到是 null）。 */
export function renderSheetObject(
  json: string,
  id: string,
  look: TableLook = {},
): { el: HTMLElement; name: string; kind: SheetObject["kind"]; table?: Table } | null {
  const wb = parseWorkbook(json);
  const calc = new Calc(wb);
  for (const s of wb.sheets) {
    const t = s.tables.find((x) => x.id === id);
    if (t) return { el: tableElement(t, calc, look), name: t.name, kind: "table", table: t };
    const ch = s.charts.find((x) => x.id === id);
    if (ch) {
      const table = wb.sheets.flatMap((x) => x.tables).find((x) => x.id === ch.table) ?? null;
      return { el: chartElement(ch, table, calc), name: chartName(ch), kind: "chart" };
    }
  }
  return null;
}

const BORDER: Record<string, "borderTop" | "borderRight" | "borderBottom" | "borderLeft"> = { t: "borderTop", r: "borderRight", b: "borderBottom", l: "borderLeft" };

/** 表格：標題列、標題欄、表尾列照主題上色；格子帶 data-r／data-c（在文件裡編輯用） */
export function tableElement(t: Table, calc: Calc, look: TableLook = {}): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "xl-embed xl-table-wrap";
  const table = document.createElement("table");
  const theme = look.theme ?? t.theme;
  const banded = look.banded ?? t.banded;
  table.className = ["xl-table", `theme-${theme}`, look.size ? `size-${look.size}` : "", look.full ? "full" : ""].filter(Boolean).join(" ");
  const hidR = new Set([...(t.hideR ?? []), ...hiddenRows(t, calc)]);
  const hidC = new Set(t.hideC ?? []);
  const rows = Array.from({ length: t.rows }, (_x, r) => r).filter((r) => !hidR.has(r));
  const cols = Array.from({ length: t.cols }, (_x, c) => c).filter((c) => !hidC.has(c));
  const looks = ruleLooks(t, calc);
  const group = document.createElement("colgroup");
  const total = cols.reduce((a, c) => a + t.colW[c], 0) || 1;
  for (const c of cols) {
    const col = document.createElement("col");
    // 撐滿寬度時欄寬照比例
    col.style.width = look.full ? `${((t.colW[c] / total) * 100).toFixed(2)}%` : `${t.colW[c]}px`;
    group.append(col);
  }
  table.append(group);
  const body = document.createElement("tbody");
  for (const r of rows) {
    const tr = document.createElement("tr");
    const region = r < t.hr ? "h" : r >= t.rows - t.fr ? "f" : banded && (r - t.hr) % 2 === 1 ? "band" : "";
    if (region) tr.className = region;
    for (const c of cols) {
      const m = mergeAt(t, r, c);
      // 合併範圍只在左上角（看得到的第一列、第一欄）畫一格
      if (m && (rows.find((x) => x >= m.r0) !== r || cols.find((x) => x >= m.c0) !== c)) continue;
      const head = r < t.hr || c < t.hc;
      const td = document.createElement(head ? "th" : "td");
      td.dataset.r = String(m ? m.r0 : r);
      td.dataset.c = String(m ? m.c0 : c);
      if (c < t.hc && r >= t.hr && r < t.rows - t.fr) td.className = "hc";
      if (m) {
        const rs = rows.filter((x) => x >= m.r0 && x <= m.r1).length;
        const cs = cols.filter((x) => x >= m.c0 && x <= m.c1).length;
        if (rs > 1) td.rowSpan = rs;
        if (cs > 1) td.colSpan = cs;
      }
      const s = t.cells[key(r, c)]?.s;
      const sh = show(calc.value(t.id, r, c), s);
      const lk = looks.get(key(r, c));
      const ls = lk ? LOOK_STYLE[lk] : null;
      td.style.textAlign = sh.align;
      if (s?.b || ls?.bold) td.style.fontWeight = "600";
      if (s?.i) td.style.fontStyle = "italic";
      const deco = [s?.u && "underline", s?.st && "line-through"].filter(Boolean).join(" ");
      if (deco) td.style.textDecoration = deco;
      const color = ls?.color ?? s?.color ?? (sh.error || (sh.negative && s?.fmt === "currency") ? "var(--ed-danger)" : undefined);
      if (color) td.style.color = color;
      const fill = ls?.fill ?? s?.fill;
      if (fill) td.style.background = fill;
      if (s?.fs) td.style.fontSize = `${s.fs}px`;
      if (s?.va) td.style.verticalAlign = s.va;
      if (s?.wrap) td.classList.add("wrap");
      for (const ch of s?.bd ?? "") if (BORDER[ch]) td.style[BORDER[ch]] = "1.5px solid currentColor";
      td.textContent = sh.check !== undefined ? (sh.check ? "☑" : "☐") : sh.stars !== undefined ? "★".repeat(sh.stars) : sh.text;
      if (sh.stars !== undefined) td.classList.add("stars");
      if (sh.error) td.title = sh.error;
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(body);
  wrap.append(table);
  return wrap;
}

/** 圖表：跟試算表同一個 SVG，寬度跟著文件縮放 */
export function chartElement(ch: Chart, table: Table | null, calc: Calc): HTMLElement {
  const box = document.createElement("div");
  box.className = "xl-embed xl-chart";
  box.style.maxWidth = `${ch.w}px`;
  if (ch.title) {
    const title = document.createElement("div");
    title.className = "sc-chart-title";
    title.textContent = ch.title;
    box.append(title);
  }
  const data = table ? chartData(ch, table, calc) : null;
  if (!data || !data.series.length || !data.categories.length) {
    const n = document.createElement("div");
    n.className = "pe-note";
    n.textContent = data ? "No numbers to chart in this range." : "The table for this chart was deleted.";
    box.append(n);
    return box;
  }
  const plotH = ch.h - (ch.title ? 30 : 8);
  const inner = document.createElement("div");
  inner.innerHTML = renderToStaticMarkup(<Plot data={data} type={ch.type} w={ch.w} h={plotH} legend={ch.legend} />);
  const svg = inner.querySelector("svg");
  if (svg) {
    // 固定的寬高換成 viewBox：跟著文件的寬度縮放
    const w = svg.getAttribute("width");
    const h = svg.getAttribute("height");
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("width", "100%");
    svg.removeAttribute("height");
  }
  box.append(...inner.childNodes);
  return box;
}
