import { describe, expect, it } from "vitest";
import { clickPick, keepPick, noPick, stepPick } from "./selection";

const order = ["a", "b", "c", "d", "e"];

describe("清單選取", () => {
  it("點一下只選一個；Ctrl 加入、移出", () => {
    let p = clickPick(order, noPick<string>(), "b", {});
    expect(p).toEqual({ sel: ["b"], anchor: "b" });
    p = clickPick(order, p, "d", { ctrl: true });
    expect(p).toEqual({ sel: ["b", "d"], anchor: "d" });
    p = clickPick(order, p, "a", { ctrl: true });
    expect(p.sel).toEqual(["a", "b", "d"]);
    p = clickPick(order, p, "b", { ctrl: true });
    expect(p.sel).toEqual(["a", "d"]);
  });
  it("Shift 選範圍，起點不變；Ctrl＋Shift 加到原本的選取", () => {
    let p = clickPick(order, noPick<string>(), "b", {});
    p = clickPick(order, p, "d", { shift: true });
    expect(p).toEqual({ sel: ["b", "c", "d"], anchor: "b" });
    p = clickPick(order, p, "a", { shift: true });
    expect(p.sel).toEqual(["a", "b"]);
    p = clickPick(order, { sel: ["e"], anchor: "a" }, "b", { shift: true, ctrl: true });
    expect(p.sel).toEqual(["a", "b", "e"]);
  });
  it("↑↓ 移動，Shift 延伸", () => {
    let r = stepPick(order, { sel: ["b"], anchor: "b" }, "b", 1, false);
    expect(r).toEqual({ pick: { sel: ["c"], anchor: "c" }, to: "c" });
    r = stepPick(order, r.pick, "c", 1, true);
    r = stepPick(order, r.pick, "d", 1, true);
    expect(r.pick.sel).toEqual(["c", "d", "e"]);
    expect(stepPick(order, r.pick, "e", 1, true).to).toBeNull();
  });
  it("清單變了去掉不在的", () => {
    expect(keepPick(["a", "c"], { sel: ["a", "b"], anchor: "b" })).toEqual({ sel: ["a"], anchor: null });
    const same = { sel: ["a"], anchor: "a" };
    expect(keepPick(order, same)).toBe(same);
  });
});
