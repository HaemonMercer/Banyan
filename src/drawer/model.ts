import { cleanFiles, type FileEntry, type Folder } from "./files";

/**
 * Drawer（參考 Zotero）：文獻庫的純函式。
 *
 * 整個文獻庫是一份 JSON（`drawer/library.json`）：條目（書目資料、作者、標籤、所屬收藏、附件）
 * 與收藏（可以巢狀的資料夾）。條目的筆記是一般頁面 `@引用鍵`（`notePage`），
 * 在日記或頁面寫 `[[@引用鍵]]` 就是引用它，反向連結照常運作。
 * 附件存在 `media/`（和圖片相同，以內容雜湊命名），條目裡只記路徑。
 * 備註（`Remark`）是條目上的短筆記（摘錄、想法），可以記頁碼；別的地方寫 `[[@引用鍵#r1]]`
 * 引用它（文中引用帶頁碼），`![[@引用鍵#r1]]` 嵌入它的內容。
 */

export type ItemType =
  | "article"
  | "book"
  | "chapter"
  | "conference"
  | "thesis"
  | "report"
  | "webpage"
  | "other";

export const ITEM_TYPES: { type: ItemType; label: string }[] = [
  { type: "article", label: "Journal Article" },
  { type: "book", label: "Book" },
  { type: "chapter", label: "Book Section" },
  { type: "conference", label: "Conference Paper" },
  { type: "thesis", label: "Thesis" },
  { type: "report", label: "Report" },
  { type: "webpage", label: "Web Page" },
  { type: "other", label: "Document" },
];

export const typeLabel = (t: ItemType) => ITEM_TYPES.find((x) => x.type === t)?.label ?? "Document";

export type CreatorRole = "author" | "editor";

export interface Creator {
  family: string;
  given: string;
  role: CreatorRole;
}

export interface Attachment {
  id: string;
  /** 顯示名稱（原始檔名） */
  name: string;
  /** `media/檔名`、data URL（瀏覽器預覽）或網址 */
  src: string;
  kind: "file" | "link";
  added: number;
}

/** 條目上的備註：一段文字（Markdown），可以記頁碼；id（`r1`、`r2`…）在條目裡不重複、刪掉也不再使用。 */
export interface Remark {
  id: string;
  text: string;
  /** 頁碼或位置：`12`、`12-14`、`chap. 3`（引用時加在文中引用裡） */
  page: string;
  added: number;
  modified: number;
}

/** 依類型顯示的欄位（標題、作者另外處理）。 */
export type Field =
  | "date"
  | "container"
  | "publisher"
  | "place"
  | "volume"
  | "issue"
  | "pages"
  | "edition"
  | "doi"
  | "isbn"
  | "url"
  | "accessed"
  | "language";

export interface Item {
  id: string;
  type: ItemType;
  title: string;
  creators: Creator[];
  /** 出版日期：`2020`、`2020-05` 或 `2020-05-17` */
  date: string;
  /** 期刊、書名（書的章節）、會議名稱、網站名稱 */
  container: string;
  publisher: string;
  place: string;
  volume: string;
  issue: string;
  pages: string;
  edition: string;
  doi: string;
  isbn: string;
  url: string;
  /** 網頁的存取日期 */
  accessed: string;
  language: string;
  abstract: string;
  /** 引用鍵（BibTeX key、筆記頁面 `@引用鍵`） */
  key: string;
  tags: string[];
  collections: string[];
  attachments: Attachment[];
  remarks: Remark[];
  /** 最後用掉的備註編號（`r` 後面的數字），刪掉的編號不再使用，舊的引用才不會指到別的備註 */
  remarkSeq: number;
  added: number;
  modified: number;
  /** 在垃圾桶裡 */
  trashed?: boolean;
}

export interface Collection {
  id: string;
  name: string;
  parent: string | null;
}

export interface Library {
  items: Item[];
  collections: Collection[];
  /** 檔案庫（`files.ts`）：資料夾樹與檔案 */
  folders: Folder[];
  files: FileEntry[];
}

export const FIELD_LABELS: Record<Field, string> = {
  date: "Date",
  container: "Publication",
  publisher: "Publisher",
  place: "Place",
  volume: "Volume",
  issue: "Issue",
  pages: "Pages",
  edition: "Edition",
  doi: "DOI",
  isbn: "ISBN",
  url: "URL",
  accessed: "Accessed",
  language: "Language",
};

