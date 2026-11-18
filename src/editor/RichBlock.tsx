import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import type { Marks } from "./inline";
import { TaskGlyph, WhenChip } from "../bujo/TaskGlyph";
import { whenLabel } from "../bujo/time";
import { stripTaskShortcut, stripTodoShortcut, taskShortcut, todoShortcut, type TaskState } from "../bujo/tasks";
import type { ListInfo, UnitKind } from "./markdown";
import {
  caretLine,
  contentToRegion,
  domMarks,
  recompose,
  regionToContent,
  renderInto,
  serialize,
  splitAt,
  backBy,
  forceFormat,
  formatSelection,
  selectionMarks,
  placeCaret,
  toggleAtCaret,
  type FormatSpec,
  type Shape,
} from "./wysiwyg";

/**
 * 編輯中區塊的「編輯面」：原始碼文字框與所見即所得編輯都實作這組介面，
 * 編輯器只透過它讀寫文字與選取（位置都是區塊原始碼中的位置）。
 */
export interface Surface {
  readonly el: HTMLElement;
  readonly rich: boolean;
  text(): string;
  sel(): [number, number];
  setSel(a: number, b: number): void;
  focus(): void;
  blur(): void;
  atStart(): boolean;
  atEnd(): boolean;
  allSelected(): boolean;
  firstLine(): boolean;
  lastLine(): boolean;
  /** 游標處的格式（只有所見即所得編輯提供；含剛按下、還沒打字的格式） */
  marks(): Marks | null;
  /**
   * 沒有選取時切換「接著打的字」的格式（只有所見即所得提供）。
   * 之後每打一個字（含輸入法選好的字）都會確認它有或沒有這個格式，直到游標移走。
   */
  typingStyle(spec: FormatSpec): boolean;
  /**
   * 對選取的文字切換格式（只有所見即所得提供），以畫面上的字為準；
   * 回傳新的區塊原始碼與選取位置（區塊原始碼中的位置），沒有選取時回傳 null。
   */
  format(spec: FormatSpec, mode: "toggle" | "on" | "off"): { text: string; a: number; b: number } | null;
  /** 記住目前的選取（例如輸入網址時焦點會離開），之後用 restore 放回去 */
  saveSel(): () => void;
  /**
   * 在游標處切開（Enter 用，只有所見即所得提供）：回傳游標前的區塊原始碼與游標後的行內內容。
   * 在格式中間切開時兩邊各自保有格式。
   */
  split(): { before: string; after: string } | null;
}

/** 原始碼文字框的編輯面。 */
export function textareaSurface(ta: HTMLTextAreaElement): Surface {
  return {
    el: ta,
    rich: false,
    text: () => ta.value,
    sel: () => [ta.selectionStart, ta.selectionEnd],
    setSel: (a, b) => ta.setSelectionRange(a, b),
    focus: () => ta.focus({ preventScroll: false }),
    blur: () => ta.blur(),
    atStart: () => ta.selectionStart === 0 && ta.selectionEnd === 0,
    atEnd: () => ta.selectionStart === ta.value.length,
    allSelected: () => ta.selectionStart === 0 && ta.selectionEnd === ta.value.length,
    firstLine: () => !ta.value.slice(0, ta.selectionStart).includes("\n"),
    lastLine: () => !ta.value.slice(ta.selectionEnd).includes("\n"),
    marks: () => null,
    typingStyle: () => false,
    format: () => null,
    saveSel: () => () => {},
    split: () => null,
  };
}

export type Shortcut = "h1" | "h2" | "h3" | "bullet" | "ordered" | "quote" | "code" | "task" | "todo";

