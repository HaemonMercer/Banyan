// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { addDoc, emptyFile, parseFile, serializeFile, updateDoc } from "./file";
import { paperIsDark, cleanLook, cleanPage, countWords, DEFAULT_PAGE, docxPage, isDefaultLook, isDefaultPage, pageStyle, paperColorOf, paperOf, stepNoteSize } from "./pageSetup";
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

  it("頁面顏色：白色不寫，存檔讀回來一樣，.docx 寫背景色", () => {
    expect(cleanPage({ ...DEFAULT_PAGE, color: "white" }).color).toBeUndefined();
    expect(cleanPage({ ...DEFAULT_PAGE, color: "neon" }).color).toBeUndefined();
    const p = cleanPage({ ...DEFAULT_PAGE, color: "sepia" });
    expect(isDefaultPage(p)).toBe(false);
    expect(paperColorOf(p.color)).toBe("#f3e9d6");
    expect(paperColorOf(undefined)).toBe("#ffffff");
    expect(docxPage(p).background).toBe("f3e9d6");
    expect(docxPage(DEFAULT_PAGE).background).toBe("");
  });

  it("自訂頁面顏色：#rrggbb 存小寫，#ffffff 等於白色，深色頁面換淺色字", () => {
    const p = cleanPage({ ...DEFAULT_PAGE, color: "#1E2A38" });
    expect(p.color).toBe("#1e2a38");
    expect(paperColorOf(p.color)).toBe("#1e2a38");
    expect(docxPage(p).background).toBe("1e2a38");
    expect(paperIsDark(p.color)).toBe(true);
    expect(paperIsDark("sepia")).toBe(false);
    expect(isDefaultPage(cleanPage({ ...DEFAULT_PAGE, color: "#FFFFFF" }))).toBe(true);
    expect(cleanLook({ color: "#abcdef" })).toEqual({ color: "#abcdef" });
    expect(isDefaultLook({ color: "#ffffff" })).toBe(true);
  });

  it("筆記的文字大小與頁面顏色：只存 note，預設值不寫", () => {
    let f = addDoc(emptyFile(), "note").file;
    const id = f.docs[0].id;
    expect(JSON.parse(serializeFile(f)).docs[0].look).toBeUndefined();
    f = updateDoc(f, id, { look: { size: 20, color: "mint" } });
    expect(JSON.parse(serializeFile(f)).docs[0].look).toEqual({ size: 20, color: "mint" });
    expect(parseFile(serializeFile(f)).docs[0].look).toEqual({ size: 20, color: "mint" });
    expect(cleanLook({ size: 16, color: "white" })).toEqual({});
    expect(cleanLook({ size: 17, color: "neon" })).toEqual({});
    expect(isDefaultLook(undefined)).toBe(true);
    expect(stepNoteSize(undefined, 1)).toBe(18);
    expect(stepNoteSize(undefined, -1)).toBe(15);
    expect(stepNoteSize(12, -1)).toBe(12);
    expect(stepNoteSize(28, 1)).toBe(28);
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
