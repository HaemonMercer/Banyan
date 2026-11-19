import { describe, expect, it } from "vitest";
import { addNote, addTableCard, editsInPlace, emptyBoard, fixedSize, ownsText, parseBoard, refLabel, serializeBoard } from "./board";
import { newCardWorkbook, sheetCardSize, sheetMarkdown, sheetPreview, tabularClip } from "./boardSheet";
import { cardsIntoWorkbook } from "./bridge";
import { cardsMarkdown, type CardSource } from "./file";
import { appendWorkbook } from "../sheet/importer";
import { newWorkbook, parseWorkbook, serializeWorkbook, setCell } from "../sheet/model";

const withFormula = () => {
  let wb = parseWorkbook(newCardWorkbook([["Item", "Cost"], ["Tent", "120"], ["Stove", "45"], ["Total", ""]]));
  const tid = wb.sheets[0].tables[0].id;
  wb = setCell(wb, tid, 3, 1, "=SUM(B2:B3)");
  return serializeWorkbook(wb);
};

describe("白板的表格卡片", () => {
  it("新卡片：空白表格（3 欄 4 列、第一列是標題）或貼上的格子（第一列是文字就當標題）", () => {
    const blank = parseWorkbook(newCardWorkbook());
    expect(blank.sheets).toHaveLength(1);
    expect(blank.sheets[0].tables[0]).toMatchObject({ rows: 4, cols: 3, hr: 1, x: 0, y: 0 });
    const t = parseWorkbook(newCardWorkbook([["Name", "Age"], ["Ann", "30"]])).sheets[0].tables[0];
    expect(t).toMatchObject({ rows: 2, cols: 2, hr: 1 });
    expect(t.cells["1,1"].v).toBe("30");
  });

  it("白板上顯示算好的值（公式照算）、標題列另外標", () => {
    const [t] = sheetPreview(withFormula());
    expect(t.rows.map((r) => r.map((c) => c.text))).toEqual([
      ["Item", "Cost"],
      ["Tent", "120"],
      ["Stove", "45"],
      ["Total", "165"],
    ]);
    expect(t.rows[0].every((c) => c.head)).toBe(true);
    expect(t.rows[1][0].head).toBe(false);
    expect(t.rows[1][1].align).toBe("right");
  });

  it("卡片大小剛好放得下表格（有上下限）", () => {
    const s = sheetCardSize(withFormula());
    expect(s.w).toBeGreaterThan(200);
    expect(s.h).toBeGreaterThan(4 * 27);
    expect(sheetCardSize(serializeWorkbook({ sheets: [{ ...newWorkbook().sheets[0], tables: [] }] }))).toEqual({ w: 320, h: 160 });
  });

  it("貼上的文字是不是試算表的格子", () => {
    expect(tabularClip("a\tb\n1\t2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(tabularClip("a\tb\r\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(tabularClip("just a line\twith tab")).toBeNull();
    expect(tabularClip("a\tb\nno tab here")).toBeNull();
    expect(tabularClip("a\tb\tc\n1\t2")).toBeNull();
  });

  it("卡片：內容存在卡片、大小固定、在白板上方編輯；存檔再讀回來", () => {
    const json = withFormula();
    const b = addTableCard(emptyBoard(), 5, 6, json, 300, 150).board;
    const c = b.cards[0];
    expect([ownsText(c.ref), fixedSize(c.ref), editsInPlace(c.ref), refLabel(c.ref)]).toEqual([true, true, true, "Table"]);
    expect(parseBoard(serializeBoard(b)).cards[0]).toMatchObject({ ref: { kind: "sheet" }, x: 5, y: 6, w: 300, h: 150, text: json });
  });
});

describe("表格卡片送到 Dock", () => {
  it("送到 Excel：表格卡片的工作表接上（換新 id、撞名改名），其他卡片一張一列", () => {
    let b = addTableCard(emptyBoard(), 0, 0, withFormula()).board;
    b = addNote(b, 0, 300, "Idea").board;
    const source: CardSource = (c) => ({ title: "", content: c.text });
    const blankBase = { sheets: newWorkbook().sheets.map((s) => ({ ...s, tables: [] })) };
    const wb = cardsIntoWorkbook(blankBase, b.cards, source);
    // 便利貼一張表格（原本的工作表），表格卡片接成第二張工作表
    expect(wb.sheets).toHaveLength(2);
    const card = parseWorkbook(b.cards[0].text);
    expect(wb.sheets[1].tables[0].id).not.toBe(card.sheets[0].tables[0].id);
    expect(wb.sheets[1].name).toBe("Sheet 1 2");
    // 只有表格卡片：空白的活頁簿直接換掉
    const only = cardsIntoWorkbook(blankBase, b.cards.slice(0, 1), source);
    expect(only.sheets).toHaveLength(1);
    // 同一張表格接兩次：id 不重複
    const twice = appendWorkbook(only, card).wb;
    const ids = twice.sheets.flatMap((s) => s.tables.map((t) => t.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("送到 Word／簡報：表格區塊（顯示的值），不加標題", () => {
    const b = addTableCard(emptyBoard(), 0, 0, withFormula()).board;
    const md = sheetMarkdown(b.cards[0].text);
    expect(md).toBe("<table>\n<tr><th>Item</th><th>Cost</th></tr>\n<tr><td>Tent</td><td>120</td></tr>\n<tr><td>Stove</td><td>45</td></tr>\n<tr><td>Total</td><td>165</td></tr>\n</table>");
    expect(cardsMarkdown(b.cards, () => ({ title: "Table", content: md }), "word")).toBe(md);
  });
});
