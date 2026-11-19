import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CloseIcon,
  CopyIcon,
  FormulaIcon,
  ImportIcon,
  PanelRightIcon,
  PlusIcon,
  SendIcon,
  SortIcon,
  TableIcon,
  TrashIcon,
} from "../editor/icons";
import { Field, Inspector, MenuItem, Popup, Section, Seg, SegBtn, TBtn, TMenu, Toolbar, usePanel } from "../desk/DocChrome";
import { ChartView } from "./ChartView";
import { Calc, isFormula, numberOf, show, sortKey } from "./calc";
import { autofill, findAll, hiddenRows, replaceIn, ruleLooks, type Hit } from "./features";
import { cellName, colName, generalNumber, refText, type Ref } from "./formula";
import { addImported } from "./importer";
import { IMPORT_ACCEPT, importTables, readSpreadsheet } from "./formats";
import { FilterSection, FindBar, FN_ARGS, fnMatches, fnPrefix, FnList, RulesSection, type FindState } from "./Panels";
import { colXs, headH, rowYs, TableView, type Edit, type Pos, type Sel } from "./TableView";
import {
  addChart,
  addSheet,
  addTable,
  CHART_TYPES,
  duplicateSheet,
  duplicateTable,
  clearRange,
  deleteCols,
  deleteRows,
  fill,
  growToMerges,
  insertCols,
  insertRows,
  key,
  mergeAt,
  mergeCells,
  norm,
  parseWorkbook,
  pasteGrid,
  patchChart,
  patchTable,
  removeChart,
  removeSheet,
  removeDuplicates,
  removeTable,
  resizeTable,
  renameSheet,
  renameTable,
  setBorders,
  setCell,
  setHidden,
  setNote,
  sortBody,
  styleRange,
  THEMES,
  unmergeCells,
  BORDERS,
  type BorderMode,
  type Chart,
  type ChartType,
  type Fmt,
  type Rect,
  type Style,
  type Table,
  type Workbook,
} from "./model";
import { alignBounds, measureBetween, snapMove, snapResizeGrid, type Guide, type Measure, type Rect as Box } from "../align/align";
import { AlignOverlay } from "../align/AlignMarks";
import "./sheet.css";

/**
 * 試算表的畫面（參考 Numbers）：上方工具列與公式列、工作表分頁；中間畫布上自由擺放表格與圖表；
 * 右邊「Format」面板（格子的資料格式與文字、表格的標題列與樣式、圖表）。
 *
 * - 選取：點格子、拖曳或 Shift＋點選範圍；點欄名／列號選整欄／整列；點表格名稱選整個表格（可以拖曳搬動）。
 * - 打字直接取代格子內容（一個隱藏的輸入框一直拿著焦點，輸入法也能用）；雙擊或 F2 編輯原本的內容。
 *   編輯公式時點別的格子（或拖一個範圍）插入參照，別的表格會加上「Table 2::」。
 * - 複製貼上用 Tab 分隔的文字（和 Excel、Numbers 互通）；在這裡複製的保留公式與樣式。
 * - Ctrl＋Z／Y 復原、重做（這份文件自己的歷史）；Ctrl＋B／I／U、Ctrl＋D／R 填滿。
 */

type MenuItem = { label: string; hint?: string; onClick: () => void; disabled?: boolean; danger?: boolean } | "sep";

const TEXT_COLORS = ["#e03e3e", "#d9730d", "#c29100", "#0f7b6c", "#0b6e99", "#6940a5", "#ad1a72", "#787774"];
const FILL_COLORS = ["#fbe4e4", "#fbecdd", "#fbf3db", "#ddedea", "#ddebf1", "#eae4f2", "#f4dfeb", "#ebeced"];
const FORMATS: { fmt: Fmt; label: string }[] = [
  { fmt: "auto", label: "Automatic" },
  { fmt: "number", label: "Number" },
  { fmt: "currency", label: "Currency" },
  { fmt: "percent", label: "Percentage" },
  { fmt: "date", label: "Date & Time" },
  { fmt: "checkbox", label: "Checkbox" },
  { fmt: "stars", label: "Star Rating" },
  { fmt: "text", label: "Text" },
  { fmt: "popup", label: "Pop-Up Menu" },
];
const CURRENCIES = ["$", "NT$", "€", "£", "¥", "HK$"];
/** 工具列 Formula 的常用函式 */
const QUICK_FNS = [
  ["SUM", "Sum"],
  ["AVERAGE", "Average"],
  ["MIN", "Minimum"],
  ["MAX", "Maximum"],
  ["COUNT", "Count"],
  ["PRODUCT", "Product"],
] as const;
/** 工具列 Table 的樣式 */
const TABLE_PRESETS = [
  ["basic", "Basic", "Header row and column"],
  ["header", "Header Row", "A list with column names"],
  ["footer", "With Totals", "Header, rows and a footer row"],
  ["plain", "Plain", "Just cells"],
] as const;
const CHART_LABEL: Record<ChartType, string> = { column: "Column", bar: "Bar", line: "Line", area: "Area", pie: "Pie" };

/** 最後選取（或看著）的表格：Dock 的「CSV」匯出這一個 */
let lastTable: string | null = null;
export const activeTableId = () => lastTable;

/** 這裡複製的格子（貼回 Banyan 時保留公式與樣式） */
let clip: { tsv: string; cells: { v: string; s?: Style }[][]; from: Pos } | null = null;

const tableW = (t: Table) => colXs(t)[t.cols];
const NO_LOOKS = new Map<string, never>();
const NO_KEYS = new Set<string>();

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_x, i) => a + i);

const clampPos = (t: Table, p: Pos): Pos => ({ r: Math.max(0, Math.min(t.rows - 1, p.r)), c: Math.max(0, Math.min(t.cols - 1, p.c)) });

