import DOMPurify from "dompurify";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Editor } from "../editor/Editor";
import { DatabaseView } from "../database/DatabaseView";
import { parseDatabase, serializeDatabase, titleOf, type Database } from "../database/model";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DatabaseIcon,
  DocIcon,
  ExportIcon,
  NoteIcon,
  PlayIcon,
  PlusIcon,
  SendIcon,
  SlidesIcon,
  TrashIcon,
} from "../editor/icons";
import { rowNote, toCsv } from "./bridge";
import { renderMarkdown } from "../editor/markdown";
import { PURIFY, resolveMedia } from "../editor/media";
import { saveExport, toDocx, toPptx } from "./export";
import { addDoc, DOCK_KINDS, kindLabel, moveDoc, removeDoc, splitSlides, updateDoc, type DeskFile, type DockDoc, type DockKind } from "./file";

/**
 * Dock：把白板上的想法整理成可以發表的文件。左邊是這個檔案的文件清單（拖曳排序），右邊編輯。
 *
 * - Note：一般頁面。
 * - Word：Markdown 寫，「Preview」看 A4 分頁；匯出 .docx。
 * - Slides：Markdown 寫，單獨一行的 `---`（前面空一行）分張；「Preview」看投影片、「Present」全螢幕放映；匯出 .pptx。
 * - Database：參考 Notion 的資料庫（表格、看板）；「Send to Whiteboard」把選的列變成便利貼；匯出 .csv。
 */

const html = (md: string) => DOMPurify.sanitize(resolveMedia(renderMarkdown(md)), PURIFY) as string;

export const kindIcon = (k: DockKind) =>
  k === "slides" ? <SlidesIcon /> : k === "word" ? <DocIcon /> : k === "database" ? <DatabaseIcon /> : <NoteIcon />;

