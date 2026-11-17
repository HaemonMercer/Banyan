import { describe, expect, it } from "vitest";
import {
  addDays,
  dateKey,
  dayTitle,
  daysBetween,
  isBlank,
  isDateKey,
  localStore,
  monthGrid,
  relativeLabel,
  streamDays,
  weekday,
} from "./journal";

/** 測試用的 Storage（Node 環境沒有 localStorage） */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

describe("日期", () => {
  it("日期鍵用當地時間", () => {
    expect(dateKey(new Date(2026, 10, 17, 23, 59))).toBe("2026-11-17");
    expect(dateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("檢查日期鍵", () => {
    expect(isDateKey("2026-11-17")).toBe(true);
    expect(isDateKey("2026-02-30")).toBe(false);
    expect(isDateKey("2026-1-17")).toBe(false);
    expect(isDateKey("../x")).toBe(false);
  });

  it("加減日子跨月、跨年", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(daysBetween("2026-11-17", "2026-12-01")).toBe(14);
  });

  it("標題、星期、相對日子", () => {
    expect(dayTitle("2026-11-17", "2026-11-17")).toBe("11 月 17 日");
    expect(dayTitle("2025-12-31", "2026-11-17")).toBe("2025 年 12 月 31 日");
    expect(weekday("2026-11-17")).toBe("星期二");
    expect(relativeLabel("2026-11-17", "2026-11-17")).toBe("今天");
    expect(relativeLabel("2026-11-16", "2026-11-17")).toBe("昨天");
    expect(relativeLabel("2026-11-15", "2026-11-17")).toBe("前天");
    expect(relativeLabel("2026-11-18", "2026-11-17")).toBe("明天");
    expect(relativeLabel("2026-11-10", "2026-11-17")).toBe("");
  });
});

describe("日記串與月曆", () => {
  it("今天一定在最上面；未來的日子不放進日記串", () => {
    expect(streamDays(["2026-11-10", "2026-11-20", "2026-11-15"], "2026-11-17")).toEqual([
      "2026-11-17",
      "2026-11-15",
      "2026-11-10",
    ]);
    expect(streamDays(["2026-11-17"], "2026-11-17")).toEqual(["2026-11-17"]);
  });

  it("月曆從星期日開始，6 週", () => {
    const g = monthGrid(2026, 11);
    expect(g).toHaveLength(6);
    expect(g[0][0]).toBe("2026-11-01"); // 2026-11-01 是星期日
    expect(g[5][6]).toBe("2026-12-12");
    const feb = monthGrid(2026, 2);
    expect(feb[0][0]).toBe("2026-02-01");
    expect(monthGrid(2026, 12)[0][0]).toBe("2026-11-29");
  });
});

describe("localStorage 儲存", () => {
  it("寫入、讀取、列出（新的在前）", async () => {
    const store = localStore(memoryStorage());
    await store.write("2026-11-15", "- 散步");
    await store.write("2026-11-17", "# 今天\n\n寫日記");
    expect(await store.list()).toEqual(["2026-11-17", "2026-11-15"]);
    expect(await store.read("2026-11-17")).toBe("# 今天\n\n寫日記");
    expect(await store.read("2026-11-16")).toBe("");
  });

  it("內容只剩空白（或空白區塊）就刪掉", async () => {
    const storage = memoryStorage();
    const store = localStore(storage);
    await store.write("2026-11-17", "寫日記");
    await store.write("2026-11-17", "&nbsp;\n");
    expect(await store.list()).toEqual([]);
    expect(storage.length).toBe(0);
    expect(isBlank(" \n&nbsp;\n\n")).toBe(true);
    expect(isBlank("a")).toBe(false);
  });

  it("不是日記的 key 不列出", async () => {
    const storage = memoryStorage();
    storage.setItem("banyan.document", "x");
    storage.setItem("banyan.journal.bad", "x");
    expect(await localStore(storage).list()).toEqual([]);
  });
});