/** 公式編輯中，游標前面是運算子、括號、逗號（可以插入參照） */
const refSpot = (text: string, caret: number) => text.startsWith("=") && /[=(+\-*/^&,:<>;]\s*$/.test(text.slice(0, caret));

export function SheetView(props: {
  json: string;
  onModify: (fn: (wb: Workbook) => Workbook) => void;
  /** 選取的列變成白板上的便利貼 */
  onSendNotes?: (texts: string[]) => void;
}) {
  const wb = useMemo(() => parseWorkbook(props.json), [props.json]);
  const calc = useMemo(() => new Calc(wb), [wb]);
  const [sheetId, setSheetId] = useState(wb.sheets[0].id);
  const sheet = wb.sheets.find((s) => s.id === sheetId) ?? wb.sheets[0];
  // 篩選掉的列、條件式醒目提示（每個版本算一次）
  const hiddenOf = useMemo(
    () =>
      new Map(
        sheet.tables.map((t) => {
          const h = hiddenRows(t, calc);
          for (const r of t.hideR ?? []) h.add(r);
          return [t.id, h];
        }),
      ),
    [sheet, calc],
  );
  const looksOf = useMemo(() => new Map(sheet.tables.map((t) => [t.id, ruleLooks(t, calc)])), [sheet, calc]);
  const NONE = useMemo(() => new Set<number>(), []);
  const ysOf = (t: Table) => rowYs(t, hiddenOf.get(t.id));
  const tableH = (t: Table) => ysOf(t)[t.rows];
  const [sel, setSel] = useState<Sel>(() => {
    const t = wb.sheets[0].tables[0];
    return t ? { k: "cells", tid: t.id, a: { r: 0, c: 0 }, b: { r: 0, c: 0 } } : null;
  });
  const [edit, setEditState] = useState<Edit | null>(null);
  const editRef = useRef<Edit | null>(null);
  const setEdit = (e: Edit | null) => {
    editRef.current = e;
    setEditState(e);
  };
  const [panel, setPanel] = usePanel<"format" | "organize">("sheet", "format");
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const hist = useRef<{ past: Workbook[]; future: Workbook[] }>({ past: [], future: [] });
  const inputRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const caret = useRef(0);
  /** 拖曳插入參照：插入的位置與原本的文字 */
  const refDrag = useRef<{ start: number; text: string; tid: string; a: Pos } | null>(null);

  // 用 ref 拿最新的 onModify：modify、commit 不隨每次重畫改變（卸載時才存編輯中的內容）
  const onModifyRef = useRef(props.onModify);
  onModifyRef.current = props.onModify;
  const modify = useCallback(
    (fn: (w: Workbook) => Workbook) =>
      onModifyRef.current((w) => {
        const next = fn(w);
        if (next !== w) {
          hist.current.past.push(w);
          if (hist.current.past.length > 200) hist.current.past.shift();
          hist.current.future = [];
        }
        return next;
      }),
    [],
  );
  const undo = () => {
    const prev = hist.current.past.pop();
    if (!prev) return;
    props.onModify((w) => {
      hist.current.future.push(w);
      return prev;
    });
  };
  const redo = () => {
    const next = hist.current.future.pop();
    if (!next) return;
    props.onModify((w) => {
      hist.current.past.push(w);
      return next;
    });
  };

  const tableOf = (tid: string) => sheet.tables.find((t) => t.id === tid) ?? null;
  // 選取的表格被刪掉、換了工作表：清掉
  const selTable = sel && sel.k !== "chart" ? tableOf(sel.tid) : null;
  const selChart = sel?.k === "chart" ? (sheet.charts.find((c) => c.id === sel.cid) ?? null) : null;
  // 匯出 CSV 用：最後選的表格（沒有就是這張工作表的第一個）
  lastTable = selTable?.id ?? sheet.tables[0]?.id ?? lastTable;
  const cells = sel?.k === "cells" && selTable ? { ...sel, a: clampPos(selTable, sel.a), b: clampPos(selTable, sel.b) } : null;
  const rect: Rect | null = cells && selTable ? growToMerges(selTable, norm(cells.a, cells.b)) : null;

  // 馬上給焦點（點完立刻打字也收得到），畫完再給一次（輸入框剛出現的時候）
  const focusInput = () => {
    inputRef.current?.focus({ preventScroll: true });
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  };
  const focusCanvas = () => requestAnimationFrame(() => canvasRef.current?.focus({ preventScroll: true }));

  /* ─── 編輯 ─── */

  const commit = useCallback(() => {
    const e = editRef.current;
    if (!e) return;
    setEdit(null);
    refDrag.current = null;
    const t = wbRef.current.sheets.flatMap((s) => s.tables).find((x) => x.id === e.tid);
    if (!t) return;
    const old = t.cells[key(e.r, e.c)]?.v ?? "";
    if (e.text !== old) modify((w) => setCell(w, e.tid, e.r, e.c, e.text.trim() === "=" ? "" : e.text));
  }, [modify]);
  const wbRef = useRef(wb);
  wbRef.current = wb;

  const startEdit = (text?: string, from: Edit["from"] = "cell") => {
    if (!cells || !selTable) return;
    const raw = selTable.cells[key(cells.a.r, cells.a.c)]?.v ?? "";
    const t = text ?? raw;
    setEdit({ tid: cells.tid, r: cells.a.r, c: cells.a.c, text: t, from });
    caret.current = t.length;
    if (from === "cell")
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus({ preventScroll: true });
        el.setSelectionRange(t.length, t.length);
      });
  };

  // 換工作表、文件卸載前把編輯中的內容存起來
  useEffect(() => () => commit(), [commit]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const root = canvasRef.current?.closest(".sv");
      if (root && !root.contains(e.target as Node) && !(e.target as HTMLElement).closest?.(".sv-pop")) commit();
    };
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  }, [commit]);

  const select = (s: Sel) => {
    setSel(s);
    if (s?.k === "cells") focusInput();
    else focusCanvas();
  };

  /** 編輯公式時插入參照（從 tid 表格的 a 到 b） */
  const insertRef = (tid: string, a: Pos, b: Pos) => {
    const e = editRef.current;
    const d = refDrag.current;
    if (!e || !d) return;
    const t = tableOf(tid);
    if (!t) return;
    const here = tableOf(e.tid);
    const q = tid === e.tid ? {} : here && sheet.tables.includes(t) ? { table: t.name } : { table: t.name };
    const r = norm(a, b);
    const one: Ref = { ...q, col: r.c0, row: r.r0, absC: false, absR: false };
    const txt = r.r0 === r.r1 && r.c0 === r.c1 ? refText(one) : `${refText(one)}:${refText({ col: r.c1, row: r.r1, absC: false, absR: false })}`;
    const text = d.text.slice(0, d.start) + txt + d.text.slice(d.start);
    setEdit({ ...e, text });
    const pos = d.start + txt.length;
    caret.current = pos;
    requestAnimationFrame(() => {
      const el = e.from === "bar" ? barRef.current : inputRef.current;
      el?.focus({ preventScroll: true });
      el?.setSelectionRange(pos, pos);
      caret.current = pos;
    });
  };

  /* ─── 指標：格子 ─── */

  const cellAt = (x: number, y: number, tid?: string): { tid: string; p: Pos } | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-r]");
    const root = el?.closest<HTMLElement>("[data-tid]");
    if (!el || !root || (tid && root.dataset.tid !== tid)) return null;
    return { tid: root.dataset.tid!, p: { r: Number(el.dataset.r), c: Number(el.dataset.c) } };
  };

  const onCellDown = (e: React.PointerEvent, t: Table, p: Pos) => {
    if (e.button === 2) {
      if (!(cells?.tid === t.id && rect && p.r >= rect.r0 && p.r <= rect.r1 && p.c >= rect.c0 && p.c <= rect.c1)) {
        commit();
        setSel({ k: "cells", tid: t.id, a: p, b: p });
      }
      return;
    }
    if (e.button !== 0) return;
    const ed = editRef.current;
    if (ed && !(ed.tid === t.id && ed.r === p.r && ed.c === p.c) && refSpot(ed.text, caret.current)) {
      // 公式裡插入參照，拖曳變成範圍
      e.preventDefault();
      refDrag.current = { start: caret.current, text: ed.text, tid: t.id, a: p };
      insertRef(t.id, p, p);
      const move = (ev: PointerEvent) => {
        const hit = cellAt(ev.clientX, ev.clientY, t.id);
        if (hit) insertRef(t.id, p, hit.p);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        refDrag.current = null;
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      return;
    }
    if (ed && ed.tid === t.id && ed.r === p.r && ed.c === p.c) return;
    commit();
    const target = e.target as HTMLElement;
    const cell = t.cells[key(p.r, p.c)];
    // 勾選格、星等：點了直接改
    if (target.closest(".sc-check") && !isFormula(cell?.v)) {
      const on = show(calc.value(t.id, p.r, p.c), cell?.s).check;
      modify((w) => setCell(w, t.id, p.r, p.c, on ? "FALSE" : "TRUE"));
    }
    const star = target.closest<HTMLElement>("[data-star]");
    if (star && !isFormula(cell?.v)) {
      const n = Number(star.dataset.star);
      const cur = show(calc.value(t.id, p.r, p.c), cell?.s).stars;
      modify((w) => setCell(w, t.id, p.r, p.c, String(cur === n ? 0 : n)));
    }
    const a = e.shiftKey && cells?.tid === t.id ? cells.a : p;
    select({ k: "cells", tid: t.id, a, b: p });
    if (target.closest(".sc-pop") && cell?.s?.opts?.length) {
      e.preventDefault();
      openPopup(t, p, target.getBoundingClientRect());
      return;
    }
    const move = (ev: PointerEvent) => {
      const hit = cellAt(ev.clientX, ev.clientY, t.id);
      if (hit) setSel({ k: "cells", tid: t.id, a, b: hit.p });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** 下拉選單的選項（像 Excel 的資料驗證清單） */
  const openPopup = (t: Table, p: Pos, at: DOMRect) => {
    const s = t.cells[key(p.r, p.c)]?.s;
    if (!s?.opts?.length) return;
    const cur = t.cells[key(p.r, p.c)]?.v ?? "";
    setMenu({
      x: at.left,
      y: at.bottom,
      items: [
        ...s.opts.map((o) => ({ label: o, hint: o === cur ? "✓" : undefined, onClick: () => run((w) => setCell(w, t.id, p.r, p.c, o)) })),
        "sep" as const,
        { label: "Clear", onClick: () => run((w) => setCell(w, t.id, p.r, p.c, "")) },
      ],
    });
  };

  /* ─── 鍵盤 ─── */

  const moveSel = (dr: number, dc: number, extend: boolean, jump = false) => {
    if (!cells || !selTable) return;
    const from = extend ? cells.b : cells.a;
    const hidden = hiddenOf.get(selTable.id) ?? NONE;
    let to = jump
      ? clampPos(selTable, { r: dr ? (dr > 0 ? selTable.rows - 1 : 0) : from.r, c: dc ? (dc > 0 ? selTable.cols - 1 : 0) : from.c })
      : clampPos(selTable, { r: from.r + dr, c: from.c + dc });
    // 篩選掉的列跳過：一般往同一個方向找，跳到邊緣（Ctrl）時往回找
    if (to.r !== from.r && hidden.has(to.r)) {
      const dir = (dr > 0 ? 1 : -1) * (jump ? -1 : 1);
      while (hidden.has(to.r) && to.r + dir >= 0 && to.r + dir < selTable.rows) to = { ...to, r: to.r + dir };
      if (hidden.has(to.r)) return;
    }
    // 藏起來的欄跳過
    const hidC = new Set(selTable.hideC ?? []);
    if (dc && hidC.has(to.c)) {
      const dir = dc > 0 ? 1 : -1;
      while (hidC.has(to.c) && to.c + dir >= 0 && to.c + dir < selTable.cols) to = { ...to, c: to.c + dir };
      if (hidC.has(to.c)) return;
    }
    // 落在合併格子裡：換成它的左上角；本來就在這個合併格子裡就跳出去
    if (!extend) {
      const m = mergeAt(selTable, to.r, to.c);
      const here = mergeAt(selTable, from.r, from.c);
      if (m && m === here) {
        const next = clampPos(selTable, { r: dr > 0 ? m.r1 + 1 : dr < 0 ? m.r0 - 1 : from.r, c: dc > 0 ? m.c1 + 1 : dc < 0 ? m.c0 - 1 : from.c });
        const m2 = mergeAt(selTable, next.r, next.c);
        to = m2 ? { r: m2.r0, c: m2.c0 } : next;
      } else if (m) to = { r: m.r0, c: m.c0 };
    }
    setSel(extend ? { ...cells, b: to } : { ...cells, a: to, b: to });
  };

  const run = (fn: (w: Workbook) => Workbook) => modify(fn);

  const toggleStyle = (k: "b" | "i" | "u") => {
    if (!cells || !rect || !selTable) return;
    const on = !!selTable.cells[key(cells.a.r, cells.a.c)]?.s?.[k];
    run((w) => styleRange(w, cells.tid, rect, { [k]: !on }));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key;
    const lower = k.toLowerCase();
    const ed = editRef.current;
    if (ed) {
      // 函式自動完成的清單開著：上下選、Tab／Enter 插入、Esc 關掉
      if (ac) {
        if (k === "ArrowDown" || k === "ArrowUp") {
          e.preventDefault();
          e.stopPropagation();
          setAcIndex((i) => (i + (k === "ArrowDown" ? 1 : -1) + ac.items.length) % ac.items.length);
          return;
        }
        if (k === "Tab" || k === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          pickFn(ac.items[Math.min(acIndex, ac.items.length - 1)]);
          return;
        }
        if (k === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setAcOff(ed.text);
          return;
        }
      }
      if (k === "Enter" || k === "Tab") {
        e.preventDefault();
        commit();
        if (ed.from === "bar") focusInput();
        if (k === "Enter") moveSel(e.shiftKey ? -1 : 1, 0, false);
        else moveSel(0, e.shiftKey ? -1 : 1, false);
      } else if (k === "Escape") {
        e.preventDefault();
        setEdit(null);
        focusInput();
      }
      e.stopPropagation();
      return;
    }
    if (ctrl && lower === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (ctrl && lower === "y") {
      e.preventDefault();
      redo();
      return;
    }
    if (ctrl && (lower === "f" || lower === "h")) {
      e.preventDefault();
      setFind((f) => ({ ...(f ?? { q: "", by: "", matchCase: false, whole: false, i: 0, replace: false }), replace: lower === "h" || !!f?.replace }));
      return;
    }
    if (sel?.k === "chart" || sel?.k === "table") {
      if (k === "Delete" || k === "Backspace") {
        e.preventDefault();
        if (sel.k === "chart") run((w) => removeChart(w, sel.cid));
        else deleteTable(sel.tid);
        setSel(null);
      } else if (k === "Escape") setSel(null);
      return;
    }
    if (!cells || !rect || !selTable) return;
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[k]) {
      e.preventDefault();
      moveSel(arrows[k][0], arrows[k][1], e.shiftKey, ctrl);
    } else if (k === "Tab") {
      e.preventDefault();
      moveSel(0, e.shiftKey ? -1 : 1, false);
    } else if (k === "Enter") {
      e.preventDefault();
      moveSel(e.shiftKey ? -1 : 1, 0, false);
    } else if (k === "F2") {
      e.preventDefault();
      startEdit();
    } else if (k === "Delete" || k === "Backspace") {
      e.preventDefault();
      run((w) => clearRange(w, cells.tid, rect));
    } else if (k === "Escape") {
      setSel({ ...cells, b: cells.a });
    } else if (ctrl && lower === "a") {
      e.preventDefault();
      setSel({ ...cells, a: { r: 0, c: 0 }, b: { r: selTable.rows - 1, c: selTable.cols - 1 } });
    } else if (ctrl && (k === ";" || k === ":")) {
      // 像 Excel、Google 試算表：Ctrl＋; 今天的日期、Ctrl＋Shift＋; 現在的時間
      e.preventDefault();
      const d = new Date();
      const pad = (x: number) => String(x).padStart(2, "0");
      const text = e.shiftKey ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      run((w) => setCell(w, cells.tid, cells.a.r, cells.a.c, text));
    } else if (ctrl && (k === "-" || k === "_")) {
      // 像 Excel 的 Ctrl＋−：選了整列就刪列、選了整欄就刪欄
      e.preventDefault();
      const wholeRows = rect.c0 === 0 && rect.c1 === selTable.cols - 1;
      const wholeCols = rect.r0 === 0 && rect.r1 === selTable.rows - 1;
      if (wholeRows && !wholeCols) removeRows(selTable, rect.r0, rect.r1 - rect.r0 + 1);
      else if (wholeCols && !wholeRows) removeCols(selTable, rect.c0, rect.c1 - rect.c0 + 1);
      else flash("Select whole rows (click a row number) or whole columns (click a column letter), then press Ctrl+− to delete them");
    } else if (ctrl && k === "5") {
      e.preventDefault();
      const on = !!selTable.cells[key(cells.a.r, cells.a.c)]?.s?.st;
      run((w) => styleRange(w, cells.tid, rect, { st: !on }));
    } else if (e.altKey && k === "ArrowDown") {
      e.preventDefault();
      const el = canvasRef.current?.querySelector<HTMLElement>(`[data-tid="${cells.tid}"] [data-r="${cells.a.r}"][data-c="${cells.a.c}"]`);
      if (el) openPopup(selTable, cells.a, el.getBoundingClientRect());
    } else if (ctrl && (lower === "b" || lower === "i" || lower === "u")) {
      e.preventDefault();
      toggleStyle(lower as "b" | "i" | "u");
    } else if (ctrl && lower === "d") {
      e.preventDefault();
      run((w) => fill(w, cells.tid, rect, "down"));
    } else if (ctrl && lower === "r") {
      e.preventDefault();
      run((w) => fill(w, cells.tid, rect, "right"));
    } else if (k === " " && selTable.cells[key(cells.a.r, cells.a.c)]?.s?.fmt === "checkbox") {
      e.preventDefault();
      const on = show(calc.value(cells.tid, cells.a.r, cells.a.c), selTable.cells[key(cells.a.r, cells.a.c)]?.s).check;
      run((w) => setCell(w, cells.tid, cells.a.r, cells.a.c, on ? "FALSE" : "TRUE"));
    }
  };

  /* ─── 剪貼簿 ─── */

  const copyRange = (e: React.ClipboardEvent, cut: boolean) => {
    if (editRef.current || !cells || !rect || !selTable) return;
    e.preventDefault();
    const grid: { v: string; s?: Style }[][] = [];
    const lines: string[] = [];
    for (let r = rect.r0; r <= rect.r1; r++) {
      const row: { v: string; s?: Style }[] = [];
      const txt: string[] = [];
      for (let c = rect.c0; c <= rect.c1; c++) {
        const cell = selTable.cells[key(r, c)];
        row.push({ v: cell?.v ?? "", s: cell?.s });
        txt.push(show(calc.value(selTable.id, r, c), cell?.s).text.replace(/[\t\n]/g, " "));
      }
      grid.push(row);
      lines.push(txt.join("\t"));
    }
    const tsv = lines.join("\n");
    e.clipboardData.setData("text/plain", tsv);
    clip = { tsv, cells: grid, from: { r: rect.r0, c: rect.c0 } };
    if (cut) run((w) => clearRange(w, cells.tid, rect, true));
  };

  const paste = (e: React.ClipboardEvent) => {
    if (editRef.current || !cells || !rect) return;
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    const ours = clip && clip.tsv === text.replace(/\r\n/g, "\n") ? clip : null;
    const grid = ours
      ? ours.cells
      : text
          .replace(/\r\n?/g, "\n")
          .replace(/\n$/, "")
          .split("\n")
          .map((l) => l.split("\t").map((v) => ({ v: v.trim() })));
    run((w) => pasteGrid(w, cells.tid, rect.r0, rect.c0, grid, ours?.from));
    setSel({ ...cells, a: { r: rect.r0, c: rect.c0 }, b: { r: rect.r0 + grid.length - 1, c: rect.c0 + Math.max(...grid.map((g) => g.length)) - 1 } });
  };

  /* ─── 表格與圖表 ─── */

  const bottom = Math.max(0, ...sheet.tables.map((t) => t.y + headH(t) + tableH(t)), ...sheet.charts.map((c) => c.y + c.h));
  const newTable = (preset: "basic" | "header" | "plain" | "footer") => {
    commit();
    const opts =
      preset === "plain" ? { hr: 0, hc: 0 } : preset === "header" ? { hr: 1, hc: 0 } : preset === "footer" ? { hr: 1, hc: 1, fr: 1, rows: 8 } : {};
    let id = "";
    run((w) => {
      const r = addTable(w, sheet.id, 40, bottom ? bottom + 64 : 40, opts);
      id = r.id;
      return r.wb;
    });
    if (id) select({ k: "cells", tid: id, a: { r: 0, c: 0 }, b: { r: 0, c: 0 } });
  };

  const deleteTable = (tid: string) => {
    const t = tableOf(tid);
    if (!t) return;
    const filled = Object.values(t.cells).some((c) => c.v);
    if (filled && !window.confirm(`Delete “${t.name}” and its charts?`)) return;
    run((w) => removeTable(w, tid));
    setSel(null);
  };

  const newChart = (type: ChartType) => {
    if (!cells || !rect || !selTable) return;
    // 只選一格：用整個表格
    const r = rect.r0 === rect.r1 && rect.c0 === rect.c1 ? { r0: 0, c0: 0, r1: selTable.rows - 1, c1: selTable.cols - 1 } : rect;
    let id = "";
    run((w) => {
      const out = addChart(w, sheet.id, {
        type,
        title: selTable.name,
        // 放在表格下面（畫布往下長，比較容易看到）
        x: selTable.x,
        y: selTable.y + headH(selTable) + tableH(selTable) + 48,
        w: 440,
        h: 290,
        table: selTable.id,
        ...r,
        legend: true,
        byRow: false,
      });
      id = out.id;
      return out.wb;
    });
    if (id) select({ k: "chart", cid: id });
  };

  /* ─── 輔助對齊（和 Draw、白板共用 src/align）：搬表格與圖表、改圖表大小時吸到其他東西的邊、中線或等距，
   *     顯示距離；選取後按住 Alt 滑過別的表格或圖表量距離。拖曳時按住 Alt 暫時不吸附。 ─── */

  const [guides, setGuides] = useState<Guide[]>([]);
  const [measures, setMeasures] = useState<Measure[]>([]);
  const clearAlign = () => {
    setGuides([]);
    setMeasures([]);
  };
  /** 畫布上每個表格、圖表的外框 */
  const objRects = (): { id: string; r: Box }[] => [
    ...sheet.tables.map((t) => ({ id: t.id, r: { x: t.x, y: t.y, w: tableW(t), h: headH(t) + tableH(t) } })),
    ...sheet.charts.map((c) => ({ id: c.id, r: { x: c.x, y: c.y, w: c.w, h: c.h } })),
  ];
  const [altAt, setAltAt] = useState<{ x: number; y: number } | null>(null);
  const altRef = useRef(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Alt") altRef.current = true;
    };
    const off = () => {
      altRef.current = false;
      setAltAt(null);
    };
    const up = (e: KeyboardEvent) => e.key === "Alt" && off();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", off);
    };
  }, []);

  /** 搬動表格、圖表：拖曳中的位移（放開才寫入） */
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const startMove = (e: React.PointerEvent, id: string, at: { x: number; y: number }, onClick?: () => void) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    commit();
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    const all = objRects();
    const box = all.find((o) => o.id === id)?.r ?? null;
    const others = all.filter((o) => o.id !== id).map((o) => o.r);
    let last = { dx: 0, dy: 0 };
    const move = (ev: PointerEvent) => {
      let dx = ev.clientX - x0;
      let dy = ev.clientY - y0;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      // 吸到其他表格、圖表的邊、中線或等距，都沒有才對齊 8px 格線（Alt 暫時不吸附）
      if (box && !ev.altKey) {
        const r = snapMove(box, dx, dy, others, 6, 8);
        dx = r.dx;
        dy = r.dy;
        setGuides(r.guides);
        setMeasures(r.measures);
      } else clearAlign();
      last = { dx: Math.max(-at.x, dx), dy: Math.max(-at.y, dy) };
      setDrag({ id, ...last });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      clearAlign();
      if (!moved) return onClick?.();
      const x = Math.max(0, Math.round(at.x + last.dx));
      const y = Math.max(0, Math.round(at.y + last.dy));
      if (sheet.tables.some((t) => t.id === id)) run((w) => patchTable(w, id, { x, y }));
      else run((w) => patchChart(w, id, { x, y }));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const sortBy = (desc: boolean) => {
    if (!cells || !selTable) return;
    const c = cells.a.c;
    run((w) => sortBody(w, cells.tid, desc, (r) => sortKey(calc.value(cells.tid, r, c))));
  };

  const cellMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!cells || !rect || !selTable) return;
    const t = selTable;
    const nr = rect.r1 - rect.r0 + 1;
    const nc = rect.c1 - rect.c0 + 1;
    const rows = nr === 1 ? "Row" : `${nr} Rows`;
    const colsL = nc === 1 ? "Column" : `${nc} Columns`;
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: `Add ${rows} Above`, onClick: () => run((w) => insertRows(w, t.id, rect.r0, nr)) },
        { label: `Add ${rows} Below`, onClick: () => run((w) => insertRows(w, t.id, rect.r1 + 1, nr)) },
        { label: `Add ${colsL} Before`, onClick: () => run((w) => insertCols(w, t.id, rect.c0, nc)) },
        { label: `Add ${colsL} After`, onClick: () => run((w) => insertCols(w, t.id, rect.c1 + 1, nc)) },
        "sep",
        { label: `Delete ${rows}`, hint: "Ctrl+−", onClick: () => removeRows(t, rect.r0, nr), disabled: t.rows <= 1, danger: true },
        { label: `Delete ${colsL}`, onClick: () => removeCols(t, rect.c0, nc), disabled: t.cols <= 1, danger: true },
        "sep",
        { label: `Sort Ascending by Column ${colName(cells.a.c)}`, onClick: () => sortBy(false) },
        { label: `Sort Descending by Column ${colName(cells.a.c)}`, onClick: () => sortBy(true) },
        "sep",
        { label: "Fill Down", hint: "Ctrl+D", onClick: () => run((w) => fill(w, t.id, rect, "down")), disabled: nr < 2 },
        { label: "Fill Right", hint: "Ctrl+R", onClick: () => run((w) => fill(w, t.id, rect, "right")), disabled: nc < 2 },
        { label: "Clear Contents", hint: "Del", onClick: () => run((w) => clearRange(w, t.id, rect)) },
        { label: "Clear All (with Style)", onClick: () => run((w) => clearRange(w, t.id, rect, true)) },
        "sep",
        t.merges?.some((m) => m.r0 <= rect.r1 && rect.r0 <= m.r1 && m.c0 <= rect.c1 && rect.c0 <= m.c1)
          ? { label: "Unmerge Cells", onClick: () => run((w) => unmergeCells(w, t.id, rect)) }
          : { label: "Merge Cells", onClick: () => run((w) => mergeCells(w, t.id, rect)), disabled: nr === 1 && nc === 1 },
        { label: `Hide ${rows}`, onClick: () => run((w) => setHidden(w, t.id, "row", range(rect.r0, rect.r1), true)), disabled: nr >= t.rows },
        { label: `Hide ${colsL}`, onClick: () => run((w) => setHidden(w, t.id, "col", range(rect.c0, rect.c1), true)), disabled: nc >= t.cols },
        ...(t.hideR?.length || t.hideC?.length ? [{ label: "Unhide All Rows and Columns", onClick: () => run((w) => patchTable(w, t.id, { hideR: undefined, hideC: undefined })) }] : []),
      ],
    });
  };

  // 選取的格子捲進畫面
  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el || !cells || !selTable) return;
    const xs = colXs(selTable);
    const ys = ysOf(selTable);
    const pad = 40;
    const left = selTable.x + xs[cells.b.c] + pad;
    const right = selTable.x + xs[cells.b.c + 1] + pad;
    const top = selTable.y + headH(selTable) + ys[cells.b.r] + pad;
    const bot = selTable.y + headH(selTable) + ys[cells.b.r + 1] + pad;
    if (left - 40 < el.scrollLeft) el.scrollLeft = Math.max(0, left - 40);
    else if (right + 20 > el.scrollLeft + el.clientWidth) el.scrollLeft = right + 20 - el.clientWidth;
    if (top - 40 < el.scrollTop) el.scrollTop = Math.max(0, top - 40);
    else if (bot + 20 > el.scrollTop + el.clientHeight) el.scrollTop = bot + 20 - el.clientHeight;
  }, [cells?.b.r, cells?.b.c, cells?.tid]); // eslint-disable-line react-hooks/exhaustive-deps

  // 選取的圖表捲進畫面
  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el || !selChart) return;
    const pad = 40;
    const { x, y, w, h } = selChart;
    if (x + pad < el.scrollLeft || x + w + pad > el.scrollLeft + el.clientWidth) el.scrollLeft = Math.max(0, x + pad - 40);
    if (y + pad < el.scrollTop || y + h + pad > el.scrollTop + el.clientHeight) el.scrollTop = Math.max(0, y + pad - 40);
  }, [selChart?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ─── 公式列、狀態列 ─── */

  const activeRaw = cells && selTable ? (selTable.cells[key(cells.a.r, cells.a.c)]?.v ?? "") : "";
  const barValue = edit ? edit.text : activeRaw;

  const stats = useMemo(() => {
    if (!rect || !selTable || (rect.r0 === rect.r1 && rect.c0 === rect.c1)) return null;
    const xs: number[] = [];
    let count = 0;
    for (let r = rect.r0; r <= rect.r1; r++) {
      if (hiddenOf.get(selTable.id)?.has(r)) continue; // 篩選掉的列不算（像 Excel）
      for (let c = rect.c0; c <= rect.c1; c++) {
        const v = calc.value(selTable.id, r, c);
        if (v.t !== "empty") count++;
        const n = numberOf(v);
        if (n !== null && v.t === "n") xs.push(n);
      }
    }
    if (!xs.length) return { count };
    const sum = xs.reduce((a, b) => a + b, 0);
    return { count, sum, avg: sum / xs.length, min: Math.min(...xs), max: Math.max(...xs) };
  }, [rect?.r0, rect?.r1, rect?.c0, rect?.c1, selTable, calc, hiddenOf]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendRows = () => {
    if (!props.onSendNotes || !rect || !selTable) return;
    const t = selTable;
    const r0 = Math.max(rect.r0, t.hr);
    const r1 = Math.min(rect.r1, t.rows - t.fr - 1);
    const text = (r: number, c: number) => show(calc.value(t.id, r, c), t.cells[key(r, c)]?.s).text.trim();
    const notes: string[] = [];
    for (let r = r0; r <= r1; r++) {
      const vals = Array.from({ length: t.cols }, (_x, c) => text(r, c));
      if (!vals.some(Boolean)) continue;
      const [first, ...rest] = vals;
      const fields = rest
        .map((v, i) => [t.hr ? text(t.hr - 1, i + 1) : colName(i + 1), v] as const)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k || colName(1)}: ${v}`);
      const title = `**${first || "Untitled"}**`;
      notes.push(fields.length ? `${title}\n\n${fields.join(" · ")}` : title);
    }
    if (notes.length) props.onSendNotes(notes);
  };

  // 選取後按住 Alt：量到滑過的表格或圖表
  const altMeasures = (() => {
    if (!altAt || drag || !sel) return [];
    const selId = sel.k === "chart" ? sel.cid : "tid" in sel ? sel.tid : null;
    const all = objRects();
    const box = alignBounds(all.filter((o) => o.id === selId).map((o) => o.r));
    if (!box) return [];
    const hit = all.find(
      (o) => o.id !== selId && altAt.x >= o.r.x && altAt.x <= o.r.x + o.r.w && altAt.y >= o.r.y && altAt.y <= o.r.y + o.r.h,
    );
    return hit ? measureBetween(box, hit.r) : [];
  })();
  const canvasW = Math.max(1400, ...sheet.tables.map((t) => t.x + tableW(t) + 400), ...sheet.charts.map((c) => c.x + c.w + 400));
  const canvasH = Math.max(900, bottom + 400);


  /* ─── 函式自動完成 ─── */

  const [acIndex, setAcIndex] = useState(0);
  /** 按了 Esc 的那段文字（同一段文字不再跳出清單） */
  const [acOff, setAcOff] = useState<string | null>(null);
  const acPrefix = edit && edit.text !== acOff ? fnPrefix(edit.text, caret.current) : null;
  const acItems = acPrefix ? fnMatches(acPrefix).filter((n) => n !== acPrefix.toUpperCase() || fnMatches(acPrefix).length > 1) : [];
  const ac = acPrefix && acItems.length ? { prefix: acPrefix, items: acItems } : null;
  useEffect(() => setAcIndex(0), [acPrefix]);
  const pickFn = (name: string) => {
    const ed = editRef.current;
    if (!ed || !ac) return;
    const at = caret.current;
    const start = at - ac.prefix.length;
    const text = ed.text.slice(0, start) + name + "(" + ed.text.slice(at);
    // 游標位置記在區域變數：React 改 value 時的 select 事件會改 caret.current
    const pos = start + name.length + 1;
    caret.current = pos;
    setEdit({ ...ed, text });
    requestAnimationFrame(() => {
      const el = ed.from === "bar" ? barRef.current : inputRef.current;
      el?.focus({ preventScroll: true });
      el?.setSelectionRange(pos, pos);
      caret.current = pos;
    });
  };
  const acAnchor = ac ? ((edit?.from === "bar" ? barRef.current : inputRef.current)?.getBoundingClientRect() ?? null) : null;

  /* ─── 尋找與取代 ─── */

  const [find, setFind] = useState<FindState | null>(null);
  const hits: Hit[] = useMemo(() => (find?.q ? findAll(sheet, calc, find.q, find) : []), [find, sheet, calc]);
  const hitAt = find && hits.length ? hits[Math.min(find.i, hits.length - 1)] : null;
  const foundOf = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const h of hits) {
      if (!m.has(h.tid)) m.set(h.tid, new Set());
      m.get(h.tid)!.add(key(h.r, h.c));
    }
    return m;
  }, [hits]);
  const showHit = (h: Hit | null) => h && setSel({ k: "cells", tid: h.tid, a: { r: h.r, c: h.c }, b: { r: h.r, c: h.c } });
  const stepFind = (d: 1 | -1) => {
    if (!find || !hits.length) return;
    const i = (Math.min(find.i, hits.length - 1) + d + hits.length) % hits.length;
    setFind({ ...find, i });
    showHit(hits[i]);
  };
  useEffect(() => {
    if (hitAt) showHit(hitAt);
  }, [find?.q, find?.matchCase, find?.whole]); // eslint-disable-line react-hooks/exhaustive-deps
  const replaceOne = () => {
    if (!find || !hitAt) return;
    let n = 0;
    run((w) => {
      const r = replaceIn(w, [hitAt], find.q, find.by, find);
      n = r.count;
      return r.wb;
    });
    if (!n) stepFind(1);
  };
  const replaceAll = () => {
    if (!find || !hits.length) return;
    let n = 0;
    run((w) => {
      const r = replaceIn(w, hits, find.q, find.by, find);
      n = r.count;
      return r.wb;
    });
    flash(n ? `Replaced ${n} ${n === 1 ? "cell" : "cells"}` : "Nothing to replace (formulas are left alone)");
  };

  /* ─── 匯入 ─── */

  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const tm = setTimeout(() => setMsg(null), 6000);
    return () => clearTimeout(tm);
  }, [msg]);
  const flash = (m: string) => setMsg(m);

  /** 刪掉列、欄（至少留一列一欄），選取移到還在的格子，狀態列提示可以復原 */
  const removeRows = (t: Table, at: number, n: number) => {
    const k = Math.min(n, t.rows - 1 - Math.max(0, at + n - t.rows));
    if (k <= 0) return flash("A table needs at least one row");
    run((w) => deleteRows(w, t.id, at, k));
    const r = Math.min(at, t.rows - k - 1);
    setSel({ k: "cells", tid: t.id, a: { r, c: cells?.a.c ?? 0 }, b: { r, c: cells?.a.c ?? 0 } });
    flash(`Deleted ${k} ${k === 1 ? "row" : "rows"} · Ctrl+Z to undo`);
    focusInput();
  };
  const removeCols = (t: Table, at: number, n: number) => {
    const k = Math.min(n, t.cols - 1 - Math.max(0, at + n - t.cols));
    if (k <= 0) return flash("A table needs at least one column");
    run((w) => deleteCols(w, t.id, at, k));
    const c = Math.min(at, t.cols - k - 1);
    setSel({ k: "cells", tid: t.id, a: { r: cells?.a.r ?? 0, c }, b: { r: cells?.a.r ?? 0, c } });
    flash(`Deleted ${k} ${k === 1 ? "column" : "columns"} · Ctrl+Z to undo`);
    focusInput();
  };
  // 匯入（`formats.ts`）：活頁簿（.xlsx、.xls、.ods）每張變成新的工作表；表格（CSV、JSON、HTML、Markdown）放在目前工作表最下面
  const importFile = async (f: File) => {
    commit();
    try {
      const got = await readSpreadsheet(f.name, new Uint8Array(await f.arrayBuffer()));
      if (got.kind === "workbook") {
        const sheets = got.sheets;
        if (!sheets.length) return flash(`No sheets found in ${f.name}`);
        let id = "";
        run((w) => {
          const r = addImported(w, sheets);
          id = r.id;
          return r.wb;
        });
        if (id) {
          setSheetId(id);
          setSel(null);
        }
        flash(`Imported ${sheets.length} ${sheets.length === 1 ? "sheet" : "sheets"} from ${f.name}`);
      } else {
        const tables = got.tables.filter((t) => t.grid.length);
        if (!tables.length) return flash(`Nothing to import in ${f.name}`);
        let id = "";
        run((w) => {
          const r = importTables(w, sheet.id, tables, bottom ? bottom + 64 : 40);
          id = r.id;
          return r.wb;
        });
        if (id) select({ k: "cells", tid: id, a: { r: 0, c: 0 }, b: { r: 0, c: 0 } });
        flash(tables.length > 1 ? `Imported ${tables.length} tables from ${f.name}` : `Imported ${f.name}`);
      }
    } catch (err) {
      console.error("Import failed", err);
      flash(`Couldn't import ${f.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="sv">
      <Toolbar>
        <TMenu icon={<PlusIcon />} label="Insert" title="Add rows or columns next to the selected cells" disabled={!rect || !selTable}>
          {(close) => {
            const t = selTable!;
            const r = rect!;
            const nr = r.r1 - r.r0 + 1;
            const nc = r.c1 - r.c0 + 1;
            const act = (fn: (w: Workbook) => Workbook) => () => {
              close();
              run(fn);
              focusInput();
            };
            return (
              <>
                <MenuItem label={nr === 1 ? "Row Above" : `${nr} Rows Above`} onClick={act((w) => insertRows(w, t.id, r.r0, nr))} />
                <MenuItem label={nr === 1 ? "Row Below" : `${nr} Rows Below`} onClick={act((w) => insertRows(w, t.id, r.r1 + 1, nr))} />
                <div className="popover-sep" />
                <MenuItem label={nc === 1 ? "Column Before" : `${nc} Columns Before`} onClick={act((w) => insertCols(w, t.id, r.c0, nc))} />
                <MenuItem label={nc === 1 ? "Column After" : `${nc} Columns After`} onClick={act((w) => insertCols(w, t.id, r.c1 + 1, nc))} />
              </>
            );
          }}
        </TMenu>
        <TMenu icon={<TrashIcon />} label="Delete" title="Delete the selected rows or columns" disabled={!rect || !selTable}>
          {(close) => {
            const t = selTable!;
            const r = rect!;
            const nr = r.r1 - r.r0 + 1;
            const nc = r.c1 - r.c0 + 1;
            return (
              <>
                <MenuItem
                  label={nr === 1 ? `Delete Row ${r.r0 + 1}` : `Delete Rows ${r.r0 + 1}–${r.r1 + 1}`}
                  hint={nr >= t.rows ? "Keeps one row" : undefined}
                  onClick={() => (close(), removeRows(t, r.r0, nr))}
                />
                <MenuItem
                  label={nc === 1 ? `Delete Column ${colName(r.c0)}` : `Delete Columns ${colName(r.c0)}–${colName(r.c1)}`}
                  hint={nc >= t.cols ? "Keeps one column" : undefined}
                  onClick={() => (close(), removeCols(t, r.c0, nc))}
                />
              </>
            );
          }}
        </TMenu>
        <TMenu icon={<FormulaIcon />} label="Formula" title="Start a formula in the selected cell" disabled={!cells}>
          {(close) => (
            <>
              {QUICK_FNS.map(([fn, label]) => (
                <MenuItem
                  key={fn}
                  label={label}
                  hint={`=${fn}()`}
                  onClick={() => {
                    close();
                    startEdit(`=${fn}(`);
                  }}
                />
              ))}
              <div className="popover-sep" />
              <MenuItem
                label="New Formula"
                hint="="
                onClick={() => {
                  close();
                  startEdit("=");
                }}
              />
            </>
          )}
        </TMenu>
        <span className="dc-sep" />
        <TMenu icon={<TableIcon />} label="Table" title="Add a table to this sheet">
          {(close) =>
            TABLE_PRESETS.map(([id, label, hint]) => (
              <MenuItem
                key={id}
                label={label}
                hint={hint}
                onClick={() => {
                  close();
                  newTable(id);
                }}
              />
            ))
          }
        </TMenu>
        <TMenu icon={<ChartGlyph />} label="Chart" title={cells ? "Chart the selected cells" : "Select cells in a table first"} disabled={!cells}>
          {(close) =>
            CHART_TYPES.map((ty) => (
              <MenuItem
                key={ty}
                label={CHART_LABEL[ty]}
                onClick={() => {
                  close();
                  newChart(ty);
                }}
              />
            ))
          }
        </TMenu>
        <TBtn
          icon={<ImportIcon />}
          label="Import"
          title="Import Excel (.xlsx, .xls), OpenDocument (.ods), CSV/TSV, JSON, or tables from a web page (.html) or Markdown (.md)"
          onClick={() => fileRef.current?.click()}
        />
        <input
          ref={fileRef}
          type="file"
          accept={IMPORT_ACCEPT}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void importFile(f);
          }}
        />
        {props.onSendNotes && (
          <TBtn icon={<SendIcon />} label="To Whiteboard" title="Turn the selected rows into sticky notes on the whiteboard" disabled={!cells} onClick={sendRows} />
        )}
        <span className="dc-gap" />
        <TBtn icon={<PanelRightIcon />} label="Format" title="Show or hide the Format inspector" on={panel === "format"} onClick={() => setPanel(panel === "format" ? null : "format")} />
        <TBtn icon={<SortIcon />} label="Organize" title="Sort and filter the selected table" on={panel === "organize"} onClick={() => setPanel(panel === "organize" ? null : "organize")} />
      </Toolbar>
      <SheetTabs
        wb={wb}
        active={sheet.id}
        onPick={(id) => {
          commit();
          setSheetId(id);
          const t = wb.sheets.find((s) => s.id === id)?.tables[0];
          setSel(t ? { k: "cells", tid: t.id, a: { r: 0, c: 0 }, b: { r: 0, c: 0 } } : null);
        }}
        onAdd={() => {
          commit();
          let id = "";
          run((w) => {
            const r = addSheet(w);
            id = r.id;
            return r.wb;
          });
          if (id) {
            setSheetId(id);
            setSel(null);
          }
        }}
        onRename={(id, name) => run((w) => renameSheet(w, id, name))}
        onDuplicate={(id) => {
          commit();
          let nid = "";
          run((w) => {
            const r = duplicateSheet(w, id);
            nid = r.id;
            return r.wb;
          });
          if (nid) {
            setSheetId(nid);
            setSel(null);
          }
        }}
        onDelete={(id) => {
          const s = wb.sheets.find((x) => x.id === id);
          if (!s || wb.sheets.length <= 1) return;
          if (!window.confirm(`Delete the sheet “${s.name}” with its tables and charts?`)) return;
          run((w) => removeSheet(w, id));
          if (id === sheet.id) setSheetId(wb.sheets.find((x) => x.id !== id)!.id);
          setSel(null);
        }}
      />
      <div className="sv-formula">
        <span className="sv-cellname">{cells && selTable ? (rect && (rect.r0 !== rect.r1 || rect.c0 !== rect.c1) ? `${cellName(rect.r0, rect.c0)}:${cellName(rect.r1, rect.c1)}` : cellName(cells.a.r, cells.a.c)) : ""}</span>
        <span className="sv-fx">fx</span>
        <input
          ref={barRef}
          className="sv-bar"
          value={barValue}
          disabled={!cells}
          placeholder={cells ? "Type a value, or = to start a formula" : ""}
          spellCheck={false}
          onFocus={() => {
            if (!editRef.current && cells) startEdit(undefined, "bar");
            else if (editRef.current) setEdit({ ...editRef.current, from: "bar" });
          }}
          onChange={(e) => {
            const ed = editRef.current;
            if (!ed) return;
            caret.current = e.target.selectionStart ?? e.target.value.length;
            setEdit({ ...ed, text: e.target.value, from: "bar" });
          }}
          onSelect={(e) => (caret.current = e.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKey}
        />
        {edit && !ac && <FormulaHint text={edit.text} />}
      </div>
      {find && (
        <FindBar
          state={find}
          count={hits.length}
          onChange={setFind}
          onStep={stepFind}
          onReplace={replaceOne}
          onReplaceAll={replaceAll}
          onClose={() => {
            setFind(null);
            focusInput();
          }}
        />
      )}
      {ac && acAnchor && <FnList at={acAnchor} items={ac.items} index={Math.min(acIndex, ac.items.length - 1)} onPick={pickFn} />}
      <div className="sv-main">
        <div
          className="sv-canvas"
          ref={canvasRef}
          tabIndex={-1}
          onKeyDown={onKey}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("sv-paper")) {
              commit();
              setSel(null);
              focusCanvas();
            }
          }}
        >
          <div
            className="sv-paper"
            style={{ width: canvasW, height: canvasH }}
            onPointerMove={(e) => {
              if (!altRef.current && !e.altKey) {
                if (altAt) setAltAt(null);
                return;
              }
              const r = e.currentTarget.getBoundingClientRect();
              setAltAt({ x: e.clientX - r.left, y: e.clientY - r.top });
            }}
          >
            <AlignOverlay guides={guides} measures={[...measures, ...altMeasures]} zoom={1} />
            {sheet.tables.map((t) => {
              const d = drag?.id === t.id ? drag : null;
              return (
                <TableView
                  key={t.id}
                  t={t}
                  sheet={sheet}
                  wb={wb}
                  calc={calc}
                  dx={d?.dx ?? 0}
                  dy={d?.dy ?? 0}
                  hidden={hiddenOf.get(t.id) ?? NONE}
                  looks={looksOf.get(t.id) ?? NO_LOOKS}
                  found={foundOf.get(t.id) ?? NO_KEYS}
                  foundAt={hitAt?.tid === t.id ? key(hitAt.r, hitAt.c) : null}
                  onFill={(src, to) => {
                    run((w) => autofill(w, t.id, src, to));
                    setSel({ k: "cells", tid: t.id, a: { r: to.r0, c: to.c0 }, b: { r: to.r1, c: to.c1 } });
                    focusInput();
                  }}
                  objectSel={sel?.k === "table" && sel.tid === t.id}
                  cells={cells?.tid === t.id ? cells : null}
                  edit={edit?.tid === t.id ? edit : null}
                  refEdit={edit}
                  inputRef={cells?.tid === t.id ? inputRef : null}
                  onCellDown={onCellDown}
                  onCellDouble={() => startEdit()}
                  onMenu={cellMenu}
                  onSelect={(s) => {
                    commit();
                    select(s);
                  }}
                  onMove={(e) => startMove(e, t.id, t, () => select({ k: "table", tid: t.id }))}
                  onInput={(text, pos) => {
                    caret.current = pos;
                    const ed = editRef.current;
                    if (ed) setEdit({ ...ed, text, from: "cell" });
                    else if (cells) setEdit({ tid: cells.tid, r: cells.a.r, c: cells.a.c, text, from: "cell" });
                  }}
                  onCaret={(pos) => (caret.current = pos)}
                  onCopy={(e) => copyRange(e, false)}
                  onCut={(e) => copyRange(e, true)}
                  onPaste={paste}
                  run={run}
                  onNote={flash}
                />
              );
            })}
            {sheet.charts.map((ch) => {
              const t = sheet.tables.find((x) => x.id === ch.table);
              const d = drag?.id === ch.id ? drag : null;
              return (
                <ChartView
                  key={ch.id}
                  chart={{ ...ch, x: ch.x + (d?.dx ?? 0), y: ch.y + (d?.dy ?? 0) }}
                  table={t ?? null}
                  calc={calc}
                  selected={sel?.k === "chart" && sel.cid === ch.id}
                  onDown={(e) => startMove(e, ch.id, ch, () => select({ k: "chart", cid: ch.id }))}
                  onResize={(w, h) => run((wb2) => patchChart(wb2, ch.id, { w, h }))}
                  snapSize={(w, h, alt) => {
                    if (alt) {
                      clearAlign();
                      return { w, h };
                    }
                    const r0 = { x: ch.x, y: ch.y, w: ch.w, h: ch.h };
                    const others = objRects()
                      .filter((o) => o.id !== ch.id)
                      .map((o) => o.r);
                    const sr = snapResizeGrid({ ...r0, w, h }, r0, "se", others, 6, 8, 150);
                    setGuides(sr.guides);
                    setMeasures(sr.measures);
                    return { w: Math.max(200, sr.rect.w), h: Math.max(150, sr.rect.h) };
                  }}
                  onResizeEnd={clearAlign}
                />
              );
            })}
            {!sheet.tables.length && !sheet.charts.length && (
              <div className="sv-empty">
                <p>This sheet is empty.</p>
                <button className="dp-btn" onClick={() => newTable("basic")}>
                  <PlusIcon /> Add a table
                </button>
              </div>
            )}
          </div>
        </div>
        {panel === "format" && (
          <SheetFormat
            wb={wb}
            table={selTable}
            chart={selChart}
            rect={rect}
            anchor={cells?.a ?? null}
            run={run}
            onDeleteTable={deleteTable}
            onDuplicateTable={(id) => {
              let nid = "";
              run((w) => {
                const r = duplicateTable(w, id);
                nid = r.id;
                return r.wb;
              });
              if (nid) select({ k: "table", tid: nid });
            }}
            onDeleteChart={(id) => {
              run((w) => removeChart(w, id));
              setSel(null);
            }}
          />
        )}
        {panel === "organize" && (
          <SheetOrganize
            table={selTable}
            anchor={cells?.a ?? null}
            rect={rect}
            hidden={selTable ? (hiddenOf.get(selTable.id)?.size ?? 0) : 0}
            run={run}
            onSort={sortBy}
            onDedupe={(cols) => {
              if (!selTable) return;
              let removed = 0;
              run((w) => {
                const r = removeDuplicates(w, selTable.id, cols, (row, c) => show(calc.value(selTable.id, row, c), selTable.cells[key(row, c)]?.s).text);
                removed = r.removed;
                return r.wb;
              });
              flash(removed ? `Removed ${removed} duplicate ${removed === 1 ? "row" : "rows"}` : "No duplicate rows found");
            }}
          />
        )}
      </div>
      <div className="sv-status">
        {msg ? (
          <span className="sv-msg" role="status">
            {msg}
          </span>
        ) : stats ? (
          <>
            {stats.sum !== undefined && (
              <>
                <span>
                  SUM <b>{generalNumber(stats.sum)}</b>
                </span>
                <span>
                  AVERAGE <b>{generalNumber(Number(stats.avg!.toPrecision(10)))}</b>
                </span>
                <span>
                  MIN <b>{generalNumber(stats.min!)}</b>
                </span>
                <span>
                  MAX <b>{generalNumber(stats.max!)}</b>
                </span>
              </>
            )}
            <span>
              COUNT <b>{stats.count}</b>
            </span>
          </>
        ) : (
          <span className="sv-tip">Select cells to see their sum. Type = to start a formula; click cells to add them.</span>
        )}
      </div>
      {menu && (
        <Pop at={new DOMRect(menu.x, menu.y, 0, 0)} below={false} onClose={() => setMenu(null)}>
          {menu.items.map((it, i) =>
            it === "sep" ? (
              <div key={i} className="sv-pop-sep" />
            ) : (
              <button
                key={i}
                className={it.danger ? "danger" : ""}
                disabled={it.disabled}
                onClick={() => {
                  setMenu(null);
                  it.onClick();
                  focusInput();
                }}
              >
                <span className="label">{it.label}</span>
                {it.hint && <span className="hint">{it.hint}</span>}
              </button>
            ),
          )}
        </Pop>
      )}
    </div>
  );
}

