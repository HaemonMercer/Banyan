import { describe, expect, it } from "vitest";
import { addDoc, emptyFile, parseFile, serializeFile, updateDoc } from "./file";
import {
  alignFrames,
  arrange,
  cleanBoxes,
  cleanFrame,
  dashArray,
  withShape,
  duplicateBoxes,
  MAIN_FRAME,
  moveBoxes,
  newImageBox,
  newShapeBox,
  newTextBox,
  removeBoxes,
  type SlideBox,
} from "./slideBoxes";
import { animDuplicate, animRemove, setMeta, trimAnim } from "./slideAnim";

const box = (id: string, x = 0, y = 0): SlideBox => ({ id, kind: "shape", shape: "rect", x, y, w: 100, h: 50 });
const ids = (bs: SlideBox[]) => bs.map((b) => b.id);

describe("投影片上的物件", () => {
  it("新增：文字方塊錯開、圖片照比例縮進投影片、形狀置中", () => {
    const a = newTextBox([]);
    const b = newTextBox([a]);
    expect([b.x - a.x, b.y - a.y]).toEqual([20, 20]);
    const img = newImageBox([], "media/a.png", { w: 2000, h: 1000 });
    expect([img.w, img.h]).toEqual([576, 288]);
    expect(img.x).toBe((960 - 576) / 2);
    const s = newShapeBox([], "ellipse");
    expect(s.x + s.w / 2).toBe(480);
  });

  it("搬移、刪除、複製、上下層", () => {
    const bs = [box("a"), box("b"), box("c")];
    expect(moveBoxes(bs, ["b"], 10, 5)[1]).toMatchObject({ x: 10, y: 5 });
    expect(ids(removeBoxes(bs, ["a", "c"]))).toEqual(["b"]);
    const d = duplicateBoxes(bs, ["a"]);
    expect(d.boxes).toHaveLength(4);
    expect(d.boxes[3]).toMatchObject({ x: 20, y: 20 });
    expect(d.added).toEqual([d.boxes[3].id]);
    expect(ids(arrange(bs, ["a"], "front"))).toEqual(["b", "c", "a"]);
    expect(ids(arrange(bs, ["c"], "back"))).toEqual(["c", "a", "b"]);
    expect(ids(arrange(bs, ["a"], "forward"))).toEqual(["b", "a", "c"]);
    expect(ids(arrange(bs, ["c"], "backward"))).toEqual(["a", "c", "b"]);
  });

  it("對齊：一個對投影片，好幾個對它們的外框", () => {
    expect(alignFrames([{ id: "a", x: 10, y: 10, w: 100, h: 40 }], "center").get("a")).toMatchObject({ x: 430 });
    const m = alignFrames(
      [
        { id: "a", x: 10, y: 10, w: 100, h: 40 },
        { id: "b", x: 200, y: 100, w: 50, h: 40 },
      ],
      "right",
    );
    expect([m.get("a")!.x, m.get("b")!.x]).toEqual([150, 200]);
  });

  it("存檔讀回來；壞掉的物件丟掉；主文字方塊沒搬過就不存", () => {
    expect(cleanBoxes([{ kind: "image" }, { kind: "x" }, { id: "t", kind: "text", x: 1, y: 2, w: 3, h: 4, text: "hi" }])).toEqual([
      { id: "t", kind: "text", x: 1, y: 2, w: 8, h: 8, text: "hi" },
    ]);
    expect(cleanFrame(MAIN_FRAME)).toBeUndefined();
    expect(cleanFrame({ x: 10, y: 20, w: 300, h: 200 })).toEqual({ x: 10, y: 20, w: 300, h: 200 });

    let f = addDoc(emptyFile(), "slides").file;
    const anim = setMeta([], 1, (m) => ({ ...m, main: { x: 10, y: 20, w: 300, h: 200 }, boxes: [box("s")] }));
    f = updateDoc(f, f.docs[0].id, { anim });
    expect(parseFile(serializeFile(f)).docs[0].anim).toEqual(trimAnim(anim));
  });

  it("主文字方塊刪掉了：存檔讀回來還是刪掉的", () => {
    const anim = setMeta([], 1, (m) => ({ ...m, noBody: true }));
    expect(trimAnim(anim)).toHaveLength(2);
    let f = addDoc(emptyFile(), "slides").file;
    f = updateDoc(f, f.docs[0].id, { content: "# A\n\n---\n\n", anim });
    expect(parseFile(serializeFile(f)).docs[0].anim?.[1]).toMatchObject({ noBody: true });
    expect(parseFile(serializeFile(f)).docs[0].anim?.[0].noBody).toBeUndefined();
  });

  it("物件跟著投影片刪除、複製", () => {
    const anim = setMeta(setMeta([], 0, (m) => ({ ...m, boxes: [box("a")] })), 2, (m) => ({ ...m, boxes: [box("c")] }));
    expect(animRemove(anim, [0]).map((a) => a.boxes?.map((b) => b.id) ?? [])).toEqual([[], ["c"]]);
    expect(animDuplicate(anim, [0], 3)[1].boxes?.[0].id).toBe("a");
    // 沒有物件也沒有動畫的投影片在結尾不存
    expect(setMeta(anim, 2, (m) => ({ ...m, boxes: [] }))).toHaveLength(1);
  });
});

