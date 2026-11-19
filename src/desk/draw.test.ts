import { describe, expect, it } from "vitest";
import {
  addEdge,
  addFrame,
  addShape,
  alignItems,
  boundaryPoint,
  cardsToShapes,
  cloneTo,
  copyItems,
  distribute,
  edgeGeometry,
  emptyDiagram,
  facingSide,
  flipEdges,
  groupItems,
  itemsIn,
  layerName,
  measureBetween,
  measureGaps,
  moveLayer,
  normalizeHex,
  moveItems,
  orthogonal,
  parseDiagram,
  pasteClip,
  patchShapes,
  removeItems,
  renderOrder,
  reorder,
  reparent,
  resizeRect,
  serializeDiagram,
  setKind,
  shapeMap,
  simplify,
  snapGuides,
  snapResize,
  snapSpacing,
  starterDiagram,
  ungroupItems,
  withGroups,
  wrapText,
  type Diagram,
} from "./draw";

const two = () => {
  let d = emptyDiagram();
  const a = addShape(d, "rect", 0, 0);
  d = a.diagram;
  const b = addShape(d, "rect", 300, 0);
  d = b.diagram;
  const e = addEdge(d, { shape: a.id, side: null }, { shape: b.id, side: null });
  return { d: e.diagram, a: a.id, b: b.id, e: e.id };
};

describe("讀寫", () => {
  it("存了再讀回來一樣", () => {
    const d = starterDiagram();
    expect(parseDiagram(serializeDiagram(d))).toEqual(d);
  });
  it("壞掉的 JSON 是空的圖表", () => {
    expect(parseDiagram("{oops")).toEqual(emptyDiagram());
    expect(parseDiagram("")).toEqual(emptyDiagram());
  });
  it("丟掉接到不存在圖形的連線、不認得的值用預設", () => {
    const d = parseDiagram(
      JSON.stringify({
        shapes: [{ id: "a", kind: "blob", x: 1, y: 2, style: { fill: "teal", width: 99 } }],
        edges: [
          { id: "e1", from: { shape: "a" }, to: { shape: "zz" } },
          { id: "e2", from: { shape: "a", side: "top" }, to: { x: 5, y: 6 } },
        ],
      }),
    );
    expect(d.shapes[0].kind).toBe("rect");
    expect(d.shapes[0].style.fill).toBe("default");
    expect(d.shapes[0].style.width).toBe(12);
    expect(d.edges.map((e) => e.id)).toEqual(["e2"]);
    expect(d.edges[0].from).toEqual({ shape: "a", side: "top" });
  });
});

describe("幾何", () => {
  it("面向的邊", () => {
    const r = { x: 0, y: 0, w: 100, h: 50 };
    expect(facingSide(r, { x: 300, y: 30 })).toBe("right");
    expect(facingSide(r, { x: 50, y: -200 })).toBe("top");
    expect(facingSide(r, { x: -100, y: 25 })).toBe("left");
  });
  it("橢圓與菱形的外框點", () => {
    let d = emptyDiagram();
    d = addShape(d, "ellipse", 0, 0, { w: 100, h: 100 }).diagram;
    const p = boundaryPoint(d.shapes[0], { x: 200, y: 50 });
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(50);
    const q = boundaryPoint({ ...d.shapes[0], kind: "diamond" }, { x: 100, y: 100 });
    expect(q.x).toBeCloseTo(75);
    expect(q.y).toBeCloseTo(75);
  });
  it("simplify 去掉共線點", () => {
    expect(
      simplify([
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });
  it("直角連線：面對面的兩邊走 Z 字，每段都是水平或垂直", () => {
    const pts = orthogonal({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 200, y: 100 }, { x: -1, y: 0 });
    expect(pts).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ]);
  });
  it("直角連線：右邊接到上面是 L 形", () => {
    const pts = orthogonal({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 200, y: 100 }, { x: 0, y: -1 });
    expect(pts).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
    ]);
  });
  it("直角連線：背對背也只走水平與垂直", () => {
    const pts = orthogonal({ x: 0, y: 0 }, { x: -1, y: 0 }, { x: 200, y: 100 }, { x: 1, y: 0 });
    for (let i = 1; i < pts.length; i++) expect(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y).toBe(true);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 200, y: 100 });
  });
  it("連線自動選面對面的邊，箭頭在終點", () => {
    const { d, e } = two();
    const g = edgeGeometry(d.edges.find((x) => x.id === e)!, shapeMap(d))!;
    expect(g.start.tip).toEqual({ x: 120, y: 30 });
    expect(g.end.tip).toEqual({ x: 300, y: 30 });
    expect(g.end.dir).toEqual({ x: 1, y: 0 });
    expect(g.mid).toEqual({ x: 210, y: 30 });
  });
  it("直線連線從外框出發", () => {
    let { d, e } = two();
    d = { ...d, edges: d.edges.map((x) => ({ ...x, style: { ...x.style, route: "straight" as const } })) };
    const g = edgeGeometry(d.edges.find((x) => x.id === e)!, shapeMap(d))!;
    expect(g.start.tip.x).toBeCloseTo(120);
    expect(g.end.tip.x).toBeCloseTo(300);
  });
});

