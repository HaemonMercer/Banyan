// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { embedPages } from "../editor/embed";
import { renderInto, serialize } from "../editor/wysiwyg";
import { linkPages } from "../pages/pageRef";
import { inText, locatorText } from "./cite";
import { bibliographyMarkdown, citeItem, citeRemark, setCiteLibrary, setCiteStyle, suggestCites } from "./citeRef";
import {
  addItems,
  addRemark,
  blankItem,
  emptyLibrary,
  matches,
  moveRemark,
  parseCiteName,
  parseLibrary,
  remarkRef,
  removeRemark,
  serializeLibrary,
  updateItem,
  updateRemark,
  type Item,
  type Library,
} from "./model";

function libWith(p: Partial<Item>): Library {
  return addItems(emptyLibrary(), [{ ...blankItem("article", 1), ...p }], 1);
}

const html = (h: string) => {
  const t = document.createElement("template");
  t.innerHTML = h;
  return t.content;
};

describe("Drawer 條目的備註", () => {
  it("新增的備註編號 r1、r2…，刪掉的編號不再使用", () => {
    let lib = libWith({ id: "a", key: "smith2020" });
    const one = addRemark(lib, "a", { text: "First", page: "12" }, 5);
    lib = one.lib;
    expect(one.id).toBe("r1");
    lib = addRemark(lib, "a", { text: "Second" }, 6).lib;
    lib = removeRemark(lib, "a", "r2", 7);
    const three = addRemark(lib, "a", {}, 8);
    expect(three.id).toBe("r3");
    const it = three.lib.items[0];
    expect(it.remarks.map((r) => r.id)).toEqual(["r1", "r3"]);
    expect(it.remarks[0]).toMatchObject({ text: "First", page: "12", added: 5 });
    expect(it.modified).toBe(8);
    expect(addRemark(lib, "nobody").id).toBe("");
  });

  it("改文字、頁碼與順序", () => {
    let lib = libWith({ id: "a", key: "k" });
    lib = addRemark(lib, "a", { text: "A" }).lib;
    lib = addRemark(lib, "a", { text: "B" }).lib;
    lib = updateRemark(lib, "a", "r1", { text: "A2", page: "3-4" }, 9);
    expect(lib.items[0].remarks[0]).toMatchObject({ text: "A2", page: "3-4", modified: 9 });
    expect(updateRemark(lib, "a", "r9", { text: "x" })).toBe(lib);
    lib = moveRemark(lib, "a", "r2", -1);
    expect(lib.items[0].remarks.map((r) => r.text)).toEqual(["B", "A2"]);
    expect(moveRemark(lib, "a", "r2", -1)).toBe(lib);
  });

  it("存檔再讀回來；壞掉的備註略過，編號從最大的往下接", () => {
    let lib = libWith({ id: "a", key: "k" });
    lib = addRemark(lib, "a", { text: "Kept", page: "7" }).lib;
    const back = parseLibrary(serializeLibrary(lib));
    expect(back.items[0].remarks).toEqual(lib.items[0].remarks);
    expect(back.items[0].remarkSeq).toBe(1);
    const hand = parseLibrary(
      JSON.stringify({ items: [{ id: "a", key: "k", remarks: [{ id: "r5", text: "x" }, { id: "bad" }, { id: "r5", text: "dup" }, "junk"] }] }),
    );
    expect(hand.items[0].remarks.map((r) => r.text)).toEqual(["x"]);
    expect(addRemark(hand, "a").id).toBe("r6");
    // 舊的文獻庫沒有備註
    expect(parseLibrary(JSON.stringify({ items: [{ id: "a" }] })).items[0].remarks).toEqual([]);
  });

  it("搜尋條目時也找備註的文字", () => {
    const lib = addRemark(libWith({ id: "a", key: "k", title: "Paper" }), "a", { text: "Key insight about entropy" }).lib;
    expect(matches(lib.items[0], "entropy")).toBe(true);
    expect(matches(lib.items[0], "entropy paper")).toBe(true);
    expect(matches(lib.items[0], "gravity")).toBe(false);
  });

  it("引用名稱 @引用鍵#r1；引用鍵不能有 #", () => {
    expect(parseCiteName("@smith2020#r2")).toEqual({ key: "smith2020", remark: "r2" });
    expect(parseCiteName("@smith2020")).toEqual({ key: "smith2020", remark: null });
    expect(parseCiteName("smith2020#r2")).toBeNull();
    expect(remarkRef({ key: "smith2020" }, { id: "r2" })).toBe("@smith2020#r2");
    const lib = updateItem(libWith({ id: "a", key: "k" }), "a", { key: "new#key" });
    expect(lib.items[0].key).toBe("newkey");
  });
});

