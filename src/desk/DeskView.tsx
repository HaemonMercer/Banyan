import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BoardIcon, DeskIcon, WhiteboardIcon } from "../editor/icons";
import { dayTitle } from "../journal/journal";
import type { Docs } from "../journal/useJournals";
import { newWorkbook, parseWorkbook, serializeWorkbook } from "../sheet/model";
import { parseBoard, serializeBoard, type Card, type CardRef } from "./board";
import { cardsIntoWorkbook, placeNotes } from "./bridge";
import { sheetMarkdown } from "./boardSheet";
import { mediaCardMarkdown } from "./boardMedia";
import { codeFence } from "../editor/codeHighlight";
import { Dock } from "./Dock";
import { addDoc, appendMarkdown, cardsDiagram, cardsMarkdown, dockOrder, isDataKind, parseFile, updateDoc, type DeskFile } from "./file";
import { appendTaskCards, markdownCard, parseTasks, serializeTasks, starterTasks } from "./tasks";
import { TasksView } from "./TasksView";
import { diagramText } from "./draw";
import { forgetCamera, loadDockDoc, saveDockDoc, touchFile } from "./store";
import { Whiteboard, type SendTarget } from "./Whiteboard";
import "./board.css";
import "./desk.css";

export type DeskTab = "board" | "dock" | "tasks";

/** Alt+D：Whiteboard → Dock → Tasks → Whiteboard */
export const nextDeskTab = (t: DeskTab): DeskTab => (t === "board" ? "dock" : t === "dock" ? "tasks" : "board");

/** Desk 首頁（檔案清單）在 `DeskHome.tsx` */
export { DeskView } from "./DeskHome";

/* ─── 一個檔案：Whiteboard／Dock／Tasks ─── */

/** Whiteboard／Dock／Tasks 切換：只有圖示的分段按鈕，放在 App 頂端列的標題後面（名稱在提示裡，Alt+D 輪流換） */
export function DeskSwitch(props: { tab: DeskTab; onTab: (t: DeskTab) => void }) {
  const item = (t: DeskTab, label: string, icon: ReactNode) => (
    <button
      className={props.tab === t ? "on" : ""}
      role="tab"
      aria-selected={props.tab === t}
      aria-label={label}
      title={`${label} (Alt+D to switch)`}
      onClick={() => props.onTab(t)}
    >
      {icon}
    </button>
  );
  return (
    <div className="desk-switch" role="tablist" aria-label="Whiteboard, Dock or Tasks">
      {item("board", "Whiteboard", <WhiteboardIcon />)}
      {item("dock", "Dock", <DeskIcon />)}
      {item("tasks", "Tasks", <BoardIcon />)}
    </div>
  );
}

/** 改名的文字框：Enter 或離開時確定、Esc 取消（點擊不會傳到外面的卡片） */
export function RenameField(props: { value: string; className?: string; onDone: (name: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => ref.current?.select(), []);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    props.onDone(v);
  };
  return (
    <input
      ref={ref}
      className={`rename-field${props.className ? " " + props.className : ""}`}
      defaultValue={props.value}
      spellCheck={false}
      aria-label="File name"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.currentTarget.value);
        else if (e.key === "Escape") finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}

/** 頂端列的檔案名稱：按兩下改名 */
export function FileTitle(props: { name: string; onRename: (to: string) => Promise<string | null> }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <RenameField
        value={props.name}
        className="doc-title-input"
        onDone={(v) => {
          setEditing(false);
          if (v !== null && v.trim() && v.trim() !== props.name) void props.onRename(v).then((err) => err && window.alert(err));
        }}
      />
    );
  }
  return (
    <span className="doc-title file-title" title="Double-click to rename" onDoubleClick={() => setEditing(true)}>
      {props.name}
    </span>
  );
}