describe("編輯", () => {
  it("刪掉圖形，連到它的線也刪", () => {
    const { d, a } = two();
    const out = removeItems(d, [a]);
    expect(out.shapes).toHaveLength(1);
    expect(out.edges).toHaveLength(0);
  });
  it("搬移圖形；選取的連線，自由端點一起搬", () => {
    let d = emptyDiagram();
    const a = addShape(d, "rect", 0, 0);
    d = a.diagram;
    const e = addEdge(d, { shape: a.id, side: "right" }, { x: 500, y: 30 });
    d = moveItems(e.diagram, [a.id, e.id], 10, 20);
    expect(d.shapes[0]).toMatchObject({ x: 10, y: 20 });
    expect(d.edges[0].to).toEqual({ x: 510, y: 50 });
  });
  it("改大小：左上角、維持比例、最小值", () => {
    const r = { x: 0, y: 0, w: 100, h: 50 };
    expect(resizeRect(r, "nw", 20, 10)).toEqual({ x: 20, y: 10, w: 80, h: 40 });
    expect(resizeRect(r, "se", 100, 0, true)).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    expect(resizeRect(r, "e", -500, 0)).toEqual({ x: 0, y: 0, w: 10, h: 50 });
  });
  it("複製貼上：新 id、連線跟著新的圖形；只選一端的連線變成自由端", () => {
    const { d, a, b, e } = two();
    const both = pasteClip(d, copyItems(d, [a, b]), 20, 20);
    expect(both.diagram.shapes).toHaveLength(4);
    expect(both.diagram.edges).toHaveLength(2);
    const copy = both.diagram.edges[1];
    expect(copy.from).toMatchObject({ shape: both.ids[0] });
    expect(copy.to).toMatchObject({ shape: both.ids[1] });

    const one = copyItems(d, [a, e]);
    expect(one.edges).toHaveLength(1);
    expect(one.edges[0].to).toEqual({ x: 300, y: 30 });
  });
  it("移到最上層／最下層", () => {
    const { d, a } = two();
    expect(reorder(d, [a], true).shapes.map((s) => s.id)[1]).toBe(a);
    expect(reorder(reorder(d, [a], true), [a], false).shapes[0].id).toBe(a);
  });
  it("對齊與平均分布", () => {
    let d: Diagram = emptyDiagram();
    for (const [x, y] of [
      [0, 0],
      [100, 40],
      [400, 10],
    ])
      d = addShape(d, "rect", x, y, { w: 50, h: 20 }).diagram;
    const ids = d.shapes.map((s) => s.id);
    expect(alignItems(d, ids, "top").shapes.map((s) => s.y)).toEqual([0, 0, 0]);
    expect(alignItems(d, ids, "right").shapes.map((s) => s.x)).toEqual([400, 400, 400]);
    expect(distribute(d, ids, "x").shapes.map((s) => s.x)).toEqual([0, 200, 400]);
  });
  it("反轉連線，箭頭也跟著換邊", () => {
    const { d, a, e } = two();
    const f = flipEdges(d, [e]).edges[0];
    expect(f.to).toMatchObject({ shape: a });
    expect(f.style.start).toBe("arrow");
    expect(f.style.end).toBe("none");
  });
  it("旁邊複製一個並連起來；位置被佔就往外放", () => {
    const { d, a } = two();
    const r = cloneTo(d, a, "right")!;
    const made = r.diagram.shapes.find((s) => s.id === r.id)!;
    expect(made).toMatchObject({ x: 180, y: 0, w: 120, h: 60, text: "" });
    const link = r.diagram.edges[r.diagram.edges.length - 1];
    expect(link.from).toEqual({ shape: a, side: "right" });
    expect(link.to).toEqual({ shape: r.id, side: "left" });
    // 再複製一次：右邊已經有了，往下放
    const again = cloneTo(r.diagram, a, "right")!;
    const second = again.diagram.shapes.find((s) => s.id === again.id)!;
    expect(second.x).toBe(180);
    expect(second.y).toBeGreaterThan(60);
  });
  it("換種類時預設顏色跟著換、自訂的保留", () => {
    let d = emptyDiagram();
    d = addShape(d, "rect", 0, 0).diagram;
    const id = d.shapes[0].id;
    expect(setKind(d, [id], "note").shapes[0].style.fill).toBe("yellow");
    d = { ...d, shapes: [{ ...d.shapes[0], style: { ...d.shapes[0].style, fill: "blue" } }] };
    expect(setKind(d, [id], "note").shapes[0].style.fill).toBe("blue");
  });
  it("框選只選完全在框裡的", () => {
    const { d, a } = two();
    expect(itemsIn(d, { x: -10, y: -10, w: 200, h: 100 })).toEqual([a]);
    expect(itemsIn(d, { x: -10, y: -10, w: 500, h: 100 })).toHaveLength(3);
  });
  it("對齊線吸附到別的圖形的邊", () => {
    const r = snapGuides({ x: 103, y: 200, w: 50, h: 20 }, [{ x: 100, y: 0, w: 80, h: 40 }], 5);
    expect(r.dx).toBe(-3);
    expect(r.dy).toBe(0);
    expect(r.guides[0]).toMatchObject({ axis: "x", at: 100, from: 0, to: 220 });
  });
});

