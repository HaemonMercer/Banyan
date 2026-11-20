/**
 * 「插入 Excel 的表格或圖表」對話框的登記處（跟 `drawer/drawerImages.ts` 的 `pickImages` 一樣）。
 *
 * App 用 `setSheetPicker` 登記對話框（`SheetPicker.tsx`）；編輯器（斜線選單、`EditorCommands.insertSheet`）
 * 呼叫 `pickSheetObject()`，選好回傳要插入的 Markdown（`![[檔案/標題#^id]]`），取消是 null。
 * 編輯器只 import 這裡，不載入對話框。
 */
let picker: (() => Promise<string | null>) | null = null;

export function setSheetPicker(fn: typeof picker): void {
  picker = fn;
}

/** 打開對話框；沒有登記（測試）就是 null。 */
export function pickSheetObject(): Promise<string | null> {
  return picker ? picker() : Promise.resolve(null);
}
