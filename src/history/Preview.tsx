import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Editor, unitDisplayHtml } from "../editor/Editor";
import { renderMarkdown } from "../editor/markdown";
import type { Docs } from "../journal/useJournals";
import { kindLabel, parseFile, splitSlides, type DeskFile, type DockDoc } from "../desk/file";
import { PaperEditor, PAGE_W } from "../desk/PaperEditor";
import { SlideView } from "../desk/SlideCanvas";
import { SheetView } from "../sheet/SheetView";
import { DrawView } from "../desk/DrawView";
import { Whiteboard } from "../desk/Whiteboard";
import { parseDiagram } from "../desk/draw";
import { TasksView } from "../desk/TasksView";
import { serializeTasks } from "../desk/tasks";
import { serializeBoard } from "../desk/board";
import { forgetCamera } from "../desk/store";
import { parseWorkbook } from "../sheet/model";
import type { SlideAnim } from "../desk/slideAnim";
import { diffBlocks, diffText } from "./diff";
import { mergeChanges } from "./merge";

/**
 * 版本的所見即所得預覽：用真正的畫面（編輯器、Word 的 A4 紙、投影片、Excel、Draw、白板）畫出那個版本，
 * 外面包 `inert` 變成唯讀（不能點、不能打字、不會變成「最後操作的編輯器」）。
 * Show changes 開著時和前一個版本比較，畫好之後直接在畫面上標記（參考 Google Docs）：
 * 新增的區塊標綠、刪掉的區塊插回原位劃線標紅，改過的區塊在字詞層級標出增刪；
 * Excel 標出改過的格子、Draw 標出新增或改過的圖形、白板標出新增／改過／刪掉的卡片。
 */

const noop = () => {};

/** HTML 的純文字 */
function plain(html: string): string {
  const t = document.createElement("template");
  t.innerHTML = html;
  return t.content.textContent ?? "";
}

/** 不碰的元素：按鈕、輸入框、任務符號與時間標籤這類 React 自己管的小元件 */
const SKIP = "button, input, select, textarea, svg, [contenteditable='false'], .vh-ins, .vh-del";

/**
 * 在元素裡標出和舊文字相比新增（`ins`）與刪掉（`del`）的字詞：只動文字節點，
 * 新增的包起來，刪掉的在原位插進一段（交界的刪除歸前一段文字，才不會跑進後面的粗體、連結裡）。
 */
export function markNode(root: Node, before: string): void {
  const nodes: Text[] = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const skip = n.parentElement?.closest(SKIP);
      return skip && root.contains(skip) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = walk.nextNode(); n; n = walk.nextNode()) nodes.push(n as Text);
  const after = nodes.map((n) => n.data).join("");
  const parts = diffText(before, after);
  const adds: [number, number][] = [];
  const dels: { at: number; text: string }[] = [];
  let pos = 0;
  for (const p of parts) {
    if (p.op === "same") pos += p.text.length;
    else if (p.op === "add") {
      adds.push([pos, pos + p.text.length]);
      pos += p.text.length;
    } else dels.push({ at: pos, text: p.text });
  }
  if (!adds.length && !dels.length) return;
  const mark = (tag: "ins" | "del", text: string) => {
    const el = document.createElement(tag);
    el.className = tag === "ins" ? "vh-ins" : "vh-del";
    el.textContent = text;
    return el;
  };
  let start = 0;
  nodes.forEach((node, ni) => {
    const end = start + node.data.length;
    const cuts = new Set<number>([start, end]);
    for (const [a, b] of adds) {
      if (a > start && a < end) cuts.add(a);
      if (b > start && b < end) cuts.add(b);
    }
    for (const d of dels) if (d.at > start && d.at < end) cuts.add(d.at);
    const points = [...cuts].sort((x, y) => x - y);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if ((p > start || ni === 0) && p <= end) for (const d of dels) if (d.at === p) frag.append(mark("del", d.text));
      if (i === points.length - 1) break;
      const q = points[i + 1];
      const text = node.data.slice(p - start, q - start);
      if (!text) continue;
      frag.append(adds.some(([a, b]) => p >= a && q <= b) ? mark("ins", text) : document.createTextNode(text));
    }
    node.replaceWith(frag);
    start = end;
  });
  if (!nodes.length) for (const d of dels) root.appendChild(mark("del", d.text));
}

