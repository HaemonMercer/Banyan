// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { codeLang, decodeText, docxHtml, looksText, pptxSlides, previewKind } from "./preview";

const enc = (s: string) => new TextEncoder().encode(s);
const files = (o: Record<string, string>) => new Map(Object.entries(o).map(([k, v]) => [k, enc(v)]));

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const doc = (body: string) => `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`;

describe("檔案預覽的種類", () => {
  it("依副檔名或 data URL 判斷", () => {
    expect(previewKind("a.PNG")).toBe("image");
    expect(previewKind("x", "data:image/png;base64,AA")).toBe("image");
    expect(previewKind("a.mp3")).toBe("audio");
    expect(previewKind("paper.pdf")).toBe("pdf");
    expect(previewKind("x", "data:application/pdf;base64,AA")).toBe("pdf");
    expect(previewKind("page.htm")).toBe("html");
    expect(previewKind("README.md")).toBe("markdown");
    expect(previewKind("data.tsv")).toBe("table");
    expect(previewKind("book.xlsx")).toBe("xlsx");
    expect(previewKind("old.xls")).toBe("xlsx");
    expect(previewKind("calc.ods")).toBe("xlsx");
    expect(previewKind("report.docx")).toBe("docx");
    expect(previewKind("talk.pptx")).toBe("pptx");
    expect(previewKind("main.py")).toBe("code");
    expect(previewKind("notes.txt")).toBe("code");
    expect(previewKind("old.doc")).toBe("other");
    expect(previewKind("noext")).toBe("other");
  });

  it("程式碼的語言從副檔名來", () => {
    expect(codeLang("a.ts")).toBe("typescript");
    expect(codeLang("a.py")).toBe("python");
    expect(codeLang("a.yml")).toBe("yaml");
    expect(codeLang("a.h")).toBe("c");
    expect(codeLang("a.ps1")).toBe("powershell");
    expect(codeLang("refs.bib")).toBe("");
    expect(codeLang("a.zip")).toBeNull();
    expect(codeLang("Makefile")).toBeNull();
  });

  it("內容看起來是不是文字；解碼時處理 BOM 與 UTF-16", () => {
    expect(looksText(enc("hello 你好"))).toBe(true);
    expect(looksText(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]))).toBe(false);
    expect(looksText(new Uint8Array([0xc3, 0x28, 0x41]))).toBe(false);
    expect(looksText(new Uint8Array())).toBe(true);
    expect(decodeText(enc("﻿abc"))).toBe("abc");
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00]))).toBe("AB");
  });
});

