/**
 * Drawer 的檔案庫：資料邏輯和文獻庫一樣（參考 Zotero）——資料夾像收藏，是一棵樹，
 * 檔案像條目，可以放在好幾個資料夾（`folders`，空的就是 Unfiled）、有標籤、刪除先進垃圾桶。
 * 和文獻庫存在同一份 `drawer/library.json`（`Library.folders`、`Library.files`）。
 * 檔案內容和附件一樣存在 `media/`，這裡只記名稱與位置。
 *
 * 重複偵測：`media/` 的檔名本來就是內容雜湊（Rust `media_name`），所以「同樣內容」＝同樣的雜湊；
 * 瀏覽器預覽的 data URL 用資料本身算雜湊。檔案庫的檔案與條目附件一起比對（`locate`、`duplicateGroups`）。
 */

import type { Attachment, Item, Library } from "./model";

export interface Folder {
  id: string;
  name: string;
  /** null 是最上層 */
  parent: string | null;
  added: number;
}

export interface FileEntry {
  id: string;
  /** 顯示名稱（含副檔名） */
  name: string;
  /** `media/檔名`、data URL（瀏覽器預覽） */
  src: string;
  /** 所在的資料夾（像條目的收藏，可以好幾個；空的是 Unfiled） */
  folders: string[];
  tags: string[];
  /** 在垃圾桶裡 */
  trashed?: boolean;
  /** 位元組數（不知道就是 0） */
  size: number;
  added: number;
  modified: number;
}

let seq = 0;
const newId = (prefix: string) => {
  seq = (seq + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
};
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : 0);
const uniq = (xs: string[]) => [...new Set(xs)];
const collate = (a: string, b: string) => a.localeCompare(b, "zh-Hant", { numeric: true, sensitivity: "base" });

/* ─── 讀檔 ─── */

/** 讀進來的資料夾與檔案補齊欄位；父資料夾不存在（或形成迴圈）就放回最上層；舊版的 `folder`（一個）變成 `folders`。 */
export function cleanFiles(foldersRaw: unknown, filesRaw: unknown): { folders: Folder[]; files: FileEntry[] } {
  const folders: Folder[] = Array.isArray(foldersRaw)
    ? foldersRaw
        .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
        .map((f) => ({ id: str(f.id) || newId("f"), name: str(f.name).trim() || "New folder", parent: str(f.parent) || null, added: num(f.added) }))
    : [];
  const ids = new Set(folders.map((f) => f.id));
  const byId = new Map(folders.map((f) => [f.id, f]));
  for (const f of folders) {
    if (f.parent && !ids.has(f.parent)) f.parent = null;
    // 迴圈（手改過的檔案）：從自己往上走回到自己就切斷
    const seen = new Set([f.id]);
    for (let p = f.parent; p; p = byId.get(p)?.parent ?? null) {
      if (seen.has(p)) {
        f.parent = null;
        break;
      }
      seen.add(p);
    }
  }
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const files: FileEntry[] = Array.isArray(filesRaw)
    ? filesRaw
        .filter((f): f is Record<string, unknown> => !!f && typeof f === "object" && !!str((f as Record<string, unknown>).src))
        .map((f) => {
          const added = num(f.added);
          const inFolders = Array.isArray(f.folders) ? strs(f.folders) : str(f.folder) ? [str(f.folder)] : [];
          return {
            id: str(f.id) || newId("F"),
            name: str(f.name).trim() || str(f.src).split("/").pop() || "File",
            src: str(f.src),
            folders: uniq(inFolders.filter((x) => ids.has(x))),
            tags: uniq(strs(f.tags).map((t) => t.trim()).filter(Boolean)),
            ...(f.trashed === true ? { trashed: true } : {}),
            size: num(f.size),
            added,
            modified: num(f.modified) || added,
          };
        })
    : [];
  return { folders, files };
}

/* ─── 名稱 ─── */

const splitExt = (name: string) => {
  const i = name.lastIndexOf(".");
  return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, ""];
};

/** Windows 不能用在檔名裡的字元換成底線，前後空白與結尾的點拿掉。 */
export function cleanName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().replace(/[. ]+$/, "");
}

/** 不重複的名稱：`報告.pdf` → `報告 (2).pdf`（和 Windows 一樣，不分大小寫）。 */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  const [stem0, ext] = splitExt(name);
  const stem = stem0.replace(/ \(\d+\)$/, "");
  for (let i = 2; ; i++) {
    const n = `${stem} (${i})${ext}`;
    if (!used.has(n.toLowerCase())) return n;
  }
}

