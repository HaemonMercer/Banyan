import { describe, expect, it } from "vitest";
import { addDraw, addNote, DRAW_H, DRAW_W, emptyBoard, fixedSize, ownsText, parseBoard, refLabel, serializeBoard } from "./board";
import { addEdge, addShape, appendDiagram, diagramText, emptyDiagram, parseDiagram, serializeDiagram } from "./draw";
import { cardsDiagram, cardsMarkdown, type CardSource } from "./file";

/** 兩個圖形加一條連線的小圖表 */
function smallDiagram(at = 0) {
  let d = emptyDiagram();
  const a = addShape(d, "rect", at, 0, { text: "Start" });
  d = a.diagram;
  const b = addShape(d, "rect", at + 200, 0, { text: "End" });
  d = b.diagram;
  return addEdge(d, { shape: a.id, side: "right" }, { shape: b.id, side: "left" }).diagram;
}

describe("白板的圖表卡片（Draw）", () => {
  it("新增：預設大小、內容是圖表的 JSON；大小固定、內容存在卡片裡", () => {
    const json = serializeDiagram(smallDiagram());
    const { board, id } = addDraw(emptyBoard(), 10, 20, json);
    const c = board.cards.find((x) => x.id === id)!;
    expect(c).toMatchObject({ ref: { kind: "draw" }, x: 10, y: 20, w: DRAW_W, h: DRAW_H, text: json });
    expect(fixedSize(c.ref)).toBe(true);
    expect(ownsText(c.ref)).toBe(true);
    expect(refLabel(c.ref)).toBe("Diagram");
  });

  it("存檔再讀回來，圖表內容與大小都在", () => {
    const json = serializeDiagram(smallDiagram());
    const b = addDraw(emptyBoard(), 0, 0, json, 300, 120).board;
    const back = parseBoard(serializeBoard(b));
    expect(back.cards[0]).toMatchObject({ ref: { kind: "draw" }, w: 300, h: 120, text: json });
    // 舊的檔案沒有大小：用預設
    const raw = JSON.parse(serializeBoard(b));
    delete raw.cards[0].w;
    delete raw.cards[0].h;
    expect(parseBoard(JSON.stringify(raw)).cards[0]).toMatchObject({ w: DRAW_W, h: DRAW_H });
  });

  it("整張圖表貼在既有內容下面（新的 id，連線跟著）", () => {
    const target = smallDiagram();
    const out = appendDiagram(target, smallDiagram(500));
    expect(out.shapes).toHaveLength(4);
    expect(out.edges).toHaveLength(2);
    const added = out.shapes.slice(2);
    expect(added.every((s) => !target.shapes.some((t) => t.id === s.id))).toBe(true);
    // 放在原本內容的下面、左邊對齊
    expect(Math.min(...added.map((s) => s.y))).toBeGreaterThan(Math.max(...target.shapes.map((s) => s.y + s.h)));
    expect(Math.min(...added.map((s) => s.x))).toBe(Math.min(...target.shapes.map((s) => s.x)));
    const e = out.edges[1];
    expect("shape" in e.from && added.some((s) => s.id === (e.from as { shape: string }).shape)).toBe(true);
    expect(appendDiagram(target, emptyDiagram())).toBe(target);
  });

  it("圖表上的文字（送到 Word／簡報時用），不重複", () => {
    let d = smallDiagram();
    d = addShape(d, "rect", 0, 200, { text: "Start" }).diagram;
    expect(diagramText(serializeDiagram(d))).toBe("- Start\n- End");
    expect(diagramText("")).toBe("");
  });

  it("送到 Draw 文件：圖表卡片整張貼過去，其他卡片各變成一個圖形", () => {
    let b = addDraw(emptyBoard(), 0, 0, serializeDiagram(smallDiagram())).board;
    b = addNote(b, 0, 400, "Idea").board;
    const source: CardSource = (c) => (c.ref.kind === "note" ? { title: "", content: c.text } : { title: "Diagram", content: diagramText(c.text) });
    const d = parseDiagram(cardsDiagram("", b.cards, source));
    expect(d.shapes.map((s) => s.text).sort()).toEqual(["End", "Idea", "Start"]);
    expect(d.edges).toHaveLength(1);
    // 送到 Markdown 文件：標題加上圖上的文字
    expect(cardsMarkdown(b.cards.slice(0, 1), source, "word")).toBe("## Diagram\n\n- Start\n- End");
  });
});
