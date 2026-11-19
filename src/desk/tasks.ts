import { newId } from "./board";
import { addDays, dayTitle, isDateKey, today } from "../journal/journal";

/**
 * Tasks：參考 Trello 的任務看板。Dock 的一種文件（`kind: "tasks"`）。
 *
 * - 看板有幾個清單（`lists`，照陣列順序由左到右），卡片（`cards`）的 `list` 指向所在的清單，
 *   清單裡的順序就是 `cards` 陣列的順序（跟 Dock 資料夾一樣，資料是平的）。
 * - 卡片可以有標籤（看板共用的六種顏色，名稱可改）、截止日（`due`＝`YYYY-MM-DD`，`time`＝`HH:MM` 可省略）、
 *   完成（`done`）、說明（`desc`，純文字）、檢查清單（`checklist`）。
 * - 有卡片設了截止日，畫面上才出現 Calendar 檢視（`hasDue`）。
 *
 * 記憶體裡 `DockDoc.content` 是 JSON 字串，存檔時 `file.ts` 寫成 `tasks` 物件。這裡都是純函式。
 */

export type LabelColor = "green" | "yellow" | "orange" | "red" | "purple" | "blue";
export const LABEL_COLORS: LabelColor[] = ["green", "yellow", "orange", "red", "purple", "blue"];

export interface TaskLabel {
  id: string;
  color: LabelColor;
  name: string;
}

export interface TaskList {
  id: string;
  title: string;
}

export interface CheckItem {
  id: string;
  text: string;
  done: boolean;
}

export interface TaskCard {
  id: string;
  list: string;
  title: string;
  desc?: string;
  /** 截止日 `YYYY-MM-DD` */
  due?: string;
  /** 截止時間 `HH:MM`（有截止日才有意義） */
  time?: string;
  done?: boolean;
  labels?: string[];
  checklist?: CheckItem[];
}

export interface TaskBoard {
  lists: TaskList[];
  cards: TaskCard[];
  labels: TaskLabel[];
}

const defaultLabels = (): TaskLabel[] => LABEL_COLORS.map((color) => ({ id: color, color, name: "" }));