/** 同一層的資料夾名稱（資料夾之間不重名；檔案像條目，名稱可以重複）。 */
const siblingNames = (lib: Library, parent: string | null, except?: string) =>
  lib.folders.filter((f) => f.parent === parent && f.id !== except).map((f) => f.name);

/* ─── 資料夾樹 ─── */

export function childFolders(lib: Library, parent: string | null): Folder[] {
  return lib.folders.filter((f) => f.parent === parent).sort((a, b) => collate(a.name, b.name));
}

/** 資料夾和它底下所有子資料夾的 id。 */
export function folderDescendants(lib: Library, id: string): Set<string> {
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of lib.folders) {
      if (f.parent && out.has(f.parent) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
    }
  }
  return out;
}

/** 從最上層到這個資料夾的路徑（麵包屑）；null 是空陣列。 */
export function folderPath(lib: Library, id: string | null): Folder[] {
  const byId = new Map(lib.folders.map((f) => [f.id, f]));
  const out: Folder[] = [];
  const seen = new Set<string>();
  for (let f = id ? byId.get(id) : undefined; f && !seen.has(f.id); f = f.parent ? byId.get(f.parent) : undefined) {
    seen.add(f.id);
    out.unshift(f);
  }
  return out;
}

/** 顯示用的位置：`研究 › 2026`；null 是 `My Files`（最上層）。 */
export function pathLabel(lib: Library, folder: string | null): string {
  const p = folderPath(lib, folder);
  return p.length ? p.map((f) => f.name).join(" › ") : "My Files";
}

/** 檔案在哪些資料夾：`研究 › 2026, 課程`；沒有資料夾是 `Unfiled`。 */
export function fileLocation(lib: Library, f: FileEntry): string {
  const known = f.folders.filter((id) => lib.folders.some((x) => x.id === id));
  return known.length ? known.map((id) => pathLabel(lib, id)).join(", ") : "Unfiled";
}

/* ─── 範圍、搜尋、排序（和文獻庫的 `Scope`、`filterItems`、`sortItems` 一樣） ─── */

/** 檔案庫頁左欄選的範圍：全部、沒有資料夾的、某個資料夾（含子資料夾）、垃圾桶。 */
export type FileScope = { kind: "all" } | { kind: "unfiled" } | { kind: "trash" } | { kind: "folder"; id: string };

export const fileScopeKey = (s: FileScope) => (s.kind === "folder" ? `f:${s.id}` : s.kind);

/** 記住的範圍讀回來（舊版記的是資料夾 id 或 `f:id`，空的是全部）。 */
export function fileScopeFrom(k: string | undefined, lib: Library): FileScope {
  if (k === "unfiled" || k === "trash" || k === "all") return { kind: k };
  const id = k?.startsWith("f:") ? k.slice(2) : k;
  return id && lib.folders.some((f) => f.id === id) ? { kind: "folder", id } : { kind: "all" };
}

export function inFileScope(lib: Library, scope: FileScope): (f: FileEntry) => boolean {
  switch (scope.kind) {
    case "all":
      return (f) => !f.trashed;
    case "unfiled":
      return (f) => !f.trashed && !f.folders.length;
    case "trash":
      return (f) => !!f.trashed;
    case "folder": {
      const ids = folderDescendants(lib, scope.id);
      return (f) => !f.trashed && f.folders.some((x) => ids.has(x));
    }
  }
}

/** 搜尋：每個字都要出現在名稱或標籤裡（不分大小寫）。 */
export function fileMatches(f: FileEntry, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${f.name}\n${f.tags.join(" ")}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function filterFiles(lib: Library, scope: FileScope, query: string, tags: string[]): FileEntry[] {
  const ok = inFileScope(lib, scope);
  return lib.files.filter((f) => ok(f) && tags.every((t) => f.tags.includes(t)) && fileMatches(f, query));
}

export type FileSortKey = "name" | "added" | "type" | "size";

export function sortFiles(files: FileEntry[], key: FileSortKey, desc: boolean): FileEntry[] {
  return [...files].sort((a, b) => {
    const r =
      key === "added" ? a.added - b.added : key === "size" ? a.size - b.size : key === "type" ? collate(typeName(a.name, a.src), typeName(b.name, b.src)) : 0;
    const v = r || collate(a.name, b.name);
    return desc ? -v : v;
  });
}

/** 每個資料夾（含子資料夾）裡有幾個檔案（垃圾桶不算）。 */
export function folderCounts(lib: Library): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of lib.folders) out.set(f.id, filterFiles(lib, { kind: "folder", id: f.id }, "", []).length);
  return out;
}

