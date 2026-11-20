import { useCallback, useEffect, useRef, useState } from "react";
import { isBlank } from "./journal";

/** 一組 Markdown 文件的儲存（日記：鍵是日期；頁面：鍵是頁面名稱）。 */
export interface DocStore {
  /** 有內容的文件 */
  list(): Promise<string[]>;
  /** 一份文件的內容（沒有就是空字串） */
  read(key: string): Promise<string>;
  /** 寫入；只有空白就刪掉 */
  write(key: string, content: string): Promise<void>;
  /** 改名（有的話 `Docs.rename` 用它；沒有就寫新的、刪舊的） */
  rename?(from: string, to: string): Promise<void>;
}

export interface Docs {
  /** 有內容的文件（還沒讀完清單時是 null） */
  dates: Set<string> | null;
  /** 已讀進來的內容 */
  contents: Record<string, string>;
  /** 清單裡的文件都讀進來了（反向連結、任務總覽要等它） */
  ready: boolean;
  /** 讀一份（已經讀過就不再讀） */
  load: (key: string) => void;
  /** 改一份的內容（稍後自動寫入） */
  update: (key: string, content: string) => void;
  /** 依目前（最新）的內容修改一份；還沒讀進來時先讀 */
  modify: (key: string, fn: (content: string) => string) => void;
  /** 改名：先把沒寫入的修改寫掉，再搬檔案，記憶體裡的內容跟著換鍵（失敗會丟出錯誤） */
  rename: (from: string, to: string) => Promise<void>;
  /** 還有沒寫入的修改 */
  saving: boolean;
}

/** 舊名稱：日記用的就是一般的文件組 */
export type Journals = Docs;

const SAVE_DELAY = 400;

/**
 * 文件的讀寫：啟動時讀清單並把全部內容讀進記憶體（反向連結、任務總覽要看全部），
 * 修改後延遲一下才寫入（連續打字只寫一次）。
 */
export function useDocs(store: DocStore, onSaved?: (key: string, content: string, prev: string | undefined) => void): Docs {
  const [dates, setDates] = useState<Set<string> | null>(null);
  const [contents, setContents] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const contentsRef = useRef(contents);
  contentsRef.current = contents;
  const loading = useRef(new Map<string, Promise<string>>());
  const pending = useRef(new Map<string, string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storeRef = useRef(store);
  storeRef.current = store;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  /** 磁碟上的內容（讀進來的或最後寫入的；版本歷史要知道存檔前的樣子） */
  const onDisk = useRef(new Map<string, string>());

  const read = useCallback((key: string): Promise<string> => {
    let p = loading.current.get(key);
    if (!p) {
      p = storeRef.current.read(key).catch((err) => {
        console.error("Couldn't read the document", key, err);
        return "";
      });
      loading.current.set(key, p);
      void p.then((s) => {
        if (!onDisk.current.has(key)) onDisk.current.set(key, s);
      });
      // 讀的時候已經改過（例如還沒讀完就開始打字）就以改過的為準
      void p.then((s) =>
        setContents((c) => {
          if (key in c) return c;
          const next = { ...c, [key]: s };
          contentsRef.current = next;
          return next;
        }),
      );
    }
    return p;
  }, []);

  useEffect(() => {
    let alive = true;
    storeRef.current
      .list()
      .catch((err) => {
        console.error("Couldn't read the document list", err);
        return [] as string[];
      })
      .then(async (keys) => {
        if (!alive) return;
        await Promise.all(keys.map(read));
        if (alive) setDates((ds) => new Set([...keys, ...(ds ?? [])]));
      });
    return () => {
      alive = false;
    };
  }, [read]);

  const load = useCallback((key: string) => void read(key), [read]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const items = [...pending.current];
    pending.current.clear();
    if (!items.length) return Promise.resolve();
    return Promise.all(
      items.map(([key, content]) =>
        storeRef.current.write(key, content).then(
          () => {
            const prev = onDisk.current.get(key);
            onDisk.current.set(key, content);
            onSavedRef.current?.(key, content, prev);
          },
          (err) => console.error("Couldn't save", key, err),
        ),
      ),
    ).then(() => {
      if (!pending.current.size) setSaving(false);
    });
  }, []);

  const rename = useCallback(
    async (from: string, to: string) => {
      if (from === to) return;
      await flush();
      const content = contentsRef.current[from] ?? (await read(from));
      const store = storeRef.current;
      if (store.rename) await store.rename(from, to);
      else {
        await store.write(to, content);
        await store.write(from, "");
      }
      const next = { ...contentsRef.current, [to]: content };
      delete next[from];
      contentsRef.current = next;
      setContents(next);
      setDates((ds) => {
        const out = new Set(ds ?? []);
        out.delete(from);
        if (!isBlank(content)) out.add(to);
        return out;
      });
      loading.current.delete(from);
      loading.current.set(to, Promise.resolve(content));
      const disk = onDisk.current.get(from);
      onDisk.current.delete(from);
      if (disk !== undefined) onDisk.current.set(to, disk);
    },
    [flush, read],
  );

  const update = useCallback(
    (key: string, content: string) => {
      if (!loading.current.has(key)) loading.current.set(key, Promise.resolve(content));
      const next = { ...contentsRef.current, [key]: content };
      contentsRef.current = next;
      setContents(next);
      setDates((ds) => {
        const blank = isBlank(content);
        const has = !!ds?.has(key);
        if (has === !blank) return ds;
        const out = new Set(ds ?? []);
        if (blank) out.delete(key);
        else out.add(key);
        return out;
      });
      pending.current.set(key, content);
      setSaving(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY);
    },
    [flush],
  );

  const modify = useCallback(
    (key: string, fn: (content: string) => string) => {
      if (key in contentsRef.current) update(key, fn(contentsRef.current[key]));
      else void read(key).then(() => update(key, fn(contentsRef.current[key] ?? "")));
    },
    [read, update],
  );

  // 關閉視窗、切換畫面時把沒寫入的修改寫掉
  useEffect(() => {
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [flush]);

  return { dates, contents, ready: dates !== null, load, update, modify, rename, saving };
}

/** 舊名稱 */
export const useJournals = useDocs;
