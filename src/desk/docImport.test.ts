// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { zip } from "../sheet/xlsx";
import {
  docParasHtml,
  htmlToMarkdown,
  importAsDoc,
  importKind,
  importSlides,
  importWord,
  markdownSlides,
  odpSlides,
  odtHtml,
  rtfHtml,
  textToMarkdown,
  withImportedSlides,
  withImportedText,
} from "./docImport";
import { NO_ANIM } from "./slideAnim";

const enc = (s: string) => new TextEncoder().encode(s);
/** 測試用的存圖：記下檔名，回傳 media/ 路徑 */
const saver = () => {
  const saved: string[] = [];
  const save = async (_b: Uint8Array, name: string) => {
    saved.push(name);
    return `media/${name}`;
  };
  return { saved, save };
};

describe("匯入 Word：HTML → Markdown", () => {
  it("標題、段落與行內格式（用編輯器的 serialize）", () => {
    expect(htmlToMarkdown("<h1>Title</h1><p>Some <strong>bold</strong> and <em>italic</em>, <u>under</u> <a href=\"https://x.org\">link</a>.</p>")).toBe(
      "# Title\n\nSome **bold** and *italic*, <u>under</u> [link](https://x.org).",
    );
  });

  it("清單（巢狀、有序的起始號碼）、引言、程式碼、分隔線", () => {
    const md = htmlToMarkdown(
      "<ul><li>One<ul><li>Inner</li></ul></li><li>Two</li></ul><ol start=\"3\"><li>Third</li></ol><blockquote><p>Quote</p></blockquote><pre><code>let x = 1;</code></pre><hr>",
    );
    expect(md).toBe("- One\n   - Inner\n- Two\n\n3. Third\n\n> Quote\n\n```\nlet x = 1;\n```\n\n***");
  });

  it("表格變成編輯器的表格區塊；圖片另起一段", () => {
    const md = htmlToMarkdown('<table><tr><th>A</th><th colspan="2">B</th></tr><tr><td>1</td><td>2</td><td>3</td></tr></table><p>See <img src="media/a.png"> here</p>');
    expect(md).toBe("<table>\n<tr><th>A</th><th>B</th><th></th></tr>\n<tr><td>1</td><td>2</td><td>3</td></tr>\n</table>\n\nSee here\n\n![](media/a.png)");
  });

  it("略過 script、style；div 裡的文字當段落；Markdown 字元跳脫", () => {
    expect(htmlToMarkdown("<style>p{}</style><div>Plain *star* # not heading</div><script>x()</script>")).toBe("Plain \\*star\\* # not heading");
    // 段落裡的換行是硬換行（行尾反斜線）
    expect(textToMarkdown("# not a heading\nsecond line\n\n1. not a list")).toBe("\\# not a heading\\\nsecond line\n\n1\\. not a list");
  });
});

describe("匯入 Word：RTF", () => {
  it("段落、粗體斜體、Unicode、依字碼頁（Big5）解碼；略過字型表", () => {
    const rtf =
      "{\\rtf1\\ansi\\ansicpg950\\deff0{\\fonttbl{\\f0 \\'b7\\'73\\'b2\\'d3\\'a9\\'fa\\'c5\\'e9;}}{\\colortbl;\\red0\\green0\\blue0;}" +
      "\\pard Hello {\\b bold} \\i italic\\i0  end\\par\n\\'a4\\'a4\\'a4\\'e5 \\u20013?\\u25991?\\par{\\*\\generator Riched20;}x\\line y\\par}";
    expect(rtfHtml(rtf)).toBe("<p>Hello <strong>bold</strong> <em>italic</em> end</p><p>中文 中文</p><p>x<br>y</p>");
  });
});

describe("匯入 Word：RTF 的結構、Word 網頁的清單、.doc 的表格", () => {
  it("RTF：樣式表的標題、清單項目（listtext）、表格（intbl、cell、row）", () => {
    const rtf =
      "{\\rtf1\\ansi{\\stylesheet{\\s0 Normal;}{\\s1\\outlinelevel0 heading 1;}{\\s2 heading 2;}}" +
      "\\pard\\s1 Title\\par\\pard Body\\par" +
      "\\pard\\ls1{\\listtext\\'b7\\tab}One\\par{\\listtext\\'b7\\tab}Two\\par" +
      "\\pard\\intbl A\\cell B\\cell\\row\\pard\\intbl C\\cell D\\cell\\row\\pard After\\par}";
    expect(rtfHtml(rtf)).toBe("<h1>Title</h1><p>Body</p><ul><li>One</li><li>Two</li></ul><table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table><p>After</p>");
  });

  it("Word 存的網頁：MsoListParagraph 的段落變成清單，拿掉項目符號", () => {
    const html =
      `<p class=MsoListParagraphCxSpFirst><span style='font-family:Wingdings'>l<span>&nbsp;&nbsp;</span></span><span>Tent</span></p>` +
      `<p class=MsoListParagraphCxSpLast><span style='font-family:Wingdings'>l<span>&nbsp;&nbsp;</span></span><span>Stove</span></p>` +
      `<p class=MsoListParagraph><span style='mso-list:Ignore'>1.<span>&nbsp;</span></span>First</p><p>Done <img src="report.files/image001.png"></p>`;
    expect(htmlToMarkdown(html)).toBe("- Tent\n- Stove\n\n1. First\n\nDone");
  });

  it(".doc 的段落：表格列（格子可以是空的）組成表格", () => {
    expect(docParasHtml(["Intro", "AB", "D", "End"])).toBe("<p>Intro</p><table><tr><td>A</td><td>B</td></tr><tr><td></td><td>D</td></tr></table><p>End</p>");
  });
});

