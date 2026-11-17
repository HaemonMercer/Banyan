import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { Surface } from "./RichBlock";
import {
  addColumn,
  addRow,
  parseTable,
  removeColumn,
  removeRow,
  setCell,
  tableHtml,
  type TableData,
} from "./table";

interface Props {
  /** 表格的 HTML 區塊原始碼 */
  text: string;
  /** 點擊進入編輯時的滑鼠位置（游標放在點到的儲存格） */
  point: { x: number; y: number } | null;
  onChange: (text: string) => void;
  /** Esc：離開編輯並選取表格 */
  onLeave: () => void;
  onBlur: (el: HTMLElement, related: Element | null) => void;
}

/**
 * 表格編輯：每個儲存格是一個純文字的可編輯元素。
 * Tab／Shift+Tab 換儲存格（最後一格再按 Tab 新增一列），Enter 往下一列，Shift+Enter 換行。
 */
export const TableEditor = forwardRef<Surface, Props>(function TableEditor(p, ref) {
  const rootRef = useRef<HTMLDivElement>(null);
  const data = useRef<TableData>(parseTable(p.text) ?? { rows: [[""]], header: false });
  /** 目前畫面代表的原始碼；外部改了（例如復原）才重新讀 */
  const last = useRef(p.text);
  const active = useRef<[number, number]>([0, 0]);
  const [, setVersion] = useState(0);
  const rerender = () => setVersion((v) => v + 1);

  if (p.text !== last.current) {
    const d = parseTable(p.text);
    if (d) data.current = d;
    last.current = p.text;
  }

  const emit = (d: TableData, structural = false) => {
    data.current = d;
    const html = tableHtml(d);
    last.current = html;
    p.onChange(html);
    if (structural) rerender();
  };

  const cellEl = (r: number, c: number) =>
    rootRef.current?.querySelector<HTMLElement>(`[data-cell="${r},${c}"]`) ?? null;

  const focusCell = (r: number, c: number, atEnd = true) => {
    const el = cellEl(r, c);
    if (!el) return;
    active.current = [r, c];
    el.focus({ preventScroll: false });
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(!atEnd);
    const s = document.getSelection();
    s?.removeAllRanges();
    s?.addRange(range);
  };

  // 儲存格內容跟著資料（正在打字的那格不動，游標與輸入法才不會亂）
  useLayoutEffect(() => {
    rootRef.current?.querySelectorAll<HTMLElement>("[data-cell]").forEach((el) => {
      const [r, c] = el.dataset.cell!.split(",").map(Number);
      const v = data.current.rows[r]?.[c] ?? "";
      if (document.activeElement !== el && readCell(el) !== v) el.innerText = v;
    });
  });

  // 剛進入編輯：游標放在點到的儲存格，或第一格
  useLayoutEffect(() => {
    const pt = p.point;
    const hit = pt ? (document.elementFromPoint(pt.x, pt.y) as HTMLElement | null)?.closest<HTMLElement>("[data-cell]") : null;
    if (hit && rootRef.current?.contains(hit)) {
      const [r, c] = hit.dataset.cell!.split(",").map(Number);
      focusCell(r, c);
    } else focusCell(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(
    ref,
    (): Surface => ({
      get el() {
        return rootRef.current!;
      },
      rich: false,
      text: () => last.current,
      sel: () => [0, 0],
      setSel: () => {},
      focus: () => {
        if (!rootRef.current?.contains(document.activeElement)) focusCell(...active.current);
      },
      blur: () => (document.activeElement as HTMLElement | null)?.blur(),
      atStart: () => false,
      atEnd: () => false,
      allSelected: () => false,
      firstLine: () => false,
      lastLine: () => false,
      marks: () => null,
      typingStyle: () => false,
      format: () => null,
      saveSel: () => () => {},
      split: () => null,
    }),
    [],
  );

  const rows = data.current.rows;
  const cols = rows[0]?.length ?? 1;

  const onCellInput = (r: number, c: number, el: HTMLElement) => {
    emit(setCell(data.current, r, c, readCell(el)));
  };

  const onCellKey = (e: KeyboardEvent<HTMLElement>, r: number, c: number) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const last = rows.length - 1;
    if (e.key === "Escape") {
      e.preventDefault();
      p.onLeave();
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) {
        if (c > 0) focusCell(r, c - 1);
        else if (r > 0) focusCell(r - 1, cols - 1);
      } else if (c < cols - 1) focusCell(r, c + 1);
      else if (r < last) focusCell(r + 1, 0);
      else {
        emit(addRow(data.current, rows.length), true);
        requestAnimationFrame(() => focusCell(r + 1, 0));
      }
    } else if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (r < last) focusCell(r + 1, c);
      else {
        emit(addRow(data.current, rows.length), true);
        requestAnimationFrame(() => focusCell(r + 1, c));
      }
    } else if (e.key === "ArrowUp" && r > 0 && !readCell(e.currentTarget).includes("\n")) {
      e.preventDefault();
      focusCell(r - 1, c);
    } else if (e.key === "ArrowDown" && r < last && !readCell(e.currentTarget).includes("\n")) {
      e.preventDefault();
      focusCell(r + 1, c);
    }
  };

  const act = (fn: (d: TableData, r: number, c: number) => TableData, next?: (r: number, c: number) => [number, number]) => {
    const [r, c] = active.current;
    emit(fn(data.current, r, c), true);
    requestAnimationFrame(() => {
      const [nr, nc] = next ? next(r, c) : [r, c];
      const maxR = data.current.rows.length - 1;
      const maxC = (data.current.rows[0]?.length ?? 1) - 1;
      focusCell(Math.min(nr, maxR), Math.min(nc, maxC));
    });
  };

  return (
    <div
      className="table-edit"
      ref={rootRef}
      tabIndex={-1}
      onBlur={(e) => {
        const related = e.relatedTarget as Element | null;
        if (related && rootRef.current?.contains(related)) return; // 在儲存格之間移動
        p.onBlur(rootRef.current!, related);
      }}
    >
      <div className="table-tools" onMouseDown={(e) => e.preventDefault()}>
        <button onClick={() => act((d, r) => addRow(d, r + 1), (r, c) => [r + 1, c])} title="在下方新增一列">
          ＋ 列
        </button>
        <button onClick={() => act((d, _r, c) => addColumn(d, c + 1), (r, c) => [r, c + 1])} title="在右邊新增一欄">
          ＋ 欄
        </button>
        <button onClick={() => act((d, r) => removeRow(d, r))} disabled={rows.length <= 1} title="刪除這一列">
          刪除列
        </button>
        <button onClick={() => act((d, _r, c) => removeColumn(d, c))} disabled={cols <= 1} title="刪除這一欄">
          刪除欄
        </button>
        <button
          className={data.current.header ? "on" : ""}
          onClick={() => act((d) => ({ ...d, header: !d.header }))}
          title="第一列當標題列"
        >
          標題列
        </button>
        <span className="table-hint">
          <kbd>Tab</kbd> 下一格 <kbd>Enter</kbd> 下一列 <kbd>Esc</kbd> 完成
        </span>
      </div>
      <table>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((_, c) => {
                const Cell = data.current.header && r === 0 ? "th" : "td";
                return (
                  <Cell key={c}>
                    <div
                      className="cell"
                      data-cell={`${r},${c}`}
                      contentEditable="plaintext-only"
                      suppressContentEditableWarning
                      spellCheck={false}
                      onFocus={() => (active.current = [r, c])}
                      onInput={(e) => onCellInput(r, c, e.currentTarget)}
                      onKeyDown={(e) => onCellKey(e, r, c)}
                    />
                  </Cell>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

/** 儲存格的文字（瀏覽器在空的可編輯元素最後補的換行不算）。 */
function readCell(el: HTMLElement): string {
  return el.innerText.replace(/\r/g, "").replace(/\n$/, "");
}