describe("slide object appearance", () => {
  it("keeps border width, line style, opacity and shadow", () => {
    const [b] = cleanBoxes([{ id: "s", kind: "shape", x: 0, y: 0, w: 10, h: 10, lw: 6.3, dash: "dot", opacity: 45, shadow: true }]);
    expect(b).toMatchObject({ lw: 6.5, dash: "dot", opacity: 45, shadow: true });
    // 預設值、範圍外、不認得的不存
    const [c] = cleanBoxes([{ id: "t", kind: "text", x: 0, y: 0, w: 10, h: 10, lw: 3, dash: "wavy", opacity: 100, shadow: "yes" }]);
    expect(c).not.toHaveProperty("lw");
    expect(c).not.toHaveProperty("dash");
    expect(c).not.toHaveProperty("opacity");
    expect(c).not.toHaveProperty("shadow");
    expect(cleanBoxes([{ kind: "text", lw: 99, opacity: 2 }])[0]).toMatchObject({ lw: 40, opacity: 10 });
  });

  it("changes a shape's kind", () => {
    const rect = { id: "a", kind: "shape" as const, shape: "rect" as const, x: 0, y: 0, w: 10, h: 10, fill: "red" as const, line: null };
    expect(withShape(rect, "star")).toMatchObject({ shape: "star", fill: "red", line: null });
    const line = withShape(rect, "line");
    expect(line).toMatchObject({ shape: "line", fill: null, line: "gray" });
    expect(withShape(line, "ellipse")).toMatchObject({ shape: "ellipse", fill: "blue", line: "gray" });
  });

  it("draws dashes from the line width", () => {
    expect(dashArray(undefined, 3)).toBeUndefined();
    expect(dashArray("dash", 2)).toBe("6 4");
    expect(dashArray("dot", 2)).toBe("0 4");
  });
});

describe("物件的自訂顏色", () => {
  it("填色、框線可以是色盤名稱或 #rrggbb，不認得的丟掉", () => {
    const [b] = cleanBoxes([{ id: "s", kind: "shape", x: 0, y: 0, w: 10, h: 10, fill: "#AA3366", line: "blue" }]);
    expect(b.fill).toBe("#aa3366");
    expect(b.line).toBe("blue");
    const [c] = cleanBoxes([{ id: "t", kind: "text", x: 0, y: 0, w: 10, h: 10, fill: "#12", line: "neon" }]);
    expect(c.fill).toBeUndefined();
    expect(c.line).toBeUndefined();
  });
});
