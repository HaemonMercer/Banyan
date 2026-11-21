/**
 * 區塊編輯器以外所有可以打字的地方：字預測＋輔助打字（`typing.ts`）。
 * 一般文字框（textarea）、單行輸入框（input）與純文字的可編輯元素（`contenteditable="plaintext-only"`：
 * Draw 圖形的文字、圖片的圖說、表格編輯器的格子）——便利貼、心智圖主題、備忘稿、Tasks 卡片、
 * 試算表的格子（`.st-input`）、標題、搜尋框…都不用各自接，App 呼叫一次 `installFieldPrediction`，
 * 在 document 上聽事件，每個元素一個 Predictor（`predictor.ts`，和區塊編輯器共用）。
 * 區塊編輯器（`RichBlock.tsx`，`contenteditable="true"`）自己接，不經過這裡。
 *
 * 不預測：區塊編輯器的原始碼文字框（`textarea.edit`，程式碼等）、密碼／網址／數字等特殊輸入框、
 * 唯讀、`data-no-predict`。
 * 不輔助打字（但照樣預測）：`data-no-assist`（程式碼卡片）、`=` 開頭的內容（試算表公式）。
 */
import { predictData } from "./predict";
import { caretPoint } from "./PredictBar";
import { createPredictor, setFieldResolver, type Predictor } from "./predictor";
import { assistText, typingPrefs } from "./typing";

type TextField = HTMLInputElement | HTMLTextAreaElement;
/** 文字框、輸入框，或純文字的可編輯元素 */
type Field = TextField | HTMLElement;

const TEXT_TYPES = new Set(["", "text", "search"]);

const isTextField = (el: Field): el is TextField => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;

/** 事件目標對應的打字元素（可編輯元素裡的文字節點、子元素也算）；不處理的回傳 null */
export function predictField(t: EventTarget | null): Field | null {
  if (t instanceof HTMLTextAreaElement) {
    if (t.matches("textarea.edit")) return null;
  } else if (t instanceof HTMLInputElement) {
    if (!TEXT_TYPES.has(t.type)) return null;
  } else {
    const node = t instanceof Node ? (t.nodeType === 1 ? (t as Element) : t.parentElement) : null;
    const host = node?.closest<HTMLElement>('[contenteditable="plaintext-only"]');
    if (!host || host.closest("[data-no-predict]")) return null;
    return host;
  }
  return !t.readOnly && !t.disabled && !t.closest("[data-no-predict]") ? t : null;
}

/** 元素裡的全部文字 */
const fullText = (el: Field) => (isTextField(el) ? el.value : (el.innerText ?? "").replace(/\r/g, ""));

/** 游標前的文字（有選取範圍時回傳 null） */
function textBefore(el: Field): string | null {
  if (isTextField(el)) {
    const a = el.selectionStart;
    if (a === null || a !== el.selectionEnd) return null;
    return el.value.slice(0, a);
  }
  const sel = el.ownerDocument.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  if (!el.contains(r.startContainer)) return null;
  const pre = el.ownerDocument.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().replace(/​/g, "");
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
export function fieldCaretPoint(el: TextField): { x: number; y: number } | null {
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
      textBefore: () => (el.contains(document.activeElement) || document.activeElement === el ? textBefore(el) : null),
      caret: () => (!el.isConnected ? null : isTextField(el) ? fieldCaretPoint(el) : caretPoint(el)),
      // 文字框失去焦點時元件常常會結束編輯（便利貼、格子、Draw 的文字），所以不切換焦點：
      // 重設游標位置讓輸入法結束組字（沒結束的話等它自己的 compositionend）
      endComposition: () => {
        if (isTextField(el)) {
          const at = el.selectionEnd ?? el.value.length;
          el.setSelectionRange(at, at);
          return;
        }
        const sel = el.ownerDocument.getSelection();
        if (!sel?.rangeCount) return;
        const r = sel.getRangeAt(0).cloneRange();
        sel.removeAllRanges();
        sel.addRange(r);
      },
    });
    predictors.set(el, p);
  }
  return p;
}

