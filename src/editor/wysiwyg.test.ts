// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";
import {
  contentToRegion,
  decompose,
  recompose,
  regionToContent,
  renderInto,
  sameLook,
  serialize,
  backBy,
  forceFormat,
  formatSelection,
  selectionMarks,
  splitAt,
  toggleAtCaret,
} from "./wysiwyg";

let el: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<p id="ed" contenteditable="true"></p>';
  el = document.getElementById("ed")!;
});

/** 渲染後再轉回來，應該得到同一段 Markdown。 */
const roundTrip = (content: string) => {
  renderInto(el, content, null);
  return serialize(el).content;
};

describe("拆開區塊語法", () => {
  it("段落、標題、清單項目、引用", () => {
    expect(decompose("一段文字", "paragraph")?.content).toBe("一段文字");
    const h = decompose("## 標題 ##", "heading")!;
    expect([h.prefixes[0], h.content, h.suffix]).toEqual(["## ", "標題", " ##"]);
    const li = decompose("1. 第一行\n   第二行", "item")!;
    expect(li.content).toBe("第一行\n第二行");
    expect(recompose(li, "改過\n第二行")).toBe("1. 改過\n   第二行");
    const q = decompose("> a\n> b", "quote")!;
    expect(q.content).toBe("a\nb");
    expect(recompose(q, "a\nb\nc")).toBe("> a\n> b\n> c");
  });

  it("空的區塊打字後補上空白", () => {
    expect(recompose(decompose("-", "item")!, "x")).toBe("- x");
    expect(recompose(decompose("#", "heading")!, "x")).toBe("# x");
  });

  it("複雜的區塊不拆（改用原始碼編輯）", () => {
    expect(decompose("- a\n  - b", "item")).toBeNull();
    expect(decompose("> a\n>\n> b", "quote")).toBeNull();
    expect(decompose("```\nx\n```", "code")).toBeNull();
    expect(decompose("a <kbd>K</kbd>", "paragraph")).toBeNull();
  });

  it("位置對照", () => {
    const s = decompose("# 標題", "heading")!;
    expect(contentToRegion(s, s.content, 0)).toBe(2);
    expect(regionToContent(s, s.content, 3)).toBe(1);
    expect(regionToContent(s, s.content, 0)).toBe(0);
    const li = decompose("- a\n  b", "item")!;
    expect(contentToRegion(li, li.content, 2)).toBe(6); // 第二行的 b 前面（前面是兩格縮排）
  });
});

describe("DOM 與 Markdown 來回轉換", () => {
  it("各種格式來回不變", () => {
    for (const c of [
      "一般文字",
      "**粗體**與*斜體*",
      "`code` 與 [連結](https://a.b)",
      '<u>底線</u> <s>刪除</s> <span class="red">紅</span> <mark class="yellow">亮</mark>',
      '<span style="color: #aa3366">自訂</span> <mark style="background-color: #ffee00">螢光</mark>',
      "第一行\\\n第二行",
      "***粗斜***",
    ]) {
      expect(roundTrip(c)).toBe(c);
    }
  });

  it("使用者打的特殊字元會被跳脫，不會變成格式", () => {
    el.textContent = "價格 5*3 和 a_b 與 [x] <tag>";
    const out = serialize(el).content;
    expect(renderMarkdown(out)).toBe("<p>價格 5*3 和 a_b 與 [x] &lt;tag&gt;</p>\n");
  });

  it("行首會變成區塊語法的字元也跳脫", () => {
    for (const t of ["# 不是標題", "- 不是清單", "1. 不是編號", "> 不是引用", "```不是程式碼"]) {
      el.textContent = t;
      const out = serialize(el).content;
      expect(renderMarkdown(out)).toBe(`<p>${t.replace(">", "&gt;")}</p>\n`);
    }
  });

  it("開頭的 { 也跳脫（打 {o} 還沒打空白時，清單項目不會先變成子彈筆記的任務）", async () => {
    const { lineTask } = await import("../bujo/tasks");
    el.textContent = "{o}";
    const out = serialize(el).content;
    expect(out).toBe("\\{o}");
    expect(lineTask("- " + out)).toBeNull();
    expect(renderMarkdown(out)).toBe("<p>{o}</p>\n");
  });

  it("中文標點旁的粗體在 CommonMark 不成立時改用 HTML 標籤", () => {
    el.innerHTML = "中文<strong>「粗」</strong>後";
    const out = serialize(el).content;
    expect(sameLook(el, out)).toBe(true);
    expect(renderMarkdown(out)).toContain("<strong>「粗」</strong>");
  });

  it("相鄰的同格式合併、空的格式去掉", () => {
    el.innerHTML = "<b>a</b><b>b</b><i>\u200B</i>c";
    expect(serialize(el).content).toBe("**ab**c");
  });

  it("記號內側的空白搬到外面", () => {
    el.innerHTML = "a<b> 粗 </b>b";
    expect(serialize(el).content).toBe("a **粗** b");
  });
});

