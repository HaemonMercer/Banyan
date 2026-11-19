// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  decodeTableText,
  fromOdsFormula,
  importTables,
  lengthPx,
  parseHtmlTables,
  parseJsonTable,
  parseMarkdownTables,
  readOds,
  readSpreadsheet,
  readXls,
  rkValue,
  xlsError,
} from "./formats";
import { addImported, iso } from "./importer";
import { Calc } from "./calc";
import { newWorkbook } from "./model";
import { zip } from "./xlsx";

const enc = (s: string) => new TextEncoder().encode(s);
const vals = (grid: { v: string }[][]) => grid.map((r) => r.map((c) => c.v));

describe("匯入：文字的編碼", () => {
  it("BOM、UTF-8、UTF-16，不是 UTF-8 就當 Big5", () => {
    expect(decodeTableText(new Uint8Array([0xef, 0xbb, 0xbf, ...enc("名稱,a")]))).toBe("名稱,a");
    expect(decodeTableText(enc("名稱,a"))).toBe("名稱,a");
    expect(decodeTableText(new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x09, 0x00, 0x42, 0x00]))).toBe("A\tB");
    // 「中文」的 Big5：A4 A4 A4 E5
    expect(decodeTableText(new Uint8Array([0xa4, 0xa4, 0xa4, 0xe5, 0x2c, 0x31]))).toBe("中文,1");
  });
});

describe("匯入：JSON", () => {
  it("物件的陣列：欄位照第一次出現的順序", () => {
    expect(parseJsonTable('[{"name":"Tent","cost":120},{"name":"Stove","cost":45,"ok":true,"tags":["a"]},{"x":null}]')).toEqual([
      ["name", "cost", "ok", "tags", "x"],
      ["Tent", "120", "", "", ""],
      ["Stove", "45", "TRUE", '["a"]', ""],
      ["", "", "", "", ""],
    ]);
  });

  it("陣列的陣列、藏在欄位裡的資料、以鍵分的物件", () => {
    expect(parseJsonTable("[[1,2],[3,4]]")).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
    // 政府開放資料常見：{"result":{"records":[…]}}
    expect(parseJsonTable('{"success":true,"result":{"total":1,"records":[{"站名":"淡水","溫度":21}]}}')).toEqual([
      ["站名", "溫度"],
      ["淡水", "21"],
    ]);
    expect(parseJsonTable('{"a":{"x":1},"b":{"y":2}}')).toEqual([
      ["", "x", "y"],
      ["a", "1", ""],
      ["b", "", "2"],
    ]);
    expect(() => parseJsonTable("{bad")).toThrow(/valid JSON/);
    expect(() => parseJsonTable('{"a":1}')).toThrow(/no list/);
  });
});

describe("匯入：HTML 與 Markdown 的表格", () => {
  it("每個 table 一個；colspan、rowspan 只在第一格放字；巢狀的表格不另外算", () => {
    const ts = parseHtmlTables(
      `<table><caption>Budget</caption><tr><th>Item</th><th colspan="2">Cost</th></tr>` +
        `<tr><td rowspan="2">Tent</td><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table>` +
        `<p>x</p><table><tr><td>A <b>b</b><table><tr><td>in</td></tr></table></td></tr></table>`,
    );
    expect(ts).toHaveLength(2);
    expect(ts[0]).toEqual({
      name: "Budget",
      rows: [
        ["Item", "Cost", ""],
        ["Tent", "1", "2"],
        ["", "3", "4"],
      ],
    });
    // jsdom 沒有 innerText，巢狀表格的字直接接在後面（瀏覽器裡中間有空白）
    expect(ts[1].rows[0][0]).toMatch(/^A b ?in$/);
  });

  it("Markdown：標題列、分隔列、內容；跳脫的直線", () => {
    const md = "# Notes\n\n| Site | Count |\n|:---|---:|\n| River | 12 |\n| A \\| B | 3 |\n\ntext\n\nx | y\n--|--\n1 | 2\n";
    expect(parseMarkdownTables(md)).toEqual([
      [
        ["Site", "Count"],
        ["River", "12"],
        ["A | B", "3"],
      ],
      [
        ["x", "y"],
        ["1", "2"],
      ],
    ]);
    expect(parseMarkdownTables("no | table here")).toEqual([]);
  });
});

