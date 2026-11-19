import { describe, expect, it } from "vitest";
import { BLOCK_FONTS, blockStyleCss, cleanStyles, formatBlockStyle, freeStyleName, parseBlockStyle, patchBlockStyle, styleModified } from "./blockStyle";
import { blockBox, restyleBoxes, setBlockBox, setBlocksBox, setBlockBg } from "./layout";
import { parseDoc, renderMarkdown } from "./markdown";

const find = (src: string, text: string) => parseDoc(src).blocks.find((b) => src.split("\n")[b.start].includes(text))!;

describe("區塊樣式 blockStyle", () => {
  it("寫出固定的順序與寫法，讀回來一樣", () => {
    const css = formatBlockStyle({ margin: [12, 0, 6, 0], padding: [4, 8, 4, 8], font: BLOCK_FONTS[1].css, size: 14, line: 1.5, border: 1, borderColor: "blue", radius: 6 });
    expect(css).toBe(
      "margin: 12pt 0pt 6pt 0pt; padding: 4pt 8pt 4pt 8pt; font-family: Cambria, Georgia, 'Times New Roman', serif; font-size: 14pt; line-height: 1.8; border: 1pt solid var(--tc-blue); border-radius: 6pt",
    );
    expect(formatBlockStyle(parseBlockStyle(css))).toBe(css);
    expect(parseBlockStyle(css).line).toBe(1.5);
  });

  it("不認得的屬性、值丟掉；預設值（全 0、沒有框線）不寫", () => {
    expect(parseBlockStyle("color: red; margin: 4pt; font-family: Comic Sans; padding: 0pt; position: fixed")).toEqual({ margin: [4, 4, 4, 4] });
    expect(parseBlockStyle("margin: 4px; font-size: 12em; border: 1pt dashed red")).toEqual({});
    expect(formatBlockStyle({ margin: [0, 0, 0, 0], padding: [0, 0, 0, 0] })).toBe("");
  });

  it("CSS 縮寫：兩個值是上下、左右；超出範圍夾住", () => {
    expect(parseBlockStyle("padding: 6pt 12pt").padding).toEqual([6, 12, 6, 12]);
    expect(parseBlockStyle("margin: 999pt").margin).toEqual([200, 200, 200, 200]);
  });

  it("patch 只改一項，undefined 拿掉", () => {
    const a = patchBlockStyle("", { size: 18 });
    expect(a).toBe("font-size: 18pt");
    const b = patchBlockStyle(a, { padding: [2, 2, 2, 2] });
    expect(b).toBe("padding: 2pt 2pt 2pt 2pt; font-size: 18pt");
    expect(patchBlockStyle(b, { size: undefined, padding: undefined })).toBe("");
  });

  it("畫面的 style：camelCase，--box-inset 是左內距＋框線", () => {
    expect(blockStyleCss("padding: 4pt 8pt 4pt 10pt; border: 2pt solid var(--ed-faint); font-size: 12pt")).toEqual({
      "--box-inset": "12pt",
      padding: "4pt 8pt 4pt 10pt",
      fontSize: "12pt",
      border: "2pt solid var(--ed-faint)",
    });
  });
});

