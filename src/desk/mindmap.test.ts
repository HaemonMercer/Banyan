import { describe, expect, it } from "vitest";
import { emptyBoard, moveItems, parseBoard, removeItems, sectionMembers, serializeBoard, addSection } from "./board";
import {
  addChild,
  addSibling,
  detachTopic,
  findTopic,
  layoutMap,
  mapOutline,
  moveTopic,
  neighbor,
  newMap,
  removeTopic,
  setMapStyle,
  setText,
  setTopicLook,
  THEMES,
  toggleCollapse,
  TOPIC_COLORS,
  topic,
  type MindMap,
} from "./mindmap";

const sample = (): MindMap => ({
  id: "m",
  x: 0,
  y: 0,
  root: {
    id: "r",
    text: "Root",
    collapsed: false,
    children: [
      { id: "a", text: "A", collapsed: false, children: [{ id: "a1", text: "A1", collapsed: false, children: [] }, { id: "a2", text: "A2", collapsed: false, children: [] }] },
      { id: "b", text: "B", collapsed: false, children: [] },
      { id: "c", text: "C", collapsed: false, children: [] },
    ],
  },
});

describe("mind map model", () => {
  it("new maps follow XMind's default: a central topic with four main topics", () => {
    const m = newMap(10, 20);
    expect(m.root.text).toBe("Central Topic");
    expect(m.root.children.map((c) => c.text)).toEqual(["Main Topic 1", "Main Topic 2", "Main Topic 3", "Main Topic 4"]);
  });

  it("round-trips through the board JSON, and boards without maps stay the same", () => {
    const b = { ...emptyBoard(), maps: [toggleCollapse([sample()], "m", "a")[0]] };
    expect(parseBoard(serializeBoard(b))).toEqual(b);
    expect(serializeBoard(emptyBoard())).not.toContain("maps");
    expect(parseBoard("{}").maps).toEqual([]);
  });

  it("adds children and siblings in the right place", () => {
    let r = addChild([sample()], "m", "a");
    expect(findTopic(r.maps[0], r.id!)!.parent!.id).toBe("a");
    expect(findTopic(r.maps[0], r.id!)!.topic.text).toBe("Subtopic");
    r = addSibling([sample()], "m", "a1");
    expect(findTopic(r.maps[0], "a")!.topic.children.map((c) => c.id)).toEqual(["a1", r.id, "a2"]);
    r = addSibling([sample()], "m", "a1", true);
    expect(findTopic(r.maps[0], "a")!.topic.children[0].id).toBe(r.id);
    // 中心主題沒有同層：加成主要主題
    r = addSibling([sample()], "m", "r");
    expect(findTopic(r.maps[0], r.id!)!.depth).toBe(1);
    expect(findTopic(r.maps[0], r.id!)!.topic.text).toBe("Main Topic 4");
  });

  it("adding a child expands a collapsed topic", () => {
    const maps = toggleCollapse([sample()], "m", "a");
    expect(findTopic(maps[0], "a")!.topic.collapsed).toBe(true);
    const r = addChild(maps, "m", "a");
    expect(findTopic(r.maps[0], "a")!.topic.collapsed).toBe(false);
  });

  it("removes topics with their subtopics; removing the root removes the map", () => {
    const maps = removeTopic([sample()], "m", "a");
    expect(findTopic(maps[0], "a1")).toBeNull();
    expect(removeTopic([sample()], "m", "r")).toEqual([]);
  });

  it("edits text without touching other topics", () => {
    const m0 = sample();
    const [m] = setText([m0], "m", "b", "Bee");
    expect(findTopic(m, "b")!.topic.text).toBe("Bee");
    expect(m.root.children[0]).toBe(m0.root.children[0]);
  });

  it("moves topics as a child, before or after another, but never into themselves", () => {
    let maps = moveTopic([sample()], { map: "m", topic: "b" }, { map: "m", topic: "a1", mode: "child" });
    expect(findTopic(maps[0], "b")!.parent!.id).toBe("a1");
    maps = moveTopic([sample()], { map: "m", topic: "c" }, { map: "m", topic: "a", mode: "before" });
    expect(maps[0].root.children.map((c) => c.id)).toEqual(["c", "a", "b"]);
    maps = moveTopic([sample()], { map: "m", topic: "a2" }, { map: "m", topic: "c", mode: "after" });
    expect(maps[0].root.children.map((c) => c.id)).toEqual(["a", "b", "c", "a2"]);
    const same = [sample()];
    expect(moveTopic(same, { map: "m", topic: "a" }, { map: "m", topic: "a2", mode: "child" })).toBe(same);
    expect(moveTopic(same, { map: "m", topic: "r" }, { map: "m", topic: "b", mode: "child" })).toBe(same);
  });

  it("moves topics between maps and detaches a topic into its own map", () => {
    const other: MindMap = { id: "n", x: 500, y: 0, root: topic("Other") };
    let maps = moveTopic([sample(), other], { map: "m", topic: "a" }, { map: "n", topic: other.root.id, mode: "before" });
    expect(findTopic(maps[0], "a")).toBeNull();
    expect(findTopic(maps[1], "a")!.parent!.id).toBe(other.root.id);
    const r = detachTopic([sample()], "m", "a", 300, 400);
    expect(r.maps).toHaveLength(2);
    expect(r.maps[1]).toMatchObject({ x: 300, y: 400, root: { id: "a" } });
  });

  it("outlines a map as Markdown for the Dock", () => {
    expect(mapOutline(sample())).toBe("**Root**\n\n- A\n  - A1\n  - A2\n- B\n- C");
  });

  it("board operations move, remove and group maps", () => {
    const b = { ...emptyBoard(), maps: [sample()] };
    expect(moveItems(b, ["m"], 5, 6).maps[0]).toMatchObject({ x: 5, y: 6 });
    expect(removeItems(b, ["m"]).maps).toEqual([]);
    const s = addSection(b, { x: -10, y: -10, w: 400, h: 300 });
    expect(sectionMembers(s.board, s.id)).toContain("m");
  });
});

