import { invoke, isTauri } from "@tauri-apps/api/core";
import type { DocStore } from "../journal/useJournals";

/**
 * Drawer 的儲存：整個文獻庫是資料夾裡的 `drawer/library.json`（Rust 指令 drawer_read／drawer_write）；
 * 只有前端時存在 localStorage。用和日記、頁面相同的 `useDocs` 管理，只有一份文件，鍵是 `LIBRARY`。
 */

export const LIBRARY = "library";
const LOCAL_KEY = "banyan.drawer";

export function localDrawerStore(storage: Storage): DocStore {
  return {
    async list() {
      return storage.getItem(LOCAL_KEY) ? [LIBRARY] : [];
    },
    async read() {
      return storage.getItem(LOCAL_KEY) ?? "";
    },
    async write(_key, content) {
      if (!content.trim()) storage.removeItem(LOCAL_KEY);
      else storage.setItem(LOCAL_KEY, content);
    },
  };
}

function tauriDrawerStore(): DocStore {
  return {
    list: async () => ((await invoke<string>("drawer_read")).trim() ? [LIBRARY] : []),
    read: () => invoke<string>("drawer_read"),
    write: (_key, content) => invoke<void>("drawer_write", { content }),
  };
}

export function defaultDrawerStore(): DocStore {
  return isTauri() ? tauriDrawerStore() : localDrawerStore(window.localStorage);
}

/* ─── 個人瀏覽狀態（不寫進檔案） ─── */

const UI_KEY = "banyan.drawerUi";

export interface DrawerUi {
  /** 文獻庫頁選的範圍 */
  scope: string;
  /** 檔案庫頁打開的資料夾（空字串是 My Files） */
  folder: string;
  sort: string;
  desc: boolean;
  style: string;
  collapsed: string[];
}

export function loadUi(): Partial<DrawerUi> {
  try {
    const v = JSON.parse(localStorage.getItem(UI_KEY) ?? "null");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function saveUi(ui: DrawerUi): void {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(ui));
  } catch {
    /* 記不住也沒關係 */
  }
}
