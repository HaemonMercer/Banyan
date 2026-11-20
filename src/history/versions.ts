import { monthName } from "../journal/journal";

/**
 * 版本歷史（參考 Google Docs 的 Version history）的純函式。
 *
 * 每份文件（日記的一天、頁面、Desk 的檔案）有一份版本清單（`index.json`），每個版本的內容另存一個檔案。
 * 存檔時記錄版本：同一段連續編輯（離上個版本不到 `SESSION_GAP`、整段不超過 `SESSION_MAX`）
 * 只更新最後一個版本，所以一個版本代表「一段編輯結束時的樣子」。
 * 命名過的、還原產生的、最早的基準版本不再合併（之後的修改一律開新版本）。
 * 沒命名的版本最多留 `MAX_UNNAMED` 個，多的從最舊的刪；命名的版本一律留著。
 */

export interface Version {
  id: string;
  /** 這個版本的時間（最後一次存檔） */
  at: number;
  /** 這段編輯開始的時間 */
  start: number;
  /** 使用者取的名稱（Name this version） */
  name?: string;
  /** 還原舊版本產生的版本：被還原的版本時間 */
  restored?: number;
  /** 第一次記錄時補上的「原本的內容」（不知道確切時間） */
  base?: boolean;
}

export interface VersionIndex {
  /** 由舊到新 */
  versions: Version[];
}

export const SESSION_GAP = 10 * 60_000;
export const SESSION_MAX = 60 * 60_000;
export const MAX_UNNAMED = 150;

export const emptyIndex = (): VersionIndex => ({ versions: [] });

export function parseIndex(json: string): VersionIndex {
  try {
    const raw = JSON.parse(json || "{}");
    const list: unknown[] = Array.isArray(raw?.versions) ? raw.versions : [];
    const versions = list
      .filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
      .filter((v) => typeof v.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v.id) && Number.isFinite(v.at))
      .map((v) => {
        const out: Version = { id: v.id as string, at: v.at as number, start: Number.isFinite(v.start) ? (v.start as number) : (v.at as number) };
        if (typeof v.name === "string" && v.name.trim()) out.name = v.name.trim();
        if (Number.isFinite(v.restored)) out.restored = v.restored as number;
        if (v.base === true) out.base = true;
        return out;
      })
      .sort((a, b) => a.at - b.at);
    return { versions };
  } catch {
    return emptyIndex();
  }
}

export const serializeIndex = (ix: VersionIndex): string => JSON.stringify({ versions: ix.versions }, null, 1) + "\n";

let seq = 0;
export function versionId(now: number): string {
  seq = (seq + 1) % 1296;
  return now.toString(36) + seq.toString(36).padStart(2, "0") + Math.random().toString(36).slice(2, 6);
}

/** 不能再合併進去的版本 */
const frozen = (v: Version) => !!(v.name || v.base || v.restored !== undefined);

/** 記錄一次存檔的結果：要寫的內容檔、要刪的內容檔，以及新的清单。 */
export interface RecordResult {
  index: VersionIndex;
  /** 要寫入的版本內容（id → 內容） */
  write: { id: string; content: string }[];
  /** 要刪掉的版本內容 */
  remove: string[];
  changed: boolean;
}

export interface RecordOptions {
  /** 存檔前的內容（清單是空的時候補成基準版本） */
  prev?: string;
  /** 最新版本的內容（用來判斷有沒有改；不知道就是 undefined） */
  latest?: string;
  /** 這次是還原：被還原的版本時間 */
  restored?: number;
  /** 一定要開新版本 */
  fresh?: boolean;
}