describe("選取位置", () => {
  it("渲染時把選取放在對應的文字上，轉回時位置一致", () => {
    const content = "前**粗體**後";
    renderInto(el, content, [3, 5]);
    expect(window.getSelection()!.toString()).toBe("粗體");
    const r = serialize(el);
    expect(r.content).toBe(content);
    expect([r.a, r.b]).toEqual([3, 5]);
  });

  it("游標在粗體結尾：在記號裡面", () => {
    renderInto(el, "**ab**c", [4, 4]);
    expect(serialize(el).a).toBe(4);
  });
});

describe("沒有選取時切換格式", () => {
  it("放一個空的粗體元素，打字後變成粗體", () => {
    renderInto(el, "ab", [1, 1]);
    expect(toggleAtCaret(el, { tag: "strong" })).toBe(true);
    expect(serialize(el).content).toBe("ab"); // 還沒打字：沒有改變
    document.execCommand?.("insertText", false, "X");
    const sel = window.getSelection()!;
    // happy-dom 沒有 execCommand：直接在游標處插入文字
    if (!el.textContent!.includes("X")) sel.getRangeAt(0).insertNode(document.createTextNode("X"));
    expect(serialize(el).content).toBe("a**X**b");
  });

  it("在粗體裡：從游標處斷開", () => {
    renderInto(el, "**abcd**", [4, 4]);
    toggleAtCaret(el, { tag: "strong" });
    window.getSelection()!.getRangeAt(0).insertNode(document.createTextNode("X"));
    expect(serialize(el).content).toBe("**ab**X**cd**");
  });
});

describe("Enter：在格式中間切開", () => {
  it("在粗體中間切開，前後都還是粗體", () => {
    renderInto(el, "前**粗體字**後", [5, 5]);
    expect(splitAt(el)).toEqual({ before: "前**粗體**", after: "**字**後" });
  });

  it("在粗體結尾切開，後面是空的", () => {
    renderInto(el, "a **文字**", [6, 6]);
    expect(splitAt(el)).toEqual({ before: "a **文字**", after: "" });
  });

  it("有選取時刪掉選取的文字", () => {
    renderInto(el, "abcdef", [2, 4]);
    expect(splitAt(el)).toEqual({ before: "ab", after: "ef" });
  });
});

describe("換行", () => {
  it("Shift+Enter 插入的換行字元是硬換行", () => {
    el.textContent = "第一行\n第二行";
    const out = serialize(el).content;
    expect(out).toBe("第一行\\\n第二行");
    expect(renderMarkdown(out)).toBe("<p>第一行<br />\n第二行</p>\n");
  });

  it("原始碼的軟換行顯示成空白（跟渲染結果一樣）", () => {
    renderInto(el, "a\nb", null);
    expect(el.textContent).toBe("a b");
  });
});

describe("硬換行後的強調", () => {
  it("換行後的粗體仍用 ** 寫", () => {
    el.innerHTML = "項目\n第二行<strong>粗</strong>";
    expect(serialize(el).content).toBe("項目\\\n第二行**粗**");
  });
});

describe("接著打的字的格式（輸入法把字插進粗體裡也一樣）", () => {
  it("取消粗體後打的字，就算被插進 <strong> 裡也會被搬出來", () => {
    el.innerHTML = "一段<strong>文字普通</strong>";
    const t = el.querySelector("strong")!.firstChild!;
    const from = backBy(el, t, 4, 2)!;
    const end = forceFormat(el, from, [t, 4], { tag: "strong" }, false);
    expect(end).not.toBeNull();
    expect(serialize(el).content).toBe("一段**文字**普通");
  });

  it("剛打的字在粗體中間：前後仍是粗體", () => {
    el.innerHTML = "<strong>前X後</strong>";
    const t = el.querySelector("strong")!.firstChild!;
    forceFormat(el, [t, 1], [t, 2], { tag: "strong" }, false);
    expect(serialize(el).content).toBe("**前**X**後**");
  });

  it("開啟粗體後打的字，沒在 <strong> 裡就包起來", () => {
    el.innerHTML = "一段新字";
    const t = el.firstChild!;
    forceFormat(el, [t, 2], [t, 4], { tag: "strong" }, true);
    expect(serialize(el).content).toBe("一段**新字**");
  });

  it("在紅字後面改打藍字", () => {
    el.innerHTML = '<span class="red">紅藍</span>';
    const t = el.querySelector("span")!.firstChild!;
    forceFormat(el, [t, 1], [t, 2], { tag: "span", color: "blue" }, true);
    expect(serialize(el).content).toBe('<span class="red">紅</span><span class="blue">藍</span>');
  });

  it("其他格式保留（例如粗斜體只拿掉粗體）", () => {
    el.innerHTML = "<strong><em>ab</em></strong>";
    const t = el.querySelector("em")!.firstChild!;
    forceFormat(el, [t, 1], [t, 2], { tag: "strong" }, false);
    expect(serialize(el).content).toBe("***a****b*");
  });
});

