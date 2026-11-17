import DOMPurify from "dompurify";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type ReactNode,
} from "react";
import { BLOCK_TYPES, filterBlockTypes, kindLabel } from "./blockTypes";
import { CopyIcon, GripIcon, IndentIcon, LinkIcon, OutdentIcon, PlusIcon, TrashIcon } from "./icons";
import { caretFromPoint } from "./caret";
import {
  blocksMarkdown,
  canDrop,
  canIndent,
  canOutdent,
  deleteBlocks,
  duplicateBlocks,
  groupOf,
  indentBlock,
  indentBlocks,
  moveBlocks,
  pasteAfter,
  pasteInto,
  rangeOf,
  placeBesideMany,
  reselect,
  topLevel,
  outdentBlock,
  placeBeside,
  setColumnWidths,
  treeWith,
  type DropPos,
  type Picked,
} from "./layout";
import { parseDoc, type Container, type ParsedDoc, type TreeNode, type Unit } from "./markdown";
import {
  EMPTY_BLOCK,
  activate,
  applyText,
  backspaceAtStart,
  deactivate,
  insertEmptyAfter,
  moveUnit,
  nextUnit,
  prevUnit,
  regionText,
  regionUnit,
  splitBlock,
  turnInto,
  turnRegionInto,
  type BlockType,
  type EditorState,
} from "./ops";
import "./editor.css";

// ─── 共用小工具 ────────────────────────────────────────────────

const sanitized = new Map<string, string>();
function clean(html: string): string {
  let out = sanitized.get(html);
  if (out === undefined) {
    if (sanitized.size > 2000) sanitized.clear();
    out = DOMPurify.sanitize(html);
    sanitized.set(html, out);
  }
  return out;
}

async function openLink(href: string) {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(href);
  } catch {
    window.open(href, "_blank", "noopener");
  }
}

/** 剪貼簿中標記「這是 Banyan 的區塊」的格式 */
const BLOCKS_MIME = "application/x-banyan-blocks";

const MARKER = /^(\s*)([-+*]|\d{1,9}[.)])[ \t]+/;

interface Slash {
  pos: number;
  index: number;
}

/** 拖曳中的區塊。用指標事件自己做，不用 HTML5 拖放（Tauri 在 Windows 上會攔截它）。 */
interface Drag {
  from: Unit;
  /** 一起拖曳的區塊（多選時不只一個） */
  many: Picked[];
  drop: Drop | null;
  x: number;
  y: number;
  label: string;
}

/** 放置位置：目標區塊（起始行）與方向；左右表示形成多欄。 */
interface Drop {
  start: number;
  pos: DropPos;
}

interface History {
  past: EditorState[];
  future: EditorState[];
  last: number;
}

export interface EditorProps {
  value: string;
  onChange: (markdown: string) => void;
}

// ─── 編輯器 ────────────────────────────────────────────────────