export function recordVersion(ix: VersionIndex, content: string, now: number, opts: RecordOptions = {}): RecordResult {
  const versions = [...ix.versions];
  const write: RecordResult["write"] = [];
  const last = versions[versions.length - 1];
  if (last && opts.latest === content && opts.restored === undefined) {
    return { index: ix, write, remove: [], changed: false };
  }
  if (!last && opts.prev !== undefined && opts.prev.trim() && opts.prev !== content) {
    const id = versionId(now - 1);
    versions.push({ id, at: now - 1, start: now - 1, base: true });
    write.push({ id, content: opts.prev });
  }
  const tail = versions[versions.length - 1];
  const merge =
    !!tail &&
    tail === last &&
    !opts.fresh &&
    opts.restored === undefined &&
    !frozen(tail) &&
    now - tail.at < SESSION_GAP &&
    now - tail.start < SESSION_MAX;
  if (merge) {
    versions[versions.length - 1] = { ...tail, at: now };
    write.push({ id: tail.id, content });
  } else {
    const v: Version = { id: versionId(now), at: now, start: now };
    if (opts.restored !== undefined) v.restored = opts.restored;
    versions.push(v);
    write.push({ id: v.id, content });
  }
  const { kept, removed } = prune(versions);
  return { index: { versions: kept }, write: write.filter((w) => !removed.includes(w.id)), remove: removed, changed: true };
}

/** 沒命名的版本超過上限時刪掉最舊的（最新的一個永遠留著）。 */
export function prune(versions: Version[], max = MAX_UNNAMED): { kept: Version[]; removed: string[] } {
  const unnamed = versions.filter((v, i) => !v.name && i < versions.length - 1);
  const extra = unnamed.length - (max - 1);
  if (extra <= 0) return { kept: versions, removed: [] };
  const removed = new Set(unnamed.slice(0, extra).map((v) => v.id));
  return { kept: versions.filter((v) => !removed.has(v.id)), removed: [...removed] };
}

/** 命名（空字串是拿掉名稱）。 */
export function nameVersion(ix: VersionIndex, id: string, name: string): VersionIndex {
  const n = name.trim();
  return {
    versions: ix.versions.map((v) => {
      if (v.id !== id) return v;
      const out = { ...v };
      if (n) out.name = n;
      else delete out.name;
      return out;
    }),
  };
}

/* ─── 顯示 ─── */

const pad = (n: number) => String(n).padStart(2, "0");
const localKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 「3:45 PM」 */
export function clockText(at: number): string {
  const d = new Date(at);
  const h = d.getHours();
  return `${h % 12 || 12}:${pad(d.getMinutes())} ${h < 12 ? "AM" : "PM"}`;
}

/** 「November 19, 3:45 PM」；不是今年的加上年份。 */
export function versionTime(at: number, now = Date.now()): string {
  const d = new Date(at);
  const year = d.getFullYear() === new Date(now).getFullYear() ? "" : `, ${d.getFullYear()}`;
  return `${monthName(d.getMonth() + 1)} ${d.getDate()}${year}, ${clockText(at)}`;
}

/** 依日期分組（新的在前）：「Today」「Yesterday」「November 17」 */
export function groupByDay<T extends { at: number }>(items: T[], now = Date.now()): { label: string; items: T[] }[] {
  const out: { key: string; label: string; items: T[] }[] = [];
  const today = localKey(new Date(now));
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  const yesterday = localKey(y);
  for (const it of [...items].sort((a, b) => b.at - a.at)) {
    const d = new Date(it.at);
    const key = localKey(d);
    let g = out[out.length - 1];
    if (!g || g.key !== key) {
      const label =
        key === today
          ? "Today"
          : key === yesterday
            ? "Yesterday"
            : `${monthName(d.getMonth() + 1)} ${d.getDate()}${d.getFullYear() === new Date(now).getFullYear() ? "" : `, ${d.getFullYear()}`}`;
      g = { key, label, items: [] };
      out.push(g);
    }
    g.items.push(it);
  }
  return out.map(({ label, items }) => ({ label, items }));
}

/** 副本的名稱：「名稱 (copy)」，已經有了就「名稱 (copy 2)」… */
export function copyName(base: string, taken: (name: string) => boolean): string {
  const first = `${base} (copy)`;
  if (!taken(first)) return first;
  for (let i = 2; ; i++) if (!taken(`${base} (copy ${i})`)) return `${base} (copy ${i})`;
}
