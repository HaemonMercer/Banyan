import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BackIcon,
  CopyIcon,
  ExportIcon,
  EyeIcon,
  EyeOffIcon,
  FitIcon,
  FrameIcon,
  FrontIcon,
  ImageIcon,
  LayersIcon,
  LockIcon,
  MinusIcon,
  NoteIcon,
  PlusIcon,
  SectionIcon,
  ShapesIcon,
  TextIcon,
  TrashIcon,
  UnlockIcon,
} from "../editor/icons";
import { mediaUrl, saveMedia } from "../editor/media";
import { saveExport } from "./export";
import { loadImages, pngBlob, selectionDiagram, toHtml, toPng } from "./drawExport";
import { copyPng } from "./imageClip";
import { boundsOf, fitCamera, toWorld, zoomAt, type Camera, type Rect } from "./board";
import {
  addEdge,
  addFrame,
  addShape,
  arrowHead,
  cloneTo,
  contentBounds,
  copyItems,
  defaultEdgeStyle,
  edgeGeometry,
  FRAME_PRESETS,
  GRID,
  groupItems,
  itemsIn,
  layerName,
  MENU_KINDS,
  MIN_SIZE,
  moveItems,
  moveLayer,
  nearSide,
  NORMAL,
  parseDiagram,
  pasteClip,
  patchEdges,
  patchShapes,
  radiusOf,
  rectOf,
  removeItems,
  renderOrder,
  reorder,
  reparent,
  resizeRect,
  serializeDiagram,
  setRect,
  setShapeStyle,
  SHAPE_INFO,
  shapeMap,
  shapePath,
  sidePoint,
  SIDES,
  snap,
  measureBetween,
  textBox,
  ungroupItems,
  withGroups,
  type Clip,
  type Dash,
  type Diagram,
  type Edge,
  type End,
  type Guide,
  type Measure,
  type Handle,
  type Pt,
  type Shape,
  type ShapeKind,
  type Side,
} from "./draw";
import { DrawStyleBar, fillCss, KindThumb, strokeCss, textCss } from "./DrawStyleBar";
import { snapMove, snapResizeGrid } from "../align/align";
import { AlignMarks } from "../align/AlignMarks";
import "./draw.css";

/**
 * Draw 文件的編輯器：流程圖（參考 draw.io）與網頁設計（參考 Figma）。介面跟白板一樣：整個畫布、
 * 左上角的工具列（Frame、Shape、Text、Image、Note、Layers，選取時顯示數量、複製、刪除）、
 * 選取時下方中央的樣式列（`DrawStyleBar.tsx`，精確的屬性都在它往上打開的選單裡）、右鍵選單、右下角縮放。
 *
 * - 工具（參考 Figma）：F 畫板、R 矩形、O 橢圓、T 文字，在畫布上拖出大小（點一下是預設大小）；Esc 或 V 取消。
 * - 畫板：裡面的圖形跟著搬、超出的裁掉；畫板上方的名稱可以拖、連按兩下改名；畫板裡一律是淺色主題的顏色。
 *   在有內容的畫板空白處拖曳是框選（點一下選取畫板）。
 * - 輔助對齊（參考 Figma）：拖曳時對齊其他圖形的邊與中線、等距吸附（和同一列其他圖形的間距一樣，或夾在兩個中間），
 *   顯示和上下左右鄰居（或所在畫板的內側）的距離；改大小時邊吸到其他圖形；選取後按住 Alt 滑過別的圖形量距離。
 *   拖曳時按住 Alt 暫時不吸附。
 * - 圖層（工具列 Layers）：浮動的清單，拖曳排序與放進畫板、隱藏、鎖定、連按兩下改名；Ctrl＋G 群組。
 *
 * - 畫布：滾輪平移、Ctrl＋滾輪縮放、空白鍵或中鍵拖曳平移；空白處拖曳框選。
 * - 圖形：拖曳搬移（對齊格線與其他圖形的邊，Alt 暫時不對齊）、八個控制點改大小（Shift 維持比例）、
 *   Enter、F2 或連按兩下編輯文字。滑過或選取圖形時四邊出現藍色圓點（和白板的卡片一樣）：拖曳拉出連線，
 *   點一下在那一邊複製一個並連起來。
 * - 連線：選取後拖兩端改接到別的圖形（靠近邊的中點就固定接在那一邊），雙擊編輯標籤。
 *
 * 拖曳一律用指標事件（Tauri 在 Windows 收不到 HTML5 拖放）。顏色用 CSS 變數，跟著主題。
 */

let clipboard: Clip | null = null;
let pasteCount = 0;

const CURSOR: Record<Handle, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};

function handlePoint(r: Rect, h: Handle): Pt {
  return {
    x: r.x + (h.includes("w") ? 0 : h.includes("e") ? r.w : r.w / 2),
    y: r.y + (h.includes("n") ? 0 : h.includes("s") ? r.h : r.h / 2),
  };
}

/* ─── 記住畫面位置 ─── */

const camKey = (id: string) => `banyan.drawCam.${id}`;
function loadCam(id: string): Camera | null {
  try {
    const c = JSON.parse(localStorage.getItem(camKey(id)) ?? "null");
    return c && typeof c.x === "number" && typeof c.y === "number" && typeof c.zoom === "number" ? c : null;
  } catch {
    return null;
  }
}
function saveCam(id: string, c: Camera) {
  try {
    localStorage.setItem(camKey(id), JSON.stringify(c));
  } catch {
    /* 存不了就算了 */
  }
}
type Target = { shape: string; side: Side | null };

