// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { addDoc, emptyFile, parseFile, serializeFile, updateDoc } from "./file";
import { cleanPage, countWords, DEFAULT_PAGE, docxPage, isDefaultPage, pageStyle, paperOf } from "./pageSetup";
import { buildUnits } from "./SlideDeck";

describe("Word 的版面設定", () => {
  it("沒改過不存；改過的存檔讀回來一樣；壞掉的值用預設", () => {
    let f = addDoc(emptyFile(), "word").file;
    const id = f.docs[0].id;
    expect(JSON.parse(serializeFile(f)).docs[0].page).toBeUndefined();
    const page = { ...DEFAULT_PAGE, font: "serif" as const, size: 12, margin: "narrow" as const };
    f = updateDoc(f, id, { page });
    expect(JSON.parse(serializeFile(f)).docs[0].page).toEqual(page);
    expect(parseFile(serializeFile(f)).docs[0].page).toEqual(page);
    expect(cleanPage({ font: "comic", size: 99, spacing: 2, margin: "wide" })).toEqual({ ...DEFAULT_PAGE, spacing: 2, margin: "wide" });
    expect(isDefaultPage(cleanPage(null))).toBe(true);
  });

  it("畫面與 .docx 的數值", () => {
    expect(pageStyle({ ...DEFAULT_PAGE, size: 12, spacing: 1.5 })).toMatchObject({ fontSize: "16px", lineHeight: 1.8 });
    const d = docxPage({ ...DEFAULT_PAGE, size: 10.5, spacing: 2, margin: "wide" });
    expect(d).toMatchObject({ font: "Calibri", size: 21, line: 480, margin: { top: 1440, bottom: 1440, left: 2880, right: 2880 } });
    expect(d.paper).toEqual({ width: 11910, height: 16845, landscape: false });
  });

  it("紙張大小、方向、頁首頁尾：存檔讀回來，預設值不寫", () => {
    const p = cleanPage({ ...DEFAULT_PAGE, paper: "letter", landscape: true, header: "Draft", footer: "ACME", numbers: false });
    expect(p).toMatchObject({ paper: "letter", landscape: true, header: "Draft", footer: "ACME", numbers: false });
    expect(paperOf(p)).toEqual({ w: 1056, h: 816, label: "US Letter · Landscape" });
    expect(isDefaultPage(p)).toBe(false);
    expect(isDefaultPage(cleanPage({ ...DEFAULT_PAGE, paper: "a4", header: "  " }))).toBe(true);
    expect(docxPage(p)).toMatchObject({ header: "Draft", footer: "ACME", numbers: false, paper: { width: 12240, height: 15840, landscape: true } });
  });

  it("字數：中文一個字算一個，英文以詞計，不算標記", () => {
    expect(countWords("# Quarterly report\n\nFirst **paragraph** with [a link](https://x.y).\n\n- { } task one\n")).toBe(9);
    expect(countWords("今天天氣很好 and sunny")).toBe(8);
    expect(countWords('<div class="align-center">\n\n![圖](media/a.png)\n\n</div>\n')).toBe(0);
  });
});

describe("逐項顯示看得穿排版容器", () => {
  it("置中的標題還是開頭的標題", () => {
    const el = document.createElement("div");
    el.innerHTML = '<div class="align-center"><h2>T</h2></div><ul><li>1</li></ul><div class="bg-blue"><p>x</p></div>';
    expect(buildUnits(el).map((u) => u.textContent)).toEqual(["1", "x"]);
  });
});