export function FileView(props: {
  name: string;
  json: string | undefined;
  tab: DeskTab;
  /** Dock 開著的文件（App 決定） */
  doc: string | null;
  /** 選了 Dock 的文件：換到 Dock 並開那份 */
  onDoc: (id: string) => void;
  onTab: (t: DeskTab) => void;
  onModify: (fn: (f: DeskFile) => DeskFile) => void;
  pages: Docs;
  journals: Docs;
  pageNames: string[];
  now: string;
  onOpenRef: (ref: CardRef) => void;
  /** 刪除卡片指向的頁面或日記（App 確認），回傳是否刪了 */
  onDeleteRef?: (ref: CardRef) => boolean;
  /** 資料庫的列標題連到同名頁面 */
  onOpenPage: (title: string) => void;
  hasPage: (title: string) => boolean;
}) {
  const { name, onModify, pages, journals, now } = props;
  const file = useMemo(() => parseFile(props.json ?? ""), [props.json]);
  const boardJson = useMemo(() => serializeBoard(file.board), [file.board]);
  // 還沒用過 Tasks 的檔案先給一個 To do／Doing／Done 的看板（第一次修改才寫進檔案）
  const tasksJson = useMemo(() => serializeTasks(file.tasks ?? starterTasks()), [file]);
  const onTasks = useCallback((j: string) => onModify((f) => ({ ...f, tasks: parseTasks(j) })), [onModify]);
  // Dock 開著的文件由 App 的畫面決定（會記進最近、可以收藏）；選別份文件就換畫面並記住
  const { onDoc } = props;
  const active = props.doc ?? loadDockDoc(name);
  const setActive = useCallback(
    (id: string | null) => {
      if (!id) return;
      saveDockDoc(name, id);
      onDoc(id);
    },
    [name, onDoc],
  );

  // 首頁的「Opened／Edited …」：打開時記一次，之後內容每次改變記成編輯
  useEffect(() => touchFile(name, "opened"), [name]);
  const seen = useRef<{ name: string; json: string | undefined }>({ name, json: props.json });
  useEffect(() => {
    const prev = seen.current;
    seen.current = { name, json: props.json };
    if (prev.name === name && prev.json !== undefined && props.json !== undefined && prev.json !== props.json) touchFile(name, "edited");
  }, [name, props.json]);

  const onWrite = useCallback((j: string) => onModify((f) => ({ ...f, board: parseBoard(j) })), [onModify]);

  const source = (c: Card) => {
    if (c.ref.kind === "note") return { title: "", content: c.text };
    if (c.ref.kind === "code") return { title: "Code", content: codeFence(c.text, c.ref.lang) };
    if (c.ref.kind === "media") return { title: c.ref.type === "image" ? "Image" : "Video", content: mediaCardMarkdown(c.ref) };
    // 圖表卡片送到 Draw 是整張圖表（`cardsDiagram`）；送到 Markdown 文件時寫出圖上的文字
    if (c.ref.kind === "draw") return { title: "Diagram", content: diagramText(c.text) };
    // 表格卡片送到 Excel 是整份活頁簿（`cardsIntoWorkbook`）；送到 Markdown 文件時是表格區塊（顯示的值）
    if (c.ref.kind === "sheet") return { title: "Table", content: sheetMarkdown(c.text) };
    if (c.ref.kind === "page") return { title: c.ref.name, content: pages.contents[c.ref.name] ?? "" };
    return { title: dayTitle(c.ref.date, now), content: journals.contents[c.ref.date] ?? "" };
  };
  // 送到任務看板：便利貼的第一行是卡片標題、其他是說明；其他卡片用它的名稱
  const taskItems = (cards: Card[]) =>
    cards.map((c) => {
      const s = source(c);
      return c.ref.kind === "note" ? markdownCard(s.content, "Note") : { title: s.title || "Untitled" };
    });
  const onSend = (cards: Card[], to: SendTarget): string => {
    if ("tasks" in to) {
      const items = taskItems(cards);
      onModify((f) => ({ ...f, tasks: appendTaskCards(f.tasks ?? starterTasks(), items) }));
      return "Tasks";
    }
    if ("doc" in to) {
      const doc = file.docs.find((d) => d.id === to.doc);
      if (!doc) return "";
      if (doc.kind === "sheet") {
        onModify((f) => {
          const d = f.docs.find((x) => x.id === to.doc);
          return d ? updateDoc(f, d.id, { content: serializeWorkbook(cardsIntoWorkbook(parseWorkbook(d.content), cards, source)) }) : f;
        });
        return doc.title;
      }
      if (doc.kind === "draw") {
        onModify((f) => {
          const d = f.docs.find((x) => x.id === to.doc);
          return d ? updateDoc(f, d.id, { content: cardsDiagram(d.content, cards, source) }) : f;
        });
        return doc.title;
      }
      const add = cardsMarkdown(cards, source, doc.kind);
      onModify((f) => {
        const d = f.docs.find((x) => x.id === to.doc);
        return d ? updateDoc(f, d.id, { content: appendMarkdown(d.content, add, d.kind) }) : f;
      });
      return doc.title;
    }
    const add =
      to.kind === "sheet"
        ? serializeWorkbook(cardsIntoWorkbook({ sheets: newWorkbook().sheets.map((s) => ({ ...s, tables: [] })) }, cards, source))
        : to.kind === "draw"
          ? cardsDiagram("", cards, source)
          : cardsMarkdown(cards, source, to.kind);
    const r = addDoc(file, to.kind, undefined, isDataKind(to.kind) ? add : add ? add + "\n" : "");
    const made = r.file.docs[r.file.docs.length - 1];
    onModify((f) => ({ ...f, docs: [...f.docs, made] }));
    // 留在白板上；之後打開 Dock 就是這份
    saveDockDoc(name, made.id);
    return made.title;
  };

  if (props.json === undefined) return <div className="board-loading">Loading…</div>;
  return (
    <div className="desk-file">
      {props.tab === "board" ? (
        <Whiteboard
          key={name}
          name={name}
          json={boardJson}
          onWrite={onWrite}
          pages={pages}
          journals={journals}
          pageNames={props.pageNames}
          now={now}
          onOpen={props.onOpenRef}
          onDeleteRef={props.onDeleteRef}
          dock={dockOrder(file).map((d) => ({ id: d.id, title: d.title, kind: d.kind }))}
          onSend={onSend}
          onOpenDoc={(id) => (id ? setActive(id) : props.onTab("dock"))}
          onOpenTasks={() => props.onTab("tasks")}
        />
      ) : props.tab === "tasks" ? (
        <TasksView stateKey={name} title={name} value={tasksJson} onChange={onTasks} />
      ) : (
        <Dock
          name={name}
          file={file}
          onChange={onModify}
          active={active}
          onActive={setActive}
          onOpenPage={props.onOpenPage}
          hasPage={props.hasPage}
          onSendNotes={(texts) => {
            onModify((f) => ({ ...f, board: placeNotes(f.board, texts).board }));
            // 新的便利貼在既有內容旁邊：白板打開時重新放進畫面，才看得到
            forgetCamera(name);
            props.onTab("board");
          }}
        />
      )}
    </div>
  );
}