export function DrawView(props: { docId: string; title: string; value: string; onChange: (json: string) => void }) {
  const { docId, onChange } = props;
  const rootRef = useRef<HTMLDivElement>(null);

  /* ─── 內容與復原 ─── */

  const [diagram, setDiagramState] = useState<Diagram>(() => parseDiagram(props.value));
  const dRef = useRef(diagram);
  const lastJson = useRef(props.value);
  const history = useRef<{ past: Diagram[]; future: Diagram[] }>({ past: [], future: [] });
  useEffect(() => {
    if (props.value !== lastJson.current) {
      lastJson.current = props.value;
      const d = parseDiagram(props.value);
      dRef.current = d;
      setDiagramState(d);
    }
  }, [props.value]);
  const write = useCallback(
    (next: Diagram) => {
      dRef.current = next;
      setDiagramState(next);
      const j = serializeDiagram(next);
      lastJson.current = j;
      onChange(j);
    },
    [onChange],
  );
  const checkpoint = () => {
    const h = history.current;
    h.past.push(dRef.current);
    if (h.past.length > 200) h.past.shift();
    h.future = [];
  };
  /** 改圖表；record=false 是拖曳中途（開始時已經記過復原點）。 */
  const apply = (next: Diagram, record = true) => {
    if (next === dRef.current) return;
    if (record) checkpoint();
    write(next);
  };
  const undo = (redo: boolean) => {
    const h = history.current;
    const from = redo ? h.future : h.past;
    const to = redo ? h.past : h.future;
    const d = from.pop();
    if (!d) return;
    to.push(dRef.current);
    write(d);
  };

  /* ─── 選取 ─── */

  const [selRaw, setSelState] = useState<string[]>([]);
  const selRef = useRef(selRaw);
  const setSel = (ids: string[]) => {
    selRef.current = ids;
    setSelState(ids);
  };
  const map = useMemo(() => shapeMap(diagram), [diagram]);
  const edgeIds = useMemo(() => new Set(diagram.edges.map((e) => e.id)), [diagram.edges]);
  const sel = useMemo(() => selRaw.filter((id) => map.has(id) || edgeIds.has(id)), [selRaw, map, edgeIds]);
  const selSet = useMemo(() => new Set(sel), [sel]);
  const selShapes = diagram.shapes.filter((s) => selSet.has(s.id));
  const selEdges = diagram.edges.filter((e) => selSet.has(e.id));

  /* ─── 畫面 ─── */

  const [cam, setCamState] = useState<Camera>(() => loadCam(docId) ?? { x: 80, y: 80, zoom: 1 });
  const camRef = useRef(cam);
  const setCam = useCallback((c: Camera) => {
    camRef.current = c;
    setCamState(c);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => saveCam(docId, cam), 300);
    return () => clearTimeout(t);
  }, [docId, cam]);
  const viewport = () => {
    const r = rootRef.current?.getBoundingClientRect();
    return { left: r?.left ?? 0, top: r?.top ?? 0, w: r?.width ?? 800, h: r?.height ?? 600 };
  };
  const world = (clientX: number, clientY: number) => {
    const v = viewport();
    return toWorld(camRef.current, clientX - v.left, clientY - v.top);
  };
  const fit = () => {
    const v = viewport();
    setCam(fitCamera(contentBounds(dRef.current), v.w, v.h));
  };
  useLayoutEffect(() => {
    if (!loadCam(docId)) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const zoomBy = (f: number) => {
    const v = viewport();
    setCam(zoomAt(camRef.current, camRef.current.zoom * f, v.w / 2, v.h / 2));
  };

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest?.(".board-ui, .board-menu")) return;
      e.preventDefault();
      const v = el.getBoundingClientRect();
      const c = camRef.current;
      if (e.ctrlKey || e.metaKey) {
        const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
        setCam(zoomAt(c, c.zoom * f, e.clientX - v.left, e.clientY - v.top));
        return;
      }
      const k = e.deltaMode === 1 ? 16 : 1;
      const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k;
      const dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k;
      setCam({ ...c, x: c.x - dx, y: c.y - dy });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [setCam]);

  // 按住 Alt 量距離（參考 Figma）
  const [altDown, setAltDown] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Alt" && e.target === rootRef.current) {
        e.preventDefault();
        setAltDown(true);
      }
    };
    const up = (e: KeyboardEvent) => e.key === "Alt" && setAltDown(false);
    const blur = () => setAltDown(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);
  /** Alt 量距離時滑過的圖形（畫板也算） */
  const [altHover, setAltHover] = useState<string | null>(null);

  // 按住空白鍵拖曳平移
  const [spaceDown, setSpaceDown] = useState(false);
  const spaceRef = useRef(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && e.target === rootRef.current) {
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
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  /* ─── 拖曳中的狀態 ─── */

  const dragRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [panning, setPanning] = useState(false);
  const [box, setBox] = useState<Rect | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  /** 拖曳時的距離與等距標記 */
  const [measures, setMeasures] = useState<Measure[]>([]);
  /** 對齊用的其他圖形：不含自己、跟著搬的畫板內容與藏起來的 */
  const snapTargets = (exclude: Set<string>) =>
    dRef.current.shapes.filter((s) => !exclude.has(s.id) && !s.hidden && !(s.parent && exclude.has(s.parent))).map(rectOf);
  const [link, setLink] = useState<{ from: End; to: End } | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; typed?: boolean } | null>(null);
  /** 直接打字開始編輯：文字框出現之前打的字先記在這裡 */
  const typed = useRef<string | null>(null);
  // 不在讀的時候清掉（開發模式的 StrictMode 會跑兩次 effect），編輯結束才清
  const takeTyped = () => typed.current;
  /** 圖形選單：at 是要放的位置（沒有就是工具列打開的：點了放在畫面中央，也可以拖到畫布上）；edge 是要接上的連線 */
  const [quick, setQuick] = useState<{ x: number; y: number; at?: Pt; edge?: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; at: Pt; item: boolean } | null>(null);
  /** 目前的工具：在畫布上拖出這種圖形（null 是選取） */
  const [tool, setTool] = useState<ShapeKind | null>(null);
  const [frameMenu, setFrameMenu] = useState<{ x: number; y: number } | null>(null);
  const [layers, setLayers] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [ghost, setGhost] = useState<{ kind: ShapeKind; x: number; y: number } | null>(null);

  const track = (move: (ev: PointerEvent) => void, up: (ev: PointerEvent) => void) => {
    dragRef.current = true;
    const mv = (ev: PointerEvent) => move(ev);
    const u = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", u);
      window.removeEventListener("pointercancel", u);
      dragRef.current = false;
      up(ev);
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", u);
    window.addEventListener("pointercancel", u);
  };

  /** 指標下最上面的圖形（連線要接的目標）；靠近邊的中點就固定接那一邊。 */
  const targetAt = (p: Pt, exclude?: string): Target | null => {
    const d = dRef.current;
    const z = camRef.current.zoom;
    const tol = 6 / z;
    for (let i = d.shapes.length - 1; i >= 0; i--) {
      const s = d.shapes[i];
      if (s.id === exclude || s.hidden || s.locked || s.kind === "frame") continue;
      if (p.x >= s.x - tol && p.x <= s.x + s.w + tol && p.y >= s.y - tol && p.y <= s.y + s.h + tol)
        return { shape: s.id, side: nearSide(s, p, 14 / z) };
    }
    return null;
  };

  const focusRoot = () => rootRef.current?.focus({ preventScroll: true });

  const startPan = (e: React.PointerEvent) => {
    const c0 = camRef.current;
    const x0 = e.clientX;
    const y0 = e.clientY;
    setPanning(true);
    track(
      (ev) => setCam({ ...c0, x: c0.x + ev.clientX - x0, y: c0.y + ev.clientY - y0 }),
      () => setPanning(false),
    );
  };

  const startResize = (e: React.PointerEvent, s: Shape, h: Handle) => {
    const base = rectOf(s);
    const others = snapTargets(new Set([s.id]));
    const p0 = world(e.clientX, e.clientY);
    let started = false;
    track(
      (ev) => {
        const p = world(ev.clientX, ev.clientY);
        let r = resizeRect(base, h, p.x - p0.x, p.y - p0.y, ev.shiftKey);
        const z = camRef.current.zoom;
        let gs: Guide[] = [];
        let ms: Measure[] = [];
        if (!ev.altKey && !ev.shiftKey) {
          const sr = snapResizeGrid(r, base, h, others, 6 / z, dRef.current.grid ? GRID : null, MIN_SIZE);
          r = sr.rect;
          gs = sr.guides;
          ms = sr.measures;
        }
        setGuides(gs);
        setMeasures(ms);
        if (!started) {
          checkpoint();
          started = true;
          setDragging(true);
        }
        apply(setRect(dRef.current, s.id, r), false);
      },
      () => {
        setDragging(false);
        setGuides([]);
        setMeasures([]);
      },
    );
  };

  const startMove = (e: React.PointerEvent, ids: string[], onClick: () => void) => {
    const base = dRef.current;
    const set = new Set(ids);
    const moving = base.shapes.filter((s) => set.has(s.id));
    const bb = boundsOf(moving.map(rectOf));
    const others = snapTargets(new Set(withChildren(ids)));
    const x0 = e.clientX;
    const y0 = e.clientY;
    let started = false;
    track(
      (ev) => {
        if (!started && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
        if (!started) {
          checkpoint();
          started = true;
          setDragging(true);
        }
        const z = camRef.current.zoom;
        let dx = (ev.clientX - x0) / z;
        let dy = (ev.clientY - y0) / z;
        let gs: Guide[] = [];
        let ms: Measure[] = [];
        if (bb && !ev.altKey) {
          // 先對齊邊與中線或等距（取比較近的），都沒有才對齊格線
          const r = snapMove(bb, dx, dy, others, 6 / z, base.grid ? GRID : null);
          dx = r.dx;
          dy = r.dy;
          gs = r.guides;
          ms = r.measures;
        }
        setGuides(gs);
        setMeasures(ms);
        apply(moveItems(base, ids, dx, dy), false);
      },
      () => {
        setGuides([]);
        setMeasures([]);
        setDragging(false);
        if (!started) onClick();
        else apply(reparent(dRef.current, withChildren(ids)), false);
      },
    );
  };

  /** 從圖形旁的箭頭拉出連線；沒有拖就在那一邊複製一個並連起來。 */
  const startLink = (e: React.PointerEvent, sid: string, side: Side) => {
    const from: End = { shape: sid, side };
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    track(
      (ev) => {
        if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
        if (!moved) setDragging(true);
        moved = true;
        const p = world(ev.clientX, ev.clientY);
        const tg = targetAt(p, sid);
        setTarget(tg);
        setLink({ from, to: tg ?? { x: p.x, y: p.y } });
      },
      (ev) => {
        setLink(null);
        setTarget(null);
        setDragging(false);
        if (!moved) {
          const r = cloneTo(dRef.current, sid, side);
          if (r) {
            apply(r.diagram);
            setSel([r.id]);
          }
          return;
        }
        const p = world(ev.clientX, ev.clientY);
        const tg = targetAt(p, sid);
        const r = addEdge(dRef.current, from, tg ?? { x: p.x, y: p.y });
        apply(r.diagram);
        setSel([r.id]);
        // 放在空白處：像 draw.io 一樣問要接哪種圖形
        if (!tg) {
          const v = viewport();
          setQuick({ x: ev.clientX - v.left, y: ev.clientY - v.top, at: p, edge: r.id });
        }
      },
    );
  };

  /** 拖連線的一端改接。 */
  const startEndpoint = (eid: string, which: "from" | "to") => {
    let started = false;
    track(
      (ev) => {
        const edge = dRef.current.edges.find((x) => x.id === eid);
        if (!edge) return;
        const other = which === "from" ? edge.to : edge.from;
        const p = world(ev.clientX, ev.clientY);
        const tg = targetAt(p, "shape" in other ? other.shape : undefined);
        setTarget(tg);
        if (!started) {
          checkpoint();
          started = true;
          setDragging(true);
        }
        const end: End = tg ?? { x: p.x, y: p.y };
        apply(patchEdges(dRef.current, [eid], (x) => ({ ...x, [which]: end })), false);
      },
      () => {
        setTarget(null);
        setDragging(false);
      },
    );
  };

  /** 用工具在畫布上拖出一個圖形（點一下是預設大小）。 */
  const startCreate = (e: React.PointerEvent, kind: ShapeKind) => {
    const p0 = world(e.clientX, e.clientY);
    const grid = dRef.current.grid && !e.altKey;
    const a = grid ? { x: snap(p0.x), y: snap(p0.y) } : p0;
    let r: Rect | null = null;
    track(
      (ev) => {
        let p = world(ev.clientX, ev.clientY);
        if (grid && !ev.altKey) p = { x: snap(p.x), y: snap(p.y) };
        let w = Math.abs(p.x - a.x);
        let h = Math.abs(p.y - a.y);
        if (ev.shiftKey) w = h = Math.max(w, h);
        r = { x: p.x < a.x ? a.x - w : a.x, y: p.y < a.y ? a.y - h : a.y, w, h };
        setBox(r);
      },
      () => {
        setBox(null);
        setTool(null);
        const big = r && r.w >= 4 && r.h >= 4 ? r : null;
        const info = SHAPE_INFO[kind];
        let made: { diagram: Diagram; id: string };
        if (kind === "frame") {
          made = big
            ? addFrame(dRef.current, { label: "Frame", w: Math.max(MIN_SIZE, big.w), h: Math.max(MIN_SIZE, big.h) }, big)
            : addFrame(dRef.current, { label: "Frame", w: 100, h: 100 }, a);
        } else {
          const rr = big ?? { x: a.x - info.w / 2, y: a.y - info.h / 2, w: info.w, h: info.h };
          made = addShape(dRef.current, kind, rr.x, rr.y, { w: Math.max(MIN_SIZE, rr.w), h: Math.max(MIN_SIZE, rr.h), text: "" });
        }
        apply(reparent(made.diagram, [made.id]));
        setSel([made.id]);
        focusRoot();
        if (kind === "text") setEditing({ id: made.id });
      },
    );
  };

  const withChildren = (ids: string[]) => {
    const set = new Set(ids);
    for (const s of dRef.current.shapes) if (s.parent && set.has(s.parent)) set.add(s.id);
    return [...set];
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const t = e.target as Element;
    if (t.closest(".board-ui, .dw-edit, .board-menu")) return;
    focusRoot();
    setQuick(null);
    setMenu(null);
    if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
      e.preventDefault();
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    setFrameMenu(null);
    if (tool) {
      startCreate(e, tool);
      return;
    }
    const hEl = t.closest("[data-handle]");
    if (hEl) {
      const s = dRef.current.shapes.find((x) => x.id === hEl.getAttribute("data-of"));
      if (s) startResize(e, s, hEl.getAttribute("data-handle") as Handle);
      return;
    }
    const cEl = t.closest("[data-conn]");
    if (cEl) {
      startLink(e, cEl.getAttribute("data-of")!, cEl.getAttribute("data-conn") as Side);
      return;
    }
    const epEl = t.closest("[data-endpoint]");
    if (epEl) {
      startEndpoint(epEl.getAttribute("data-of")!, epEl.getAttribute("data-endpoint") as "from" | "to");
      return;
    }
    let hit = t.closest("[data-shape]")?.getAttribute("data-shape") ?? t.closest("[data-edge]")?.getAttribute("data-edge");
    // 有內容的畫板：在空白處拖曳是框選，點一下才選畫板（名稱列一律是選畫板）
    let frameClick: string | null = null;
    const hitShape = hit ? dRef.current.shapes.find((x) => x.id === hit) : undefined;
    if (hitShape?.kind === "frame" && !t.closest(".dw-frame-title") && dRef.current.shapes.some((x) => x.parent === hitShape.id && !x.hidden)) {
      frameClick = hitShape.id;
      hit = null;
    }
    if (hit) {
      const mod = e.shiftKey || e.ctrlKey || e.metaKey;
      const unit = withGroups(dRef.current, [hit]);
      let cur = selRef.current;
      if (mod) {
        cur = cur.includes(hit) ? cur.filter((x) => !unit.includes(x)) : [...new Set([...cur, ...unit])];
        setSel(cur);
        if (!cur.includes(hit)) return;
      } else if (!cur.includes(hit)) {
        cur = unit;
        setSel(cur);
      }
      startMove(e, cur, () => {
        if (!mod && selRef.current.length > unit.length) setSel(unit);
      });
      return;
    }
    // 空白處：框選
    const p0 = world(e.clientX, e.clientY);
    const keep = e.shiftKey || e.ctrlKey || e.metaKey ? selRef.current : [];
    if (!keep.length) setSel([]);
    let moved = false;
    track(
      (ev) => {
        moved = true;
        const p = world(ev.clientX, ev.clientY);
        const r = { x: Math.min(p0.x, p.x), y: Math.min(p0.y, p.y), w: Math.abs(p.x - p0.x), h: Math.abs(p.y - p0.y) };
        setBox(r);
        // 在畫板裡框選不選到畫板本身
        const found = itemsIn(dRef.current, r).filter((id) => id !== frameClick);
        setSel([...new Set([...keep, ...withGroups(dRef.current, found)])]);
      },
      () => {
        setBox(null);
        if (!moved && frameClick) setSel([frameClick]);
      },
    );
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragRef.current) return;
    const p = world(e.clientX, e.clientY);
    lastPointer.current = p;
    const d = dRef.current;
    const z = camRef.current.zoom;
    const inside = (s: Shape, pad: number) => p.x >= s.x - pad && p.x <= s.x + s.w + pad && p.y >= s.y - pad && p.y <= s.y + s.h + pad;
    let found: string | null = null;
    for (let i = d.shapes.length - 1; i >= 0 && !found; i--) {
      const s = d.shapes[i];
      if (!s.hidden && !s.locked && s.kind !== "frame" && inside(s, 0)) found = s.id;
    }
    // 離開圖形一點點還留著圓點，才點得到
    if (!found && hover) {
      const s = d.shapes.find((x) => x.id === hover);
      if (s && inside(s, 12 / z)) found = hover;
    }
    if (found !== hover) setHover(found);
    let any: string | null = null;
    for (let i = d.shapes.length - 1; i >= 0 && !any; i--) {
      const s = d.shapes[i];
      if (!s.hidden && inside(s, 0)) any = s.id;
    }
    if (any !== altHover) setAltHover(any);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const t = e.target as Element;
    if (t.closest(".board-ui, .dw-edit, .board-menu, [data-conn], [data-handle], [data-endpoint]")) return;
    const id = t.closest("[data-shape]")?.getAttribute("data-shape") ?? t.closest("[data-edge]")?.getAttribute("data-edge");
    const isFrameBody = id && map.get(id)?.kind === "frame" && !t.closest(".dw-frame-title");
    if (id && !isFrameBody && map.get(id)?.kind !== "image") {
      setSel([id]);
      setEditing({ id });
      return;
    }
    if (id && !isFrameBody) return;
    const v = viewport();
    setQuick({ x: e.clientX - v.left, y: e.clientY - v.top, at: world(e.clientX, e.clientY) });
  };

  /* ─── 新增 ─── */

  const addAt = (kind: ShapeKind, c: Pt) => {
    const info = SHAPE_INFO[kind];
    let x = c.x - info.w / 2;
    let y = c.y - info.h / 2;
    if (dRef.current.grid) {
      x = snap(x);
      y = snap(y);
    }
    const r = addShape(dRef.current, kind, x, y);
    apply(reparent(r.diagram, [r.id]));
    setSel([r.id]);
    focusRoot();
    return r.id;
  };

  /** 加一張圖片（原始大小，最寬 480），放在 c（白板座標）的中央。 */
  const addImage = async (file: File, c?: Pt) => {
    try {
      const src = await saveMedia(file);
      const size = await new Promise<{ w: number; h: number }>((ok) => {
        const img = new Image();
        img.onload = () => ok({ w: img.naturalWidth || 240, h: img.naturalHeight || 160 });
        img.onerror = () => ok({ w: 240, h: 160 });
        img.src = mediaUrl(src);
      });
      const k = Math.min(1, 480 / size.w);
      const w = Math.round(size.w * k);
      const h = Math.round(size.h * k);
      const v = viewport();
      const at = c ?? toWorld(camRef.current, v.w / 2, v.h / 2);
      const r = addShape(dRef.current, "image", Math.round(at.x - w / 2), Math.round(at.y - h / 2), {
        w,
        h,
        src,
        name: file.name.replace(/\.[^.]+$/, "") || undefined,
      });
      apply(reparent(r.diagram, [r.id]));
      setSel([r.id]);
      focusRoot();
    } catch (err) {
      setToast(`Couldn't add the image: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if ((e.target as Element).closest(".dw-edit, input, textarea")) return;
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault();
    const v = viewport();
    const at = lastPointer.current ?? toWorld(camRef.current, v.w / 2, v.h / 2);
    files.forEach((f, i) => void addImage(f, { x: at.x + i * 24, y: at.y + i * 24 }));
  };
  const lastPointer = useRef<Pt | null>(null);

  /** 匯出一個畫板（PNG 或網頁），存到下載資料夾。 */
  const exportFrame = async (id: string, format: "png" | "html") => {
    const d = dRef.current;
    const f = d.shapes.find((s) => s.id === id);
    if (!f) return;
    try {
      const name = `${(props.title.trim() || "Diagram") + " - " + (f.text.trim() || "Frame")}.${format}`;
      const bytes = format === "png" ? await toPng(d, 2, id) : new TextEncoder().encode(toHtml(d, f.text || props.title, await loadImages(d), id));
      const path = await saveExport(name, bytes);
      setToast(path ? `Saved to ${path}` : `Downloaded ${name}`);
    } catch (err) {
      setToast(`Couldn't export: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  /** 複製成圖片（PNG）：選取的項目（一個畫板就是那個畫板），沒有選取就是整張圖。 */
  const copyImage = (ids: string[]) => {
    const d = dRef.current;
    const pick = ids.length ? selectionDiagram(d, ids) : { diagram: d };
    if (!renderOrder(pick.diagram).length) return;
    copyPng(() => pngBlob(pick.diagram, 2, pick.only)).then(
      () => setToast(ids.length ? "Copied selection as image" : "Copied diagram as image"),
      (err) => setToast(`Couldn't copy: ${err instanceof Error ? err.message : String(err)}`),
    );
  };
  /** 加在畫面中央（已經有圖形在同一個位置就往右下錯開）。 */
  const addCenter = (kind: ShapeKind) => {
    const v = viewport();
    const c = toWorld(camRef.current, v.w / 2, v.h / 2);
    const info = SHAPE_INFO[kind];
    let at = { ...c };
    for (let i = 0; i < 30; i++) {
      const x = snap(at.x - info.w / 2);
      const y = snap(at.y - info.h / 2);
      if (!dRef.current.shapes.some((s) => Math.abs(s.x - x) < 5 && Math.abs(s.y - y) < 5)) break;
      at = { x: at.x + 20, y: at.y + 20 };
    }
    addAt(kind, at);
  };

  const pickQuick = (kind: ShapeKind) => {
    const q = quick;
    setQuick(null);
    if (!q) return;
    if (!q.at) return addCenter(kind);
    if (!q.edge) {
      addAt(kind, q.at);
      return;
    }
    // 連線的自由端：在那裡放一個圖形並接上
    const info = SHAPE_INFO[kind];
    const edge = dRef.current.edges.find((x) => x.id === q.edge);
    let x = snap(q.at.x - info.w / 2);
    let y = snap(q.at.y - info.h / 2);
    if (edge && "shape" in edge.from && edge.from.side) {
      // 從固定的邊拉出來：新圖形對齊來源的中線，連線才是直的
      const src = dRef.current.shapes.find((s) => "shape" in edge.from && s.id === edge.from.shape);
      const n = NORMAL[edge.from.side];
      if (src && n.x === 0) {
        x = src.x + src.w / 2 - info.w / 2;
        y = n.y > 0 ? snap(q.at.y) : snap(q.at.y - info.h);
      } else if (src) {
        y = src.y + src.h / 2 - info.h / 2;
        x = n.x > 0 ? snap(q.at.x) : snap(q.at.x - info.w);
      }
    }
    const r = addShape(dRef.current, kind, x, y);
    const linked = edge ? patchEdges(r.diagram, [edge.id], (x) => ({ ...x, to: { shape: r.id, side: null } })) : r.diagram;
    apply(linked);
    setSel([r.id]);
    focusRoot();
  };

  const startLibDrag = (e: React.PointerEvent, kind: ShapeKind) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    track(
      (ev) => {
        if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
        moved = true;
        setGhost({ kind, x: ev.clientX, y: ev.clientY });
      },
      (ev) => {
        setGhost(null);
        setQuick(null);
        if (!moved) return addCenter(kind);
        const v = viewport();
        if (ev.clientX >= v.left && ev.clientX <= v.left + v.w && ev.clientY >= v.top && ev.clientY <= v.top + v.h)
          addAt(kind, world(ev.clientX, ev.clientY));
      },
    );
  };

  /* ─── 文字 ─── */

  const commitText = (id: string, text: string | null) => {
    typed.current = null;
    setEditing(null);
    focusRoot();
    if (text === null) return;
    const d = dRef.current;
    if (d.shapes.some((s) => s.id === id)) {
      const s = d.shapes.find((x) => x.id === id);
      if (s && s.text !== text) apply(patchShapes(d, [id], (x) => ({ ...x, text })));
    } else {
      const e = d.edges.find((x) => x.id === id);
      if (e && e.label !== text) apply(patchEdges(d, [id], (x) => ({ ...x, label: text })));
    }
  };

  /* ─── 右鍵選單 ─── */

  const onContextMenu = (e: React.MouseEvent) => {
    const t = e.target as Element;
    if (t.closest(".board-ui, .board-menu, .dw-edit")) return;
    e.preventDefault();
    setQuick(null);
    const v = viewport();
    const id = t.closest("[data-shape]")?.getAttribute("data-shape") ?? t.closest("[data-edge]")?.getAttribute("data-edge");
    if (id && !selRef.current.includes(id)) setSel([id]);
    if (!id) setSel([]);
    setMenu({ x: e.clientX - v.left, y: e.clientY - v.top, at: world(e.clientX, e.clientY), item: !!id });
  };

  /* ─── 鍵盤 ─── */

  const removeSel = () => apply(removeItems(dRef.current, selRef.current));
  const copySel = () => {
    if (!selRef.current.length) return;
    clipboard = copyItems(dRef.current, selRef.current);
    pasteCount = 0;
  };
  const paste = () => {
    if (!clipboard || (!clipboard.shapes.length && !clipboard.edges.length)) return;
    pasteCount++;
    const r = pasteClip(dRef.current, clipboard, GRID * 2 * pasteCount, GRID * 2 * pasteCount);
    apply(r.diagram);
    setSel(r.ids);
  };
  const duplicate = () => {
    if (!selRef.current.length) return;
    const r = pasteClip(dRef.current, copyItems(dRef.current, selRef.current), GRID * 2, GRID * 2);
    apply(r.diagram);
    setSel(r.ids);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t !== rootRef.current) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const ids = selRef.current;
    const one = ids.length === 1 ? ids[0] : null;
    const plain = !ctrl && !e.altKey && !e.shiftKey && !e.nativeEvent.isComposing;
    if (e.key === "Delete" || e.key === "Backspace") removeSel();
    else if (plain && k === "r") setTool("rect");
    else if (plain && k === "o") setTool("ellipse");
    else if (plain && k === "t") setTool("text");
    else if (plain && k === "f") setTool("frame");
    else if (plain && k === "v") setTool(null);
    else if (ctrl && e.shiftKey && k === "g") apply(ungroupItems(dRef.current, ids));
    else if (ctrl && k === "g") apply(groupItems(dRef.current, ids).diagram);
    else if (ctrl && e.shiftKey && k === "h") {
      const hide = !dRef.current.shapes.find((x) => ids.includes(x.id))?.hidden;
      apply(patchShapes(dRef.current, ids, (x) => ({ ...x, hidden: hide || undefined })));
      if (hide) setSel([]);
    } else if (ctrl && e.shiftKey && k === "l") {
      const lock = !dRef.current.shapes.find((x) => ids.includes(x.id))?.locked;
      apply(patchShapes(dRef.current, ids, (x) => ({ ...x, locked: lock || undefined })));
      if (lock) setSel([]);
    }
    else if (ctrl && !e.altKey && (k === "z" || k === "y")) undo(k === "y" || e.shiftKey);
    else if (ctrl && k === "a") setSel([...dRef.current.shapes.map((s) => s.id), ...dRef.current.edges.map((x) => x.id)]);
    else if (ctrl && e.shiftKey && k === "c") copyImage(ids);
    else if (ctrl && k === "c") copySel();
    else if (ctrl && k === "x") {
      copySel();
      removeSel();
    } else if (ctrl && k === "v") paste();
    else if (ctrl && k === "d") duplicate();
    else if (ctrl && e.shiftKey && k === "f") apply(reorder(dRef.current, ids, true));
    else if (ctrl && e.shiftKey && k === "b") apply(reorder(dRef.current, ids, false));
    else if (ctrl && k === "b") {
      const s = dRef.current.shapes.find((x) => ids.includes(x.id));
      if (s) apply(setShapeStyle(dRef.current, ids, { weight: s.style.weight >= 600 ? 400 : 700 }));
    } else if (ctrl && k === "i") {
      const s = dRef.current.shapes.find((x) => ids.includes(x.id));
      if (s) apply(setShapeStyle(dRef.current, ids, { italic: !s.style.italic }));
    } else if (ctrl && (k === "=" || k === "+")) zoomBy(1.2);
    else if (ctrl && k === "-") zoomBy(1 / 1.2);
    else if (ctrl && k === "0") {
      const v = viewport();
      setCam(zoomAt(camRef.current, 1, v.w / 2, v.h / 2));
    } else if (e.shiftKey && e.code === "Digit1") fit();
    else if (e.key.startsWith("Arrow") && ids.length) {
      const step = e.shiftKey ? GRID : 1;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      apply(moveItems(dRef.current, ids, dx, dy));
    } else if ((e.key === "Enter" || e.key === "F2") && one) setEditing({ id: one });
    else if (e.key === "Escape") {
      if (tool) setTool(null);
      else setSel([]);
      setQuick(null);
      setMenu(null);
      setFrameMenu(null);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  /* ─── 畫面 ─── */

  const z = cam.zoom;
  const order = useMemo(() => renderOrder(diagram), [diagram]);
  const geos = useMemo(() => new Map(diagram.edges.map((e) => [e.id, edgeGeometry(e, map)])), [diagram.edges, map]);
  const single = selShapes.length === 1 && selEdges.length === 0 ? selShapes[0] : null;
  const singleEdge = selEdges.length === 1 && selShapes.length === 0 ? selEdges[0] : null;
  const busy = dragging || !!editing || spaceDown || !!link || !!tool;
  // 藍色圓點：滑過的圖形，或唯一選取的圖形（畫板沒有）
  const dotCandidate = (hover ? map.get(hover) : undefined) ?? single ?? undefined;
  const dotShape = busy || dotCandidate?.kind === "frame" || dotCandidate?.locked ? undefined : dotCandidate;
  const linkGeo = useMemo(() => {
    if (!link) return null;
    const e: Edge = { id: "__link", from: link.from, to: link.to, label: "", style: defaultEdgeStyle() };
    return edgeGeometry(e, map);
  }, [link, map]);
  const targetShape = target ? map.get(target.shape) : undefined;
  const dotGap = GRID * 2 * z;
  const showGrid = diagram.grid && dotGap >= 6;
  const bar = sel.length > 0 && !editing && !tool;
  // 選取後按住 Alt：量到滑過的圖形，沒有就量到所在的畫板
  const altMeasures = useMemo(() => {
    if (!altDown || dragging || !selShapes.length) return [];
    const box = boundsOf(selShapes.map(rectOf));
    if (!box) return [];
    const other = altHover && !selSet.has(altHover) ? map.get(altHover) : undefined;
    const parent = selShapes[0].parent && selShapes.every((s) => s.parent === selShapes[0].parent) ? map.get(selShapes[0].parent) : undefined;
    const t = other ?? parent;
    return t ? measureBetween(box, rectOf(t)) : [];
  }, [altDown, dragging, selShapes, altHover, selSet, map]);
  const clipId = (id: string) => `dwclip-${docId}-${id}`;
  const below = (e: React.MouseEvent) => {
    const v = viewport();
    const r = e.currentTarget.getBoundingClientRect();
    return { x: r.left - v.left, y: r.bottom - v.top + 6 };
  };

  // SVG：畫板後面接著它裡面的圖形（裁在畫板裡、淺色主題）
  const svgShapes: React.ReactNode[] = [];
  for (let i = 0; i < order.length; i++) {
    const s = order[i];
    if (s.kind !== "frame") {
      svgShapes.push(<ShapeG key={s.id} s={s} />);
      continue;
    }
    const kids: Shape[] = [];
    while (order[i + 1]?.parent === s.id) kids.push(order[++i]);
    svgShapes.push(
      <g key={s.id} className="dw-light">
        <ShapeG s={s} />
        {kids.length > 0 && (
          <>
            <clipPath id={clipId(s.id)}>
              <path transform={`translate(${s.x} ${s.y})`} d={shapePath("frame", s.w, s.h, radiusOf(s))} />
            </clipPath>
            <g clipPath={`url(#${clipId(s.id)})`}>
              {kids.map((k) => (
                <ShapeG key={k.id} s={k} />
              ))}
            </g>
          </>
        )}
      </g>,
    );
  }

  const textOfShape = (s: Shape, ox: number, oy: number) => {
    const isEditing = editing?.id === s.id;
    if (s.kind === "image" || (!s.text && !isEditing)) return null;
    const tb = textBox(s.kind, s.w, s.h);
    return (
      <div
        key={s.id}
        className={`dw-text v-${s.style.valign}${isEditing ? " editing" : ""}`}
        style={{
          left: s.x - ox + tb.x,
          top: s.y - oy + tb.y,
          width: tb.w,
          height: tb.h,
          fontFamily: s.style.font ? `"${s.style.font}", var(--ed-font)` : undefined,
          fontSize: s.style.size,
          fontWeight: s.style.weight,
          fontStyle: s.style.italic ? "italic" : undefined,
          lineHeight: s.style.lineHeight,
          letterSpacing: s.style.spacing || undefined,
          color: textCss(s.style.color),
          textAlign: s.style.align,
          opacity: s.style.opacity < 1 ? s.style.opacity : undefined,
        }}
      >
        {isEditing ? <EditBox initial={s.text} seed={editing.typed ? takeTyped : undefined} onDone={(t) => commitText(s.id, t)} /> : <div className="dw-text-in">{s.text}</div>}
      </div>
    );
  };
  const labels: React.ReactNode[] = [];
  for (let i = 0; i < order.length; i++) {
    const s = order[i];
    if (s.kind !== "frame") {
      labels.push(textOfShape(s, 0, 0));
      continue;
    }
    const kids: Shape[] = [];
    while (order[i + 1]?.parent === s.id) kids.push(order[++i]);
    const naming = editing?.id === s.id;
    labels.push(
      <div
        key={`t-${s.id}`}
        className={`dw-frame-title${selSet.has(s.id) ? " on" : ""}`}
        data-shape={s.id}
        style={{ left: s.x, top: s.y, fontSize: 12 / z, maxWidth: s.w }}
        title="Drag to move the frame · double-click to rename"
      >
        {naming ? <EditBox initial={s.text} onDone={(t) => commitText(s.id, t)} /> : s.text || "Frame"}
      </div>,
    );
    if (kids.length)
      labels.push(
        <div key={`c-${s.id}`} className="dw-frame-clip dw-light" style={{ left: s.x, top: s.y, width: s.w, height: s.h, borderRadius: radiusOf(s) }}>
          {kids.map((k) => textOfShape(k, s.x, s.y))}
        </div>,
      );
  }

  return (
    <div
      ref={rootRef}
      className={`board dw-stage no-box${spaceDown || panning ? " panning" : ""}${panning ? " grabbing" : ""}${dragging ? " dragging" : ""}${
        bar ? " has-mm-bar" : ""
      }${tool ? " dw-tool" : ""}`}
      tabIndex={0}
      style={
        showGrid
          ? { backgroundSize: `${dotGap}px ${dotGap}px`, backgroundPosition: `${cam.x}px ${cam.y}px` }
          : { backgroundImage: "none" }
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => !dragRef.current && setHover(null)}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onScroll={(e) => {
        const el = e.currentTarget;
        if (el.scrollLeft || el.scrollTop) {
          el.scrollLeft = 0;
          el.scrollTop = 0;
        }
      }}
    >
      <svg className="dw-svg">
        <g transform={`translate(${cam.x} ${cam.y}) scale(${z})`}>
          {svgShapes}
          {diagram.edges.map((e) => {
            const g = geos.get(e.id);
            if (!g) return null;
            const on = selSet.has(e.id);
            const color = on ? "var(--ed-accent)" : e.style.stroke === "default" || e.style.stroke === "none" ? "var(--draw-edge)" : strokeCss(e.style.stroke);
            return (
              <g key={e.id} data-edge={e.id} className={`dw-edge${on ? " on" : ""}`}>
                <path className="dw-edge-hit" d={g.hit} style={{ strokeWidth: Math.max(e.style.width + 8, 12 / z) }} />
                {on && <path className="dw-edge-glow" d={g.hit} style={{ strokeWidth: e.style.width + 6 / z }} />}
                <path d={g.path} className="dw-edge-line" style={{ stroke: color, strokeWidth: e.style.width, strokeDasharray: dashCss(e.style.dash, e.style.width) }} />
                {(
                  [
                    [e.style.start, g.start],
                    [e.style.end, g.end],
                  ] as const
                ).map(([a, end], i) => {
                  const h = arrowHead(a, end.tip, end.dir, e.style.width);
                  return h ? <path key={i} d={h.d} className="dw-edge-line" style={{ stroke: color, strokeWidth: e.style.width, fill: h.filled ? color : "none" }} /> : null;
                })}
              </g>
            );
          })}

          {/* 選取：和白板卡片一樣的藍框與光暈 */}
          {selShapes.map((s) => (
            <g key={s.id} className="dw-sel">
              <rect className="dw-sel-ring" x={s.x - 3 / z} y={s.y - 3 / z} width={s.w + 6 / z} height={s.h + 6 / z} rx={4 / z} />
              <rect className="dw-sel-line" x={s.x} y={s.y} width={s.w} height={s.h} />
            </g>
          ))}
          {single && !busy && !single.locked && (
            <g>
              {(["n", "s", "e", "w"] as Handle[]).map((h) => {
                const t = 8 / z;
                const r =
                  h === "n" || h === "s"
                    ? { x: single.x, y: (h === "n" ? single.y : single.y + single.h) - t / 2, w: single.w, h: t }
                    : { x: (h === "w" ? single.x : single.x + single.w) - t / 2, y: single.y, w: t, h: single.h };
                return <rect key={h} className="dw-side-handle" data-handle={h} data-of={single.id} x={r.x} y={r.y} width={r.w} height={r.h} style={{ cursor: CURSOR[h] }} />;
              })}
              {(["nw", "ne", "se", "sw"] as Handle[]).map((h) => {
                const p = handlePoint(single, h);
                const r = 4 / z;
                return (
                  <rect key={h} className="dw-handle" data-handle={h} data-of={single.id} x={p.x - r} y={p.y - r} width={r * 2} height={r * 2} rx={1.5 / z} style={{ cursor: CURSOR[h] }} />
                );
              })}
            </g>
          )}
          {single && !busy && single.kind !== "frame" && (
            <text className="dw-size" x={single.x + single.w / 2} y={single.y + single.h + 16 / z} fontSize={11 / z}>
              {Math.round(single.w)} × {Math.round(single.h)}
            </text>
          )}
          {singleEdge &&
            !busy &&
            (() => {
              const g = geos.get(singleEdge.id);
              if (!g) return null;
              return (["from", "to"] as const).map((w) => {
                const p = w === "from" ? g.start.tip : g.end.tip;
                return <circle key={w} className="dw-dot endpoint" data-endpoint={w} data-of={singleEdge.id} cx={p.x} cy={p.y} r={5 / z} />;
              });
            })()}

          {/* 連線的圓點（拖曳拉線，點一下複製一個並連起來） */}
          {dotShape &&
            SIDES.map((sd) => {
              const p = sidePoint(dotShape, sd);
              return (
                <g key={sd} data-conn={sd} data-of={dotShape.id} className="dw-conn">
                  <circle cx={p.x} cy={p.y} r={11 / z} className="dw-conn-hit" />
                  <circle cx={p.x} cy={p.y} r={5 / z} className="dw-dot" />
                </g>
              );
            })}

          {/* 拉連線、改接：目標圖形 */}
          {targetShape && (
            <g>
              <rect className="dw-target" x={targetShape.x - 3 / z} y={targetShape.y - 3 / z} width={targetShape.w + 6 / z} height={targetShape.h + 6 / z} rx={4 / z} />
              {SIDES.map((sd) => {
                const p = sidePoint(targetShape, sd);
                return <circle key={sd} className={`dw-dot port${target?.side === sd ? " on" : ""}`} cx={p.x} cy={p.y} r={5 / z} />;
              })}
            </g>
          )}
          {linkGeo && <path className="dw-link" d={linkGeo.hit} />}

          <AlignMarks guides={guides} measures={[...measures, ...altMeasures]} zoom={z} />
        </g>
      </svg>

      <div className="dw-labels" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${z})` }}>
        {labels}
        {diagram.edges.map((e) => {
          const isEditing = editing?.id === e.id;
          const g = geos.get(e.id);
          if (!g || (!e.label && !isEditing)) return null;
          return (
            <div
              key={e.id}
              data-edge={e.id}
              className={`dw-label${selSet.has(e.id) ? " on" : ""}${isEditing ? " editing" : ""}`}
              style={{ left: g.mid.x, top: g.mid.y, fontSize: e.style.size }}
            >
              {isEditing ? <EditBox initial={e.label} seed={editing.typed ? takeTyped : undefined} onDone={(t) => commitText(e.id, t)} /> : e.label}
            </div>
          );
        })}
      </div>

      {box && <div className={tool ? "dw-draft" : "board-box"} style={{ left: box.x * z + cam.x, top: box.y * z + cam.y, width: box.w * z, height: box.h * z }} />}

      {!diagram.shapes.length && !diagram.edges.length && !tool && (
        <div className="board-empty">
          <p className="be-title">Draw a diagram or design a page</p>
          <p className="be-hint">Add a frame to design a web page, or double-click anywhere for a shape and connect shapes with their blue dots.</p>
          <button className="be-btn board-ui" onClick={(e) => setFrameMenu(below(e))}>
            <FrameIcon /> Add a frame
          </button>
        </div>
      )}

      <div className="board-toolbar board-ui">
        <button
          className={frameMenu || tool === "frame" ? "on" : ""}
          onClick={(e) => {
            setQuick(null);
            setFrameMenu(frameMenu ? null : below(e));
          }}
          title="Add a frame for a web page (F to draw one)"
        >
          <FrameIcon /> <span>Frame</span>
        </button>
        <button
          className={quick && !quick.at ? "on" : ""}
          onClick={(e) => {
            setMenu(null);
            setFrameMenu(null);
            setQuick(quick && !quick.at ? null : below(e));
          }}
          title="Add a shape (R rectangle, O ellipse, or double-click the canvas)"
        >
          <ShapesIcon /> <span>Shape</span>
        </button>
        <button className={tool === "text" ? "on" : ""} onClick={() => setTool(tool === "text" ? null : "text")} title="Text (T): click or drag on the canvas">
          <TextIcon /> <span>Text</span>
        </button>
        <button onClick={() => fileRef.current?.click()} title="Add an image (or paste one)">
          <ImageIcon /> <span>Image</span>
        </button>
        <button onClick={() => addCenter("note")} title="Add a sticky note">
          <NoteIcon /> <span>Note</span>
        </button>
        <span className="bt-sep" />
        <button className={layers ? "on" : ""} onClick={() => setLayers(!layers)} title="Layers">
          <LayersIcon /> <span>Layers</span>
        </button>
        {sel.length > 0 && (
          <>
            <span className="bt-sep" />
            <span className="bt-count">{sel.length} selected</span>
            <button onClick={duplicate} title="Duplicate (Ctrl+D)">
              <CopyIcon />
            </button>
            <button onClick={removeSel} title="Delete (Delete)">
              <TrashIcon />
            </button>
          </>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          const v = viewport();
          const c = toWorld(camRef.current, v.w / 2, v.h / 2);
          files.forEach((f, i) => void addImage(f, { x: c.x + i * 24, y: c.y + i * 24 }));
        }}
      />
      <input
        ref={replaceRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const src = await saveMedia(f);
          apply(patchShapes(dRef.current, selRef.current, (s) => (s.kind === "image" ? { ...s, src } : s)));
        }}
      />

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
          {Math.round(z * 100)}%
        </button>
        <button onClick={() => zoomBy(1.2)} title="Zoom in (Ctrl+=)">
          <PlusIcon />
        </button>
        <button onClick={fit} title="Fit to screen (Shift+1)">
          <FitIcon />
        </button>
      </div>

      {!bar && (
        <div className="board-hint">
          {tool
            ? `Drag to draw ${tool === "frame" ? "a frame" : `a ${SHAPE_INFO[tool].label.toLowerCase()}`} (Shift for a square) · click for the default size · Esc to cancel`
            : "F frame · R rectangle · O ellipse · T text · drag a blue dot to connect · scroll to pan · Ctrl+scroll to zoom"}
        </div>
      )}

      {bar && (
        <DrawStyleBar shapes={selShapes} edges={selEdges} onApply={(fn) => apply(fn(dRef.current))} onReplaceImage={() => replaceRef.current?.click()} />
      )}

      {layers && (
        <LayersPanel
          diagram={diagram}
          sel={selSet}
          onSelect={(ids) => {
            setSel(ids);
            focusRoot();
          }}
          onApply={(fn) => apply(fn(dRef.current))}
          onClose={() => setLayers(false)}
        />
      )}

      {frameMenu && (
        <FrameMenu
          x={frameMenu.x}
          y={frameMenu.y}
          onClose={() => setFrameMenu(null)}
          onDraw={() => {
            setFrameMenu(null);
            setTool("frame");
            focusRoot();
          }}
          onPick={(p) => {
            setFrameMenu(null);
            const r = addFrame(dRef.current, p);
            apply(r.diagram);
            setSel([r.id]);
            const f = r.diagram.shapes.find((s) => s.id === r.id)!;
            const v = viewport();
            setCam(fitCamera({ x: f.x, y: f.y - 24, w: f.w, h: f.h + 24 }, v.w, v.h));
            focusRoot();
          }}
        />
      )}
      {quick && (
        <ShapeMenu
          x={quick.x}
          y={quick.y}
          title={quick.edge ? "Connect to" : "Shapes"}
          onPick={pickQuick}
          onDrag={quick.at ? undefined : startLibDrag}
          onClose={() => setQuick(null)}
        />
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          item={menu.item}
          count={sel.length}
          canEdit={!!(single || singleEdge) && single?.kind !== "image"}
          frame={single?.kind === "frame" ? single.id : null}
          grouped={selShapes.some((s) => s.group)}
          canGroup={selShapes.filter((s) => s.kind !== "frame").length > 1}
          canPaste={!!clipboard}
          grid={diagram.grid}
          onClose={() => setMenu(null)}
          act={(a) => {
            const at = menu.at;
            setMenu(null);
            focusRoot();
            const ids = selRef.current;
            if (a === "edit" && sel.length === 1) setEditing({ id: sel[0] });
            else if (a === "duplicate") duplicate();
            else if (a === "copy") copySel();
            else if (a === "copy-image") copyImage(ids);
            else if (a === "copy-all-image") copyImage([]);
            else if (a === "paste") paste();
            else if (a === "front") apply(reorder(dRef.current, ids, true));
            else if (a === "back") apply(reorder(dRef.current, ids, false));
            else if (a === "group") apply(groupItems(dRef.current, ids).diagram);
            else if (a === "ungroup") apply(ungroupItems(dRef.current, ids));
            else if (a === "hide") {
              apply(patchShapes(dRef.current, ids, (x) => ({ ...x, hidden: true })));
              setSel([]);
            } else if (a === "lock") {
              apply(patchShapes(dRef.current, ids, (x) => ({ ...x, locked: true })));
              setSel([]);
            } else if (a === "export-png" && single) void exportFrame(single.id, "png");
            else if (a === "export-html" && single) void exportFrame(single.id, "html");
            else if (a === "delete") removeSel();
            else if (a === "shape") setQuick({ x: menu.x, y: menu.y, at });
            else if (a === "frame") setFrameMenu({ x: menu.x, y: menu.y });
            else if (a === "all") setSel([...dRef.current.shapes.filter((s) => !s.hidden && !s.locked).map((s) => s.id), ...dRef.current.edges.map((x) => x.id)]);
            else if (a === "grid") apply({ ...dRef.current, grid: !dRef.current.grid });
            else if (a === "fit") fit();
          }}
        />
      )}
      {toast && (
        <div className="board-toast board-ui" role="status">
          {toast}
        </div>
      )}
      {ghost && (
        <svg className="dw-ghost" style={{ left: ghost.x, top: ghost.y }} width={SHAPE_INFO[ghost.kind].w * z + 4} height={SHAPE_INFO[ghost.kind].h * z + 4}>
          <path transform="translate(2 2)" d={shapePath(ghost.kind, SHAPE_INFO[ghost.kind].w * z, SHAPE_INFO[ghost.kind].h * z)} />
        </svg>
      )}
    </div>
  );
}

const dashCss = (d: Dash, w: number) => (d === "dashed" ? `${w * 4} ${w * 3}` : d === "dotted" ? `${w} ${w * 2}` : undefined);
const SHADOW_FILTER = {
  none: undefined,
  sm: "drop-shadow(0 1px 1.5px rgba(15, 15, 15, 0.12))",
  md: "drop-shadow(0 4px 6px rgba(15, 15, 15, 0.14))",
  lg: "drop-shadow(0 12px 16px rgba(15, 15, 15, 0.18))",
} as const;

/* ─── 一個圖形 ─── */

function ShapeG({ s }: { s: Shape }) {
  const st = s.style;
  const fill = s.kind === "actor" && st.fill === "default" ? "none" : fillCss(st.fill);
  const r = radiusOf(s);
  const custom = s.kind === "rounded" || st.radius !== null ? r : undefined;
  const style: React.CSSProperties = { opacity: st.opacity < 1 ? st.opacity : undefined, filter: SHADOW_FILTER[st.shadow] };
  const outline = { stroke: strokeCss(st.stroke), strokeWidth: st.width, strokeDasharray: dashCss(st.dash, st.width) };
  return (
    <g data-shape={s.id} transform={`translate(${s.x} ${s.y})`} className={`dw-shape${s.locked ? " locked" : ""}`} style={style}>
      <rect className="dw-shape-hit" width={s.w} height={s.h} />
      {s.kind === "image" ? (
        <>
          <clipPath id={`dwimg-${s.id}`}>
            <path d={shapePath("rect", s.w, s.h, r)} />
          </clipPath>
          {s.src ? (
            <image
              href={mediaUrl(s.src)}
              width={s.w}
              height={s.h}
              preserveAspectRatio={st.fit === "contain" ? "xMidYMid meet" : "xMidYMid slice"}
              clipPath={`url(#dwimg-${s.id})`}
            />
          ) : (
            <rect width={s.w} height={s.h} className="dw-img-empty" clipPath={`url(#dwimg-${s.id})`} />
          )}
          {st.stroke !== "none" && <path d={shapePath("rect", s.w, s.h, r)} style={{ ...outline, fill: "none" }} />}
        </>
      ) : (
        <path d={shapePath(s.kind, s.w, s.h, custom)} style={{ fill, ...outline }} />
      )}
      {s.kind === "text" && !s.text && <rect className="dw-text-empty" width={s.w} height={s.h} />}
    </g>
  );
}

