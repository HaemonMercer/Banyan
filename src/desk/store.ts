import { invoke, isTauri } from "@tauri-apps/api/core";
import type { DocStore } from "../journal/useJournals";
import type { Camera } from "./board";

/**
 * Desk 檔案的儲存：App 資料夾的 `desk/名稱.json`（Rust 指令 desk_list／desk_read／desk_write，
 * 檔名和頁面一樣用 URL 編碼）；只有前端時存在 localStorage。內容是空字串就刪掉。
 * 用和日記、頁面相同的 `useDocs` 管理（內容是 JSON 字串）。
 */

const PREFIX = "banyan.desk.";

export function localDeskStore(storage: Storage): DocStore {
  return {
    async list() {
      const names: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k?.startsWith(PREFIX)) names.push(k.slice(PREFIX.length));
      }
      return names.sort();
    },
    async read(name) {
      return storage.getItem(PREFIX + name) ?? "";
    },
    async write(name, content) {
      if (!content.trim()) storage.removeItem(PREFIX + name);
      else storage.setItem(PREFIX + name, content);
    },
  };
}

function tauriDeskStore(): DocStore {
  return {
    list: () => invoke<string[]>("desk_list"),
    read: (name) => invoke<string>("desk_read", { name }),
    write: (name, content) => invoke<void>("desk_write", { name, content }),
  };
}

export function defaultDeskStore(): DocStore {
  return isTauri() ? tauriDeskStore() : localDeskStore(window.localStorage);
}

/* ─── 個人瀏覽狀態（不寫進檔案）：白板上次的畫面位置、Dock 上次開的文件 ─── */

const CAM_PREFIX = "banyan.deskCamera.";
const DOC_PREFIX = "banyan.deskDoc.";

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

/** 刪掉檔案時一起清掉 */
export function forgetFile(name: string): void {
  try {
    localStorage.removeItem(CAM_PREFIX + name);
    localStorage.removeItem(DOC_PREFIX + name);
  } catch {
    /* 無所謂 */
  }
}