export function Editor({ value, onChange }: EditorProps) {
  const [state, setStateRaw] = useState<EditorState>({ source: value, region: null, caret: 0 });
  const [slash, setSlash] = useState<Slash | null>(null);
  const [menu, setMenu] = useState<{ unit: Unit; x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [resize, setResize] = useState<Record<number, number> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const history = useRef<History>({ past: [], future: [], last: 0 });
  const taRef = useRef<HTMLTextAreaElement>(null);
  // 區塊選取：選取的區塊（起始行）、Shift 延伸的起點與終點、框選的矩形
  const [selected, setSelected] = useState<number[]>([]);
  const selRef = useRef<number[]>([]);
  const anchorRef = useRef<number | null>(null);
  const focusRef = useRef<number | null>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const select = useCallback((starts: number[], anchor?: number | null, focus?: number | null) => {
    const sorted = [...new Set(starts)].sort((a, b) => a - b);
    selRef.current = sorted;
    setSelected(sorted);
    if (anchor !== undefined) anchorRef.current = anchor;
    if (focus !== undefined) focusRef.current = focus;
  }, []);

  const doc = useMemo(() => parseDoc(state.source), [state.source]);

  // 外部改了 value（例如原始碼面板）就採用
  useEffect(() => {
    if (value !== stateRef.current.source) {
      const next = { source: value, region: null, caret: 0 };
      stateRef.current = next;
      setStateRaw(next);
    }
  }, [value]);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  /** 換掉目前狀態，並同步通知外部（不能放在 effect 裡，否則會跟 value 互相覆蓋）。 */
  const replace = useCallback((next: EditorState) => {
    const changed = next.source !== stateRef.current.source;
    stateRef.current = next;
    setStateRaw(next);
    if (changed) onChangeRef.current(next.source);
    // 內容改了或開始編輯，選取就失效（選取操作會在之後重新設定）
    if ((changed || next.region) && selRef.current.length) {
      selRef.current = [];
      setSelected([]);
    }
  }, []);

  /** 更新狀態並記錄復原點；連續打字會合併成一筆。 */
  const commit = useCallback((next: EditorState, typing = false) => {
    const h = history.current;
    const prev = stateRef.current;
    if (next.source !== prev.source) {
      const now = Date.now();
      if (!typing || now - h.last > 800) {
        h.past.push(prev);
        if (h.past.length > 300) h.past.shift();
      }
      h.last = typing ? now : 0;
      h.future = [];
    }
    replace(next);
  }, [replace]);

  const undo = useCallback((redo: boolean) => {
    const h = history.current;
    const from = redo ? h.future : h.past;
    const to = redo ? h.past : h.future;
    const s = from.pop();
    if (!s) return;
    to.push(stateRef.current);
    h.last = 0;
    setSlash(null);
    replace(s);
  }, [replace]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "z" || k === "y") {
        if ((e.target as HTMLElement)?.closest?.(".md-source-panel")) return;
        e.preventDefault();
        undo(k === "y" || e.shiftKey);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  // 套用游標位置、自動調整高度
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta || !state.region) return;
    ta.style.height = "0px";
    ta.style.height = ta.scrollHeight + "px";
    if (document.activeElement !== ta) ta.focus({ preventScroll: false });
    if (ta.selectionStart !== state.caret || ta.selectionEnd !== state.caret) {
      ta.setSelectionRange(state.caret, state.caret);
    }
  }, [state]);

  const region = state.region;
  const editText = region ? regionText(doc.lines, region) : "";
  const editUnit = region ? regionUnit(doc, region) : undefined;

  // ─── 編輯區事件 ────────────────────────────────────────────

  const onTextChange = (text: string, caret: number) => {
    const prev = editText;
    const next = applyText(stateRef.current, text, caret);
    commit(next, true);
    // 編輯區往上擴張時，編輯區內的偏移會整體位移
    const shift = next.caret - caret;
    const kind = editUnit?.kind;
    const grew = text.length - prev.length;
    if (!slash && grew > 0 && kind !== "code" && kind !== "html") {
      // 這次輸入的內容裡有「/」，且它在行首或空白後、後面沒有空白：開啟選單
      const at = text.lastIndexOf("/", caret - 1);
      if (at >= caret - grew && (at === 0 || /\s/.test(text[at - 1])) && !/\s/.test(text.slice(at + 1, caret))) {
        setSlash({ pos: at + shift, index: 0 });
        return;
      }
    }
    if (slash && next.region) {
      const nextText = regionText(next.source.split("\n"), next.region);
      const pos = slash.pos + shift;
      const query = nextText.slice(pos + 1, next.caret);
      if (
        next.caret <= pos ||
        nextText[pos] !== "/" ||
        /\s/.test(query) ||
        (!filterBlockTypes(query).length && query.length > 3)
      ) {
        setSlash(null);
      } else if (shift) {
        setSlash({ ...slash, pos });
      }
    }
  };

  const slashQuery = slash && region ? editText.slice(slash.pos + 1, state.caret) : "";
  const slashItems = slash ? filterBlockTypes(slashQuery) : [];

  const pickSlash = (type: BlockType) => {
    if (!slash) return;
    const s = stateRef.current;
    const text = editText.slice(0, slash.pos) + editText.slice(s.caret);
    setSlash(null);
    commit(turnRegionInto(s, text, type));
  };

  const go = (unit: Unit | undefined, caret: number | "end") => {
    if (!unit) return false;
    setSlash(null);
    commit(activate(stateRef.current, unit, caret));
    return true;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const ta = e.currentTarget;
    const { selectionStart: a, selectionEnd: b, value: text } = ta;
    const s = stateRef.current;
    if (!s.region) return;

    if (slash && slashItems.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        setSlash({ ...slash, index: (slash.index + d + slashItems.length) % slashItems.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickSlash(slashItems[Math.min(slash.index, slashItems.length - 1)].type);
        return;
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (slash) setSlash(null);
      else {
        // 離開編輯並選取這個區塊（再按方向鍵可以移動選取、Delete 刪除…）
        const start = s.region.start;
        const map = leaveEditing();
        const b = parseDoc(stateRef.current.source).blocks.find((u) => u.start === map(start));
        if (b) select([b.start], b.start, b.start);
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && a === 0 && b === text.length) {
      // 文字已經全選時再按 Ctrl+A：選取所有區塊
      e.preventDefault();
      leaveEditing();
      selectAll();
      return;
    }

    const kind = editUnit?.kind ?? "paragraph";
    const sync = { ...s, caret: a };

    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.shiftKey) {
        if (kind === "paragraph" || kind === "item" || kind === "quote") {
          e.preventDefault();
          // CommonMark 的硬換行：行尾反斜線
          commit(applyText(sync, text.slice(0, a) + "\\\n" + text.slice(b), a + 2));
        }
        return;
      }
      const next = splitBlock({ ...sync, source: s.source }, a);
      if (next) {
        e.preventDefault();
        if (a !== b) return;
        setSlash(null);
        commit(next);
      }
      return;
    }

    if (e.key === "Backspace" && a === 0 && b === 0) {
      const next = backspaceAtStart(sync);
      e.preventDefault();
      if (next) commit(next);
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      if (kind === "item") {
        const lines = text.split("\n");
        const prev = prevUnit(doc, s.region);
        const width = prev?.list ? (MARKER.exec(doc.lines[prev.start])?.[0].length ?? 2) : 2;
        if (e.shiftKey) {
          const out = lines.map((l) => l.replace(new RegExp(`^ {1,${width}}`), ""));
          const removed = lines[0].length - out[0].length;
          commit(applyText(sync, out.join("\n"), Math.max(0, a - removed)));
        } else if (prev?.list) {
          const pad = " ".repeat(width);
          commit(applyText(sync, lines.map((l) => (l ? pad + l : l)).join("\n"), a + width));
        }
      } else if (kind === "code") {
        commit(applyText(sync, text.slice(0, a) + "  " + text.slice(b), a + 2));
      } else {
        // 其他區塊：Tab 增加縮排、Shift+Tab 減少縮排
        setSlash(null);
        shiftIndent(s.region, e.shiftKey, a);
      }
      return;
    }

    if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || a !== b) return;
    if (e.key === "ArrowUp" && !text.slice(0, a).includes("\n")) {
      if (go(prevUnit(doc, s.region), "end")) e.preventDefault();
    } else if (e.key === "ArrowDown" && !text.slice(a).includes("\n")) {
      if (go(nextUnit(doc, s.region), 0)) e.preventDefault();
    } else if (e.key === "ArrowLeft" && a === 0) {
      if (go(prevUnit(doc, s.region), "end")) e.preventDefault();
    } else if (e.key === "ArrowRight" && a === text.length) {
      if (go(nextUnit(doc, s.region), 0)) e.preventDefault();
    }
  };

  const onBlur = (ta: HTMLTextAreaElement, renderedStart: number) => {
    if (!document.hasFocus()) return; // 只是切換到別的視窗
    const s = stateRef.current;
    // 已經換到別的編輯區（舊 textarea 卸載或被新的搶走焦點）就不處理
    if (!s.region || s.region.start !== renderedStart || taRef.current !== ta || !ta.isConnected) return;
    setSlash(null);
    commit(deactivate(s).state);
  };

  // ─── 區塊事件 ──────────────────────────────────────────────

  /** 離開編輯（空白區塊會變成 &nbsp;），回傳行號對照。 */
  const leaveEditing = () => {
    const s = stateRef.current;
    setSlash(null);
    if (!s.region) return (l: number) => l;
    const d = deactivate(s);
    commit(d.state);
    taRef.current?.blur();
    return d.map;
  };

  const blocksNow = () => parseDoc(stateRef.current.source).blocks;

  /** 兩個區塊之間（含）的所有區塊。 */
  const rangeBetween = (a: number, b: number): number[] => {
    const blocks = blocksNow();
    const i = blocks.findIndex((u) => u.start === a);
    const j = blocks.findIndex((u) => u.start === b);
    if (i < 0 || j < 0) return [];
    return blocks.slice(Math.min(i, j), Math.max(i, j) + 1).map((u) => u.start);
  };

  const selectAll = () => {
    const blocks = blocksNow();
    if (!blocks.length) return;
    select(
      blocks.map((u) => u.start),
      blocks[0].start,
      blocks[blocks.length - 1].start,
    );
  };

  /** Shift+點擊：從起點延伸選取到這個區塊。 */
  const extendTo = (unit: Unit) => {
    const s = stateRef.current;
    const editing = s.region?.start ?? null;
    const map = leaveEditing();
    const target = map(unit.start);
    const anchor = anchorRef.current ?? (editing !== null ? map(editing) : target);
    const valid = blocksNow().some((u) => u.start === anchor) ? anchor : target;
    select(rangeBetween(valid, target), valid, target);
  };

  /** Ctrl+點擊：加入或移出選取。 */
  const toggle = (unit: Unit) => {
    const map = leaveEditing();
    const start = map(unit.start);
    const cur = selRef.current;
    select(cur.includes(start) ? cur.filter((x) => x !== start) : [...cur, start], start, start);
  };

  const onUnitMouseDown = (e: MouseEvent<HTMLDivElement>, unit: Unit) => {
    if (e.button !== 0) return;
    const link = (e.target as HTMLElement).closest("a");
    e.preventDefault();
    setMenu(null);
    if (link && (e.ctrlKey || e.metaKey)) {
      const href = link.getAttribute("href");
      if (href) void openLink(href);
      return;
    }
    if (e.shiftKey) return extendTo(unit);
    if (e.ctrlKey || e.metaKey) return toggle(unit);

    // 一般按下：放開時開始編輯；按著拖到別的區塊則改成選取一段區塊
    const src = regionText(doc.lines, unit);
    const caret = caretFromPoint(e.currentTarget, e.clientX, e.clientY, src);
    let origin = unit.start;
    let ranging = false;
    const move = (ev: PointerEvent) => {
      const row = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>(
        ".row[data-start]",
      );
      if (!row) return;
      const over = Number(row.dataset.start);
      if (!ranging) {
        if (over === origin) return;
        ranging = true;
        origin = leaveEditing()(origin);
        window.getSelection()?.removeAllRanges();
      }
      select(rangeBetween(origin, over), origin, over);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!ranging) {
        select([]);
        anchorRef.current = null;
        go(unit, caret);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const addAfter = (unit: Unit | null) => {
    setMenu(null);
    const s = stateRef.current;
    if (unit?.list) {
      // 在清單項目後面加：新增同一份清單的項目
      const at = activate(s, unit, "end");
      const next = splitBlock(at, at.region ? regionText(at.source.split("\n"), at.region).length : 0);
      if (next) {
        commit(applyText(next, regionText(next.source.split("\n"), next.region!) + "/", next.caret + 1));
        setSlash({ pos: next.caret, index: 0 });
        return;
      }
    }
    const end = unit ? unit.end : doc.lines.length;
    const next = insertEmptyAfter(s, end, "/");
    commit(next);
    setSlash({ pos: 0, index: 0 });
  };

  /** 點文件下方的空白處：最後一個區塊是空白區塊就編輯它，否則在最後新增一個。 */
  const onTailClick = () => {
    const s = stateRef.current;
    const cur = parseDoc(s.source);
    const last = cur.units[cur.units.length - 1];
    if (s.region && (!last || s.region.start >= last.end) && /^\s*$/.test(regionText(cur.lines, s.region))) {
      taRef.current?.focus();
      return;
    }
    const lastBlock = cur.blocks[cur.blocks.length - 1];
    if (lastBlock && lastBlock.start === last?.start && cur.lines[lastBlock.start].trim() === EMPTY_BLOCK) {
      commit(activate(s, lastBlock, 0));
      return;
    }
    commit(insertEmptyAfter(s, last ? last.end : 0));
  };

  const turnUnitInto = (unit: Unit, type: BlockType) => {
    setMenu(null);
    const s = stateRef.current;
    const t = turnInto(regionText(doc.lines, unit), type);
    const next = applyText({ source: s.source, region: { start: unit.start, end: unit.end }, caret: 0 }, t.text, 0);
    commit({ ...next, region: null });
  };

  /** 指標位置對應到放置的位置：最近的區塊，以及上、下、左、右。 */
  const dropAt = (x: number, y: number, from: Unit, many: Unit[]): Drop | null => {
    const fromStart = from.start;
    const cur = parseDoc(stateRef.current.source);
    // 正在搬的範圍（多欄整組、區塊連同子區塊）裡的區塊都不能當目標
    const ranges = many.map((m) => rangeOf(cur, m));
    const rowsEl = [...document.querySelectorAll<HTMLElement>(".md-editor .row[data-start]")].filter((el) => {
      const start = Number(el.dataset.start);
      if (start === fromStart) return true;
      if (ranges.some((r) => start >= r.start && start < r.end)) return false;
      const t = cur.blocks.find((u) => u.start === start);
      // 不能放進自己的子區塊；有子區塊的區塊不能放進縮排
      return t ? many.every((m) => canDrop(cur, m, t)) : false;
    });
    let best: HTMLElement | null = null;
    let bestD = Infinity;
    for (const el of rowsEl) {
      const r = el.getBoundingClientRect();
      const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      const d = dx * dx + dy * dy * 4;
      if (d < bestD) {
        bestD = d;
        best = el;
      }
    }
    if (!best) return null;
    const start = Number(best.dataset.start);
    const r = best.getBoundingClientRect();
    // 指標進入區塊左緣一小段 → 放左邊；右側四分之一 → 放右邊（形成多欄）
    const edge = Math.min(56, r.width * 0.2);
    let pos: DropPos;
    if (x >= r.left && x < r.left + edge && start !== fromStart) pos = "left";
    else if (x > r.right - Math.max(edge, r.width * 0.25) && start !== fromStart) pos = "right";
    else pos = y < r.top + r.height / 2 ? "before" : "after";
    return { start, pos };
  };

  const onHandlePointerDown = (e: ReactPointerEvent<HTMLButtonElement>, unit: Unit) => {
    if (e.button !== 0) return;
    e.preventDefault(); // 不讓編輯中的 textarea 失焦，也不選取文字
    if (e.shiftKey) return extendTo(unit);
    if (e.ctrlKey || e.metaKey) return toggle(unit);
    const handle = e.currentTarget;
    const startX = e.clientX;
    const startY = e.clientY;
    let current: Drag | null = null;

    const move = (ev: PointerEvent) => {
      if (!current) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
        // 開始拖曳：先關閉編輯區，並找出行號位移後對應的區塊
        const map = leaveEditing();
        const s = stateRef.current;
        const cur = parseDoc(s.source);
        const from = cur.blocks.find((u) => u.start === map(unit.start));
        if (!from) return cleanup();
        setMenu(null);
        // 拖曳的區塊在多選裡：整組選取一起搬
        const sel = selRef.current;
        const many: Picked[] = sel.length > 1 && sel.includes(from.start) ? topLevel(cur, sel.map((st) => ({ start: st, end: st + 1 }))) : [from];
        const grouped = many.length > 1 || !!many[0]?.whole;
        if (!grouped) select([]);
        const kids = groupOf(cur, from).end > from.end;
        const label = grouped
          ? many.map((m) => (m.whole ? "多欄" : null)).filter(Boolean).length === many.length
            ? "多欄排版"
            : `${many.length} 個單位` + (many.some((m) => m.whole) ? "（含多欄）" : "")
          : regionText(s.source.split("\n"), from).slice(0, 80) + (kids ? "  ＋子區塊" : "");
        current = { from, many, drop: null, x: 0, y: 0, label };
      }
      current = { ...current, x: ev.clientX, y: ev.clientY, drop: dropAt(ev.clientX, ev.clientY, current.from, current.many) };
      setDrag(current);
    };

    const up = () => {
      cleanup();
      if (!current) {
        // 沒有移動：當作點擊，選取這個區塊（已在多選裡就保留多選）並開啟區塊選單
        const map = leaveEditing();
        const start = map(unit.start);
        if (!selRef.current.includes(start)) select([start], start, start);
        const r = handle.getBoundingClientRect();
        const u = blocksNow().find((b) => b.start === start);
        if (u) setMenu({ unit: u, x: r.left, y: r.bottom + 4 });
        return;
      }
      const { from, many, drop } = current;
      setDrag(null);
      if (!drop || drop.start === from.start) return;
      const source = stateRef.current.source;
      const blocks = parseDoc(source).blocks;
      const x = blocks.find((u) => u.start === from.start);
      const target = blocks.find((u) => u.start === drop.start);
      if (!x || !target) return;
      if (many.length > 1 || many[0]?.whole) {
        const texts = many.map((m) => source.split("\n").slice(m.start, m.end).join("\n"));
        const side = drop.pos === "left" || drop.pos === "right";
        const res = side
          ? { source: placeBesideMany(source, many, target, drop.pos as "left" | "right"), starts: [] as number[] }
          : moveBlocks(source, many, target, drop.pos as "before" | "after");
        if (res.source === source) return;
        commit({ source: res.source, region: null, caret: 0 });
        const starts = side ? reselect(res.source, texts) : res.starts;
        select(starts, starts[0] ?? null, starts[starts.length - 1] ?? null);
        return;
      }
      const next =
        drop.pos === "left" || drop.pos === "right"
          ? placeBeside(source, x, target, drop.pos)
          : moveUnit(source, x, target, drop.pos);
      if (next !== source) commit({ source: next, region: null, caret: 0 });
    };

    const key = (ev: globalThis.KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      current = null;
      setDrag(null);
      cleanup();
    };

    function cleanup() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", key);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("keydown", key);
  };

  /** 拖曳欄位之間的空隙調整欄寬。 */
  const onGapPointerDown = (e: ReactPointerEvent<HTMLDivElement>, a: Container, b: Container) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const gap = e.currentTarget.parentElement as HTMLElement;
    const left = gap.previousElementSibling as HTMLElement | null;
    const right = gap.nextElementSibling as HTMLElement | null;
    if (!left || !right) return;
    const pa = left.getBoundingClientRect().width;
    const pb = right.getBoundingClientRect().width;
    const sum = a.width + b.width;
    const startX = e.clientX;
    let result: Record<number, number> | null = null;
    gap.classList.add("active");

    const move = (ev: PointerEvent) => {
      const min = 64;
      const na = Math.min(Math.max(pa + ev.clientX - startX, min), pa + pb - min);
      result = { [a.open.start]: (sum * na) / (pa + pb), [b.open.start]: (sum * (pa + pb - na)) / (pa + pb) };
      setResize(result);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      gap.classList.remove("active");
      setResize(null);
      if (!result) return;
      const s = stateRef.current;
      const widths = Object.entries(result).map(([line, width]) => ({ line: Number(line), width }));
      commit({ ...s, source: setColumnWidths(s.source, widths) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  /** 縮排或減少縮排，完成後繼續編輯同一個區塊。 */
  const shiftIndent = (r: { start: number; end: number }, outdent: boolean, caret: number | null) => {
    const s = stateRef.current;
    const res = outdent ? outdentBlock(s.source, r) : indentBlock(s.source, r);
    if (!res) return false;
    const target = { start: res.start, end: res.start + (r.end - r.start) };
    const next = { source: res.source, region: null, caret: 0 };
    commit(caret === null ? next : activate(next, target, caret));
    return true;
  };

  // ─── 區塊選取：鍵盤、剪貼簿、框選 ───────────────────────────

  /** 目前選取的區塊（拿掉跟著父區塊的子區塊）。 */
  const selectedBlocks = () => {
    const cur = parseDoc(stateRef.current.source);
    return topLevel(cur, selRef.current.map((st) => ({ start: st, end: st + 1 })));
  };

  const applyMany = (res: { source: string; starts: number[] }) => {
    if (res.source === stateRef.current.source) return;
    commit({ source: res.source, region: null, caret: 0 });
    select(res.starts, res.starts[0] ?? null, res.starts[res.starts.length - 1] ?? null);
  };

  const deleteSelected = () => {
    const xs = selectedBlocks();
    if (!xs.length) return;
    const source = stateRef.current.source;
    const blocks = parseDoc(source).blocks;
    const next = deleteBlocks(source, xs);
    commit({ source: next, region: null, caret: 0 });
    // 刪除後選取原本位置附近的區塊
    const firstIdx = Math.max(0, blocks.findIndex((b) => b.start >= xs[0].start));
    const after = parseDoc(next).blocks;
    const keep = after[Math.min(firstIdx, after.length - 1)] ?? null;
    select(keep ? [keep.start] : [], keep?.start ?? null, keep?.start ?? null);
  };

  const turnSelectedInto = (type: BlockType) => {
    const xs = selectedBlocks();
    let source = stateRef.current.source;
    const texts: string[] = [];
    for (const x of [...xs].reverse()) {
      if (x.whole) continue; // 多欄本身不能轉換類型
      const lines = source.split("\n");
      const t = turnInto(lines.slice(x.start, x.end).join("\n"), type);
      texts.unshift(t.text);
      lines.splice(x.start, x.end - x.start, ...t.text.split("\n"));
      source = lines.join("\n");
    }
    const starts = reselect(source, texts);
    applyMany({ source, starts });
  };

  /**
   * 在編輯中的區塊裡貼上：從 Banyan 複製的區塊、或多行的 Markdown，直接變成區塊
   * （在游標處切開，貼上的區塊放在中間並選取）；單行文字照一般方式貼進文字框。
   */
  const onTextPaste = (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const s = stateRef.current;
    if (!s.region) return;
    const kind = editUnit?.kind;
    if (kind === "code" || kind === "html") return; // 程式碼裡就是文字
    const blocks = e.clipboardData.getData(BLOCKS_MIME);
    const text = blocks || e.clipboardData.getData("text/plain");
    if (!text || (!blocks && !text.replace(/\r?\n+$/, "").includes("\n"))) return;
    e.preventDefault();
    const ta = e.currentTarget;
    setSlash(null);
    const res = pasteInto(s.source, s.region, ta.selectionStart, ta.selectionEnd, text);
    commit({ source: res.source, region: null, caret: 0 });
    ta.blur();
    select(res.starts, res.starts[0] ?? null, res.starts[res.starts.length - 1] ?? null);
  };

  const selectionKeys = useRef<(e: globalThis.KeyboardEvent) => void>(() => {});
  selectionKeys.current = (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest?.("textarea, input, .md-source-panel")) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === "a") {
      e.preventDefault();
      selectAll();
      return;
    }
    if (!selRef.current.length || e.isComposing) return;
    const blocks = blocksNow();
    const focus = focusRef.current ?? selRef.current[selRef.current.length - 1];
    const fi = blocks.findIndex((u) => u.start === focus);
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        select([], null, null);
        return;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        deleteSelected();
        return;
      case "Enter": {
        e.preventDefault();
        const first = blocks.find((u) => u.start === selRef.current[0]);
        select([], null, null);
        if (first) go(first, "end");
        return;
      }
      case "Tab":
        e.preventDefault();
        applyMany(indentBlocks(stateRef.current.source, selectedBlocks(), e.shiftKey));
        return;
      case "ArrowUp":
      case "ArrowDown": {
        e.preventDefault();
        const ni = Math.min(Math.max(fi + (e.key === "ArrowDown" ? 1 : -1), 0), blocks.length - 1);
        const next = blocks[ni];
        if (!next) return;
        if (e.shiftKey) {
          const anchor = anchorRef.current ?? focus;
          select(rangeBetween(anchor, next.start), anchor, next.start);
        } else {
          select([next.start], next.start, next.start);
        }
        next && document.querySelector(`.row[data-start="${next.start}"]`)?.scrollIntoView({ block: "nearest" });
        return;
      }
    }
    if (ctrl && e.key.toLowerCase() === "d") {
      e.preventDefault();
      applyMany(duplicateBlocks(stateRef.current.source, selectedBlocks()));
    }
  };

  const clipboard = useRef<(e: ClipboardEvent) => void>(() => {});
  clipboard.current = (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest?.("textarea, input, .md-source-panel") || !selRef.current.length) return;
    const xs = selectedBlocks();
    if (e.type === "paste") {
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!text) return;
      e.preventDefault();
      applyMany(pasteAfter(stateRef.current.source, xs[xs.length - 1] ?? null, text));
      return;
    }
    e.preventDefault();
    const markdown = blocksMarkdown(stateRef.current.source, xs) + "\n";
    e.clipboardData?.setData("text/plain", markdown);
    // 標記這是 Banyan 的區塊，貼到編輯中的區塊時才知道要當區塊貼上
    e.clipboardData?.setData(BLOCKS_MIME, markdown);
    if (e.type === "cut") deleteSelected();
  };

  /** 在頁面空白處按下拖曳：框選區塊；沒有拖曳就是點一下（取消選取，或在文件下方新增區塊）。 */
  const boxDown = useRef<(e: PointerEvent) => void>(() => {});
  boxDown.current = (e) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (!t.closest?.(".page, .md-editor")) return;
    if (t.closest(".row .content, .gutter, .popover, .grip, textarea, .md-source-panel")) return;
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const onTail = !!t.closest(".tail");
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
        moved = true;
        leaveEditing();
        setMenu(null);
      }
      const left = Math.min(x0, ev.clientX);
      const top = Math.min(y0, ev.clientY);
      const width = Math.abs(ev.clientX - x0);
      const height = Math.abs(ev.clientY - y0);
      setBox({ left, top, width, height });
      const hits: number[] = [];
      document.querySelectorAll<HTMLElement>(".md-editor .row[data-start]").forEach((row) => {
        const r = row.querySelector(".content")!.getBoundingClientRect();
        if (r.right >= left && r.left <= left + width && r.bottom >= top && r.top <= top + height) {
          hits.push(Number(row.dataset.start));
        }
      });
      select(hits, hits[0] ?? null, hits[hits.length - 1] ?? null);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setBox(null);
      if (moved) return;
      setMenu(null);
      select([], null, null);
      if (onTail) onTailClick();
      else leaveEditing();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => selectionKeys.current(e);
    const clip = (e: ClipboardEvent) => clipboard.current(e);
    const down = (e: PointerEvent) => boxDown.current(e);
    window.addEventListener("keydown", key);
    document.addEventListener("copy", clip);
    document.addEventListener("cut", clip);
    document.addEventListener("paste", clip);
    document.addEventListener("pointerdown", down);
    return () => {
      window.removeEventListener("keydown", key);
      document.removeEventListener("copy", clip);
      document.removeEventListener("cut", clip);
      document.removeEventListener("paste", clip);
      document.removeEventListener("pointerdown", down);
    };
  }, []);

  // 畫面上要標示為選取的區塊：選取的區塊加上它們的子區塊
  const shownSelected = useMemo(() => {
    const set = new Set<number>();
    for (const st of selected) {
      const g = groupOf(doc, { start: st, end: st + 1 });
      for (const b of doc.blocks) if (b.start >= g.start && b.start < g.end) set.add(b.start);
    }
    return set;
  }, [selected, doc]);

  // ─── 畫面 ──────────────────────────────────────────────────

  const editorRow = region ? (
    <div
      className={`row editing kind-${editUnit?.kind ?? "paragraph"}${editUnit && isTitle(editUnit, doc) ? " is-title" : ""}`}
      key={`edit:${region.start}`}
    >
      <div className="gutter" />
      <div className="content">
        <textarea
          ref={taRef}
          className={`edit ${editUnit?.kind === "heading" ? `h${editUnit.level}` : ""}`}
          value={editText}
          spellCheck={false}
          rows={1}
          placeholder={editText ? "" : "輸入文字，或按「/」選擇區塊類型"}
          onChange={(e) => onTextChange(e.target.value, e.target.selectionStart)}
          onSelect={(e) => {
            const c = e.currentTarget.selectionStart;
            if (c !== stateRef.current.caret) stateRef.current = { ...stateRef.current, caret: c };
          }}
          onKeyDown={onKeyDown}
          onPaste={onTextPaste}
          onBlur={(e) => onBlur(e.currentTarget, region.start)}
        />
        <span className="edit-badge" aria-hidden>
          {kindLabel(editUnit?.kind ?? "paragraph", editUnit?.level)}
          <kbd>Esc</kbd>
        </span>
        {slash && (
          <SlashMenu
            items={slashItems}
            active={Math.min(slash.index, slashItems.length - 1)}
            onPick={pickSlash}
            onHover={(i) => setSlash({ ...slash, index: i })}
          />
        )}
      </div>
    </div>
  ) : null;

  // 編輯區取代與它重疊的區塊，放進樹中對應的位置
  const view = useMemo(() => (region ? treeWith(doc, region) : { tree: doc.tree, self: null }), [doc, region]);

  const dragRanges = drag ? drag.many.map((m) => rangeOf(doc, m)) : [];

  const renderNodes = (nodes: TreeNode[]): ReactNode[] =>
    nodes.map((n) => {
      if (n.type === "leaf") {
        const u = n.unit;
        if (u === view.self) return editorRow;
        return (
          <UnitRow
            key={`${u.start}:${u.kind}`}
            unit={u}
            doc={doc}
            drop={drag?.drop?.start === u.start ? drag.drop.pos : null}
            dragging={dragRanges.some((r) => u.start >= r.start && u.start < r.end)}
            selected={shownSelected.has(u.start)}
            onMouseDown={(e) => onUnitMouseDown(e, u)}
            onAdd={() => addAfter(u)}
            onHandlePointerDown={(e) => onHandlePointerDown(e, u)}
          />
        );
      }
      if (n.kind === "columns") {
        const cols = n.children;
        const out: ReactNode[] = [];
        cols.forEach((c, i) => {
          const prev = cols[i - 1];
          if (i > 0 && prev.type === "container" && c.type === "container") {
            out.push(
              <div key={`gap:${c.open.start}`} className="col-gap">
                <div className="grip" title="拖曳調整欄寬" onPointerDown={(e) => onGapPointerDown(e, prev, c)} />
              </div>,
            );
          }
          if (c.type === "container") {
            const w = resize?.[c.open.start] ?? c.width;
            out.push(
              <div key={`col:${c.open.start}`} className="column" style={{ flex: `${w} 1 0` }}>
                {renderNodes(c.children)}
              </div>,
            );
          } else {
            out.push(...renderNodes([c]));
          }
        });
        return (
          <div key={`cols:${n.open.start}`} className="columns">
            {out}
          </div>
        );
      }
      const i = nodes.indexOf(n);
      const owner = nodes[i - 1];
      const dragged =
        n.kind === "indent" &&
        owner?.type === "leaf" &&
        dragRanges.some((r) => owner.unit.start >= r.start && owner.unit.start < r.end);
      return (
        <div
          key={`${n.kind}:${n.open.start}`}
          className={n.kind === "indent" ? `indent-block${dragged ? " dragging" : ""}` : "column"}
        >
          {renderNodes(n.children)}
        </div>
      );
    });

  const menuDoc = menu ? doc : null;

  return (
    <div className={`md-editor${drag ? " is-dragging" : ""}`}>
      {renderNodes(view.tree)}
      <div className="tail">
        {doc.units.length === 0 && !region && <span className="empty-hint">點這裡開始寫作…</span>}
      </div>
      {box && <div className="select-box" style={box} />}
      {drag && (
        <div className="drag-ghost" style={{ left: drag.x + 12, top: drag.y + 8 }}>
          {drag.label || "（空白）"}
        </div>
      )}
      {menu && menuDoc && (() => {
        const many = selected.length > 1 && selected.includes(menu.unit.start);
        const targets = many ? topLevel(menuDoc, selected.map((st) => ({ start: st, end: st + 1 }))) : [menu.unit];
        const noItems = targets.every((t) => t.kind !== "item");
        return (
          <BlockMenu
            x={menu.x}
            y={menu.y}
            count={targets.length}
            current={many ? null : blockTypeOf(menu.unit)}
            canIndent={noItems && targets.some((t) => canIndent(menuDoc, t))}
            canOutdent={noItems && targets.some((t) => canOutdent(menuDoc, t))}
            onClose={() => setMenu(null)}
            onTurn={(t) => {
              setMenu(null);
              if (many) turnSelectedInto(t);
              else turnUnitInto(menu.unit, t);
            }}
            onIndent={(outdent) => {
              setMenu(null);
              applyMany(indentBlocks(state.source, targets, outdent));
            }}
            onDuplicate={() => {
              setMenu(null);
              // 連同子區塊一起複製
              applyMany(duplicateBlocks(state.source, targets));
            }}
            onDelete={() => {
              setMenu(null);
              // 連同子區塊一起刪除
              select(targets.map((t) => t.start));
              deleteSelected();
            }}
          />
        );
      })()}
    </div>
  );
}

