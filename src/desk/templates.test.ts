import { describe, expect, it } from "vitest";
import { addNote, emptyBoard, parseBoard, serializeBoard } from "./board";
import { mapBounds } from "./mindmap";
import { insertMindMap, insertMindMapAt, mindMapSpot } from "./templates";

describe("whiteboard mind map template", () => {
  it("adds one XMind-style map with a central topic and four main topics", () => {
    const { board, ids, bounds } = insertMindMap(emptyBoard(), 0, 0);
    expect(board.cards).toHaveLength(0);
    expect(board.maps).toHaveLength(1);
    expect(ids).toEqual([board.maps[0].id]);
    expect(board.maps[0].root.children.map((c) => c.text)).toEqual(["Main Topic 1", "Main Topic 2", "Main Topic 3", "Main Topic 4"]);
    expect(parseBoard(serializeBoard(board))).toEqual(board);
    expect(bounds.w).toBeGreaterThan(0);
  });

  it("keeps existing content and places the map to its right", () => {
    const b = addNote(emptyBoard(), 0, 0, "hi").board;
    expect(mindMapSpot(emptyBoard(), 10, 20)).toEqual({ x: 10, y: 20 });
    const spot = mindMapSpot(b, 0, 0);
    const r = insertMindMap(b, spot.x, spot.y);
    expect(r.board.cards[0].text).toBe("hi");
    expect(r.bounds.x).toBeGreaterThan(240);
  });

  it("insertMindMapAt puts the map's top-left corner at the point", () => {
    const r = insertMindMapAt(emptyBoard(), 500, 300);
    const m = mapBounds(r.board.maps[0]);
    expect(m.x).toBeCloseTo(500);
    expect(m.y).toBeCloseTo(300);
    expect(r.bounds).toMatchObject({ x: 500, y: 300 });
  });
});
