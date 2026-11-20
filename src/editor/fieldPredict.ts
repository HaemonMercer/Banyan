/**
 * 一般文字框（textarea）與單行輸入框（input）的字預測：便利貼、備忘稿、Draw 的文字、Tasks 卡片、
 * 試算表的格子（`.st-input`）、標題、搜尋框…都不用各自接，App 呼叫一次 `installFieldPrediction`，
 * 在 document 上聽事件，每個元素一個 Predictor（`predictor.ts`，和區塊編輯器共用）。
 *
 * 不預測：區塊編輯器的原始碼文字框（`textarea.edit`，程式碼等）、密碼／網址／數字等特殊輸入框、
 * 唯讀、`data-no-predict`。
 */
import { predictData } from "./predict";
import { createPredictor, setFieldResolver, type Predictor } from "./predictor";

type Field = HTMLInputElement | HTMLTextAreaElement;

const TEXT_TYPES = new Set(["", "text", "search"]);

export function isPredictField(el: EventTarget | null): el is Field {
  if (el instanceof HTMLTextAreaElement) {
    if (el.matches("textarea.edit")) return false;
  } else if (el instanceof HTMLInputElement) {
    if (!TEXT_TYPES.has(el.type)) return false;
  } else return false;
  return !el.readOnly && !el.disabled && !el.closest("[data-no-predict]");
}

/** 游標前的文字（有選取範圍時回傳 null） */
function textBefore(el: Field): string | null {
  const a = el.selectionStart;
  if (a === null || a !== el.selectionEnd) return null;
  return el.value.slice(0, a);
}

const MIRROR_PROPS = [
  "boxSizing",
  "width",
  "height",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderStyle",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontVariant",
  "letterSpacing",
  "lineHeight",
  "textTransform",
  "textIndent",
  "textAlign",
  "tabSize",
  "wordSpacing",
] as const;

/** 文字框裡游標的位置（視窗座標）：用一個樣式相同的影子元素量 */
export function fieldCaretPoint(el: Field): { x: number; y: number } | null {
  const at = el.selectionEnd;
  if (at === null) return null;
  const cs = getComputedStyle(el);
  const box = el.getBoundingClientRect();
  const mirror = document.createElement("div");
  const st = mirror.style;
  for (const k of MIRROR_PROPS) st[k] = cs[k];
  st.position = "fixed";
  st.left = `${box.left}px`;
  st.top = `${box.top}px`;
  st.visibility = "hidden";
  st.overflow = "hidden";
  const single = el instanceof HTMLInputElement;
  st.whiteSpace = single ? "pre" : "pre-wrap";
  st.overflowWrap = single ? "normal" : "break-word";
  mirror.textContent = el.value.slice(0, at);
  const mark = document.createElement("span");
  mark.textContent = "​";
  mirror.appendChild(mark);
  document.body.appendChild(mirror);
  const r = mark.getBoundingClientRect();
  mirror.remove();
  const lineH = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3 || r.height;
  const x = Math.min(box.right, Math.max(box.left, r.left - el.scrollLeft));
  const y = Math.min(box.bottom, Math.max(box.top, r.top - el.scrollTop + lineH));
  return { x, y };
}

const predictors = new WeakMap<Field, Predictor>();

function predictorOf(el: Field): Predictor {
  let p = predictors.get(el);
  if (!p) {
    p = createPredictor({
      el: () => el,
      textBefore: () => (document.activeElement === el ? textBefore(el) : null),
      caret: () => (el.isConnected ? fieldCaretPoint(el) : null),
      // 文字框失去焦點時元件常常會結束編輯（便利貼、格子），所以不切換焦點：
      // 重設游標位置讓輸入法結束組字（沒結束的話等它自己的 compositionend）
      endComposition: () => {
        const at = el.selectionEnd ?? el.value.length;
        el.setSelectionRange(at, at);
      },
    });
    predictors.set(el, p);
  }
  return p;
}

let installed = false;

/** 在整個 App 的文字框、輸入框上啟用字預測（App 啟動時呼叫一次） */
export function installFieldPrediction() {
  if (installed) return;
  installed = true;
  // 按鍵（Banyan 輸入、選字）由 PredictBar 依焦點所在元素找 Predictor
  setFieldResolver((t) => (isPredictField(t) ? predictorOf(t) : null));
  const on = <K extends keyof DocumentEventMap>(type: K, fn: (el: Field, e: DocumentEventMap[K]) => void) =>
    document.addEventListener(
      type,
      (e) => {
        if (isPredictField(e.target)) fn(e.target, e);
      },
      true,
    );
  on("focusin", () => void predictData());
  on("beforeinput", (el, e) => {
    if (predictorOf(el).beforeInput(e)) e.stopImmediatePropagation();
  });
  // 等元件自己的 onChange 處理完、重畫之後（React 在 root 上聽）再預測
  on("input", (el, e) => {
    const ie = e as InputEvent;
    const p = predictorOf(el);
    // 插入預測的字造成的輸入不再預測（要在事件當下判斷）
    if (p.inserting()) return;
    setTimeout(() => p.input(ie), 0);
  });
  on("compositionstart", (el) => predictorOf(el).compositionStart());
  on("compositionupdate", (el, e) => predictorOf(el).compositionUpdate(e.data ?? ""));
  on("compositionend", (el, e) => {
    const p = predictorOf(el);
    if (!p.compositionEnd(e.data ?? "") && e.data) setTimeout(() => p.follow(), 0);
  });
  on("keydown", (el, e) => predictorOf(el).keySeen(e));
}
