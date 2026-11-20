/**
 * 字預測列：打字時游標下方的一排候選字（內容由 `predict.ts` 決定，RichBlock 呼叫 `showPredictions`）。
 * 整個 App 只有一個（App 放 `<PredictBar />`），portal 到 body；
 * mousedown 時 preventDefault，按了不會讓編輯器失去焦點。
 */
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  imeOn,
  imeTemp,
  inputSnapshot,
  predictPrefs,
  schemeSwitches,
  setImeOn,
  setImeTemp,
  subscribeInput,
  switchInputScheme,
  type Prediction,
} from "./predict";
import { predictorFor } from "./predictor";

export interface PredictState {
  items: Prediction[];
  /** 游標的位置（視窗座標）：預測列放在它下方 */
  x: number;
  y: number;
  /**
   * 系統輸入法組字中的倉頡／速成候選字、Banyan 輸入的候選字、選好字後的聯想、英文補完、英文的下一個字、
   * 切換中／英時閃一下的提示
   */
  kind: "code" | "ime" | "next" | "word" | "after" | "mode";
  pick: (i: number) => void;
  /** 目前選中的（左右鍵移動，Tab 或 Enter 選它） */
  sel: number;
  /** 用左右鍵移動過（之後 Enter 才是選字，不然 Enter 是換行或交給輸入法） */
  moved: boolean;
  /** 正在打字的元素（捲動時重新量游標位置；按鍵只在它上面時才交給 onKey） */
  el?: HTMLElement;
  /** 量游標位置（文字框與編輯器量法不同；沒有就用 caretPoint） */
  caret?: () => { x: number; y: number } | null;
  /** 選字的按鍵（`predictor.ts`）；回傳 true 表示處理掉了 */
  onKey?: (e: KeyboardEvent) => boolean;
  /** 左邊的字：Banyan 輸入打到一半的字根，或「中」／「英」 */
  head?: string;
  /** 候選字的頁數（`2/5`） */
  pageInfo?: string;
  /** Banyan 輸入打了的字母碼（`hqi`，顯示在字根旁邊） */
  code?: string;
  /** 點預測列上的 ‹ › 換頁 */
  onPage?: (delta: number) => void;
}

let state: PredictState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function showPredictions(s: Omit<PredictState, "sel" | "moved"> | null) {
  state = s && (s.items.length || s.head) ? { ...s, sel: 0, moved: false } : null;
  emit();
}

/** 左右鍵：移動選中的字（到頭繞回另一端） */
export function movePrediction(delta: number) {
  if (!state) return;
  const n = state.items.length;
  state = { ...state, sel: (state.sel + delta + n) % n, moved: true };
  emit();
}

export const hidePredictions = () => {
  if (state) showPredictions(null);
};

export const predictions = () => state;

/** 游標（選取的起點）的位置；拿不到回傳 null */
export function caretPoint(el: HTMLElement): { x: number; y: number } | null {
  const sel = el.ownerDocument.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!el.contains(r.startContainer)) return null;
  const rect = r.getClientRects()[0] ?? charBefore(r)?.getClientRects()[0];
  if (rect) return { x: rect.right, y: rect.bottom };
  const box = el.getBoundingClientRect();
  return { x: box.left, y: box.bottom };
}

