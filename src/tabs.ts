import { isBookFile } from "./drawer/books";

/**
 * Tabs, like a browser's (and Zotero's): the first tab is the module chosen in the rail (Drawer,
 * Whiteboard, Annotator, 設定); PDFs and books open in tabs of their own beside it.
 */

/** A file open in a tab. */
export interface FileTabInfo {
    attachmentId: number;
    fileName: string;
    /** The item's title (or the file name). */
    title: string;
    /** The item it belongs to ("在 Drawer 中顯示"). */
    itemId: number | null;
}

export const OPEN_TAB_EVENT = "banyan:open-tab";

/** Opens the file in a tab (or goes to its tab when it has one). */
export function openFileTab(tab: FileTabInfo) {
    window.dispatchEvent(new CustomEvent<FileTabInfo>(OPEN_TAB_EVENT, { detail: tab }));
}

/** Files that open in tabs: the ones you read for a while and annotate. */
export const opensInTab = (fileName: string) => /\.pdf$/i.test(fileName) || isBookFile(fileName);

/** "report.pdf" → "report". */
export const withoutExtension = (fileName: string) => fileName.replace(/\.[^.]+$/, "") || fileName;

// The module tab stays mounted (keeping its place) while a file tab is shown. Its window-wide
// keyboard shortcuts check this, so they don't act on a module nobody is looking at.
let homeActive = true;
export const isHomeActive = () => homeActive;
export function setHomeActive(active: boolean) {
    homeActive = active;
}

/** Whether an element is on screen (not in a hidden tab). */
export const isShown = (el: Element | null | undefined) => !!el && el.getClientRects().length > 0;
