import type { Token } from "markdown-it";
import { md } from "../editor/markdown";

/**
 * 匯出 Word、PowerPoint 用的中間格式：把 Markdown 拆成段落與一段段有格式的文字。
 * 用 CommonMark 的 token（和編輯器同一個解析器），所以畫面上看到什麼，匯出就是什麼。
 * 不支援的 HTML 區塊（縮排、多欄的標籤、影片、表格）只留文字或略過。
 */

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  underline?: boolean;
  sup?: boolean;
  sub?: boolean;
  code?: boolean;
  highlight?: boolean;
  link?: string;
  /** 換行（Shift＋Enter） */
  br?: boolean;
}

export interface ListInfo {
  ordered: boolean;
  /** 第幾層（0 開始） */
  level: number;
  /** 編號清單的起始號碼 */
  start: number;
  /** 第幾個清單（Word 的編號每個清單重新開始） */
  id: number;
  /** 清單項目的第二段以後：沒有項目符號、只縮排 */
  cont: boolean;
}

export type MdBlock =
  | { type: "heading"; level: number; runs: Run[] }
  | { type: "para"; runs: Run[]; list?: ListInfo; quote: number }
  | { type: "code"; text: string }
  | { type: "image"; src: string; alt: string }
  | { type: "hr" }
  /** 分頁符號（`<div class="page-break"></div>`） */
  | { type: "pagebreak" };

/** 子彈筆記與待辦清單的標記 → 文字符號 */
const TASK_GLYPH: Record<string, string> = { "": "☐", " ": "☐", x: "☑", X: "☑", "<": "→", "-": "✕", o: "○", O: "○" };
const TASK = /^(?:\{([ xX<\-oO]?)\}|\[([ xX])\])(?:[ \t]+|$)/;

/** `[[頁面]]` 只留名稱 */
const unref = (s: string) => s.replace(/\[\[([^\]\n]+)\]\]/g, "$1");

function inlineRuns(children: Token[]): Run[] {
  const runs: Run[] = [];
  const st = { bold: 0, italic: 0, strike: 0, underline: 0, sup: 0, sub: 0, highlight: 0 };
  const links: string[] = [];
  const push = (text: string, extra: Partial<Run> = {}) => {
    if (!text && !extra.br) return;
    const r: Run = { text };
    if (st.bold) r.bold = true;
    if (st.italic) r.italic = true;
    if (st.strike) r.strike = true;
    if (st.underline) r.underline = true;
    if (st.sup) r.sup = true;
    if (st.sub) r.sub = true;
    if (st.highlight) r.highlight = true;
    if (links.length) r.link = links[links.length - 1];
    runs.push({ ...r, ...extra });
  };
  for (const t of children) {
    switch (t.type) {
      case "text":
        push(unref(t.content));
        break;
      case "code_inline":
        push(t.content, { code: true });
        break;
      case "softbreak":
        push(" ");
        break;
      case "hardbreak":
        push("", { br: true });
        break;
      case "strong_open":
        st.bold++;
        break;
      case "strong_close":
        st.bold--;
        break;
      case "em_open":
        st.italic++;
        break;
      case "em_close":
        st.italic--;
        break;
      case "link_open":
        links.push(String(t.attrGet("href") ?? ""));
        break;
      case "link_close":
        links.pop();
        break;
      case "image":
        push(t.content || "");
        break;
      case "html_inline": {
        const m = /^<(\/?)(s|del|strike|u|sup|sub|mark|br)\b[^>]*>$/i.exec(t.content.trim());
        if (!m) break;
        const tag = m[2].toLowerCase();
        if (tag === "br") {
          push("", { br: true });
          break;
        }
        const d = m[1] ? -1 : 1;
        if (tag === "u") st.underline = Math.max(0, st.underline + d);
        else if (tag === "sup") st.sup = Math.max(0, st.sup + d);
        else if (tag === "sub") st.sub = Math.max(0, st.sub + d);
        else if (tag === "mark") st.highlight = Math.max(0, st.highlight + d);
        else st.strike = Math.max(0, st.strike + d);
        break;
      }
    }
  }
  return runs;
}

