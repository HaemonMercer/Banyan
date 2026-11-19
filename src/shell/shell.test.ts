// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyTheme, forgetFileTargets, forgetTarget, isFavorite, loadTargets, pushRecent, targetKey, toggleFavorite, type NavTarget } from "./nav";
import { matchShortcut } from "./shortcuts";

const day = (date: string): NavTarget => ({ kind: "day", date });
const page = (name: string): NavTarget => ({ kind: "page", name });

describe("最近與收藏", () => {
  it("最近：新的放最前面、去掉重複、有上限", () => {
    let list: NavTarget[] = [];
    list = pushRecent(list, page("A"));
    list = pushRecent(list, day("2026-11-17"));
    list = pushRecent(list, page("A"));
    expect(list).toEqual([page("A"), day("2026-11-17")]);
    for (let i = 0; i < 20; i++) list = pushRecent(list, page(`P${i}`), 5);
    expect(list).toHaveLength(5);
    expect(list[0]).toEqual(page("P19"));
  });

  it("收藏：切換", () => {
    let fav = toggleFavorite([], page("A"));
    fav = toggleFavorite(fav, day("2026-11-17"));
    expect(isFavorite(fav, page("A"))).toBe(true);
    fav = toggleFavorite(fav, page("A"));
    expect(fav).toEqual([day("2026-11-17")]);
  });

  it("刪除文件時從清單拿掉；不在清單裡就原樣傳回", () => {
    const list = [page("A"), day("2026-11-17"), page("B")];
    expect(forgetTarget(list, page("A"))).toEqual([day("2026-11-17"), page("B")]);
    expect(forgetTarget(list, day("2026-11-17"))).toEqual([page("A"), page("B")]);
    expect(forgetTarget(list, page("C"))).toBe(list);
  });
});

describe("Dock 文件的最近與收藏", () => {
  const doc = (file: string, id: string): NavTarget => ({ kind: "doc", file, id });
  it("同一份文件只留一筆，不同檔案的同 id 是不同文件", () => {
    let r: NavTarget[] = [];
    r = pushRecent(r, doc("Trip", "a"));
    r = pushRecent(r, { kind: "file", name: "Trip" });
    r = pushRecent(r, doc("Work", "a"));
    r = pushRecent(r, doc("Trip", "a"));
    expect(r.map(targetKey)).toEqual([targetKey(doc("Trip", "a")), targetKey(doc("Work", "a")), "file:Trip"]);
    expect(isFavorite(toggleFavorite([], doc("Trip", "a")), doc("Trip", "a"))).toBe(true);
  });
  it("刪除檔案時連它的文件一起拿掉", () => {
    const list: NavTarget[] = [doc("Trip", "a"), { kind: "file", name: "Trip" }, doc("Work", "b"), { kind: "page", name: "Trip" }];
    expect(forgetFileTargets(list, "Trip")).toEqual([doc("Work", "b"), { kind: "page", name: "Trip" }]);
  });
  it("從 localStorage 讀回來，格式不對的略過", () => {
    localStorage.setItem("t.test", JSON.stringify([doc("Trip", "a"), { kind: "doc", file: "Trip" }, { kind: "doc", file: "", id: "x" }]));
    expect(loadTargets("t.test")).toEqual([doc("Trip", "a")]);
    localStorage.removeItem("t.test");
  });
});

describe("主題", () => {
  it("系統主題拿掉 data-theme", () => {
    const el = document.createElement("html");
    applyTheme("dark", el);
    expect(el.dataset.theme).toBe("dark");
    applyTheme("system", el);
    expect(el.dataset.theme).toBeUndefined();
  });
});

describe("快捷鍵", () => {
  const ev = (code: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
    code,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  });

  it("Alt 組合鍵", () => {
    expect(matchShortcut(ev("KeyT", { altKey: true }))).toBe("today");
    expect(matchShortcut(ev("Digit1", { altKey: true }))).toBe("view-bujo");
    expect(matchShortcut(ev("Digit2", { altKey: true }))).toBe("view-desk");
    expect(matchShortcut(ev("Digit3", { altKey: true }))).toBe("view-drawer");
    expect(matchShortcut(ev("Digit4", { altKey: true }))).toBeNull();
    expect(matchShortcut(ev("Comma", { altKey: true }))).toBe("settings");
    expect(matchShortcut(ev("KeyW", { altKey: true }))).toBeNull();
    expect(matchShortcut(ev("KeyD", { altKey: true }))).toBe("desk-switch");
    expect(matchShortcut(ev("ArrowLeft", { altKey: true }))).toBe("back");
  });

  it("Ctrl 組合鍵", () => {
    expect(matchShortcut(ev("Backslash", { ctrlKey: true }))).toBe("toggle-sidebar");
    expect(matchShortcut(ev("Slash", { metaKey: true }))).toBe("help");
  });

  it("沒有 code 時用 key", () => {
    expect(matchShortcut({ ...ev("", { ctrlKey: true }), key: "/" })).toBe("help");
    expect(matchShortcut({ ...ev("", { altKey: true }), key: "t" })).toBe("today");
  });

  it("不攔編輯器的按鍵", () => {
    expect(matchShortcut(ev("KeyB", { ctrlKey: true }))).toBeNull();
    expect(matchShortcut(ev("KeyT"))).toBeNull();
    expect(matchShortcut(ev("KeyT", { altKey: true, shiftKey: true }))).toBeNull();
    expect(matchShortcut(ev("KeyT", { altKey: true, ctrlKey: true }))).toBeNull();
  });
});

describe("儲存位置", () => {
  it("同一個資料夾不分大小寫、斜線與結尾斜線", async () => {
    const { samePath } = await import("./storage");
    expect(samePath("D:\\Notes\\", "d:/notes")).toBe(true);
    expect(samePath("D:\\Notes", "D:\\Notes2")).toBe(false);
  });
});

describe("更新", () => {
  it("檔案大小與錯誤訊息", async () => {
    const { sizeText, updateError } = await import("./updates");
    expect(sizeText(512)).toBe("512 B");
    expect(sizeText(2048)).toBe("2 KB");
    expect(sizeText(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(updateError(new Error("Could not fetch a valid release JSON"))).toMatch(/update server/);
    expect(updateError("signature mismatch")).toBe("signature mismatch");
  });
});
