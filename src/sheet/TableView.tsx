import { useMemo, useState } from "react";
import { GripIcon, PlusIcon } from "../editor/icons";
import { isFormula, show, type Calc } from "./calc";
import { LOOK_STYLE } from "./features";
import { colName, refsOf } from "./formula";
import {
  COL_W,
  insertCols,
  insertRows,
  key,
  mergeAt,
  MIN_COL_W,
  MIN_ROW_H,
  norm,
  patchTable,
  renameTable,
  resizeTable,
  resolveTable,
  ROW_H,
  rowHeight,
  setRowHeights,
  type Look,
  type Rect,
  type Sheet,
  type Table,
  type Workbook,
} from "./model";

/**
 * 畫布上的一個表格：名稱、欄名與列號（選取時）、格子、選取框、輸入框、填滿控點、改大小的控點。
 * 列高可以不一樣（`rowH`），篩選掉的列不畫（高度 0），所以位置一律用 `rowYs` 算。
 */

export type Pos = { r: number; c: number };
export type Sel = { k: "cells"; tid: string; a: Pos; b: Pos } | { k: "table"; tid: string } | { k: "chart"; cid: string } | null;
export type Edit = { tid: string; r: number; c: number; text: string; from: "cell" | "bar" };

const REF_COLORS = ["#2f7fd8", "#e0584f", "#34a36d", "#8a63d2", "#f0a030", "#2bb3b8"];

/** 表格上方：名稱（可以藏起來）＋欄名列的空間 */
export const NAME_H = 26;
export const BAR_H = 22;
export const headH = (t: Table) => (t.showName ? NAME_H : 0) + BAR_H;

export const colXs = (t: Table, widths = t.colW) => {
  const xs = [0];
  for (let c = 0; c < t.cols; c++) xs.push(xs[c] + (widths[c] ?? COL_W));
  return xs;
};

/** 每一列的上緣（長度 rows＋1，最後一個是總高）；藏起來的列高度 0 */
export function rowYs(t: Table, hidden?: Set<number>, live?: { rows: number[]; h: number } | null): number[] {
  const ys = [0];
  for (let r = 0; r < t.rows; r++) {
    const h = hidden?.has(r) ? 0 : live?.rows.includes(r) ? live.h : rowHeight(t, r);
    ys.push(ys[r] + h);
  }
  return ys;
}