/** 同上，給 HTML 字串用（測試用） */
export function markInline(html: string, before: string): string {
  const t = document.createElement("template");
  t.innerHTML = html;
  markNode(t.content, before);
  return t.innerHTML;
}

/**
 * 畫面畫好之後套上標記；畫面重畫（加了區塊、分頁、圖片載入）時再套一次。
 * 套標記本身會改到 DOM，所以套的時候先停止觀察。
 */
function useMarks(ref: RefObject<HTMLElement | null>, apply: (root: HTMLElement) => void, key: unknown) {
  const fn = useRef(apply);
  fn.current = apply;
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let frame = 0;
    const obs = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(run);
    });
    function run() {
      frame = 0;
      obs.disconnect();
      fn.current(root!);
      obs.observe(root!, { childList: true, subtree: true });
    }
    run();
    return () => {
      obs.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref, key]);
}

/** 版面寬度（Word、投影片縮放用） */
function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/* ─── Markdown：日記、頁面、筆記、Word ─── */

function MarkedEditor(props: { after: string; before?: string; changes: boolean; children: (source: string) => ReactNode }) {
  const { after, before, changes } = props;
  const merged = useMemo(
    () => (changes && before !== undefined ? mergeChanges(before, after) : { source: after, marks: [] }),
    [after, before, changes],
  );
  const ref = useRef<HTMLDivElement>(null);
  useMarks(
    ref,
    (root) => {
      for (const m of merged.marks) {
        const row = root.querySelector<HTMLElement>(`.row[data-start="${m.line}"]`);
        if (!row) continue;
        row.classList.add(m.op === "add" ? "vh-added" : m.op === "del" ? "vh-removed" : "vh-changed");
        if (m.op === "change" && m.old) {
          const c = row.querySelector(".content");
          if (c && !c.querySelector(".vh-ins, .vh-del")) markNode(c, plain(unitDisplayHtml(m.old)));
        }
      }
    },
    merged,
  );
  return (
    <div ref={ref} className="vh-live" inert>
      {props.children(merged.source)}
    </div>
  );
}

/** 日記、頁面、Dock 的筆記：和平常一樣的頁面（標題＋編輯器） */
export function PagePreview(props: { after: string; before?: string; changes: boolean; title?: string }) {
  return (
    <div className="vh-page">
      {props.title && <h1 className="page-title vh-page-title">{props.title}</h1>}
      {!props.after.trim() && !(props.changes && props.before?.trim()) ? (
        <p className="vh-empty">This version is empty.</p>
      ) : (
        <MarkedEditor after={props.after} before={props.before} changes={props.changes}>
          {(source) => <Editor value={source} onChange={noop} compact placeholder="" formatBar={false} />}
        </MarkedEditor>
      )}
    </div>
  );
}

