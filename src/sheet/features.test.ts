// @vitest-environment jsdom
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Calc } from "./calc";
import { autofill, findAll, hiddenRows, matches, replaceIn, ruleLooks, seriesAt } from "./features";
import { toText, type Value } from "./formula";
import { addImported, fromExcelFormula, importCsv, parseCsv, readXlsx, unzip } from "./importer";
import {
  addRule,
  deleteCols,
  deleteRows,
  duplicateSheet,
  duplicateTable,
  insertRows,
  key,
  newWorkbook,
  parseWorkbook,
  patchTable,
  serializeWorkbook,
  setCell,
  setRowHeights,
  styleRange,
  type Workbook,
} from "./model";
import { toXlsx, zip } from "./xlsx";

function book(cells: Record<string, string>): { wb: Workbook; tid: string } {
  let wb = newWorkbook();
  const tid = wb.sheets[0].tables[0].id;
  for (const [ref, v] of Object.entries(cells)) {
    const m = /^([A-Z])(\d+)$/.exec(ref)!;
    wb = setCell(wb, tid, Number(m[2]) - 1, m[1].charCodeAt(0) - 65, v);
  }
  return { wb, tid };
}
const cellsOf = (wb: Workbook, tid: string) => wb.sheets.flatMap((s) => s.tables).find((t) => t.id === tid)!.cells;
const col = (wb: Workbook, tid: string, c: number, r0: number, r1: number) =>
  Array.from({ length: r1 - r0 + 1 }, (_x, i) => cellsOf(wb, tid)[key(r0 + i, c)]?.v ?? "");

describe("條件", () => {
  const n = (x: number): Value => ({ t: "n", n: x });
  it("數字、文字、空白", () => {
    expect(matches({ op: "gt", value: "10" }, n(12), "12")).toBe(true);
    expect(matches({ op: "between", value: "5", value2: "1" }, n(3), "3")).toBe(true);
    expect(matches({ op: "lte", value: "15%" }, n(0.1), "10%")).toBe(true);
    expect(matches({ op: "eq", value: "pen" }, { t: "s", s: "Pen" }, "Pen")).toBe(true);
    expect(matches({ op: "contains", value: "EN" }, { t: "s", s: "Pen" }, "Pen")).toBe(true);
    expect(matches({ op: "begins", value: "x" }, { t: "s", s: "Pen" }, "Pen")).toBe(false);
    expect(matches({ op: "contains", value: "" }, { t: "s", s: "Pen" }, "Pen")).toBe(true);
    expect(matches({ op: "empty", value: "" }, { t: "empty" }, "")).toBe(true);
    expect(matches({ op: "gt", value: "1" }, { t: "s", s: "abc" }, "abc")).toBe(false);
  });

  it("篩選掉的列、醒目提示", () => {
    let { wb, tid } = book({ A1: "Item", B1: "Qty", A2: "Pen", B2: "3", A3: "Ink", B3: "10", A4: "Pen", B4: "12" });
    wb = patchTable(wb, tid, { filters: [{ col: 1, op: "gte", value: "10" }], filterOn: true });
    let t = wb.sheets[0].tables[0];
    // 第 5 列以後是空的：數字條件不符合也藏起來
    expect([...hiddenRows(t, new Calc(wb))].slice(0, 2)).toEqual([1, 4]);
    wb = patchTable(wb, tid, { filterOn: false });
    expect(hiddenRows(wb.sheets[0].tables[0], new Calc(wb)).size).toBe(0);
    wb = addRule(wb, tid, { r0: 1, c0: 0, r1: 3, c1: 0, op: "dup", value: "", look: "yellow" }).wb;
    wb = addRule(wb, tid, { r0: 1, c0: 1, r1: 3, c1: 1, op: "gt", value: "5", look: "green" }).wb;
    t = wb.sheets[0].tables[0];
    const looks = ruleLooks(t, new Calc(wb));
    expect([...looks.entries()].sort()).toEqual([
      ["1,0", "yellow"],
      ["2,1", "green"],
      ["3,0", "yellow"],
      ["3,1", "green"],
    ]);
  });

  it("插入、刪除列欄時列高、篩選、醒目提示跟著搬，讀寫保留", () => {
    let { wb, tid } = book({ A1: "x" });
    wb = setRowHeights(wb, tid, [3], 50);
    wb = patchTable(wb, tid, { filters: [{ col: 2, op: "notEmpty", value: "" }], filterOn: true });
    wb = addRule(wb, tid, { r0: 2, c0: 1, r1: 5, c1: 2, op: "gt", value: "1", look: "red" }).wb;
    wb = insertRows(wb, tid, 1, 2);
    let t = wb.sheets[0].tables[0];
    expect(t.rowH).toEqual({ 5: 50 });
    expect(t.rules[0]).toMatchObject({ r0: 4, r1: 7 });
    wb = deleteRows(wb, tid, 5, 1);
    wb = deleteCols(wb, tid, 1, 1);
    t = wb.sheets[0].tables[0];
    expect(t.rowH).toEqual({});
    expect(t.filters).toEqual([{ col: 1, op: "notEmpty", value: "" }]);
    expect(t.rules[0]).toMatchObject({ r0: 4, r1: 6, c0: 1, c1: 1 });
    expect(parseWorkbook(serializeWorkbook(wb))).toEqual(wb);
  });
});

