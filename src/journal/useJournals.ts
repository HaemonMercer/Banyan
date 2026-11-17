import { useCallback, useEffect, useRef, useState } from "react";
import { isBlank, type JournalStore } from "./journal";

export interface Journals {
  /** 有寫的日期（還沒讀完清單時是 null） */
  dates: Set<string> | null;
  /** 已讀進來的內容 */
  contents: Record<string, string>;
  /** 讀一天（已經讀過就不再讀） */
  load: (date: string) => void;
  /** 改一天的內容（稍後自動寫入） */
  update: (date: string, content: string) => void;
  /** 還有沒寫入的修改 */
  saving: boolean;
}

const SAVE_DELAY = 400;

/** 日記的讀寫：內容快取在記憶體，修改後延遲一下才寫入（連續打字只寫一次）。 */
export function useJournals(store: JournalStore): Journals {
  const [dates, setDates] = useState<Set<string> | null>(null);
  const [contents, setContents] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const loading = useRef(new Set<string>());
  const pending = useRef(new Map<string, string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    let alive = true;
    storeRef.current
      .list()
      .then((ds) => alive && setDates(new Set(ds)))
      .catch((err) => {
        console.error("讀不到日記清單", err);
        if (alive) setDates(new Set());
      });
    return () => {
      alive = false;
    };
  }, []);

  const load = useCallback((date: string) => {
    if (loading.current.has(date)) return;
    loading.current.add(date);
    storeRef.current
      .read(date)
      .catch((err) => {
        console.error("讀不到日記", date, err);
        return "";
      })
      // 讀的時候已經改過（例如還沒讀完就開始打字）就以改過的為準
      .then((s) => setContents((c) => (date in c ? c : { ...c, [date]: s })));
  }, []);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const items = [...pending.current];
    pending.current.clear();
    if (!items.length) return;
    void Promise.all(
      items.map(([date, content]) =>
        storeRef.current.write(date, content).catch((err) => console.error("無法儲存日記", date, err)),
      ),
    ).then(() => {
      if (!pending.current.size) setSaving(false);
    });
  }, []);

  const update = useCallback(
    (date: string, content: string) => {
      loading.current.add(date);
      setContents((c) => ({ ...c, [date]: content }));
      setDates((ds) => {
        const blank = isBlank(content);
        if (!ds || ds.has(date) === !blank) return ds;
        const next = new Set(ds);
        if (blank) next.delete(date);
        else next.add(date);
        return next;
      });
      pending.current.set(date, content);
      setSaving(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY);
    },
    [flush],
  );

  // 關閉視窗、切換畫面時把沒寫入的修改寫掉
  useEffect(() => {
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [flush]);

  return { dates, contents, load, update, saving };
}
