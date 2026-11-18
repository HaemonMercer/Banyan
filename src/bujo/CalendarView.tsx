import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { contentHtml, escapeWithRefs } from "../editor/wysiwyg";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon, JournalIcon } from "../editor/icons";
import { addDays, dateKey, isDateKey, monthGrid, monthName, monthShort, parseKey, weekday, weekdayShort, WEEKDAYS_MIN } from "../journal/journal";
import type { Docs } from "../journal/useJournals";
import { openPage } from "../pages/pageRef";
import { DateChip, TaskGlyph, TaskIcon } from "./TaskGlyph";
import {
  TASK_LABEL,
  appendItems,
  collectTasks,
  cycleState,
  scheduleAt,
  setTaskAt,
  taskMark,
  type TaskItem,
  type TaskState,
} from "./tasks";
import { clock, duration, layoutTimed, parseClock, parseTime, setTimeAt, timeLabel, timeText, type TaskTime } from "./time";
import "./bujo.css";

/** 行事曆上的一項：日記裡的任務或事件 */
interface CalItem extends TaskItem {
  /** 寫在哪一天的日記 */
  date: string;
  /** 內容開頭的時間 */
  time: TaskTime | null;
  /** 去掉時間的內容 */
  title: string;
  key: string;
}

type View = "year" | "month" | "week" | "day";

/** 排在行事曆的哪一天：排程過的是排到的那天，其他是寫的那天 */
const dayOf = (t: CalItem) => t.due ?? t.date;

/** 可以排到別天的項目：未完成、已排程的任務與事件（完成、取消的留在原處） */
const movable = (t: CalItem) => t.state === "open" || t.state === "scheduled" || t.state === "event";

/** 月曆一格一開始（還沒量高度前）顯示幾項，其他收成「還有 N 項」 */
const CELL_MAX = 3;
/** 時間表一小時的高度（px） */
const HOUR = 48;
/** 拖曳、點選時間對齊到幾分鐘 */
const SNAP = 15;

const WEEK = WEEKDAYS_MIN;
const VIEWS: [View, string, string][] = [
  ["year", "Year", "Y"],
  ["month", "Month", "M"],
  ["week", "Week", "W"],
  ["day", "Day", "D"],
];
const VIEW_KEY = "banyan.calendar.view";

function loadView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === "year" || v === "month" || v === "week" || v === "day") return v;
  } catch {
    /* 沒有 localStorage 就用預設 */
  }
  return "month";
}

