import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { objectEmbed } from "../desk/docLinks";
import { ChartIcon, CloseIcon, SearchIcon, SheetIcon, TableIcon } from "../editor/icons";
import { parseWorkbook } from "./model";
import { renderSheetObject, sheetObjects, type SheetObject } from "./sheetEmbed";
import "../drawer/imagePicker.css";

/** 一份 Excel 文件（Desk 檔案 Dock 裡的 `sheet`） */
export interface SheetBook {
  file: string;
  title: string;
  json: string;
}

/**
 * 插入 Excel 的表格或圖表（參考 Pages／Word 從 Numbers／Excel 插入）：
 * 左邊是所有 Desk 檔案裡的 Excel 文件，中間是選取的活頁簿裡的表格與圖表（照工作表分組），右邊是預覽。
 * 插入的是連結 `![[檔案/標題#^id]]`（參考 Notion 的 Linked database）：Excel 是本體，表格在文件裡可以直接改格子（改的是 Excel），
 * 樣子可以每個位置不一樣（Style）；圖表跟著試算表變。App 畫它（`pickSheetObject`）。
 */
export function SheetPicker(props: { books: SheetBook[]; onDone: (md: string | null) => void }) {
  const { books, onDone } = props;
  const [query, setQuery] = useState("");
  const [book, setBook] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const objects = useMemo(() => books.map((b) => sheetObjects(parseWorkbook(b.json))), [books]);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (s: string) => words.every((w) => s.toLowerCase().includes(w));
  /** 搜尋：活頁簿名稱或裡面的表格、圖表名稱符合的 */
  const shown = books.map((_b, i) => i).filter((i) => !words.length || hit(`${books[i].file} ${books[i].title}`) || objects[i].some((o) => hit(o.name)));
  const cur = shown.includes(book) ? book : (shown[0] ?? -1);
  const list = cur < 0 ? [] : objects[cur].filter((o) => !words.length || hit(`${books[cur].file} ${books[cur].title}`) || hit(o.name));
  const sel = list.find((o) => o.id === picked) ?? list[0] ?? null;

  useEffect(() => searchRef.current?.focus(), []);
  // 預覽：跟文件裡顯示的一樣
  useEffect(() => {
    const box = previewRef.current;
    if (!box) return;
    const r = sel && cur >= 0 ? renderSheetObject(books[cur].json, sel.id) : null;
    box.replaceChildren(...(r ? [r.el] : []));
  }, [sel, cur, books]);

  const insert = (o: SheetObject | null = sel) => {
    if (!o || cur < 0) return;
    const b = books[cur];
    onDone(objectEmbed(b.file, b.title, o.id));
  };

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    if (e.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onDone(null);
    } else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      e.stopPropagation();
      insert();
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);

  const sheetsOf = (os: SheetObject[]) => [...new Set(os.map((o) => o.sheet))];

  return createPortal(
    <div className="modal-backdrop ip-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onDone(null)}>
      <div className="modal ip xp" role="dialog" aria-modal="true" aria-label="Insert from Excel">
        <div className="ip-head">
          <span className="ip-title">
            <SheetIcon /> Insert from Excel
          </span>
          <label className="ip-search">
            <SearchIcon />
            <input ref={searchRef} value={query} placeholder="Search tables and charts" onChange={(e) => setQuery(e.target.value)} />
            {query && (
              <button className="ip-clear" title="Clear search" onClick={() => setQuery("")}>
                <CloseIcon />
              </button>
            )}
          </label>
          <button className="icon-btn ip-close" title="Close (Esc)" onClick={() => onDone(null)}>
            <CloseIcon />
          </button>
        </div>
        {!books.length ? (
          <div className="ip-body">
            <div className="ip-empty">No Excel documents yet. Add one to the Dock of a Desk file, then insert its tables and charts here.</div>
          </div>
        ) : (
          <div className="xp-body">
            <div className="xp-books" role="listbox" aria-label="Excel documents">
              {shown.map((i) => (
                <button key={`${books[i].file}\u0000${books[i].title}\u0000${i}`} className={`xp-book${i === cur ? " on" : ""}`} onClick={() => (setBook(i), setPicked(null))}>
                  <SheetIcon />
                  <span className="xp-book-text">
                    <span className="xp-book-title">{books[i].title}</span>
                    <span className="xp-book-file">{books[i].file}</span>
                  </span>
                </button>
              ))}
              {!shown.length && <div className="xp-none">No matches</div>}
            </div>
            <div className="xp-objects" role="listbox" aria-label="Tables and charts">
              {sheetsOf(list).map((s) => (
                <div key={s} className="xp-group">
                  <div className="xp-sheet">{s}</div>
                  {list
                    .filter((o) => o.sheet === s)
                    .map((o) => (
                      <button
                        key={o.id}
                        role="option"
                        aria-selected={o === sel}
                        className={`xp-object${o === sel ? " on" : ""}`}
                        onClick={() => setPicked(o.id)}
                        onDoubleClick={() => insert(o)}
                      >
                        {o.kind === "table" ? <TableIcon /> : <ChartIcon />}
                        <span>{o.name}</span>
                      </button>
                    ))}
                </div>
              ))}
              {cur >= 0 && !list.length && <div className="xp-none">This document has no tables or charts.</div>}
            </div>
            <div className="xp-preview">
              <div className="xp-preview-box" ref={previewRef} />
            </div>
          </div>
        )}
        <div className="ip-foot">
          <span className="ip-count xp-hint">{sel?.kind === "chart"
              ? "Linked: the chart updates when the spreadsheet changes."
              : "Linked: edit cells right in the document and Excel changes too. The table's look can differ (Style)."}</span>
          <button className="dr-btn" onClick={() => onDone(null)}>
            Cancel
          </button>
          <button className="dr-btn primary" disabled={!sel} onClick={() => insert()}>
            Insert
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
