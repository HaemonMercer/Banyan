import { describe, expect, it } from "vitest";
import {
  activeDoc,
  cleanPanes,
  closeGroup,
  closeTab,
  cycleTab,
  focusGroup,
  groupsOf,
  MAX_GROUPS,
  moveTab,
  nextDoc,
  onePane,
  openDoc,
  openDocs,
  openToSide,
  parsePanes,
  pinTab,
  reopenTab,
  resizeSplit,
  splitGroup,
  type PaneNode,
  type Panes,
} from "./panes";

const all = () => true;
/** 版面的簡寫：群組是分頁用逗號接起來（作用中的加 *、預覽的加 ~），分割是 row(...)／col(...) */
function shape(node: PaneNode): string {
  if (node.type === "group") return node.tabs.map((t) => `${t}${node.active === t ? "*" : ""}${node.preview === t ? "~" : ""}`).join(",");
  return `${node.dir}(${node.children.map(shape).join(" | ")})`;
}
const tabsOf = (...ids: string[]) => ids.reduce((p, id) => openDoc(p, id), onePane(ids[0]));

describe("Dock 的分割視窗（編輯器群組）", () => {
  it("打開文件：插在作用中分頁後面；已經開著就換過去", () => {
    let p = tabsOf("a", "b", "c");
    expect(shape(p.root)).toBe("a,b,c*");
    p = openDoc(openDoc(p, "a"), "d");
    expect(shape(p.root)).toBe("a,d*,b,c");
    expect(openDoc(p, "d")).toBe(p);
  });

  it("預覽分頁：下次預覽打開時被取代，編輯（pinTab）或固定打開後留下", () => {
    let p = openDoc(onePane("a"), "b", { preview: true });
    expect(shape(p.root)).toBe("a,b*~");
    p = openDoc(p, "c", { preview: true });
    expect(shape(p.root)).toBe("a,c*~");
    p = pinTab(p, "c");
    p = openDoc(p, "d", { preview: true });
    expect(shape(p.root)).toBe("a,c,d*~");
    // 固定打開已經是預覽的分頁：變成固定的
    expect(shape(openDoc(p, "d").root)).toBe("a,c,d*");
    expect(pinTab(p, "a")).toBe(p);
  });

  it("分割：好幾個分頁時把作用中分頁搬到新群組；只有一個時開清單上下一份", () => {
    let p = tabsOf("a", "b");
    p = splitGroup(p, "right", nextDoc(p, ["a", "b", "c"]));
    expect(shape(p.root)).toBe("row(a* | b*)");
    expect(activeDoc(p)).toBe("b");
    p = splitGroup(p, "down", nextDoc(p, ["a", "b", "c"]));
    expect(shape(p.root)).toBe("row(a* | col(b* | c*))");
    // 都開著了：不能再分割
    expect(splitGroup(p, "right", nextDoc(p, ["a", "b", "c"]))).toBe(p);
  });

  it("同方向的分割排在同一層，分掉那個群組一半的大小", () => {
    let p = splitGroup(onePane("a"), "right", "b");
    p = splitGroup(p, "right", "c");
    expect(shape(p.root)).toBe("row(a* | b* | c*)");
    expect(p.root.type === "split" && p.root.sizes).toEqual([0.5, 0.25, 0.25]);
    p = splitGroup(focusGroup(p, groupsOf(p.root)[0].id), "left", "d");
    expect(shape(p.root)).toBe("row(d* | a* | b* | c*)");
  });

  it("群組數有上限：分割改成放進那個群組", () => {
    let p = onePane("x0");
    for (let i = 1; i < MAX_GROUPS + 2; i++) p = splitGroup(p, "right", `x${i}`);
    expect(groupsOf(p.root)).toHaveLength(MAX_GROUPS);
    expect(moveTab(p, "z", { group: p.focus, side: "down" }).root).toEqual(moveTab(p, "z", { group: p.focus }).root);
  });

  it("拖分頁：排順序、搬到別的群組、拖到一邊分割；群組空了就拿掉", () => {
    let p = tabsOf("a", "b", "c");
    const g1 = p.focus;
    p = moveTab(p, "c", { group: g1, index: 0 });
    expect(shape(p.root)).toBe("c*,a,b");
    p = moveTab(p, "a", { group: g1, side: "down" });
    expect(shape(p.root)).toBe("col(c*,b | a*)");
    const g2 = p.focus;
    p = moveTab(p, "b", { group: g2, index: 0 });
    expect(shape(p.root)).toBe("col(c* | b*,a)");
    // 群組只有它自己：拖到自己的一邊不動
    const top = groupsOf(p.root)[0].id;
    expect(moveTab(p, "c", { group: top, side: "right" })).toBe(p);
    // 最後一個分頁搬走：群組拿掉，焦點跟著分頁
    p = moveTab(p, "c", { group: g2 });
    expect(shape(p.root)).toBe("b,c*,a");
    expect(p.focus).toBe(g2);
  });

  it("從清單拖進來：還沒開的文件直接開在那裡", () => {
    const p = moveTab(onePane("a"), "b", { group: "g1", side: "right" });
    expect(shape(p.root)).toBe("row(a* | b*)");
    expect(shape(moveTab(onePane("a"), "b", { group: "g1", index: 0 }).root)).toBe("b*,a");
  });

  it("在旁邊打開：放進右邊的群組，沒有就分割", () => {
    let p = openToSide(onePane("a"), "b");
    expect(shape(p.root)).toBe("row(a* | b*)");
    p = openToSide(focusGroup(p, "g1"), "c");
    expect(shape(p.root)).toBe("row(a* | b,c*)");
    // 已經開在別的群組：換過去
    expect(openToSide(focusGroup(p, "g1"), "b").focus).toBe(groupsOf(p.root)[1].id);
  });

  it("關分頁：作用中換成旁邊的；群組空了就拿掉；最後一個不能關；重新打開放回原來的地方", () => {
    let p = tabsOf("a", "b", "c");
    p = closeTab(openDoc(p, "b"), "b");
    expect(shape(p.root)).toBe("a,c*");
    p = splitGroup(p, "right", null);
    expect(shape(p.root)).toBe("row(a* | c*)");
    p = closeTab(p, "c");
    expect(shape(p.root)).toBe("a*");
    expect(closeTab(p, "a")).toBe(p);
    p = reopenTab(p, all);
    expect(shape(p.root)).toBe("a,c*");
    p = reopenTab(p, all);
    expect(shape(p.root)).toBe("a,b*,c");
    expect(reopenTab(p, all)).toBe(p);
    // 重新打開時已經刪掉的跳過
    const q = closeTab(p, "b");
    expect(reopenTab(q, (id) => id !== "b").closed).toEqual([]);
  });

  it("關群組、切換分頁", () => {
    let p = splitGroup(tabsOf("a", "b", "c"), "right", null);
    expect(shape(p.root)).toBe("row(a,b* | c*)");
    expect(shape(cycleTab(focusGroup(p, "g1"), 1).root)).toBe("row(a*,b | c*)");
    p = closeGroup(p, "g1");
    expect(shape(p.root)).toBe("c*");
    expect(p.closed.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("改大小：兩邊都有最小比例", () => {
    const p = splitGroup(onePane("a"), "right", "b");
    const id = p.root.type === "split" ? p.root.id : "";
    const q = resizeSplit(p, id, 0, 0.7);
    expect(q.root.type === "split" && q.root.sizes.map((s) => Math.round(s * 100))).toEqual([70, 30]);
    expect(resizeSplit(q, id, 0, 0.99).root.type === "split" && (resizeSplit(q, id, 0, 0.99).root as { sizes: number[] }).sizes[1]).toBeCloseTo(0.1);
    expect(resizeSplit(q, id, 1, 0.5)).toBe(q);
  });

  it("整理：刪掉的文件、重複的分頁、空群組；什麼都沒開時開 fallback", () => {
    let p = splitGroup(tabsOf("a", "b"), "right", null);
    p = { ...p, root: { ...p.root, children: [...(p.root as { children: PaneNode[] }).children] } as PaneNode };
    const c = cleanPanes(p, (id) => id !== "b", "a");
    expect(shape(c.root)).toBe("a*");
    expect(groupsOf(c.root).some((g) => g.id === c.focus)).toBe(true);
    expect(shape(cleanPanes(p, () => false, null).root)).toBe("");
    expect(shape(cleanPanes(onePane(null), all, "z").root)).toBe("z*");
  });

  it("讀回存檔：新格式照舊；舊格式（一排窗格）轉成一排群組", () => {
    const p: Panes = splitGroup(splitGroup(tabsOf("a", "b"), "right", null), "down", "c");
    const back = parsePanes(JSON.parse(JSON.stringify(p)))!;
    expect(back).toEqual(p);
    // 之後新增的群組不會撞名
    const more = splitGroup(back, "right", "d");
    expect(new Set(groupsOf(more.root).map((g) => g.id)).size).toBe(4);
    const old = parsePanes({ docs: ["a", "b"], sizes: [0.3, 0.7], focus: 1, closed: [{ id: "c", at: 0, size: 0.5 }] })!;
    expect(shape(old.root)).toBe("row(a* | b*)");
    expect(old.root.type === "split" && old.root.sizes).toEqual([0.3, 0.7]);
    expect(activeDoc(old)).toBe("b");
    expect(openDocs(old)).toEqual(["a", "b"]);
    expect(parsePanes(null)).toBeNull();
    expect(parsePanes({ root: { type: "nope" } })).toBeNull();
  });
});