/* ─── 修改：資料夾 ─── */

export function addFolder(lib: Library, parent: string | null, name = "New folder", now = Date.now()): { lib: Library; id: string } {
  const id = newId("f");
  const n = uniqueName(cleanName(name) || "New folder", siblingNames(lib, parent));
  return { lib: { ...lib, folders: [...lib.folders, { id, name: n, parent, added: now }] }, id };
}

/** 把資料夾搬到另一個資料夾底下（null 是最上層）；不能搬進自己的子資料夾，撞名加 (2)。 */
export function moveFolder(lib: Library, id: string, parent: string | null): Library {
  const folder = lib.folders.find((f) => f.id === id);
  if (!folder || folder.parent === parent) return lib;
  if (parent && (!lib.folders.some((f) => f.id === parent) || folderDescendants(lib, id).has(parent))) return lib;
  const name = uniqueName(folder.name, siblingNames(lib, parent, id));
  return { ...lib, folders: lib.folders.map((f) => (f.id === id ? { ...f, parent, name } : f)) };
}

/** 刪除資料夾（連同子資料夾）；檔案留在檔案庫，只是不再屬於它們（和刪收藏一樣）。 */
export function removeFolder(lib: Library, id: string): Library {
  const gone = folderDescendants(lib, id);
  return {
    ...lib,
    folders: lib.folders.filter((f) => !gone.has(f.id)),
    files: lib.files.map((f) => (f.folders.some((x) => gone.has(x)) ? { ...f, folders: f.folders.filter((x) => !gone.has(x)) } : f)),
  };
}

/* ─── 修改：檔案 ─── */

/** 加入檔案（放進資料夾，null 是 Unfiled），回傳新的 id。 */
export function addFiles(
  lib: Library,
  folder: string | null,
  entries: { name: string; src: string; size?: number }[],
  now = Date.now(),
): { lib: Library; ids: string[] } {
  const into = folder && lib.folders.some((f) => f.id === folder) ? [folder] : [];
  const added: FileEntry[] = entries.map((e) => ({
    id: newId("F"),
    name: cleanName(e.name) || "File",
    src: e.src,
    folders: into,
    tags: [],
    size: e.size ?? 0,
    added: now,
    modified: now,
  }));
  return { lib: { ...lib, files: [...lib.files, ...added] }, ids: added.map((f) => f.id) };
}

/** 改名（檔案或資料夾）；空的不改，資料夾和同一層的撞名時加 (2)。 */
export function renameEntry(lib: Library, id: string, name: string, now = Date.now()): Library {
  const n = cleanName(name);
  if (!n) return lib;
  const folder = lib.folders.find((f) => f.id === id);
  if (folder) {
    const nm = uniqueName(n, siblingNames(lib, folder.parent, id));
    return { ...lib, folders: lib.folders.map((f) => (f.id === id ? { ...f, name: nm } : f)) };
  }
  return { ...lib, files: lib.files.map((f) => (f.id === id ? { ...f, name: n, modified: now } : f)) };
}

const mapFiles = (lib: Library, ids: Iterable<string>, fn: (f: FileEntry) => FileEntry): Library => {
  const set = new Set(ids);
  return { ...lib, files: lib.files.map((f) => (set.has(f.id) ? fn(f) : f)) };
};

/** 放進資料夾（原本的資料夾保留，像加進收藏）。 */
export function addToFolder(lib: Library, ids: Iterable<string>, folder: string, now = Date.now()): Library {
  if (!lib.folders.some((f) => f.id === folder)) return lib;
  return mapFiles(lib, ids, (f) => (f.folders.includes(folder) ? f : { ...f, folders: [...f.folders, folder], modified: now }));
}

export function removeFromFolder(lib: Library, ids: Iterable<string>, folder: string, now = Date.now()): Library {
  return mapFiles(lib, ids, (f) => (f.folders.includes(folder) ? { ...f, folders: f.folders.filter((x) => x !== folder), modified: now } : f));
}

/** 從一個資料夾搬到另一個（剪下貼上）：from 是 null 時只加進 to；to 是 null 時只從 from 拿掉。 */
export function moveFiles(lib: Library, ids: Iterable<string>, from: string | null, to: string | null, now = Date.now()): Library {
  if (from === to) return lib;
  const list = [...ids];
  let out = from ? removeFromFolder(lib, list, from, now) : lib;
  if (to) out = addToFolder(out, list, to, now);
  return out;
}