describe("有選取時切換格式（以畫面上的字為準）", () => {
  /** 設定選取：從 [節點, 位置] 到 [節點, 位置] */
  const select = (a: [Node, number], b: [Node, number]) => {
    const r = document.createRange();
    r.setStart(...a);
    r.setEnd(...b);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(r);
  };

  it("錄影中的情況：滑鼠選取從粗體前面的空白開始，按 Ctrl+B 取消粗體不會產生多餘的 **", () => {
    renderInto(el, "asd**fa**f s**fafa** **fdfasfas**", null);
    const strongs = el.querySelectorAll("strong");
    const space = strongs[1].nextSibling!; // 「 」
    const last = strongs[2].firstChild!;
    select([space, 1], [last, 8]);
    expect(selectionMarks(el)!.bold).toBe(true);
    const r = formatSelection(el, { tag: "strong" }, "toggle")!;
    expect(r.content).toBe("asd**fa**f s**fafa** fdfasfas");
    expect(r.content.slice(r.a, r.b)).toBe("fdfasfas");
    expect(renderMarkdown(r.content)).toBe(
      "<p>asd<strong>fa</strong>f s<strong>fafa</strong> fdfasfas</p>\n",
    );
  });

  it("字元樣式：選取的字包上 <span data-cs>，讀得到名稱；換一個、拿掉", () => {
    renderInto(el, "abc def ghi", null);
    const t = el.firstChild!;
    select([t, 4], [t, 7]);
    const r = formatSelection(el, { tag: "cs", name: "Key" }, "on")!;
    expect(r.content).toBe('abc <span data-cs="Key">def</span> ghi');
    renderInto(el, r.content, null);
    const span = el.querySelector("span[data-cs]")!;
    select([span.firstChild!, 0], [span.firstChild!, 3]);
    expect(selectionMarks(el)!.charStyle).toBe("Key");
    expect(formatSelection(el, { tag: "cs", name: "Term" }, "on")!.content).toBe('abc <span data-cs="Term">def</span> ghi');
    select([span.firstChild!, 0], [span.firstChild!, 3]);
    expect(formatSelection(el, { tag: "cs", name: null }, "off")!.content).toBe("abc def ghi");
  });

  it("選取有顏色的字，選「預設」拿掉顏色", () => {
    renderInto(el, 'a <span class="red">bc</span> d', null);
    const span = el.querySelector("span.red")!;
    select([span.firstChild!, 0], [span.firstChild!, 2]);
    expect(formatSelection(el, { tag: "span", color: null }, "off")!.content).toBe("a bc d");
  });

  it("再按一次加回粗體", () => {
    renderInto(el, "s**fafa** fdfasfas", null);
    const t = el.lastChild!; // 「 fdfasfas」
    select([t, 1], [t, 9]);
    const r = formatSelection(el, { tag: "strong" }, "toggle")!;
    expect(r.content).toBe("s**fafa** **fdfasfas**");
  });

  it("選取一部分是粗體、一部分不是：全部變粗體", () => {
    renderInto(el, "a**bc**de", null);
    select([el.firstChild!, 0], [el.lastChild!, 1]);
    expect(formatSelection(el, { tag: "strong" }, "toggle")!.content).toBe("**abcd**e");
  });

  it("跨過兩段粗體取消粗體", () => {
    renderInto(el, "**ab** **cd**", null);
    const s = el.querySelectorAll("strong");
    select([s[0].firstChild!, 1], [s[1].firstChild!, 1]);
    expect(formatSelection(el, { tag: "strong" }, "toggle")!.content).toBe("**a**b c**d**");
  });

  it("選取的字變成連結、變色", () => {
    renderInto(el, "看這裡", null);
    select([el.firstChild!, 1], [el.firstChild!, 3]);
    expect(formatSelection(el, { tag: "a", href: "https://a.b" }, "on")!.content).toBe("看[這裡](https://a.b)");
    renderInto(el, "看這裡", null);
    select([el.firstChild!, 1], [el.firstChild!, 3]);
    expect(formatSelection(el, { tag: "span", color: "red" }, "on")!.content).toBe('看<span class="red">這裡</span>');
  });
});

describe("上標、下標的所見即所得", () => {
  it("<sup>、<sub> 轉回 Markdown 原樣", () => {
    expect(roundTrip("E = mc<sup>2</sup>，H<sub>2</sub>O")).toBe("E = mc<sup>2</sup>，H<sub>2</sub>O");
  });
});

describe("有上標、下標的區塊仍是所見即所得", () => {
  it("decompose 接受 <sup>、<sub>", () => {
    expect(decompose("H<sub>2</sub>O 與 x<sup>2</sup>", "paragraph")).not.toBeNull();
  });
});
