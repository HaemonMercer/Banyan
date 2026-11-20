import { describe, expect, it } from "vitest";
import cangjieText from "./predict/cangjie.txt?raw";
import phraseText from "./predict/phrases.txt?raw";
import englishText from "./predict/english.txt?raw";
import nextText from "./predict/english-next.txt?raw";
import {
  codeRadicals,
  compositionCode,
  maxCode,
  pageCount,
  pageItems,
  countPairs,
  countWords,
  parseNextWords,
  predictAfter,
  wordAfter,
  parseChars,
  parsePhrases,
  parseWords,
  predictChars,
  predictNext,
  predictWords,
  quickCode,
  wordBefore,
} from "./predict";

const chars = parseChars(cangjieText);
const phrases = parsePhrases(phraseText);
const english = parseWords(englishText);

describe("compositionCode", () => {
  it("reads radicals and letters", () => {
    expect(compositionCode("日月")).toBe("ab");
    expect(compositionCode("竹手戈")).toBe("hqi");
    expect(compositionCode("hqi")).toBe("hqi");
    expect(compositionCode("ＨＱＩ")).toBe("hqi");
    expect(compositionCode("難卜")).toBe("xy");
  });
  it("gives up on anything else", () => {
    expect(compositionCode("我")).toBeNull();
    expect(compositionCode("ni3")).toBeNull();
    expect(compositionCode("")).toBeNull();
  });
  it("makes Quick codes", () => {
    expect(quickCode("hqi")).toBe("hi");
    expect(quickCode("ab")).toBe("ab");
  });
});

describe("predictChars", () => {
  it("puts exact Cangjie codes first, then longer codes by frequency", () => {
    const got = predictChars(chars, "hqi", "cangjie").map((p) => p.text);
    expect(got[0]).toBe("我");
    const a = predictChars(chars, "a", "cangjie").map((p) => p.text);
    expect(a[0]).toBe("日");
    expect(a).toContain("是"); // amyo：還沒打完碼也預測得到
  });
  it("uses first and last codes for Quick", () => {
    const got = predictChars(chars, "hi", "quick").map((p) => p.text);
    expect(got).toContain("我");
  });
  it("does not repeat a character", () => {
    const got = predictChars(chars, "h", "cangjie").map((p) => p.text);
    expect(new Set(got).size).toBe(got.length);
    expect(got.length).toBe(9);
  });
});

describe("predictNext", () => {
  it("continues a phrase from the last characters", () => {
    const got = predictNext(phrases, "我們明").map((p) => p.text);
    expect(got).toContain("天");
  });
  it("prefers the last two characters", () => {
    const tiny = new Map([
      ["天", ["天氣", "天空"]],
      ["明", ["明天見"]],
    ]);
    expect(predictNext(tiny, "明天").map((p) => p.text)).toEqual(["見", "氣", "空"]);
  });
  it("needs Chinese characters", () => {
    expect(predictNext(phrases, "hello")).toEqual([]);
    expect(predictNext(phrases, "，")).toEqual([]);
  });
});

describe("predictWords", () => {
  it("finds the word being typed", () => {
    expect(wordBefore("I am wri")).toBe("wri");
    expect(wordBefore("x")).toBe("x");
    expect(wordBefore("I am ")).toBeNull();
    expect(wordBefore("中文ab")).toBe("ab");
    expect(wordBefore("abc1")).toBeNull();
  });
  it("completes common words", () => {
    const got = predictWords(english, new Map(), "beca").map((p) => p.text);
    expect(got[0]).toBe("because");
  });
  it("puts the user's own words first and follows case", () => {
    const mine = countWords(["Banyan banyan banyan is a tree", "bandwidth"]);
    expect(predictWords(english, mine, "ban")[0].text).toBe("banyan");
    expect(predictWords(english, mine, "Ban")[0].text).toBe("Banyan");
    expect(predictWords(english, mine, "BAN")[0].text).toBe("BANYAN");
    expect(predictWords(english, mine, "ban").map((p) => p.text)).not.toContain("bandwidth");
  });
});

describe("predictAfter", () => {
  const common = parseNextWords(nextText);
  it("finds the word just finished", () => {
    expect(wordAfter("I want ")).toBe("want");
    expect(wordAfter("I don't ")).toBe("don't");
    expect(wordAfter("I want")).toBeNull();
    expect(wordAfter("I want  ")).toBeNull();
    expect(wordAfter("end. ")).toBeNull();
    expect(wordAfter("page3 ")).toBeNull();
  });
  it("suggests common next words", () => {
    expect(predictAfter(common, new Map(), "want")[0].text).toBe("to");
    expect(predictAfter(common, new Map(), "thank").map((p) => p.text)).toEqual(["you"]);
    expect(predictAfter(common, new Map(), "zebra")).toEqual([]);
  });
  it("puts what the user wrote first", () => {
    const mine = countPairs(["Banyan notes are local. banyan notes, Banyan app", "so I said"]);
    expect(predictAfter(common, mine, "banyan").map((p) => p.text)).toEqual(["notes", "app"]);
    expect(predictAfter(common, mine, "so")[0].text).toBe("I");
  });
});

describe("Banyan input pages", () => {
  it("splits candidates into pages of nine", () => {
    const all = predictChars(chars, "a", "cangjie", 90);
    expect(all.length).toBeGreaterThan(9);
    expect(pageCount(all.length)).toBe(Math.ceil(all.length / 9));
    expect(pageItems(all, 0)).toEqual(all.slice(0, 9));
    expect(pageItems(all, 1)[0]).toEqual(all[9]);
    expect(pageCount(0)).toBe(1);
  });
  it("limits code length", () => {
    expect(maxCode("cangjie")).toBe(5);
    expect(maxCode("quick")).toBe(2);
    expect(codeRadicals("hqi")).toBe("竹手戈");
  });
});