export function setFilesTrashed(lib: Library, ids: Iterable<string>, trashed: boolean, now = Date.now()): Library {
  return mapFiles(lib, ids, (f) => {
    if (!!f.trashed === trashed) return f;
    const { trashed: _t, ...rest } = f;
    return trashed ? { ...rest, trashed: true, modified: now } : { ...rest, modified: now };
  });
}

/**
 * 永久刪除紀錄，連同條目上連到它們的附件（附件就存在檔案庫，不然下次 `linkAttachments` 又會補回來）。
 * `media/` 裡的檔案留著（可能還有別的地方用到）。
 */
export function deleteFiles(lib: Library, ids: Iterable<string>, now = Date.now()): Library {
  const set = new Set(ids);
  if (!set.size) return lib;
  return {
    ...lib,
    files: lib.files.filter((f) => !set.has(f.id)),
    items: lib.items.map((i) =>
      i.attachments.some((a) => a.file && set.has(a.file)) ? { ...i, attachments: i.attachments.filter((a) => !(a.file && set.has(a.file))), modified: now } : i,
    ),
  };
}

export function emptyFileTrash(lib: Library): Library {
  return deleteFiles(
    lib,
    lib.files.filter((f) => f.trashed).map((f) => f.id),
  );
}

/* ─── 附件與檔案庫 ─── */

/** 連到這個檔案的條目附件（垃圾桶裡的條目也算）。 */
export function attachedTo(lib: Library, fileId: string): { item: Item; att: Attachment }[] {
  const out: { item: Item; att: Attachment }[] = [];
  for (const item of lib.items) for (const att of item.attachments) if (att.file === fileId) out.push({ item, att });
  return out;
}

/** 有沒有還沒連到檔案庫的檔案附件（舊資料、剛加的附件）。 */
export function hasUnlinked(lib: Library): boolean {
  const ids = new Set(lib.files.map((f) => f.id));
  return lib.items.some((i) => i.attachments.some((a) => a.kind === "file" && !(a.file && ids.has(a.file))));
}

/**
 * 每個檔案附件都存在檔案庫：還沒連的附件找同樣內容的檔案（`fingerprint`；在垃圾桶裡就拿出來），
 * 找不到就在 Unfiled 新增一筆（名稱與加入時間跟附件一樣）。沒有要改的就回傳原本的 lib。
 */
export function linkAttachments(lib: Library, now = Date.now()): Library {
  if (!hasUnlinked(lib)) return lib;
  const files = [...lib.files];
  const byId = new Map(files.map((f) => [f.id, f]));
  const byPrint = new Map<string, FileEntry>();
  // 同樣內容有好幾筆時：優先不在垃圾桶的、再來是最早的
  for (const f of [...files].sort((a, b) => Number(!!a.trashed) - Number(!!b.trashed) || a.added - b.added)) {
    const k = fingerprint(f.src);
    if (!byPrint.has(k)) byPrint.set(k, f);
  }
  const restore = new Set<string>();
  const items = lib.items.map((item) => {
    let changed = false;
    const attachments = item.attachments.map((a) => {
      if (a.kind !== "file" || (a.file && byId.has(a.file))) return a;
      changed = true;
      const k = fingerprint(a.src);
      let f = byPrint.get(k);
      if (!f) {
        f = { id: newId("F"), name: cleanName(a.name) || "File", src: a.src, folders: [], tags: [], size: 0, added: a.added || now, modified: now };
        files.push(f);
        byId.set(f.id, f);
        byPrint.set(k, f);
      } else if (f.trashed) restore.add(f.id);
      return { ...a, file: f.id };
    });
    return changed ? { ...item, attachments } : item;
  });
  const out = { ...lib, items, files };
  return restore.size ? setFilesTrashed(out, restore, false, now) : out;
}

