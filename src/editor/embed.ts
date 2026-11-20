/**
 * 顯示嵌入的頁面：段落（或清單項目）裡只有 `![[名稱]]` 時，換成那一頁的內容（唯讀）。
 *
 * 和頁面連結一樣只在顯示時處理：CommonMark 把 `![[名稱]]` 渲染成文字，原始碼不變，
 * 編輯那個區塊時照樣看到 `![[名稱]]`。嵌入的內容裡還有嵌入時繼續展開（最多 `MAX_DEPTH` 層，
 * 已經在外層出現過的頁面不再展開，避免互相嵌入時無窮迴圈）。
 * 名稱可以是任何頁面、日記（`YYYY-MM-DD`）或 Dock 文件（`檔案/標題`；Note、Word、簡報顯示內容，
 * Excel、Draw 只顯示標題連結），Excel 的一個表格或圖表（`檔案/標題#^id`，`sheetEmbed.tsx` 畫，跟著試算表即時更新），
 * 或 Drawer 條目的備註（`@引用鍵#r1`）。
 * 頁面連結在這之後由 `linkPages` 處理（嵌入內容裡的 `[[…]]` 也會變成連結）。
 */
import DOMPurify from "dompurify";
import { TASK_LABEL, type TaskState } from "../bujo/tasks";
import { docKindLabel, docLinkOf, objectRef } from "../desk/docLinks";
import { citeLabel, citeReference, citeRemark } from "../drawer/citeRef";
import type { Item, Remark } from "../drawer/model";
import { embedSource, sheetSource } from "../pages/embeds";
import { cleanName, pageKey } from "../pages/pageRef";
import { parseLook, renderSheetObject } from "../sheet/sheetEmbed";
import { highlightBlocksHtml } from "./codeHighlight";
import { md } from "./markdown";
import { PURIFY, resolveMedia } from "./media";

const EMBED = /^!\[\[([^[\]\n]+?)\]\]$/;
const MAX_DEPTH = 3;

const TASK_OF: Record<string, TaskState> = {
  "": "open",
  " ": "open",
  x: "done",
  X: "done",
  "<": "scheduled",
  "-": "cancelled",
  o: "event",
  O: "event",
};
const GLYPH: Record<TaskState, string> = { open: "•", done: "×", scheduled: "<", cancelled: "•", event: "○" };

/** 文字是不是嵌入（`![[名稱]]`）；是的話回傳名稱。 */
export function embedName(text: string): string | null {
  const m = EMBED.exec(text.trim());
  const name = m ? cleanName(m[1]) : "";
  return name || null;
}

/** 把 HTML 裡的嵌入換成頁面內容。seen：外層已經展開的頁面鍵。 */
export function embedPages(html: string, depth = 0, seen: string[] = []): string {
  if (!html.includes("![[")) return html;
  const t = document.createElement("template");
  t.innerHTML = html;
  for (const el of [...t.content.querySelectorAll("p, li")]) {
    if (el.closest("pre, code, .page-embed") || el.children.length) continue;
    const name = embedName(el.textContent ?? "");
    if (!name) continue;
    const box = embedElement(name, depth, seen);
    if (el.tagName === "P") el.replaceWith(box);
    else el.replaceChildren(box);
  }
  return t.innerHTML;
}

/** 嵌入 Drawer 條目的備註（`![[@引用鍵#r1]]`）：備註內容加上文中引用，點引用在 Drawer 打開備註。 */
function remarkElement(name: string, item: Item, remark: Remark): HTMLElement {
  const box = document.createElement("div");
  box.className = "page-embed remark-embed";
  box.setAttribute("data-page", name);
  const head = document.createElement("div");
  head.className = "pe-head";
  const a = document.createElement("a");
  a.className = "page-ref cite-ref remark-ref";
  a.setAttribute("data-page", name);
  a.setAttribute("data-cite", item.key);
  a.setAttribute("data-remark", remark.id);
  a.title = citeReference(item);
  a.textContent = `(${citeLabel(item, undefined, remark.page)})`;
  const title = document.createElement("span");
  title.className = "pe-sub";
  title.textContent = item.title.trim() || "Untitled";
  head.append(a, title);
  const body = document.createElement("div");
  body.className = "pe-body";
  box.append(head, body);
  if (remark.text.trim()) body.innerHTML = renderEmbedded(remark.text);
  else {
    const n = document.createElement("div");
    n.className = "pe-note";
    n.textContent = "Empty remark";
    body.append(n);
    box.classList.add("empty");
  }
  return box;
}

/**
 * 嵌入 Excel 的表格或圖表（`![[檔案/標題#^id|選項]]`）：標題列是「活頁簿 › 名稱」，點了打開那份活頁簿。
 * 表格的格子點了直接編輯、寫回 Excel（`sheet/embedEdit.ts`，由 Editor 的按下處理接手）；
 * 標題列的 Style 改這個位置的樣子（選項，`TableLook`）。
 */
