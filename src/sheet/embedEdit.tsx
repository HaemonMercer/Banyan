/**
 * 在 Word、簡報、Note 裡直接編輯嵌入的 Excel 表格（參考 Notion 的 Linked database：改的是本體）。
 *
 * - 點格子：格子上方浮出一個輸入框（portal 到 body），內容是格子的原始文字（公式顯示公式）；
 *   Enter 存並往下一格、Tab／Shift＋Tab 往右／左、Esc 取消、點別處存。存的時候呼叫 App 用
 *   `setSheetWriter` 登記的函式改那份 Excel（`model.ts` 的 `setCell`），活頁簿改了所有嵌入它的地方一起重畫。
 * - 樣式：嵌入標題列的 Style 打開 `TableLookMenu`，只改這個位置的選項（`TableLook`），Excel 不變。
 * Editor 的按下處理認得 `.sheet-table [data-r]` 與 `.xe-style`，交給這裡（不會開始編輯那一行原始碼）。
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { sheetSource } from "../pages/embeds";
import { key, parseWorkbook, setCell, THEMES, type Theme, type Workbook } from "./model";
import { TEXT_SIZES, type TableLook } from "./sheetEmbed";

/** 改一份 Excel 文件（`檔案/標題`）；找不到文件回傳 false */
type Writer = (doc: string, change: (wb: Workbook) => Workbook) => boolean;
let writer: Writer | null = null;

/** App 登記：怎麼改 Desk 檔案裡的 Excel 文件 */
export function setSheetWriter(fn: Writer | null): void {
  writer = fn;
}

/** 在嵌入的 Excel 表格裡改一格（原始文字，`=` 開頭是公式）。 */
export function writeEmbedCell(doc: string, tid: string, r: number, c: number, raw: string): boolean {
  return writer ? writer(doc, (wb) => setCell(wb, tid, r, c, raw)) : false;
}

/** 正在編輯的格子（同時只有一個） */
let current: { finish: (commit: boolean) => void } | null = null;

const cellsOf = (table: Element) => [...table.querySelectorAll<HTMLElement>("[data-r][data-c]")];
const at = (el: HTMLElement) => ({ r: Number(el.dataset.r), c: Number(el.dataset.c) });

/** 點了嵌入表格的一格：在上面打開輸入框 */
export function editEmbedCell(td: HTMLElement): void {
  current?.finish(true);
  const box = td.closest<HTMLElement>(".sheet-embed");
  const table = td.closest("table");
  const doc = box?.dataset.doc;
  const tid = box?.dataset.object;
  if (!box || !table || !doc || !tid) return;
  const json = sheetSource(doc);
  if (json === undefined) return;
  const t = parseWorkbook(json).sheets.flatMap((s) => s.tables).find((x) => x.id === tid);
  if (!t) return;
  const { r, c } = at(td);
  const raw = t.cells[key(r, c)]?.v ?? "";
  // 重畫之後用來找回同一個嵌入：所在的區塊列與它在列裡是第幾個嵌入
  const scope = box.closest<HTMLElement>(".row") ?? box.parentElement ?? document.body;
  const index = [...scope.querySelectorAll(".sheet-embed")].indexOf(box);

  const input = document.createElement("input");
  input.className = "xe-input editor-ui";
  input.value = raw;
  input.spellcheck = false;
  const place = () => {
    const rc = td.getBoundingClientRect();
    const cs = getComputedStyle(td);
    // Word 的紙張會縮放（transform）：字的大小跟著畫面上的大小
    const scale = td.offsetWidth ? rc.width / td.offsetWidth : 1;
    Object.assign(input.style, {
      left: `${rc.left}px`,
      top: `${rc.top}px`,
      width: `${Math.max(rc.width, 60)}px`,
      height: `${rc.height}px`,
      fontSize: `${parseFloat(cs.fontSize) * scale}px`,
      padding: `0 ${7 * scale}px`,
      fontWeight: cs.fontWeight,
      textAlign: cs.textAlign,
    });
  };
  place();
  td.classList.add("xe-editing");
  document.body.append(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (commit: boolean, next?: { r: number; c: number }) => {
    if (done) return;
    done = true;
    current = null;
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onScroll);
    td.classList.remove("xe-editing");
    const value = input.value;
    input.remove();
    if (commit && value !== raw) writeEmbedCell(doc, tid, r, c, value);
    if (!next) return;
    // 存了之後嵌入會重畫：等畫好再到下一格
    setTimeout(() => {
      const again = scope.querySelectorAll(".sheet-embed")[index]?.querySelector("table");
      const cell = again && cellsOf(again).find((x) => at(x).r === next.r && at(x).c === next.c);
      if (cell) editEmbedCell(cell);
    }, 60);
  };
  const onScroll = () => finish(true);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);
  current = { finish: (commit) => finish(commit) };

  input.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      const all = cellsOf(table);
      const i = all.indexOf(td);
      let to: HTMLElement | undefined;
      if (e.key === "Tab") to = all[e.shiftKey ? i - 1 : i + 1];
      else to = all.filter((x) => at(x).c === c && at(x).r > r).sort((a, b) => at(a).r - at(b).r)[0];
      finish(true, to ? at(to) : undefined);
    }
  });
  input.addEventListener("blur", () => finish(true));
}

