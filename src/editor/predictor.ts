/**
 * 字預測的「打字邏輯」：一個可以打字的元素一個 Predictor（`createPredictor`），
 * 區塊編輯器（`RichBlock.tsx`）與一般文字框、輸入框（`fieldPredict.ts`）共用。
 * 預測什麼由 `predict.ts` 決定，畫面是 `PredictBar.tsx`。
 *
 * 元素只要提供：游標前的文字、游標位置、讓輸入法結束組字的方法；插入一律用 execCommand（可以復原、
 * 會觸發 input 事件，React 的 onChange 也收得到）。
 *
 * 按鍵（`keyDown`）由 PredictBar 在 window 捕捉階段交給焦點所在元素的 Predictor（`predictorFor`），
 * 比各元件自己的快捷鍵早（例如簡報的 Esc、試算表的 Enter）。
 *
 * Banyan 自己的倉頡／速成輸入（不用 Windows 的中文輸入法）：中文模式（Shift 切換，`imeOn`）下
 * 打 a～y 不進文件，記在這裡的碼（`imeCode`），預測列左邊顯示字根、右邊是候選字；
 * 空白鍵、Enter、Tab 選反白的字，數字鍵 1～9 選第幾個，左右鍵移動，上下鍵（或 - =）換頁，
 * Backspace 刪一碼，Esc 取消；打標點等其他字先選反白的字再照常輸入。選好字後聯想。
 * 打大寫字母就暫時打英文（`imeTemp`），打完這個字（空白、標點、Enter…）回到中文。
 */
import {
  codeRadicals,
  compositionCode,
  imeOn,
  imeTemp,
  maxCode,
  myPairs,
  myWords,
  predictAfter,
  predictChars,
  predictData,
  predictNext,
  predictPrefs,
  predictWords,
  pageCount,
  setImeTemp,
  pageItems,
  wordAfter,
  wordBefore,
  type Prediction,
} from "./predict";
import { hidePredictions, movePrediction, predictions, showPredictions, type PredictState } from "./PredictBar";

export interface PredictTarget {
  el: () => HTMLElement | null;
  /** 游標前的文字；有選取範圍或不該預測（例如行內程式碼）時回傳 null */
  textBefore: () => string | null;
  /** 游標的位置（視窗座標） */
  caret: () => { x: number; y: number } | null;
  /** 讓輸入法結束組字（之後會送 compositionend，或直接取消） */
  endComposition: () => void;
}

export interface Predictor {
  /** 正在插入預測的字（不要再經過輔助打字） */
  inserting: () => boolean;
  /** beforeinput：選字用的按鍵後來又送出的字；回傳 true 表示丟掉了（已經 preventDefault） */
  beforeInput: (e: InputEvent) => boolean;
  /** input：一般打字時預測英文 */
  input: (e?: InputEvent) => void;
  compositionStart: () => void;
  compositionUpdate: (data: string) => void;
  /** compositionend：回傳 true 表示處理掉了（換成了選的字，或丟掉了選字的按鍵） */
  compositionEnd: (data: string) => boolean;
  /** 選好字之後：聯想 */
  follow: () => boolean;
  /** 一般按鍵進來時重設組字狀態 */
  keySeen: (e: KeyboardEvent) => void;
  /** 按鍵（PredictBar 在 window 捕捉階段交過來）；回傳 true 表示處理掉了 */
  keyDown: (e: KeyboardEvent) => boolean;
  /** 切換了中／英：取消打到一半的碼，在游標下方閃一下「中」或「英」 */
  modeChanged: () => void;
}

// ---- 元素 → Predictor（PredictBar 的按鍵依焦點所在元素找） ----

const registry = new WeakMap<EventTarget, Predictor>();
let fieldResolver: ((t: EventTarget) => Predictor | null) | null = null;

/** 區塊編輯器登記自己的編輯元素 */
export function registerPredictor(el: HTMLElement, p: Predictor) {
  registry.set(el, p);
}

/** 文字框、輸入框（`fieldPredict.ts`）：依元素建立或找到 Predictor */
export function setFieldResolver(fn: (t: EventTarget) => Predictor | null) {
  fieldResolver = fn;
}

