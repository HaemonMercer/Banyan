import { cleanStyles, type SavedStyle } from "../editor/blockStyle";
import { cleanDeck, isDefaultDeck, type DeckSetup } from "./deckSetup";
import { cleanAnim, trimAnim, type SlideAnim } from "./slideAnim";
import { cleanLook, cleanPage, isDefaultLook, isDefaultPage, type NoteLook, type PageSetup } from "./pageSetup";
import { fromDatabase, newWorkbook, parseWorkbook, serializeWorkbook } from "../sheet/model";
import { boardData, emptyBoard, newId, parseBoard, type Board, type Card } from "./board";
import { appendDiagram, cardsToShapes, diagramData, diagramFrom, parseDiagram, serializeDiagram, starterDiagram } from "./draw";
import { tasksData, tasksFrom, type TaskBoard } from "./tasks";

/**
 * Desk 的一個檔案（File）＝一個專案，有三個部分：
 *
 * - **Whiteboard**：發想。把想法直接貼上去（便利貼、頁面、日記），不用管順序（`board.ts`）。
 * - **Dock**：整理。把想法整理成可以發表的文件，五種：
 *   一般筆記（`note`）、Word 文件（`word`，A4 分頁預覽、匯出 .docx）、
 *   簡報（`slides`，用單獨一行的 `---` 分張，匯出 .pptx）、試算表（`sheet`，介面叫 Excel，參考 Numbers，匯出 .xlsx）、
 *   圖表（`draw`，參考 draw.io，匯出 .png／.svg／.drawio）。
 *   前三種的內容是 Markdown；試算表與圖表在記憶體裡是 JSON 字串（`src/sheet/model.ts`、`draw.ts`），
 *   存檔時寫成 `sheet`／`draw` 物件（不是跳脫過的字串）。舊的資料庫文件（`database`，已經拿掉）讀進來時轉成試算表。
 *
 * 存成 App 資料夾的 `desk/名稱.json`。這裡都是純函式。
 */

export type DockKind = "note" | "word" | "slides" | "sheet" | "draw";

/** 內容是 JSON 的種類（不是 Markdown：不能嵌入、不改寫連結） */
export const isDataKind = (k: DockKind) => k === "sheet" || k === "draw";

export const DOCK_KINDS: { kind: DockKind; label: string; hint: string }[] = [
  { kind: "word", label: "Word document", hint: "A4 pages · export .docx" },
  { kind: "slides", label: "Slides", hint: "16:9 slides · export .pptx" },
  { kind: "sheet", label: "Excel spreadsheet", hint: "Tables, formulas, charts · export .xlsx" },
  { kind: "draw", label: "Draw", hint: "Flowcharts and diagrams · export .png" },
  { kind: "note", label: "Note", hint: "A plain page" },
];

export const kindLabel = (k: DockKind) =>
  k === "word" ? "Word" : k === "slides" ? "Slides" : k === "sheet" ? "Excel" : k === "draw" ? "Draw" : "Note";

export interface DockDoc {
  id: string;
  title: string;
  kind: DockKind;
  content: string;
  /** 簡報每張投影片的動畫（`slideAnim.ts`；沒有動畫就不寫） */
  anim?: SlideAnim[];
  /** Word 的版面設定（`pageSetup.ts`；沒改過就不寫） */
  page?: PageSetup;
  /** 筆記的文字大小與頁面顏色（`pageSetup.ts` 的 `NoteLook`；沒改過就不寫） */
  look?: NoteLook;
  /** 簡報整份的設定：主題、頁碼、頁尾（`deckSetup.ts`；沒改過就不寫） */
  deck?: DeckSetup;
  /** 舊版每份文件一份的已存區塊樣式（現在所有文件共用 `styleLibrary.ts`；打開時併過去並拿掉這裡的） */
  styles?: SavedStyle[];
  /** 所在的資料夾（`DeskFile.folders` 的 id；不在資料夾裡就不寫）。連結名稱不受資料夾影響。 */
  folder?: string;
}

/** Dock 的資料夾：只有一層，裡面的文件照 `docs` 的順序排 */
export interface DockFolder {
  id: string;
  name: string;
}