function sheetObjectElement(name: string, doc: string, id: string, opts: string): HTMLElement {
  const box = document.createElement("div");
  box.className = "page-embed sheet-embed";
  box.setAttribute("data-page", name);
  box.setAttribute("data-doc", doc);
  box.setAttribute("data-object", id);
  const head = document.createElement("div");
  head.className = "pe-head";
  const a = document.createElement("a");
  a.className = "page-ref dock-ref";
  a.setAttribute("data-page", doc);
  a.setAttribute("data-kind", "sheet");
  a.textContent = doc;
  head.append(a);
  const body = document.createElement("div");
  body.className = "pe-body";
  box.append(head, body);
  const json = sheetSource(doc);
  const obj = json === undefined ? null : renderSheetObject(json, id, parseLook(opts));
  if (obj) {
    a.title = `Open ${doc} in Excel`;
    const sub = document.createElement("span");
    sub.className = "pe-sub";
    sub.textContent = obj.name;
    head.append(sub);
    if (obj.kind === "table") {
      box.classList.add("sheet-table");
      box.setAttribute("data-banded", obj.table?.banded ? "1" : "0");
      box.setAttribute("data-theme", obj.table?.theme ?? "blue");
      const hint = document.createElement("span");
      hint.className = "xe-hint";
      hint.textContent = "Linked · edits update Excel";
      const style = document.createElement("button");
      style.className = "xe-style";
      style.type = "button";
      style.title = "Change how this table looks here (Excel keeps its own style)";
      style.textContent = "Style";
      head.append(hint, style);
    }
    body.append(obj.el);
  } else {
    const n = document.createElement("div");
    n.className = "pe-note";
    n.textContent = json === undefined ? "No Excel document with this name" : "This table or chart was deleted";
    body.append(n);
    box.classList.add("empty");
  }
  return box;
}

function embedElement(name: string, depth: number, seen: string[]): HTMLElement {
  const rm = citeRemark(name);
  if (rm) return remarkElement(name, rm.item, rm.remark);
  const obj = objectRef(name);
  if (obj) return sheetObjectElement(name, obj.doc, obj.id, obj.opts);
  const box = document.createElement("div");
  box.className = "page-embed";
  box.setAttribute("data-page", name);
  const head = document.createElement("div");
  head.className = "pe-head";
  const a = document.createElement("a");
  a.className = "page-ref";
  a.setAttribute("data-page", name);
  a.textContent = name;
  head.append(a);
  const source = embedSource(name);
  const link = docLinkOf(name);
  if (link) {
    a.classList.add("dock-ref");
    a.setAttribute("data-kind", link.kind);
    a.title = `${docKindLabel(link.kind)} in ${link.file}`;
  }
  const body = document.createElement("div");
  body.className = "pe-body";
  box.append(head, body);

  const k = pageKey(name);
  const note = (text: string) => {
    const n = document.createElement("div");
    n.className = "pe-note";
    n.textContent = text;
    body.append(n);
    box.classList.add("empty");
  };
  if (seen.includes(k) || depth >= MAX_DEPTH) {
    note("Already embedded above");
    return box;
  }
  if (source === undefined && link) note(`${docKindLabel(link.kind)} · click the title to open`);
  else if (source === undefined) note("No page with this name yet");
  else if (!source.trim()) note(link ? "Empty document" : "Empty page");
  else body.innerHTML = embedPages(renderEmbedded(source), depth + 1, [...seen, k]);
  return box;
}

/** 嵌入頁面的 HTML：與編輯器相同的清理、媒體、程式碼上色；任務標記換成符號。 */
export function renderEmbedded(source: string): string {
  const t = document.createElement("template");
  t.innerHTML = DOMPurify.sanitize(resolveMedia(md.render(source)), PURIFY) as string;
  for (const li of t.content.querySelectorAll("li")) markTask(li);
  return highlightBlocksHtml(t.innerHTML);
}

/** 清單項目開頭的 `{x}`、`[ ]` 等標記換成子彈筆記的符號或核取方塊。 */
function markTask(li: Element) {
  const first = firstText(li);
  if (!first) return;
  const m = /^(?:\{([ xX<\-oO]?)\}|\[([ xX])\])(?:[ \t]+|$)/.exec(first.data);
  if (!m) return;
  first.data = first.data.slice(m[0].length);
  const mark = document.createElement("span");
  if (m[2] !== undefined) {
    const done = m[2] !== " ";
    mark.className = `pe-check${done ? " on" : ""}`;
    mark.textContent = done ? "✓" : "";
    if (done) li.classList.add("pe-done");
  } else {
    const state = TASK_OF[m[1]];
    mark.className = `pe-task t-${state}`;
    mark.title = TASK_LABEL[state];
    mark.textContent = GLYPH[state];
    li.classList.add(`pe-${state}`);
  }
  li.classList.add("pe-item");
  first.before(mark);
}

function firstText(el: Element): Text | null {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    if (t.data.trim()) {
      // 第一段文字前面的空白去掉，才比對得到標記
      t.data = t.data.replace(/^\s+/, "");
      return t;
    }
  }
  return null;
}