export function predictorFor(t: EventTarget | null): Predictor | null {
  if (!t) return null;
  return registry.get(t) ?? fieldResolver?.(t) ?? null;
}

const SWALLOW_MS = 600;
/** 輸入法結束組字後這段時間內的按鍵不拿來選字 */
const COMMIT_KEY_MS = 250;

export function createPredictor(t: PredictTarget): Predictor {
  let inserting = false;
  let composing = false;
  /** 這次選字是組字中按鍵（空白、數字、Enter）選的，不是點的 */
  let pickByKey = false;
  /** 選字用的按鍵送出的字（數字、空白）與選的字，短時間內又輸入就丟掉 */
  let swallow: { chars: string[]; until: number } | null = null;
  /** 組字中選了候選字：輸入法結束組字（compositionend 帶來組字的內容 data）後換成它 */
  let pickChar: { ch: string; data: string | null } | null = null;
  /** 輸入法自己結束組字（不是選預測列）的時間 */
  let committedAt = 0;
  /** Banyan 輸入：打到一半的碼、候選字、第幾頁 */
  let imeCode = "";
  let imeAll: Prediction[] = [];
  let imePage = 0;

  const swallowed = (data: string): boolean => {
    const s = swallow;
    if (!s || Date.now() > s.until) return false;
    // 全形數字、全形空白（輸入法中文模式）也算
    const half = data.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, " ");
    const at = s.chars.indexOf(half);
    if (at < 0) return false;
    // 每個字只丟一次（數字鍵和輸入法自己的字可能各送一次）
    s.chars.splice(at, 1);
    if (!s.chars.length) swallow = null;
    return true;
  };
  const recentPick = () => !!pickChar && !!swallow && Date.now() <= swallow.until;

  const insert = (remove: number, text: string) => {
    inserting = true;
    try {
      for (let i = 0; i < remove; i++) document.execCommand("delete");
      if (text) document.execCommand("insertText", false, text);
    } finally {
      inserting = false;
    }
  };

  const show = (
    kind: PredictState["kind"],
    items: Prediction[],
    pick: (i: number) => void,
    extra: Pick<PredictState, "head" | "pageInfo" | "code" | "onPage"> = {},
  ) => {
    const el = t.el();
    const pt = el && (items.length || extra.head) ? t.caret() : null;
    if (!el || !pt) return hidePredictions();
    showPredictions({ items, ...pt, kind, pick, el, caret: t.caret, onKey: keyDown, ...extra });
  };

  // ─── Banyan 輸入 ───
  const resetIme = () => {
    imeCode = "";
    imeAll = [];
    imePage = 0;
  };

  const showIme = () => {
    const mode = predictPrefs().chinese;
    if (mode === "off") return;
    const d = predictData();
    imeAll = d ? predictChars(d.chars, imeCode, mode, 90) : [];
    const pages = pageCount(imeAll.length);
    imePage = Math.min(imePage, pages - 1);
    show("ime", pageItems(imeAll, imePage), commitIme, {
      head: codeRadicals(imeCode),
      code: imeCode,
      pageInfo: pages > 1 ? `${imePage + 1}/${pages}` : undefined,
      onPage: turnPage,
    });
  };

  /** 換頁（上下鍵、- =、預測列上的 ‹ ›） */
  function turnPage(delta: number) {
    const next = imePage + delta;
    if (!imeCode || next < 0 || next >= pageCount(imeAll.length)) return;
    imePage = next;
    showIme();
  }

  /** 選了這一頁第 i 個字：插入、聯想 */
  function commitIme(i: number) {
    const it = pageItems(imeAll, imePage)[i];
    resetIme();
    hidePredictions();
    if (!it) return;
    insert(0, it.text);
    follow();
  }

  /** 中文模式的按鍵；回傳 true 表示處理掉了 */
  const imeKey = (e: KeyboardEvent): boolean => {
    const mode = predictPrefs().chinese;
    if (mode === "off" || !imeOn() || e.ctrlKey || e.altKey || e.metaKey || e.isComposing || composing || e.key === "Process") {
      if (imeCode) resetIme();
      return false;
    }
    const bar = predictions();
    // 預測列被關掉了（點了別的地方、捲出畫面）：打到一半的碼也不要了
    if (imeCode && bar?.onKey !== keyDown) resetIme();
    const k = e.key;
    const take = (fn: () => void) => {
      e.preventDefault();
      fn();
      return true;
    };
    // 暫時打英文（打了大寫字母）：字母、數字照常打；空白、標點、Enter、Tab、移動游標、Esc 結束（那個鍵照常作用）
    if (imeTemp()) {
      if (/^[A-Za-z0-9'’-]$/.test(k) || k === "Backspace" || k === "Shift") return false;
      if (k.length === 1 || /^(Enter|Tab|Escape|Arrow|Home|End|Page)/.test(k)) setImeTemp(false);
      return false;
    }
    // 打了大寫字母：先選打到一半的字，再暫時打英文（大寫字母照常輸入）
    if (/^[A-Z]$/.test(k)) {
      if (imeCode) commitIme(bar?.onKey === keyDown ? bar.sel : 0);
      if (t.textBefore() !== null) setImeTemp(true);
      return false;
    }
    if (/^[a-y]$/.test(k)) {
      // 行內程式碼裡、選取了一段文字：照常打英文
      if (!imeCode && t.textBefore() === null) return false;
      // 碼已經打滿（速成 2 碼、倉頡 5 碼）還繼續打：先選反白的字，這個字母開始下一個字（連打）
      if (imeCode.length >= maxCode(mode))
        return take(() => {
          commitIme(bar?.onKey === keyDown ? bar.sel : 0);
          imeCode = k;
          imePage = 0;
          showIme();
        });
      return take(() => {
        imeCode += k;
        imePage = 0;
        showIme();
      });
    }
    if (!imeCode) return false;
    const sel = bar?.onKey === keyDown ? bar.sel : 0;
    switch (k) {
      case "Backspace":
        return take(() => {
          imeCode = imeCode.slice(0, -1);
          imePage = 0;
          if (imeCode) showIme();
          else hidePredictions();
        });
      case "Escape":
        return take(() => {
          resetIme();
          hidePredictions();
        });
      case " ":
      case "Enter":
      case "Tab":
        return take(() => commitIme(sel));
      case "ArrowRight":
        return take(() => movePrediction(1));
      case "ArrowLeft":
        return take(() => movePrediction(-1));
      case "ArrowDown":
      case "PageDown":
      case "=":
        return take(() => turnPage(1));
      case "ArrowUp":
      case "PageUp":
      case "-":
        return take(() => turnPage(-1));
    }
    if (/^[1-9]$/.test(k)) return take(() => commitIme(Number(k) - 1));
    // 標點、z、大寫字母等其他字：先選反白的字，再照常輸入那個字
    if (k.length === 1) {
      commitIme(sel);
      return false;
    }
    // 其他按鍵（Home、Delete…）：打到一半時不動
    return take(() => {});
  };

  /** 英文：正在打的字補完；打完一個字空一格，預測下一個字 */
  const predictWord = (): boolean => {
    if (!predictPrefs().english) return false;
    const before = t.textBefore();
    if (before === null) return false;
    const w = wordBefore(before);
    const prev = w ? null : wordAfter(before);
    const d = w || prev ? predictData() : null;
    if (!d) return false;
    if (prev) {
      const next = predictAfter(d.englishNext, myPairs(), prev);
      if (!next.length) return false;
      show("after", next, (i) => {
        hidePredictions();
        const b = t.textBefore();
        if (b !== null && wordAfter(b) === prev) insert(0, next[i].text);
      });
      return true;
    }
    if (!w) return false;
    const items = predictWords(d.english, myWords(), w);
    if (!items.length) return false;
    show("word", items, (i) => {
      hidePredictions();
      const b = t.textBefore();
      const cur = b === null ? null : wordBefore(b);
      if (cur) insert(cur.length, items[i].text);
    });
    return true;
  };

  /** 聯想：選好字後接下來可能打的字 */
  const follow = (): boolean => {
    if (predictPrefs().chinese === "off") return false;
    const before = t.textBefore();
    const d = before ? predictData() : null;
    if (!before || !d) return false;
    const items = predictNext(d.phrases, before);
    if (!items.length) return false;
    show("next", items, (i) => {
      hidePredictions();
      insert(0, items[i].text);
      follow();
    });
    return true;
  };

  /** 把組字的內容（取消組字時是空的）換成選的字 */
  const finishPick = () => {
    const p = pickChar;
    if (!p || p.data === null) return;
    pickChar = null;
    // 從真正換上去之後再算一段時間，輸入法再送出同一個字就丟掉
    if (swallow) swallow.until = Date.now() + SWALLOW_MS;
    const before = t.textBefore() ?? "";
    insert(p.data && before.endsWith(p.data) ? p.data.length : 0, p.ch);
    // 選字的那個鍵可能晚一點又送一次 keydown，不要拿來選接著出現的聯想
    committedAt = Date.now();
    follow();
  };

  /** 點了候選字（或輸入法沒有自己結束組字）：讓輸入法結束組字，再換成選的字 */
  const endComposition = () => {
    t.endComposition();
    hidePredictions();
    if (pickChar && pickChar.data !== null) finishPick();
    else
      // 輸入法沒有送 compositionend（直接取消了組字）：直接插入
      setTimeout(() => {
        const p = pickChar;
        if (p && p.data === null) {
          composing = false;
          p.data = "";
          finishPick();
        }
      }, 300);
  };

  /** 組字中：依字根預測倉頡／速成的字 */
  const predictCode = (data: string) => {
    const mode = predictPrefs().chinese;
    const code = mode === "off" ? null : compositionCode(data);
    const d = code ? predictData() : null;
    if (!code || !d || mode === "off") return hidePredictions();
    const items = predictChars(d.chars, code, mode);
    // 組字中的文字要等這次事件之後才會在畫面上：事件處理完再量游標位置
    setTimeout(() => {
      if (!composing) return;
      show("code", items, (i) => {
        const ch = items[i].text;
        pickChar = { ch, data: null };
        const byKey = pickByKey;
        pickByKey = false;
        if (byKey) {
          // 用數字鍵、Enter 選的：輸入法也正在處理這個鍵（送出它自己的字或原本的字根），
          // 先等它自己結束組字（compositionend 時換成選的字）；之後同一個字又送出來就丟掉
          swallow?.chars.push(ch);
          hidePredictions();
          setTimeout(() => {
            if (pickChar?.data === null && composing) endComposition();
          }, 150);
          return;
        }
        endComposition();
      });
    }, 0);
  };

  /**
   * 預測列的按鍵；回傳 true 表示處理掉了。
   * 數字鍵 1～9（或 Ctrl＋數字）選第幾個；左右鍵移動選中的字，Tab、Enter 選它；Esc 關掉。
   * 英文的下一個字是「接下來可能打的」，Enter 要先用左右鍵移動過才選（不然 Enter 照常換行）；聯想直接按 Enter 就選。
   * 組字中按鍵先給輸入法（key 是 `Process`），改看 code：數字、Enter 選預測列的字（空白鍵留給輸入法）
   * （輸入法同時送出的字會在 compositionend 換掉，那個鍵之後又送出來的數字、空白由 swallow 丟掉），左右鍵也移動預測列。
   */
  const keyDown = (e: KeyboardEvent): boolean => {
    // Alt＋數字（上排）：直接打數字（預測列出現時數字鍵是選字；打到一半的碼先選反白的字）。
    // App 切換畫面的快捷鍵因此改成 Alt＋Shift＋1／2／3
    const altDigit = /^Digit([0-9])$/.exec(e.code)?.[1];
    if (altDigit && e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && t.textBefore() !== null) {
      const bar = predictions();
      e.preventDefault();
      if (imeCode) commitIme(bar?.onKey === keyDown ? bar.sel : 0);
      hidePredictions();
      insert(0, altDigit);
      return true;
    }
    if (imeKey(e)) return true;
    const bar = predictions();
    // 預測列是別的元素的
    if (!bar || bar.onKey !== keyDown || e.altKey || e.metaKey) return false;
    // 用輸入法自己的候選字（例如按 1 選「我」）：輸入法先送 compositionend、聯想列出現，
    // 那個鍵的 keydown 才到。剛結束組字時的按鍵是給輸入法的，不要拿來選聯想（會變成「我們」）
    if (Date.now() - committedAt < COMMIT_KEY_MS) return false;
    const inIme = e.isComposing || composing || e.key === "Process";
    const take = (fn: () => void, typed?: string) => {
      e.preventDefault();
      // 輸入法開著時 preventDefault 擋不住輸入法，那個鍵的字可能晚一點才送出來
      if (typed && inIme) swallow = { chars: [typed], until: Date.now() + SWALLOW_MS };
      pickByKey = inIme && bar.kind === "code";
      fn();
      pickByKey = false;
      return true;
    };
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)?.[1] ?? (/^[1-9]$/.test(e.key) ? e.key : null);
    // 數字鍵選字（要打數字按 Alt＋數字，見上面）
    if (digit && !e.shiftKey && (inIme || e.ctrlKey || /^[1-9]$/.test(e.key))) {
      const i = Number(digit) - 1;
      if (i < bar.items.length) return take(() => bar.pick(i), e.ctrlKey ? undefined : digit);
      return false;
    }
    if (e.ctrlKey || e.shiftKey) {
      if (!inIme && /^(Arrow|Home|End|Page)/.test(e.key)) hidePredictions();
      return false;
    }
    const key = inIme ? e.code : e.key;
    if (key === "ArrowRight") return take(() => movePrediction(1));
    if (key === "ArrowLeft") return take(() => movePrediction(-1));
    // Enter 選字：中文候選字、聯想（使用者要的）、英文補完；英文的下一個字要先用左右鍵移動過，不然 Enter 照常換行
    const enterPicks = bar.kind === "code" || bar.kind === "next" || bar.kind === "word" || bar.moved;
    if ((key === "Enter" || key === "NumpadEnter") && enterPicks) return take(() => bar.pick(bar.sel), "\n");
    // 空白鍵不選字：組字中它是系統輸入法的（換字、開候選窗），網頁擋不住，搶來用會和輸入法打架
    if (inIme) return false;
    if (key === "Tab") return take(() => bar.pick(bar.sel));
    if (key === "Escape") return take(hidePredictions);
    if (/^(Arrow|Home|End|Page|Enter|Delete)/.test(key)) hidePredictions();
    return false;
  };

  return {
    inserting: () => inserting,
    beforeInput: (e) => {
      if (e.isComposing || !e.data || !swallowed(e.data)) return false;
      e.preventDefault();
      return true;
    },
    input: (e) => {
      // 輸入事件說不在組字中就是不在（輸入法沒送 compositionend 時 composing 會卡住，預測就全部停了）
      if (e && !e.isComposing) composing = false;
      if (e?.isComposing || inserting || composing) return;
      if (!predictWord()) hidePredictions();
    },
    compositionStart: () => {
      composing = true;
      if (recentPick()) return;
      pickChar = null;
      hidePredictions();
    },
    compositionUpdate: (data) => {
      composing = true;
      // 剛用按鍵選了字：輸入法把那個鍵也放進組字裡，不要取消選的字
      if (recentPick()) return;
      pickChar = null;
      predictCode(data);
    },
    compositionEnd: (data) => {
      composing = false;
      const pick = pickChar;
      if (pick) {
        // 選了預測列的候選字：焦點在元素上就馬上換，否則等選字那邊把焦點移回來再換
        pick.data = data;
        if (document.activeElement === t.el()) finishPick();
        return true;
      }
      // 選字的數字鍵在組字結束後又被輸入法送出來（例如全形的「３」）：刪掉
      if (data && swallowed(data)) {
        if (t.textBefore()?.endsWith(data)) insert(data.length, "");
        hidePredictions();
        return true;
      }
      if (data) committedAt = Date.now();
      hidePredictions();
      return false;
    },
    follow,
    keySeen: (e) => {
      if (!e.isComposing && e.key !== "Process") composing = false;
    },
    keyDown,
    modeChanged: () => {
      resetIme();
      const el = t.el();
      const pt = el ? t.caret() : null;
      if (!el || !pt) return hidePredictions();
      showPredictions({ items: [], ...pt, kind: "mode", pick: () => {}, el, caret: t.caret, head: imeOn() ? "中" : "英" });
      const shown = predictions();
      setTimeout(() => {
        if (predictions() === shown) hidePredictions();
      }, 900);
    },
  };
}
