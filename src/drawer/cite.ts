/**
 * 引用格式與書目交換格式：
 * - APA 第 7 版、MLA 第 9 版的參考文獻與文中引用
 * - BibTeX 匯出、匯入
 * - CSL-JSON 匯入（DOI 查詢、Zotero 等軟體匯出的 .json）
 */

import { blankItem, named, parseName, yearOf, type Creator, type Item, type ItemType } from "./model";

export type Style = "apa" | "mla";

export const STYLES: { style: Style; label: string }[] = [
  { style: "apa", label: "APA 7th" },
  { style: "mla", label: "MLA 9th" },
];

/** 一段文字；italic 的部分在 HTML 是 <i>、在 Markdown 是 *…*。 */
export type Part = { text: string; italic?: boolean };

const authorsOf = (it: Item) => named(it.creators).filter((c) => c.role === "author");
const editorsOf = (it: Item) => named(it.creators).filter((c) => c.role === "editor");

/** 名字縮寫：「John Ronald」→「J. R.」，「Jean-Paul」→「J.-P.」。 */
export function initials(given: string): string {
  return given
    .split(/\s+/)
    .filter(Boolean)
    .map((w) =>
      w
        .split("-")
        .map((p) => (p ? `${[...p][0].toUpperCase()}.` : ""))
        .join("-"),
    )
    .join(" ");
}

const isCjk = (s: string) => /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(s);

function apaName(c: Creator): string {
  if (isCjk(c.family + c.given)) return c.family + c.given;
  return c.given ? `${c.family}, ${initials(c.given)}` : c.family;
}

function joinList(names: string[], amp: string): string {
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return `${names[0]} ${amp} ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, ${amp} ${names[names.length - 1]}`;
}

function apaAuthors(cs: Creator[]): string {
  const names = cs.map(apaName);
  if (names.length > 20) return `${names.slice(0, 19).join(", ")}, … ${names[names.length - 1]}`;
  if (names.length === 2) return `${names[0]}, & ${names[1]}`;
  return joinList(names, "&");
}

