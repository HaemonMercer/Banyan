import { DECK_THEMES, DeckContext, SLIDE_BGS, themeOf, type DeckSetup } from "./deckSetup";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { editorBus } from "../editor/Editor";
import {
  AnimIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  CopyIcon,
  CutIcon,
  EyeOffIcon,
  GalleryIcon,
  ImageIcon,
  ImportIcon,
  NoteIcon,
  DocIcon,
  PanelRightIcon,
  ShowIcon,
  ShapesIcon,
  TextIcon,
  TableIcon,
  VideoIcon,
  PasteIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
} from "../editor/icons";
import { importSlides, saveImported, SLIDES_IMPORT, withImportedSlides } from "./docImport";
import { duplicateSlides, insertSlide, insertSlides, joinSlides, moveGroup, moveSlides, removeSlides, sameSlide, setSlide, splitSlides } from "./file";
import { clickPick, keepPick, noPick, stepPick, type Picked } from "./selection";
import { BoxFormat, pickImageBox, SlideCanvas, SlideView } from "./SlideCanvas";
import { MAIN, newShapeBox, newTextBox, removeBoxes, shapePath, SHAPES, type ShapeKind, type SlideBox } from "./slideBoxes";
import {
  Field,
  FormatInspector,
  Inspector,
  MenuItem,
  ParagraphLayoutFormat,
  ParagraphStyleFormat,
  Section,
  TBtn,
  TextStyleFormat,
  TMenu,
  Toolbar,
  useEditorRun,
  useEditorStatus,
  useFormatTab,
  usePanel,
  type StyleLib,
  type ParaStyle,
} from "./DocChrome";
import {
  animAt,
  animDuplicate,
  animInsert,
  animRemove,
  animReorder,
  animSplice,
  BUILD_MS,
  BUILDS,
  isAnimated,
  sameAnim,
  setAnim,
  setMeta,
  TRANSITION_MS,
  TRANSITIONS,
  type Deck,
  type SlideAnim,
} from "./slideAnim";

/**
 * 簡報的所見即所得編輯（參考 PowerPoint）：左邊是投影片縮圖（點了切換、拖曳排序），
 * 中間是目前這張投影片，直接在 16:9 的版面上用區塊編輯器編輯。
 *
 * 內容仍是一份 Markdown，投影片之間是前面空一行、單獨一行的 `---`（`file.ts` 的 `splitSlides`）；
 * 這裡的操作都經過 `file.ts` 的純函式（`setSlide`、`insertSlide`…），
 * 並用 `onEdit(fn)` 拿最新的內容改。
 */

/** 設計尺寸 960×540；畫面上用 transform 縮放 */
const SLIDE_W = 960;
const SLIDE_H = 540;

/**
 * 逐項顯示時一次出現的單位：頂層的區塊，清單拆成一項一項；開頭的標題一開始就在，不算。
 */
export function buildUnits(content: Element): HTMLElement[] {
  const out: HTMLElement[] = [];
  // 對齊、背景、縮排這些排版容器（<div class="align-center"> …）看裡面的區塊
  const flat = (els: Element[]): Element[] =>
    els.flatMap((el) => (el.tagName === "DIV" && /\b(align-|bg-|indent|width-|caption-)/.test(el.className) && el.children.length ? flat([...el.children]) : [el]));
  flat([...content.children]).forEach((el, i) => {
    if (i === 0 && /^H[1-6]$/.test(el.tagName)) return;
    if (el.tagName === "UL" || el.tagName === "OL") out.push(...([...el.children].filter((li) => li.tagName === "LI") as HTMLElement[]));
    else out.push(el as HTMLElement);
  });
  return out;
}

/**
 * 有逐項顯示的投影片：第 step 個單位以後先藏起來（保留位置），
 * `fresh` 時剛出現的那一個播動畫。`onCount` 回報總共有幾個單位。
 */
function BuildSlide(props: { source: string; width: number; anim: SlideAnim; step: number; fresh: boolean; num?: number; onCount?: (n: number) => void }) {
  // 單位：主文字方塊的區塊，接著是其他物件（照上下層的順序）
  const content = useRef<HTMLDivElement>(null);
  const { build } = props.anim;
  const { step, fresh, onCount } = props;
  useLayoutEffect(() => {
    const el = content.current;
    if (!el) return;
    const objs = [...(el.closest(".slide")?.querySelectorAll<HTMLElement>("[data-box]") ?? [])];
    const units = build === "none" ? [] : [...buildUnits(el), ...objs];
    units.forEach((u, k) => {
      u.classList.toggle("bd-hide", k >= step);
      u.classList.remove("bd-in");
      u.removeAttribute("data-build");
      if (fresh && k === step - 1 && build !== "appear") {
        u.dataset.build = build;
        void u.offsetWidth; // 重新開始動畫
        u.classList.add("bd-in");
      }
    });
    onCount?.(units.length);
  }, [props.source, props.anim, build, step, fresh, onCount]);
  return <SlideView source={props.source} meta={props.anim} width={props.width} num={props.num} contentRef={content} />;
}

/** 放映與預覽共用的舞台：換張時舊的一層、新的一層，照新投影片（往回時是離開的那張）的轉場播 */
type Leaving = { i: number; step: number; back: boolean; transition: SlideAnim["transition"]; key: number };

function Stage(props: {
  slides: string[];
  anim: SlideAnim[];
  width: number;
  i: number;
  step: number;
  fresh: boolean;
  leaving: Leaving | null;
  onCount: (n: number) => void;
}) {
  const { slides, anim, width, leaving } = props;
  const tr = leaving ? ` tr-${leaving.transition}${leaving.back ? " back" : ""}` : "";
  return (
    <div className="pr-stage" style={{ width, height: (width * SLIDE_H) / SLIDE_W }}>
      {leaving && (
        <div key={`out${leaving.key}`} className={`pr-layer tr-out${tr}`}>
          {leaving.i >= 0 ? (
            <BuildSlide source={slides[leaving.i] ?? ""} width={width} anim={animAt(anim, leaving.i)} step={leaving.step} fresh={false} num={leaving.i + 1} />
          ) : (
            <div className="slide-frame" style={{ width, height: (width * SLIDE_H) / SLIDE_W }} />
          )}
        </div>
      )}
      <div key={`in${props.i}`} className={`pr-layer${leaving ? ` tr-in${tr}` : ""}`}>
        <BuildSlide
          source={slides[props.i] ?? ""}
          width={width}
          anim={animAt(anim, props.i)}
          step={props.step}
          fresh={props.fresh}
          num={props.i + 1}
          onCount={props.onCount}
        />
      </div>
    </div>
  );
}

