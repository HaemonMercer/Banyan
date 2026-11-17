import { describe, expect, it } from "vitest";
import { stripTaskShortcut, stripTodoShortcut, taskShortcut, todoShortcut } from "./tasks";

describe("todoShortcut", () => {
  it("星號＋方括號是待辦清單", () => {
    expect(todoShortcut("*[] ")).toEqual({ state: "open", length: 4 });
    expect(todoShortcut("*[ ] a")).toEqual({ state: "open", length: 5 });
    expect(todoShortcut("* [] ")).toEqual({ state: "open", length: 5 });
    expect(todoShortcut("*[x] ")?.state).toBe("done");
    expect(todoShortcut("＊【】 ")?.state).toBe("open");
    expect(todoShortcut("＊　「」　")?.state).toBe("open");
  });
  it("其他狀態、沒有星號都不算", () => {
    expect(todoShortcut("*[o] ")).toBeNull();
    expect(todoShortcut("[] ")).toBeNull();
    expect(todoShortcut("*[]")).toBeNull();
  });
  it("去掉跳脫過的快捷", () => {
    expect(stripTodoShortcut(String.raw`\*\[\] 買牛奶`)).toBe("買牛奶");
    expect(stripTodoShortcut(String.raw`\* \[x\] a`)).toBe("a");
    expect(stripTodoShortcut("＊「」 a")).toBe("a");
    expect(stripTodoShortcut("abc")).toBeNull();
  });
});

describe("taskShortcut", () => {
  it("半形", () => {
    expect(taskShortcut("[] a")).toEqual({ state: "open", length: 3 });
    expect(taskShortcut("[ ] ")).toEqual({ state: "open", length: 4 });
    expect(taskShortcut("[x] ")?.state).toBe("done");
    expect(taskShortcut("[o] ")?.state).toBe("event");
    expect(taskShortcut("[<] ")?.state).toBe("scheduled");
    expect(taskShortcut("[-] ")?.state).toBe("cancelled");
    expect(taskShortcut("[] ")?.state).toBe("open");
  });
  it("中文輸入法打出來的括號與空白", () => {
    expect(taskShortcut("「」 ")).toEqual({ state: "open", length: 3 });
    expect(taskShortcut("【】 ")?.state).toBe("open");
    expect(taskShortcut("［］　")?.state).toBe("open");
    expect(taskShortcut("「　」 ")?.state).toBe("open");
    expect(taskShortcut("「ｏ」 ")?.state).toBe("event");
    expect(taskShortcut("【○】 ")?.state).toBe("event");
    expect(taskShortcut("［ｘ］ ")?.state).toBe("done");
  });
  it("不是快捷", () => {
    expect(taskShortcut("[]")).toBeNull();
    expect(taskShortcut("[a] ")).toBeNull();
    expect(taskShortcut("[>] ")).toBeNull();
    expect(taskShortcut("「你好」 ")).toBeNull();
    expect(taskShortcut(" [] ")).toBeNull();
  });
});

describe("stripTaskShortcut", () => {
  it("去掉跳脫過的快捷", () => {
    expect(stripTaskShortcut(String.raw`\[\] 買牛奶`)).toBe("買牛奶");
    expect(stripTaskShortcut(String.raw`\[ \] `)).toBe("");
    expect(stripTaskShortcut(String.raw`\[x\] **粗體**`)).toBe("**粗體**");
    expect(stripTaskShortcut(String.raw`\[&lt;\] a`)).toBe("a");
    expect(stripTaskShortcut(String.raw`\[\-\] a`)).toBe("a");
    expect(stripTaskShortcut("「」 開會")).toBe("開會");
    expect(stripTaskShortcut("【ｏ】&nbsp;開會")).toBe("開會");
  });
  it("不是快捷就是 null", () => {
    expect(stripTaskShortcut("abc")).toBeNull();
  });
});
