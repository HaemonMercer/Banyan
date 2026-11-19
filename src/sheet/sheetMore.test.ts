import { describe, expect, it } from "vitest";
import { Calc, show } from "./calc";
import { formatText, toText } from "./formula";
import {
  deleteCols,
  deleteRows,
  growToMerges,
  insertRows,
  key,
  mergeAt,
  mergeCells,
  newWorkbook,
  parseWorkbook,
  removeDuplicates,
  serializeWorkbook,
  setBorders,
  setCell,
  setHidden,
  setNote,
  styleRange,
  unmergeCells,
  type Workbook,
} from "./model";
import { toCsv, toXlsx, unzipNames } from "./xlsx";

/** Excel 與 Google 試算表共有、這次補上的功能 */

const NOW = new Date(2026, 10, 18, 9, 30);

function book(cells: Record<string, string>): { wb: Workbook; tid: string } {
  let wb = newWorkbook();
  const tid = wb.sheets[0].tables[0].id;
  for (const [ref, v] of Object.entries(cells)) {
    const m = /^([A-Z])(\d+)$/.exec(ref)!;
    wb = setCell(wb, tid, Number(m[2]) - 1, m[1].charCodeAt(0) - 65, v);
  }
  return { wb, tid };
}
const f = (cells: Record<string, string>, ref = "A1") => {
  const { wb, tid } = book(cells);
  const m = /^([A-Z])(\d+)$/.exec(ref)!;
  return toText(new Calc(wb, NOW).value(tid, Number(m[2]) - 1, m[1].charCodeAt(0) - 65));
};
const table = (wb: Workbook) => wb.sheets[0].tables[0];