/** 投影片的剪貼簿：複製時連動畫一起記住；貼上的文字跟它一樣就用記住的動畫 */
let clip: { text: string; anim: SlideAnim[] } | null = null;

/** 投影片結構操作的一步復原：前後的內容與選取 */
type Step = { before: Deck; after: Deck; at: [number, number[]]; to: [number, number[]] };

export function SlideDeck(props: {
  content: string;
  slides: string[];
  anim: SlideAnim[];
  current: number;
  onCurrent: (i: number) => void;
  onEdit: (fn: (d: Deck) => Deck) => void;
  onPresent: (i: number) => void;
  /** 整份的設定（主題、頁碼、頁尾） */
  deck: DeckSetup;
  onDeck: (d: DeckSetup) => void;
  /** 已存的區塊樣式 */
  styles?: StyleLib;
}) {
  const { slides, anim, current, onCurrent, onEdit } = props;
  /** Navigator（左邊縮圖＋投影片）或 Light Table（全部投影片排成格子） */
  const [view, setView] = useState<"navigator" | "table">("navigator");
  const stage = useRef<HTMLDivElement>(null);
  const scope = useRef<HTMLDivElement>(null);
  const st = useEditorStatus(scope);
  const run = useEditorRun(scope);
  const [panel, setPanel] = usePanel<"format" | "animate" | "document">("slides", "format");
  const [fmtTab, setFmtTab] = useFormatTab("slides");
  const [width, setWidth] = useState(720);
  const order = useMemo(() => slides.map((_s, i) => i), [slides]);
  const [pickRaw, setPick] = useState<Picked<number>>(noPick);
  // 投影片變少了（刪除、編輯時重新分張）：去掉不在的
  const pick = keepPick(order, pickRaw);
  /** 結構操作（新增、刪除、複製、搬移、貼上、動畫）的復原與重做；打字的復原交給編輯器 */
  const history = useRef<{ undo: Step[]; redo: Step[] }>({ undo: [], redo: [] });
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth - 64;
      const h = el.clientHeight - 64;
      setWidth(Math.max(240, Math.min(w, (h * SLIDE_W) / SLIDE_H, SLIDE_W * 1.4)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** 對第 i 張的操作要處理哪些投影片：它在多選裡就是整組 */
  const targets = (i: number) => (pick.sel.length > 1 && pick.sel.includes(i) ? pick.sel : [i]);
  const show = (cur: number, sel: number[]) => {
    onCurrent(cur);
    setPick({ sel, anchor: sel[0] ?? null });
  };

  /** 做一個結構操作：記下前後，之後可以復原；`say` 是提示（刪除時給 Undo） */
  const commit = (fn: (d: Deck) => Deck, cur: number, sel: number[], say?: string) => {
    const before: Deck = { content: props.content, anim };
    const after = fn(before);
    history.current.undo.push({ before, after, at: [current, pick.sel.length ? pick.sel : [current]], to: [cur, sel] });
    if (history.current.undo.length > 100) history.current.undo.shift();
    history.current.redo = [];
    onEdit(() => after);
    show(cur, sel);
    setToast(say ? { text: say, key: Date.now() } : null);
  };
  // 匯入（`docImport.ts`）：投影片接在最後面（原本只有空白投影片就換掉），經過 commit 才能復原
  const importRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const importFile = async (f: File) => {
    setImporting(true);
    try {
      const got = await importSlides(f.name, new Uint8Array(await f.arrayBuffer()), saveImported);
      if (!got.length) return setToast({ text: `There were no slides in ${f.name}`, key: Date.now() });
      const r = withImportedSlides(props.content, anim, got);
      const added = got.map((_s, i) => r.first + i);
      commit((d) => ({ ...d, content: r.content, anim: r.anim }), r.first, added, `Imported ${got.length} ${got.length === 1 ? "slide" : "slides"} from ${f.name}`);
    } catch (err) {
      console.error("Import failed", err);
      setToast({ text: `Couldn't import ${f.name}: ${err instanceof Error ? err.message : String(err)}`, key: Date.now() });
    } finally {
      setImporting(false);
    }
  };
  const same = (a: Deck, b: Deck) => a.content === b.content && sameAnim(a.anim, b.anim);
  /** 復原／重做：內容在那之後被改過（例如打字）就不能再復原結構操作 */
  const undo = (redo = false) => {
    const h = history.current;
    const step = (redo ? h.redo : h.undo).pop();
    if (!step) return;
    const now: Deck = { content: props.content, anim };
    if (!same(now, redo ? step.before : step.after)) {
      h.undo = [];
      h.redo = [];
      return setToast({ text: "Can't undo: the slides were edited since", key: Date.now() });
    }
    (redo ? h.undo : h.redo).push(step);
    onEdit(() => (redo ? step.after : step.before));
    const [cur, sel] = redo ? step.to : step.at;
    show(cur, sel);
    setToast(null);
  };

  const sorted = (idx: number[]) => [...new Set(idx)].sort((a, b) => a - b);
  const add = (at: number) => commit((d) => ({ content: insertSlide(d.content, at), anim: animInsert(d.anim, at) }), at, [at]);
  const duplicate = (idx: number[]) => {
    const s = sorted(idx);
    const at = s[s.length - 1] + 1;
    const added = s.map((_x, k) => at + k);
    commit((d) => ({ content: duplicateSlides(d.content, s).md, anim: animDuplicate(d.anim, s, splitSlides(d.content).length) }), added[0], added);
  };
  const remove = (idx: number[]) => {
    if (slides.length <= 1 && !slides[0]?.trim()) return;
    const left = slides.length - idx.length;
    const next = Math.max(0, Math.min(Math.min(...idx), left - 1));
    commit(
      (d) => ({ content: removeSlides(d.content, idx), anim: animRemove(d.anim, idx) }),
      next,
      [next],
      `Deleted ${idx.length === 1 ? "a slide" : `${idx.length} slides`}`,
    );
  };
  const move = (idx: number[], before: number) => {
    const set = new Set(idx);
    const next = moveGroup(order, (i) => set.has(i), before);
    const moved = next.flatMap((x, k) => (set.has(x) ? [k] : []));
    if (next.every((x, k) => x === k)) return;
    commit(
      (d) => ({ content: moveSlides(d.content, idx, before).md, anim: animReorder(d.anim, moveGroup(order, (i) => set.has(i), before)) }),
      Math.max(0, next.indexOf(current)),
      moved,
    );
  };
  /** 往上（-1）或往下（1）挪一格 */
  const nudge = (idx: number[], dir: -1 | 1) => {
    const s = sorted(idx);
    if (dir < 0 ? s[0] <= 0 : s[s.length - 1] >= slides.length - 1) return;
    move(s, dir < 0 ? s[0] - 1 : s[s.length - 1] + 2);
  };
  const copy = (idx: number[], data?: DataTransfer | null) => {
    const s = sorted(idx);
    const text = joinSlides(s.map((i) => slides[i] ?? ""));
    clip = { text, anim: s.map((i) => animAt(anim, i)) };
    if (data) data.setData("text/plain", text);
    else navigator.clipboard?.writeText(text).catch(() => {});
    setToast({ text: `Copied ${s.length === 1 ? "a slide" : `${s.length} slides`}`, key: Date.now() });
  };
  const cut = (idx: number[], data?: DataTransfer | null) => {
    copy(idx, data);
    remove(idx);
  };
  /** 貼在選取的最後一張後面；文字跟剪貼簿記住的一樣才帶動畫 */
  const paste = (text: string | null, after: number) => {
    const src = text ?? clip?.text;
    if (!src?.trim()) return;
    const texts = splitSlides(src);
    const withAnim = !!clip && (text === null || sameSlides(text, clip.text));
    const at = after + 1;
    const added = texts.map((_t, k) => at + k);
    commit(
      (d) => ({
        content: insertSlides(d.content, at, texts),
        anim: animSplice(d.anim, at, texts.map((_t, k) => (withAnim ? animAt(clip!.anim, k) : animAt([], k)))),
      }),
      added[0],
      added,
    );
  };
  /** 改這張投影片的文字；打出分隔線多出投影片時，動畫也跟著往後移 */
  const write = (text: string) =>
    onEdit((d) => {
      const before = splitSlides(d.content).length;
      const content = setSlide(d.content, current, text);
      return { content, anim: animInsert(d.anim, current + 1, splitSlides(content).length - before) };
    });

  const group = targets(current);
  const many = group.length > 1;
  /** 編輯畫面上的動畫預覽（每次換選項都重播） */
  const [preview, setPreview] = useState(0);
  const animate = (patch: Partial<SlideAnim>, all = false) => {
    commit((d) => ({ ...d, anim: setAnim(d.anim, all ? order : group, patch) }), current, pick.sel.length ? pick.sel : [current]);
    setPreview((p) => p + 1);
  };
  const last = (idx: number[]) => Math.max(...idx);
  /** 這張投影片上選取的物件（換張就清掉） */
  const [boxSel, setBoxSel] = useState<string[]>([]);
  useEffect(() => setBoxSel([]), [current]);
  const meta = animAt(anim, current);
  /** 改這張投影片的物件；history 是記不記結構操作的復原 */
  const editMeta = (fn: (m: SlideAnim) => SlideAnim, history = true) => {
    const apply = (d: Deck): Deck => ({ ...d, anim: setMeta(d.anim, current, fn) });
    if (history) commit(apply, current, pick.sel.length ? pick.sel : [current]);
    else onEdit(apply);
  };
  const addBox = (b: SlideBox) => {
    editMeta((m) => ({ ...m, boxes: [...(m.boxes ?? []), b] }));
    setBoxSel([b.id]);
    if (b.kind === "text") setAutoEdit(b.id);
  };
  const [autoEdit, setAutoEdit] = useState<string | null>(null);
  /** 刪掉主文字方塊（跟 PowerPoint 刪掉版面配置的文字框一樣）：內容清空、藏起來；objs 是一起刪的物件 */
  const deleteBody = (objs: string[]) => {
    commit(
      (d) => ({
        content: setSlide(d.content, current, ""),
        anim: setMeta(d.anim, current, (m) => {
          const out: SlideAnim = { ...m, noBody: true, boxes: removeBoxes(m.boxes ?? [], objs) };
          delete out.main;
          return out;
        }),
      }),
      current,
      pick.sel.length ? pick.sel : [current],
    );
    setBoxSel([]);
  };
  /** 把主文字方塊加回來並開始編輯 */
  const addBody = () => {
    editMeta((m) => {
      const out = { ...m };
      delete out.noBody;
      return out;
    });
    setBoxSel([MAIN]);
    setAutoEdit(MAIN);
  };
  const editingText = st.active && (st.editing || st.selected > 0);
  /** 背景、跳過：套用到選取的投影片（記復原） */
  const setSlideMeta = (patch: Partial<SlideAnim>) =>
    commit(
      (d) => {
        let a = d.anim;
        for (const i of group) a = setMeta(a, i, (m) => {
          const out: SlideAnim = { ...m, ...patch };
          for (const k of Object.keys(patch) as (keyof SlideAnim)[]) if (patch[k] === undefined) delete out[k];
          return out;
        });
        return { ...d, anim: a };
      },
      current,
      pick.sel.length ? pick.sel : [current],
    );

  // 投影片上的 Ctrl＋Z／Y：沒在編輯文字、最後一次改動是物件或投影片的操作，就復原它（在編輯器自己的復原之前）
  const undoRef = useRef({ undo, content: props.content, anim });
  undoRef.current = { undo, content: props.content, anim };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k !== "z" && k !== "y") return;
      const a = document.activeElement as HTMLElement | null;
      if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.closest(".deck-strip"))) return;
      const s = editorBus.status();
      if (s.root && scope.current?.contains(s.root) && (s.editing || s.selected)) return;
      const redo = k === "y" || e.shiftKey;
      const h = history.current;
      const step = (redo ? h.redo : h.undo)[(redo ? h.redo : h.undo).length - 1];
      const now: Deck = { content: undoRef.current.content, anim: undoRef.current.anim };
      if (!step || !same(now, redo ? step.before : step.after)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      undoRef.current.undo(redo);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
    // same 只比較內容，不會變
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const cur = animAt(anim, current);
  const sel = pick.sel.length ? pick.sel : [current];

  const tile = (on: boolean, label: string, glyph: string, title: string, onClick: () => void) => (
    <button key={glyph} className={`dc-fx${on ? " on" : ""}`} title={title} aria-pressed={on} onClick={onClick}>
      <FxGlyph fx={glyph} />
      <span>{label}</span>
    </button>
  );

  return (
    <DeckContext.Provider value={props.deck}>
    <div className="office deck-office" ref={scope}>
      <Toolbar>
        <TMenu icon={<GalleryIcon />} label="View" title="Navigator or Light Table">
          {(close) => (
            <>
              <MenuItem label="Navigator" current={view === "navigator"} onClick={() => (close(), setView("navigator"))} />
              <MenuItem label="Light Table" current={view === "table"} onClick={() => (close(), setView("table"))} />
            </>
          )}
        </TMenu>
        <TBtn icon={<PlusIcon />} label="Add Slide" title="Add a slide after this one (Ctrl+M)" onClick={() => add(current + 1)} />
        <TBtn icon={<PlayIcon />} label="Play" title="Play from this slide" accent onClick={() => props.onPresent(current)} />
        <span className="dc-sep" />
        <TBtn icon={<TextIcon />} label="Text" title="Add a text box" onClick={() => addBox(newTextBox(meta.boxes ?? []))} />
        <TMenu icon={<ShapesIcon />} label="Shape" title="Add a shape">
          {(close) =>
            SHAPES.map((sh) => (
              <MenuItem key={sh.id} icon={<ShapeGlyph shape={sh.id} />} label={sh.label} onClick={() => (close(), addBox(newShapeBox(meta.boxes ?? [], sh.id)))} />
            ))
          }
        </TMenu>
        <TMenu icon={<ImageIcon />} label="Media" title="Add a picture or a video">
          {(close) => (
            <>
              <MenuItem icon={<ImageIcon />} label="Photo or Image…" onClick={() => (close(), pickImageBox(meta.boxes ?? [], addBox))} />
              <MenuItem icon={<VideoIcon />} label="Video in Text…" onClick={() => (close(), run((c) => c.insert("video")))} />
            </>
          )}
        </TMenu>
        <TBtn icon={<TableIcon />} label="Table" title="Insert a table in the text you're editing" onClick={() => run((c) => c.insert("table"))} />
        <TBtn
          icon={<ImportIcon />}
          label={importing ? "Importing…" : "Import"}
          title="Add slides from PowerPoint (.pptx), OpenDocument (.odp) or Markdown (--- between slides) after the last slide"
          disabled={importing}
          onClick={() => importRef.current?.click()}
        />
        <input
          ref={importRef}
          type="file"
          accept={SLIDES_IMPORT}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void importFile(f);
          }}
        />
        <span className="dc-gap" />
        <TBtn icon={<PanelRightIcon />} label="Format" title="Show or hide the Format inspector" on={panel === "format"} onClick={() => setPanel(panel === "format" ? null : "format")} />
        <TBtn icon={<AnimIcon />} label="Animate" title="Show or hide the Animate inspector" on={panel === "animate"} onClick={() => setPanel(panel === "animate" ? null : "animate")} />
        <TBtn icon={<DocIcon />} label="Document" title="Show or hide the Document inspector" on={panel === "document"} onClick={() => setPanel(panel === "document" ? null : "document")} />
      </Toolbar>
      <div className="deck">
        {view === "table" && (
          <LightTable
            slides={slides}
            anim={anim}
            current={current}
            onOpen={(i) => {
              onCurrent(i);
              setView("navigator");
            }}
            onPick={onCurrent}
          />
        )}
        {view === "navigator" && (
        <>
        <SlideStrip
          slides={slides}
          current={current}
          pick={pick}
          onPick={setPick}
          onCurrent={onCurrent}
          anim={anim}
          canPaste={!!clip}
          act={{
            add: (at) => add(Math.min(at, slides.length)),
            remove: (i) => remove(targets(i)),
            duplicate: (i) => duplicate(targets(i)),
            move: (i, before) => move(targets(i), before),
            nudge: (i, dir) => nudge(targets(i), dir),
            copy: (i, data) => copy(targets(i), data),
            cut: (i, data) => cut(targets(i), data),
            paste: (i, text) => paste(text, i < 0 ? slides.length - 1 : last(targets(i))),
            undo: () => undo(),
            redo: () => undo(true),
            present: (i) => props.onPresent(i),
          }}
        />
        <div className="deck-stage" ref={stage}>
          <div className="deck-canvas-wrap" style={{ width }}>
            <SlideCanvas
              key={current}
              source={slides[current] ?? ""}
              meta={meta}
              width={width}
              onText={write}
              onMeta={editMeta}
              sel={boxSel}
              onSel={setBoxSel}
              autoEdit={autoEdit}
              onAutoEdited={() => setAutoEdit(null)}
              onDeleteBody={deleteBody}
              num={current + 1}
            />
            {preview > 0 && (
              <AnimPreview
                key={`${preview}-${current}`}
                slides={slides}
                anim={anim}
                i={current}
                width={width}
                onDone={() => setPreview(0)}
              />
            )}
          </div>
          <textarea
            key={`notes-${current}`}
            className="deck-notes editor-ui"
            placeholder="Click to add speaker notes"
            defaultValue={meta.notes ?? ""}
            style={{ width }}
            onKeyDown={(e) => e.stopPropagation()}
            // 打字就存（不記投影片的復原；工具列按下去不會讓這裡失去焦點，所以不能等 blur）
            onChange={(e) => {
              const notes = e.target.value;
              editMeta((m) => {
                const out: SlideAnim = { ...m, notes };
                if (!notes.trim()) delete out.notes;
                return out;
              }, false);
            }}
          />
          <div className="dc-count" role="status">
            Slide {current + 1} of {slides.length}
            {meta.skip && " · Skipped"}
            {sel.length > 1 && ` · ${sel.length} selected`}
            {toast && (
              <span className="deck-toast" key={toast.key}>
                {toast.text}
                {history.current.undo.length > 0 && toast.text.startsWith("Deleted") && (
                  <button onClick={() => undo()} title="Undo (Ctrl+Z)">
                    Undo
                  </button>
                )}
              </span>
            )}
          </div>
        </div>
        </>
        )}
        {panel === "format" && (
          // 分頁：Style（段落樣式、物件或投影片的外觀）、Text、Paragraph（含區塊樣式）；選了物件才有 Arrange
          <FormatInspector tabs={boxSel.length ? ["style", "text", "paragraph", "arrange"] : ["style", "text", "paragraph"]} tab={fmtTab} onTab={setFmtTab}>
            {(t) =>
              t === "text" ? (
                <TextStyleFormat st={st} run={run} hint={TEXT_HINT} />
              ) : t === "paragraph" ? (
                <ParagraphLayoutFormat st={st} run={run} hint={TEXT_HINT} />
              ) : t === "arrange" ? (
                <BoxFormat part="arrange" meta={meta} sel={boxSel} onMeta={(fn) => editMeta(fn)} onSel={setBoxSel} onDeleteBody={deleteBody} />
              ) : (
          <>
            {editingText && <ParagraphStyleFormat st={st} run={run} styles={SLIDE_STYLES} lib={props.styles} />}
            {meta.noBody && !boxSel.length && !(slides[current] ?? "").trim() && (
              <Section title="Slide Layout">
                <button className="dp-btn" onClick={addBody}>
                  <TextIcon /> Add Body Text
                </button>
              </Section>
            )}
            <BoxFormat part="style" meta={meta} sel={boxSel} onMeta={(fn) => editMeta(fn)} onSel={setBoxSel} onDeleteBody={deleteBody} />
            {!boxSel.length && (
              <Section title={many ? `Slide Background · ${group.length} slides` : "Slide Background"}>
                <div className="deck-bgs">
                  <button className={`deck-bg theme${!cur.bg ? " on" : ""}`} title="Theme background" style={{ background: themeOf(props.deck).c.bg }} onClick={() => setSlideMeta({ bg: undefined })} />
                  {SLIDE_BGS.map((b) => (
                    <button key={b.id} className={`deck-bg${cur.bg === b.id ? " on" : ""}`} title={b.label} style={{ background: b.id }} onClick={() => setSlideMeta({ bg: b.id })} />
                  ))}
                </div>
                <label className="dc-check">
                  <input type="checkbox" checked={!!cur.skip} onChange={(e) => setSlideMeta({ skip: e.target.checked ? true : undefined })} /> Skip slide when presenting
                </label>
              </Section>
            )}
          </>
              )
            }
          </FormatInspector>
        )}
        {panel === "animate" && (
          <Inspector title="Animate">
            <Section title={many ? `Transition · ${group.length} slides` : "Slide Transition"}>
              <div className="dc-fx-grid">
                {TRANSITIONS.map((t) => tile(cur.transition === t.id, t.label, t.id, `${t.label} transition`, () => animate({ transition: t.id })))}
              </div>
            </Section>
            <Section title={many ? `Build In · ${group.length} slides` : "Build In"}>
              <div className="dc-fx-grid">
                {BUILDS.map((b) =>
                  tile(cur.build === b.id, b.label, `b-${b.id}`, b.id === "none" ? "Show the whole slide at once" : `${b.label}: one block per click`, () => animate({ build: b.id })),
                )}
              </div>
              <Field label="Delivery">
                <span className="dc-static">{cur.build === "none" ? "All at once" : "By paragraph"}</span>
              </Field>
              <p className="dc-note">When presenting, each block and list item comes in on a click. The opening heading is there from the start.</p>
            </Section>
            <Section>
              <div className="dc-btns">
                <button className="dp-btn" disabled={!isAnimated(cur)} onClick={() => setPreview((p) => p + 1)}>
                  <PlayIcon /> Preview
                </button>
                <button className="dp-btn" onClick={() => animate({ transition: cur.transition, build: cur.build }, true)} title="Use this transition and build on every slide">
                  Apply to All Slides
                </button>
              </div>
            </Section>
          </Inspector>
        )}
        {panel === "document" && (
          <Inspector title="Document">
            <Section title="Presentation">
              <Field label="Slide Size">
                <span className="dc-static">Widescreen 16:9</span>
              </Field>
              <Field label="Slides">
                <span className="dc-static">{slides.length}</span>
              </Field>
            </Section>
            <Section title="Theme">
              <div className="deck-themes">
                {DECK_THEMES.map((t) => (
                  <button
                    key={t.id}
                    className={`deck-theme${themeOf(props.deck).id === t.id ? " on" : ""}`}
                    title={t.label}
                    onClick={() => props.onDeck({ ...props.deck, theme: t.id === "white" ? undefined : t.id })}
                  >
                    <span className="deck-theme-swatch" style={{ background: t.c.bg, color: t.c.text }}>
                      <b>Aa</b>
                      <i style={{ background: t.c.accent }} />
                    </span>
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
            </Section>
            <Section title="Slide Numbers & Footer">
              <label className="dc-check" style={{ marginTop: 0 }}>
                <input type="checkbox" checked={!!props.deck.numbers} onChange={(e) => props.onDeck({ ...props.deck, numbers: e.target.checked || undefined })} /> Slide numbers
              </label>
              <input
                className="dc-input"
                style={{ marginTop: 10 }}
                key={props.deck.footer ?? ""}
                defaultValue={props.deck.footer ?? ""}
                placeholder="Footer text"
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                onBlur={(e) => e.target.value !== (props.deck.footer ?? "") && props.onDeck({ ...props.deck, footer: e.target.value.trim() || undefined })}
              />
            </Section>
            <Section title="Play">
              <div className="dc-btns">
                <button className="dp-btn" onClick={() => props.onPresent(0)}>
                  <ShowIcon /> From Beginning
                </button>
                <button className="dp-btn" onClick={() => props.onPresent(current)}>
                  <PlayIcon /> From This Slide
                </button>
              </div>
              <p className="dc-note">← → or Space to move on, Esc to stop.</p>
            </Section>
          </Inspector>
        )}
      </div>
    </div>
    </DeckContext.Provider>
  );
}

/** Light Table（像 Keynote 的看片台、PowerPoint 的投影片瀏覽）：全部投影片排成格子；點一下選取、連按兩下打開 */
function LightTable(props: { slides: string[]; anim: SlideAnim[]; current: number; onOpen: (i: number) => void; onPick: (i: number) => void }) {
  return (
    <div className="deck-table" role="listbox" aria-label="Slides">
      {props.slides.map((s, i) => (
        <button
          key={i}
          role="option"
          aria-selected={i === props.current}
          className={`deck-table-item${i === props.current ? " on" : ""}${props.anim[i]?.skip ? " skip" : ""}`}
          onClick={() => props.onPick(i)}
          onDoubleClick={() => props.onOpen(i)}
          onKeyDown={(e) => e.key === "Enter" && props.onOpen(i)}
          title="Double-click to open this slide"
        >
          <SlideView source={s} meta={props.anim[i]} width={220} num={i + 1} />
          <span>{i + 1}</span>
        </button>
      ))}
    </div>
  );
}

/** 簡報的 Text、Paragraph 分頁沒有在編輯文字時的提示 */
const TEXT_HINT = "Click in the slide’s text, or double-click a text box, to format it.";

const SLIDE_STYLES: ParaStyle[] = [
  { type: "h1", label: "Title", cls: "s-title" },
  { type: "h2", label: "Heading", cls: "s-h2" },
  { type: "h3", label: "Subheading", cls: "s-h3" },
  { type: "paragraph", label: "Body", cls: "s-body" },
];

/** 形狀選單的小圖 */
function ShapeGlyph(props: { shape: ShapeKind }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <g transform="translate(2 3)">
        <path d={shapePath(props.shape, 12, 10)} fill="none" stroke="currentColor" strokeWidth="1.3" />
      </g>
    </svg>
  );
}

