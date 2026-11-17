import { describe, expect, it } from "vitest";
import { parseDoc } from "./markdown";
import {
  activate,
  applyText,
  backspaceAtStart,
  deactivate,
  deleteUnit,
  duplicateUnit,
  insertEmptyAfter,
  moveUnit,
  splitBlock,
  turnInto,
  type EditorState,
} from "./ops";

const st = (source: string, start?: number, end?: number, caret = 0): EditorState => ({
  source,
  region: start === undefined ? null : { start, end: end ?? start + 1 },
  caret,
});
const units = (source: string) => parseDoc(source).units;

describe("區塊切分", () => {
  it("清單的每個項目是一個區塊", () => {
    const u = units("# 標題\n\n- a\n- b\n\n1. x\n2. y\n");
    expect(u.map((x) => [x.kind, x.start, x.end])).toEqual([
      ["heading", 0, 1],
      ["item", 2, 3],
      ["item", 3, 4],
      ["item", 5, 6],
      ["item", 6, 7],
    ]);
    expect(u[4].list?.number).toBe(2);
  });

  it("連結參考定義成為原始碼區塊", () => {
    const u = units("[a]: /url\n\n[a]\n");
    expect(u.map((x) => x.kind)).toEqual(["source", "paragraph"]);
  });
});

describe("編輯", () => {
  it("只改編輯區那幾行，其他原始碼逐字保留", () => {
    const src = "foo  \nbar\n\n*  x\n\n```\ncode\n```\n";
    const s = applyText(st(src, 3, 4), "*  y", 4);
    expect(s.source).toBe("foo  \nbar\n\n*  y\n\n```\ncode\n```\n");
  });

  it("打開 ``` 後編輯區會涵蓋整個程式碼區塊", () => {
    const s = applyText(st("a\n\nb\n\nc\n", 0), "```", 3);
    expect(s.region).toEqual({ start: 0, end: 5 });
  });

  it("離開空的編輯區時把它刪掉", () => {
    const s = insertEmptyAfter(st("a\n\nb\n"), 1);
    expect(s.source).toBe("a\n\n\n\nb\n");
    expect(deactivate(s).state.source).toBe("a\n\nb\n");
  });

  it("在文件結尾新增後離開不留多餘空行", () => {
    const s = insertEmptyAfter(st("a\n"), 1);
    expect(s.source).toBe("a\n\n\n");
    expect(deactivate(s).state.source).toBe("a\n");
  });

  it("切換編輯區時，刪除空區塊後目標行號會位移", () => {
    const s = insertEmptyAfter(st("a\n\nb\n"), 1); // 空區塊在第 2 行，b 移到第 4 行
    const t = activate(s, { start: 4, end: 5 }, 0);
    expect(t.source).toBe("a\n\nb\n");
    expect(t.region).toEqual({ start: 2, end: 3 });
  });
});

describe("Enter", () => {
  it("段落中間切成兩個段落", () => {
    const s = splitBlock(st("hello world\n", 0, 1, 5), 5)!;
    expect(s.source).toBe("hello\n\nworld\n");
    expect(s.region).toEqual({ start: 2, end: 3 });
  });

  it("清單項目延續同一種標記與編號", () => {
    expect(splitBlock(st("- a\n- b\n", 0, 1), 3)!.source).toBe("- a\n- \n- b\n");
    const s = splitBlock(st("1. a\n", 0, 1), 4)!;
    expect(s.source).toBe("1. a\n2. \n");
    expect(s.caret).toBe(3);
  });

  it("空項目按 Enter 離開清單", () => {
    const s = splitBlock(st("- a\n- \n", 1, 2), 2)!;
    expect(s.source).toBe("- a\n\n\n");
    expect(s.region).toEqual({ start: 2, end: 3 });
  });

  it("程式碼區塊交給 textarea 換行", () => {
    expect(splitBlock(st("```\nx\n```\n", 0, 3), 5)).toBeNull();
  });
});

describe("Backspace", () => {
  it("先把標題變回段落，再與上一段合併", () => {
    const s = backspaceAtStart(st("a\n\n# b\n", 2))!;
    expect(s.source).toBe("a\n\nb\n");
    const t = backspaceAtStart(s)!;
    expect(t.source).toBe("ab\n");
    expect(t.caret).toBe(1);
  });

  it("空區塊刪除後回到上一個區塊結尾", () => {
    const s = backspaceAtStart(insertEmptyAfter(st("a\n"), 1))!;
    expect(s.source).toBe("a\n");
    expect(s.region).toEqual({ start: 0, end: 1 });
    expect(s.caret).toBe(1);
  });
});

describe("轉換類型", () => {
  it("段落與各種區塊互轉", () => {
    expect(turnInto("hi", "h2").text).toBe("## hi");
    expect(turnInto("## hi", "bullet").text).toBe("- hi");
    expect(turnInto("- a\n  b", "quote").text).toBe("> a\n> b");
    expect(turnInto("> a\n> b", "paragraph").text).toBe("a\nb");
    expect(turnInto("a ``` b", "code").text).toBe("````\na ``` b\n````");
    expect(turnInto("```\nx\n```", "paragraph").text).toBe("x");
  });
});

describe("區塊操作", () => {
  const src = "# t\n\npara\n\n- a\n- b\n- c\n";
  const u = units(src);

  it("刪除", () => {
    expect(deleteUnit(src, u[1])).toBe("# t\n\n- a\n- b\n- c\n");
    expect(deleteUnit(src, u[3])).toBe("# t\n\npara\n\n- a\n- c\n");
  });

  it("複製", () => {
    expect(duplicateUnit(src, u[2])).toBe("# t\n\npara\n\n- a\n- a\n- b\n- c\n");
    expect(duplicateUnit(src, u[0])).toBe("# t\n\n# t\n\npara\n\n- a\n- b\n- c\n");
  });

  it("拖曳搬移", () => {
    expect(moveUnit(src, u[4], u[2])).toBe("# t\n\npara\n\n- c\n- a\n- b\n");
    expect(moveUnit(src, u[0], null)).toBe("para\n\n- a\n- b\n- c\n\n# t\n");
    expect(moveUnit(src, u[1], u[0])).toBe("para\n\n# t\n\n- a\n- b\n- c\n");
  });
});
