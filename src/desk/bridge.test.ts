import { describe, expect, it } from "vitest";
import { key, newWorkbook, parseWorkbook } from "../sheet/model";
import { addNote, emptyBoard } from "./board";
import { cardsToSheet, placeNotes, plainLine } from "./bridge";
import { addDoc, emptyFile, parseFile, serializeFile } from "./file";

describe("Dock 的試算表文件", () => {
  it("存檔時寫成物件、讀回來一樣", () => {
    const f = addDoc(emptyFile(), "sheet").file;
    expect(f.docs[0].title).toBe("Spreadsheet");
    const j = JSON.parse(serializeFile(f));
    expect(typeof j.docs[0].sheet).toBe("object");
    expect(j.docs[0].content).toBeUndefined();
    const back = parseFile(serializeFile(f));
    expect(back.docs[0].kind).toBe("sheet");
    expect(parseWorkbook(back.docs[0].content).sheets[0].tables[0].name).toBe("Table 1");
    expect(serializeFile(back)).toBe(serializeFile(f));
  });

  it("舊的資料庫文件讀進來變成試算表", () => {
    const json = JSON.stringify({
      docs: [
        {
          id: "d1",
          title: "Reading list",
          kind: "database",
          database: { props: [{ id: "title", name: "Name", type: "title" }], rows: [{ id: "r", cells: { title: "Dune" } }] },
        },
      ],
    });
    const f = parseFile(json);
    expect(f.docs[0]).toMatchObject({ id: "d1", title: "Reading list", kind: "sheet" });
    const t = parseWorkbook(f.docs[0].content).sheets[0].tables[0];
    expect(t.name).toBe("Reading list");
    expect(t.cells[key(1, 0)].v).toBe("Dune");
  });
});

describe("白板與試算表互通", () => {
  const src = (c: { ref: { kind: string }; text: string }) =>
    c.ref.kind === "note" ? { title: "", content: c.text } : { title: "研究", content: "內容" };

  it("一行 Markdown 變純文字", () => {
    expect(plainLine("## **重點** [[頁面]]")).toBe("重點 頁面");
    expect(plainLine("- { } 買書")).toBe("買書");
    expect(plainLine("[連結](https://a.b) `碼`")).toBe("連結 碼");
  });

  it("卡片接在第一個表格最後一列後面：第一行是名稱，其餘是備註", () => {
    const b = addNote(addNote(emptyBoard(), 0, 0, "**第一**\n\n細節一").board, 0, 200, "第二").board;
    const page = { ...b.cards[0], id: "p", ref: { kind: "page" as const, name: "研究" }, text: "" };
    let wb = newWorkbook();
    wb = cardsToSheet(wb, [...b.cards, page], src);
    let t = wb.sheets[0].tables[0];
    expect([0, 1, 2, 3].map((r) => t.cells[key(r, 0)]?.v)).toEqual(["Name", "第一", "第二", "研究"]);
    expect(t.cells[key(0, 1)].v).toBe("Notes");
    expect(t.cells[key(1, 1)].v).toBe("細節一");
    // 再送一次：接在後面；超過表格就加列
    for (let i = 0; i < 3; i++) wb = cardsToSheet(wb, [...b.cards, page], src);
    t = wb.sheets[0].tables[0];
    expect(t.rows).toBe(13);
    expect(t.cells[key(12, 0)].v).toBe("研究");
  });

  it("沒有表格：建一個", () => {
    const b = addNote(emptyBoard(), 0, 0, "一").board;
    const wb = cardsToSheet({ sheets: [{ id: "s", name: "Sheet 1", tables: [], charts: [] }] }, b.cards, src);
    expect(wb.sheets[0].tables[0].cells[key(1, 0)].v).toBe("一");
  });

  it("便利貼排在既有內容的右邊，一排四張", () => {
    const b = addNote(emptyBoard(), 0, 0, "原本的").board;
    const { board, ids } = placeNotes(b, ["a", "b", "c", "d", "e"]);
    expect(ids).toHaveLength(5);
    const added = board.cards.filter((c) => ids.includes(c.id));
    expect(Math.min(...added.map((c) => c.x))).toBeGreaterThan(b.cards[0].x + b.cards[0].w);
    expect(new Set(added.slice(0, 4).map((c) => c.y)).size).toBe(1);
    expect(added[4].y).toBeGreaterThan(added[0].y);
    expect(added[4].x).toBe(added[0].x);
  });
});