describe("文中引用的頁碼", () => {
  const it1: Item = { ...blankItem("article", 1), creators: [{ family: "Smith", given: "J", role: "author" }], date: "2020" };
  it("APA 加 p.／pp.，MLA 只寫數字，其他照寫", () => {
    expect(locatorText("12", "apa")).toBe("p. 12");
    expect(locatorText("12-14", "apa")).toBe("pp. 12–14");
    expect(locatorText(" 12 – 14 ", "mla")).toBe("12–14");
    expect(locatorText("xii", "apa")).toBe("xii");
    expect(locatorText("chap. 3", "apa")).toBe("chap. 3");
    expect(locatorText("", "apa")).toBe("");
    expect(inText(it1, "apa", "12")).toBe("(Smith, 2020, p. 12)");
    expect(inText(it1, "mla", "12")).toBe("(Smith 12)");
    expect(inText(it1, "apa")).toBe("(Smith, 2020)");
  });
});

describe("在其他地方引用備註", () => {
  let smith: Item;
  beforeEach(() => {
    let lib = libWith({
      id: "a",
      key: "smith2020deep",
      title: "Deep learning for sparse signals",
      creators: [{ family: "Smith", given: "John", role: "author" }],
      date: "2020",
    });
    lib = addRemark(lib, "a", { text: "Sparse codes **beat** dense ones", page: "12" }).lib;
    lib = addRemark(lib, "a", { text: "Limitations section" }).lib;
    smith = lib.items[0];
    setCiteStyle("apa");
    setCiteLibrary([smith]);
  });
  afterEach(() => setCiteLibrary([]));

  it("用 @引用鍵#r1 找到條目與備註；不認得的備註只算引用條目", () => {
    expect(citeRemark("@smith2020deep#r1")?.remark.text).toContain("Sparse");
    expect(citeRemark("@SMITH2020DEEP#R1")?.remark.id).toBe("r1");
    expect(citeRemark("@smith2020deep#r9")).toBeUndefined();
    expect(citeRemark("@smith2020deep")).toBeUndefined();
    expect(citeItem("@smith2020deep#r9")?.id).toBe("a");
  });

  it("顯示成帶頁碼的文中引用，滑過看備註；可以和其他引用合併", () => {
    const c = html(linkPages("<p>Shown [[@smith2020deep#r1]]; [[@smith2020deep]].</p>"));
    expect(c.textContent).toBe("Shown (Smith, 2020, p. 12; Smith, 2020).");
    const a = c.querySelector("a.remark-ref")!;
    expect(a.getAttribute("data-page")).toBe("@smith2020deep#r1");
    expect(a.getAttribute("data-remark")).toBe("r1");
    expect(a.getAttribute("title")).toContain("Sparse codes **beat** dense ones");
    expect(a.getAttribute("title")).toContain("Deep learning for sparse signals");
    // 沒有頁碼的備註
    expect(html(linkPages("<p>[[@smith2020deep#r2]]</p>")).textContent).toBe("(Smith, 2020)");
  });

  it("編輯時保留原始碼，轉回 Markdown 不變", () => {
    document.body.innerHTML = '<p id="ed" contenteditable="true"></p>';
    const el = document.getElementById("ed")!;
    const src = "See [[@smith2020deep#r1]] here.";
    renderInto(el, src, null);
    expect(el.querySelector(".cite-ref")!.getAttribute("title")).toContain("(Smith, 2020, p. 12)");
    expect(serialize(el).content).toBe(src);
  });

  it("![[@引用鍵#r1]] 嵌入備註的內容與引用", () => {
    const c = html(embedPages("<p>![[@smith2020deep#r1]]</p>"));
    const box = c.querySelector(".remark-embed")!;
    expect(box.querySelector(".pe-head a.remark-ref")!.textContent).toBe("(Smith, 2020, p. 12)");
    expect(box.querySelector(".pe-body strong")!.textContent).toBe("beat");
    expect(box.querySelector(".pe-sub")!.textContent).toBe("Deep learning for sparse signals");
    // 不認得的備註照常當成頁面嵌入
    expect(html(embedPages("<p>![[@smith2020deep#r9]]</p>")).querySelector(".remark-embed")).toBeNull();
  });

  it("[[@ 的建議：引用鍵# 列出備註，一般搜尋也找得到備註", () => {
    expect(suggestCites("smith2020deep#").map((s) => s.key)).toEqual(["smith2020deep#r1", "smith2020deep#r2"]);
    expect(suggestCites("smith2020deep#limit").map((s) => s.key)).toEqual(["smith2020deep#r2"]);
    expect(suggestCites("nobody#")).toEqual([]);
    // 條目本身也符合（搜尋包含備註文字），備註接在條目後面
    const s = suggestCites("dense ones");
    expect(s.map((x) => x.key)).toEqual(["smith2020deep", "smith2020deep#r1"]);
    expect(s[1].detail).toBe("Remark · Smith · 2020 · p. 12");
    // 引用鍵相符時條目排第一
    expect(suggestCites("smith")[0].key).toBe("smith2020deep");
  });

  it("引用備註也算引用了條目（參考文獻清單）", () => {
    expect(bibliographyMarkdown("Only [[@smith2020deep#r1]]")).toMatch(/^- Smith, J\. \(2020\)/);
  });
});