// ─── 區塊 ──────────────────────────────────────────────────────

interface UnitRowProps {
  unit: Unit;
  doc: ParsedDoc;
  drop: DropPos | null;
  dragging: boolean;
  selected: boolean;
  onMouseDown: (e: MouseEvent<HTMLDivElement>) => void;
  onAdd: () => void;
  onHandlePointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void;
}

function UnitRow({ unit, doc, drop, dragging, selected, ...on }: UnitRowProps) {
  let body: ReactNode;
  const html = { __html: clean(unit.html) };
  if (unit.kind === "item" && unit.list) {
    body = unit.list.ordered ? (
      <ol start={unit.list.number}>
        <li dangerouslySetInnerHTML={html} />
      </ol>
    ) : (
      <ul>
        <li dangerouslySetInnerHTML={html} />
      </ul>
    );
  } else if (unit.kind === "source") {
    body = (
      <div className="md-ref">
        <LinkIcon />
        <code>{regionText(doc.lines, unit)}</code>
      </div>
    );
  } else {
    body = <div dangerouslySetInnerHTML={html} />;
  }
  return (
    <div
      className={`row kind-${unit.kind}${isTitle(unit, doc) ? " is-title" : ""}${dragging ? " dragging" : ""}${selected ? " selected" : ""}`}
      data-start={unit.start}
    >
      {drop && <div className={`drop-indicator ${drop}`} />}
      <div className="gutter">
        <button className="add" title="在下方新增區塊" onMouseDown={(e) => e.preventDefault()} onClick={on.onAdd}>
          <PlusIcon />
        </button>
        <button className="handle" title="拖曳以搬移・點擊開啟選單" onPointerDown={on.onHandlePointerDown}>
          <GripIcon />
        </button>
      </div>
      <div className="content" onMouseDown={on.onMouseDown}>
        {body}
      </div>
    </div>
  );
}

