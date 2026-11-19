import DOMPurify from "dompurify";
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DeckContext, slideStyle } from "./deckSetup";
import { AlignOverlay } from "../align/AlignMarks";
import { snapMove, snapResizeGrid, type Guide, type Measure } from "../align/align";
import { editorBus, Editor, Swatches } from "../editor/Editor";
import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon, BackIcon, FrontIcon, TrashIcon } from "../editor/icons";
import type { Color } from "../editor/inline";
import { renderMarkdown } from "../editor/markdown";
import { PURIFY, mediaUrl, resolveMedia, saveMedia } from "../editor/media";
import { Field, Section, Seg, SegBtn } from "./DocChrome";
import { sameSlide } from "./file";
import {
  alignFrames,
  arrange,
  duplicateBoxes,
  MAIN,
  MAIN_FRAME,
  moveBoxes,
  newBoxId,
  newImageBox,
  removeBoxes,
  sameFrame,
  shapePath,
  SLIDE_H,
  SLIDE_W,
  updateBoxes,
  type AlignTo,
  type Frame,
  type SlideBox,
} from "./slideBoxes";
import type { SlideAnim } from "./slideAnim";

/**
 * 投影片上的物件（參考 PowerPoint）：主文字方塊（這張投影片的 Markdown）＋文字方塊、圖片、形狀。
 *
 * - `SlideView`：只顯示（縮圖、放映、預覽）。
 * - `SlideCanvas`：編輯。跟 PowerPoint 一樣：點文字方塊裡的字直接編輯；拖文字方塊的邊（或空白處）搬移；
 *   圖片、形狀點了選取、拖曳搬移；選取後八個控制點改大小（圖片的角保持比例）；空白處拖曳框選；
 *   搬移與改大小用 `src/align` 的輔助對齊（對齊其他物件與投影片的邊、中線）。
 *   選了物件（沒在編輯文字）：Delete 刪除、方向鍵移動（Shift 一次 10）、Ctrl＋D 複製、Esc 取消選取。
 * - `BoxFormat`：檢閱器裡物件的樣式與排列。
 *
 * 座標都是投影片的設計尺寸 960×540；畫面上整張投影片用 transform 縮放。
 */

const html = (md: string) => DOMPurify.sanitize(resolveMedia(renderMarkdown(md)), PURIFY) as string;

/** 只有一個大標題（加上最多兩行）的投影片是標題投影片：置中 */
export const isTitleSlide = (source: string) => {
  const t = source.trim();
  return /^#\s/.test(t) && t.split("\n").filter((l) => l.trim()).length <= 3;
};

export const mainFrame = (meta: SlideAnim | undefined): Frame => meta?.main ?? MAIN_FRAME;

/** 複製的物件（貼上時換新的代號） */
let boxClip: SlideBox[] | null = null;
/** 剪貼簿裡的文字：貼上時看到它才當成物件貼上 */
const BOX_CLIP_TEXT = "[Banyan slide objects]";

const frameStyle = (f: Frame & { rot?: number }) => ({ left: f.x, top: f.y, width: f.w, height: f.h, transform: f.rot ? `rotate(${f.rot}deg)` : undefined });
const fillVar = (c: Color | null | undefined) => (c ? `var(--tc-${c})` : "none");

/** 圖片、形狀的畫面（編輯與顯示共用） */
function BoxBody(props: { b: SlideBox }) {
  const { b } = props;
  if (b.kind === "image")
    return <img className="sl-img" src={mediaUrl(b.src ?? "")} alt={b.alt ?? ""} draggable={false} style={{ objectFit: b.fit ?? "contain" }} />;
  if (b.kind === "shape")
    return (
      <svg className="sl-shape" width={b.w} height={b.h} viewBox={`0 0 ${b.w} ${b.h}`} aria-hidden>
        <path d={shapePath(b.shape ?? "rect", b.w, b.h)} style={{ fill: fillVar(b.fill === undefined ? "blue" : b.fill), stroke: fillVar(b.line), strokeWidth: b.line ? 3 : 0 }} />
      </svg>
    );
  return null;
}

/** 文字方塊的底色、框線（文字方塊預設沒有） */
const textBoxStyle = (b: SlideBox) => ({
  background: b.fill ? `var(--bg-${b.fill})` : undefined,
  boxShadow: b.line ? `inset 0 0 0 3px var(--tc-${b.line})` : undefined,
});

/** 頁尾文字與頁碼（簡報設定開著才有） */
function SlideFoot(props: { num?: number }) {
  const deck = useContext(DeckContext);
  if (!deck.footer && !(deck.numbers && props.num)) return null;
  return (
    <div className="sl-foot" aria-hidden>
      <span>{deck.footer}</span>
      <span>{deck.numbers && props.num ? props.num : ""}</span>
    </div>
  );
}

