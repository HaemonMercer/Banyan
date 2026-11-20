import { useLayoutEffect, useRef, useState } from "react";
import { Editor } from "../editor/Editor";
import { DEFAULT_PAGE, marginOf, pageStyle, paperColorOf, paperIsDark, paperOf, type PageSetup } from "./pageSetup";

/**
 * Word 的所見即所得編輯：直接在 A4 紙上寫，邊寫邊分頁（參考 Word 的整頁模式）。
 *
 * 編輯器是一整條連續的欄，疊在一張張紙的上面；每頁的版心之間有一段「死區」
 * （下邊界＋頁間空隙＋下一頁上邊界）。`paginate` 依序量每個頂層區塊，碰到跨頁或
 * 落在死區的區塊，就加上 margin-top 把它推到下一頁開頭（比一頁還高的區塊照樣跨頁）。
 * 只改區塊的 style，不動 Markdown，也不重畫編輯器（打字時游標與輸入法不受影響）。
 */

/** 預設 A4 在 96 dpi：794 × 1123 px（紙張大小、方向照版面設定 `paperOf`）；邊界照版面設定（預設四邊 1 吋＝96 px） */
export const PAGE_W = 794;
export const PAGE_H = 1123;
/** 頁與頁之間的空隙 */
export const GAP = 24;
/** 一頁加空隙的高度（A4） */
export const STEP = PAGE_H + GAP;

/** 推下去的距離（區塊 → px）與原本的 margin-top */
const pushed = new WeakMap<HTMLElement, { push: number; base: number }>();

/**
 * 依序檢查編輯器的頂層區塊，需要的就推到下一頁；回傳頁數。
 * 編輯器的座標：第 k 頁的版心是 [k·STEP, k·STEP + BODY)；BODY 是頁高減掉上下邊界。
 */
export function paginate(root: HTMLElement, margin = 96, pageH = PAGE_H): number {
  const STEP = pageH + GAP;
  const BODY = pageH - margin * 2;
  let bottom = 0;
  let tail: HTMLElement | null = null;
  // 前一個區塊是分頁符號：這一個從下一頁開始
  let breakNext = false;
  for (const c of [...root.children] as HTMLElement[]) {
    if (c.classList.contains("tail")) {
      tail = c;
      continue;
    }
    const was = pushed.get(c);
    const cur = was?.push ?? 0;
    const h = c.offsetHeight;
    // 不推的話它在哪裡（前面的區塊都已經處理好）
    const top = c.offsetTop - cur;
    const k = Math.floor(top / STEP);
    const end = k * STEP + BODY;
    let want = 0;
    if (top >= end) want = (k + 1) * STEP - top;
    else if (top + h > end && h <= BODY && top > k * STEP + 1) want = (k + 1) * STEP - top;
    else if (breakNext && top > k * STEP + 1) want = (k + 1) * STEP - top;
    breakNext = !!c.querySelector(".page-break");
    if (want !== cur) {
      const base = was?.base ?? (parseFloat(getComputedStyle(c).marginTop) || 0);
      c.style.marginTop = want ? `${base + want}px` : "";
      pushed.set(c, { push: want, base });
    }
    bottom = Math.max(bottom, top + want + h);
  }
  const pages = Math.max(1, Math.floor(Math.max(0, bottom - 1) / STEP) + 1);
  // 文件下方的空白（點了在最後新增區塊）延伸到最後一頁的版心底部
  if (tail) {
    const room = (pages - 1) * STEP + BODY - tail.offsetTop;
    const h = `${Math.max(28, Math.round(room))}px`;
    if (tail.style.minHeight !== h) tail.style.minHeight = h;
  }
  return pages;
}

