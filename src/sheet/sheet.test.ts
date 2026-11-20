import { describe, expect, it } from "vitest";
import { Calc, show } from "./calc";
import { formulaError, mapRefs, toText, type Value } from "./formula";
import {
  deleteCols,
  deleteRows,
  fill,
  fromDatabase,
  insertCols,
  insertRows,
  key,
  newWorkbook,
  parseWorkbook,
  pasteGrid,
  renameTable,
  resizeTable,
  serializeWorkbook,
  setCell,
  sortBody,
  styleRange,
  addSheet,
  renameSheet,
  type Workbook,
} from "./model";
import { toXlsx, unzipNames } from "./xlsx";
import { sortKey } from "./calc";

const NOW = new Date(2026, 10, 18, 9, 30);

/** 在第一張表格依序填格子：{ A1: "1", B2: "=A1*2" } */
function book(cells: Record<string, string>): { wb: Workbook; tid: string } {
  let wb = newWorkbook();
  const tid = wb.sheets[0].tables[0].id;
  for (const [ref, v] of Object.entries(cells)) {
    const m = /^([A-Z])(\d+)$/.exec(ref)!;
    wb = setCell(wb, tid, Number(m[2]) - 1, m[1].charCodeAt(0) - 65, v);
  }
  return { wb, tid };
}

const val = (wb: Workbook, tid: string, ref: string): Value => {
  const m = /^([A-Z])(\d+)$/.exec(ref)!;
  return new Calc(wb, NOW).value(tid, Number(m[2]) - 1, m[1].charCodeAt(0) - 65);
};
const text = (wb: Workbook, tid: string, ref: string) => {
  const m = /^([A-Z])(\d+)$/.exec(ref)!;
  const t = wb.sheets.flatMap((s) => s.tables).find((x) => x.id === tid)!;
  return show(val(wb, tid, ref), t.cells[key(Number(m[2]) - 1, m[1].charCodeAt(0) - 65)]?.s).text;
};
const f = (cells: Record<string, string>, ref = "A1") => {
  const { wb, tid } = book(cells);
  return toText(val(wb, tid, ref));
};