// ─── 選單 ──────────────────────────────────────────────────────

/** 文件第一個區塊是一級標題時，當作頁面標題顯示。 */
function isTitle(unit: Unit, doc: ParsedDoc): boolean {
  return unit.kind === "heading" && unit.level === 1 && doc.units[0]?.start === unit.start;
}

/** 區塊目前對應的類型（區塊選單標出「目前」用）。 */
function blockTypeOf(unit: Unit): BlockType | null {
  switch (unit.kind) {
    case "paragraph":
      return "paragraph";
    case "heading":
      return unit.level && unit.level <= 3 ? (`h${unit.level}` as BlockType) : null;
    case "item":
      return unit.list?.ordered ? "ordered" : "bullet";
    case "quote":
      return "quote";
    case "code":
      return "code";
    case "hr":
      return "hr";
    default:
      return null;
  }
}

function SlashMenu(props: {
  items: typeof BLOCK_TYPES;
  active: number;
  onPick: (t: BlockType) => void;
  onHover: (i: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  }, [props.active]);
  return (
    <div className="popover slash-menu" onMouseDown={(e) => e.preventDefault()}>
      <div className="popover-scroll" ref={ref}>
        <div className="popover-title">基本區塊</div>
        {props.items.length === 0 && <div className="popover-empty">沒有符合的類型</div>}
        {props.items.map((t, i) => (
          <button
            key={t.type}
            className={i === props.active ? "active" : ""}
            onMouseEnter={() => props.onHover(i)}
            onClick={() => props.onPick(t.type)}
          >
            <span className="tile">{t.icon}</span>
            <span className="text">
              <span className="label">{t.label}</span>
              <span className="desc">{t.description}</span>
            </span>
            {t.hint && <kbd className="hint">{t.hint}</kbd>}
          </button>
        ))}
      </div>
      <div className="popover-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> 選擇
        </span>
        <span>
          <kbd>Enter</kbd> 確認
        </span>
        <span>
          <kbd>Esc</kbd> 關閉
        </span>
      </div>
    </div>
  );
}