/** 段落開頭的任務標記換成符號。 */
function taskGlyph(runs: Run[]): Run[] {
  const first = runs[0];
  if (!first || first.code) return runs;
  const m = TASK.exec(first.text);
  if (!m) return runs;
  const glyph = TASK_GLYPH[m[1] ?? m[2] ?? ""] ?? "☐";
  const rest = first.text.slice(m[0].length);
  const cancelled = m[1] === "-";
  const tail = runs.slice(1).map((r) => (cancelled ? { ...r, strike: true } : r));
  return [{ text: glyph + " " }, ...(rest ? [{ ...first, text: rest, strike: first.strike || cancelled || undefined }] : []), ...tail];
}

/** 只有一張圖片的段落 */
function soleImage(children: Token[]): { src: string; alt: string } | null {
  const real = children.filter((t) => !(t.type === "text" && !t.content.trim()) && t.type !== "softbreak");
  if (real.length !== 1 || real[0].type !== "image") return null;
  return { src: String(real[0].attrGet("src") ?? ""), alt: real[0].content ?? "" };
}

const stripTags = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

export function mdBlocks(source: string): MdBlock[] {
  const tokens = md.parse(source, {});
  const out: MdBlock[] = [];
  const lists: { ordered: boolean; start: number; id: number }[] = [];
  /** 每層清單項目裡已經有幾個段落 */
  const itemParas: number[] = [];
  let quote = 0;
  let listCount = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    switch (t.type) {
      case "heading_open": {
        const inline = tokens[i + 1];
        out.push({ type: "heading", level: Number(t.tag.slice(1)), runs: inlineRuns(inline?.children ?? []) });
        i += 2;
        break;
      }
      case "bullet_list_open":
      case "ordered_list_open":
        lists.push({ ordered: t.type === "ordered_list_open", start: Number(t.attrGet("start") ?? 1), id: listCount++ });
        break;
      case "bullet_list_close":
      case "ordered_list_close":
        lists.pop();
        break;
      case "list_item_open":
        itemParas.push(0);
        break;
      case "list_item_close":
        itemParas.pop();
        break;
      case "blockquote_open":
        quote++;
        break;
      case "blockquote_close":
        quote--;
        break;
      case "paragraph_open": {
        const inline = tokens[i + 1];
        const children = inline?.children ?? [];
        i += 2;
        const img = soleImage(children);
        if (img && !lists.length) {
          out.push({ type: "image", ...img });
          break;
        }
        let runs = inlineRuns(children);
        let list: ListInfo | undefined;
        if (lists.length && itemParas.length) {
          const l = lists[lists.length - 1];
          const n = itemParas[itemParas.length - 1]++;
          list = { ordered: l.ordered, level: lists.length - 1, start: l.start, id: l.id, cont: n > 0 };
          if (n === 0) runs = taskGlyph(runs);
        }
        out.push({ type: "para", runs, list, quote });
        break;
      }
      case "fence":
      case "code_block":
        out.push({ type: "code", text: t.content.replace(/\n$/, "") });
        break;
      case "hr":
        out.push({ type: "hr" });
        break;
      case "html_block": {
        // 影片、表格、排版標籤：只留看得到的文字
        if (/class="page-break"/.test(t.content)) {
          out.push({ type: "pagebreak" });
          break;
        }
        if (/^\s*<\/?div\b[^>]*>\s*$/i.test(t.content)) break;
        const text = stripTags(t.content);
        if (text) out.push({ type: "para", runs: [{ text }], quote });
        break;
      }
    }
  }
  return out;
}

/** 純文字（簡報的標題、檔名用） */
export const runsText = (runs: Run[]) => runs.map((r) => (r.br ? " " : r.text)).join("").trim();