/* ─── 工作表分頁 ─── */

function SheetTabs(props: {
  wb: Workbook;
  active: string;
  onPick: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  const [naming, setNaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; at: DOMRect } | null>(null);
  return (
    <div className="sv-tabs" role="tablist">
      {props.wb.sheets.map((s) => (
        <div key={s.id} className={`sv-tab${s.id === props.active ? " on" : ""}`} role="tab" aria-selected={s.id === props.active}>
          {naming === s.id ? (
            <input
              autoFocus
              defaultValue={s.name}
              onBlur={(e) => {
                setNaming(null);
                props.onRename(s.id, e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setNaming(null);
              }}
            />
          ) : (
            <button
              onClick={() => props.onPick(s.id)}
              onDoubleClick={() => setNaming(s.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ id: s.id, at: new DOMRect(e.clientX, e.clientY, 0, 0) });
              }}
              title="Double-click to rename · right-click for more"
            >
              {s.name}
            </button>
          )}
          {props.wb.sheets.length > 1 && s.id === props.active && (
            <button className="sv-tab-x" title="Delete this sheet" onClick={() => props.onDelete(s.id)}>
              <CloseIcon />
            </button>
          )}
        </div>
      ))}
      <button className="sv-tab-add" title="Add a sheet" onClick={props.onAdd}>
        <PlusIcon />
      </button>
      {menu && (
        <Pop at={menu.at} below={false} onClose={() => setMenu(null)}>
          <button
            onClick={() => {
              setNaming(menu.id);
              setMenu(null);
            }}
          >
            <span className="label">Rename</span>
          </button>
          <button
            onClick={() => {
              props.onDuplicate(menu.id);
              setMenu(null);
            }}
          >
            <span className="label">Duplicate Sheet</span>
          </button>
          <button
            className="danger"
            disabled={props.wb.sheets.length <= 1}
            onClick={() => {
              props.onDelete(menu.id);
              setMenu(null);
            }}
          >
            <span className="label">Delete Sheet</span>
          </button>
        </Pop>
      )}
    </div>
  );
}