describe("匯入：OpenDocument（.ods）", () => {
  it("公式從 OpenFormula 換過來", () => {
    expect(fromOdsFormula("of:=SUM([.B2:.B3])")).toBe("=SUM(B2:B3)");
    expect(fromOdsFormula("of:=IF([.A1]>1;\"a;b\";[$Sheet2.C3])")).toBe('=IF(A1>1,"a;b",Sheet2::C3)');
    // 名稱有空白不用加引號（`Sheet 2::A1` 本來就合法）
    expect(fromOdsFormula("of:=[$'My data'.A1:.B2]")).toBe("=My data::A1:B2");
  });

  it("值的種類、重複的列與欄、好幾張工作表", async () => {
    const NS =
      'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';
    const cell = (attrs: string, text = "") => `<table:table-cell ${attrs}>${text ? `<text:p>${text}</text:p>` : ""}</table:table-cell>`;
    const xml =
      `<office:document-content ${NS}><office:body><office:spreadsheet>` +
      `<table:table table:name="Budget">` +
      `<table:table-row>${cell('office:value-type="string"', "Item")}${cell('office:value-type="string"', "Cost")}</table:table-row>` +
      `<table:table-row>${cell('office:value-type="string"', "Tent")}${cell('office:value-type="float" office:value="120"', "120")}</table:table-row>` +
      `<table:table-row table:number-rows-repeated="2"><table:table-cell table:number-columns-repeated="2"/></table:table-row>` +
      `<table:table-row>${cell('office:value-type="date" office:date-value="2026-11-19"', "19/11")}${cell('office:value-type="percentage" office:value="0.25"', "25%")}${cell('table:formula="of:=SUM([.B2:.B2])" office:value-type="float" office:value="120"', "120")}</table:table-row>` +
      `<table:table-row table:number-rows-repeated="1048570"><table:table-cell table:number-columns-repeated="1024"/></table:table-row>` +
      `</table:table>` +
      `<table:table table:name="Other"><table:table-row>${cell('office:value-type="boolean" office:boolean-value="true"', "TRUE")}${cell('office:value-type="currency" office:currency="TWD" office:value="30"', "NT$30")}${cell('office:value-type="string"', "=not")}</table:table-row></table:table>` +
      `</office:spreadsheet></office:body></office:document-content>`;
    const sheets = await readOds(zip([["mimetype", enc("application/vnd.oasis.opendocument.spreadsheet")], ["content.xml", enc(xml)]]));
    expect(sheets.map((s) => s.name)).toEqual(["Budget", "Other"]);
    expect(vals(sheets[0].grid)).toEqual([["Item", "Cost"], ["Tent", "120"], [], [], ["2026-11-19", "25%", "=SUM(B2:B2)"]]);
    expect(sheets[1].grid[0]).toEqual([{ v: "TRUE" }, { v: "30", s: { fmt: "currency", cur: "NT$" } }, { v: "'=not" }]);
  });

  it("結果是文字的公式不加 '；欄寬照欄的樣式", async () => {
    const NS =
      'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"';
    const xml =
      `<office:document-content ${NS}><office:automatic-styles><style:style style:name="co1" style:family="table-column"><style:table-column-properties style:column-width="1.5in"/></style:style></office:automatic-styles>` +
      `<office:body><office:spreadsheet><table:table table:name="S"><table:table-column table:style-name="co1" table:number-columns-repeated="2"/><table:table-column/>` +
      `<table:table-row><table:table-cell table:formula="of:=[.B1]&amp;&quot;!&quot;" office:value-type="string"><text:p>ok!</text:p></table:table-cell></table:table-row>` +
      `</table:table></office:spreadsheet></office:body></office:document-content>`;
    const [s] = await readOds(zip([["content.xml", enc(xml)]]));
    expect(s.grid[0][0].v).toBe('=B1&"!"');
    expect(s.colW).toEqual([144, 144]);
    expect(lengthPx("2.54cm")).toBeCloseTo(96);
    expect(lengthPx("bad")).toBe(0);
  });
});

