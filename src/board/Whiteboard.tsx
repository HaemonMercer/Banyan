import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Editor } from "../editor/Editor";
import {
  CalendarIcon,
  CloseIcon,
  DocIcon,
  FitIcon,
  MinusIcon,
  OpenIcon,
  PlusIcon,
  SectionIcon,
  TrashIcon,
} from "../editor/icons";
import { COLORS, COLOR_LABELS, type Color } from "../editor/inline";
import { dayTitle, isDateKey, weekday } from "../journal/journal";
import type { Docs } from "../journal/useJournals";
import { cleanName, pageKey } from "../pages/pageRef";
import {
  addCard,
  addEdge,
  addSection,
  boundsOf,
  CARD_AUTO_MAX_H,
  CARD_MIN_H,
  CARD_MIN_W,
  CARD_W,
  cardRect,
  contains,
  dangling,
  edgePath,
  findCard,
  fitCamera,
  flipEdge,
  intersects,
  moveItems,
  parseBoard,
  removeItems,
  sectionAround,
  sectionMembers,
  SECTION_MIN,
  serializeBoard,
  toWorld,
  updateCard,
  updateEdge,
  updateSection,
  zoomAt,
  type Board,
  type Camera,
  type Card,
  type CardRef,
  type Rect,
  type Section,
} from "./model";
import { loadCamera, saveCamera } from "./store";
import "./board.css";

/**
 * 白板畫面（參考 Heptabase）。
 *
 * - 卡片是頁面或日記，在卡片裡直接編輯；拖標題列搬移，右邊、右下角拉大小。
 * - 從卡片四邊的圓點拖到另一張卡片就連起來；連線可以加標籤、反轉方向。
 * - 區段是一個有標題的框，拖動標題時框裡的卡片一起移動。
 * - 滾輪（觸控板兩指）平移、Ctrl＋滾輪（捏合）縮放、按住空白鍵或滑鼠中鍵拖曳平移；
 *   在空白處拖曳框選，連按兩下新增卡片。
 *
 * 編輯器裡的按鍵（復原、刪除…）照舊交給編輯器；焦點在畫布本身時才是白板的操作。
 */

type Menu =
  | { kind: "card"; id: string; x: number; y: number }
  | { kind: "section"; id: string; x: number; y: number }
  | { kind: "edge"; id: string; x: number; y: number }
  | { kind: "canvas"; x: number; y: number; wx: number; wy: number };

type Picker = { x: number; y: number; wx: number; wy: number };

interface Props {
  name: string;
  boards: Docs;
  pages: Docs;
  journals: Docs;
  /** 可以放上白板的頁面名稱（有內容的與被提到的） */
  pageNames: string[];
  now: string;
  onOpen: (ref: CardRef) => void;
}

const refKey = (r: CardRef) => (r.kind === "page" ? pageKey(r.name) : r.date);

export function Whiteboard(props: Props) {
  const { name, boards, pages, journals, now } = props;
  const json = boards.contents[name];
  const exists = !!boards.dates?.has(name);
  const { load } = boards;
  useEffect(() => {
    if (exists) load(name);
  }, [exists, name, load]);

  if (json === undefined && exists) return <div className="board-loading">Loading…</div>;
  return <Canvas key={name} {...props} json={json ?? ""} pages={pages} journals={journals} now={now} />;
}