/* ─── 公式提示 ─── */

function FormulaHint(props: { text: string }) {
  if (!isFormula(props.text)) return null;
  // 游標所在的函式名稱（最後一個沒關起來的「NAME(」）
  const m = /([A-Za-z][A-Za-z0-9.]*)\([^()]*$/.exec(props.text);
  const fn = m?.[1].toUpperCase();
  const help = fn ? FN_ARGS[fn] : undefined;
  return help !== undefined ? (
    <span className="sv-hint">
      <b>{fn}</b>({help})
    </span>
  ) : null;
}


/* ─── 右邊的檢閱器（參考 Numbers）：Format（表格、儲存格、文字；圖表）與 Organize（排序、篩選） ─── */

type FmtTab = "table" | "cell" | "text";

function SheetFormat(props: {
  wb: Workbook;
  table: Table | null;
  chart: Chart | null;
  rect: Rect | null;
  anchor: Pos | null;
  run: (fn: (w: Workbook) => Workbook) => void;
  onDeleteTable: (id: string) => void;
  onDuplicateTable: (id: string) => void;
  onDeleteChart: (id: string) => void;
}) {
  const { table: t, chart: ch, rect, anchor, run } = props;
  // 選了儲存格先看 Cell，只選了表格看 Table（跟 Numbers 一樣，記住使用者換過的分頁）
  const [tab, setTab] = useState<FmtTab | null>(null);
  const shown: FmtTab = tab ?? (rect ? "cell" : "table");
  const s: Style = (t && anchor && t.cells[key(anchor.r, anchor.c)]?.s) || {};
  const fmt = s.fmt ?? "auto";
  const style = (patch: Partial<Record<keyof Style, unknown>>) => t && rect && run((w) => styleRange(w, t.id, rect, patch));
  const note = (t && anchor && t.cells[key(anchor.r, anchor.c)]?.n) || "";
  const merged = !!(t && rect && t.merges?.some((m) => m.r0 <= rect.r1 && rect.r0 <= m.r1 && m.c0 <= rect.c1 && rect.c0 <= m.c1));

  if (ch) {
    const src = props.wb.sheets.flatMap((x) => x.tables).find((x) => x.id === ch.table);
    return (
      <Inspector title="Chart">
        <Section title="Chart Type">
          <Popup label="Chart type" value={ch.type} options={CHART_TYPES.map((ty) => ({ id: ty, label: CHART_LABEL[ty] }))} onPick={(ty) => run((w) => patchChart(w, ch.id, { type: ty }))} />
        </Section>
        <Section title="Chart Options">
          <Field label="Title">
            <input
              className="dc-input"
              defaultValue={ch.title}
              key={ch.id + ch.title}
              placeholder="No title"
              onBlur={(e) => run((w) => patchChart(w, ch.id, { title: e.target.value }))}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          </Field>
          <label className="dc-check">
            <input type="checkbox" checked={ch.legend} onChange={(e) => run((w) => patchChart(w, ch.id, { legend: e.target.checked }))} /> Legend
          </label>
          {ch.type !== "pie" && (
            <label className="dc-check">
              <input type="checkbox" checked={ch.byRow} onChange={(e) => run((w) => patchChart(w, ch.id, { byRow: e.target.checked }))} /> Plot rows as series
            </label>
          )}
          <p className="dc-note">
            Data: {src?.name ?? "missing table"} · {cellName(ch.r0, ch.c0)}:{cellName(ch.r1, ch.c1)}
          </p>
        </Section>
        <Section>
          <button className="dp-btn danger" onClick={() => props.onDeleteChart(ch.id)}>
            <TrashIcon /> Delete Chart
          </button>
        </Section>
      </Inspector>
    );
  }
  if (!t)
    return (
      <Inspector title="Format">
        <Section>
          <p className="dc-empty">Select a table, cells or a chart to format it.</p>
        </Section>
      </Inspector>
    );
  const needCells = !rect && shown !== "table";
  return (
    <Inspector
      title="Format"
      tabs={[
        { id: "table", label: "Table" },
        { id: "cell", label: "Cell" },
        { id: "text", label: "Text" },
      ]}
      tab={shown}
      onTab={(id) => setTab(id as FmtTab)}
    >
      {needCells ? (
        <Section>
          <p className="dc-empty">Select some cells to format them.</p>
        </Section>
      ) : shown === "table" ? (
        <>
          <Section title="Table Styles">
            <div className="sv-themes">
              {THEMES.map((th) => (
                <button key={th} className={`theme-${th}${t.theme === th ? " on" : ""}`} title={th} onClick={() => run((w) => patchTable(w, t.id, { theme: th }))} />
              ))}
            </div>
            <label className="dc-check">
              <input type="checkbox" checked={t.banded} onChange={(e) => run((w) => patchTable(w, t.id, { banded: e.target.checked }))} /> Alternating row color
            </label>
          </Section>
          <Section title="Table Name">
            <input
              className="dc-input"
              key={t.id + t.name}
              defaultValue={t.name}
              onBlur={(e) => run((w) => renameTable(w, t.id, e.target.value))}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
            <label className="dc-check">
              <input type="checkbox" checked={t.showName} onChange={(e) => run((w) => patchTable(w, t.id, { showName: e.target.checked }))} /> Show name
            </label>
          </Section>
          <Section title="Table Size">
            <div className="sv-row">
              <Stepper label="Rows" value={t.rows} min={Math.max(1, t.hr + t.fr + 1)} max={5000} onChange={(v) => run((w) => resizeTable(w, t.id, v, t.cols))} />
              <Stepper label="Columns" value={t.cols} min={1} max={200} onChange={(v) => run((w) => resizeTable(w, t.id, t.rows, v))} />
            </div>
            <p className="dc-note">Adds or removes rows above the footer and columns on the right. To remove others, select them and use Delete in the toolbar.</p>
          </Section>
          <Section title="Headers & Footer">
            <div className="sv-row three">
              <Stepper label="Header Rows" value={t.hr} max={Math.min(5, t.rows - t.fr)} onChange={(v) => run((w) => patchTable(w, t.id, { hr: v }))} />
              <Stepper label="Header Cols" value={t.hc} max={Math.min(5, t.cols)} onChange={(v) => run((w) => patchTable(w, t.id, { hc: v }))} />
              <Stepper label="Footer" value={t.fr} max={Math.min(5, t.rows - t.hr)} onChange={(v) => run((w) => patchTable(w, t.id, { fr: v }))} />
            </div>
            <p className="dc-note">
              {t.rows} rows × {t.cols} columns
            </p>
            {(t.hideR?.length || t.hideC?.length) && (
              <button className="dp-btn" style={{ marginTop: 8 }} onClick={() => run((w) => patchTable(w, t.id, { hideR: undefined, hideC: undefined }))}>
                Unhide {[t.hideR?.length && `${t.hideR.length} rows`, t.hideC?.length && `${t.hideC.length} columns`].filter(Boolean).join(", ")}
              </button>
            )}
          </Section>
          <Section>
            <div className="dc-row">
              <button className="dp-btn" onClick={() => props.onDuplicateTable(t.id)}>
                <CopyIcon /> Duplicate
              </button>
              <button className="dp-btn danger" onClick={() => props.onDeleteTable(t.id)}>
                <TrashIcon /> Delete Table
              </button>
            </div>
          </Section>
        </>
      ) : shown === "cell" ? (
        <>
          <Section title="Data Format">
            <Popup label="Data format" value={fmt} options={FORMATS.map((f) => ({ id: f.fmt, label: f.label }))} onPick={(f) => style({ fmt: f, dec: undefined })} />
            {(fmt === "number" || fmt === "currency" || fmt === "percent") && (
              <div className="sv-fmt-opts">
                <Field label="Decimals">
                  <Popup
                    label="Decimal places"
                    value={s.dec ?? -1}
                    options={[{ id: -1, label: "Auto" }, ...[0, 1, 2, 3, 4, 5, 6].map((d) => ({ id: d, label: String(d) }))]}
                    onPick={(d) => style({ dec: d < 0 ? undefined : d })}
                  />
                </Field>
                {fmt === "currency" && (
                  <Field label="Symbol">
                    <Popup label="Currency symbol" value={s.cur ?? "$"} options={CURRENCIES.map((c) => ({ id: c, label: c }))} onPick={(c) => style({ cur: c === "$" ? undefined : c })} />
                  </Field>
                )}
                {(fmt === "number" || fmt === "percent") && (
                  <label className="dc-check">
                    <input type="checkbox" checked={!!s.sep} onChange={(e) => style({ sep: e.target.checked })} /> Thousands separator
                  </label>
                )}
              </div>
            )}
            <div className="dc-row sv-dec-row">
              <Seg label="Decimal places">
                <SegBtn title="Decrease decimal places" onClick={() => style({ fmt: fmt === "auto" ? "number" : fmt, dec: Math.max(0, (s.dec ?? 2) - 1) })}>
                  <span className="dc-mono">.0←</span>
                </SegBtn>
                <SegBtn title="Increase decimal places" onClick={() => style({ fmt: fmt === "auto" ? "number" : fmt, dec: Math.min(10, (s.dec ?? 0) + 1) })}>
                  <span className="dc-mono">.00→</span>
                </SegBtn>
              </Seg>
            </div>
            {fmt === "popup" && (
              <>
                <p className="dc-note">Choices, one per line. Click ▾ in the cell (or press Alt+↓) to pick one.</p>
                <textarea
                  className="dc-input dc-area"
                  rows={5}
                  key={t.id + (s.opts ?? []).join("|")}
                  defaultValue={(s.opts ?? []).join("\n")}
                  placeholder={"Yes\nNo\nMaybe"}
                  onKeyDown={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    const opts = e.target.value
                      .split("\n")
                      .map((x) => x.trim())
                      .filter(Boolean);
                    style({ opts: opts.length ? opts : undefined });
                  }}
                />
              </>
            )}
          </Section>
          <Section title="Fill">
            <Swatches value={s.fill} colors={FILL_COLORS} onPick={(c) => style({ fill: c })} />
          </Section>
          <Section title="Border">
            <div className="sv-borders">
              {BORDERS.map((b) => (
                <button key={b} className="sv-border-btn" title={BORDER_LABEL[b]} aria-label={BORDER_LABEL[b]} onClick={() => t && rect && run((w) => setBorders(w, t.id, rect, b))}>
                  <BorderGlyph mode={b} />
                </button>
              ))}
            </div>
          </Section>
          <Section title="Merge">
            {merged ? (
              <button className="dp-btn" onClick={() => t && rect && run((w) => unmergeCells(w, t.id, rect))}>
                Unmerge Cells
              </button>
            ) : (
              <button className="dp-btn" disabled={!rect || (rect.r0 === rect.r1 && rect.c0 === rect.c1)} onClick={() => t && rect && run((w) => mergeCells(w, t.id, rect))}>
                Merge Cells
              </button>
            )}
            <p className="dc-note">Keeps the top-left value, like Excel and Google Sheets.</p>
          </Section>
          <Section title="Note">
            <textarea
              className="dc-input dc-area"
              rows={3}
              key={`${t.id}:${anchor?.r}:${anchor?.c}:${note}`}
              defaultValue={note}
              placeholder="Add a note to this cell"
              onKeyDown={(e) => e.stopPropagation()}
              onBlur={(e) => anchor && e.target.value !== note && run((w) => setNote(w, t.id, anchor.r, anchor.c, e.target.value))}
            />
          </Section>
          <div className="sv-insp-old">
            <RulesSection t={t} rect={rect!} run={run} />
          </div>
        </>
      ) : (
        <>
          <Section title="Font">
            <div className="dc-row">
              <Seg label="Character style">
                <SegBtn title="Bold (Ctrl+B)" on={!!s.b} onClick={() => style({ b: !s.b })}>
                  <b>B</b>
                </SegBtn>
                <SegBtn title="Italic (Ctrl+I)" on={!!s.i} onClick={() => style({ i: !s.i })}>
                  <i style={{ fontFamily: "Georgia, serif" }}>I</i>
                </SegBtn>
                <SegBtn title="Underline (Ctrl+U)" on={!!s.u} onClick={() => style({ u: !s.u })}>
                  <u>U</u>
                </SegBtn>
                <SegBtn title="Strikethrough (Ctrl+5)" on={!!s.st} onClick={() => style({ st: !s.st })}>
                  <s>S</s>
                </SegBtn>
              </Seg>
            </div>
            <Field label="Size">
              <Popup label="Font size" value={s.fs ?? 13} options={FONT_SIZES.map((n) => ({ id: n, label: `${n} pt` }))} onPick={(n) => style({ fs: n === 13 ? undefined : n })} />
            </Field>
          </Section>
          <Section title="Text Color">
            <Swatches value={s.color} colors={TEXT_COLORS} onPick={(c) => style({ color: c })} />
          </Section>
          <Section title="Alignment">
            <Seg label="Alignment">
              <SegBtn title="Align left" on={s.align === "left"} onClick={() => style({ align: s.align === "left" ? undefined : "left" })}>
                <AlignLeftIcon />
              </SegBtn>
              <SegBtn title="Center" on={s.align === "center"} onClick={() => style({ align: s.align === "center" ? undefined : "center" })}>
                <AlignCenterIcon />
              </SegBtn>
              <SegBtn title="Align right" on={s.align === "right"} onClick={() => style({ align: s.align === "right" ? undefined : "right" })}>
                <AlignRightIcon />
              </SegBtn>
            </Seg>
            <p className="dc-note">With no alignment set, numbers line up on the right and text on the left.</p>
            <div className="dc-row" style={{ marginTop: 10 }}>
              <Seg label="Vertical alignment">
                {(["top", "middle", "bottom"] as const).map((v) => (
                  <SegBtn key={v} title={`Align ${v}`} on={(s.va ?? "middle") === v} onClick={() => style({ va: v === "middle" ? undefined : v })}>
                    <VAlignGlyph at={v} />
                  </SegBtn>
                ))}
              </Seg>
            </div>
            <label className="dc-check">
              <input type="checkbox" checked={!!s.wrap} onChange={(e) => style({ wrap: e.target.checked })} /> Wrap text
            </label>
          </Section>
        </>
      )}
    </Inspector>
  );
}

