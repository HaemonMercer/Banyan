// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { assistText, DEFAULT_TYPING, inEnglish, sentenceStart, setTypingPref, typingPrefs, type TypingPrefs } from "./typing";

const ALL: TypingPrefs = { cjkPunct: true, enPunct: true, capitalize: true, spacing: true };
const go = (before: string, data: string, p: TypingPrefs = DEFAULT_TYPING) => assistText(before, data, p)?.text ?? null;

describe("英文標點（英文句子裡的中文標點換回半形）", () => {
  it("英文句子裡換", () => {
    expect(go("Hello world", "，")).toBe(",");
    expect(go("It works", "。")).toBe(".");
    expect(go("Really", "？")).toBe("?");
    expect(go("Note", "：")).toBe(":");
    expect(go("call ", "（")).toBe("(");
    expect(go("say ", "「")).toBe('"');
  });
  it("中文句子裡、中文夾英文不換", () => {
    expect(go("你好", "，")).toBeNull();
    expect(go("我在用 Banyan", "，")).toBeNull();
    expect(go("", "，")).toBeNull();
  });
  it("前一句是中文、這句是英文", () => {
    expect(go("好的。Then we go", "，")).toBe(",");
  });
});

describe("句首大寫", () => {
  it("區塊開頭與英文句尾後面", () => {
    expect(go("", "h")).toBe("H");
    expect(go("It works. ", "t")).toBe("T");
    expect(go("Really? ", "y")).toBe("Y");
    expect(go("Wow! ", "a")).toBe("A");
  });
  it("句子中間、縮寫、編號、中文後面不換", () => {
    expect(go("It works", "t")).toBeNull();
    expect(go("For example, e.g. ", "t")).toBeNull();
    expect(go("Ask Mr. ", "s")).toBeNull();
    expect(go("Step 3. ", "t")).toBeNull();
    expect(go("好的. ", "t")).toBeNull();
    expect(go("example.", "c")).toBeNull();
  });
  it("單獨的 i 換成 I", () => {
    expect(go("so i", " ")).toBe("I ");
    expect(go("i", "'")).toBe("I'");
    expect(go("Hi", " ")).toBeNull();
    expect(go("Wi", ",")).toBeNull();
  });
  it("整串輸入逐字處理", () => {
    expect(go("", "hello world. this is fine")).toBe("Hello world. This is fine");
  });
});

describe("中英之間加空格", () => {
  it("中文後面打英文、英文後面打中文", () => {
    expect(go("我用", "B", ALL)).toBe(" B");
    expect(go("用 Banyan", "寫", ALL)).toBe(" 寫");
    expect(go("第", "3", ALL)).toBe(" 3");
    expect(go("我用", "Banyan寫", ALL)).toBe(" Banyan 寫");
  });
  it("標點、已經有空格不加；預設關", () => {
    expect(go("我用，", "B", ALL)).toBeNull();
    expect(go("我用 ", "B", ALL)).toBeNull();
    expect(go("我用", "B")).toBeNull();
  });
});

describe("中文標點仍照舊", () => {
  it("中文句子裡的半形標點", () => {
    expect(go("你好", ",")).toBe("，");
    expect(go("你好", ",", { ...DEFAULT_TYPING, cjkPunct: false })).toBeNull();
  });
});

describe("判斷", () => {
  it("inEnglish", () => {
    expect(inEnglish("Hello world")).toBe(true);
    expect(inEnglish("我用 Banyan")).toBe(false);
    expect(inEnglish("123")).toBe(false);
  });
  it("sentenceStart", () => {
    expect(sentenceStart("")).toBe(true);
    expect(sentenceStart("Done. ")).toBe(true);
    expect(sentenceStart("Done.")).toBe(false);
  });
});

describe("設定", () => {
  beforeEach(() => localStorage.clear());
  it("預設值與舊設定", () => {
    expect(typingPrefs()).toEqual(DEFAULT_TYPING);
    localStorage.setItem("banyan.cjkPunct", "off");
    expect(typingPrefs().cjkPunct).toBe(false);
    setTypingPref("spacing", true);
    expect(typingPrefs()).toEqual({ ...DEFAULT_TYPING, cjkPunct: false, spacing: true });
    expect(localStorage.getItem("banyan.cjkPunct")).toBeNull();
  });
});
