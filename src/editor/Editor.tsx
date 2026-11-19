import DOMPurify from "dompurify";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type ReactNode,
} from "react";
import { BLOCK_TYPES, filterBlockTypes, kindLabel, type SlashItem } from "./blockTypes";
import { expandTemplate, findTemplate, getTemplates } from "../pages/templates";
import { bibliographyMarkdown, citeStamp, subscribeCites, suggestCites } from "../drawer/citeRef";
import { docKindLabel, getDocLinks, linkMenu } from "../desk/docLinks";
import { TaskGlyph, TaskIcon, WhenChip } from "../bujo/TaskGlyph";
import { clock, contentWhen, lineWhen, parseClock, setTimeAt, stripWhenHtml, whenLabel, type TaskTime } from "../bujo/time";
import {
  TASK_LABEL,
  cycleState,
  lineTask,
  lineDate,
  scheduleAt,
  setLineTask,
  setTaskAt,
  stripTaskHtml,
  type TaskState,
} from "../bujo/tasks";
import { cleanName, getPageNames, linkPages, openPage, pageKey, suggestPages } from "../pages/pageRef";
import {
  AlignCenterIcon,
  CaptionBottomIcon,
  CaptionTopIcon,
  AlignLeftIcon,
  AlignRightIcon,
  CopyIcon,
  GripIcon,
  IndentIcon,
  LinkIcon,
  OutdentIcon,
  PlusIcon,
  TrashIcon,
} from "./icons";
import { COLORS, COLOR_LABELS, marksAt, setColor, toggleMark, type Color, type Mark, type Marks } from "./inline";
import { caretFromPoint } from "./caret";
import { RichBlock, SpellCheck, textareaSurface, type Shortcut, type Surface } from "./RichBlock";
import { highlightBlocksHtml, parseCodeBlock, setCodeLang } from "./codeHighlight";
import { CodeTools } from "./CodeTools";
import { decompose, type FormatSpec } from "./wysiwyg";
import { isTauri } from "@tauri-apps/api/core";
import {
  PURIFY,
  importMediaPath,
  isMediaBlock,
  kindOf,
  mediaCaption,
  mediaMarkdown,
  setMediaCaption,
  resolveMedia,
  saveMedia,
  type MediaKind,
} from "./media";
import { isTableBlock, newTable } from "./table";
import { TableEditor } from "./TableEditor";
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
  blockAlign,
  blockBg,
  setBlockAlign,
  setCaptionPos,
  setBlockSize,
  blockSize,
  type MediaSize,
  captionPos,
  type CaptionPos,
  type Align,
  setBlockBg,
  setBlocksBg,
  setBlocksAlign,
  setBlockBox,
  setBlocksBox,
  blockBox,
  setColumnWidths,
  treeWith,
  type BoxValue,
  type DropPos,
  type Picked,
} from "./layout";
import { parseDoc, type Container, type ParsedDoc, type TreeNode, type Unit } from "./markdown";
import { blockStyleClasses, blockStyleCss } from "./blockStyle";
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
import { embedPages } from "./embed";
import "./editor.css";

// ─── 共用小工具 ────────────────────────────────────────────────

const sanitized = new Map<string, string>();
let sanitizedStamp = -1;
function clean(html: string): string {
  // 文獻庫或引用格式變了：[[@引用鍵]] 的顯示跟著變
  if (sanitizedStamp !== citeStamp()) {
    sanitized.clear();
    sanitizedStamp = citeStamp();
  }
  let out = sanitized.get(html);
  if (out === undefined) {
    if (sanitized.size > 2000) sanitized.clear();
    // ``` 區塊在清理之後才上色（highlight.js 的輸出已經跳脫）
    out = linkPages(embedPages(highlightBlocksHtml(DOMPurify.sanitize(resolveMedia(html), PURIFY))));
    sanitized.set(html, out);
  }
  return out;
}

/** 唯讀顯示一個區塊（反向連結用）：與編輯器相同的清理、頁面連結；任務去掉標記。 */
export function unitDisplayHtml(unit: Unit): string {
  return clean(taskHtml(unit));
}

/** 任務區塊顯示用的 HTML：去掉任務標記（改用符號顯示），以及時間與排程日期（改用標籤顯示）。 */
function taskHtml(unit: Unit): string {
  if (!unit.task) return unit.html;
  const html = stripTaskHtml(unit.html);
  return unit.when ? stripWhenHtml(html, unit.when) : html;
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
  /** 精簡模式（日記等一頁有好幾個編輯器時）：文件下方不留大片空白 */
  compact?: boolean;
  /** 文件是空的時候的提示 */
  placeholder?: string;
  /** 編輯時浮在區塊上方的格式列；Word、簡報用固定的功能區（`editorBus`）就關掉 */
  formatBar?: boolean;
  /** 插入範本時的 `{{title}}`（頁面名稱） */
  title?: string;
  /** 拼字檢查（Word 文件的設定；其他地方關掉） */
  spellCheck?: boolean;
  /** 插入範本時的 `{{date}}` 等（日記那一天，`YYYY-MM-DD`；沒有就是今天） */
  date?: string;
}

// ─── 好幾個編輯器並存 ──────────────────────────────────────────
//
// 日記一頁有好幾天，每天一個編輯器。復原、選取按鍵、剪貼簿、Ctrl＋A 這些掛在
// window／document 上的處理，只交給最後操作的編輯器（在裡面按下滑鼠或取得焦點）。

let currentEditor: object | null = null;

// ─── 外部工具列（Word、簡報的功能區） ──────────────────────────
//
// 功能區不在編輯器裡：透過 `editorBus` 看「最後操作的編輯器」的狀態、對它下指令。
// 功能區的元素要加 `editor-ui` class，並在 mousedown 時 preventDefault：
// 按下去不會結束編輯、不會搶走焦點（框選與失去焦點的處理會跳過它）。

/** 功能區看得到的編輯器狀態 */
export interface EditorStatus {
  /** 編輯器的根元素（功能區只管自己文件裡的編輯器） */
  root: HTMLElement | null;
  editing: boolean;
  /** 選取了幾個區塊 */
  selected: number;
  /** 編輯中的區塊能不能加行內格式（程式碼、HTML 不行） */
  formattable: boolean;
  marks: Marks | null;
  /** 編輯中（或第一個選取）的區塊類型 */
  type: BlockType | null;
  bg: Color | null;
  align: Align;
  /** 區塊樣式（`blockStyle.ts` 的 style 文字；編輯中或第一個選取的區塊，沒有就是空字串） */
  box: string;
  /** 區塊套用的已存樣式名稱（沒有就是空字串） */
  boxName: string;
  /** 編輯中的區塊裡選取了文字（沒有選取時，功能區的粗斜體、顏色作用在整段） */
  textSel: boolean;
}

/** 功能區的指令：編輯中就作用在編輯中的區塊／選取的文字，否則作用在選取的區塊 */
export interface EditorCommands {
  /** 結束編輯、取消選取的區塊（簡報的文字方塊按 Esc：改成選取整個文字方塊） */
  release: () => void;
  mark: (m: Mark) => void;
  color: (kind: "color" | "highlight", c: Color | null) => void;
  /** 選取的文字套用字元樣式（`<span data-cs="名稱">`；null 是拿掉） */
  charStyle: (name: string | null) => void;
  blockBg: (c: Color | null) => void;
  turnInto: (t: BlockType) => void;
  indent: (outdent: boolean) => void;
  align: (a: Align) => void;
  /** 改區塊樣式：fn 從區塊現在的樣式算出新的（多選時每個區塊各算各的） */
  box: (fn: (v: BoxValue) => BoxValue) => void;
  /** 插入：編輯中的區塊或選取的區塊後面，都沒有就是文件最後 */
  insert: (kind: "image" | "video" | "table" | "hr") => void;
  /** 在編輯中（或選取）的區塊後面插入一段 Markdown（分頁、目錄…） */
  insertMarkdown: (md: string) => void;
  undo: () => void;
  redo: () => void;
}

const NO_STATUS: EditorStatus = {
  root: null,
  editing: false,
  selected: 0,
  formattable: false,
  marks: null,
  type: null,
  bg: null,
  align: "left",
  box: "",
  boxName: "",
  textSel: false,
};
const handles = new Map<object, { status: EditorStatus; cmds: EditorCommands }>();
const busListeners = new Set<() => void>();
const notifyBus = () => busListeners.forEach((f) => f());

export const editorBus = {
  subscribe(fn: () => void) {
    busListeners.add(fn);
    return () => {
      busListeners.delete(fn);
    };
  },
  /** 最後操作的編輯器的狀態（同一個狀態是同一個物件，可以給 useSyncExternalStore） */
  status(): EditorStatus {
    return (currentEditor && handles.get(currentEditor)?.status) || NO_STATUS;
  },
  /** 對最後操作的編輯器下指令；within 給了就只在它在 within 裡面時才做 */
  run(within: Element | null, fn: (c: EditorCommands) => void) {
    const h = currentEditor && handles.get(currentEditor);
    if (!h || (within && !(h.status.root && within.contains(h.status.root)))) return false;
    fn(h.cmds);
    return true;
  },
  /** 讓 within 裡的編輯器成為最後操作的編輯器（功能區按下去前，例如還沒點過文件） */
  focusWithin(within: Element) {
    for (const [me, h] of handles) {
      if (h.status.root && within.contains(h.status.root)) {
        setCurrent(me);
        return true;
      }
    }
    return false;
  },
};

function setCurrent(me: object | null) {
  if (currentEditor === me) return;
  currentEditor = me;
  notifyBus();
}

/** 離 y 最近的編輯器（點在頁面左右空白處、從檔案總管拖進檔案時，用來決定是哪一個）。 */
function nearestEditor(y: number): Element | null {
  let best: Element | null = null;
  let bestD = Infinity;
  document.querySelectorAll(".md-editor").forEach((el) => {
    const r = el.getBoundingClientRect();
    const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    if (d < bestD) {
      bestD = d;
      best = el;
    }
  });
  return best;
}

// ─── 編輯器 ────────────────────────────────────────────────────

