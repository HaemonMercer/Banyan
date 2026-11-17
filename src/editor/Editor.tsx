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
  type ReactNode,
} from "react";
import { BLOCK_TYPES, filterBlockTypes, kindLabel } from "./blockTypes";
import { CopyIcon, GripIcon, IndentIcon, LinkIcon, OutdentIcon, PlusIcon, TrashIcon } from "./icons";
import { caretFromPoint } from "./caret";
import {
  canDrop,
  canIndent,
  canOutdent,
  groupOf,
  indentBlock,
  outdentBlock,
  placeBeside,
  setColumnWidths,
  treeWith,
  type DropPos,
} from "./layout";
import { parseDoc, type Container, type ParsedDoc, type TreeNode, type Unit } from "./markdown";
import {
  activate,
  applyText,
  backspaceAtStart,
  deactivate,
  deleteUnit,
  duplicateUnit,
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

const MARKER = /^(\s*)([-+*]|\d{1,9}[.)])[ \t]+/;

interface Slash {
  pos: number;
  index: number;
}

/** 拖曳中的區塊。用指標事件自己做，不用 HTML5 拖放（Tauri 在 Windows 上會攔截它）。 */
interface Drag {
  from: Unit;
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
        commit(deactivate(s).state);
        ta.blur();
      }
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

  const onUnitMouseDown = (e: MouseEvent<HTMLDivElement>, unit: Unit) => {
    if (e.button !== 0) return;
    const link = (e.target as HTMLElement).closest("a");
    e.preventDefault();
    if (link && (e.ctrlKey || e.metaKey)) {
      const href = link.getAttribute("href");
      if (href) void openLink(href);
      return;
    }
    const src = regionText(doc.lines, unit);
    const caret = caretFromPoint(e.currentTarget, e.clientX, e.clientY, src);
    setMenu(null);
    go(unit, caret);
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

  const onTailMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const s = stateRef.current;
    const last = doc.units[doc.units.length - 1];
    if (s.region && (!last || s.region.start >= last.end) && /^\s*$/.test(editText)) {
      taRef.current?.focus();
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
  const dropAt = (x: number, y: number, from: Unit): Drop | null => {
    const fromStart = from.start;
    const cur = parseDoc(stateRef.current.source);
    const rowsEl = [...document.querySelectorAll<HTMLElement>(".md-editor .row[data-start]")].filter((el) => {
      const start = Number(el.dataset.start);
      const t = cur.blocks.find((u) => u.start === start);
      // 不能放進自己的子區塊；有子區塊的區塊不能放進縮排
      return start === fromStart || (t ? canDrop(cur, from, t) : false);
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
    const handle = e.currentTarget;
    const startX = e.clientX;
    const startY = e.clientY;
    let current: Drag | null = null;

    const move = (ev: PointerEvent) => {
      if (!current) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
        // 開始拖曳：先關閉編輯區，並找出行號位移後對應的區塊
        let s = stateRef.current;
        let from: Unit | undefined = unit;
        if (s.region) {
          const d = deactivate(s);
          s = d.state;
          from = parseDoc(s.source).blocks.find((u) => u.start === d.map(unit.start));
          commit(s);
        }
        if (!from) return cleanup();
        setMenu(null);
        const kids = groupOf(parseDoc(s.source), from).end > from.end;
        const label = regionText(s.source.split("\n"), from).slice(0, 80) + (kids ? "  ＋子區塊" : "");
        current = { from, drop: null, x: 0, y: 0, label };
      }
      current = { ...current, x: ev.clientX, y: ev.clientY, drop: dropAt(ev.clientX, ev.clientY, current.from) };
      setDrag(current);
    };

    const up = () => {
      cleanup();
      if (!current) {
        // 沒有移動：當作點擊，開啟區塊選單
        const r = handle.getBoundingClientRect();
        setMenu({ unit, x: r.left, y: r.bottom + 4 });
        return;
      }
      const { from, drop } = current;
      setDrag(null);
      if (!drop || drop.start === from.start) return;
      const source = stateRef.current.source;
      const blocks = parseDoc(source).blocks;
      const x = blocks.find((u) => u.start === from.start);
      const target = blocks.find((u) => u.start === drop.start);
      if (!x || !target) return;
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
            dragging={drag?.from.start === u.start}
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
      const dragged = n.kind === "indent" && owner?.type === "leaf" && drag?.from.start === owner.unit.start;
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
      <div className="tail" onMouseDown={onTailMouseDown}>
        {doc.units.length === 0 && !region && <span className="empty-hint">點這裡開始寫作…</span>}
      </div>
      {drag && (
        <div className="drag-ghost" style={{ left: drag.x + 12, top: drag.y + 8 }}>
          {drag.label || "（空白）"}
        </div>
      )}
      {menu && menuDoc && (
        <BlockMenu
          x={menu.x}
          y={menu.y}
          current={blockTypeOf(menu.unit)}
          canIndent={menu.unit.kind !== "item" && canIndent(menuDoc, menu.unit)}
          canOutdent={menu.unit.kind !== "item" && canOutdent(menuDoc, menu.unit)}
          onClose={() => setMenu(null)}
          onTurn={(t) => turnUnitInto(menu.unit, t)}
          onIndent={(outdent) => {
            setMenu(null);
            shiftIndent(menu.unit, outdent, null);
          }}
          onDuplicate={() => {
            setMenu(null);
            // 連同子區塊一起複製
            const g = groupOf(menuDoc, menu.unit);
            commit({ source: duplicateUnit(state.source, { ...menu.unit, end: g.end }), region: null, caret: 0 });
          }}
          onDelete={() => {
            setMenu(null);
            // 連同子區塊一起刪除
            commit({ source: deleteUnit(state.source, groupOf(menuDoc, menu.unit)), region: null, caret: 0 });
          }}
        />
      )}
    </div>
  );
}

// ─── 區塊 ──────────────────────────────────────────────────────

interface UnitRowProps {
  unit: Unit;
  doc: ParsedDoc;
  drop: DropPos | null;
  dragging: boolean;
  onMouseDown: (e: MouseEvent<HTMLDivElement>) => void;
  onAdd: () => void;
  onHandlePointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void;
}

function UnitRow({ unit, doc, drop, dragging, ...on }: UnitRowProps) {
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
      className={`row kind-${unit.kind}${isTitle(unit, doc) ? " is-title" : ""}${dragging ? " dragging" : ""}`}
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