describe("自動填滿", () => {
  const c = (...vs: string[]) => vs.map((v) => ({ v }));
  it("數列", () => {
    const at = (src: string[], k: number) => seriesAt(c(...src), k, "row")?.v;
    expect([3, 4, 5].map((k) => at(["1", "3"], k))).toEqual(["7", "9", "11"]);
    expect(at(["5"], 3)).toBe("5");
    expect(at(["2026-11-18"], 2)).toBe("2026-11-20");
    expect(at(["$10", "$15"], 2)).toBe("$20");
    expect(at(["10%", "20%"], 2)).toBe("30%");
    expect([1, 2].map((k) => at(["Item 1"], k))).toEqual(["Item 2", "Item 3"]);
    expect(at(["Q09"], 1)).toBe("Q10");
    expect([1, 12].map((k) => at(["Jan"], k))).toEqual(["Feb", "Jan"]);
    expect(at(["Monday", "Wednesday"], 2)).toBe("Friday");
    expect([2, 3].map((k) => at(["a", "b"], k))).toEqual(["a", "b"]);
  });

  it("往下、往右，公式位移", () => {
    let { wb, tid } = book({ A2: "1", A3: "2", B2: "=A2*10" });
    wb = autofill(wb, tid, { r0: 1, c0: 0, r1: 2, c1: 0 }, { r0: 1, c0: 0, r1: 5, c1: 0 });
    expect(col(wb, tid, 0, 1, 5)).toEqual(["1", "2", "3", "4", "5"]);
    wb = autofill(wb, tid, { r0: 1, c0: 1, r1: 1, c1: 1 }, { r0: 1, c0: 1, r1: 3, c1: 1 });
    expect(col(wb, tid, 1, 1, 3)).toEqual(["=A2*10", "=A3*10", "=A4*10"]);
    wb = autofill(wb, tid, { r0: 0, c0: 0, r1: 0, c1: 0 }, { r0: 0, c0: 0, r1: 0, c1: 3 });
    expect(cellsOf(wb, tid)[key(0, 3)]).toBeUndefined();
    wb = setCell(wb, tid, 0, 0, "Mon");
    wb = autofill(wb, tid, { r0: 0, c0: 0, r1: 0, c1: 0 }, { r0: 0, c0: 0, r1: 0, c1: 2 });
    expect([0, 1, 2].map((c2) => cellsOf(wb, tid)[key(0, c2)].v)).toEqual(["Mon", "Tue", "Wed"]);
  });
});

