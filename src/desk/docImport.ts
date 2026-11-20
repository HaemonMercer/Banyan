/**
 * Dock 的 Word 與簡報匯入常用的格式（試算表在 `sheet/formats.ts`）。
 *
 * Word（內容是 Markdown）：
 * - .docx（`drawer/preview.ts` 的 `docxHtml`，加上圖片）、.odt（OpenDocument 文字，`odtHtml`）、
 *   .rtf（WordPad 等，`rtfHtml`，依 \ansicpg 解碼，繁體中文是 Big5）、.html、
 *   舊版 Word 97–2003 的 .doc（`docText`：只有文字與段落）、.md、.txt。
 * - 都先變成 HTML，再由 `htmlToMarkdown` 轉成 Markdown：區塊（標題、段落、清單、引言、程式碼、表格、圖片）
 *   自己處理，段落裡的文字交給編輯器的 `serialize`（和所見即所得同一套跳脫與格式）。
 *
 * 簡報（內容是用 `---` 分張的 Markdown，備忘稿在 `SlideAnim.notes`）：
 * - .pptx（`pptxSlides`：標題、內文與項目符號、圖片、備忘稿）、.odp（`odpSlides`）、
 *   .md（`---` 分張；沒有的話照 `#` 標題分張）。
 *
 * 圖片交給呼叫的人存（`saveImage`，App 裡存到 `media/`），Markdown 寫存好的位置。
 */
import { cfbStream, decodeTableText, IMPORT_ACCEPT, importTables, readSpreadsheet } from "../sheet/formats";
import { addImported, unzip } from "../sheet/importer";
import { newWorkbook, serializeWorkbook } from "../sheet/model";
import { joinSlides, splitSlides, type DockKind } from "./file";
import { NO_ANIM, trimAnim, type SlideAnim } from "./slideAnim";
import { docxHtml, docxImages, pptxSlides } from "../drawer/preview";
import { serialize } from "../editor/wysiwyg";
import { tableHtml } from "../editor/table";
import { mediaMarkdown, saveMedia } from "../editor/media";

export type SaveImage = (bytes: Uint8Array, name: string) => Promise<string>;

/** App 裡的存圖：存到 media/（瀏覽器預覽是 data URL），回傳 Markdown 要寫的位置 */
export const saveImported: SaveImage = (bytes, name) => saveMedia(new File([bytes as BlobPart], name, { type: imageType(name) }));

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  emf: "image/emf",
  wmf: "image/wmf",
};
const imageType = (name: string) => IMAGE_TYPES[extOf(name)] ?? "application/octet-stream";

export const WORD_IMPORT = ".docx,.doc,.odt,.rtf,.html,.htm,.md,.markdown,.txt";
export const SLIDES_IMPORT = ".pptx,.odp,.md,.markdown";

const extOf = (name: string) => (/\.([^./\\]+)$/.exec(name)?.[1] ?? "").toLowerCase();
export const titleOf = (name: string) => name.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "").trim();

/* ─── HTML → Markdown ─── */

const BLOCK = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "TABLE", "HR", "SECTION", "ARTICLE", "MAIN", "HEADER", "FOOTER", "FIGURE", "FIGCAPTION", "DL", "DT", "DD", "ADDRESS", "ASIDE", "NAV", "CENTER", "BODY"]);
const SKIP = new Set(["SCRIPT", "STYLE", "HEAD", "TITLE", "META", "LINK", "NOSCRIPT", "TEMPLATE", "IFRAME", "OBJECT", "SVG", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "FORM"]);

const hasBlock = (el: Element) => [...el.children].some((c) => BLOCK.has(c.tagName));

/** 一段行內內容 → Markdown（編輯器的 serialize：粗斜體、底線、刪除線、上下標、連結、行內程式碼與跳脫）。 */
function inlineMd(el: Element): string {
  const p = document.createElement("p");
  for (const n of [...el.childNodes]) {
    if (n.nodeType === 1 && (SKIP.has((n as Element).tagName) || (n as Element).tagName === "IMG")) continue;
    p.append(n.cloneNode(true));
  }
  // 連續的空白（HTML 原始碼的換行、縮排）算一個空格；先把相鄰的文字併起來（拿掉圖片後兩邊的空白才會合一）
  p.normalize();
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode() as Text | null; t; t = walker.nextNode() as Text | null) t.data = t.data.replace(/[ \t\r\n]+/g, " ");
  if (!(p.textContent ?? "").trim()) return "";
  return serialize(p).content.trim();
}

/** 段落裡的圖片：只留讀得到的（已經存好的 media/、data:、網址）；網頁旁邊資料夾裡的圖片（`report.files/…`）匯入不了 */
const imagesIn = (el: Element) =>
  [...el.querySelectorAll("img")].map((img) => img.getAttribute("src") ?? "").filter((s) => /^(media\/|data:image\/|https?:\/\/|blob:)/i.test(s));
const imageMd = (srcs: string[]) => srcs.map((s) => mediaMarkdown(s, "image"));

function listMd(list: Element, depth: number): string {
  const ordered = list.tagName === "OL";
  let n = Number(list.getAttribute("start")) || 1;
  const pad = "   ".repeat(depth);
  const lines: string[] = [];
  for (const li of [...list.children].filter((c) => c.tagName === "LI")) {
    const own = document.createElement("div");
    const nested: Element[] = [];
    for (const ch of [...li.childNodes]) {
      if (ch.nodeType === 1 && /^(UL|OL)$/.test((ch as Element).tagName)) nested.push(ch as Element);
      else own.append(ch.cloneNode(true));
    }
    const text = hasBlock(own) ? blocksMd(own).join(" ").replace(/\n+/g, " ") : inlineMd(own);
    lines.push(`${pad}${ordered ? `${n++}.` : "-"} ${text}`.trimEnd());
    for (const sub of nested) lines.push(listMd(sub, depth + 1));
  }
  return lines.join("\n");
}