export function Editor({ value, onChange, compact = false, placeholder = "Click here to start writing…", formatBar = true, title, date, spellCheck = false }: EditorProps) {
  /** 這個編輯器的識別（比對 currentEditor 用） */
  const me = useRef({}).current;
  const rootRef = useRef<HTMLDivElement>(null);
  /** Drawer 的文獻庫或引用格式改變時重畫（[[@引用鍵]] 顯示成文中引用） */
  const citeVer = useSyncExternalStore(subscribeCites, citeStamp);
  const isCurrent = () => currentEditor === me;
  const rowEls = () => rootRef.current?.querySelectorAll<HTMLElement>(".row[data-start]") ?? [];
  useEffect(() => {
    if (!currentEditor) setCurrent(me);
    return () => {
      handles.delete(me);
      if (currentEditor === me) setCurrent(null);
    };
  }, [me]);
  const [state, setStateRaw] = useState<EditorState>({ source: value, region: null, caret: 0 });
  const [slash, setSlash] = useState<Slash | null>(null);
  const [menu, setMenu] = useState<{ unit: Unit; x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [resize, setResize] = useState<Record<number, number> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const history = useRef<History>({ past: [], future: [], last: 0 });
  /** 編輯中區塊的編輯面（所見即所得或原始碼文字框） */
  const surfRef = useRef<Surface | null>(null);
  /** 點擊進入編輯時的滑鼠位置：所見即所得編輯可以把游標放在點到的字上 */
  const pendingPoint = useRef<{ x: number; y: number } | null>(null);
  // 區塊選取：選取的區塊（起始行）、Shift 延伸的起點與終點、框選的矩形
  const [selected, setSelected] = useState<number[]>([]);
  const selRef = useRef<number[]>([]);
  const anchorRef = useRef<number | null>(null);
  const focusRef = useRef<number | null>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  /** 子彈筆記符號的右鍵選單（任務所在的行） */
  const [taskMenu, setTaskMenu] = useState<{ line: number; x: number; y: number } | null>(null);
  const [whenMenu, setWhenMenu] = useState<{ line: number; x: number; y: number } | null>(null);
  /** 頁面連結的自動完成：目前選到第幾個、按 Esc 關掉的那個 `[[` 的位置 */
  const [refIndex, setRefIndex] = useState(0);
  const [refClosed, setRefClosed] = useState<number | null>(null);

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
        if (currentEditor !== me) return;
        e.preventDefault();
        undo(k === "y" || e.shiftKey);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  // 行內格式：游標所在文字的狀態（下方格式列用），以及套用格式後要恢復的選取
  const [marks, setMarks] = useState<Marks | null>(null);
  /** 編輯中的區塊裡有沒有選取文字（功能區用：有選取作用在選取的字，沒有作用在整段） */
  const [textSel, setTextSel] = useState(false);
  const pendingSel = useRef<[number, number] | null>(null);

  const refreshMarks = useCallback(() => {
    const surf = surfRef.current;
    if (!surf || !stateRef.current.region) {
      setTextSel(false);
      return setMarks(null);
    }
    const [sa, sb] = surf.sel();
    setTextSel(sa !== sb);
    const next = surf.marks() ?? marksAt(surf.text(), sa, sb);
    setMarks((cur) =>
      cur && (Object.keys(next) as (keyof Marks)[]).every((k) => cur[k] === next[k]) ? cur : next,
    );
  }, []);

  // 套用游標位置、自動調整高度
  useLayoutEffect(() => {
    const surf = surfRef.current;
    if (!surf || !state.region || !surf.el?.isConnected) {
      setMarks(null);
      return;
    }
    if (surf.el instanceof HTMLTextAreaElement) {
      const ta = surf.el;
      ta.style.height = "0px";
      ta.style.height = ta.scrollHeight + "px";
    }
    const focused = document.activeElement === surf.el;
    if (!focused) surf.focus();
    const point = pendingPoint.current;
    pendingPoint.current = null;
    if (pendingSel.current) {
      surf.setSel(...pendingSel.current);
      pendingSel.current = null;
    } else if (point && surf.rich && placeAtPoint(surf.el, point)) {
      // 所見即所得：游標放在點到的字上
    } else {
      const [a, b] = surf.sel();
      if (!focused || a !== state.caret || b !== state.caret) surf.setSel(state.caret, state.caret);
    }
    refreshMarks();
  }, [state, refreshMarks]);

  const region = state.region;
  const editText = region ? regionText(doc.lines, region) : "";
  const editUnit = region ? regionUnit(doc, region) : undefined;
  // 編輯中區塊的類型名稱：清單分得出項目符號、編號、待辦、任務、事件
  const editType = editUnit ? blockTypeOf(editUnit) : null;
  const editKind = BLOCK_TYPES.find((t) => t.type === editType)?.label ?? kindLabel(editUnit?.kind ?? "paragraph", editUnit?.level);
  /** 這個區塊能不能所見即所得編輯（拆得開區塊語法與行內內容）；不能就用原始碼文字框 */
  const shape = useMemo(() => {
    if (!region) return null;
    const kind = editUnit?.kind;
    // 編輯區涵蓋多個區塊（例如剛打開程式碼區塊）時用原始碼
    const units = doc.units.filter((u) => u.start < region.end && u.end > region.start);
    if (units.length > 1) return null;
    if (isMediaBlock(editText)) return null; // 圖片、影片用原始碼編輯（改說明、路徑）
    return decompose(editText, kind);
  }, [region, editText, editUnit, doc]);
  /** 編輯中的區塊是表格：用表格編輯器 */
  const tableMode = !!region && !shape && editUnit?.kind === "html" && isTableBlock(editText);

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
        (!filterBlockTypes(query, getTemplates()).length && query.length > 3)
      ) {
        setSlash(null);
      } else if (shift) {
        setSlash({ ...slash, pos });
      }
    }
  };

  const slashQuery = slash && region ? editText.slice(slash.pos + 1, state.caret) : "";
  const slashItems = slash ? filterBlockTypes(slashQuery, getTemplates()) : [];

  // 頁面連結：游標前面是 `[[`（打字時被跳脫成 `\[\[`）加上還沒打完的名稱
  const refFound =
    region && !slash && !["code", "html", "source"].includes(editUnit?.kind ?? "paragraph")
      ? findRefQuery(editText, state.caret)
      : null;
  const refAsk = refFound && refFound.from !== refClosed ? refFound : null;
  const refQuery = refAsk ? cleanName(refAsk.query) : null;
  // `[[@`：引用 Drawer 的條目（依標題、作者、年份、引用鍵搜尋）
  const citeMode = !!refQuery?.startsWith("@");
  const refItems = useMemo((): RefItem[] => {
    if (refQuery === null) return [];
    if (refQuery.startsWith("@")) {
      const q = refQuery.slice(1);
      const cites: RefItem[] = suggestCites(q).map((c) => ({ name: "@" + c.key, create: false, label: c.title, desc: [c.detail, "@" + c.key].filter(Boolean).join(" · ") }));
      // 打了引用鍵、但文獻庫沒有：照常可以連到（新的）頁面（`引用鍵#…` 是備註，不提供新頁面）
      if (q && !/[\s#]/.test(q) && !cites.some((c) => pageKey(c.name) === pageKey(refQuery))) cites.push({ name: refQuery, create: true });
      return cites;
    }
    // 分級選單：第一層是頁面與 Desk 的檔案，選了檔案進到它的 Dock 文件（`linkMenu`）
    const menu = linkMenu(refQuery, (q) => suggestPages(q, getPageNames()), getDocLinks());
    if (menu.folder) return menu.docs.map((d) => ({ name: d.name, create: false, label: d.title, desc: docKindLabel(d.kind), dock: true }));
    const items: RefItem[] = menu.pages.map((name) => ({ name, create: false }));
    for (const f of menu.files) {
      items.push({ name: f.file + "/", create: false, label: f.file, desc: f.count === 1 ? "1 document" : `${f.count} documents`, folder: f.file });
    }
    for (const d of menu.docs) {
      if (!items.some((i) => !i.folder && pageKey(i.name) === pageKey(d.name))) items.push({ name: d.name, create: false, label: d.title, desc: `${docKindLabel(d.kind)} in ${d.file}`, dock: true });
    }
    if (refQuery && !items.some((n) => !n.folder && pageKey(n.name) === pageKey(refQuery))) items.push({ name: refQuery, create: true });
    return items;
    // citeVer：文獻庫改變時重新搜尋
  }, [refQuery, citeVer]);

  /** 分級選單第二層的檔案（打的字是「檔案/…」時） */
  const refFolder = refQuery !== null && !citeMode ? linkMenu(refQuery, () => [], getDocLinks()).folder : null;

  /** 把 `[[` 後面打的字換成 t（`[[` 保持打開，選單跟著換層）。 */
  const setRefText = (t: string) => {
    const s = stateRef.current;
    if (!refAsk || !s.region) return;
    const text = regionText(s.source.split("\n"), s.region);
    const ins = "[[" + t.replace(/[\\`*_<]/g, "\\$&");
    const out = text.slice(0, refAsk.from) + ins + text.slice(s.caret);
    const at = refAsk.from + ins.length;
    setRefIndex(0);
    commitFormatted({ text: out, a: at, b: at });
  };
  /** 選了選單的一項：檔案就進到它的文件，其他寫成連結。 */
  const pickRefItem = (it: RefItem) => (it.folder ? setRefText(it.folder + "/") : pickRef(it.name));

  /** 選了自動完成的頁面：寫成 `[[名稱]]`，游標放在後面。 */
  const pickRef = (name: string) => {
    const s = stateRef.current;
    if (!refAsk || !s.region) return;
    const text = regionText(s.source.split("\n"), s.region);
    let end = s.caret;
    const close = /^(?:\\?\]){2}/.exec(text.slice(end));
    if (close) end += close[0].length;
    const ref = `[[${name.replace(/[\\`*_<]/g, "\\$&")}]]`;
    const out = text.slice(0, refAsk.from) + ref + text.slice(end);
    const at = refAsk.from + ref.length;
    setRefIndex(0);
    commitFormatted({ text: out, a: at, b: at });
  };

  /** 可以套用行內格式的區塊（程式碼、HTML、參考連結裡的字不是 Markdown 行內語法）。 */
  const formattable = !!region && !["code", "html", "source"].includes(editUnit?.kind ?? "paragraph");

  /** 切換游標或選取文字的粗體、斜體、程式碼、連結。 */
  /** 把編輯面算出來的新原始碼與選取套用上去。 */
  const commitFormatted = (r: { text: string; a: number; b: number }) => {
    const s = stateRef.current;
    if (!s.region || r.text === regionText(s.source.split("\n"), s.region)) {
      pendingSel.current = [r.a, r.b];
      commit({ ...s });
      return;
    }
    setSlash(null);
    const next = applyText(s, r.text, r.b);
    const shift = next.caret - r.b; // 編輯區往上擴張時的位移
    pendingSel.current = [r.a + shift, r.b + shift];
    commit(next);
  };

  const TAG_OF = { bold: "strong", italic: "em", underline: "u", strike: "s", sup: "sup", sub: "sub", code: "code" } as const;

  const applyMark = (mark: Mark) => {
    const surf = surfRef.current;
    const s = stateRef.current;
    if (!surf || !s.region) return;
    const [a, b] = surf.sel();
    if (surf.rich) {
      if (mark === "link") {
        if (marks?.link) {
          // 在連結裡：拿掉連結（有選取時以畫面上的字為準）
          const r = a !== b ? surf.format({ tag: "a", href: "" }, "off") : null;
          if (r) return commitFormatted(r);
          const t = toggleMark(surf.text(), a, b, "link", true);
          if (t.text !== surf.text()) commitFormatted(t);
          return;
        }
        // 所見即所得看不到網址：另外問網址，先記住選取
        setLinkAsk({ a, b, restore: surf.saveSel() });
        return;
      }
      const tag = TAG_OF[mark];
      if (a === b) {
        // 沒有選取：讓接著打的字有（或沒有）這個格式
        if (surf.typingStyle({ tag })) refreshMarks();
        return;
      }
      // 有選取：以畫面上選到的字為準（不會因為選取邊界剛好在 ** 記號旁而切壞）
      const r = surf.format({ tag }, "toggle");
      if (r) commitFormatted(r);
      return;
    }
    const text = surf.text();
    const r = toggleMark(text, a, b, mark, marks?.[mark]);
    if (r.text === text) return;
    commitFormatted(r);
  };

  /** 設定選取文字的文字顏色或螢光標記。 */
  const applyColor = (kind: "color" | "highlight", color: Color | null) => {
    const surf = surfRef.current;
    const s = stateRef.current;
    if (!surf || !s.region) return;
    const [a, b] = surf.sel();
    if (surf.rich) {
      const spec: FormatSpec = { tag: kind === "color" ? "span" : "mark", color };
      if (a === b) {
        if (surf.typingStyle(spec)) refreshMarks();
        return;
      }
      const r = surf.format(spec, color ? "on" : "off");
      if (r) commitFormatted(r);
      return;
    }
    const text = surf.text();
    const r = setColor(text, a, b, kind, color);
    if (r.text === text) return;
    commitFormatted(r);
  };

  /** 選取的文字套用（或拿掉）字元樣式；沒有選取時讓接著打的字套用。只有所見即所得編輯有。 */
  const applyCharStyle = (name: string | null) => {
    const surf = surfRef.current;
    if (!surf || !stateRef.current.region || !surf.rich) return;
    const [a, b] = surf.sel();
    const spec: FormatSpec = { tag: "cs", name };
    if (a === b) {
      if (surf.typingStyle(spec)) refreshMarks();
      return;
    }
    const r = surf.format(spec, name ? "on" : "off");
    if (r) commitFormatted(r);
  };

  /** 設定正在編輯的整個區塊的背景顏色，然後繼續編輯同一個區塊。 */
  const applyBlockBg = (color: Color | null) => {
    const surf = surfRef.current;
    const s = stateRef.current;
    if (!s.region) return;
    const sel: [number, number] = surf ? surf.sel() : [s.caret, s.caret];
    const res = setBlockBg(s.source, s.region, color);
    if (res.source === s.source || res.start < 0) return;
    const len = s.region.end - s.region.start;
    const next = activate({ source: res.source, region: null, caret: 0 }, { start: res.start, end: res.start + len }, sel[1]);
    pendingSel.current = sel;
    commit(next);
  };

  /** 所見即所得插入連結：輸入網址的小視窗（a、b 是原始碼中的選取，restore 放回原本的選取） */
  const [linkAsk, setLinkAsk] = useState<{ a: number; b: number; restore: () => void } | null>(null);
  const applyLink = (url: string) => {
    const ask = linkAsk;
    setLinkAsk(null);
    const s = stateRef.current;
    const surf = surfRef.current;
    if (!ask || !s.region || !surf) return;
    ask.restore();
    const href = url.trim();
    if (!href) {
      pendingSel.current = [ask.a, ask.b];
      commit({ ...s });
      return;
    }
    // 有選取：把選到的字（以畫面為準）包成連結
    const r = ask.a !== ask.b ? surf.format({ tag: "a", href }, "on") : null;
    if (r) return commitFormatted(r);
    // 沒有選取：插入以網址為文字的連結
    const text = regionText(s.source.split("\n"), s.region);
    const label = href.replace(/^https?:\/\//, "").replace(/[\\`*_[\]<]/g, "\\$&");
    const dest = /[\s()<>]/.test(href) ? `<${href}>` : href;
    const out = text.slice(0, ask.a) + `[${label}](${dest})` + text.slice(ask.b);
    commitFormatted({ text: out, a: ask.a + 1, b: ask.a + 1 + label.length });
  };

  /** 段落開頭打了區塊標記：轉成對應的區塊，游標放在內容開頭。 */
  const onShortcut = (type: Shortcut, rest: string, state?: TaskState, marker?: string) => {
    const s = stateRef.current;
    if (!s.region) return;
    setSlash(null);
    const t = turnInto(rest, type);
    // `* ` 打出來的項目符號留著 `*`（接著打 `[] ` 會變成待辦清單）
    if (type === "bullet" && marker === "*") t.text = "*" + t.text.slice(1);
    // 任務、待辦快捷帶了狀態（`{x} `、`{o} `、`[x] `…）：換掉預設的未完成
    if ((type === "task" || type === "todo") && state && state !== "open") {
      const nl = t.text.indexOf("\n");
      const first = nl < 0 ? t.text : t.text.slice(0, nl);
      t.text = setLineTask(first, state) + (nl < 0 ? "" : t.text.slice(nl));
    }
    const caret = type === "code" ? t.caret : t.text.length - rest.length;
    commit(applyText(s, t.text, caret));
  };

  const pickSlash = (item: SlashItem) => {
    const type = item.type;
    if (!slash) return;
    const s = stateRef.current;
    const text = editText.slice(0, slash.pos) + editText.slice(s.caret);
    setSlash(null);
    if (type === "cite") {
      // 換成 `[[@`，接著打字就是搜尋 Drawer 的條目
      const at = slash.pos + 3;
      setRefClosed(null);
      setRefIndex(0);
      commitFormatted({ text: text.slice(0, slash.pos) + "[[@" + text.slice(slash.pos), a: at, b: at });
      return;
    }
    if (type === "template") {
      // 頁面範本：換掉變數後放在這個區塊（空白區塊就整個換掉；有文字就放在下面）
      const typed = applyText(s, text, text.length);
      const t = item.template ? findTemplate(item.template) : undefined;
      const body = t ? expandTemplate(t.content, { title, date }) : "";
      if (!body) return commit(typed);
      if (!text.trim() && s.region) {
        const lines = s.source.split("\n");
        lines.splice(s.region.start, s.region.end - s.region.start, ...body.split("\n"));
        commit({ source: lines.join("\n"), region: null, caret: 0 });
      } else commit({ source: pasteAfter(typed.source, typed.region, body).source, region: null, caret: 0 });
      return;
    }
    if (type === "bibliography") {
      // 這份文件引用到的條目，依格式排好，一筆一個清單項目（放在這個區塊；有文字就放在下面）
      const typed = applyText(s, text, text.length);
      const refs = bibliographyMarkdown(typed.source);
      // 還沒有引用：只拿掉「/指令」
      if (!refs) return commit(typed);
      if (!text.trim() && s.region) {
        const lines = s.source.split("\n");
        lines.splice(s.region.start, s.region.end - s.region.start, ...refs.split("\n"));
        commit({ source: lines.join("\n"), region: null, caret: 0 });
      } else commit({ source: pasteAfter(typed.source, typed.region, refs).source, region: null, caret: 0 });
      return;
    }
    if (type === "table") {
      // 空白區塊直接變成表格；有文字就在下面加一個表格
      if (!text.trim()) commit(applyText(s, newTable(), 0));
      else {
        const res = pasteAfter(applyText(s, text, text.length).source, s.region!, newTable());
        commit(activate({ source: res.source, region: null, caret: 0 }, { start: res.starts[0], end: res.starts[0] + 1 }, 0));
      }
      return;
    }
    if (type === "image" || type === "video") {
      // 先拿掉「/指令」，離開編輯（選檔案時焦點會離開），選好檔案後放在這個區塊
      commit(applyText(s, text, text.length));
      const start = s.region!.start;
      const map = leaveEditing();
      pickFiles(type, map(start));
      return;
    }
    commit(turnRegionInto(s, text, type));
  };

  // ─── 圖片、GIF、影片 ───────────────────────────────────────

  /** 改圖片、影片的圖說（寫在圖片標題、影片的 title 屬性），改完選取它。 */
  /** 改程式碼區塊的語言（``` 後面的字） */
  const langBlock = (unit: Unit, lang: string) => {
    const map = leaveEditing();
    const source = stateRef.current.source;
    const cur = parseDoc(source);
    const u = cur.blocks.find((b) => b.start === map(unit.start));
    if (!u) return;
    const old = regionText(cur.lines, u);
    const next = setCodeLang(old, lang);
    if (next === old) return;
    const lines = source.split("\n");
    lines.splice(u.start, u.end - u.start, ...next.split("\n"));
    commit({ source: lines.join("\n"), region: null, caret: 0 });
  };

  const captionBlock = (unit: Unit, caption: string) => {
    const map = leaveEditing();
    const source = stateRef.current.source;
    const cur = parseDoc(source);
    const u = cur.blocks.find((b) => b.start === map(unit.start));
    if (!u) return;
    const old = regionText(cur.lines, u);
    const next = setMediaCaption(old, caption);
    if (next === old) return;
    const lines = source.split("\n");
    lines.splice(u.start, u.end - u.start, ...next.split("\n"));
    commit({ source: lines.join("\n"), region: null, caret: 0 });
    select([u.start], u.start, u.start);
  };

  /** 設定圖片、影片（或任何區塊）的對齊，設定後選取它。 */
  const alignBlock = (unit: Unit, a: Align) => {
    const map = leaveEditing();
    const source = stateRef.current.source;
    const cur = parseDoc(source).blocks.find((b) => b.start === map(unit.start));
    if (!cur) return;
    const res = setBlockAlign(source, cur, a);
    if (res.source !== source) commit({ source: res.source, region: null, caret: 0 });
    if (res.start >= 0) select([res.start], res.start, res.start);
  };

  /** 設定圖片、影片的寬度，設定後選取它。 */
  const sizeBlock = (unit: Unit, size: MediaSize | null) => {
    const map = leaveEditing();
    const source = stateRef.current.source;
    const cur = parseDoc(source).blocks.find((b) => b.start === map(unit.start));
    if (!cur) return;
    const res = setBlockSize(source, cur, size);
    if (res.source !== source) commit({ source: res.source, region: null, caret: 0 });
    if (res.start >= 0) select([res.start], res.start, res.start);
  };

  /** 設定圖說在圖片、影片的上方或下方，設定後選取它。 */
  const captionPosBlock = (unit: Unit, pos: CaptionPos) => {
    const map = leaveEditing();
    const source = stateRef.current.source;
    const cur = parseDoc(source).blocks.find((b) => b.start === map(unit.start));
    if (!cur) return;
    const res = setCaptionPos(source, cur, pos);
    if (res.source !== source) commit({ source: res.source, region: null, caret: 0 });
    if (res.start >= 0) select([res.start], res.start, res.start);
  };

  /**
   * 放媒體區塊：at 是空白區塊時直接換掉它，否則放在 at 這個區塊後面（null 表示文件最後）。
   * 放好後選取新的區塊。
   */
  const placeMedia = (markdown: string, at: number | null) => {
    if (!markdown) return;
    const s = stateRef.current;
    const map = s.region ? leaveEditing() : (l: number) => l;
    const source = stateRef.current.source;
    const cur = parseDoc(source);
    const target = at === null ? null : (cur.blocks.find((b) => b.start === map(at)) ?? null);
    if (target && target.end - target.start === 1 && /^\s*(&nbsp;)?\s*$/.test(cur.lines[target.start])) {
      const lines = source.split("\n");
      lines.splice(target.start, 1, ...markdown.split("\n"));
      const next = lines.join("\n");
      commit({ source: next, region: null, caret: 0 });
      const starts = parseDoc(next)
        .blocks.filter((b) => b.start >= target.start && b.start < target.start + markdown.split("\n").length)
        .map((b) => b.start);
      select(starts, starts[0] ?? null, starts[starts.length - 1] ?? null);
      return;
    }
    applyMany(pasteAfter(source, target, markdown));
  };

  /** 存好檔案並轉成 Markdown（多個檔案之間空一行）。 */
  const filesToMarkdown = async (files: File[]): Promise<string> => {
    const parts: string[] = [];
    for (const f of files) {
      const kind = kindOf(f.name, f.type);
      if (!kind) continue;
      try {
        const src = await saveMedia(f);
        parts.push(mediaMarkdown(src, kind, kind === "image" ? f.name.replace(/\.[^.]+$/, "") : ""));
      } catch (err) {
        console.error("Couldn't save the file", f.name, err);
      }
    }
    return parts.join("\n\n");
  };

  /** 開啟選擇檔案的視窗，選好的圖片或影片放在 at 這個區塊。 */
  const pickFiles = (kind: MediaKind, at: number | null) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = kind === "image" ? "image/*" : "video/*";
    input.multiple = true;
    input.onchange = async () => {
      const md = await filesToMarkdown([...(input.files ?? [])]);
      placeMedia(md, at);
    };
    input.click();
  };

  /** 從檔案總管拖進來的檔案（Tauri 會攔截拖放，給的是檔案路徑）。 */
  const dropPaths = useRef<(paths: string[], x: number, y: number) => void>(() => {});
  dropPaths.current = async (paths, x, y) => {
    // 白板上：放在畫布空白處由白板處理（媒體卡片），放在這個編輯器上才是這個編輯器的
    const hit = document.elementFromPoint(x, y);
    if (hit?.closest(".board") && !rootRef.current?.contains(hit)) return;
    // 好幾個編輯器時，由離放開位置最近的那個處理
    if (nearestEditor(y) !== rootRef.current) return;
    const parts: string[] = [];
    for (const path of paths) {
      const kind = kindOf(path);
      if (!kind) continue;
      try {
        const src = await importMediaPath(path);
        const name = path.split(/[\\/]/).pop() ?? "";
        parts.push(mediaMarkdown(src, kind, kind === "image" ? name.replace(/\.[^.]+$/, "") : ""));
      } catch (err) {
        console.error("Couldn't import the file", path, err);
      }
    }
    if (!parts.length) return;
    // 放在滑鼠位置最近的區塊後面
    let best: number | null = null;
    let bestD = Infinity;
    rowEls().forEach((row) => {
      const r = row.getBoundingClientRect();
      const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (d < bestD) {
        bestD = d;
        best = Number(row.dataset.start);
      }
    });
    placeMedia(parts.join("\n\n"), best);
  };

  useEffect(() => {
    if (!isTauri()) return;
    let off: (() => void) | undefined;
    let alive = true;
    void import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
      getCurrentWebview()
        .onDragDropEvent((ev) => {
          if (ev.payload.type !== "drop") return;
          const r = window.devicePixelRatio;
          dropPaths.current(ev.payload.paths, ev.payload.position.x / r, ev.payload.position.y / r);
        })
        .then((fn) => {
          if (alive) off = fn;
          else fn();
        }),
    );
    return () => {
      alive = false;
      off?.();
    };
  }, []);

  const go = (unit: Unit | undefined, caret: number | "end") => {
    if (!unit) return false;
    setSlash(null);
    commit(activate(stateRef.current, unit, caret));
    return true;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const surf = surfRef.current;
    const s = stateRef.current;
    if (!surf || !s.region) return;
    const text = surf.text();
    const [a, b] = surf.sel();

    // 行內格式快捷鍵
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const key = e.key.toLowerCase();
      const mark = e.shiftKey
        ? key === "x"
          ? "strike"
          : undefined
        : ({ b: "bold", i: "italic", u: "underline", e: "code", k: "link", ".": "sup", ",": "sub" } as Record<string, Mark>)[key];
      if (mark && formattable) {
        e.preventDefault();
        applyMark(mark);
        return;
      }
    }

    if (slash && slashItems.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        setSlash({ ...slash, index: (slash.index + d + slashItems.length) % slashItems.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickSlash(slashItems[Math.min(slash.index, slashItems.length - 1)]);
        return;
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (refAsk) setRefClosed(refAsk.from);
      else if (slash) setSlash(null);
      else {
        // 離開編輯並選取這個區塊（再按方向鍵可以移動選取、Delete 刪除…）
        const start = s.region.start;
        const map = leaveEditing();
        const b = parseDoc(stateRef.current.source).blocks.find((u) => u.start === map(start));
        if (b) select([b.start], b.start, b.start);
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && surf.allSelected()) {
      // 文字已經全選時再按 Ctrl+A：選取所有區塊
      e.preventDefault();
      leaveEditing();
      selectAll();
      return;
    }

    const kind = editUnit?.kind ?? "paragraph";
    const sync = { ...s, caret: a };

    // 頁面連結的自動完成
    if (refAsk && refItems.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        setRefIndex((i) => (i + d + refItems.length) % refItems.length);
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
        e.preventDefault();
        pickRefItem(refItems[Math.min(refIndex, refItems.length - 1)]);
        return;
      }
      // → 進到檔案（分級選單）
      const it = refItems[Math.min(refIndex, refItems.length - 1)];
      if (e.key === "ArrowRight" && it.folder) {
        e.preventDefault();
        setRefText(it.folder + "/");
        return;
      }
    }
    // ← 在檔案的第一層（斜線後面還沒打字）：回到上一層
    if (refAsk && refFolder && e.key === "ArrowLeft" && refQuery?.endsWith("/")) {
      e.preventDefault();
      setRefText("");
      return;
    }

    // Ctrl+Enter：清單項目切換任務（任務 ↔ 完成）；段落變成任務
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      if (kind === "item") {
        e.preventDefault();
        setTask(s.region.start, "cycle");
      } else if (kind === "paragraph") {
        e.preventDefault();
        const t = turnInto(text, "task");
        commit(applyText(sync, t.text, a + (t.text.length - text.length)));
      }
      return;
    }

    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.shiftKey) {
        if (kind === "paragraph" || kind === "item" || kind === "quote") {
          e.preventDefault();
          // CommonMark 的硬換行：行尾反斜線（所見即所得：插入換行元素，轉回時就是硬換行）
          if (surf.rich) document.execCommand("insertLineBreak");
          else commit(applyText(sync, text.slice(0, a) + "\\\n" + text.slice(b), a + 2));
        } else e.preventDefault();
        return;
      }
      if (surf.rich) {
        // 所見即所得：在 DOM 上切開，前後各自轉回 Markdown，格式不會被切壞
        e.preventDefault();
        const parts = surf.split();
        if (!parts) return;
        const joined = applyText(s, parts.before + parts.after, parts.before.length);
        const next = splitBlock(joined, parts.before.length);
        setSlash(null);
        if (next) commit(next);
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

    if (e.key === "Backspace" && a === b && surf.atStart()) {
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
      } else if (kind === "code" && !surf.rich) {
        commit(applyText(sync, text.slice(0, a) + "  " + text.slice(b), a + 2));
      } else {
        // 其他區塊：Tab 增加縮排、Shift+Tab 減少縮排
        setSlash(null);
        shiftIndent(s.region, e.shiftKey, a);
      }
      return;
    }

    if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || a !== b) return;
    if (e.key === "ArrowUp" && surf.firstLine()) {
      if (go(prevUnit(doc, s.region), "end")) e.preventDefault();
    } else if (e.key === "ArrowDown" && surf.lastLine()) {
      if (go(nextUnit(doc, s.region), 0)) e.preventDefault();
    } else if (e.key === "ArrowLeft" && surf.atStart()) {
      if (go(prevUnit(doc, s.region), "end")) e.preventDefault();
    } else if (e.key === "ArrowRight" && surf.atEnd()) {
      if (go(nextUnit(doc, s.region), 0)) e.preventDefault();
    }
  };

  const onBlur = (el: HTMLElement, renderedStart: number, related: Element | null = null) => {
    if (!document.hasFocus()) return; // 只是切換到別的視窗
    if (related?.closest?.(".link-ask, .format-bar, .editor-ui")) return; // 焦點移到網址輸入框、格式列
    const s = stateRef.current;
    // 已經換到別的編輯區（舊的編輯元素卸載或被新的搶走焦點）就不處理
    if (!s.region || s.region.start !== renderedStart || surfRef.current?.el !== el || !el.isConnected) return;
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
    surfRef.current?.blur();
    return d.map;
  };

  const blocksNow = () => parseDoc(stateRef.current.source).blocks;

  // ─── 子彈筆記 ──────────────────────────────────────────────

  /** 設定某一行的任務狀態（"cycle"：任務 ↔ 完成；null：變回一般清單項目）。 */
  const setTask = (line: number, to: TaskState | null | "cycle") => {
    const s = stateRef.current;
    const lines = s.source.split("\n");
    const before = lines[line] ?? "";
    const cur = lineTask(before);
    const state = to === "cycle" ? (cur ? cycleState(cur.state, !!lineDate(before)) : "open") : to;
    const source = setTaskAt(s.source, line, state);
    if (source === s.source) return;
    // 只改這一行；正在編輯這一行時，游標跟著標記長度的變化位移
    const delta = source.split("\n")[line].length - before.length;
    const editing = !!s.region && s.region.start === line;
    const caret = editing ? Math.max(0, s.caret + delta) : s.caret;
    if (editing) pendingSel.current = [caret, caret];
    commit({ ...s, source, caret });
  };

  /**
   * 改任務的排程日期（null：取消排程）與時間（null：拿掉時間）；undefined 是不改。
   * 標記、時間、日期都在內容之外；正在編輯這一行時游標跟著內容開頭的位移。
   */
  const setWhen = (line: number, date: string | null | undefined, time: TaskTime | null | undefined) => {
    const s = stateRef.current;
    let source = s.source;
    if (date !== undefined) source = scheduleAt(source, line, date);
    if (time !== undefined) source = setTimeAt(source, line, time);
    if (source === s.source) return;
    const contentStart = (l: string) => {
      const t = lineTask(l);
      return t ? t.prefix + (contentWhen(l.slice(t.prefix))?.timeLen ?? 0) : 0;
    };
    const delta = contentStart(source.split("\n")[line] ?? "") - contentStart(s.source.split("\n")[line] ?? "");
    const editing = !!s.region && s.region.start === line;
    const caret = editing ? Math.max(0, s.caret + delta) : s.caret;
    if (editing) pendingSel.current = [caret, caret];
    commit({ ...s, source, caret });
  };

  /** 排程：任務留在原處，標成 `{<}` 並在行尾寫上日期（那天的「該做的事」與行事曆會列出它）。 */
  const sendTask = (line: number, date: string) => setWhen(line, date, undefined);

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
    // 影片的播放控制要能按
    if (!(e.target as HTMLElement).closest("video")) e.preventDefault();
    setMenu(null);
    // 頁面連結：直接開啟那一頁（像 Logseq）
    if (link?.classList.contains("page-ref")) {
      openPage(link.getAttribute("data-page") ?? "");
      return;
    }
    if (link && (e.ctrlKey || e.metaKey)) {
      const href = link.getAttribute("href");
      if (href) void openLink(href);
      return;
    }
    if (e.shiftKey) return extendTo(unit);
    if (e.ctrlKey || e.metaKey) return toggle(unit);

    const src = regionText(doc.lines, unit);
    // 圖片、影片：點一下選取（可以拖曳、刪除），連按兩下才編輯原始碼；影片的播放控制照常可以按
    if (isMediaBlock(src)) {
      if (e.detail >= 2) {
        go(unit, "end");
        return;
      }
      const map = leaveEditing();
      const st = map(unit.start);
      select([st], st, st);
      return;
    }

    // 一般按下：放開時開始編輯；按著拖到別的區塊則改成選取一段區塊
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
        pendingPoint.current = { x: e.clientX, y: e.clientY };
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
      surfRef.current?.focus();
      return;
    }
    const lastBlock = cur.blocks[cur.blocks.length - 1];
    if (lastBlock && lastBlock.start === last?.start && cur.lines[lastBlock.start].trim() === EMPTY_BLOCK) {
      commit(activate(s, lastBlock, 0));
      return;
    }
    commit(insertEmptyAfter(s, last ? last.end : 0));
  };

  /** 格式列的「Turn into」：正在編輯的區塊換類型，繼續編輯，游標留在同一段文字上。 */
  const turnEditingInto = (type: BlockType) => {
    const s = stateRef.current;
    if (!s.region) return;
    const text = regionText(s.source.split("\n"), s.region);
    const t = turnInto(text, type);
    if (t.text === text) return;
    // 換掉的是開頭的標記，游標到結尾的距離不變；程式碼框先拿掉前後的圍欄再算
    let from = text;
    let at = s.caret;
    const fence = /^ {0,3}(`{3,}|~{3,})[^\n]*\n([\s\S]*?)(?:\n {0,3}\1[`~]*[ \t]*)?$/.exec(text);
    if (fence) {
      const open = text.indexOf("\n") + 1;
      from = fence[2];
      at = Math.max(0, Math.min(from.length, at - open));
    }
    const caret = type === "code" ? t.caret : Math.max(0, Math.min(t.text.length, t.text.length - (from.length - at)));
    commit(applyText(s, t.text, caret));
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
    const rowsEl = [...rowEls()].filter((el) => {
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
          ? many.map((m) => (m.whole ? "Columns" : null)).filter(Boolean).length === many.length
            ? "Column layout"
            : `${many.length} items` + (many.some((m) => m.whole) ? " (incl. columns)" : "")
          : regionText(s.source.split("\n"), from).slice(0, 80) + (kids ? "  + sub-blocks" : "");
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
  const onTextPaste = (e: ReactClipboardEvent<HTMLElement>) => {
    const s = stateRef.current;
    const surf = surfRef.current;
    if (!s.region || !surf) return;
    // 貼上圖片（截圖、複製的圖片檔）：放在目前的區塊後面（空白區塊就直接換掉）
    const files = [...e.clipboardData.files].filter((f) => kindOf(f.name, f.type));
    if (files.length) {
      e.preventDefault();
      const at = s.region.start;
      const map = leaveEditing();
      void filesToMarkdown(files).then((md) => placeMedia(md, map(at)));
      return;
    }
    const kind = editUnit?.kind;
    const blocks = e.clipboardData.getData(BLOCKS_MIME);
    const text = blocks || e.clipboardData.getData("text/plain");
    const multi = !!blocks || text.replace(/\r?\n+$/, "").includes("\n");
    if (kind === "code" || kind === "html" || !text || !multi) {
      // 單行文字：所見即所得只貼純文字（不帶網頁的格式）
      if (surf.rich) {
        e.preventDefault();
        document.execCommand("insertText", false, text.replace(/\r?\n/g, " "));
      }
      return;
    }
    e.preventDefault();
    setSlash(null);
    const [a, b] = surf.sel();
    const res = pasteInto(s.source, s.region, a, b, text);
    commit({ source: res.source, region: null, caret: 0 });
    surf.blur();
    select(res.starts, res.starts[0] ?? null, res.starts[res.starts.length - 1] ?? null);
  };

  const selectionKeys = useRef<(e: globalThis.KeyboardEvent) => void>(() => {});
  selectionKeys.current = (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest?.("textarea, input, [contenteditable]")) return;
    if (!isCurrent()) return;
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
        next && rootRef.current?.querySelector(`.row[data-start="${next.start}"]`)?.scrollIntoView({ block: "nearest" });
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
    if (target?.closest?.("textarea, input, [contenteditable]") || !selRef.current.length) return;
    if (!isCurrent()) return;
    const xs = selectedBlocks();
    if (e.type === "paste") {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => kindOf(f.name, f.type));
      if (files.length) {
        e.preventDefault();
        const after = xs[xs.length - 1]?.start ?? null;
        void filesToMarkdown(files).then((md) => placeMedia(md, after));
        return;
      }
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
    if (t.closest?.(".editor-ui")) return; // 功能區：不結束編輯
    if (!t.closest?.(".page, .md-editor")) return;
    const root = rootRef.current;
    if (!root) return;
    // 好幾個編輯器時：按在別的編輯器裡（或頁面空白處離別的編輯器比較近），這裡只結束編輯、取消選取
    const inside = t.closest(".md-editor");
    const owner = inside ?? (t.closest(".no-box") ? null : nearestEditor(e.clientY));
    if (owner !== root) {
      if (stateRef.current.region || selRef.current.length) {
        leaveEditing();
        select([], null, null);
      }
      setMenu(null);
      return;
    }
    setCurrent(me);
    if (t.closest(".row .content, .gutter, .popover, .grip, textarea, .format-bar")) return;
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
      rowEls().forEach((row) => {
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
      className={`row editing ${shape ? "wysiwyg" : "raw"} kind-${editUnit?.kind ?? "paragraph"}${editUnit && isTitle(editUnit, doc) ? " is-title" : ""}`}
      key={`edit:${region.start}`}
    >
      {/* 編輯中的區塊也有把手（拖曳、區塊選單）：按下去不會先結束編輯，拖動或放開時才由 onHandlePointerDown 結束 */}
      <div className="gutter">
        {editUnit && (
          <>
            <button className="add" title="Add a block below" onMouseDown={(e) => e.preventDefault()} onClick={() => addAfter(editUnit)}>
              <PlusIcon />
            </button>
            <button className="handle" title="Drag to move · click for menu" onPointerDown={(e) => onHandlePointerDown(e, editUnit)}>
              <GripIcon />
            </button>
          </>
        )}
      </div>
      <div
        className="content"
        onMouseDown={(e) => {
          // 編輯中按住 Ctrl 點頁面連結：開啟那一頁
          const a = (e.target as HTMLElement).closest(".page-ref");
          if (a && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            openPage(a.getAttribute("data-page") ?? "");
          }
        }}
      >
        {shape ? (
          <RichBlock
            ref={surfRef}
            text={editText}
            shape={shape}
            kind={editUnit?.kind}
            level={editUnit?.level}
            list={editUnit?.list}
            env={doc.env}
            placeholder={editUnit?.kind === "heading" ? "Heading" : "Type text, or press “/” for blocks"}
            onText={onTextChange}
            onShortcut={onShortcut}
            onTaskClick={() => setTask(region.start, "cycle")}
            onTaskMenu={(x, y) => setTaskMenu({ line: region.start, x, y })}
            onWhenMenu={(x, y) => setWhenMenu({ line: region.start, x, y })}
            onKeyDown={onKeyDown}
            onPaste={onTextPaste}
            onBlur={(el, related) => onBlur(el, region.start, related)}
            onSelect={() => {
              const surf = surfRef.current;
              if (surf) {
                const [, c] = surf.sel();
                if (c !== stateRef.current.caret) stateRef.current = { ...stateRef.current, caret: c };
              }
              refreshMarks();
            }}
          />
        ) : tableMode ? (
          <TableEditor
            ref={surfRef}
            text={editText}
            point={pendingPoint.current}
            onChange={(text) => onTextChange(text, 0)}
            onLeave={() => {
              const start = region.start;
              const map = leaveEditing();
              const st = map(start);
              select([st], st, st);
            }}
            onBlur={(el, related) => onBlur(el, region.start, related)}
          />
        ) : (
          <textarea
            ref={(el) => {
              surfRef.current = el ? textareaSurface(el) : null;
            }}
            className={`edit ${editUnit?.kind === "heading" ? `h${editUnit.level}` : ""}`}
            value={editText}
            spellCheck={false}
            rows={1}
            placeholder={editText ? "" : "Type text, or press “/” for blocks"}
            onChange={(e) => onTextChange(e.target.value, e.target.selectionStart)}
            onSelect={(e) => {
              const c = e.currentTarget.selectionStart;
              if (c !== stateRef.current.caret) stateRef.current = { ...stateRef.current, caret: c };
              refreshMarks();
            }}
            onKeyDown={onKeyDown}
            onPaste={onTextPaste}
            onBlur={(e) => onBlur(e.currentTarget, region.start, e.relatedTarget as Element | null)}
          />
        )}
        {slash && (
          <Floating>
            <SlashMenu
              items={slashItems}
              active={Math.min(slash.index, slashItems.length - 1)}
              onPick={pickSlash}
              onHover={(i) => setSlash({ ...slash, index: i })}
            />
          </Floating>
        )}
        {refAsk && !slash && (
          <Floating>
            <RefMenu
              cite={citeMode}
              items={refItems}
              folder={refFolder}
              onBack={() => setRefText("")}
              active={Math.min(refIndex, Math.max(0, refItems.length - 1))}
              onPick={pickRefItem}
              onHover={setRefIndex}
            />
          </Floating>
        )}
      </div>
    </div>
  ) : null;

  // 編輯區取代與它重疊的區塊，放進樹中對應的位置
  const view = useMemo(() => (region ? treeWith(doc, region) : { tree: doc.tree, self: null }), [doc, region]);

  const dragRanges = drag ? drag.many.map((m) => rangeOf(doc, m)) : [];

  // ─── 功能區（editorBus）：指令與狀態 ─────────────────────────

  const commands: EditorCommands = {
    release: () => {
      leaveEditing();
      setMenu(null);
      select([], null, null);
    },
    mark: (m) => applyMark(m),
    color: (kind, c) => applyColor(kind, c),
    charStyle: (n) => applyCharStyle(n),
    blockBg: (c) => {
      if (stateRef.current.region) applyBlockBg(c);
      else if (selRef.current.length) applyMany(setBlocksBg(stateRef.current.source, selectedBlocks(), c));
    },
    turnInto: (t) => {
      if (stateRef.current.region) turnEditingInto(t);
      else if (selRef.current.length) turnSelectedInto(t);
    },
    indent: (outdent) => {
      const s = stateRef.current;
      if (s.region) shiftIndent(s.region, outdent, s.caret);
      else if (selRef.current.length) applyMany(indentBlocks(s.source, selectedBlocks(), outdent));
    },
    align: (a) => {
      const s = stateRef.current;
      if (s.region) {
        // 跟區塊背景一樣：包一層容器，繼續編輯同一個區塊
        const surf = surfRef.current;
        const sel: [number, number] = surf ? surf.sel() : [s.caret, s.caret];
        const res = setBlockAlign(s.source, s.region, a);
        if (res.source === s.source || res.start < 0) return;
        const len = s.region.end - s.region.start;
        pendingSel.current = sel;
        commit(activate({ source: res.source, region: null, caret: 0 }, { start: res.start, end: res.start + len }, sel[1]));
      } else if (selRef.current.length) applyMany(setBlocksAlign(s.source, selectedBlocks(), a));
    },
    box: (fn) => {
      const s = stateRef.current;
      if (s.region) {
        // 跟對齊一樣：包一層（或改）樣式容器，繼續編輯同一個區塊
        const surf = surfRef.current;
        const sel: [number, number] = surf ? surf.sel() : [s.caret, s.caret];
        const doc = parseDoc(s.source);
        const res = setBlockBox(s.source, s.region, fn(blockBox(doc, s.region)));
        if (res.source === s.source || res.start < 0) return;
        const len = s.region.end - s.region.start;
        pendingSel.current = sel;
        commit(activate({ source: res.source, region: null, caret: 0 }, { start: res.start, end: res.start + len }, sel[1]));
      } else if (selRef.current.length) applyMany(setBlocksBox(s.source, selectedBlocks(), fn));
    },
    insert: (kind) => {
      const s = stateRef.current;
      const sel = selRef.current;
      const at = s.region ? s.region.start : sel.length ? sel[sel.length - 1] : null;
      if (kind === "image" || kind === "video") {
        const map = s.region ? leaveEditing() : (l: number) => l;
        pickFiles(kind, at === null ? null : map(at));
        return;
      }
      // 分隔線用 ***：簡報裡前面空一行的 --- 是換投影片
      placeMedia(kind === "table" ? newTable() : "***", at);
    },
    insertMarkdown: (md) => {
      const s = stateRef.current;
      const sel = selRef.current;
      placeMedia(md, s.region ? s.region.start : sel.length ? sel[sel.length - 1] : null);
    },
    undo: () => undo(false),
    redo: () => undo(true),
  };
  const cmdRef = useRef(commands);
  cmdRef.current = commands;
  const statusAlign = region ? blockAlign(doc, region) : selected.length ? blockAlign(doc, { start: selected[0], end: selected[0] + 1 }) : "left";
  const boxNow = region ? blockBox(doc, region) : selected.length ? blockBox(doc, { start: selected[0], end: selected[0] + 1 }) : { css: "" };
  const statusBg = region ? ((blockBg(doc, region) as Color | null) ?? null) : null;
  const selType = !region && selected.length ? (doc.units.find((u) => u.start === selected[0]) ?? null) : null;
  const statusType = editType ?? (selType ? blockTypeOf(selType) : null);
  useEffect(() => {
    const prev = handles.get(me)?.status;
    const next: EditorStatus = {
      root: rootRef.current,
      editing: !!region,
      selected: selected.length,
      formattable,
      marks,
      type: statusType,
      bg: statusBg,
      align: statusAlign,
      box: boxNow.css,
      boxName: boxNow.name ?? "",
      textSel: !!region && textSel,
    };
    const same = prev && (Object.keys(next) as (keyof EditorStatus)[]).every((k) => prev[k] === next[k]);
    const status = same ? prev : next;
    handles.set(me, {
      status,
      cmds: {
        release: () => cmdRef.current.release(),
        mark: (m) => cmdRef.current.mark(m),
        color: (k, c) => cmdRef.current.color(k, c),
        charStyle: (n) => cmdRef.current.charStyle(n),
        blockBg: (c) => cmdRef.current.blockBg(c),
        turnInto: (t) => cmdRef.current.turnInto(t),
        indent: (o) => cmdRef.current.indent(o),
        align: (a) => cmdRef.current.align(a),
        box: (fn) => cmdRef.current.box(fn),
        insert: (k) => cmdRef.current.insert(k),
        insertMarkdown: (md) => cmdRef.current.insertMarkdown(md),
        undo: () => cmdRef.current.undo(),
        redo: () => cmdRef.current.redo(),
      },
    });
    if (!same && currentEditor === me) notifyBus();
  });

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
            align={isMediaBlock(regionText(doc.lines, u)) ? blockAlign(doc, u) : null}
            onAlign={(a) => alignBlock(u, a)}
            caption={mediaCaption(regionText(doc.lines, u))}
            onCaption={(t) => captionBlock(u, t)}
            onCodeLang={(l) => langBlock(u, l)}
            captionPos={isMediaBlock(regionText(doc.lines, u)) ? captionPos(doc, u) : "bottom"}
            onCaptionPos={(p) => captionPosBlock(u, p)}
            size={isMediaBlock(regionText(doc.lines, u)) ? blockSize(doc, u) : null}
            onSize={(z) => sizeBlock(u, z)}
            task={u.task ?? null}
            onTask={() => setTask(u.start, "cycle")}
            onTaskMenu={(x, y) => setTaskMenu({ line: u.start, x, y })}
            onWhenMenu={(x, y) => setWhenMenu({ line: u.start, x, y })}
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
                <div className="grip" title="Drag to resize columns" onPointerDown={(e) => onGapPointerDown(e, prev, c)} />
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
        (n.kind === "indent" &&
          owner?.type === "leaf" &&
          dragRanges.some((r) => owner.unit.start >= r.start && owner.unit.start < r.end)) ||
        ((n.kind === "bg" || n.kind === "align" || n.kind === "cap" || n.kind === "size" || n.kind === "box") && dragRanges.some((r) => n.open.start >= r.start && n.open.start < r.end));
      if (n.kind === "align") {
        return (
          <div key={`align:${n.open.start}`} className={`block-align align-${n.color}${dragged ? " dragging" : ""}`}>
            {renderNodes(n.children)}
          </div>
        );
      }
      if (n.kind === "size") {
        return (
          <div key={`size:${n.open.start}`} className={`block-size width-${n.color}${dragged ? " dragging" : ""}`}>
            {renderNodes(n.children)}
          </div>
        );
      }
      if (n.kind === "cap") {
        return (
          <div key={`cap:${n.open.start}`} className={`block-cap cap-${n.color}${dragged ? " dragging" : ""}`}>
            {renderNodes(n.children)}
          </div>
        );
      }
      // 背景色與區塊樣式互相單獨包住時畫成同一個 div：內距、框線、圓角才會包住背景
      const only = n.children.length === 1 && n.children[0].type === "container" ? n.children[0] : null;
      if (n.kind === "bg" || n.kind === "box") {
        const pair = only && (only.kind === "bg" || only.kind === "box") && only.kind !== n.kind ? only : null;
        const bg = n.kind === "bg" ? n : pair;
        const box = n.kind === "box" ? n : pair;
        return (
          <div
            key={`${n.kind}:${n.open.start}`}
            className={`${bg ? `block-bg bg-${bg.color}` : ""}${box ? ` block-box ${blockStyleClasses(box.color ?? "")}` : ""}${dragged ? " dragging" : ""}`}
            style={box ? blockStyleCss(box.color ?? "") : undefined}
          >
            {renderNodes(pair ? pair.children : n.children)}
          </div>
        );
      }
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
    <SpellCheck.Provider value={spellCheck}>
    <div
      ref={rootRef}
      className={`md-editor${drag ? " is-dragging" : ""}${compact ? " compact" : ""}`}
      // 不做拼字檢查（WebView2 會在英文以外的字、縮寫下畫紅色虛線）
      spellCheck={false}
      onPointerDownCapture={() => setCurrent(me)}
      onFocusCapture={() => setCurrent(me)}
    >
      {renderNodes(view.tree)}
      <div className="tail">
        {doc.units.length === 0 && !region && <span className="empty-hint">{placeholder}</span>}
      </div>
      {/* 固定在視窗上的浮動元件放到 body：編輯器在縮放的白板裡時（transform）位置才不會跑掉 */}
      {createPortal(<>
      {box && <div className="select-box" style={box} />}
      {linkAsk && region && (
        <LinkAsk onSubmit={applyLink} onCancel={() => applyLink("")} />
      )}
      {region && !drag && formatBar && (
        <FormatBar
          kind={editKind}
          marks={marks}
          bg={(blockBg(doc, region) as Color | null) ?? null}
          enabled={formattable}
          current={editType}
          onTurn={turnEditingInto}
          onToggle={applyMark}
          onColor={applyColor}
          onBlockBg={applyBlockBg}
        />
      )}
      {drag && (
        <div className="drag-ghost" style={{ left: drag.x + 12, top: drag.y + 8 }}>
          {drag.label || "(empty)"}
        </div>
      )}
      {whenMenu && (() => {
        const line = state.source.split("\n")[whenMenu.line] ?? "";
        const t = lineTask(line);
        if (!t) return null;
        const w = lineWhen(line);
        return (
          <WhenMenu
            key={whenMenu.line}
            x={whenMenu.x}
            y={whenMenu.y}
            date={w?.date ?? null}
            time={w?.time ?? null}
            onDate={(d) => setWhen(whenMenu.line, d, undefined)}
            onTime={(tm) => setWhen(whenMenu.line, undefined, tm)}
            onClose={() => setWhenMenu(null)}
          />
        );
      })()}
      {taskMenu && (() => {
        const menuLine = state.source.split("\n")[taskMenu.line] ?? "";
        const t = lineTask(menuLine);
        if (!t) return null;
        return (
          <TaskMenu
            x={taskMenu.x}
            y={taskMenu.y}
            state={t.state}
            onClose={() => setTaskMenu(null)}
            onState={(st) => {
              setTaskMenu(null);
              setTask(taskMenu.line, st);
            }}
            onSend={(date) => {
              setTaskMenu(null);
              sendTask(taskMenu.line, date);
            }}
          />
        );
      })()}
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
            bg={many ? null : ((blockBg(menuDoc, menu.unit) as Color | null) ?? null)}
            onBg={(color) => {
              setMenu(null);
              applyMany(setBlocksBg(state.source, targets, color));
            }}
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
      </>, document.body)}
    </div>
    </SpellCheck.Provider>
  );
}

/**
 * 把選單放到 body、固定在所在元素（父元素）的正下方（下面放不下就放上面）。
 * 編輯器在白板卡片裡時，卡片會捲動、裁切，還可能被縮放；放到 body 才不會被裁掉或跟著變形。
 */
function Floating({ children }: { children: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; flip: boolean } | null>(null);
  useLayoutEffect(() => {
    let raf = 0;
    const update = () => {
      const host = anchor.current?.parentElement;
      if (host) {
        const r = host.getBoundingClientRect();
        const flip = r.bottom + 340 > window.innerHeight && r.top > window.innerHeight - r.bottom;
        const next = { left: r.left, top: flip ? r.top : r.bottom, flip };
        setPos((p) => (p && p.left === next.left && p.top === next.top && p.flip === next.flip ? p : next));
      }
      raf = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <>
      <span ref={anchor} hidden />
      {pos &&
        createPortal(
          <div className={`float-anchor${pos.flip ? " flip" : ""}`} style={{ left: pos.left, top: pos.top }}>
            {children}
          </div>,
          document.body,
        )}
    </>
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
  /** 圖片、影片的對齊（null 表示不是媒體區塊，不顯示對齊工具） */
  align: Align | null;
  onAlign: (a: Align) => void;
  /** 圖片、影片的圖說（null 表示不是媒體區塊） */
  caption: string | null;
  onCaption: (text: string) => void;
  /** 程式碼區塊改語言 */
  onCodeLang: (lang: string) => void;
  /** 圖說在圖片上方或下方 */
  captionPos: CaptionPos;
  onCaptionPos: (pos: CaptionPos) => void;
  /** 圖片、影片的寬度（null 是原始大小） */
  size: MediaSize | null;
  onSize: (size: MediaSize | null) => void;
  /** 子彈筆記的任務狀態（清單項目有任務標記時） */
  task: TaskState | null;
  onTask: () => void;
  onTaskMenu: (x: number, y: number) => void;
  /** 點任務的日期時間標籤 */
  onWhenMenu: (x: number, y: number) => void;
}

/** 圖片、影片下方可以直接點來編輯的圖說。Enter 或點別處儲存，Esc 取消。 */
function Caption(props: { value: string; onSave: (text: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const read = () => (ref.current?.innerText ?? "").replace(/\s+/g, " ").trim();
  const mark = () => {
    if (ref.current) ref.current.dataset.empty = read() ? "" : "1";
  };
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && read() !== props.value) el.innerText = props.value;
    mark();
  });
  return (
    <div
      ref={ref}
      className="media-caption"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      data-placeholder="Add a caption…"
      onMouseDown={(e) => e.stopPropagation()}
      onInput={mark}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.currentTarget.innerText = props.value;
          e.currentTarget.blur();
        }
      }}
      onBlur={() => {
        const text = read();
        if (text !== props.value) props.onSave(text);
      }}
    />
  );
}

const ALIGNS: { value: Align; label: string; icon: ReactNode }[] = [
  { value: "left", label: "Align left", icon: <AlignLeftIcon /> },
  { value: "center", label: "Center", icon: <AlignCenterIcon /> },
  { value: "right", label: "Align right", icon: <AlignRightIcon /> },
];

const CAPTION_POS: { value: CaptionPos; label: string; icon: ReactNode }[] = [
  { value: "top", label: "Caption above", icon: <CaptionTopIcon /> },
  { value: "bottom", label: "Caption below", icon: <CaptionBottomIcon /> },
];

const SIZES: { value: MediaSize | null; label: string; title: string }[] = [
  { value: null, label: "Original", title: "Original size" },
  { value: "25", label: "25%", title: "25% of page width" },
  { value: "50", label: "50%", title: "50% of page width" },
  { value: "75", label: "75%", title: "75% of page width" },
  { value: "100", label: "100%", title: "Full page width" },
];

/** 選取圖片、影片時浮在它上方的選單：對齊、大小、圖說。 */
function MediaMenu(props: {
  align: Align;
  size: MediaSize | null;
  captionPos: CaptionPos;
  onAlign: (a: Align) => void;
  onSize: (s: MediaSize | null) => void;
  onCaptionPos: (p: CaptionPos) => void;
}) {
  return (
    <div
      className={`media-menu at-${props.align}`}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="group" aria-label="Align">
        {ALIGNS.map((a) => (
          <button
            key={a.value}
            className={a.value === props.align ? "on" : ""}
            title={a.label}
            onClick={() => props.onAlign(a.value)}
          >
            {a.icon}
          </button>
        ))}
      </div>
      <span className="sep" />
      <div className="group" aria-label="Size">
        {SIZES.map((z) => (
          <button
            key={z.label}
            className={`text${z.value === props.size ? " on" : ""}`}
            title={z.title}
            onClick={() => props.onSize(z.value)}
          >
            {z.label}
          </button>
        ))}
      </div>
      <span className="sep" />
      <div className="group" aria-label="Caption">
        <button
          className="text"
          title="Edit caption"
          onClick={(e) => {
            const cap = e.currentTarget.closest(".content")?.querySelector<HTMLElement>(".media-caption");
            if (!cap) return;
            cap.focus();
            const r = document.createRange();
            r.selectNodeContents(cap);
            r.collapse(false);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(r);
          }}
        >
          Caption
        </button>
        {CAPTION_POS.map((c) => (
          <button
            key={c.value}
            className={c.value === props.captionPos ? "on" : ""}
            title={c.label}
            onClick={() => props.onCaptionPos(c.value)}
          >
            {c.icon}
          </button>
        ))}
      </div>
    </div>
  );
}

function UnitRow({ unit, doc, drop, dragging, selected, align, caption, captionPos, size, task, ...on }: UnitRowProps) {
  let body: ReactNode;
  const html = { __html: clean(task ? taskHtml(unit) : unit.html) };
  if (unit.kind === "item" && unit.list) {
    const li = task ? (
      <li className={`task t-${task}${unit.check ? " check" : ""}${unit.when ? " has-when" : ""}`}>
        <TaskGlyph state={task} box={unit.check} onClick={on.onTask} onMenu={on.onTaskMenu} />
        <div dangerouslySetInnerHTML={html} />
        {unit.when && (
          <WhenChip
            date={unit.when.date}
            label={whenLabel(unit.when.date, unit.when.time)}
            state={task}
            onClick={on.onWhenMenu}
          />
        )}
      </li>
    ) : (
      <li dangerouslySetInnerHTML={html} />
    );
    body = unit.list.ordered ? <ol start={unit.list.number}>{li}</ol> : <ul>{li}</ul>;
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
        <button className="add" title="Add a block below" onMouseDown={(e) => e.preventDefault()} onClick={on.onAdd}>
          <PlusIcon />
        </button>
        <button className="handle" title="Drag to move · click for menu" onPointerDown={on.onHandlePointerDown}>
          <GripIcon />
        </button>
      </div>
      <div className="content" onMouseDown={on.onMouseDown}>
        {align ? (
          <div className="media-frame">
            {body}
            {caption !== null && <Caption value={caption} onSave={on.onCaption} />}
          </div>
        ) : (
          body
        )}
        {unit.kind === "code" && (() => {
          const code = parseCodeBlock(regionText(doc.lines, unit));
          return code ? (
            <CodeTools lang={code.lang} code={() => parseCodeBlock(regionText(doc.lines, unit))?.code ?? ""} onLang={on.onCodeLang} />
          ) : null;
        })()}
        {align && selected && (
          <MediaMenu
            align={align}
            size={size}
            captionPos={captionPos}
            onAlign={on.onAlign}
            onSize={on.onSize}
            onCaptionPos={on.onCaptionPos}
          />
        )}
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
      return unit.check ? "todo" : unit.task ? (unit.task === "event" ? "event" : "task") : unit.list?.ordered ? "ordered" : "bullet";
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

/** 所見即所得插入連結時輸入網址的小視窗。 */
function LinkAsk(props: { onSubmit: (url: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="popover link-ask">
      <LinkIcon />
      <input
        ref={ref}
        placeholder="Paste or type a URL, then press Enter"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            props.onSubmit(e.currentTarget.value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            props.onCancel();
          }
        }}
        onBlur={(e) => {
          if (!(e.relatedTarget as Element | null)?.closest?.(".link-ask")) props.onCancel();
        }}
      />
    </div>
  );
}

/** 把游標放在畫面上的某一點（點擊進入編輯時用）；點不在元素裡就回傳 false。 */
function placeAtPoint(el: HTMLElement, p: { x: number; y: number }): boolean {
  const d = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  let node: Node | null = null;
  let offset = 0;
  if (d.caretPositionFromPoint) {
    const r = d.caretPositionFromPoint(p.x, p.y);
    if (r) [node, offset] = [r.offsetNode, r.offset];
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(p.x, p.y);
    if (r) [node, offset] = [r.startContainer, r.startOffset];
  }
  if (!node || !el.contains(node)) return false;
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const sel = document.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  return true;
}

/** 只能插入、不能拿來「轉換成」的區塊類型 */
const INSERT_ONLY = new Set<BlockType>(["image", "video", "table"]);

const FORMATS: { mark: Mark; label: string; key: string; icon: ReactNode }[] = [
  { mark: "bold", label: "Bold", key: "Ctrl+B", icon: <b>B</b> },
  { mark: "italic", label: "Italic", key: "Ctrl+I", icon: <i>I</i> },
  { mark: "underline", label: "Underline", key: "Ctrl+U", icon: <u className="fb-u">U</u> },
  { mark: "strike", label: "Strikethrough", key: "Ctrl+Shift+X", icon: <s className="fb-s">S</s> },
  { mark: "sup", label: "Superscript", key: "Ctrl+.", icon: <span className="fb-script">x<sup>2</sup></span> },
  { mark: "sub", label: "Subscript", key: "Ctrl+,", icon: <span className="fb-script">x<sub>2</sub></span> },
  { mark: "code", label: "Code", key: "Ctrl+E", icon: <CodeGlyph /> },
  { mark: "link", label: "Link", key: "Ctrl+K", icon: <LinkIcon /> },
];

function CodeGlyph() {
  return <span className="fb-code">{"</>"}</span>;
}

/** 一排顏色：預設＋九種。kind 決定樣本的畫法（文字、螢光、區塊背景）。 */
export function Swatches(props: { kind: "color" | "highlight" | "bg"; value: Color | null; onPick: (c: Color | null) => void }) {
  return (
    <div className="swatches">
      {[null, ...COLORS].map((c) => (
        <button
          key={c ?? "default"}
          className={`swatch ${props.kind}${c ? ` ${props.kind === "color" ? "tc" : props.kind === "highlight" ? "hl" : "bg"}-${c}` : " none"}${
            props.value === c ? " on" : ""
          }`}
          title={c ? COLOR_LABELS[c] : "Default"}
          onClick={() => props.onPick(c)}
        >
          {props.kind === "bg" ? "" : "A"}
        </button>
      ))}
    </div>
  );
}

/** 編輯時固定在畫面下方的格式列：顯示游標所在文字的狀態，點按鈕切換格式、選顏色。 */
function FormatBar(props: {
  kind: string;
  marks: Marks | null;
  bg: Color | null;
  enabled: boolean;
  /** 編輯中區塊的類型（「Turn into」選單打勾） */
  current: BlockType | null;
  onTurn: (t: BlockType) => void;
  onToggle: (m: Mark) => void;
  onColor: (kind: "color" | "highlight", c: Color | null) => void;
  onBlockBg: (c: Color | null) => void;
}) {
  const [open, setOpen] = useState<"turn" | "color" | null>(null);
  const m = props.marks;
  const active = FORMATS.filter((f) => m?.[f.mark]).map((f) => f.label);
  if (m?.color) active.push(`${COLOR_LABELS[m.color]} text`);
  if (m?.highlight) active.push(`${COLOR_LABELS[m.highlight]} highlight`);
  if (props.bg) active.push(`${COLOR_LABELS[props.bg]} background`);
  return (
    <div className="format-bar" role="toolbar" aria-label="Text formatting" onMouseDown={(e) => e.preventDefault()}>
      <button
        className={`fb-kind${open === "turn" ? " on" : ""}`}
        title="Turn into another block type"
        aria-haspopup="menu"
        aria-expanded={open === "turn"}
        onClick={() => setOpen((v) => (v === "turn" ? null : "turn"))}
      >
        {props.kind}
        <span className="fb-caret">▾</span>
      </button>
      <span className="fb-sep" />
      {FORMATS.map((f) => (
        <button
          key={f.mark}
          className={m?.[f.mark] ? "on" : ""}
          disabled={!props.enabled}
          title={`${f.label} (${f.key})`}
          aria-pressed={!!m?.[f.mark]}
          onClick={() => props.onToggle(f.mark)}
        >
          {f.icon}
        </button>
      ))}
      <button
        className={`fb-color${open === "color" ? " on" : ""}`}
        title="Color: text, highlight, block background"
        onClick={() => setOpen((v) => (v === "color" ? null : "color"))}
      >
        <span className={`fb-a${m?.color ? ` tc-${m.color}` : ""}${m?.highlight ? ` hl-${m.highlight}` : ""}`}>A</span>
        <span className="fb-caret">▾</span>
      </button>
      <span className="fb-sep" />
      <span className={`fb-state${active.length ? " has" : ""}`}>
        {!props.enabled ? "Raw text" : active.length ? active.join("・") : "Plain text"}
      </span>
      {open === "turn" && (
        <div className="popover block-menu turn-menu" role="menu">
          <div className="popover-title">Turn into</div>
          {BLOCK_TYPES.filter((t) => !INSERT_ONLY.has(t.type) && t.type !== "hr").map((t) => (
            <button
              key={t.type}
              role="menuitem"
              className={t.type === props.current ? "current" : ""}
              onClick={() => {
                setOpen(null);
                if (t.type !== props.current) props.onTurn(t.type);
              }}
            >
              <span className="tile small">{t.icon}</span>
              <span className={`label look look-${t.type}`}>{t.label}</span>
              {t.type === props.current && <span className="check">✓</span>}
            </button>
          ))}
        </div>
      )}
      {open === "color" && (
        <div className="popover color-menu">
          {props.enabled && (
            <>
              <div className="popover-title">Text color</div>
              <Swatches kind="color" value={m?.color ?? null} onPick={(c) => props.onColor("color", c)} />
              <div className="popover-title">Highlight</div>
              <Swatches kind="highlight" value={m?.highlight ?? null} onPick={(c) => props.onColor("highlight", c)} />
            </>
          )}
          <div className="popover-title">Block background</div>
          <Swatches kind="bg" value={props.bg} onPick={props.onBlockBg} />
        </div>
      )}
    </div>
  );
}

/** 游標前面還沒打完的頁面連結：`[[`（或跳脫過的 `\[\[`）的位置與已經打的名稱。 */
export function findRefQuery(text: string, caret: number): { from: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(?:\\?\[){2}((?:\\.|[^[\]\n\\])*)$/.exec(before);
  if (!m) return null;
  const query = m[1].replace(/\\(.)/g, "$1");
  if (query.length > 60) return null;
  return { from: m.index, query };
}

/** 輸入 `[[` 後的頁面建議。 */
interface RefItem {
  /** 寫進 [[…]] 的名稱 */
  name: string;
  create: boolean;
  /** 引用：條目標題與作者、年份 */
  label?: string;
  desc?: string;
  /** Dock 的文件 */
  dock?: boolean;
  /** Desk 的檔案（分級選單：選了進到它的文件） */
  folder?: string;
}

function RefMenu(props: {
  cite: boolean;
  items: RefItem[];
  /** 第二層：正在看的檔案 */
  folder?: string | null;
  onBack?: () => void;
  active: number;
  onPick: (it: RefItem) => void;
  onHover: (i: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  }, [props.active]);
  return (
    <div className="popover slash-menu ref-menu" onMouseDown={(e) => e.preventDefault()}>
      <div className="popover-scroll" ref={ref}>
        {props.folder ? (
          <button className="ref-back" onClick={props.onBack} title="Back (←)">
            <span className="chev">‹</span>
            <span className="text">{props.folder}</span>
          </button>
        ) : (
          <div className="popover-title">{props.cite ? "Cite from Drawer" : "Link to page or document"}</div>
        )}
        {props.items.length === 0 && (
          <div className="popover-empty">{props.cite ? "No items in Drawer" : props.folder ? "No matching documents" : "Type a page name"}</div>
        )}
        {props.items.map((t, i) => (
          <button
            key={(t.create ? "+" : "") + t.name}
            className={i === props.active ? "active" : ""}
            onMouseEnter={() => props.onHover(i)}
            onClick={() => props.onPick(t)}
          >
            <span className="tile">{t.create ? "+" : props.cite ? "❞" : t.folder ? "▦" : t.dock ? "▤" : "[["}</span>
            <span className="text">
              <span className="label">{t.label ?? t.name}</span>
              <span className="desc">{t.desc ?? (t.create ? (props.cite ? "Not in Drawer — new page" : "New page") : "Existing page")}</span>
            </span>
            {t.folder && <span className="chev">›</span>}
          </button>
        ))}
      </div>
      <div className="popover-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> Choose
        </span>
        <span>
          <kbd>Enter</kbd> OK
        </span>
        <span>
          <kbd>Esc</kbd> Close
        </span>
      </div>
    </div>
  );
}

const STATE_ITEMS: TaskState[] = ["open", "done", "cancelled", "event"];

/**
 * 任務的日期與時間選單（點「2026/11/18 23:00」標籤）：日期就是排程（標成 `{<}`、行尾寫日期），
 * 開始／結束時間寫在內容開頭。改了就直接寫回原始碼。
 */
function WhenMenu(props: {
  x: number;
  y: number;
  date: string | null;
  time: TaskTime | null;
  onDate: (date: string | null) => void;
  onTime: (time: TaskTime | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: props.x, top: props.y });
  const [start, setStart] = useState(props.time ? clock(props.time.start) : "");
  const [end, setEnd] = useState(props.time?.end !== undefined ? clock(props.time.end) : "");
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
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      left: Math.max(8, Math.min(props.x, window.innerWidth - r.width - 8)),
      top: r.bottom > window.innerHeight - 8 ? Math.max(8, props.y - r.height - 32) : props.y,
    });
  }, [props.x, props.y]);
  /** 開始、結束都填好（或只有開始）才寫入 */
  const commitTime = (s: string, e: string) => {
    const a = parseClock(s);
    if (a === null || a >= 1440) return;
    const b = parseClock(e);
    props.onTime(b !== null && b > a ? { start: a, end: b } : { start: a });
  };
  return (
    <div className="popover when-menu" ref={ref} style={pos}>
      <div className="popover-title">Date & time</div>
      <div className="when-row">
        <span>Date</span>
        <input
          type="date"
          value={props.date ?? ""}
          onChange={(e) => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) props.onDate(e.target.value);
          }}
          aria-label="Date"
        />
        {props.date && (
          <button className="when-clear" onClick={() => props.onDate(null)} title="Unschedule">
            Clear
          </button>
        )}
      </div>
      <div className="when-row">
        <span>Time</span>
        <input
          type="time"
          value={start}
          onChange={(e) => {
            const v = e.target.value;
            // 改開始時間時結束時間跟著移（保持長度）
            const a = parseClock(start);
            const b = parseClock(end);
            const n = parseClock(v);
            const ne = a !== null && b !== null && n !== null && b > a ? clock(Math.min(1439, n + b - a)) : end;
            setStart(v);
            setEnd(ne);
            commitTime(v, ne);
          }}
          aria-label="Start time"
        />
        <span>–</span>
        <input
          type="time"
          value={end}
          onChange={(e) => {
            setEnd(e.target.value);
            commitTime(start, e.target.value);
          }}
          aria-label="End time"
        />
      </div>
      {props.time && (
        <div className="when-row">
          <button
            className="when-clear"
            onClick={() => {
              setStart("");
              setEnd("");
              props.onTime(null);
            }}
          >
            All day
          </button>
        </div>
      )}
    </div>
  );
}