/** 同一天、加減幾個月（日子超過那個月的天數就取最後一天） */
function addMonths(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const first = new Date(y, m - 1 + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  first.setDate(Math.min(d, last));
  return dateKey(first);
}

const weekStart = (key: string) => addDays(key, -parseKey(key).getDay());

function rangeTitle(view: View, cursor: string): string {
  const [y, m, d] = cursor.split("-").map(Number);
  if (view === "year") return `${y}`;
  if (view === "month") return `${monthName(m)} ${y}`;
  if (view === "day") return `${weekday(cursor)}, ${monthName(m)} ${d}, ${y}`;
  const s = weekStart(cursor);
  const e = addDays(s, 6);
  const [y1, m1, d1] = s.split("-").map(Number);
  const [y2, m2, d2] = e.split("-").map(Number);
  if (y1 !== y2) return `${monthShort(m1)} ${d1}, ${y1} – ${monthShort(m2)} ${d2}, ${y2}`;
  if (m1 !== m2) return `${monthShort(m1)} ${d1} – ${monthShort(m2)} ${d2}, ${y1}`;
  return `${monthName(m1)} ${d1} – ${d2}, ${y1}`;
}

const shortDay = (key: string) => {
  const d = parseKey(key);
  return `${weekdayShort(key)}, ${monthShort(d.getMonth() + 1)} ${d.getDate()}`;
};

const nowMinutes = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

/** 現在幾點（分鐘），每 30 秒更新 */
function useNowMinutes(): number {
  const [m, setM] = useState(nowMinutes);
  useEffect(() => {
    const id = window.setInterval(() => setM(nowMinutes()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return m;
}

/** 上次點外面關掉浮動視窗的時間（那一下不要又開新增視窗，跟 Google 日曆一樣） */
let closedAt = 0;

/** 點外面或按 Esc 關掉浮動視窗 */
function useDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void, keep?: () => HTMLElement | null) {
  useEffect(() => {
    const down = (e: globalThis.MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || keep?.()?.contains(t)) return;
      closedAt = Date.now();
      onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [ref, onClose, keep]);
}

/** 浮動視窗放在點的位置旁邊，不超出視窗 */
function usePlace(ref: RefObject<HTMLElement | null>, x: number, y: number) {
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(8, Math.min(x + 8, window.innerWidth - w - 8));
    const top = y + h + 8 > window.innerHeight ? Math.max(8, y - h - 8) : y + 8;
    setPos({ left, top });
  }, [ref, x, y]);
  return pos;
}

// ─── 拖曳 ──────────────────────────────────────────────────────

/*
 * 用指標事件自己做拖曳，不用 HTML5 的 drag／drop：Tauri 在 Windows 開著原生的檔案拖放
 * （編輯器拖檔案進來要用）時，網頁收不到 HTML5 的拖曳事件，在 App 裡會完全拖不動。
 * 放置目標用 `data-drop`（day：格子、改日期；allday：全天列、拿掉時間；time：時間表，
 * 依位置算時間）與 `data-date` 標記。
 */

type DropKind = "day" | "allday" | "time";

const dropAttrs = (kind: DropKind, date: string) => ({ "data-drop": kind, "data-date": date });

/** 放開時由行事曆處理（掛在 CalendarView 上） */
let dropHandler: ((key: string, kind: DropKind, date: string, el: HTMLElement, y: number, grab: number) => void) | null =
  null;

/** 時間表上的位置 → 分鐘（扣掉抓住的位置，對齊 SNAP） */
function minuteIn(el: HTMLElement, y: number, grab = 0): number {
  const r = el.getBoundingClientRect();
  const min = ((y - r.top) / HOUR) * 60 - grab;
  return Math.max(0, Math.min(1440 - SNAP, Math.round(min / SNAP) * SNAP));
}

function dropTarget(x: number, y: number): HTMLElement | null {
  return document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]") ?? null;
}

function startDrag(t: CalItem, x0: number, y0: number, grab: number) {
  let ghost: HTMLDivElement | null = null;
  let over: HTMLElement | null = null;
  const highlight = (el: HTMLElement | null) => {
    if (el === over) return;
    over?.classList.remove("drop-over");
    el?.classList.add("drop-over");
    over = el;
  };
  const finish = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("keydown", key, true);
    highlight(null);
    ghost?.remove();
    document.body.classList.remove("cal-dragging");
  };
  const move = (e: PointerEvent) => {
    if (!ghost) {
      // 移動一點點才算拖曳（不然就是一般的點擊）
      if (Math.hypot(e.clientX - x0, e.clientY - y0) < 5) return;
      ghost = document.createElement("div");
      ghost.className = "cal-drag-ghost";
      ghost.textContent = t.title || "(empty)";
      document.body.appendChild(ghost);
      document.body.classList.add("cal-dragging");
      window.getSelection()?.removeAllRanges();
    }
    ghost.style.left = e.clientX + 12 + "px";
    ghost.style.top = e.clientY + 10 + "px";
    const el = dropTarget(e.clientX, e.clientY);
    highlight(el);
    // 拖到時間表時顯示會放在幾點
    if (el?.dataset.drop === "time") ghost.dataset.time = clock(minuteIn(el, e.clientY, grab));
    else delete ghost.dataset.time;
  };
  const up = (e: PointerEvent) => {
    const dragged = !!ghost;
    finish();
    if (!dragged) return;
    // 放開後接著的 click 不要再開新增或詳細視窗
    const stop = (ev: Event) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    window.addEventListener("click", stop, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 300);
    const el = dropTarget(e.clientX, e.clientY);
    const kind = el?.dataset.drop as DropKind | undefined;
    const date = el?.dataset.date;
    if (el && kind && date && dropHandler) dropHandler(t.key, kind, date, el, e.clientY, grab);
  };
  // Esc 取消拖曳
  const key = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !ghost) return;
    e.stopPropagation();
    finish();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("keydown", key, true);
}

/** 可以拖的項目：按住（不是在符號或連結上）移動就開始拖 */
function dragProps(t: CalItem, grabAt?: (e: ReactPointerEvent) => number) {
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest(".task-glyph, a")) return;
      startDrag(t, e.clientX, e.clientY, grabAt?.(e) ?? 0);
    },
  };
}

// ─── 行事曆 ────────────────────────────────────────────────────

interface QuickInit {
  date: string;
  time: TaskTime | null;
  x: number;
  y: number;
}

/**
 * 行事曆（參考 Google 日曆、Apple 行事曆、Thunderbird）：月／週／日檢視，
 * 每一項是日記裡的任務或事件（子彈筆記的符號）。點空白處新增、點項目看詳細、
 * 拖曳改日期與時間；右邊是小月曆與以前沒做完的任務（排程、取消）。
 * 所有資料仍然寫在日記的 Markdown 裡，這裡只是整理與總覽。
 */
