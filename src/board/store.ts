import { invoke, isTauri } from "@tauri-apps/api/core";
import type { DocStore } from "../journal/useJournals";
import type { Camera } from "./model";

/**
 * 白板的儲存：App 資料夾的 `whiteboards/名稱.json`（Rust 指令 board_list／board_read／board_write，
 * 檔名和頁面一樣用 URL 編碼）；只有前端時存在 localStorage。內容是空字串就刪掉。
 * 用和日記、頁面相同的 `useDocs` 管理（內容是 JSON 字串）。
 */

const PREFIX = "banyan.board.";

export function localBoardStore(storage: Storage): DocStore {
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

function tauriBoardStore(): DocStore {
  return {
    list: () => invoke<string[]>("board_list"),
    read: (name) => invoke<string>("board_read", { name }),
    write: (name, content) => invoke<void>("board_write", { name, content }),
  };
}

export function defaultBoardStore(): DocStore {
  return isTauri() ? tauriBoardStore() : localBoardStore(window.localStorage);
}

/* ─── 每個白板上次的畫面位置（個人瀏覽狀態，不寫進檔案） ─── */

const CAM_PREFIX = "banyan.boardCamera.";

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

export function forgetCamera(name: string): void {
  try {
    localStorage.removeItem(CAM_PREFIX + name);
  } catch {
    /* 無所謂 */
  }
}