describe("公式", () => {
  it("運算與優先順序", () => {
    expect(f({ A1: "=1+2*3" })).toBe("7");
    expect(f({ A1: "=(1+2)*3" })).toBe("9");
    expect(f({ A1: "=2^3^2" })).toBe("512");
    expect(f({ A1: "=-2^2" })).toBe("4");
    expect(f({ A1: "=50%*10" })).toBe("5");
    expect(f({ A1: '="a"&1&TRUE' })).toBe("a1TRUE");
    expect(f({ A1: "=1/0" })).toBe("#DIV/0!");
    expect(f({ A1: '="x"+1' })).toBe("#VALUE!");
  });

  it("參照、範圍、整欄、迴圈", () => {
    expect(f({ A2: "3", A3: "4", B2: "=A2*A3" }, "B2")).toBe("12");
    expect(f({ A2: "1", A3: "2", A4: "x", C1: "=SUM(A2:A4)" }, "C1")).toBe("3");
    // 整欄不含標題列
    expect(f({ A1: "100", A2: "1", A3: "2", B1: "=SUM(A:A)" }, "B1")).toBe("3");
    expect(f({ A1: "=B1", B1: "=A1" })).toBe("#CIRC!");
    expect(f({ A1: "=$B$2+B3", B2: "1", B3: "2" })).toBe("3");
    expect(f({ A1: "=Z99" })).toBe("#REF!");
    expect(f({ A1: "=B1" })).toBe("0");
  });

  it("函式", () => {
    const cells = { A2: "3", A3: "5", A4: "8", B2: "x", B3: "y", B4: "x" };
    expect(f({ ...cells, C1: "=AVERAGE(A2:A4)" }, "C1")).toBe("5.333333333");
    expect(f({ ...cells, C1: "=ROUND(AVERAGE(A2:A4),2)" }, "C1")).toBe("5.33");
    expect(f({ ...cells, C1: '=COUNTIF(B2:B4,"x")' }, "C1")).toBe("2");
    expect(f({ ...cells, C1: '=SUMIF(B2:B4,"x",A2:A4)' }, "C1")).toBe("11");
    expect(f({ ...cells, C1: '=COUNTIF(A2:A4,">4")' }, "C1")).toBe("2");
    expect(f({ ...cells, C1: "=MAX(A2:A4)-MIN(A2:A4)" }, "C1")).toBe("5");
    expect(f({ ...cells, C1: '=IF(A2>2,"big","small")' }, "C1")).toBe("big");
    expect(f({ ...cells, C1: '=IFERROR(1/0,"none")' }, "C1")).toBe("none");
    expect(f({ ...cells, C1: "=VLOOKUP(5,A2:B4,2,FALSE)" }, "C1")).toBe("y");
    expect(f({ ...cells, C1: "=INDEX(A2:B4,3,1)" }, "C1")).toBe("8");
    expect(f({ ...cells, C1: '=MATCH("y",B2:B4,0)' }, "C1")).toBe("2");
    expect(f({ C1: '=LEFT("Banyan",3)&UPPER(MID("abc",2,1))&LEN("你好")' }, "C1")).toBe("BanB2");
    expect(f({ C1: '=SUBSTITUTE("a-b-c","-","+")' }, "C1")).toBe("a+b+c");
    expect(f({ C1: "=AND(TRUE,1>0,NOT(FALSE))" }, "C1")).toBe("TRUE");
  });

  it("日期", () => {
    const { wb, tid } = book({ A1: "2026-11-18", B1: "=A1+14", C1: "=TODAY()", D1: '=DAYS("2026-12-25",C1)', E1: "=DATE(2026,13,1)" });
    expect(text(wb, tid, "A1")).toBe("Nov 18, 2026");
    expect(text(wb, tid, "B1")).toBe("Dec 2, 2026");
    expect(text(wb, tid, "C1")).toBe("Nov 18, 2026");
    expect(text(wb, tid, "D1")).toBe("37");
    expect(text(wb, tid, "E1")).toBe("Jan 1, 2027");
    expect(f({ A1: "=YEAR(DATE(2026,2,3))+MONTH(\"2026-02-03\")+DAY(\"2026-02-03\")" })).toBe(String(2026 + 2 + 3));
  });

  it("語法錯誤", () => {
    expect(formulaError("1+")).toMatch(/ends too early/);
    expect(formulaError("FOO(1)")).toMatch(/Unknown function FOO/);
    expect(formulaError("ROUND(1,2,3)")).toMatch(/1 to 2/);
    expect(formulaError('"open')).toMatch(/isn't closed/);
    expect(f({ A1: "=SUM(" })).toBe("#ERROR!");
  });

  it("別的表格與工作表", () => {
    let { wb, tid } = book({ A1: "7" });
    const r = addSheet(wb);
    wb = r.wb;
    const other = wb.sheets[1].tables[0];
    expect(other.name).toBe("Table 2");
    wb = setCell(wb, other.id, 0, 0, "=Table 1::A1*2");
    wb = setCell(wb, other.id, 0, 1, "=Sheet 1::Table 1::A1+1");
    expect(toText(new Calc(wb).value(other.id, 0, 0))).toBe("14");
    expect(toText(new Calc(wb).value(other.id, 0, 1))).toBe("8");
    wb = renameTable(wb, tid, "Prices");
    wb = renameSheet(wb, wb.sheets[0].id, "Main (2026)");
    const cells = wb.sheets[1].tables[0].cells;
    expect(cells[key(0, 0)].v).toBe("=Prices::A1*2");
    expect(cells[key(0, 1)].v).toBe("='Main (2026)'::Prices::A1+1");
    expect(toText(new Calc(wb).value(other.id, 0, 1))).toBe("8");
  });
});

describe("格式", () => {
  it("自動格式依輸入猜", () => {
    const { wb, tid } = book({ A1: "$1234.5", B1: "15%", C1: "1,200", D1: "=A1*2", E1: "'00123", A2: "TRUE" });
    expect(text(wb, tid, "A1")).toBe("$1,234.50");
    expect(text(wb, tid, "B1")).toBe("15%");
    expect(text(wb, tid, "C1")).toBe("1200");
    expect(text(wb, tid, "D1")).toBe("$2,469.00");
    expect(text(wb, tid, "E1")).toBe("00123");
    expect(text(wb, tid, "A2")).toBe("TRUE");
  });

  it("指定格式", () => {
    let { wb, tid } = book({ A1: "0.256", B1: "1234567.891", C1: "1", D1: "4" });
    wb = styleRange(wb, tid, { r0: 0, c0: 0, r1: 0, c1: 0 }, { fmt: "percent", dec: 1 });
    wb = styleRange(wb, tid, { r0: 0, c0: 1, r1: 0, c1: 1 }, { fmt: "number", dec: 2, sep: true });
    wb = styleRange(wb, tid, { r0: 0, c0: 2, r1: 0, c1: 2 }, { fmt: "checkbox" });
    wb = styleRange(wb, tid, { r0: 0, c0: 3, r1: 0, c1: 3 }, { fmt: "stars" });
    expect(text(wb, tid, "A1")).toBe("25.6%");
    expect(text(wb, tid, "B1")).toBe("1,234,567.89");
    const t = wb.sheets[0].tables[0];
    expect(show(val(wb, tid, "C1"), t.cells[key(0, 2)].s).check).toBe(true);
    expect(show(val(wb, tid, "D1"), t.cells[key(0, 3)].s).stars).toBe(4);
    // 拿掉格式
    wb = styleRange(wb, tid, { r0: 0, c0: 0, r1: 0, c1: 0 }, { fmt: undefined, dec: undefined });
    expect(wb.sheets[0].tables[0].cells[key(0, 0)].s).toBeUndefined();
  });
});

describe("編輯表格", () => {
  it("插入、刪除列欄時公式跟著改", () => {
    let { wb, tid } = book({ A2: "1", A3: "2", A4: "3", B1: "=SUM(A2:A4)", C1: "=A3*10" });
    wb = insertRows(wb, tid, 2, 1);
    let t = wb.sheets[0].tables[0];
    expect(t.rows).toBe(11);
    expect(t.cells[key(0, 1)].v).toBe("=SUM(A2:A5)");
    expect(t.cells[key(0, 2)].v).toBe("=A4*10");
    wb = deleteRows(wb, tid, 3, 1);
    t = wb.sheets[0].tables[0];
    expect(t.cells[key(0, 1)].v).toBe("=SUM(A2:A4)");
    expect(t.cells[key(0, 2)].v).toBe("=#REF!*10");
    expect(toText(new Calc(wb).value(tid, 0, 2))).toBe("#REF!");
    wb = insertCols(wb, tid, 0, 2);
    t = wb.sheets[0].tables[0];
    expect(t.cols).toBe(7);
    expect(t.hc).toBe(3);
    expect(t.cells[key(0, 3)].v).toBe("=SUM(C2:C4)");
    wb = deleteCols(wb, tid, 0, 2);
    expect(wb.sheets[0].tables[0].cells[key(0, 1)].v).toBe("=SUM(A2:A4)");
  });

  it("貼上：表格長大、公式的相對參照位移", () => {
    let { wb, tid } = book({});
    wb = pasteGrid(wb, tid, 8, 3, [[{ v: "=A1+$B$1" }, { v: "x" }, { v: "y" }], [{ v: "1" }]], { r: 0, c: 0 });
    const t = wb.sheets[0].tables[0];
    expect(t.rows).toBe(10);
    expect(t.cols).toBe(6);
    expect(t.cells[key(8, 3)].v).toBe("=D9+$B$1");
    expect(t.cells[key(8, 5)].v).toBe("y");
  });

  it("往下填滿、排序、改大小", () => {
    let { wb, tid } = book({ A2: "3", A3: "1", A4: "2", B2: "=A2*2" });
    wb = fill(wb, tid, { r0: 1, c0: 1, r1: 3, c1: 1 }, "down");
    expect(wb.sheets[0].tables[0].cells[key(3, 1)].v).toBe("=A4*2");
    wb = resizeTable(wb, tid, 4, 2);
    const c = new Calc(wb);
    wb = sortBody(wb, tid, false, (r) => sortKey(c.value(tid, r, 0)));
    const t = wb.sheets[0].tables[0];
    expect([1, 2, 3].map((r) => t.cells[key(r, 0)].v)).toEqual(["1", "2", "3"]);
    expect([1, 2, 3].map((r) => t.cells[key(r, 1)].v)).toEqual(["=A2*2", "=A3*2", "=A4*2"]);
    expect([1, 2, 3].map((r) => toText(new Calc(wb).value(tid, r, 1)))).toEqual(["2", "4", "6"]);
  });

  it("讀寫保留內容", () => {
    let { wb, tid } = book({ A1: "Name", B2: "=1+1" });
    wb = styleRange(wb, tid, { r0: 0, c0: 0, r1: 0, c1: 0 }, { b: true, fill: "#ffeeaa" });
    const back = parseWorkbook(serializeWorkbook(wb));
    expect(back).toEqual(wb);
    expect(parseWorkbook("garbage").sheets).toHaveLength(1);
  });

  it("mapRefs 只動參照", () => {
    expect(mapRefs('SUM(A1:B2)+"A1"&Table 2::C3', (r) => ({ ...r, col: r.col + 1 }))).toBe('SUM(B1:C2)+"A1"&Table 2::D3');
  });
});

describe("舊的資料庫", () => {
  it("轉成一張表格", () => {
    const wb = fromDatabase(
      {
        props: [
          { id: "title", name: "Name", type: "title" },
          { id: "s", name: "Status", type: "select", options: [{ id: "o1", name: "Done" }] },
          { id: "d", name: "Done?", type: "checkbox" },
          { id: "n", name: "Price", type: "number" },
          { id: "m", name: "Tags", type: "multi", options: [{ id: "a", name: "A" }, { id: "b", name: "B" }] },
        ],
        rows: [{ id: "r1", cells: { title: "Pen", s: "o1", d: true, n: 3, m: ["a", "b"] } }],
      },
      "Tasks",
    );
    const t = wb.sheets[0].tables[0];
    expect(t.name).toBe("Tasks");
    expect([0, 1, 2, 3, 4].map((c) => t.cells[key(0, c)].v)).toEqual(["Name", "Status", "Done?", "Price", "Tags"]);
    expect([0, 1, 2, 3, 4].map((c) => t.cells[key(1, c)].v)).toEqual(["Pen", "Done", "TRUE", "3", "A, B"]);
    expect(t.cells[key(1, 2)].s?.fmt).toBe("checkbox");
  });
});

describe("匯出 .xlsx", () => {
  it("每個表格一張工作表，公式與值都寫進去", async () => {
    const { wb } = book({ A1: "Item", B1: "Qty", A2: "Pen", B2: "3", B3: "=B2*2" });
    const bytes = toXlsx(wb, new Calc(wb, NOW));
    const names = unzipNames(bytes);
    expect(names).toEqual(
      expect.arrayContaining(["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/styles.xml", "xl/sharedStrings.xml"]),
    );
    const xml = new TextDecoder().decode(bytes);
    expect(xml).toContain("<f>B2*2</f><v>6</v>");
  });
});