describe("Word（.docx）預覽", () => {
  it("標題、段落與文字格式", () => {
    const html = docxHtml(
      files({
        "word/document.xml": doc(
          `<w:p><w:pPr><w:pStyle w:val="1"/></w:pPr><w:r><w:t>Intro</w:t></w:r></w:p>` +
            `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r><w:r><w:t xml:space="preserve"> and </w:t></w:r>` +
            `<w:r><w:rPr><w:i/><w:b w:val="0"/></w:rPr><w:t>italic &lt;x&gt;</w:t></w:r><w:r><w:br/><w:t>next</w:t></w:r></w:p>` +
            `<w:p/>` +
            `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:rPr><w:u w:val="single"/><w:strike/></w:rPr><w:t>Sub</w:t></w:r></w:p>`,
        ),
        // 中文 Word 的標題樣式 id 是數字，名稱才是 heading 1
        "word/styles.xml": `<w:styles ${W}><w:style w:styleId="1"><w:name w:val="heading 1"/></w:style></w:styles>`,
      }),
    );
    expect(html).toBe("<h1>Intro</h1><p><strong>Bold</strong> and <em>italic &lt;x&gt;</em><br>next</p><h2><u><s>Sub</s></u></h2>");
  });

  it("清單（項目符號與編號）、表格、外部連結", () => {
    const html = docxHtml(
      files({
        "word/document.xml": doc(
          `<w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>One</w:t></w:r></w:p>` +
            `<w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Two</w:t></w:r></w:p>` +
            `<w:p><w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>First</w:t></w:r></w:p>` +
            `<w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
            `<w:p><w:hyperlink r:id="rId9"><w:r><w:t>site</w:t></w:r></w:hyperlink><w:hyperlink r:id="rId8"><w:r><w:t>bad</w:t></w:r></w:hyperlink></w:p>`,
        ),
        "word/numbering.xml":
          `<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>` +
          `<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>` +
          `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
        "word/_rels/document.xml.rels":
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId9" Target="https://example.com/a?b=1&amp;c=2" TargetMode="External"/>` +
          `<Relationship Id="rId8" Target="javascript:alert(1)" TargetMode="External"/></Relationships>`,
      }),
    );
    expect(html).toBe(
      "<ul><li>One</li><li>Two</li></ul><ol><li>First</li></ol>" +
        '<table><tbody><tr><td colspan="2"><p>A</p></td></tr></tbody></table>' +
        '<p><a href="https://example.com/a?b=1&amp;c=2">site</a>bad</p>',
    );
  });

  it("不是 Word 文件就是 null", () => {
    expect(docxHtml(files({ "x.xml": "<a/>" }))).toBeNull();
    expect(docxHtml(files({ "word/document.xml": "not xml <" }))).toBeNull();
  });
});

describe("PowerPoint（.pptx）預覽", () => {
  const NS =
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const slide = (title: string, ...body: string[]) =>
    `<p:sld ${NS}><p:cSld><p:spTree>` +
    `<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>` +
    `<p:sp><p:txBody>${body.map((b) => `<a:p><a:r><a:t>${b}</a:t></a:r></a:p>`).join("")}<a:p></a:p></p:txBody></p:sp>` +
    `</p:spTree></p:cSld></p:sld>`;

  it("依 presentation.xml 的順序讀每張的標題與內文", () => {
    const s = pptxSlides(
      files({
        "ppt/presentation.xml": `<p:presentation ${NS}><p:sldIdLst><p:sldId id="1" r:id="rB"/><p:sldId id="2" r:id="rA"/></p:sldIdLst></p:presentation>`,
        "ppt/_rels/presentation.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rA" Target="slides/slide1.xml"/><Relationship Id="rB" Target="slides/slide2.xml"/></Relationships>`,
        "ppt/slides/slide1.xml": slide("Second", "b1"),
        "ppt/slides/slide2.xml": slide("First", "a1", "a2"),
      }),
    );
    expect(s).toMatchObject([
      { title: "First", body: ["a1", "a2"], bullet: [false, false] },
      { title: "Second", body: ["b1"] },
    ]);
  });

  it("內文版面配置區的段落是項目符號；圖片與備忘稿", () => {
    const rel = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
    const s = pptxSlides(
      files({
        "ppt/slides/slide1.xml":
          `<p:sld ${NS}><p:cSld><p:spTree>` +
          `<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Plan</a:t></a:r></a:p></p:txBody></p:sp>` +
          `<p:sp><p:nvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>One</a:t></a:r></a:p><a:p><a:pPr><a:buNone/></a:pPr><a:r><a:t>Plain</a:t></a:r></a:p></p:txBody></p:sp>` +
          `<p:pic><p:blipFill><a:blip r:embed="rId2"/></p:blipFill></p:pic>` +
          `</p:spTree></p:cSld></p:sld>`,
        "ppt/slides/_rels/slide1.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel("rId2", "image", "../media/image1.png")}${rel("rId3", "notesSlide", "../notesSlides/notesSlide1.xml")}</Relationships>`,
        "ppt/media/image1.png": "png",
        "ppt/notesSlides/notesSlide1.xml": `<p:notes ${NS}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Say hi</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`,
      }),
    );
    expect(s).toEqual([{ title: "Plan", body: ["One", "Plain"], bullet: [true, false], images: ["ppt/media/image1.png"], notes: "Say hi" }]);
  });

  it("沒有順序資訊時照檔名的數字排；不是簡報就是 null", () => {
    const s = pptxSlides(files({ "ppt/slides/slide10.xml": slide("Ten"), "ppt/slides/slide2.xml": slide("Two") }));
    expect(s?.map((x) => x.title)).toEqual(["Two", "Ten"]);
    expect(pptxSlides(files({ "word/document.xml": "<a/>" }))).toBeNull();
  });

  it("沒有標題版面配置區時第一段當標題（只有一段就留在內文）", () => {
    const plain = (...ps: string[]) =>
      `<p:sld ${NS}><p:cSld><p:spTree>${ps.map((t) => `<p:sp><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp>`).join("")}</p:spTree></p:cSld></p:sld>`;
    const s = pptxSlides(files({ "ppt/slides/slide1.xml": plain("Kickoff", "Goals"), "ppt/slides/slide2.xml": plain("Only") }));
    expect(s).toMatchObject([
      { title: "Kickoff", body: ["Goals"], bullet: [false] },
      { title: "", body: ["Only"] },
    ]);
  });
});
