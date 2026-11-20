import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useSyncExternalStore } from "react";
import { charStyleSheet, cleanStyles, freeStyleName, type SavedStyle } from "../editor/blockStyle";
import { restyleBoxes, type BoxValue } from "../editor/layout";

/**
 * 已存的樣式：所有 Word、簡報文件共用一份。存在資料夾的 `styles/block-styles.json`
 * （Rust `styles_read`／`styles_write`）；只有前端時存在 localStorage。
 *
 * - 段落樣式（`styles`）：段落類型＋區塊樣式，套用時寫進區塊（`<div class="box" data-style>`）。
 *   改清單用 `changeStyles`，restyle 交給 App 改所有文件裡用到它的區塊。
 * - 字元樣式（`chars`）：套用在選取的文字，文件裡只寫參照 `<span data-cs="名稱">`，
 *   樣子由這裡產生的樣式表（`<style id="banyan-char-styles">`）決定，所以改樣式不必改寫文件；
 *   改名、刪除才用 `changeCharStyles` 的 rewrite 改所有文件。
 */

const LOCAL_KEY = "banyan.blockStyles";

let styles: SavedStyle[] = [];
let chars: SavedStyle[] = [];
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

/** App 註冊：用 rewrite 改所有 Desk 檔案裡 Word、簡報的內容（hint：內容裡沒有這串字的檔案跳過） */
let rewriteDocs: (rewrite: (src: string) => string, hint: string) => void = () => {};
export function setRewriteDocs(fn: typeof rewriteDocs) {
  rewriteDocs = fn;
}

export interface StyleFile {
  styles: SavedStyle[];
  chars: SavedStyle[];
}

export function parseStyleData(text: string): StyleFile {
  if (!text.trim()) return { styles: [], chars: [] };
  try {
    const raw = JSON.parse(text);
    if (Array.isArray(raw)) return { styles: cleanStyles(raw), chars: [] };
    // 字元樣式沒有段落類型
    return { styles: cleanStyles(raw?.styles), chars: cleanStyles(raw?.chars).map(({ name, css }) => ({ name, css })) };
  } catch {
    return { styles: [], chars: [] };
  }
}

/** 只要段落樣式（舊的呼叫方式） */
export const parseStyleFile = (text: string) => parseStyleData(text).styles;

export function serializeStyleFile(list: SavedStyle[], charList: SavedStyle[] = []): string {
  if (!list.length && !charList.length) return "";
  const data = {
    version: 1,
    styles: list.map((s) => ({ name: s.name, css: s.css, ...(s.type ? { type: s.type } : {}) })),
    ...(charList.length ? { chars: charList.map((s) => ({ name: s.name, css: s.css })) } : {}),
  };
  return JSON.stringify(data, null, 2) + "\n";
}

async function read(): Promise<string> {
  if (isTauri()) return invoke<string>("styles_read");
  try {
    return localStorage.getItem(LOCAL_KEY) ?? "";
  } catch {
    return "";
  }
}

async function write(text: string): Promise<void> {
  if (isTauri()) return invoke<void>("styles_write", { content: text });
  try {
    if (text) localStorage.setItem(LOCAL_KEY, text);
    else localStorage.removeItem(LOCAL_KEY);
  } catch {
    /* 瀏覽器預覽存不了就算了 */
  }
}

/** 字元樣式的樣式表放在 <head> 裡 */
function syncSheet() {
  if (typeof document === "undefined") return;
  let el = document.getElementById("banyan-char-styles");
  if (!el) {
    el = document.createElement("style");
    el.id = "banyan-char-styles";
    document.head.appendChild(el);
  }
  const css = charStyleSheet(chars);
  if (el.textContent !== css) el.textContent = css;
}

/** 讀檔（只讀一次）；之後的修改都等它讀完，才不會蓋掉檔案裡的樣式。App 啟動時就呼叫（字元樣式的樣式表） */
export function loadStyles(): Promise<void> {
  loading ??= read()
    .then((text) => {
      const data = parseStyleData(text);
      // 讀完之前已經有改動（併進來的舊樣式）：檔案裡的在前面
      styles = mergeInto(data.styles, styles);
      chars = mergeInto(data.chars, chars);
      syncSheet();
      notify();
    })
    .catch(() => {});
  return loading;
}

/** 把 extra 併進 base：同名的保留 base（不分大小寫） */
function mergeInto(base: SavedStyle[], extra: SavedStyle[]): SavedStyle[] {
  const out = [...base];
  for (const s of extra) if (!out.some((x) => x.name.toLowerCase() === s.name.toLowerCase())) out.push(s);
  return out;
}

const save = () => {
  void write(serializeStyleFile(styles, chars)).catch(() => {});
};

/** 改段落樣式清單（並且用 restyle 改所有文件裡的區塊） */
export function changeStyles(next: SavedStyle[], restyle?: (v: BoxValue) => BoxValue | null) {
  void loadStyles().then(() => {
    styles = next;
    notify();
    save();
    if (restyle) rewriteDocs((src) => restyleBoxes(src, restyle), "data-style");
  });
}

/** 改字元樣式清單（樣子馬上換）；改名、刪除時用 rewrite 改所有文件裡的參照 */
export function changeCharStyles(next: SavedStyle[], rewrite?: (src: string) => string) {
  void loadStyles().then(() => {
    chars = next;
    syncSheet();
    notify();
    save();
    if (rewrite) rewriteDocs(rewrite, "data-cs");
  });
}

/**
 * 以前每份文件各存一份（`DockDoc.styles`）：打開時併進共用的清單。
 * 同名不同樣子的改名加編號，回傳區塊要改的名稱（舊名 → 新名）。
 */
export async function adoptStyles(list: SavedStyle[]): Promise<Map<string, string>> {
  await loadStyles();
  const renames = new Map<string, string>();
  let next = styles;
  for (const s of list) {
    const same = next.find((x) => x.name.toLowerCase() === s.name.toLowerCase());
    if (same && same.css === s.css) continue;
    const name = same ? freeStyleName(next, s.name) : s.name;
    if (name !== s.name) renames.set(s.name, name);
    next = [...next, { name, css: s.css }];
  }
  if (next !== styles) {
    styles = next;
    notify();
    save();
  }
  return renames;
}

const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};

/** 共用的段落樣式清單（第一次用到時讀檔） */
export function useSavedStyles(): SavedStyle[] {
  useEffect(() => {
    void loadStyles();
  }, []);
  return useSyncExternalStore(subscribe, () => styles);
}

/** 共用的字元樣式清單 */
export function useCharStyles(): SavedStyle[] {
  useEffect(() => {
    void loadStyles();
  }, []);
  return useSyncExternalStore(subscribe, () => chars);
}
