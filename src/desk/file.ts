import { newDatabase, parseDatabase, serializeDatabase } from "../database/model";
import { boardData, emptyBoard, newId, parseBoard, type Board, type Card } from "./board";

/**
 * Desk 的一個檔案（File）＝一個專案，有兩個部分：
 *
 * - **Whiteboard**：發想。把想法直接貼上去（便利貼、頁面、日記），不用管順序（`board.ts`）。
 * - **Dock**：整理。把想法整理成可以發表的文件，四種：
 *   一般筆記（`note`）、Word 文件（`word`，A4 分頁預覽、匯出 .docx）、
 *   簡報（`slides`，用單獨一行的 `---` 分張，匯出 .pptx）、資料庫（`database`，參考 Notion，匯出 .csv）。
 *   前三種的內容是 Markdown；資料庫在記憶體裡是 `src/database/model.ts` 的 JSON 字串，
 *   存檔時寫成 `database` 物件（不是跳脫過的字串）。
 *
 * 存成 App 資料夾的 `desk/名稱.json`。這裡都是純函式。
 */

export type DockKind = "note" | "word" | "slides" | "database";

export const DOCK_KINDS: { kind: DockKind; label: string; hint: string }[] = [
  { kind: "word", label: "Word document", hint: "A4 pages · export .docx" },
  { kind: "slides", label: "Slides", hint: "--- between slides · export .pptx" },
  { kind: "database", label: "Database", hint: "Table and board · export .csv" },
  { kind: "note", label: "Note", hint: "A plain page" },
];

export const kindLabel = (k: DockKind) =>
  k === "word" ? "Word" : k === "slides" ? "Slides" : k === "database" ? "Database" : "Note";

export interface DockDoc {
  id: string;
  title: string;
  kind: DockKind;
  content: string;
}

export interface DeskFile {
  board: Board;
  docs: DockDoc[];
}

export const emptyFile = (): DeskFile => ({ board: emptyBoard(), docs: [] });

const KINDS: DockKind[] = ["note", "word", "slides", "database"];

export function parseFile(json: string): DeskFile {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json || "{}");
  } catch {
    return emptyFile();
  }
  if (!raw || typeof raw !== "object") return emptyFile();
  const docs: DockDoc[] = (Array.isArray(raw.docs) ? raw.docs : [])
    .filter((o): o is Record<string, unknown> => !!o && typeof o === "object" && typeof o.id === "string")
    .map((o) => {
      const kind = KINDS.includes(o.kind as DockKind) ? (o.kind as DockKind) : "note";
      const content =
        kind === "database"
          ? serializeDatabase(parseDatabase(o.database && typeof o.database === "object" ? JSON.stringify(o.database) : ""))
          : typeof o.content === "string"
            ? o.content
            : "";
      return { id: o.id as string, title: typeof o.title === "string" && o.title.trim() ? o.title : "Untitled", kind, content };
    });
  return { board: parseBoard(raw.board ?? {}), docs };
}

export function serializeFile(f: DeskFile): string {
  return (
    JSON.stringify(
      {
        version: 1,
        board: boardData(f.board),
        docs: f.docs.map((d) =>
          d.kind === "database"
            ? { id: d.id, title: d.title, kind: d.kind, database: JSON.parse(serializeDatabase(parseDatabase(d.content))) }
            : { id: d.id, title: d.title, kind: d.kind, content: d.content },
        ),
      },
      null,
      2,
    ) + "\n"
  );
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
  slides: (t) => `# ${t}\n\n---\n\n## \n`,
  database: () => serializeDatabase(newDatabase()),
};

export function addDoc(f: DeskFile, kind: DockKind, title?: string, content?: string): { file: DeskFile; id: string } {
  const t = (title ?? "").trim() || freeTitle(f, kind === "slides" ? "Slides" : kind === "word" ? "Document" : kind === "database" ? "Database" : "Note");
  const doc: DockDoc = { id: newId(), title: t, kind, content: content ?? STARTER[kind](t) };
  return { file: { ...f, docs: [...f.docs, doc] }, id: doc.id };
}

export function updateDoc(f: DeskFile, id: string, patch: Partial<Omit<DockDoc, "id">>): DeskFile {
  return { ...f, docs: f.docs.map((d) => (d.id === id ? { ...d, ...patch } : d)) };
}

export function removeDoc(f: DeskFile, id: string): DeskFile {
  return { ...f, docs: f.docs.filter((d) => d.id !== id) };
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
  return out.map((l) => l.join("\n").trim()).filter((s, _i, all) => s || all.length === 1);
}

/* ─── 送到 Dock ─── */

/** 卡片的內容：便利貼是自己的文字；頁面、日記是標題＋內容。 */
export type CardSource = (card: Card) => { title: string; content: string };

/** 選取的卡片（已照閱讀順序排好）接成一段 Markdown；簡報每張卡片一張投影片。 */
export function cardsMarkdown(cards: Card[], source: CardSource, kind: DockKind): string {
  const parts = cards
    .map((c) => {
      const { title, content } = source(c);
      const body = content.trim();
      if (c.ref.kind === "note") return body;
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

/* ─── 舊的獨立資料庫搬進 Dock ─── */

/**
 * 把舊的 `databases/名稱.json` 加成 Dock 的資料庫文件（標題是原本的名稱）；
 * 已經有同標題（不分大小寫）的資料庫就略過，重複執行不會多出來。
 */
export function importDatabases(f: DeskFile, dbs: [name: string, json: string][]): DeskFile {
  let out = f;
  for (const [name, json] of dbs) {
    if (!json.trim()) continue;
    if (out.docs.some((d) => d.kind === "database" && d.title.toLowerCase() === name.toLowerCase())) continue;
    out = addDoc(out, "database", name, serializeDatabase(parseDatabase(json))).file;
  }
  return out;
}

/* ─── 統計（清單用） ─── */

export function fileStats(json: string): { cards: number; docs: number } {
  const f = parseFile(json);
  return { cards: f.board.cards.length, docs: f.docs.length };
}
