// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { addEdge, addFrame, addShape, emptyDiagram, starterDiagram } from "./draw";
import { toDrawio, toHtml, toSvg } from "./drawExport";

describe("Draw 匯出", () => {
  it("SVG：每個圖形一個外框、文字、箭頭，用淺色主題的顏色", () => {
    const { svg, w, h } = toSvg(starterDiagram());
    expect(svg.startsWith("<svg")).toBe(true);
    expect(w).toBeGreaterThan(100);
    expect(h).toBeGreaterThan(100);
    expect(svg).toContain(">Start</tspan>");
    expect(svg).toContain(">Yes</tspan>");
    expect(svg).not.toContain("var(--");
    expect(new DOMParser().parseFromString(svg, "image/svg+xml").querySelector("parsererror")).toBeNull();
  });
  it("SVG 跳脫特殊字元", () => {
    const d = addShape(emptyDiagram(), "rect", 0, 0, { text: "a < b & c" }).diagram;
    expect(toSvg(d).svg).toContain("a &lt; b &amp; c");
  });
  it("draw.io：圖形與連線（固定的邊、自由端點）", () => {
    let d = emptyDiagram();
    const a = addShape(d, "diamond", 0, 0, { text: "Line 1\nLine <2>" });
    d = a.diagram;
    d = addEdge(d, { shape: a.id, side: "right" }, { x: 300, y: 40 }).diagram;
    const xml = toDrawio(d, "My diagram");
    expect(xml).toContain('<diagram name="My diagram"');
    expect(xml).toContain("rhombus;");
    expect(xml).toContain('value="Line 1&lt;br&gt;Line &amp;lt;2&amp;gt;"');
    expect(xml).toContain("exitX=1;exitY=0.5;");
    expect(xml).toContain('source="b-' + a.id + '"');
    expect(xml).toContain('<mxPoint x="300" y="40" as="targetPoint"/>');
    expect(new DOMParser().parseFromString(xml, "application/xml").querySelector("parsererror")).toBeNull();
  });
});

describe("網頁匯出", () => {
  it("每個畫板一段 section，圖形是絕對定位的 div，座標相對畫板", () => {
    let d = emptyDiagram();
    const f = addFrame(d, { label: "Desktop", w: 1440, h: 1024 });
    d = f.diagram;
    const fr = d.shapes[0];
    d = addShape(d, "rect", fr.x + 40, fr.y + 30, {
      w: 200,
      h: 48,
      text: "Sign up",
      parent: f.id,
      style: { ...d.shapes[0].style, fill: "#2383e2", color: "#ffffff", radius: 8, stroke: "none", weight: 600, align: "center", valign: "middle" },
    }).diagram;
    const html = toHtml(d, "Landing");
    expect(html).toContain("<title>Landing</title>");
    expect(html).toContain('aria-label="Desktop"');
    expect(html).toContain("width:1440px;height:1024px;background:#ffffff");
    expect(html).toContain("left:40px;top:30px;width:200px;height:48px");
    expect(html).toContain("background:#2383e2");
    expect(html).toContain("border-radius:8px");
    expect(html).toContain("font-weight:600");
    expect(html).toContain(">Sign up</div>");
    expect(new DOMParser().parseFromString(html, "text/html").querySelectorAll("section.frame")).toHaveLength(1);
  });
  it("沒有畫板時整張圖是一頁；只匯出一個畫板的 SVG 剛好是畫板大小", () => {
    expect(toHtml(starterDiagram(), "Flow")).toContain(">Start</div>");
    const f = addFrame(emptyDiagram(), { label: "Phone", w: 390, h: 844 });
    const svg = toSvg(f.diagram, {}, f.id);
    expect(svg.w).toBe(390);
    expect(svg.h).toBe(844);
  });
});

describe("網頁匯出的屬性", () => {
  it("inline style 裡的字型名稱用單引號（不會截斷 style 屬性）", () => {
    let d = addFrame(emptyDiagram(), { label: "Phone", w: 390, h: 844 }).diagram;
    const f = d.shapes[0];
    d = addShape(d, "text", f.x + 10, f.y + 10, { text: "Hi", parent: f.id, style: { ...d.shapes[0].style, font: "Georgia", fill: "none", stroke: "none" } }).diagram;
    const html = toHtml(d, "x");
    const el = new DOMParser().parseFromString(html, "text/html").querySelector("section .t") as HTMLElement;
    expect(el.textContent).toBe("Hi");
    expect(el.getAttribute("style")).toContain("font-family:'Georgia'");
    expect(el.getAttribute("style")).toContain("color:");
  });
});
