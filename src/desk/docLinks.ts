/**
 * 連到 Dock 文件的連結：`[[檔案名稱/文件標題]]`。
 *
 * 跟頁面連結同一種寫法（CommonMark 照樣渲染成文字，不加 markdown-it 規則）；
 * 顯示時 `pageRef.ts` 的 `linkPagesIn` 用 `docLinkOf` 認出它，加上 `dock-ref` class；
 * 點了（`openPage`）由 App 打開那個檔案的 Dock 並選取那份文件（`file` 畫面的 `doc`）。
 *
 * 同名的頁面優先：App 呼叫 `setDocLinks` 時已經拿掉和既有頁面同名的連結。
 * 名稱不分大小寫；同一個檔案裡標題相同的文件，連到第一份。
 * 這個檔案只用型別，不載入 Dock 的其他模組（編輯器也會用到它）。
 */
import type { DockKind } from "./file";
import { refsChanged } from "../drawer/citeRef";

export interface DocLink {
  /** 寫在 [[…]] 裡的名稱：`檔案/標題` */
  name: string;
  file: string;
  id: string;
  title: string;
  kind: DockKind;
}

const KINDS: DockKind[] = ["note", "word", "slides", "sheet", "draw"];

const LABEL: Record<DockKind, string> = { note: "Note", word: "Word", slides: "Slides", sheet: "Excel", draw: "Draw" };
export const docKindLabel = (k: DockKind) => LABEL[k];

/** 比對用的鍵（和 `pageKey` 一樣：去頭尾空白、連續空白算一個、不分大小寫）。 */
export const linkKey = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** 連結名稱：`檔案/標題`（標題裡的方括號、換行拿掉，否則寫不進 [[…]]）。 */
export function docLinkName(file: string, title: string): string {
  const clean = (s: string) => s.replace(/[[\]]/g, "").replace(/[\n\r]/g, " ").trim().replace(/\s+/g, " ");
  return `${clean(file)}/${clean(title)}`;
}

/** 一個檔案的 JSON → 它的 Dock 文件連結（只看 id、標題、種類，不解析內容）。 */
export function fileDocLinks(file: string, json: string): DocLink[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json || "{}");
  } catch {
    return [];
  }
  const docs = raw && typeof raw === "object" && Array.isArray((raw as { docs?: unknown }).docs) ? (raw as { docs: unknown[] }).docs : [];
  // 照 Dock 清單上的順序：資料夾（照資料夾的順序）裡的在前，不在資料夾裡的在後（同 `file.ts` 的 `dockOrder`）
  const folders = raw && typeof raw === "object" && Array.isArray((raw as { folders?: unknown }).folders) ? (raw as { folders: unknown[] }).folders : [];
  const rank = new Map<string, number>();
  folders.forEach((x, i) => {
    const id = x && typeof x === "object" ? (x as { id?: unknown }).id : undefined;
    if (typeof id === "string" && !rank.has(id)) rank.set(id, i);
  });
  const out: (DocLink & { rank: number })[] = [];
  for (const o of docs) {
    if (!o || typeof o !== "object") continue;
    const d = o as Record<string, unknown>;
    if (typeof d.id !== "string") continue;
    const title = typeof d.title === "string" && d.title.trim() ? d.title : "Untitled";
    // 舊的資料庫讀進來時變成試算表
    const kind: DockKind = d.kind === "database" ? "sheet" : KINDS.includes(d.kind as DockKind) ? (d.kind as DockKind) : "note";
    const rk = typeof d.folder === "string" ? rank.get(d.folder) : undefined;
    out.push({ name: docLinkName(file, title), file, id: d.id, title, kind, rank: rk ?? folders.length });
  }
  return out.sort((x, y) => x.rank - y.rank).map(({ rank: _r, ...l }) => l);
}

/** 所有檔案的 Dock 文件連結（檔案依名稱排序）。 */
export function collectDocLinks(files: Iterable<string>, contents: Record<string, string>): DocLink[] {
  return [...files].sort((a, b) => a.localeCompare(b)).flatMap((f) => fileDocLinks(f, contents[f] ?? ""));
}

/** 名稱 → 連結；同名的取第一個。 */
export function indexDocLinks(list: DocLink[]): Map<string, DocLink> {
  const m = new Map<string, DocLink>();
  for (const l of list) {
    const k = linkKey(l.name);
    if (!m.has(k)) m.set(k, l);
  }
  return m;
}

/** 依輸入篩選：整個名稱或文件標題開頭相符的排前面，再來是包含；最多 limit 個。 */
export function suggestDocLinks(query: string, list: DocLink[], limit = 6): DocLink[] {
  const q = linkKey(query);
  if (!q) return list.slice(0, limit);
  const starts: DocLink[] = [];
  const contains: DocLink[] = [];
  for (const l of list) {
    const k = linkKey(l.name);
    if (k.startsWith(q) || linkKey(l.title).startsWith(q)) starts.push(l);
    else if (k.includes(q)) contains.push(l);
  }
  return [...starts, ...contains].slice(0, limit);
}

/**
 * `[[` 的分級選單：
 * - 第一層：符合的頁面，接著 Desk 的檔案（有文件的才算；點了進到第二層），
 *   有打字時再加上標題符合的文件（直接選，不用進資料夾）。
 * - 第二層：打的字是「檔案名稱/」開頭（選了檔案就會寫成這樣）時，只列那個檔案的文件，
 *   用斜線後面的字篩選。
 */
