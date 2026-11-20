import { describe, expect, it } from "vitest";
import {
  copyName,
  emptyIndex,
  groupByDay,
  MAX_UNNAMED,
  nameVersion,
  parseIndex,
  prune,
  recordVersion,
  serializeIndex,
  SESSION_GAP,
  SESSION_MAX,
  versionTime,
  type Version,
} from "./versions";
import { diffBlocks, diffSeq, diffText, similarity, words } from "./diff";
import { localHistoryFiles, VersionLog } from "./store";

const MIN = 60_000;

describe("recordVersion", () => {
  it("starts a version, then merges saves in the same session", () => {
    const a = recordVersion(emptyIndex(), "one", 1000);
    expect(a.index.versions).toHaveLength(1);
    expect(a.write).toEqual([{ id: a.index.versions[0].id, content: "one" }]);
    const b = recordVersion(a.index, "one two", 1000 + 2 * MIN, { latest: "one" });
    expect(b.index.versions).toHaveLength(1);
    expect(b.index.versions[0].at).toBe(1000 + 2 * MIN);
    expect(b.index.versions[0].start).toBe(1000);
    expect(b.write[0].content).toBe("one two");
  });

  it("opens a new version after a pause or a long session", () => {
    const a = recordVersion(emptyIndex(), "one", 0).index;
    expect(recordVersion(a, "two", SESSION_GAP + 1, { latest: "one" }).index.versions).toHaveLength(2);
    let ix = a;
    let t = 0;
    while (t < SESSION_MAX) {
      t += 5 * MIN;
      ix = recordVersion(ix, `v${t}`, t).index;
    }
    expect(ix.versions.length).toBe(2);
  });

  it("ignores saves that didn't change anything", () => {
    const a = recordVersion(emptyIndex(), "one", 0).index;
    expect(recordVersion(a, "one", 20 * MIN, { latest: "one" }).changed).toBe(false);
  });

  it("keeps the content from before the first recorded save", () => {
    const r = recordVersion(emptyIndex(), "new", 5000, { prev: "old" });
    expect(r.index.versions).toHaveLength(2);
    expect(r.index.versions[0].base).toBe(true);
    expect(r.write.map((w) => w.content)).toEqual(["old", "new"]);
  });

  it("never merges into named or restored versions", () => {
    let ix = recordVersion(emptyIndex(), "one", 0).index;
    ix = nameVersion(ix, ix.versions[0].id, "Draft");
    ix = recordVersion(ix, "two", MIN, { latest: "one" }).index;
    expect(ix.versions).toHaveLength(2);
    ix = recordVersion(ix, "one", 2 * MIN, { latest: "two", restored: 0 }).index;
    expect(ix.versions).toHaveLength(3);
    expect(ix.versions[2].restored).toBe(0);
    ix = recordVersion(ix, "three", 3 * MIN, { latest: "one" }).index;
    expect(ix.versions).toHaveLength(4);
  });

  it("drops the oldest unnamed versions over the limit", () => {
    const vs: Version[] = Array.from({ length: MAX_UNNAMED + 3 }, (_, i) => ({ id: `v${i}`, at: i, start: i, name: i === 1 ? "keep" : undefined }));
    const { kept, removed } = prune(vs);
    expect(kept.length).toBe(MAX_UNNAMED + 1);
    expect(removed).toEqual(["v0", "v2"]);
    expect(kept.some((v) => v.name === "keep")).toBe(true);
  });

  it("names and unnames", () => {
    let ix = recordVersion(emptyIndex(), "one", 0).index;
    const id = ix.versions[0].id;
    ix = nameVersion(ix, id, "  First  ");
    expect(ix.versions[0].name).toBe("First");
    expect(nameVersion(ix, id, "").versions[0].name).toBeUndefined();
  });

  it("round-trips the index and drops bad entries", () => {
    const ix = { versions: [{ id: "a1", at: 5, start: 3, name: "n", restored: 1 }, { id: "b2", at: 2, start: 2, base: true }] };
    const back = parseIndex(serializeIndex(ix));
    expect(back.versions.map((v) => v.id)).toEqual(["b2", "a1"]);
    expect(parseIndex('{"versions":[{"id":"../x","at":1}]}').versions).toEqual([]);
    expect(parseIndex("nope").versions).toEqual([]);
  });
});

describe("display", () => {
  const now = new Date(2026, 10, 19, 16, 0).getTime();
  it("formats times like Google Docs", () => {
    expect(versionTime(new Date(2026, 10, 19, 15, 5).getTime(), now)).toBe("November 19, 3:05 PM");
    expect(versionTime(new Date(2025, 0, 2, 0, 30).getTime(), now)).toBe("January 2, 2025, 12:30 AM");
  });
  it("groups by day, newest first", () => {
    const at = (d: number, h: number) => ({ at: new Date(2026, 10, d, h).getTime() });
    const g = groupByDay([at(17, 9), at(19, 9), at(18, 9), at(19, 10)], now);
    expect(g.map((x) => x.label)).toEqual(["Today", "Yesterday", "November 17"]);
    expect(g[0].items[0].at).toBeGreaterThan(g[0].items[1].at);
  });
  it("names copies", () => {
    expect(copyName("Plan", () => false)).toBe("Plan (copy)");
    expect(copyName("Plan", (n) => n === "Plan (copy)")).toBe("Plan (copy 2)");
  });
});