export function CalendarView(props: { journals: Docs; now: string }) {
  const { journals, now } = props;
  const [view, setViewState] = useState<View>(loadView);
  const [cursor, setCursor] = useState(now);
  const [showKey, setShowKey] = useState(false);
  const [detail, setDetail] = useState<{ key: string; x: number; y: number } | null>(null);
  const [quick, setQuick] = useState<QuickInit | null>(null);
  const nowMin = useNowMinutes();
  const mainRef = useRef<HTMLDivElement>(null);

  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* 記不住也沒關係 */
    }
  };

  // 所有日記裡的任務與事件
  const tasks = useMemo(() => {
    const out: CalItem[] = [];
    for (const [date, content] of Object.entries(journals.contents)) {
      if (!content.includes("{") && !content.includes("[")) continue;
      for (const t of collectTasks(content)) {
        // 沒有寫排到哪天的 `{<}`不知道該放哪天，不顯示
        if (t.state === "scheduled" && !t.due) continue;
        const { time, rest } = parseTime(t.text);
        out.push({ ...t, date, time, title: rest, key: date + ":" + t.line });
      }
    }
    return out.sort(
      (a, b) =>
        dayOf(a).localeCompare(dayOf(b)) ||
        (a.time?.start ?? -1) - (b.time?.start ?? -1) ||
        a.date.localeCompare(b.date) ||
        a.line - b.line,
    );
  }, [journals.contents]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalItem[]>();
    for (const t of tasks) map.set(dayOf(t), [...(map.get(dayOf(t)) ?? []), t]);
    return map;
  }, [tasks]);

  const find = (key: string) => tasks.find((t) => t.key === key);

  const setState = (t: CalItem, state: TaskState | null) =>
    journals.modify(t.date, (src) => setTaskAt(src, t.line, state));

  /**
   * 改日期與時間。同一天只改時間；換到別天就是排程：任務留在原處，標成 <、行尾寫上日期
   * （事件還是事件）；排回寫的那天就取消排程。time 是 undefined 時時間不變，null 時拿掉時間。
   */
  const move = (t: CalItem, date: string, time?: TaskTime | null) => {
    if (date !== dayOf(t) && !movable(t)) return;
    journals.modify(t.date, (src) => {
      let s = src;
      if (date !== dayOf(t)) s = scheduleAt(s, t.line, date === t.date ? null : date);
      if (time !== undefined) s = setTimeAt(s, t.line, time);
      return s;
    });
  };

  /** 排程到某一天（未完成清單的「Schedule」）。 */
  const send = (items: CalItem[], date: string) => {
    for (const t of items) journals.modify(t.date, (src) => scheduleAt(src, t.line, date === t.date ? null : date));
  };

  const add = (kind: "open" | "event", text: string, date: string, time: TaskTime | null) =>
    // 跳脫特殊字元，但 [[頁面連結]] 保留
    journals.modify(date, (s) =>
      appendItems(s, ["- " + taskMark(kind) + (time ? timeText(time) + " " : "") + escapeWithRefs(text)]),
    );

  const step = (n: number) =>
    setCursor((c) =>
      view === "year" ? addMonths(c, 12 * n) : view === "month" ? addMonths(c, n) : addDays(c, view === "week" ? 7 * n : n),
    );
  const goToday = () => setCursor(now);
  const showDay = (d: string) => {
    setCursor(d);
    setView("day");
  };

  /** 建立（C 鍵）：在月曆上方中間開新增視窗 */
  const create = () => {
    const r = mainRef.current?.getBoundingClientRect();
    setDetail(null);
    setQuick({
      date: cursor,
      time: null,
      x: r ? r.left + r.width / 2 - 150 : 200,
      y: r ? r.top + 40 : 120,
    });
  };

  const openQuick = (date: string, time: TaskTime | null, e: MouseEvent) => {
    if (Date.now() - closedAt < 400) return;
    setDetail(null);
    setCursor(date);
    setQuick({ date, time, x: e.clientX, y: e.clientY });
  };
  const openDetail = (t: CalItem, e: MouseEvent) => {
    setQuick(null);
    setDetail({ key: t.key, x: e.clientX, y: e.clientY });
  };

  // 鍵盤：M／W／D 換檢視、T 今天、J／K（或方向鍵）前後、C 建立
  const keys = useRef({ step, goToday, setView, create });
  keys.current = { step, goToday, setView, create };
  const popupOpen = !!(quick || detail || showKey);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || popupOpen || e.isComposing) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("input, textarea, select, [contenteditable='true'], [contenteditable='']")) return;
      const k = keys.current;
      const act: Record<string, () => void> = {
        y: () => k.setView("year"),
        m: () => k.setView("month"),
        w: () => k.setView("week"),
        d: () => k.setView("day"),
        t: k.goToday,
        j: () => k.step(1),
        n: () => k.step(1),
        arrowright: () => k.step(1),
        k: () => k.step(-1),
        p: () => k.step(-1),
        arrowleft: () => k.step(-1),
        c: k.create,
      };
      const f = act[e.key.toLowerCase()];
      if (!f) return;
      e.preventDefault();
      f();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popupOpen]);

  const overdue = tasks.filter((t) => isLate(t, now));
  const detailTask = detail ? find(detail.key) : undefined;
  const days = view === "week" ? Array.from({ length: 7 }, (_, i) => addDays(weekStart(cursor), i)) : [cursor];

  // 拖曳放開：格子改日期（時間不變）、全天列拿掉時間、時間表依位置改時間（長度不變）
  useEffect(() => {
    dropHandler = (key, kind, date, el, y, grab) => {
      const t = find(key);
      if (!t) return;
      if (kind === "day") return move(t, date);
      if (kind === "allday") return move(t, date, null);
      const start = minuteIn(el, y, grab);
      const len = t.time ? duration(t.time) : 60;
      move(t, date, t.time && t.time.end === undefined ? { start } : { start, end: Math.min(1440, start + len) });
    };
    return () => {
      dropHandler = null;
    };
  });

  const common = {
    now,
    cursor,
    byDay,
    onOpen: openDetail,
    onState: (t: CalItem) => setState(t, cycleState(t.state, !!t.due)),
    onQuick: openQuick,
    find,
    onDay: showDay,
  };

  return (
    <div className="cal-page">
      {/* 版面（使用者畫的線框）：上面一列是範圍、今天與月／週／日；下面左邊是月曆或時間表，
          右邊是小月曆與未完成。整頁填滿視窗，只有時間表與右邊面板自己捲動。 */}
      <header className="cal-bar no-box">
        <div className="cal-nav">
          <span className="cal-title">{rangeTitle(view, cursor)}</span>
          <button className="cal-today" onClick={goToday} title="Today (T)">
            Today
          </button>
          <button className="icon-btn" onClick={() => step(-1)} title="Previous (K)">
            <ChevronLeftIcon />
          </button>
          <button className="icon-btn" onClick={() => step(1)} title="Next (J)">
            <ChevronRightIcon />
          </button>
        </div>
        <div className="cal-tools">
          <div className="cal-views" role="tablist" aria-label="View">
            {VIEWS.map(([v, label, key]) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                className={view === v ? "on" : ""}
                onClick={() => setView(v)}
                title={`${label} (${key})`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="cal-key-wrap">
            <button
              className={`cal-help${showKey ? " on" : ""}`}
              onClick={() => setShowKey((v) => !v)}
              title="Help"
              aria-label="Help"
            >
              ?
            </button>
            {showKey && <Key onClose={() => setShowKey(false)} />}
          </div>
        </div>
      </header>

      {!journals.ready ? (
        <div className="journal-loading">Loading…</div>
      ) : (
        <div className="cal-body">
          <div className="cal-main" ref={mainRef}>
            {view === "year" ? (
              <YearView
                {...common}
                onMonth={(d) => {
                  setCursor(d);
                  setView("month");
                }}
              />
            ) : view === "month" ? (
              <MonthView {...common} />
            ) : (
              <TimeGrid {...common} days={days} nowMin={nowMin} view={view} />
            )}
          </div>

          <aside className="cal-side no-box">
            <MiniMonth cursor={cursor} now={now} byDay={byDay} onPick={setCursor} />
            <section className="cal-panel">
              <div className="cal-panel-head">
                <h2>Overdue ({overdue.length})</h2>
              </div>
              {!overdue.length && <p className="cal-empty">All caught up</p>}
              {overdue.map((t) => (
                <OverdueRow key={t.key} task={t} now={now} onState={setState} onSend={send} />
              ))}
            </section>
          </aside>
        </div>
      )}

      {quick && (
        <QuickAdd
          key={`${quick.date}:${quick.time?.start}:${quick.x}:${quick.y}`}
          init={quick}
          onAdd={add}
          onClose={() => setQuick(null)}
        />
      )}
      {detail && detailTask && (
        <Detail
          key={detail.key}
          task={detailTask}
          x={detail.x}
          y={detail.y}
          now={now}
          onState={(s) => setState(detailTask, s)}
          onMove={(date, time) => move(detailTask, date, time)}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

interface ViewProps {
  now: string;
  cursor: string;
  byDay: Map<string, CalItem[]>;
  onOpen: (t: CalItem, e: MouseEvent) => void;
  onState: (t: CalItem) => void;
  onQuick: (date: string, time: TaskTime | null, e: MouseEvent) => void;
  find: (key: string) => CalItem | undefined;
  onDay: (date: string) => void;
}

/** 點頁面連結開啟那一頁（回傳 true）；其他地方交給呼叫的人。 */
function clickRef(e: MouseEvent): boolean {
  const a = (e.target as HTMLElement).closest("a");
  if (!a) return false;
  e.preventDefault();
  e.stopPropagation();
  if (a.classList.contains("page-ref")) openPage(a.getAttribute("data-page") ?? "");
  return true;
}

const isLate = (t: CalItem, now: string) => (t.state === "open" || t.state === "scheduled") && dayOf(t) < now;

// ─── 年檢視 ────────────────────────────────────────────────────

/**
 * 一年 12 個月的小月曆（像 Apple 行事曆、Google 日曆的年檢視）。
 * 有項目的日子底色依數量變深（事件、任務都算），點日子看那一天，點月份名稱看那個月。
 */
function YearView(props: ViewProps & { onMonth: (date: string) => void }) {
  const { now, cursor, byDay } = props;
  const y = Number(cursor.slice(0, 4));
  return (
    <div className="cal-year no-box">
      {Array.from({ length: 12 }, (_, i) => {
        const m = i + 1;
        const prefix = `${y}-${String(m).padStart(2, "0")}`;
        const thisMonth = now.startsWith(prefix);
        return (
          <section key={m} className="cal-ym">
            <button
              className={`cal-ym-name${thisMonth ? " now" : ""}`}
              onClick={() => props.onMonth(`${prefix}-01`)}
              title="View this month"
            >
              {monthName(m)}
            </button>
            <div className="cal-ym-grid">
              {WEEK.map((w, wi) => (
                <span key={w} className={`cal-ym-wd${wi === 0 || wi === 6 ? " weekend" : ""}`}>
                  {w}
                </span>
              ))}
              {monthGrid(y, m)
                .flat()
                .map((d) => {
                  if (!d.startsWith(prefix)) return <span key={d} />;
                  const items = byDay.get(d) ?? [];
                  const open = items.filter((t) => t.state === "open").length;
                  const events = items.filter((t) => t.state === "event").length;
                  const level = Math.min(3, items.length);
                  const cls = [
                    "cal-ym-day",
                    d === now ? "today" : "",
                    d === cursor ? "on" : "",
                    level ? `lv${level}` : "",
                    open && d < now ? "late" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  const tip = items.length
                    ? `${shortDay(d)}: ${events ? `${events} event${events > 1 ? "s" : ""}` : ""}${events && items.length - events ? ", " : ""}${
                        items.length - events ? `${items.length - events} task${items.length - events > 1 ? "s" : ""}` : ""
                      }`
                    : shortDay(d);
                  return (
                    <button key={d} className={cls} onClick={() => props.onDay(d)} title={tip} {...dropAttrs("day", d)}>
                      {Number(d.slice(8))}
                    </button>
                  );
                })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ─── 月檢視 ────────────────────────────────────────────────────

function MonthView(props: ViewProps) {
  const [y, m] = props.cursor.split("-").map(Number);
  const prefix = props.cursor.slice(0, 7);
  // 最後一週全是下個月的就不顯示（5 或 6 週）
  const grid = monthGrid(y, m).filter((week) => week.some((d) => d.startsWith(prefix)));
  // 格子高度跟著視窗：量一格的高度，算出放得下幾項
  const ref = useRef<HTMLDivElement>(null);
  const [max, setMax] = useState(CELL_MAX);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const cell = el.querySelector<HTMLElement>(".cal-cell");
      if (!cell) return;
      // 日期數字約 26px，一項約 21px，留一行給「還有 N 項」
      setMax(Math.max(1, Math.floor((cell.clientHeight - 32) / 21) - 1));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [grid.length]);
  return (
    <div className="cal-month no-box" ref={ref}>
      <div className="cal-week cal-head-row">
        {WEEK.map((w, i) => (
          <span key={w} className={`cal-wd${i === 0 || i === 6 ? " weekend" : ""}`}>
            {w}
          </span>
        ))}
      </div>
      {grid.map((week) => (
        <div key={week[0]} className="cal-week">
          {week.map((d) => (
            <DayCell
              key={d}
              {...props}
              date={d}
              max={max}
              inMonth={d.startsWith(prefix)}
              items={props.byDay.get(d) ?? []}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function DayCell(props: ViewProps & { date: string; max: number; inMonth: boolean; items: CalItem[] }) {
  const { date, now, items } = props;
  const wd = parseKey(date).getDay();
  // 全部放得下就全部顯示，否則留一行給「還有 N 項」
  const shown = items.length <= props.max + 1 ? items : items.slice(0, props.max);
  const more = items.length - shown.length;
  const cls = [
    "cal-cell",
    props.inMonth ? "" : "other",
    date === now ? "today" : "",
    date === props.cursor ? "selected" : "",
    wd === 0 || wd === 6 ? "weekend" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={cls}
      onClick={(e) => props.onQuick(date, null, e)}
      {...dropAttrs("day", date)}
    >
      <button
        className="cal-dnum"
        onClick={(e) => {
          e.stopPropagation();
          props.onDay(date);
        }}
        title="View this day"
      >
        {Number(date.slice(8))}
      </button>
      <div className="cal-items">
        {shown.map((t) => (
          <CellItem key={t.key} task={t} now={now} showTime onOpen={props.onOpen} onState={props.onState} />
        ))}
        {more > 0 && (
          <button
            className="cal-more"
            onClick={(e) => {
              e.stopPropagation();
              props.onDay(date);
            }}
          >
            +{more} more
          </button>
        )}
      </div>
    </div>
  );
}

function CellItem(props: {
  task: CalItem;
  now: string;
  showTime?: boolean;
  onOpen: (t: CalItem, e: MouseEvent) => void;
  onState: (t: CalItem) => void;
}) {
  const { task, now } = props;
  const html = useMemo(() => contentHtml(task.title), [task.title]);
  return (
    <div
      className={`cal-item t-${task.state}${isLate(task, now) ? " late" : ""}`}
      title={`${TASK_LABEL[task.state]}: ${task.text}`}
      onClick={(e) => {
        e.stopPropagation();
        if (!clickRef(e)) props.onOpen(task, e);
      }}
      {...dragProps(task)}
    >
      <TaskGlyph state={task.state} onClick={() => props.onState(task)} />
      {props.showTime && task.time && <span className="cal-item-time">{clock(task.time.start)}</span>}
      <span className="cal-item-text" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

// ─── 週檢視、日檢視（時間表） ──────────────────────────────────

function TimeGrid(props: ViewProps & { days: string[]; nowMin: number; view: View }) {
  const { days, now, byDay } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const cols = { gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))` };

  // 一開始捲到最早的項目（或早上 7 點）
  const first = days[0];
  useLayoutEffect(() => {
    const starts = days.flatMap((d) => (byDay.get(d) ?? []).flatMap((t) => (t.time ? [t.time.start] : [])));
    const at = Math.min(7 * 60, ...starts);
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, (at / 60 - 0.5) * HOUR);
    // 換日期範圍時才捲動
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first, days.length]);

  /** 時間表上的位置 → 分鐘（對齊 SNAP） */
  const minuteAt = (e: MouseEvent, grab = 0) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const min = ((e.clientY - r.top) / HOUR) * 60 - grab;
    return Math.max(0, Math.min(1440 - SNAP, Math.round(min / SNAP) * SNAP));
  };

  return (
    <div className={`tg tg-v-${props.view} no-box`}>
      <div className="tg-head" style={cols}>
        <span className="tg-gutter" />
        {days.map((d) => {
          const wd = parseKey(d).getDay();
          return (
            <div key={d} className={`tg-day${d === now ? " today" : ""}${wd === 0 || wd === 6 ? " weekend" : ""}`}>
              <span className="tg-wd">{WEEK[wd]}</span>
              <button className="tg-dnum" onClick={() => props.onDay(d)} title="View this day">
                {Number(d.slice(8))}
              </button>
              {props.view === "day" && (
                <button className="cal-link tg-journal" onClick={() => openPage(d)}>
                  <JournalIcon /> Open this day's journal
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="tg-allday" style={cols}>
        <span className="tg-gutter tg-label">All day</span>
        {days.map((d) => (
          <div
            key={d}
            className="tg-allday-cell"
            onClick={(e) => props.onQuick(d, null, e)}
            {...dropAttrs("allday", d)}
          >
            {(byDay.get(d) ?? [])
              .filter((t) => !t.time)
              .map((t) => (
                <CellItem key={t.key} task={t} now={now} onOpen={props.onOpen} onState={props.onState} />
              ))}
          </div>
        ))}
      </div>

      <div className="tg-scroll" ref={scrollRef}>
        <div className="tg-body" style={{ ...cols, height: 24 * HOUR }}>
          <div className="tg-gutter tg-hours">
            {Array.from({ length: 23 }, (_, i) => (
              <span key={i} style={{ top: (i + 1) * HOUR }}>
                {clock((i + 1) * 60)}
              </span>
            ))}
          </div>
          {days.map((d) => {
            const timed = (byDay.get(d) ?? []).filter((t) => t.time);
            return (
              <div
                key={d}
                className={`tg-col${d === now ? " today" : ""}`}
                style={{ backgroundSize: `100% ${HOUR}px` }}
                onClick={(e) => {
                  const start = Math.floor(minuteAt(e) / 30) * 30;
                  props.onQuick(d, { start, end: Math.min(1440, start + 60) }, e);
                }}
                {...dropAttrs("time", d)}
              >
                {layoutTimed(timed, (t) => t.time!).map(({ item, col, cols: n }) => (
                  <TimedItem key={item.key} {...props} task={item} col={col} cols={n} />
                ))}
                {d === now && (
                  <div className="tg-now" style={{ top: (props.nowMin / 60) * HOUR }} aria-label="Now" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TimedItem(props: ViewProps & { task: CalItem; col: number; cols: number }) {
  const { task, col, cols, now } = props;
  const time = task.time!;
  const html = useMemo(() => contentHtml(task.title), [task.title]);
  const len = duration(time);
  const height = Math.max(len, 22) / 60 * HOUR - 2;
  return (
    <div
      className={`tg-item t-${task.state}${isLate(task, now) ? " late" : ""}${len <= 30 ? " short" : ""}`}
      style={{
        top: (time.start / 60) * HOUR + 1,
        height,
        // 重疊的項目像 Google 日曆一樣互相蓋住一點（後面的在上面），不要切得太窄
        left: `calc(${(col / cols) * 100}% + 1px)`,
        width: `calc(${(col === cols - 1 ? 1 / cols : Math.min(1.7 / cols, 1 - col / cols)) * 100}% - 3px)`,
        zIndex: 1 + col,
      }}
      title={`${timeLabel(time)}  ${task.text}`}
      onClick={(e) => {
        e.stopPropagation();
        if (!clickRef(e)) props.onOpen(task, e);
      }}
      {...dragProps(task, (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        return ((e.clientY - r.top) / HOUR) * 60;
      })}
    >
      <div className="tg-item-head">
        <TaskGlyph state={task.state} onClick={() => props.onState(task)} />
        <span className="tg-item-text" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      <span className="tg-item-time">{timeLabel(time)}</span>
    </div>
  );
}

// ─── 浮動視窗：新增、詳細 ─────────────────────────────────────

function TimeFields(props: {
  start: string;
  end: string;
  onStart: (v: string) => void;
  onEnd: (v: string) => void;
  onClear?: () => void;
}) {
  return (
    <div className="cal-time-row">
      <ClockIcon />
      <input type="time" value={props.start} onChange={(e) => props.onStart(e.target.value)} aria-label="Start time" />
      <span>–</span>
      <input type="time" value={props.end} onChange={(e) => props.onEnd(e.target.value)} aria-label="End time" />
      {props.onClear && (
        <button type="button" className="cal-link" onClick={props.onClear}>
          All day
        </button>
      )}
    </div>
  );
}

/** 開始、結束時間的文字 → TaskTime（開始沒填是全天） */
function readTime(start: string, end: string): TaskTime | null {
  const s = parseClock(start);
  if (s === null || s >= 1440) return null;
  const e = parseClock(end);
  return e !== null && e > s ? { start: s, end: e } : { start: s };
}

function QuickAdd(props: {
  init: QuickInit;
  onAdd: (kind: "open" | "event", text: string, date: string, time: TaskTime | null) => void;
  onClose: () => void;
}) {
  const { init } = props;
  const ref = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState<"open" | "event">(init.time ? "event" : "open");
  const [text, setText] = useState("");
  const [date, setDate] = useState(init.date);
  const [start, setStart] = useState(init.time ? clock(init.time.start) : "");
  const [end, setEnd] = useState(init.time?.end !== undefined ? clock(init.time.end) : "");
  useDismiss(ref, props.onClose);
  const pos = usePlace(ref, init.x, init.y);

  // 改開始時間時結束時間跟著移（保持長度）
  const changeStart = (v: string) => {
    const a = parseClock(start);
    const b = parseClock(end);
    const n = parseClock(v);
    if (a !== null && b !== null && n !== null && b > a) setEnd(clock(Math.min(1439, n + b - a)));
    setStart(v);
  };

  return (
    <form
      ref={ref}
      className="popover cal-pop cal-quick"
      style={pos}
      onSubmit={(e) => {
        e.preventDefault();
        const t = text.trim();
        if (!t || !isDateKey(date)) return;
        props.onAdd(kind, t, date, readTime(start, end));
        props.onClose();
      }}
    >
      <input
        className="cal-quick-title"
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={kind === "event" ? "New event" : "New task"}
      />
      <div className="cal-kind" role="radiogroup" aria-label="Type">
        {(["event", "open"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            className={kind === k ? "on" : ""}
            onClick={() => setKind(k)}
          >
            <TaskIcon state={k} size={13} />
            {TASK_LABEL[k]}
          </button>
        ))}
      </div>
      <div className="cal-time-row">
        <CalendarIcon />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
      </div>
      <TimeFields
        start={start}
        end={end}
        onStart={changeStart}
        onEnd={setEnd}
        onClear={start || end ? () => (setStart(""), setEnd("")) : undefined}
      />
      <div className="cal-pop-actions">
        <span className="cal-pop-hint">Goes into the journal for {shortDay(isDateKey(date) ? date : init.date)}</span>
        <button type="button" className="cal-btn" onClick={props.onClose}>
          Cancel
        </button>
        <button type="submit" className="cal-btn primary" disabled={!text.trim()}>
          Save
        </button>
      </div>
    </form>
  );
}

function Detail(props: {
  task: CalItem;
  x: number;
  y: number;
  now: string;
  onState: (s: TaskState) => void;
  onMove: (date: string, time?: TaskTime | null) => void;
  onClose: () => void;
}) {
  const { task, now } = props;
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, props.onClose);
  const pos = usePlace(ref, props.x, props.y);
  const html = useMemo(() => contentHtml(task.title), [task.title]);
  const t = task.time;
  const [start, setStart] = useState(t ? clock(t.start) : "");
  const [end, setEnd] = useState(t?.end !== undefined ? clock(t.end) : "");

  const commit = (s: string, e: string) => {
    const time = readTime(s, e);
    if (s && !time) return; // 還在輸入
    props.onMove(dayOf(task), time);
  };
  const states: TaskState[] =
    task.state === "event"
      ? ["event", "open"]
      : task.due
        ? ["scheduled", "done", "cancelled"]
        : ["open", "done", "cancelled", "event"];

  return (
    <div ref={ref} className="popover cal-pop cal-detail" style={pos}>
      <div className={`cal-detail-title t-${task.state}${isLate(task, now) ? " late" : ""}`}>
        <TaskIcon state={task.state} size={16} />
        <span onClick={(e) => clickRef(e)} dangerouslySetInnerHTML={{ __html: html || "(empty)" }} />
      </div>
      <div className="cal-time-row">
        <CalendarIcon />
        <DateChip date={dayOf(task)} state={task.state} onOpen={openPage} />
        {movable(task) && (
          // 換日期就是排程：原本的標成 <，那天的日記加一份
          <label className="cal-schedule cal-detail-schedule" title="Schedule to another day (marks this one <)">
            <TaskIcon state="scheduled" size={12} /> Schedule
            <input
              type="date"
              onChange={(e) => {
                if (isDateKey(e.target.value) && e.target.value !== task.date) {
                  props.onMove(e.target.value);
                  props.onClose();
                }
              }}
              aria-label="Schedule to"
            />
          </label>
        )}
      </div>
      <TimeFields
        start={start}
        end={end}
        onStart={(v) => {
          const a = parseClock(start);
          const b = parseClock(end);
          const n = parseClock(v);
          const ne = a !== null && b !== null && n !== null && b > a ? clock(Math.min(1439, n + b - a)) : end;
          setStart(v);
          setEnd(ne);
          commit(v, ne);
        }}
        onEnd={(v) => {
          setEnd(v);
          commit(start, v);
        }}
        onClear={
          start
            ? () => {
                setStart("");
                setEnd("");
                props.onMove(dayOf(task), null);
              }
            : undefined
        }
      />
      <div className="cal-states">
        {states.map((s) => (
          <button
            key={s}
            className={task.state === s ? "on" : ""}
            onClick={() => props.onState(s)}
            title={TASK_LABEL[s]}
          >
            <TaskIcon state={s} size={13} />
            {TASK_LABEL[s]}
          </button>
        ))}
      </div>
      <div className="cal-pop-actions">
        <span className="cal-pop-hint">Written on {shortDay(task.date)}</span>
        <button
          className="cal-btn"
          onClick={() => {
            props.onClose();
            openPage(task.date);
          }}
        >
          <JournalIcon /> Open journal
        </button>
      </div>
    </div>
  );
}

// ─── 右邊：小月曆、未完成 ──────────────────────────────────────

function MiniMonth(props: { cursor: string; now: string; byDay: Map<string, CalItem[]>; onPick: (d: string) => void }) {
  const { cursor, now } = props;
  const [shown, setShown] = useState(cursor.slice(0, 7));
  useEffect(() => setShown(cursor.slice(0, 7)), [cursor]);
  const [y, m] = shown.split("-").map(Number);
  const grid = monthGrid(y, m).filter((week) => week.some((d) => d.startsWith(shown)));
  const go = (n: number) => setShown(addMonths(shown + "-01", n).slice(0, 7));
  const week = weekStart(cursor);
  return (
    <section className="cal-mini">
      <div className="cal-mini-head">
        <span>
          {monthName(m)} {y}
        </span>
        <button className="icon-btn" onClick={() => go(-1)} title="Previous month">
          <ChevronLeftIcon />
        </button>
        <button className="icon-btn" onClick={() => go(1)} title="Next month">
          <ChevronRightIcon />
        </button>
      </div>
      <div className="cal-mini-grid">
        {WEEK.map((w) => (
          <span key={w} className="cal-mini-wd">
            {w}
          </span>
        ))}
        {grid.flat().map((d) => {
          const cls = [
            "cal-mini-day",
            d.startsWith(shown) ? "" : "other",
            d === now ? "today" : "",
            d === cursor ? "on" : "",
            d >= week && d <= addDays(week, 6) ? "in-week" : "",
            props.byDay.get(d)?.length ? "has" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button key={d} className={cls} onClick={() => props.onPick(d)} {...dropAttrs("day", d)}>
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function OverdueRow(props: {
  task: CalItem;
  now: string;
  onState: (t: CalItem, s: TaskState | null) => void;
  onSend: (items: CalItem[], date: string) => void;
}) {
  const { task, now } = props;
  const html = useMemo(() => contentHtml(task.text), [task.text]);
  return (
    <div className="cal-od">
      <div className="cal-od-main">
        <TaskGlyph state={task.state} onClick={() => props.onState(task, cycleState(task.state, !!task.due))} />
        <span
          className="cal-od-text"
          onClick={(e) => {
            if (!clickRef(e)) openPage(task.date);
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <DateChip date={dayOf(task)} state={task.state} onOpen={openPage} />
      </div>
      <div className="cal-od-actions">
        <label className="cal-schedule" title="Schedule to a day (marks the original <)">
          <TaskIcon state="scheduled" size={12} /> Schedule
          <input
            type="date"
            min={now}
            onChange={(e) => {
              if (isDateKey(e.target.value)) props.onSend([task], e.target.value);
            }}
          />
        </label>
        <button onClick={() => props.onState(task, "cancelled")} title="Won't do">
          <TaskIcon state="cancelled" size={12} /> Cancel
        </button>
      </div>
    </div>
  );
}

// ─── 說明 ──────────────────────────────────────────────────────

function Key(props: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const keep = useRef(() => ref.current?.parentElement ?? null).current;
  useDismiss(ref, props.onClose, keep);
  const rows: [TaskState | "note", string, string][] = [
    ["open", "- { } item", "Task"],
    ["done", "- {x} item", "Done"],
    ["scheduled", "- {<} item [[2026-11-20]]", "Scheduled to that day"],
    ["cancelled", "- {-} item", "Cancelled"],
    ["event", "- {o} item", "Event"],
    ["note", "- item", "Note"],
  ];
  const shortcuts: [string, string][] = [
    ["Y / M / W / D", "Year / Month / Week / Day"],
    ["T", "Today"],
    ["J / K", "Next / previous"],
    ["C", "Create"],
  ];
  return (
    <div className="popover cal-key" ref={ref}>
      <div className="popover-title">Symbols</div>
      <table>
        <tbody>
          {rows.map(([s, md, desc]) => (
            <tr key={s}>
              <td className={`g-${s}`}>
                <TaskIcon state={s} size={15} />
              </td>
              <td>{desc}</td>
              <td>
                <code>{md}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul>
        <li>
          Put the time at the start: <code>{"- {o} 14:00-15:30 Meeting"}</code>.
        </li>
        <li>
          Items go on the day they were written. Scheduling keeps the item where it is, marks it <code>{"{<}"}</code> and adds the date at the end; it then shows on that day here and in that day's journal.
        </li>
        <li>Click empty space to add, click an item for details, drag to another day to schedule it (same day: change the time); click a symbol to toggle done.</li>
      </ul>
      <div className="popover-title">Shortcuts</div>
      <table>
        <tbody>
          {shortcuts.map(([k, d]) => (
            <tr key={k}>
              <td className="k">
                <code>{k}</code>
              </td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
