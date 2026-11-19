import { describe, expect, it } from "vitest";
import { cjkPunct, cjkPunctText, inChinese, isCjk } from "./punct";

const t = (before: string, key: string) => cjkPunct(before, key)?.text ?? null;

describe("中文標點", () => {
  it("前一個字是中文才換", () => {
    expect(t("你好", ",")).toBe("，");
    expect(t("你好", ".")).toBe("。");
    expect(t("真的", "?")).toBe("？");
    expect(t("好", "!")).toBe("！");
    expect(t("如下", ":")).toBe("：");
    expect(t("第一", ";")).toBe("；");
    expect(t("hello", ",")).toBeNull();
    expect(t("1", ".")).toBeNull();
    expect(t("", ",")).toBeNull();
  });
  it("中文標點後面也算中文", () => {
    expect(t("好，", "(")).toBe("（");
    expect(t("說「", "?")).toBe("？");
  });
  it("。後面再打 . 變成刪節號", () => {
    expect(cjkPunct("然後。", ".")).toEqual({ text: "……", remove: 1 });
  });
  it("括號：開要在中文後面，關要有還開著的", () => {
    expect(t("備註", "(")).toBe("（");
    expect(t("備註（abc", ")")).toBe("）");
    expect(t("備註", ")")).toBeNull();
    expect(t("（a）b中", ")")).toBeNull();
  });
  it("引號依前面開著沒有決定開或關", () => {
    expect(t("他說", '"')).toBe("「");
    expect(t("他說「好", '"')).toBe("」");
    expect(t("他說「ok", '"')).toBe("」");
    expect(t("「好」中", '"')).toBe("「");
    expect(t("書名", "'")).toBe("『");
    expect(t("『書名", "'")).toBe("』");
    expect(t("abc", '"')).toBeNull();
  });
  it("isCjk", () => {
    expect(isCjk("中")).toBe(true);
    expect(isCjk("ㄅ")).toBe(true);
    expect(isCjk("あ")).toBe(true);
    expect(isCjk("，")).toBe(true);
    expect(isCjk("a")).toBe(false);
    expect(isCjk("1")).toBe(false);
  });
});

describe("一次輸入好幾個字", () => {
  it("逐字換，前面的字也算", () => {
    expect(cjkPunctText("", "好,")).toEqual({ text: "好，", remove: 0 });
    expect(cjkPunctText("你", ',他說"今天(晴)"..')).toEqual({ text: "，他說「今天（晴）」……", remove: 0 });
    expect(cjkPunctText("好。", ".")).toEqual({ text: "……", remove: 1 });
    expect(cjkPunctText("你", " ok, done.")).toEqual({ text: " ok， done。", remove: 0 });
    expect(cjkPunctText("Hi", " ok, done.")).toBeNull();
  });
});

describe("中文夾英文", () => {
  it("中文句子裡的英文後面也換", () => {
    expect(t("我在用 Banyan", ",")).toBe("，");
    expect(t("這是 React Native", ".")).toBe("。");
    expect(t("你知道 GitHub", "?")).toBe("？");
    expect(t("你好 ", ",")).toBe("，");
    expect(t("他用 Python，也用 Go", ",")).toBe("，");
    expect(t("版本 v1.2 很好用，我推薦 Banyan", "!")).toBe("！");
  });
  it("整句英文、另一句英文不換", () => {
    expect(t("Hello world", ",")).toBeNull();
    expect(t("好。Hello world", ",")).toBeNull();
    expect(t("我說 Hi. Then", ",")).toBeNull();
    expect(t("第一行\nHello", ",")).toBeNull();
  });
  it("數字後面的 . , : 不換（小數、千分位、時間）", () => {
    expect(t("價格 3", ".")).toBeNull();
    expect(t("共 1", ",")).toBeNull();
    expect(t("下午 14", ":")).toBeNull();
    expect(t("第 3", "?")).toBe("？");
  });
  it("網址、路徑、Email 不換", () => {
    expect(t("網址 https", ":")).toBeNull();
    expect(t("看 https://example", ".")).toBeNull();
    expect(t("寄到 me@mail", ".")).toBeNull();
    expect(t("在 src/editor", ".")).toBeNull();
  });
  it("英文字後面的引號、括號不換開", () => {
    expect(t("我覺得 it", "'")).toBeNull();
    expect(t("函式 f", "(")).toBeNull();
    expect(t("他說 ", '"')).toBe("「");
    expect(t("他說「Hello", '"')).toBe("」");
  });
  it("inChinese", () => {
    expect(inChinese("我在用 Banyan")).toBe(true);
    expect(inChinese("Banyan")).toBe(false);
    expect(inChinese("")).toBe(false);
  });
});
