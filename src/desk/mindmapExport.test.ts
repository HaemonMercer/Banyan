import { describe, expect, it } from "vitest";
import { newMap, setMapStyle, toggleCollapse } from "./mindmap";
import { mapSvg, solidColor } from "./mindmapExport";

describe("mapSvg", () => {
  it("每個主題的文字、白底、沒有 CSS 變數", () => {
    const m = newMap(0, 0);
    const { svg, w, h } = mapSvg(m);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
    expect(svg).toContain("Central Topic");
    expect(svg).toContain("Main Topic 4");
    expect(svg).not.toContain("var(");
  });

  it("配色主題的變數換成淺色值", () => {
    const [m] = setMapStyle([newMap(0, 0)], "", {});
    const ink = setMapStyle([m], m.id, { theme: "ink" })[0];
    expect(mapSvg(ink).svg).not.toContain("var(");
    expect(solidColor("var(--mm-root-bg)")).toBe("#2f3437");
  });

  it("收起的主題顯示藏了幾個", () => {
    const m = newMap(0, 0, 1);
    const main = m.root.children[0];
    main.children = [{ id: "a", text: "A", children: [], collapsed: false }, { id: "b", text: "B", children: [], collapsed: false }];
    const [shut] = toggleCollapse([m], m.id, main.id, true);
    const { svg } = mapSvg(shut);
    expect(svg).not.toContain(">A<");
    expect(svg).toMatch(/>2<\/text>/);
  });
});