/** Organize：排序（照選取格的欄）與篩選 */
function SheetOrganize(props: {
  table: Table | null;
  anchor: Pos | null;
  rect: Rect | null;
  hidden: number;
  run: (fn: (w: Workbook) => Workbook) => void;
  onSort: (desc: boolean) => void;
  onDedupe: (cols: number[]) => void;
}) {
  const t = props.table;
  if (!t)
    return (
      <Inspector title="Organize">
        <Section>
          <p className="dc-empty">Select a table to sort or filter it.</p>
        </Section>
      </Inspector>
    );
  const col = props.anchor?.c ?? 0;
  return (
    <Inspector title="Organize">
      <Section title="Sort">
        <div className="dc-row">
          <button className="dp-btn" disabled={!props.anchor} onClick={() => props.onSort(false)} title={`Sort the body rows by column ${colName(col)}, A to Z`}>
            <ArrowUpIcon /> Ascending
          </button>
          <button className="dp-btn" disabled={!props.anchor} onClick={() => props.onSort(true)} title={`Sort the body rows by column ${colName(col)}, Z to A`}>
            <ArrowDownIcon /> Descending
          </button>
        </div>
        <p className="dc-note">{props.anchor ? `Sorts the body rows by column ${colName(col)}. Header and footer rows stay put.` : "Select a cell in the column to sort by."}</p>
      </Section>
      <div className="sv-insp-old">
        <FilterSection t={t} hidden={props.hidden} col={col} run={props.run} />
      </div>
      <Section title="Remove Duplicates">
        <button
          className="dp-btn"
          onClick={() => {
            const r = props.rect;
            const many = r && r.c1 > r.c0;
            props.onDedupe(many ? range(r.c0, r.c1) : range(0, t.cols - 1));
          }}
        >
          Remove Duplicate Rows
        </button>
        <p className="dc-note">Compares {props.rect && props.rect.c1 > props.rect.c0 ? `columns ${colName(props.rect.c0)}–${colName(props.rect.c1)}` : "whole rows"} and keeps the first one.</p>
      </Section>
    </Inspector>
  );
}

