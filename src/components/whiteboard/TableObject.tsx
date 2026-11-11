import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../icons/Icon";
import {
    COL_HEAD_H,
    MIN_COL_WIDTH,
    ROW_HEAD_W,
    ROW_HEIGHT,
    TABLE_STYLES,
    TABLE_STYLE_COLORS,
    TABLE_STYLE_NAMES,
    autofitWidth,
    cellName,
    colIndex,
    colName,
    copyBlock,
    deleteCols,
    deleteRows,
    displayValue,
    evaluateTable,
    fillBlock,
    insertCol,
    insertRow,
    parseBlock,
    pasteBlock,
    readTable,
    tableSize,
    type TableData,
} from "../../whiteboard/table";
import { rangeText, usedRange } from "../../whiteboard/chart";

interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface Props {
    data: string;
    rect: Rect;
    zoom: number;
    /** The object is selected on the board (formula bar and tools show only then). */
    active: boolean;
    onChange: (t: TableData) => void;
    /** The table grew or shrank: the object's new rectangle (top-left stays). */
    onFit: (rect: Rect) => void;
    /** "board" (default): drawn on the whiteboard; "panel": the side panel, with its bars in the flow. */
    variant?: "board" | "panel";
    /** Make a chart of a range of this table (on the board). */
    onInsertChart?: (range: string) => void;
}

/** A block of selected cells; (ar, ac) is the active cell. */
interface Sel {
    r1: number;
    c1: number;
    r2: number;
    c2: number;
    ar: number;
    ac: number;
}

const one = (r: number, c: number): Sel => ({ r1: r, c1: c, r2: r, c2: c, ar: r, ac: c });
const span = (ar: number, ac: number, r: number, c: number): Sel => ({
    r1: Math.min(ar, r),
    c1: Math.min(ac, c),
    r2: Math.max(ar, r),
    c2: Math.max(ac, c),
    ar,
    ac,
});

type Menu = { x: number; y: number; r: number; c: number };
type Fill = { axis: "row" | "col"; to: number };

/** The sheet's font (also used to measure columns for autofit). */
const CELL_FONT = `13px "Aptos", "Calibri", "Segoe UI", "Microsoft JhengHei UI", "Microsoft JhengHei", sans-serif`;
const UNDO_LIMIT = 100;

/**
 * A table on the board that looks and works like an Excel sheet: column letters and row numbers,
 * gridlines, a name box and formula bar, a green selection border with a fill handle, and
 * Excel's table styles (header row, first column, total row, banded rows, colours).
 *
 * Keys: arrows (Shift extends, Ctrl jumps to the edge) · Enter / Shift+Enter down / up · Tab ·
 * Home, Ctrl+Home, Ctrl+End · F2 or double-click edit · typing replaces · Delete clears ·
 * Backspace clears and edits · Ctrl+C / X / V · Ctrl+D / Ctrl+R fill down / right ·
 * Ctrl+Z / Ctrl+Y undo / redo · Esc deselect.
 */