/** Word：A4 紙、照版面設定分頁，寬度不夠時縮小 */
function WordPreview(props: { doc: DockDoc; before?: string; changes: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const w = useWidth(ref);
  const zoom = w ? Math.min(1, (w - 48) / PAGE_W) : 1;
  return (
    <div ref={ref} className="vh-word">
      <MarkedEditor after={props.doc.content} before={props.before} changes={props.changes}>
        {(source) => <PaperEditor value={source} onChange={noop} setup={props.doc.page} zoom={zoom} formatBar={false} />}
      </MarkedEditor>
    </div>
  );
}

/** 簡報：每張投影片照放映的樣子排下來；改過、新增、刪掉的投影片加框與標籤 */
function SlidesPreview(props: { doc: DockDoc; old?: DockDoc; changes: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const w = useWidth(ref);
  const width = Math.max(240, Math.min(800, w - 48));
  type S = { i: number; text: string; meta?: SlideAnim };
  const list = (d: DockDoc | undefined): S[] => (d ? splitSlides(d.content).map((text, i) => ({ i, text, meta: d.anim?.[i] })) : []);
  const rows = useMemo(() => {
    const now = list(props.doc);
    if (!props.changes || !props.old) return now.map((s) => ({ s, op: "same" as const, old: undefined as S | undefined }));
    const key = (s: S) => s.text.trim() + "\u0000" + JSON.stringify(s.meta ?? null);
    return diffBlocks(list(props.old), now, (s) => s.text.trim(), 0.35).map((o) =>
      o.op === "same"
        ? { s: o.b, op: key(o.a) === key(o.b) ? ("same" as const) : ("change" as const), old: o.a }
        : o.op === "add"
          ? { s: o.b, op: "add" as const, old: undefined }
          : o.op === "del"
            ? { s: o.a, op: "del" as const, old: undefined }
            : { s: o.b, op: "change" as const, old: o.a },
    );
  }, [props.doc, props.old, props.changes]);
  useMarks(
    ref,
    (root) => {
      root.querySelectorAll<HTMLElement>(".vh-slide[data-old]").forEach((el) => {
        const c = el.querySelector(".sl-main .slide-content");
        if (c && !c.querySelector(".vh-ins, .vh-del")) markNode(c, plain(renderMarkdown(el.dataset.old ?? "")));
      });
    },
    rows,
  );
  let n = 0;
  return (
    <div ref={ref} className="vh-slides" inert>
      {rows.map((r, k) => {
        const num = r.op === "del" ? null : ++n;
        return (
          <div key={k} className={`vh-slide${r.op !== "same" ? " s-" + r.op : ""}`} data-old={r.op === "change" && r.old ? r.old.text : undefined}>
            <div className="vh-slide-num">
              {num ?? "–"}
              {r.op !== "same" && <span className="vh-badge">{r.op === "add" ? "New" : r.op === "del" ? "Deleted" : "Changed"}</span>}
            </div>
            <SlideView source={r.s.text} meta={r.s.meta} width={width} />
          </div>
        );
      })}
    </div>
  );
}

/** Excel：真正的試算表畫面（唯讀）；改過的格子、新的表格加上標記。好幾張工作表時上面可以切換。 */
function SheetPreview(props: { doc: DockDoc; before?: string }) {
  const wb = useMemo(() => parseWorkbook(props.doc.content), [props.doc.content]);
  const [sheet, setSheet] = useState(wb.sheets[0].id);
  const shown = wb.sheets.find((s) => s.id === sheet) ?? wb.sheets[0];
  // SheetView 顯示第一張工作表：把要看的那張排到最前面
  const json = useMemo(() => JSON.stringify({ sheets: [shown, ...wb.sheets.filter((s) => s !== shown)] }), [wb, shown]);
  const changed = useMemo(() => {
    if (props.before === undefined) return null;
    const old = parseWorkbook(props.before);
    const oldTables = new Map(old.sheets.flatMap((s) => s.tables).map((t) => [t.id, t]));
    const cells: string[] = [];
    const tables: string[] = [];
    for (const t of shown.tables) {
      const o = oldTables.get(t.id);
      if (!o) {
        tables.push(t.id);
        continue;
      }
      const keys = new Set([...Object.keys(t.cells), ...Object.keys(o.cells)]);
      for (const k of keys) if ((t.cells[k]?.v ?? "") !== (o.cells[k]?.v ?? "")) cells.push(`${t.id}|${k}`);
    }
    return { cells, tables };
  }, [props.before, shown]);
  const ref = useRef<HTMLDivElement>(null);
  useMarks(
    ref,
    (root) => {
      if (!changed) return;
      for (const id of changed.tables) root.querySelector(`[data-tid="${id}"]`)?.classList.add("vh-added-box");
      for (const c of changed.cells) {
        const [tid, k] = c.split("|");
        const [r, col] = k.split(",");
        root.querySelector(`[data-tid="${tid}"] [data-r="${r}"][data-c="${col}"]`)?.classList.add("vh-cell-changed");
      }
    },
    changed,
  );
  return (
    <div className="vh-canvas">
      {wb.sheets.length > 1 && (
        <div className="vh-sheet-tabs">
          {wb.sheets.map((s) => (
            <button key={s.id} className={s.id === shown.id ? "on" : ""} onClick={() => setSheet(s.id)}>
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div ref={ref} className="vh-live vh-fill" inert>
        <SheetView key={shown.id} json={json} onModify={noop} />
      </div>
    </div>
  );
}

/** Draw：真正的畫布（唯讀）；新增或改過的圖形加上標記 */
function DrawPreview(props: { doc: DockDoc; before?: string }) {
  const camId = `vh-${props.doc.id}`;
  useEffect(() => () => localStorage.removeItem(`banyan.drawCam.${camId}`), [camId]);
  const changed = useMemo(() => {
    if (props.before === undefined) return null;
    const old = new Map(parseDiagram(props.before).shapes.map((s) => [s.id, JSON.stringify(s)]));
    return parseDiagram(props.doc.content)
      .shapes.filter((s) => old.get(s.id) !== JSON.stringify(s))
      .map((s) => ({ id: s.id, added: !old.has(s.id) }));
  }, [props.before, props.doc.content]);
  const ref = useRef<HTMLDivElement>(null);
  useMarks(
    ref,
    (root) => {
      for (const c of changed ?? []) root.querySelectorAll(`[data-shape="${c.id}"]`).forEach((el) => el.classList.add(c.added ? "vh-added-shape" : "vh-changed-shape"));
    },
    changed,
  );
  return (
    <div className="vh-canvas">
      <div ref={ref} className="vh-live vh-fill" inert>
        <DrawView docId={camId} title={props.doc.title} value={props.doc.content} onChange={noop} />
      </div>
    </div>
  );
}

/** 任務看板：真正的看板（唯讀），新增或改過的卡片加上標記 */
function TasksPreview(props: { after: DeskFile; before: DeskFile | null }) {
  const json = useMemo(() => serializeTasks(props.after.tasks ?? { lists: [], cards: [], labels: [] }), [props.after]);
  const changed = useMemo(() => {
    if (!props.before) return null;
    const old = new Map((props.before.tasks?.cards ?? []).map((c) => [c.id, JSON.stringify(c)]));
    return (props.after.tasks?.cards ?? []).filter((c) => old.get(c.id) !== JSON.stringify(c)).map((c) => ({ id: c.id, added: !old.has(c.id) }));
  }, [props.before, props.after]);
  const ref = useRef<HTMLDivElement>(null);
  useMarks(
    ref,
    (root) => {
      for (const c of changed ?? []) root.querySelectorAll(`[data-card="${c.id}"]`).forEach((el) => el.classList.add(c.added ? "vh-added-box" : "vh-changed-box"));
    },
    changed,
  );
  return (
    <div className="vh-canvas">
      <div ref={ref} className="vh-live vh-fill" inert>
        <TasksView stateKey="vh-tasks" title="" value={json} onChange={noop} />
      </div>
    </div>
  );
}

export interface BoardContext {
  name: string;
  pages: Docs;
  journals: Docs;
  pageNames: string[];
}

/** 白板：真正的白板（唯讀）；刪掉的卡片放回原位，新增／改過／刪掉的卡片加上標記 */
function BoardPreview(props: { after: DeskFile; before: DeskFile | null; ctx: BoardContext; now: string }) {
  const { after, before } = props;
  const merged = useMemo(() => {
    const board = after.board;
    if (!before) return { json: serializeBoard(board), marks: [] as { id: string; cls: string }[] };
    const old = new Map(before.board.cards.map((c) => [c.id, c]));
    const ids = new Set(board.cards.map((c) => c.id));
    const removed = before.board.cards.filter((c) => !ids.has(c.id));
    const marks = [
      ...board.cards.flatMap((c) => {
        const o = old.get(c.id);
        return !o ? [{ id: c.id, cls: "vh-added-box" }] : JSON.stringify(o) !== JSON.stringify(c) ? [{ id: c.id, cls: "vh-changed-box" }] : [];
      }),
      ...removed.map((c) => ({ id: c.id, cls: "vh-removed-box" })),
    ];
    return { json: serializeBoard({ ...board, cards: [...board.cards, ...removed] }), marks };
  }, [after, before]);
  const name = `vh:${props.ctx.name}`;
  useEffect(() => () => forgetCamera(name), [name]);
  const ref = useRef<HTMLDivElement>(null);
  useMarks(
    ref,
    (root) => {
      for (const m of merged.marks) root.querySelector(`.board-card[data-id="${m.id}"]`)?.classList.add(m.cls);
    },
    merged,
  );
  return (
    <div className="vh-canvas">
      <div ref={ref} className="vh-live vh-fill" inert>
        <Whiteboard
          name={name}
          json={merged.json}
          onWrite={noop}
          pages={props.ctx.pages}
          journals={props.ctx.journals}
          pageNames={props.ctx.pageNames}
          now={props.now}
          onOpen={noop}
          dock={after.docs.map((d) => ({ id: d.id, title: d.title, kind: d.kind }))}
          onSend={() => ""}
          onOpenDoc={noop}
        />
      </div>
    </div>
  );
}

/* ─── Desk 檔案的一部分 ─── */

/** Desk 檔案裡的一部分：白板（`board`）、任務看板（`tasks`）或一份 Dock 文件的 id。版本歷史只看正在處理的那一部分。 */
export const BOARD = "board";
export const TASKS = "tasks";

const docKey = (d: DockDoc) => JSON.stringify([d.title, d.kind, d.content, d.anim ?? null, d.page ?? null]);

/** 這一部分在某個版本的指紋（比較有沒有改）；這個版本沒有這份文件就是 null。 */
export function partKey(f: DeskFile, part: string): string | null {
  if (part === BOARD) return JSON.stringify(f.board);
  if (part === TASKS) return f.tasks ? JSON.stringify(f.tasks) : null;
  const d = f.docs.find((x) => x.id === part);
  return d ? docKey(d) : null;
}

/** 只留這一部分有改的版本（由舊到新；沒有這份文件的版本略過）。 */
export function partVersions<T>(items: T[], fileOf: (item: T) => DeskFile | undefined, part: string): T[] {
  const out: T[] = [];
  let last: string | null = null;
  for (const it of items) {
    const f = fileOf(it);
    if (!f) continue;
    const k = partKey(f, part);
    if (k === null || k === last) continue;
    out.push(it);
    last = k;
  }
  return out;
}

/** 這一部分的標題（「Report · Word」「Whiteboard」） */
export function partTitle(json: string, part: string): string {
  if (part === BOARD) return "Whiteboard";
  if (part === TASKS) return "Tasks";
  const d = parseFile(json).docs.find((x) => x.id === part);
  return d ? `${d.title} · ${kindLabel(d.kind)}` : "Document";
}

/** Desk 檔案某一部分（白板或一份 Dock 文件）的所見即所得預覽。 */
export function DeskPartPreview(props: { after: string; before?: string; changes: boolean; part: string; now: string; ctx: BoardContext }) {
  const after = useMemo(() => parseFile(props.after), [props.after]);
  const before = useMemo(() => (props.changes && props.before !== undefined ? parseFile(props.before) : null), [props.before, props.changes]);
  if (props.part === BOARD) return <BoardPreview after={after} before={before} ctx={props.ctx} now={props.now} />;
  if (props.part === TASKS) return after.tasks ? <TasksPreview after={after} before={before} /> : <p className="vh-empty">This version has no tasks yet.</p>;
  const d = after.docs.find((x) => x.id === props.part);
  if (!d) return <p className="vh-empty">This document doesn't exist in this version.</p>;
  const old = before?.docs.find((x) => x.id === d.id);
  // 沒有前一個版本就不比較；前一個版本沒有這份文件就是全部新增
  const prev: string | undefined = before ? (old?.content ?? "") : undefined;
  if (d.kind === "sheet") return <SheetPreview doc={d} before={prev} />;
  if (d.kind === "draw") return <DrawPreview doc={d} before={prev} />;
  if (d.kind === "word") return <WordPreview doc={d} before={prev} changes={props.changes} />;
  if (d.kind === "slides") return <SlidesPreview doc={d} old={before ? (old ?? { ...d, content: "", anim: [] }) : undefined} changes={props.changes} />;
  return <PagePreview after={d.content} before={prev} changes={props.changes} title={d.title} />;
}

/** 預覽要放在哪種版面：頁面（白底置中）、紙張與投影片（灰底捲動）、畫布（填滿） */
export function previewLayout(kind: "markdown" | "desk", json: string, part: string | null): "page" | "paper" | "canvas" {
  if (kind === "markdown" || part === null) return "page";
  if (part === BOARD || part === TASKS) return "canvas";
  const d = parseFile(json).docs.find((x) => x.id === part);
  return !d || d.kind === "note" ? "page" : d.kind === "word" || d.kind === "slides" ? "paper" : "canvas";
}
