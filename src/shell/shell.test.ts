// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyTheme, forgetTarget, isFavorite, pushRecent, toggleFavorite, type NavTarget } from "./nav";
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
    expect(matchShortcut(ev("Digit3", { altKey: true }))).toBeNull();
    expect(matchShortcut(ev("KeyW", { altKey: true }))).toBeNull();
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