describe("mind map layout", () => {
  it("balances main topics: first half right (top to bottom), the rest left", () => {
    const L = layoutMap(sample());
    const r = L.nodes.get("r")!;
    const [a, b, c] = ["a", "b", "c"].map((id) => L.nodes.get(id)!);
    expect(a.side).toBe("right");
    expect(b.side).toBe("right");
    expect(c.side).toBe("left");
    expect(a.x).toBeGreaterThan(r.x + r.w);
    expect(c.x + c.w).toBeLessThan(r.x);
    expect(a.y).toBeLessThan(b.y);
    const classic = THEMES[0].branches;
    expect([a.color, b.color, c.color]).toEqual(classic.slice(0, 3));
  });

  it("centers parents on their children and keeps siblings from overlapping", () => {
    const L = layoutMap(sample());
    const a = L.nodes.get("a")!;
    const [a1, a2] = [L.nodes.get("a1")!, L.nodes.get("a2")!];
    expect(a1.side).toBe("right");
    expect(a1.color).toBe(a.color);
    expect(a1.shape).toBe("underline");
    expect(a1.y + a1.h).toBeLessThanOrEqual(a2.y);
    expect(Math.abs((a1.y + a2.y + a2.h) / 2 - (a.y + a.h / 2))).toBeLessThan(1);
    expect(L.links).toHaveLength(5);
  });

  it("hides collapsed subtopics and counts them", () => {
    const [m] = toggleCollapse([sample()], "m", "a");
    const L = layoutMap(m);
    expect(L.nodes.has("a1")).toBe(false);
    expect(L.nodes.get("a")!.hidden).toBe(2);
  });

  it("grows with the text being typed (draft)", () => {
    const m = sample();
    const w0 = layoutMap(m).nodes.get("b")!.w;
    expect(layoutMap(m, { id: "b", text: "A much longer topic" }).nodes.get("b")!.w).toBeGreaterThan(w0);
    expect(layoutMap(m, { id: "b", text: "two\nlines" }).nodes.get("b")!.h).toBeGreaterThan(layoutMap(m).nodes.get("b")!.h);
  });

  it("arrow keys move outward, inward and between siblings", () => {
    const m = sample();
    expect(neighbor(m, "r", "ArrowLeft")).toBe("c");
    expect(neighbor(m, "a", "ArrowRight")).toMatch(/^a[12]$/);
    expect(neighbor(m, "a1", "ArrowLeft")).toBe("a");
    expect(neighbor(m, "c", "ArrowRight")).toBe("r");
    expect(neighbor(m, "a1", "ArrowDown")).toBe("a2");
    expect(neighbor(m, "a", "ArrowDown")).toBe("b");
    expect(neighbor(m, "a", "ArrowUp")).toBeNull();
  });
});