function BlockMenu(props: {
  x: number;
  y: number;
  count: number;
  current: BlockType | null;
  canIndent: boolean;
  canOutdent: boolean;
  onClose: () => void;
  onTurn: (t: BlockType) => void;
  onIndent: (outdent: boolean) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: props.x, top: props.y });
  const { onClose } = props;
  useEffect(() => {
    const down = (e: globalThis.MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);
  // 靠近視窗底部或右邊時往內收
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const top = r.bottom > window.innerHeight - 8 ? Math.max(8, props.y - r.height - 32) : props.y;
    const left = Math.min(props.x, window.innerWidth - r.width - 8);
    setPos({ left: Math.max(8, left), top });
  }, [props.x, props.y]);
  return (
    <div className="popover block-menu" ref={ref} style={pos} onMouseDown={(e) => e.preventDefault()}>
      {props.count > 1 && <div className="popover-count">已選取 {props.count} 個區塊</div>}
      <div className="popover-title">轉換成</div>
      {BLOCK_TYPES.map((t) => (
        <button
          key={t.type}
          className={t.type === props.current ? "current" : ""}
          onClick={() => props.onTurn(t.type)}
        >
          <span className="tile small">{t.icon}</span>
          <span className="label">{t.label}</span>
          {t.type === props.current && <span className="check">✓</span>}
        </button>
      ))}
      <div className="popover-sep" />
      {props.canIndent && (
        <button onClick={() => props.onIndent(false)}>
          <span className="glyph">
            <IndentIcon />
          </span>
          <span className="label">增加縮排</span>
          <kbd className="hint">Tab</kbd>
        </button>
      )}
      {props.canOutdent && (
        <button onClick={() => props.onIndent(true)}>
          <span className="glyph">
            <OutdentIcon />
          </span>
          <span className="label">減少縮排</span>
          <kbd className="hint">⇧Tab</kbd>
        </button>
      )}
      <button onClick={props.onDuplicate}>
        <span className="glyph">
          <CopyIcon />
        </span>
        <span className="label">建立副本</span>
      </button>
      <button className="danger" onClick={props.onDelete}>
        <span className="glyph">
          <TrashIcon />
        </span>
        <span className="label">刪除</span>
      </button>
    </div>
  );
}