/* ─── 舊版 Excel（.xls）：在測試裡組一個最小的 OLE 複合文件＋BIFF8 ─── */

const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const f64 = (n: number) => [...new Uint8Array(new Float64Array([n]).buffer)];
const rec = (type: number, data: number[]) => [...u16(type), ...u16(data.length), ...data];
const str8 = (s: string) => [...s].map((c) => c.charCodeAt(0));
const str16 = (s: string) => [...new Uint8Array(new Uint16Array([...s].map((c) => c.charCodeAt(0))).buffer)];
const xlStr = (s: string, wide = false) => [...u16(s.length), wide ? 1 : 0, ...(wide ? str16(s) : str8(s))];

function biff(): Uint8Array {
  const bof = (dt: number) => rec(0x0809, [...u16(0x0600), ...u16(dt), ...new Array(12).fill(0)]);
  const xf = (ifmt: number) => rec(0x00e0, [...u16(0), ...u16(ifmt), ...new Array(16).fill(0)]);
  const globals = (pos: number) => [
    ...bof(0x0005),
    ...rec(0x041e, [...u16(164), ...xlStr("yyyy/mm/dd")]),
    ...xf(0), // 0 一般
    ...xf(14), // 1 內建日期
    ...xf(9), // 2 百分比
    ...xf(164), // 3 自訂日期
    ...rec(0x0085, [...u32(pos), 0, 0, 6, 0, ...str8("Budget")]),
    // SST：第三個字串跨到 CONTINUE（新的一段開頭是編碼旗標）
    ...rec(0x00fc, [...u32(3), ...u32(3), ...xlStr("Item"), ...xlStr("價格", true), ...u16(11), 0, ...str8("Hello")]),
    ...rec(0x003c, [0, ...str8(" World")]),
    ...rec(0x000a, []),
  ];
  const at = globals(0).length;
  const cellHead = (r: number, c: number, ixfe = 0) => [...u16(r), ...u16(c), ...u16(ixfe)];
  const sheet = [
    ...bof(0x0010),
    ...rec(0x007d, [...u16(0), ...u16(0), ...u16(20 * 256), ...u16(0), ...u16(0), ...u16(0)]),
    ...rec(0x00fd, [...cellHead(0, 0), ...u32(0)]),
    ...rec(0x00fd, [...cellHead(0, 1), ...u32(1)]),
    ...rec(0x0203, [...cellHead(1, 1), ...f64(12.5)]),
    ...rec(0x027e, [...cellHead(2, 1), ...u32((42 << 2) | 2)]),
    // MULRK：日期（內建格式）與百分比
    ...rec(0x00bd, [...u16(3), ...u16(0), ...u16(1), ...u32((45000 << 2) | 2), ...u16(2), ...u32(0x3fd00000), ...u16(1)]),
    // 公式：數字結果，與字串結果（接著 STRING）
    ...rec(0x0006, [...cellHead(4, 1), ...f64(55), ...u16(0), ...u32(0), ...u16(0)]),
    ...rec(0x0006, [...cellHead(4, 0), 0, 0, 0, 0, 0, 0, 0xff, 0xff, ...u16(0), ...u32(0), ...u16(0)]),
    ...rec(0x0207, xlStr("Total")),
    ...rec(0x00fd, [...cellHead(5, 0), ...u32(2)]),
    ...rec(0x0204, [...cellHead(6, 0), ...xlStr("=not formula")]),
    ...rec(0x0205, [...cellHead(6, 1), 1, 0]),
    ...rec(0x0203, [...cellHead(7, 0, 3), ...f64(46345)]),
    ...rec(0x000a, []),
  ];
  return new Uint8Array([...globals(at), ...sheet]);
}

