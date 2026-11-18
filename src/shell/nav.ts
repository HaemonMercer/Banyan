/**
 * 側邊欄的狀態：收藏、最近開過的日記與頁面、側邊欄收合、主題。
 * 都只是使用者偏好，存在 localStorage；讀寫失敗就用預設值，不影響使用。
 */

/** 可以收藏、會出現在「最近」的目標：某天的日記、某個頁面、某個資料庫或 Desk 的某個檔案。 */
export type NavTarget =
  | { kind: "day"; date: string }
  | { kind: "page"; name: string }
  | { kind: "file"; name: string };

export function targetKey(t: NavTarget): string {
  return t.kind === "day" ? `day:${t.date}` : `${t.kind}:${t.name}`;
}

export function sameTarget(a: NavTarget, b: NavTarget): boolean {
  return targetKey(a) === targetKey(b);
}

function isTarget(v: unknown): v is NavTarget {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return false;
  if (o.kind === "day") return typeof o.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.date);
  if (o.kind === "page" || o.kind === "file") return typeof o.name === "string" && o.name.trim() !== "";
  return false;
}

export const RECENT_LIMIT = 8;

/** 把目標放到最近清單的最前面（去掉重複的），最多留 limit 筆。 */
export function pushRecent(list: NavTarget[], t: NavTarget, limit = RECENT_LIMIT): NavTarget[] {
  return [t, ...list.filter((x) => !sameTarget(x, t))].slice(0, limit);
}

/** 收藏或取消收藏；新收藏的加在最後面。 */
export function toggleFavorite(list: NavTarget[], t: NavTarget): NavTarget[] {
  return list.some((x) => sameTarget(x, t)) ? list.filter((x) => !sameTarget(x, t)) : [...list, t];
}

/** 從收藏或最近清單拿掉一個目標（刪除文件時用）。 */
export function forgetTarget(list: NavTarget[], t: NavTarget): NavTarget[] {
  return list.some((x) => sameTarget(x, t)) ? list.filter((x) => !sameTarget(x, t)) : list;
}

export function isFavorite(list: NavTarget[], t: NavTarget): boolean {
  return list.some((x) => sameTarget(x, t));
}

export function loadTargets(key: string): NavTarget[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.filter(isTarget) : [];
  } catch {
    return [];
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 記不住偏好也沒關係 */
  }
}

export function loadJson<T>(key: string, fallback: T, ok: (v: unknown) => boolean): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const v = JSON.parse(raw);
    return ok(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

export const FAVORITES_KEY = "banyan.favorites";
export const RECENTS_KEY = "banyan.recents";
export const SIDEBAR_KEY = "banyan.sidebar";
export const THEME_KEY = "banyan.theme";

/* ─── 主題 ─── */

export type ThemePref = "system" | "light" | "dark";

export function loadTheme(): ThemePref {
  return loadJson<ThemePref>(THEME_KEY, "system", (v) => v === "system" || v === "light" || v === "dark");
}

/** 系統：拿掉 data-theme，交給 prefers-color-scheme；淺色／深色：固定。 */
export function applyTheme(pref: ThemePref, root: HTMLElement = document.documentElement): void {
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
}