describe("更多函式", () => {
  it("SUMIFS、COUNTIFS、AVERAGEIFS、MAXIFS、MINIFS", () => {
    const data = { A2: "east", A3: "west", A4: "east", A5: "east", B2: "10", B3: "20", B4: "30", B5: "5", C2: "x", C3: "x", C4: "y", C5: "x" };
    expect(f({ ...data, E1: '=SUMIFS(B2:B5, A2:A5, "east", C2:C5, "x")' }, "E1")).toBe("15");
    expect(f({ ...data, E1: '=COUNTIFS(A2:A5, "east", B2:B5, ">6")' }, "E1")).toBe("2");
    expect(f({ ...data, E1: '=AVERAGEIFS(B2:B5, A2:A5, "east")' }, "E1")).toBe("15");
    expect(f({ ...data, E1: '=MAXIFS(B2:B5, A2:A5, "east")' }, "E1")).toBe("30");
    expect(f({ ...data, E1: '=MINIFS(B2:B5, A2:A5, "east")' }, "E1")).toBe("5");
  });

  it("XLOOKUP、HLOOKUP", () => {
    const data = { A2: "apple", A3: "pear", B2: "3", B3: "7" };
    expect(f({ ...data, D1: '=XLOOKUP("pear", A2:A3, B2:B3)' }, "D1")).toBe("7");
    expect(f({ ...data, D1: '=XLOOKUP("kiwi", A2:A3, B2:B3, "none")' }, "D1")).toBe("none");
    expect(f({ ...data, D1: '=XLOOKUP("kiwi", A2:A3, B2:B3)' }, "D1")).toBe("#N/A");
    expect(f({ A1: "a", B1: "b", A2: "1", B2: "2", D1: '=HLOOKUP("b", A1:B2, 2, FALSE)' }, "D1")).toBe("2");
  });

  it("IFS、SWITCH、CHOOSE、IFNA", () => {
    expect(f({ A1: "=IFS(1>2, \"a\", 2>1, \"b\")" })).toBe("b");
    expect(f({ A1: '=SWITCH(2, 1, "one", 2, "two", "other")' })).toBe("two");
    expect(f({ A1: '=SWITCH(9, 1, "one", "other")' })).toBe("other");
    expect(f({ A1: '=CHOOSE(2, "a", "b", "c")' })).toBe("b");
    expect(f({ A1: '=IFNA(XLOOKUP("z", B1:B2, C1:C2), "missing")' })).toBe("missing");
    expect(f({ A1: "=ISNA(NA())" })).toBe("TRUE");
  });

  it("TEXT、TEXTJOIN 與文字", () => {
    expect(f({ A1: '=TEXT(1234.5, "#,##0.00")' })).toBe("1,234.50");
    expect(f({ A1: '=TEXT(0.256, "0.0%")' })).toBe("25.6%");
    expect(f({ A1: '=TEXT(DATE(2026,11,18), "yyyy-mm-dd")' })).toBe("2026-11-18");
    expect(f({ A1: '=TEXT(DATE(2026,11,18), "mmm d, yyyy")' })).toBe("Nov 18, 2026");
    expect(formatText(0.75, "hh:mm")).toBe("18:00");
    expect(f({ A2: "a", A3: "", A4: "c", B1: '=TEXTJOIN(", ", TRUE, A2:A4)' }, "B1")).toBe("a, c");
    expect(f({ A1: '=EXACT("A", "a")' })).toBe("FALSE");
    expect(f({ A1: "=CHAR(65)" })).toBe("A");
  });

  it("統計與數學", () => {
    const d = { A2: "2", A3: "4", A4: "4", A5: "4", A6: "5", A7: "5", A8: "7", A9: "9" };
    expect(f({ ...d, B1: "=LARGE(A2:A9, 2)" }, "B1")).toBe("7");
    expect(f({ ...d, B1: "=SMALL(A2:A9, 1)" }, "B1")).toBe("2");
    expect(f({ ...d, B1: "=STDEVP(A2:A9)" }, "B1")).toBe("2");
    expect(f({ ...d, B1: "=MODE(A2:A9)" }, "B1")).toBe("4");
    expect(f({ ...d, B1: "=RANK(7, A2:A9)" }, "B1")).toBe("2");
    expect(f({ A2: "1", A3: "2", B2: "3", B3: "4", C1: "=SUMPRODUCT(A2:A3, B2:B3)" }, "C1")).toBe("11");
    expect(f({ A1: "=TRUNC(3.789, 1)" })).toBe("3.7");
    expect(f({ A1: "=LOG(8, 2)" })).toBe("3");
    expect(f({ A1: "=ISODD(3)" })).toBe("TRUE");
    const r = Number(f({ A1: "=RANDBETWEEN(1, 3)" }));
    expect(r >= 1 && r <= 3).toBe(true);
  });

  it("日期與時間", () => {
    expect(f({ A1: '=HOUR("14:35")' })).toBe("14");
    expect(f({ A1: '=MINUTE("14:35")' })).toBe("35");
    expect(f({ A1: "=DAY(EOMONTH(DATE(2026,2,10), 0))" })).toBe("28");
    // 2026-11-16（一）到 11-20（五）
    expect(f({ A1: "=NETWORKDAYS(DATE(2026,11,16), DATE(2026,11,22))" })).toBe("5");
  });
});