/* ─── 這個位置的樣子 ─── */

const SWATCH: Record<Theme, string> = { gray: "#7a8088", blue: "#2f7fd8", green: "#2e9e65", orange: "#e08a1e", red: "#d9534f", purple: "#7d5bc9" };
const SIZE_LABEL: Record<"small" | "normal" | "large", string> = { small: "Small", normal: "Normal", large: "Large" };

/**
 * 嵌入表格的 Style 選單：顏色（Excel 的、六種主題、不上色）、交錯列底色、字的大小、撐滿寬度、回到 Excel 的樣子。
 * base 是 Excel 裡表格本來的主題與交錯底色（沒有選項時顯示的樣子）。
 */
export function TableLookMenu(props: {
  look: TableLook;
  base: { theme: string; banded: boolean };
  x: number;
  y: number;
  onChange: (look: TableLook) => void;
  onClose: () => void;
}) {
  const { look, base, onChange, onClose } = props;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [onClose]);
  const banded = look.banded ?? base.banded;
  const left = Math.max(8, Math.min(props.x, window.innerWidth - 248));
  const top = Math.min(props.y, window.innerHeight - 260);
  return createPortal(
    <div ref={ref} className="popover xe-menu editor-ui" style={{ left, top }} onMouseDown={(e) => e.preventDefault()} role="dialog" aria-label="Table style">
      <div className="xe-label">Color</div>
      <div className="xe-swatches">
        <button className={`xe-auto${!look.theme ? " on" : ""}`} title="Same as in Excel" onClick={() => onChange({ ...look, theme: undefined })}>
          Excel
        </button>
        {THEMES.map((t) => (
          <button
            key={t}
            className={`xe-swatch${look.theme === t ? " on" : ""}`}
            style={{ background: SWATCH[t] }}
            title={t[0].toUpperCase() + t.slice(1)}
            aria-label={t}
            onClick={() => onChange({ ...look, theme: t })}
          />
        ))}
        <button className={`xe-swatch plain${look.theme === "plain" ? " on" : ""}`} title="No color" aria-label="No color" onClick={() => onChange({ ...look, theme: "plain" })} />
      </div>
      <label className="xe-check">
        <input type="checkbox" checked={banded} onChange={(e) => onChange({ ...look, banded: e.target.checked === base.banded ? undefined : e.target.checked })} />
        Banded rows
      </label>
      <div className="xe-label">Text size</div>
      <div className="xe-seg">
        {(["small", "normal", "large"] as const).map((s) => (
          <button
            key={s}
            className={(look.size ?? "normal") === s ? "on" : ""}
            onClick={() => onChange({ ...look, size: s === "normal" ? undefined : (s as (typeof TEXT_SIZES)[number]) })}
          >
            {SIZE_LABEL[s]}
          </button>
        ))}
      </div>
      <label className="xe-check">
        <input type="checkbox" checked={!!look.full} onChange={(e) => onChange({ ...look, full: e.target.checked || undefined })} />
        Fit to page width
      </label>
      <div className="popover-sep" />
      <button className="xe-reset" disabled={!look.theme && look.banded === undefined && !look.size && !look.full} onClick={() => onChange({})}>
        Use Excel’s style
      </button>
      <div className="xe-note">Only changes this copy’s look. The data is shared with Excel.</div>
    </div>,
    document.body,
  );
}
