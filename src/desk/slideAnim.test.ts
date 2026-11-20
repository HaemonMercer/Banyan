// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { addDoc, emptyFile, insertSlides, joinSlides, parseFile, serializeFile, splitSlides, updateDoc } from "./file";
import { buildUnits } from "./SlideDeck";
import { animAt, animDuplicate, animSplice, sameAnim, animInsert, animRemove, animReorder, cleanAnim, NO_ANIM, setAnim, trimAnim, type SlideAnim } from "./slideAnim";

const A = (transition: SlideAnim["transition"], build: SlideAnim["build"] = "none"): SlideAnim => ({ transition, build });
const names = (l: SlideAnim[]) => l.map((a) => a.transition);

describe("簡報動畫", () => {
  it("改一張、好幾張；結尾沒有動畫的不存", () => {
    let l = setAnim([], [2], { transition: "fade" });
    expect(names(l)).toEqual(["none", "none", "fade"]);
    l = setAnim(l, [0, 1], { build: "rise" });
    expect(l.map((a) => a.build)).toEqual(["rise", "rise", "none"]);
    expect(setAnim(l, [2], { transition: "none" })).toHaveLength(2);
    expect(trimAnim([NO_ANIM, NO_ANIM])).toEqual([]);
    expect(animAt([], 5)).toEqual(NO_ANIM);
  });

  it("跟著投影片插入、刪除、複製、重排", () => {
    const l = [A("fade"), A("push"), A("wipe")];
    expect(names(animInsert(l, 1))).toEqual(["fade", "none", "push", "wipe"]);
    expect(names(animInsert(l, 3))).toEqual(["fade", "push", "wipe"]);
    expect(names(animRemove(l, [0, 2]))).toEqual(["push"]);
    // 跟 duplicateSlides 一樣，複本接在最後一張選取的後面
    expect(names(animDuplicate(l, [2, 0], 4))).toEqual(["fade", "push", "wipe", "fade", "wipe"]);
    expect(names(animDuplicate([A("zoom")], [0], 3))).toEqual(["zoom", "zoom"]);
    expect(names(animReorder(l, [2, 0, 1]))).toEqual(["wipe", "fade", "push"]);
  });

  it("存檔寫成 anim，讀回來一樣；壞掉的值當成沒有動畫", () => {
    let f = addDoc(emptyFile(), "slides").file;
    const id = f.docs[0].id;
    const plain = serializeFile(f);
    expect(JSON.parse(plain).docs[0].anim).toBeUndefined();
    f = updateDoc(f, id, { anim: [A("fade", "rise"), NO_ANIM] });
    const saved = JSON.parse(serializeFile(f));
    expect(saved.docs[0].anim).toEqual([A("fade", "rise")]);
    expect(parseFile(serializeFile(f)).docs[0].anim).toEqual([A("fade", "rise")]);
    expect(cleanAnim([{ transition: "spin", build: "fade" }, 3, null])).toEqual([A("none", "fade")]);
    expect(cleanAnim("x")).toEqual([]);
  });

  it("逐項顯示的單位：開頭的標題不算，清單一項一項", () => {
    const el = document.createElement("div");
    el.innerHTML = "<h2>T</h2><p>a</p><ul><li>1</li><li>2</li></ul><h3>S</h3>";
    expect(buildUnits(el).map((u) => u.textContent)).toEqual(["a", "1", "2", "S"]);
    el.innerHTML = "<p>x</p><ol><li>1</li></ol>";
    expect(buildUnits(el).map((u) => u.textContent)).toEqual(["x", "1"]);
  });
});

describe("匯出 .pptx 的轉場", () => {
  it("加在 clrMapOvr 後面；沒有轉場不動", async () => {
    const { withTransition } = await import("./export");
    const xml = "<p:sld><p:cSld/><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>";
    expect(withTransition(xml, "fade")).toBe(
      '<p:sld><p:cSld/><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr><p:transition spd="med"><p:fade/></p:transition></p:sld>',
    );
    expect(withTransition(xml, "none")).toBe(xml);
    expect(withTransition("<p:sld><p:timing/></p:sld>", "push")).toBe('<p:sld><p:transition spd="med"><p:push dir="l"/></p:transition><p:timing/></p:sld>');
  });
});

describe("貼上投影片", () => {
  it("插入好幾張投影片與它們的動畫", () => {
    const md = joinSlides(["A", "B"]);
    expect(splitSlides(insertSlides(md, 1, ["X", "Y"]))).toEqual(["A", "X", "Y", "B"]);
    expect(names(animSplice([A("fade"), A("push")], 1, [A("zoom"), NO_ANIM]))).toEqual(["fade", "zoom", "none", "push"]);
    expect(names(animSplice([], 2, [A("wipe")]))).toEqual(["none", "none", "wipe"]);
    expect(sameAnim([A("fade"), NO_ANIM], [A("fade")])).toBe(true);
    expect(sameAnim([A("fade")], [A("push")])).toBe(false);
  });
});
