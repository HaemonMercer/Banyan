import { lineTask } from "./tasks";

/**
 * 任務與事件的時間：寫在內容最前面，`14:00` 或 `14:00-15:30`（也接受 `–`、`~`）。
 *
 *   - [o] 14:00-15:30 開會 [[2026-11-20]]
 *
 * 跟日期一樣只是普通文字，其他 Markdown 軟體也看得懂。時間以「從午夜起算的分鐘」表示。
 */
export interface TaskTime {
  start: number;
  /** 結束時間（沒寫就是只有開始時間） */
  end?: number;
}

const TIME = /^(\d{1,2}):(\d{2})(?:[ \t]*[-–~][ \t]*(\d{1,2}):(\d{2}))?(?=[ \t]|$)[ \t]*/;

const minutes = (h: string, m: string) => {
  const hh = Number(h);
  const mm = Number(m);
  return hh <= 24 && mm < 60 && hh * 60 + mm <= 1440 ? hh * 60 + mm : null;
};

/** 內容開頭的時間；rest 是去掉時間之後的內容。 */
export function parseTime(text: string): { time: TaskTime | null; rest: string } {
  const m = TIME.exec(text);
  if (!m) return { time: null, rest: text };
  const start = minutes(m[1], m[2]);
  if (start === null || start >= 1440) return { time: null, rest: text };
  const end = m[3] ? minutes(m[3], m[4]) : null;
  const time: TaskTime = end !== null && end > start ? { start, end } : { start };
  return { time, rest: text.slice(m[0].length) };
}

/** 分鐘 → `HH:MM`。 */
export function clock(min: number): string {
  const h = Math.floor(min / 60);
  return `${String(h).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** `HH:MM` → 分鐘（格式不對是 null）。 */
export function parseClock(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  return m ? minutes(m[1], m[2]) : null;
}

/** 寫進 Markdown 的時間：`14:00` 或 `14:00-15:30`。 */
export function timeText(t: TaskTime): string {
  return t.end !== undefined && t.end > t.start ? `${clock(t.start)}-${clock(t.end)}` : clock(t.start);
}

/** 畫面上顯示的時間：`14:00 – 15:30`。 */
export function timeLabel(t: TaskTime): string {
  return t.end !== undefined && t.end > t.start ? `${clock(t.start)} – ${clock(t.end)}` : clock(t.start);
}

/** 時間長度（分鐘）；只有開始時間的算一小時。 */
export function duration(t: TaskTime): number {
  return t.end !== undefined && t.end > t.start ? t.end - t.start : 60;
}

/** 設定或拿掉任務行的時間（time 為 null 時拿掉）；不是任務就不變。 */
export function setLineTime(line: string, time: TaskTime | null): string {
  const t = lineTask(line);
  if (!t) return line;
  const head = line.slice(0, t.prefix);
  const { rest } = parseTime(line.slice(t.prefix));
  if (!time) return head + rest;
  return head + timeText(time) + (rest ? " " + rest : "");
}

export function setTimeAt(source: string, line: number, time: TaskTime | null): string {
  const lines = source.split("\n");
  if (line < 0 || line >= lines.length || !lineTask(lines[line])) return source;
  lines[line] = setLineTime(lines[line], time);
  return lines.join("\n");
}

/**
 * 同一天有時間的項目排版：時間重疊的並排（像 Google 日曆），
 * 回傳每一項在第幾欄、這一群共有幾欄。
 */
export function layoutTimed<T>(items: T[], timeOf: (x: T) => TaskTime): { item: T; col: number; cols: number }[] {
  const sorted = [...items].sort((a, b) => timeOf(a).start - timeOf(b).start || duration(timeOf(b)) - duration(timeOf(a)));
  const out: { item: T; col: number; cols: number }[] = [];
  let group: { item: T; col: number; cols: number }[] = [];
  let colEnds: number[] = [];
  let groupEnd = -1;
  const flush = () => {
    for (const g of group) g.cols = colEnds.length;
    out.push(...group);
    group = [];
    colEnds = [];
  };
  for (const item of sorted) {
    const t = timeOf(item);
    const end = t.start + duration(t);
    if (group.length && t.start >= groupEnd) flush();
    let col = colEnds.findIndex((e) => e <= t.start);
    if (col < 0) col = colEnds.push(end) - 1;
    else colEnds[col] = end;
    group.push({ item, col, cols: 1 });
    groupEnd = Math.max(groupEnd, end);
  }
  flush();
  return out;
}