/** 一張投影片的畫面（縮圖、放映）：主文字方塊＋物件；contentRef 是主文字方塊的內容（逐項顯示用） */
export function SlideView(props: { source: string; meta?: SlideAnim; width: number; num?: number; contentRef?: React.Ref<HTMLDivElement> }) {
  const markup = useMemo(() => html(props.source), [props.source]);
  const boxes = props.meta?.boxes ?? [];
  const deck = useContext(DeckContext);
  return (
    <div className="slide-frame" style={{ width: props.width, height: (props.width * SLIDE_H) / SLIDE_W }}>
      <div className="slide" style={{ zoom: props.width / SLIDE_W, ...slideStyle(deck, props.meta) }}>
        <div className={`sl-box sl-main${isTitleSlide(props.source) ? " title-slide" : ""}`} style={frameStyle(mainFrame(props.meta))}>
          <div className="content slide-content" ref={props.contentRef} dangerouslySetInnerHTML={{ __html: markup }} />
        </div>
        {boxes.map((b) =>
          b.kind === "text" ? (
            <div key={b.id} className="sl-box sl-textbox" data-box={b.id} style={{ ...frameStyle(b), ...textBoxStyle(b) }}>
              <div className="content slide-content" dangerouslySetInnerHTML={{ __html: html(b.text ?? "") }} />
            </div>
          ) : (
            <div key={b.id} className={`sl-box sl-${b.kind}`} data-box={b.id} style={frameStyle(b)}>
              <BoxBody b={b} />
            </div>
          ),
        )}
        <SlideFoot num={props.num} />
      </div>
    </div>
  );
}

/** 選一張圖片存進 media/，回傳圖片物件（放在投影片中間，照原圖比例） */
export function pickImageBox(boxes: SlideBox[], onBox: (b: SlideBox) => void) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const src = await saveMedia(f);
      const natural = await new Promise<{ w: number; h: number } | null>((res) => {
        const img = new Image();
        img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => res(null);
        img.src = mediaUrl(src);
      });
      onBox(newImageBox(boxes, src, natural, f.name.replace(/\.[^.]+$/, "")));
    } catch (err) {
      console.error("Couldn't add the image", err);
    }
  };
  input.click();
}

type Live = { ids: string[]; dx: number; dy: number } | { id: string; frame: Frame } | null;