function Canvas(props: Props & { json: string }) {
  const { name, boards, pages, journals, now, json } = props;
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

  const { update: updateBoard } = boards;
  const write = useCallback(
    (next: Board) => {
      boardRef.current = next;
      setBoardState(next);
      const j = serializeBoard(next);
      lastJson.current = j;
      updateBoard(name, j);
    },
    [name, updateBoard],
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
  const allRects = (b = boardRef.current): Rect[] => [...b.cards.map(rectOf), ...b.sections];
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
      if (e.code === "Space" && !e.repeat && !editable(e.target) && e.target === rootRef.current) {
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

  const [selected, setSelectedState] = useState<string[]>([]);
  const selRef = useRef<string[]>([]);
  const select = useCallback((ids: string[]) => {
    selRef.current = ids;
    setSelectedState(ids);
  }, []);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  // 白板內容變了，選取裡已經不存在的就拿掉
  useEffect(() => {
    const ids = new Set([...board.cards, ...board.sections, ...board.edges].map((x) => x.id));
    if (selRef.current.some((id) => !ids.has(id))) select(selRef.current.filter((id) => ids.has(id)));
  }, [board, select]);

  const [menu, setMenu] = useState<Menu | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [box, setBox] = useState<Rect | null>(null);
  const [link, setLink] = useState<{ from: string; x: number; y: number; over: string | null } | null>(null);
  const [editLabel, setEditLabel] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [dragging, setDragging] = useState(false);

  const focusCanvas = () => rootRef.current?.focus({ preventScroll: true });
  /** 上次拖曳（搬移、拉大小、連線）的時間：剛拖完的兩下點擊不算連按兩下 */
  const draggedAt = useRef(0);

  /* ─── 指標操作（全部從畫布根元素分派） ─── */

  const lastDown = useRef({ x: 0, y: 0 });
  const onPointerDown = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement;
    lastDown.current = { x: e.clientX, y: e.clientY };
    // 卡片內容交給編輯器；浮動的工具列、選單自己處理
    if (t.closest(".bc-body, .board-ui, .board-menu, .board-picker, input, textarea")) return;
    setMenu(null);
    setPicker(null);
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
          if (card) {
            const w = Math.max(CARD_MIN_W, r0.w + dx);
            const h = mode === "width" ? card.h : Math.max(CARD_MIN_H, r0.h + dy);
            apply(updateCard(base, id, { w, h }), false);
          } else if (sec) {
            apply(updateSection(base, id, { w: Math.max(SECTION_MIN, r0.w + dx), h: Math.max(SECTION_MIN, r0.h + dy) }), false);
          }
        },
        () => setDragging(false),
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
          apply(moveItems(base, moving, dx, dy), false);
        },
        () => setDragging(false),
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

  const onDoubleClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (Date.now() - draggedAt.current < 500) return;
    if (t.closest(".bc-body, .board-ui, .board-menu, .board-picker, input")) return;
    const cardEl = t.closest<HTMLElement>(".board-card");
    if (cardEl) {
      const c = boardRef.current.cards.find((x) => x.id === cardEl.dataset.id);
      if (c && !t.closest("[data-resize], [data-connect]")) props.onOpen(c.ref);
      if (c && t.closest("[data-resize]")) apply(updateCard(boardRef.current, c.id, { h: null }));
      return;
    }
    const secEl = t.closest<HTMLElement>(".bs-head");
    if (secEl) return setEditTitle(secEl.dataset.id!);
    const edgeEl = t.closest<HTMLElement>("[data-edge]");
    if (edgeEl) return setEditLabel(edgeEl.dataset.edge!);
    const v = viewport();
    const w = screenToWorld(e.clientX, e.clientY);
    setPicker({ x: e.clientX - v.left, y: e.clientY - v.top, wx: w.x, wy: w.y });
  };

  const onContextMenu = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest(".bc-body, .board-ui, .board-menu, .board-picker, input")) return;
    e.preventDefault();
    const v = viewport();
    const x = e.clientX - v.left;
    const y = e.clientY - v.top;
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
    if (e.target !== rootRef.current || e.nativeEvent.isComposing) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    let handled = true;
    if (ctrl && !e.altKey && (k === "z" || k === "y")) undo(k === "y" || e.shiftKey);
    else if (ctrl && k === "a") select([...boardRef.current.cards, ...boardRef.current.sections].map((x) => x.id));
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
    } else if (e.key === "Enter" && selRef.current.length === 1) {
      const c = boardRef.current.cards.find((x) => x.id === selRef.current[0]);
      if (c) focusCardEditor(c.id);
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
    const row = rootRef.current?.querySelector<HTMLElement>(`.board-card[data-id="${id}"] .md-editor .row .content, .board-card[data-id="${id}"] .md-editor .tail`);
    row?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    row?.click();
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

  const removeSelected = () => apply(removeItems(boardRef.current, selRef.current));

  /* ─── 畫面 ─── */

  const empty = !board.cards.length && !board.sections.length;
  const world = `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})`;
  const grid = 24 * cam.zoom;
  const cardById = useMemo(() => new Map(board.cards.map((c) => [c.id, c])), [board.cards]);
  const onBoard = useMemo(() => new Set(board.cards.map((c) => refKey(c.ref))), [board.cards]);

  return (
    <div
      ref={rootRef}
      className={`board no-box${spaceDown || panning ? " panning" : ""}${panning ? " grabbing" : ""}${dragging || link ? " dragging" : ""}`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      style={{ backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${cam.x}px ${cam.y}px` }}
    >
      <div className="board-world" style={{ transform: world }}>
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
        {board.cards.map((c) => {
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

      {empty && (
        <div className="board-empty">
          <p className="be-title">This whiteboard is empty</p>
          <p className="be-hint">Double-click anywhere to add a page or journal as a card, or</p>
          <button
            className="be-btn board-ui"
            onClick={() => {
              const v = viewport();
              const c = viewCenter();
              setPicker({ x: v.w / 2 - 170, y: v.h / 2.5 - 40, wx: c.x, wy: c.y });
            }}
          >
            <PlusIcon /> Add a card
          </button>
        </div>
      )}

      <div className="board-toolbar board-ui">
        <button
          onClick={() => {
            const c = viewCenter();
            setPicker({ x: 12, y: 52, wx: c.x, wy: c.y });
          }}
          title="Add a page or journal as a card (or double-click the canvas)"
        >
          <PlusIcon /> <span>Card</span>
        </button>
        <button onClick={() => newSection()} title="Add a section (wraps the selected cards)">
          <SectionIcon /> <span>Section</span>
        </button>
        {selected.length > 0 && (
          <>
            <span className="bt-sep" />
            <span className="bt-count">{selected.length} selected</span>
            <button onClick={removeSelected} title="Remove from whiteboard (Delete)">
              <TrashIcon />
            </button>
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

      <div className="board-hint">Scroll to pan · Ctrl+scroll to zoom · Space+drag to move · drag a card's dot to connect</div>

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
          onClose={() => setMenu(null)}
          act={(a) => {
            setMenu(null);
            const b = boardRef.current;
            switch (a.type) {
              case "open": {
                const c = b.cards.find((x) => x.id === a.id);
                if (c) props.onOpen(c.ref);
                return;
              }
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
  const isDay = card.ref.kind === "day";
  const title = card.ref.kind === "day" ? dayTitle(card.ref.date, props.now) : card.ref.name;
  const sub = card.ref.kind === "day" ? weekday(card.ref.date) : "";
  const onChange = useCallback((md: string) => update(docKey, md), [update, docKey]);

  return (
    <div
      ref={ref}
      className={`board-card${props.selected ? " selected" : ""}${props.linkTarget ? " link-target" : ""}${card.color ? ` c-${card.color}` : ""}`}
      data-id={card.id}
      style={{ left: card.x, top: card.y, width: card.w, height: card.h ?? undefined }}
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

/* ─── 區段 ─── */

function SectionBox(props: { section: Section; selected: boolean; editing: boolean; onRename: (t: string | null) => void }) {
  const s = props.section;
  return (
    <div
      className={`board-section${props.selected ? " selected" : ""}${s.color ? ` c-${s.color}` : ""}`}
      style={{ left: s.x, top: s.y, width: s.w, height: s.h }}
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
  | { type: "open" | "auto-height" | "remove" | "rename" | "label" | "flip"; id: string }
  | { type: "color"; id: string; color: Color | null }
  | { type: "group" | "fit" }
  | { type: "add-card" | "add-section"; x: number; y: number };

function BoardMenu(props: { menu: Menu; board: Board; count: number; onClose: () => void; act: (a: MenuAction) => void }) {
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
        <button onClick={() => act({ type: "open", id: c.id })}>
          <span className="glyph">
            <OpenIcon />
          </span>
          <span className="label">Open {c.ref.kind === "day" ? "journal" : "page"}</span>
        </button>
        {c.h !== null && (
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
        {swatches(c.id, c.color)}
        <div className="popover-sep" />
        <button className="danger" onClick={() => act({ type: "remove", id: c.id })}>
          <span className="glyph">
            <CloseIcon />
          </span>
          <span className="label">{many ? `Remove ${props.count} from whiteboard` : "Remove from whiteboard"}</span>
        </button>
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
        <button onClick={() => act({ type: "add-card", x: menu.wx, y: menu.wy })}>
          <span className="glyph">
            <PlusIcon />
          </span>
          <span className="label">Add card here</span>
        </button>
        <button onClick={() => act({ type: "add-section", x: menu.wx, y: menu.wy })}>
          <span className="glyph">
            <SectionIcon />
          </span>
          <span className="label">Add section here</span>
        </button>
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