describe("diff", () => {
  it("diffs sequences", () => {
    const ops = diffSeq(["a", "b", "c"], ["a", "x", "c"]).map((o) => o.op);
    expect(ops).toEqual(["same", "del", "add", "same"]);
  });
  it("splits CJK by character", () => {
    expect(words("今天 hello, world")).toEqual(["今", "天", " ", "hello", ",", " ", "world"]);
  });
  it("diffs text into parts", () => {
    expect(diffText("the quick fox", "the slow fox")).toEqual([
      { op: "same", text: "the " },
      { op: "del", text: "quick" },
      { op: "add", text: "slow" },
      { op: "same", text: " fox" },
    ]);
    expect(diffText("今天很好", "今天不好")).toEqual([
      { op: "same", text: "今天" },
      { op: "del", text: "很" },
      { op: "add", text: "不" },
      { op: "same", text: "好" },
    ]);
  });
  it("measures similarity", () => {
    expect(similarity("a b c d", "a b c e")).toBeCloseTo(0.75);
    expect(similarity("x", "")).toBe(0);
  });
  it("pairs edited blocks as changes", () => {
    const ops = diffBlocks(["# Title", "Some text here", "Gone"], ["# Title", "New block", "Some text there"], (s) => s);
    expect(ops.map((o) => o.op)).toEqual(["same", "add", "change", "del"]);
  });
});

describe("VersionLog", () => {
  const mem = () => {
    const m = new Map<string, string>();
    const storage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    } as unknown as Storage;
    return { m, files: localHistoryFiles(storage) };
  };

  it("records, merges, names and reads versions", async () => {
    const { m, files } = mem();
    let t = 1_000_000;
    const log = new VersionLog("pages", files, () => t);
    await log.record("Plan", "v1", "v0");
    t += MIN;
    await log.record("Plan", "v2");
    let vs = await log.list("Plan");
    expect(vs).toHaveLength(2);
    expect(vs[0].base).toBe(true);
    expect(await log.read("Plan", vs[1].id)).toBe("v2");
    await log.rename("Plan", vs[1].id, "Second");
    t += MIN;
    await log.record("Plan", "v3");
    vs = await log.list("Plan");
    expect(vs.map((v) => v.name)).toEqual([undefined, "Second", undefined]);
    // 一個新的 VersionLog 從檔案讀回來
    const again = new VersionLog("pages", files, () => t);
    expect((await again.list("Plan")).length).toBe(3);
    expect([...m.keys()].filter((k) => k.endsWith(".txt"))).toHaveLength(3);
  });

  it("marks restores and names the current version", async () => {
    const { files } = mem();
    let t = 0;
    const log = new VersionLog("desk", files, () => t);
    await log.record("F", "a");
    const first = (await log.list("F"))[0];
    log.markRestore("F", first.at);
    t += MIN;
    await log.record("F", "a");
    let vs = await log.list("F");
    expect(vs).toHaveLength(2);
    expect(vs[1].restored).toBe(first.at);
    await log.nameCurrent("F", "a", "Final");
    vs = await log.list("F");
    expect(vs).toHaveLength(2);
    expect(vs[1].name).toBe("Final");
    await log.nameCurrent("F", "a", "Again");
    expect((await log.list("F")).map((v) => v.name)).toEqual([undefined, "Again"]);
  });

  it("skips blank content", async () => {
    const { files } = mem();
    const log = new VersionLog("journals", files);
    await log.record("2026-11-19", "  \n");
    expect(await log.list("2026-11-19")).toEqual([]);
  });
});

describe("mergeChanges", () => {
  it("puts deleted blocks back where they were and marks lines", async () => {
    const { mergeChanges } = await import("./merge");
    const before = "# T\n\nkeep\n\ngone\n\nold text here\n";
    const after = "# T\n\nkeep\n\nnew text here\n\nadded\n";
    const m = mergeChanges(before, after);
    expect(m.source).toBe("# T\n\nkeep\n\ngone\n\nnew text here\n\nadded\n");
    expect(m.marks.map((x) => [x.line, x.op])).toEqual([
      [4, "del"],
      [6, "change"],
      [8, "add"],
    ]);
  });
  it("keeps deleted list items inside the list", async () => {
    const { mergeChanges } = await import("./merge");
    const m = mergeChanges("- a\n- b\n- c\n", "- a\n- c\n");
    expect(m.source).toBe("- a\n- b\n- c\n");
    expect(m.marks).toEqual([{ line: 1, op: "del" }]);
    expect(mergeChanges("- a\n- b\n", "- a\n").source).toBe("- a\n- b\n");
  });
  it("doesn't let a deleted paragraph join a list", async () => {
    const { mergeChanges } = await import("./merge");
    expect(mergeChanges("- a\n\npara\n\n- b\n", "- a\n- b\n").source).toBe("- a\n\npara\n\n- b\n");
  });
});