/** 各類型的欄位與「出處」欄的名稱。 */
export const TYPE_FIELDS: Record<ItemType, { fields: Field[]; container?: string }> = {
  article: { fields: ["container", "volume", "issue", "pages", "date", "doi", "url", "language"], container: "Journal" },
  book: { fields: ["edition", "place", "publisher", "date", "isbn", "doi", "url", "language"] },
  chapter: {
    fields: ["container", "edition", "place", "publisher", "pages", "date", "isbn", "doi", "url"],
    container: "Book Title",
  },
  conference: {
    fields: ["container", "place", "publisher", "pages", "date", "doi", "url"],
    container: "Proceedings Title",
  },
  thesis: { fields: ["publisher", "place", "date", "url", "language"] },
  report: { fields: ["container", "issue", "publisher", "place", "pages", "date", "doi", "url"], container: "Series" },
  webpage: { fields: ["container", "date", "url", "accessed", "language"], container: "Website" },
  other: { fields: ["container", "publisher", "date", "doi", "url"], container: "Publication" },
};

/** 欄位在某個類型下的名稱（論文的「publisher」叫 University…）。 */
export function fieldLabel(type: ItemType, f: Field): string {
  if (f === "container") return TYPE_FIELDS[type].container ?? FIELD_LABELS.container;
  if (f === "publisher" && type === "thesis") return "University";
  if (f === "publisher" && type === "report") return "Institution";
  if (f === "issue" && type === "report") return "Report Number";
  return FIELD_LABELS[f];
}

export const emptyLibrary = (): Library => ({ items: [], collections: [], folders: [], files: [] });

let seq = 0;
export function newId(prefix: string): string {
  seq = (seq + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const TYPES = new Set(ITEM_TYPES.map((t) => t.type));

export function blankItem(type: ItemType = "article", now = Date.now()): Item {
  return {
    id: newId("i"),
    type,
    title: "",
    creators: [],
    date: "",
    container: "",
    publisher: "",
    place: "",
    volume: "",
    issue: "",
    pages: "",
    edition: "",
    doi: "",
    isbn: "",
    url: "",
    accessed: "",
    language: "",
    abstract: "",
    key: "",
    tags: [],
    collections: [],
    attachments: [],
    remarks: [],
    remarkSeq: 0,
    added: now,
    modified: now,
  };
}

function cleanCreator(v: unknown): Creator | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  // 空的作者留著（剛按「Add creator」還沒打字），引用時才略過
  return { family: str(o.family), given: str(o.given), role: o.role === "editor" ? "editor" : "author" };
}

function cleanAttachment(v: unknown): Attachment | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const src = str(o.src);
  if (!src) return null;
  return {
    id: str(o.id) || newId("a"),
    name: str(o.name) || src.split("/").pop() || "Attachment",
    src,
    kind: o.kind === "link" ? "link" : "file",
    added: typeof o.added === "number" ? o.added : 0,
  };
}

function cleanRemark(v: unknown): Remark | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id).trim();
  if (!/^r\d+$/.test(id)) return null;
  const added = typeof o.added === "number" ? o.added : 0;
  return { id, text: str(o.text), page: str(o.page), added, modified: typeof o.modified === "number" ? o.modified : added };
}

const remarkNum = (id: string) => Number(id.slice(1)) || 0;

const uniq = (xs: string[]) => [...new Set(xs)];

/** 讀進來的條目補齊欄位（舊版本、手改過的檔案都不會讓畫面壞掉）。 */
export function cleanItem(v: unknown): Item | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const base = blankItem(TYPES.has(o.type as ItemType) ? (o.type as ItemType) : "other", 0);
  const out: Item = { ...base, id: str(o.id) || base.id };
  for (const k of [
    "title",
    "date",
    "container",
    "publisher",
    "place",
    "volume",
    "issue",
    "pages",
    "edition",
    "doi",
    "isbn",
    "url",
    "accessed",
    "language",
    "abstract",
    "key",
  ] as const) {
    out[k] = str(o[k]);
  }
  out.creators = Array.isArray(o.creators) ? o.creators.map(cleanCreator).filter((c): c is Creator => !!c) : [];
  out.tags = Array.isArray(o.tags) ? uniq(o.tags.map(str).map((t) => t.trim()).filter(Boolean)) : [];
  out.collections = Array.isArray(o.collections) ? uniq(o.collections.map(str).filter(Boolean)) : [];
  out.attachments = Array.isArray(o.attachments)
    ? o.attachments.map(cleanAttachment).filter((a): a is Attachment => !!a)
    : [];
  const seen = new Set<string>();
  out.remarks = Array.isArray(o.remarks)
    ? o.remarks.map(cleanRemark).filter((r): r is Remark => !!r && !seen.has(r.id) && !!seen.add(r.id))
    : [];
  out.remarkSeq = Math.max(typeof o.remarkSeq === "number" ? o.remarkSeq : 0, ...out.remarks.map((r) => remarkNum(r.id)));
  out.added = typeof o.added === "number" ? o.added : 0;
  out.modified = typeof o.modified === "number" ? o.modified : out.added;
  if (o.trashed === true) out.trashed = true;
  return out;
}

