/**
 * 頁面連結 `[[頁面名稱]]`（Logseq／Obsidian 的寫法）。
 *
 * CommonMark 沒有這種語法：`[[名稱]]` 照規格渲染成普通文字「[[名稱]]」。編輯器只在
 * 「顯示」時把這段文字換成可點的連結（不動 markdown-it 的規則，渲染結果仍與規格一致），
 * 所見即所得轉回 Markdown 時再寫回 `[[名稱]]`。
 *
 * 名稱不分大小寫（`pageKey`）；`[[2026-11-17]]` 是那天的日記。
 */

import { citeItem, citeLabel, citeReference, citeRemark, remarkTitle } from "../drawer/citeRef";
import type { Item } from "../drawer/model";
import { docKindLabel, docLinkOf } from "../desk/docLinks";

/** 原始碼裡的頁面連結（名稱不能有方括號、不能跨行）。 */
export const REF_SOURCE = /\[\[((?:\\.|[^[\]\n\\])+?)\]\]/g;
/** 渲染後文字裡的頁面連結 */
const REF_TEXT = /\[\[([^[\]\n]+?)\]\]/g;

/** 比對用的頁面鍵：去掉頭尾空白、不分大小寫、連續空白算一個。 */
export function pageKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** 頁面名稱整理成可以存檔、顯示的樣子。 */
export function cleanName(name: string): string {
  return name.replace(/[[\]\n\r]/g, "").trim().replace(/\s+/g, " ");
}

/** 去掉反斜線跳脫（`a\_b` → `a_b`）。 */
function unescape(s: string): string {
  return s.replace(/\\([!-/:-@[-`{-~])/g, "$1");
}

/** 原始碼裡提到的頁面名稱（程式碼區塊、行內程式碼裡的不算），依出現順序、不重複。 */
export function extractRefs(source: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of source.split("\n")) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (line.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (fence || /^( {4}|\t)/.test(line)) continue;
    const plain = line.replace(/(`+)[\s\S]*?\1/g, "");
    for (const m of plain.matchAll(REF_SOURCE)) {
      const name = cleanName(unescape(m[1]));
      const k = pageKey(name);
      if (name && !seen.has(k)) {
        seen.add(k);
        out.push(name);
      }
    }
  }
  return out;
}

/** 原始碼的這一行有沒有提到某個頁面。 */
export function lineMentions(line: string, key: string): boolean {
  for (const m of line.matchAll(REF_SOURCE)) if (pageKey(unescape(m[1])) === key) return true;
  return false;
}

// ─── 顯示：把文字裡的 [[名稱]] 換成連結 ─────────────────────────────

const SKIP = new Set(["CODE", "PRE", "A", "SCRIPT", "STYLE", "TEXTAREA"]);
const ZWSP = "​";

/**
 * 在 DOM 裡把 `[[名稱]]` 文字換成頁面連結元素。
 * guard：編輯時在連結後面放一個零寬空白，游標才有地方停在連結外面（接著打的字不會跑進連結裡）。
 */
export function linkPagesIn(root: Node, guard = false): void {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    if (!t.data.includes("[[")) continue;
    let p = t.parentElement;
    let skip = false;
    while (p && p !== root) {
      if (SKIP.has(p.tagName)) skip = true;
      p = p.parentElement;
    }
    if (!skip) texts.push(t);
  }
  for (const t of texts) {
    const data = t.data;
    REF_TEXT.lastIndex = 0;
    let last = 0;
    const frag = doc.createDocumentFragment();
    /** 上一個文中引用的括號（緊接著的引用併進去） */
    let group: HTMLElement | null = null;
    for (const m of data.matchAll(REF_TEXT)) {
      const name = cleanName(m[1].replace(/[​]/g, ""));
      if (!name) continue;
      const between = data.slice(last, m.index);
      const item = citeItem(name);
      if (item && !guard) {
        // 顯示：文中引用（中間只有空白或分號的相鄰引用合成一個括號）
        const a = citeElement(doc, name, item);
        if (group && /^[\s;]*$/.test(between)) group.lastChild!.before("; ", a);
        else {
          if (between) frag.append(between);
          group = doc.createElement("span");
          group.className = "cite";
          group.append("(", a, ")");
          frag.append(group);
        }
        last = m.index! + m[0].length;
        continue;
      }
      group = null;
      if (between) frag.append(between);
      const el = pageRefElement(doc, m[1], name);
      const dock = docLinkOf(name);
      if (dock) {
        // Dock 文件的連結 [[檔案/標題]]
        el.classList.add("dock-ref");
        el.setAttribute("data-kind", dock.kind);
        el.title = `${docKindLabel(dock.kind)} in ${dock.file}`;
      }
      if (item) {
        // 編輯中：保留原始的 [[@引用鍵]]，滑過時顯示文中引用與參考文獻（備註再加上備註的文字）
        const rm = citeRemark(name);
        el.classList.add("cite-ref");
        el.title = rm ? `(${citeLabel(item, undefined, rm.remark.page)}) ${remarkTitle(item, rm.remark)}` : `(${citeLabel(item)}) ${citeReference(item)}`;
      }
      frag.append(el);
      if (guard) frag.append(ZWSP);
      last = m.index! + m[0].length;
    }
    if (!last) continue;
    if (last < data.length) frag.append(data.slice(last));
    t.replaceWith(frag);
  }
}