// ─── 輔助打字（`typing.ts`） ───

/** 這個元素現在要不要輔助打字：程式碼（`data-no-assist`）、試算表公式（`=` 開頭）不換 */
const wantsAssist = (el: Field) => !el.closest("[data-no-assist]") && !fullText(el).startsWith("=");

/** 剛換過的字：{ 換成的字, 原本打的字 }，緊接著按 Backspace 就還原 */
const assisted = new WeakMap<Field, { text: string; ascii: string }>();

/** 把游標前 remove 個字換成 text（execCommand 才會進復原、觸發 input 讓元件的 onChange 跟上） */
function replaceBefore(el: Field, remove: number, text: string) {
  if (isTextField(el)) {
    const at = el.selectionStart ?? el.value.length;
    el.setSelectionRange(at - remove, at);
  } else {
    for (let i = 0; i < remove; i++) document.execCommand("delete");
  }
  document.execCommand("insertText", false, text);
}

/** 一般打字：在 beforeinput 換掉要打的字；回傳 true 表示換了（呼叫的人要 preventDefault） */
function assistTyped(el: Field, data: string): boolean {
  assisted.delete(el);
  if (!wantsAssist(el)) return false;
  const before = textBefore(el);
  if (before === null) return false;
  const out = assistText(before, data, typingPrefs());
  if (!out) return false;
  replaceBefore(el, out.remove, out.text);
  assisted.set(el, { text: out.text, ascii: before.slice(before.length - out.remove) + data });
  return true;
}

/** 輸入法選好字（已經在元素裡了）：把剛送出的 data 換掉 */
function assistComposed(el: Field, data: string) {
  assisted.delete(el);
  if (!wantsAssist(el)) return;
  const before = textBefore(el);
  if (before === null || !before.endsWith(data)) return;
  const pre = before.slice(0, before.length - data.length);
  const out = assistText(pre, data, typingPrefs());
  if (!out) return;
  replaceBefore(el, data.length + out.remove, out.text);
  assisted.set(el, { text: out.text, ascii: pre.slice(pre.length - out.remove) + data });
}

/** 剛換過後緊接著按 Backspace：還原成原本打的字；回傳 true 表示處理掉了 */
function undoAssist(el: Field, e: KeyboardEvent): boolean {
  const typed = assisted.get(el);
  assisted.delete(el);
  if (!typed || e.key !== "Backspace" || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return false;
  const before = textBefore(el);
  if (before === null || !before.endsWith(typed.text)) return false;
  replaceBefore(el, typed.text.length, typed.ascii);
  return true;
}

let installed = false;

/** 在整個 App 的文字框、輸入框、純文字可編輯元素上啟用字預測與輔助打字（App 啟動時呼叫一次） */
export function installFieldPrediction() {
  if (installed) return;
  installed = true;
  // 按鍵（Banyan 輸入、選字）由 PredictBar 依焦點所在元素找 Predictor
  setFieldResolver((t) => {
    const el = predictField(t);
    return el ? predictorOf(el) : null;
  });
  const on = <K extends keyof DocumentEventMap>(type: K, fn: (el: Field, e: DocumentEventMap[K]) => void) =>
    document.addEventListener(
      type,
      (e) => {
        const el = predictField(e.target);
        if (el) fn(el, e);
      },
      true,
    );
  on("focusin", () => void predictData());
  on("beforeinput", (el, e) => {
    const p = predictorOf(el);
    if (p.beforeInput(e)) {
      e.stopImmediatePropagation();
      return;
    }
    if (e.inputType !== "insertText" || e.isComposing || !e.data || p.inserting()) return;
    if (assistTyped(el, e.data)) e.preventDefault();
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
    if (p.compositionEnd(e.data ?? "") || !e.data) return;
    assistComposed(el, e.data);
    setTimeout(() => p.follow(), 0);
  });
  on("keydown", (el, e) => {
    predictorOf(el).keySeen(e);
    if (undoAssist(el, e)) e.preventDefault();
  });
}
