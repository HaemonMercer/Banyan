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
  { type: "paragraph", label: "文字", description: "一般段落", hint: "", icon: "Aa", keywords: "text paragraph p 文字 段落" },
  { type: "h1", label: "標題 1", description: "大標題", hint: "#", icon: "H1", keywords: "heading h1 title 標題 大標" },
  { type: "h2", label: "標題 2", description: "中標題", hint: "##", icon: "H2", keywords: "heading h2 標題 中標" },
  { type: "h3", label: "標題 3", description: "小標題", hint: "###", icon: "H3", keywords: "heading h3 標題 小標" },
  { type: "bullet", label: "項目清單", description: "用圓點列出項目", hint: "-", icon: "•", keywords: "bullet list ul 清單 項目" },
  { type: "ordered", label: "編號清單", description: "用數字列出步驟", hint: "1.", icon: "1.", keywords: "numbered ordered list ol 編號 清單" },
  { type: "quote", label: "引用", description: "引述一段文字", hint: ">", icon: "❝", keywords: "quote blockquote 引用 引言" },
  { type: "code", label: "程式碼", description: "等寬字的程式碼區塊", hint: "```", icon: "{ }", keywords: "code fence 程式 代碼" },
  { type: "hr", label: "分隔線", description: "在區塊間畫一條線", hint: "---", icon: "—", keywords: "divider hr rule line 分隔 水平線" },
];

export function filterBlockTypes(query: string): BlockTypeItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return BLOCK_TYPES;
  return BLOCK_TYPES.filter((t) => (t.label + " " + t.keywords).toLowerCase().includes(q));
}

/** 編輯中區塊的類型名稱（顯示在編輯框右上角）。 */
export function kindLabel(kind: string, level?: number): string {
  switch (kind) {
    case "heading":
      return `標題 ${level ?? 1}`;
    case "item":
      return "清單項目";
    case "quote":
      return "引用";
    case "code":
      return "程式碼";
    case "hr":
      return "分隔線";
    case "html":
      return "HTML";
    case "source":
      return "參考連結";
    default:
      return "文字";
  }
}