/** 子彈筆記符號的選單：改狀態、排程。 */
function TaskMenu(props: {
  x: number;
  y: number;
  state: TaskState;
  onClose: () => void;
  onState: (s: TaskState | null) => void;
  onSend: (date: string) => void;
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
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      left: Math.max(8, Math.min(props.x, window.innerWidth - r.width - 8)),
      top: r.bottom > window.innerHeight - 8 ? Math.max(8, props.y - r.height) : props.y,
    });
  }, [props.x, props.y]);
  const today = localDay(0);
  return (
    <div className="popover block-menu task-menu" ref={ref} style={pos}>
      <div className="popover-title">Bullet journal</div>
      {STATE_ITEMS.map((st) => (
        <button key={st} className={st === props.state ? "current" : ""} onClick={() => props.onState(st)}>
          <span className={`tile small task-tile g-${st}`}>
            <TaskIcon state={st} />
          </span>
          <span className="label">{TASK_LABEL[st]}</span>
          {st === props.state && <span className="check">✓</span>}
        </button>
      ))}
      <button onClick={() => props.onState(null)}>
        <span className="tile small task-tile">
          <TaskIcon state="note" />
        </span>
        <span className="label">Note (remove symbol)</span>
      </button>
      <div className="popover-sep" />
      <label className="task-date">
        <span className="tile small task-tile">
          <TaskIcon state="scheduled" />
        </span>
        <span className="label">Schedule to</span>
        <input
          type="date"
          min={today}
          onChange={(e) => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) props.onSend(e.target.value);
          }}
        />
      </label>
    </div>
  );
}