describe("其他", () => {
  it("斷行：英文照字斷、中文照字斷、保留換行", () => {
    const m = (s: string) => s.length * 10;
    expect(wrapText("hello big world", 90, m)).toEqual(["hello big", "world"]);
    expect(wrapText("一二三四五", 30, m)).toEqual(["一二三", "四五"]);
    expect(wrapText("a\nb", 100, m)).toEqual(["a", "b"]);
  });
  it("卡片變成圖形，排在既有內容下面", () => {
    const d = cardsToShapes(starterDiagram(), [
      { text: "Idea", note: true },
      { text: "Page", note: false },
    ]);
    const added = d.shapes.slice(-2);
    expect(added.map((s) => s.kind)).toEqual(["note", "rounded"]);
    expect(added[0].y).toBeGreaterThan(250);
    expect(added[1].x).toBeGreaterThan(added[0].x);
  });
});

describe("網頁設計", () => {
  const withFrame = () => {
    let d = emptyDiagram();
    const f = addFrame(d, { label: "Phone", w: 390, h: 844 });
    d = f.diagram;
    const a = addShape(d, "rect", 20, 20);
    d = reparent(a.diagram, [a.id]);
    const out = addShape(d, "ellipse", 600, 20);
    d = reparent(out.diagram, [out.id]);
    return { d, frame: f.id, inside: a.id, outside: out.id };
  };

  it("讀寫：色碼、圓角、字重、陰影；舊檔案的 bold／shadow 轉過來", () => {
    const d = parseDiagram(
      JSON.stringify({
        shapes: [
          { id: "a", kind: "rect", style: { fill: "#FF8800", radius: 8, weight: 650, shadow: "lg", opacity: 2, font: "Arial" } },
          { id: "b", kind: "rect", style: { bold: true, shadow: true, fill: "#xyz" } },
        ],
      }),
    );
    expect(d.shapes[0].style).toMatchObject({ fill: "#ff8800", radius: 8, weight: 700, shadow: "lg", opacity: 1, font: "Arial" });
    expect(d.shapes[1].style).toMatchObject({ weight: 600, shadow: "md", fill: "default" });
    expect(parseDiagram(serializeDiagram(d))).toEqual(d);
  });
  it("色碼整理", () => {
    expect(normalizeHex("abc")).toBe("#aabbcc");
    expect(normalizeHex(" #12AB9f ")).toBe("#12ab9f");
    expect(normalizeHex("red")).toBeNull();
  });
  it("新的畫板放在既有內容右邊、名稱不重複", () => {
    const { d } = withFrame();
    const f2 = addFrame(d, { label: "Phone", w: 390, h: 844 });
    const s = f2.diagram.shapes.find((x) => x.id === f2.id)!;
    expect(s.text).toBe("Phone 2");
    expect(s.x).toBeGreaterThan(600);
  });
  it("中心在畫板裡的圖形放進畫板，排在畫板後面；拖出去就拿出來", () => {
    const { d, frame, inside, outside } = withFrame();
    expect(d.shapes.find((s) => s.id === inside)!.parent).toBe(frame);
    expect(d.shapes.find((s) => s.id === outside)!.parent).toBeUndefined();
    const out = reparent(moveItems(d, [inside], 1000, 0), [inside]);
    expect(out.shapes.find((s) => s.id === inside)!.parent).toBeUndefined();
    // 畫板排在後面時，放進畫板的圖形跟著排到畫板後面
    const back = reparent(moveItems(reorder(d, [outside], false), [outside], -500, 0), [outside]);
    const ids = back.shapes.map((s) => s.id);
    expect(ids.indexOf(outside)).toBeGreaterThan(ids.indexOf(frame));
  });
  it("搬、刪、複製畫板時裡面的一起", () => {
    const { d, frame, inside } = withFrame();
    expect(moveItems(d, [frame], 10, 0).shapes.find((s) => s.id === inside)!.x).toBe(30);
    expect(removeItems(d, [frame]).shapes).toHaveLength(1);
    const pasted = pasteClip(d, copyItems(d, [frame]), 500, 0);
    const copyFrame = pasted.diagram.shapes.find((s) => s.id === pasted.ids[0])!;
    const copyKid = pasted.diagram.shapes.find((s) => s.id === pasted.ids[1])!;
    expect(copyFrame.kind).toBe("frame");
    expect(copyKid.parent).toBe(copyFrame.id);
  });
  it("畫的順序：畫板後面接著裡面的，藏起來的不畫", () => {
    const { d, frame, inside, outside } = withFrame();
    expect(renderOrder(d).map((s) => s.id)).toEqual([frame, inside, outside]);
    const hidden = patchShapes(d, [inside], (s) => ({ ...s, hidden: true }));
    expect(renderOrder(hidden).map((s) => s.id)).toEqual([frame, outside]);
    expect(itemsIn(hidden, { x: -1000, y: -1000, w: 5000, h: 5000 })).not.toContain(inside);
  });
  it("群組：一起選取；取消群組", () => {
    const { d, inside, outside } = withFrame();
    const g = groupItems(d, [inside, outside]);
    expect(g.group).toBeTruthy();
    expect(withGroups(g.diagram, [inside]).sort()).toEqual([inside, outside].sort());
    expect(withGroups(ungroupItems(g.diagram, [inside, outside]), [inside])).toEqual([inside]);
    // 複製的群組是新的群組
    const p = pasteClip(g.diagram, copyItems(g.diagram, [inside, outside]), 10, 10);
    const groups = new Set(p.diagram.shapes.filter((s) => s.group).map((s) => s.group));
    expect(groups.size).toBe(2);
  });
  it("圖層拖曳：放到別的圖形上面、放進畫板", () => {
    const { d, frame, inside, outside } = withFrame();
    const into = moveLayer(d, outside, frame, "into");
    expect(into.shapes.find((s) => s.id === outside)!.parent).toBe(frame);
    expect(into.shapes.map((s) => s.id)).toEqual([frame, inside, outside]);
    const below = moveLayer(d, outside, inside, "below");
    expect(below.shapes.map((s) => s.id)).toEqual([frame, outside, inside]);
    expect(below.shapes.find((s) => s.id === outside)!.parent).toBe(frame);
    const out = moveLayer(d, inside, outside, "above");
    expect(out.shapes.find((s) => s.id === inside)!.parent).toBeUndefined();
    expect(out.shapes.map((s) => s.id)).toEqual([frame, outside, inside]);
  });
  it("圖層名稱", () => {
    const { d, inside } = withFrame();
    const s = d.shapes.find((x) => x.id === inside)!;
    expect(layerName(s)).toBe("Rectangle");
    expect(layerName({ ...s, text: "Sign up\nnow" })).toBe("Sign up");
    expect(layerName({ ...s, name: "Button" })).toBe("Button");
  });
});

