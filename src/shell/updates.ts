import { isTauri } from "@tauri-apps/api/core";
import type { Update } from "@tauri-apps/plugin-updater";

/**
 * 手動檢查 App 新版本（設定畫面用）。
 * 用 Tauri updater：tauri.conf.json 的 `plugins.updater.endpoints` 指向 GitHub Releases 的 latest.json，
 * 安裝檔要用 ~/.tauri/banyan.key 簽章（`TAURI_SIGNING_PRIVATE_KEY`）。瀏覽器預覽沒有更新。
 */

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "latest"; checked: Date }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; version: string; done: number; total: number | null }
  | { kind: "error"; message: string };

export const canUpdate = (): boolean => isTauri();

export async function appVersion(): Promise<string | null> {
  if (!isTauri()) return null;
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

/** 有新版本就回傳 Update，否則 null。 */
export async function checkUpdate(): Promise<Update | null> {
  const { check } = await import("@tauri-apps/plugin-updater");
  return check();
}

/** 下載並安裝，完成後重新啟動 App；progress 回報已下載與總位元組。 */
export async function installUpdate(update: Update, progress: (done: number, total: number | null) => void) {
  let done = 0;
  let total: number | null = null;
  await update.downloadAndInstall((e) => {
    if (e.event === "Started") total = e.data.contentLength ?? null;
    else if (e.event === "Progress") done += e.data.chunkLength;
    progress(done, total);
  });
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

/** 錯誤訊息：抓不到 latest.json（還沒發佈過、沒有網路）時說得明白一點。 */
export function updateError(e: unknown): string {
  const msg = String(e instanceof Error ? e.message : e);
  if (/fetch|network|request|404|status|json/i.test(msg)) {
    return `Couldn't reach the update server. Check your connection, or no release has been published yet. (${msg})`;
  }
  return msg;
}

/** 位元組 → 「3.2 MB」 */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
