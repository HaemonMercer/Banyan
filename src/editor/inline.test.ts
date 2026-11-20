import { describe, expect, it } from "vitest";
import { marksAt, setColor, toggleMark } from "./inline";
import { renderMarkdown } from "./markdown";

const at = (text: string, i: number, j = i) => marksAt(text, i, j);

describe("判斷游標所在的格式", () => {
  it("粗體、斜體、程式碼、連結", () => {
    expect(at("a **粗體** b", 5).bold).toBe(true);
    expect(at("a **粗體** b", 1).bold).toBe(false);
    expect(at("*斜* x", 2).italic).toBe(true);
    expect(at("`code` x", 3).code).toBe(true);
    expect(at("[文字](https://a.b)", 2).link).toBe(true);
    const both = at("***粗斜***", 4);
    expect(both.bold && both.italic).toBe(true);
  });

  it("游標在記號外側不算", () => {
    expect(at("**粗**後", 6).bold).toBe(false);
    expect(at("前**粗**", 1).bold).toBe(false);
  });

  it("跟 CommonMark 一致：不成對的記號不是粗體", () => {
    expect(at("a ** b ** c", 6).bold).toBe(false);
  });

  it("有選取時頭尾都在格式內才算", () => {
    expect(marksAt("**abc** d", 2, 5).bold).toBe(true);
    expect(marksAt("**abc** d", 2, 9).bold).toBe(false);
  });

  it("標題、清單裡的文字也能判斷", () => {
    expect(at("# 標題 **粗**", 8).bold).toBe(true);
    expect(at("- 項目 *斜*", 7).italic).toBe(true);
  });
});

describe("切換格式", () => {
  const apply = (text: string, a: number, b: number, mark: Parameters<typeof toggleMark>[3]) =>
    toggleMark(text, a, b, mark);

  it("選取文字加粗體，選取留在文字上", () => {
    const r = apply("我是文字", 2, 4, "bold");
    expect(r.text).toBe("我是**文字**");
    expect(r.text.slice(r.a, r.b)).toBe("文字");
    expect(renderMarkdown(r.text)).toBe("<p>我是<strong>文字</strong></p>\n");
  });

  it("再按一次取消", () => {
    const r = apply("我是**文字**", 4, 6, "bold");
    expect(r.text).toBe("我是文字");
    expect(r.text.slice(r.a, r.b)).toBe("文字");
  });

  it("選取包含記號時也能取消", () => {
    expect(apply("a **b** c", 2, 7, "bold").text).toBe("a b c");
  });

  it("沒有選取：不在格式裡就放一對記號，在格式裡就取消整段", () => {
    const r = apply("ab", 1, 1, "bold");
    expect(r.text).toBe("a****b");
    expect(r.a).toBe(3);
    expect(apply("x **粗體** y", 5, 5, "bold").text).toBe("x 粗體 y");
  });

  it("取消粗體中間的一段：前後斷開", () => {
    const r = apply("**abcde**", 4, 5, "bold");
    expect(r.text).toBe("**ab**c**de**");
    expect(renderMarkdown(r.text)).toBe("<p><strong>ab</strong>c<strong>de</strong></p>\n");
  });

  it("前後空白留在記號外面", () => {
    expect(apply("a b c", 1, 4, "italic").text).toBe("a *b* c");
  });

  it("斜體疊在粗體上", () => {
    const r = apply("**粗**", 2, 3, "italic");
    expect(r.text).toBe("***粗***");
    expect(marksAt(r.text, r.a, r.b)).toMatchObject({ bold: true, italic: true });
    const back = toggleMark(r.text, r.a, r.b, "italic");
    expect(back.text).toBe("**粗**");
  });

  it("行內程式碼：內容有反引號時用更多反引號", () => {
    expect(apply("x a`b y", 2, 5, "code").text).toBe("x ``a`b`` y");
    expect(apply("x `c` y", 3, 4, "code").text).toBe("x c y");
  });

  it("連結：包成 [文字](網址) 並選取網址；在連結裡再按就拿掉", () => {
    const r = apply("看這裡", 1, 3, "link");
    expect(r.text).toBe("看[這裡](https://)");
    expect(r.text.slice(r.a, r.b)).toBe("https://");
    expect(toggleMark("看[這裡](https://a.b)", 3, 3, "link").text).toBe("看這裡");
  });
});

