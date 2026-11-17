import { useEffect, useRef, useState } from "react";
import { Editor } from "../editor/Editor";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "../editor/icons";
import { addDays, dayTitle, monthGrid, parseKey, relativeLabel, streamDays, weekday } from "./journal";
import type { Journals } from "./useJournals";
import "./journal.css";

/** 一次多顯示幾天（捲到底再載入下一批） */
const PAGE = 10;

const PLACEHOLDER = "今天發生了什麼？輸入 / 插入區塊…";

// ─── 日記串（像 Logseq 的 Journals：今天在最上面，往下是以前寫過的日子） ─────

export function JournalStream(props: { journals: Journals; now: string; onOpenDay: (date: string) => void }) {
  const { journals, now } = props;
  const [shown, setShown] = useState(PAGE);
  const days = journals.dates ? streamDays(journals.dates, now) : [now];
  const visible = days.slice(0, shown);
  const more = days.length > shown;
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more) return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) setShown((n) => n + PAGE);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [more, shown]);

  return (
    <div className="journal-stream">
      {visible.map((date) => (
        <DaySection key={date} date={date} now={now} journals={journals} onOpenDay={props.onOpenDay} />
      ))}
      {more && <div ref={sentinel} className="journal-more no-box">載入更早的日記…</div>}
      {journals.dates && !more && days.length > 1 && <div className="journal-end no-box">以上是所有日記</div>}
    </div>
  );
}

function DaySection(props: { date: string; now: string; journals: Journals; onOpenDay: (date: string) => void }) {
  const { date, now, journals } = props;
  const { load } = journals;
  useEffect(() => load(date), [date, load]);
  const content = journals.contents[date];
  return (
    <section className={`journal-day${date === now ? " is-today" : ""}`}>
      <DayHeading date={date} now={now} onOpen={() => props.onOpenDay(date)} />
      {content === undefined ? (
        <div className="journal-loading">讀取中…</div>
      ) : (
        <Editor
          compact
          value={content}
          onChange={(md) => journals.update(date, md)}
          placeholder={date === now ? PLACEHOLDER : "這天沒有內容"}
        />
      )}
    </section>
  );
}

function DayHeading(props: { date: string; now: string; onOpen?: () => void; big?: boolean }) {
  const rel = relativeLabel(props.date, props.now);
  const title = dayTitle(props.date, props.now);
  return (
    <header className={`journal-head no-box${props.big ? " big" : ""}`}>
      {props.onOpen ? (
        <button className="journal-title" onClick={props.onOpen} title="單獨開啟這一天">
          {title}
        </button>
      ) : (
        <h1 className="journal-title">{title}</h1>
      )}
      <span className="journal-weekday">{weekday(props.date)}</span>
      {rel && <span className={`journal-rel${rel === "今天" ? " today" : ""}`}>{rel}</span>}
    </header>
  );
}

// ─── 單日頁面 ──────────────────────────────────────────────────

export function JournalDay(props: {
  journals: Journals;
  date: string;
  now: string;
  onOpenDay: (date: string) => void;
}) {
  const { journals, date, now, onOpenDay } = props;
  const { load } = journals;
  useEffect(() => load(date), [date, load]);
  const content = journals.contents[date];
  const has = (d: string) => !!journals.dates?.has(d);
  // 前一篇／後一篇有寫的日記
  const sorted = journals.dates ? [...journals.dates].sort() : [];
  const prevWritten = [...sorted].reverse().find((d) => d < date);
  const nextWritten = sorted.find((d) => d > date);

  return (
    <div className="journal-single">
      <nav className="journal-nav no-box">
        <button className="icon-btn" onClick={() => onOpenDay(addDays(date, -1))} title="前一天">
          <ChevronLeftIcon />
        </button>
        <button className="icon-btn" onClick={() => onOpenDay(addDays(date, 1))} title="後一天">
          <ChevronRightIcon />
        </button>
        {prevWritten && (
          <button className="journal-link" onClick={() => onOpenDay(prevWritten)}>
            ← 上一篇（{dayTitle(prevWritten, now)}）
          </button>
        )}
        {nextWritten && (
          <button className="journal-link" onClick={() => onOpenDay(nextWritten)}>
            下一篇（{dayTitle(nextWritten, now)}）→
          </button>
        )}
        {!has(date) && date !== now && <span className="journal-note">這天還沒有日記，打字就會建立</span>}
      </nav>
      <DayHeading date={date} now={now} big />
      {content === undefined ? (
        <div className="journal-loading">讀取中…</div>
      ) : (
        <Editor
          key={date}
          value={content}
          onChange={(md) => journals.update(date, md)}
          placeholder={date === now ? PLACEHOLDER : "點這裡開始寫這天的日記…"}
        />
      )}
    </div>
  );
}

// ─── 月曆 ──────────────────────────────────────────────────────

/** 頂端列的月曆：有寫日記的日子有圓點，點一下開啟那一天。 */
export function CalendarButton(props: {
  dates: Set<string> | null;
  now: string;
  selected: string | null;
  onPick: (date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div className="calendar-wrap" ref={ref}>
      <button className={`tool${open ? " on" : ""}`} onClick={() => setOpen((v) => !v)} title="日曆">
        <CalendarIcon />
        <span>日曆</span>
      </button>
      {open && (
        <Calendar
          dates={props.dates}
          now={props.now}
          selected={props.selected}
          onPick={(d) => {
            setOpen(false);
            props.onPick(d);
          }}
        />
      )}
    </div>
  );
}

export function Calendar(props: {
  dates: Set<string> | null;
  now: string;
  selected: string | null;
  onPick: (date: string) => void;
}) {
  const start = parseKey(props.selected ?? props.now);
  const [ym, setYm] = useState({ y: start.getFullYear(), m: start.getMonth() + 1 });
  const grid = monthGrid(ym.y, ym.m);
  const prefix = `${ym.y}-${String(ym.m).padStart(2, "0")}`;
  const step = (n: number) =>
    setYm(({ y, m }) => {
      const t = y * 12 + (m - 1) + n;
      return { y: Math.floor(t / 12), m: (t % 12) + 1 };
    });
  const count = props.dates ? [...props.dates].filter((d) => d.startsWith(prefix)).length : 0;
  return (
    <div className="calendar popover">
      <div className="cal-head">
        <button className="icon-btn" onClick={() => step(-1)} title="上個月">
          <ChevronLeftIcon />
        </button>
        <span className="cal-month">
          {ym.y} 年 {ym.m} 月
        </span>
        <button className="icon-btn" onClick={() => step(1)} title="下個月">
          <ChevronRightIcon />
        </button>
      </div>
      <div className="cal-grid">
        {["日", "一", "二", "三", "四", "五", "六"].map((w) => (
          <span key={w} className="cal-wd">
            {w}
          </span>
        ))}
        {grid.flat().map((d) => (
          <button
            key={d}
            className={[
              "cal-day",
              d.startsWith(prefix) ? "" : "other",
              d === props.now ? "today" : "",
              d === props.selected ? "selected" : "",
              props.dates?.has(d) ? "has" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => props.onPick(d)}
            title={`${dayTitle(d, props.now)} ${weekday(d)}`}
          >
            {Number(d.slice(8))}
          </button>
        ))}
      </div>
      <div className="cal-foot">
        <span>{count ? `這個月寫了 ${count} 天` : "這個月還沒有日記"}</span>
        <button className="journal-link" onClick={() => props.onPick(props.now)}>
          今天
        </button>
      </div>
    </div>
  );
}
