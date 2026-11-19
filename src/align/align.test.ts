import { describe, expect, it } from "vitest";
import { snapMove, snapResizeGrid } from "./align";

const r = (x: number, y: number, w = 50, h = 50) => ({ x, y, w, h });

describe("共用的輔助對齊", () => {
  it("搬移：靠近邊時吸過去，並顯示對齊線與距離", () => {
    const out = snapMove(r(0, 0), 197, 3, [r(300, 0)], 6, null);
    // 水平方向沒有可吸的（右邊 247 離 300 太遠）；上邊 3 吸到 0，右邊顯示到 300 的距離
    expect(out.dy).toBe(0);
    expect(out.guides.some((g) => g.axis === "y" && g.at === 0)).toBe(true);
    expect(out.measures.some((m) => m.axis === "x" && m.from === 247 && m.to === 300)).toBe(true);
  });
  it("搬移：等距比對齊邊近時用等距", () => {
    // A 0..50、B 80..130（間距 30）；拖的框放到 158（離 B 28），等距吸到 160
    const out = snapMove(r(1000, 0), -842, 0, [r(0, 0), r(80, 0), r(400, 0)], 6, null);
    expect(out.dx).toBe(-840);
    expect(out.measures.filter((m) => m.equal)).toHaveLength(2);
  });
  it("搬移：都沒有時對齊格線", () => {
    expect(snapMove(r(0, 0), 13, 17, [], 6, 8)).toMatchObject({ dx: 16, dy: 16 });
  });
  it("改大小：右下角吸到別的東西的邊，另一邊對齊格線", () => {
    const base = r(0, 0, 100, 100);
    const out = snapResizeGrid({ ...base, w: 197, h: 133 }, base, "se", [r(300, 0, 10, 10), r(200, 500, 20, 20)], 6, 8);
    expect(out.rect).toEqual({ x: 0, y: 0, w: 200, h: 136 });
    expect(out.guides).toHaveLength(1);
  });
});