/** 游標在元素之間（不在文字裡）時量不到位置：改量它前面那個字 */
function charBefore(r: Range): Range | null {
  let node: Node | null = r.startContainer;
  let off = r.startOffset;
  if (node.nodeType !== 3) {
    node = node.childNodes[off - 1] ?? null;
    while (node && node.nodeType !== 3) node = node.lastChild;
    off = node?.textContent?.length ?? 0;
  }
  if (!node || off === 0) return null;
  const out = document.createRange();
  out.setStart(node, off - 1);
  out.setEnd(node, off);
  return out;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** 現在的中文輸入法名稱（倉頡／速成） */
const schemeName = () => (predictPrefs().chinese === "quick" ? "Quick" : "Cangjie");

export function PredictBar() {
  const s = useSyncExternalStore(subscribe, predictions);
  // 換了倉頡／速成（Alt＋`、右下角標籤）：焦點在可以打字的地方就在游標下方閃一下
  const switches = useSyncExternalStore(subscribeInput, schemeSwitches);
  useEffect(() => {
    if (switches) predictorFor(document.activeElement)?.modeChanged();
  }, [switches]);
  // 捲動或改變視窗大小：跟著游標移動（不要關掉：日記、頁面打字時外層常常會捲動）；游標看不到了才關掉
  useEffect(() => {
    if (!s?.el) return;
    const el = s.el;
    const caret = s.caret ?? (() => caretPoint(el));
    const follow = () => {
      const cur = predictions();
      if (!cur) return;
      const pt = el.isConnected ? caret() : null;
      if (!pt || pt.y < 0 || pt.y > window.innerHeight) return hidePredictions();
      if (pt.x === cur.x && pt.y === cur.y) return;
      state = { ...cur, ...pt };
      emit();
    };
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [s?.el, s?.caret]);
  // 按鍵：在 window 捕捉階段交給焦點所在元素的 Predictor（Banyan 輸入的字母、選字的按鍵；比各元件自己的快捷鍵早，
  // 例如簡報的 Esc、試算表的 Enter；App 一開始就掛上，同一階段才排在各元件之前）。
  // 單獨按一下 Shift（中間沒按別的鍵、沒點滑鼠）切換中／英。點預測列以外的地方就關掉。
  useEffect(() => {
    let shiftAlone = false;
    const key = (e: KeyboardEvent) => {
      shiftAlone = e.key === "Shift" ? !e.repeat || shiftAlone : false;
      const p = predictorFor(e.target);
      if (p?.keyDown(e)) e.stopImmediatePropagation();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== "Shift" || !shiftAlone) return;
      shiftAlone = false;
      const p = predictorFor(e.target);
      if (!p || predictPrefs().chinese === "off") return;
      setImeOn(!imeOn());
      p.modeChanged();
    };
    const down = (e: MouseEvent) => {
      shiftAlone = false;
      // 點了別的地方：暫時打英文結束
      if (!(e.target as Element | null)?.closest?.(".ime-badge")) setImeTemp(false);
      const t = e.target as Element | null;
      if (predictions() && !t?.closest?.(".predict-bar")) hidePredictions();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("mousedown", down, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("mousedown", down, true);
    };
  }, []);
  // 量到實際寬度後夾在視窗內
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const bar = ref.current;
    if (!bar || !s) return;
    const w = bar.offsetWidth;
    const h = bar.offsetHeight;
    bar.style.left = `${Math.max(8, Math.min(s.x - 12, window.innerWidth - w - 8))}px`;
    const below = s.y + 6;
    bar.style.top = `${below + h > window.innerHeight - 8 ? s.y - h - 30 : below}px`;
  }, [s]);
  if (!s) return null;
  return createPortal(
    <div
      ref={ref}
      className={`predict-bar editor-ui pb-${s.kind}`}
      style={{ left: s.x - 12, top: s.y + 6 }}
      onMouseDown={(e) => e.preventDefault()}
      role="listbox"
      aria-label={s.kind === "mode" ? "Input mode" : "Predictions"}
    >
      {s.kind === "mode" ? (
        // 切換中／英：一個小標籤
        <div className="pb-mode-chip">
          <b>{s.head}</b>
          <span>{s.head === "中" ? schemeName() : "English"}</span>
        </div>
      ) : (
        <>
          {s.kind === "ime" && (
            // Banyan 輸入：上面一層是打了的碼（字根＋字母）與換頁
            <div className="pb-top">
              <span className="pb-code">{s.head}</span>
              {s.code && <span className="pb-latin">{s.code}</span>}
              {s.pageInfo && (
                <span className="pb-pager">
                  <button type="button" tabIndex={-1} aria-label="Previous page" onClick={() => s.onPage?.(-1)}>
                    ‹
                  </button>
                  <span>{s.pageInfo}</span>
                  <button type="button" tabIndex={-1} aria-label="Next page" onClick={() => s.onPage?.(1)}>
                    ›
                  </button>
                </span>
              )}
            </div>
          )}
          <div className="pb-row">
            {s.kind === "ime" && !s.items.length && <span className="pb-none">No match</span>}
            {s.items.map((it, i) => (
              <button
                key={i + it.text}
                type="button"
                tabIndex={-1}
                role="option"
                aria-selected={i === s.sel}
                className={i === s.sel ? "pb-item on" : "pb-item"}
                onClick={() => s.pick(i)}
              >
                {i < 9 && <span className="pb-num">{i + 1}</span>}
                <span className="pb-text">{it.text}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}

const SCHEME_LABEL = { cangjie: "Cangjie", quick: "Quick" } as const;

/**
 * 右下角的輸入法標籤：左邊的「中／英」點一下切換中英（和單獨按 Shift 一樣），
 * 右邊的「Cangjie／Quick」點一下換倉頡或速成（英文時是 English，點了切回中文）。
 * 設定的 Chinese input 是 Off 時不顯示。mousedown 時 preventDefault，按了不會讓編輯器失去焦點。
 */
export function InputModeBadge() {
  useSyncExternalStore(subscribeInput, inputSnapshot);
  const scheme = predictPrefs().chinese;
  if (scheme === "off") return null;
  // 中文模式裡打了大寫字母暫時打英文：標籤也顯示英，旁邊註明 temporarily
  const temp = imeTemp();
  const zh = imeOn() && !temp;
  const other = scheme === "cangjie" ? "quick" : "cangjie";
  return createPortal(
    <div className={`ime-badge editor-ui${zh ? " zh" : ""}`} onMouseDown={(e) => e.preventDefault()}>
      <button
        type="button"
        tabIndex={-1}
        className="ime-mode"
        onClick={() => (temp ? setImeTemp(false) : setImeOn(!zh))}
        title={zh ? "Chinese — click or tap Shift for English" : "English — click or tap Shift for Chinese"}
        aria-label={zh ? "Switch to English" : "Switch to Chinese"}
      >
        {zh ? "中" : "英"}
      </button>
      <button
        type="button"
        tabIndex={-1}
        className="ime-scheme"
        onClick={() => (zh ? switchInputScheme() : setImeOn(true))}
        title={zh ? `Switch to ${SCHEME_LABEL[other]} (Alt+\`)` : `Switch to Chinese (${SCHEME_LABEL[scheme]})`}
      >
        {zh ? SCHEME_LABEL[scheme] : temp ? "English · until space" : "English"}
      </button>
    </div>,
    document.body,
  );
}