function Stepper(props: { label: string; value: number; min?: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="sv-field">
      <span>{props.label}</span>
      <div className="sv-stepper">
        <button disabled={props.value <= (props.min ?? 0)} onClick={() => props.onChange(props.value - 1)}>
          −
        </button>
        <b>{props.value}</b>
        <button disabled={props.value >= props.max} onClick={() => props.onChange(props.value + 1)}>
          +
        </button>
      </div>
    </div>
  );
}

function Swatches(props: { value?: string; colors: string[]; onPick: (c: string | undefined) => void }) {
  return (
    <div className="sv-swatches">
      <button className={`none${!props.value ? " on" : ""}`} title="None" onClick={() => props.onPick(undefined)} />
      {props.colors.map((c) => (
        <button key={c} className={props.value === c ? "on" : ""} style={{ background: c }} title={c} onClick={() => props.onPick(c)} />
      ))}
    </div>
  );
}

/* ─── 浮動選單 ─── */

function Pop(props: { at: DOMRect; below?: boolean; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: props.at.left, top: props.below === false ? props.at.top : props.at.bottom + 4 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos((p) => ({
      left: Math.max(8, Math.min(p.left, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(p.top, window.innerHeight - r.height - 8)),
    }));
  }, []);
  useEffect(() => {
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && props.onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
    };
  });
  return createPortal(
    <div className="sv-pop" ref={ref} style={pos} onContextMenu={(e) => e.preventDefault()}>
      {props.children}
    </div>,
    document.body,
  );
}

