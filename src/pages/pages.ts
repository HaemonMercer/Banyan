import { invoke, isTauri } from "@tauri-apps/api/core";
import { isBlank, isDateKey } from "../journal/journal";
import type { DocStore } from "../journal/useJournals";
import { cleanName, pageKey } from "./pageRef";

/**
 * 頁面：`[[名稱]]` 連到的文件。App 裡存在 App 資料夾的 `pages/名稱.md`（Rust 指令
 * page_list／page_read／page_write）；只有前端時存在 localStorage。
 */

const PREFIX = "banyan.page.";

export function localPageStore(storage: Storage): DocStore {
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
      if (isBlank(content)) storage.removeItem(PREFIX + name);
      else storage.setItem(PREFIX + name, content);
    },
  };
}

function tauriPageStore(): DocStore {
  return {
    list: () => invoke<string[]>("page_list"),
    read: (name) => invoke<string>("page_read", { name }),
    write: (name, content) => invoke<void>("page_write", { name, content: isBlank(content) ? "" : content }),
  };
}

export function defaultPageStore(): DocStore {
  return isTauri() ? tauriPageStore() : localPageStore(window.localStorage);
}

/** 連結的目標：日記的某一天，或某個頁面。 */
export type Target = { kind: "day"; date: string } | { kind: "page"; name: string };

/**
 * 連結名稱 → 目標。`[[2026-11-17]]` 是那天的日記；其他是頁面，
 * 已經有同名（不分大小寫）的頁面就用它的寫法。
 */
export function resolveTarget(name: string, existing: Iterable<string>): Target | null {
  const n = cleanName(name);
  if (!n) return null;
  if (isDateKey(n)) return { kind: "day", date: n };
  const k = pageKey(n);
  for (const e of existing) if (pageKey(e) === k) return { kind: "page", name: e };
  return { kind: "page", name: n };
}
