import { describe, expect, it } from "vitest";
import { hexToHsv, hsvToHex, isHex, parseHex, STANDARD_COLORS, withRecent, type Hex } from "./ColorPicker";
import { inkCss } from "./inline";

describe("自訂顏色", () => {
  it("使用者打的色碼", () => {
    expect(parseHex("#ABC")).toBe("#aabbcc");
    expect(parseHex(" 12ab9F ")).toBe("#12ab9f");
    expect(parseHex("#12345")).toBeNull();
    expect(parseHex("red")).toBeNull();
  });

  it("HSV 與色碼互換", () => {
    expect(hsvToHex(0, 1, 1)).toBe("#ff0000");
    expect(hsvToHex(120, 1, 1)).toBe("#00ff00");
    expect(hsvToHex(0, 0, 1)).toBe("#ffffff");
    expect(hsvToHex(0, 0, 0)).toBe("#000000");
    for (const c of ["#2f7fd8", "#aa3366", "#f3e9d6", "#123456"] as Hex[]) {
      const { h, s, v } = hexToHsv(c);
      expect(hsvToHex(h, s, v)).toBe(c);
    }
  });

  it("最近用過：新的放前面、不重複、最多 8 個", () => {
    const list = ["#000001", "#000002"] as Hex[];
    expect(withRecent(list, "#000002")).toEqual(["#000002", "#000001"]);
    let many: Hex[] = [];
    for (let i = 0; i < 10; i++) many = withRecent(many, `#00000${i}` as Hex);
    expect(many).toHaveLength(8);
    expect(many[0]).toBe("#000009");
  });

  it("標準色：十欄四列、都是不重複的小寫色碼", () => {
    expect(STANDARD_COLORS).toHaveLength(40);
    expect(new Set(STANDARD_COLORS).size).toBe(40);
    expect(STANDARD_COLORS.every((c) => isHex(c) && c === c.toLowerCase())).toBe(true);
  });

  it("色盤顏色的 CSS：文字用 --tc-*，螢光與背景用 --bg-*", () => {
    expect(inkCss("tc", "red")).toBe("var(--tc-red)");
    expect(inkCss("hl", "red")).toBe("var(--bg-red)");
    expect(inkCss("bg", "#AABBCC")).toBe("#AABBCC");
  });
});
