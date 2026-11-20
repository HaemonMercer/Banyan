// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { decompose, recompose, renderInto, serialize } from "../editor/wysiwyg";
import { findRefQuery } from "../editor/Editor";
import { isDateKey } from "../journal/journal";
import { cleanName, extractRefs, linkPages, pageKey, suggestPages } from "./pageRef";
import { resolveTarget } from "./pages";
import { allPages, findBacklinks, type Source } from "./refIndex";

let el: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<p id="ed" contenteditable="true"></p>';
  el = document.getElementById("ed")!;
});

describe("頁面連結", () => {
  it("名稱整理與比對", () => {
    expect(pageKey("  讀書  Notes ")).toBe("讀書 notes");
    expect(cleanName(" a [b] ")).toBe("a b");
  });

  it("找出原始碼裡的連結（程式碼裡的不算、不重複）", () => {
    const src = "今天讀了 [[原子習慣]]，想到 [[專案 A]]。\n\n- { } 寫 [[原子習慣]] 心得\n\n`[[不算]]`\n\n```\n[[也不算]]\n```\n\n[[my\\_page]]";
    expect(extractRefs(src)).toEqual(["原子習慣", "專案 A", "my_page"]);
  });

  it("顯示時把 [[名稱]] 換成連結（程式碼裡的不換）", () => {
    const html = linkPages("<p>讀 [[原子習慣]] 和 <code>[[x]]</code></p>");
    expect(html).toContain('<a class="page-ref" data-page="原子習慣"><span class="pr-b">[[</span>原子習慣<span class="pr-b">]]</span></a>');
    expect(html).toContain("<code>[[x]]</code>");
    expect(linkPages("<p>[[ ]] 與 [a]</p>")).toBe("<p>[[ ]] 與 [a]</p>");
  });

  it("所見即所得：連結來回不變，方括號不被跳脫", () => {
    for (const c of ["讀 [[原子習慣]] 的心得", "**[[粗體頁]]** 與 [[a]][[b]]", "[[2026-11-17]]"]) {
      renderInto(el, c, null);
      expect(el.querySelector(".page-ref")).not.toBeNull();
      expect(serialize(el).content).toBe(c);
    }
    // 自己打的 [[名稱]]（還沒變成連結元素）也寫成連結；只有單個方括號照常跳脫
    el.textContent = "見 [[新頁面]] 與 [註]";
    expect(serialize(el).content).toBe("見 [[新頁面]] 與 \\[註\\]");
  });

  it("輸入中的 [[：找出已經打的名稱", () => {
    expect(findRefQuery("讀 \\[\\[原子", 8)).toEqual({ from: 2, query: "原子" });
    expect(findRefQuery("讀 [[原子", 6)).toEqual({ from: 2, query: "原子" });
    expect(findRefQuery("讀 [[原子]] 後", 11)).toBeNull();
    expect(findRefQuery("沒有", 2)).toBeNull();
  });

  it("建議頁面：開頭相符的在前", () => {
    expect(suggestPages("專", ["大專案", "專案 A", "其他"])).toEqual(["專案 A", "大專案"]);
    expect(suggestPages("", ["a", "b"], 1)).toEqual(["a"]);
  });

  it("連結目標：日期是日記，其他是頁面（沿用已有頁面的大小寫）", () => {
    expect(resolveTarget("2026-11-17", [])).toEqual({ kind: "day", date: "2026-11-17" });
    expect(resolveTarget("reading", ["Reading"])).toEqual({ kind: "page", name: "Reading" });
    expect(resolveTarget("新頁", [])).toEqual({ kind: "page", name: "新頁" });
    expect(resolveTarget("  ", [])).toBeNull();
  });
});

describe("反向連結", () => {
  const sources: Source[] = [
    { kind: "day", key: "2026-11-15", content: "- { } 讀 [[原子習慣]] 第三章\n- 散步\n" },
    { kind: "day", key: "2026-11-17", content: "今天想到 [[原子習慣]] 的觀念。\n\n無關的段落\n" },
    { kind: "page", key: "讀書清單", content: "- [[原子習慣]]\n- [[深度工作]]\n" },
    { kind: "page", key: "原子習慣", content: "自己提到 [[原子習慣]] 不算\n" },
  ];

  it("列出提到的文件與區塊（日記新的在前，自己不算）", () => {
    const m = findBacklinks("原子習慣", sources, { kind: "page", key: "原子習慣" });
    expect(m.map((x) => x.source.key)).toEqual(["2026-11-17", "2026-11-15", "讀書清單"]);
    expect(m[1].blocks.map((b) => b.start)).toEqual([0]);
    expect(m[1].blocks[0].task).toBe("open");
    expect(m[0].blocks).toHaveLength(1);
  });

  it("所有頁面：有內容的＋被提到但還沒寫的；日期不算", () => {
    const list = allPages(["原子習慣", "讀書清單"], [...sources, { kind: "page", key: "x", content: "[[2026-11-17]]" }], isDateKey);
    expect(list.map((p) => [p.name, p.exists, p.refs])).toEqual([
      ["原子習慣", true, 3],
      ["深度工作", false, 1],
      ["讀書清單", true, 0],
    ]);
  });
});

describe("所見即所得的任務", () => {
  it("任務標記算區塊語法，內容不含標記", () => {
    const s = decompose("- { } 買牛奶", "item")!;
    expect(s.task).toBe("open");
    expect(s.content).toBe("買牛奶");
    expect(recompose(s, "買豆漿")).toBe("- { } 買豆漿");
    expect(recompose(decompose("- { }", "item")!, "x")).toBe("- { } x");
    expect(decompose("- 筆記", "item")!.task).toBeUndefined();
  });
});

describe("所見即所得的任務時間與排程日期", () => {
  it("時間藏在前綴、日期藏在 suffix；改內容時兩者都不動", () => {
    const s = decompose("- {<} 23:00 繳電費 [[2026-11-18]]", "item")!;
    expect(s.content).toBe("繳電費");
    expect(s.when).toEqual({ date: "2026-11-18", time: { start: 1380 } });
    expect(recompose(s, "繳水費")).toBe("- {<} 23:00 繳水費 [[2026-11-18]]");
    // 原本只有日期的任務，打字後日期前面補空白
    const only = decompose("- {<} [[2026-11-18]]", "item")!;
    expect(only.content).toBe("");
    expect(recompose(only, "x")).toBe("- {<} x [[2026-11-18]]");
    // 不是任務、待辦、多行的任務：照常是內容
    expect(decompose("- 讀 [[2026-11-20]]", "item")!.content).toBe("讀 [[2026-11-20]]");
    expect(decompose("- [ ] 10:00 待辦 [[2026-11-20]]", "item")!.content).toBe("10:00 待辦 [[2026-11-20]]");
  });
});
