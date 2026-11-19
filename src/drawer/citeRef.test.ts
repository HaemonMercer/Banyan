// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderInto, serialize } from "../editor/wysiwyg";
import { filterBlockTypes } from "../editor/blockTypes";
import { linkPages } from "../pages/pageRef";
import { blankItem, type Item } from "./model";
import {
  bibliographyMarkdown,
  citeItem,
  citeStamp,
  citedItems,
  setCiteLibrary,
  setCiteStyle,
  subscribeCites,
  suggestCites,
} from "./citeRef";

function item(p: Partial<Item>): Item {
  return { ...blankItem("article", 1), ...p };
}

const smith = item({
  id: "a",
  key: "smith2020deep",
  title: "Deep learning for sparse signals",
  creators: [
    { family: "Smith", given: "John", role: "author" },
    { family: "Lee", given: "Ann", role: "author" },
  ],
  date: "2020-05-17",
  container: "Journal of Signals",
});
const adams = item({
  id: "b",
  key: "adams2019habits",
  title: "Atomic habits",
  type: "book",
  creators: [{ family: "Adams", given: "Ruth", role: "author" }],
  date: "2019",
  publisher: "Penguin",
});
const gone = item({ id: "c", key: "old1999", title: "Trashed", trashed: true });

beforeEach(() => {
  setCiteStyle("apa");
  setCiteLibrary([smith, adams, gone]);
});
afterEach(() => setCiteLibrary([]));

describe("引用 Drawer 的條目", () => {
  it("用頁面名稱 @引用鍵 找條目（不分大小寫；垃圾桶裡的不算）", () => {
    expect(citeItem("@smith2020deep")?.id).toBe("a");
    expect(citeItem("@Smith2020Deep")?.id).toBe("a");
    expect(citeItem("smith2020deep")).toBeUndefined();
    expect(citeItem("@old1999")).toBeUndefined();
    expect(citeItem("@nobody")).toBeUndefined();
  });

  it("顯示時換成文中引用，滑過是完整的參考文獻", () => {
    const html = linkPages("<p>As shown [[@smith2020deep]].</p>");
    const t = document.createElement("template");
    t.innerHTML = html;
    const cite = t.content.querySelector(".cite")!;
    expect(cite.textContent).toBe("(Smith & Lee, 2020)");
    const a = cite.querySelector("a.page-ref.cite-ref")!;
    expect(a.getAttribute("data-page")).toBe("@smith2020deep");
    expect(a.getAttribute("title")).toContain("Deep learning for sparse signals");
    expect(t.content.textContent).toBe("As shown (Smith & Lee, 2020).");
  });

  it("相鄰的引用合成一個括號；中間有字就分開", () => {
    const t = document.createElement("template");
    t.innerHTML = linkPages("<p>[[@smith2020deep]]; [[@adams2019habits]] and [[@adams2019habits]]</p>");
    expect(t.content.textContent).toBe("(Smith & Lee, 2020; Adams, 2019) and (Adams, 2019)");
    expect(t.content.querySelectorAll(".cite")).toHaveLength(2);
    expect(t.content.querySelectorAll(".cite-ref")).toHaveLength(3);
  });

  it("不認得的引用鍵照常是頁面連結", () => {
    const html = linkPages("<p>[[@nobody]] [[Notes]]</p>");
    expect(html).toContain('<a class="page-ref" data-page="@nobody"><span class="pr-b">[[</span>@nobody<span class="pr-b">]]</span></a>');
    expect(html).not.toContain("cite");
  });

  it("MLA 格式；格式或文獻庫改變時通知編輯器", () => {
    let calls = 0;
    const off = subscribeCites(() => calls++);
    const before = citeStamp();
    setCiteStyle("mla");
    expect(citeStamp()).not.toBe(before);
    const t = document.createElement("template");
    t.innerHTML = linkPages("<p>[[@smith2020deep]]</p>");
    expect(t.content.textContent).toBe("(Smith and Lee)");
    setCiteStyle("mla"); // 沒變就不通知
    setCiteLibrary([adams]);
    expect(calls).toBe(2);
    off();
    expect(citeItem("@smith2020deep")).toBeUndefined();
  });

  it("編輯時保留原始的 [[@引用鍵]]，轉回 Markdown 不變", () => {
    document.body.innerHTML = '<p id="ed" contenteditable="true"></p>';
    const el = document.getElementById("ed")!;
    const c = "See [[@smith2020deep]]; [[@adams2019habits]] and [[@my\\_key]].";
    renderInto(el, c, null);
    expect(el.querySelectorAll(".cite-ref")).toHaveLength(2);
    expect(el.querySelector(".cite")).toBeNull();
    expect(el.querySelector(".cite-ref")!.getAttribute("title")).toContain("(Smith & Lee, 2020)");
    expect(serialize(el).content).toBe(c);
  });

  it("搜尋條目：引用鍵開頭、標題、作者、年份", () => {
    expect(suggestCites("smi").map((c) => c.key)).toEqual(["smith2020deep"]);
    expect(suggestCites("habits").map((c) => c.key)).toEqual(["adams2019habits"]);
    expect(suggestCites("lee").map((c) => c.key)).toEqual(["smith2020deep"]);
    expect(suggestCites("2019").map((c) => c.key)).toEqual(["adams2019habits"]);
    expect(suggestCites("trashed")).toEqual([]);
    expect(suggestCites("").length).toBe(2);
    expect(suggestCites("smith")[0]).toEqual({ key: "smith2020deep", title: "Deep learning for sparse signals", detail: "Smith and Lee · 2020" });
  });

  it("參考文獻清單：文件裡引用到的條目，依作者排序，一筆一個清單項目", () => {
    const src = "Intro [[@smith2020deep]] and [[@adams2019habits]], again [[@SMITH2020DEEP]].\n\n`[[@old]]` [[@nobody]]";
    expect(citedItems(src).map((i) => i.id)).toEqual(["a", "b"]);
    const md = bibliographyMarkdown(src);
    const lines = md.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^- Adams, R\. \(2019\)\. \*Atomic habits\*/);
    expect(lines[1]).toMatch(/^- Smith, J\., & Lee, A\. \(2020\)/);
    expect(bibliographyMarkdown("no citations here")).toBe("");
  });

  it("斜線選單有引用與參考文獻指令", () => {
    expect(filterBlockTypes("cite").map((t) => t.type)).toContain("cite");
    expect(filterBlockTypes("bibliography").map((t) => t.type)).toEqual(["bibliography"]);
  });
});