export function PaperEditor(props: {
  value: string;
  onChange: (md: string) => void;
  setup?: PageSetup;
  /** 縮放（1 是 100%）：整疊紙用 transform 縮放，不影響分頁的量法 */
  zoom?: number;
  onPages?: (n: number) => void;
  /** 浮動格式列（有功能區時關掉） */
  formatBar?: boolean;
  spellCheck?: boolean;
}) {
  const flow = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState(1);
  const setup = props.setup ?? DEFAULT_PAGE;
  const m = marginOf(setup);
  const zoom = props.zoom ?? 1;
  const paper = paperOf(setup);
  const STEP = paper.h + GAP;
  const tb = useRef({ margin: m.tb, h: paper.h });
  tb.current = { margin: m.tb, h: paper.h };
  const onPages = useRef(props.onPages);
  onPages.current = props.onPages;

  useLayoutEffect(() => {
    const host = flow.current;
    if (!host) return;
    let raf = 0;
    let ro: ResizeObserver | null = null;
    let watched: Element | null = null;
    const run = () => {
      raf = 0;
      const root = host.querySelector<HTMLElement>(".md-editor");
      if (!root) return;
      if (root !== watched) {
        ro?.disconnect();
        ro = new ResizeObserver(schedule);
        ro.observe(root);
        watched = root;
      }
      const n = paginate(root, tb.current.margin, tb.current.h);
      setPages(n);
      onPages.current?.(n);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(run);
    };
    run();
    // 版面設定改了（邊界、字級）重新分頁
    const again = () => schedule();
    host.addEventListener("repaginate", again);
    // 打字、換區塊（只看內容，不看 style，免得自己改的 margin 又觸發）
    const mo = new MutationObserver(schedule);
    mo.observe(host, { childList: true, subtree: true, characterData: true });
    // 圖片載入後高度會變
    host.addEventListener("load", schedule, true);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      mo.disconnect();
      ro?.disconnect();
      host.removeEventListener("load", schedule, true);
      host.removeEventListener("repaginate", again);
    };
  }, []);
  // 邊界、字型、字級、行距改了：重新量
  useLayoutEffect(() => {
    flow.current?.dispatchEvent(new Event("repaginate"));
  }, [m.tb, m.lr, setup.font, setup.size, setup.spacing, paper.w, paper.h]);

  return (
    <div className="paper-host">
      <div className="paper-zoom" style={{ width: paper.w * zoom, height: (pages * STEP - GAP) * zoom }}>
        <div className={`paper-sheets${paperIsDark(setup.color) ? " paper-dark" : ""}`} style={{ width: paper.w, height: pages * STEP - GAP, transform: zoom === 1 ? undefined : `scale(${zoom})`, ["--paper-bg" as string]: paperColorOf(setup.color) }}>
          {Array.from({ length: pages }, (_, i) => (
            <div key={i} className="paper-page" style={{ top: i * STEP, width: paper.w, height: paper.h }} aria-hidden>
              {setup.header?.trim() && (
                <span className="paper-header" style={{ left: m.lr, right: m.lr, top: Math.max(20, m.tb / 2 - 10) }}>
                  {fill(setup.header, i + 1, pages)}
                </span>
              )}
              {setup.footer?.trim() && (
                <span className="paper-footer" style={{ left: m.lr, right: m.lr, bottom: Math.max(16, m.tb / 2 - 10) }}>
                  {fill(setup.footer, i + 1, pages)}
                </span>
              )}
              {setup.numbers !== false && <span className="paper-num">{i + 1}</span>}
            </div>
          ))}
          <div
            className="paper-flow paper-content"
            ref={flow}
            style={{ top: m.tb, left: m.lr, width: paper.w - m.lr * 2, ...pageStyle(setup) }}
          >
            <Editor value={props.value} onChange={props.onChange} compact placeholder="Start writing…" formatBar={props.formatBar ?? true} spellCheck={props.spellCheck} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** 頁首、頁尾裡的 {page}、{pages} 換成頁碼與總頁數 */
const fill = (text: string, page: number, pages: number) => text.replace(/\{page\}/gi, String(page)).replace(/\{pages\}/gi, String(pages));