export interface DeskFile {
  board: Board;
  docs: DockDoc[];
  /** Dock 的資料夾（照清單上的順序；沒有就不寫） */
  folders?: DockFolder[];
  /** Tasks：任務看板（參考 Trello，`tasks.ts`；還沒用過就不寫） */
  tasks?: TaskBoard;
}

export const emptyFile = (): DeskFile => ({ board: emptyBoard(), docs: [] });

const KINDS: DockKind[] = ["note", "word", "slides", "sheet", "draw"];

export function parseFile(json: string): DeskFile {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json || "{}");
  } catch {
    return emptyFile();
  }
  if (!raw || typeof raw !== "object") return emptyFile();
  const rawDocs = (Array.isArray(raw.docs) ? raw.docs : []).filter((o): o is Record<string, unknown> => !!o && typeof o === "object" && typeof o.id === "string");
  // 任務看板一開始做成 Dock 文件（kind "tasks"），後來改成檔案的一部分：沒有 tasks 時拿第一份過來
  const oldTasks = rawDocs.find((o) => o.kind === "tasks" && o.tasks && typeof o.tasks === "object");
  const tasksRaw = raw.tasks && typeof raw.tasks === "object" ? raw.tasks : oldTasks?.tasks;
  const docs: DockDoc[] = rawDocs
    .filter((o) => o.kind !== "tasks")
    .map((o) => {
      const title = typeof o.title === "string" && o.title.trim() ? o.title : "Untitled";
      // 舊的資料庫 → 一張表格的試算表
      if (o.kind === "database") return { id: o.id as string, title, kind: "sheet" as const, content: serializeWorkbook(fromDatabase(o.database, title)) };
      const kind = KINDS.includes(o.kind as DockKind) ? (o.kind as DockKind) : "note";
      const content =
        kind === "sheet"
          ? serializeWorkbook(parseWorkbook(o.sheet && typeof o.sheet === "object" ? JSON.stringify(o.sheet) : ""))
          : kind === "draw"
            ? serializeDiagram(diagramFrom(o.draw))
            : typeof o.content === "string"
            ? o.content
            : "";
      const anim = kind === "slides" ? cleanAnim(o.anim) : [];
      const page = kind === "word" && o.page ? cleanPage(o.page) : null;
      const doc: DockDoc = { id: o.id as string, title, kind, content };
      if (anim.length) doc.anim = anim;
      if (page && !isDefaultPage(page)) doc.page = page;
      const look = kind === "note" && o.look ? cleanLook(o.look) : null;
      if (look && !isDefaultLook(look)) doc.look = look;
      const deck = kind === "slides" ? cleanDeck(o.deck) : {};
      if (!isDefaultDeck(deck)) doc.deck = deck;
      if (typeof o.folder === "string" && o.folder) doc.folder = o.folder;
      const styles = kind === "word" || kind === "slides" ? cleanStyles(o.styles) : [];
      if (styles.length) doc.styles = styles;
      return doc;
    });
  const folders: DockFolder[] = [];
  for (const o of Array.isArray(raw.folders) ? raw.folders : []) {
    if (!o || typeof o !== "object" || typeof o.id !== "string" || !o.id || folders.some((x) => x.id === o.id)) continue;
    folders.push({ id: o.id, name: typeof o.name === "string" && o.name.trim() ? o.name : "Untitled folder" });
  }
  const f: DeskFile = { board: parseBoard(raw.board ?? {}), docs, folders };
  if (tasksRaw) f.tasks = tasksFrom(tasksRaw);
  return cleanFolders(f);
}

/** 去掉指向不存在資料夾的 `folder`；沒有資料夾就不留 `folders`。 */
export function cleanFolders(f: DeskFile): DeskFile {
  const ids = new Set((f.folders ?? []).map((x) => x.id));
  const stray = f.docs.some((d) => d.folder !== undefined && !ids.has(d.folder));
  const docs = stray
    ? f.docs.map((d) => {
        if (d.folder === undefined || ids.has(d.folder)) return d;
        const { folder: _gone, ...rest } = d;
        return rest;
      })
    : f.docs;
  if (ids.size) return stray ? { ...f, docs } : f;
  const { folders: _none, ...rest } = f;
  return { ...rest, docs };
}

