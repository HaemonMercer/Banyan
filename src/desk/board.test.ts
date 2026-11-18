import { describe, expect, it } from "vitest";
import {
  addCard,
  addEdge,
  addNote,
  addSection,
  CARD_MIN_W,
  edgePath,
  emptyBoard,
  fitCamera,
  flipEdge,
  moveItems,
  parseBoard,
  readingOrder,
  removeItems,
  renameRef,
  sectionAround,
  sectionMembers,
  serializeBoard,
  toWorld,
  zoomAt,
  ZOOM_MAX,
  type Board,
} from "./board";

const page = (name: string) => ({ kind: "page" as const, name });
const day = (date: string) => ({ kind: "day" as const, date });

function twoCards(): { board: Board; a: string; b: string } {
  const r1 = addCard(emptyBoard(), page("A"), 0, 0);
  const r2 = addCard(r1.board, page("B"), 500, 0);
  return { board: r2.board, a: r1.id, b: r2.id };
}

describe("白板讀寫", () => {
  it("serialize → parse 不變", () => {
    const { board, a, b } = twoCards();
    const withEdge = addEdge(board, a, b).board;
    const withSec = addSection(withEdge, { x: -50, y: -50, w: 1000, h: 400 }, "研究").board;
    const json = serializeBoard(withSec);
    expect(parseBoard(json)).toEqual(withSec);
    expect(serializeBoard(parseBoard(json))).toBe(json);
  });

  it("壞掉的檔案與不合法的項目略過", () => {
    expect(parseBoard("not json")).toEqual(emptyBoard());
    expect(parseBoard("")).toEqual(emptyBoard());
    const b = parseBoard(
      JSON.stringify({
        cards: [
          { id: "1", ref: { kind: "page", name: "A" }, x: 1, y: 2, w: 10, h: null, color: "nope" },
          { id: "2", ref: { kind: "day", date: "bad" }, x: 0, y: 0 },
          { id: "3", ref: { kind: "day", date: "2026-11-18" } },
        ],
        edges: [
          { id: "e1", from: "1", to: "3" },
          { id: "e2", from: "1", to: "2" },
          { id: "e3", from: "1", to: "1" },
        ],
      }),
    );
    expect(b.cards.map((c) => c.id)).toEqual(["1", "3"]);
    expect(b.cards[0].w).toBe(CARD_MIN_W);
    expect(b.cards[0].color).toBeNull();
    expect(b.edges.map((e) => e.id)).toEqual(["e1"]);
    expect(b.edges[0].label).toBe("");
  });
});

describe("卡片", () => {
  it("同一份文件只放一張（頁面名稱不分大小寫）", () => {
    const r1 = addCard(emptyBoard(), page("讀書 筆記"), 0, 0);
    const r2 = addCard(r1.board, page("讀書  筆記"), 100, 100);
    expect(r2.added).toBe(false);
    expect(r2.id).toBe(r1.id);
    expect(r2.board.cards).toHaveLength(1);
    const r3 = addCard(r2.board, day("2026-11-18"), 0, 0);
    expect(r3.added).toBe(true);
  });

  it("搬移卡片與區段", () => {
    const { board, a } = twoCards();
    const s = addSection(board, { x: 0, y: 0, w: 300, h: 300 });
    const moved = moveItems(s.board, [a, s.id], 10, -5);
    expect(moved.cards.find((c) => c.id === a)).toMatchObject({ x: 10, y: -5 });
    expect(moved.sections[0]).toMatchObject({ x: 10, y: -5 });
    expect(moveItems(board, [a], 0, 0)).toBe(board);
  });

  it("拿掉卡片時連線一起拿掉", () => {
    const { board, a, b } = twoCards();
    const e = addEdge(board, a, b);
    const out = removeItems(e.board, [a]);
    expect(out.cards.map((c) => c.id)).toEqual([b]);
    expect(out.edges).toEqual([]);
    // 只拿掉連線
    expect(removeItems(e.board, [e.id!]).cards).toHaveLength(2);
  });

  it("頁面改名後卡片跟著改", () => {
    const { board } = twoCards();
    const out = renameRef(board, "a", "Alpha");
    expect(out.cards[0].ref).toEqual(page("Alpha"));
    expect(renameRef(board, "zzz", "x")).toBe(board);
  });
});