const end = (s: string) => (/[.?!]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
const doiUrl = (doi: string) => `https://doi.org/${doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")}`;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function apaDate(it: Item): string {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/.exec(it.date.trim());
  if (!m) return "n.d.";
  if (it.type === "webpage" && m[2]) return `${m[1]}, ${MONTHS[+m[2] - 1]}${m[3] ? ` ${+m[3]}` : ""}`;
  return m[1];
}

function apaParts(it: Item): Part[] {
  const out: Part[] = [];
  const authors = authorsOf(it);
  const editors = editorsOf(it);
  const title = it.title.trim() || "Untitled";
  const date = `(${apaDate(it)}).`;
  const link = it.doi ? doiUrl(it.doi) : it.url;
  let lead: string;
  if (authors.length) lead = end(apaAuthors(authors));
  else if (editors.length && it.type === "book") lead = `${apaAuthors(editors)} (${editors.length > 1 ? "Eds." : "Ed."}).`;
  else lead = "";

  // 沒有作者：標題放在最前面
  const head = (titleParts: Part[]) => {
    if (lead) out.push({ text: `${lead} ${date} ` }, ...titleParts);
    else out.push(...titleParts, { text: ` ${date}` });
  };

  switch (it.type) {
    case "article": {
      head([{ text: end(title) }]);
      if (it.container) {
        out.push({ text: " " }, { text: it.container, italic: true });
        if (it.volume) out.push({ text: ", " }, { text: it.volume, italic: true });
        if (it.issue) out.push({ text: `(${it.issue})` });
        if (it.pages) out.push({ text: `, ${it.pages.replace(/--?/, "–")}` });
        out.push({ text: "." });
      }
      break;
    }
    case "chapter": {
      head([{ text: end(title) }]);
      const eds = editors.map((e) => (e.given ? `${initials(e.given)} ${e.family}` : e.family));
      out.push({ text: " In " });
      if (eds.length) out.push({ text: `${joinList(eds, "&")} (${eds.length > 1 ? "Eds." : "Ed."}), ` });
      out.push({ text: it.container || "Untitled", italic: true });
      const extra = [it.edition && `${it.edition} ed.`, it.pages && `pp. ${it.pages.replace(/--?/, "–")}`].filter(Boolean);
      if (extra.length) out.push({ text: ` (${extra.join(", ")})` });
      out.push({ text: "." });
      if (it.publisher) out.push({ text: ` ${end(it.publisher)}` });
      break;
    }
    case "book":
    case "report":
    case "thesis": {
      const tail =
        it.type === "book" && it.edition
          ? ` (${it.edition} ed.)`
          : it.type === "report" && it.issue
            ? ` (Report No. ${it.issue})`
            : it.type === "thesis"
              ? " [Thesis]"
              : "";
      head([{ text: title, italic: true }, { text: `${tail}.` }]);
      if (it.publisher) out.push({ text: ` ${end(it.publisher)}` });
      break;
    }
    case "conference": {
      head([{ text: end(title) }]);
      if (it.container) out.push({ text: " In " }, { text: it.container, italic: true }, { text: it.pages ? ` (pp. ${it.pages.replace(/--?/, "–")}).` : "." });
      if (it.publisher) out.push({ text: ` ${end(it.publisher)}` });
      break;
    }
    case "webpage": {
      head([{ text: title, italic: true }, { text: "." }]);
      if (it.container && it.container !== lead.replace(/\.$/, "")) out.push({ text: ` ${end(it.container)}` });
      break;
    }
    default: {
      head([{ text: title, italic: true }, { text: "." }]);
      if (it.container) out.push({ text: ` ${end(it.container)}` });
      if (it.publisher) out.push({ text: ` ${end(it.publisher)}` });
    }
  }
  if (link) out.push({ text: ` ${link}` });
  return merge(out);
}

function mlaName(c: Creator, first: boolean): string {
  if (isCjk(c.family + c.given)) return c.family + c.given;
  if (!c.given) return c.family;
  return first ? `${c.family}, ${c.given}` : `${c.given} ${c.family}`;
}

function mlaParts(it: Item): Part[] {
  const out: Part[] = [];
  const a = authorsOf(it);
  if (a.length === 1) out.push({ text: `${end(mlaName(a[0], true))} ` });
  else if (a.length === 2) out.push({ text: `${mlaName(a[0], true)}, and ${end(mlaName(a[1], false))} ` });
  else if (a.length > 2) out.push({ text: `${mlaName(a[0], true)}, et al. ` });
  const title = it.title.trim() || "Untitled";
  const standalone = it.type === "book" || it.type === "report" || it.type === "thesis" || it.type === "other" || it.type === "webpage";
  if (standalone && it.type !== "webpage") out.push({ text: title, italic: true }, { text: ". " });
  else out.push({ text: `“${end(title)}” ` });
  const bits: Part[][] = [];
  if (it.container) bits.push([{ text: it.container, italic: true }]);
  const eds = editorsOf(it);
  if (eds.length && it.type === "chapter") bits.push([{ text: `edited by ${eds.map((e) => mlaName(e, false)).join(" and ")}` }]);
  if (it.volume) bits.push([{ text: `vol. ${it.volume}` }]);
  if (it.issue) bits.push([{ text: `no. ${it.issue}` }]);
  if (it.publisher && it.type !== "article") bits.push([{ text: it.publisher }]);
  const y = yearOf(it.date);
  if (y) bits.push([{ text: y }]);
  if (it.pages) bits.push([{ text: `${/[-–]/.test(it.pages) ? "pp." : "p."} ${it.pages.replace(/--?/, "–")}` }]);
  const link = it.doi ? doiUrl(it.doi) : it.url.replace(/^https?:\/\//, "");
  if (link) bits.push([{ text: link }]);
  bits.forEach((b, i) => {
    out.push(...b);
    out.push({ text: i === bits.length - 1 ? "." : ", " });
  });
  return merge(out.length && out[out.length - 1].text.endsWith(" ") ? trimLast(out) : out);
}

function trimLast(ps: Part[]): Part[] {
  const out = [...ps];
  const last = out[out.length - 1];
  out[out.length - 1] = { ...last, text: last.text.trimEnd() };
  return out;
}

/** 相鄰同樣式的段落合併、去掉重複的句點。 */
function merge(ps: Part[]): Part[] {
  const out: Part[] = [];
  for (const p of ps) {
    if (!p.text) continue;
    const last = out[out.length - 1];
    if (last && !!last.italic === !!p.italic) last.text += p.text;
    else out.push({ ...p });
  }
  for (const p of out) p.text = p.text.replace(/\.\.(?!\.)/g, ".").replace(/\s{2,}/g, " ");
  return out;
}

/** 參考文獻的一筆。 */
export function reference(it: Item, style: Style): Part[] {
  return style === "mla" ? mlaParts(it) : apaParts(it);
}

/**
 * 文中引用的頁碼：APA `p. 12`／`pp. 12–14`、MLA `12`／`12–14`；
 * 不是數字（`chap. 3`、`fig. 2`）就照寫。
 */
export function locatorText(page: string, style: Style): string {
  const p = page.trim();
  if (!p) return "";
  const range = /^(\w*\d\w*)\s*[-–—]+\s*(\w*\d\w*)$/.exec(p);
  if (range) return `${style === "apa" ? "pp. " : ""}${range[1]}–${range[2]}`;
  if (/^\w*\d\w*$/.test(p)) return `${style === "apa" ? "p. " : ""}${p}`;
  return p;
}

/** 文中引用：APA (Smith & Lee, 2020)、MLA (Smith and Lee)；有頁碼時 APA (Smith, 2020, p. 12)、MLA (Smith 12)。 */
export function inText(it: Item, style: Style, page = ""): string {
  const loc = locatorText(page, style);
  const a = authorsOf(it).length ? authorsOf(it) : editorsOf(it);
  const fam = (c: Creator) => c.family || c.given;
  let who: string;
  if (!a.length) who = `“${it.title.trim() || "Untitled"}”`;
  else if (a.length === 1) who = fam(a[0]);
  else if (a.length === 2) who = `${fam(a[0])} ${style === "apa" ? "&" : "and"} ${fam(a[1])}`;
  else who = `${fam(a[0])} et al.`;
  if (style === "mla") return `(${who}${loc ? ` ${loc}` : ""})`;
  return `(${who}, ${yearOf(it.date) || "n.d."}${loc ? `, ${loc}` : ""})`;
}

/** 排序後的參考文獻清單（依第一作者、年份、標題）。 */
export function bibliography(items: Item[], style: Style): Part[][] {
  const sortKey = (it: Item) =>
    `${(authorsOf(it)[0]?.family ?? it.title).toLowerCase()}\u0000${yearOf(it.date)}\u0000${it.title.toLowerCase()}`;
  return [...items].sort((a, b) => sortKey(a).localeCompare(sortKey(b), "zh-Hant")).map((it) => reference(it, style));
}

export const toText = (ps: Part[]) => ps.map((p) => p.text).join("");

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const toHtml = (ps: Part[]) => ps.map((p) => (p.italic ? `<i>${escHtml(p.text)}</i>` : escHtml(p.text))).join("");

const escMd = (s: string) => s.replace(/([\\`*_[\]<>#])/g, "\\$1");
/** 貼進編輯器的 Markdown（斜體是 `*…*`）。 */
export const toMarkdown = (ps: Part[]) =>
  ps
    .map((p) => {
      if (!p.italic) return escMd(p.text);
      const m = /^(\s*)(.*?)(\s*)$/s.exec(p.text)!;
      return m[2] ? `${m[1]}*${escMd(m[2])}*${m[3]}` : p.text;
    })
    .join("");

/* ─── BibTeX ─── */

const BIB_TYPE: Record<ItemType, string> = {
  article: "article",
  book: "book",
  chapter: "incollection",
  conference: "inproceedings",
  thesis: "phdthesis",
  report: "techreport",
  webpage: "misc",
  other: "misc",
};

const bibEsc = (s: string) => s.replace(/([&%$#_])/g, "\\$1").replace(/[{}]/g, "");

function bibName(c: Creator): string {
  return c.given ? `${c.family}, ${c.given}` : `{${c.family}}`;
}

export function toBibtex(items: Item[]): string {
  return items
    .map((it) => {
      const f: [string, string][] = [];
      const add = (k: string, v: string, raw = false) => v.trim() && f.push([k, raw ? v.trim() : bibEsc(v.trim())]);
      add("title", it.title);
      add("author", authorsOf(it).map(bibName).join(" and "), true);
      add("editor", editorsOf(it).map(bibName).join(" and "), true);
      const container = it.type === "article" ? "journal" : it.type === "chapter" || it.type === "conference" ? "booktitle" : it.type === "report" ? "series" : it.type === "webpage" ? "howpublished" : "journal";
      add(container, it.container);
      add(it.type === "thesis" ? "school" : it.type === "report" ? "institution" : "publisher", it.publisher);
      add("address", it.place);
      add("volume", it.volume);
      add("number", it.issue);
      add("pages", it.pages.replace(/[–—]/g, "--").replace(/(\d)-(\d)/, "$1--$2"));
      add("edition", it.edition);
      add("year", yearOf(it.date));
      const month = /^\d{4}-(\d{2})/.exec(it.date)?.[1];
      if (month) f.push(["month", ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"][+month - 1] ?? month]);
      add("doi", it.doi, true);
      add("isbn", it.isbn, true);
      add("url", it.url, true);
      add("urldate", it.accessed, true);
      add("language", it.language);
      add("abstract", it.abstract);
      add("keywords", it.tags.join(", "));
      const body = f.map(([k, v]) => `  ${k} = {${v}}`).join(",\n");
      return `@${BIB_TYPE[it.type]}{${it.key || "item"},\n${body}\n}`;
    })
    .join("\n\n");
}

const FROM_BIB: Record<string, ItemType> = {
  article: "article",
  book: "book",
  booklet: "book",
  inbook: "chapter",
  incollection: "chapter",
  inproceedings: "conference",
  conference: "conference",
  phdthesis: "thesis",
  mastersthesis: "thesis",
  thesis: "thesis",
  techreport: "report",
  report: "report",
  online: "webpage",
  electronic: "webpage",
  www: "webpage",
};

const LATEX_ACCENTS: Record<string, string> = { "'": "\u0301", "`": "\u0300", "^": "\u0302", '"': "\u0308", "~": "\u0303", "=": "\u0304", ".": "\u0307", c: "\u0327", v: "\u030c", u: "\u0306", H: "\u030b" };

/** 簡單的 LaTeX → 文字：重音、跳脫字元、大括號。 */
export function delatex(s: string): string {
  return s
    .replace(/\{\\([`'^"~=.cvuH])\s*\{?(\w)\}?\}|\\([`'^"~=.])\{?(\w)\}?|\\([cvuH])\{(\w)\}/g, (_, a, b, c, d, e, f) => {
      const acc = a ?? c ?? e;
      const ch = b ?? d ?? f;
      return (ch + (LATEX_ACCENTS[acc] ?? "")).normalize("NFC");
    })
    .replace(/\\(ss|ae|oe|o|aa|l)\b\s?/gi, (_, x: string) => ({ ss: "ß", ae: "æ", oe: "œ", o: "ø", aa: "å", l: "ł" })[x.toLowerCase()] ?? x)
    .replace(/\\textendash\b\s?|--/g, "–")
    .replace(/\\([&%$#_{}])/g, "$1")
    .replace(/\\(?:emph|textit|textbf|textsc|mbox)\b/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 讀一個 BibTeX 值：`{…}`（可巢狀）、`"…"` 或數字／字串巨集，可以用 `#` 串接。 */
function readValue(src: string, i: number, macros: Record<string, string>): [string, number] {
  let out = "";
  for (;;) {
    while (/\s/.test(src[i] ?? "")) i++;
    if (src[i] === "{") {
      let depth = 0;
      const start = i + 1;
      for (; i < src.length; i++) {
        if (src[i] === "\\") {
          i++;
          continue;
        }
        if (src[i] === "{") depth++;
        else if (src[i] === "}" && --depth === 0) break;
      }
      out += src.slice(start, i);
      i++;
    } else if (src[i] === '"') {
      let depth = 0;
      const start = ++i;
      for (; i < src.length; i++) {
        if (src[i] === "\\") {
          i++;
          continue;
        }
        if (src[i] === "{") depth++;
        else if (src[i] === "}") depth--;
        else if (src[i] === '"' && depth === 0) break;
      }
      out += src.slice(start, i);
      i++;
    } else {
      const m = /^[\w:.-]+/.exec(src.slice(i));
      if (!m) break;
      out += macros[m[0].toLowerCase()] ?? m[0];
      i += m[0].length;
    }
    while (/\s/.test(src[i] ?? "")) i++;
    if (src[i] === "#") {
      i++;
      continue;
    }
    break;
  }
  return [out, i];
}

const MONTH_NUM: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

/** 解析 BibTeX（`@string` 巨集、`@comment`、`@preamble` 跳過）；讀不懂的條目略過。 */
export function parseBibtex(src: string): Item[] {
  const items: Item[] = [];
  const macros: Record<string, string> = {};
  const re = /@(\w+)\s*[{(]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const kind = m[1].toLowerCase();
    let i = re.lastIndex;
    if (kind === "comment" || kind === "preamble") continue;
    if (kind === "string") {
      const nm = /^\s*([\w:.-]+)\s*=/.exec(src.slice(i));
      if (nm) {
        const [v, j] = readValue(src, i + nm[0].length, macros);
        macros[nm[1].toLowerCase()] = v;
        re.lastIndex = j;
      }
      continue;
    }
    const keyM = /^\s*([^,\s]*)\s*,/.exec(src.slice(i));
    if (!keyM) continue;
    i += keyM[0].length;
    const fields: Record<string, string> = {};
    for (;;) {
      const fm = /^\s*([\w:.-]+)\s*=/.exec(src.slice(i));
      if (!fm) break;
      const [v, j] = readValue(src, i + fm[0].length, macros);
      fields[fm[1].toLowerCase()] = v;
      i = j;
      while (/[\s,]/.test(src[i] ?? "")) i++;
    }
    re.lastIndex = i;
    const it = blankItem(FROM_BIB[kind] ?? "other", 0);
    it.key = keyM[1];
    const g = (k: string) => delatex(fields[k] ?? "");
    it.title = g("title");
    const names = (k: string, role: "author" | "editor") =>
      (fields[k] ?? "")
        .split(/\s+and\s+/i)
        .map((n) => {
          const raw = n.trim();
          // {Organization Name} 整個當一個名字
          if (/^\{.*\}$/.test(raw)) return { family: delatex(raw), given: "", role };
          return parseName(delatex(raw), role);
        })
        .filter((c): c is Creator => !!c && !!(c.family || c.given));
    it.creators = [...names("author", "author"), ...names("editor", "editor")];
    it.container = g("journal") || g("journaltitle") || g("booktitle") || g("series") || g("howpublished");
    it.publisher = g("publisher") || g("school") || g("institution") || g("organization");
    it.place = g("address") || g("location");
    it.volume = g("volume");
    it.issue = g("number") || g("issue");
    it.pages = g("pages").replace(/\s*[-–]+\s*/g, "–");
    it.edition = g("edition");
    const date = g("date");
    const year = g("year");
    const month = MONTH_NUM[g("month").toLowerCase().slice(0, 3)] ?? (/^\d{1,2}$/.test(g("month")) ? g("month").padStart(2, "0") : "");
    it.date = /^\d{4}/.test(date) ? date : year ? (month ? `${year}-${month}` : year) : "";
    it.doi = (fields.doi ?? "").trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
    it.isbn = (fields.isbn ?? "").trim();
    it.url = (fields.url ?? "").trim();
    it.accessed = (fields.urldate ?? "").trim();
    it.language = g("language");
    it.abstract = g("abstract");
    it.tags = [...g("keywords").split(/\s*[,;]\s*/)].filter(Boolean);
    if (it.title || it.creators.length) items.push(it);
  }
  return items;
}

/* ─── CSL-JSON ─── */

const FROM_CSL: Record<string, ItemType> = {
  "article-journal": "article",
  article: "article",
  "article-magazine": "article",
  "article-newspaper": "article",
  "journal-article": "article",
  book: "book",
  monograph: "book",
  "edited-book": "book",
  chapter: "chapter",
  "book-chapter": "chapter",
  "paper-conference": "conference",
  "proceedings-article": "conference",
  thesis: "thesis",
  dissertation: "thesis",
  report: "report",
  webpage: "webpage",
  "post-weblog": "webpage",
  post: "webpage",
};

function cslDate(v: unknown): string {
  const parts = (v as { "date-parts"?: unknown[][] } | undefined)?.["date-parts"]?.[0];
  if (Array.isArray(parts) && parts.length && parts[0]) {
    return parts
      .slice(0, 3)
      .map((p, i) => (i === 0 ? String(p) : String(p).padStart(2, "0")))
      .join("-");
  }
  const raw = (v as { raw?: string } | undefined)?.raw;
  return typeof raw === "string" ? raw : "";
}

const first = (v: unknown) => (Array.isArray(v) ? String(v[0] ?? "") : typeof v === "string" || typeof v === "number" ? String(v) : "");

/** 去掉 Crossref 摘要的 JATS 標籤。 */
const stripTags = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** CSL-JSON 的一筆 → 條目。 */
export function fromCsl(o: Record<string, unknown>): Item {
  const it = blankItem(FROM_CSL[String(o.type ?? "")] ?? "other", 0);
  it.title = first(o.title).replace(/\s+/g, " ").trim();
  const sub = first(o.subtitle);
  if (sub && !it.title.includes(sub)) it.title += `: ${sub}`;
  const names = (k: string, role: "author" | "editor") =>
    Array.isArray(o[k])
      ? (o[k] as Record<string, unknown>[])
          .map((n): Creator => ({ family: String(n.family ?? n.literal ?? n.name ?? "").trim(), given: String(n.given ?? "").trim(), role }))
          .filter((c) => c.family || c.given)
      : [];
  it.creators = [...names("author", "author"), ...names("editor", "editor")];
  it.container = first(o["container-title"]) || first(o["collection-title"]);
  it.publisher = first(o.publisher);
  it.place = first(o["publisher-place"]);
  it.volume = first(o.volume);
  it.issue = first(o.issue) || first(o.number);
  it.pages = first(o.page).replace(/\s*[-–]+\s*/g, "–");
  it.edition = first(o.edition);
  it.date = cslDate(o.issued) || cslDate(o["published-print"]) || cslDate(o["published-online"]) || cslDate(o.created);
  it.doi = first(o.DOI);
  it.isbn = first(o.ISBN);
  it.url = first(o.URL);
  it.accessed = cslDate(o.accessed);
  it.language = first(o.language);
  it.abstract = stripTags(first(o.abstract));
  if (it.url && it.doi && /doi\.org\//i.test(it.url)) it.url = "";
  if (typeof o["citation-key"] === "string") it.key = o["citation-key"] as string;
  else if (typeof o.id === "string" && /^[\w:-]+$/.test(o.id) && !/^https?:/.test(o.id)) it.key = o.id;
  if (Array.isArray(o.keyword)) it.tags = o.keyword.map(String);
  else if (typeof o.keyword === "string") it.tags = o.keyword.split(/\s*[,;]\s*/).filter(Boolean);
  return it;
}

/** 讀一個匯入的檔案：BibTeX、CSL-JSON（陣列或單筆）。 */
export function parseImport(text: string): Item[] {
  const t = text.trim();
  if (t.startsWith("[") || t.startsWith("{")) {
    try {
      const v = JSON.parse(t);
      const list = Array.isArray(v) ? v : Array.isArray(v?.items) ? v.items : [v];
      return list.filter((o: unknown) => o && typeof o === "object").map(fromCsl).filter((i: Item) => i.title || i.creators.length);
    } catch {
      return [];
    }
  }
  return parseBibtex(t);
}

/** 新筆記頁面的內容：引用格式的參考文獻放在引言裡。 */
export function noteTemplate(it: Item): string {
  return `> ${toMarkdown(reference(it, "apa"))}

&nbsp;
`;
}
