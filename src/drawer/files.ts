/**
 * Drawer 的檔案庫（參考 Windows 檔案總管）：資料夾樹＋檔案，和文獻庫存在同一份 `drawer/library.json`
 * （`Library.folders`、`Library.files`）。檔案內容和附件一樣存在 `media/`，這裡只記名稱與位置。
 *
 * 重複偵測：`media/` 的檔名本來就是內容雜湊（Rust `media_name`），所以「同樣內容」＝同樣的雜湊；
 * 瀏覽器預覽的 data URL 用資料本身算雜湊。檔案庫的檔案與條目附件一起比對（`locate`、`duplicateGroups`）。
 */

import type { Attachment, Item, Library } from "./model";

export interface Folder {
  id: string;
  name: string;
  /** null 是最上層（My Files） */
  parent: string | null;
  added: number;
}

export interface FileEntry {
  id: string;
  /** 顯示名稱（含副檔名），同一個資料夾裡不重複（不分大小寫） */
  name: string;
  /** `media/檔名`、data URL（瀏覽器預覽） */
  src: string;
  folder: string | null;
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
const collate = (a: string, b: string) => a.localeCompare(b, "zh-Hant", { numeric: true, sensitivity: "base" });

/* ─── 讀檔 ─── */

/** 讀進來的資料夾與檔案補齊欄位；父資料夾不存在（或形成迴圈）就放回最上層。 */
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
  const files: FileEntry[] = Array.isArray(filesRaw)
    ? filesRaw
        .filter((f): f is Record<string, unknown> => !!f && typeof f === "object" && !!str((f as Record<string, unknown>).src))
        .map((f) => {
          const folder = str(f.folder) || null;
          const added = num(f.added);
          return {
            id: str(f.id) || newId("F"),
            name: str(f.name).trim() || str(f.src).split("/").pop() || "File",
            src: str(f.src),
            folder: folder && ids.has(folder) ? folder : null,
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

/** 同一個資料夾裡不重複的名稱：`報告.pdf` → `報告 (2).pdf`（和 Windows 一樣）。 */
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

/** 某個資料夾裡已用的名稱（資料夾與檔案共用，和 Windows 一樣）。 */
function namesIn(lib: Library, folder: string | null, except?: string): string[] {
  return [
    ...lib.folders.filter((f) => f.parent === folder && f.id !== except).map((f) => f.name),
    ...lib.files.filter((f) => f.folder === folder && f.id !== except).map((f) => f.name),
  ];
}

/* ─── 查詢 ─── */

export function childFolders(lib: Library, parent: string | null): Folder[] {
  return lib.folders.filter((f) => f.parent === parent).sort((a, b) => collate(a.name, b.name));
}

export function filesIn(lib: Library, folder: string | null): FileEntry[] {
  return lib.files.filter((f) => f.folder === folder).sort((a, b) => collate(a.name, b.name));
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

/** 顯示用的位置：`My Files › 研究 › 2026`。 */
export function pathLabel(lib: Library, folder: string | null): string {
  return ["My Files", ...folderPath(lib, folder).map((f) => f.name)].join(" › ");
}

/** 資料夾（含子資料夾）裡的檔案數。 */
export function folderFileCount(lib: Library, id: string): number {
  const ids = folderDescendants(lib, id);
  return lib.files.filter((f) => f.folder && ids.has(f.folder)).length;
}

/** 在資料夾（含子資料夾；null 是整個檔案庫）裡找名稱含有每個字的檔案與資料夾。 */
export function searchFiles(lib: Library, folder: string | null, query: string): { folders: Folder[]; files: FileEntry[] } {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const within = folder ? folderDescendants(lib, folder) : null;
  const inside = (f: string | null) => (within ? !!f && within.has(f) : true);
  const ok = (name: string) => words.every((w) => name.toLowerCase().includes(w));
  return {
    folders: lib.folders.filter((f) => f.id !== folder && inside(f.parent) && ok(f.name)).sort((a, b) => collate(a.name, b.name)),
    files: lib.files.filter((f) => inside(f.folder) && ok(f.name)).sort((a, b) => collate(a.name, b.name)),
  };
}

/* ─── 修改 ─── */

export function addFolder(lib: Library, parent: string | null, name = "New folder", now = Date.now()): { lib: Library; id: string } {
  const id = newId("f");
  const n = uniqueName(cleanName(name) || "New folder", namesIn(lib, parent));
  return { lib: { ...lib, folders: [...lib.folders, { id, name: n, parent, added: now }] }, id };
}

/** 加入檔案（名稱重複就加 (2)、(3)…），回傳新的 id。 */
export function addFiles(
  lib: Library,
  folder: string | null,
  entries: { name: string; src: string; size?: number }[],
  now = Date.now(),
): { lib: Library; ids: string[] } {
  const taken = namesIn(lib, folder);
  const added: FileEntry[] = entries.map((e) => {
    const name = uniqueName(cleanName(e.name) || "File", taken);
    taken.push(name);
    return { id: newId("F"), name, src: e.src, folder, size: e.size ?? 0, added: now, modified: now };
  });
  return { lib: { ...lib, files: [...lib.files, ...added] }, ids: added.map((f) => f.id) };
}

/** 改名（檔案或資料夾）；空的或和同資料夾的其他東西撞名時加 (2)。 */
export function renameEntry(lib: Library, id: string, name: string, now = Date.now()): Library {
  const n = cleanName(name);
  if (!n) return lib;
  const folder = lib.folders.find((f) => f.id === id);
  if (folder) {
    const nm = uniqueName(n, namesIn(lib, folder.parent, id));
    return { ...lib, folders: lib.folders.map((f) => (f.id === id ? { ...f, name: nm } : f)) };
  }
  const file = lib.files.find((f) => f.id === id);
  if (!file) return lib;
  const nm = uniqueName(n, namesIn(lib, file.folder, id));
  return { ...lib, files: lib.files.map((f) => (f.id === id ? { ...f, name: nm, modified: now } : f)) };
}

/** 搬到另一個資料夾（null 是最上層）；資料夾不能搬進自己或自己的子資料夾，名稱重複就加 (2)。 */
export function moveEntries(lib: Library, ids: Iterable<string>, to: string | null, now = Date.now()): Library {
  const set = new Set(ids);
  if (to && !lib.folders.some((f) => f.id === to)) return lib;
  let out = lib;
  for (const id of set) {
    const folder = out.folders.find((f) => f.id === id);
    if (folder) {
      if (folder.parent === to || (to && folderDescendants(out, id).has(to))) continue;
      const name = uniqueName(folder.name, namesIn(out, to, id));
      out = { ...out, folders: out.folders.map((f) => (f.id === id ? { ...f, parent: to, name } : f)) };
      continue;
    }
    const file = out.files.find((f) => f.id === id);
    if (!file || file.folder === to) continue;
    const name = uniqueName(file.name, namesIn(out, to, id));
    out = { ...out, files: out.files.map((f) => (f.id === id ? { ...f, folder: to, name, modified: now } : f)) };
  }
  return out;
}

/** 刪除檔案與資料夾（資料夾連同裡面的東西）。`media/` 裡的檔案留著（可能還有別的地方用到）。 */
export function removeEntries(lib: Library, ids: Iterable<string>): Library {
  const set = new Set(ids);
  const gone = new Set<string>();
  for (const f of lib.folders) if (set.has(f.id)) for (const d of folderDescendants(lib, f.id)) gone.add(d);
  return {
    ...lib,
    folders: lib.folders.filter((f) => !gone.has(f.id)),
    files: lib.files.filter((f) => !set.has(f.id) && !(f.folder && gone.has(f.folder))),
  };
}

/** 要刪除的東西裡共有幾個檔案（確認對話框用）。 */
export function countRemoved(lib: Library, ids: Iterable<string>): { folders: number; files: number } {
  const set = new Set(ids);
  const gone = new Set<string>();
  for (const f of lib.folders) if (set.has(f.id)) for (const d of folderDescendants(lib, f.id)) gone.add(d);
  return { folders: gone.size, files: lib.files.filter((f) => set.has(f.id) || (f.folder && gone.has(f.folder))).length };
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

/** 顯示用的位置：`My Files › 研究` 或 `Attached to “標題”`。 */
export function placeLabel(lib: Library, p: Place): string {
  if (p.kind === "file") return pathLabel(lib, p.file.folder);
  return `Attached to “${p.item.title || "Untitled"}”${p.item.trashed ? " (in the Trash)" : ""}`;
}

/** 文獻庫裡所有放了檔案的地方（連結附件不算，同一個網址可以出現在很多條目）。 */
export function allPlaces(lib: Library): Place[] {
  const out: Place[] = lib.files.map((file) => ({ kind: "file", file }));
  for (const item of lib.items) for (const att of item.attachments) if (att.kind === "file") out.push({ kind: "attachment", item, att });
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
  for (const e of entries) {
    const fp = fingerprint(e.src);
    const existing = locate(lib, e.src);
    if (existing.length || seen.has(fp)) out.push({ entry: e, existing, sameBatch: !existing.length });
    else seen.set(fp, e);
  }
  return out;
}

/** 整個文獻庫裡內容相同的群組（兩個以上），每組依加入時間排（最早的在前）。 */
export function duplicateGroups(lib: Library): Place[][] {
  const m = new Map<string, Place[]>();
  for (const p of allPlaces(lib)) {
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

/** 一組重複裡要拿掉的檔案庫檔案：留下最早的一個（附件不動；組裡已經有附件就留最早的檔案）。 */
export function extraCopies(group: Place[]): FileEntry[] {
  const files = group.filter((p): p is Extract<Place, { kind: "file" }> => p.kind === "file").map((p) => p.file);
  return files.slice(1);
}

/** 拿掉某個附件（重複工具用）。 */
export function removePlace(lib: Library, p: Place, now = Date.now()): Library {
  if (p.kind === "file") return removeEntries(lib, [p.file.id]);
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