export function serializeFile(file: DeskFile): string {
  const f = cleanFolders(file);
  const at = (d: DockDoc) => (d.folder ? { folder: d.folder } : {});
  return (
    JSON.stringify(
      {
        version: 1,
        board: boardData(f.board),
        ...(f.folders?.length ? { folders: f.folders.map((x) => ({ id: x.id, name: x.name })) } : {}),
        docs: f.docs.map((d) => ({ ...docData(d), ...at(d) })),
        ...(f.tasks ? { tasks: tasksData(f.tasks) } : {}),
      },
      null,
      2,
    ) + "\n"
  );
}

function docData(d: DockDoc) {
  return d.kind === "sheet"
            ? { id: d.id, title: d.title, kind: d.kind, sheet: JSON.parse(serializeWorkbook(parseWorkbook(d.content))) }
            : d.kind === "draw"
              ? { id: d.id, title: d.title, kind: d.kind, draw: diagramData(parseDiagram(d.content)) }
              : {
                  id: d.id,
                  title: d.title,
                  kind: d.kind,
                  content: d.content,
                  ...(d.kind === "word" && d.page && !isDefaultPage(d.page) ? { page: d.page } : {}),
                  ...(d.kind === "note" && !isDefaultLook(d.look) ? { look: cleanLook(d.look) } : {}),
                  ...(d.kind === "slides" && d.anim && trimAnim(d.anim).length ? { anim: trimAnim(d.anim) } : {}),
                  ...(d.kind === "slides" && !isDefaultDeck(d.deck) ? { deck: cleanDeck(d.deck) } : {}),
                  ...((d.kind === "word" || d.kind === "slides") && d.styles?.length ? { styles: d.styles.map((x) => ({ name: x.name, css: x.css })) } : {}),
                };
}

/* ─── Dock 的文件 ─── */

