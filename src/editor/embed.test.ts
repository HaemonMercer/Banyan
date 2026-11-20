// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { embedName, embedPages, renderEmbedded } from "./embed";
import { md } from "./markdown";
import { setEmbedSources } from "../pages/embeds";
import { setDocLinks } from "../desk/docLinks";

describe("![[名稱]] 嵌入", () => {
  it("CommonMark 把 ![[名稱]] 渲染成文字", () => {
    expect(md.render("![[Template]]")).toBe("<p>![[Template]]</p>\n");
  });

  it("認得嵌入", () => {
    expect(embedName(" ![[Template/Journal]] ")).toBe("Template/Journal");
    expect(embedName("see ![[A]]")).toBeNull();
    expect(embedName("[[A]]")).toBeNull();
  });

  it("段落與清單項目換成頁面內容", () => {
    setEmbedSources([["Template", "# Title\n\nhello [[B]]"]]);
    const div = document.createElement("div");
    div.innerHTML = embedPages("<p>![[template]]</p><ul><li>![[Template]]</li></ul><p>x ![[Template]]</p>");
    const boxes = div.querySelectorAll(".page-embed");
    expect(boxes).toHaveLength(2);
    expect(boxes[0].querySelector(".pe-body h1")?.textContent).toBe("Title");
    expect(boxes[0].querySelector(".pe-head .page-ref")?.getAttribute("data-page")).toBe("template");
    expect(boxes[1].parentElement?.tagName).toBe("LI");
    expect(div.lastElementChild?.textContent).toBe("x ![[Template]]");
  });

  it("沒有這一頁、空白頁、互相嵌入", () => {
    setEmbedSources([
      ["Empty", "  "],
      ["A", "![[B]]"],
      ["B", "![[A]]"],
    ]);
    const div = document.createElement("div");
    div.innerHTML = embedPages("<p>![[Nope]]</p><p>![[Empty]]</p><p>![[A]]</p>");
    const notes = [...div.querySelectorAll(".pe-note")].map((n) => n.textContent);
    expect(notes).toEqual(["No page with this name yet", "Empty page", "Already embedded above"]);
    expect(div.querySelectorAll(".page-embed")).toHaveLength(5); // Nope、Empty、A → B → A（停住）
  });

  it("任務標記換成符號", () => {
    const div = document.createElement("div");
    div.innerHTML = renderEmbedded("- {x} done\n- [ ] todo\n- plain");
    const lis = div.querySelectorAll("li");
    expect(lis[0].querySelector(".pe-task")?.textContent).toBe("×");
    expect(lis[0].textContent).toBe("×done");
    expect(lis[1].querySelector(".pe-check")).not.toBeNull();
    expect(lis[2].classList.contains("pe-item")).toBe(false);
  });

  it("程式碼裡的不展開", () => {
    setEmbedSources([["A", "x"]]);
    expect(embedPages("<pre><code>![[A]]</code></pre>")).not.toContain("page-embed");
  });

  it("Dock 文件：Markdown 文件顯示內容，Excel 只有標題連結", () => {
    setDocLinks([
      { name: "Trip/Plan", file: "Trip", id: "a", title: "Plan", kind: "word" },
      { name: "Trip/Budget", file: "Trip", id: "b", title: "Budget", kind: "sheet" },
    ]);
    setEmbedSources([["Trip/Plan", "Day one"]]);
    const div = document.createElement("div");
    div.innerHTML = embedPages("<p>![[Trip/Plan]]</p><p>![[trip/budget]]</p>");
    const [plan, budget] = div.querySelectorAll(".page-embed");
    expect(plan.querySelector(".pe-head .dock-ref")).not.toBeNull();
    expect(plan.querySelector(".pe-body")?.textContent?.trim()).toBe("Day one");
    expect(budget.querySelector(".pe-note")?.textContent).toBe("Excel · click the title to open");
    setDocLinks([]);
  });
});
