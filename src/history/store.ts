import { invoke, isTauri } from "@tauri-apps/api/core";
import { nameVersion, parseIndex, recordVersion, serializeIndex, type Version, type VersionIndex } from "./versions";

/**
 * 版本歷史的儲存：App 裡是資料夾的 `history/<種類>/<名稱>/`（Rust 指令 history_read／history_write，
 * `index.json` 加上每個版本一個 `<id>.txt`）；只有前端時存在 localStorage。
 */

export type HistoryKind = "journals" | "pages" | "desk";

export interface HistoryFiles {
  read(kind: HistoryKind, key: string, file: string): Promise<string>;
  /** 內容是空字串就刪掉 */
  write(kind: HistoryKind, key: string, file: string, content: string): Promise<void>;
}

const PREFIX = "banyan.history.";

export function localHistoryFiles(storage: Storage): HistoryFiles {
  const k = (kind: string, key: string, file: string) => `${PREFIX}${kind}.${key}/${file}`;
  return {
    async read(kind, key, file) {
      return storage.getItem(k(kind, key, file)) ?? "";
    },
    async write(kind, key, file, content) {
      if (!content) storage.removeItem(k(kind, key, file));
      else storage.setItem(k(kind, key, file), content);
    },
  };
}

function tauriHistoryFiles(): HistoryFiles {
  return {
    read: (kind, key, file) => invoke<string>("history_read", { kind, key, file }),
    write: (kind, key, file, content) => invoke<void>("history_write", { kind, key, file, content }),
  };
}

export function defaultHistoryFiles(): HistoryFiles {
  return isTauri() ? tauriHistoryFiles() : localHistoryFiles(window.localStorage);
}

/**
 * 一種文件的版本紀錄。同一份文件的操作排隊依序做（存檔很頻繁，不能兩次同時改清單）。
 * 清單讀過就記在記憶體裡，最新版本的內容也記著（判斷有沒有改，不用每次讀檔）。
 */
export class VersionLog {
  private queue = new Map<string, Promise<unknown>>();
  private indexes = new Map<string, VersionIndex>();
  private latest = new Map<string, string>();
  private restoring = new Map<string, number>();
  /** 清單有變的時候通知畫面（版本歷史面板開著時跟著更新） */
  private listeners = new Set<(key: string) => void>();

  constructor(
    readonly kind: HistoryKind,
    private files: HistoryFiles,
    private clock: () => number = Date.now,
  ) {}

  private run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queue.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.queue.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  }

  private async index(key: string): Promise<VersionIndex> {
    let ix = this.indexes.get(key);
    if (!ix) {
      ix = parseIndex(await this.files.read(this.kind, key, "index.json").catch(() => ""));
      this.indexes.set(key, ix);
    }
    return ix;
  }

  private async save(key: string, ix: VersionIndex): Promise<void> {
    this.indexes.set(key, ix);
    await this.files.write(this.kind, key, "index.json", ix.versions.length ? serializeIndex(ix) : "");
    for (const fn of this.listeners) fn(key);
  }

  subscribe(fn: (key: string) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /** 下一次記錄這份文件時，標成「還原自 at 的版本」並開新版本。 */
  markRestore(key: string, at: number): void {
    this.restoring.set(key, at);
  }

  /** 存檔之後記錄版本（prev 是存檔前、磁碟上的內容）。空白內容（刪掉文件）不記。 */
  record(key: string, content: string, prev?: string): Promise<void> {
    const restored = this.restoring.get(key);
    this.restoring.delete(key);
    if (!content.trim()) return Promise.resolve();
    return this.run(key, async () => {
      const ix = await this.index(key);
      let latest = this.latest.get(key);
      const last = ix.versions[ix.versions.length - 1];
      if (latest === undefined && last) {
        latest = await this.files.read(this.kind, key, `${last.id}.txt`).catch(() => undefined);
      }
      const r = recordVersion(ix, content, this.clock(), { prev, latest, restored });
      if (!r.changed) return;
      for (const w of r.write) await this.files.write(this.kind, key, `${w.id}.txt`, w.content);
      for (const id of r.remove) await this.files.write(this.kind, key, `${id}.txt`, "");
      this.latest.set(key, content);
      await this.save(key, r.index);
    }).catch((err) => console.error("Couldn't record a version", key, err));
  }

  list(key: string): Promise<Version[]> {
    return this.run(key, async () => (await this.index(key)).versions);
  }

  read(key: string, id: string): Promise<string> {
    return this.run(key, () => this.files.read(this.kind, key, `${id}.txt`));
  }

  /** 命名一個版本（空字串拿掉名稱）。 */
  rename(key: string, id: string, name: string): Promise<void> {
    return this.run(key, async () => this.save(key, nameVersion(await this.index(key), id, name)));
  }

  /** 命名目前的內容（Name current version）：最新版本就是目前的內容時直接命名它，否則先記成新版本。 */
  nameCurrent(key: string, content: string, name: string): Promise<void> {
    return this.run(key, async () => {
      const ix = await this.index(key);
      const last = ix.versions[ix.versions.length - 1];
      const latest = this.latest.get(key) ?? (last ? await this.files.read(this.kind, key, `${last.id}.txt`).catch(() => undefined) : undefined);
      let next = ix;
      if (!last || latest !== content) {
        const r = recordVersion(ix, content, this.clock(), { latest, fresh: true });
        for (const w of r.write) await this.files.write(this.kind, key, `${w.id}.txt`, w.content);
        for (const id of r.remove) await this.files.write(this.kind, key, `${id}.txt`, "");
        this.latest.set(key, content);
        next = r.index;
      }
      const top = next.versions[next.versions.length - 1];
      await this.save(key, top ? nameVersion(next, top.id, name) : next);
    });
  }

  /**
   * 文件改名：copy 時把版本一份一份抄到新名稱、刪掉舊的（瀏覽器預覽；App 裡 Rust 的 desk_rename
   * 已經搬了資料夾，copy 是 false，只要忘記記憶體裡的清單）。
   */
  move(from: string, to: string, copy: boolean): Promise<void> {
    const forget = () => {
      for (const k of [from, to]) {
        this.indexes.delete(k);
        this.latest.delete(k);
        this.restoring.delete(k);
      }
    };
    if (!copy) {
      forget();
      return Promise.resolve();
    }
    return this.run(from, async () => {
      const ix = await this.index(from);
      for (const v of ix.versions) {
        const text = await this.files.read(this.kind, from, `${v.id}.txt`).catch(() => "");
        if (text) await this.files.write(this.kind, to, `${v.id}.txt`, text);
      }
      if (ix.versions.length) await this.files.write(this.kind, to, "index.json", serializeIndex(ix));
      for (const v of ix.versions) await this.files.write(this.kind, from, `${v.id}.txt`, "");
      await this.files.write(this.kind, from, "index.json", "");
      forget();
    });
  }

  /** 忘記記憶體裡的清單（換資料夾之後） */
  reset(): void {
    this.indexes.clear();
    this.latest.clear();
  }
}