/** 段落開頭打這些字會轉成對應的區塊（像 Notion）。 */
const SHORTCUTS: [RegExp, Shortcut][] = [
  [/^### $/, "h3"],
  [/^## $/, "h2"],
  [/^# $/, "h1"],
  [/^[-*+] $/, "bullet"],
  [/^1[.)] $/, "ordered"],
  [/^> $/, "quote"],
  [/^```$/, "code"],
];

/** 在 Markdown 行內內容開頭去掉（跳脫過的）區塊標記。 */
const MARKER_SOURCE = /^(?:\\?#{1,3} |\\?[-*+] |1\\?[.)] |\\?> |(?:\\?`){3})/;

interface Props {
  text: string;
  shape: Shape;
  kind: UnitKind | undefined;
  level?: number;
  list?: ListInfo;
  env: Record<string, unknown>;
  placeholder: string;
  /** 使用者編輯後的新原始碼與游標位置 */
  onText: (text: string, caret: number) => void;
  /**
   * 段落開頭打了區塊標記：rest 是標記後面剩下的行內內容；任務、待辦另外帶狀態；
   * 項目符號帶打的是哪個符號（`*` 要留著，接著打 `[] ` 才會變成待辦清單）
   */
  onShortcut: (type: Shortcut, rest: string, state?: TaskState, marker?: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  onPaste: (e: ClipboardEvent<HTMLElement>) => void;
  onBlur: (el: HTMLElement, related: Element | null) => void;
  onSelect: () => void;
  /** 點任務符號（切換完成） */
  onTaskClick?: () => void;
  /** 在任務符號上按右鍵 */
  onTaskMenu?: (x: number, y: number) => void;
  /** 點任務的日期時間標籤 */
  onWhenMenu?: (x: number, y: number) => void;
}

/** 所見即所得編輯的區塊：可編輯的元素，內容是渲染後的行內 Markdown。 */
export const RichBlock = forwardRef<Surface, Props>(function RichBlock(p, ref) {
  const elRef = useRef<HTMLElement | null>(null);
  /** 目前 DOM 代表的原始碼；props.text 不同時才重新渲染（打字時不重畫，游標與輸入法才不會亂） */
  const last = useRef<string | null>(null);
  const shapeRef = useRef(p.shape);
  shapeRef.current = p.shape;
  const envRef = useRef(p.env);
  envRef.current = p.env;
  /** 接著打的字要有（on）或沒有的格式；游標移走、重畫時清掉 */
  const pending = useRef<{ spec: FormatSpec; on: boolean } | null>(null);
  /** 上一次輸入時的純文字（判斷任務快捷是不是這次才打出來的） */
  const prevPlain = useRef("");

  const MARK_OF = { strong: "bold", em: "italic", u: "underline", s: "strike", code: "code", a: "link" } as const;

  /** 把剛打的 len 個字套上（或拿掉）等待中的格式。 */
  const applyPending = (len: number) => {
    const pend = pending.current;
    const el = elRef.current;
    if (!pend || !el || len <= 0) return;
    const sel = el.ownerDocument.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return;
    const r = sel.getRangeAt(0);
    const from = backBy(el, r.startContainer, r.startOffset, len);
    if (!from) return;
    const end = forceFormat(el, from, [r.startContainer, r.startOffset], pend.spec, pend.on);
    if (end) placeCaret(el, end);
  };

  const markEmpty = () => {
    const el = elRef.current;
    if (el) el.dataset.empty = (el.textContent ?? "").replace(/[\u200B\s]/g, "") ? "" : "1";
  };

  useLayoutEffect(() => {
    const el = elRef.current;
    if (!el || p.text === last.current) return;
    last.current = p.text;
    pending.current = null;
    renderInto(el, p.shape.content, null, envRef.current);
    prevPlain.current = (el.textContent ?? "").replace(/​/g, "");
    markEmpty();
  });

  const current = () => {
    const el = elRef.current!;
    const r = serialize(el, envRef.current);
    return r;
  };

  useImperativeHandle(
    ref,
    (): Surface => ({
      get el() {
        return elRef.current!;
      },
      rich: true,
      text: () => last.current ?? p.text,
      sel: () => {
        const r = current();
        const shape = shapeRef.current;
        const a = contentToRegion(shape, r.content, r.a ?? r.content.length);
        const b = contentToRegion(shape, r.content, r.b ?? r.content.length);
        return [a, b];
      },
      setSel: (a, b) => {
        const el = elRef.current!;
        const r = current();
        const shape = shapeRef.current;
        const ca = regionToContent(shape, r.content, a);
        const cb = regionToContent(shape, r.content, b);
        pending.current = null;
        renderInto(el, r.content, [ca, cb], envRef.current);
        markEmpty();
      },
      focus: () => elRef.current?.focus({ preventScroll: false }),
      blur: () => elRef.current?.blur(),
      atStart: () => {
        const r = current();
        return r.a === 0 && r.b === 0;
      },
      atEnd: () => {
        const r = current();
        return r.b === r.content.length;
      },
      allSelected: () => {
        const r = current();
        return r.a === 0 && r.b === r.content.length;
      },
      firstLine: () => caretLine(elRef.current!).first,
      lastLine: () => caretLine(elRef.current!).last,
      marks: () => {
        const m = selectionMarks(elRef.current!);
        const pend = pending.current;
        if (!m || !pend) return m;
        // 等待中的格式：狀態列顯示接著打的字會是什麼樣子
        if (pend.spec.tag === "span") return { ...m, color: pend.on ? pend.spec.color : null };
        if (pend.spec.tag === "mark") return { ...m, highlight: pend.on ? pend.spec.color : null };
        return { ...m, [MARK_OF[pend.spec.tag]]: pend.on };
      },
      format: (spec, mode) => {
        const el = elRef.current!;
        const r = formatSelection(el, spec, mode, envRef.current);
        if (!r) return null;
        const shape = shapeRef.current;
        return {
          text: recompose(shape, r.content),
          a: contentToRegion(shape, r.content, r.a),
          b: contentToRegion(shape, r.content, r.b),
        };
      },
      saveSel: () => {
        const sel = elRef.current?.ownerDocument.getSelection();
        const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
        return () => {
          if (!range) return;
          elRef.current?.focus({ preventScroll: true });
          const s = elRef.current?.ownerDocument.getSelection();
          s?.removeAllRanges();
          s?.addRange(range);
        };
      },
      typingStyle: (spec) => {
        const el = elRef.current!;
        const m = domMarks(el);
        if (!m) return false;
        let on: boolean;
        if (spec.tag === "span" || spec.tag === "mark") on = spec.color !== null;
        else {
          const cur = pending.current && pending.current.spec.tag === spec.tag ? pending.current.on : m[MARK_OF[spec.tag]];
          on = !cur;
        }
        // 先試著把游標放到對的位置（零寬元素）；之後每打一個字再確認一次
        toggleAtCaret(el, spec);
        pending.current = { spec, on };
        return true;
      },
      split: () => {
        const parts = splitAt(elRef.current!, envRef.current);
        if (!parts) return null;
        return { before: recompose(shapeRef.current, parts.before), after: parts.after };
      },
    }),
    [p.text],
  );

  const onInput = (e?: React.FormEvent<HTMLElement>) => {
    const el = elRef.current;
    if (!el) return;
    const ne = e?.nativeEvent as InputEvent | undefined;
    // 剛打的字（不在輸入法組字中）：套上等待中的格式
    if (pending.current && ne && !ne.isComposing && ne.inputType?.startsWith("insert") && ne.data) {
      applyPending(ne.data.length);
    }
    markEmpty();
    const r = current();
    // 段落或清單項目開頭打 `[] `、`[x] `、`[o] `…（中文輸入法的「」【】、全形空白也算）：
    // 變成子彈筆記的任務。游標在快捷後面就觸發（輸入法一次送出整串時游標會更後面），
    // 但這次輸入之前開頭就已經是這樣的不算（例如在既有文字後面打字）。
    {
      const plain = (el.textContent ?? "").replace(/​/g, "");
      // 輸入法組字中不觸發，也不更新「上一次」（選好字時 compositionend 會再檢查一次）
      const composing = !!ne?.isComposing;
      const before = prevPlain.current;
      if (!composing) prevPlain.current = plain;
      const kind = p.kind ?? "paragraph";
      // 待辦清單（核取方塊）：段落開頭打 `*[] `、`*[x] `、`＊【】 `…
      const todo = todoShortcut(plain);
      if (
        todo &&
        !composing &&
        !todoShortcut(before) &&
        kind === "paragraph" &&
        caretPlain(el) >= todo.length
      ) {
        const rest = stripTodoShortcut(r.content);
        if (rest !== null) {
          last.current = null;
          p.onShortcut("todo", rest, todo.state);
          return;
        }
      }
      const tm = taskShortcut(plain);
      if (
        tm &&
        !composing &&
        !taskShortcut(before) &&
        (kind === "paragraph" || (kind === "item" && !shapeRef.current.task)) &&
        caretPlain(el) >= tm.length
      ) {
        // 內容裡的方括號是跳脫過的（`\[\] `）
        const rest = stripTaskShortcut(r.content);
        if (rest !== null) {
          last.current = null;
          // `* ` 項目裡打 `[] `／`[x] `：待辦清單；其他是子彈筆記的任務
          // `[] `、`[x] ` 是待辦清單；`{} `、`{x} `、`{o} `… 是子彈筆記的任務
          p.onShortcut(tm.check ? "todo" : "task", rest, tm.state);
          return;
        }
      }
    }
    // 段落開頭打區塊標記（# 、- 、1. 、> 、```）：轉成對應的區塊
    if (shapeRef.current.kind === "paragraph" && (p.kind ?? "paragraph") === "paragraph") {
      const plain = (el.textContent ?? "").replace(/\u00a0/g, " ").replace(/\u200B/g, "");
      for (const [re, type] of SHORTCUTS) {
        const m = /^(#{1,3} |[-*+] |1[.)] |> |```)/.exec(plain);
        if (m && re.test(m[0]) && caretPlain(el) === m[0].length) {
          const rest = r.content.replace(MARKER_SOURCE, "");
          last.current = null; // 接著一定會重畫
          p.onShortcut(type, rest, undefined, m[0][0]);
          return;
        }
      }
    }
    const shape = shapeRef.current;
    const text = recompose(shape, r.content);
    const caret = contentToRegion(shape, r.content, r.b ?? r.content.length);
    last.current = text;
    p.onText(text, caret);
  };

  const common = {
    ref: (el: HTMLElement | null) => {
      elRef.current = el;
    },
    className: "rich",
    contentEditable: true,
    suppressContentEditableWarning: true,
    spellCheck: false,
    "data-placeholder": p.placeholder,
    onInput,
    // 輸入法選好字：這時才套用等待中的格式（組字中動 DOM 會打斷輸入法）
    onCompositionEnd: (e: React.CompositionEvent<HTMLElement>) => {
      if (pending.current && e.data) {
        applyPending(e.data.length);
        onInput();
      } else if (
        taskShortcut((elRef.current?.textContent ?? "").replace(/\u200B/g, "")) ||
        todoShortcut((elRef.current?.textContent ?? "").replace(/\u200B/g, ""))
      ) {
        // 輸入法一次送出「」 之類的任務快捷
        onInput();
      }
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      // 游標移走：取消等待中的格式
      if (/^(Arrow|Home|End|Page)/.test(e.key)) pending.current = null;
      p.onKeyDown(e);
    },
    onMouseDown: () => {
      pending.current = null;
    },
    onPaste: p.onPaste,
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      const related = e.relatedTarget as Element | null;
      if (!related?.closest?.(".format-bar")) pending.current = null;
      p.onBlur(e.currentTarget, related);
    },
    onSelect: p.onSelect,
    onKeyUp: p.onSelect,
    onMouseUp: p.onSelect,
    onDrop: (e: React.DragEvent) => e.preventDefault(),
  };

  switch (p.kind) {
    case "heading": {
      const level = Math.min(Math.max(p.level ?? 1, 1), 6);
      const H = `h${level}` as "h1";
      return <H {...common} />;
    }
    case "item": {
      const task = p.shape.task;
      const li = (
        <li className={task ? `task t-${task}${p.shape.check ? " check" : ""}${p.shape.when ? " has-when" : ""}` : undefined}>
          {task && <TaskGlyph state={task} box={p.shape.check} onClick={p.onTaskClick} onMenu={p.onTaskMenu} />}
          <div {...common} />
          {task && p.shape.when && (
            <WhenChip
              date={p.shape.when.date}
              label={whenLabel(p.shape.when.date, p.shape.when.time)}
              state={task}
              onClick={p.onWhenMenu}
            />
          )}
        </li>
      );
      return p.list?.ordered ? <ol start={p.list.number}>{li}</ol> : <ul>{li}</ul>;
    }
    case "quote":
      return (
        <blockquote>
          <p {...common} />
        </blockquote>
      );
    default:
      return <p {...common} />;
  }
});

/** 游標前面有幾個看得到的字（區塊標記快捷鍵用）。 */
function caretPlain(el: HTMLElement): number {
  const sel = el.ownerDocument.getSelection();
  if (!sel || !sel.rangeCount) return -1;
  const r = sel.getRangeAt(0);
  const pre = el.ownerDocument.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().replace(/\u200B/g, "").length;
}
