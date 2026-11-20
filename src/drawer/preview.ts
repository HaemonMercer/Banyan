/**
 * Drawer 的檔案預覽：判斷怎麼顯示，並把簡單的文件轉成可以顯示的東西（純函式，只用 DOMParser）。
 *
 * - 圖片、影片、音訊、PDF、HTML：交給瀏覽器（`<img>`、`<video>`、`<audio>`、`<iframe>`）。
 * - Markdown：照編輯器的樣子渲染；程式碼與純文字：上色（`codeLang` 從副檔名判斷語言）。
 * - CSV／TSV、Excel（.xlsx）：轉成試算表，用 `SheetView` 顯示（公式照算）。
 * - Word（.docx）：`docxHtml` 讀 `word/document.xml`，保留標題、段落、粗體斜體底線刪除線、清單、表格、連結。
 * - PowerPoint（.pptx）：`pptxSlides` 讀每張投影片的文字（標題＋內文）。
 * - 其他副檔名：內容看起來是文字（`looksText`）就當純文字顯示。
 */
import { normLang } from "../editor/codeHighlight";

export type PreviewKind = "image" | "video" | "audio" | "pdf" | "html" | "markdown" | "code" | "table" | "xlsx" | "docx" | "pptx" | "other";

const extOf = (name: string) => (/\.([^./\\]+)$/.exec(name)?.[1] ?? "").toLowerCase();

/** 沒有特別語言、但一定是文字的副檔名 */
const PLAIN = /^(txt|text|log|ini|cfg|conf|toml|env|properties|bib|ris|tex|rst|org|srt|vtt|gitignore|editorconfig)$/;

/** 副檔名 → 程式碼語言（`codeHighlight.ts` 的 id；純文字是 ""）；不是程式碼或文字就是 null。 */
export function codeLang(name: string): string | null {
  const e = extOf(name);
  if (!e) return null;
  if (PLAIN.test(e)) return "";
  const id = normLang(e);
  const known: Record<string, string> = {
    bash: "bash", c: "c", cpp: "cpp", cxx: "cpp", csharp: "csharp", css: "css", scss: "css", less: "css", diff: "diff",
    go: "go", java: "java", javascript: "javascript", json: "json", jsonc: "json", kotlin: "kotlin", kts: "kotlin",
    php: "php", powershell: "powershell", psm1: "powershell", python: "python", pyw: "python", ruby: "ruby",
    rust: "rust", sql: "sql", swift: "swift", typescript: "typescript", xml: "xml", xsl: "xml", svg: "xml",
    yaml: "yaml", bat: "", cmd: "",
  };
  return id in known ? known[id] : null;
}

