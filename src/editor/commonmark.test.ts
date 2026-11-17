import { describe, expect, it } from "vitest";
// @ts-expect-error commonmark-spec 沒有型別定義
import spec from "commonmark-spec";
import { parseDoc, renderMarkdown } from "./markdown";

interface SpecTest {
  markdown: string;
  html: string;
  section: string;
  number: number;
}

// 規格檔以「→」代表 tab。
const tests: SpecTest[] = (spec.tests as SpecTest[]).map((t) => ({
  ...t,
  markdown: t.markdown.replace(/→/g, "\t"),
  html: t.html.replace(/→/g, "\t"),
}));

describe("CommonMark 0.31.2 規格", () => {
  it("有 652 個範例", () => {
    expect(tests.length).toBe(652);
  });

  // 編輯器把文件切成區塊再組回來；組回的 HTML 必須與規格逐字相同（不做任何正規化）。
  it.each(tests.map((t) => [t.number, t.section, t] as const))("範例 %i（%s）", (_n, _s, t) => {
    expect(renderMarkdown(t.markdown)).toBe(t.html);
    expect(parseDoc(t.markdown).html).toBe(t.html);
  });

  // 每一個非空白行都必須屬於某個區塊，否則畫面上會看不到、改不到。
  it.each(tests.map((t) => [t.number, t] as const))("範例 %i 的每行都有區塊", (_n, t) => {
    const doc = parseDoc(t.markdown);
    const owned = new Set<number>();
    for (const u of doc.units) {
      expect(u.end).toBeGreaterThan(u.start);
      for (let l = u.start; l < u.end; l++) owned.add(l);
    }
    doc.lines.forEach((line, l) => {
      if (!/^[ \t]*$/.test(line)) expect(owned.has(l), `第 ${l} 行：${JSON.stringify(line)}`).toBe(true);
    });
  });
});