function TableObject({ data, rect, zoom, active, onChange, onFit, variant = "board", onInsertChart }: Props) {
    const inPanel = variant === "panel";
    const table = useMemo(() => readTable(data), [data]);
    /** The latest table, also right after a change (before the board passes it back). */
    const tableRef = useRef(table);
    tableRef.current = table;
    const values = useMemo(() => evaluateTable(table), [table]);
    const [sel, setSel] = useState<Sel | null>(null);
    /**
     * The cell being edited. `mode` is Excel's: "enter" (started by typing; arrow keys point at
     * cells while a formula is typed) or "edit" (F2, double-click, formula bar; arrows move the caret).
     */
    const [editing, setEditingState] = useState<{ r: number; c: number; draft: string; mode?: "enter" | "edit" } | null>(null);
    /** The edit in progress, readable at once (Enter and the blur that follows must finish it only once). */
    const editingRef = useRef(editing);
    const setEditing = (e: typeof editing) => {
        editingRef.current = e;
        setEditingState(e);
    };
    const [menu, setMenu] = useState<Menu | null>(null);
    /** Column widths while a column edge is being dragged. */
    const [widths, setWidths] = useState<Record<string, number> | null>(null);
    /** Where the fill handle is being dragged to. */
    const [fill, setFill] = useState<Fill | null>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    /**
     * One input sits on the active cell the whole time the table is selected: it takes the keys
     * (so typing goes straight in, input methods included) and becomes the cell editor.
     */
    const keysRef = useRef<HTMLInputElement>(null);
    const barRef = useRef<HTMLInputElement>(null);
    const dragging = useRef(false);
    /**
     * Point mode (typing a formula): the reference last put into the formula by clicking, dragging
     * or arrow keys — where it sits in the text and the cells it names (anchor, far corner).
     */
    const pointRef = useRef<{ start: number; end: number; ar: number; ac: number; r: number; c: number } | null>(null);
    const pointing = useRef(false);
    const undo = useRef<TableData[]>([]);
    const redo = useRef<TableData[]>([]);

    const nR = table.rows.length;
    const nC = table.cols.length;
    const colW = (i: number) => widths?.[table.cols[i].id] ?? table.cols[i].width;

    const cur = () => tableRef.current;
    /** Every change goes through here (and can be undone with Ctrl+Z). */
    const commit = (t: TableData) => {
        undo.current.push(cur());
        if (undo.current.length > UNDO_LIMIT) undo.current.shift();
        redo.current = [];
        tableRef.current = t;
        onChange(t);
    };
    const restore = (from: React.MutableRefObject<TableData[]>, to: React.MutableRefObject<TableData[]>) => {
        const t = from.current.pop();
        if (!t) return;
        to.current.push(cur());
        tableRef.current = t;
        onChange(t);
    };

    // Keep the object fitted to the sheet (its top-left corner stays put).
    const size = tableSize(table);
    const rectRef = useRef(rect);
    rectRef.current = rect;
    useLayoutEffect(() => {
        const r = rectRef.current;
        if (Math.abs(r.width - size.width) + Math.abs(r.height - size.height) > 1) {
            onFit({ x: r.x, y: r.y, width: size.width, height: size.height });
        }
    }, [size.width, size.height]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!active) {
            setSel(null);
            setEditing(null);
            setMenu(null);
        }
    }, [active]);

    // Keep the selection inside the sheet when rows or columns go away.
    useEffect(() => {
        if (sel && (sel.r2 >= nR || sel.c2 >= nC)) setSel(one(Math.min(sel.ar, nR - 1), Math.min(sel.ac, nC - 1)));
    }, [nR, nC]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const up = () => {
            dragging.current = false;
            pointing.current = false;
        };
        window.addEventListener("pointerup", up);
        return () => window.removeEventListener("pointerup", up);
    }, []);

    const focusGrid = () => {
        const go = () => (keysRef.current ?? wrapRef.current)?.focus({ preventScroll: true });
        go();
        requestAnimationFrame(go); // after a first selection, the input appears on the next render
    };

    const rawAt = (r: number, c: number) => table.rows[r]?.cells[table.cols[c]?.id] ?? "";

    const setCell = (r: number, c: number, v: string) => {
        const t = cur();
        const col = t.cols[c];
        if (!col || !t.rows[r] || (t.rows[r].cells[col.id] ?? "") === v) return;
        commit({ ...t, rows: t.rows.map((row, i) => (i === r ? { ...row, cells: { ...row.cells, [col.id]: v } } : row)) });
    };

    const clear = (s: Sel) => {
        const t = cur();
        const ids = t.cols.slice(s.c1, s.c2 + 1).map((c) => c.id);
        if (!t.rows.some((row, r) => r >= s.r1 && r <= s.r2 && ids.some((id) => row.cells[id]))) return;
        commit({
            ...t,
            rows: t.rows.map((row, r) => {
                if (r < s.r1 || r > s.r2) return row;
                const cells = { ...row.cells };
                ids.forEach((id) => delete cells[id]);
                return { ...row, cells };
            }),
        });
    };

    const move = (dr: number, dc: number, extend = false, jump = false) => {
        if (!sel) return;
        const to = (v: number, d: number, max: number) => (jump && d !== 0 ? (d < 0 ? 0 : max) : clamp(v + d, 0, max));
        if (extend) {
            // Move the far corner of the block.
            const fr = sel.ar === sel.r1 ? sel.r2 : sel.r1;
            const fc = sel.ac === sel.c1 ? sel.c2 : sel.c1;
            setSel(span(sel.ar, sel.ac, to(fr, dr, nR - 1), to(fc, dc, nC - 1)));
        } else setSel(one(to(sel.ar, dr, nR - 1), to(sel.ac, dc, nC - 1)));
    };

    /** Enter / Tab inside a selected block move within it, like Excel. */
    const step = (dr: number, dc: number) => {
        if (!sel) return;
        const block = sel.r2 > sel.r1 || sel.c2 > sel.c1;
        if (!block) {
            move(dr, dc);
            return;
        }
        let r = sel.ar + dr;
        let c = sel.ac + dc;
        if (c > sel.c2) [c, r] = [sel.c1, r + 1];
        if (c < sel.c1) [c, r] = [sel.c2, r - 1];
        if (r > sel.r2) [r, c] = [sel.r1, dc ? c : c + 1 > sel.c2 ? sel.c1 : c + 1];
        if (r < sel.r1) [r, c] = [sel.r2, dc ? c : c - 1 < sel.c1 ? sel.c2 : c - 1];
        setSel({ ...sel, ar: r, ac: c });
    };

    const finishEdit = (save: boolean, then?: [number, number]) => {
        const ed = editingRef.current;
        if (!ed) return;
        setEditing(null);
        pointRef.current = null;
        if (save) setCell(ed.r, ed.c, ed.draft);
        if (then) {
            let [r, c] = then;
            // Tab past the last column wraps to the next row; Enter past the last row adds one.
            if (c >= nC) {
                c = 0;
                r += 1;
            }
            if (r >= cur().rows.length) commit(insertRow(cur(), cur().rows.length - cur().footerRows));
            setSel(one(clamp(r, 0, cur().rows.length - 1), clamp(c, 0, nC - 1)));
        }
        focusGrid();
    };

    // ---------- point mode: building a formula by pointing at cells, like Excel ----------

    /** The input the edit is typed in (the cell or the formula bar). */
    const editorEl = () => (document.activeElement === barRef.current ? barRef.current : keysRef.current);

    /** A reference can go at the caret: right after "=", an operator, "(", "," … or the last pointed reference. */
    const canPoint = () => {
        const ed = editingRef.current;
        if (!ed || !ed.draft.startsWith("=")) return false;
        const el = editorEl();
        const caret = el?.selectionStart ?? ed.draft.length;
        const pr = pointRef.current;
        if (pr && caret === pr.end) return true;
        const before = ed.draft.slice(0, caret).trimEnd();
        return /[=+\-*/^&(,:;<>]$/.test(before);
    };

    /** Puts the reference to (ar, ac)–(r, c) into the formula at the caret (or over the last pointed one). */
    const pointAt = (ar: number, ac: number, r: number, c: number) => {
        const ed = editingRef.current;
        if (!ed) return;
        const el = editorEl();
        const r1 = Math.min(ar, r);
        const r2 = Math.max(ar, r);
        const c1 = Math.min(ac, c);
        const c2 = Math.max(ac, c);
        const text = r1 === r2 && c1 === c2 ? cellName(r1, c1) : `${cellName(r1, c1)}:${cellName(r2, c2)}`;
        const caret = el?.selectionStart ?? ed.draft.length;
        const pr = pointRef.current;
        const [start, end] = pr && caret === pr.end ? [pr.start, pr.end] : [caret, caret];
        const draft = ed.draft.slice(0, start) + text + ed.draft.slice(end);
        pointRef.current = { start, end: start + text.length, ar, ac, r, c };
        setEditing({ ...ed, draft });
        const at = start + text.length;
        requestAnimationFrame(() => {
            el?.focus({ preventScroll: true });
            el?.setSelectionRange(at, at);
        });
    };

    /** Keys while editing (the cell or the formula bar). */
    const editKeys = (e: React.KeyboardEvent) => {
        e.stopPropagation();
        const ed = editingRef.current;
        if (!ed || e.nativeEvent.isComposing) return;
        const arrow = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
        if (arrow && ed.mode !== "edit" && canPoint()) {
            // Enter mode: the arrows walk a reference around the sheet (Shift stretches it to a range).
            e.preventDefault();
            const pr = pointRef.current;
            const from = pr ?? { ar: ed.r, ac: ed.c, r: ed.r, c: ed.c };
            const r = clamp(from.r + arrow[0], 0, nR - 1);
            const c = clamp(from.c + arrow[1], 0, nC - 1);
            if (e.shiftKey && pr) pointAt(pr.ar, pr.ac, r, c);
            else pointAt(r, c, r, c);
            return;
        }
        if (e.key === "Enter") {
            e.preventDefault();
            finishEdit(true, [ed.r + (e.shiftKey ? -1 : 1), ed.c]);
        } else if (e.key === "Tab") {
            e.preventDefault();
            finishEdit(true, [ed.r, ed.c + (e.shiftKey ? -1 : 1)]);
        } else if (e.key === "Escape") {
            e.preventDefault();
            finishEdit(false);
        }
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (!sel) return;
        // Keys never reach the board while the table has them (Delete must not remove the table).
        e.stopPropagation();
        if (editingRef.current) {
            editKeys(e);
            return;
        }
        let handled = true;
        const ctrl = e.ctrlKey || e.metaKey;
        const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        if (k === "ArrowUp") move(-1, 0, e.shiftKey, ctrl);
        else if (k === "ArrowDown") move(1, 0, e.shiftKey, ctrl);
        else if (k === "ArrowLeft") move(0, -1, e.shiftKey, ctrl);
        else if (k === "ArrowRight") move(0, 1, e.shiftKey, ctrl);
        else if (k === "Enter") step(e.shiftKey ? -1 : 1, 0);
        else if (k === "Tab") step(0, e.shiftKey ? -1 : 1);
        else if (k === "Home") setSel(one(ctrl ? 0 : sel.ar, 0));
        else if (k === "End" && ctrl) setSel(one(nR - 1, nC - 1));
        else if (k === "F2") setEditing({ r: sel.ar, c: sel.ac, draft: rawAt(sel.ar, sel.ac), mode: "edit" });
        else if (k === "Delete") clear(sel);
        else if (k === "Backspace") {
            clear(one(sel.ar, sel.ac));
            setEditing({ r: sel.ar, c: sel.ac, draft: "", mode: "enter" });
        } else if (k === "Escape") {
            setSel(null);
            setMenu(null);
        } else if (ctrl && k === "a") setSel({ r1: 0, c1: 0, r2: nR - 1, c2: nC - 1, ar: sel.ar, ac: sel.ac });
        else if (ctrl && k === "z" && !e.shiftKey) restore(undo, redo);
        else if (ctrl && (k === "y" || (k === "z" && e.shiftKey))) restore(redo, undo);
        else if (ctrl && k === "d" && sel.r2 > sel.r1) commit(fillBlock(cur(), sel.r1, sel.c1, sel.r1, sel.c2, "row", sel.r2));
        else if (ctrl && k === "r" && sel.c2 > sel.c1) commit(fillBlock(cur(), sel.r1, sel.c1, sel.r2, sel.c1, "col", sel.c2));
        // Anything else (typing, Ctrl+C / V / X) goes on into the input: typing starts an edit.
        else handled = false;
        if (handled) e.preventDefault();
    };

    const onCopy = (e: React.ClipboardEvent, cut = false) => {
        if (editing || !sel) return;
        e.preventDefault();
        e.stopPropagation();
        e.clipboardData.setData("text/plain", copyBlock(table, values, sel.r1, sel.c1, sel.r2, sel.c2, true));
        if (cut) clear(sel);
    };

    const onPaste = (e: React.ClipboardEvent) => {
        if (editing || !sel) return;
        const text = e.clipboardData.getData("text/plain");
        e.preventDefault();
        e.stopPropagation();
        if (!text) return;
        const block = parseBlock(text);
        // One value pasted onto a block fills the block.
        if (block.length === 1 && block[0].length === 1 && (sel.r2 > sel.r1 || sel.c2 > sel.c1)) {
            const all = Array.from({ length: sel.r2 - sel.r1 + 1 }, () => Array(sel.c2 - sel.c1 + 1).fill(block[0][0]));
            commit(pasteBlock(cur(), sel.r1, sel.c1, all));
            return;
        }
        commit(pasteBlock(cur(), sel.r1, sel.c1, block));
        setSel(span(sel.r1, sel.c1, sel.r1 + block.length - 1, sel.c1 + Math.max(...block.map((l) => l.length)) - 1));
    };

    // ---------- rows and columns ----------

    const wholeCol = (i: number): Sel => ({ r1: 0, c1: i, r2: nR - 1, c2: i, ar: 0, ac: i });
    const wholeRow = (r: number): Sel => ({ r1: r, c1: 0, r2: r, c2: nC - 1, ar: r, ac: 0 });
    const act = (fn: () => void) => () => {
        fn();
        setMenu(null);
        focusGrid();
    };
    const menuItems = (m: Menu) => {
        const s = sel ?? one(m.r, m.c);
        const nRows = s.r2 - s.r1 + 1;
        const nCols = s.c2 - s.c1 + 1;
        const t = cur();
        const setAlign = (align: "left" | "center" | "right") =>
            commit({ ...t, cols: t.cols.map((col, i) => (i >= s.c1 && i <= s.c2 ? { ...col, align } : col)) });
        return [
            { label: "在上方插入列", run: () => commit(insertRow(t, s.r1)) },
            { label: "在下方插入列", run: () => commit(insertRow(t, s.r2 + 1)) },
            { label: nRows > 1 ? `刪除 ${nRows} 列` : "刪除列", run: () => commit(deleteRows(t, s.r1, s.r2)), danger: true, disabled: nRows >= nR },
            null,
            { label: "在左側插入欄", run: () => commit(insertCol(t, s.c1)) },
            { label: "在右側插入欄", run: () => commit(insertCol(t, s.c2 + 1)) },
            { label: nCols > 1 ? `刪除 ${nCols} 欄` : "刪除欄", run: () => commit(deleteCols(t, s.c1, s.c2)), danger: true, disabled: nCols >= nC },
            { label: "自動調整欄寬", run: () => autofit(s.c1, s.c2) },
            null,
            { label: "靠左對齊", run: () => setAlign("left") },
            { label: "置中對齊", run: () => setAlign("center") },
            { label: "靠右對齊", run: () => setAlign("right") },
            null,
            { label: "向下填滿（Ctrl＋D）", run: () => commit(fillBlock(t, s.r1, s.c1, s.r1, s.c2, "row", s.r2)), disabled: nRows < 2 },
            { label: "向右填滿（Ctrl＋R）", run: () => commit(fillBlock(t, s.r1, s.c1, s.r2, s.c1, "col", s.c2)), disabled: nCols < 2 },
            { label: "清除內容", run: () => clear(s) },
            ...(onInsertChart ? [null, { label: "插入圖表", run: () => insertChart(s) }] : []),
        ];
    };

    /** `whole`: the row or column whose header was clicked (selected unless already inside the selection). */
    const openMenu = (e: React.MouseEvent, r: number, c: number, whole?: Sel) => {
        e.preventDefault();
        e.stopPropagation();
        const box = wrapRef.current!.getBoundingClientRect();
        const inside = sel && r >= sel.r1 && r <= sel.r2 && c >= sel.c1 && c <= sel.c2 && (!whole || (whole.r1 >= sel.r1 && whole.r2 <= sel.r2 && whole.c1 >= sel.c1 && whole.c2 <= sel.c2));
        if (!inside) setSel(whole ?? one(r, c));
        setMenu({ x: (e.clientX - box.left) / zoom, y: (e.clientY - box.top) / zoom, r, c });
    };

    /** A chart of the selected block; a single cell charts everything that is filled in. */
    const insertChart = (s: Sel | null) => {
        if (!onInsertChart) return;
        const block = s && (s.r2 > s.r1 || s.c2 > s.c1);
        onInsertChart(block ? rangeText(s!.r1, s!.c1, s!.r2, s!.c2) : usedRange(cur()));
    };

    const autofit = (c1: number, c2: number) => {
        const t = cur();
        const v = evaluateTable(t);
        commit({ ...t, cols: t.cols.map((col, i) => (i >= c1 && i <= c2 ? { ...col, width: autofitWidth(t, v, i, CELL_FONT) } : col)) });
    };

    const startResize = (e: React.PointerEvent, i: number) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const el = e.currentTarget as HTMLElement;
        el.setPointerCapture(e.pointerId);
        const start = e.clientX;
        const id = table.cols[i].id;
        const w0 = table.cols[i].width;
        let last = w0;
        const mv = (ev: PointerEvent) => {
            last = Math.max(MIN_COL_WIDTH, Math.round(w0 + (ev.clientX - start) / zoom));
            setWidths({ [id]: last });
        };
        const up = () => {
            el.removeEventListener("pointermove", mv);
            el.removeEventListener("pointerup", up);
            setWidths(null);
            const t = cur();
            if (last !== w0) commit({ ...t, cols: t.cols.map((c) => (c.id === id ? { ...c, width: last } : c)) });
        };
        el.addEventListener("pointermove", mv);
        el.addEventListener("pointerup", up);
    };

    /** The fill handle (the small square at the selection's corner): drag down or right to fill. */
    const startFill = (e: React.PointerEvent) => {
        if (e.button !== 0 || !sel) return;
        e.preventDefault();
        e.stopPropagation();
        const el = e.currentTarget as HTMLElement;
        el.setPointerCapture(e.pointerId);
        const s = sel;
        let target: Fill | null = null;
        const mv = (ev: PointerEvent) => {
            const td = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("td[data-r]");
            if (!td || !wrapRef.current?.contains(td)) return;
            const r = Number(td.dataset.r);
            const c = Number(td.dataset.c);
            const down = r - s.r2;
            const right = c - s.c2;
            target = down > 0 && down >= right ? { axis: "row", to: r } : right > 0 ? { axis: "col", to: c } : null;
            setFill(target);
        };
        const up = () => {
            el.removeEventListener("pointermove", mv);
            el.removeEventListener("pointerup", up);
            setFill(null);
            if (!target) return;
            commit(fillBlock(cur(), s.r1, s.c1, s.r2, s.c2, target.axis, target.to));
            setSel(target.axis === "row" ? { ...s, r2: target.to } : { ...s, c2: target.to });
            focusGrid();
        };
        el.addEventListener("pointermove", mv);
        el.addEventListener("pointerup", up);
    };

    const toggle = (key: "headerRows" | "headerCols" | "footerRows") => {
        const t = cur();
        const on = t[key] > 0;
        let next: TableData = { ...t, [key]: on ? 0 : 1 };
        // A total row needs a row of its own below the body.
        if (key === "footerRows" && !on && t.rows.length - t.headerRows < 2) next = { ...insertRow(t, t.rows.length), footerRows: 1 };
        commit(next);
        focusGrid();
    };

    const isHeaderRow = (r: number) => r < table.headerRows;
    const isFooterRow = (r: number) => r >= nR - table.footerRows && !isHeaderRow(r);
    const activeRaw = sel ? rawAt(sel.ar, sel.ac) : "";

    let x = 0;
    const colX = table.cols.map((_, i) => {
        const v = x;
        x += colW(i);
        return v;
    });
    const gridW = x;
    /** Sheet coordinates of a column's left edge / a row's top edge. */
    const gx = (c: number) => ROW_HEAD_W + (c >= nC ? gridW : colX[c]);
    const gy = (r: number) => COL_HEAD_H + r * ROW_HEIGHT;
    const colsFull = sel && sel.r1 === 0 && sel.r2 === nR - 1;
    const rowsFull = sel && sel.c1 === 0 && sel.c2 === nC - 1;
    const accent = TABLE_STYLE_COLORS[table.style];
    /** While a formula is being typed, the cells it refers to get coloured boxes (like Excel). */
    const refBoxes = editing?.draft.startsWith("=") ? formulaRefs(editing.draft) : [];

    const formulaBar = (
        <div
                    className="xl-formula-bar"
                    style={{ width: Math.max(ROW_HEAD_W + gridW, 340) }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                >
                    <span className="xl-namebox">
                        {sel ? cellName(sel.ar, sel.ac) : ""}
                    </span>
                    <span className="xl-fx">fx</span>
                    <input
                        ref={barRef}
                        className="xl-formula"
                        value={editing ? editing.draft : activeRaw}
                        disabled={!sel}
                        aria-label="公式列"
                        onFocus={() => {
                            if (sel && !editingRef.current) setEditing({ r: sel.ar, c: sel.ac, draft: activeRaw, mode: "edit" });
                        }}
                        onChange={(e) => {
                            if (!sel) return;
                            pointRef.current = null;
                            setEditing({ r: editingRef.current?.r ?? sel.ar, c: editingRef.current?.c ?? sel.ac, draft: e.target.value, mode: editingRef.current?.mode ?? "edit" });
                        }}
                        onKeyDown={editKeys}
                        onBlur={(e) => {
                            if (e.relatedTarget !== keysRef.current) finishEdit(true);
                        }}
                    />
                </div>
    );
    const designBar = (
        <div className="wb-tbl-bar" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                        <label className="xl-check">
                            <input type="checkbox" checked={table.headerRows > 0} onChange={() => toggle("headerRows")} /> 標題列
                        </label>
                        <label className="xl-check">
                            <input type="checkbox" checked={table.footerRows > 0} onChange={() => toggle("footerRows")} /> 合計列
                        </label>
                        <label className="xl-check">
                            <input type="checkbox" checked={table.banded} onChange={() => { commit({ ...cur(), banded: !cur().banded }); focusGrid(); }} /> 帶狀列
                        </label>
                        <label className="xl-check">
                            <input type="checkbox" checked={table.headerCols > 0} onChange={() => toggle("headerCols")} /> 首欄
                        </label>
                        {onInsertChart && (
                            <>
                                <span className="wb-tbl-sep" />
                                <button className="xl-chart-btn" title="用選取的範圍（或整個表格）插入圖表" onClick={() => insertChart(sel)}>
                                    <Icon name="chart" /> 插入圖表
                                </button>
                            </>
                        )}
                        <span className="wb-tbl-sep" />
                        {TABLE_STYLES.map((s) => (
                            <button
                                key={s}
                                className={`xl-style${table.style === s ? " on" : ""}`}
                                style={{ ["--tbl-accent" as string]: TABLE_STYLE_COLORS[s] }}
                                title={`表格樣式：${TABLE_STYLE_NAMES[s]}`}
                                onClick={() => {
                                    commit({ ...cur(), style: s });
                                    focusGrid();
                                }}
                            >
                                <span />
                                <span />
                                <span />
                            </button>
                        ))}
                    </div>
    );

    const sheet = (
        <div
            ref={wrapRef}
            className={`wb-table xl${active ? " active" : ""}${inPanel ? " in-panel" : ""}`}
            style={{ ["--tbl-accent" as string]: accent, width: ROW_HEAD_W + gridW, height: COL_HEAD_H + nR * ROW_HEIGHT }}
            tabIndex={-1}
            data-role="tbl"
            onCopy={(e) => onCopy(e)}
            onCut={(e) => onCopy(e, true)}
            onPaste={onPaste}
            onPointerDown={() => setMenu(null)}
        >
            {active && !inPanel && formulaBar}

            {/* Corner (select all), column letters, row numbers. */}
            <div
                className={`xl-corner${sel && colsFull && rowsFull ? " full" : ""}`}
                title="全選"
                data-role="tbl-head"
                onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    setSel({ r1: 0, c1: 0, r2: nR - 1, c2: nC - 1, ar: 0, ac: 0 });
                    focusGrid();
                }}
            />
            {table.cols.map((col, i) => {
                const hl = sel && i >= sel.c1 && i <= sel.c2;
                return (
                    <div
                        key={col.id}
                        className={`xl-colhead${hl ? " hl" : ""}${hl && colsFull ? " full" : ""}`}
                        style={{ left: gx(i), width: colW(i) }}
                        data-role="tbl-head"
                        onPointerDown={(e) => {
                            if (e.button !== 0) return;
                            e.stopPropagation();
                            setSel(e.shiftKey && sel ? { r1: 0, c1: Math.min(sel.c1, i), r2: nR - 1, c2: Math.max(sel.c2, i), ar: 0, ac: Math.min(sel.c1, i) } : wholeCol(i));
                            focusGrid();
                        }}
                        onContextMenu={(e) => openMenu(e, 0, i, wholeCol(i))}
                    >
                        {colName(i)}
                        <span
                            className="xl-col-resize"
                            title="拖曳調整欄寬；雙擊自動調整"
                            onPointerDown={(e) => startResize(e, i)}
                            onDoubleClick={(e) => {
                                e.stopPropagation();
                                autofit(i, i);
                            }}
                        />
                    </div>
                );
            })}
            {table.rows.map((row, r) => {
                const hl = sel && r >= sel.r1 && r <= sel.r2;
                return (
                    <div
                        key={row.id}
                        className={`xl-rowhead${hl ? " hl" : ""}${hl && rowsFull ? " full" : ""}`}
                        style={{ top: gy(r), height: ROW_HEIGHT }}
                        data-role="tbl-head"
                        onPointerDown={(e) => {
                            if (e.button !== 0) return;
                            e.stopPropagation();
                            setSel(e.shiftKey && sel ? { r1: Math.min(sel.r1, r), c1: 0, r2: Math.max(sel.r2, r), c2: nC - 1, ar: Math.min(sel.r1, r), ac: 0 } : wholeRow(r));
                            focusGrid();
                        }}
                        onContextMenu={(e) => openMenu(e, r, 0, wholeRow(r))}
                    >
                        {r + 1}
                    </div>
                );
            })}

            <table className="wb-tbl" style={{ width: gridW, left: ROW_HEAD_W, top: COL_HEAD_H }}>
                <colgroup>
                    {table.cols.map((col, i) => (
                        <col key={col.id} style={{ width: colW(i) }} />
                    ))}
                </colgroup>
                <tbody>
                    {table.rows.map((row, r) => (
                        <tr key={row.id} style={{ height: ROW_HEIGHT }}>
                            {table.cols.map((col, c) => {
                                const raw = row.cells[col.id] ?? "";
                                const v = values[r][c];
                                const inSel = sel && r >= sel.r1 && r <= sel.r2 && c >= sel.c1 && c <= sel.c2;
                                const isActive = sel && sel.ar === r && sel.ac === c;
                                const head = isHeaderRow(r) || c < table.headerCols;
                                const cls = [
                                    "wb-td",
                                    isHeaderRow(r) ? "hrow" : "",
                                    c < table.headerCols && !isHeaderRow(r) ? "hcol" : "",
                                    isFooterRow(r) ? "frow" : "",
                                    table.banded && !isHeaderRow(r) && !isFooterRow(r) && (r - table.headerRows) % 2 === 0 ? "band" : "",
                                    inSel && !isActive ? "in-sel" : "",
                                    v.kind === "error" ? "err" : "",
                                    `align-${col.align ?? (v.kind === "number" && !head ? "right" : "left")}`,
                                ]
                                    .filter(Boolean)
                                    .join(" ");
                                const isEditing = editing?.r === r && editing.c === c;
                                return (
                                    <td
                                        key={col.id}
                                        className={cls}
                                        data-role="tbl-cell"
                                        data-r={r}
                                        data-c={c}
                                        title={raw.startsWith("=") ? `${cellName(r, c)}：${raw}` : undefined}
                                        onPointerDown={(e) => {
                                            if (e.button !== 0 || isEditing) return;
                                            e.preventDefault(); // keep the focus in the table's input
                                            if (editing && canPoint()) {
                                                // Typing a formula: the click puts this cell into it (drag for a range).
                                                pointing.current = true;
                                                const pr = pointRef.current;
                                                if (e.shiftKey && pr) pointAt(pr.ar, pr.ac, r, c);
                                                else pointAt(r, c, r, c);
                                                return;
                                            }
                                            if (editing) finishEdit(true);
                                            dragging.current = true;
                                            setSel(e.shiftKey && sel ? span(sel.ar, sel.ac, r, c) : one(r, c));
                                            focusGrid();
                                        }}
                                        onPointerEnter={() => {
                                            if (pointing.current && pointRef.current) pointAt(pointRef.current.ar, pointRef.current.ac, r, c);
                                            else if (dragging.current && sel) setSel(span(sel.ar, sel.ac, r, c));
                                        }}
                                        onDoubleClick={(e) => {
                                            e.stopPropagation();
                                            setSel(one(r, c));
                                            setEditing({ r, c, draft: raw, mode: "edit" });
                                        }}
                                        onContextMenu={(e) => active && openMenu(e, r, c)}
                                    >
                                        <span className="wb-td-text">{isEditing ? "" : displayValue(raw, v)}</span>
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>

            {refBoxes.map((b, i) =>
                b.r1 < nR && b.c1 < nC ? (
                    <div
                        key={i}
                        className="xl-refbox"
                        style={{
                            ["--ref" as string]: REF_COLORS[b.color % REF_COLORS.length],
                            left: gx(b.c1) - 1,
                            top: gy(b.r1) - 1,
                            width: gx(Math.min(b.c2, nC - 1) + 1) - gx(b.c1) + 1,
                            height: (Math.min(b.r2, nR - 1) - b.r1 + 1) * ROW_HEIGHT + 1,
                        }}
                    />
                ) : null,
            )}

            {/* Selection: Excel's border around the block, with the fill handle at its corner. */}
            {sel && !(editing && refBoxes.length) && (
                <div
                    className="xl-range"
                    style={{
                        left: gx(sel.c1) - 1,
                        top: gy(sel.r1) - 1,
                        width: gx(sel.c2 + 1) - gx(sel.c1) + 1,
                        height: (sel.r2 - sel.r1 + 1) * ROW_HEIGHT + 1,
                    }}
                >
                    {active && !editing && <div className="xl-fill" title="拖曳以填滿" onPointerDown={startFill} />}
                </div>
            )}
            {sel && fill && (
                <div
                    className="xl-fill-preview"
                    style={
                        fill.axis === "row"
                            ? { left: gx(sel.c1) - 1, top: gy(sel.r1) - 1, width: gx(sel.c2 + 1) - gx(sel.c1) + 1, height: (fill.to - sel.r1 + 1) * ROW_HEIGHT + 1 }
                            : { left: gx(sel.c1) - 1, top: gy(sel.r1) - 1, width: gx(fill.to + 1) - gx(sel.c1) + 1, height: (sel.r2 - sel.r1 + 1) * ROW_HEIGHT + 1 }
                    }
                />
            )}

            {active && sel && (() => {
                const at = editing ?? { r: sel.ar, c: sel.ac };
                const col = table.cols[at.c];
                if (!col) return null;
                const v = values[at.r]?.[at.c];
                const head = isHeaderRow(at.r) || at.c < table.headerCols || isFooterRow(at.r);
                return (
                    <input
                        ref={keysRef}
                        className={`wb-tbl-input${editing ? " editing" : ""}${head ? " head" : ""}`}
                        style={{
                            left: gx(at.c),
                            top: gy(at.r),
                            width: colW(at.c),
                            height: ROW_HEIGHT,
                            textAlign: col.align ?? (v?.kind === "number" && !head ? "right" : "left"),
                        }}
                        value={editing?.draft ?? ""}
                        aria-label={`儲存格 ${cellName(at.r, at.c)}`}
                        onChange={(e) => {
                            const cell = editingRef.current ?? { r: sel.ar, c: sel.ac, mode: "enter" as const };
                            pointRef.current = null;
                            setEditing({ r: cell.r, c: cell.c, draft: e.target.value, mode: cell.mode ?? "enter" });
                        }}
                        onKeyDown={onKeyDown}
                        onBlur={(e) => {
                            if (e.relatedTarget !== barRef.current) finishEdit(true);
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                    />
                );
            })()}

            {active && (
                <>
                    <button
                        className="wb-tbl-add col"
                        style={{ top: COL_HEAD_H }}
                        title="新增一欄"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => commit(insertCol(cur(), cur().cols.length))}
                    >
                        <Icon name="plus" />
                    </button>
                    <button
                        className="wb-tbl-add row"
                        style={{ left: ROW_HEAD_W }}
                        title="新增一列"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => commit(insertRow(cur(), cur().rows.length - cur().footerRows))}
                    >
                        <Icon name="plus" />
                    </button>

                    {!inPanel && designBar}
                </>
            )}

            {menu && (
                <div
                    className="wb-tbl-menu"
                    style={{ left: menu.x, top: menu.y, transform: `scale(${1 / zoom})` }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onContextMenu={(e) => e.preventDefault()}
                >
                    {menuItems(menu).map((it, i) =>
                        it ? (
                            <button key={i} className={`wb-tbl-menu-item${it.danger ? " danger" : ""}`} disabled={it.disabled} onClick={act(it.run)}>
                                {it.label}
                            </button>
                        ) : (
                            <div key={i} className="wb-tbl-menu-sep" />
                        ),
                    )}
                </div>
            )}
        </div>
    );

    if (!inPanel) return sheet;
    // Side panel: formula bar on top, the sheet scrolling under it, the design options below.
    return (
        <div className="xl-panel">
            {formulaBar}
            <div className="xl-scroll">{sheet}</div>
            {designBar}
        </div>
    );
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Excel's colours for the references of a formula being edited. */
const REF_COLORS = ["#4472c4", "#c0504d", "#8064a2", "#4bacc6", "#f79646", "#9bbb59", "#2c4d75"];

/** The cells and ranges a formula refers to (string literals skipped); the same reference keeps one colour. */
function formulaRefs(src: string): { r1: number; c1: number; r2: number; c2: number; color: number }[] {
    const out: { r1: number; c1: number; r2: number; c2: number; color: number }[] = [];
    const colors = new Map<string, number>();
    const re = /("(?:[^"]|"")*")|\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?(?![A-Za-z_(\d])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
        if (m[1]) continue;
        if (m.index > 0 && /[A-Za-z_]/.test(src[m.index - 1])) continue;
        const a = { r: Number(m[3]) - 1, c: colIndex(m[2]) };
        const b = m[4] ? { r: Number(m[5]) - 1, c: colIndex(m[4]) } : a;
        const key = m[0].replace(/\$/g, "").toUpperCase();
        if (!colors.has(key)) colors.set(key, colors.size);
        out.push({ r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c), color: colors.get(key)! });
    }
    return out;
}

export default TableObject;