describe("匯入 Word：依副檔名", () => {
  it(".docx：文字、清單與圖片（存到 media）", async () => {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
    const file = zip([
      [
        "word/document.xml",
        enc(
          `<w:document ${W}><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Report</w:t></w:r></w:p>` +
            `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r><w:r><w:t xml:space="preserve"> text</w:t></w:r></w:p>` +
            `<w:p><w:r><w:drawing><a:graphic><a:graphicData><a:blip r:embed="rId5"/></a:graphicData></a:graphic></w:drawing></w:r></w:p></w:body></w:document>`,
        ),
      ],
      [
        "word/_rels/document.xml.rels",
        enc(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>`),
      ],
      ["word/media/image1.png", new Uint8Array([1, 2, 3])],
    ]);
    const s = saver();
    expect(await importWord("r.docx", file, s.save)).toBe("# Report\n\n**Bold** text\n\n![](media/image1.png)");
    expect(s.saved).toEqual(["image1.png"]);
  });

  it(".odt：標題、粗體（自動樣式）、編號清單、表格、圖片", async () => {
    const N =
      'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink"';
    const content =
      `<office:document-content ${N}><office:automatic-styles>` +
      `<style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>` +
      `<text:list-style style:name="L1"><text:list-level-style-number text:level="1"/></text:list-style>` +
      `</office:automatic-styles><office:body><office:text>` +
      `<text:h text:outline-level="2">Plan</text:h>` +
      `<text:p>Go <text:span text:style-name="T1">now</text:span><text:s text:c="2"/>ok</text:p>` +
      `<text:list text:style-name="L1"><text:list-item><text:p>First</text:p></text:list-item><text:list-item><text:p>Second</text:p></text:list-item></text:list>` +
      `<table:table><table:table-header-rows><table:table-row><table:table-cell><text:p>H</text:p></table:table-cell></table:table-row></table:table-header-rows><table:table-row><table:table-cell><text:p>v</text:p></table:table-cell></table:table-row></table:table>` +
      `<text:p><draw:frame><draw:image xlink:href="Pictures/p.png"/></draw:frame></text:p>` +
      `</office:text></office:body></office:document-content>`;
    const s = saver();
    const files = new Map([
      ["content.xml", enc(content)],
      ["Pictures/p.png", new Uint8Array([1])],
    ]);
    const html = await odtHtml(files, s.save);
    // 連續空白照 HTML 的規則算一個
    expect(htmlToMarkdown(html!)).toBe("## Plan\n\nGo **now** ok\n\n1. First\n2. Second\n\n<table>\n<tr><td>H</td></tr>\n<tr><td>v</td></tr>\n</table>\n\n![](media/p.png)");
  });

  it(".md 照原樣；.txt 跳脫；.html", async () => {
    const s = saver();
    expect(await importWord("a.md", enc("# Hi\r\n\r\n- x\r\n"), s.save)).toBe("# Hi\n\n- x");
    expect(await importWord("a.txt", enc("Line *one*\n\nTwo"), s.save)).toBe("Line \\*one\\*\n\nTwo");
    expect(await importWord("a.html", enc("<html><body><h2>T</h2><p>x</p></body></html>"), s.save)).toBe("## T\n\nx");
    // 網站的 .doc 其實是網頁
    expect(await importWord("old.doc", enc("<html><body><p>web doc</p></body></html>".padEnd(600)), s.save)).toBe("web doc");
  });
});

describe("匯入簡報", () => {
  it("Markdown：--- 分張（去掉 front matter，程式碼裡的 --- 不算）；沒有就照標題分張", () => {
    expect(markdownSlides("---\nmarp: true\n---\n# A\n\nx\n\n---\n\n# B\n```\n---\n```\n")).toEqual(["# A\n\nx", "# B\n```\n---\n```"]);
    expect(markdownSlides("# One\n\na\n\n# Two\n\nb")).toEqual(["# One\n\na", "# Two\n\nb"]);
    expect(markdownSlides("## One\n\na\n\n## Two")).toEqual(["## One\n\na", "## Two"]);
  });

  it(".pptx：標題、項目符號、一般段落、圖片、備忘稿", async () => {
    const NS =
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const file = zip([
      [
        "ppt/slides/slide1.xml",
        enc(
          `<p:sld ${NS}><p:cSld><p:spTree>` +
            `<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Kick*off</a:t></a:r></a:p></p:txBody></p:sp>` +
            `<p:sp><p:nvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Goals</a:t></a:r></a:p><a:p><a:r><a:t>Dates</a:t></a:r></a:p></p:txBody></p:sp>` +
            `<p:sp><p:txBody><a:p><a:r><a:t>Footnote</a:t></a:r></a:p></p:txBody></p:sp>` +
            `<p:pic><p:blipFill><a:blip r:embed="rId2"/></p:blipFill></p:pic></p:spTree></p:cSld></p:sld>`,
        ),
      ],
      [
        "ppt/slides/_rels/slide1.xml.rels",
        enc(
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>` +
            `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`,
        ),
      ],
      ["ppt/media/image1.png", new Uint8Array([9])],
      ["ppt/notesSlides/notesSlide1.xml", enc(`<p:notes ${NS}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Welcome</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`)],
    ]);
    const s = saver();
    expect(await importSlides("deck.pptx", file, s.save)).toEqual([{ md: "# Kick\\*off\n\n- Goals\n- Dates\n\nFootnote\n\n![](media/image1.png)", notes: "Welcome" }]);
  });

  it(".odp：標題、大綱（項目符號）、圖片、備忘稿", async () => {
    const N =
      'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:xlink="http://www.w3.org/1999/xlink"';
    const content =
      `<office:document-content ${N}><office:body><office:presentation>` +
      `<draw:page draw:name="p1"><draw:frame presentation:class="title"><draw:text-box><text:p>Plan</text:p></draw:text-box></draw:frame>` +
      `<draw:frame presentation:class="outline"><draw:text-box><text:list><text:list-item><text:p>One</text:p></text:list-item><text:list-item><text:p>Two</text:p></text:list-item></text:list></draw:text-box></draw:frame>` +
      `<draw:frame><draw:image xlink:href="Pictures/x.png"/></draw:frame>` +
      `<presentation:notes><draw:frame presentation:class="notes"><draw:text-box><text:p>Note</text:p></draw:text-box></draw:frame></presentation:notes></draw:page>` +
      `<draw:page draw:name="p2"><draw:frame presentation:class="title"><draw:text-box><text:p>End</text:p></draw:text-box></draw:frame></draw:page>` +
      `</office:presentation></office:body></office:document-content>`;
    const s = saver();
    const slides = await odpSlides(new Map([["content.xml", enc(content)], ["Pictures/x.png", new Uint8Array([1])]]), s.save);
    expect(slides).toEqual([{ md: "# Plan\n\n- One\n- Two\n\n![](media/x.png)", notes: "Note" }, { md: "# End" }]);
  });

  it("接在簡報後面：備忘稿放進設定；原本只有空白投影片就換掉", () => {
    const r = withImportedSlides("# A\n\n---\n\n# B\n", [{ ...NO_ANIM, transition: "fade" }], [{ md: "# C", notes: "say" }, { md: "# D" }]);
    expect(r.first).toBe(2);
    expect(r.content).toBe("# A\n\n---\n\n# B\n\n---\n\n# C\n\n---\n\n# D\n");
    expect(r.anim.map((a) => a.notes ?? a.transition)).toEqual(["fade", "none", "say"]);
    const blank = withImportedSlides("\n", [], [{ md: "# X" }]);
    expect(blank).toMatchObject({ first: 0, content: "# X\n" });
    expect(withImportedText("", "# T")).toBe("# T\n");
    expect(withImportedText("Old\n", "New")).toBe("Old\n\nNew\n");
  });

  it("Dock 的匯入依副檔名決定文件種類", async () => {
    expect(importKind("a.pptx")).toBe("slides");
    expect(importKind("a.xls")).toBe("sheet");
    expect(importKind("a.csv")).toBe("sheet");
    expect(importKind("a.rtf")).toBe("word");
    expect(importKind("a.md")).toBe("word");
    expect(importKind("a.zip")).toBeNull();
    const doc = await importAsDoc("notes.md", enc("# Hi"), saver().save);
    expect(doc).toEqual({ kind: "word", title: "notes", content: "# Hi\n" });
    const sheet = await importAsDoc("data.csv", enc("a,b\n1,2"), saver().save);
    expect(sheet.kind).toBe("sheet");
    expect(JSON.parse(sheet.content).sheets[0].tables[0].cells["1,1"].v).toBe("2");
    await expect(importAsDoc("x.zip", enc(""), saver().save)).rejects.toThrow(/can't import/);
  });

  it("舊版 .ppt 說明要先另存", async () => {
    await expect(importSlides("old.ppt", new Uint8Array(10), saver().save)).rejects.toThrow(/\.pptx/);
  });
});