function tableMd(t: Element): string {
  const rows = [...t.querySelectorAll("tr")]
    .filter((tr) => tr.closest("table") === t)
    .map((tr) => [...tr.children].filter((c) => c.tagName === "TD" || c.tagName === "TH"));
  if (!rows.length) return "";
  const header = rows[0].some((c) => c.tagName === "TH") || !!t.querySelector("thead");
  const text = (c: Element) => {
    const parts = [...c.children].some((x) => BLOCK.has(x.tagName)) ? [...c.children].map((x) => (x.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean) : [(c.textContent ?? "").replace(/\s+/g, " ").trim()];
    return parts.join("\n");
  };
  return tableHtml({ rows: rows.map((r) => r.flatMap((c) => [text(c), ...Array(Math.max(0, (Number(c.getAttribute("colspan")) || 1) - 1)).fill("")])), header });
}

/** 一個容器裡的區塊 → Markdown 區塊（每個一段，之後用空行接起來） */
function blocksMd(root: Element): string[] {
  const out: string[] = [];
  let inline: Node[] = [];
  const flushInline = () => {
    if (!inline.length) return;
    const p = document.createElement("p");
    for (const n of inline) p.append(n.cloneNode(true));
    inline = [];
    const md = inlineMd(p);
    if (md) out.push(md);
    out.push(...imageMd(imagesIn(p)));
  };
  for (const n of [...root.childNodes]) {
    if (n.nodeType === 3) {
      inline.push(n);
      continue;
    }
    if (n.nodeType !== 1) continue;
    const el = n as Element;
    const tag = el.tagName;
    if (SKIP.has(tag)) continue;
    if (!BLOCK.has(tag)) {
      if (tag === "IMG" || tag === "BR" || (el.textContent ?? "").trim() || el.querySelector("img")) inline.push(el);
      continue;
    }
    flushInline();
    if (/^H[1-6]$/.test(tag)) {
      const md = inlineMd(el);
      if (md) out.push(`${"#".repeat(Number(tag[1]))} ${md}`);
      out.push(...imageMd(imagesIn(el)));
    } else if (tag === "UL" || tag === "OL") {
      const md = listMd(el, 0);
      if (md.trim()) out.push(md);
    } else if (tag === "BLOCKQUOTE") {
      const inner = blocksMd(el).join("\n\n");
      if (inner.trim()) out.push(inner.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n"));
    } else if (tag === "PRE") {
      const code = (el.textContent ?? "").replace(/\n$/, "");
      const fence = code.includes("```") ? "~~~" : "```";
      out.push(`${fence}\n${code}\n${fence}`);
    } else if (tag === "TABLE") {
      const md = tableMd(el);
      if (md) out.push(md);
    } else if (tag === "HR") {
      // 不用 ---：簡報裡 --- 是分張
      out.push("***");
    } else if (hasBlock(el) || tag === "BODY") out.push(...blocksMd(el));
    else {
      const md = inlineMd(el);
      if (md) out.push(md);
      out.push(...imageMd(imagesIn(el)));
    }
  }
  flushInline();
  return out;
}

/**
 * Word 存成網頁時，清單是一段一段的 `<p class=MsoListParagraph…>`，項目符號寫在
 * `<span style='mso-list:Ignore'>` 裡：拿掉項目符號，連續的段落組成 `<ul>`／`<ol>`。
 */
function wordHtmlLists(body: HTMLElement) {
  const isItem = (el: Element | null): el is HTMLElement =>
    !!el && el.tagName === "P" && (/MsoList/i.test(el.className) || /mso-list\s*:\s*l\d/i.test(el.getAttribute("style") ?? ""));
  for (const p of [...body.querySelectorAll("p")]) {
    if (!isItem(p) || !p.isConnected) continue;
    // 一個清單到 …CxSpLast（或只有一項的 MsoListParagraph）為止，接著的是另一個清單
    const run: HTMLElement[] = [];
    for (let el: Element | null = p; isItem(el); el = el.nextElementSibling) {
      run.push(el);
      if (/CxSpLast$|^MsoListParagraph$/i.test(el.className.trim())) break;
    }
    const marker = (el: HTMLElement) => {
      // 一般的網頁：項目符號在 mso-list:Ignore 裡；「篩選過的網頁」沒有這個標記，項目符號是第一個 span
      // （Wingdings／Symbol 字型的一個符號，或「1.」「a)」這種編號，後面跟著 &nbsp;）
      let ign = [...el.querySelectorAll("span")].find((s) => /mso-list\s*:\s*ignore/i.test(s.getAttribute("style") ?? ""));
      if (!ign) {
        const first = el.firstElementChild;
        const t = (first?.textContent ?? "").replace(/ /g, " ").trim();
        const symbolFont = /wingdings|symbol/i.test(first?.getAttribute("style") ?? "");
        if (first?.tagName === "SPAN" && t.length <= 4 && (symbolFont || /^((\d+|[a-zA-Z]|[ivxIVX]+)[.)]|[·•▪◦o§\-–])$/.test(t))) ign = first as HTMLElement;
      }
      const text = (ign?.textContent ?? "").replace(/ /g, " ").trim();
      ign?.remove();
      return text;
    };
    const first = marker(run[0]);
    const list = document.createElement(/^(\d+|[a-zA-Z]|[ivxIVX]+)[.)]$/.test(first) ? "ol" : "ul");
    run.forEach((el, i) => {
      if (i) marker(el);
      const li = document.createElement("li");
      li.append(...el.childNodes);
      list.append(li);
    });
    run[0].before(list);
    run.forEach((el) => el.remove());
  }
}

