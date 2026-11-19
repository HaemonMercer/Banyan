import { beforeEach, describe, expect, it, vi } from "vitest";

// 每個測試重新載入模組（模組裡有共用的狀態）
let lib: typeof import("./styleLibrary");
beforeEach(async () => {
  vi.resetModules();
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  lib = await import("./styleLibrary");
});

describe("共用的區塊樣式 styleLibrary", () => {
  it("檔案格式：讀寫一樣；壞掉的、空的是空清單", () => {
    const list = [{ name: "Card", css: "padding: 6pt 6pt 6pt 6pt" }];
    expect(lib.parseStyleFile(lib.serializeStyleFile(list))).toEqual(list);
    expect(lib.serializeStyleFile([])).toBe("");
    expect(lib.parseStyleFile("{oops")).toEqual([]);
    expect(lib.parseStyleFile('[{"name":"A","css":"margin: 1pt"}]')).toEqual([{ name: "A", css: "margin: 1pt 1pt 1pt 1pt" }]);
  });

  it("改清單會存起來，並把 restyle 交給 App", async () => {
    const seen: string[] = [];
    lib.setRestyleAll((fn) => seen.push(fn({ css: "", name: "A" })?.name ?? "removed"));
    lib.changeStyles([{ name: "B", css: "" }], (v) => (v.name === "A" ? { ...v, name: "B" } : v));
    await lib.loadStyles();
    await Promise.resolve();
    expect(seen).toEqual(["B"]);
    expect(lib.parseStyleFile(localStorage.getItem("banyan.blockStyles") ?? "")).toEqual([{ name: "B", css: "" }]);
  });

  it("舊的每份文件的樣式併進來：一樣的略過，同名不同樣子的改名", async () => {
    localStorage.setItem("banyan.blockStyles", lib.serializeStyleFile([{ name: "Card", css: "font-size: 9pt" }]));
    const renames = await lib.adoptStyles([
      { name: "card", css: "font-size: 9pt" },
      { name: "Card", css: "font-size: 20pt" },
      { name: "Note", css: "" },
    ]);
    expect([...renames]).toEqual([["Card", "Card 2"]]);
    expect(lib.parseStyleFile(localStorage.getItem("banyan.blockStyles") ?? "").map((s) => s.name)).toEqual(["Card", "Card 2", "Note"]);
  });
});
