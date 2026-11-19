import type { BlockType } from "./ops";

export interface BlockTypeItem {
  type: BlockType;
  label: string;
  /** 選單中的說明 */
  description: string;
  /** 對應的 Markdown 語法 */
  hint: string;
  icon: string;
  keywords: string;
}

export const BLOCK_TYPES: BlockTypeItem[] = [
  { type: "paragraph", label: "Text", description: "Plain paragraph", hint: "", icon: "Aa", keywords: "text paragraph p plain" },
  { type: "h1", label: "Heading 1", description: "Large heading", hint: "#", icon: "H1", keywords: "heading h1 title" },
  { type: "h2", label: "Heading 2", description: "Medium heading", hint: "##", icon: "H2", keywords: "heading h2 subtitle" },
  { type: "h3", label: "Heading 3", description: "Small heading", hint: "###", icon: "H3", keywords: "heading h3" },
  { type: "bullet", label: "Bulleted list", description: "A simple bulleted list", hint: "-", icon: "•", keywords: "bullet list ul unordered" },
  { type: "ordered", label: "Numbered list", description: "A list with numbers", hint: "1.", icon: "1.", keywords: "numbered ordered list ol" },
  { type: "todo", label: "To-do list", description: "Checkboxes you can tick", hint: "[]", icon: "☑", keywords: "todo to-do checkbox tickbox check list" },
  { type: "task", label: "Task", description: "A bullet journal task (click the symbol to finish)", hint: "{}", icon: "□", keywords: "task bujo bullet" },
  { type: "event", label: "Event", description: "A bullet journal event", hint: "{o}", icon: "○", keywords: "event bujo bullet appointment" },
  { type: "quote", label: "Quote", description: "Capture a quote", hint: ">", icon: "❝", keywords: "quote blockquote citation" },
  { type: "code", label: "Code", description: "A monospaced code block", hint: "```", icon: "{ }", keywords: "code fence snippet" },
  { type: "hr", label: "Divider", description: "Visually divide blocks", hint: "---", icon: "—", keywords: "divider hr rule line separator" },
  { type: "image", label: "Image", description: "Upload an image or GIF", hint: "", icon: "🖼", keywords: "image picture photo gif" },
  { type: "video", label: "Video", description: "Upload a video", hint: "", icon: "▶", keywords: "video movie mp4 clip" },
  { type: "table", label: "Table", description: "A simple table", hint: "", icon: "▦", keywords: "table grid" },
];

/** 斜線選單裡不是區塊類型的指令：引用 Drawer 的條目、插入參考文獻、插入頁面範本。 */
export type SlashType = BlockType | "cite" | "bibliography" | "template";

export interface SlashItem extends Omit<BlockTypeItem, "type"> {
  type: SlashType;
  /** 範本：範本頁面的名稱（`Template/…`，`src/pages/templates.ts`）；沒有範本時是空字串（只顯示說明） */
  template?: string;
}

export const SLASH_COMMANDS: SlashItem[] = [
  { type: "cite", label: "Citation", description: "Cite an item from Drawer", hint: "[[@", icon: "❞", keywords: "cite citation reference drawer source zotero" },
  { type: "bibliography", label: "Bibliography", description: "List the works cited on this page", hint: "", icon: "☰", keywords: "bibliography references works cited sources drawer" },
];

/** 頁面範本在斜線選單裡的項目；沒有範本時是一個說明怎麼建立範本的項目 */
export function templateItems(templates: { page: string; label: string }[]): SlashItem[] {
  if (!templates.length)
    return [{ type: "template", template: "", label: "Template", description: "Pages named Template/… show up here", hint: "", icon: "⧉", keywords: "template snippet boilerplate" }];
  return templates.map((t) => ({
    type: "template" as const,
    template: t.page,
    label: t.label,
    description: "Insert this template",
    hint: "",
    icon: "⧉",
    keywords: "template snippet boilerplate " + t.label,
  }));
}

export function filterBlockTypes(query: string, templates: { page: string; label: string }[] = []): SlashItem[] {
  const all: SlashItem[] = [...BLOCK_TYPES, ...SLASH_COMMANDS, ...templateItems(templates)];
  const q = query.trim().toLowerCase();
  if (!q) return all;
  return all.filter((t) => (t.label + " " + t.keywords).toLowerCase().includes(q));
}

/** 編輯中區塊的類型名稱（顯示在編輯框右上角）。 */
export function kindLabel(kind: string, level?: number): string {
  switch (kind) {
    case "heading":
      return `Heading ${level ?? 1}`;
    case "item":
      return "List item";
    case "quote":
      return "Quote";
    case "code":
      return "Code";
    case "hr":
      return "Divider";
    case "html":
      return "HTML";
    case "source":
      return "Link reference";
    default:
      return "Text";
  }
}