export interface LinkMenu {
  /** 第二層時是檔案名稱 */
  folder: string | null;
  pages: string[];
  files: { file: string; count: number }[];
  docs: DocLink[];
}

export function linkMenu(query: string, pages: (q: string) => string[], list: DocLink[]): LinkMenu {
  const q = query.trim();
  const slash = q.lastIndexOf("/");
  if (slash >= 0) {
    const head = linkKey(q.slice(0, slash));
    const inFile = list.filter((l) => linkKey(l.file) === head);
    if (inFile.length) {
      const t = linkKey(q.slice(slash + 1));
      const starts = inFile.filter((l) => linkKey(l.title).startsWith(t));
      const contains = inFile.filter((l) => !linkKey(l.title).startsWith(t) && linkKey(l.title).includes(t));
      return { folder: inFile[0].file, pages: [], files: [], docs: [...starts, ...contains] };
    }
  }
  const k = linkKey(q);
  const counts = new Map<string, { file: string; count: number }>();
  for (const l of list) {
    const c = counts.get(l.file);
    if (c) c.count++;
    else counts.set(l.file, { file: l.file, count: 1 });
  }
  const all = [...counts.values()];
  const files = k
    ? [...all.filter((f) => linkKey(f.file).startsWith(k)), ...all.filter((f) => !linkKey(f.file).startsWith(k) && linkKey(f.file).includes(k))]
    : all;
  const docs = k ? suggestDocLinks(q, list).filter((l) => !linkKey(l.file).startsWith(k) || linkKey(l.title).startsWith(k)) : [];
  return { folder: null, pages: pages(q), files: files.slice(0, 6), docs };
}

// ─── App 設定的清單（編輯器顯示、自動完成、點連結用） ───

let links: DocLink[] = [];
let byName = new Map<string, DocLink>();
let stamp = "";

/** App 讀完 Desk 檔案後設定；連結的集合變了才通知編輯器重畫。 */
export function setDocLinks(list: DocLink[]): void {
  links = list;
  byName = indexDocLinks(list);
  const next = list.map((l) => `${l.name}\u0000${l.kind}`).join("\n");
  if (next !== stamp) {
    stamp = next;
    refsChanged();
  }
}

export const getDocLinks = () => links;

/** `[[…]]` 裡的名稱 → Dock 文件（不認得就是 undefined）。 */
export const docLinkOf = (name: string) => byName.get(linkKey(name));

/**
 * 改寫原始碼裡的 Dock 文件連結 `[[檔案/標題]]`：to(檔案, 標題) 回傳新的名稱就換掉，null 不動。
 * 程式碼區塊裡的不改；新名稱照編輯器的方式跳脫。沒有變就回傳原字串。
 */
export function rewriteDocLinks(source: string, to: (file: string, title: string) => string | null): string {
  if (!source.includes("[[")) return source;
  const esc = (s: string) => s.replace(/[\\`*_<]/g, "\\$&");
  let fence: string | null = null;
  let changed = false;
  const lines = source.split("\n").map((line) => {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (line.trim().startsWith(fence)) fence = null;
      return line;
    }
    if (fence || !line.includes("[[")) return line;
    return line.replace(/\[\[((?:\\.|[^[\]\n\\])+?)\]\]/g, (all, raw: string) => {
      const name = raw.replace(/\\([!-/:-@[-`{-~])/g, "$1").trim();
      const cut = name.lastIndexOf("/");
      if (cut < 0) return all;
      const next = to(name.slice(0, cut), name.slice(cut + 1));
      if (next === null || next === name) return all;
      changed = true;
      return `[[${esc(next)}]]`;
    });
  });
  return changed ? lines.join("\n") : source;
}

/** 標題比對用（和連結名稱一樣拿掉方括號、換行） */
const titleKey = (t: string) => linkKey(docLinkName("", t).slice(1));

/**
 * 檔案改名時改寫連到它文件的 `[[舊檔名/標題]]` → `[[新檔名/標題]]`。
 * 只改標題是這個檔案的文件的連結（同名的頁面連結不動）。
 */
export function renameFileInLinks(source: string, from: string, to: string, titles: string[]): string {
  const have = new Set(titles.map(titleKey));
  const fk = linkKey(from);
  return rewriteDocLinks(source, (file, title) => (linkKey(file) === fk && have.has(titleKey(title)) ? `${to}/${title}` : null));
}

/**
 * 一次修改裡改了標題的文件（只算連結會連到的：檔案裡第一份是這個標題的）。
 * 標題沒變或只差空白的不算；只差大小寫的算（連結跟著改寫法）。
 */
export function docRenames(before: { docs: { id: string; title: string }[] }, after: { docs: { id: string; title: string }[] }): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (const d of before.docs) {
    const n = after.docs.find((x) => x.id === d.id);
    if (!n || docLinkName("", n.title) === docLinkName("", d.title)) continue;
    const first = before.docs.find((x) => titleKey(x.title) === titleKey(d.title));
    if (first?.id === d.id) out.push({ from: d.title, to: n.title });
  }
  return out;
}

/** Dock 文件改名時改寫 `[[檔案/舊標題]]` → `[[檔案/新標題]]`（檔名照原本的寫法）。 */
export function renameDocInLinks(source: string, file: string, renames: { from: string; to: string }[]): string {
  if (!renames.length) return source;
  const fk = linkKey(file);
  return rewriteDocLinks(source, (f, title) => {
    if (linkKey(f) !== fk) return null;
    const r = renames.find((x) => titleKey(x.from) === titleKey(title));
    return r ? `${f}/${docLinkName("", r.to).slice(1)}` : null;
  });
}
