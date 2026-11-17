import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * 日記（參考 Logseq 的 Journals）：每天一頁 Markdown。
 *
 * 日期一律用當地時間的 `YYYY-MM-DD` 字串表示（以下稱「日期鍵」）。
 * 在 App 裡存成 App 資料夾的 `journals/2026_11_17.md`（Rust 指令 journal_list／read／write，
 * 檔名與 Logseq 相同）；只有前端（瀏覽器預覽）時存在 localStorage。內容是空的就刪掉。
 */

// ─── 日期 ──────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

/** Date → 日期鍵（當地時間）。 */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isDateKey(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return dateKey(parseKey(s)) === s;
}

/** 日期鍵 → Date（當地時間的午夜）。 */
export function parseKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function today(): string {
  return dateKey(new Date());
}

export function addDays(key: string, n: number): string {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

/** 兩個日期相差幾天（b − a）。 */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseKey(b).getTime() - parseKey(a).getTime()) / 86_400_000);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** 星期的縮寫（月曆表頭、日期標籤） */
export const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** 月曆表頭用的兩字母星期（也當 React key，不能重複） */
export const WEEKDAYS_MIN = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));

/** 月份名稱（m 是 1～12） */
export const monthName = (m: number) => MONTHS[m - 1];
export const monthShort = (m: number) => MONTHS_SHORT[m - 1];

export function weekday(key: string): string {
  return WEEKDAYS[parseKey(key).getDay()];
}

export function weekdayShort(key: string): string {
  return WEEKDAYS_SHORT[parseKey(key).getDay()];
}

/** 日記標題：「Nov 17」，不是今年的加上年份（「Nov 17, 2025」）。 */
export function dayTitle(key: string, now = today()): string {
  const [y, m, d] = key.split("-").map(Number);
  const md = `${monthShort(m)} ${d}`;
  return y === Number(now.slice(0, 4)) ? md : `${md}, ${y}`;
}

/** 「Today」「Yesterday」「Tomorrow」之類，其他是空字串。 */
export function relativeLabel(key: string, now = today()): string {
  return { 0: "Today", [-1]: "Yesterday", [-2]: "2 days ago", 1: "Tomorrow" }[daysBetween(now, key)] ?? "";
}

/** 日記串要顯示的日子：今天（就算還沒寫）加上今天以前有寫的日子，新的在前。 */
export function streamDays(dates: Iterable<string>, now = today()): string[] {
  const set = new Set([...dates].filter((d) => d <= now));
  set.add(now);
  return [...set].sort().reverse();
}

/** 月曆：某年某月（month 從 1 開始）的 6 週 × 7 天，星期日開頭；不在這個月的日子也列出。 */
export function monthGrid(year: number, month: number): string[][] {
  const first = new Date(year, month - 1, 1);
  const start = addDays(dateKey(first), -first.getDay());
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, i) => addDays(start, w * 7 + i)));
}

// ─── 儲存 ──────────────────────────────────────────────────────

export interface JournalStore {
  /** 有寫的日期（新的在前） */
  list(): Promise<string[]>;
  /** 一天的內容（沒有就是空字串） */
  read(date: string): Promise<string>;
  /** 寫入；只有空白就刪掉 */
  write(date: string, content: string): Promise<void>;
}

/** 日記內容是不是空的（只有空白或空白區塊的 &nbsp;）。 */
export function isBlank(content: string): boolean {
  return content.replace(/&nbsp;/g, "").trim() === "";
}

const PREFIX = "banyan.journal.";

/** 存在 localStorage（瀏覽器預覽、測試用）。 */
export function localStore(storage: Storage): JournalStore {
  return {
    async list() {
      const dates: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k?.startsWith(PREFIX) && isDateKey(k.slice(PREFIX.length))) dates.push(k.slice(PREFIX.length));
      }
      return dates.sort().reverse();
    },
    async read(date) {
      return storage.getItem(PREFIX + date) ?? "";
    },
    async write(date, content) {
      if (isBlank(content)) storage.removeItem(PREFIX + date);
      else storage.setItem(PREFIX + date, content);
    },
  };
}

/** 存在 App 資料夾的 journals/（Rust 指令）。 */
function tauriStore(): JournalStore {
  return {
    list: () => invoke<string[]>("journal_list"),
    read: (date) => invoke<string>("journal_read", { date }),
    write: (date, content) => invoke<void>("journal_write", { date, content: isBlank(content) ? "" : content }),
  };
}

export function defaultStore(): JournalStore {
  return isTauri() ? tauriStore() : localStore(window.localStorage);
}
