import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useSyncExternalStore } from "react";
import { cleanStyles, freeStyleName, type SavedStyle } from "../editor/blockStyle";
import type { BoxValue } from "../editor/layout";

/**
 * 已存的區塊樣式：所有 Word、簡報文件共用一份（使用者要的「每份文件都能用自己的樣式」）。
 * 存在資料夾的 `styles/block-styles.json`（Rust `styles_read`／`styles_write`）；只有前端時存在 localStorage。
 *
 * 改清單一律用 `changeStyles`：同時交給 App 註冊的 `setRestyleAll`，把所有 Desk 檔案裡
 * 用到那個樣式的區塊一起改（更新、改名、刪除）。
 */

const LOCAL_KEY = "banyan.blockStyles";

let styles: SavedStyle[] = [];
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

/** App 註冊：對所有 Desk 檔案的 Word、簡報內容做 restyle */
let restyleAll: (fn: (v: BoxValue) => BoxValue | null) => void = () => {};
export function setRestyleAll(fn: typeof restyleAll) {
  restyleAll = fn;
}

export function parseStyleFile(text: string): SavedStyle[] {
  if (!text.trim()) return [];
  try {
    const raw = JSON.parse(text);
    return cleanStyles(Array.isArray(raw) ? raw : raw?.styles);
  } catch {
    return [];
  }
}

export const serializeStyleFile = (list: SavedStyle[]) =>
  list.length ? JSON.stringify({ version: 1, styles: list.map((s) => ({ name: s.name, css: s.css, ...(s.type ? { type: s.type } : {}) })) }, null, 2) + "\n" : "";

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

/** 讀檔（只讀一次）；之後的修改都等它讀完，才不會蓋掉檔案裡的樣式 */
export function loadStyles(): Promise<void> {
  loading ??= read()
    .then((text) => {
      // 讀完之前已經有改動（併進來的舊樣式）：檔案裡的在前面
      const merged = mergeInto(parseStyleFile(text), styles);
      styles = merged;
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
  void write(serializeStyleFile(styles)).catch(() => {});
};

/** 改清單（並且用 restyle 改所有文件裡的區塊） */
export function changeStyles(next: SavedStyle[], restyle?: (v: BoxValue) => BoxValue | null) {
  void loadStyles().then(() => {
    styles = next;
    notify();
    save();
    if (restyle) restyleAll(restyle);
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

/** 共用的樣式清單（第一次用到時讀檔） */
export function useSavedStyles(): SavedStyle[] {
  useEffect(() => {
    void loadStyles();
  }, []);
  return useSyncExternalStore(subscribe, () => styles);
}
