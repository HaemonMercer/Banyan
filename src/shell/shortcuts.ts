/**
 * 全 App 的鍵盤快捷鍵。編輯器已經用掉 Ctrl+B／I／U／E／K／Z／Y／A、Ctrl+Shift+X，
 * 這裡用 Alt 組合鍵與 Ctrl+\、Ctrl+/，不會跟編輯器衝突。
 * 用 KeyboardEvent.code 判斷按鍵，不受輸入法、鍵盤配置與 Alt 改變 key 的影響。
 */

export type ShortcutAction =
  | "toggle-sidebar"
  | "today"
  | "view-bujo"
  | "view-desk"
  | "view-drawer"
  | "back"
  | "forward"
  | "newer-day"
  | "older-day"
  | "favorite"
  | "desk-switch"
  | "settings"
  | "history"
  | "input-scheme"
  | "help";

type KeyLike = Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"> & { key?: string };

/** 有些輸入來源（自動化、某些虛擬鍵盤）沒有 code，就從 key 推回來。 */
function codeOf(e: KeyLike): string {
  if (e.code) return e.code;
  const k = e.key ?? "";
  if (/^[a-z]$/i.test(k)) return `Key${k.toUpperCase()}`;
  if (/^\d$/.test(k)) return `Digit${k}`;
  return { "/": "Slash", "\\": "Backslash", ",": "Comma", "`": "Backquote" }[k] ?? k;
}

const ALT: Record<string, ShortcutAction> = {
  KeyT: "today",
  ArrowLeft: "back",
  ArrowRight: "forward",
  ArrowUp: "newer-day",
  ArrowDown: "older-day",
  KeyS: "favorite",
  KeyD: "desk-switch",
  KeyH: "history",
  Backquote: "input-scheme",
  Comma: "settings",
};

/** Alt＋數字留給打字（字預測：Alt＋數字直接打數字），切換畫面用 Alt＋Shift＋數字 */
const ALT_SHIFT: Record<string, ShortcutAction> = {
  Digit1: "view-bujo",
  Digit2: "view-desk",
  Digit3: "view-drawer",
};

const CTRL: Record<string, ShortcutAction> = {
  Backslash: "toggle-sidebar",
  Slash: "help",
};

export function matchShortcut(e: KeyLike): ShortcutAction | null {
  const ctrl = e.ctrlKey || e.metaKey;
  const code = codeOf(e);
  if (e.shiftKey) return e.altKey && !ctrl ? (ALT_SHIFT[code] ?? null) : null;
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
      [["Alt", "Shift", "1"], "Calendar"],
      [["Alt", "Shift", "2"], "Desk"],
      [["Alt", "Shift", "3"], "Drawer"],
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
      [["Alt", "D"], "Cycle Whiteboard / Dock / Tasks (in a Desk file)"],
      [["Alt", "H"], "Version history"],
      [["Alt", ","], "Settings"],
      [["Shift"], "Switch Chinese / English input (tap alone)"],
      [["Alt", "`"], "Switch Cangjie / Quick"],
      [["Alt", "0–9"], "Type a digit (while suggestions are open, 1–9 pick)"],
      [["Ctrl", "/"], "Keyboard shortcuts"],
    ],
  },
  {
    // Dock 自己處理（`Dock.tsx`），不經過 matchShortcut
    title: "Dock",
    items: [
      [["Alt", "\\"], "Split right (moves the current tab, or opens the next document)"],
      [["Alt", "Shift", "\\"], "Split down"],
      [["Alt", "Click"], "Open a document to the side"],
      [["Alt", "W"], "Close the current tab"],
      [["Alt", "Shift", "T"], "Reopen the last closed tab"],
      [["Alt", "PgUp/PgDn"], "Previous / next tab"],
      [["Alt", "Shift", "PgUp/PgDn"], "Previous / next group"],
    ],
  },
  {
    // 白板自己處理（`Whiteboard.tsx`），原本寫在白板下方的提示改放在這裡
    title: "Whiteboard",
    items: [
      [["Double-click"], "Add a sticky note"],
      [["N"], "Add a sticky note"],
      [["Enter"], "Edit the selected card"],
      [["Delete"], "Remove the selected items"],
      [["Space", "Drag"], "Move around"],
      [["Ctrl", "Scroll"], "Zoom"],
      [["Shift", "1"], "Fit to screen"],
      [["Drag a dot"], "Connect two cards"],
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
