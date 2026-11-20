import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isTauri } from "@tauri-apps/api/core";
import { highlightCode, parseCodeBlock } from "../editor/codeHighlight";
import { CodeTools } from "../editor/CodeTools";
import { Editor } from "../editor/Editor";
import {
  CalendarIcon,
  CloseIcon,
  DocIcon,
  BoardIcon,
  DrawIcon,
  FitIcon,
  MinusIcon,
  NoteIcon,
  OpenIcon,
  PencilIcon,
  PlusIcon,
  SectionIcon,
  SendIcon,
  SheetIcon,
  SlidesIcon,
  ImageIcon,
  MindMapIcon,
  TrashIcon,
} from "../editor/icons";
import { importMediaPath, kindOf, mediaUrl, saveMedia } from "../editor/media";
import { parseDiagram } from "./draw";
import { loadImages, toSvg } from "./drawExport";
import { DrawView } from "./DrawView";
import { newCardWorkbook, sheetCardSize, sheetPreview, tabularClip } from "./boardSheet";
import { SheetView } from "../sheet/SheetView";
import { parseWorkbook, serializeWorkbook, type Workbook } from "../sheet/model";
import { COLORS, COLOR_LABELS, type Color } from "../editor/inline";
import { dayTitle, isDateKey, weekday } from "../journal/journal";
import type { Docs } from "../journal/useJournals";
import { cleanName, pageKey } from "../pages/pageRef";
import {
  addCard,
  addEdge,
  addCode,
  addDraw,
  addTableCard,
  editsInPlace,
  DRAW_H,
  DRAW_W,
  fixedSize,
  addMedia,
  addNote,
  addSection,
  boundsOf,
  CARD_AUTO_MAX_H,
  CARD_MIN_H,
  CARD_MIN_W,
  CARD_W,
  CODE_W,
  cardRect,
  clipText,
  contains,
  copyItems,
  dangling,
  edgePath,
  findCard,
  fitCamera,
  flipEdge,
  intersects,
  isDocRef,
  MEDIA_MIN,
  moveItems,
  NOTE_W,
  parseBoard,
  parseClip,
  pasteItems,
  readingOrder,
  removeItems,
  sectionAround,
  sectionMembers,
  SECTION_MIN,
  serializeBoard,
  setCardLook,
  toWorld,
  updateCard,
  updateEdge,
  updateSection,
  zoomAt,
  type Board,
  type Camera,
  type Card,
  type CardRef,
  type DocRef,
  type MediaType,
  type Rect,
  type Section,
} from "./board";
import { embedUrl, fitMediaSize, mediaFromUrl, resizeKeepRatio } from "./boardMedia";
import { DOCK_KINDS, kindLabel, type DockKind } from "./file";
import { loadCamera, saveCamera } from "./store";
import { MindMapView } from "./MindMapView";
import { CardStyleBar, MindMapStyleBar } from "./MindMapStyle";
import {
  addChild,
  addSibling,
  detachTopic,
  findTopic,
  isWithin,
  layoutMap,
  mapBounds,
  mapOutline,
  moveTopic,
  neighbor,
  removeTopic,
  setMapStyle,
  setText,
  setTopicLook,
  siblingAxis,
  toggleCollapse,
  type DropMode,
} from "./mindmap";
import { insertMindMap, insertMindMapAt, mindMapSpot } from "./templates";
import { alignBounds, measureBetween, snapMove, snapResizeGrid, type Guide, type Measure } from "../align/align";
import { AlignOverlay } from "../align/AlignMarks";
import "./board.css";

/**
 * Desk 檔案的白板（參考 Heptabase）：發想用，想到什麼就貼上去，不管順序。
 *
 * - 便利貼：連按兩下空白處、按 N、或在畫布上貼上文字／圖片就新增一張，直接打字。
 * - 卡片也可以是頁面或日記，在卡片裡直接編輯；拖標題列搬移，右邊、右下角拉大小。
 * - 選取卡片後「Send to Dock」：照閱讀順序（由上到下、由左到右）接到 Dock 的一份文件後面。
 * - 從卡片四邊的圓點拖到另一張卡片就連起來；連線可以加標籤、反轉方向。
 * - 區段是一個有標題的框，拖動標題時框裡的卡片一起移動。
 * - 媒體卡片：貼上（Ctrl＋V）或從檔案總管拖進來的圖片、GIF、影片，存到 media/；貼上 YouTube／Vimeo 網址是嵌入影片，
 *   .mp4／.webm 網址是影片（`boardMedia.ts`）。照比例改大小；影片、嵌入影片要先選取才能播放（沒選取時點下去是選取、拖曳）。
 * - Ctrl＋C／X／V 複製、剪下、貼上選取的東西，Ctrl＋D 原地複製一份（剪貼簿是 JSON 文字，`copyItems`、`pasteItems`）。
 * - 程式碼卡片：工具列「Code」、右鍵「Add code block here」，或在畫布上貼上 ``` 區塊；語法上色、語言選單、複製
 *   和編輯器的程式碼區塊共用（`src/editor/codeHighlight.ts`、`CodeTools.tsx`）。
 * - 範本只有心智圖（`templates.ts`）。
 * - 心智圖（參考 XMind，`mindmap.ts`、`MindMapView.tsx`）：自動排版；選取主題後 Tab 加子主題、Enter 加同層主題、
 *   Space／F2／連按兩下編輯、Delete 刪除、方向鍵移動、Ctrl＋. 收合；拖主題到別的主題上搬移，拖到空白處變成新的一張圖，
 *   拖中心主題搬整張圖。
 * - 滾輪（觸控板兩指）平移、Ctrl＋滾輪（捏合）縮放、按住空白鍵或滑鼠中鍵拖曳平移；
 *   在空白處拖曳框選，連按兩下新增卡片。
 *
 * 編輯器裡的按鍵（復原、刪除…）照舊交給編輯器；焦點在畫布本身時才是白板的操作。
 */

type Menu =
  | { kind: "card"; id: string; x: number; y: number }
  | { kind: "section"; id: string; x: number; y: number }
  | { kind: "edge"; id: string; x: number; y: number }
  | { kind: "topic"; map: string; topic: string; x: number; y: number }
  | { kind: "canvas"; x: number; y: number; wx: number; wy: number };

type Picker = { x: number; y: number; wx: number; wy: number };

/** 送到 Dock 的目標：既有的文件，或新增一份 */
export type SendTarget = { doc: string } | { kind: DockKind } | { tasks: true };

interface Props {
  /** Desk 檔案的名稱（記住畫面位置用） */
  name: string;
  /** 白板的 JSON */
  json: string;
  onWrite: (json: string) => void;
  pages: Docs;
  journals: Docs;
  /** 可以放上白板的頁面名稱（有內容的與被提到的） */
  pageNames: string[];
  now: string;
  onOpen: (ref: CardRef) => void;
  /** 刪除卡片指向的頁面或日記（App 確認），刪了回傳 true，這張白板上指向它的卡片也拿掉 */
  onDeleteRef?: (ref: CardRef) => boolean;
  /** Dock 裡的文件（送到 Dock 的選單用） */
  dock: { id: string; title: string; kind: DockKind }[];
  /** 把卡片（已照閱讀順序排好）送到 Dock，回傳那份文件的標題 */
  onSend: (cards: Card[], to: SendTarget) => string;
  /** 打開 Dock 的某份文件 */
  onOpenDoc: (id: string | null) => void;
  /** 打開這個檔案的 Tasks（送到 Tasks 之後按 Open） */
  onOpenTasks?: () => void;
}

const refKey = (r: CardRef) => (r.kind === "page" ? pageKey(r.name) : r.kind === "day" ? r.date : "");

