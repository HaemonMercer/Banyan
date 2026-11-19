import { dayTitle, monthName, today, weekday } from "../journal/journal";
import { pageKey } from "./pageRef";

/**
 * 頁面範本（參考 Logseq）：名稱是 `Template/…` 的頁面就是範本，跟一般頁面一樣存在 `pages/`、一樣編輯。
 *
 * - 任何頁面或日記打「/範本名稱」（斜線選單）插入範本內容。
 * - 名稱是 `Template/Journal` 的範本：每天第一次打開 App 時，今天還沒有日記就用它寫上。
 * - 空白頁面上方列出範本，點了就用它開始。
 * - 範本裡的變數插入時換掉：`{{date}}`（`[[YYYY-MM-DD]]`，日記那一天或今天）、`{{today}}`（`Nov 18`）、
 *   `{{weekday}}`、`{{month}}`、`{{year}}`、`{{time}}`（`14:05`）、`{{title}}`（頁面名稱或日記日期）。
 *
 * App 在頁面清單變了時呼叫 `setTemplates`；編輯器的斜線選單用 `getTemplates` 讀（和 `setPageNames` 一樣）。
 */

export const TEMPLATE_PREFIX = "Template/";
export const JOURNAL_TEMPLATE = "Template/Journal";

export interface PageTemplate {
  /** 頁面名稱（`Template/Meeting`） */
  page: string;
  /** 顯示名稱（`Meeting`） */
  label: string;
  content: string;
}

export const isTemplatePage = (name: string) => pageKey(name).startsWith(pageKey(TEMPLATE_PREFIX)) && name.trim().length > TEMPLATE_PREFIX.length;

export const templateLabel = (name: string) => (isTemplatePage(name) ? name.trim().slice(TEMPLATE_PREFIX.length).trim() : name);

/** 從所有頁面挑出有內容的範本，依名稱排好 */
export function collectTemplates(contents: Record<string, string>): PageTemplate[] {
  return Object.entries(contents)
    .filter(([name, content]) => isTemplatePage(name) && content.trim())
    .map(([page, content]) => ({ page, label: templateLabel(page), content }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** 頁面另存成範本時的名稱：`Template/頁面名稱`，已經有了就加數字 */
export function templateNameFor(page: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(pageKey));
  const base = TEMPLATE_PREFIX + templateLabel(page).trim();
  if (!used.has(pageKey(base))) return base;
  for (let i = 2; ; i++) if (!used.has(pageKey(`${base} ${i}`))) return `${base} ${i}`;
}

export interface TemplateVars {
  /** 日記那一天（`YYYY-MM-DD`；預設今天） */
  date?: string;
  /** 頁面名稱（日記沒有：用日期標題） */
  title?: string;
  /** 現在（`{{time}}`） */
  now?: Date;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 換掉範本裡的變數（不認得的照舊），並去掉頭尾的空行 */
export function expandTemplate(text: string, vars: TemplateVars = {}): string {
  const date = vars.date ?? today();
  const now = vars.now ?? new Date();
  const [y, m] = date.split("-").map(Number);
  const values: Record<string, string> = {
    date: `[[${date}]]`,
    today: dayTitle(date, ""),
    weekday: weekday(date),
    month: monthName(m),
    year: String(y),
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    title: vars.title ?? dayTitle(date, ""),
  };
  return text
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (all, name: string) => values[name.toLowerCase()] ?? all)
    .replace(/^(?:[ \t]*\n)+/, "")
    .replace(/\s+$/, "");
}

let templates: PageTemplate[] = [];

export function setTemplates(list: PageTemplate[]): void {
  templates = list;
}

export function getTemplates(): PageTemplate[] {
  return templates;
}

export const findTemplate = (page: string, list = templates) => list.find((t) => pageKey(t.page) === pageKey(page));
