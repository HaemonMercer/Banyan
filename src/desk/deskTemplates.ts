import { addEdge, addNote, addSection, emptyBoard, newId, updateSection, type Board } from "./board";
import type { Color } from "../editor/inline";
import { DOC_TEMPLATES } from "./docTemplates";
import { emptyFile, parseFile, serializeFile, type DeskFile, type DockDoc, type DockKind } from "./file";
import { topic, type MindMap } from "./mindmap";

/**
 * Desk 檔案的範本：New file 時挑一個，一次擺好白板與 Dock 的文件。
 *
 * - 內建範本（`FILE_TEMPLATES`）：Blank、Project、Research、Presentation、Meeting。
 * - 使用者的範本：首頁檔案卡片「Save as template」把整個檔案（白板＋Dock）存進 `desk-templates/名稱.json`
 *   （Rust 指令 `desk_template_*`，`store.ts` 的 `defaultDeskTemplateStore`），內容和 Desk 檔案一樣。
 *
 * 這裡都是純函式。
 */

export interface FileTemplate {
  id: string;
  label: string;
  hint: string;
  make: () => DeskFile;
}

/** 用內建的 Dock 範本做一份文件 */
function doc(tplId: string, title: string): DockDoc {
  const t = DOC_TEMPLATES.find((d) => d.id === tplId)!;
  return { id: newId(), title, kind: t.kind as DockKind, content: t.make(title) };
}

/** 一排區段（看板的欄），回傳白板與每個區段的左上角 */
function columns(b: Board, titles: [string, Color | null][], x0: number, y0: number, w = 280, h = 460, gap = 28) {
  let board = b;
  const at: { x: number; y: number }[] = [];
  titles.forEach(([title, color], i) => {
    const x = x0 + i * (w + gap);
    const r = addSection(board, { x, y: y0, w, h }, title);
    board = color ? updateSection(r.board, r.id, { color }) : r.board;
    at.push({ x, y: y0 });
  });
  return { board, at };
}

function notes(b: Board, x: number, y: number, texts: string[], dy = 92): { board: Board; ids: string[] } {
  let board = b;
  const ids: string[] = [];
  texts.forEach((t, i) => {
    const r = addNote(board, x, y + i * dy, t);
    board = r.board;
    ids.push(r.id);
  });
  return { board, ids };
}

function mindMap(x: number, y: number, root: string, mains: [string, string[]][]): MindMap {
  return { id: newId(), x, y, root: topic(root, mains.map(([t, kids]) => topic(t, kids.map((k) => topic(k))))) };
}

export const FILE_TEMPLATES: FileTemplate[] = [
  { id: "blank", label: "Blank", hint: "An empty whiteboard and Dock", make: emptyFile },
  {
    id: "project",
    label: "Project",
    hint: "Kanban board · project brief · task tracker",
    make: () => {
      let { board, at } = columns(emptyBoard(), [
        ["To do", "gray"],
        ["Doing", "blue"],
        ["Done", "green"],
      ], 0, 0);
      board = notes(board, at[0].x + 24, at[0].y + 60, ["Write the brief", "Plan the milestones", "Find the people"]).board;
      board = notes(board, at[1].x + 24, at[1].y + 60, ["Kick-off"]).board;
      return { board, docs: [doc("word-report", "Project brief"), doc("sheet-tracker", "Tasks")] };
    },
  },
  {
    id: "research",
    label: "Research",
    hint: "Question mind map · notes · reading list",
    make: () => {
      const map = mindMap(0, 0, "Research question", [
        ["What we know", ["Source"]],
        ["Open questions", ["Question"]],
        ["Methods", ["Method"]],
        ["Findings", ["Finding"]],
      ]);
      const board: Board = { ...emptyBoard(), maps: [map] };
      return {
        board,
        docs: [
          { id: newId(), title: "Notes", kind: "note", content: "# Notes\n\n## Sources\n\n- \n\n## Ideas\n\n- \n" },
          doc("word-report", "Write-up"),
        ],
      };
    },
  },
  {
    id: "presentation",
    label: "Presentation",
    hint: "Story outline · slides · speaker notes",
    make: () => {
      const steps = ["Hook", "Problem", "Idea", "Proof", "Ask"];
      let board = emptyBoard();
      const ids: string[] = [];
      steps.forEach((s, i) => {
        const r = addNote(board, i * 240, 0, s);
        board = r.board;
        ids.push(r.id);
      });
      for (let i = 1; i < ids.length; i++) board = addEdge(board, ids[i - 1], ids[i]).board;
      return {
        board,
        docs: [
          doc("slides-pitch", "Slides"),
          { id: newId(), title: "Speaker notes", kind: "note", content: steps.map((s) => `## ${s}\n\n- `).join("\n\n") + "\n" },
        ],
      };
    },
  },
  {
    id: "meeting",
    label: "Meeting",
    hint: "Agenda board · minutes",
    make: () => {
      let { board, at } = columns(emptyBoard(), [
        ["Agenda", "blue"],
        ["Parking lot", "yellow"],
      ], 0, 0, 300, 400);
      board = notes(board, at[0].x + 24, at[0].y + 60, ["Topic 1", "Topic 2"]).board;
      return { board, docs: [doc("word-minutes", "Minutes")] };
    },
  },
];

/** 使用者範本：把檔案存成範本的內容（和 Desk 檔案相同的 JSON） */
export const templateOfFile = (json: string): string => serializeFile(parseFile(json));

/** 用範本建立新檔案的內容：內建的用 id，使用者的直接用存下來的 JSON */
export function fileFromTemplate(builtin: string | null, userJson?: string): string {
  if (userJson !== undefined) return serializeFile(parseFile(userJson));
  const t = FILE_TEMPLATES.find((f) => f.id === builtin) ?? FILE_TEMPLATES[0];
  return serializeFile(t.make());
}
