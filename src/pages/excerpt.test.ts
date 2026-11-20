import { describe, expect, it } from "vitest";
import { excerpt, preview } from "./excerpt";

describe("頁面摘要", () => {
  it("去掉 Markdown 記號，保留文字", () => {
    expect(excerpt("Some **bold** and *em* with `code`.\n\n- item [[Other page]]\n- [link](https://x.y)")).toBe(
      "Some bold and em with code. item Other page link",
    );
  });

  it("略過與頁面同名的開頭標題、程式碼、版面標籤、圖片、空白區塊", () => {
    const md = "# 寶島一村\n\n<div class=\"columns\">\n\n```js\nx = 1\n```\n\n![cover](media/a.png)\n\n&nbsp;\n\n<span class=\"red\">金</span>獎\n\n</div>\n";
    expect(excerpt(md, "寶島一村")).toBe("金獎");
  });

  it("不同名的標題保留；任務標記去掉", () => {
    expect(excerpt("# 重點\n\n- { } 寫評論", "評論")).toBe("重點 寫評論");
  });

  it("太長就截斷", () => {
    const out = excerpt("字".repeat(500), "", 50);
    expect(out).toHaveLength(51);
    expect(out.endsWith("…")).toBe(true);
  });

  it("空的頁面是空字串", () => {
    expect(excerpt("&nbsp;\n\n")).toBe("");
  });

  it("卡片預覽：文字與第一張圖片依順序", () => {
    const md = "# 寶島一村\n\n金\n\n![海報](media/a.png)\n\n導演：王偉忠\n\n![](media/b.png)\n";
    expect(preview(md, "寶島一村")).toEqual([
      { kind: "text", text: "金" },
      { kind: "image", src: "media/a.png" },
      { kind: "text", text: "導演：王偉忠" },
    ]);
    expect(preview('<p><img src="media/c.png"></p>')).toEqual([{ kind: "image", src: "media/c.png" }]);
    expect(preview("```\n![x](media/no.png)\n```\n文字")).toEqual([{ kind: "text", text: "文字" }]);
  });
});