/** HTML（整份網頁或片段）→ Markdown。 */
export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  wordHtmlLists(doc.body);
  return blocksMd(doc.body).join("\n\n");
}

/** 純文字 → Markdown：空行分段，段落裡的換行保留（硬換行）；特殊字元跳脫。 */
export function textToMarkdown(text: string): string {
  const paras = text.replace(/\r\n?/g, "\n").split(/\n\s*\n/);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return htmlToMarkdown(paras.map((p) => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`).join(""));
}

/* ─── OpenDocument 文字（.odt） ─── */

const NS = {
  office: "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
  text: "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
  table: "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
  style: "urn:oasis:names:tc:opendocument:xmlns:style:1.0",
  fo: "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0",
  draw: "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0",
  xlink: "http://www.w3.org/1999/xlink",
  presentation: "urn:oasis:names:tc:opendocument:xmlns:presentation:1.0",
};

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 文字樣式（自動樣式＋styles.xml）：名稱 → 粗體、斜體、底線、刪除線、上下標 */
function odfTextStyles(docs: (Document | null)[]): Map<string, { b?: boolean; i?: boolean; u?: boolean; s?: boolean; sup?: boolean; sub?: boolean }> {
  const out = new Map<string, { b?: boolean; i?: boolean; u?: boolean; s?: boolean; sup?: boolean; sub?: boolean }>();
  for (const d of docs) {
    for (const st of d ? [...d.getElementsByTagNameNS(NS.style, "style")] : []) {
      const tp = st.getElementsByTagNameNS(NS.style, "text-properties")[0];
      if (!tp) continue;
      const pos = tp.getAttributeNS(NS.style, "text-position") ?? "";
      out.set(st.getAttributeNS(NS.style, "name") ?? "", {
        b: tp.getAttributeNS(NS.fo, "font-weight") === "bold",
        i: tp.getAttributeNS(NS.fo, "font-style") === "italic",
        u: !!tp.getAttributeNS(NS.style, "text-underline-style") && tp.getAttributeNS(NS.style, "text-underline-style") !== "none",
        s: !!tp.getAttributeNS(NS.style, "text-line-through-style") && tp.getAttributeNS(NS.style, "text-line-through-style") !== "none",
        sup: /^super|^[1-9]/.test(pos),
        sub: /^sub|^-/.test(pos),
      });
    }
  }
  return out;
}

/** ODF 的文字內容（text:p、text:h、text:list、table:table、draw:frame…）→ HTML。images：壓縮檔裡的路徑 → 存好的位置 */
function odfBlocksHtml(parent: Element, ctx: { styles: ReturnType<typeof odfTextStyles>; numbered: Set<string>; images: Map<string, string> }): string {
  const inline = (el: Element): string => {
    let out = "";
    for (const n of [...el.childNodes]) {
      if (n.nodeType === 3) {
        out += escHtml(n.textContent ?? "");
        continue;
      }
      if (n.nodeType !== 1) continue;
      const c = n as Element;
      const ln = c.localName;
      if (c.namespaceURI === NS.text && ln === "span") {
        let inner = inline(c);
        const st = ctx.styles.get(c.getAttributeNS(NS.text, "style-name") ?? "");
        if (st?.sup) inner = `<sup>${inner}</sup>`;
        if (st?.sub) inner = `<sub>${inner}</sub>`;
        if (st?.s) inner = `<s>${inner}</s>`;
        if (st?.u) inner = `<u>${inner}</u>`;
        if (st?.i) inner = `<em>${inner}</em>`;
        if (st?.b) inner = `<strong>${inner}</strong>`;
        out += inner;
      } else if (c.namespaceURI === NS.text && ln === "a") {
        const href = c.getAttributeNS(NS.xlink, "href") ?? "";
        out += /^(https?:|mailto:)/i.test(href) ? `<a href="${escHtml(href)}">${inline(c)}</a>` : inline(c);
      } else if (c.namespaceURI === NS.text && ln === "s") out += " ".repeat(Math.max(1, Number(c.getAttributeNS(NS.text, "c")) || 1));
      else if (c.namespaceURI === NS.text && ln === "tab") out += "\t";
      else if (c.namespaceURI === NS.text && ln === "line-break") out += "<br>";
      else if (c.namespaceURI === NS.draw && ln === "frame") out += frameImg(c);
      else if (c.namespaceURI === NS.text && /^(note|bookmark|bookmark-start|bookmark-end|soft-page-break|sequence-decls)$/.test(ln)) continue;
      else out += inline(c);
    }
    return out;
  };
  const frameImg = (frame: Element) => {
    const img = frame.getElementsByTagNameNS(NS.draw, "image")[0];
    const src = img ? ctx.images.get(img.getAttributeNS(NS.xlink, "href") ?? "") : undefined;
    return src ? `<img src="${escHtml(src)}">` : "";
  };
  const list = (l: Element): string => {
    const tag = ctx.numbered.has(l.getAttributeNS(NS.text, "style-name") ?? "") ? "ol" : "ul";
    const items = [...l.children]
      .filter((c) => c.namespaceURI === NS.text && (c.localName === "list-item" || c.localName === "list-header"))
      .map((li) => `<li>${odfBlocksHtml(li, ctx)}</li>`);
    return `<${tag}>${items.join("")}</${tag}>`;
  };
  let out = "";
  for (const c of [...parent.children]) {
    const ln = c.localName;
    if (c.namespaceURI === NS.text && ln === "h") {
      const lv = Math.min(6, Math.max(1, Number(c.getAttributeNS(NS.text, "outline-level")) || 1));
      out += `<h${lv}>${inline(c)}</h${lv}>`;
    } else if (c.namespaceURI === NS.text && ln === "p") out += `<p>${inline(c)}</p>`;
    else if (c.namespaceURI === NS.text && ln === "list") out += list(c);
    else if (c.namespaceURI === NS.table && ln === "table") {
      // 這個表格自己的列（表頭列在 table-header-rows 裡），不含巢狀表格的
      const rowsOf = (el: Element): Element[] =>
        [...el.children].flatMap((x) =>
          x.namespaceURI !== NS.table ? [] : x.localName === "table-row" ? [x] : /^table-(header-)?rows$|^table-row-group$/.test(x.localName) ? rowsOf(x) : [],
        );
      const rows = rowsOf(c)
        .map((r) => `<tr>${[...r.children].filter((x) => x.namespaceURI === NS.table && x.localName === "table-cell").map((x) => `<td>${odfBlocksHtml(x, ctx)}</td>`).join("")}</tr>`);
      out += `<table>${rows.join("")}</table>`;
    } else if (c.namespaceURI === NS.text && /^(section|index-body|table-of-content|illustration-index)$/.test(ln)) out += odfBlocksHtml(c, ctx);
    else if (c.namespaceURI === NS.draw && ln === "frame") out += `<p>${frameImg(c)}</p>`;
  }
  return out;
}

/** 有編號的清單樣式名稱（第一層是 text:list-level-style-number） */
function numberedLists(docs: (Document | null)[]): Set<string> {
  const out = new Set<string>();
  for (const d of docs)
    for (const ls of d ? [...d.getElementsByTagNameNS(NS.text, "list-style")] : []) {
      const first = [...ls.children][0];
      if (first?.localName === "list-level-style-number") out.add(ls.getAttributeNS(NS.style, "name") ?? "");
    }
  return out;
}

async function saveParts(files: Map<string, Uint8Array>, paths: Iterable<string>, saveImage: SaveImage): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const p of paths) {
    const b = files.get(p);
    if (b && !out.has(p)) out.set(p, await saveImage(b, p.split("/").pop() ?? "image"));
  }
  return out;
}

const parseXml = (files: Map<string, Uint8Array>, path: string) => {
  const b = files.get(path);
  return b ? new DOMParser().parseFromString(new TextDecoder().decode(b), "application/xml") : null;
};

/** .odt（解壓縮後）→ HTML；圖片先存好。 */
export async function odtHtml(files: Map<string, Uint8Array>, saveImage?: SaveImage): Promise<string | null> {
  const content = parseXml(files, "content.xml");
  const body = content?.getElementsByTagNameNS(NS.office, "text")[0];
  if (!content || !body) return null;
  const stylesDoc = parseXml(files, "styles.xml");
  const pics = [...content.getElementsByTagNameNS(NS.draw, "image")].map((i) => i.getAttributeNS(NS.xlink, "href") ?? "").filter((h) => h && !/^https?:/.test(h));
  const images = saveImage ? await saveParts(files, pics, saveImage) : new Map<string, string>();
  return odfBlocksHtml(body, { styles: odfTextStyles([content, stylesDoc]), numbered: numberedLists([content, stylesDoc]), images });
}

/* ─── RTF ─── */

const CODEPAGES: Record<number, string> = { 950: "big5", 936: "gbk", 932: "shift_jis", 949: "euc-kr", 1252: "windows-1252", 1250: "windows-1250", 1251: "windows-1251", 65001: "utf-8" };
/** 會略過的目的地（字型表、色彩表、樣式表、文件資訊、圖片、頁首頁尾…） */
const RTF_SKIP = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "headerl", "headerr", "headerf", "footer", "footerl", "footerr", "footerf", "listtable", "listoverridetable", "rsidtbl", "generator", "xmlnstbl", "themedata", "colorschememapping", "latentstyles", "datastore", "mmathPr", "object", "fldinst", "filetbl", "revtbl", "pgdsctbl", "footnote"]);

/**
 * RTF → HTML：段落、標題（樣式表裡叫 heading 1… 的段落樣式）、清單項目（有 \listtext／\pntext 或 \ls 的段落）、
 * 表格（\intbl 的段落、\cell、\row）、粗體、斜體、底線、刪除線、上下標、換行；圖片、頁首頁尾略過。
 * 依 \ansicpg 解碼（繁體中文是 950＝Big5），\uN 是 Unicode。
 */
export function rtfHtml(rtf: string): string {
  let cp = "windows-1252";
  const m = /\\ansicpg(\d+)/.exec(rtf);
  if (m && CODEPAGES[Number(m[1])]) cp = CODEPAGES[Number(m[1])];
  // 樣式表：段落樣式編號 → 標題層級（名稱是 heading 1…；中文版 Word 也用英文名稱）
  const headingOf = new Map<number, number>();
  const sheet = /\{\\stylesheet([\s\S]*?)\}\s*(?:\{\\\*?\\?(?:listtable|list|rsidtbl|generator|info|latentstyles|mmathPr)|\\)/.exec(rtf)?.[1] ?? "";
  for (const s of sheet.matchAll(/\{[^{}]*?\\s(\d+)\b[^{}]*?\s([^;{}\\]*?)\s*;\s*\}/g)) {
    const h = /heading\s*(\d)/i.exec(s[2]);
    if (h) headingOf.set(Number(s[1]), Math.min(6, Number(h[1])));
  }
  type St = { b: boolean; i: boolean; u: boolean; s: boolean; sup: boolean; sub: boolean; skip: boolean; uc: number; list: boolean };
  let st: St = { b: false, i: false, u: false, s: false, sup: false, sub: false, skip: false, uc: 1, list: false };
  const stack: St[] = [];
  /** 目前段落的屬性（\pard 重設） */
  let pp = { style: 0, list: false, table: false };
  let para = "";
  let bytes: number[] = [];
  let skipChars = 0;
  const out: string[] = [];
  let list: string[] = [];
  let cells: string[] = [];
  let rows: string[][] = [];
  const flushList = () => {
    if (list.length) out.push(`<ul>${list.map((x) => `<li>${x}</li>`).join("")}</ul>`);
    list = [];
  };
  const flushTable = () => {
    if (cells.length) rows.push(cells);
    cells = [];
    if (rows.length) out.push(`<table>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`);
    rows = [];
  };
  const decode = (b: number[]) => {
    try {
      return new TextDecoder(cp).decode(new Uint8Array(b));
    } catch {
      return String.fromCharCode(...b);
    }
  };
  const wrap = (s: string) => {
    let t = escHtml(s);
    if (st.sup) t = `<sup>${t}</sup>`;
    if (st.sub) t = `<sub>${t}</sub>`;
    if (st.s) t = `<s>${t}</s>`;
    if (st.u) t = `<u>${t}</u>`;
    if (st.i) t = `<em>${t}</em>`;
    if (st.b) t = `<strong>${t}</strong>`;
    return t;
  };
  const emit = (s: string) => {
    if (!st.skip && s) para += wrap(s);
  };
  const flushBytes = () => {
    if (!bytes.length) return;
    const s = decode(bytes);
    bytes = [];
    emit(s);
  };
  // 一個字一個字包的格式併起來：<strong>b</strong><strong>o</strong> → <strong>bo</strong>
  const merge = (p: string) => {
    let prev = "";
    while (prev !== p) {
      prev = p;
      p = p.replace(/<\/(strong|em|u|s|sup|sub)><\1>/g, "");
    }
    return p.trim();
  };
  const hasText = (p: string) => !!p.replace(/<[^>]+>/g, "").trim();
  const endPara = () => {
    flushBytes();
    const html = merge(para);
    para = "";
    if (pp.table) return; // 表格的段落在 \cell 收進格子
    flushTable();
    if (pp.list) {
      if (hasText(html)) list.push(html);
      return;
    }
    flushList();
    if (!hasText(html)) return;
    const h = headingOf.get(pp.style);
    out.push(h ? `<h${h}>${html}</h${h}>` : `<p>${html}</p>`);
  };
  const endCell = () => {
    flushBytes();
    flushList();
    cells.push(merge(para));
    para = "";
  };
  for (let i = 0; i < rtf.length; ) {
    const ch = rtf[i];
    if (ch === "{") {
      flushBytes();
      stack.push(st);
      st = { ...st };
      i++;
      // {\* …} 不認得的目的地整個略過
      if (rtf.startsWith("\\*", i)) st.skip = true;
      continue;
    }
    if (ch === "}") {
      flushBytes();
      st = stack.pop() ?? st;
      i++;
      continue;
    }
    if (ch === "\\") {
      const nx = rtf[i + 1];
      if (nx === "'") {
        if (skipChars > 0) skipChars--;
        else if (!st.skip) bytes.push(parseInt(rtf.substr(i + 2, 2), 16));
        i += 4;
        continue;
      }
      if (nx === "\\" || nx === "{" || nx === "}") {
        flushBytes();
        if (skipChars > 0) skipChars--;
        else emit(nx);
        i += 2;
        continue;
      }
      if (nx === "~") {
        flushBytes();
        emit(" ");
        i += 2;
        continue;
      }
      if (nx === "\n" || nx === "\r") {
        endPara();
        i += 2;
        continue;
      }
      const w = /^([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i + 1, i + 40));
      if (!w) {
        i += 2;
        continue;
      }
      i += 1 + w[0].length;
      const word = w[1];
      const arg = w[2] === undefined ? null : Number(w[2]);
      if (word !== "u") flushBytes();
      if (word === "listtext" || word === "pntext") {
        // 清單的編號／項目符號文字：不要，但這一段是清單項目
        pp.list = true;
        st.skip = true;
        continue;
      }
      if (RTF_SKIP.has(word)) {
        st.skip = true;
        continue;
      }
      if (st.skip) continue;
      switch (word) {
        case "par":
        case "sect":
        case "page":
          endPara();
          break;
        case "pard":
          pp = { style: 0, list: false, table: false };
          break;
        case "s":
          pp.style = arg ?? 0;
          break;
        case "ls":
        case "ilvl":
          pp.list = true;
          break;
        case "intbl":
          pp.table = true;
          break;
        case "cell":
          endCell();
          break;
        case "row":
          flushBytes();
          if (cells.length) rows.push(cells);
          cells = [];
          para = "";
          break;
        case "line":
          para += "<br>";
          break;
        case "tab":
          emit("\t");
          break;
        case "b":
          st.b = arg !== 0;
          break;
        case "i":
          st.i = arg !== 0;
          break;
        case "ul":
          st.u = arg !== 0;
          break;
        case "ulnone":
          st.u = false;
          break;
        case "strike":
          st.s = arg !== 0;
          break;
        case "super":
          st.sup = true;
          break;
        case "sub":
          st.sub = true;
          break;
        case "nosupersub":
          st.sup = st.sub = false;
          break;
        case "plain":
          st = { ...st, b: false, i: false, u: false, s: false, sup: false, sub: false };
          break;
        case "uc":
          st.uc = arg ?? 1;
          break;
        case "u": {
          flushBytes();
          let code = arg ?? 0;
          if (code < 0) code += 65536;
          emit(String.fromCharCode(code));
          skipChars = st.uc;
          break;
        }
        case "emdash":
          emit("—");
          break;
        case "endash":
          emit("–");
          break;
        case "bullet":
          emit("•");
          break;
        case "lquote":
          emit("‘");
          break;
        case "rquote":
          emit("’");
          break;
        case "ldblquote":
          emit("“");
          break;
        case "rdblquote":
          emit("”");
          break;
      }
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      i++;
      continue;
    }
    if (skipChars > 0) {
      skipChars--;
      i++;
      continue;
    }
    flushBytes();
    emit(ch);
    i++;
  }
  endPara();
  pp.table = false;
  flushTable();
  flushList();
  return out.join("");
}

/* ─── 舊版 Word（.doc）：只拿文字 ─── */

/**
 * Word 97–2003（.doc）→ 段落文字。讀 FIB 找到 piece table（CLX），照每一段（piece）的編碼
 * （壓縮的是 cp1252，其他是 UTF-16）取出正文；欄位只留結果，表格的格子用 Tab 隔開。
 */
export function docText(bytes: Uint8Array): string[] {
  const wd = cfbStream(bytes, ["WordDocument"]);
  if (!wd || wd.length < 0x200) throw new Error("This file isn't a Word 97–2003 document.");
  const v = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
  if (v.getUint16(0, true) !== 0xa5ec) throw new Error("This Word file is too old to import (Word 95 or earlier). Save it as .docx first.");
  const flags = v.getUint16(0x0a, true);
  if (flags & 0x0100) throw new Error("This document is password-protected. Open it in Word and save it without a password first.");
  const table = cfbStream(bytes, [flags & 0x0200 ? "1Table" : "0Table"]);
  if (!table) throw new Error("This Word file is missing its table stream.");
  // FIB：base(32) → csw → fibRgW → cslw → fibRgLw → cbRgFcLcb → fibRgFcLcb
  let at = 32;
  const csw = v.getUint16(at, true);
  at += 2 + csw * 2;
  const cslw = v.getUint16(at, true);
  const rgLw = at + 2;
  const ccpText = v.getUint32(rgLw + 3 * 4, true);
  at += 2 + cslw * 4;
  at += 2;
  const fcClx = v.getUint32(at + 33 * 8, true);
  const lcbClx = v.getUint32(at + 33 * 8 + 4, true);
  const tv = new DataView(table.buffer, table.byteOffset, table.byteLength);
  let p = fcClx;
  const end = fcClx + lcbClx;
  while (p < end && table[p] === 0x01) p += 3 + tv.getUint16(p + 1, true);
  if (table[p] !== 0x02) throw new Error("This Word file's text table couldn't be read.");
  const lcb = tv.getUint32(p + 1, true);
  const plc = p + 5;
  const n = (lcb - 4) / 12;
  let text = "";
  for (let k = 0; k < n && text.length < ccpText; k++) {
    const cp0 = tv.getUint32(plc + k * 4, true);
    const cp1 = tv.getUint32(plc + (k + 1) * 4, true);
    const pcd = plc + (n + 1) * 4 + k * 8;
    const fcRaw = tv.getUint32(pcd + 2, true);
    const compressed = (fcRaw & 0x40000000) !== 0;
    const len = cp1 - cp0;
    if (compressed) {
      const fc = (fcRaw & 0x3fffffff) / 2;
      text += new TextDecoder("windows-1252").decode(wd.subarray(fc, fc + len));
    } else text += new TextDecoder("utf-16le").decode(wd.subarray(fcRaw, fcRaw + len * 2));
  }
  text = text.slice(0, ccpText);
  // 欄位：\x13 指令 \x14 結果 \x15 → 只留結果
  text = text.replace(/\x13[^\x13\x14\x15]*\x14([^\x13\x15]*)\x15/g, "$1").replace(/\x13[^\x13\x15]*\x15/g, "");
  text = text.replace(/[\x01\x08\x05\x02\x03\x04]/g, "");
  // 表格：每格結尾是 \x07，一列結尾再多一個 \x07 → 一列變成一個「段落」，格子用 ROW_CELL 隔開
  // （格子可以是空的，所以用最短的比對：遇到第一個連續的 \x07\x07 就是這一列的結尾）
  text = text.replace(/((?:[^\r\x07\x0c]*\x07)+?)\x07/g, (_m, cells: string) => `\r${ROW}${cells.slice(0, -1).split("\x07").join(ROW_CELL)}\r`);
  return text
    .replace(/\x07/g, "\t")
    .replace(/\x0b/g, "\n")
    .split(/[\r\x0c]/)
    .map((s) => s.replace(/\t+$/, "").trimEnd())
    .filter((s) => s.trim());
}

/** `docText` 裡表格的一列：開頭是 ROW，格子之間是 ROW_CELL */
const ROW = "";
const ROW_CELL = "";

/** `docText` 的段落 → HTML（連續的表格列組成一個表格）。 */
export function docParasHtml(paras: string[]): string {
  const out: string[] = [];
  let rows: string[][] = [];
  const flush = () => {
    if (rows.length) out.push(`<table>${rows.map((r) => `<tr>${r.map((c) => `<td>${escHtml(c.trim())}</td>`).join("")}</tr>`).join("")}</table>`);
    rows = [];
  };
  for (const p of paras) {
    if (p.startsWith(ROW)) {
      rows.push(p.slice(1).split(ROW_CELL));
      continue;
    }
    flush();
    out.push(`<p>${escHtml(p).replace(/\n/g, "<br>")}</p>`);
  }
  flush();
  return out.join("");
}

/* ─── Word：依副檔名 ─── */

/** 匯入 Word 文件 → Markdown。 */
export async function importWord(name: string, bytes: Uint8Array, saveImage: SaveImage): Promise<string> {
  const e = extOf(name);
  if (e === "docx") {
    const files = await unzip(bytes);
    const html = docxHtml(files, { images: true });
    if (html === null) throw new Error("This file isn't a Word document.");
    const ids = docxImages(files);
    const saved = await saveParts(files, ids.values(), saveImage);
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const img of [...doc.querySelectorAll("img[data-rid]")]) {
      const src = saved.get(ids.get(img.getAttribute("data-rid") ?? "") ?? "");
      if (src) img.setAttribute("src", src);
      else img.remove();
    }
    return htmlToMarkdown(doc.body.innerHTML);
  }
  if (e === "odt") {
    const html = await odtHtml(await unzip(bytes), saveImage);
    if (html === null) throw new Error("This file isn't an OpenDocument text document.");
    return htmlToMarkdown(html);
  }
  if (e === "doc") {
    // 有些網站的 .doc 其實是 HTML 或 RTF
    const head = decodeTableText(bytes.subarray(0, 512)).trimStart();
    if (head.startsWith("{\\rtf")) return htmlToMarkdown(rtfHtml(new TextDecoder("latin1").decode(bytes)));
    if (/^<(!doctype|html|\?xml)/i.test(head)) return htmlToMarkdown(decodeTableText(bytes));
    return htmlToMarkdown(docParasHtml(docText(bytes)));
  }
  if (e === "rtf") return htmlToMarkdown(rtfHtml(new TextDecoder("latin1").decode(bytes)));
  if (e === "html" || e === "htm") return htmlToMarkdown(decodeTableText(bytes));
  if (e === "md" || e === "markdown") return decodeTableText(bytes).replace(/\r\n?/g, "\n").trim();
  return textToMarkdown(decodeTableText(bytes));
}

/* ─── 簡報 ─── */

export interface ImportedSlide {
  /** 投影片的 Markdown */
  md: string;
  notes?: string;
}

/** 標題、內文（項目符號）、圖片 → 一張投影片的 Markdown */
function slideMd(title: string, body: { text: string; bullet: boolean }[], images: string[]): string {
  const esc = (s: string) => textToMarkdown(s).replace(/\n\n/g, " ");
  const parts: string[] = [];
  if (title.trim()) parts.push(`# ${esc(title.replace(/\n/g, " "))}`);
  let list: string[] = [];
  const flush = () => {
    if (list.length) parts.push(list.join("\n"));
    list = [];
  };
  for (const b of body) {
    const md = esc(b.text);
    if (!md) continue;
    if (b.bullet) list.push(`- ${md}`);
    else {
      flush();
      parts.push(md);
    }
  }
  flush();
  parts.push(...imageMd(images));
  return parts.join("\n\n");
}

/** OpenDocument 簡報（.odp）→ 投影片 */
export async function odpSlides(files: Map<string, Uint8Array>, saveImage?: SaveImage): Promise<ImportedSlide[] | null> {
  const content = parseXml(files, "content.xml");
  const pres = content?.getElementsByTagNameNS(NS.office, "presentation")[0];
  if (!content || !pres) return null;
  const pics = [...content.getElementsByTagNameNS(NS.draw, "image")].map((i) => i.getAttributeNS(NS.xlink, "href") ?? "").filter((h) => h && !/^https?:/.test(h));
  const saved = saveImage ? await saveParts(files, pics, saveImage) : new Map<string, string>();
  const paras = (el: Element) =>
    [...el.getElementsByTagNameNS(NS.text, "p")].map((p) => ({ text: (p.textContent ?? "").trim(), inList: !!p.closest("list-item") || p.parentElement?.localName === "list-item" }));
  return [...pres.getElementsByTagNameNS(NS.draw, "page")].map((page) => {
    let title = "";
    const body: { text: string; bullet: boolean }[] = [];
    const images: string[] = [];
    let notes = "";
    for (const frame of [...page.children].filter((c) => c.namespaceURI === NS.draw && (c.localName === "frame" || c.localName === "custom-shape"))) {
      const cls = frame.getAttributeNS(NS.presentation, "class") ?? "";
      const img = frame.getElementsByTagNameNS(NS.draw, "image")[0];
      const src = img ? saved.get(img.getAttributeNS(NS.xlink, "href") ?? "") : undefined;
      if (src && !frame.getElementsByTagNameNS(NS.text, "p").length) {
        images.push(src);
        continue;
      }
      const ps = paras(frame).filter((p) => p.text);
      if (cls === "title" && !title) title = ps.map((p) => p.text).join(" ");
      else for (const p of ps) body.push({ text: p.text, bullet: cls === "outline" || p.inList });
    }
    const n = page.getElementsByTagNameNS(NS.presentation, "notes")[0];
    if (n) notes = paras(n).map((p) => p.text).filter(Boolean).join("\n");
    if (!title && body.length > 1) title = body.shift()!.text;
    return { md: slideMd(title, body, images), ...(notes ? { notes } : {}) };
  });
}

/** Markdown → 投影片：單獨一行的 `---` 分張（Marp、Slidev 的寫法，開頭的 front matter 去掉）；沒有的話照 `#` 標題分張。 */
export function markdownSlides(md: string): string[] {
  let s = md.replace(/\r\n?/g, "\n");
  s = s.replace(/^---\n(?:[\w-]+:.*\n)*---\n/, "");
  const lines = s.split("\n");
  const parts: string[][] = [[]];
  let fence: string | null = null;
  for (const line of lines) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) fence = fence ? (line.trim().startsWith(fence) ? null : fence) : f[1];
    if (!fence && /^\s*---\s*$/.test(line)) parts.push([]);
    else parts[parts.length - 1].push(line);
  }
  let slides = parts.map((p) => p.join("\n").trim()).filter(Boolean);
  if (slides.length <= 1 && s.trim()) {
    const level = /^# /m.test(s) && (s.match(/^# /gm)?.length ?? 0) > 1 ? "# " : "## ";
    const out: string[][] = [[]];
    fence = null;
    for (const line of s.split("\n")) {
      const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (f) fence = fence ? (line.trim().startsWith(fence) ? null : fence) : f[1];
      if (!fence && line.startsWith(level) && out[out.length - 1].some((l) => l.trim())) out.push([]);
      out[out.length - 1].push(line);
    }
    slides = out.map((p) => p.join("\n").trim()).filter(Boolean);
  }
  return slides;
}