/** 最小的 OLE 複合文件（512 位元組的磁區）：mini 是小於 4096 的串流放在 mini stream 的情形 */
function cfb(stream: Uint8Array, mini: boolean): Uint8Array {
  const S = 512;
  const END = 0xfffffffe;
  const FREE = 0xffffffff;
  const pad = (b: Uint8Array, n: number) => {
    const out = new Uint8Array(Math.ceil(Math.max(1, b.length) / n) * n);
    out.set(b);
    return out;
  };
  const header = new Uint8Array(S);
  header.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const hv = new DataView(header.buffer);
  hv.setUint16(0x18, 0x3e, true);
  hv.setUint16(0x1a, 3, true);
  hv.setUint16(0x1c, 0xfffe, true);
  hv.setUint16(0x1e, 9, true);
  hv.setUint16(0x20, 6, true);
  hv.setUint32(0x2c, 1, true);
  hv.setUint32(0x30, 1, true);
  hv.setUint32(0x38, 4096, true);
  hv.setUint32(0x44, END, true);
  for (let i = 0; i < 109; i++) hv.setUint32(0x4c + i * 4, i ? FREE : 0, true);
  const fat = new DataView(new ArrayBuffer(S));
  for (let i = 0; i < S / 4; i++) fat.setUint32(i * 4, FREE, true);
  fat.setUint32(0, 0xfffffffd, true);
  fat.setUint32(4, END, true);
  const dir = new Uint8Array(S);
  const dv = new DataView(dir.buffer);
  const entry = (i: number, name: string, type: number, start: number, size: number) => {
    const n = str16(name);
    dir.set(n, i * 128);
    dv.setUint16(i * 128 + 0x40, n.length + 2, true);
    dir[i * 128 + 0x42] = type;
    for (const o of [0x44, 0x48, 0x4c]) dv.setUint32(i * 128 + o, FREE, true);
    dv.setUint32(i * 128 + 0x74, start, true);
    dv.setUint32(i * 128 + 0x78, size, true);
  };
  const chain = (first: number, n: number) => {
    for (let k = 0; k < n; k++) fat.setUint32((first + k) * 4, k === n - 1 ? END : first + k + 1, true);
  };
  if (!mini) {
    const data = pad(stream, S);
    const n = data.length / S;
    chain(2, n);
    entry(0, "Root Entry", 5, END, 0);
    entry(1, "Workbook", 2, 2, stream.length);
    hv.setUint32(0x3c, END, true);
    return new Uint8Array([...header, ...new Uint8Array(fat.buffer), ...dir, ...data]);
  }
  const ms = pad(stream, 64);
  const nMini = ms.length / 64;
  const minifat = new DataView(new ArrayBuffer(S));
  for (let i = 0; i < S / 4; i++) minifat.setUint32(i * 4, i < nMini ? (i === nMini - 1 ? END : i + 1) : FREE, true);
  const data = pad(ms, S);
  chain(2, 1);
  chain(3, data.length / S);
  entry(0, "Root Entry", 5, 3, ms.length);
  entry(1, "Workbook", 2, 0, stream.length);
  hv.setUint32(0x3c, 2, true);
  hv.setUint32(0x40, 1, true);
  return new Uint8Array([...header, ...new Uint8Array(fat.buffer), ...dir, ...new Uint8Array(minifat.buffer), ...data]);
}