describe("輔助對齊", () => {
  const r = (x: number, y: number, w = 50, h = 50) => ({ x, y, w, h });
  it("間距：上下左右最近的鄰居；被畫板包住時量到畫板內側", () => {
    const ms = measureGaps(r(100, 100), [r(0, 110), r(200, 90), r(100, 300), r(-500, -500, 2000, 2000)]);
    const by = (axis: string, from: number) => ms.find((m) => m.axis === axis && m.from === from);
    expect(by("x", 50)).toMatchObject({ to: 100 });
    expect(by("x", 150)).toMatchObject({ to: 200 });
    expect(by("y", 150)).toMatchObject({ to: 300 });
    // 上面沒有鄰居：量到外框
    expect(by("y", -500)).toMatchObject({ to: 100 });
  });
  it("等距吸附：和同一列其他兩個的間距一樣", () => {
    // A(0..50) 和 B(80..130) 間距 30；拖的框在 C 左邊，離 B 32：吸到 30
    const s = snapSpacing(r(162, 0), [r(0, 0), r(80, 0), r(400, 0)], 6);
    expect(s.dx).toBe(-2);
    expect(s.marks.filter((m) => m.equal)).toHaveLength(2);
  });
  it("等距吸附：夾在兩個中間時吸到正中間", () => {
    // 上面 0..50、下面 250..300：正中間是 y=125
    const s = snapSpacing(r(0, 122, 50, 50), [r(0, 0, 50, 50), r(0, 250, 50, 50)], 6);
    expect(s.dy).toBe(3);
    expect(s.marks).toHaveLength(2);
    expect(s.dx).toBe(0);
  });
  it("改大小：動的邊吸到別的圖形的邊", () => {
    const s = snapResize(r(0, 0, 97, 50), "se", [r(200, 0, 100, 100), r(0, 300, 100, 10)], 6);
    expect(s.rect).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    expect(s.guides[0]).toMatchObject({ axis: "x", at: 100 });
    const w = snapResize(r(3, 0, 97, 50), "w", [r(0, 300, 100, 10)], 6);
    expect(w.rect).toEqual({ x: 0, y: 0, w: 100, h: 50 });
  });
  it("量距離：分開時量間距，包住時量四邊內距", () => {
    expect(measureBetween(r(0, 0), r(80, 0))).toEqual([{ axis: "x", from: 50, to: 80, at: 25 }]);
    const inside = measureBetween(r(10, 20), r(0, 0, 100, 100));
    expect(inside.map((m) => m.to - m.from)).toEqual([10, 40, 20, 30]);
  });
});