/** 今天加上 n 天（當地時間的 YYYY-MM-DD）。 */
function localDay(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function SlashMenu(props: {
  items: SlashItem[];
  active: number;
  onPick: (t: SlashItem) => void;
  onHover: (i: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  }, [props.active]);
  return (
    <div className="popover slash-menu" onMouseDown={(e) => e.preventDefault()}>
      <div className="popover-scroll" ref={ref}>
        {props.items[0]?.type !== "template" && <div className="popover-title">Basic blocks</div>}
        {props.items.length === 0 && <div className="popover-empty">No matching blocks</div>}
        {props.items.map((t, i) => [
          t.type === "template" && props.items[i - 1]?.type !== "template" && (
            <div key="tpl-title" className="popover-title">
              Templates
            </div>
          ),
          <button
            key={t.type + (t.template ?? "")}
            className={i === props.active ? "active" : ""}
            onMouseEnter={() => props.onHover(i)}
            onClick={() => props.onPick(t)}
          >
            <span className="tile">{t.icon}</span>
            <span className="text">
              <span className={`label look look-${t.type}`}>{t.label}</span>
              <span className="desc">{t.description}</span>
            </span>
            {t.hint && <kbd className="hint">{t.hint}</kbd>}
          </button>,
        ])}
      </div>
      <div className="popover-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> Choose
        </span>
        <span>
          <kbd>Enter</kbd> OK
        </span>
        <span>
          <kbd>Esc</kbd> Close
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
  bg: Color | null;
  onBg: (c: Color | null) => void;
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
      {props.count > 1 && <div className="popover-count">{props.count} blocks selected</div>}
      <div className="popover-title">Turn into</div>
      {BLOCK_TYPES.filter((t) => !INSERT_ONLY.has(t.type)).map((t) => (
        <button
          key={t.type}
          className={t.type === props.current ? "current" : ""}
          onClick={() => props.onTurn(t.type)}
        >
          <span className="tile small">{t.icon}</span>
          <span className={`label look look-${t.type}`}>{t.label}</span>
          {t.type === props.current && <span className="check">✓</span>}
        </button>
      ))}
      <div className="popover-title">Background color</div>
      <Swatches kind="bg" value={props.bg} onPick={props.onBg} />
      <div className="popover-sep" />
      {props.canIndent && (
        <button onClick={() => props.onIndent(false)}>
          <span className="glyph">
            <IndentIcon />
          </span>
          <span className="label">Indent</span>
          <kbd className="hint">Tab</kbd>
        </button>
      )}
      {props.canOutdent && (
        <button onClick={() => props.onIndent(true)}>
          <span className="glyph">
            <OutdentIcon />
          </span>
          <span className="label">Outdent</span>
          <kbd className="hint">⇧Tab</kbd>
        </button>
      )}
      <button onClick={props.onDuplicate}>
        <span className="glyph">
          <CopyIcon />
        </span>
        <span className="label">Duplicate</span>
      </button>
      <button className="danger" onClick={props.onDelete}>
        <span className="glyph">
          <TrashIcon />
        </span>
        <span className="label">Delete</span>
      </button>
    </div>
  );
}
