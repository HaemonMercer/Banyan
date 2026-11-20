import { collectTasks, type TaskItem } from "./tasks";
import { parseTime, type TaskTime } from "./time";

/**
 * 日記上方的「該做的事」：
 * - 排到這天的：排程到這天（`- [<] 任務 [[YYYY-MM-DD]]`）、寫在別處的任務與事件。
 *   任務留在原處，這裡列出它；寫在這天日記裡的不重複列出。
 * - 今天另外列出過期的：未完成或已排程、排的日子（排程日期，沒有就是寫的那天）在今天以前。
 *   頁面裡沒有排程日期的任務不屬於哪一天，不會列出。
 */
export interface AgendaItem extends TaskItem {
  /** 寫在哪裡：日記（key 是日期）或頁面（key 是名稱） */
  kind: "day" | "page";
  key: string;
  time: TaskTime | null;
  /** 去掉時間的內容 */
  title: string;
}

/** 排在哪一天（頁面裡沒有排程日期的是 null） */
export const agendaDay = (t: AgendaItem): string | null => t.due ?? (t.kind === "day" ? t.key : null);

const cache = new WeakMap<Record<string, string>, AgendaItem[]>();

function collect(kind: "day" | "page", contents: Record<string, string>): AgendaItem[] {
  const hit = cache.get(contents);
  if (hit) return hit;
  const out: AgendaItem[] = [];
  for (const [key, content] of Object.entries(contents)) {
    if (!content.includes("{") && !content.includes("[")) continue;
    for (const t of collectTasks(content)) {
      const { time, rest } = parseTime(t.text);
      out.push({ ...t, kind, key, time, title: rest });
    }
  }
  cache.set(contents, out);
  return out;
}

/** 所有日記與頁面裡的任務與事件（依內容快取，內容沒變就不重算）。 */
export function collectAll(journals: Record<string, string>, pages: Record<string, string> = {}): AgendaItem[] {
  return [...collect("day", journals), ...collect("page", pages)];
}

const byTime = (a: AgendaItem, b: AgendaItem) =>
  (a.time?.start ?? -1) - (b.time?.start ?? -1) || a.key.localeCompare(b.key) || a.line - b.line;

/** 某一天的「該做的事」：排到這天的（依時間），與今天的過期（舊的在前）。 */
export function agendaFor(
  all: AgendaItem[],
  date: string,
  now: string,
): { scheduled: AgendaItem[]; overdue: AgendaItem[] } {
  const scheduled = all.filter((t) => t.due === date && !(t.kind === "day" && t.key === date)).sort(byTime);
  const overdue =
    date === now
      ? all
          .filter((t) => {
            const d = agendaDay(t);
            return (t.state === "open" || t.state === "scheduled") && d !== null && d < now;
          })
          .sort((a, b) => agendaDay(a)!.localeCompare(agendaDay(b)!) || byTime(a, b))
      : [];
  return { scheduled, overdue };
}