/** 匯入簡報 → 投影片（Markdown 與備忘稿）。 */
export async function importSlides(name: string, bytes: Uint8Array, saveImage: SaveImage): Promise<ImportedSlide[]> {
  const e = extOf(name);
  if (e === "pptx") {
    const files = await unzip(bytes);
    const slides = pptxSlides(files);
    if (slides === null) throw new Error("This file isn't a PowerPoint presentation.");
    const saved = await saveParts(files, slides.flatMap((s) => s.images ?? []), saveImage);
    return slides.map((s) => ({
      md: slideMd(
        s.title,
        s.body.map((text, i) => ({ text, bullet: !!s.bullet?.[i] })),
        (s.images ?? []).map((p) => saved.get(p) ?? "").filter(Boolean),
      ),
      ...(s.notes ? { notes: s.notes } : {}),
    }));
  }
  if (e === "odp") {
    const slides = await odpSlides(await unzip(bytes), saveImage);
    if (slides === null) throw new Error("This file isn't an OpenDocument presentation.");
    return slides;
  }
  if (e === "ppt") throw new Error("PowerPoint 97–2003 files (.ppt) can't be imported. Save it as .pptx first.");
  return markdownSlides(decodeTableText(bytes)).map((md) => ({ md }));
}

/* ─── 放進文件 ─── */

