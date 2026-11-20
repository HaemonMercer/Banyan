import { describe, expect, it } from "vitest";
import { cleanDeck, slideColors } from "./deckSetup";
import { animInsert, cleanAnim, trimAnim } from "./slideAnim";
import { MAIN_FRAME } from "./slideBoxes";
import {
  baseFrame,
  cleanMasters,
  duplicateMaster,
  insertMaster,
  makeDefault,
  masterAsMeta,
  masterOf,
  masterUsage,
  metaIntoMaster,
  moveMaster,
  presetMaster,
  removeMaster,
  uniqueName,
  updateMaster,
  type SlideMaster,
} from "./slideMasters";

const a: SlideMaster = { id: "a", name: "Default" };
const b: SlideMaster = { id: "b", name: "Dark", bg: "#141414", boxes: [{ id: "x", kind: "shape", shape: "rect", x: 0, y: 0, w: 960, h: 20 }], main: { x: 80, y: 60, w: 800, h: 400 } };

describe("slide masters", () => {
  it("cleans saved masters", () => {
    const out = cleanMasters([{ id: "a", name: " Title ", bg: "red", main: MAIN_FRAME }, { id: "a" }, "junk", { name: "", noFoot: true }]);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ id: "a", name: "Title" });
    expect(out[1].id).not.toBe("a");
    expect(out[2]).toMatchObject({ name: "Master", noFoot: true });
    expect(cleanMasters(null)).toEqual([]);
  });

  it("keeps masters in the deck setup", () => {
    expect(cleanDeck({ masters: [a] })).toEqual({ masters: [a] });
    expect(cleanDeck({ masters: [] })).toEqual({});
  });

  it("finds a slide's master, falling back to the first", () => {
    expect(masterOf([], { transition: "none", build: "none" })).toBeUndefined();
    expect(masterOf([a, b], { transition: "none", build: "none", master: "b" })).toBe(b);
    expect(masterOf([a, b], { transition: "none", build: "none", master: "gone" })).toBe(a);
    expect(masterOf([a, b], undefined)).toBe(a);
    expect(baseFrame(b)).toEqual(b.main);
    expect(baseFrame(undefined)).toEqual(MAIN_FRAME);
  });

  it("counts the slides that use a master", () => {
    const anim = [{ transition: "none" as const, build: "none" as const, master: "b" }];
    expect(masterUsage([a, b], anim, 3, "a")).toBe(2);
    expect(masterUsage([a, b], anim, 3, "b")).toBe(1);
  });

  it("uses the master's background unless the slide has its own", () => {
    const deck = { masters: [a, b] };
    expect(slideColors(deck, { transition: "none", build: "none", master: "b" }).bg).toBe("#141414");
    expect(slideColors(deck, { transition: "none", build: "none", master: "b" }).text).toBe("#f5f5f5");
    expect(slideColors(deck, { transition: "none", build: "none", master: "b", bg: "#ffffff" }).bg).toBe("#ffffff");
    expect(slideColors(deck, { transition: "none", build: "none", master: "b" }, null).bg).toBe("#ffffff");
  });

  it("adds, duplicates, reorders and removes masters", () => {
    const list = insertMaster([a, b], { id: "c", name: "C" }, "a");
    expect(list.map((m) => m.id)).toEqual(["a", "c", "b"]);
    const d = duplicateMaster(list, "b");
    expect(d.masters.map((m) => m.name)).toEqual(["Default", "C", "Dark", "Dark copy"]);
    expect(d.copy!.boxes![0].id).not.toBe("x");
    expect(makeDefault(list, "b").map((m) => m.id)).toEqual(["b", "a", "c"]);
    expect(moveMaster(list, "a", 3).map((m) => m.id)).toEqual(["c", "b", "a"]);
    expect(moveMaster(list, "b", 0).map((m) => m.id)).toEqual(["b", "a", "c"]);
    expect(removeMaster(list, "c").map((m) => m.id)).toEqual(["a", "b"]);
    expect(uniqueName([a, { id: "q", name: "Default 2" }], "Default")).toBe("Default 3");
  });

  it("edits a master through the slide canvas's settings", () => {
    const meta = masterAsMeta(b);
    expect(meta).toMatchObject({ bg: "#141414", main: b.main, boxes: b.boxes });
    const moved = metaIntoMaster(b, { ...meta, main: MAIN_FRAME, boxes: [] });
    expect(moved).toEqual({ id: "b", name: "Dark", bg: "#141414" });
    expect(updateMaster([a, b], "a", (m) => ({ ...m, noFoot: true, boxes: [] }))[0]).toEqual({ id: "a", name: "Default", noFoot: true });
  });

  it("makes masters from presets", () => {
    expect(presetMaster("blank", "M")).toMatchObject({ name: "M" });
    expect(presetMaster("blank", "M").boxes).toBeUndefined();
    const side = presetMaster("side", "Side");
    expect(side.boxes).toHaveLength(1);
    expect(side.main!.x).toBeGreaterThan(side.boxes![0].w);
  });

  it("keeps a slide's master in its settings", () => {
    expect(cleanAnim([{ master: "b" }, { master: 3 }])).toEqual([{ transition: "none", build: "none", master: "b" }]);
    expect(trimAnim([{ transition: "none", build: "none", master: "b" }])).toHaveLength(1);
    expect(animInsert([{ transition: "none", build: "none", master: "b" }], 0)[1].master).toBe("b");
  });
});
