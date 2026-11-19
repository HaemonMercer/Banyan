/**
 * 在 Markdown 裡引用 Drawer 的條目：`[[@引用鍵]]`。
 *
 * 原始碼仍是頁面連結（CommonMark 渲染成文字，頁面 `@引用鍵` 是條目的筆記，反向連結照常運作）；
 * 只有顯示時（`pageRef.ts` 的 `linkPagesIn`）把認得的引用鍵換成文中引用「(Smith, 2020)」，
 * 相鄰的幾個引用（中間只有空白或分號）合成一個括號「(Smith, 2020; Lee, 2019)」。
 * 編輯時照樣顯示原始的 `[[@引用鍵]]`（游標與所見即所得轉回 Markdown 都靠這段文字）。
 * `[[@引用鍵#r1]]` 引用條目的備註：文中引用帶上備註的頁碼「(Smith, 2020, p. 12)」，滑過看備註；
 * 參考文獻照樣算是引用了那個條目。
 *
 * App 載入文獻庫後呼叫 `setCiteLibrary`；編輯器用 `subscribeCites`／`citeStamp` 在文獻庫或
 * 引用格式改變時重畫。
 */
import { bibliography, inText, reference, toMarkdown, toText, type Style } from "./cite";
import { matches, parseCiteName, yearOf, creatorSummary, type Item, type Remark } from "./model";
import { extractRefs } from "../pages/pageRef";

let byKey = new Map<string, Item>();
let items: Item[] = [];
let style: Style = "apa";
let version = 0;
const listeners = new Set<() => void>();

function changed() {
  version++;
  for (const l of listeners) l();
}

/** 別的 [[…]] 顯示方式改變時（例如 Dock 文件連結 `desk/docLinks.ts` 的清單）也讓編輯器重畫。 */
export const refsChanged = changed;

/** 設定可以引用的條目（垃圾桶裡的、沒有引用鍵的不算）。 */
export function setCiteLibrary(list: Item[]): void {
  items = list.filter((i) => !i.trashed && i.key);
  byKey = new Map(items.map((i) => [i.key.toLowerCase(), i]));
  changed();
}

/** 文中引用的格式（跟著 Drawer 選的 APA／MLA）。 */
export function setCiteStyle(s: Style): void {
  if (s === style) return;
  style = s;
  changed();
}

export const citeStyle = () => style;

export function subscribeCites(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 文獻庫或格式每改一次就不同（給快取當鍵）。 */
export const citeStamp = () => version;

/** 頁面名稱 `@引用鍵`（或 `@引用鍵#r1`）→ 條目（不分大小寫；不是引用或不認得就是 undefined）。 */
export function citeItem(name: string): Item | undefined {
  const c = parseCiteName(name);
  return c ? byKey.get(c.key.toLowerCase()) : undefined;
}

/** `@引用鍵#r1` → 條目與備註（條目或備註不認得就是 undefined）。 */
export function citeRemark(name: string): { item: Item; remark: Remark } | undefined {
  const c = parseCiteName(name);
  const item = c?.remark ? byKey.get(c.key.toLowerCase()) : undefined;
  const remark = item?.remarks.find((r) => r.id.toLowerCase() === c!.remark!.toLowerCase());
  return item && remark ? { item, remark } : undefined;
}

/** 文中引用括號裡的字：`Smith, 2020`（APA）、`Smith`（MLA）；有頁碼時 `Smith, 2020, p. 12`、`Smith 12`。 */
export function citeLabel(it: Item, s: Style = style, page = ""): string {
  return inText(it, s, page).slice(1, -1);
}

/** 備註滑過時的說明：備註的文字（太長就截斷），下面是參考文獻。 */
export function remarkTitle(it: Item, r: Remark, s: Style = style): string {
  const text = r.text.trim().replace(/\s+/g, " ");
  const short = text.length > 240 ? text.slice(0, 239) + "…" : text;
  return [short ? `“${short}”` : "(empty remark)", citeReference(it, s)].join("\n");
}

/** 完整的參考文獻（純文字，滑過時顯示）。 */
export function citeReference(it: Item, s: Style = style): string {
  return toText(reference(it, s));
}

export interface CiteSuggestion {
  /** 寫進 `[[@…]]` 的部分：引用鍵，或備註的 `引用鍵#r1` */
  key: string;
  title: string;
  /** 作者與年份：`Smith et al. · 2020` */
  detail: string;
}

/**
 * `[[@` 後面的建議：引用鍵開頭相符的排前面，其次是標題、作者、年份等任何欄位相符的，
 * 再來是文字相符的備註。打了 `引用鍵#` 時只列那個條目的備註（`#` 後面的字篩選備註）。
 */
export function suggestCites(query: string, limit = 8, list: Item[] = items): CiteSuggestion[] {
  const q = query.trim().toLowerCase();
  const usable = list.filter((it) => !it.trashed && it.key);
  const hash = q.indexOf("#");
  if (hash >= 0) {
    const it = usable.find((i) => i.key.toLowerCase() === q.slice(0, hash));
    const rq = q.slice(hash + 1);
    if (!it) return [];
    return it.remarks
      .filter((r) => !rq || r.id.toLowerCase().startsWith(rq) || r.text.toLowerCase().includes(rq))
      .slice(0, limit)
      .map((r) => remarkSuggestion(it, r));
  }
  const starts: Item[] = [];
  const rest: Item[] = [];
  for (const it of usable) {
    if (!q || it.key.toLowerCase().startsWith(q)) starts.push(it);
    else if (matches(it, q)) rest.push(it);
  }
  const recent = (a: Item, b: Item) => (b.modified ?? 0) - (a.modified ?? 0);
  if (!q) starts.sort(recent);
  const out: CiteSuggestion[] = [...starts, ...rest].slice(0, limit).map((it) => ({
    key: it.key,
    title: it.title.trim() || "Untitled",
    detail: [creatorSummary(it), yearOf(it.date)].filter(Boolean).join(" · "),
  }));
  if (q) {
    const words = q.split(/\s+/).filter(Boolean);
    for (const it of usable) {
      for (const r of it.remarks) {
        if (out.length >= limit) return out;
        const t = r.text.toLowerCase();
        if (words.every((w) => t.includes(w))) out.push(remarkSuggestion(it, r));
      }
    }
  }
  return out;
}

function remarkSuggestion(it: Item, r: Remark): CiteSuggestion {
  const text = r.text.trim().replace(/\s+/g, " ");
  return {
    key: `${it.key}#${r.id}`,
    title: text ? (text.length > 80 ? text.slice(0, 79) + "…" : text) : "Empty remark",
    detail: ["Remark", creatorSummary(it), yearOf(it.date), r.page.trim() && `p. ${r.page.trim()}`].filter(Boolean).join(" · "),
  };
}

/** 原始碼裡引用到、而且文獻庫認得的條目（依第一次出現的順序、不重複）。 */
export function citedItems(source: string): Item[] {
  const out: Item[] = [];
  const seen = new Set<string>();
  for (const name of extractRefs(source)) {
    const it = citeItem(name);
    if (it && !seen.has(it.id)) {
      seen.add(it.id);
      out.push(it);
    }
  }
  return out;
}

/** 參考文獻清單的 Markdown（一筆一個清單項目，依作者排序）；沒有引用就是空字串。 */
export function bibliographyMarkdown(source: string, s: Style = style): string {
  const cited = citedItems(source);
  return bibliography(cited, s)
    .map((r) => `- ${toMarkdown(r)}`)
    .join("\n");
}