/**
 * 把匯入的投影片接在簡報後面（原本只有空白投影片就換掉），備忘稿放進每張的設定。
 * 回傳新的內容、動畫設定，與第一張匯入的投影片是第幾張。
 */
export function withImportedSlides(content: string, anim: SlideAnim[], imported: ImportedSlide[]): { content: string; anim: SlideAnim[]; first: number } {
  const old = splitSlides(content);
  const blank = old.every((s) => !s.trim());
  const base = blank ? [] : old;
  const a: SlideAnim[] = blank ? [] : anim.slice(0, base.length);
  while (a.length < base.length) a.push(NO_ANIM);
  for (const s of imported) a.push(s.notes ? { ...NO_ANIM, notes: s.notes } : NO_ANIM);
  return { content: joinSlides([...base, ...imported.map((s) => s.md)]), anim: trimAnim(a), first: base.length };
}

/** 把匯入的 Markdown 接在 Word 文件後面（原本是空的就換掉）。 */
export const withImportedText = (content: string, md: string) => (content.trim() ? `${content.trimEnd()}\n\n${md.trim()}\n` : `${md.trim()}\n`);

/** Dock 的「Import a File…」接受的副檔名：Word、簡報、試算表都可以 */
export const DOCK_IMPORT = [...new Set([...WORD_IMPORT.split(","), ...SLIDES_IMPORT.split(","), ...IMPORT_ACCEPT.split(",")])].join(",");

