import { useMemo, useState } from "react";
import { TrashIcon, WhiteboardIcon } from "../editor/icons";
import type { Docs } from "../journal/useJournals";
import { cleanName, pageKey } from "../pages/pageRef";
import { boundsOf, cardRect, edgePath, parseBoard, type Board } from "./model";
import "./board.css";

/** 所有白板：縮圖、卡片數；上方輸入名稱按 Enter 新增或開啟。 */
export function BoardsView(props: {
  boards: Docs;
  onOpen: (name: string) => void;
  onCreate: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const names = useMemo(() => [...(props.boards.dates ?? [])].sort((a, b) => a.localeCompare(b)), [props.boards.dates]);
  const q = pageKey(query);
  const shown = q ? names.filter((n) => pageKey(n).includes(q)) : names;
  const name = cleanName(query);
  const exact = names.find((n) => pageKey(n) === q);

  return (
    <div className="boards-view">
      <header className="page-head no-box">
        <h1 className="page-title">Whiteboards</h1>
        <span className="page-note">{props.boards.ready ? `${names.length} whiteboards` : "Loading…"}</span>
      </header>
      <form
        className="page-search no-box"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name) return;
          if (exact) props.onOpen(exact);
          else props.onCreate(name);
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search whiteboards, or type a new whiteboard name and press Enter"
          spellCheck={false}
        />
      </form>
      <div className="page-list no-box">
        {name && !exact && (
          <button className="page-row create" onClick={() => props.onCreate(name)}>
            <span className="pr-name">+ Create whiteboard “{name}”</span>
          </button>
        )}
      </div>
      <div className="board-grid no-box">
        {shown.map((n) => {
          const b = parseBoard(props.boards.contents[n] ?? "");
          return (
            <div
              key={n}
              className="board-tile"
              role="button"
              tabIndex={0}
              onClick={() => props.onOpen(n)}
              onKeyDown={(e) => e.key === "Enter" && props.onOpen(n)}
            >
              <Thumb board={b} />
              <div className="bt-meta">
                <span className="bt-name">{n}</span>
                <span className="bt-stat">
                  {b.cards.length} {b.cards.length === 1 ? "card" : "cards"}
                </span>
              </div>
              <button
                className="bt-del"
                title="Delete whiteboard (the cards' pages are kept)"
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`Delete the whiteboard “${n}”? The pages and journals on it are kept.`)) props.onDelete(n);
                }}
              >
                <TrashIcon />
              </button>
            </div>
          );
        })}
      </div>
      {props.boards.ready && !names.length && !name && (
        <p className="backlinks-empty no-box">
          No whiteboards yet. Type a name above to create one, then lay out pages and journals as cards, connect them, and
          group them into sections.
        </p>
      )}
    </div>
  );
}

/** 白板縮圖：卡片、區段、連線的位置（卡片高度用估計值）。 */
function Thumb({ board }: { board: Board }) {
  const rects = [...board.cards.map((c) => cardRect(c, {})), ...board.sections];
  const b = boundsOf(rects);
  if (!b) return <svg className="bt-preview" aria-hidden />;
  const pad = 40;
  const vb = `${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}`;
  const byId = new Map(board.cards.map((c) => [c.id, c]));
  const sw = Math.max(b.w, b.h) / 160;
  return (
    <svg className="bt-preview" viewBox={vb} preserveAspectRatio="xMidYMid meet" aria-hidden>
      {board.sections.map((s) => (
        <rect key={s.id} className="section" x={s.x} y={s.y} width={s.w} height={s.h} rx={14} strokeWidth={sw} />
      ))}
      {board.edges.map((e) => {
        const a = byId.get(e.from);
        const z = byId.get(e.to);
        return a && z ? <path key={e.id} d={edgePath(cardRect(a), cardRect(z)).d} strokeWidth={sw * 1.5} /> : null;
      })}
      {board.cards.map((c) => {
        const r = cardRect(c, {});
        return <rect key={c.id} className="card" x={r.x} y={r.y} width={r.w} height={r.h} rx={10} strokeWidth={sw} />;
      })}
    </svg>
  );
}

/** 頁面、日記下方：這份文件放在哪些白板上。 */
export function OnBoards(props: { names: string[]; onOpen: (name: string) => void }) {
  if (!props.names.length) return null;
  return (
    <div className="on-boards no-box">
      <span>On whiteboards</span>
      {props.names.map((n) => (
        <button key={n} onClick={() => props.onOpen(n)}>
          <WhiteboardIcon /> {n}
        </button>
      ))}
    </div>
  );
}
