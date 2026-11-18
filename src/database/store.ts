import { invoke, isTauri } from "@tauri-apps/api/core";
import type { DocStore } from "../journal/useJournals";

/**
 * 資料庫的儲存：App 資料夾的 `databases/名稱.json`（Rust 指令 database_list／database_read／database_write，
 * 檔名和頁面一樣用 URL 編碼）；只有前端時存在 localStorage。內容是空字串就刪掉。
 * 用和日記、頁面相同的 `useDocs` 管理（內容是 JSON 字串）。
 */

const PREFIX = "banyan.database.";

export function localDatabaseStore(storage: Storage): DocStore {
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

function tauriDatabaseStore(): DocStore {
  return {
    list: () => invoke<string[]>("database_list"),
    read: (name) => invoke<string>("database_read", { name }),
    write: (name, content) => invoke<void>("database_write", { name, content }),
  };
}

export function defaultDatabaseStore(): DocStore {
  return isTauri() ? tauriDatabaseStore() : localDatabaseStore(window.localStorage);
}
