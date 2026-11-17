/**
 * 全 App 的鍵盤快捷鍵。編輯器已經用掉 Ctrl+B／I／U／E／K／Z／Y／A、Ctrl+Shift+X，
 * 這裡用 Alt 組合鍵與 Ctrl+\、Ctrl+/，不會跟編輯器衝突。
 * 用 KeyboardEvent.code 判斷按鍵，不受輸入法、鍵盤配置與 Alt 改變 key 的影響。
 */

export type ShortcutAction =
  | "toggle-sidebar"
  | "today"
  | "view-journals"
  | "view-bujo"
  | "view-pages"
  | "view-boards"
  | "view-doc"
  | "back"
  | "forward"
  | "newer-day"
  | "older-day"
  | "favorite"
  | "source"
  | "help";

type KeyLike = Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"> & { key?: string };

/** 有些輸入來源（自動化、某些虛擬鍵盤）沒有 code，就從 key 推回來。 */
function codeOf(e: KeyLike): string {
  if (e.code) return e.code;
  const k = e.key ?? "";
  if (/^[a-z]$/i.test(k)) return `Key${k.toUpperCase()}`;
  if (/^\d$/.test(k)) return `Digit${k}`;
  return { "/": "Slash", "\\": "Backslash" }[k] ?? k;
}

const ALT: Record<string, ShortcutAction> = {
  KeyT: "today",
  Digit1: "view-journals",
  Digit2: "view-bujo",
  Digit3: "view-pages",
  Digit4: "view-doc",
  Digit5: "view-boards",
  ArrowLeft: "back",
  ArrowRight: "forward",
  ArrowUp: "newer-day",
  ArrowDown: "older-day",
  KeyS: "favorite",
  KeyM: "source",
};

const CTRL: Record<string, ShortcutAction> = {
  Backslash: "toggle-sidebar",
  Slash: "help",
};

export function matchShortcut(e: KeyLike): ShortcutAction | null {
  if (e.shiftKey) return null;
  const ctrl = e.ctrlKey || e.metaKey;
  const code = codeOf(e);
  if (e.altKey && !ctrl) return ALT[code] ?? null;
  if (ctrl && !e.altKey) return CTRL[code] ?? null;
  return null;
}

/** 快捷鍵一覽（說明視窗用）。 */
export const SHORTCUT_GROUPS: { title: string; items: [keys: string[], label: string][] }[] = [
  {
    title: "Navigate",
    items: [
      [["Alt", "T"], "Today's journal"],
      [["Alt", "1"], "Journals"],
      [["Alt", "2"], "Calendar"],
      [["Alt", "3"], "All pages"],
      [["Alt", "4"], "Document"],
      [["Alt", "5"], "Whiteboards"],
      [["Alt", "←"], "Back"],
      [["Alt", "→"], "Forward"],
      [["Alt", "↑"], "Next day's journal"],
      [["Alt", "↓"], "Previous day's journal"],
    ],
  },
  {
    title: "Interface",
    items: [
      [["Ctrl", "\\"], "Show/hide sidebar"],
      [["Alt", "S"], "Favorite / unfavorite this page"],
      [["Alt", "M"], "Markdown source panel"],
      [["Ctrl", "/"], "Keyboard shortcuts"],
    ],
  },
  {
    title: "Whiteboard",
    items: [
      [["Double-click"], "Add a card"],
      [["Ctrl", "Scroll"], "Zoom"],
      [["Space", "Drag"], "Pan"],
      [["Shift", "1"], "Fit to screen"],
      [["Ctrl", "0"], "Zoom to 100%"],
      [["Delete"], "Remove from whiteboard"],
    ],
  },
  {
    title: "Editing",
    items: [
      [["/"], "Block menu (in an empty block)"],
      [["[["], "Link to a page"],
      [["Ctrl", "B"], "Bold"],
      [["Ctrl", "I"], "Italic"],
      [["Ctrl", "U"], "Underline"],
      [["Ctrl", "Shift", "X"], "Strikethrough"],
      [["Ctrl", "E"], "Inline code"],
      [["Ctrl", "K"], "Link"],
      [["Tab"], "Indent"],
      [["Shift", "Enter"], "Line break in block"],
      [["Ctrl", "Z"], "Undo"],
      [["Ctrl", "Y"], "Redo"],
    ],
  },
];
