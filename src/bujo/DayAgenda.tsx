import { useMemo, type MouseEvent } from "react";
import { contentHtml } from "../editor/wysiwyg";
import { PagesIcon } from "../editor/icons";
import { dayTitle, isDateKey } from "../journal/journal";
import type { Docs } from "../journal/useJournals";
import { openPage } from "../pages/pageRef";
import { agendaDay, agendaFor, collectAll, type AgendaItem } from "./agenda";
import { DateChip, TaskGlyph, TaskIcon } from "./TaskGlyph";
import { cycleState, scheduleAt, setTaskAt } from "./tasks";
import { timeLabel } from "./time";
import "./bujo.css";

/**
 * 日記上方的「該做的事」：排程到這天的任務、事件（任務留在寫它的地方，這裡列出），
 * 今天另外列出過期的，可以重新排程（含今天）或取消。沒有項目時整塊不顯示。
 */
export function DayAgenda(props: { date: string; now: string; journals: Docs; pages: Docs }) {
  const { date, now, journals, pages } = props;
  const all = useMemo(() => collectAll(journals.contents, pages.contents), [journals.contents, pages.contents]);
  const { scheduled, overdue } = useMemo(() => agendaFor(all, date, now), [all, date, now]);
  if (!scheduled.length && !overdue.length) return null;

  const tasks = scheduled.filter((t) => t.state !== "event");
  const events = scheduled.filter((t) => t.state === "event");
  // 今天：「Today's Tasks」；其他天：「Tasks for Nov 20」
  const label = (what: string) => (date === now ? `Today's ${what}` : `${what} for ${dayTitle(date, now)}`);

  const docs = (t: AgendaItem) => (t.kind === "day" ? journals : pages);
  const toggle = (t: AgendaItem) => docs(t).modify(t.key, (s) => setTaskAt(s, t.line, cycleState(t.state, !!t.due)));
  /** 排程（或重新排程）：任務留在原處，標成 <、行尾寫上日期；排回寫的那天就取消排程 */
  const schedule = (t: AgendaItem, d: string) =>
    docs(t).modify(t.key, (s) => scheduleAt(s, t.line, t.kind === "day" && d === t.key ? null : d));
  const cancel = (t: AgendaItem) => docs(t).modify(t.key, (s) => setTaskAt(s, t.line, "cancelled"));

  const row = (t: AgendaItem, late: boolean) => (
    <AgendaRow
      key={t.kind + t.key + ":" + t.line}
      task={t}
      now={now}
      late={late}
      onToggle={toggle}
      onSchedule={(d) => schedule(t, d)}
      onCancel={() => cancel(t)}
    />
  );

  return (
    <section className="agenda no-box" aria-label="Agenda">
      {tasks.length > 0 && (
        <>
          <h2 className="agenda-head">
            <TaskIcon state="scheduled" size={13} />
            {label("Tasks")} ({tasks.length})
          </h2>
          {tasks.map((t) => row(t, false))}
        </>
      )}
      {events.length > 0 && (
        <>
          <h2 className="agenda-head">
            <TaskIcon state="event" size={13} />
            {label("Events")} ({events.length})
          </h2>
          {events.map((t) => row(t, false))}
        </>
      )}
      {overdue.length > 0 && (
        <>
          <h2 className="agenda-head late">
            <TaskIcon state="open" size={13} />
            Overdue ({overdue.length})
          </h2>
          {overdue.map((t) => row(t, true))}
        </>
      )}
    </section>
  );
}

function AgendaRow(props: {
  task: AgendaItem;
  now: string;
  late: boolean;
  onToggle: (t: AgendaItem) => void;
  onSchedule: (date: string) => void;
  onCancel: () => void;
}) {
  const { task, late } = props;
  const html = useMemo(() => contentHtml(task.title), [task.title]);
  const open = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    e.preventDefault();
    if (a?.classList.contains("page-ref")) openPage(a.getAttribute("data-page") ?? "");
    else if (!a) openPage(task.key);
  };
  const pending = task.state === "open" || task.state === "scheduled" || task.state === "event";
  const day = agendaDay(task);
  return (
    <div className={`agenda-row t-${task.state}`}>
      <TaskGlyph state={task.state} onClick={() => props.onToggle(task)} />
      {task.time && <span className="agenda-time">{timeLabel(task.time)}</span>}
      <span className="agenda-text" onClick={open} title="Open where it was written" dangerouslySetInnerHTML={{ __html: html }} />
      {late && day && <DateChip date={day} state={task.state} onOpen={openPage} />}
      <button className="agenda-src" onClick={() => openPage(task.key)} title="Open where it was written">
        {task.kind === "page" ? (
          <>
            <PagesIcon width={12} height={12} />
            {task.key}
          </>
        ) : (
          `from ${dayTitle(task.key, props.now)}`
        )}
      </button>
      {pending && (
        <label className="agenda-act cal-schedule" title="Schedule to a day, today included (marks it <)">
          <TaskIcon state="scheduled" size={12} /> {late ? "Schedule" : "Reschedule"}
          <input
            type="date"
            min={props.now}
            onChange={(e) => {
              if (isDateKey(e.target.value)) props.onSchedule(e.target.value);
            }}
          />
        </label>
      )}
      {late && (
        <button className="agenda-act" onClick={props.onCancel} title="Won't do">
          <TaskIcon state="cancelled" size={12} /> Cancel
        </button>
      )}
    </div>
  );
}