export function TableView(props: {
  t: Table;
  sheet: Sheet;
  wb: Workbook;
  calc: Calc;
  dx: number;
  dy: number;
  hidden: Set<number>;
  looks: Map<string, Look>;
  /** 尋找的結果（這個表格的格子鍵）與目前那一個 */
  found: Set<string>;
  foundAt: string | null;
  objectSel: boolean;
  cells: { a: Pos; b: Pos } | null;
  edit: Edit | null;
  /** 任何地方正在編輯的公式（標出它參照到這個表格的格子） */
  refEdit: Edit | null;
  inputRef: React.RefObject<HTMLInputElement | null> | null;
  onCellDown: (e: React.PointerEvent, t: Table, p: Pos) => void;
  onCellDouble: () => void;
  onMenu: (e: React.MouseEvent) => void;
  onSelect: (s: Sel) => void;
  onMove: (e: React.PointerEvent) => void;
  onInput: (text: string, caret: number) => void;
  onCaret: (caret: number) => void;
  onCopy: (e: React.ClipboardEvent) => void;
  onCut: (e: React.ClipboardEvent) => void;
  onPaste: (e: React.ClipboardEvent) => void;
  onFill: (src: Rect, to: Rect) => void;
  run: (fn: (w: Workbook) => Workbook) => void;
  /** 狀態列的提示 */
  onNote?: (msg: string) => void;
}) {
  const { t, calc, cells, edit, hidden } = props;
  const [colW, setColW] = useState<number[] | null>(null);
  const [liveRows, setLiveRows] = useState<{ rows: number[]; h: number } | null>(null);
  const [ghost, setGhost] = useState<{ rows: number; cols: number } | null>(null);
  const [fillTo, setFillTo] = useState<Rect | null>(null);
  const [naming, setNaming] = useState(false);
  // 藏起來的欄寬度 0
  const hidC = new Set(t.hideC ?? []);
  const widths = (colW ?? t.colW).map((w, i) => (hidC.has(i) ? 0 : w));
  const xs = colXs(t, widths);
  const ys = rowYs(t, hidden, liveRows);
  const W = xs[t.cols];
  const H = ys[t.rows];
  const rh = (r: number) => ys[r + 1] - ys[r];
  const active = !!cells || props.objectSel;
  const rect = cells ? norm(cells.a, cells.b) : null;
  const box = (r: Rect) => ({ left: xs[r.c0], top: ys[r.r0], width: xs[r.c1 + 1] - xs[r.c0], height: ys[r.r1 + 1] - ys[r.r0] });
  /** 一格（在合併範圍裡就是整個合併範圍） */
  const cellBox = (r: number, c: number) => box(mergeAt(t, r, c) ?? { r0: r, c0: c, r1: r, c1: c });

  const region = (r: number, c: number) =>
    r < t.hr ? "h" : r >= t.rows - t.fr ? "f" : c < t.hc ? "hc" : t.banded && (r - t.hr) % 2 === 1 ? "band" : "";

  const drag = (e: React.PointerEvent, move: (ev: PointerEvent) => void, up: (ev: PointerEvent) => void) => {
    e.preventDefault();
    e.stopPropagation();
    const end = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      up(ev);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  const resizeCol = (e: React.PointerEvent, c: number) => {
    const x0 = e.clientX;
    const w0 = t.colW[c];
    let out = t.colW;
    drag(
      e,
      (ev) => {
        out = t.colW.map((w, i) => (i === c ? Math.max(MIN_COL_W, Math.round(w0 + ev.clientX - x0)) : w));
        setColW(out);
      },
      () => {
        setColW(null);
        if (out !== t.colW) props.run((w) => patchTable(w, t.id, { colW: out }));
      },
    );
  };

  /** 拖列號下緣改列高；拖的列在選取裡就一起改 */
  const resizeRow = (e: React.PointerEvent, r: number) => {
    const y0 = e.clientY;
    const h0 = rowHeight(t, r);
    const rows = rect && r >= rect.r0 && r <= rect.r1 ? Array.from({ length: rect.r1 - rect.r0 + 1 }, (_x, i) => rect.r0 + i) : [r];
    let h = h0;
    drag(
      e,
      (ev) => {
        h = Math.max(MIN_ROW_H, Math.round(h0 + ev.clientY - y0));
        setLiveRows({ rows, h });
      },
      () => {
        setLiveRows(null);
        if (h !== h0) props.run((w) => setRowHeights(w, t.id, rows, h));
      },
    );
  };

  /** 指標位置 → 列（超出表格時用預設列高往外推） */
  const rowAt = (y: number) => {
    if (y >= H) return t.rows - 1 + Math.max(1, Math.round((y - H) / ROW_H + 0.5));
    let r = 0;
    while (r < t.rows - 1 && ys[r + 1] <= y) r++;
    return r;
  };
  const colAt = (x: number) => {
    if (x >= W) return t.cols - 1 + Math.max(1, Math.round((x - W) / COL_W + 0.5));
    let c = 0;
    while (c < t.cols - 1 && xs[c + 1] <= x) c++;
    return c;
  };

  const resizeTableDrag = (e: React.PointerEvent) => {
    const grid = (e.currentTarget as HTMLElement).closest(".st")!.querySelector(".st-grid")!.getBoundingClientRect();
    let size = { rows: t.rows, cols: t.cols };
    drag(
      e,
      (ev) => {
        const x = ev.clientX - grid.left;
        const y = ev.clientY - grid.top;
        // 中點在指標左邊（上面）的欄（列）都留著
        const count = (edges: number[], n: number, at: number) => Math.max(1, Array.from({ length: n }, (_x, i) => (edges[i] + edges[i + 1]) / 2).filter((m) => m < at).length);
        const cols = x > W ? t.cols + Math.max(0, Math.round((x - W) / COL_W)) : count(xs, t.cols, x);
        const rows = y > H ? t.rows + Math.max(0, Math.round((y - H) / ROW_H)) : count(ys, t.rows, y);
        size = { rows: Math.max(t.hr + t.fr + 1, rows), cols };
        setGhost(size);
      },
      () => {
        setGhost(null);
        if (size.rows === t.rows && size.cols === t.cols) return;
        const lost = Object.keys(t.cells).some((k) => {
          const [r, c] = k.split(",").map(Number);
          return (r >= size.rows - t.fr && r < t.rows - t.fr) || c >= size.cols;
        });
        // 不用確認視窗（WebView 裡可能被擋掉，拖了就沒反應）：直接改，提示可以復原
        props.run((w) => resizeTable(w, t.id, size.rows, size.cols));
        const dr = t.rows - size.rows;
        const dc = t.cols - size.cols;
        const parts = [dr > 0 && `${dr} ${dr === 1 ? "row" : "rows"}`, dc > 0 && `${dc} ${dc === 1 ? "column" : "columns"}`].filter(Boolean);
        if (parts.length) props.onNote?.(`Removed ${parts.join(" and ")}${lost ? " with content" : ""} · Ctrl+Z to undo`);
      },
    );
  };

  /** 填滿控點：往下或往右拖，放開時接著數列填 */
  const fillDrag = (e: React.PointerEvent) => {
    if (!rect) return;
    const grid = (e.currentTarget as HTMLElement).closest(".st")!.querySelector(".st-grid")!.getBoundingClientRect();
    let to: Rect | null = null;
    drag(
      e,
      (ev) => {
        const r = Math.min(rowAt(ev.clientY - grid.top), t.rows - 1);
        const c = Math.min(colAt(ev.clientX - grid.left), t.cols - 1);
        const dr = r - rect.r1;
        const dc = c - rect.c1;
        to = dr <= 0 && dc <= 0 ? null : dr >= dc ? { ...rect, r1: r } : { ...rect, c1: c };
        setFillTo(to);
      },
      () => {
        setFillTo(null);
        if (to) props.onFill(rect, to);
      },
    );
  };

  // 公式參照的格子（編輯中）
  const refBoxes = useMemo(() => {
    const e = props.refEdit;
    if (!e || !isFormula(e.text)) return [];
    const home = props.wb.sheets.flatMap((s) => s.tables.map((x) => ({ s, x }))).find((p) => p.x.id === e.tid);
    if (!home) return [];
    return refsOf(e.text.slice(1))
      .map((r, i) => ({ ...r, color: REF_COLORS[i % REF_COLORS.length] }))
      .filter((r) => resolveTable(props.wb, home.s, home.x, r.a)?.table.id === t.id)
      .map((r) => {
        const c0 = Math.min(r.a.col, r.b.col);
        const c1 = Math.min(Math.max(r.a.col, r.b.col), t.cols - 1);
        const whole = r.a.row === null || r.b.row === null;
        const r0 = whole ? t.hr : Math.min(r.a.row!, r.b.row!);
        const r1 = whole ? t.rows - t.fr - 1 : Math.min(Math.max(r.a.row!, r.b.row!), t.rows - 1);
        return { c0, c1, r0, r1, color: r.color };
      })
      .filter((b) => b.c0 < t.cols && b.r0 < t.rows && b.r1 >= b.r0);
  }, [props.refEdit, props.wb, t]);

  const editW = edit ? Math.min(600, Math.max(widths[edit.c] ?? COL_W, edit.text.length * 7.5 + 20)) : 0;
  const visible = Array.from({ length: t.rows }, (_x, r) => r).filter((r) => !hidden.has(r));
  const rowIdx = new Map(visible.map((r, i) => [r, i]));
  // 合併：左上角那格跨過整個範圍，其他格子不畫
  const covered = new Set<string>();
  for (const m of t.merges ?? []) for (let r = m.r0; r <= m.r1; r++) for (let c = m.c0; c <= m.c1; c++) if (r !== m.r0 || c !== m.c0) covered.add(key(r, c));
  const filtered = t.filterOn && t.filters.length > 0;

  return (
    <div
      className={`st theme-${t.theme}${active ? " active" : ""}${props.objectSel ? " object" : ""}`}
      style={{ left: t.x + props.dx, top: t.y + props.dy }}
      data-tid={t.id}
    >
      <div className="st-head" style={{ width: W, height: headH(t) }}>
        <button className="st-grip" title="Drag to move the table · click to select it" onPointerDown={props.onMove}>
          <GripIcon />
        </button>
        {t.showName &&
          (naming ? (
            <input
              className="st-name-edit"
              autoFocus
              defaultValue={t.name}
              onBlur={(e) => {
                setNaming(false);
                props.run((w) => renameTable(w, t.id, e.target.value));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setNaming(false);
                e.stopPropagation();
              }}
            />
          ) : (
            <span className="st-name" onPointerDown={props.onMove} onDoubleClick={() => setNaming(true)} title="Double-click to rename">
              {t.name}
              {filtered && (
                <span className="st-filtered" title="Some rows are hidden by a filter (Format → Filter)">
                  Filtered · {hidden.size} hidden
                </span>
              )}
            </span>
          ))}
      </div>
      <div
        className="st-body"
        onMouseDown={(e) => {
          // 焦點留在隱藏的輸入框（編輯中點輸入框本身才讓它放游標）
          if (!(e.target as HTMLElement).classList.contains("st-input")) e.preventDefault();
        }}
      >
        {active && (
          <>
            <div className="st-colbar" style={{ width: W }}>
              {Array.from({ length: t.cols }, (_x, c) => (
                <div
                  key={c}
                  className={`st-colh${rect && c >= rect.c0 && c <= rect.c1 ? " on" : ""}${t.filterOn && t.filters.some((f) => f.col === c) ? " filter" : ""}${hidC.has(c) ? " hid" : ""}${hidC.has(c + 1) ? " before-hid" : ""}`}
                  style={{ left: xs[c], width: widths[c] }}
                  onPointerDown={(e) => {
                    if ((e.target as HTMLElement).classList.contains("st-colrs")) return;
                    const a = e.shiftKey && cells ? { r: 0, c: cells.a.c } : { r: 0, c };
                    props.onSelect({ k: "cells", tid: t.id, a, b: { r: t.rows - 1, c } });
                  }}
                >
                  {colName(c)}
                  <span className="st-colrs" onPointerDown={(e) => resizeCol(e, c)} />
                </div>
              ))}
            </div>
            <div className="st-rowbar" style={{ height: H }}>
              {visible.map((r) => (
                <div
                  key={r}
                  className={`st-rowh${rect && r >= rect.r0 && r <= rect.r1 ? " on" : ""}`}
                  style={{ top: ys[r], height: rh(r) }}
                  onPointerDown={(e) => {
                    if ((e.target as HTMLElement).classList.contains("st-rowrs")) return;
                    props.onSelect({ k: "cells", tid: t.id, a: e.shiftKey && cells ? { r: cells.a.r, c: 0 } : { r, c: 0 }, b: { r, c: t.cols - 1 } });
                  }}
                >
                  {r + 1}
                  <span className="st-rowrs" title="Drag to change the row height" onPointerDown={(e) => resizeRow(e, r)} />
                </div>
              ))}
            </div>
          </>
        )}
        <div
          className="st-grid"
          style={{
            gridTemplateColumns: widths.map((w) => `${w}px`).join(" "),
            gridTemplateRows: visible.map((r) => `${rh(r)}px`).join(" "),
            width: W,
          }}
          onPointerDown={(e) => {
            const el = (e.target as HTMLElement).closest<HTMLElement>("[data-r]");
            if (el) props.onCellDown(e, t, { r: Number(el.dataset.r), c: Number(el.dataset.c) });
          }}
          onDoubleClick={(e) => {
            if ((e.target as HTMLElement).closest(".sc-check, [data-star]")) return;
            props.onCellDouble();
          }}
          onContextMenu={props.onMenu}
        >
          {visible.map((r) =>
            Array.from({ length: t.cols }, (_y, c) => {
              const k = key(r, c);
              if (covered.has(k)) return null;
              const cell = t.cells[k];
              const m = mergeAt(t, r, c);
              const rowSpan = m ? visible.filter((x) => x >= m.r0 && x <= m.r1).length : 1;
              const v = calc.value(t.id, r, c);
              const s = cell?.s;
              const sh = show(v, s);
              const look = props.looks.get(k);
              const ls = look ? LOOK_STYLE[look] : null;
              const deco = [s?.u && "underline", s?.st && "line-through"].filter(Boolean).join(" ");
              const flow = s?.wrap || (s?.va && s.va !== "middle");
              const style: React.CSSProperties = {
                gridRow: `${(rowIdx.get(r) ?? 0) + 1} / span ${Math.max(1, rowSpan)}`,
                gridColumn: `${c + 1} / span ${m ? m.c1 - m.c0 + 1 : 1}`,
                textAlign: sh.align,
                fontWeight: s?.b || ls?.bold ? 600 : undefined,
                fontStyle: s?.i ? "italic" : undefined,
                textDecoration: deco || undefined,
                color: ls?.color ?? s?.color,
                background: ls?.fill ?? s?.fill,
                fontSize: s?.fs,
                lineHeight: flow ? 1.3 : `${(m ? ys[m.r1 + 1] - ys[m.r0] : rh(r)) - 1}px`,
                boxShadow: s?.bd ? borderShadow(s.bd) : undefined,
                ...(flow
                  ? {
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: s?.va === "top" ? "flex-start" : s?.va === "bottom" ? "flex-end" : "center",
                      whiteSpace: s?.wrap ? "normal" : undefined,
                      wordBreak: s?.wrap ? "break-word" : undefined,
                      paddingTop: 3,
                      paddingBottom: 3,
                    }
                  : {}),
              };
              const tip = [sh.error ? `${sh.text}: ${sh.error}` : "", cell?.n ?? ""].filter(Boolean).join(" · ");
              return (
                <div
                  key={k}
                  data-r={r}
                  data-c={c}
                  className={`sc ${region(r, c)}${sh.error ? " err" : ""}${sh.negative && s?.fmt === "currency" ? " neg" : ""}${props.found.has(k) ? (props.foundAt === k ? " found now" : " found") : ""}${hidC.has(c) ? " hid" : ""}${cell?.n ? " has-note" : ""}${sh.popup ? " popup" : ""}`}
                  style={style}
                  title={tip || undefined}
                >
                  {sh.check !== undefined ? (
                    <span className={`sc-check${sh.check ? " on" : ""}`} />
                  ) : sh.stars !== undefined ? (
                    <span className="sc-stars">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <span key={i} data-star={i} className={i <= sh.stars! ? "on" : ""}>
                          ★
                        </span>
                      ))}
                    </span>
                  ) : sh.popup ? (
                    <>
                      <span className="sc-pop-text">{sh.text}</span>
                      <span className="sc-pop" title="Choose from the list">
                        ▾
                      </span>
                    </>
                  ) : (
                    sh.text
                  )}
                </div>
              );
            }),
          )}
        </div>
        {refBoxes.map((b, i) => (
          <div key={i} className="st-refbox" style={{ ...box(b), borderColor: b.color, background: `${b.color}14` }} />
        ))}
        {rect && <div className="st-sel" style={box(rect)} />}
        {fillTo && <div className="st-fillto" style={box(fillTo)} />}
        {cells && <div className="st-cur" style={cellBox(cells.a.r, cells.a.c)} />}
        {rect && !edit && (
          <span
            className="st-fill"
            style={{ left: xs[rect.c1 + 1] - 4, top: ys[rect.r1 + 1] - 4 }}
            title="Drag down or right to fill (continues series like 1, 2, 3 or Jan, Feb)"
            onPointerDown={fillDrag}
          />
        )}
        {cells && props.inputRef && (
          <input
            ref={props.inputRef}
            className={`st-input${edit ? " editing" : ""}`}
            style={{
              left: xs[(edit ?? { c: cells.a.c }).c],
              top: ys[(edit ?? { r: cells.a.r }).r],
              width: Math.max(edit ? editW : 0, cellBox((edit ?? cells.a).r, (edit ?? cells.a).c).width),
              height: Math.max(ROW_H, cellBox((edit ?? cells.a).r, (edit ?? cells.a).c).height),
              textAlign: edit ? "left" : undefined,
            }}
            value={edit ? edit.text : ""}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => props.onInput(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onSelect={(e) => props.onCaret(e.currentTarget.selectionStart ?? 0)}
            onCopy={props.onCopy}
            onCut={props.onCut}
            onPaste={props.onPaste}
          />
        )}
        {ghost && (
          <div
            className="st-ghost"
            style={{
              width: ghost.cols <= t.cols ? xs[ghost.cols] : W + (ghost.cols - t.cols) * COL_W,
              height: ghost.rows <= t.rows ? ys[ghost.rows] : H + (ghost.rows - t.rows) * ROW_H,
            }}
          >
            <span>
              {ghost.rows} × {ghost.cols}
            </span>
          </div>
        )}
        {active && (
          <>
            <button
              className="st-add col"
              style={{ left: W + 6, top: Math.max(0, H / 2 - 10) }}
              title="Add a column"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => props.run((w) => insertCols(w, t.id, t.cols, 1))}
            >
              <PlusIcon />
            </button>
            <button
              className="st-add row"
              style={{ top: H + 6, left: Math.max(0, W / 2 - 10) }}
              title="Add a row"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => props.run((w) => insertRows(w, t.id, t.rows - t.fr, 1))}
            >
              <PlusIcon />
            </button>
            <span className="st-corner" style={{ left: W + 2, top: H + 2 }} title="Drag to add or remove rows and columns" onPointerDown={resizeTableDrag} />
          </>
        )}
      </div>
    </div>
  );
}

/** 框線（格子存的 t、r、b、l）畫成內陰影，不會改變格子大小 */
function borderShadow(bd: string): string {
  const w = "1.5px";
  const col = "var(--sc-border)";
  const parts: string[] = [];
  if (bd.includes("t")) parts.push(`inset 0 ${w} 0 0 ${col}`);
  if (bd.includes("b")) parts.push(`inset 0 -${w} 0 0 ${col}`);
  if (bd.includes("l")) parts.push(`inset ${w} 0 0 0 ${col}`);
  if (bd.includes("r")) parts.push(`inset -${w} 0 0 0 ${col}`);
  return parts.join(", ");
}