/** 新文件的標題：「Untitled」，已經有了就「Untitled 2」… */
export function freeTitle(f: DeskFile, base: string): string {
  const used = new Set(f.docs.map((d) => d.title.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!used.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

const STARTER: Record<DockKind, (title: string) => string> = {
  note: () => "",
  word: (t) => `# ${t}\n`,
  slides: (t) => `# ${t}\n`,
  sheet: () => serializeWorkbook(newWorkbook()),
  draw: () => serializeDiagram(starterDiagram()),
};

export function addDoc(f: DeskFile, kind: DockKind, title?: string, content?: string): { file: DeskFile; id: string } {
  const t = (title ?? "").trim() || freeTitle(f, kind === "slides" ? "Slides" : kind === "word" ? "Document" : kind === "sheet" ? "Spreadsheet" : kind === "draw" ? "Diagram" : "Note");
  const doc: DockDoc = { id: newId(), title: t, kind, content: content ?? STARTER[kind](t) };
  return { file: { ...f, docs: [...f.docs, doc] }, id: doc.id };
}

export function updateDoc(f: DeskFile, id: string, patch: Partial<Omit<DockDoc, "id">>): DeskFile {
  return { ...f, docs: f.docs.map((d) => (d.id === id ? { ...d, ...patch } : d)) };
}

export function removeDoc(f: DeskFile, id: string): DeskFile {
  return { ...f, docs: f.docs.filter((d) => d.id !== id) };
}

/** 刪掉好幾份文件。 */
export function removeDocs(f: DeskFile, ids: Iterable<string>): DeskFile {
  const gone = new Set(ids);
  return { ...f, docs: f.docs.filter((d) => !gone.has(d.id)) };
}

/**
 * 把一組項目（照原本的順序）搬到原本第 before 個項目前面（before = 長度就是最後面）。
 * 回傳新的順序；文件清單與投影片共用。
 */
export function moveGroup<T>(items: T[], picked: (item: T, i: number) => boolean, before: number): T[] {
  const moving: T[] = [];
  const rest: T[] = [];
  let at = 0;
  items.forEach((it, i) => {
    if (picked(it, i)) moving.push(it);
    else {
      if (i < before) at++;
      rest.push(it);
    }
  });
  rest.splice(at, 0, ...moving);
  return rest;
}

/** 把選取的文件搬到原本第 before 份前面。 */
export function moveDocs(f: DeskFile, ids: Iterable<string>, before: number): DeskFile {
  const set = new Set(ids);
  return { ...f, docs: moveGroup(f.docs, (d) => set.has(d.id), before) };
}

/** 把文件搬到第 to 個位置。 */
export function moveDoc(f: DeskFile, id: string, to: number): DeskFile {
  const from = f.docs.findIndex((d) => d.id === id);
  if (from < 0) return f;
  const docs = [...f.docs];
  const [d] = docs.splice(from, 1);
  docs.splice(Math.max(0, Math.min(to, docs.length)), 0, d);
  return { ...f, docs };
}

/* ─── Dock 的資料夾（一層；資料夾排在前面，不在資料夾裡的文件排在最後） ─── */

/** 文件在清單上的位置：資料夾（照 `folders` 的順序，裡面照 `docs` 的順序），然後是不在資料夾裡的。 */
export function dockOutline(f: DeskFile): { folders: { folder: DockFolder; docs: DockDoc[] }[]; loose: DockDoc[] } {
  const folders = (f.folders ?? []).map((folder) => ({ folder, docs: [] as DockDoc[] }));
  const byId = new Map(folders.map((x) => [x.folder.id, x]));
  const loose: DockDoc[] = [];
  for (const d of f.docs) ((d.folder !== undefined && byId.get(d.folder)?.docs) || loose).push(d);
  return { folders, loose };
}

/** 照清單上的順序排的文件（送到 Dock 的選單、鍵盤上下移動用） */
export function dockOrder(f: DeskFile): DockDoc[] {
  const o = dockOutline(f);
  return [...o.folders.flatMap((x) => x.docs), ...o.loose];
}

/** 文件所在的資料夾（不存在的資料夾算不在資料夾裡） */
export function folderOf(f: DeskFile, d: DockDoc): DockFolder | null {
  return (d.folder !== undefined && f.folders?.find((x) => x.id === d.folder)) || null;
}

/** 新資料夾的名稱：「New folder」，已經有了就「New folder 2」… */
export function freeFolderName(f: DeskFile, base = "New folder"): string {
  const used = new Set((f.folders ?? []).map((x) => x.name.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!used.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

/** 新增資料夾（排在最後）；給了 ids 就把那些文件搬進去。 */
export function addFolder(f: DeskFile, name?: string, ids: Iterable<string> = [], id = newId()): { file: DeskFile; id: string } {
  const folder: DockFolder = { id, name: (name ?? "").trim() || freeFolderName(f) };
  const next = { ...f, folders: [...(f.folders ?? []), folder] };
  return { file: placeDocs(next, ids, id, null), id };
}

export function renameFolder(f: DeskFile, id: string, name: string): DeskFile {
  const n = name.trim();
  if (!n || !f.folders?.some((x) => x.id === id)) return f;
  return { ...f, folders: f.folders.map((x) => (x.id === id ? { ...x, name: n } : x)) };
}

/** 刪掉資料夾：裡面的文件一起刪掉（withDocs），或搬出來（排在不在資料夾裡的文件最後面）。 */
export function removeFolder(f: DeskFile, id: string, withDocs = false): DeskFile {
  if (!f.folders?.some((x) => x.id === id)) return f;
  const inside = f.docs.filter((d) => d.folder === id).map((d) => d.id);
  const rest = { ...f, folders: f.folders.filter((x) => x.id !== id) };
  return cleanFolders(withDocs ? removeDocs(rest, inside) : placeDocs(rest, inside, null, null));
}

/** 還原舊版本的文件時保留它現在所在的資料夾（資料夾不算文件的版本內容）。 */
export function keepFolder(old: DockDoc, now: DockDoc): DockDoc {
  const { folder: _then, ...rest } = old;
  return now.folder ? { ...rest, folder: now.folder } : rest;
}

/** 把資料夾搬到原本第 before 個資料夾前面。 */
export function moveFolder(f: DeskFile, id: string, before: number): DeskFile {
  if (!f.folders?.some((x) => x.id === id)) return f;
  return { ...f, folders: moveGroup(f.folders, (x) => x.id === id, before) };
}

/**
 * 把文件（照原本的順序）放進資料夾 folder（null＝不在資料夾裡），排在文件 before 前面（null＝那裡的最後面）。
 * 拖曳與「Move to」共用。
 */
export function placeDocs(f: DeskFile, ids: Iterable<string>, folder: string | null, before: string | null): DeskFile {
  const set = new Set(ids);
  if (folder !== null && !f.folders?.some((x) => x.id === folder)) return f;
  const moving: DockDoc[] = [];
  const rest: DockDoc[] = [];
  for (const d of f.docs) {
    if (!set.has(d.id)) rest.push(d);
    else if (folder === null) {
      const { folder: _out, ...plain } = d;
      moving.push(plain);
    } else moving.push({ ...d, folder });
  }
  if (!moving.length) return f;
  // 排在自己（搬動中的文件）前面：改成排在同一群裡、後面第一份不搬的文件前面
  let anchor = before;
  if (anchor !== null && set.has(anchor)) {
    const from = f.docs.findIndex((d) => d.id === anchor);
    anchor = f.docs.slice(from + 1).find((d) => !set.has(d.id) && (folderOf(f, d)?.id ?? null) === folder)?.id ?? null;
  }
  const k = anchor === null ? -1 : rest.findIndex((d) => d.id === anchor);
  // 不在資料夾裡的文件排在清單最後：放到「最後面」就是接在整個陣列後面；放進資料夾也一樣（那個資料夾的最後）
  if (k < 0) rest.push(...moving);
  else rest.splice(k, 0, ...moving);
  return { ...f, docs: rest };
}

/* ─── 簡報：用單獨一行的 --- 分張 ─── */

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const BREAK = /^ {0,3}---\s*$/;

/**
 * 把簡報的 Markdown 分成一張一張。分隔是程式碼區塊外、前一行是空行（或在開頭）的 `---`；
 * 緊接在文字下面的 `---` 是 CommonMark 的標題底線，不算分隔。
 */
export function splitSlides(md: string): string[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[][] = [[]];
  let fence: string | null = null;
  lines.forEach((line, i) => {
    const m = FENCE.exec(line);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !line.trim().slice(m[1].length).trim()) fence = null;
    } else if (m) fence = m[1];
    else if (BREAK.test(line) && (i === 0 || !lines[i - 1].trim())) {
      out.push([]);
      return;
    }
    out[out.length - 1].push(line);
  });
  return out.map((l) => tidySlide(l.join("\n")));
}

/** 去掉投影片前後的空行（不動第一行的縮排：縮排程式碼區塊要靠它）。 */
const tidySlide = (s: string) => s.replace(/^(?:[ \t]*\n)+/, "").trimEnd();

/** 把投影片接回一份 Markdown（每張之間是「空行、---、空行」）。 */
export const joinSlides = (slides: string[]) => slides.map(tidySlide).join("\n\n---\n\n") + "\n";

/** 換掉第 i 張投影片的內容（其他張照舊）。 */
export function setSlide(md: string, i: number, text: string): string {
  const all = splitSlides(md);
  if (i < 0 || i >= all.length) return md;
  all[i] = text;
  return joinSlides(all);
}

/** 在第 at 個位置插入一張投影片。 */
export function insertSlide(md: string, at: number, text = ""): string {
  const all = splitSlides(md);
  all.splice(Math.max(0, Math.min(at, all.length)), 0, text);
  return joinSlides(all);
}

/** 在第 at 個位置插入好幾張投影片（貼上）。 */
export function insertSlides(md: string, at: number, texts: string[]): string {
  const all = splitSlides(md);
  all.splice(Math.max(0, Math.min(at, all.length)), 0, ...texts);
  return joinSlides(all);
}

/** 刪掉第 i 張（只剩一張時留下一張空的）。 */
export function removeSlide(md: string, i: number): string {
  const all = splitSlides(md);
  if (i < 0 || i >= all.length) return md;
  all.splice(i, 1);
  return joinSlides(all.length ? all : [""]);
}

/** 刪掉好幾張（全刪時留下一張空的）。 */
export function removeSlides(md: string, idx: number[]): string {
  const gone = new Set(idx);
  const all = splitSlides(md).filter((_s, i) => !gone.has(i));
  return joinSlides(all.length ? all : [""]);
}

/** 複製好幾張：照順序接在最後一張選取的後面。回傳新內容與複本的位置。 */
export function duplicateSlides(md: string, idx: number[]): { md: string; added: number[] } {
  const all = splitSlides(md);
  const pick = [...new Set(idx)].filter((i) => i >= 0 && i < all.length).sort((a, b) => a - b);
  if (!pick.length) return { md, added: [] };
  const at = pick[pick.length - 1] + 1;
  all.splice(at, 0, ...pick.map((i) => all[i]));
  return { md: joinSlides(all), added: pick.map((_p, k) => at + k) };
}

/** 把選取的投影片搬到原本第 before 張前面；回傳新內容與它們的新位置。 */
export function moveSlides(md: string, idx: number[], before: number): { md: string; moved: number[] } {
  const set = new Set(idx);
  const all = splitSlides(md).map((s, i) => ({ s, i }));
  const next = moveGroup(all, (x) => set.has(x.i), before);
  const moved = next.flatMap((x, k) => (set.has(x.i) ? [k] : []));
  return { md: joinSlides(next.map((x) => x.s)), moved };
}

/** 把第 from 張搬到第 to 個位置。 */
export function moveSlide(md: string, from: number, to: number): string {
  const all = splitSlides(md);
  if (from < 0 || from >= all.length) return md;
  const [s] = all.splice(from, 1);
  all.splice(Math.max(0, Math.min(to, all.length)), 0, s);
  return joinSlides(all);
}

/** 投影片編輯器送出的文字與分張後的文字是否相同（不算前後空行）。 */
export const sameSlide = (a: string, b: string) => tidySlide(a) === tidySlide(b);

/* ─── 送到 Dock ─── */

/** 卡片的內容：便利貼是自己的文字；頁面、日記是標題＋內容。 */
export type CardSource = (card: Card) => { title: string; content: string };

/** 選取的卡片（已照閱讀順序排好）接成一段 Markdown；簡報每張卡片一張投影片。 */
export function cardsMarkdown(cards: Card[], source: CardSource, kind: DockKind): string {
  const parts = cards
    .map((c) => {
      const { title, content } = source(c);
      const body = content.trim();
      if (c.ref.kind === "note" || c.ref.kind === "media" || c.ref.kind === "code" || c.ref.kind === "sheet") return body;
      return body ? `## ${title}\n\n${body}` : `## ${title}`;
    })
    .filter(Boolean);
  return parts.join(kind === "slides" ? "\n\n---\n\n" : "\n\n");
}

/** 接在文件最後面（簡報另起一張）。 */
export function appendMarkdown(src: string, add: string, kind: DockKind): string {
  if (!add.trim()) return src;
  const base = src.trimEnd();
  if (!base) return add + "\n";
  return `${base}${kind === "slides" ? "\n\n---\n\n" : "\n\n"}${add}\n`;
}

/** 卡片送到圖表：每張卡片一個圖形（便利貼是便利貼，頁面、日記是標題）。 */
export function cardsDiagram(json: string, cards: Card[], source: CardSource): string {
  // 圖表卡片整張貼過去；其他卡片各變成一個圖形
  const items = cards
    .filter((c) => c.ref.kind !== "draw")
    .map((c) => {
      const { title, content } = source(c);
      return c.ref.kind === "note" ? { text: content, note: true } : { text: title, note: false };
    });
  let d = parseDiagram(json);
  if (items.length) d = cardsToShapes(d, items);
  for (const c of cards) if (c.ref.kind === "draw") d = appendDiagram(d, parseDiagram(c.text));
  return serializeDiagram(d);
}

/* ─── 統計（清單用） ─── */

export function fileStats(json: string): { cards: number; docs: number } {
  const f = parseFile(json);
  return { cards: f.board.cards.length + f.board.maps.length, docs: f.docs.length };
}
