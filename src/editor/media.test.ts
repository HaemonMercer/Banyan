// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseDoc, renderMarkdown } from "./markdown";
import { isMediaBlock, kindOf, mediaMarkdown } from "./media";
import { addColumn, addRow, newTable, parseTable, removeColumn, removeRow, setCell, tableHtml } from "./table";

describe("圖片、GIF、影片", () => {
  it("依檔名與類型判斷", () => {
    expect(kindOf("a.PNG")).toBe("image");
    expect(kindOf("動畫.gif")).toBe("image");
    expect(kindOf("clip.mp4")).toBe("video");
    expect(kindOf("x", "image/webp")).toBe("image");
    expect(kindOf("doc.pdf")).toBeNull();
  });

  it("圖片是 CommonMark 的圖片語法", () => {
    const md = mediaMarkdown("media/abc.gif", "image", "說明");
    expect(md).toBe("![說明](media/abc.gif)");
    expect(renderMarkdown(md)).toBe('<p><img src="media/abc.gif" alt="說明" /></p>\n');
    expect(isMediaBlock(md)).toBe("image");
  });

  it("影片是 HTML 區塊，前後的段落不受影響", () => {
    const md = mediaMarkdown("media/abc.mp4", "video");
    const src = `前\n\n${md}\n\n後\n`;
    expect(renderMarkdown(src)).toBe('<p>前</p>\n<video src="media/abc.mp4" controls>\n</video>\n<p>後</p>\n');
    expect(parseDoc(src).blocks.map((b) => b.kind)).toEqual(["paragraph", "html", "paragraph"]);
    expect(isMediaBlock(md)).toBe("video");
  });

  it("路徑有空白時用 <…> 包起來", () => {
    expect(mediaMarkdown("C:/a b.png", "image")).toBe("![](<C:/a b.png>)");
  });

  it("文字中的圖片不算媒體區塊", () => {
    expect(isMediaBlock("看 ![](a.png)")).toBeNull();
  });
});

describe("表格（HTML 區塊）", () => {
  it("新表格是一個 HTML 區塊，渲染成表格", () => {
    const t = newTable();
    expect(t.split("\n").every((l) => l.trim())).toBe(true); // 沒有空行
    const doc = parseDoc(`前\n\n${t}\n\n後\n`);
    expect(doc.blocks.map((b) => b.kind)).toEqual(["paragraph", "html", "paragraph"]);
    expect(renderMarkdown(t)).toContain("<table>");
  });

  it("讀寫來回不變，特殊字元與換行", () => {
    const d = { rows: [["名稱", "a < b & c"], ["第一行\n第二行", ""]], header: true };
    const html = tableHtml(d);
    expect(html).toBe(
      "<table>\n<tr><th>名稱</th><th>a &lt; b &amp; c</th></tr>\n<tr><td>第一行<br>第二行</td><td></td></tr>\n</table>",
    );
    expect(parseTable(html)).toEqual(d);
  });

  it("新增、刪除列與欄", () => {
    let d = parseTable(newTable())!;
    d = setCell(d, 0, 0, "A");
    d = addRow(d, 1);
    expect(d.rows.length).toBe(4);
    d = addColumn(d, 3);
    expect(d.rows[0].length).toBe(4);
    d = removeColumn(removeRow(d, 1), 0);
    expect(d.rows.length).toBe(3);
    expect(d.rows[0]).toEqual(["", "", ""]);
  });

  it("少了儲存格的列會補齊", () => {
    const d = parseTable("<table>\n<tr><td>a</td><td>b</td></tr>\n<tr><td>c</td></tr>\n</table>")!;
    expect(d.rows).toEqual([["a", "b"], ["c", ""]]);
    expect(d.header).toBe(false);
  });
});

describe("圖說", () => {
  it("圖片的圖說是 CommonMark 的圖片標題", async () => {
    const { mediaCaption, setMediaCaption } = await import("./media");
    const md = setMediaCaption("![花](media/a.png)", "春天的花");
    expect(md).toBe('![花](media/a.png "春天的花")');
    expect(renderMarkdown(md)).toBe('<p><img src="media/a.png" alt="花" title="春天的花" /></p>\n');
    expect(mediaCaption(md)).toBe("春天的花");
    expect(isMediaBlock(md)).toBe("image");
    expect(setMediaCaption(md, "")).toBe("![花](media/a.png)");
  });

  it("圖說裡的引號與反斜線會跳脫", async () => {
    const { mediaCaption, setMediaCaption } = await import("./media");
    const md = setMediaCaption("![](a.png)", '他說"好"\\');
    expect(mediaCaption(md)).toBe('他說"好"\\');
    expect(renderMarkdown(md)).toContain('title="他說&quot;好&quot;\\"');
  });

  it("影片的圖說是 title 屬性，仍是 HTML 區塊", async () => {
    const { mediaCaption, setMediaCaption } = await import("./media");
    const v = mediaMarkdown("media/v.mp4", "video");
    const md = setMediaCaption(v, "示範 <影片> & 說明");
    expect(md).toBe('<video src="media/v.mp4" controls title="示範 &lt;影片&gt; &amp; 說明">\n</video>');
    expect(mediaCaption(md)).toBe("示範 <影片> & 說明");
    expect(parseDoc(md).blocks.map((b) => b.kind)).toEqual(["html"]);
    expect(setMediaCaption(md, "")).toBe(v);
  });

  it("不是媒體區塊時不動", async () => {
    const { mediaCaption, setMediaCaption } = await import("./media");
    expect(mediaCaption("一段文字")).toBeNull();
    expect(setMediaCaption("一段文字", "x")).toBe("一段文字");
  });
});
