import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { BoardIcon, CalendarIcon, ExportIcon, CheckboxIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon, CloseIcon, MoreIcon, PlusIcon, TextIcon, TrashIcon } from "../editor/icons";
import { monthGrid, monthName, today, WEEKDAYS_SHORT } from "../journal/journal";
import { Field, Inspector, MenuItem, Section, TBtn, TMenu, Toolbar } from "./DocChrome";
import { saveExport } from "./export";
import { TASKS_VIEW_PREFIX } from "./store";
import {
  addCard,
  addCheck,
  addList,
  cardsByDay,
  checkProgress,
  dueLabel,
  dueState,
  hasDue,
  listCards,
  moveCard,
  moveList,
  parseTasks,
  removeCard,
  removeCheck,
  removeList,
  renameLabel,
  renameList,
  serializeTasks,
  tasksCsv,
  tasksMarkdown,
  toggleLabel,
  updateCard,
  updateCheck,
  type TaskBoard,
  type TaskCard,
} from "./tasks";
import "./tasks.css";

/**
 * Desk 檔案的 Tasks（參考 Trello；和 Whiteboard、Dock 並列的第三個分頁，看板存在 `DeskFile.tasks`）：Board 檢視是一欄一欄的清單與卡片，拖曳卡片換位置或換清單、
 * 拖曳清單標題換順序；有卡片設了截止日才出現 Calendar 檢視（月曆，拖到別天就是改截止日）。
 * 選了卡片，右邊的檢閱器（`DocChrome.tsx` 的 `Inspector`）改標題、清單、截止日、標籤、說明與檢查清單。
 *
 * 拖曳用指標事件（`data-list`、`data-card`、`data-date`），不要用 HTML5 drag／drop（Tauri 收不到）。
 * 改看板一律經過 `commit`（同時記復原；打字時同一個欄位連續的修改併成一步）。
 */

type View = "board" | "calendar";

type Drag =
  | { kind: "card"; id: string; x: number; y: number; dx: number; dy: number; w: number; over: { list: string; index: number } | { date: string } | null }
  | { kind: "list"; id: string; x: number; y: number; dx: number; dy: number; w: number; over: number | null };

const viewKey = (id: string) => TASKS_VIEW_PREFIX + id;
const loadView = (id: string): View => {
  try {
    return localStorage.getItem(viewKey(id)) === "calendar" ? "calendar" : "board";
  } catch {
    return "board";
  }
};

const typing = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest("input, textarea, select, [contenteditable]");