/** 把檔案庫的檔案附加到條目（同一個條目已經有同樣內容的附件就不再加）；在垃圾桶裡就拿出來。 */
export function attachFile(lib: Library, itemId: string, fileId: string, now = Date.now()): Library {
  const f = lib.files.find((x) => x.id === fileId);
  const item = lib.items.find((i) => i.id === itemId);
  if (!f || !item) return lib;
  const k = fingerprint(f.src);
  if (item.attachments.some((a) => a.file === f.id || (a.kind === "file" && fingerprint(a.src) === k))) return f.trashed ? setFilesTrashed(lib, [f.id], false, now) : lib;
  const att: Attachment = { id: newId("a"), name: f.name, src: f.src, kind: "file", added: now, file: f.id };
  const out = { ...lib, items: lib.items.map((i) => (i.id === itemId ? { ...i, attachments: [...i.attachments, att], modified: now } : i)) };
  return f.trashed ? setFilesTrashed(out, [f.id], false, now) : out;
}

/* ─── 標籤（和條目的標籤分開算） ─── */

export function setFileTags(lib: Library, id: string, tags: string[], now = Date.now()): Library {
  return mapFiles(lib, [id], (f) => ({ ...f, tags: uniq(tags.map((t) => t.trim()).filter(Boolean)), modified: now }));
}

/** 檔案庫所有標籤與用到的檔案數（垃圾桶不算），依名稱排。 */
export function fileTags(lib: Library): { tag: string; count: number }[] {
  const m = new Map<string, number>();
  for (const f of lib.files) if (!f.trashed) for (const t of f.tags) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag, "zh-Hant"));
}

/** 改標籤名稱（改成已有的就是合併）；空字串是刪掉標籤。 */
export function renameFileTag(lib: Library, from: string, to: string, now = Date.now()): Library {
  const t = to.trim();
  return {
    ...lib,
    files: lib.files.map((f) => (f.tags.includes(from) ? { ...f, tags: uniq(f.tags.flatMap((x) => (x === from ? (t ? [t] : []) : [x]))), modified: now } : f)),
  };
}

/* ─── 重複內容 ─── */

/** FNV-1a 64 位元（data URL 用；結果是 16 個十六進位字元）。 */
function fnv64(s: string): string {
  let h = 0xcbf29ce484222325n;
  const p = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * p) & mask;
  }
  return h.toString(16).padStart(16, "0");
}

/**
 * 內容指紋：同樣的內容得到同樣的字串。`media/<雜湊>.<副檔名>` 取雜湊（副檔名不同也算同一份），
 * data URL 用資料本身（MIME 不同也算同一份），網址用網址本身。
 */
export function fingerprint(src: string): string {
  const m = /^media\/([0-9a-f]{16})\.\w+$/i.exec(src);
  if (m) return `m:${m[1].toLowerCase()}`;
  if (src.startsWith("data:")) return `d:${fnv64(src.slice(src.indexOf(",") + 1))}`;
  return `u:${src.trim().replace(/\/+$/, "").toLowerCase()}`;
}

/** 同一份內容出現的地方：檔案庫的檔案，或某個條目的附件。 */
export type Place =
  | { kind: "file"; file: FileEntry }
  | { kind: "attachment"; item: Item; att: Attachment };

export const placeName = (p: Place) => (p.kind === "file" ? p.file.name : p.att.name);
export const placeKey = (p: Place) => (p.kind === "file" ? `F:${p.file.id}` : `A:${p.item.id}:${p.att.id}`);

/** 顯示用的位置：`研究 › 2026`、`Unfiled` 或 `Attached to “標題”`。 */
export function placeLabel(lib: Library, p: Place): string {
  if (p.kind === "file") return `${fileLocation(lib, p.file)}${p.file.trashed ? " (in the Trash)" : ""}`;
  return `Attached to “${p.item.title || "Untitled"}”${p.item.trashed ? " (in the Trash)" : ""}`;
}

/**
 * 文獻庫裡所有放了檔案的地方（連結附件不算，同一個網址可以出現在很多條目）。
 * `copies`：只算各自存放的副本——連到檔案庫的附件就是那一筆檔案，不算另一份（重複偵測用）。
 */
export function allPlaces(lib: Library, copies = false): Place[] {
  const out: Place[] = lib.files.map((file) => ({ kind: "file", file }));
  const ids = copies ? new Set(lib.files.map((f) => f.id)) : null;
  for (const item of lib.items)
    for (const att of item.attachments) if (att.kind === "file" && !(ids && att.file && ids.has(att.file))) out.push({ kind: "attachment", item, att });
  return out;
}

/** 和這份內容相同的既有位置。 */
export function locate(lib: Library, src: string): Place[] {
  const fp = fingerprint(src);
  return allPlaces(lib).filter((p) => fingerprint(p.kind === "file" ? p.file.src : p.att.src) === fp);
}