describe("mind map styles", () => {
  const styled = (patch: Parameters<typeof setMapStyle>[2]) => setMapStyle([sample()], "m", patch)[0];

  it("logic chart puts every main topic on the right", () => {
    const L = layoutMap(styled({ structure: "right" }));
    expect(["a", "b", "c"].map((id) => L.nodes.get(id)!.side)).toEqual(["right", "right", "right"]);
  });

  it("org chart grows downward with siblings side by side", () => {
    const m = styled({ structure: "org" });
    const L = layoutMap(m);
    const r = L.nodes.get("r")!;
    const [a, b, c] = ["a", "b", "c"].map((id) => L.nodes.get(id)!);
    expect(a.y).toBeGreaterThan(r.y + r.h);
    expect(a.y).toBe(b.y);
    expect(a.x + a.w).toBeLessThan(b.x);
    expect(b.x + b.w).toBeLessThan(c.x);
    // 父主題在子主題群的水平中央
    const [a1, a2] = [L.nodes.get("a1")!, L.nodes.get("a2")!];
    expect(Math.abs((a1.x + a2.x + a2.w) / 2 - (a.x + a.w / 2))).toBeLessThan(1);
    expect(L.nodes.get("a1")!.shape).toBe("rounded");
    expect(neighbor(m, "r", "ArrowDown")).toBe("b");
    expect(neighbor(m, "a", "ArrowUp")).toBe("r");
    expect(neighbor(m, "a", "ArrowRight")).toBe("b");
    expect(neighbor(m, "b", "ArrowLeft")).toBe("a");
  });

  it("tree indents children below their parent, in order", () => {
    const m = styled({ structure: "tree" });
    const L = layoutMap(m);
    const order = ["r", "a", "a1", "a2", "b", "c"].map((id) => L.nodes.get(id)!);
    for (let i = 1; i < order.length; i++) expect(order[i].y).toBeGreaterThan(order[i - 1].y);
    expect(L.nodes.get("a")!.x).toBeGreaterThan(L.nodes.get("r")!.x);
    expect(L.nodes.get("a1")!.x).toBeGreaterThan(L.nodes.get("a")!.x);
    expect(neighbor(m, "a", "ArrowRight")).toBe("a1");
    expect(neighbor(m, "a", "ArrowDown")).toBe("b");
  });

  it("themes change the root and branch colors and the main topic fill", () => {
    const L = layoutMap(styled({ theme: "pastel" }));
    expect(L.nodes.get("a")!.fill).toBe("soft");
    const ink = layoutMap(styled({ theme: "ink" }));
    expect(ink.nodes.get("a")!.fill).toBe("outline");
    expect(ink.nodes.get("b")!.color).toBe(ink.nodes.get("a")!.color);
  });

  it("a topic's color is used by its whole branch; shape and bold change the size", () => {
    let maps = setTopicLook([sample()], "m", "a", { color: "red" });
    const L = layoutMap(maps[0]);
    expect(L.nodes.get("a")!.color).toBe(TOPIC_COLORS.red);
    expect(L.nodes.get("a1")!.color).toBe(TOPIC_COLORS.red);
    expect(L.links.find((l) => l.to === "a1")!.color).toBe(TOPIC_COLORS.red);
    maps = setTopicLook(maps, "m", "a1", { shape: "pill", bold: true });
    const n = layoutMap(maps[0]).nodes.get("a1")!;
    expect(n.shape).toBe("pill");
    expect(n.fill).toBe("outline");
    expect(n.style.weight).toBe(700);
    expect(n.w).toBeGreaterThan(L.nodes.get("a1")!.w);
    // 清掉
    maps = setTopicLook(maps, "m", "a1", { bold: false });
    expect(findTopic(maps[0], "a1")!.topic.look).toEqual({ shape: "pill" });
    maps = setTopicLook(maps, "m", "a1", null);
    expect(findTopic(maps[0], "a1")!.topic.look).toBeUndefined();
  });

  it("styles round-trip through the board JSON and bad values are dropped", () => {
    let maps = setMapStyle([sample()], "m", { structure: "org", theme: "ocean" });
    maps = setTopicLook(maps, "m", "b", { color: "green", shape: "rect", bold: true });
    const b = { ...emptyBoard(), maps };
    expect(parseBoard(serializeBoard(b))).toEqual(b);
    const bad = parseBoard({ maps: [{ id: "x", x: 0, y: 0, style: { structure: "spiral", theme: "neon" }, root: { id: "r", text: "", look: { color: "teal", shape: "star" } } }] });
    expect(bad.maps[0].style).toBeUndefined();
    expect(bad.maps[0].root.look).toBeUndefined();
  });
});
