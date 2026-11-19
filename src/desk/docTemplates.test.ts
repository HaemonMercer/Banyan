import { describe, expect, it } from "vitest";
import { Calc } from "../sheet/calc";
import { parseWorkbook } from "../sheet/model";
import { DOC_TEMPLATES, templatesFor } from "./docTemplates";
import { splitSlides } from "./file";

describe("Dock 文件範本", () => {
  it("Word、簡報、Excel 都有範本，第一個是空白；Note、Draw 沒有", () => {
    for (const k of ["word", "slides", "sheet"] as const) {
      expect(templatesFor(k)[0].label).toBe("Blank");
      expect(templatesFor(k).length).toBeGreaterThan(2);
    }
    expect(templatesFor("note")).toEqual([]);
    expect(templatesFor("draw")).toEqual([]);
    expect(new Set(DOC_TEMPLATES.map((t) => t.id)).size).toBe(DOC_TEMPLATES.length);
  });

  it("Word 範本換掉標題變數", () => {
    const report = DOC_TEMPLATES.find((t) => t.id === "word-report")!;
    const md = report.make("Q4 review");
    expect(md.startsWith("# Q4 review\n")).toBe(true);
    expect(md).not.toMatch(/\{\{/);
  });

  it("簡報範本分成好幾張", () => {
    const pitch = DOC_TEMPLATES.find((t) => t.id === "slides-pitch")!;
    expect(splitSlides(pitch.make("Acme")).length).toBe(7);
  });

  it("預算表的公式算得出來", () => {
    const wb = parseWorkbook(DOC_TEMPLATES.find((t) => t.id === "sheet-budget")!.make("Home"));
    const t = wb.sheets[0].tables[0];
    expect(t.name).toBe("Home");
    const calc = new Calc(wb);
    // 第一列 Rent：1200 - 0
    expect(calc.value(t.id, 1, 3)).toMatchObject({ t: "n", n: 1200 });
    // 表尾的總計
    expect(calc.value(t.id, t.rows - 1, 1)).toMatchObject({ t: "n", n: 2570 });
  });

  it("每個 Excel 範本都是讀得回來的活頁簿", () => {
    for (const t of templatesFor("sheet")) expect(parseWorkbook(t.make("X")).sheets[0].tables.length).toBe(1);
  });
});