describe("區塊樣式容器 setBlockBox", () => {
  it("包一層 <div class=\"box\" style=\"…\">，再設定只改標籤，空的就拿掉", () => {
    const src = "a\n\nb\n";
    const r = setBlockBox(src, find(src, "b"), { css: "margin: 6pt 6pt 6pt 6pt" });
    expect(r.source).toBe('a\n\n<div class="box" style="margin: 6pt 6pt 6pt 6pt">\n\nb\n\n</div>\n');
    expect(renderMarkdown(r.source)).toBe('<p>a</p>\n<div class="box" style="margin: 6pt 6pt 6pt 6pt">\n<p>b</p>\n</div>\n');
    const doc = parseDoc(r.source);
    expect(blockBox(doc, find(r.source, "b"))).toEqual({ css: "margin: 6pt 6pt 6pt 6pt" });
    const g = setBlockBox(r.source, find(r.source, "b"), { css: "font-size: 9pt" });
    expect(g.source).toBe('a\n\n<div class="box" style="font-size: 9pt">\n\nb\n\n</div>\n');
    expect(setBlockBox(g.source, find(g.source, "b"), { css: "" }).source).toBe(src);
  });

  it("跟背景色一起：兩層都算區塊自己的，清單套用到整份清單", () => {
    const src = "- a\n- b\n";
    const bg = setBlockBg(src, find(src, "- b"), "blue").source;
    const both = setBlockBox(bg, find(bg, "- a"), { css: "padding: 4pt 4pt 4pt 4pt" }).source;
    expect(both).toBe('<div class="box" style="padding: 4pt 4pt 4pt 4pt">\n\n<div class="bg-blue">\n\n- a\n- b\n\n</div>\n\n</div>\n');
    expect(blockBox(parseDoc(both), find(both, "- b")).css).toBe("padding: 4pt 4pt 4pt 4pt");
  });

  it("多個區塊各改各的（只動改到的欄位）", () => {
    const src = 'a\n\n<div class="box" style="font-size: 20pt">\n\nb\n\n</div>\n';
    const doc = parseDoc(src);
    const res = setBlocksBox(src, [find(src, "a"), find(src, "b")], (v) => ({ ...v, css: patchBlockStyle(v.css, { margin: [1, 1, 1, 1] }) }));
    expect(res.source).toBe(
      '<div class="box" style="margin: 1pt 1pt 1pt 1pt">\n\na\n\n</div>\n\n<div class="box" style="margin: 1pt 1pt 1pt 1pt; font-size: 20pt">\n\nb\n\n</div>\n',
    );
    expect(res.starts.length).toBe(2);
    expect(doc.blocks.length).toBe(2);
  });
});

describe("已存的樣式（data-style）", () => {
  const card =
    'a\n\n<div class="box" data-style="Card" style="padding: 6pt 6pt 6pt 6pt">\n\nb\n\n</div>\n\n<div class="box" data-style="Note" style="font-size: 9pt">\n\nc\n\n</div>\n';

  it("讀得到名稱；只有名稱、沒有 css 也留著那層", () => {
    expect(blockBox(parseDoc(card), find(card, "b"))).toEqual({ css: "padding: 6pt 6pt 6pt 6pt", name: "Card" });
    const named = setBlockBox("x\n", find("x\n", "x"), { css: "", name: "Plain" }).source;
    expect(named).toBe('<div class="box" data-style="Plain" style="">\n\nx\n\n</div>\n');
    expect(renderMarkdown(named)).toContain('data-style="Plain"');
  });

  it("restyleBoxes：更新、改名只動用到它的區塊；回傳 null 拿掉那層", () => {
    const up = restyleBoxes(card, (v) => (v.name === "Card" ? { ...v, css: "padding: 1pt 1pt 1pt 1pt" } : v));
    expect(up).toContain('data-style="Card" style="padding: 1pt 1pt 1pt 1pt"');
    expect(up).toContain('data-style="Note" style="font-size: 9pt"');
    const renamed = restyleBoxes(card, (v) => (v.name === "Note" ? { ...v, name: "Small" } : v));
    expect(renamed).toContain('data-style="Small" style="font-size: 9pt"');
    const detached = restyleBoxes(card, (v) => (v.name === "Card" ? { css: v.css } : v));
    expect(detached).toContain('<div class="box" style="padding: 6pt 6pt 6pt 6pt">');
    expect(restyleBoxes(card, () => null)).toBe("a\n\nb\n\nc\n");
    expect(restyleBoxes(card, (v) => v)).toBe(card);
  });

  it("清單：讀檔丟掉壞的與重複的、名稱去掉特殊字元；撞名加編號；改過的判斷", () => {
    expect(cleanStyles([{ name: 'Ca"rd', css: "margin: 2pt; color: red" }, { name: "card", css: "" }, { css: "x" }, null])).toEqual([
      { name: "Card", css: "margin: 2pt 2pt 2pt 2pt" },
    ]);
    const list = [{ name: "Card", css: "font-size: 9pt" }];
    expect(freeStyleName(list, "card")).toBe("card 2");
    expect(freeStyleName(list, "Card", "Card")).toBe("Card");
    expect(styleModified(list, "Card", "font-size: 9pt")).toBe(false);
    expect(styleModified(list, "Card", "font-size: 10pt")).toBe(true);
    expect(styleModified(list, "Gone", "font-size: 10pt")).toBe(false);
  });

  it("段落類型：認得的留著，不認得的丟掉", () => {
    expect(cleanStyles([{ name: "Head", css: "", type: "h2" }, { name: "Odd", css: "", type: "banner" }])).toEqual([
      { name: "Head", css: "", type: "h2" },
      { name: "Odd", css: "" },
    ]);
  });
});