describe("匯入：舊版 Excel（.xls）", () => {
  const expected = [
    ["Item", "價格"],
    ["", "12.5"],
    ["", "42"],
    [iso(45000), "25%"],
    ["Total", "55"],
    ["Hello World"],
    ["'=not formula", "TRUE"],
    ["2026-11-19"],
  ];

  it("錯誤代碼", () => {
    expect(xlsError(0x2a)).toBe("#N/A");
    expect(xlsError(0x07)).toBe("#DIV/0!");
    expect(xlsError(0x99)).toBe("#ERROR!");
  });

  it("RK 數值", () => {
    expect(rkValue((42 << 2) | 2)).toBe(42);
    expect(rkValue((1234 << 2) | 3)).toBe(12.34);
    expect(rkValue(0x3fd00000)).toBe(0.25);
  });

  it("讀出工作表、字串表（跨 CONTINUE）、數字、日期、百分比、公式結果、欄寬", () => {
    const stream = biff();
    const padded = new Uint8Array(Math.max(4096, stream.length));
    padded.set(stream);
    const sheets = readXls(cfb(padded, false));
    expect(sheets.map((s) => s.name)).toEqual(["Budget"]);
    expect(vals(sheets[0].grid)).toEqual(expected);
    expect(Math.round(sheets[0].colW[0])).toBe(145);
  });

  it("小檔案在 mini stream 裡也讀得到", () => {
    expect(vals(readXls(cfb(biff(), true))[0].grid)).toEqual(expected);
  });

  it("不是 .xls、或其實是網頁／CSV 的 .xls", async () => {
    expect(() => readXls(enc("hello".padEnd(600)))).toThrow(/Excel 97/);
    const html = await readSpreadsheet("export.xls", enc("<html><body><table><tr><td>a</td><td>1</td></tr></table></body></html>"));
    expect(html.kind === "tables" && vals(html.tables[0].grid)).toEqual([["a", "1"]]);
    const csv = await readSpreadsheet("export.xls", enc("a,b\n1,2"));
    expect(csv.kind === "tables" && vals(csv.tables[0].grid)).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("匯入：撞名的工作表", () => {
  it("改名時公式跟著改，不會指到原本就有的同名工作表", () => {
    let wb = addImported(newWorkbook(), [
      { name: "Notes", grid: [[{ v: "old" }]], colW: [] },
      { name: "Main", grid: [[{ v: "x" }]], colW: [] },
    ]).wb;
    wb = addImported(wb, [
      { name: "Notes", grid: [[{ v: "new" }]], colW: [] },
      { name: "Main", grid: [[{ v: "=Notes::A1" }]], colW: [] },
    ]).wb;
    expect(wb.sheets.map((s) => s.name)).toEqual(["Notes", "Main", "Notes 2", "Main 2"]);
    const main2 = wb.sheets[3].tables[0];
    expect(main2.cells["0,0"].v).toBe("=Notes 2::A1");
    expect(new Calc(wb).value(main2.id, 0, 0)).toEqual({ t: "s", s: "new" });
  });
});

describe("匯入：放進活頁簿", () => {
  it("依副檔名讀；表格一個接一個放在目前工作表下面", async () => {
    const r = await readSpreadsheet("trip.md", enc("| a | b |\n|---|---|\n| 1 | 2 |\n\n| c |\n|---|\n| 3 |\n"));
    expect(r.kind).toBe("tables");
    if (r.kind !== "tables") return;
    expect(r.tables.map((t) => t.name)).toEqual(["trip 1", "trip 2"]);
    const wb = newWorkbook();
    const out = importTables(wb, wb.sheets[0].id, r.tables, 500);
    const added = out.wb.sheets[0].tables.slice(1);
    expect(added.map((t) => t.name)).toEqual(["trip 1", "trip 2"]);
    expect(added[0].y).toBe(500);
    expect(added[1].y).toBeGreaterThan(500 + 40);
    expect(out.id).toBe(added[0].id);
    const json = await readSpreadsheet("data.json", enc('[{"x":1}]'));
    expect(json.kind === "tables" && json.tables[0].name).toBe("data");
    const csv = await readSpreadsheet("big5.csv", new Uint8Array([0xa4, 0xa4, 0xa4, 0xe5, 0x2c, 0x31]));
    expect(csv.kind === "tables" && vals(csv.tables[0].grid)).toEqual([["中文", "1"]]);
  });
});
