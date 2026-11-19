import { boundsOf, cardRect, type Board, type Rect } from "./board";
import type { DeskFile } from "./file";
import { layoutMap } from "./mindmap";

/**
 * Desk 首頁（檔案清單）用的純函式：搜尋、最近排序、相對時間、白板縮圖的幾何。
 */

/** 每個檔案最近一次打開、編輯的時間（毫秒；個人瀏覽狀態，不寫進檔案） */
export interface FileActivity {
  opened?: number;
  edited?: number;
}

export const lastActive = (a: FileActivity | undefined) => Math.max(a?.opened ?? 0, a?.edited ?? 0);

export interface FileEntry {
  name: string;
  file: DeskFile;
}

/** 檔案裡可以搜尋的文字：檔名、文件標題、便利貼、頁面名稱、區段標題、心智圖的中心主題。 */
function haystack(e: FileEntry): string {
  const b = e.file.board;
  return [
    e.name,
    ...e.file.docs.map((d) => d.title),
    ...b.cards.map((c) => (c.ref.kind === "note" || c.ref.kind === "code" ? c.text : c.ref.kind === "page" ? c.ref.name : c.ref.kind === "day" ? c.ref.date : "")),
    ...b.sections.map((s) => s.title),
    ...b.maps.map((m) => m.root.text),
  ]
    .join("\n")
    .toLowerCase();
}

/** 用空白分開的每個詞都要出現（不分大小寫）。 */
export function matchFile(e: FileEntry, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const h = haystack(e);
  return words.every((w) => h.includes(w));
}

const byName = (a: string, b: string) => a.localeCompare(b, "zh-Hant");

/** 最近打開或編輯的排前面；沒有紀錄的照名稱排在後面。 */
export function sortFiles(list: FileEntry[], activity: Record<string, FileActivity>): FileEntry[] {
  return [...list].sort((a, b) => lastActive(activity[b.name]) - lastActive(activity[a.name]) || byName(a.name, b.name));
}

/** 「just now」、「5 min ago」、「3 h ago」、「Yesterday」、「4 days ago」，再久就是日期。 */
export function timeAgo(ms: number, now: number): string {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const days = Math.floor(s / 86400);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString("en-US", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

/** 名稱沒被用過就用，否則加上「 2」、「 3」…（比較時不分大小寫，和建立檔案的規則一樣）。 */
export function freeName(taken: string[], base: string, key: (s: string) => string): string {
  const used = new Set(taken.map(key));
  if (!used.has(key(base))) return base;
  for (let i = 2; ; i++) if (!used.has(key(`${base} ${i}`))) return `${base} ${i}`;
}

/* ─── 白板縮圖 ─── */

export type ThumbItem =
  | { kind: "section"; r: Rect; color: string | null }
  | { kind: "card"; r: Rect; color: string | null; note: boolean }
  | { kind: "topic"; r: Rect; root: boolean }
  | { kind: "edge"; x1: number; y1: number; x2: number; y2: number };

export interface Thumb {
  view: Rect;
  items: ThumbItem[];
}

/** 白板縮圖：區段、連線、卡片、心智圖主題的方塊（沒有內容是 null）。 */
export function boardThumb(b: Board, maxTopics = 60): Thumb | null {
  const items: ThumbItem[] = [];
  const rects: Rect[] = [];
  for (const s of b.sections) {
    const r = { x: s.x, y: s.y, w: s.w, h: s.h };
    items.push({ kind: "section", r, color: s.color });
    rects.push(r);
  }
  const cards = new Map(b.cards.map((c) => [c.id, cardRect(c)]));
  for (const e of b.edges) {
    const a = cards.get(e.from);
    const z = cards.get(e.to);
    if (a && z) items.push({ kind: "edge", x1: a.x + a.w / 2, y1: a.y + a.h / 2, x2: z.x + z.w / 2, y2: z.y + z.h / 2 });
  }
  for (const c of b.cards) {
    const r = cards.get(c.id)!;
    items.push({ kind: "card", r, color: c.color, note: c.ref.kind === "note" });
    rects.push(r);
  }
  for (const m of b.maps) {
    let L;
    try {
      L = layoutMap(m);
    } catch {
      continue;
    }
    rects.push(L.bounds);
    for (const id of L.order.slice(0, maxTopics)) {
      const n = L.nodes.get(id);
      if (n) items.push({ kind: "topic", r: { x: n.x, y: n.y, w: n.w, h: n.h }, root: n.depth === 0 });
    }
  }
  const box = boundsOf(rects);
  if (!box) return null;
  const pad = Math.max(24, Math.max(box.w, box.h) * 0.06);
  return { view: { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 }, items };
}