/** 轉場、逐項顯示的小圖（功能區的效果庫） */
function FxGlyph(props: { fx: string }) {
  const frame = <rect x="1" y="1" width="28" height="20" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />;
  const lines = (o: number[]) =>
    o.map((op, k) => <path key={k} d={`M7 ${7 + k * 4}h${16 - k * 3}`} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity={op} />);
  const inner = (() => {
    switch (props.fx) {
      case "none":
      case "b-none":
        return props.fx === "none" ? <path d="M6 17 24 5" stroke="currentColor" strokeWidth="1.2" opacity=".5" /> : lines([1, 1, 1]);
      case "fade":
        return <rect x="4" y="4" width="22" height="14" rx="1" fill="currentColor" opacity=".25" />;
      case "push":
        return (
          <>
            <rect x="4" y="4" width="9" height="14" rx="1" fill="currentColor" opacity=".2" />
            <rect x="15" y="4" width="11" height="14" rx="1" fill="currentColor" opacity=".55" />
            <path d="M18 11h-6m2-2-2 2 2 2" stroke="currentColor" strokeWidth="1.2" fill="none" />
          </>
        );
      case "cover":
        return (
          <>
            <rect x="4" y="4" width="22" height="14" rx="1" fill="currentColor" opacity=".15" />
            <rect x="12" y="4" width="14" height="14" rx="1" fill="currentColor" opacity=".55" />
          </>
        );
      case "wipe":
        return (
          <>
            <rect x="4" y="4" width="12" height="14" fill="currentColor" opacity=".5" />
            <path d="M16 3v16" stroke="currentColor" strokeWidth="1.2" />
          </>
        );
      case "zoom":
        return (
          <>
            <rect x="10" y="7" width="10" height="8" rx="1" fill="currentColor" opacity=".5" />
            <path d="M5 4l4 3M25 4l-4 3M5 18l4-3M25 18l-4-3" stroke="currentColor" strokeWidth="1.1" />
          </>
        );
      case "b-appear":
        return lines([1, 1, 0.15]);
      case "b-fade":
        return lines([1, 0.55, 0.15]);
      case "b-rise":
        return (
          <>
            {lines([1, 0.15, 0.15])}
            <path d="M22 18v-6m-2 2 2-2 2 2" stroke="currentColor" strokeWidth="1.2" fill="none" />
          </>
        );
      case "b-zoom":
        return (
          <>
            {lines([1, 0.15, 0.15])}
            <circle cx="22" cy="15" r="3" fill="none" stroke="currentColor" strokeWidth="1.2" />
          </>
        );
      default:
        return null;
    }
  })();
  return (
    <svg className="dc-fxg" viewBox="0 0 30 22" aria-hidden>
      {frame}
      {inner}
    </svg>
  );
}

