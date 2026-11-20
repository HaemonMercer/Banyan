// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { BOARD, markInline, partKey, partVersions } from "./Preview";
import { emptyFile, type DeskFile } from "../desk/file";

describe("markInline", () => {
  it("wraps added words and inserts deleted ones", () => {
    expect(markInline("<p>the slow fox</p>", "the quick fox")).toBe(
      '<p>the <del class="vh-del">quick</del><ins class="vh-ins">slow</ins> fox</p>',
    );
  });
  it("works across inline elements", () => {
    expect(markInline("<p>a <strong>bold</strong> move</p>", "a move")).toBe(
      '<p>a <strong><ins class="vh-ins">bold</ins></strong><ins class="vh-ins"> </ins>move</p>',
    );
  });
  it("puts deletions at the end", () => {
    expect(markInline("<p>keep</p>", "keep this")).toBe('<p>keep<del class="vh-del"> this</del></p>');
  });
  it("escapes deleted text", () => {
    expect(markInline("<p>x</p>", "x <b>")).toContain("&lt;b&gt;");
  });
  it("leaves unchanged blocks alone", () => {
    expect(markInline("<p>same</p>", "same")).toBe("<p>same</p>");
  });
});

describe("partVersions", () => {
  const file = (docs: DeskFile["docs"], cards = 0): DeskFile => ({
    ...emptyFile(),
    board: { ...emptyFile().board, cards: Array.from({ length: cards }, (_, i) => ({ id: `c${i}`, ref: { kind: "note" as const }, x: 0, y: 0, w: 240, h: null, color: null, text: "" })) },
    docs,
  });
  const doc = (id: string, content: string) => ({ id, title: id, kind: "note" as const, content });
  const files = [
    file([doc("a", "1")]),
    file([doc("a", "1"), doc("b", "x")]),
    file([doc("a", "2"), doc("b", "x")], 1),
    file([doc("a", "2"), doc("b", "y")], 1),
    file([doc("b", "y")], 2),
  ];
  const ids = (part: string) => partVersions(files.map((f, i) => ({ i, f })), (x) => x.f, part).map((x) => x.i);
  it("keeps only the versions where that document changed", () => {
    expect(ids("a")).toEqual([0, 2]);
    expect(ids("b")).toEqual([1, 3]);
    expect(ids(BOARD)).toEqual([0, 2, 4]);
  });
  it("fingerprints a part", () => {
    expect(partKey(files[0], "zzz")).toBeNull();
    expect(partKey(files[0], "a")).not.toBe(partKey(files[2], "a"));
  });
});