/** 頁面連結元素：`<a class="page-ref" data-page="名稱"><span class="pr-b">[[</span>名稱<span class="pr-b">]]</span></a>` */
function pageRefElement(doc: Document, text: string, name: string): HTMLElement {
  const a = doc.createElement("a");
  a.className = "page-ref";
  a.setAttribute("data-page", name);
  const open = doc.createElement("span");
  open.className = "pr-b";
  open.textContent = "[[";
  const close = doc.createElement("span");
  close.className = "pr-b";
  close.textContent = "]]";
  a.append(open, text, close);
  return a;
}

/**
 * 文中引用的一筆：`<a class="page-ref cite-ref" data-page="@引用鍵">Smith, 2020</a>`（點了開啟筆記頁面）。
 * 引用備註（`@引用鍵#r1`）時加上頁碼與 `data-remark`，滑過看備註，點了在 Drawer 打開那個備註。
 */
function citeElement(doc: Document, name: string, item: Item): HTMLElement {
  const a = doc.createElement("a");
  const rm = citeRemark(name);
  a.className = rm ? "page-ref cite-ref remark-ref" : "page-ref cite-ref";
  a.setAttribute("data-page", name);
  a.setAttribute("data-cite", item.key);
  if (rm) a.setAttribute("data-remark", rm.remark.id);
  a.title = rm ? remarkTitle(item, rm.remark) : citeReference(item);
  a.textContent = citeLabel(item, undefined, rm?.remark.page);
  return a;
}

/** HTML 字串版本（有 `[[` 才處理）。 */
export function linkPages(html: string, guard = false): string {
  if (!html.includes("[[")) return html;
  const t = document.createElement("template");
  t.innerHTML = html;
  linkPagesIn(t.content, guard);
  return t.innerHTML;
}

// ─── 頁面名稱清單（自動完成用） ─────────────────────────────────

let names: string[] = [];

/** App 載入頁面後設定（編輯器輸入 `[[` 時的建議清單）。 */
export function setPageNames(list: string[]): void {
  names = list;
}

export function getPageNames(): string[] {
  return names;
}

/** 依輸入篩選頁面名稱：開頭相符的排前面；最多 limit 個。 */
export function suggestPages(query: string, all: string[], limit = 8): string[] {
  const q = pageKey(query);
  if (!q) return all.slice(0, limit);
  const starts: string[] = [];
  const contains: string[] = [];
  for (const n of all) {
    const k = pageKey(n);
    if (k.startsWith(q)) starts.push(n);
    else if (k.includes(q)) contains.push(n);
  }
  return [...starts, ...contains].slice(0, limit);
}

/** 開啟頁面（App 監聽這個事件；編輯器、反向連結都用它）。 */
export const OPEN_PAGE_EVENT = "banyan:open-page";

export function openPage(name: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_PAGE_EVENT, { detail: name }));
}