describe("刪除線、底線、顏色、螢光（行內 HTML）", () => {
  it("判斷狀態", () => {
    const t = '<s>刪</s> <u>底</u> <span class="red">紅</span> <mark class="green">亮</mark> <mark>黃</mark>';
    expect(marksAt(t, 3, 3).strike).toBe(true);
    expect(marksAt(t, 12, 12).underline).toBe(true);
    expect(marksAt(t, t.indexOf("紅"), t.indexOf("紅")).color).toBe("red");
    expect(marksAt(t, t.indexOf("亮"), t.indexOf("亮")).highlight).toBe("green");
    expect(marksAt(t, t.indexOf("黃"), t.indexOf("黃")).highlight).toBe("yellow");
    expect(marksAt(t, 0, 0).strike).toBe(false);
  });

  it("切換刪除線、底線，且是合法的 CommonMark", () => {
    const r = toggleMark("abc", 1, 2, "strike");
    expect(r.text).toBe("a<s>b</s>c");
    expect(r.text.slice(r.a, r.b)).toBe("b");
    expect(renderMarkdown(r.text)).toBe("<p>a<s>b</s>c</p>\n");
    expect(toggleMark(r.text, r.a, r.b, "strike").text).toBe("abc");
    const u = toggleMark("**粗**", 2, 3, "underline");
    expect(renderMarkdown(u.text)).toBe("<p><strong><u>粗</u></strong></p>\n");
  });

  it("取消中間一段：前後保留原本格式", () => {
    const r = toggleMark("<u>abcde</u>", 5, 6, "underline");
    expect(r.text).toBe("<u>ab</u>c<u>de</u>");
  });

  it("自訂顏色：寫成 style，判斷得出來，換回色盤也可以", () => {
    const r = setColor("我是文字", 2, 4, "color", "#AA3366");
    expect(r.text).toBe('我是<span style="color: #aa3366">文字</span>');
    expect(marksAt(r.text, r.a, r.b).color).toBe("#aa3366");
    expect(renderMarkdown(r.text)).toBe('<p>我是<span style="color: #aa3366">文字</span></p>\n');
    expect(setColor(r.text, r.a, r.b, "color", "blue").text).toBe('我是<span class="blue">文字</span>');
    const h = setColor("亮", 0, 1, "highlight", "#ffee00");
    expect(h.text).toBe('<mark style="background-color: #ffee00">亮</mark>');
    expect(marksAt(h.text, h.a, h.b).highlight).toBe("#ffee00");
  });

  it("文字顏色：加上、換色、拿掉", () => {
    const r = setColor("我是文字", 2, 4, "color", "red");
    expect(r.text).toBe('我是<span class="red">文字</span>');
    expect(marksAt(r.text, r.a, r.b).color).toBe("red");
    const g = setColor(r.text, r.a, r.b, "color", "blue");
    expect(g.text).toBe('我是<span class="blue">文字</span>');
    const n = setColor(g.text, g.a, g.b, "color", null);
    expect(n.text).toBe("我是文字");
  });

  it("游標在顏色裡沒有選取：整段換色或拿掉", () => {
    const t = 'a<span class="red">bcd</span>e';
    const at = t.indexOf("bcd") + 1;
    expect(setColor(t, at, at, "color", "green").text).toBe('a<span class="green">bcd</span>e');
    expect(setColor(t, at, at, "color", null).text).toBe("abcde");
  });

  it("在紅字中間把一段改成藍字", () => {
    const t = '<span class="red">abcde</span>';
    const a = t.indexOf("abcde") + 2;
    const r = setColor(t, a, a + 1, "color", "blue");
    expect(r.text).toBe('<span class="red">ab</span><span class="blue">c</span><span class="red">de</span>');
    expect(r.text.slice(r.a, r.b)).toBe("c");
  });

  it("螢光標記可以選顏色，與文字顏色分開", () => {
    const r = setColor("重點", 0, 2, "highlight", "yellow");
    expect(r.text).toBe('<mark class="yellow">重點</mark>');
    const c = setColor(r.text, r.a, r.b, "color", "red");
    expect(c.text).toBe('<mark class="yellow"><span class="red">重點</span></mark>');
    const m = marksAt(c.text, c.a, c.b);
    expect([m.highlight, m.color]).toEqual(["yellow", "red"]);
  });

  it("選取裡已有的同種標籤先拿掉，不會層層疊", () => {
    const t = 'x<span class="red">a</span>y';
    const r = setColor(t, 0, t.length, "color", "blue");
    expect(r.text).toBe('<span class="blue">xay</span>');
  });
});

describe("上標、下標", () => {
  it("切換成 <sup>、<sub>，判斷游標所在的格式", () => {
    const up = toggleMark("x2", 1, 2, "sup");
    expect(up.text).toBe("x<sup>2</sup>");
    expect(renderMarkdown(up.text)).toBe("<p>x<sup>2</sup></p>\n");
    expect(marksAt(up.text, up.a, up.b).sup).toBe(true);
    expect(toggleMark(up.text, 6, 7, "sup").text).toBe("x2");
    const down = toggleMark("H2O", 1, 2, "sub");
    expect(down.text).toBe("H<sub>2</sub>O");
    expect(marksAt(down.text, down.a, down.b)).toMatchObject({ sub: true, sup: false });
  });
});