export function SlideCanvas(props: {
  source: string;
  meta: SlideAnim;
  width: number;
  onText: (text: string) => void;
  /** 改這張投影片的物件；history 是記不記結構操作的復原（打字、自動長高不記） */
  onMeta: (fn: (m: SlideAnim) => SlideAnim, history?: boolean) => void;
  sel: string[];
  onSel: (ids: string[]) => void;
  /** 剛新增的文字方塊：畫出來後直接進入編輯（游標放在裡面），跟 Keynote 一樣 */
  autoEdit?: string | null;
  onAutoEdited?: () => void;
  /** 刪掉主文字方塊（連同 objs 這些物件）：內容清空、藏起來，一起記一次復原 */
  onDeleteBody: (objs: string[]) => void;
  /** 第幾張（頁碼） */
  num?: number;
}) {
  const { meta, sel, onSel, onMeta } = props;
  const deck = useContext(DeckContext);
  const scale = props.width / SLIDE_W;
  const boxes = meta.boxes ?? [];
  const main = mainFrame(meta);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!props.autoEdit) return;
    const shell = root.current?.querySelector<HTMLElement>(`[data-box="${props.autoEdit}"]`);
    if (!shell) return;
    props.onAutoEdited?.();
    // 新編輯器的 pointerdown 處理在它自己的 effect 裡才掛上，所以等一下再送
    const r = shell.getBoundingClientRect();
    editAtEnd(shell, r.left + r.width / 2, r.top + r.height / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.autoEdit, boxes.length]);
  const [live, setLive] = useState<Live>(null);
  const [marks, setMarks] = useState<{ guides: Guide[]; measures: Measure[] }>({ guides: [], measures: [] });
  const [marquee, setMarquee] = useState<Frame | null>(null);
  const [over, setOver] = useState(false);

  /** 物件現在的位置（拖曳中的照拖曳的算） */
  const frameOf = (id: string): Frame & { rot?: number } => {
    const base = id === MAIN ? main : (boxes.find((b) => b.id === id) ?? MAIN_FRAME);
    const rot = (base as SlideBox).rot;
    if (live && "ids" in live && live.ids.includes(id)) return { x: base.x + live.dx, y: base.y + live.dy, w: base.w, h: base.h, rot };
    if (live && "id" in live && live.id === id) return { ...live.frame, rot };
    return { x: base.x, y: base.y, w: base.w, h: base.h, rot };
  };
  // 主文字方塊刪掉了（又沒有內容）就不畫
  const hasBody = !meta.noBody || !!props.source.trim();
  const allIds = [...(hasBody ? [MAIN] : []), ...boxes.map((b) => b.id)];
  const slideRect = { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H };

  /** 結束文字編輯（點到別的物件、空白處時；原本的事件被擋下來，編輯器自己不會知道） */
  const blurEditing = () => {
    const a = document.activeElement as HTMLElement | null;
    if (a && root.current?.contains(a) && (a.isContentEditable || a.tagName === "TEXTAREA" || a.tagName === "INPUT")) a.blur();
  };

  /** 把一組物件的位置寫回去 */
  const applyFrames = (m: SlideAnim, frames: Map<string, Frame>): SlideAnim => {
    const out: SlideAnim = { ...m, boxes: (m.boxes ?? []).map((b) => (frames.has(b.id) ? { ...b, ...frames.get(b.id)! } : b)) };
    const mf = frames.get(MAIN);
    if (mf) {
      if (sameFrame(mf, MAIN_FRAME)) delete out.main;
      else out.main = { ...mf };
    }
    return out;
  };

  /** 拖曳搬移（沒有拖動就是點一下：onClick） */
  const startMove = (e: React.PointerEvent, ids: string[], onClick?: () => void) => {
    const x0 = e.clientX;
    const y0 = e.clientY;
    const frames = ids.map((id) => ({ id, ...frameOf(id) }));
    const bb = {
      x: Math.min(...frames.map((f) => f.x)),
      y: Math.min(...frames.map((f) => f.y)),
      w: Math.max(...frames.map((f) => f.x + f.w)) - Math.min(...frames.map((f) => f.x)),
      h: Math.max(...frames.map((f) => f.y + f.h)) - Math.min(...frames.map((f) => f.y)),
    };
    const others = [slideRect, ...allIds.filter((id) => !ids.includes(id)).map(frameOf)];
    let moved = false;
    let last = { dx: 0, dy: 0 };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / scale;
      const dy = (ev.clientY - y0) / scale;
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      if (!moved) blurEditing();
      moved = true;
      const r = ev.altKey ? { dx, dy, guides: [], measures: [] } : snapMove(bb, dx, dy, others, 6 / scale, null);
      last = { dx: Math.round(r.dx), dy: Math.round(r.dy) };
      setLive({ ids, ...last });
      setMarks({ guides: r.guides, measures: r.measures });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setLive(null);
      setMarks({ guides: [], measures: [] });
      if (!moved) return onClick?.();
      if (!last.dx && !last.dy) return;
      onMeta((m) => applyFrames(m, new Map(frames.map((f) => [f.id, { x: f.x + last.dx, y: f.y + last.dy, w: f.w, h: f.h }]))));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** 拖控制點改大小（h 是 n、s、e、w 的組合）；圖片拖角保持比例 */
  const startResize = (e: React.PointerEvent, id: string, h: string) => {
    e.preventDefault();
    e.stopPropagation();
    blurEditing();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const base = frameOf(id);
    const keep = boxes.find((b) => b.id === id)?.kind === "image" && h.length === 2;
    const others = [slideRect, ...allIds.filter((x) => x !== id).map(frameOf)];
    const min = 20;
    let cur = base;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / scale;
      const dy = (ev.clientY - y0) / scale;
      let r = { ...base };
      if (h.includes("e")) r.w = base.w + dx;
      if (h.includes("w")) r = { ...r, x: base.x + dx, w: base.w - dx };
      if (h.includes("s")) r.h = base.h + dy;
      if (h.includes("n")) r = { ...r, y: base.y + dy, h: base.h - dy };
      if (keep) {
        const k = Math.max(min / Math.min(base.w, base.h), Math.max(r.w / base.w, r.h / base.h));
        const w = base.w * k;
        const hh = base.h * k;
        r = { x: h.includes("w") ? base.x + base.w - w : base.x, y: h.includes("n") ? base.y + base.h - hh : base.y, w, h: hh };
        setMarks({ guides: [], measures: [] });
      } else {
        if (r.w < min) r = { ...r, w: min, x: h.includes("w") ? base.x + base.w - min : r.x };
        if (r.h < min) r = { ...r, h: min, y: h.includes("n") ? base.y + base.h - min : r.y };
        if (!ev.altKey) {
          const s = snapResizeGrid(r, base, h, others, 6 / scale, null, min);
          r = s.rect;
          setMarks({ guides: s.guides, measures: s.measures });
        }
      }
      cur = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
      setLive({ id, frame: cur });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setLive(null);
      setMarks({ guides: [], measures: [] });
      if (!sameFrame(cur, base)) onMeta((m) => applyFrames(m, new Map([[id, cur]])));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** 點一下文字方塊的空白處：跟點文件下方一樣，在最後面開始編輯 */
  const editAtEnd = (shell: HTMLElement, x: number, y: number) => {
    setTimeout(() => {
      const tail = shell.querySelector<HTMLElement>(".md-editor .tail");
      if (!tail) return;
      const init = { bubbles: true, button: 0, clientX: x, clientY: y };
      tail.dispatchEvent(new PointerEvent("pointerdown", init));
      window.dispatchEvent(new PointerEvent("pointerup", init));
    });
  };

  /** 按下物件：選取（Shift／Ctrl 加入或移出），拖曳就搬移 */
  const pick = (e: React.PointerEvent, id: string) => {
    const add = e.shiftKey || e.ctrlKey || e.metaKey;
    if (add) {
      onSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
      return null;
    }
    const ids = sel.includes(id) ? sel : [id];
    if (!sel.includes(id)) onSel([id]);
    return ids;
  };

  const textDown = (e: React.PointerEvent, id: string) => {
    // 程式送的 pointerdown（editAtEnd、新文字方塊開始編輯）要交給編輯器，不能在這裡擋下
    if (e.button !== 0 || !e.nativeEvent.isTrusted) return;
    const t = e.target as HTMLElement;
    // 點在字上：交給編輯器（直接編輯）
    if (t.closest(".md-editor") && !t.closest(".tail") && !t.closest(".sl-edge")) {
      if (!e.shiftKey && !(sel.length === 1 && sel[0] === id)) onSel([id]);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const ids = pick(e, id);
    if (!ids) return;
    const shell = e.currentTarget as HTMLElement;
    const onEdge = !!t.closest(".sl-edge");
    startMove(e, ids, onEdge ? blurEditing : () => editAtEnd(shell, e.clientX, e.clientY));
  };

  const objDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    blurEditing();
    const ids = pick(e, id);
    if (ids) startMove(e, ids);
  };

  /** 空白處：取消選取；拖曳框選物件 */
  const bgDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".sl-box, .sl-handles")) return;
    e.preventDefault();
    blurEditing();
    const add = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!add) onSel([]);
    const r0 = root.current!.getBoundingClientRect();
    const p0 = { x: (e.clientX - r0.left) / scale, y: (e.clientY - r0.top) / scale };
    const keep = add ? sel : [];
    const move = (ev: PointerEvent) => {
      const p = { x: (ev.clientX - r0.left) / scale, y: (ev.clientY - r0.top) / scale };
      const r = { x: Math.min(p0.x, p.x), y: Math.min(p0.y, p.y), w: Math.abs(p.x - p0.x), h: Math.abs(p.y - p0.y) };
      setMarquee(r);
      const hit = allIds.filter((id) => {
        const f = frameOf(id);
        return f.x < r.x + r.w && f.x + f.w > r.x && f.y < r.y + r.h && f.y + f.h > r.y;
      });
      onSel([...new Set([...keep, ...hit])]);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setMarquee(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // 選了物件（沒在編輯文字、沒選編輯器裡的區塊）時的按鍵
  const live2 = useRef({ sel, boxes, onMeta, onSel, onDeleteBody: props.onDeleteBody });
  live2.current = { sel, boxes, onMeta, onSel, onDeleteBody: props.onDeleteBody };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const { sel, onMeta, onSel, onDeleteBody } = live2.current;
      if (!sel.length || e.defaultPrevented) return;
      const a = document.activeElement as HTMLElement | null;
      if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.closest(".deck-strip"))) return;
      const st = editorBus.status();
      if (st.root && root.current?.contains(st.root) && (st.editing || st.selected)) return;
      const objs = sel.filter((id) => id !== MAIN);
      const ctrl = e.ctrlKey || e.metaKey;
      const step = e.shiftKey ? 10 : 1;
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (e.key === "Delete" || e.key === "Backspace") {
        if (sel.includes(MAIN)) onDeleteBody(objs);
        else if (objs.length) onMeta((m) => ({ ...m, boxes: removeBoxes(m.boxes ?? [], objs) }));
        else return;
        onSel([]);
      } else if (arrows[e.key]) {
        const [dx, dy] = arrows[e.key];
        onMeta((m) => {
          const out: SlideAnim = { ...m, boxes: moveBoxes(m.boxes ?? [], objs, dx, dy) };
          if (sel.includes(MAIN)) {
            const f = mainFrame(m);
            const nf = { ...f, x: f.x + dx, y: f.y + dy };
            if (sameFrame(nf, MAIN_FRAME)) delete out.main;
            else out.main = nf;
          }
          return out;
        });
      } else if (ctrl && e.key.toLowerCase() === "d") {
        if (!objs.length) return;
        let added: string[] = [];
        onMeta((m) => {
          const r = duplicateBoxes(m.boxes ?? [], objs);
          added = r.added;
          return { ...m, boxes: r.boxes };
        });
        onSel(added);
      } else if (e.key === "Escape") onSel([]);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    // Esc：在文字方塊裡編輯（或選了裡面的區塊）時，改成選取整個文字方塊（跟 PowerPoint 一樣），再按 Delete 就刪掉它
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const st = editorBus.status();
      const shell = st.root?.closest<HTMLElement>("[data-box]");
      if (!shell || !root.current?.contains(shell) || !(st.editing || st.selected)) return;
      e.preventDefault();
      e.stopPropagation();
      editorBus.run(shell, (c) => c.release());
      const a = document.activeElement as HTMLElement | null;
      if (a && shell.contains(a)) a.blur();
      live2.current.onSel([shell.dataset.box!]);
    };
    // 選了物件時 Ctrl＋C／X／V：複製、剪下、貼上物件（存在模組的剪貼簿，可以貼到別張投影片；跟 PowerPoint 一樣錯開一點）
    const clip = (e: ClipboardEvent) => {
      const a = document.activeElement as HTMLElement | null;
      if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.closest(".deck-strip"))) return;
      const st = editorBus.status();
      if (st.root && root.current?.contains(st.root) && (st.editing || st.selected)) return;
      const { sel, boxes, onMeta, onSel } = live2.current;
      const objs = boxes.filter((b) => sel.includes(b.id));
      if (e.type === "paste") {
        if (!boxClip?.length || e.clipboardData?.getData("text/plain") !== BOX_CLIP_TEXT) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const added = boxClip.map((b) => ({ ...structuredClone(b), id: newBoxId(), x: b.x + 20, y: b.y + 20 }));
        boxClip = added;
        onMeta((m) => ({ ...m, boxes: [...(m.boxes ?? []), ...added] }));
        onSel(added.map((b) => b.id));
        return;
      }
      if (!objs.length) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      boxClip = objs.map((b) => structuredClone(b));
      e.clipboardData?.setData("text/plain", BOX_CLIP_TEXT);
      if (e.type === "cut") {
        onMeta((m) => ({ ...m, boxes: removeBoxes(m.boxes ?? [], objs.map((b) => b.id)) }));
        onSel([]);
      }
    };
    window.addEventListener("keydown", key);
    window.addEventListener("keydown", esc, true);
    for (const t of ["copy", "cut", "paste"]) window.addEventListener(t, clip as EventListener, true);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keydown", esc, true);
      for (const t of ["copy", "cut", "paste"]) window.removeEventListener(t, clip as EventListener, true);
    };
  }, []);

  // 空的文字方塊在取消選取後拿掉（跟 PowerPoint 一樣）
  useEffect(() => {
    const empty = boxes.filter((b) => b.kind === "text" && !(b.text ?? "").replace(/&nbsp;/g, "").trim() &&!sel.includes(b.id)).map((b) => b.id);
    if (empty.length) onMeta((m) => ({ ...m, boxes: removeBoxes(m.boxes ?? [], empty) }), false);
    // 只在選取改變時檢查
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.join(",")]);
  // 換到別張投影片（這個畫面拿掉）時也拿掉空的文字方塊
  const latest = useRef({ boxes, onMeta });
  latest.current = { boxes, onMeta };
  useEffect(
    () => () => {
      const { boxes, onMeta } = latest.current;
      const empty = boxes.filter((b) => b.kind === "text" && !(b.text ?? "").replace(/&nbsp;/g, "").trim()).map((b) => b.id);
      if (empty.length) onMeta((m) => ({ ...m, boxes: removeBoxes(m.boxes ?? [], empty) }), false);
    },
    [],
  );

  // 主文字方塊的內容超出：提示
  useLayoutEffect(() => {
    const el = root.current?.querySelector<HTMLElement>(".sl-main");
    const inner = el?.querySelector<HTMLElement>(":scope > .slide-content");
    if (!el || !inner) return;
    // 量內容（四邊可以拖的條會超出框，不能用 scrollHeight）
    const check = () => setOver(inner.offsetHeight > el.clientHeight + 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [main.h]);

  const edge = 10 / scale;
  const shownSel = sel.filter((id) => allIds.includes(id));
  return (
    <>
      <div className="slide-frame deck-canvas" style={{ width: props.width, height: props.width * (SLIDE_H / SLIDE_W) }} onPointerDown={bgDown}>
        <div ref={root} className="slide slide-edit" style={{ transform: `scale(${scale})`, ...slideStyle(deck, meta) }}>
          {hasBody && (
          <TextShell
            id={MAIN}
            frame={frameOf(MAIN)}
            cls={`sl-main${isTitleSlide(props.source) ? " title-slide" : ""}`}
            on={shownSel.includes(MAIN)}
            edge={edge}
            onDown={textDown}
          >
            <TextEditor value={props.source} onChange={props.onText} placeholder="Click to add a title — start with “# ” for a title slide" main />
          </TextShell>
          )}
          {boxes.map((b) =>
            b.kind === "text" ? (
              <TextShell
                key={b.id}
                id={b.id}
                frame={frameOf(b.id)}
                cls="sl-textbox"
                style={textBoxStyle(b)}
                on={shownSel.includes(b.id)}
                edge={edge}
                onDown={textDown}
                onGrow={(h) => onMeta((m) => ({ ...m, boxes: updateBoxes(m.boxes ?? [], [b.id], (x) => ({ ...x, h })) }), false)}
              >
                <TextEditor
                  value={b.text ?? ""}
                  onChange={(t) => onMeta((m) => ({ ...m, boxes: updateBoxes(m.boxes ?? [], [b.id], (x) => ({ ...x, text: t })) }), false)}
                  placeholder="Text"
                />
              </TextShell>
            ) : (
              <div
                key={b.id}
                className={`sl-box sl-${b.kind}${shownSel.includes(b.id) ? " on" : ""}`}
                data-box={b.id}
                style={frameStyle(frameOf(b.id))}
                onPointerDown={(e) => objDown(e, b.id)}
              >
                <BoxBody b={{ ...b, ...frameOf(b.id) }} />
              </div>
            ),
          )}
          {/* 選取的物件：外框與控制點（改大小） */}
          <div className="sl-handles" style={{ ["--hs" as string]: `${8 / scale}px`, ["--bw" as string]: `${1.5 / scale}px` }}>
            {shownSel.map((id) => {
              const f = frameOf(id);
              return (
                <div key={id} className="sl-sel" style={frameStyle(f)}>
                  {shownSel.length === 1 &&
                    ["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((h) => <span key={h} className={`sl-h h-${h}`} onPointerDown={(e) => startResize(e, id, h)} />)}
                </div>
              );
            })}
            {marquee && <div className="sl-marquee" style={frameStyle(marquee)} />}
          </div>
          <SlideFoot num={props.num} />
          <AlignOverlay guides={marks.guides} measures={marks.measures} zoom={scale} />
        </div>
      </div>
      {over && <p className="deck-over">The text doesn't fit in its box. Make the box bigger, or move some of it to a new slide.</p>}
    </>
  );
}

/** 文字方塊的外殼：可以拖的四邊、內容（編輯器），內容比框高就把框長高（onGrow） */
function TextShell(props: {
  id: string;
  frame: Frame;
  cls: string;
  style?: React.CSSProperties;
  on: boolean;
  edge: number;
  onDown: (e: React.PointerEvent, id: string) => void;
  onGrow?: (h: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { onGrow, frame } = props;
  const grow = useRef(onGrow);
  grow.current = onGrow;
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(".slide-content");
    if (!el || !grow.current) return;
    const check = () => {
      const need = Math.ceil(el.offsetHeight + 8);
      if (need > frame.h + 1) grow.current?.(need);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [frame.h]);
  const e = props.edge;
  return (
    <div
      ref={ref}
      className={`sl-box sl-text ${props.cls}${props.on ? " on" : ""}`}
      data-box={props.id}
      style={{ ...frameStyle(props.frame), ...props.style }}
      onPointerDown={(ev) => props.onDown(ev, props.id)}
    >
      {props.children}
      <span className="sl-edge" style={{ left: -e / 2, right: -e / 2, top: -e / 2, height: e }} />
      <span className="sl-edge" style={{ left: -e / 2, right: -e / 2, bottom: -e / 2, height: e }} />
      <span className="sl-edge" style={{ top: -e / 2, bottom: -e / 2, left: -e / 2, width: e }} />
      <span className="sl-edge" style={{ top: -e / 2, bottom: -e / 2, right: -e / 2, width: e }} />
    </div>
  );
}

/** 文字方塊裡的編輯器（編輯器送出的文字沿用，免得編輯器以為是外部改了內容而結束編輯） */
function TextEditor(props: { value: string; onChange: (t: string) => void; placeholder: string; main?: boolean }) {
  const last = useRef(props.value);
  if (props.main ? !sameSlide(last.current, props.value) : last.current !== props.value) last.current = props.value;
  return (
    <div className="slide-content">
      <Editor
        value={last.current}
        onChange={(t) => {
          last.current = t;
          props.onChange(t);
        }}
        compact
        formatBar={false}
        placeholder={props.placeholder}
      />
    </div>
  );
}

/* ─── 檢閱器：物件的樣式與排列 ─── */

function NumField(props: { label: string; value: number; onSet: (v: number) => void }) {
  const [v, setV] = useState(String(Math.round(props.value)));
  useEffect(() => setV(String(Math.round(props.value))), [props.value]);
  const done = () => {
    const n = Number(v);
    if (Number.isFinite(n) && Math.round(n) !== Math.round(props.value)) props.onSet(Math.round(n));
    else setV(String(Math.round(props.value)));
  };
  return (
    <label className="dc-num">
      <input
        value={v}
        inputMode="numeric"
        onChange={(e) => setV(e.target.value)}
        onBlur={done}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setV(String(Math.round(props.value)));
            (e.target as HTMLInputElement).blur();
          }
        }}
        aria-label={props.label}
      />
      <span>{props.label}</span>
    </label>
  );
}

/**
 * 選取的物件的檢閱器：part 是 Format 的哪一個分頁——
 * Style：填色、框線、圖片的縮放、刪除；Arrange：位置與大小、旋轉、對齊、上下層。
 */
export function BoxFormat(props: {
  part: "style" | "arrange";
  meta: SlideAnim;
  sel: string[];
  onMeta: (fn: (m: SlideAnim) => SlideAnim) => void;
  onSel: (ids: string[]) => void;
  onDeleteBody: (objs: string[]) => void;
}) {
  const { meta, onMeta } = props;
  const boxes = meta.boxes ?? [];
  const ids = props.sel.filter((id) => id === MAIN || boxes.some((b) => b.id === id));
  if (!ids.length) return null;
  const objs = boxes.filter((b) => ids.includes(b.id));
  const one = ids.length === 1 ? (ids[0] === MAIN ? null : objs[0]) : null;
  const frames = ids.map((id) => ({ id, ...(id === MAIN ? mainFrame(meta) : boxes.find((b) => b.id === id)!) }));
  const setFrames = (fs: Map<string, Frame>) =>
    onMeta((m) => {
      const out: SlideAnim = { ...m, boxes: (m.boxes ?? []).map((b) => (fs.has(b.id) ? { ...b, ...fs.get(b.id)! } : b)) };
      const mf = fs.get(MAIN);
      if (mf) {
        if (sameFrame(mf, MAIN_FRAME)) delete out.main;
        else out.main = mf;
      }
      return out;
    });
  const patch = (p: Partial<SlideBox>) => onMeta((m) => ({ ...m, boxes: updateBoxes(m.boxes ?? [], objs.map((b) => b.id), (b) => ({ ...b, ...p })) }));
  const f = frames[0];
  const kinds = new Set(objs.map((b) => b.kind));
  const title =
    ids.length > 1 ? `${ids.length} objects` : ids[0] === MAIN ? "Body Text" : one?.kind === "image" ? "Image" : one?.kind === "shape" ? "Shape" : "Text Box";
  if (props.part === "style")
    return (
      <>
      <Section title={title}>
        {(kinds.has("shape") || kinds.has("text")) && !kinds.has("image") && (
          <>
            <Field label="Fill">
              <ColorPick kind={kinds.has("shape") ? "color" : "bg"} value={objs[0]?.fill === undefined ? (kinds.has("shape") ? "blue" : null) : (objs[0].fill ?? null)} onPick={(c) => patch({ fill: c })} />
            </Field>
            <Field label="Border">
              <ColorPick kind="color" value={objs[0]?.line ?? null} onPick={(c) => patch({ line: c })} />
            </Field>
          </>
        )}
        {kinds.size === 1 && kinds.has("image") && (
          <Field label="Scale">
            <Seg label="Image fit">
              <SegBtn title="Fit the whole image in the box" wide on={(objs[0].fit ?? "contain") === "contain"} onClick={() => patch({ fit: "contain" })}>
                Fit
              </SegBtn>
              <SegBtn title="Fill the box, cropping the image" wide on={objs[0].fit === "cover"} onClick={() => patch({ fit: "cover" })}>
                Fill
              </SegBtn>
            </Seg>
          </Field>
        )}
        {ids.includes(MAIN) && ids.length === 1 && <p className="dc-note">The slide’s body text. Change its text in the Text and Paragraph tabs.</p>}
      </Section>
      <Section>
        <button
          className="dp-btn danger"
          onClick={() => {
            if (ids.includes(MAIN)) props.onDeleteBody(objs.map((b) => b.id));
            else onMeta((m) => ({ ...m, boxes: removeBoxes(m.boxes ?? [], objs.map((b) => b.id)) }));
            props.onSel([]);
          }}
        >
          <TrashIcon /> Delete {ids.length === 1 ? "Object" : `${ids.length} Objects`}
        </button>
      </Section>
      </>
    );
  return (
    <>
      <Section title={ids.length > 1 ? `Arrange · ${ids.length} objects` : "Position & Size"}>
        {ids.length === 1 && (
          <div className="dc-nums">
            <NumField label="X" value={f.x} onSet={(x) => setFrames(new Map([[f.id, { ...f, x }]]))} />
            <NumField label="Y" value={f.y} onSet={(y) => setFrames(new Map([[f.id, { ...f, y }]]))} />
            <NumField label="Width" value={f.w} onSet={(w) => setFrames(new Map([[f.id, { ...f, w: Math.max(20, w) }]]))} />
            <NumField label="Height" value={f.h} onSet={(h) => setFrames(new Map([[f.id, { ...f, h: Math.max(20, h) }]]))} />
          </div>
        )}
        {ids.includes(MAIN) && ids.length === 1 && (
          <button className="dp-btn" disabled={!meta.main} onClick={() => setFrames(new Map([[MAIN, MAIN_FRAME]]))}>
            Reset Position
          </button>
        )}
        {one && (
          <div className="dc-row sl-rot-row">
            <NumField label="Rotate °" value={one.rot ?? 0} onSet={(r) => patch({ rot: ((Math.round(r) % 360) + 360) % 360 || undefined })} />
            <Seg label="Rotate">
              <SegBtn title="Rotate left 90°" onClick={() => patch({ rot: (((one.rot ?? 0) - 90) % 360 + 360) % 360 || undefined })}>
                ⟲
              </SegBtn>
              <SegBtn title="Rotate right 90°" onClick={() => patch({ rot: ((one.rot ?? 0) + 90) % 360 || undefined })}>
                ⟳
              </SegBtn>
            </Seg>
          </div>
        )}
        <div className="dc-row">
          <Seg label={ids.length === 1 ? "Align on the slide" : "Align the objects"}>
            {(["left", "center", "right"] as AlignTo[]).map((a) => (
              <SegBtn key={a} title={`Align ${a}`} onClick={() => setFrames(alignFrames(frames, a))}>
                {a === "left" ? <AlignLeftIcon /> : a === "center" ? <AlignCenterIcon /> : <AlignRightIcon />}
              </SegBtn>
            ))}
          </Seg>
          <Seg label="Vertical align">
            {(["top", "middle", "bottom"] as AlignTo[]).map((a) => (
              <SegBtn key={a} title={`Align ${a}`} onClick={() => setFrames(alignFrames(frames, a))}>
                <AlignLeftIcon style={{ transform: "rotate(90deg)", ...(a === "middle" ? { opacity: 0.85 } : {}) }} />
              </SegBtn>
            ))}
          </Seg>
        </div>
        {objs.length > 0 && (
          <div className="dc-btns">
            <button className="dp-btn" onClick={() => onMeta((m) => ({ ...m, boxes: arrange(m.boxes ?? [], objs.map((b) => b.id), "front") }))} title="Bring to Front">
              <FrontIcon /> Front
            </button>
            <button className="dp-btn" onClick={() => onMeta((m) => ({ ...m, boxes: arrange(m.boxes ?? [], objs.map((b) => b.id), "forward") }))} title="Bring Forward">
              Forward
            </button>
            <button className="dp-btn" onClick={() => onMeta((m) => ({ ...m, boxes: arrange(m.boxes ?? [], objs.map((b) => b.id), "backward") }))} title="Send Backward">
              Backward
            </button>
            <button className="dp-btn" onClick={() => onMeta((m) => ({ ...m, boxes: arrange(m.boxes ?? [], objs.map((b) => b.id), "back") }))} title="Send to Back">
              <BackIcon /> Back
            </button>
          </div>
        )}
      </Section>
    </>
  );
}

function ColorPick(props: { kind: "color" | "bg"; value: Color | null; onPick: (c: Color | null) => void }) {
  return (
    <div className="dc-swatch-inline">
      <Swatches kind={props.kind} value={props.value} onPick={props.onPick} />
    </div>
  );
}