export function parseLibrary(json: string): Library {
  if (!json.trim()) return emptyLibrary();
  try {
    const v = JSON.parse(json);
    const collections: Collection[] = Array.isArray(v?.collections)
      ? v.collections
          .filter((c: unknown) => c && typeof c === "object")
          .map((c: Record<string, unknown>) => ({
            id: str(c.id) || newId("c"),
            name: str(c.name) || "Untitled",
            parent: str(c.parent) || null,
          }))
      : [];
    const ids = new Set(collections.map((c) => c.id));
    for (const c of collections) if (c.parent && (!ids.has(c.parent) || c.parent === c.id)) c.parent = null;
    const items: Item[] = Array.isArray(v?.items) ? v.items.map(cleanItem).filter((i: Item | null): i is Item => !!i) : [];
    for (const it of items) it.collections = it.collections.filter((c) => ids.has(c));
    return { items, collections, ...cleanFiles(v?.folders, v?.files) };
  } catch {
    return emptyLibrary();
  }
}

export function serializeLibrary(lib: Library): string {
  if (!lib.items.length && !lib.collections.length && !lib.folders.length && !lib.files.length) return "";
  return JSON.stringify({ version: 1, ...lib }, null, 1);
}

/* ─── 作者 ─── */

/** 「Smith, John」或「John Smith」→ 作者；中文名字（沒有空白、沒有逗號）整個當姓。 */
export function parseName(raw: string, role: CreatorRole = "author"): Creator | null {
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) return null;
  const comma = s.indexOf(",");
  if (comma >= 0) return { family: s.slice(0, comma).trim(), given: s.slice(comma + 1).trim(), role };
  const sp = s.lastIndexOf(" ");
  if (sp < 0) return { family: s, given: "", role };
  return { family: s.slice(sp + 1), given: s.slice(0, sp), role };
}

/** 「Smith, John; Lee, Ann」→ 作者清單（BibTeX 的 `and` 也可以）。 */
export function parseNames(raw: string, role: CreatorRole = "author"): Creator[] {
  return raw
    .split(/\s*;\s*|\s+and\s+/i)
    .map((s) => parseName(s, role))
    .filter((c): c is Creator => !!c);
}

export const fullName = (c: Creator) => (c.given ? `${c.family}, ${c.given}` : c.family);

/** 有名字的作者（沒有作者就用編者）。 */
export const named = (cs: Creator[]) => cs.filter((c) => c.family.trim() || c.given.trim());

const authorsOf = (it: Item) => {
  const cs = named(it.creators);
  const a = cs.filter((c) => c.role === "author");
  return a.length ? a : cs;
};

/** 清單上的作者欄：Smith、Smith and Lee、Smith et al. */
export function creatorSummary(it: Item): string {
  const a = authorsOf(it);
  if (!a.length) return "";
  if (a.length === 1) return a[0].family || a[0].given;
  if (a.length === 2) return `${a[0].family} and ${a[1].family}`;
  return `${a[0].family} et al.`;
}

/** 日期裡的年份（沒有就是空字串）。 */
export function yearOf(date: string): string {
  return /\b(\d{4})\b/.exec(date)?.[1] ?? "";
}

/* ─── 引用鍵 ─── */

const STOP = new Set(["a", "an", "the", "on", "of", "in", "for", "and", "to", "with", "from", "at", "by"]);