export function Dock(props: {
  /** Desk 檔案名稱（匯出的預設檔名） */
  name: string;
  file: DeskFile;
  onChange: (fn: (f: DeskFile) => DeskFile) => void;
  active: string | null;
  onActive: (id: string | null) => void;
  onOpenPage: (title: string) => void;
  hasPage: (title: string) => boolean;
  /** 把文字變成白板上的便利貼（資料庫的列） */
  onSendNotes: (texts: string[]) => void;
}) {
  const { file, onChange } = props;
  const doc = file.docs.find((d) => d.id === props.active) ?? file.docs[0] ?? null;
  const [adding, setAdding] = useState(false);

  const create = (kind: DockKind) => {
    setAdding(false);
    // 先用目前的檔案決定新文件（標題、id），再加到最新的檔案裡
    const r = addDoc(file, kind);
    const made = r.file.docs[r.file.docs.length - 1];
    onChange((f) => ({ ...f, docs: [...f.docs, made] }));
    props.onActive(r.id);
  };

  return (
    <div className="dock">
      <aside className="dock-side">
        <div className="ds-head">
          <span>Documents</span>
          <button className="icon-btn" title="New document" onClick={() => setAdding((v) => !v)}>
            <PlusIcon />
          </button>
        </div>
        {adding && <KindPicker onPick={create} onClose={() => setAdding(false)} />}
        <DocList
          docs={file.docs}
          active={doc?.id ?? null}
          onOpen={props.onActive}
          onMove={(id, to) => onChange((f) => moveDoc(f, id, to))}
          onDelete={(d) => {
            if (!window.confirm(`Delete “${d.title}” from the Dock? This can't be undone.`)) return;
            onChange((f) => removeDoc(f, d.id));
            if (doc?.id === d.id) props.onActive(null);
          }}
        />
        {!file.docs.length && !adding && <p className="ds-empty">Nothing here yet. Send cards from the whiteboard, or start a document with +.</p>}
      </aside>
      <section className="dock-main">
        {doc ? (
          <DocPane
            key={doc.id}
            fileName={props.name}
            doc={doc}
            onChange={(patch) => onChange((f) => updateDoc(f, doc.id, patch))}
            onModifyDb={(fn) =>
              onChange((f) => {
                const d = f.docs.find((x) => x.id === doc.id);
                return d ? updateDoc(f, d.id, { content: serializeDatabase(fn(parseDatabase(d.content))) }) : f;
              })
            }
            onOpenPage={props.onOpenPage}
            hasPage={props.hasPage}
            onSendNotes={props.onSendNotes}
          />
        ) : (
          <div className="dock-start">
            <h2>Shape your ideas into something to publish</h2>
            <p>Pick what to make. You can also select cards on the whiteboard and choose Send to Dock.</p>
            <div className="dock-kinds">
              {DOCK_KINDS.map((k) => (
                <button key={k.kind} className="dock-kind no-box" onClick={() => create(k.kind)}>
                  <span className="dk-icon">{kindIcon(k.kind)}</span>
                  <strong>{k.label}</strong>
                  <span>{k.hint}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function KindPicker(props: { onPick: (k: DockKind) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.(".ds-head")) props.onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
    };
  });
  return (
    <div className="ds-kinds" ref={ref}>
      {DOCK_KINDS.map((k) => (
        <button key={k.kind} onClick={() => props.onPick(k.kind)}>
          {kindIcon(k.kind)}
          <span>{k.label}</span>
        </button>
      ))}
    </div>
  );
}

/** 文件清單：點了開啟；拖曳排序（指標事件）；滑過出現刪除。 */
function DocList(props: {
  docs: DockDoc[];
  active: string | null;
  onOpen: (id: string) => void;
  onMove: (id: string, to: number) => void;
  onDelete: (d: DockDoc) => void;
}) {
  const [drag, setDrag] = useState<{ id: string; over: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const down = (e: React.PointerEvent, d: DockDoc) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".dl-del")) return;
    const y0 = e.clientY;
    let started = false;
    let over = -1;
    const move = (ev: PointerEvent) => {
      if (!started && Math.abs(ev.clientY - y0) < 4) return;
      started = true;
      const rows = [...(listRef.current?.querySelectorAll<HTMLElement>(".dl-row") ?? [])];
      over = rows.length;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) {
          over = i;
          break;
        }
      }
      setDrag({ id: d.id, over });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (!started) return props.onOpen(d.id);
      const from = props.docs.findIndex((x) => x.id === d.id);
      const to = over > from ? over - 1 : over;
      if (to !== from && over >= 0) props.onMove(d.id, to);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div className={`dl${drag ? " dragging" : ""}`} ref={listRef}>
      {props.docs.map((d, i) => (
        <div
          key={d.id}
          className={`dl-row${d.id === props.active ? " on" : ""}${drag?.id === d.id ? " moving" : ""}${drag && drag.over === i ? " drop-before" : ""}${
            drag && drag.over === props.docs.length && i === props.docs.length - 1 ? " drop-after" : ""
          }`}
          role="button"
          tabIndex={0}
          onPointerDown={(e) => down(e, d)}
          onKeyDown={(e) => e.key === "Enter" && props.onOpen(d.id)}
          title={`${d.title} · ${kindLabel(d.kind)}`}
        >
          <span className="dl-icon">{kindIcon(d.kind)}</span>
          <span className="dl-title">{d.title}</span>
          <span className="dl-kind">{kindLabel(d.kind)}</span>
          <button className="dl-del" title="Delete document" onClick={() => props.onDelete(d)}>
            <TrashIcon />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ─── 一份文件 ─── */

function DocPane(props: {
  fileName: string;
  doc: DockDoc;
  onChange: (patch: Partial<Omit<DockDoc, "id">>) => void;
  onModifyDb: (fn: (db: Database) => Database) => void;
  onOpenPage: (title: string) => void;
  hasPage: (title: string) => boolean;
  onSendNotes: (texts: string[]) => void;
}) {
  const { doc, onChange } = props;
  const [picking, setPicking] = useState(false);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [present, setPresent] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 5000);
    return () => clearTimeout(t);
  }, [note]);
  const onContent = useCallback((content: string) => onChange({ content }), [onChange]);
  const slides = useMemo(() => (doc.kind === "slides" ? splitSlides(doc.content) : []), [doc.kind, doc.content]);

  const exportDoc = async () => {
    setBusy(true);
    try {
      const base = doc.title.trim() || props.fileName;
      let name: string;
      let bytes: Uint8Array;
      if (doc.kind === "word") {
        name = `${base}.docx`;
        bytes = await toDocx(doc.content);
      } else if (doc.kind === "slides") {
        name = `${base}.pptx`;
        bytes = await toPptx(doc.content, base);
      } else if (doc.kind === "database") {
        name = `${base}.csv`;
        bytes = new TextEncoder().encode(toCsv(parseDatabase(doc.content)));
      } else {
        name = `${base}.md`;
        bytes = new TextEncoder().encode(doc.content);
      }
      const path = await saveExport(name, bytes);
      setNote(path ? `Saved to ${path}` : `Downloaded ${name}`);
    } catch (err) {
      console.error("Export failed", err);
      setNote(`Couldn't export: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`doc-pane kind-${doc.kind}`}>
      <div className="dp-head">
        <TitleInput value={doc.title} onChange={(title) => onChange({ title })} />
        <span className="dp-kind">
          {kindIcon(doc.kind)} {kindLabel(doc.kind)}
          {doc.kind === "slides" && ` · ${slides.length} ${slides.length === 1 ? "slide" : "slides"}`}
        </span>
        <span className="dp-gap" />
        {doc.kind === "database" && (
          <button className="dp-btn" onClick={() => setPicking((v) => !v)} title="Turn rows into sticky notes on the whiteboard">
            <SendIcon /> Send to Whiteboard
          </button>
        )}
        {(doc.kind === "word" || doc.kind === "slides") && (
          <div className="dp-seg" role="tablist">
            <button className={mode === "write" ? "on" : ""} onClick={() => setMode("write")} role="tab" aria-selected={mode === "write"}>
              Write
            </button>
            <button className={mode === "preview" ? "on" : ""} onClick={() => setMode("preview")} role="tab" aria-selected={mode === "preview"}>
              Preview
            </button>
          </div>
        )}
        {doc.kind === "slides" && (
          <button className="dp-btn" onClick={() => setPresent(0)} disabled={!slides.length} title="Present full screen (Esc to stop)">
            <PlayIcon /> Present
          </button>
        )}
        <button className="dp-btn primary" onClick={exportDoc} disabled={busy} title="Save to your Downloads folder">
          <ExportIcon />{" "}
          {busy
            ? "Exporting…"
            : doc.kind === "word"
              ? "Export .docx"
              : doc.kind === "slides"
                ? "Export .pptx"
                : doc.kind === "database"
                  ? "Export .csv"
                  : "Export .md"}
        </button>
      </div>
      {note && (
        <div className="dp-note" role="status">
          {note}
        </div>
      )}
      {picking && doc.kind === "database" && (
        <RowPicker
          db={parseDatabase(doc.content)}
          onCancel={() => setPicking(false)}
          onSend={(texts) => {
            setPicking(false);
            props.onSendNotes(texts);
          }}
        />
      )}
      <div className="dp-body">
        {doc.kind === "database" ? (
          <div className="dp-db">
            <DatabaseView
              name={`desk:${props.fileName}:${doc.id}`}
              json={doc.content}
              ready
              onModify={props.onModifyDb}
              onOpenPage={props.onOpenPage}
              hasPage={props.hasPage}
            />
          </div>
        ) : mode === "write" || doc.kind === "note" ? (
          <div className={`dp-write${doc.kind === "word" ? " paper-width" : ""}`}>
            {doc.kind === "slides" && (
              <p className="dp-tip">
                Put <code>---</code> on its own line, after a blank line, to start a new slide. The first heading on a slide is its title.
              </p>
            )}
            <Editor value={doc.content} onChange={onContent} placeholder="Start writing…" />
          </div>
        ) : doc.kind === "word" ? (
          <Paper source={doc.content} />
        ) : (
          <SlideGrid slides={slides} onOpen={(i) => setPresent(i)} />
        )}
      </div>
      {present !== null && slides.length > 0 && <Presenter slides={slides} start={present} onClose={() => setPresent(null)} />}
    </div>
  );
}

/** 選要送到白板的列（預設選有標題的）。 */
function RowPicker(props: { db: Database; onSend: (texts: string[]) => void; onCancel: () => void }) {
  const { db } = props;
  const [picked, setPicked] = useState<Set<string>>(() => new Set(db.rows.filter((r) => titleOf(r).trim()).map((r) => r.id)));
  const all = picked.size === db.rows.length && db.rows.length > 0;
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <div className="row-picker">
      <div className="rp-head">
        <label>
          <input type="checkbox" checked={all} onChange={() => setPicked(all ? new Set() : new Set(db.rows.map((r) => r.id)))} />
          {picked.size} of {db.rows.length} rows
        </label>
        <span className="dp-gap" />
        <button className="dp-btn" onClick={props.onCancel}>
          Cancel
        </button>
        <button
          className="dp-btn primary"
          disabled={!picked.size}
          onClick={() => props.onSend(db.rows.filter((r) => picked.has(r.id)).map((r) => rowNote(db, r)))}
        >
          Add {picked.size === 1 ? "1 note" : `${picked.size} notes`} to the whiteboard
        </button>
      </div>
      <div className="rp-list">
        {db.rows.map((r) => (
          <label key={r.id} className="rp-row">
            <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
            <span className={titleOf(r).trim() ? "" : "rp-untitled"}>{titleOf(r).trim() || "Untitled"}</span>
          </label>
        ))}
        {!db.rows.length && <p className="rp-empty">This database has no rows.</p>}
      </div>
    </div>
  );
}

function TitleInput(props: { value: string; onChange: (v: string) => void }) {
  const [v, setV] = useState(props.value);
  useEffect(() => setV(props.value), [props.value]);
  const commit = () => {
    const t = v.trim();
    if (t && t !== props.value) props.onChange(t);
    else setV(props.value);
  };
  return (
    <input
      className="dp-title"
      value={v}
      spellCheck={false}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setV(props.value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/* ─── Word：A4 分頁預覽 ─── */

/** A4 在 96 dpi：794 × 1123 px；四邊留 1 吋（96 px） */
const PAGE_W = 794;
const PAGE_H = 1123;
const PAGE_M = 96;

function Paper(props: { source: string }) {
  const markup = useMemo(() => html(props.source), [props.source]);
  const measure = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [scale, setScale] = useState(1);

  const paginate = useCallback(() => {
    const el = measure.current;
    if (!el) return;
    const limit = PAGE_H - PAGE_M * 2;
    const out: string[][] = [[]];
    let used = 0;
    for (const child of [...el.children] as HTMLElement[]) {
      const st = getComputedStyle(child);
      const h = child.offsetHeight + parseFloat(st.marginTop) + parseFloat(st.marginBottom);
      if (used + h > limit && out[out.length - 1].length) {
        out.push([]);
        used = 0;
      }
      out[out.length - 1].push(child.outerHTML);
      used += h;
    }
    setPages(out.map((p) => p.join("")));
  }, []);

  useLayoutEffect(() => {
    paginate();
    // 圖片載入後高度會變
    const imgs = [...(measure.current?.querySelectorAll("img") ?? [])];
    imgs.forEach((i) => i.addEventListener("load", paginate));
    return () => imgs.forEach((i) => i.removeEventListener("load", paginate));
  }, [markup, paginate]);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, (el.clientWidth - 32) / PAGE_W)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="paper-host" ref={host}>
      <div className="paper-measure content paper-content" ref={measure} dangerouslySetInnerHTML={{ __html: markup }} />
      <div className="paper-stack" style={{ zoom: scale }}>
        {pages.map((p, i) => (
          <div key={i} className="paper-page">
            <div className="content paper-content" dangerouslySetInnerHTML={{ __html: p }} />
            <span className="paper-num">{i + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── 簡報 ─── */

/** 一張投影片（960×540 設計尺寸，用 zoom 縮放） */
function Slide(props: { source: string; width: number }) {
  const markup = useMemo(() => html(props.source), [props.source]);
  const lone = /^#\s/.test(props.source.trim()) && props.source.trim().split("\n").filter((l) => l.trim()).length <= 3;
  return (
    <div className="slide-frame" style={{ width: props.width, height: (props.width * 9) / 16 }}>
      <div className={`slide${lone ? " title-slide" : ""}`} style={{ zoom: props.width / 960 }}>
        <div className="content slide-content" dangerouslySetInnerHTML={{ __html: markup }} />
      </div>
    </div>
  );
}

function SlideGrid(props: { slides: string[]; onOpen: (i: number) => void }) {
  return (
    <div className="slide-grid">
      {props.slides.map((s, i) => (
        <button key={i} className="slide-thumb no-box" onClick={() => props.onOpen(i)} title="Present from this slide">
          <Slide source={s} width={320} />
          <span className="slide-num">{i + 1}</span>
        </button>
      ))}
    </div>
  );
}

/** 全螢幕放映：← → 空白鍵換頁，點一下下一張，Esc 結束。 */
function Presenter(props: { slides: string[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(Math.min(props.start, props.slides.length - 1));
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const n = props.slides.length;
  const { onClose } = props;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) setI((x) => Math.min(n - 1, x + 1));
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) setI((x) => Math.max(0, x - 1));
      else if (e.key === "Home") setI(0);
      else if (e.key === "End") setI(n - 1);
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
  const w = Math.min(size.w, (size.h * 16) / 9);
  return (
    <div className="presenter" onClick={() => setI((x) => Math.min(n - 1, x + 1))}>
      <Slide source={props.slides[i]} width={w} />
      <div className="pr-bar" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0} title="Previous (←)">
          <ChevronLeftIcon />
        </button>
        <span>
          {i + 1} / {n}
        </span>
        <button onClick={() => setI((x) => Math.min(n - 1, x + 1))} disabled={i === n - 1} title="Next (→)">
          <ChevronRightIcon />
        </button>
        <button onClick={onClose} title="Stop (Esc)">
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