/* ─── 選單（和白板的右鍵選單同一套外觀） ─── */

function useMenuPlacement(x: number, y: number, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    const r = el.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(x, h.width - r.width - 8)), top: Math.max(8, Math.min(y, h.height - r.height - 8)) });
  }, [x, y]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as Element).closest?.(".board-toolbar")) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
    };
  });
  return { ref, pos };
}

/** 畫板的尺寸選單（或自己拖出大小）。 */
function FrameMenu(props: { x: number; y: number; onPick: (p: { label: string; w: number; h: number }) => void; onDraw: () => void; onClose: () => void }) {
  const { ref, pos } = useMenuPlacement(props.x, props.y, props.onClose);
  return (
    <div className="popover block-menu board-menu dw-menu" ref={ref} style={pos}>
      <div className="popover-title">Frame</div>
      {FRAME_PRESETS.map((p) => (
        <button key={p.label} onClick={() => props.onPick(p)}>
          <span className="glyph">
            <DeviceThumb w={p.w} h={p.h} />
          </span>
          <span className="label">{p.label}</span>
          <span className="hint">
            {p.w} × {p.h}
          </span>
        </button>
      ))}
      <div className="popover-sep" />
      <button onClick={props.onDraw}>
        <span className="glyph">
          <FrameIcon />
        </span>
        <span className="label">Draw a frame</span>
        <span className="hint">F</span>
      </button>
    </div>
  );
}