/** 去掉重音、只留英數字（中文字留著）。 */
function keyPart(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** 引用鍵：第一作者的姓＋年份＋標題第一個有意義的字，例如 `smith2020deep`；重複的加 a、b…。 */
export function makeKey(it: Item, taken: Iterable<string>): string {
  const a = authorsOf(it)[0];
  const who = keyPart(a?.family || a?.given || "").toLowerCase();
  const word = (it.title.match(/[\p{L}\p{N}]+/gu) ?? []).find((w) => !STOP.has(w.toLowerCase())) ?? "";
  const base = (who + yearOf(it.date) + keyPart(word).toLowerCase().slice(0, 20)) || "item";
  const used = new Set([...taken].map((k) => k.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 0; ; i++) {
    const suffix = i < 26 ? String.fromCharCode(97 + i) : String(i);
    if (!used.has((base + suffix).toLowerCase())) return base + suffix;
  }
}

/** 條目的筆記頁面名稱。 */
export const notePage = (it: Pick<Item, "key">) => `@${it.key}`;

/** 引用備註的名稱：`@引用鍵#r1`（寫成 `[[@引用鍵#r1]]`）。 */
export const remarkRef = (it: Pick<Item, "key">, r: Pick<Remark, "id">) => `@${it.key}#${r.id}`;

/** `@引用鍵` 或 `@引用鍵#r1` → 引用鍵與備註 id（不是引用就是 null）。 */
export function parseCiteName(name: string): { key: string; remark: string | null } | null {
  const m = /^@\s*([^\s#]+)(?:#(\S+))?\s*$/.exec(name);
  return m ? { key: m[1], remark: m[2] ?? null } : null;
}

/* ─── 條目 ─── */

const others = (lib: Library, id?: string) => lib.items.filter((i) => i.id !== id).map((i) => i.key);

/** 加入條目（沒有引用鍵就產生一個），新的放最前面。 */
export function addItems(lib: Library, items: Item[], now = Date.now()): Library {
  const keys = lib.items.map((i) => i.key);
  const added = items.map((it) => {
    const key = it.key.trim() && !keys.some((k) => k.toLowerCase() === it.key.trim().toLowerCase()) ? it.key.trim() : makeKey(it, keys);
    keys.push(key);
    return { ...it, key, added: it.added || now, modified: now };
  });
  return { ...lib, items: [...added, ...lib.items] };
}

/** 改一個條目；改了作者、年份、標題而引用鍵還是自動產生的樣子時，不動引用鍵（筆記頁面靠它連結）。 */
export function updateItem(lib: Library, id: string, patch: Partial<Item>, now = Date.now()): Library {
  return {
    ...lib,
    items: lib.items.map((i) => {
      if (i.id !== id) return i;
      const next = { ...i, ...patch, id, modified: now };
      if ("key" in patch) {
        const k = (patch.key ?? "").trim().replace(/[\s[\]#]+/g, "");
        next.key = k && !others(lib, id).some((o) => o.toLowerCase() === k.toLowerCase()) ? k : i.key;
      }
      if (patch.tags) next.tags = uniq(patch.tags.map((t) => t.trim()).filter(Boolean));
      return next;
    }),
  };
}

export function setTrashed(lib: Library, ids: Iterable<string>, trashed: boolean, now = Date.now()): Library {
  const set = new Set(ids);
  return {
    ...lib,
    items: lib.items.map((i) => {
      if (!set.has(i.id)) return i;
      const { trashed: _, ...rest } = i;
      return trashed ? { ...rest, trashed: true, modified: now } : { ...rest, modified: now };
    }),
  };
}

/** 永久刪除。 */
export function removeItems(lib: Library, ids: Iterable<string>): Library {
  const set = new Set(ids);
  return { ...lib, items: lib.items.filter((i) => !set.has(i.id)) };
}

export const emptyTrash = (lib: Library): Library => ({ ...lib, items: lib.items.filter((i) => !i.trashed) });

/** 拿到相同 DOI、ISBN 或（標題＋年份）的既有條目（加入前檢查重複）。 */
export function findDuplicate(lib: Library, it: Item): Item | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return lib.items.find(
    (o) =>
      !o.trashed &&
      ((it.doi && o.doi && it.doi.toLowerCase() === o.doi.toLowerCase()) ||
        (it.isbn && o.isbn && norm(it.isbn) === norm(o.isbn)) ||
        (it.title && norm(o.title) === norm(it.title) && yearOf(o.date) === yearOf(it.date))),
  );
}

export function addAttachment(lib: Library, id: string, att: Omit<Attachment, "id" | "added">, now = Date.now()): Library {
  const it = lib.items.find((i) => i.id === id);
  if (!it) return lib;
  return updateItem(lib, id, { attachments: [...it.attachments, { ...att, id: newId("a"), added: now }] }, now);
}

export function removeAttachment(lib: Library, id: string, attId: string, now = Date.now()): Library {
  const it = lib.items.find((i) => i.id === id);
  if (!it) return lib;
  return updateItem(lib, id, { attachments: it.attachments.filter((a) => a.id !== attId) }, now);
}

/* ─── 備註 ─── */

/** 在條目最後加一個備註；回傳新備註的 id（找不到條目時是空字串）。 */
export function addRemark(lib: Library, id: string, init: Partial<Pick<Remark, "text" | "page">> = {}, now = Date.now()): { lib: Library; id: string } {
  const it = lib.items.find((i) => i.id === id);
  if (!it) return { lib, id: "" };
  const seq = it.remarkSeq + 1;
  const r: Remark = { id: `r${seq}`, text: init.text ?? "", page: init.page ?? "", added: now, modified: now };
  return { lib: updateItem(lib, id, { remarks: [...it.remarks, r], remarkSeq: seq }, now), id: r.id };
}

export function updateRemark(lib: Library, id: string, remark: string, patch: Partial<Pick<Remark, "text" | "page">>, now = Date.now()): Library {
  const it = lib.items.find((i) => i.id === id);
  if (!it || !it.remarks.some((r) => r.id === remark)) return lib;
  return updateItem(lib, id, { remarks: it.remarks.map((r) => (r.id === remark ? { ...r, ...patch, modified: now } : r)) }, now);
}

/** 刪掉備註（編號不再使用，引用它的地方改成只引用條目）。 */
export function removeRemark(lib: Library, id: string, remark: string, now = Date.now()): Library {
  const it = lib.items.find((i) => i.id === id);
  if (!it) return lib;
  return updateItem(lib, id, { remarks: it.remarks.filter((r) => r.id !== remark) }, now);
}

/** 把備註往前（-1）或往後（+1）搬一格。 */
export function moveRemark(lib: Library, id: string, remark: string, dir: -1 | 1, now = Date.now()): Library {
  const it = lib.items.find((i) => i.id === id);
  const at = it ? it.remarks.findIndex((r) => r.id === remark) : -1;
  if (!it || at < 0 || at + dir < 0 || at + dir >= it.remarks.length) return lib;
  const rs = [...it.remarks];
  [rs[at], rs[at + dir]] = [rs[at + dir], rs[at]];
  return updateItem(lib, id, { remarks: rs }, now);
}

/* ─── 收藏 ─── */

export function addCollection(lib: Library, name: string, parent: string | null = null): { lib: Library; id: string } {
  const id = newId("c");
  return { lib: { ...lib, collections: [...lib.collections, { id, name: name.trim() || "Untitled", parent }] }, id };
}

export function renameCollection(lib: Library, id: string, name: string): Library {
  const n = name.trim();
  if (!n) return lib;
  return { ...lib, collections: lib.collections.map((c) => (c.id === id ? { ...c, name: n } : c)) };
}

/** 收藏和它底下所有子收藏的 id。 */
export function descendants(lib: Library, id: string): Set<string> {
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of lib.collections) {
      if (c.parent && out.has(c.parent) && !out.has(c.id)) {
        out.add(c.id);
        grew = true;
      }
    }
  }
  return out;
}

/** 刪除收藏（連同子收藏）；條目留在文獻庫，只是不再屬於它們。 */
export function removeCollection(lib: Library, id: string): Library {
  const gone = descendants(lib, id);
  return {
    ...lib,
    collections: lib.collections.filter((c) => !gone.has(c.id)),
    items: lib.items.map((i) =>
      i.collections.some((c) => gone.has(c)) ? { ...i, collections: i.collections.filter((c) => !gone.has(c)) } : i,
    ),
  };
}

/** 把收藏搬到另一個收藏底下（null 是最上層）；不能搬進自己的子收藏。 */
export function moveCollection(lib: Library, id: string, parent: string | null): Library {
  if (parent && descendants(lib, id).has(parent)) return lib;
  return { ...lib, collections: lib.collections.map((c) => (c.id === id ? { ...c, parent } : c)) };
}

export function childCollections(lib: Library, parent: string | null): Collection[] {
  return lib.collections
    .filter((c) => c.parent === parent)
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant", { numeric: true }));
}

export function addToCollection(lib: Library, ids: Iterable<string>, coll: string, now = Date.now()): Library {
  const set = new Set(ids);
  return {
    ...lib,
    items: lib.items.map((i) =>
      set.has(i.id) && !i.collections.includes(coll) ? { ...i, collections: [...i.collections, coll], modified: now } : i,
    ),
  };
}

export function removeFromCollection(lib: Library, ids: Iterable<string>, coll: string, now = Date.now()): Library {
  const set = new Set(ids);
  return {
    ...lib,
    items: lib.items.map((i) =>
      set.has(i.id) && i.collections.includes(coll)
        ? { ...i, collections: i.collections.filter((c) => c !== coll), modified: now }
        : i,
    ),
  };
}

/* ─── 標籤 ─── */

/** 所有標籤與用到的條目數（垃圾桶不算），依名稱排。 */
export function allTags(lib: Library): { tag: string; count: number }[] {
  const m = new Map<string, number>();
  for (const i of lib.items) if (!i.trashed) for (const t of i.tags) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag, "zh-Hant"));
}

/** 改標籤名稱（改成已有的標籤就是合併）；空字串是刪掉標籤。 */
export function renameTag(lib: Library, from: string, to: string, now = Date.now()): Library {
  const t = to.trim();
  return {
    ...lib,
    items: lib.items.map((i) =>
      i.tags.includes(from)
        ? { ...i, tags: uniq(i.tags.flatMap((x) => (x === from ? (t ? [t] : []) : [x]))), modified: now }
        : i,
    ),
  };
}

/* ─── 篩選與排序 ─── */

/** 左欄選的範圍：全部、沒有收藏的、某個收藏（含子收藏）、垃圾桶。 */
export type Scope = { kind: "all" } | { kind: "unfiled" } | { kind: "trash" } | { kind: "collection"; id: string };

export function inScope(lib: Library, scope: Scope): (it: Item) => boolean {
  switch (scope.kind) {
    case "all":
      return (it) => !it.trashed;
    case "unfiled":
      return (it) => !it.trashed && !it.collections.length;
    case "trash":
      return (it) => !!it.trashed;
    case "collection": {
      const ids = descendants(lib, scope.id);
      return (it) => !it.trashed && it.collections.some((c) => ids.has(c));
    }
  }
}

/** 搜尋：每個字都要出現在標題、作者、年份、出處、標籤、引用鍵、DOI、摘要或備註裡（不分大小寫）。 */
export function matches(it: Item, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [
    it.title,
    it.creators.map((c) => `${c.given} ${c.family}`).join(" "),
    it.date,
    it.container,
    it.publisher,
    it.tags.join(" "),
    it.key,
    it.doi,
    it.isbn,
    it.abstract,
    ...it.remarks.map((r) => r.text),
  ]
    .join("\n")
    .toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function filterItems(lib: Library, scope: Scope, query: string, tags: string[]): Item[] {
  const ok = inScope(lib, scope);
  return lib.items.filter((it) => ok(it) && tags.every((t) => it.tags.includes(t)) && matches(it, query));
}

export type SortKey = "title" | "creator" | "year" | "added" | "type";

export function sortItems(items: Item[], key: SortKey, desc: boolean): Item[] {
  const coll = (a: string, b: string) => a.localeCompare(b, "zh-Hant", { numeric: true, sensitivity: "base" });
  const val = (it: Item): string =>
    key === "title" ? it.title : key === "creator" ? creatorSummary(it) : key === "year" ? it.date : key === "type" ? typeLabel(it.type) : "";
  return [...items].sort((a, b) => {
    if (key === "added") return desc ? b.added - a.added : a.added - b.added;
    const va = val(a);
    const vb = val(b);
    // 空的排最後（不論方向）
    if (!va !== !vb) return !va ? 1 : -1;
    const r = coll(va, vb);
    return desc ? -r : r;
  });
}

/** 每個收藏（含子收藏）裡有幾個條目。 */
export function collectionCounts(lib: Library): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of lib.collections) out.set(c.id, filterItems(lib, { kind: "collection", id: c.id }, "", []).length);
  return out;
}
