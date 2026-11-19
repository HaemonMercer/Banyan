import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * 資料的儲存位置（設定畫面用）。
 * 所有資料夾（journals/、pages/、media/、desk/、databases/）放在同一個地方；
 * 位置由 Rust 記在 App 設定資料夾的 settings.json（`storage_info`、`storage_set`）。
 * 瀏覽器預覽時資料在 localStorage，沒有位置可以換。
 */

export interface StorageInfo {
  /** 目前的資料夾 */
  dir: string;
  /** 預設的 App 資料夾 */
  defaultDir: string;
  /** 是不是使用者自己選的資料夾 */
  custom: boolean;
}

export const canChooseStorage = (): boolean => isTauri();

export function storageInfo(): Promise<StorageInfo | null> {
  return isTauri() ? invoke<StorageInfo>("storage_info") : Promise.resolve(null);
}

/** 換資料夾（null 是回到預設位置）；copy 時把目前的資料複製過去，不覆蓋新位置已有的檔案。 */
export function setStorage(dir: string | null, copy: boolean): Promise<StorageInfo> {
  return invoke<StorageInfo>("storage_set", { dir, copy });
}

/** 選資料夾的對話框；取消就是 null。 */
export async function pickFolder(start?: string): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, multiple: false, defaultPath: start, title: "Choose a folder for your notes" });
  return typeof picked === "string" ? picked : null;
}

/** 在檔案總管裡顯示資料夾。 */
export async function revealFolder(dir: string): Promise<void> {
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(dir);
}

/** 兩個路徑是不是同一個資料夾（Windows 不分大小寫、斜線方向與結尾斜線不計）。 */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/[\\/]+/g, "\\").replace(/\\$/, "").toLowerCase();
  return norm(a) === norm(b);
}