/** 這個檔案在 Dock 裡變成哪種文件：簡報檔 → Slides、試算表檔 → Excel，其他（含 .md、.html、.txt）→ Word */
export function importKind(name: string): DockKind | null {
  const e = extOf(name);
  if (e === "pptx" || e === "odp" || e === "ppt") return "slides";
  if (/^(xlsx|xlsm|xls|ods|csv|tsv|tab|json)$/.test(e)) return "sheet";
  if (/^(docx|doc|odt|rtf|html|htm|md|markdown|txt)$/.test(e)) return "word";
  return null;
}

/** 檔案 → Dock 的新文件內容（種類、標題、內容，簡報另有動畫設定）。 */
export async function importAsDoc(name: string, bytes: Uint8Array, saveImage: SaveImage): Promise<{ kind: DockKind; title: string; content: string; anim?: SlideAnim[] }> {
  const kind = importKind(name);
  const title = titleOf(name) || "Imported";
  if (kind === "slides") {
    const r = withImportedSlides("", [], await importSlides(name, bytes, saveImage));
    return { kind, title, content: r.content, ...(r.anim.length ? { anim: r.anim } : {}) };
  }
  if (kind === "sheet") {
    const got = await readSpreadsheet(name, bytes);
    if (got.kind === "workbook") {
      if (!got.sheets.length) throw new Error("This workbook has no sheets.");
      return { kind, title, content: serializeWorkbook(addImported(newWorkbook(), got.sheets).wb) };
    }
    const blank = newWorkbook().sheets[0];
    const wb = { sheets: [{ ...blank, name: title, tables: [] }] };
    return { kind, title, content: serializeWorkbook(importTables(wb, blank.id, got.tables, 40).wb) };
  }
  if (kind === "word") return { kind, title, content: withImportedText("", await importWord(name, bytes, saveImage)) };
  throw new Error(`Banyan can't import .${extOf(name) || "this kind of"} files.`);
}
