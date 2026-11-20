import { invoke, isTauri } from "@tauri-apps/api/core";
import type { DocStore } from "../journal/useJournals";
import type { Camera } from "./board";
import type { FileActivity } from "./home";
import { parsePanes, tabCount, type Panes } from "./panes";

/**
 * Desk 檔案的儲存：App 資料夾的 `desk/名稱.json`（Rust 指令 desk_list／desk_read／desk_write，
 * 檔名和頁面一樣用 URL 編碼）；只有前端時存在 localStorage。內容是空字串就刪掉。
 * 用和日記、頁面相同的 `useDocs` 管理（內容是 JSON 字串）。
 */

export function localDeskStore(storage: Storage, prefix = "banyan.desk."): DocStore {
  return {
    async list() {
      const names: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k?.startsWith(prefix)) names.push(k.slice(prefix.length));
      }
      return names.sort();
    },
    async read(name) {
      return storage.getItem(prefix + name) ?? "";
    },
    async write(name, content) {
      if (!content.trim()) storage.removeItem(prefix + name);
      else storage.setItem(prefix + name, content);
    },
    async rename(from, to) {
      const v = storage.getItem(prefix + from);
      if (from === to) return;
      if (storage.getItem(prefix + to) !== null) throw new Error(`A file named ${to} already exists`);
      if (v !== null) storage.setItem(prefix + to, v);
      storage.removeItem(prefix + from);
    },
  };
}

function tauriDeskStore(): DocStore {
  return {
    list: () => invoke<string[]>("desk_list"),
    read: (name) => invoke<string>("desk_read", { name }),
    write: (name, content) => invoke<void>("desk_write", { name, content }),
    // Rust 端連版本歷史的資料夾一起搬
    rename: (from, to) => invoke<void>("desk_rename", { from, to }),
  };
}

export function defaultDeskStore(): DocStore {
  return isTauri() ? tauriDeskStore() : localDeskStore(window.localStorage);
}

/** 使用者存的 Desk 檔案範本（`desk-templates/名稱.json`，`deskTemplates.ts`） */
export function defaultDeskTemplateStore(): DocStore {
  return isTauri()
    ? {
        list: () => invoke<string[]>("desk_template_list"),
        read: (name) => invoke<string>("desk_template_read", { name }),
        write: (name, content) => invoke<void>("desk_template_write", { name, content }),
      }
    : localDeskStore(window.localStorage, "banyan.deskTemplate.");
}

/* ─── 個人瀏覽狀態（不寫進檔案）：白板上次的畫面位置、Dock 上次開的文件 ─── */

const CAM_PREFIX = "banyan.deskCamera.";
const DOC_PREFIX = "banyan.deskDoc.";
const FOLDERS_PREFIX = "banyan.deskFolders.";
const PANES_PREFIX = "banyan.deskPanes.";
/** Tasks 看的是 Board 還是 Calendar（`TasksView.tsx`） */
export const TASKS_VIEW_PREFIX = "banyan.tasksView.";

/** Dock 的分割視窗（群組、分頁、大小、關掉的分頁；`panes.ts`） */
export function loadPanes(name: string): Panes | null {
  try {
    return parsePanes(JSON.parse(localStorage.getItem(PANES_PREFIX + name) ?? "null"));
  } catch {
    return null;
  }
}

export function savePanes(name: string, p: Panes): void {
  try {
    // 只開一個分頁、也沒有關掉的：不用記
    if (tabCount(p) <= 1 && !p.closed.length) localStorage.removeItem(PANES_PREFIX + name);
    else localStorage.setItem(PANES_PREFIX + name, JSON.stringify(p));
  } catch {
    /* 記不住也沒關係 */
  }
}

/** Dock 收起來的資料夾（id） */
export function loadCollapsed(name: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(FOLDERS_PREFIX + name) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function saveCollapsed(name: string, ids: string[]): void {
  try {
    if (ids.length) localStorage.setItem(FOLDERS_PREFIX + name, JSON.stringify(ids));
    else localStorage.removeItem(FOLDERS_PREFIX + name);
  } catch {
    /* 記不住也沒關係 */
  }
}

export function loadCamera(name: string): Camera | null {
  try {
    const v = JSON.parse(localStorage.getItem(CAM_PREFIX + name) ?? "null");
    if (v && [v.x, v.y, v.zoom].every((n) => typeof n === "number" && Number.isFinite(n)) && v.zoom > 0) return v;
  } catch {
    /* 沒有就重新置中 */
  }
  return null;
}

export function saveCamera(name: string, cam: Camera): void {
  try {
    localStorage.setItem(CAM_PREFIX + name, JSON.stringify(cam));
  } catch {
    /* 記不住也沒關係 */
  }
}

export function loadDockDoc(name: string): string | null {
  try {
    return localStorage.getItem(DOC_PREFIX + name);
  } catch {
    return null;
  }
}

export function saveDockDoc(name: string, id: string): void {
  try {
    localStorage.setItem(DOC_PREFIX + name, id);
  } catch {
    /* 記不住也沒關係 */
  }
}

/** 忘記白板的畫面位置（下次打開時把全部內容放進畫面） */
export function forgetCamera(name: string): void {
  try {
    localStorage.removeItem(CAM_PREFIX + name);
  } catch {
    /* 無所謂 */
  }
}

/** 改名時把畫面位置、Dock 上次開的文件、首頁的最近時間搬到新名稱 */
export function renameFileState(from: string, to: string): void {
  try {
    for (const prefix of [CAM_PREFIX, DOC_PREFIX, FOLDERS_PREFIX, PANES_PREFIX, TASKS_VIEW_PREFIX]) {
      const v = localStorage.getItem(prefix + from);
      localStorage.removeItem(prefix + from);
      if (v !== null) localStorage.setItem(prefix + to, v);
    }
    const all = loadActivity();
    if (from in all) {
      all[to] = all[from];
      delete all[from];
      localStorage.setItem(ACTIVITY_KEY, JSON.stringify(all));
    }
  } catch {
    /* 無所謂 */
  }
}

/** 刪掉檔案時一起清掉 */
export function forgetFile(name: string): void {
  try {
    localStorage.removeItem(CAM_PREFIX + name);
    localStorage.removeItem(DOC_PREFIX + name);
    localStorage.removeItem(FOLDERS_PREFIX + name);
    localStorage.removeItem(PANES_PREFIX + name);
    localStorage.removeItem(TASKS_VIEW_PREFIX + name);
    const all = loadActivity();
    if (name in all) {
      delete all[name];
      localStorage.setItem(ACTIVITY_KEY, JSON.stringify(all));
    }
  } catch {
    /* 無所謂 */
  }
}

/* ─── 首頁：每個檔案最近打開、編輯的時間 ─── */

const ACTIVITY_KEY = "banyan.deskActivity";

export function loadActivity(): Record<string, FileActivity> {
  try {
    const v = JSON.parse(localStorage.getItem(ACTIVITY_KEY) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** 記下現在打開（opened）或改了（edited）這個檔案 */
export function touchFile(name: string, what: keyof FileActivity, at = Date.now()): void {
  try {
    const all = loadActivity();
    all[name] = { ...all[name], [what]: at };
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(all));
  } catch {
    /* 記不住也沒關係 */
  }
}