/** 加入一批檔案前的檢查：每個檔案和文獻庫或同一批前面的檔案重複的話，記下已經在哪裡。 */
export function checkDuplicates<T extends { name: string; src: string }>(
  lib: Library,
  entries: T[],
): { entry: T; existing: Place[]; sameBatch: boolean }[] {
  const seen = new Map<string, T>();
  const out: { entry: T; existing: Place[]; sameBatch: boolean }[] = [];
  const places = allPlaces(lib, true);
  for (const e of entries) {
    const fp = fingerprint(e.src);
    const existing = places.filter((p) => fingerprint(p.kind === "file" ? p.file.src : p.att.src) === fp);
    if (existing.length || seen.has(fp)) out.push({ entry: e, existing, sameBatch: !existing.length });
    else seen.set(fp, e);
  }
  return out;
}

/** 整個文獻庫裡內容相同的群組（兩個以上），每組依加入時間排（最早的在前）。 */
export function duplicateGroups(lib: Library): Place[][] {
  const m = new Map<string, Place[]>();
  // 垃圾桶裡的檔案不算（移到垃圾桶就是處理掉了）；連到檔案庫的附件是同一筆
  for (const p of allPlaces(lib, true)) {
    if (p.kind === "file" && p.file.trashed) continue;
    const fp = fingerprint(p.kind === "file" ? p.file.src : p.att.src);
    const g = m.get(fp);
    if (g) g.push(p);
    else m.set(fp, [p]);
  }
  const when = (p: Place) => (p.kind === "file" ? p.file.added : p.att.added);
  return [...m.values()]
    .filter((g) => g.length > 1)
    .map((g) => [...g].sort((a, b) => when(a) - when(b)))
    .sort((a, b) => collate(placeName(a[0]), placeName(b[0])));
}

/** 一組重複裡要拿掉的檔案庫檔案：留下最早的一個（附件不動、垃圾桶裡的不算；組裡已經有附件就留最早的檔案）。 */
export function extraCopies(group: Place[]): FileEntry[] {
  const files = group.filter((p): p is Extract<Place, { kind: "file" }> => p.kind === "file" && !p.file.trashed).map((p) => p.file);
  return files.slice(1);
}

/** 拿掉一份（重複工具用）：檔案移到垃圾桶，附件從條目拿掉。 */
export function removePlace(lib: Library, p: Place, now = Date.now()): Library {
  if (p.kind === "file") return setFilesTrashed(lib, [p.file.id], true, now);
  return {
    ...lib,
    items: lib.items.map((i) => (i.id === p.item.id ? { ...i, attachments: i.attachments.filter((a) => a.id !== p.att.id), modified: now } : i)),
  };
}

/* ─── 顯示 ─── */

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

export type FileKind = "image" | "video" | "audio" | "pdf" | "text" | "sheet" | "slides" | "doc" | "archive" | "file";

export function fileKind(name: string, src = ""): FileKind {
  const e = extOf(name);
  if (/^(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/.test(e) || src.startsWith("data:image/")) return "image";
  if (/^(mp4|webm|ogv|mov|m4v|mkv|avi)$/.test(e) || src.startsWith("data:video/")) return "video";
  if (/^(mp3|wav|ogg|m4a|flac|aac)$/.test(e)) return "audio";
  if (e === "pdf" || src.startsWith("data:application/pdf")) return "pdf";
  if (/^(txt|md|markdown|json|xml|csv|tsv|html?|log|bib|ya?ml)$/.test(e)) return "text";
  if (/^(xlsx?|ods|numbers)$/.test(e)) return "sheet";
  if (/^(pptx?|odp|key)$/.test(e)) return "slides";
  if (/^(docx?|odt|rtf|pages)$/.test(e)) return "doc";
  if (/^(zip|rar|7z|tar|gz)$/.test(e)) return "archive";
  return "file";
}

const KIND_LABEL: Record<FileKind, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
  pdf: "PDF Document",
  text: "Text Document",
  sheet: "Spreadsheet",
  slides: "Presentation",
  doc: "Document",
  archive: "Archive",
  file: "File",
};

/** 「類型」欄：`PDF Document`、`PNG Image`…（和檔案總管一樣用副檔名）。 */
export function typeName(name: string, src = ""): string {
  const k = fileKind(name, src);
  const e = extOf(name).toUpperCase();
  if (k === "pdf" || !e) return KIND_LABEL[k];
  return `${e} ${k === "file" ? "File" : KIND_LABEL[k]}`;
}

export function formatSize(n: number): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}
