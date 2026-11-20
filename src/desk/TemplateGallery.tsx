import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CloseIcon, TrashIcon } from "../editor/icons";
import { parseWorkbook } from "../sheet/model";
import { splitSlides, type DockKind } from "./file";

/**
 * 範本選擇器（參考 Pages／Keynote／Numbers）：對話框裡一格一格的範本縮圖，點了就用它建立。
 * Dock 新增 Word／簡報／Excel、Desk 首頁新增檔案都用它。←→↑↓ 選、Enter 建立、Esc 關掉。
 */

export interface GalleryItem {
  id: string;
  label: string;
  hint: string;
  preview: ReactNode;
  /** 使用者自己存的範本可以刪掉 */
  onDelete?: () => void;
}

export function TemplateGallery(props: { title: string; items: GalleryItem[]; onPick: (id: string) => void; onClose: () => void; footer?: ReactNode }) {
  const [active, setActive] = useState(0);
  const { items, onPick, onClose } = props;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === "Escape") onClose();
      else if (e.key === "Enter" && items[active]) {
        e.preventDefault();
        onPick(items[active].id);
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(items.length - 1, a + (e.key === "ArrowDown" ? 3 : 1)));
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(0, a - (e.key === "ArrowUp" ? 3 : 1)));
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [items, active, onPick, onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal tpl-gallery" role="dialog" aria-modal="true" aria-label={props.title}>
        <div className="modal-head">
          <span className="modal-title">{props.title}</span>
          <button className="icon-btn" title="Close (Esc)" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="tgal-grid">
          {items.map((it, i) => (
            <div key={it.id} className={`tgal-item${i === active ? " active" : ""}`}>
              <button className="tgal-pick" onMouseEnter={() => setActive(i)} onClick={() => onPick(it.id)} title={it.hint}>
                <span className="tgal-preview">{it.preview}</span>
                <span className="tgal-label">{it.label}</span>
                <span className="tgal-hint">{it.hint}</span>
              </button>
              {it.onDelete && (
                <button className="tgal-del" title="Delete this template" onClick={it.onDelete}>
                  <TrashIcon />
                </button>
              )}
            </div>
          ))}
        </div>
        {props.footer && <div className="tgal-foot">{props.footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ─── 縮圖 ─── */

/** Markdown 的前幾行：標題變粗、清單留著符號，其他是一般文字 */
function lines(md: string, n: number): { text: string; h: number }[] {
  return md
    .split("\n")
    .map((l) => l.replace(/\\$/, "").trim())
    .filter((l) => l && l !== "---")
    .slice(0, n)
    .map((l) => {
      const m = /^(#{1,6})\s+(.*)$/.exec(l);
      return m ? { text: m[2], h: m[1].length } : { text: l.replace(/[*_`]/g, ""), h: 0 };
    });
}

export function DocPreview(props: { kind: DockKind; content: string }) {
  if (props.kind === "slides") {
    const all = splitSlides(props.content);
    const first = lines(all[0] ?? "", 2);
    return (
      <span className="tp-slide">
        <span className="tp-slide-title">{first[0]?.text}</span>
        {first[1] && <span className="tp-slide-sub">{first[1].text}</span>}
        {all.length > 1 && <span className="tp-count">{all.length} slides</span>}
      </span>
    );
  }
  if (props.kind === "sheet") {
    const t = parseWorkbook(props.content).sheets[0]?.tables[0];
    const rows = Math.min(t?.rows ?? 0, 7);
    const cols = Math.min(t?.cols ?? 0, 5);
    return (
      <span className={`tp-sheet theme-${t?.theme ?? "blue"}`}>
        {Array.from({ length: rows }, (_r, r) => (
          <span key={r} className={`tp-row${r < (t?.hr ?? 0) ? " head" : ""}${t && t.fr && r === rows - 1 && rows === t.rows ? " foot" : ""}`}>
            {Array.from({ length: cols }, (_c, c) => {
              const v = t?.cells[`${r},${c}`]?.v ?? "";
              return (
                <span key={c} className="tp-cell">
                  {v.startsWith("=") || v === "FALSE" ? "" : v.replace(/^'/, "")}
                </span>
              );
            })}
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className="tp-paper">
      {lines(props.content, 14).map((l, i) => (
        <span key={i} className={l.h ? `tp-h${Math.min(l.h, 3)}` : "tp-line"}>
          {l.text}
        </span>
      ))}
    </span>
  );
}