describe("尋找與取代", () => {
  it("找顯示的文字、取代原始文字（公式不動）", () => {
    const { wb, tid } = book({ A1: "Pen", A2: "pencil", A3: "=A1", B1: "$5" });
    const calc = new Calc(wb);
    const hits = findAll(wb.sheets[0], calc, "pen", { matchCase: false, whole: false });
    expect(hits.map((h) => [h.r, h.c])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    expect(findAll(wb.sheets[0], calc, "Pen", { matchCase: true, whole: true })).toHaveLength(2);
    expect(findAll(wb.sheets[0], calc, "$5.00", { matchCase: false, whole: true })).toHaveLength(1);
    const r = replaceIn(wb, hits, "pen", "Ink", { matchCase: false, whole: false });
    expect(r.count).toBe(2);
    expect(col(r.wb, tid, 0, 0, 2)).toEqual(["Ink", "Inkcil", "=A1"]);
  });
});

describe("複製", () => {
  it("表格與工作表", () => {
    let { wb, tid } = book({ A1: "1", B1: "=Table 1::A1+1" });
    const d = duplicateTable(wb, tid);
    wb = d.wb;
    expect(wb.sheets[0].tables.map((t) => t.name)).toEqual(["Table 1", "Table 1 copy"]);
    const s = duplicateSheet(wb, wb.sheets[0].id);
    wb = s.wb;
    expect(wb.sheets.map((x) => x.name)).toEqual(["Sheet 1", "Sheet 1 copy"]);
    const copy = wb.sheets[1].tables[0];
    expect(copy.name).toBe("Table 1 copy 2");
    expect(copy.cells[key(0, 1)].v).toBe("=Table 1 copy 2::A1+1");
    expect(toText(new Calc(wb).value(copy.id, 0, 1))).toBe("2");
  });
});

describe("匯入", () => {
  it("CSV：引號、換行、分號與 Tab", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,"x\ny",3\n')).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["1", "x\ny", "3"],
    ]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("a;b\n1;2")[1]).toEqual(["1", "2"]);
    const wb = importCsv(newWorkbook(), newWorkbook().sheets[0].id, "C:/x/Sales 2026.csv", "Item,Qty\nPen,3\n", 400).wb;
    void wb;
    const base = newWorkbook();
    const r = importCsv(base, base.sheets[0].id, "Sales.csv", "Item,Qty\nPen,3\n", 400);
    const t = r.wb.sheets[0].tables[1];
    expect(t).toMatchObject({ name: "Sales", hr: 1, rows: 2, cols: 2, y: 400 });
    expect(t.cells[key(1, 1)].v).toBe("3");
  });

  it("Excel 公式的工作表參照", () => {
    expect(fromExcelFormula("SUM(Sheet1!A1:B2)+'My (sheet)'!C3*_xlfn.CONCAT(1)")).toBe("SUM(Sheet1::A1:B2)+'My (sheet)'::C3*CONCAT(1)");
  });

  it("匯出再匯入 .xlsx：文字、數字、公式、格式", async () => {
    let { wb, tid } = book({ A1: "Item", B1: "Price", A2: "Pen", B2: "$1.5", C2: "=B2*2", A3: "When", B3: "2026-11-18", C3: "15%", A4: "Done", B4: "TRUE" });
    wb = styleRange(wb, tid, { r0: 1, c0: 0, r1: 1, c1: 0 }, { b: true });
    const bytes = toXlsx(wb, new Calc(wb));
    const sheets = await readXlsx(bytes);
    expect(sheets).toHaveLength(1);
    const g = sheets[0].grid;
    expect(g[0].map((c) => c.v)).toEqual(["Item", "Price"]);
    expect(g[1][0]).toEqual({ v: "Pen", s: { b: true } });
    expect(g[1][1]).toMatchObject({ v: "1.5", s: { fmt: "currency" } });
    expect(g[1][2].v).toBe("=B2*2");
    expect(g[2][1].v).toBe("2026-11-18");
    expect(g[2][2].v).toBe("15%");
    expect(g[3][1].v).toBe("TRUE");
    // 空白的試算表直接換掉
    const r = addImported(newWorkbook(), sheets);
    expect(r.wb.sheets.map((s) => [s.name, s.tables[0].name])).toEqual([["Sheet 1", "Sheet 1"]]);
    const t = r.wb.sheets[0].tables[0];
    expect(t.hr).toBe(1);
    expect(toText(new Calc(r.wb).value(t.id, 1, 2))).toBe("3");
  });

  it("壓縮過的 zip、共用公式", async () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
      <row r="1"><c r="A1"><v>1</v></c><c r="B1"><f t="shared" ref="B1:B3" si="0">A1*2</f><v>2</v></c></row>
      <row r="2"><c r="A2"><v>2</v></c><c r="B2"><f t="shared" si="0"/><v>4</v></c></row>
      <row r="3"><c r="A3" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>`;
    const files: [string, Uint8Array][] = [
      [
        "xl/workbook.xml",
        enc(
          `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
        ),
      ],
      ["xl/_rels/workbook.xml.rels", enc(`<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`)],
      ["xl/worksheets/sheet1.xml", enc(sheet)],
    ];
    // 先做一個不壓縮的 zip，再把其中一個檔案換成 deflate（測 unzip 的解壓縮）
    const plain = await unzip(zip(files));
    expect([...plain.keys()]).toHaveLength(3);
    const deflated = zipDeflate(files);
    const sheets = await readXlsx(deflated);
    expect(sheets[0].name).toBe("Data");
    expect(sheets[0].grid.map((r) => r.map((c) => c.v))).toEqual([
      ["1", "=A1*2"],
      ["2", "=A2*2"],
      ["x"],
    ]);
  });
});

/** 測試用：deflate 壓縮的 zip */
function zipDeflate(files: [string, Uint8Array][]): Uint8Array {
  const parts: Uint8Array[] = [];
  const dir: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nb = new TextEncoder().encode(name);
    const comp = new Uint8Array(deflateRawSync(data));
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(8, 8, true);
    h.setUint32(18, comp.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, nb.length, true);
    parts.push(new Uint8Array(h.buffer), nb, comp);
    const d = new DataView(new ArrayBuffer(46));
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(10, 8, true);
    d.setUint32(20, comp.length, true);
    d.setUint32(24, data.length, true);
    d.setUint16(28, nb.length, true);
    d.setUint32(42, offset, true);
    dir.push(new Uint8Array(d.buffer), nb);
    offset += 30 + nb.length + comp.length;
  }
  const size = dir.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, offset, true);
  const all = [...parts, ...dir, new Uint8Array(e.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