function DeviceThumb({ w, h }: { w: number; h: number }) {
  const k = Math.min(18 / w, 14 / h);
  return (
    <svg width="20" height="16" viewBox="0 0 20 16" aria-hidden>
      <rect x={(20 - w * k) / 2} y={(16 - h * k) / 2} width={w * k} height={h * k} rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

/** 圖形選單：工具列的 Shape（可以直接拖到畫布上）、連按兩下空白處、連線放在空白處。 */
function ShapeMenu(props: {
  x: number;
  y: number;
  title: string;
  onPick: (k: ShapeKind) => void;
  onDrag?: (e: React.PointerEvent, k: ShapeKind) => void;
  onClose: () => void;
}) {
  const { ref, pos } = useMenuPlacement(props.x, props.y, props.onClose);
  return (
    <div className="popover block-menu board-menu dw-shape-menu" ref={ref} style={pos}>
      <div className="popover-title">{props.title}</div>
      <div className="dw-shape-grid">
        {MENU_KINDS.map((k) => (
          <button
            key={k}
            title={props.onDrag ? `${SHAPE_INFO[k].label} — click to add, or drag onto the canvas` : SHAPE_INFO[k].label}
            onPointerDown={props.onDrag ? (e) => props.onDrag!(e, k) : undefined}
            onClick={props.onDrag ? undefined : () => props.onPick(k)}
          >
            <span className="glyph">
              <KindThumb kind={k} />
            </span>
            <span className="label">{SHAPE_INFO[k].label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

type MenuAction =
  | "edit"
  | "duplicate"
  | "copy"
  | "paste"
  | "front"
  | "back"
  | "group"
  | "ungroup"
  | "hide"
  | "lock"
  | "export-png"
  | "export-html"
  | "copy-image"
  | "copy-all-image"
  | "delete"
  | "shape"
  | "frame"
  | "all"
  | "grid"
  | "fit";

function ContextMenu(props: {
  x: number;
  y: number;
  item: boolean;
  count: number;
  canEdit: boolean;
  /** 選了一個畫板：可以匯出 */
  frame: string | null;
  grouped: boolean;
  canGroup: boolean;
  canPaste: boolean;
  grid: boolean;
  onClose: () => void;
  act: (a: MenuAction) => void;
}) {
  const { ref, pos } = useMenuPlacement(props.x, props.y, props.onClose);
  const row = (a: MenuAction, label: string, glyph: React.ReactNode, hint?: string, cls?: string) => (
    <button className={cls} onClick={() => props.act(a)}>
      <span className="glyph">{glyph}</span>
      <span className="label">{label}</span>
      {hint && <span className="hint">{hint}</span>}
    </button>
  );
  return (
    <div className="popover block-menu board-menu dw-menu" ref={ref} style={pos}>
      {props.item ? (
        <>
          {props.count > 1 && <div className="popover-count">{props.count} items selected</div>}
          {props.canEdit && row("edit", props.frame ? "Rename frame" : "Edit text", <TextIcon />, "Enter")}
          {row("duplicate", "Duplicate", <CopyIcon />, "Ctrl+D")}
          {row("copy", "Copy", <CopyIcon />, "Ctrl+C")}
          {row("copy-image", "Copy as image", <ImageIcon />, "Ctrl+Shift+C")}
          {row("front", "Bring to front", <FrontIcon />, "Ctrl+Shift+F")}
          {row("back", "Send to back", <BackIcon />, "Ctrl+Shift+B")}
          {props.canGroup && row("group", "Group", <SectionIcon />, "Ctrl+G")}
          {props.grouped && row("ungroup", "Ungroup", <SectionIcon />, "Ctrl+Shift+G")}
          {row("hide", "Hide", <EyeOffIcon />, "Ctrl+Shift+H")}
          {row("lock", "Lock", <LockIcon />, "Ctrl+Shift+L")}
          {props.frame && (
            <>
              <div className="popover-sep" />
              {row("export-html", "Export frame as web page", <ExportIcon />, ".html")}
              {row("export-png", "Export frame as image", <ExportIcon />, ".png")}
            </>
          )}
          <div className="popover-sep" />
          {row("delete", "Delete", <TrashIcon />, "Del", "danger")}
        </>
      ) : (
        <>
          {row("frame", "Add frame here…", <FrameIcon />)}
          {row("shape", "Add shape here…", <ShapesIcon />)}
          {props.canPaste && row("paste", "Paste", <CopyIcon />, "Ctrl+V")}
          {row("all", "Select all", <SelectAllIcon />, "Ctrl+A")}
          {row("copy-all-image", "Copy diagram as image", <ImageIcon />, "Ctrl+Shift+C")}
          <div className="popover-sep" />
          {row("grid", "Dots and snapping", props.grid ? <span className="check">✓</span> : null)}
          {row("fit", "Fit to screen", <FitIcon />, "Shift+1")}
        </>
      )}
    </div>
  );
}

function SelectAllIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" aria-hidden>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
    </svg>
  );
}

/* ─── 圖層（工具列 Layers 打開的浮動清單） ─── */

/**
 * 最上面的在最前面；畫板下面縮排列出它裡面的圖形。點一下選取（Shift／Ctrl 加選），連按兩下改名，
 * 拖曳排序（放在一列的上半部／下半部；拖到畫板中間是放進畫板），眼睛隱藏、鎖頭鎖定。
 */
function LayersPanel(props: {
  diagram: Diagram;
  sel: Set<string>;
  onSelect: (ids: string[]) => void;
  onApply: (fn: (d: Diagram) => Diagram) => void;
  onClose: () => void;
}) {
  const { diagram: d, sel } = props;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; place: "above" | "below" | "into" } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && !renaming && props.onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const rows: { s: Shape; depth: number }[] = [];
  const kids = new Map<string, Shape[]>();
  for (const s of d.shapes) if (s.parent) kids.set(s.parent, [...(kids.get(s.parent) ?? []), s]);
  for (const s of [...d.shapes].reverse()) {
    if (s.parent) continue;
    rows.push({ s, depth: 0 });
    if (s.kind === "frame") for (const k of [...(kids.get(s.id) ?? [])].reverse()) rows.push({ s: k, depth: 1 });
  }

  const down = (e: React.PointerEvent, s: Shape) => {
    if (e.button !== 0 || (e.target as Element).closest("button, input")) return;
    const y0 = e.clientY;
    const mods = e.shiftKey || e.ctrlKey || e.metaKey;
    let started = false;
    let over: { id: string; place: "above" | "below" | "into" } | null = null;
    const move = (ev: PointerEvent) => {
      if (!started && Math.abs(ev.clientY - y0) < 4) return;
      started = true;
      setDragId(s.id);
      over = null;
      for (const el of listRef.current?.querySelectorAll<HTMLElement>(".dw-layer") ?? []) {
        const r = el.getBoundingClientRect();
        if (ev.clientY < r.top || ev.clientY > r.bottom) continue;
        const id = el.dataset.id!;
        const isFrame = d.shapes.find((x) => x.id === id)?.kind === "frame";
        const t = (ev.clientY - r.top) / r.height;
        over = { id, place: isFrame && s.kind !== "frame" && t > 0.3 && t < 0.7 ? "into" : t < 0.5 ? "above" : "below" };
      }
      setDrop(over);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrop(null);
      setDragId(null);
      if (!started) {
        if (s.hidden || s.locked) return;
        props.onSelect(mods ? (sel.has(s.id) ? [...sel].filter((x) => x !== s.id) : [...sel, s.id]) : [s.id]);
        return;
      }
      const o = over as { id: string; place: "above" | "below" | "into" } | null;
      if (o) props.onApply((dd) => moveLayer(dd, s.id, o.id, o.place));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const toggle = (s: Shape, key: "hidden" | "locked") =>
    props.onApply((dd) => patchShapes(dd, [s.id], (x) => ({ ...x, [key]: x[key] ? undefined : true })));

  return (
    <div className="popover board-menu board-ui dw-layers" onPointerDown={(e) => e.stopPropagation()}>
      <div className="dw-layers-head">
        <span>Layers</span>
        <span className="dw-layers-count">{d.shapes.length}</span>
      </div>
      <div className="dw-layers-list" ref={listRef}>
        {rows.map(({ s, depth }) => (
          <div
            key={s.id}
            data-id={s.id}
            className={`dw-layer${sel.has(s.id) ? " on" : ""}${s.hidden ? " is-hidden" : ""}${s.locked ? " is-locked" : ""}${dragId === s.id ? " moving" : ""}${
              drop?.id === s.id ? ` drop-${drop.place}` : ""
            }`}
            style={{ paddingLeft: 8 + depth * 18 }}
            onPointerDown={(e) => down(e, s)}
            onDoubleClick={() => setRenaming(s.id)}
          >
            <span className="dw-layer-icon">{s.kind === "frame" ? <FrameIcon /> : s.kind === "image" ? <ImageIcon /> : s.kind === "text" ? <TextIcon /> : <KindThumb kind={s.kind} />}</span>
            {renaming === s.id ? (
              <input
                className="dw-layer-input"
                autoFocus
                defaultValue={s.kind === "frame" ? s.text : layerName(s)}
                onBlur={(e) => {
                  const v = e.currentTarget.value.trim();
                  setRenaming(null);
                  props.onApply((dd) =>
                    patchShapes(dd, [s.id], (x) => (x.kind === "frame" ? { ...x, text: v || x.text } : { ...x, name: v || undefined })),
                  );
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setRenaming(null);
                }}
              />
            ) : (
              <span className="dw-layer-name">
                {s.kind === "frame" ? s.text || "Frame" : layerName(s)}
                {s.group && <span className="dw-layer-tag">group</span>}
              </span>
            )}
            <button className={`dw-layer-btn${s.locked ? " keep" : ""}`} title={s.locked ? "Unlock" : "Lock"} onClick={() => toggle(s, "locked")}>
              {s.locked ? <LockIcon /> : <UnlockIcon />}
            </button>
            <button className={`dw-layer-btn${s.hidden ? " keep" : ""}`} title={s.hidden ? "Show" : "Hide"} onClick={() => toggle(s, "hidden")}>
              {s.hidden ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
        ))}
        {!rows.length && <p className="dw-layers-empty">Nothing here yet.</p>}
      </div>
    </div>
  );
}

/* ─── 編輯文字（純文字，Enter 換行，Esc、Ctrl＋Enter 或點別處結束） ─── */

function EditBox(props: { initial: string; seed?: () => string | null; onDone: (text: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const seed = props.seed?.() ?? null;
    el.textContent = seed ?? props.initial;
    el.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(el);
    if (seed !== null) range.collapse(false);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    const t = (ref.current?.innerText ?? "").replace(/\n$/, "");
    props.onDone(t);
  };
  return (
    <div
      ref={ref}
      className="dw-edit"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      onBlur={finish}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          finish();
        }
      }}
    />
  );
}