/** 兩段投影片文字是否一樣（每張不算前後空行） */
const sameSlides = (a: string, b: string) => {
  const x = splitSlides(a);
  const y = splitSlides(b);
  return x.length === y.length && x.every((s, i) => sameSlide(s, y[i]));
};

/** 編輯畫面上的預覽：蓋在投影片上播一次轉場與逐項顯示，播完（或點一下）就消失 */
function AnimPreview(props: { slides: string[]; anim: SlideAnim[]; i: number; width: number; onDone: () => void }) {
  const a = animAt(props.anim, props.i);
  const { onDone } = props;
  const [leaving, setLeaving] = useState<Leaving | null>(() =>
    a.transition === "none" ? null : { i: props.i - 1, step: Infinity, back: false, transition: a.transition, key: 1 },
  );
  const [step, setStep] = useState(0);
  const [count, setCount] = useState(-1);
  useEffect(() => {
    if (count < 0) return;
    if (leaving) {
      const t = setTimeout(() => setLeaving(null), TRANSITION_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => (a.build !== "none" && step < count ? setStep(step + 1) : onDone()), step < count && a.build !== "none" ? BUILD_MS + 250 : 700);
    return () => clearTimeout(t);
  }, [leaving, step, count, a.build, onDone]);
  return (
    <div className="deck-preview" style={{ width: props.width }} onPointerDown={onDone} title="Click to stop the preview">
      <Stage slides={props.slides} anim={props.anim} width={props.width} i={props.i} step={step} fresh leaving={leaving} onCount={setCount} />
    </div>
  );
}

/** 縮圖上的操作（i 是按到的那張；它在多選裡就處理整組；-1 是縮圖以外的空白處） */
type StripActions = {
  add: (at: number) => void;
  remove: (i: number) => void;
  duplicate: (i: number) => void;
  move: (i: number, before: number) => void;
  nudge: (i: number, dir: -1 | 1) => void;
  copy: (i: number, data: DataTransfer | null) => void;
  cut: (i: number, data: DataTransfer | null) => void;
  paste: (i: number, text: string | null) => void;
  undo: () => void;
  redo: () => void;
  present: (i: number) => void;
};

/**
 * 左邊的投影片縮圖（參考 PowerPoint）：點了切換；Ctrl／Shift＋點群選；拖曳排序（指標事件，拖選取中的整組一起搬）；
 * 兩張之間滑過出現＋插入；右鍵選單。按鍵：↑↓（加 Shift 延伸）、Home／End、Ctrl＋↑↓ 搬移、Ctrl＋A、
 * Ctrl＋D 複製、Ctrl＋M 新增、Ctrl＋C／X／V、Ctrl＋Z／Y 復原重做、Delete（不確認，可以復原）、Esc。
 * 不用 Enter 當快捷鍵：點了投影片卻沒進入編輯時，打字的 Enter 會變成新增投影片。
 */
function SlideStrip(props: {
  slides: string[];
  current: number;
  pick: Picked<number>;
  onPick: (p: Picked<number>) => void;
  onCurrent: (i: number) => void;
  anim: SlideAnim[];
  canPaste: boolean;
  act: StripActions;
}) {
  const { pick, onPick, act } = props;
  const list = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; i: number } | null>(null);
  const n = props.slides.length;
  const order = props.slides.map((_s, i) => i);
  const thumbs = () => [...(list.current?.querySelectorAll<HTMLElement>(".deck-thumb") ?? [])];

  // 換了目前這張：捲到看得見；焦點在縮圖上就跟著移過去（按鍵搬移、貼上、復原之後）
  useEffect(() => {
    const on = list.current?.querySelector<HTMLElement>(".deck-thumb.on");
    on?.scrollIntoView({ block: "nearest" });
    if (on && list.current?.contains(document.activeElement) && document.activeElement !== on && document.activeElement?.classList.contains("deck-thumb")) on.focus();
  }, [props.current, n]);

  // 剪貼簿：焦點在縮圖上時，Ctrl＋C／X／V 是投影片（在 window 的捕捉階段處理，編輯器的剪貼簿處理不會也動作）
  const live = useRef({ act, current: props.current });
  live.current = { act, current: props.current };
  useEffect(() => {
    const focused = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || !list.current?.contains(el)) return null;
      const t = el.closest<HTMLElement>(".deck-thumb");
      return t ? Number(t.dataset.i) : live.current.current;
    };
    const handle = (e: ClipboardEvent) => {
      const i = focused();
      if (i === null) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const { act } = live.current;
      if (e.type === "copy") act.copy(i, e.clipboardData);
      else if (e.type === "cut") act.cut(i, e.clipboardData);
      else act.paste(i, e.clipboardData?.getData("text/plain") || null);
    };
    for (const t of ["copy", "cut", "paste"]) window.addEventListener(t, handle as EventListener, true);
    return () => {
      for (const t of ["copy", "cut", "paste"]) window.removeEventListener(t, handle as EventListener, true);
    };
  }, []);

  const dragged = (i: number) =>
    drag !== null && (drag.from === i || (pick.sel.length > 1 && pick.sel.includes(drag.from) && pick.sel.includes(i)));

  const down = (e: React.PointerEvent, i: number) => {
    if (e.button !== 0) return;
    const mods = { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey };
    const y0 = e.clientY;
    let started = false;
    let over = -1;
    const move = (ev: PointerEvent) => {
      if (!started && Math.abs(ev.clientY - y0) < 5) return;
      started = true;
      const rows = thumbs();
      over = rows.length;
      for (let k = 0; k < rows.length; k++) {
        const r = rows[k].getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) {
          over = k;
          break;
        }
      }
      setDrag({ from: i, over });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (!started) {
        if (mods.ctrl || mods.shift) return onPick(clickPick(order, pick, i, mods));
        onPick({ sel: [i], anchor: i });
        return props.onCurrent(i);
      }
      if (over >= 0) act.move(i, over);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const go = (to: number) => {
    onPick({ sel: [to], anchor: to });
    props.onCurrent(to);
    requestAnimationFrame(() => thumbs()[to]?.focus());
  };

  const key = (e: React.KeyboardEvent, i: number) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const dir = e.key === "ArrowDown" ? 1 : -1;
      if (ctrl) act.nudge(i, dir);
      else {
        const r = stepPick(order, pick.sel.length ? pick : { sel: [i], anchor: i }, i, dir, e.shiftKey);
        if (r.to !== null) {
          const to = r.to;
          onPick(r.pick);
          if (!e.shiftKey) props.onCurrent(to);
          requestAnimationFrame(() => thumbs()[to]?.focus());
        }
      }
    } else if (e.key === "Home" || e.key === "End") go(e.key === "Home" ? 0 : n - 1);
    else if (ctrl && k === "a") onPick({ sel: order, anchor: 0 });
    else if (ctrl && k === "d") act.duplicate(i);
    else if (ctrl && k === "m") act.add(i + 1);
    else if (ctrl && k === "z") (e.shiftKey ? act.redo : act.undo)();
    else if (ctrl && k === "y") act.redo();
    else if (e.key === "Delete" || e.key === "Backspace") act.remove(i);
    else if (e.key === "Escape") onPick({ sel: [], anchor: null });
    else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      const r = thumbs()[i]?.getBoundingClientRect();
      if (r) setMenu({ x: r.left + 40, y: r.top + 30, i });
    } else return;
    // 不讓編輯器（掛在 window 上的選取按鍵）也處理
    e.preventDefault();
    e.stopPropagation();
  };

  const openMenu = (e: React.MouseEvent, i: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (i >= 0 && !pick.sel.includes(i)) {
      onPick({ sel: [i], anchor: i });
      props.onCurrent(i);
    }
    setMenu({ x: e.clientX, y: e.clientY, i });
  };

  return (
    <aside
      className={`deck-strip no-box${drag ? " dragging" : ""}`}
      ref={list}
      role="listbox"
      aria-multiselectable
      aria-label="Slides"
      onContextMenu={(e) => openMenu(e, -1)}
    >
      {props.slides.map((s, i) => (
        <div
          key={i}
          data-i={i}
          className={`deck-thumb${props.anim[i]?.skip ? " skip" : ""}${i === props.current ? " on" : ""}${pick.sel.includes(i) ? " sel" : ""}${dragged(i) ? " moving" : ""}${
            drag && drag.over === i ? " drop-before" : ""
          }${drag && drag.over === n && i === n - 1 ? " drop-after" : ""}`}
          role="option"
          aria-selected={pick.sel.includes(i)}
          tabIndex={i === props.current ? 0 : -1}
          aria-label={`Slide ${i + 1}`}
          onPointerDown={(e) => down(e, i)}
          onKeyDown={(e) => key(e, i)}
          onContextMenu={(e) => openMenu(e, i)}
        >
          <button
            className="deck-gap"
            tabIndex={-1}
            title="Insert a slide here"
            aria-label={`Insert a slide before slide ${i + 1}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => act.add(i)}
          >
            <PlusIcon />
          </button>
          <span className="deck-num">{i + 1}</span>
          <SlideView source={s} meta={props.anim[i]} width={168} num={i + 1} />
          {props.anim[i]?.skip && (
            <span className="deck-skip-mark" title="Skipped when presenting">
              <EyeOffIcon />
            </span>
          )}
          {isAnimated(props.anim[i]) && (
            <span className="deck-anim-mark" title="This slide has animation">
              <AnimIcon />
            </span>
          )}
          <span className="deck-thumb-tools" onPointerDown={(e) => e.stopPropagation()}>
            <button title="Duplicate (Ctrl+D)" tabIndex={-1} onClick={() => act.duplicate(i)}>
              <CopyIcon />
            </button>
            <button title="Delete (Delete)" tabIndex={-1} onClick={() => act.remove(i)}>
              <TrashIcon />
            </button>
          </span>
        </div>
      ))}
      <button className="deck-add" onClick={() => act.add(n)} title="Add a slide at the end">
        <PlusIcon /> New slide
      </button>
      {menu && (
        <StripMenu
          {...menu}
          count={menu.i >= 0 && pick.sel.length > 1 && pick.sel.includes(menu.i) ? pick.sel.length : 1}
          first={menu.i >= 0 && Math.min(...(pick.sel.includes(menu.i) ? pick.sel : [menu.i])) === 0}
          lastOne={menu.i >= 0 && Math.max(...(pick.sel.includes(menu.i) ? pick.sel : [menu.i])) === n - 1}
          canPaste={props.canPaste}
          act={act}
          onClose={() => setMenu(null)}
        />
      )}
    </aside>
  );
}

/** 縮圖的右鍵選單（跟編輯器、白板的右鍵選單同一套外觀；放到 body，不會被縮圖列裁切） */
function StripMenu(props: {
  x: number;
  y: number;
  i: number;
  count: number;
  first: boolean;
  lastOne: boolean;
  canPaste: boolean;
  act: StripActions;
  onClose: () => void;
}) {
  const { i, act, onClose } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: props.x, top: props.y });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      left: Math.max(8, Math.min(props.x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(props.y, window.innerHeight - r.height - 8)),
    });
  }, [props.x, props.y]);
  useEffect(() => {
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    const scroll = (e: Event) => !ref.current?.contains(e.target as Node) && onClose();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);
  useEffect(() => ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(), []);
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const item = (label: string, icon: React.ReactNode, hint: string, fn: () => void, opts: { disabled?: boolean; danger?: boolean } = {}) => (
    <button role="menuitem" className={opts.danger ? "danger" : undefined} disabled={opts.disabled} onClick={run(fn)}>
      <span className="glyph">{icon}</span>
      <span className="label">{label}</span>
      <span className="hint">{hint}</span>
    </button>
  );
  const many = props.count > 1;
  return createPortal(
    <div
      className="popover block-menu deck-menu"
      ref={ref}
      style={pos}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        // ↑↓ 在選單項目之間移動
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        e.stopPropagation();
        const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const k = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(k + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }}
    >
      {i < 0 ? (
        <>
          {item("New slide", <PlusIcon />, "", act.add.bind(null, Number.MAX_SAFE_INTEGER))}
          {item("Paste", <PasteIcon />, "Ctrl+V", () => act.paste(-1, null), { disabled: !props.canPaste })}
        </>
      ) : (
        <>
          {many && <div className="popover-title">{props.count} slides</div>}
          {item("New slide", <PlusIcon />, "Ctrl+M", () => act.add(i + 1))}
          {item(many ? "Duplicate slides" : "Duplicate slide", <CopyIcon />, "Ctrl+D", () => act.duplicate(i))}
          <div className="popover-sep" />
          {item("Cut", <CutIcon />, "Ctrl+X", () => act.cut(i, null))}
          {item("Copy", <CopyIcon />, "Ctrl+C", () => act.copy(i, null))}
          {item("Paste", <PasteIcon />, "Ctrl+V", () => act.paste(i, null), { disabled: !props.canPaste })}
          <div className="popover-sep" />
          {item("Move up", <ArrowUpIcon />, "Ctrl+↑", () => act.nudge(i, -1), { disabled: props.first })}
          {item("Move down", <ArrowDownIcon />, "Ctrl+↓", () => act.nudge(i, 1), { disabled: props.lastOne })}
          {item("Present from here", <PlayIcon />, "", () => act.present(i))}
          <div className="popover-sep" />
          {item(many ? `Delete ${props.count} slides` : "Delete slide", <TrashIcon />, "Del", () => act.remove(i), { danger: true })}
        </>
      )}
    </div>,
    document.body,
  );
}

/**
 * 全螢幕放映：← → 空白鍵往前往後（有逐項顯示時先一項一項出現），點一下往前，Esc 結束。
 * 換張時播新投影片的轉場；往回時倒著播離開那張的轉場，回到的投影片是全部出現的樣子。
 */
export function Presenter(props: { slides: string[]; anim: SlideAnim[]; start: number; onClose: () => void }) {
  const n = props.slides.length;
  /** 往 dir 方向找下一張沒有跳過的（全部都跳過就照原本的） */
  const shown = (from: number, dir: 1 | -1) => {
    for (let k = from; k >= 0 && k < n; k += dir) if (!animAt(props.anim, k).skip) return k;
    return -1;
  };
  const [view, setView] = useState(() => {
    const s = Math.max(0, Math.min(props.start, n - 1));
    const i = shown(s, 1) >= 0 ? shown(s, 1) : shown(s, -1) >= 0 ? shown(s, -1) : s;
    return { i, step: 0, fresh: false };
  });
  const [notes, setNotes] = useState(false);
  const [leaving, setLeaving] = useState<Leaving | null>(null);
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [count, setCount] = useState(0);
  const { onClose, anim } = props;
  const i = view.i;

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving(null), TRANSITION_MS);
    return () => clearTimeout(t);
  }, [leaving]);

  const go = (to: number, back: boolean) => {
    if (to < 0 || to >= n || to === view.i) return;
    const t = animAt(anim, back ? view.i : to).transition;
    setLeaving(t === "none" ? null : { i: view.i, step: view.step, back, transition: t, key: Date.now() });
    setView({ i: to, step: back ? Infinity : 0, fresh: false });
  };
  const builds = animAt(anim, i).build !== "none";
  const next = () => {
    if (builds && view.step < count) setView({ i, step: view.step + 1, fresh: true });
    else go(shown(i + 1, 1), false);
  };
  const prev = () => {
    const s = Math.min(view.step, count);
    if (builds && s > 0) setView({ i, step: s - 1, fresh: false });
    else go(shown(i - 1, -1), true);
  };
  const first = Math.max(0, shown(0, 1));
  const last = Math.max(0, shown(n - 1, -1));
  const nav = useRef({ next, prev, go, first, last });
  nav.current = { next, prev, go, first, last };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) nav.current.next();
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) nav.current.prev();
      else if (e.key === "Home") nav.current.go(nav.current.first, true);
      else if (e.key === "End") nav.current.go(nav.current.last, false);
      else if (e.key.toLowerCase() === "n") setNotes((v) => !v);
      else if (e.key === "Escape") onClose();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    const resize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("keydown", key, true);
    window.addEventListener("resize", resize);
    document.documentElement.requestFullscreen?.().catch(() => {});
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", resize);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [n, onClose]);
  useEffect(() => {
    const exit = () => !document.fullscreenElement && onClose();
    document.addEventListener("fullscreenchange", exit);
    return () => document.removeEventListener("fullscreenchange", exit);
  }, [onClose]);
  const w = Math.min(size.w, (size.h * SLIDE_W) / SLIDE_H);
  return (
    <div className="presenter" onClick={next}>
      <Stage
        slides={props.slides}
        anim={anim}
        width={w}
        i={i}
        step={view.step}
        fresh={view.fresh}
        leaving={leaving}
        onCount={setCount}
      />
      {notes && (
        <div className="pr-notes" onClick={(e) => e.stopPropagation()}>
          {animAt(anim, i).notes?.trim() || <span className="pr-notes-empty">No speaker notes for this slide.</span>}
        </div>
      )}
      <div className="pr-bar" onClick={(e) => e.stopPropagation()}>
        <button onClick={prev} disabled={i === first && !(builds && Math.min(view.step, count) > 0)} title="Previous (←)">
          <ChevronLeftIcon />
        </button>
        <span>
          {i + 1} / {n}
        </span>
        <button onClick={next} disabled={i === last && !(builds && view.step < count)} title="Next (→)">
          <ChevronRightIcon />
        </button>
        <button className={notes ? "on" : ""} onClick={() => setNotes((v) => !v)} title="Speaker notes (N)">
          <NoteIcon />
        </button>
        <button onClick={onClose} title="Stop (Esc)">
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
