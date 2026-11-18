import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DeskIcon, PlusIcon, TrashIcon, WhiteboardIcon } from "../editor/icons";
import { dayTitle } from "../journal/journal";
import type { Docs } from "../journal/useJournals";
import { pageKey } from "../pages/pageRef";
import { newDatabase, parseDatabase, serializeDatabase } from "../database/model";
import { parseBoard, serializeBoard, type Card, type CardRef } from "./board";
import { cardsToRows, placeNotes } from "./bridge";
import { Dock, kindIcon } from "./Dock";
import { addDoc, appendMarkdown, cardsMarkdown, fileStats, parseFile, updateDoc, type DeskFile } from "./file";
import { forgetCamera, loadDockDoc, saveDockDoc } from "./store";
import { Whiteboard, type SendTarget } from "./Whiteboard";
import "../database/database.css";
import "./board.css";
import "./desk.css";

export type DeskTab = "board" | "dock";

/**
 * Desk（側邊欄「Desk」）：所有檔案的清單。每個檔案是一個專案，裡面有 Whiteboard（發想）與 Dock（整理）。
 */
export function DeskView(props: {
  files: Docs;
  onOpen: (name: string) => void;
  onCreate: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const names = useMemo(() => [...(props.files.dates ?? [])].sort((a, b) => a.localeCompare(b, "zh-Hant")), [props.files.dates]);
  const contents = props.files.contents;
  return (
    <div className="dbs-view desk-list">
      <h1 className="dbs-title">Desk</h1>
      <p className="desk-intro">
        Each file is one project: a <b>Whiteboard</b> to think out loud — stick ideas anywhere, in any order — and a <b>Dock</b> to
        shape them into Word documents, slides, databases and notes you can publish.
      </p>
      <button className="dbs-new no-box" onClick={() => setAdding(true)} disabled={adding}>
        <PlusIcon /> New file
      </button>
      {props.files.ready && !names.length && !adding ? (
        <div className="dbs-empty no-box">
          <strong>Your desk is clear</strong>
          Click <b>New file</b> to start a project.
        </div>
      ) : (
        <div className="dbs-list no-box">
          {adding && (
            <NewRow
              taken={names}
              onDone={(name) => {
                setAdding(false);
                if (name) props.onCreate(name);
              }}
            />
          )}
          {names.map((n) => {
            const s = fileStats(contents[n] ?? "");
            const f = parseFile(contents[n] ?? "");
            return (
              <div
                key={n}
                className="dbs-row"
                role="button"
                tabIndex={0}
                onClick={() => props.onOpen(n)}
                onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && props.onOpen(n)}
              >
                <DeskIcon className="dbs-icon" />
                <span className="dbs-name">{n}</span>
                <span className="desk-docs">
                  {f.docs.slice(0, 3).map((d) => (
                    <span key={d.id} className="desk-doc" title={d.title}>
                      {kindIcon(d.kind)}
                      {d.title}
                    </span>
                  ))}
                  {f.docs.length > 3 && <span className="desk-doc more">+{f.docs.length - 3}</span>}
                </span>
                <span className="dbs-meta">
                  {s.cards === 1 ? "1 card" : `${s.cards} cards`} · {s.docs === 1 ? "1 document" : `${s.docs} documents`}
                </span>
                <button
                  className="dbs-del"
                  title="Delete file"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onDelete(n);
                  }}
                >
                  <TrashIcon />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NewRow(props: { taken: string[]; onDone: (name: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const [value, setValue] = useState("");
  useEffect(() => ref.current?.focus(), []);
  const finish = (v: string) => {
    if (done.current) return;
    done.current = true;
    props.onDone(v.trim());
  };
  const exists = props.taken.find((n) => pageKey(n) === pageKey(value.trim()));
  return (
    <div className="dbs-row editing">
      <DeskIcon className="dbs-icon" />
      <input
        ref={ref}
        className="dbs-input"
        value={value}
        placeholder="File name"
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") finish(value);
          else if (e.key === "Escape") finish("");
        }}
        onBlur={() => finish(value)}
      />
      {exists && <span className="dbs-meta">Opens “{exists}”</span>}
    </div>
  );
}

/* ─── 一個檔案：Whiteboard／Dock ─── */

export function FileView(props: {
  name: string;
  json: string | undefined;
  tab: DeskTab;
  onTab: (t: DeskTab) => void;
  onModify: (fn: (f: DeskFile) => DeskFile) => void;
  pages: Docs;
  journals: Docs;
  pageNames: string[];
  now: string;
  onOpenRef: (ref: CardRef) => void;
  /** 資料庫的列標題連到同名頁面 */
  onOpenPage: (title: string) => void;
  hasPage: (title: string) => boolean;
}) {
  const { name, onModify, pages, journals, now } = props;
  const file = useMemo(() => parseFile(props.json ?? ""), [props.json]);
  const boardJson = useMemo(() => serializeBoard(file.board), [file.board]);
  const [active, setActiveState] = useState<string | null>(() => loadDockDoc(name));
  const setActive = useCallback(
    (id: string | null) => {
      setActiveState(id);
      if (id) saveDockDoc(name, id);
    },
    [name],
  );

  const onWrite = useCallback((j: string) => onModify((f) => ({ ...f, board: parseBoard(j) })), [onModify]);

  const source = (c: Card) => {
    if (c.ref.kind === "note") return { title: "", content: c.text };
    if (c.ref.kind === "page") return { title: c.ref.name, content: pages.contents[c.ref.name] ?? "" };
    return { title: dayTitle(c.ref.date, now), content: journals.contents[c.ref.date] ?? "" };
  };
  const onSend = (cards: Card[], to: SendTarget): string => {
    if ("doc" in to) {
      const doc = file.docs.find((d) => d.id === to.doc);
      if (!doc) return "";
      if (doc.kind === "database") {
        onModify((f) => {
          const d = f.docs.find((x) => x.id === to.doc);
          return d ? updateDoc(f, d.id, { content: serializeDatabase(cardsToRows(parseDatabase(d.content), cards, source)) }) : f;
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
      to.kind === "database"
        ? serializeDatabase(cardsToRows({ ...newDatabase(), rows: [] }, cards, source))
        : cardsMarkdown(cards, source, to.kind);
    const r = addDoc(file, to.kind, undefined, to.kind === "database" ? add : add ? add + "\n" : "");
    const made = r.file.docs[r.file.docs.length - 1];
    onModify((f) => ({ ...f, docs: [...f.docs, made] }));
    setActive(made.id);
    return made.title;
  };

  if (props.json === undefined) return <div className="board-loading">Loading…</div>;
  return (
    <div className="desk-file">
      <div className="desk-tabs" role="tablist">
        <button className={props.tab === "board" ? "on" : ""} role="tab" aria-selected={props.tab === "board"} onClick={() => props.onTab("board")}>
          <WhiteboardIcon /> Whiteboard
          <span className="dt-count">{file.board.cards.length}</span>
        </button>
        <button className={props.tab === "dock" ? "on" : ""} role="tab" aria-selected={props.tab === "dock"} onClick={() => props.onTab("dock")}>
          <DeskIcon /> Dock
          <span className="dt-count">{file.docs.length}</span>
        </button>
        <span className="dt-hint">{props.tab === "board" ? "Think: put ideas anywhere, in any order" : "Shape: turn ideas into something to publish"}</span>
      </div>
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
          dock={file.docs.map((d) => ({ id: d.id, title: d.title, kind: d.kind }))}
          onSend={onSend}
          onOpenDoc={(id) => {
            if (id) setActive(id);
            props.onTab("dock");
          }}
        />
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