describe("合併、藏起來、框線、附註", () => {
  it("合併留下左上角的內容，取消合併", () => {
    let { wb, tid } = book({ B2: "", C2: "keep", C3: "gone" });
    wb = mergeCells(wb, tid, { r0: 1, c0: 1, r1: 2, c1: 2 });
    const t = table(wb);
    expect(t.merges).toEqual([{ r0: 1, c0: 1, r1: 2, c1: 2 }]);
    expect(t.cells[key(1, 1)].v).toBe("keep");
    expect(t.cells[key(2, 2)]).toBeUndefined();
    expect(mergeAt(t, 2, 2)).toEqual({ r0: 1, c0: 1, r1: 2, c1: 2 });
    expect(growToMerges(t, { r0: 2, c0: 0, r1: 2, c1: 1 })).toEqual({ r0: 1, c0: 0, r1: 2, c1: 2 });
    wb = unmergeCells(wb, tid, { r0: 2, c0: 2, r1: 2, c1: 2 });
    expect(table(wb).merges).toBeUndefined();
  });

  it("插入、刪除列欄時合併與藏起來的列跟著搬；存檔讀回來", () => {
    let { wb, tid } = book({});
    wb = mergeCells(wb, tid, { r0: 2, c0: 0, r1: 3, c1: 1 });
    wb = setHidden(wb, tid, "row", [5], true);
    wb = setHidden(wb, tid, "col", [3], true);
    wb = insertRows(wb, tid, 1, 2);
    expect(table(wb).merges).toEqual([{ r0: 4, c0: 0, r1: 5, c1: 1 }]);
    expect(table(wb).hideR).toEqual([7]);
    wb = deleteCols(wb, tid, 1, 1);
    // 只剩一欄寬：還是兩列高，所以還算合併
    expect(table(wb).merges).toEqual([{ r0: 4, c0: 0, r1: 5, c1: 0 }]);
    expect(table(wb).hideC).toEqual([2]);
    wb = deleteRows(wb, tid, 5, 1);
    expect(table(wb).merges).toBeUndefined();
    const back = parseWorkbook(serializeWorkbook(wb));
    expect(back.sheets[0].tables[0].hideR).toEqual([6]);
    expect(back.sheets[0].tables[0].hideC).toEqual([2]);
  });

  it("框線：外框只在邊上，內框在格子之間，None 拿掉", () => {
    let { wb, tid } = book({});
    const r = { r0: 0, c0: 0, r1: 1, c1: 1 };
    wb = setBorders(wb, tid, r, "outer");
    expect(table(wb).cells[key(0, 0)].s?.bd).toBe("tl");
    expect(table(wb).cells[key(1, 1)].s?.bd).toBe("rb");
    wb = setBorders(wb, tid, r, "inner");
    expect(table(wb).cells[key(0, 0)].s?.bd).toBe("trbl");
    wb = setBorders(wb, tid, r, "none");
    expect(table(wb).cells[key(0, 0)]).toBeUndefined();
  });

  it("附註、下拉選單、字級、刪除線存檔讀回來", () => {
    let { wb, tid } = book({ A1: "x" });
    wb = setNote(wb, tid, 0, 0, "check this");
    wb = styleRange(wb, tid, { r0: 0, c0: 0, r1: 0, c1: 0 }, { fmt: "popup", opts: ["Yes", "No"], fs: 18, st: true, wrap: true, va: "top" });
    const back = parseWorkbook(serializeWorkbook(wb)).sheets[0].tables[0].cells[key(0, 0)];
    expect(back.n).toBe("check this");
    expect(back.s).toMatchObject({ fmt: "popup", opts: ["Yes", "No"], fs: 18, st: true, wrap: true, va: "top" });
    expect(show({ t: "s", s: "Yes" }, back.s).popup).toBe(true);
    wb = setNote(wb, tid, 0, 0, "");
    expect(table(wb).cells[key(0, 0)].n).toBeUndefined();
  });

  it("移除重複的列", () => {
    const { wb, tid } = book({ A2: "a", A3: "b", A4: "A", A5: "c", B2: "1", B3: "2", B4: "1", B5: "3" });
    const t = table(wb);
    const calc = new Calc(wb, NOW);
    const textOf = (r: number, c: number) => show(calc.value(tid, r, c), t.cells[key(r, c)]?.s).text;
    const r = removeDuplicates(wb, tid, [0, 1], textOf);
    expect(r.removed).toBe(1);
    expect(table(r.wb).cells[key(3, 0)].v).toBe("c");
  });
});

describe("匯出", () => {
  it("CSV 用引號包住逗號與引號", () => {
    const { wb } = book({ A1: "Name", B1: "Note", A2: "Ann", B2: 'says "hi", ok' });
    const csv = toCsv(table(wb), new Calc(wb, NOW));
    expect(csv).toBe('Name,Note\r\nAnn,"says ""hi"", ok"\r\n');
  });

  it(".xlsx 寫入合併、框線、下拉選單", () => {
    let { wb, tid } = book({ A1: "x" });
    wb = mergeCells(wb, tid, { r0: 0, c0: 0, r1: 0, c1: 1 });
    wb = setBorders(wb, tid, { r0: 1, c0: 0, r1: 1, c1: 0 }, "all");
    wb = styleRange(wb, tid, { r0: 2, c0: 0, r1: 2, c1: 0 }, { fmt: "popup", opts: ["a", "b"] });
    const bytes = toXlsx(wb, new Calc(wb, NOW));
    const text = new TextDecoder().decode(bytes);
    expect(unzipNames(bytes)).toContain("xl/worksheets/sheet1.xml");
    expect(text).toContain('<mergeCell ref="A1:B1"/>');
    expect(text).toContain('<left style="thin">');
    expect(text).toContain('<dataValidation type="list"');
  });
});