export function Whiteboard(props: Props) {
  const { name, pages, journals, now, json, onWrite } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const markerId = useId().replace(/:/g, "");

  /* ─── 白板內容與復原 ─── */

  const [board, setBoardState] = useState<Board>(() => parseBoard(json));
  const boardRef = useRef(board);
  const lastJson = useRef(json);
  const history = useRef<{ past: Board[]; future: Board[] }>({ past: [], future: [] });
  // 檔案在別處被改了（例如頁面改名、另一個視窗）就採用
  useEffect(() => {
    if (json !== lastJson.current) {
      lastJson.current = json;
      const b = parseBoard(json);
      boardRef.current = b;
      setBoardState(b);
    }
  }, [json]);

  const write = useCallback(
    (next: Board) => {
      boardRef.current = next;
      setBoardState(next);
      const j = serializeBoard(next);
      lastJson.current = j;
      onWrite(j);
    },
    [onWrite],
  );
  /** 改白板；record=false 是拖曳中途（拖曳開始時已經記過復原點）。 */
  const apply = useCallback(
    (next: Board, record = true) => {
      if (next === boardRef.current) return;
      if (record) {
        const h = history.current;
        h.past.push(boardRef.current);
        if (h.past.length > 200) h.past.shift();
        h.future = [];
      }
      write(next);
    },
    [write],
  );
  const checkpoint = () => {
    const h = history.current;
    h.past.push(boardRef.current);
    if (h.past.length > 200) h.past.shift();
    h.future = [];
  };
  const undo = (redo: boolean) => {
    const h = history.current;
    const from = redo ? h.future : h.past;
    const to = redo ? h.past : h.future;
    const b = from.pop();
    if (!b) return;
    to.push(boardRef.current);
    write(b);
  };

  /* ─── 卡片實際高度（高度跟著內容的卡片要量） ─── */

  const [heights, setHeights] = useState<Record<string, number>>({});
  const heightsRef = useRef(heights);
  heightsRef.current = heights;
  const onHeight = useCallback((id: string, h: number) => {
    setHeights((hs) => (Math.abs((hs[id] ?? 0) - h) < 0.5 ? hs : { ...hs, [id]: h }));
  }, []);
  const rectOf = useCallback((c: Card) => cardRect(c, heightsRef.current), []);

  /* ─── 畫面（平移、縮放） ─── */

  const [cam, setCamState] = useState<Camera>(() => loadCamera(name) ?? { x: 80, y: 80, zoom: 1 });
  const camRef = useRef(cam);
  const setCam = useCallback((c: Camera) => {
    camRef.current = c;
    setCamState(c);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => saveCamera(name, cam), 300);
    return () => clearTimeout(t);
  }, [name, cam]);
  const viewport = () => {
    const r = rootRef.current?.getBoundingClientRect();
    return { left: r?.left ?? 0, top: r?.top ?? 0, w: r?.width ?? 800, h: r?.height ?? 600 };
  };
  const screenToWorld = (clientX: number, clientY: number) => {
    const v = viewport();
    return toWorld(camRef.current, clientX - v.left, clientY - v.top);
  };
  const allRects = (b = boardRef.current): Rect[] => [...b.cards.map(rectOf), ...b.sections, ...b.maps.map(mapBounds)];
  const fit = (rects = allRects()) => {
    const v = viewport();
    setCam(fitCamera(boundsOf(rects), v.w, v.h));
  };
  // 第一次開（沒有記住的畫面位置）：把全部內容放進畫面
  useLayoutEffect(() => {
    if (!loadCamera(name)) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const zoomBy = (factor: number) => {
    const v = viewport();
    setCam(zoomAt(camRef.current, camRef.current.zoom * factor, v.w / 2, v.h / 2));
  };
  /** 把白板上的點捲到畫面中央。 */
  const centerOn = (r: Rect) => {
    const v = viewport();
    const z = camRef.current.zoom;
    setCam({ zoom: z, x: v.w / 2 - (r.x + r.w / 2) * z, y: v.h / 2 - (r.y + Math.min(r.h, 200) / 2) * z });
  };

  // 滾輪：平移；Ctrl＋滾輪（觸控板捏合）：以滑鼠為中心縮放。要 passive: false 才能擋掉頁面捲動。
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest?.(".board-ui, .board-menu, .board-picker")) return;
      const v = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const c = camRef.current;
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
        setCam(zoomAt(c, c.zoom * factor, e.clientX - v.left, e.clientY - v.top));
        return;
      }
      // 卡片內容可以捲就先捲卡片
      const scroller = t.closest?.(".bc-body") as HTMLElement | null;
      if (scroller && scroller.scrollHeight > scroller.clientHeight + 1 && !e.shiftKey) {
        const down = e.deltaY > 0;
        const atEdge = down
          ? scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1
          : scroller.scrollTop <= 0;
        if (!atEdge) return;
      }
      e.preventDefault();
      const k = e.deltaMode === 1 ? 16 : 1;
      const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k;
      const dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k;
      const c = camRef.current;
      setCam({ ...c, x: c.x - dx, y: c.y - dy });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [setCam]);

  // 按住空白鍵拖曳平移（在編輯器、輸入框裡打空白不算）
  const [spaceDown, setSpaceDown] = useState(false);
  const spaceRef = useRef(false);
  useEffect(() => {
    const editable = (t: EventTarget | null) =>
      !!(t as HTMLElement)?.closest?.("input, textarea, [contenteditable='true'], [contenteditable='']");
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && !editable(e.target) && e.target === rootRef.current && !topicSelRef.current) {
        e.preventDefault();
        spaceRef.current = true;
        setSpaceDown(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" && spaceRef.current) {
        spaceRef.current = false;
        setSpaceDown(false);
      }
    };
    const blur = () => {
      spaceRef.current = false;
      setSpaceDown(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  /* ─── 選取 ─── */

  /** 心智圖：選取的主題、正在編輯的主題、拖曳中的主題 */
  const [topicSel, setTopicSelState] = useState<{ map: string; topic: string } | null>(null);
  const topicSelRef = useRef<{ map: string; topic: string } | null>(null);
  const setTopicSel = useCallback((t: { map: string; topic: string } | null) => {
    topicSelRef.current = t;
    setTopicSelState(t);
  }, []);
  type Editing = { map: string; topic: string; text: string; selectAll: boolean };

  const [selected, setSelectedState] = useState<string[]>([]);
  const selRef = useRef<string[]>([]);
  const select = useCallback((ids: string[]) => {
    selRef.current = ids;
    setSelectedState(ids);
  }, []);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  // 白板內容變了，選取裡已經不存在的就拿掉
  useEffect(() => {
    const ids = new Set([...board.cards, ...board.sections, ...board.edges, ...board.maps].map((x) => x.id));
    if (selRef.current.some((id) => !ids.has(id))) select(selRef.current.filter((id) => ids.has(id)));
    const ts = topicSelRef.current;
    if (ts) {
      const m = board.maps.find((x) => x.id === ts.map);
      if (!m || !findTopic(m, ts.topic)) setTopicSel(null);
    }
  }, [board, select, setTopicSel]);

  const [menu, setMenu] = useState<Menu | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [box, setBox] = useState<Rect | null>(null);
  const [link, setLink] = useState<{ from: string; x: number; y: number; over: string | null } | null>(null);
  const [editLabel, setEditLabel] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [dragging, setDragging] = useState(false);

  /* ─── 輔助對齊（和 Draw 共用 src/align）：拖曳、改大小時吸到其他東西的邊、中線或等距，顯示距離；Alt 量距離 ─── */

  const [guides, setGuides] = useState<Guide[]>([]);
  const [measures, setMeasures] = useState<Measure[]>([]);
  const clearAlign = () => {
    setGuides([]);
    setMeasures([]);
  };
  /** 卡片、區段、心智圖的外框 */
  const itemRect = (b: Board, id: string): Rect | null => {
    const c = b.cards.find((x) => x.id === id);
    if (c) return rectOf(c);
    const sec = b.sections.find((x) => x.id === id);
    if (sec) return { x: sec.x, y: sec.y, w: sec.w, h: sec.h };
    const m = b.maps.find((x) => x.id === id);
    return m ? mapBounds(m) : null;
  };
  const itemIds = (b: Board) => [...b.cards.map((c) => c.id), ...b.sections.map((x) => x.id), ...b.maps.map((m) => m.id)];
  const rectsOf = (b: Board, ids: Iterable<string>) => [...ids].map((id) => itemRect(b, id)).filter((r): r is Rect => !!r);
  /** 拖曳時吸附：回傳修正後的位移（Alt 暫時不吸附） */
  const snapDrag = (b: Board, moving: Set<string>, dx: number, dy: number, ev: PointerEvent) => {
    const bb = alignBounds(rectsOf(b, moving));
    if (ev.altKey || !bb) {
      clearAlign();
      return { dx, dy };
    }
    const others = rectsOf(b, itemIds(b).filter((id) => !moving.has(id)));
    const r = snapMove(bb, dx, dy, others, 6 / camRef.current.zoom, null);
    setGuides(r.guides);
    setMeasures(r.measures);
    return r;
  };
  // 選取後按住 Alt：量到滑過的卡片、區段或心智圖
  const [altAt, setAltAt] = useState<{ x: number; y: number } | null>(null);
  const altRef = useRef(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Alt") altRef.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== "Alt") return;
      altRef.current = false;
      setAltAt(null);
    };
    const blur = () => {
      altRef.current = false;
      setAltAt(null);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);
  /** 「送到 Dock」的選單（位置是畫布內的座標） */
  const [send, setSend] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditingState] = useState<Editing | null>(null);
  const editRef = useRef<Editing | null>(null);
  const setEditing = useCallback((e: Editing | null) => {
    editRef.current = e;
    setEditingState(e);
  }, []);
  const [mmDrag, setMmDrag] = useState<{
    map: string;
    topic: string;
    x: number;
    y: number;
    text: string;
    drop: { map: string; topic: string; mode: DropMode } | null;
  } | null>(null);
  /** 剛送出：顯示「Sent to …」一下 */
  const [sent, setSent] = useState<{ title: string; doc: string | null; n: number; tasks?: boolean } | null>(null);
  useEffect(() => {
    if (!sent) return;
    const t = setTimeout(() => setSent(null), 4000);
    return () => clearTimeout(t);
  }, [sent]);

  const focusCanvas = () => rootRef.current?.focus({ preventScroll: true });
  /** 上次拖曳（搬移、拉大小、連線）的時間：剛拖完的兩下點擊不算連按兩下 */
  const draggedAt = useRef(0);

  /* ─── 指標操作（全部從畫布根元素分派） ─── */

  const lastDown = useRef({ x: 0, y: 0 });
  const onPointerDown = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement;
    lastDown.current = { x: e.clientX, y: e.clientY };
    // 卡片內容交給編輯器；浮動的工具列、選單自己處理
    if (t.closest(".bc-body, .bm-live, .board-ui, .board-menu, .board-picker, input, textarea")) return;
    setMenu(null);
    setPicker(null);
    setSend(null);
    if (editRef.current) endEdit("blur");
    if (!t.closest("[data-topic], [data-fold]") && e.button === 0 && !spaceRef.current) setTopicSel(null);
    const x0 = e.clientX;
    const y0 = e.clientY;

    // 平移：滑鼠中鍵，或按住空白鍵拖曳
    if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
      e.preventDefault();
      const c0 = camRef.current;
      setPanning(true);
      track(
        (ev) => setCam({ ...c0, x: c0.x + ev.clientX - x0, y: c0.y + ev.clientY - y0 }),
        () => setPanning(false),
      );
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    focusCanvas();
    const zoom = camRef.current.zoom;
    const base = boardRef.current;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;

    // 心智圖：收合鈕
    const foldEl = t.closest<HTMLElement>("[data-fold]");
    if (foldEl) {
      apply({ ...base, maps: toggleCollapse(base.maps, foldEl.dataset.map!, foldEl.dataset.fold!) });
      return;
    }
    // 心智圖的主題：點一下選取；拖中心主題搬整張圖，拖其他主題搬到別的主題上（或拉出來變成新的一張圖）
    const topicEl = t.closest<HTMLElement>("[data-topic]");
    if (topicEl) {
      const mapId = topicEl.dataset.map!;
      const tid = topicEl.dataset.topic!;
      const m = base.maps.find((x) => x.id === mapId);
      if (!m) return;
      setTopicSel({ map: mapId, topic: tid });
      if (tid === m.root.id) {
        const keep = selRef.current.includes(mapId);
        if (!keep) select([]);
        const moving = new Set(keep ? selRef.current : [mapId]);
        for (const id of [...moving]) {
          if (base.sections.some((s) => s.id === id)) sectionMembers(base, id, heightsRef.current).forEach((x) => moving.add(x));
        }
        let started = false;
        track(
          (ev) => {
            const dx = (ev.clientX - x0) / zoom;
            const dy = (ev.clientY - y0) / zoom;
            if (!started) {
              if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
              started = true;
              checkpoint();
              setDragging(true);
            }
            const sn = snapDrag(base, moving, dx, dy, ev);
          apply(moveItems(base, moving, sn.dx, sn.dy), false);
          },
          () => {
          setDragging(false);
          clearAlign();
        },
        );
        return;
      }
      select([]);
      const found = findTopic(m, tid);
      let started = false;
      let last: {
        map: string;
        topic: string;
        x: number;
        y: number;
        text: string;
        drop: { map: string; topic: string; mode: DropMode } | null;
      } | null = null;
      track(
        (ev) => {
          if (!started) {
            if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
            started = true;
            setDragging(true);
          }
          const w = screenToWorld(ev.clientX, ev.clientY);
          last = { map: mapId, topic: tid, x: w.x, y: w.y, text: found?.topic.text ?? "", drop: topicDrop(ev.clientX, ev.clientY, mapId, tid) };
          setMmDrag(last);
        },
        (ev) => {
          setDragging(false);
          setMmDrag(null);
          const end = last;
          if (!started || !ev || !end) return;
          const b = boardRef.current;
          if (end.drop) {
            const maps = moveTopic(b.maps, { map: mapId, topic: tid }, end.drop);
            if (maps !== b.maps) {
              apply({ ...b, maps });
              setTopicSel({ map: end.drop.map, topic: tid });
            }
          } else if (!(ev.target as HTMLElement).closest?.(".board-ui, .board-card, .bs-head, [data-topic]")) {
            // 拖到空白處：變成新的一張心智圖
            const r = detachTopic(b.maps, mapId, tid, end.x - 40, end.y - 24);
            if (r.id) {
              apply({ ...b, maps: r.maps });
              setTopicSel({ map: r.id, topic: tid });
            }
          }
        },
      );
      return;
    }

    // 從卡片邊上的圓點拉出連線
    const connect = t.closest<HTMLElement>("[data-connect]");
    if (connect) {
      const from = connect.dataset.connect!;
      const start = screenToWorld(x0, y0);
      setLink({ from, x: start.x, y: start.y, over: null });
      track(
        (ev) => {
          const p = screenToWorld(ev.clientX, ev.clientY);
          const over = cardUnder(ev.clientX, ev.clientY);
          setLink({ from, x: p.x, y: p.y, over: over !== from ? over : null });
        },
        (ev) => {
          setLink(null);
          const to = ev ? cardUnder(ev.clientX, ev.clientY) : null;
          if (!to || to === from) return;
          const res = addEdge(boardRef.current, from, to);
          apply(res.board);
          if (res.id) select([res.id]);
        },
      );
      return;
    }

    // 拉大小：卡片右邊（只改寬）、右下角（寬高）；區段右下角
    const handle = t.closest<HTMLElement>("[data-resize]");
    if (handle) {
      const id = handle.dataset.resize!;
      const mode = handle.dataset.mode ?? "both";
      const card = base.cards.find((c) => c.id === id);
      const sec = base.sections.find((s) => s.id === id);
      const r0 = card ? rectOf(card) : sec;
      if (!r0) return;
      let started = false;
      setDragging(true);
      track(
        (ev) => {
          const dx = (ev.clientX - x0) / zoom;
          const dy = (ev.clientY - y0) / zoom;
          if (!started) {
            if (Math.hypot(dx, dy) < 1) return;
            started = true;
            checkpoint();
          }
          // 右邊（只改寬）或右下角；動的邊吸到其他東西的邊或中線（Alt 暫時不吸附）
          const media = !!card && fixedSize(card.ref);
          const handleDir = card && mode === "width" && !media ? "e" : "se";
          const minW = media ? MEDIA_MIN : card ? CARD_MIN_W : SECTION_MIN;
          const minH = media ? MEDIA_MIN : card ? CARD_MIN_H : SECTION_MIN;
          let next = { ...r0, w: Math.max(minW, r0.w + dx), h: handleDir === "e" ? r0.h : Math.max(minH, r0.h + dy) };
          if (!ev.altKey) {
            const others = rectsOf(base, itemIds(base).filter((x) => x !== id && !(sec && sectionMembers(base, id, heightsRef.current).includes(x))));
            const sr = snapResizeGrid(next, r0, handleDir, others, 6 / zoom, null, Math.min(minW, minH));
            next = { ...sr.rect, w: Math.max(minW, sr.rect.w), h: Math.max(minH, sr.rect.h) };
            setGuides(sr.guides);
            setMeasures(sr.measures);
          } else clearAlign();
          // 媒體卡片照原本的比例
          if (media) next = { ...next, ...resizeKeepRatio(next.w, next.h, r0.h / r0.w) };
          if (card && media) {
            apply(updateCard(base, id, { w: next.w, h: next.h }), false);
          } else if (card) {
            apply(updateCard(base, id, { w: next.w, h: mode === "width" ? card.h : next.h }), false);
          } else if (sec) {
            apply(updateSection(base, id, { w: next.w, h: next.h }), false);
          }
        },
        () => {
          setDragging(false);
          clearAlign();
        },
      );
      return;
    }

    // 搬移：卡片標題列、區段標題
    const cardEl = t.closest<HTMLElement>(".board-card");
    const secEl = t.closest<HTMLElement>(".bs-head");
    const itemId = cardEl?.dataset.id ?? secEl?.dataset.id;
    if (itemId) {
      let ids = selRef.current;
      if (additive) {
        ids = ids.includes(itemId) ? ids.filter((x) => x !== itemId) : [...ids, itemId];
        select(ids);
        if (!ids.includes(itemId)) return;
      } else if (!ids.includes(itemId)) {
        ids = [itemId];
        select(ids);
      }
      // 區段連同裡面的東西一起動
      const moving = new Set(ids.filter((id) => !base.edges.some((x) => x.id === id)));
      for (const id of [...moving]) {
        if (base.sections.some((s) => s.id === id)) sectionMembers(base, id, heightsRef.current).forEach((m) => moving.add(m));
      }
      let started = false;
      track(
        (ev) => {
          const dx = (ev.clientX - x0) / zoom;
          const dy = (ev.clientY - y0) / zoom;
          if (!started) {
            if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
            started = true;
            checkpoint();
            setDragging(true);
          }
          const sn = snapDrag(base, moving, dx, dy, ev);
          apply(moveItems(base, moving, sn.dx, sn.dy), false);
        },
        () => {
          setDragging(false);
          clearAlign();
        },
      );
      return;
    }

    // 連線：點一下選取
    const edgeEl = t.closest<SVGElement | HTMLElement>("[data-edge]");
    if (edgeEl) {
      const id = edgeEl.dataset.edge!;
      select(additive ? (selRef.current.includes(id) ? selRef.current.filter((x) => x !== id) : [...selRef.current, id]) : [id]);
      return;
    }

    // 空白處：框選（沒拖曳就是取消選取）
    const keep = additive ? selRef.current : [];
    const v = viewport();
    let moved = false;
    track(
      (ev) => {
        if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
        moved = true;
        const sr = {
          x: Math.min(x0, ev.clientX) - v.left,
          y: Math.min(y0, ev.clientY) - v.top,
          w: Math.abs(ev.clientX - x0),
          h: Math.abs(ev.clientY - y0),
        };
        setBox(sr);
        const c = camRef.current;
        const wr = { x: (sr.x - c.x) / c.zoom, y: (sr.y - c.y) / c.zoom, w: sr.w / c.zoom, h: sr.h / c.zoom };
        const b = boardRef.current;
        const hits = [
          ...b.cards.filter((x) => intersects(wr, rectOf(x))).map((x) => x.id),
          ...b.sections.filter((s) => contains(wr, s)).map((s) => s.id),
          ...b.maps.filter((m) => intersects(wr, layoutMap(m).nodes.get(m.root.id)!)).map((m) => m.id),
        ];
        select([...new Set([...keep, ...hits])]);
      },
      () => {
        setBox(null);
        if (!moved) select(keep);
      },
    );
  };

  /** 拖曳：在 window 上追蹤到放開為止。 */
  const track = (move: (e: PointerEvent) => void, end: (e: PointerEvent | null) => void) => {
    const x0 = lastDown.current.x;
    const y0 = lastDown.current.y;
    let moved = false;
    const mv = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) >= 3) moved = true;
      move(ev);
    };
    const up = (ev: PointerEvent) => {
      if (moved) draggedAt.current = Date.now();
      cleanup();
      end(ev.type === "pointercancel" ? null : ev);
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        cleanup();
        end(null);
      }
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", key);
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("keydown", key);
  };

  const cardUnder = (x: number, y: number): string | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      const c = (el as HTMLElement).closest?.<HTMLElement>(".board-card");
      if (c && rootRef.current?.contains(c)) return c.dataset.id ?? null;
    }
    return null;
  };

  /** 拖曳主題時，指標下方的主題與放法：上緣（組織圖是左緣）四分之一放前面、另一邊四分之一放後面、中間當子主題。 */
  const topicDrop = (x: number, y: number, mapId: string, tid: string): { map: string; topic: string; mode: DropMode } | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      const tEl = (el as HTMLElement).closest?.<HTMLElement>("[data-topic]");
      if (!tEl || !rootRef.current?.contains(tEl)) continue;
      const map = tEl.dataset.map!;
      const topic = tEl.dataset.topic!;
      const m = boardRef.current.maps.find((q) => q.id === map);
      if (!m || (map === mapId && isWithin(m, topic, tid))) return null;
      const r = tEl.getBoundingClientRect();
      // 組織圖的同層主題左右排：看左右；其他看上下
      const f = siblingAxis(m) === "x" ? (x - r.left) / r.width : (y - r.top) / r.height;
      const isRoot = topic === m.root.id;
      const mode: DropMode = isRoot ? "child" : f < 0.25 ? "before" : f > 0.75 ? "after" : "child";
      return { map, topic, mode };
    }
    return null;
  };

  /* ─── 心智圖的編輯 ─── */

  /** 開始編輯主題；text 省略就是原本的文字（全選），有給就是打字開始編輯（取代原本的文字） */
  const startEdit = (map: string, topic: string, text?: string) => {
    const m = boardRef.current.maps.find((x) => x.id === map);
    const f = m && findTopic(m, topic);
    if (!f) return;
    setTopicSel({ map, topic });
    setEditing({ map, topic, text: text ?? f.topic.text, selectAll: text === undefined });
    reveal(map, topic);
  };
  /** 主題在畫面外（或太靠邊）就把它捲到畫面中央 */
  const reveal = (map: string, topic: string) => {
    const m = boardRef.current.maps.find((x) => x.id === map);
    const node = m && layoutMap(m).nodes.get(topic);
    if (!node) return;
    const v = viewport();
    const c = camRef.current;
    const sx = node.x * c.zoom + c.x;
    const sy = node.y * c.zoom + c.y;
    if (sx < 40 || sy < 60 || sx + (node.w + 120) * c.zoom > v.w - 40 || sy + node.h * c.zoom > v.h - 40) centerOn(node);
  };
  const onDraft = useCallback(
    (text: string) => {
      const e = editRef.current;
      if (e) setEditing({ ...e, text });
    },
    [setEditing],
  );
  const endEdit = (how: "enter" | "tab" | "esc" | "blur") => {
    const e = editRef.current;
    if (!e) return;
    setEditing(null);
    const b = boardRef.current;
    const text = e.text.replace(/\s+$/, "");
    let maps = setText(b.maps, e.map, e.topic, text);
    if (how === "tab") {
      const r = addChild(maps, e.map, e.topic);
      maps = r.maps;
      if (maps !== b.maps) apply({ ...b, maps });
      if (r.id) startEdit(e.map, r.id);
      return;
    }
    if (maps !== b.maps) apply({ ...b, maps });
    if (how !== "blur") focusCanvas();
  };
  const endEditRef = useRef(endEdit);
  endEditRef.current = endEdit;
  const onEditEnd = useCallback((how: "enter" | "tab" | "esc" | "blur") => endEditRef.current(how), []);

  /** 加一個主題並開始編輯 */
  const growTopic = (kind: "child" | "after" | "before") => {
    const ts = topicSelRef.current;
    if (!ts) return;
    const b = boardRef.current;
    const r = kind === "child" ? addChild(b.maps, ts.map, ts.topic) : addSibling(b.maps, ts.map, ts.topic, kind === "before");
    if (!r.id) return;
    apply({ ...b, maps: r.maps });
    startEdit(ts.map, r.id);
  };
  const deleteTopic = () => {
    const ts = topicSelRef.current;
    if (!ts) return;
    const b = boardRef.current;
    const m = b.maps.find((x) => x.id === ts.map);
    const f = m && findTopic(m, ts.topic);
    if (!f) return;
    apply({ ...b, maps: removeTopic(b.maps, ts.map, ts.topic) });
    if (!f.parent) return setTopicSel(null);
    // 選同層的下一個（沒有就上一個，再沒有就父主題）
    const sib = f.parent.children[f.index + 1] ?? f.parent.children[f.index - 1] ?? f.parent;
    setTopicSel({ map: ts.map, topic: sib.id });
  };

  /** 選取主題時的按鍵（XMind）；有處理就回傳 true */
  const topicKey = (e: React.KeyboardEvent): boolean => {
    const ts = topicSelRef.current;
    if (!ts) return false;
    const ctrl = e.ctrlKey || e.metaKey;
    const m = boardRef.current.maps.find((x) => x.id === ts.map);
    if (!m) return false;
    if (e.key === "Tab" && !ctrl) growTopic("child");
    else if (e.key === "Enter" && !ctrl) growTopic(e.shiftKey ? "before" : "after");
    else if (e.key === "Delete" || e.key === "Backspace") deleteTopic();
    else if ((e.key === "F2" || e.code === "Space") && !ctrl) startEdit(ts.map, ts.topic);
    else if (ctrl && (e.key === "." || e.code === "Period")) apply({ ...boardRef.current, maps: toggleCollapse(boardRef.current.maps, ts.map, ts.topic) });
    else if (e.key === "Escape") setTopicSel(null);
    else if (!ctrl && !e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      const n = neighbor(m, ts.topic, e.key);
      if (n) {
        setTopicSel({ map: ts.map, topic: n });
        reveal(ts.map, n);
      }
    } else if (!ctrl && !e.altKey && e.key.length === 1) startEdit(ts.map, ts.topic, e.key);
    else return false;
    return true;
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    const topicEl = t.closest<HTMLElement>("[data-topic]");
    if (topicEl) {
      if (!t.closest("textarea")) startEdit(topicEl.dataset.map!, topicEl.dataset.topic!);
      return;
    }
    if (t.closest("[data-fold]")) return;
    if (Date.now() - draggedAt.current < 500) return;
    if (t.closest(".bc-body, .board-ui, .board-menu, .board-picker, input")) return;
    const cardEl = t.closest<HTMLElement>(".board-card");
    if (cardEl) {
      const c = boardRef.current.cards.find((x) => x.id === cardEl.dataset.id);
      if (c && t.closest("[data-resize]")) {
        if (!fixedSize(c.ref)) apply(updateCard(boardRef.current, c.id, { h: null }));
      } else if (c?.ref.kind === "note" || c?.ref.kind === "code") focusCardEditor(c.id);
      else if (c && editsInPlace(c.ref) && !t.closest("[data-connect]")) setCardEdit(c.id);
      else if (c && isDocRef(c.ref) && !t.closest("[data-connect]")) props.onOpen(c.ref);
      return;
    }
    const secEl = t.closest<HTMLElement>(".bs-head");
    if (secEl) return setEditTitle(secEl.dataset.id!);
    const edgeEl = t.closest<HTMLElement>("[data-edge]");
    if (edgeEl) return setEditLabel(edgeEl.dataset.edge!);
    // 空白處：貼一張便利貼，直接打字
    const w = screenToWorld(e.clientX, e.clientY);
    newNote(w.x, w.y);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest(".bc-body, .board-ui, .board-menu, .board-picker, input")) return;
    e.preventDefault();
    setSend(null);
    const v = viewport();
    const x = e.clientX - v.left;
    const y = e.clientY - v.top;
    const topicEl = t.closest<HTMLElement>("[data-topic]");
    if (topicEl) {
      setPicker(null);
      select([]);
      setTopicSel({ map: topicEl.dataset.map!, topic: topicEl.dataset.topic! });
      setMenu({ kind: "topic", map: topicEl.dataset.map!, topic: topicEl.dataset.topic!, x, y });
      return;
    }
    setTopicSel(null);
    const cardEl = t.closest<HTMLElement>(".board-card");
    const secEl = t.closest<HTMLElement>(".bs-head");
    const edgeEl = t.closest<HTMLElement>("[data-edge]");
    const id = cardEl?.dataset.id ?? secEl?.dataset.id ?? edgeEl?.dataset.edge;
    if (id && !selRef.current.includes(id)) select([id]);
    setPicker(null);
    if (cardEl) setMenu({ kind: "card", id: id!, x, y });
    else if (secEl) setMenu({ kind: "section", id: id!, x, y });
    else if (edgeEl) setMenu({ kind: "edge", id: id!, x, y });
    else {
      const w = screenToWorld(e.clientX, e.clientY);
      setMenu({ kind: "canvas", x, y, wx: w.x, wy: w.y });
    }
  };

  /* ─── 鍵盤（焦點在畫布本身時） ─── */

  const onKeyDown = (e: React.KeyboardEvent) => {
    // 卡片的編輯器（Draw、Excel）開著時，白板的按鍵一律不處理（焦點萬一還在畫布上，打字不能變成刪除卡片、新增便利貼）
    if (cardEdit || e.target !== rootRef.current || e.nativeEvent.isComposing) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    let handled = true;
    if (topicKey(e)) {
      // 心智圖的主題
    } else if (ctrl && !e.altKey && (k === "z" || k === "y")) undo(k === "y" || e.shiftKey);
    else if (ctrl && k === "a") select([...boardRef.current.cards, ...boardRef.current.sections, ...boardRef.current.maps].map((x) => x.id));
    else if (ctrl && !e.altKey && k === "d" && selRef.current.length) {
      const clip = copyItems(boardRef.current, selRef.current, heightsRef.current);
      const res = pasteItems(boardRef.current, clip, 24, 24);
      apply(res.board);
      select(res.ids);
    }
    else if (ctrl && (k === "=" || k === "+")) zoomBy(1.2);
    else if (ctrl && k === "-") zoomBy(1 / 1.2);
    else if (ctrl && k === "0") {
      const v = viewport();
      setCam(zoomAt(camRef.current, 1, v.w / 2, v.h / 2));
    } else if (e.shiftKey && e.code === "Digit1") fit();
    else if (e.key === "Delete" || e.key === "Backspace") {
      if (selRef.current.length) apply(removeItems(boardRef.current, selRef.current));
    } else if (e.key === "Escape") {
      select([]);
      setMenu(null);
      setPicker(null);
      setSend(null);
    } else if (!ctrl && !e.altKey && k === "n") {
      const c = viewCenter();
      newNote(c.x, c.y);
    } else if (e.key === "Enter" && selRef.current.length === 1) {
      const c = boardRef.current.cards.find((x) => x.id === selRef.current[0]);
      if (c && editsInPlace(c.ref)) setCardEdit(c.id);
      else if (c) focusCardEditor(c.id);
      else handled = false;
    } else if (e.key.startsWith("Arrow") && selRef.current.length) {
      const step = e.shiftKey ? 40 : 8;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      apply(moveItems(boardRef.current, selRef.current, dx, dy));
    } else handled = false;
    if (handled) {
      e.preventDefault();
      // 不要再傳到編輯器（掛在 window 上的復原、全選）
      e.stopPropagation();
    }
  };

  const focusCardEditor = (id: string) => {
    const go = () => {
      const card = rootRef.current?.querySelector<HTMLElement>(`.board-card[data-id="${id}"]`);
      // 程式碼卡片：游標放到最後
      const ta = card?.querySelector<HTMLTextAreaElement>("textarea.code-input");
      if (ta) {
        ta.focus({ preventScroll: true });
        ta.setSelectionRange(ta.value.length, ta.value.length);
        return;
      }
      const rows = card?.querySelectorAll<HTMLElement>(".md-editor .row .content");
      const row = rows && rows.length ? rows[rows.length - 1] : null;
      if (row) {
        row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        row.click();
        return;
      }
      // 空的便利貼：編輯器在「按下＋放開文件下方空白」時新增第一個區塊並開始編輯
      const tail = card?.querySelector<HTMLElement>(".md-editor .tail");
      if (!tail) return;
      const r = tail.getBoundingClientRect();
      const at = { bubbles: true, button: 0, clientX: r.left + 4, clientY: r.top + r.height / 2 };
      tail.dispatchEvent(new PointerEvent("pointerdown", at));
      window.dispatchEvent(new PointerEvent("pointerup", at));
    };
    // 剛新增的卡片要等畫面更新
    requestAnimationFrame(() => requestAnimationFrame(go));
  };

  /* ─── 新增 ─── */

  const place = (ref: CardRef, wx: number, wy: number) => {
    const had = findCard(boardRef.current, ref);
    if (had) {
      select([had.id]);
      centerOn(rectOf(had));
      return;
    }
    const res = addCard(boardRef.current, ref, wx - CARD_W / 2, wy - 20);
    apply(res.board);
    select([res.id]);
  };

  const viewCenter = () => {
    const v = viewport();
    return toWorld(camRef.current, v.w / 2, v.h / 2.5);
  };

  /** 在 (wx, wy) 貼一張便利貼（以那一點為中心），然後開始打字。 */
  /** 工具列的 Insert ▾ 選單 */
  const [insertOpen, setInsertOpen] = useState(false);
  const insertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!insertOpen) return;
    const down = (e: PointerEvent) => !insertRef.current?.contains(e.target as Node) && setInsertOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setInsertOpen(false);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
    };
  }, [insertOpen]);
  /** 在畫布座標 at 新增一種東西（工具列的 Insert 用畫面中央，右鍵選單用按的位置） */
  const insertAt = (kind: InsertKind, at: { x: number; y: number }) => {
    if (kind === "section") newSection({ x: at.x + 320, y: at.y + 200 });
    else if (kind === "map") addMindMap({ x: at.x, y: at.y });
    else if (kind === "media") pickMedia(at);
    else if (kind === "code") newCode(at.x, at.y);
    else if (kind === "draw") newDraw(at.x, at.y);
    else newTable(at.x, at.y);
  };
  /** 正在白板上方編輯的卡片（圖表用 Draw、表格用 Excel） */
  const [cardEdit, setCardEdit] = useState<string | null>(null);
  /** 在 (wx, wy) 放一張空白的圖表卡片（以那一點為中心），直接打開編輯器。 */
  const newDraw = (wx: number, wy: number) => {
    const res = addDraw(boardRef.current, wx - DRAW_W / 2, wy - DRAW_H / 2);
    apply(res.board);
    select([res.id]);
    setCardEdit(res.id);
    return res.id;
  };

  /** 在 (wx, wy) 放一張表格卡片（以那一點為中心）；grid 是貼上的格子。edit：直接打開 Excel 編輯。 */
  const newTable = (wx: number, wy: number, grid?: string[][], edit = true) => {
    const json = newCardWorkbook(grid);
    const size = sheetCardSize(json);
    const res = addTableCard(boardRef.current, wx - size.w / 2, wy - size.h / 2, json, size.w, size.h);
    apply(res.board);
    select([res.id]);
    if (edit) setCardEdit(res.id);
    return res.id;
  };

  /** 在 (wx, wy) 放一張程式碼卡片（以那一點為中心），然後開始打字。 */
  const newCode = (wx: number, wy: number, code = "", lang = "", edit = true) => {
    const res = addCode(boardRef.current, wx - CODE_W / 2, wy - 24, code, lang);
    apply(res.board);
    select([res.id]);
    if (edit) focusCardEditor(res.id);
    return res.id;
  };
  const onCodeLang = useCallback(
    (id: string, lang: string) => {
      const c = boardRef.current.cards.find((x) => x.id === id);
      if (c?.ref.kind === "code" && c.ref.lang !== lang) apply(updateCard(boardRef.current, id, { ref: { kind: "code", lang } }));
    },
    [apply],
  );

  const newNote = (wx: number, wy: number, text = "", edit = true) => {
    const res = addNote(boardRef.current, wx - NOTE_W / 2, wy - 24, text);
    apply(res.board);
    select([res.id]);
    if (edit) focusCardEditor(res.id);
    return res.id;
  };

  const onNoteText = useCallback(
    (id: string, text: string) => {
      const c = boardRef.current.cards.find((x) => x.id === id);
      if (c && c.text !== text) apply(updateCard(boardRef.current, id, { text }), false);
    },
    [apply],
  );

  /**
   * 在畫布上貼上（焦點在畫布本身），放在滑鼠最後的位置：白板內容（Ctrl＋C 複製的）照原樣貼上；
   * 圖片、GIF、影片檔變成媒體卡片；YouTube／Vimeo、影片、圖片網址也是媒體卡片；其他文字是一張便利貼。
   */
  const onPaste = async (e: React.ClipboardEvent) => {
    if (cardEdit || e.target !== rootRef.current) return;
    const files = [...e.clipboardData.files].filter((f) => kindOf(f.name, f.type));
    const text = e.clipboardData.getData("text/plain");
    if (!files.length && !text.trim()) return;
    e.preventDefault();
    const at = lastPointer.current ?? viewCenter();
    const clip = files.length ? null : parseClip(text);
    if (clip) return pasteClip(clip, at);
    if (files.length) return addFiles(files, at);
    // 整段是 ``` 區塊：程式碼卡片
    const fenced = /^\s*(```|~~~)/.test(text) ? parseCodeBlock(text.replace(/\r\n?/g, "\n").trim()) : null;
    if (fenced) {
      newCode(at.x, at.y, fenced.code, fenced.lang, false);
      return focusCanvas();
    }
    const url = mediaFromUrl(text);
    if (url) return addMediaItems([url], at);
    // 從 Excel、Google 試算表複製的格子（每列有 Tab、欄數一樣）：表格卡片
    const grid = tabularClip(text);
    if (grid) {
      newTable(at.x, at.y, grid, false);
      return focusCanvas();
    }
    newNote(at.x, at.y, text.replace(/\r\n?/g, "\n").trim(), false);
    focusCanvas();
  };
  const lastPointer = useRef<{ x: number; y: number } | null>(null);

  /* ─── 複製、貼上白板內容 ─── */

  /** Ctrl＋C／X：焦點在畫布本身時，用瀏覽器的 copy／cut 事件寫進剪貼簿（不需要剪貼簿權限） */
  const onCopy = (e: React.ClipboardEvent, cut: boolean) => {
    if (cardEdit || e.target !== rootRef.current || !selRef.current.length) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", clipText(copyItems(boardRef.current, selRef.current, heightsRef.current)));
    if (cut) removeSelected();
  };
  /** 貼上複製的內容：整體的中心放在 at */
  const pasteClip = (clip: Board, at: { x: number; y: number }) => {
    const r = boundsOf([...clip.cards.map(rectOf), ...clip.sections, ...clip.maps.map(mapBounds)]);
    const dx = r ? at.x - (r.x + r.w / 2) : 0;
    const dy = r ? at.y - (r.y + r.h / 2) : 0;
    const res = pasteItems(boardRef.current, clip, dx, dy);
    apply(res.board);
    select(res.ids);
    focusCanvas();
  };

  /* ─── 媒體卡片 ─── */

  /** 放好幾張媒體卡片：第一張的中心在 at，其他往右排；先量原始大小，一次記一個復原點。 */
  const addMediaItems = async (items: { src: string; type: MediaType }[], at: { x: number; y: number }) => {
    if (!items.length) return;
    const sizes = await Promise.all(items.map((it) => measureMedia(it.src, it.type)));
    let b = boardRef.current;
    const ids: string[] = [];
    let x = at.x - sizes[0].w / 2;
    items.forEach((it, i) => {
      const { w, h } = sizes[i];
      const res = addMedia(b, it.src, it.type, x, at.y - h / 2, w, h);
      b = res.board;
      ids.push(res.id);
      x += w + 24;
    });
    apply(b);
    select(ids);
    focusCanvas();
  };
  /** 檔案（貼上、選擇檔案）存到 media/ 再放上白板 */
  const addFiles = async (files: File[], at: { x: number; y: number }) => {
    const items: { src: string; type: MediaType }[] = [];
    for (const f of files) {
      const kind = kindOf(f.name, f.type);
      if (!kind) continue;
      try {
        items.push({ src: await saveMedia(f), type: kind });
      } catch (err) {
        console.error("Couldn't add the file", f.name, err);
      }
    }
    await addMediaItems(items, at);
  };
  /** 選擇圖片或影片檔（工具列、右鍵選單） */
  const pickMedia = (at: { x: number; y: number }) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,video/*";
    input.multiple = true;
    input.onchange = () => void addFiles([...(input.files ?? [])], at);
    input.click();
  };
  /** 從檔案總管拖進來的檔案（Tauri 攔截拖放，給的是路徑）；放在卡片的編輯器上的交給編輯器 */
  const dropPaths = useRef<(paths: string[], x: number, y: number) => void>(() => {});
  dropPaths.current = async (paths, x, y) => {
    const hit = document.elementFromPoint(x, y);
    if (!hit || !rootRef.current?.contains(hit) || hit.closest(".bc-body, .board-ui, .board-menu, .board-picker")) return;
    const items: { src: string; type: MediaType }[] = [];
    for (const path of paths) {
      const kind = kindOf(path);
      if (!kind) continue;
      try {
        items.push({ src: await importMediaPath(path), type: kind });
      } catch (err) {
        console.error("Couldn't import the file", path, err);
      }
    }
    await addMediaItems(items, screenToWorld(x, y));
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

  /* ─── 送到 Dock ─── */

  /** 要送到 Dock 的卡片：選取的卡片，加上選取的心智圖（或選了主題的那一張），心智圖寫成大綱 */
  const selectedCards = () => {
    const b = boardRef.current;
    const mapIds = new Set(selRef.current);
    if (topicSelRef.current) mapIds.add(topicSelRef.current.map);
    const maps: Card[] = b.maps
      .filter((m) => mapIds.has(m.id))
      .map((m) => {
        const r = mapBounds(m);
        return { id: m.id, ref: { kind: "note" }, x: r.x, y: r.y, w: r.w, h: r.h, color: null, text: mapOutline(m) };
      });
    return readingOrder([...b.cards.filter((c) => selRef.current.includes(c.id)), ...maps], heightsRef.current);
  };
  const sendTo = (to: SendTarget) => {
    setSend(null);
    const cards = selectedCards();
    if (!cards.length) return;
    const title = props.onSend(cards, to);
    setSent({ title, doc: "doc" in to ? to.doc : null, n: cards.length, tasks: "tasks" in to });
    focusCanvas();
  };

  const newSection = (at?: { x: number; y: number }) => {
    const b = boardRef.current;
    const picked = b.cards.filter((c) => selRef.current.includes(c.id)).map(rectOf);
    const c = at ?? viewCenter();
    const r = sectionAround(picked) ?? { x: c.x - 320, y: c.y - 200, w: 640, h: 400 };
    const res = addSection(b, r);
    apply(res.board);
    select([res.id]);
    setEditTitle(res.id);
  };

  /** 放一張心智圖（at：左上角；null＝畫面中央，或既有內容的右邊），選取它並讓畫面對準它。 */
  const addMindMap = (at: { x: number; y: number } | null) => {
    const b = boardRef.current;
    const c = viewCenter();
    const spot = mindMapSpot(b, c.x, c.y, heightsRef.current);
    const res = at ? insertMindMapAt(b, at.x, at.y) : insertMindMap(b, spot.x, spot.y);
    apply(res.board);
    select(res.ids);
    fit([res.bounds]);
    focusCanvas();
  };

  const removeSelected = () => apply(removeItems(boardRef.current, selRef.current));

  /* ─── 畫面 ─── */

  // 卡片裡的編輯器有焦點時，下方是編輯器自己的格式列：卡片樣式列先藏起來
  const [cardFocus, setCardFocus] = useState(false);
  const empty = !board.cards.length && !board.sections.length && !board.maps.length;
  /** 選取的卡片與區段（下方的樣式列用） */
  const selectedCardList = useMemo(() => board.cards.filter((c) => selectedSet.has(c.id) && !fixedSize(c.ref) && c.ref.kind !== "code"), [board.cards, selectedSet]);
  const selectedSectionList = useMemo(() => board.sections.filter((s) => selectedSet.has(s.id)), [board.sections, selectedSet]);
  const styledList = useMemo(() => [...selectedCardList, ...selectedSectionList], [selectedCardList, selectedSectionList]);
  const styleBar = !!topicSel || (styledList.length > 0 && !cardFocus);
  const world = `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})`;
  const altMeasures = (() => {
    if (!altAt || dragging || !selected.length) return [];
    const box = alignBounds(rectsOf(board, selected));
    if (!box) return [];
    // 滑過的東西：卡片、心智圖優先，再來是區段（最小的那個）
    const inside = (r: Rect) => altAt.x >= r.x && altAt.x <= r.x + r.w && altAt.y >= r.y && altAt.y <= r.y + r.h;
    const hits = itemIds(board)
      .filter((id) => !selectedSet.has(id))
      .map((id) => itemRect(board, id))
      .filter((r): r is Rect => !!r && inside(r))
      .sort((a, b) => a.w * a.h - b.w * b.h);
    return hits.length ? measureBetween(box, hits[0]) : [];
  })();
  const grid = 24 * cam.zoom;
  const cardById = useMemo(() => new Map(board.cards.map((c) => [c.id, c])), [board.cards]);
  const onBoard = useMemo(() => new Set(board.cards.map((c) => refKey(c.ref))), [board.cards]);

  return (
    <div
      ref={rootRef}
      className={`board no-box${spaceDown || panning ? " panning" : ""}${panning ? " grabbing" : ""}${dragging || link ? " dragging" : ""}${styleBar ? " has-mm-bar" : ""}`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onCopy={(e) => onCopy(e, false)}
      onCut={(e) => onCopy(e, true)}
      onFocus={(e) => setCardFocus(!!(e.target as HTMLElement).closest?.(".bc-body"))}
      onBlur={(e) => {
        if (!(e.relatedTarget as HTMLElement | null)?.closest?.(".bc-body")) setCardFocus(false);
      }}
      // 畫布是 overflow: hidden，聚焦到主題的文字框時瀏覽器會把它捲過去；一律捲回來（畫面位置只由 cam 決定）
      onScroll={(e) => {
        const el = e.currentTarget;
        if (el.scrollLeft || el.scrollTop) {
          el.scrollLeft = 0;
          el.scrollTop = 0;
        }
      }}
      onPointerMove={(e) => {
        if (e.target === rootRef.current) lastPointer.current = screenToWorld(e.clientX, e.clientY);
        if (altRef.current || e.altKey) setAltAt(screenToWorld(e.clientX, e.clientY));
        else if (altAt) setAltAt(null);
      }}
      style={{ backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${cam.x}px ${cam.y}px` }}
    >
      <div className="board-world" style={{ transform: world }}>
        <AlignOverlay guides={guides} measures={[...measures, ...altMeasures]} zoom={cam.zoom} />
        {board.sections.map((s) => (
          <SectionBox
            key={s.id}
            section={s}
            selected={selectedSet.has(s.id)}
            editing={editTitle === s.id}
            onRename={(title) => {
              setEditTitle(null);
              if (title !== null && title !== s.title) apply(updateSection(boardRef.current, s.id, { title: title || "Section" }));
              focusCanvas();
            }}
          />
        ))}
        <svg className="board-edges" width="1" height="1">
          <defs>
            <marker id={`${markerId}-a`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" className="edge-arrow" />
            </marker>
            <marker id={`${markerId}-s`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" className="edge-arrow on" />
            </marker>
          </defs>
          {board.edges.map((ed) => {
            const a = cardById.get(ed.from);
            const b = cardById.get(ed.to);
            if (!a || !b) return null;
            const { d } = edgePath(cardRect(a, heights), cardRect(b, heights));
            const on = selectedSet.has(ed.id);
            return (
              <g key={ed.id} className={`board-edge${on ? " on" : ""}`}>
                <path d={d} className="edge-line" markerEnd={`url(#${markerId}-${on ? "s" : "a"})`} />
                <path d={d} className="edge-hit" data-edge={ed.id} />
              </g>
            );
          })}
          {link && (() => {
            const a = cardById.get(link.from);
            if (!a) return null;
            const over = link.over ? cardById.get(link.over) : null;
            const d = over ? edgePath(cardRect(a, heights), cardRect(over, heights)).d : dangling(cardRect(a, heights), link.x, link.y);
            return <path d={d} className="edge-line pending" markerEnd={`url(#${markerId}-s)`} />;
          })()}
        </svg>
        {board.edges.map((ed) => {
          const a = cardById.get(ed.from);
          const b = cardById.get(ed.to);
          if (!a || !b || (!ed.label && editLabel !== ed.id)) return null;
          const { mid } = edgePath(cardRect(a, heights), cardRect(b, heights));
          return (
            <EdgeLabel
              key={ed.id}
              id={ed.id}
              x={mid.x}
              y={mid.y}
              label={ed.label}
              selected={selectedSet.has(ed.id)}
              editing={editLabel === ed.id}
              onDone={(label) => {
                setEditLabel(null);
                if (label !== null && label !== ed.label) apply(updateEdge(boardRef.current, ed.id, { label }));
                focusCanvas();
              }}
            />
          );
        })}
        {board.maps.map((m) => (
          <MindMapView
            key={m.id}
            map={m}
            selected={topicSel?.map === m.id ? topicSel.topic : null}
            mapSelected={selectedSet.has(m.id)}
            editing={editing?.map === m.id ? editing : null}
            dragging={mmDrag?.map === m.id ? mmDrag.topic : null}
            drop={mmDrag?.drop?.map === m.id ? mmDrag.drop : null}
            onDraft={onDraft}
            onEditEnd={onEditEnd}
          />
        ))}
        {mmDrag && (
          <div className="mm-ghost" style={{ left: mmDrag.x + 12, top: mmDrag.y + 8 }}>
            {mmDrag.text || "\u00a0"}
          </div>
        )}
        {board.cards.map((c) => {
          if (c.ref.kind === "code") {
            return (
              <CodeCard
                key={c.id}
                card={c}
                selected={selectedSet.has(c.id)}
                linkTarget={link?.over === c.id}
                onHeight={onHeight}
                onText={onNoteText}
                onLang={onCodeLang}
                onExit={focusCanvas}
              />
            );
          }
          if (c.ref.kind === "media") {
            return <MediaCard key={c.id} card={c} selected={selectedSet.has(c.id)} linkTarget={link?.over === c.id} />;
          }
          if (c.ref.kind === "draw") {
            return <DrawCard key={c.id} card={c} selected={selectedSet.has(c.id)} linkTarget={link?.over === c.id} onEdit={setCardEdit} />;
          }
          if (c.ref.kind === "sheet") {
            return <SheetCard key={c.id} card={c} selected={selectedSet.has(c.id)} linkTarget={link?.over === c.id} onEdit={setCardEdit} />;
          }
          if (c.ref.kind === "note") {
            return (
              <NoteCard
                key={c.id}
                card={c}
                selected={selectedSet.has(c.id)}
                linkTarget={link?.over === c.id}
                onHeight={onHeight}
                onText={onNoteText}
              />
            );
          }
          const docs = c.ref.kind === "page" ? pages : journals;
          const key = c.ref.kind === "page" ? c.ref.name : c.ref.date;
          return (
            <BoardCard
              key={c.id}
              card={c}
              content={docs.contents[key]}
              exists={!!docs.dates?.has(key)}
              docs={docs}
              docKey={key}
              now={now}
              selected={selectedSet.has(c.id)}
              linkTarget={link?.over === c.id}
              onHeight={onHeight}
            />
          );
        })}
      </div>

      {box && <div className="board-box" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
      {(() => {
        const c = cardEdit ? board.cards.find((x) => x.id === cardEdit && editsInPlace(x.ref)) : undefined;
        if (!c) return null;
        const cur = () => boardRef.current.cards.find((x) => x.id === c.id);
        return (
          <CardEditor
            key={c.id}
            card={c}
            onChange={(json) => {
              const x = cur();
              if (x && x.text !== json) apply(updateCard(boardRef.current, c.id, { text: json }));
            }}
            onModifySheet={(fn) => {
              const x = cur();
              if (!x) return;
              const json = serializeWorkbook(fn(parseWorkbook(x.text)));
              if (json !== x.text) apply(updateCard(boardRef.current, c.id, { text: json }));
            }}
            onClose={() => {
              // 表格卡片照新的內容調整大小（加了列、欄才看得到）
              const x = cur();
              if (x?.ref.kind === "sheet") {
                const size = sheetCardSize(x.text);
                if (size.w !== x.w || size.h !== x.h) apply(updateCard(boardRef.current, x.id, size));
              }
              setCardEdit(null);
              focusCanvas();
            }}
            onSendToDock={() => {
              const x = cur();
              if (!x) return;
              const title = props.onSend([x], { kind: x.ref.kind === "sheet" ? "sheet" : "draw" });
              setCardEdit(null);
              setSent({ title, doc: null, n: 1 });
              focusCanvas();
            }}
          />
        );
      })()}

      {empty && (
        <div className="board-empty">
          <p className="be-title">Put your thoughts here, in any order</p>
          <p className="be-hint">
            Double-click anywhere (or press N) for a sticky note, or paste text, images, GIFs and video links. When ideas take shape, select
            them and send them to the Dock.
          </p>
          <div className="be-actions">
            <button
              className="be-btn board-ui"
              onClick={() => {
                const c = viewCenter();
                newNote(c.x, c.y);
              }}
            >
              <NoteIcon /> Add a note
            </button>
            <button className="be-btn board-ui" onClick={() => addMindMap(null)} title="Central topic with branches · Tab / Enter to grow">
              <MindMapIcon /> Start a mind map
            </button>
          </div>
        </div>
      )}

      <div className="board-toolbar board-ui">
        <button
          onClick={() => {
            const c = viewCenter();
            newNote(c.x, c.y);
          }}
          className="bt-icon"
          title="Add a sticky note (N, or double-click the canvas)"
          aria-label="Add a sticky note"
        >
          <NoteIcon />
        </button>
        <button
          onClick={() => {
            const c = viewCenter();
            setPicker({ x: 12, y: 52, wx: c.x, wy: c.y });
          }}
          className="bt-icon"
          title="Add a page or journal as a card"
          aria-label="Add a page or journal"
        >
          <DocIcon />
        </button>
        <div className="bt-insert-wrap" ref={insertRef}>
          <button
            className={`bt-icon${insertOpen ? " on" : ""}`}
            onClick={() => setInsertOpen((v) => !v)}
            title="Insert a section, mind map, image or video, code, diagram or table"
            aria-label="Insert"
            aria-expanded={insertOpen}
          >
            <PlusIcon />
          </button>
          {insertOpen && (
            <div className="popover block-menu board-insert" role="menu">
              {INSERTS.map((it) => (
                <button
                  key={it.id}
                  role="menuitem"
                  title={it.hint}
                  onClick={() => {
                    setInsertOpen(false);
                    // 和原本的工具列一樣：區段包住選取的卡片、心智圖放在預設的位置
                    if (it.id === "section") newSection();
                    else if (it.id === "map") addMindMap(null);
                    else insertAt(it.id, viewCenter());
                  }}
                >
                  <span className="glyph">{it.icon}</span>
                  <span className="label">{it.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {(selected.length > 0 || topicSel) && (
          <>
            <span className="bt-sep" />
            {selected.length > 1 && (
              <span className="bt-count" title={`${selected.length} selected`}>
                {selected.length}
              </span>
            )}
            {(topicSel || [...board.cards, ...board.maps].some((c) => selectedSet.has(c.id))) && (
              <button
                className="bt-send bt-icon"
                onClick={(e) => {
                  const v = viewport();
                  const r = e.currentTarget.getBoundingClientRect();
                  setSend(send ? null : { x: r.left - v.left, y: r.bottom - v.top + 6 });
                }}
                title="Send to Dock — append the selected cards to a Dock document"
                aria-label="Send to Dock"
              >
                <SendIcon />
              </button>
            )}
            {selected.length > 0 && (
              <button className="bt-icon" onClick={removeSelected} title="Remove from whiteboard (Delete)" aria-label="Remove from whiteboard">
                <TrashIcon />
              </button>
            )}
          </>
        )}
      </div>

      <div className="board-zoom board-ui">
        <button onClick={() => zoomBy(1 / 1.2)} title="Zoom out (Ctrl+−)">
          <MinusIcon />
        </button>
        <button
          className="bz-pct"
          onClick={() => {
            const v = viewport();
            setCam(zoomAt(camRef.current, 1, v.w / 2, v.h / 2));
          }}
          title="Reset to 100% (Ctrl+0)"
        >
          {Math.round(cam.zoom * 100)}%
        </button>
        <button onClick={() => zoomBy(1.2)} title="Zoom in (Ctrl+=)">
          <PlusIcon />
        </button>
        <button onClick={() => fit()} title="Fit to screen (Shift+1)">
          <FitIcon />
        </button>
      </div>


      {!topicSel && styledList.length > 0 && !dragging && !cardFocus && (
        <CardStyleBar
          items={styledList}
          cards={selectedCardList.length}
          sections={selectedSectionList.length}
          onLook={(patch) => {
            const b = boardRef.current;
            apply(setCardLook(b, styledList.map((c) => c.id), patch));
          }}
        />
      )}
      {topicSel && board.maps.some((m) => m.id === topicSel.map) && (
        <MindMapStyleBar
          key={topicSel.map}
          map={board.maps.find((m) => m.id === topicSel.map)!}
          topic={topicSel.topic}
          onMap={(patch) => {
            const b = boardRef.current;
            apply({ ...b, maps: setMapStyle(b.maps, topicSel.map, patch) });
          }}
          onTopic={(patch) => {
            const b = boardRef.current;
            apply({ ...b, maps: setTopicLook(b.maps, topicSel.map, topicSel.topic, patch) });
          }}
        />
      )}

      {send && <SendMenu x={send.x} y={send.y} dock={props.dock} onPick={sendTo} onClose={() => setSend(null)} />}

      {sent && (
        <div className="board-toast board-ui" role="status">
          Sent {sent.n === 1 ? "1 card" : `${sent.n} cards`} to “{sent.title}”
          <button
            onClick={() => {
              setSent(null);
              if (sent.tasks) props.onOpenTasks?.();
              else props.onOpenDoc(sent.doc);
            }}
          >
            Open
          </button>
        </div>
      )}

      {picker && (
        <CardPicker
          x={picker.x}
          y={picker.y}
          pageNames={props.pageNames}
          journalDates={journals.dates}
          now={now}
          onBoard={onBoard}
          onPick={(ref) => {
            setPicker(null);
            place(ref, picker.wx, picker.wy);
            focusCanvas();
          }}
          onClose={() => {
            setPicker(null);
            focusCanvas();
          }}
        />
      )}

      {menu && (
        <BoardMenu
          menu={menu}
          board={board}
          count={selected.length}
          canDeleteRef={!!props.onDeleteRef}
          onClose={() => setMenu(null)}
          act={(a) => {
            setMenu(null);
            const b = boardRef.current;
            switch (a.type) {
              case "open": {
                const c = b.cards.find((x) => x.id === a.id);
                if (c && isDocRef(c.ref)) props.onOpen(c.ref);
                else if (c && editsInPlace(c.ref)) setCardEdit(c.id);
                return;
              }
              case "delete-ref": {
                const c = b.cards.find((x) => x.id === a.id);
                if (!c || !isDocRef(c.ref) || !props.onDeleteRef?.(c.ref)) return;
                // 頁面刪了，這張白板上指向它的卡片也拿掉（其他白板的卡片留著，像連結一樣）
                const key = refKey(c.ref);
                const ids = b.cards.filter((x) => x.ref.kind === c.ref.kind && refKey(x.ref) === key).map((x) => x.id);
                return apply(removeItems(boardRef.current, ids));
              }
              case "send":
                return setSend({ x: menu.x, y: menu.y });
              case "add-note":
                return newNote(a.x, a.y);
              case "color":
                if (menu.kind === "card") {
                  const ids = selRef.current.filter((id) => b.cards.some((c) => c.id === id));
                  let next = b;
                  for (const id of ids.length ? ids : [a.id]) next = updateCard(next, id, { color: a.color });
                  apply(next);
                } else apply(updateSection(b, a.id, { color: a.color }));
                return;
              case "auto-height":
                return apply(updateCard(b, a.id, { h: null }));
              case "remove":
                return apply(removeItems(b, selRef.current.length ? selRef.current : [a.id]));
              case "rename":
                return setEditTitle(a.id);
              case "label":
                return setEditLabel(a.id);
              case "flip":
                return apply(flipEdge(b, a.id));
              case "group":
                return newSection();
              case "add-card": {
                const v = viewport();
                const w = { x: a.x, y: a.y };
                const s = { x: w.x * camRef.current.zoom + camRef.current.x, y: w.y * camRef.current.zoom + camRef.current.y };
                return setPicker({ x: Math.min(s.x, v.w - 360), y: s.y, wx: w.x, wy: w.y });
              }
              case "add-section":
                return newSection({ x: a.x + 320, y: a.y + 200 });
              case "add-map":
                return addMindMap({ x: a.x, y: a.y });
              case "add-media":
                return pickMedia({ x: a.x, y: a.y });
              case "add-code":
                return newCode(a.x, a.y);
              case "add-draw":
                return newDraw(a.x, a.y);
              case "add-table":
                return newTable(a.x, a.y);
              case "add-kind":
                return insertAt(a.kind, { x: a.x, y: a.y });
              case "topic-child":
                return growTopic("child");
              case "topic-after":
                return growTopic("after");
              case "topic-edit":
                if (menu.kind === "topic") startEdit(menu.map, menu.topic);
                return;
              case "topic-fold":
                if (menu.kind === "topic") apply({ ...b, maps: toggleCollapse(b.maps, menu.map, menu.topic) });
                return focusCanvas();
              case "topic-delete":
                deleteTopic();
                return focusCanvas();
              case "topic-send":
                return setSend({ x: menu.x, y: menu.y });
              case "fit":
                return fit();
            }
          }}
        />
      )}
    </div>
  );
}

/* ─── 卡片 ─── */

/** 卡片與區段外觀的 class：填色 f-*、形狀 s-*、粗體（預設的淡色底、圓角不加） */
const lookClass = (c: { look?: Card["look"] }) =>
  `${c.look?.fill ? ` f-${c.look.fill}` : ""}${c.look?.shape ? ` s-${c.look.shape}` : ""}${c.look?.bold ? " bold" : ""}`;

/**
 * 位置與顏色變數：--cc 是卡片顏色的深色版（實心、外框、底線用）。沒有顏色時用 --board-ink，
 * 不能用 --ed-text 之類：實心卡片會把那些變數換成白色，底色也跟著變白、文字就看不到了。
 */
const cardStyle = (c: Card): React.CSSProperties =>
  ({
    left: c.x,
    top: c.y,
    width: c.w,
    height: c.h ?? undefined,
    "--cc": c.color ? `var(--tc-${c.color})` : "var(--board-ink)",
  }) as React.CSSProperties;

const BoardCard = memo(function BoardCard(props: {
  card: Card;
  content: string | undefined;
  exists: boolean;
  docs: Docs;
  docKey: string;
  now: string;
  selected: boolean;
  linkTarget: boolean;
  onHeight: (id: string, h: number) => void;
}) {
  const { card, docs, docKey, exists, onHeight } = props;
  const ref = useRef<HTMLDivElement>(null);
  const { load, update } = docs;
  useEffect(() => {
    if (exists) load(docKey);
  }, [exists, docKey, load]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => onHeight(card.id, el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [card.id, onHeight]);

  const content = props.content ?? (exists ? undefined : "");
  const r = card.ref as DocRef;
  const isDay = r.kind === "day";
  const title = r.kind === "day" ? dayTitle(r.date, props.now) : r.name;
  const sub = r.kind === "day" ? weekday(r.date) : "";
  const onChange = useCallback((md: string) => update(docKey, md), [update, docKey]);

  return (
    <div
      ref={ref}
      className={`board-card${props.selected ? " selected" : ""}${props.linkTarget ? " link-target" : ""}${card.color ? ` c-${card.color}` : ""}${lookClass(card)}`}
      data-id={card.id}
      style={cardStyle(card)}
    >
      <div className="bc-head" title="Drag to move · double-click to open">
        <span className="bc-icon">{isDay ? <CalendarIcon /> : <DocIcon />}</span>
        <span className="bc-title">{title}</span>
        {sub && <span className="bc-sub">{sub}</span>}
      </div>
      <div className="bc-body" style={card.h === null ? { maxHeight: CARD_AUTO_MAX_H } : undefined}>
        {content === undefined ? (
          <div className="bc-loading">Loading…</div>
        ) : (
          <Editor
            value={content}
            onChange={onChange}
            compact
            placeholder={isDay ? "What happened this day?" : "Write something…"}
          />
        )}
      </div>
      {(["top", "right", "bottom", "left"] as const).map((side) => (
        <span key={side} className={`bc-dot ${side}`} data-connect={card.id} title="Drag to another card to connect" />
      ))}
      <span className="bc-resize width" data-resize={card.id} data-mode="width" />
      <span className="bc-resize both" data-resize={card.id} data-mode="both" title="Drag to resize · double-click for automatic height" />
    </div>
  );
});

/* ─── 便利貼 ─── */

/* ─── 程式碼卡片 ─── */

/**
 * 程式碼卡片：上方是語言與複製（和編輯器的程式碼區塊同一個 CodeTools），下面是上色的程式碼。
 * 編輯用一個透明的 textarea 疊在上色的 pre 上面（兩者同樣自動換行，高度跟著 pre）。
 * Tab 插入兩個空白、Esc 回到畫布。
 */
const CodeCard = memo(function CodeCard(props: {
  card: Card;
  selected: boolean;
  linkTarget: boolean;
  onHeight: (id: string, h: number) => void;
  onText: (id: string, text: string) => void;
  onLang: (id: string, lang: string) => void;
  onExit: () => void;
}) {
  const { card, onHeight, onText } = props;
  const lang = card.ref.kind === "code" ? card.ref.lang : "";
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => onHeight(card.id, el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [card.id, onHeight]);
  // 最後多一個換行：textarea 最後一行是空行時，pre 也要一樣高
  const html = useMemo(() => highlightCode(card.text, lang) + "\n", [card.text, lang]);
  const textRef = useRef(card.text);
  textRef.current = card.text;
  return (
    <div
      ref={ref}
      className={`board-card code${props.selected ? " selected" : ""}${props.linkTarget ? " link-target" : ""}`}
      data-id={card.id}
      style={cardStyle(card)}
    >
      <div className="bc-head code-head" title="Drag to move">
        <span className="bc-icon bc-code-icon">{"</>"}</span>
        <CodeTools lang={lang} code={() => textRef.current} onLang={(l) => props.onLang(card.id, l)} className="in-card" />
      </div>
      <div className="bc-body code-body" style={card.h === null ? { maxHeight: CARD_AUTO_MAX_H } : undefined}>
        <div className="code-edit">
          <pre className="code-hl" aria-hidden>
            <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
          </pre>
          <textarea
            className="code-input"
            value={card.text}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            placeholder="Paste or type code…"
            onChange={(e) => onText(card.id, e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.nativeEvent.isComposing) return;
              const ta = e.currentTarget;
              if (e.key === "Tab" && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                const a = ta.selectionStart;
                const b = ta.selectionEnd;
                const v = ta.value;
                if (e.shiftKey) {
                  // 去掉這一行開頭最多兩個空白
                  const ls = v.lastIndexOf("\n", a - 1) + 1;
                  const n = /^ {1,2}/.exec(v.slice(ls))?.[0].length ?? 0;
                  if (!n) return;
                  onText(card.id, v.slice(0, ls) + v.slice(ls + n));
                  requestAnimationFrame(() => ta.setSelectionRange(Math.max(ls, a - n), Math.max(ls, b - n)));
                } else {
                  onText(card.id, v.slice(0, a) + "  " + v.slice(b));
                  requestAnimationFrame(() => ta.setSelectionRange(a + 2, a + 2));
                }
              } else if (e.key === "Escape") {
                e.preventDefault();
                ta.blur();
                props.onExit();
              }
            }}
          />
        </div>
      </div>
      {(["top", "right", "bottom", "left"] as const).map((side) => (
        <span key={side} className={`bc-dot ${side}`} data-connect={card.id} title="Drag to another card to connect" />
      ))}
      <span className="bc-resize width" data-resize={card.id} data-mode="width" />
      <span className="bc-resize both" data-resize={card.id} data-mode="both" title="Drag to resize · double-click for automatic height" />
    </div>
  );
});

/* ─── 便利貼 ─── */

const NoteCard = memo(function NoteCard(props: {
  card: Card;
  selected: boolean;
  linkTarget: boolean;
  onHeight: (id: string, h: number) => void;
  onText: (id: string, text: string) => void;
}) {
  const { card, onHeight, onText } = props;
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => onHeight(card.id, el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [card.id, onHeight]);
  const onChange = useCallback((md: string) => onText(card.id, md), [onText, card.id]);
  return (
    <div
      ref={ref}
      className={`board-card note${props.selected ? " selected" : ""}${props.linkTarget ? " link-target" : ""}${card.color ? ` c-${card.color}` : ""}${lookClass(card)}`}
      data-id={card.id}
      style={cardStyle(card)}
    >
      <div className="bc-head note-grip" title="Drag to move" />
      <div className="bc-body" style={card.h === null ? { maxHeight: CARD_AUTO_MAX_H } : undefined}>
        <Editor value={card.text} onChange={onChange} compact placeholder="Type an idea…" />
      </div>
      {(["top", "right", "bottom", "left"] as const).map((side) => (
        <span key={side} className={`bc-dot ${side}`} data-connect={card.id} title="Drag to another card to connect" />
      ))}
      <span className="bc-resize width" data-resize={card.id} data-mode="width" />
      <span className="bc-resize both" data-resize={card.id} data-mode="both" title="Drag to resize · double-click for automatic height" />
    </div>
  );
});

/* ─── 媒體卡片 ─── */

/** 量圖片、影片的原始大小，算出卡片大小（量不到就是 16:9）。 */
function measureMedia(src: string, type: MediaType): Promise<{ w: number; h: number }> {
  if (type === "embed") return Promise.resolve(fitMediaSize(560, 315, 560));
  return new Promise((resolve) => {
    let done = false;
    const finish = (w: number, h: number) => {
      if (done) return;
      done = true;
      resolve(fitMediaSize(w, h));
    };
    setTimeout(() => finish(0, 0), 5000);
    if (type === "image") {
      const img = new Image();
      img.onload = () => finish(img.naturalWidth, img.naturalHeight);
      img.onerror = () => finish(0, 0);
      img.src = mediaUrl(src);
    } else {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.muted = true;
      v.onloadedmetadata = () => finish(v.videoWidth, v.videoHeight);
      v.onerror = () => finish(0, 0);
      v.src = mediaUrl(src);
    }
  });
}

/**
 * 圖片、GIF、影片、嵌入影片。圖片整張都可以拖；影片、嵌入影片沒選取時上面蓋一層（點下去是選取、拖曳），
 * 選取後才能播放，拖上方的握把搬移。
 */
const MediaCard = memo(function MediaCard(props: { card: Card; selected: boolean; linkTarget: boolean }) {
  const { card, selected } = props;
  const ref = card.ref as Extract<CardRef, { kind: "media" }>;
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [ref.src]);
  const embed = ref.type === "embed" ? embedUrl(ref.src) : null;
  const playable = ref.type !== "image";
  let body: React.ReactNode;
  if (broken || (ref.type === "embed" && !embed)) {
    body = (
      <div className="bm-broken">
        <ImageIcon />
        <span>{ref.type === "image" ? "Image not found" : "Video not found"}</span>
      </div>
    );
  } else if (ref.type === "image") {
    body = <img className="bm-img" src={mediaUrl(ref.src)} alt="" draggable={false} onError={() => setBroken(true)} />;
  } else if (ref.type === "video") {
    body = (
      <video
        className={`bm-video${selected ? " bm-live" : ""}`}
        src={mediaUrl(ref.src)}
        controls={selected}
        preload="metadata"
        playsInline
        onError={() => setBroken(true)}
      />
    );
  } else {
    body = (
      <iframe
        className="bm-frame"
        src={embed!}
        title="Embedded video"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    );
  }
  return (
    <div
      className={`board-card media${selected ? " selected" : ""}${props.linkTarget ? " link-target" : ""}${playable ? " playable" : ""}`}
      data-id={card.id}
      style={cardStyle(card)}
    >
      <div className="bm-body">
        {body}
        {playable && !selected && <div className="bm-shield" title="Click to select · then play" />}
      </div>
      {playable && <div className="bc-head bm-grip" title="Drag to move" />}
      {(["top", "right", "bottom", "left"] as const).map((side) => (
        <span key={side} className={`bc-dot ${side}`} data-connect={card.id} title="Drag to another card to connect" />
      ))}
      <span className="bc-resize both" data-resize={card.id} data-mode="both" title="Drag to resize" />
    </div>
  );
});

/* ─── 新增的種類（工具列 Insert ▾ 與右鍵選單共用；便利貼、頁面另外有自己的按鈕） ─── */

type InsertKind = "section" | "map" | "media" | "code" | "draw" | "table";
const INSERTS: { id: InsertKind; icon: React.ReactNode; label: string; hint: string }[] = [
  { id: "section", icon: <SectionIcon />, label: "Section", hint: "Group cards" },
  { id: "map", icon: <MindMapIcon />, label: "Mind map", hint: "Tab / Enter to grow" },
  { id: "media", icon: <ImageIcon />, label: "Image or video", hint: "Or paste one" },
  { id: "code", icon: <span className="bt-code">{"</>"}</span>, label: "Code", hint: "Or paste a ``` block" },
  { id: "draw", icon: <DrawIcon />, label: "Diagram", hint: "Shapes and arrows" },
  { id: "table", icon: <SheetIcon />, label: "Table", hint: "Or paste cells" },
];

/* ─── 圖表卡片（Draw） ─── */

/**
 * 圖表卡片：白板上顯示圖表的圖（`drawExport.ts` 的 `toSvg`，和匯出 SVG 同一套，所以是固定的淺色），
 * 連按兩下（或卡片上的 Edit）在白板上方打開完整的 Draw 編輯器（`DrawEditor`）。
 */
const DrawCard = memo(function DrawCard(props: { card: Card; selected: boolean; linkTarget: boolean; onEdit: (id: string) => void }) {
  const { card, selected } = props;
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const d = parseDiagram(card.text);
    if (!d.shapes.length && !d.edges.length) {
      setSvg("");
      return;
    }
    // 圖形裡的圖片要先讀成 data URL，SVG 當成 <img> 才看得到
    void loadImages(d)
      .catch(() => ({}))
      .then((images) => live && setSvg(toSvg(d, images).svg));
    return () => {
      live = false;
    };
  }, [card.text]);
  return (
    <div className={`board-card media draw${selected ? " selected" : ""}${props.linkTarget ? " link-target" : ""}`} data-id={card.id} style={cardStyle(card)}>
      <div className="bm-body bd-body">
        {svg ? (
          <img className="bm-img bd-img" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt="Diagram" draggable={false} />
        ) : (
          <div className="bm-broken">
            <DrawIcon />
            <span>{svg === null ? "Loading…" : "Empty diagram · double-click to draw"}</span>
          </div>
        )}
      </div>
      <button className="bd-edit board-ui" title="Edit this diagram (or double-click it)" onPointerDown={(e) => e.stopPropagation()} onClick={() => props.onEdit(card.id)}>
        <PencilIcon /> Edit
      </button>
      {(["top", "right", "bottom", "left"] as const).map((side) => (
        <span key={side} className={`bc-dot ${side}`} data-connect={card.id} title="Drag to another card to connect" />
      ))}
      <span className="bc-resize both" data-resize={card.id} data-mode="both" title="Drag to resize" />
    </div>
  );
});

/**
 * 表格卡片：白板上直接顯示表格（照格式算好的值，標題列、標題欄、表尾列另外上色）；
 * 連按兩下、Edit 或右鍵「Edit table」用完整的 Excel 編輯。
 */
const SheetCard = memo(function SheetCard(props: { card: Card; selected: boolean; linkTarget: boolean; onEdit: (id: string) => void }) {
  const { card, selected } = props;
  const tables = useMemo(() => sheetPreview(card.text), [card.text]);
  return (
    <div className={`board-card media sheet${selected ? " selected" : ""}${props.linkTarget ? " link-target" : ""}`} data-id={card.id} style={cardStyle(card)}>
      <div className="bm-body bt-body">
        {tables.length ? (
          tables.map((t, i) => (
            <div className="bt-table" key={i}>
              {t.showName && <div className="bt-name">{t.name}</div>}
              <table>
                <colgroup>
                  {t.widths.map((w, c) => (
                    <col key={c} style={{ width: w }} />
                  ))}
                </colgroup>
                <tbody>
                  {t.rows.map((r, ri) => (
                    <tr key={ri}>
                      {r.map((cell, ci) => (
                        <td key={ci} className={`${cell.head ? "h" : ""}${cell.b ? " b" : ""}${cell.i ? " i" : ""}`} style={{ textAlign: cell.align }}>
                          {cell.text}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {t.more && <div className="bt-more">…</div>}
            </div>
          ))
        ) : (
          <div className="bm-broken">
            <SheetIcon />
            <span>Empty table · double-click to edit</span>
          </div>
        )}
      </div>
      <button className="bd-edit board-ui" title="Edit this table (or double-click it)" onPointerDown={(e) => e.stopPropagation()} onClick={() => props.onEdit(card.id)}>
        <PencilIcon /> Edit
      </button>
      {(["top", "right", "bottom", "left"] as const).map((side) => (
        <span key={side} className={`bc-dot ${side}`} data-connect={card.id} title="Drag to another card to connect" />
      ))}
      <span className="bc-resize both" data-resize={card.id} data-mode="both" title="Drag to resize" />
    </div>
  );
});

/**
 * 在白板上方編輯圖表或表格卡片：完整的 Draw（`DrawView`）或 Excel（`SheetView`），改了就寫回卡片。
 * 蓋在整個視窗上（portal 到 body），事件在這裡擋下，不會傳到白板（React 的 portal 會把事件往白板傳）。
 */
function CardEditor(props: {
  card: Card;
  onChange: (json: string) => void;
  onModifySheet: (fn: (wb: Workbook) => Workbook) => void;
  onClose: () => void;
  onSendToDock?: () => void;
}) {
  const sheet = props.card.ref.kind === "sheet";
  // 打開時把焦點移進編輯器（Excel 是選取格上的輸入框），不然按鍵會送到白板的畫布
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const t = setTimeout(() => (box.querySelector<HTMLElement>(".st-input") ?? box).focus({ preventScroll: true }), 0);
    return () => clearTimeout(t);
  }, []);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return createPortal(
    <div
      ref={boxRef}
      tabIndex={-1}
      className="board-draw-editor"
      role="dialog"
      aria-label={sheet ? "Edit table" : "Edit diagram"}
      onKeyDown={stop}
      onKeyUp={stop}
      onPaste={stop}
      onCopy={stop}
      onCut={stop}
      onPointerDown={stop}
      onPointerUp={stop}
      onMouseDown={stop}
      onDoubleClick={stop}
      onWheel={stop}
      onContextMenu={stop}
      onDragOver={stop}
      onDrop={stop}
    >
      <div className="bde-bar">
        {sheet ? <SheetIcon /> : <DrawIcon />}
        <span className="bde-title">{sheet ? "Table on the whiteboard" : "Diagram on the whiteboard"}</span>
        <span className="bde-hint">Changes are saved to the card</span>
        {props.onSendToDock && (
          <button className="dp-btn" onClick={props.onSendToDock} title={sheet ? "Make an Excel document in the Dock from this table" : "Make a Draw document in the Dock from this diagram"}>
            <SendIcon /> Send to Dock
          </button>
        )}
        <button className="dp-btn primary" onClick={props.onClose} title="Back to the whiteboard">
          Done
        </button>
      </div>
      <div className="bde-body">
        {sheet ? (
          <SheetView json={props.card.text} onModify={props.onModifySheet} />
        ) : (
          <DrawView docId={`board-${props.card.id}`} title="Diagram" value={props.card.text} onChange={props.onChange} />
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ─── 送到 Dock 的選單 ─── */

function SendMenu(props: {
  x: number;
  y: number;
  dock: { id: string; title: string; kind: DockKind }[];
  onPick: (to: SendTarget) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: props.x, top: props.y });
  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    const r = el.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(props.x, h.width - r.width - 8)),
      top: Math.max(8, Math.min(props.y, h.height - r.height - 8)),
    });
  }, [props.x, props.y]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.(".bt-send")) props.onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
    };
  });
  const icon = (k: DockKind) =>
    k === "slides" ? <SlidesIcon /> : k === "word" ? <DocIcon /> : k === "sheet" ? <SheetIcon /> : k === "draw" ? <DrawIcon /> : <NoteIcon />;
  return (
    <div className="popover block-menu board-menu send-menu" ref={ref} style={pos}>
      <button onClick={() => props.onPick({ tasks: true })} title="Each card becomes a task card in the first list">
        <span className="glyph">
          <BoardIcon />
        </span>
        <span className="label">Tasks</span>
        <span className="hint">Add as cards</span>
      </button>
      <div className="popover-sep" />
      {props.dock.length > 0 && <div className="popover-title">Append to</div>}
      {props.dock.map((d) => (
        <button key={d.id} onClick={() => props.onPick({ doc: d.id })}>
          <span className="glyph">{icon(d.kind)}</span>
          <span className="label">{d.title}</span>
          <span className="hint">{kindLabel(d.kind)}</span>
        </button>
      ))}
      {props.dock.length > 0 && <div className="popover-sep" />}
      <div className="popover-title">New in the Dock</div>
      {DOCK_KINDS.map((k) => (
        <button key={k.kind} onClick={() => props.onPick({ kind: k.kind })}>
          <span className="glyph">
            <PlusIcon />
          </span>
          <span className="label">{k.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ─── 區段 ─── */

function SectionBox(props: { section: Section; selected: boolean; editing: boolean; onRename: (t: string | null) => void }) {
  const s = props.section;
  return (
    <div
      className={`board-section${props.selected ? " selected" : ""}${s.color ? ` c-${s.color}` : ""}${lookClass(s)}`}
      style={
        {
          left: s.x,
          top: s.y,
          width: s.w,
          height: s.h,
          "--cc": s.color ? `var(--tc-${s.color})` : "var(--board-ink)",
        } as React.CSSProperties
      }
    >
      <div className="bs-head" data-id={s.id} title="Drag to move the section and everything in it · double-click to rename">
        {props.editing ? (
          <InlineInput value={s.title} className="bs-input" onDone={props.onRename} />
        ) : (
          s.title || "Section"
        )}
      </div>
      <span className="bs-resize" data-resize={s.id} />
    </div>
  );
}

function EdgeLabel(props: {
  id: string;
  x: number;
  y: number;
  label: string;
  selected: boolean;
  editing: boolean;
  onDone: (label: string | null) => void;
}) {
  return (
    <div className={`board-edge-label${props.selected ? " on" : ""}`} data-edge={props.id} style={{ left: props.x, top: props.y }}>
      {props.editing ? <InlineInput value={props.label} className="bel-input" placeholder="Label" onDone={props.onDone} /> : props.label}
    </div>
  );
}

/** 原地輸入：Enter 或點別處儲存、Esc 取消（回傳 null）。 */
function InlineInput(props: { value: string; className: string; placeholder?: string; onDone: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    props.onDone(v);
  };
  return (
    <input
      ref={ref}
      className={props.className}
      defaultValue={props.value}
      placeholder={props.placeholder}
      spellCheck={false}
      size={Math.max(6, props.value.length + 1)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") finish(e.currentTarget.value.trim());
        if (e.key === "Escape") finish(null);
      }}
      onInput={(e) => (e.currentTarget.size = Math.max(6, e.currentTarget.value.length + 1))}
      onBlur={(e) => finish(e.currentTarget.value.trim())}
    />
  );
}

/* ─── 新增卡片：搜尋頁面與日記 ─── */

type PickItem = { ref: CardRef; label: string; hint: string; create?: boolean };

function CardPicker(props: {
  x: number;
  y: number;
  pageNames: string[];
  journalDates: Set<string> | null;
  now: string;
  onBoard: Set<string>;
  onPick: (ref: CardRef) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const items = useMemo<PickItem[]>(() => {
    const q = pageKey(query);
    const out: PickItem[] = [];
    const name = cleanName(query);
    if (isDateKey(name)) out.push({ ref: { kind: "day", date: name }, label: dayTitle(name, props.now), hint: "Journal" });
    const pagesHit = props.pageNames.filter((n) => !q || pageKey(n).includes(q));
    // 完全相同的排前面
    pagesHit.sort((a, b) => Number(pageKey(b) === q) - Number(pageKey(a) === q));
    for (const n of pagesHit.slice(0, 40)) out.push({ ref: { kind: "page", name: n }, label: n, hint: "Page" });
    const days = [props.now, ...[...(props.journalDates ?? [])].filter((d) => d !== props.now).sort().reverse()];
    for (const d of days) {
      if (out.length > 60) break;
      const label = dayTitle(d, props.now);
      if (q && !(d.includes(q) || label.toLowerCase().includes(q) || (d === props.now && "today".includes(q)))) continue;
      if (isDateKey(name) && d === name) continue;
      out.push({ ref: { kind: "day", date: d }, label, hint: d === props.now ? "Today" : "Journal" });
    }
    // 沒有同名的頁面：可以新增（有符合的就排在它們後面，Enter 先選到既有的頁面）
    if (name && !isDateKey(name) && !props.pageNames.some((n) => pageKey(n) === q)) {
      const item = { ref: { kind: "page" as const, name }, label: `Create page “${name}”`, hint: "New", create: true };
      if (pagesHit.length) out.splice(Math.min(pagesHit.length, 40), 0, item);
      else out.unshift(item);
    }
    return out;
  }, [query, props.pageNames, props.journalDates, props.now]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    ref.current?.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  }, [active]);
  // 連按兩下開啟時，滑鼠事件結束後畫布會再拿走焦點：等一下再聚焦到輸入框
  useEffect(() => {
    const focus = () => ref.current?.querySelector("input")?.focus({ preventScroll: true });
    focus();
    const t = setTimeout(focus, 30);
    return () => clearTimeout(t);
  }, []);
  // 不要超出白板的範圍
  const [pos, setPos] = useState({ left: props.x, top: props.y });
  useLayoutEffect(() => {
    const host = ref.current?.parentElement?.getBoundingClientRect();
    if (!host) return;
    const w = 340;
    const h = 380;
    setPos({
      left: Math.max(8, Math.min(props.x, host.width - w - 8)),
      top: Math.max(8, Math.min(props.y, host.height - h - 8)),
    });
  }, [props.x, props.y]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) props.onClose();
    };
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  });

  return (
    <div className="board-picker popover" ref={ref} style={pos}>
      <input
        value={query}
        placeholder="Search pages and journals, or type a new page name"
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.nativeEvent.isComposing) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const it = items[active];
            if (it) props.onPick(it.ref);
          } else if (e.key === "Escape") {
            e.preventDefault();
            props.onClose();
          }
        }}
      />
      <div className="bp-list">
        {items.length === 0 && <div className="popover-empty">Type a page name to create a card</div>}
        {items.map((it, i) => (
          <button
            key={`${it.ref.kind}:${refKey(it.ref)}:${it.create ? "new" : ""}`}
            className={`${i === active ? "active" : ""}${it.create ? " create" : ""}`}
            onMouseEnter={() => setActive(i)}
            onClick={() => props.onPick(it.ref)}
          >
            <span className="glyph">{it.create ? <PlusIcon /> : it.ref.kind === "day" ? <CalendarIcon /> : <DocIcon />}</span>
            <span className="label">{it.label}</span>
            {!it.create && props.onBoard.has(refKey(it.ref)) ? (
              <span className="bp-tag">On board</span>
            ) : (
              <span className="bp-hint">{it.hint}</span>
            )}
          </button>
        ))}
      </div>
      <div className="popover-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> choose
        </span>
        <span>
          <kbd>Enter</kbd> add
        </span>
        <span>
          <kbd>Esc</kbd> close
        </span>
      </div>
    </div>
  );
}

/* ─── 右鍵選單 ─── */

type MenuAction =
  | { type: "open" | "auto-height" | "remove" | "rename" | "label" | "flip" | "send" | "delete-ref"; id: string }
  | { type: "color"; id: string; color: Color | null }
  | { type: "group" | "fit" }
  | { type: "add-card" | "add-section" | "add-note" | "add-map" | "add-media" | "add-code" | "add-draw" | "add-table"; x: number; y: number }
  | { type: "add-kind"; kind: InsertKind; x: number; y: number }
  | { type: "topic-child" | "topic-after" | "topic-fold" | "topic-delete" | "topic-send" | "topic-edit" };

function BoardMenu(props: {
  menu: Menu;
  board: Board;
  count: number;
  /** 頁面／日記卡片可以「刪除頁面」 */
  canDeleteRef: boolean;
  onClose: () => void;
  act: (a: MenuAction) => void;
}) {
  const { menu, board, act } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });
  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    const r = el.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(menu.x, h.width - r.width - 8)),
      top: Math.max(8, Math.min(menu.y, h.height - r.height - 8)),
    });
  }, [menu.x, menu.y]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) props.onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
    };
  });

  const many = props.count > 1;
  const swatches = (id: string, current: Color | null) => (
    <>
      <div className="popover-title">Color</div>
      <div className="swatches">
        {[null, ...COLORS].map((c) => (
          <button
            key={c ?? "none"}
            className={`swatch bg${c ? ` bg-${c}` : " none"}${current === c ? " on" : ""}`}
            title={c ? COLOR_LABELS[c] : "Default"}
            onClick={() => act({ type: "color", id, color: c })}
          />
        ))}
      </div>
    </>
  );

  let body: React.ReactNode = null;
  if (menu.kind === "card") {
    const c = board.cards.find((x) => x.id === menu.id);
    if (!c) return null;
    body = (
      <>
        {many && <div className="popover-count">{props.count} items selected</div>}
        {isDocRef(c.ref) && (
          <button onClick={() => act({ type: "open", id: c.id })}>
            <span className="glyph">
              <OpenIcon />
            </span>
            <span className="label">Open {c.ref.kind === "day" ? "journal" : "page"}</span>
          </button>
        )}
        {editsInPlace(c.ref) && (
          <button onClick={() => act({ type: "open", id: c.id })}>
            <span className="glyph">
              <PencilIcon />
            </span>
            <span className="label">{c.ref.kind === "sheet" ? "Edit table" : "Edit diagram"}</span>
          </button>
        )}
        <button onClick={() => act({ type: "send", id: c.id })}>
          <span className="glyph">
            <SendIcon />
          </span>
          <span className="label">Send to Dock…</span>
        </button>
        {c.h !== null && !fixedSize(c.ref) && (
          <button onClick={() => act({ type: "auto-height", id: c.id })}>
            <span className="glyph">↕</span>
            <span className="label">Automatic height</span>
          </button>
        )}
        {many && (
          <button onClick={() => act({ type: "group" })}>
            <span className="glyph">
              <SectionIcon />
            </span>
            <span className="label">Group in a section</span>
          </button>
        )}
        {!fixedSize(c.ref) && c.ref.kind !== "code" && swatches(c.id, c.color)}
        <div className="popover-sep" />
        <button className="danger" onClick={() => act({ type: "remove", id: c.id })}>
          <span className="glyph">
            <CloseIcon />
          </span>
          <span className="label">{many ? `Remove ${props.count} from whiteboard` : "Remove from whiteboard"}</span>
        </button>
        {!many && props.canDeleteRef && isDocRef(c.ref) && (
          <button className="danger" onClick={() => act({ type: "delete-ref", id: c.id })}>
            <span className="glyph">
              <TrashIcon />
            </span>
            <span className="label">Delete {c.ref.kind === "day" ? "journal" : "page"}…</span>
          </button>
        )}
      </>
    );
  } else if (menu.kind === "section") {
    const s = board.sections.find((x) => x.id === menu.id);
    if (!s) return null;
    body = (
      <>
        <button onClick={() => act({ type: "rename", id: s.id })}>
          <span className="glyph">✎</span>
          <span className="label">Rename</span>
        </button>
        {swatches(s.id, s.color)}
        <div className="popover-sep" />
        <button className="danger" onClick={() => act({ type: "remove", id: s.id })}>
          <span className="glyph">
            <TrashIcon />
          </span>
          <span className="label">{many ? `Remove ${props.count} items` : "Delete section (keeps the cards)"}</span>
        </button>
      </>
    );
  } else if (menu.kind === "topic") {
    const m = board.maps.find((x) => x.id === menu.map);
    const f = m && findTopic(m, menu.topic);
    if (!f) return null;
    const isRoot = !f.parent;
    body = (
      <>
        <button onClick={() => act({ type: "topic-child" })}>
          <span className="glyph">↳</span>
          <span className="label">Add subtopic</span>
          <span className="hint">Tab</span>
        </button>
        {!isRoot && (
          <button onClick={() => act({ type: "topic-after" })}>
            <span className="glyph">
              <PlusIcon />
            </span>
            <span className="label">Add topic</span>
            <span className="hint">Enter</span>
          </button>
        )}
        <button onClick={() => act({ type: "topic-edit" })}>
          <span className="glyph">✎</span>
          <span className="label">Edit text</span>
          <span className="hint">F2</span>
        </button>
        {!isRoot && f.topic.children.length > 0 && (
          <button onClick={() => act({ type: "topic-fold" })}>
            <span className="glyph">{f.topic.collapsed ? "+" : "−"}</span>
            <span className="label">{f.topic.collapsed ? "Expand" : "Collapse"}</span>
            <span className="hint">Ctrl+.</span>
          </button>
        )}
        <button onClick={() => act({ type: "topic-send" })}>
          <span className="glyph">
            <SendIcon />
          </span>
          <span className="label">Send mind map to Dock…</span>
        </button>
        <div className="popover-sep" />
        <button className="danger" onClick={() => act({ type: "topic-delete" })}>
          <span className="glyph">
            <TrashIcon />
          </span>
          <span className="label">{isRoot ? "Delete mind map" : "Delete topic"}</span>
          <span className="hint">Delete</span>
        </button>
      </>
    );
  } else if (menu.kind === "edge") {
    body = (
      <>
        <button onClick={() => act({ type: "label", id: menu.id })}>
          <span className="glyph">✎</span>
          <span className="label">Edit label</span>
        </button>
        <button onClick={() => act({ type: "flip", id: menu.id })}>
          <span className="glyph">⇄</span>
          <span className="label">Reverse direction</span>
        </button>
        <div className="popover-sep" />
        <button className="danger" onClick={() => act({ type: "remove", id: menu.id })}>
          <span className="glyph">
            <TrashIcon />
          </span>
          <span className="label">Delete connection</span>
        </button>
      </>
    );
  } else {
    body = (
      <>
        <button onClick={() => act({ type: "add-note", x: menu.wx, y: menu.wy })}>
          <span className="glyph">
            <NoteIcon />
          </span>
          <span className="label">Add note here</span>
        </button>
        <button onClick={() => act({ type: "add-card", x: menu.wx, y: menu.wy })}>
          <span className="glyph">
            <DocIcon />
          </span>
          <span className="label">Add page or journal here</span>
        </button>
        <div className="board-menu-tiles" role="group" aria-label="Add here">
          {INSERTS.map((it) => (
            <button key={it.id} title={`Add ${it.label.toLowerCase()} here`} aria-label={`Add ${it.label.toLowerCase()} here`} onClick={() => act({ type: "add-kind", kind: it.id, x: menu.wx, y: menu.wy })}>
              {it.icon}
            </button>
          ))}
        </div>
        <div className="popover-sep" />
        <button onClick={() => act({ type: "fit" })}>
          <span className="glyph">
            <FitIcon />
          </span>
          <span className="label">Fit to screen</span>
        </button>
      </>
    );
  }
  return (
    <div className="popover block-menu board-menu" ref={ref} style={pos}>
      {body}
    </div>
  );
}