/** 新的看板：To do、Doing、Done 三個清單 */
export function starterTasks(): TaskBoard {
  return { lists: ["To do", "Doing", "Done"].map((title) => ({ id: newId(), title })), cards: [], labels: defaultLabels() };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** 從存檔的物件讀回看板（補齊欄位、丟掉壞掉的資料） */
export function tasksFrom(raw: unknown): TaskBoard {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const lists: TaskList[] = [];
  for (const l of Array.isArray(o.lists) ? o.lists : []) {
    if (!l || typeof l !== "object" || !str(l.id) || lists.some((x) => x.id === l.id)) continue;
    lists.push({ id: l.id, title: str(l.title) });
  }
  const labels: TaskLabel[] = [];
  for (const l of Array.isArray(o.labels) ? o.labels : []) {
    if (!l || typeof l !== "object" || !str(l.id) || labels.some((x) => x.id === l.id)) continue;
    labels.push({ id: l.id, color: LABEL_COLORS.includes(l.color) ? l.color : "green", name: str(l.name) });
  }
  if (!Array.isArray(o.labels)) labels.push(...defaultLabels());
  const listIds = new Set(lists.map((l) => l.id));
  const labelIds = new Set(labels.map((l) => l.id));
  const cards: TaskCard[] = [];
  for (const c of Array.isArray(o.cards) ? o.cards : []) {
    if (!c || typeof c !== "object" || !str(c.id) || !listIds.has(c.list) || cards.some((x) => x.id === c.id)) continue;
    const card: TaskCard = { id: c.id, list: c.list, title: str(c.title) };
    if (str(c.desc)) card.desc = c.desc;
    if (isDateKey(str(c.due))) {
      card.due = c.due;
      if (isTime(str(c.time))) card.time = c.time;
    }
    if (c.done === true) card.done = true;
    const ls = (Array.isArray(c.labels) ? (c.labels as unknown[]) : []).filter((x): x is string => typeof x === "string" && labelIds.has(x));
    if (ls.length) card.labels = [...new Set(ls)];
    const items = (Array.isArray(c.checklist) ? c.checklist : [])
      .filter((x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !!str((x as Record<string, unknown>).id))
      .map((x: Record<string, unknown>) => ({ id: x.id as string, text: str(x.text), done: x.done === true }));
    if (items.length) card.checklist = items;
    cards.push(card);
  }
  return { lists, cards, labels };
}

export function parseTasks(json: string): TaskBoard {
  if (!json.trim()) return starterTasks();
  try {
    return tasksFrom(JSON.parse(json));
  } catch {
    return starterTasks();
  }
}

/** 存檔用的物件（沒填的欄位不寫） */
export function tasksData(b: TaskBoard) {
  return {
    lists: b.lists.map((l) => ({ id: l.id, title: l.title })),
    labels: b.labels.map((l) => ({ id: l.id, color: l.color, name: l.name })),
    cards: b.cards.map((c) => ({
      id: c.id,
      list: c.list,
      title: c.title,
      ...(c.desc ? { desc: c.desc } : {}),
      ...(c.due ? { due: c.due, ...(c.time ? { time: c.time } : {}) } : {}),
      ...(c.done ? { done: true } : {}),
      ...(c.labels?.length ? { labels: c.labels } : {}),
      ...(c.checklist?.length ? { checklist: c.checklist.map((x) => ({ id: x.id, text: x.text, done: x.done })) } : {}),
    })),
  };
}

export const serializeTasks = (b: TaskBoard) => JSON.stringify(tasksData(b));

/* ─── 清單 ─── */

export function addList(b: TaskBoard, title: string): { board: TaskBoard; id: string } {
  const id = newId();
  return { board: { ...b, lists: [...b.lists, { id, title }] }, id };
}

export function renameList(b: TaskBoard, id: string, title: string): TaskBoard {
  return { ...b, lists: b.lists.map((l) => (l.id === id ? { ...l, title } : l)) };
}

/** 刪掉清單與裡面的卡片 */
export function removeList(b: TaskBoard, id: string): TaskBoard {
  return { ...b, lists: b.lists.filter((l) => l.id !== id), cards: b.cards.filter((c) => c.list !== id) };
}

/** 把清單搬到第 to 個位置（to 是拿掉它之後的位置） */
export function moveList(b: TaskBoard, id: string, to: number): TaskBoard {
  const from = b.lists.findIndex((l) => l.id === id);
  if (from < 0) return b;
  const lists = [...b.lists];
  const [l] = lists.splice(from, 1);
  lists.splice(Math.max(0, Math.min(to, lists.length)), 0, l);
  return { ...b, lists };
}

/* ─── 卡片 ─── */

export const listCards = (b: TaskBoard, list: string) => b.cards.filter((c) => c.list === list);

export function addCard(b: TaskBoard, list: string, title: string, patch: Partial<Omit<TaskCard, "id" | "list" | "title">> = {}): { board: TaskBoard; id: string } {
  const id = newId();
  return { board: { ...b, cards: [...b.cards, { ...patch, id, list, title }] }, id };
}

/** 改卡片；值是 undefined、空字串或空陣列的欄位直接拿掉 */
export function updateCard(b: TaskBoard, id: string, patch: Partial<Omit<TaskCard, "id">>): TaskBoard {
  return {
    ...b,
    cards: b.cards.map((c) => {
      if (c.id !== id) return c;
      const out: Record<string, unknown> = { ...c, ...patch };
      for (const k of ["desc", "due", "time", "done", "labels", "checklist"]) {
        const v = out[k];
        if (v === undefined || v === "" || v === false || (Array.isArray(v) && !v.length)) delete out[k];
      }
      if (!out.due) delete out.time;
      return out as unknown as TaskCard;
    }),
  };
}

export function removeCard(b: TaskBoard, id: string): TaskBoard {
  return { ...b, cards: b.cards.filter((c) => c.id !== id) };
}

/** 把卡片搬到清單 list 的第 before 張卡片前面（before 是不算它自己的位置；超過就是最後面） */
export function moveCard(b: TaskBoard, id: string, list: string, before: number): TaskBoard {
  const card = b.cards.find((c) => c.id === id);
  if (!card || !b.lists.some((l) => l.id === list)) return b;
  const rest = b.cards.filter((c) => c.id !== id);
  const inList = rest.filter((c) => c.list === list);
  const moved = { ...card, list };
  const anchor = inList[before];
  let at: number;
  if (anchor) at = rest.indexOf(anchor);
  else {
    const last = inList[inList.length - 1];
    at = last ? rest.indexOf(last) + 1 : rest.length;
  }
  rest.splice(at, 0, moved);
  return { ...b, cards: rest };
}

export function toggleLabel(b: TaskBoard, card: string, label: string): TaskBoard {
  const c = b.cards.find((x) => x.id === card);
  if (!c) return b;
  const has = c.labels?.includes(label);
  const order = b.labels.map((l) => l.id);
  const labels = has ? (c.labels ?? []).filter((x) => x !== label) : [...(c.labels ?? []), label].sort((x, y) => order.indexOf(x) - order.indexOf(y));
  return updateCard(b, card, { labels });
}

export function renameLabel(b: TaskBoard, id: string, name: string): TaskBoard {
  return { ...b, labels: b.labels.map((l) => (l.id === id ? { ...l, name } : l)) };
}

/* ─── 檢查清單 ─── */

export function addCheck(b: TaskBoard, card: string, text: string): TaskBoard {
  const c = b.cards.find((x) => x.id === card);
  return c ? updateCard(b, card, { checklist: [...(c.checklist ?? []), { id: newId(), text, done: false }] }) : b;
}

export function updateCheck(b: TaskBoard, card: string, item: string, patch: Partial<Omit<CheckItem, "id">>): TaskBoard {
  const c = b.cards.find((x) => x.id === card);
  return c ? updateCard(b, card, { checklist: (c.checklist ?? []).map((x) => (x.id === item ? { ...x, ...patch } : x)) }) : b;
}

export function removeCheck(b: TaskBoard, card: string, item: string): TaskBoard {
  const c = b.cards.find((x) => x.id === card);
  return c ? updateCard(b, card, { checklist: (c.checklist ?? []).filter((x) => x.id !== item) }) : b;
}

export function checkProgress(c: TaskCard): { done: number; total: number } {
  const items = c.checklist ?? [];
  return { done: items.filter((x) => x.done).length, total: items.length };
}

/* ─── 截止日 ─── */

/** 有沒有卡片設了截止日（有才出現 Calendar 檢視） */
export const hasDue = (b: TaskBoard) => b.cards.some((c) => !!c.due);

export type DueState = "done" | "overdue" | "today" | "soon" | "later";

/** 截止日的狀態：完成、過期、今天、明天到期、之後 */
export function dueState(c: TaskCard, now = today()): DueState | null {
  if (!c.due) return null;
  if (c.done) return "done";
  if (c.due < now) return "overdue";
  if (c.due === now) return "today";
  if (c.due === addDays(now, 1)) return "soon";
  return "later";
}

/** 截止日的顯示文字（「Nov 18」「Nov 18, 14:00」） */
export function dueLabel(c: TaskCard, now = today()): string {
  if (!c.due) return "";
  return `${dayTitle(c.due, now)}${c.time ? `, ${c.time}` : ""}`;
}

/** 某幾天裡到期的卡片（依日期分組；同一天照時間、沒有時間的在後面，再照看板上的順序） */
export function cardsByDay(b: TaskBoard, days: Iterable<string>): Map<string, TaskCard[]> {
  const out = new Map<string, TaskCard[]>();
  for (const d of days) out.set(d, []);
  for (const c of b.cards) if (c.due && out.has(c.due)) out.get(c.due)!.push(c);
  for (const list of out.values()) list.sort((x, y) => (x.time ?? "99:99").localeCompare(y.time ?? "99:99"));
  return out;
}

/* ─── 匯出與從白板送過來 ─── */

/** Markdown：每個清單一個標題，卡片是待辦清單（截止日、標籤寫在後面） */
export function tasksMarkdown(b: TaskBoard, title = ""): string {
  const name = (id: string) => {
    const l = b.labels.find((x) => x.id === id);
    return l ? l.name || l.color : "";
  };
  const out: string[] = [];
  if (title) out.push(`# ${title}`, "");
  for (const l of b.lists) {
    out.push(`## ${l.title || "Untitled list"}`, "");
    const cards = listCards(b, l.id);
    if (!cards.length) out.push("_No cards_", "");
    for (const c of cards) {
      const extra = [c.due ? `due ${c.due}${c.time ? ` ${c.time}` : ""}` : "", ...(c.labels ?? []).map((x) => `#${name(x).replace(/\s+/g, "-")}`)].filter(Boolean);
      out.push(`- [${c.done ? "x" : " "}] ${c.title || "Untitled"}${extra.length ? ` (${extra.join(", ")})` : ""}`);
      for (const line of (c.desc ?? "").split("\n").filter((x) => x.trim())) out.push(`  ${line}`);
      for (const x of c.checklist ?? []) out.push(`  - [${x.done ? "x" : " "}] ${x.text}`);
    }
    if (cards.length) out.push("");
  }
  return out.join("\n").trimEnd() + "\n";
}

const csvCell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** CSV：一張卡片一列 */
export function tasksCsv(b: TaskBoard): string {
  const label = (id: string) => {
    const l = b.labels.find((x) => x.id === id);
    return l ? l.name || l.color : "";
  };
  const rows = [["List", "Card", "Due", "Time", "Done", "Labels", "Checklist", "Description"]];
  for (const l of b.lists) {
    for (const c of listCards(b, l.id)) {
      const p = checkProgress(c);
      rows.push([l.title, c.title, c.due ?? "", c.time ?? "", c.done ? "Yes" : "", (c.labels ?? []).map(label).join("; "), p.total ? `${p.done}/${p.total}` : "", c.desc ?? ""]);
    }
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** 白板的卡片送過來：每張變成第一個清單最後面的一張卡片（沒有清單就先加一個 To do） */
export function appendTaskCards(b: TaskBoard, items: { title: string; desc?: string }[]): TaskBoard {
  let board = b;
  let list = board.lists[0]?.id;
  if (!list) {
    const r = addList(board, "To do");
    board = r.board;
    list = r.id;
  }
  for (const it of items) board = addCard(board, list, it.title, it.desc ? { desc: it.desc } : {}).board;
  return board;
}

/** 一段 Markdown 變成卡片：第一行（去掉標題、清單、粗體記號）是標題，其他是說明 */
export function markdownCard(md: string, fallback = ""): { title: string; desc?: string } {
  const lines = md.split(/\r?\n/);
  const i = lines.findIndex((l) => l.trim());
  if (i < 0) return { title: fallback };
  const clean = (s: string) =>
    s
      .replace(/^\s*(#{1,6}\s+|[-*+]\s+(\{.\}\s*|\[.\]\s*)?|\d+[.)]\s+|>\s*)/, "")
      .replace(/\*\*|__|`/g, "")
      .trim();
  const title = clean(lines[i]) || fallback;
  const desc = lines
    .slice(i + 1)
    .join("\n")
    .trim();
  return desc ? { title, desc } : { title };
}

/** 行事曆（Alt＋1 的 Calendar）用：有截止日的卡片與所在清單的名稱，依看板順序 */
export function dueCards(b: TaskBoard): { card: TaskCard; list: string }[] {
  const lists = new Map(b.lists.map((l) => [l.id, l.title]));
  return b.cards
    .filter((c) => c.due && isDateKey(c.due) && lists.has(c.list))
    .map((card) => ({ card, list: lists.get(card.list) ?? "" }));
}
