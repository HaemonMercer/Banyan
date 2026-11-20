// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { objectEmbed, objectRef, renameDocInLinks } from "../desk/docLinks";
import { embedPages } from "../editor/embed";
import { md } from "../editor/markdown";
import { setSheetSources } from "../pages/embeds";
import { setSheetWriter, writeEmbedCell } from "./embedEdit";
import { gridTable, key, parseWorkbook, serializeWorkbook, type Chart, type Workbook } from "./model";
import { formatLook, parseLook, renderSheetObject, sheetObjects } from "./sheetEmbed";

function book(): Workbook {
  const t = gridTable("Sales", ["Month", "Amount"], [["Jan", "10"], ["Feb", "20"], ["Total", "=SUM(B2:B3)"]]);
  t.id = "t1";
  t.hc = 1;
  t.cells[key(2, 1)].s = { b: true };
  const ch: Chart = { id: "c1", type: "column", title: "", x: 0, y: 0, w: 400, h: 260, table: "t1", r0: 0, c0: 0, r1: 2, c1: 1, legend: true, byRow: false };
  return { sheets: [{ id: "s1", name: "Sheet 1", tables: [t], charts: [ch] }] };
}

describe("Excel 物件的參照", () => {
  it("objectRef 拆出文件名稱、id 與選項", () => {
    expect(objectRef("Budget/Q1#^abc123")).toEqual({ doc: "Budget/Q1", id: "abc123", opts: "" });
    expect(objectRef("Budget/Q1#^abc123|green banded")).toEqual({ doc: "Budget/Q1", id: "abc123", opts: "green banded" });
    expect(objectRef("Budget/Q1")).toBeNull();
    expect(objectRef("@key#r1")).toBeNull();
  });
  it("objectEmbed 跳脫 Markdown 字元、加上選項", () => {
    expect(objectEmbed("My_File", "Q*1", "t1")).toBe(String.raw`![[My\_File/Q\*1#^t1]]`);
    expect(objectEmbed("Budget", "Q1", "t1", "red full")).toBe("![[Budget/Q1#^t1|red full]]");
    expect(objectRef(md.renderInline(String.raw`My\_File/Q\*1#^t1`))).toEqual({ doc: "My_File/Q*1", id: "t1", opts: "" });
  });
  it("文件改名時連結跟著改，id 與選項留著", () => {
    expect(renameDocInLinks("![[Budget/Q1#^t1|green]]", "Budget", [{ from: "Q1", to: "Q2" }])).toBe("![[Budget/Q2#^t1|green]]");
  });
});

describe("這個位置的樣子", () => {
  it("parseLook／formatLook", () => {
    expect(parseLook("Green banded large full junk")).toEqual({ theme: "green", banded: true, size: "large", full: true });
    expect(parseLook("plain unbanded small")).toEqual({ theme: "plain", banded: false, size: "small" });
    expect(formatLook({ full: true, theme: "red", banded: false })).toBe("red unbanded full");
    expect(formatLook({})).toBe("");
  });
  it("樣子只改這個位置的畫法", () => {
    const json = serializeWorkbook(book());
    const plain = renderSheetObject(json, "t1")!.el.querySelector("table")!;
    expect(plain.className).toBe("xl-table theme-blue");
    const t = renderSheetObject(json, "t1", parseLook("red banded small full"))!.el.querySelector("table")!;
    expect(t.className).toBe("xl-table theme-red size-small full");
    expect(t.querySelectorAll("tr")[2].className).toBe("band");
    expect(t.querySelector("col")!.style.width).toMatch(/%$/);
  });
});

describe("sheetEmbed", () => {
  it("列出表格與圖表", () => {
    expect(sheetObjects(book())).toEqual([
      { id: "t1", kind: "table", name: "Sales", sheet: "Sheet 1" },
      { id: "c1", kind: "chart", name: "Column chart", sheet: "Sheet 1" },
    ]);
  });
  it("表格照公式算值、標題列用 th、格子帶座標", () => {
    const r = renderSheetObject(serializeWorkbook(book()), "t1")!;
    expect(r.kind).toBe("table");
    const rows = [...r.el.querySelectorAll("tr")].map((tr) => [...tr.children].map((c) => c.textContent));
    expect(rows).toEqual([["Month", "Amount"], ["Jan", "10"], ["Feb", "20"], ["Total", "30"]]);
    expect(r.el.querySelector("tr")!.className).toBe("h");
    expect((r.el.querySelectorAll("td")[1] as HTMLElement).style.fontWeight).toBe("600");
    const last = r.el.querySelectorAll<HTMLElement>("[data-r]");
    expect([last[last.length - 1].dataset.r, last[last.length - 1].dataset.c]).toEqual(["3", "1"]);
  });
  it("藏起來的欄不顯示", () => {
    const wb = book();
    wb.sheets[0].tables[0].hideC = [0];
    const r = renderSheetObject(serializeWorkbook(wb), "t1")!;
    expect([...r.el.querySelectorAll("tr")].map((tr) => tr.textContent)).toEqual(["Amount", "10", "20", "30"]);
  });
  it("圖表是可以縮放的 SVG", () => {
    const r = renderSheetObject(serializeWorkbook(book()), "c1")!;
    const svg = r.el.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toMatch(/^0 0 400 /);
    expect(svg.getAttribute("width")).toBe("100%");
    expect(r.el.querySelectorAll("rect").length).toBe(2);
  });
  it("找不到是 null", () => {
    expect(renderSheetObject(serializeWorkbook(book()), "zzz")).toBeNull();
  });
  it("嵌入 ![[檔案/標題#^id|選項]] 顯示表格與 Style", () => {
    setSheetSources([["Budget/Q1", serializeWorkbook(book())]]);
    const t = document.createElement("template");
    t.innerHTML = embedPages(md.render("![[Budget/Q1#^t1|green]]"));
    const box = t.content.querySelector<HTMLElement>(".sheet-embed")!;
    expect(box.querySelector(".pe-sub")?.textContent).toBe("Sales");
    expect(box.querySelector(".page-ref")?.getAttribute("data-page")).toBe("Budget/Q1");
    expect([box.dataset.doc, box.dataset.object]).toEqual(["Budget/Q1", "t1"]);
    expect(box.classList.contains("sheet-table")).toBe(true);
    expect(box.querySelector(".xe-style")).not.toBeNull();
    expect(box.querySelector("table")!.className).toBe("xl-table theme-green");
    const chart = document.createElement("template");
    chart.innerHTML = embedPages(md.render("![[Budget/Q1#^c1]]"));
    expect(chart.content.querySelector(".xe-style")).toBeNull();
    const gone = document.createElement("template");
    gone.innerHTML = embedPages(md.render("![[Budget/Q1#^nope]]"));
    expect(gone.content.querySelector(".pe-note")?.textContent).toBe("This table or chart was deleted");
  });
});

describe("在文件裡改格子", () => {
  it("writeEmbedCell 改的是 Excel 的活頁簿", () => {
    let json = serializeWorkbook(book());
    setSheetWriter((doc, change) => {
      if (doc !== "Budget/Q1") return false;
      json = serializeWorkbook(change(parseWorkbook(json)));
      return true;
    });
    expect(writeEmbedCell("Budget/Q1", "t1", 1, 1, "15")).toBe(true);
    expect(writeEmbedCell("Nope/X", "t1", 1, 1, "1")).toBe(false);
    const r = renderSheetObject(json, "t1")!;
    expect([...r.el.querySelectorAll("tr")].map((tr) => tr.textContent)).toEqual(["MonthAmount", "Jan15", "Feb20", "Total35"]);
    setSheetWriter(null);
  });
});