/** stateKey：記住檢視的鍵（Desk 檔名）；title：匯出的檔名 */
export function TasksView(props: { stateKey: string; title: string; value: string; onChange: (json: string) => void }) {
  const board = useMemo(() => parseTasks(props.value), [props.value]);
  const value = useRef(props.value);
  value.current = props.value;
  const hist = useRef({ past: [] as string[], future: [] as string[], key: "", at: 0 });

  /** 改看板；key 一樣、間隔很短的連續修改（打字）併成一步復原 */
  const commit = (fn: (b: TaskBoard) => TaskBoard, key = "") => {
    const cur = value.current;
    const next = serializeTasks(fn(parseTasks(cur)));
    if (next === cur) return;
    const h = hist.current;
    const now = Date.now();
    if (!(key && key === h.key && now - h.at < 1500)) {
      h.past.push(cur);
      if (h.past.length > 200) h.past.shift();
    }
    h.key = key;
    h.at = now;
    h.future = [];
    value.current = next;
    props.onChange(next);
  };
  const undo = (redo = false) => {
    const h = hist.current;
    const from = redo ? h.future : h.past;
    const to = redo ? h.past : h.future;
    const v = from.pop();
    if (v === undefined) return;
    to.push(value.current);
    h.key = "";
    value.current = v;
    props.onChange(v);
  };

  const [view, setViewRaw] = useState<View>(() => loadView(props.stateKey));
  const setView = (v: View) => {
    setViewRaw(v);
    try {
      localStorage.setItem(viewKey(props.stateKey), v);
    } catch {
      /* 不能存就算了 */
    }
  };
  const dated = hasDue(board);
  const shown: View = dated ? view : "board";

  const [sel, setSel] = useState<string | null>(null);
  const card = board.cards.find((c) => c.id === sel) ?? null;
  const [focusList, setFocusList] = useState<string | null>(null);

  const newList = () => {
    let id = "";
    commit((b) => {
      const r = addList(b, "");
      id = r.id;
      return r.board;
    });
    setView("board");
    setFocusList(id);
  };

  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 5000);
    return () => clearTimeout(t);
  }, [note]);
  const exportAs = async (format: "md" | "csv") => {
    const base = `${props.title || "Board"} - Tasks`;
    const name = `${base}.${format}`;
    // CSV 開頭加 BOM：Excel 才認得 UTF-8 的中文
    const text = format === "csv" ? "\ufeff" + tasksCsv(board) : tasksMarkdown(board, base);
    try {
      const path = await saveExport(name, new TextEncoder().encode(text));
      setNote(path ? `Saved to ${path}` : `Downloaded ${name}`);
    } catch (err) {
      setNote(`Couldn't export: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (typing(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo(e.shiftKey);
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      undo(true);
    } else if ((e.key === "Delete" || e.key === "Backspace") && card) {
      e.preventDefault();
      commit((b) => removeCard(b, card.id));
      setSel(null);
    } else if (e.key === "Escape" && sel) {
      setSel(null);
    }
  };

  return (
    <div className="office tasks-office" tabIndex={-1} onKeyDown={onKeyDown}>
      <Toolbar>
        <TBtn icon={<BoardIcon />} label="Board" title="Lists and cards" on={shown === "board"} onClick={() => setView("board")} />
        {dated && <TBtn icon={<CalendarIcon />} label="Calendar" title="Cards with a due date, by month" on={shown === "calendar"} onClick={() => setView("calendar")} />}
        <span className="dc-sep" />
        <TBtn icon={<PlusIcon />} label="List" title="Add a list" onClick={newList} />
        <span className="dc-gap" />
        <TMenu icon={<ExportIcon />} label="Export" title="Save the board as a file" align="right">
          {(close) => (
            <>
              <MenuItem label="Markdown checklist" hint=".md" onClick={() => (close(), void exportAs("md"))} />
              <MenuItem label="CSV (one row per card)" hint=".csv" onClick={() => (close(), void exportAs("csv"))} />
            </>
          )}
        </TMenu>
      </Toolbar>
      {note && (
        <div className="dp-note" role="status">
          {note}
        </div>
      )}
      <div className="dc-main">
        <div className="dc-doc">
          {shown === "board" ? (
            <BoardView board={board} commit={commit} sel={sel} onSel={setSel} focusList={focusList} onFocused={() => setFocusList(null)} onNewList={newList} />
          ) : (
            <CalendarView board={board} commit={commit} sel={sel} onSel={setSel} />
          )}
        </div>
        {card && <CardInspector board={board} card={card} commit={commit} onClose={() => setSel(null)} />}
      </div>
    </div>
  );
}

type Commit = (fn: (b: TaskBoard) => TaskBoard, key?: string) => void;

/* ─── 拖曳（卡片與清單共用） ─── */

function useDrag(onDrop: (d: Drag) => void, onClick: (id: string) => void) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const latest = useRef<Drag | null>(null);
  latest.current = drag;
  const drop = useRef(onDrop);
  drop.current = onDrop;

  const start = (e: ReactPointerEvent, kind: Drag["kind"], id: string, locate: (x: number, y: number, d: Drag) => Drag["over"]) => {
    if (e.button !== 0 || typing(e.target) || (e.target as HTMLElement).closest("button")) return;
    const el = e.currentTarget as HTMLElement;
    const box = (kind === "list" ? (el.closest(".tk-list") as HTMLElement) : el).getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    let moving = false;
    const move = (ev: PointerEvent) => {
      if (!moving && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      moving = true;
      const base = { id, x: ev.clientX, y: ev.clientY, dx: sx - box.left, dy: sy - box.top, w: box.width };
      const d = (kind === "card" ? { kind, ...base, over: null } : { kind, ...base, over: null }) as Drag;
      d.over = locate(ev.clientX, ev.clientY, d) as never;
      setDrag(d);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const d = latest.current;
      setDrag(null);
      if (!moving) onClick(id);
      else if (d) drop.current(d);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  return { drag, start };
}

/** 指標底下的清單與插入位置（不算拖曳中的卡片） */
function cardSpot(x: number, y: number, id: string): { list: string; index: number } | null {
  const hit = document.elementFromPoint(x, y) as HTMLElement | null;
  const col = hit?.closest<HTMLElement>("[data-list]");
  if (!col) return null;
  const cards = [...col.querySelectorAll<HTMLElement>("[data-card]")].filter((c) => c.dataset.card !== id);
  const index = cards.filter((c) => {
    const r = c.getBoundingClientRect();
    return r.top + r.height / 2 < y;
  }).length;
  return { list: col.dataset.list!, index };
}

function daySpot(x: number, y: number): { date: string } | null {
  const hit = document.elementFromPoint(x, y) as HTMLElement | null;
  const cell = hit?.closest<HTMLElement>("[data-date]");
  return cell ? { date: cell.dataset.date! } : null;
}

/** 清單要插到第幾個位置（不算拖曳中的清單） */
function listSpot(x: number, id: string, root: HTMLElement | null): number | null {
  if (!root) return null;
  const cols = [...root.querySelectorAll<HTMLElement>(".tk-list[data-list]")].filter((c) => c.dataset.list !== id);
  return cols.filter((c) => {
    const r = c.getBoundingClientRect();
    return r.left + r.width / 2 < x;
  }).length;
}

/* ─── Board 檢視 ─── */

function BoardView(props: {
  board: TaskBoard;
  commit: Commit;
  sel: string | null;
  onSel: (id: string | null) => void;
  focusList: string | null;
  onFocused: () => void;
  onNewList: () => void;
}) {
  const { board, commit } = props;
  const root = useRef<HTMLDivElement>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const { drag, start } = useDrag(
    (d) => {
      if (d.kind === "card" && d.over && "list" in d.over) {
        const o = d.over;
        commit((b) => moveCard(b, d.id, o.list, o.index));
      } else if (d.kind === "list" && d.over !== null) {
        const to = d.over;
        commit((b) => moveList(b, d.id, to));
      }
    },
    // 點一下（沒有拖曳）：卡片是選取，清單標題是改名
    (id) => (board.cards.some((c) => c.id === id) ? props.onSel(id) : setEditList(id)),
  );
  const [editList, setEditList] = useState<string | null>(null);
  useEffect(() => {
    if (props.focusList) {
      setEditList(props.focusList);
      props.onFocused();
    }
  }, [props.focusList]); // eslint-disable-line react-hooks/exhaustive-deps
  const dragCard = drag?.kind === "card" ? board.cards.find((c) => c.id === drag.id) : undefined;
  const dragList = drag?.kind === "list" ? board.lists.find((l) => l.id === drag.id) : undefined;
  const cardOver = drag?.kind === "card" && drag.over && "list" in drag.over ? drag.over : null;
  const listOver = drag?.kind === "list" ? drag.over : null;
  const others = board.lists.filter((l) => l.id !== drag?.id || drag?.kind !== "list");

  return (
    <div
      className={`tk-board${drag ? " dragging" : ""}`}
      ref={root}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) props.onSel(null);
      }}
    >
      {board.lists.map((l) => {
        const cards = listCards(board, l.id);
        const shownCards = cards.filter((c) => c.id !== drag?.id);
        const dropAt = cardOver?.list === l.id ? cardOver.index : -1;
        const beforeIdx = others.findIndex((x) => x.id === l.id);
        return (
          <div key={l.id} className="tk-slot">
            {listOver !== null && listOver === beforeIdx && dragList?.id !== l.id && <div className="tk-list-drop" />}
            <div className={`tk-list${dragList?.id === l.id ? " lifted" : ""}`} data-list={l.id}>
              <div className="tk-list-head" onPointerDown={(e) => start(e, "list", l.id, (x) => listSpot(x, l.id, root.current))}>
                {editList === l.id ? (
                  <ListTitle value={l.title} onDone={() => setEditList(null)} onChange={(t) => commit((b) => renameList(b, l.id, t), `list:${l.id}`)} />
                ) : (
                  <span className={`tk-list-title static${l.title ? "" : " empty"}`} title="Click to rename · drag to move">
                    {l.title || "List name"}
                  </span>
                )}
                <span className="tk-count">{cards.length || ""}</span>
                <div className="tk-menu-wrap">
                  <button className="icon-btn" title="List actions" aria-label="List actions" onClick={() => setMenu(menu === l.id ? null : l.id)}>
                    <MoreIcon />
                  </button>
                  {menu === l.id && (
                    <ListMenu
                      onClose={() => setMenu(null)}
                      onAdd={() => (setMenu(null), setAdding(l.id))}
                      onDelete={() => {
                        setMenu(null);
                        commit((b) => removeList(b, l.id));
                      }}
                      count={cards.length}
                    />
                  )}
                </div>
              </div>
              <div className="tk-cards">
                {shownCards.map((c, i) => (
                  <div key={c.id}>
                    {dropAt === i && <div className="tk-drop" />}
                    <CardFace
                      card={c}
                      board={board}
                      selected={props.sel === c.id}
                      onPointerDown={(e) => start(e, "card", c.id, (x, y) => cardSpot(x, y, c.id))}
                      onToggleDone={() => commit((b) => updateCard(b, c.id, { done: !c.done }))}
                    />
                  </div>
                ))}
                {dropAt >= shownCards.length && <div className="tk-drop" />}
                {adding === l.id && (
                  <AddCard
                    onAdd={(title) => {
                      let id = "";
                      commit((b) => {
                        const r = addCard(b, l.id, title);
                        id = r.id;
                        return r.board;
                      });
                      return id;
                    }}
                    onClose={() => setAdding(null)}
                  />
                )}
              </div>
              {adding !== l.id && (
                <button className="tk-add-card" onClick={() => setAdding(l.id)}>
                  <PlusIcon /> Add a card
                </button>
              )}
            </div>
          </div>
        );
      })}
      {listOver !== null && listOver >= others.length && <div className="tk-list-drop" />}
      <button className="tk-new-list" onClick={props.onNewList}>
        <PlusIcon /> Add a list
      </button>
      {dragCard && drag && <div className="tk-ghost" style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w }}>{<CardFace card={dragCard} board={board} selected={false} />}</div>}
      {dragList && drag && (
        <div className="tk-ghost tk-ghost-list" style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w }}>
          <div className="tk-list-head">
            <span className="tk-list-title static">{dragList.title || "Untitled list"}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** 清單名稱的輸入框：Enter、Esc 或離開就結束 */
function ListTitle(props: { value: string; onDone: () => void; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="tk-list-title"
      value={props.value}
      placeholder="List name"
      aria-label="List name"
      onChange={(e) => props.onChange(e.target.value)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && e.currentTarget.blur()}
      onBlur={props.onDone}
    />
  );
}

function ListMenu(props: { count: number; onAdd: () => void; onDelete: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.(".tk-menu-wrap") && props.onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
    };
  });
  return (
    <div className="popover block-menu tk-menu" role="menu" ref={ref}>
      <button role="menuitem" onClick={props.onAdd}>
        <span className="glyph">
          <PlusIcon />
        </span>
        <span className="label">Add a card</span>
      </button>
      <button role="menuitem" className="danger" onClick={() => (props.count && !confirm ? setConfirm(true) : props.onDelete())}>
        <span className="glyph">
          <TrashIcon />
        </span>
        <span className="label">{confirm ? `Delete list and ${props.count} ${props.count === 1 ? "card" : "cards"}?` : "Delete list"}</span>
      </button>
    </div>
  );
}

/** 清單最下面新增卡片的輸入框：Enter 加一張、繼續輸入下一張；Esc 或空白時離開 */
function AddCard(props: { onAdd: (title: string) => string; onClose: () => void; placeholder?: string }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.scrollIntoView({ block: "nearest" });
  }, []);
  const add = () => {
    const t = text.trim();
    if (!t) return props.onClose();
    props.onAdd(t);
    setText("");
    requestAnimationFrame(() => ref.current?.scrollIntoView({ block: "nearest" }));
  };
  return (
    <div className="tk-add-form">
      <textarea
        ref={ref}
        value={text}
        rows={2}
        placeholder={props.placeholder ?? "Card title — Enter to add"}
        aria-label="New card title"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            add();
          } else if (e.key === "Escape") {
            e.preventDefault();
            props.onClose();
          }
        }}
        onBlur={() => {
          if (text.trim()) props.onAdd(text.trim());
          props.onClose();
        }}
      />
    </div>
  );
}

function LabelBars(props: { card: TaskCard; board: TaskBoard }) {
  const labels = (props.card.labels ?? []).map((id) => props.board.labels.find((l) => l.id === id)).filter((l) => !!l);
  if (!labels.length) return null;
  return (
    <div className="tk-labels">
      {labels.map((l) => (
        <span key={l.id} className={`tk-label c-${l.color}${l.name ? " named" : ""}`} title={l.name || l.color}>
          {l.name}
        </span>
      ))}
    </div>
  );
}

/** 卡片：標籤、標題、截止日（點了切換完成）、說明與檢查清單的小標記 */
function CardFace(props: { card: TaskCard; board: TaskBoard; selected: boolean; onPointerDown?: (e: ReactPointerEvent) => void; onToggleDone?: () => void }) {
  const c = props.card;
  const due = dueState(c);
  const p = checkProgress(c);
  return (
    <div className={`tk-card${props.selected ? " selected" : ""}${c.done ? " done" : ""}`} data-card={c.id} onPointerDown={props.onPointerDown}>
      <LabelBars card={c} board={props.board} />
      <div className="tk-title">{c.title || "Untitled"}</div>
      {(c.due || c.desc || p.total > 0) && (
        <div className="tk-badges">
          {c.due && (
            <button className={`tk-due due-${due}`} title={c.done ? "Done — click to mark as not done" : "Click to mark as done"} onClick={props.onToggleDone}>
              {c.done ? <CheckboxIcon /> : <ClockIcon />} {dueLabel(c)}
            </button>
          )}
          {c.desc && (
            <span className="tk-badge" title="This card has a description">
              <TextIcon />
            </span>
          )}
          {p.total > 0 && (
            <span className={`tk-badge${p.done === p.total ? " complete" : ""}`} title="Checklist">
              <CheckboxIcon /> {p.done}/{p.total}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Calendar 檢視 ─── */

function CalendarView(props: { board: TaskBoard; commit: Commit; sel: string | null; onSel: (id: string | null) => void }) {
  const { board, commit } = props;
  const now = today();
  const [ym, setYm] = useState(() => {
    // 這個月沒有到期的卡片，就從最近的一張開始
    const month = now.slice(0, 7);
    if (board.cards.some((c) => c.due?.startsWith(month))) return month;
    const next = board.cards.map((c) => c.due).filter((d): d is string => !!d && d >= now).sort()[0];
    return (next ?? month).slice(0, 7);
  });
  const [y, m] = ym.split("-").map(Number);
  const weeks = useMemo(() => monthGrid(y, m), [y, m]);
  const byDay = useMemo(() => cardsByDay(board, weeks.flat()), [board, weeks]);
  const shift = (n: number) => {
    const d = new Date(y, m - 1 + n, 1);
    setYm(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const [adding, setAdding] = useState<string | null>(null);
  const { drag, start } = useDrag(
    (d) => {
      if (d.kind === "card" && d.over && "date" in d.over) {
        const date = d.over.date;
        commit((b) => updateCard(b, d.id, { due: date }));
      }
    },
    (id) => props.onSel(id),
  );
  const over = drag?.kind === "card" && drag.over && "date" in drag.over ? drag.over.date : null;
  const dragCard = drag?.kind === "card" ? board.cards.find((c) => c.id === drag.id) : undefined;
  const firstList = board.lists[0]?.id;

  return (
    <div className="tk-cal">
      <div className="tk-cal-head">
        <button className="icon-btn" title="Previous month" aria-label="Previous month" onClick={() => shift(-1)}>
          <ChevronLeftIcon />
        </button>
        <h3>
          {monthName(m)} {y}
        </h3>
        <button className="icon-btn" title="Next month" aria-label="Next month" onClick={() => shift(1)}>
          <ChevronRightIcon />
        </button>
        <button className="tk-today" onClick={() => setYm(now.slice(0, 7))}>
          Today
        </button>
      </div>
      <div className="tk-cal-week">
        {WEEKDAYS_SHORT.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="tk-cal-grid">
        {weeks.flat().map((day) => (
          <div
            key={day}
            className={`tk-day${day.slice(0, 7) !== ym ? " other" : ""}${day === now ? " today" : ""}${over === day ? " over" : ""}`}
            data-date={day}
            onDoubleClick={(e) => {
              if (firstList && !(e.target as HTMLElement).closest(".tk-chip, textarea")) setAdding(day);
            }}
            title={firstList ? "Double-click to add a card due this day" : undefined}
          >
            <span className="tk-day-num">{Number(day.slice(8))}</span>
            {byDay.get(day)!.map((c) => (
              <div
                key={c.id}
                className={`tk-chip due-${dueState(c, now)}${props.sel === c.id ? " selected" : ""}${drag?.id === c.id ? " lifted" : ""}`}
                onPointerDown={(e) => start(e, "card", c.id, (x, yy) => daySpot(x, yy))}
                title={`${c.title || "Untitled"}${c.time ? ` · ${c.time}` : ""} · ${board.lists.find((l) => l.id === c.list)?.title || "Untitled list"}`}
              >
                <ChipLabels card={c} board={board} />
                {c.time && <span className="tk-chip-time">{c.time}</span>}
                <span className="tk-chip-title">{c.title || "Untitled"}</span>
              </div>
            ))}
            {adding === day && firstList && (
              <AddCard
                placeholder="Card title"
                onAdd={(title) => {
                  let id = "";
                  commit((b) => {
                    const r = addCard(b, firstList, title, { due: day });
                    id = r.id;
                    return r.board;
                  });
                  return id;
                }}
                onClose={() => setAdding(null)}
              />
            )}
          </div>
        ))}
      </div>
      {dragCard && drag && (
        <div className="tk-ghost tk-chip" style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w }}>
          <span className="tk-chip-title">{dragCard.title || "Untitled"}</span>
        </div>
      )}
    </div>
  );
}

function ChipLabels(props: { card: TaskCard; board: TaskBoard }) {
  const ls = (props.card.labels ?? []).map((id) => props.board.labels.find((l) => l.id === id)).filter((l) => !!l);
  if (!ls.length) return null;
  return (
    <span className="tk-chip-labels">
      {ls.map((l) => (
        <span key={l.id} className={`c-${l.color}`} />
      ))}
    </span>
  );
}

/* ─── 卡片的檢閱器 ─── */

function CardInspector(props: { board: TaskBoard; card: TaskCard; commit: Commit; onClose: () => void }) {
  const { board, card: c, commit } = props;
  const id = c.id;
  const [newItem, setNewItem] = useState("");
  const p = checkProgress(c);
  const due = dueState(c);
  return (
    <Inspector title="Card">
      <div className="tk-insp-close">
        <button className="icon-btn" title="Close (Esc)" aria-label="Close" onClick={props.onClose}>
          <CloseIcon />
        </button>
      </div>
      <Section>
        <textarea
          className="dc-input dc-area tk-insp-title"
          value={c.title}
          rows={2}
          placeholder="Card title"
          aria-label="Card title"
          onChange={(e) => commit((b) => updateCard(b, id, { title: e.target.value.replace(/\n/g, " ") }), `title:${id}`)}
        />
        <Field label="List">
          <select
            className="dc-input"
            value={c.list}
            onChange={(e) => {
              const to = e.target.value;
              commit((b) => moveCard(b, id, to, Infinity));
            }}
          >
            {board.lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title || "Untitled list"}
              </option>
            ))}
          </select>
        </Field>
        <label className="dc-check">
          <input type="checkbox" checked={!!c.done} onChange={(e) => commit((b) => updateCard(b, id, { done: e.target.checked }))} /> Mark as complete
        </label>
      </Section>
      <Section title="Due Date">
        <div className="tk-due-row">
          <input className="dc-input" type="date" value={c.due ?? ""} aria-label="Due date" onChange={(e) => commit((b) => updateCard(b, id, { due: e.target.value || undefined }))} />
          <input
            className="dc-input"
            type="time"
            value={c.time ?? ""}
            aria-label="Due time"
            disabled={!c.due}
            onChange={(e) => commit((b) => updateCard(b, id, { time: e.target.value || undefined }))}
          />
        </div>
        {c.due ? (
          <div className="tk-due-info">
            <span className={`tk-due due-${due}`}>{due === "overdue" ? "Overdue" : due === "today" ? "Due today" : due === "soon" ? "Due tomorrow" : due === "done" ? "Complete" : dueLabel(c)}</span>
            <button className="tk-link" onClick={() => commit((b) => updateCard(b, id, { due: undefined }))}>
              Remove
            </button>
          </div>
        ) : (
          <p className="dc-note">Cards with a due date also appear in the Calendar view.</p>
        )}
      </Section>
      <Section title="Labels">
        {board.labels.map((l) => {
          const on = !!c.labels?.includes(l.id);
          return (
            <div key={l.id} className="tk-label-row">
              <button className={`tk-swatch c-${l.color}${on ? " on" : ""}`} title={on ? "Remove this label" : "Add this label"} aria-pressed={on} onClick={() => commit((b) => toggleLabel(b, id, l.id))}>
                {on && "✓"}
              </button>
              <input
                className="dc-input"
                value={l.name}
                placeholder={l.color[0].toUpperCase() + l.color.slice(1)}
                aria-label={`Name of the ${l.color} label`}
                onChange={(e) => commit((b) => renameLabel(b, l.id, e.target.value), `label:${l.id}`)}
              />
            </div>
          );
        })}
        <p className="dc-note">Label names are shared by every card on this board.</p>
      </Section>
      <Section title="Description">
        <textarea
          className="dc-input dc-area tk-desc"
          value={c.desc ?? ""}
          rows={4}
          placeholder="Add more detail…"
          aria-label="Description"
          onChange={(e) => commit((b) => updateCard(b, id, { desc: e.target.value }), `desc:${id}`)}
        />
      </Section>
      <Section title={p.total ? `Checklist · ${p.done}/${p.total}` : "Checklist"}>
        {p.total > 0 && (
          <div className="tk-progress" aria-hidden>
            <span style={{ width: `${(p.done / p.total) * 100}%` }} />
          </div>
        )}
        {(c.checklist ?? []).map((x) => (
          <div key={x.id} className="tk-check-row">
            <input type="checkbox" checked={x.done} aria-label="Done" onChange={(e) => commit((b) => updateCheck(b, id, x.id, { done: e.target.checked }))} />
            <input className={`dc-input${x.done ? " struck" : ""}`} value={x.text} aria-label="Checklist item" onChange={(e) => commit((b) => updateCheck(b, id, x.id, { text: e.target.value }), `check:${x.id}`)} />
            <button className="icon-btn" title="Remove item" aria-label="Remove item" onClick={() => commit((b) => removeCheck(b, id, x.id))}>
              <CloseIcon />
            </button>
          </div>
        ))}
        <input
          className="dc-input"
          value={newItem}
          placeholder="Add an item — Enter"
          aria-label="New checklist item"
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing && newItem.trim()) {
              const t = newItem.trim();
              commit((b) => addCheck(b, id, t));
              setNewItem("");
            }
          }}
        />
      </Section>
      <Section>
        <button
          className="tk-delete"
          onClick={() => {
            commit((b) => removeCard(b, id));
            props.onClose();
          }}
        >
          <TrashIcon /> Delete Card
        </button>
      </Section>
    </Inspector>
  );
}