describe("連線", () => {
  it("不連自己、不重複", () => {
    const { board, a, b } = twoCards();
    expect(addEdge(board, a, a).id).toBeNull();
    const e1 = addEdge(board, a, b);
    const e2 = addEdge(e1.board, a, b);
    expect(e2.id).toBe(e1.id);
    expect(e2.board.edges).toHaveLength(1);
    // 反方向可以另外連
    expect(addEdge(e2.board, b, a).board.edges).toHaveLength(2);
  });

  it("反轉方向", () => {
    const { board, a, b } = twoCards();
    const e = addEdge(board, a, b);
    expect(flipEdge(e.board, e.id!).edges[0]).toMatchObject({ from: b, to: a });
  });

  it("左右排列時從右邊連到左邊；上下排列時從下面連到上面", () => {
    const left = { x: 0, y: 0, w: 100, h: 50 };
    const right = { x: 300, y: 0, w: 100, h: 50 };
    expect(edgePath(left, right).d.startsWith("M 100 25")).toBe(true);
    expect(edgePath(left, right).d.endsWith("300 25")).toBe(true);
    const below = { x: 0, y: 300, w: 100, h: 50 };
    expect(edgePath(left, below).d.startsWith("M 50 50")).toBe(true);
    expect(edgePath(left, below).d.endsWith("50 300")).toBe(true);
    expect(edgePath(left, right).mid).toEqual({ x: 200, y: 25 });
  });
});

describe("區段", () => {
  it("區段裡的卡片看中心點；整個在裡面的區段也算", () => {
    let b = emptyBoard();
    const s = addSection(b, { x: 0, y: 0, w: 600, h: 400 });
    b = s.board;
    const inside = addCard(b, page("in"), 100, 100);
    const half = addCard(inside.board, page("half"), 450, 100); // 寬 340，中心 620：在外面
    const inner = addSection(half.board, { x: 50, y: 250, w: 200, h: 160 }); // 超出下緣
    const inner2 = addSection(inner.board, { x: 300, y: 200, w: 200, h: 160 });
    const members = sectionMembers(inner2.board, s.id, {});
    expect(members).toContain(inside.id);
    expect(members).not.toContain(half.id);
    expect(members).toContain(inner2.id);
    expect(members).not.toContain(inner.id);
    expect(members).not.toContain(s.id);
  });

  it("包住選取的卡片", () => {
    expect(sectionAround([])).toBeNull();
    expect(sectionAround([{ x: 0, y: 0, w: 100, h: 100 }], 10)).toEqual({ x: -10, y: -34, w: 120, h: 144 });
  });
});

describe("畫面", () => {
  it("以滑鼠為中心縮放：滑鼠下的點不動", () => {
    const cam = { x: 30, y: 40, zoom: 1 };
    const before = toWorld(cam, 200, 150);
    const after = zoomAt(cam, 2, 200, 150);
    expect(toWorld(after, 200, 150)).toEqual(before);
    expect(zoomAt(cam, 99, 0, 0).zoom).toBe(ZOOM_MAX);
  });

  it("符合畫面：內容置中、不放大超過 100%", () => {
    const cam = fitCamera({ x: 0, y: 0, w: 100, h: 100 }, 800, 600);
    expect(cam.zoom).toBe(1);
    expect(toWorld(cam, 400, 300)).toEqual({ x: 50, y: 50 });
    const big = fitCamera({ x: 0, y: 0, w: 4000, h: 1000 }, 800, 600, 0);
    expect(big.zoom).toBeCloseTo(0.2);
  });
});

describe("便利貼", () => {
  it("每次都新增一張，內容存在白板裡、讀回來一樣", () => {
    const a = addNote(emptyBoard(), 10, 20, "第一個想法");
    const b = addNote(a.board, 300, 20, "**第二個**");
    expect(b.board.cards).toHaveLength(2);
    expect(b.board.cards[0].color).toBe("yellow");
    const back = parseBoard(serializeBoard(b.board));
    expect(back.cards.map((c) => [c.ref.kind, c.text])).toEqual([
      ["note", "第一個想法"],
      ["note", "**第二個**"],
    ]);
  });

  it("頁面卡片不存內容", () => {
    const { board } = twoCards();
    const j = JSON.parse(serializeBoard(board));
    expect(j.cards[0].text).toBeUndefined();
    expect(parseBoard(j).cards[0].text).toBe("");
  });

  it("閱讀順序：由上到下，同一列由左到右", () => {
    let b = emptyBoard();
    const at = (x: number, y: number, t: string) => (b = addNote(b, x, y, t).board);
    at(400, 10, "右上");
    at(0, 0, "左上");
    at(200, 300, "下面");
    at(0, 300, "左下");
    const heights = Object.fromEntries(b.cards.map((c) => [c.id, 100]));
    expect(readingOrder(b.cards, heights).map((c) => c.text)).toEqual(["左上", "右上", "左下", "下面"]);
  });
});