/** 依副檔名（或 data URL 的類型）決定怎麼預覽。 */
export function previewKind(name: string, src = ""): PreviewKind {
  const e = extOf(name);
  const mime = /^data:([^;,]+)/.exec(src)?.[1] ?? "";
  if (/^(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/.test(e) || mime.startsWith("image/")) return "image";
  if (/^(mp4|webm|ogv|mov|m4v)$/.test(e) || mime.startsWith("video/")) return "video";
  if (/^(mp3|wav|ogg|oga|m4a|flac|aac|opus)$/.test(e) || mime.startsWith("audio/")) return "audio";
  if (e === "pdf" || mime === "application/pdf") return "pdf";
  if (/^html?$/.test(e)) return "html";
  if (/^(md|markdown|mdown|mkd)$/.test(e)) return "markdown";
  if (/^(csv|tsv)$/.test(e)) return "table";
  // 活頁簿（舊版 .xls、OpenDocument .ods 也是；試算表的 `formats.ts` 讀）
  if (/^(xlsx|xlsm|xls|ods)$/.test(e)) return "xlsx";
  if (e === "docx") return "docx";
  if (e === "pptx") return "pptx";
  if (codeLang(name) !== null) return "code";
  return "other";
}

/** 內容像不像文字：開頭 8 KB 沒有 NUL，而且是合法的 UTF-8（或有 UTF-16 的 BOM）。 */
export function looksText(bytes: Uint8Array): boolean {
  if (!bytes.length) return true;
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return true;
  const head = bytes.subarray(0, 8192);
  if (head.includes(0)) return false;
  try {
    // 最後一個字可能被切斷，少看幾個位元組
    new TextDecoder("utf-8", { fatal: true }).decode(head.subarray(0, head.length === bytes.length ? head.length : head.length - 4));
    return true;
  } catch {
    return false;
  }
}

/** 位元組 → 文字（UTF-8，或依 BOM 用 UTF-16）；去掉 BOM。 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  return new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
}

/* ─── Word（.docx） ─── */

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";

function parseXml(files: Map<string, Uint8Array>, path: string): Document | null {
  const b = files.get(path);
  if (!b) return null;
  const d = new DOMParser().parseFromString(decodeText(b), "application/xml");
  return d.getElementsByTagName("parsererror").length ? null : d;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kids = (el: Element, ns: string, tag: string) => [...el.children].filter((c) => c.namespaceURI === ns && c.localName === tag);
const kid = (el: Element | undefined, ns: string, tag: string) => (el ? kids(el, ns, tag)[0] : undefined);
const wAttr = (el: Element | undefined, name: string) => el?.getAttributeNS(W, name) ?? el?.getAttribute(`w:${name}`) ?? null;

/** `<w:b/>` 是開，`<w:b w:val="0"/>`、`false`、`none` 是關。 */
function on(rPr: Element | undefined, tag: string): boolean {
  const el = kid(rPr, W, tag);
  if (!el) return false;
  const v = wAttr(el, "val");
  return v === null || !/^(0|false|off|none)$/i.test(v);
}

/** 樣式 id → 標題層級（1–6；`Title` 算 1），從 styles.xml 的樣式名稱判斷（中文 Word 的 id 常常是數字）。 */
function headingStyles(styles: Document | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!styles) return out;
  for (const s of [...styles.getElementsByTagNameNS(W, "style")]) {
    const id = wAttr(s, "styleId");
    const name = (wAttr(kid(s, W, "name"), "val") ?? "").toLowerCase();
    const m = /^heading\s*(\d)$/.exec(name);
    if (id && m) out.set(id, Math.min(6, Math.max(1, Number(m[1]))));
    else if (id && name === "title") out.set(id, 1);
  }
  return out;
}

const VML = "urn:schemas-microsoft-com:vml";

/** run 裡的圖片（`w:drawing` 的 `a:blip`、舊的 `v:imagedata`）→ relationship id */
function imageIds(r: Element): string[] {
  const ids: string[] = [];
  for (const b of [...r.getElementsByTagNameNS(A, "blip")]) {
    const id = b.getAttributeNS(R, "embed") ?? b.getAttribute("r:embed");
    if (id) ids.push(id);
  }
  for (const v of [...r.getElementsByTagNameNS(VML, "imagedata")]) {
    const id = v.getAttributeNS(R, "id") ?? v.getAttribute("r:id");
    if (id) ids.push(id);
  }
  return ids;
}

/** 一段文字（run）→ HTML：粗體、斜體、底線、刪除線、上下標；Tab、換行。images：圖片寫成 `<img data-rid>`（匯入時換成存好的檔案） */
function runHtml(r: Element, images = false): string {
  let text = "";
  const pics = images ? imageIds(r).map((id) => `<img data-rid="${esc(id)}">`).join("") : "";
  for (const c of [...r.children]) {
    if (c.namespaceURI !== W) continue;
    if (c.localName === "t" || c.localName === "delText") text += esc(c.textContent ?? "");
    else if (c.localName === "tab") text += "\t";
    else if (c.localName === "br" || c.localName === "cr") text += "<br>";
    else if (c.localName === "noBreakHyphen") text += "‑";
  }
  if (!text) return pics;
  const rPr = kid(r, W, "rPr");
  const va = wAttr(kid(rPr, W, "vertAlign"), "val");
  if (va === "superscript") text = `<sup>${text}</sup>`;
  if (va === "subscript") text = `<sub>${text}</sub>`;
  if (on(rPr, "strike") || on(rPr, "dstrike")) text = `<s>${text}</s>`;
  if (kid(rPr, W, "u") && wAttr(kid(rPr, W, "u"), "val") !== "none") text = `<u>${text}</u>`;
  if (on(rPr, "i")) text = `<em>${text}</em>`;
  if (on(rPr, "b")) text = `<strong>${text}</strong>`;
  return text + pics;
}

/** 段落裡的內容：文字、連結（`w:hyperlink`，外部網址從 rels 找）、欄位與修訂裡的文字。 */
function inlineHtml(el: Element, links: Map<string, string>, images = false): string {
  let out = "";
  for (const c of [...el.children]) {
    if (c.namespaceURI !== W) continue;
    if (c.localName === "r") out += runHtml(c, images);
    else if (c.localName === "hyperlink") {
      const id = c.getAttributeNS(R, "id") ?? c.getAttribute("r:id");
      const href = id ? links.get(id) : undefined;
      const inner = inlineHtml(c, links, images);
      out += href && /^(https?:|mailto:)/i.test(href) ? `<a href="${esc(href)}">${inner}</a>` : inner;
    } else if (["ins", "smartTag", "fldSimple", "sdt", "sdtContent", "customXml"].includes(c.localName)) out += inlineHtml(c, links, images);
  }
  return out;
}

/** Word 文件裡的圖片：relationship id → 壓縮檔裡的路徑（`word/media/image1.png`） */
export function docxImages(files: Map<string, Uint8Array>): Map<string, string> {
  const out = new Map<string, string>();
  const rels = parseXml(files, "word/_rels/document.xml.rels");
  for (const r of rels ? [...rels.getElementsByTagName("Relationship")] : []) {
    if (!/\/image$/.test(r.getAttribute("Type") ?? "") || r.getAttribute("TargetMode") === "External") continue;
    out.set(r.getAttribute("Id") ?? "", resolvePart("word/document.xml", r.getAttribute("Target") ?? ""));
  }
  return out;
}

/** 壓縮檔裡相對於某個檔案的路徑（`../media/a.png` 相對於 `ppt/slides/slide1.xml` → `ppt/media/a.png`） */
export function resolvePart(from: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = from.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

/**
 * Word 文件（解壓縮後的檔案）→ HTML。只處理文字結構：標題、段落、清單（有編號設定的段落；
 * numFmt 是 bullet 以外的當有序清單）、表格（含巢狀）、連結；圖片、文字方塊、頁首頁尾略過。
 * 沒有 `word/document.xml` 就是 null。
 */
export function docxHtml(files: Map<string, Uint8Array>, opts: { images?: boolean } = {}): string | null {
  const doc = parseXml(files, "word/document.xml");
  const body = doc ? doc.getElementsByTagNameNS(W, "body")[0] : undefined;
  if (!body) return null;
  const heads = headingStyles(parseXml(files, "word/styles.xml"));
  const links = new Map<string, string>();
  const rels = parseXml(files, "word/_rels/document.xml.rels");
  for (const r of rels ? [...rels.getElementsByTagName("Relationship")] : []) {
    if (r.getAttribute("TargetMode") === "External") links.set(r.getAttribute("Id") ?? "", r.getAttribute("Target") ?? "");
  }
  // 編號定義：numId → 是不是項目符號
  const bullets = new Map<string, boolean>();
  const numbering = parseXml(files, "word/numbering.xml");
  if (numbering) {
    const absFmt = new Map<string, boolean>();
    for (const a of [...numbering.getElementsByTagNameNS(W, "abstractNum")]) {
      const lvl0 = kids(a, W, "lvl")[0];
      absFmt.set(wAttr(a, "abstractNumId") ?? "", wAttr(kid(lvl0, W, "numFmt"), "val") === "bullet");
    }
    for (const n of [...numbering.getElementsByTagNameNS(W, "num")]) {
      bullets.set(wAttr(n, "numId") ?? "", absFmt.get(wAttr(kid(n, W, "abstractNumId"), "val") ?? "") ?? true);
    }
  }

  const blocks = (parent: Element): string => {
    let out = "";
    let list: { tag: "ul" | "ol"; items: string[] } | null = null;
    const flush = () => {
      if (list) out += `<${list.tag}>${list.items.map((i) => `<li>${i}</li>`).join("")}</${list.tag}>`;
      list = null;
    };
    for (const c of [...parent.children]) {
      if (c.namespaceURI !== W) continue;
      if (c.localName === "p") {
        const pPr = kid(c, W, "pPr");
        const html = inlineHtml(c, links, !!opts.images);
        const numId = wAttr(kid(kid(pPr, W, "numPr"), W, "numId"), "val");
        if (numId && numId !== "0") {
          const tag = bullets.get(numId) === false ? "ol" : "ul";
          if (!list || list.tag !== tag) {
            flush();
            list = { tag, items: [] };
          }
          list.items.push(html);
          continue;
        }
        flush();
        const style = wAttr(kid(pPr, W, "pStyle"), "val") ?? "";
        const outline = wAttr(kid(pPr, W, "outlineLvl"), "val");
        const level = heads.get(style) ?? (/^heading(\d)$/i.exec(style) ? Number(style.slice(7)) : outline !== null ? Number(outline) + 1 : 0);
        if (level >= 1 && level <= 6 && html.trim()) out += `<h${level}>${html}</h${level}>`;
        else out += html.trim() ? `<p>${html}</p>` : "";
      } else if (c.localName === "tbl") {
        flush();
        const rows = kids(c, W, "tr").map((tr) => {
          const cells = kids(tr, W, "tc").map((tc) => {
            const span = Number(wAttr(kid(kid(tc, W, "tcPr"), W, "gridSpan"), "val") ?? 1);
            return `<td${span > 1 ? ` colspan="${span}"` : ""}>${blocks(tc)}</td>`;
          });
          return `<tr>${cells.join("")}</tr>`;
        });
        out += `<table><tbody>${rows.join("")}</tbody></table>`;
      } else if (c.localName === "sdt") {
        flush();
        const content = kid(c, W, "sdtContent");
        if (content) out += blocks(content);
      }
    }
    flush();
    return out;
  };
  return blocks(body);
}

/* ─── PowerPoint（.pptx） ─── */

export interface SlideText {
  title: string;
  /** 內文的每一段（依文字方塊、段落順序；空段落略過） */
  body: string[];
  /** body 的每一段是不是項目符號（內文版面配置區的段落，或有 buChar／buAutoNum 的） */
  bullet?: boolean[];
  /** 投影片上的圖片（壓縮檔裡的路徑） */
  images?: string[];
  /** 備忘稿 */
  notes?: string;
}

const paraText = (p: Element) =>
  [...p.children].map((c) => (c.localName === "br" ? "\n" : [...c.getElementsByTagNameNS(A, "t")].map((t) => t.textContent ?? "").join(""))).join("");

/** 一張投影片的 relationships：id → 路徑，另外找出備忘稿 */
function slideRels(files: Map<string, Uint8Array>, path: string): { byId: Map<string, string>; notes: string | null } {
  const byId = new Map<string, string>();
  let notes: string | null = null;
  const d = parseXml(files, path.replace(/([^/]+)$/, "_rels/$1.rels"));
  for (const r of d ? [...d.getElementsByTagName("Relationship")] : []) {
    if (r.getAttribute("TargetMode") === "External") continue;
    const to = resolvePart(path, r.getAttribute("Target") ?? "");
    byId.set(r.getAttribute("Id") ?? "", to);
    if (/\/notesSlide$/.test(r.getAttribute("Type") ?? "")) notes = to;
  }
  return { byId, notes };
}

/** 簡報（解壓縮後的檔案）→ 每張投影片的標題與內文，依投影片順序；不是簡報就是 null。 */
export function pptxSlides(files: Map<string, Uint8Array>): SlideText[] | null {
  // 順序：presentation.xml 的 sldIdLst → rels；讀不到就照檔名的數字排
  let paths: string[] = [];
  const pres = parseXml(files, "ppt/presentation.xml");
  const rels = parseXml(files, "ppt/_rels/presentation.xml.rels");
  if (pres && rels) {
    const target = new Map<string, string>();
    for (const r of [...rels.getElementsByTagName("Relationship")]) target.set(r.getAttribute("Id") ?? "", r.getAttribute("Target") ?? "");
    paths = [...pres.getElementsByTagNameNS(P, "sldId")]
      .map((s) => target.get(s.getAttributeNS(R, "id") ?? s.getAttribute("r:id") ?? "") ?? "")
      .filter(Boolean)
      .map((t) => (t.startsWith("/") ? t.slice(1) : `ppt/${t}`).replace(/\/[^/]+\/\.\.\//g, "/"));
  }
  if (!paths.length) {
    paths = [...files.keys()]
      .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
      .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  }
  if (!paths.length) return files.has("ppt/presentation.xml") ? [] : null;
  return paths.map((path) => {
    const d = parseXml(files, path);
    const slide: SlideText = { title: "", body: [], bullet: [], images: [] };
    if (!d) return slide;
    const rels = slideRels(files, path);
    for (const sp of [...d.getElementsByTagNameNS(P, "sp")]) {
      const ph = sp.getElementsByTagNameNS(P, "ph")[0];
      const type = ph ? (ph.getAttribute("type") ?? "body") : "";
      const isTitle = /^(title|ctrTitle)$/.test(type);
      // 內文版面配置區的段落預設有項目符號；文字方塊與副標題沒有
      const listy = type === "body" || type === "obj";
      for (const p of [...sp.getElementsByTagNameNS(A, "p")]) {
        const t = paraText(p);
        if (!t.trim()) continue;
        if (isTitle) {
          slide.title = slide.title ? `${slide.title} ${t}` : t;
          continue;
        }
        const pPr = p.getElementsByTagNameNS(A, "pPr")[0];
        const none = !!pPr && pPr.getElementsByTagNameNS(A, "buNone").length > 0;
        const explicit = !!pPr && (pPr.getElementsByTagNameNS(A, "buChar").length > 0 || pPr.getElementsByTagNameNS(A, "buAutoNum").length > 0);
        slide.body.push(t);
        slide.bullet!.push(explicit || (listy && !none));
      }
    }
    for (const pic of [...d.getElementsByTagNameNS(P, "pic")]) {
      const id = pic.getElementsByTagNameNS(A, "blip")[0]?.getAttributeNS(R, "embed");
      const to = id ? rels.byId.get(id) : undefined;
      if (to && files.has(to)) slide.images!.push(to);
    }
    if (rels.notes) {
      const nd = parseXml(files, rels.notes);
      const paras: string[] = [];
      for (const sp of nd ? [...nd.getElementsByTagNameNS(P, "sp")] : []) {
        if (sp.getElementsByTagNameNS(P, "ph")[0]?.getAttribute("type") !== "body") continue;
        for (const p of [...sp.getElementsByTagNameNS(A, "p")]) paras.push(paraText(p));
      }
      const notes = paras.join("\n").trim();
      if (notes) slide.notes = notes;
    }
    // 沒有標題版面配置區（例如程式產生的簡報）：第一段當標題，但只有一段時留在內文
    if (!slide.title && slide.body.length > 1) {
      slide.title = slide.body.shift()!;
      slide.bullet!.shift();
    }
    return slide;
  });
}