/* ─── 圖示 ─── */

const ChartGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
    <path d="M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5" />
  </svg>
);

const FONT_SIZES = [9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 36];

const BORDER_LABEL: Record<BorderMode, string> = {
  all: "All borders",
  outer: "Outside borders",
  inner: "Inside borders",
  top: "Top border",
  bottom: "Bottom border",
  left: "Left border",
  right: "Right border",
  none: "No borders",
};

/** 框線按鈕的圖示：細線是格線，粗線是會加上的框線 */
function BorderGlyph(props: { mode: BorderMode }) {
  const m = props.mode;
  const on = (x: string) => m === "all" || (m === "outer" && "trbl".includes(x)) || m === x;
  const inner = m === "all" || m === "inner";
  const thin = { stroke: "currentColor", strokeOpacity: 0.3, strokeWidth: 1 };
  const bold = { stroke: "currentColor", strokeWidth: 2 };
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M2 2h14v14H2zM9 2v14M2 9h14" {...thin} />
      {on("t") && <path d="M2 2h14" {...bold} />}
      {on("b") && <path d="M2 16h14" {...bold} />}
      {on("l") && <path d="M2 2v14" {...bold} />}
      {on("r") && <path d="M16 2v14" {...bold} />}
      {inner && <path d="M9 2v14M2 9h14" {...bold} />}
      {m === "none" && <path d="M3 15L15 3" stroke="var(--ed-danger)" strokeWidth="1.5" />}
    </svg>
  );
}

function VAlignGlyph(props: { at: "top" | "middle" | "bottom" }) {
  const y = props.at === "top" ? 4 : props.at === "middle" ? 8 : 12;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <path d={props.at === "top" ? "M2 2h12" : props.at === "bottom" ? "M2 14h12" : "M2 8h0"} strokeOpacity={0.5} />
      <path d={`M5 ${y}h6M5 ${y + 2.5}h6`} />
    </svg>
  );
}
