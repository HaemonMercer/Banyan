import { describe, expect, it } from "vitest";
import { parseDoc } from "../editor/markdown";
import { applyText, backspaceAtStart, splitBlock, turnInto, type EditorState } from "../editor/ops";
import {
  appendItems,
  collectTasks,
  cycleState,
  lineTask,
  setLineTask,
  setTaskAt,
  stripTaskHtml,
} from "./tasks";

const st = (source: string, start: number, end: number, caret: number): EditorState => ({
  source,
  region: { start, end },
  caret,
});

describe("任務標記", () => {
  it("認得各種狀態", () => {
    expect(lineTask("- { } 買牛奶")?.state).toBe("open");
    expect(lineTask("* [x] 完成")?.state).toBe("done");
    // 沒有「已遷移」：[>] 不是任務標記
    expect(lineTask("1. [>] 遷移")).toBeNull();
    expect(lineTask("  - {<} 排程")?.state).toBe("scheduled");
    expect(lineTask("- {-} 取消")?.state).toBe("cancelled");
    expect(lineTask("- {o} 開會")?.state).toBe("event");
    expect(lineTask("- { }")?.state).toBe("open");
    expect(lineTask("- { }x")).toBeNull();
    expect(lineTask("- 筆記")).toBeNull();
    expect(lineTask("[ ] 不是清單")).toBeNull();
    expect(lineTask("- { } 買牛奶")?.prefix).toBe(6);
  });

  it("設定、拿掉、加上任務標記", () => {
    expect(setLineTask("- { } a", "done")).toBe("- {x} a");
    expect(setLineTask("- {x} a", null)).toBe("- a");
    expect(setLineTask("- a", "open")).toBe("- { } a");
    expect(setLineTask("2. a", "event")).toBe("2. {o} a");
    expect(setLineTask("段落", "open")).toBe("- { } 段落");
    expect(cycleState("open")).toBe("done");
    expect(cycleState("done")).toBe("open");
    expect(cycleState("scheduled")).toBe("done");
    expect(cycleState("done", true)).toBe("scheduled");
    expect(cycleState("cancelled")).toBe("open");
    expect(cycleState("event")).toBe("event");
  });

  it("列出文件裡的任務（程式碼區塊裡的不算）", () => {
    const src = "- { } a\n- 筆記\n- {x} b\n\n```\n- { } 不算\n```\n\n  - {o} c";
    expect(collectTasks(src)).toEqual([
      { line: 0, state: "open", text: "a" },
      { line: 2, state: "done", text: "b" },
      { line: 8, state: "event", text: "c" },
    ]);
    expect(setTaskAt(src, 2, "open").split("\n")[2]).toBe("- { } b");
  });

  it("加到文件最後：接在同一份清單，或空一行另起", () => {
    expect(appendItems("", ["- { } a"])).toBe("- { } a\n");
    expect(appendItems("&nbsp;\n", ["- { } a"])).toBe("- { } a\n");
    expect(appendItems("- {x} 舊的\n", ["- { } a", "- {o} b"])).toBe("- {x} 舊的\n- { } a\n- {o} b\n");
    expect(appendItems("一段文字\n\n", ["- { } a"])).toBe("一段文字\n\n- { } a\n");
    expect(appendItems("* x", ["- { } a"])).toBe("* x\n\n- { } a\n");
  });

  it("渲染後的 HTML 去掉標記；區塊記住任務狀態", () => {
    expect(stripTaskHtml("[ ] 買牛奶")).toBe("買牛奶");
    expect(stripTaskHtml("<p>[x] 完成</p>\n")).toBe("<p>完成</p>\n");
    expect(stripTaskHtml("[ ]")).toBe("");
    expect(stripTaskHtml("[&gt;] 遷移")).toBe("[&gt;] 遷移");
    expect(stripTaskHtml("{&lt;} 排程")).toBe("排程");
    expect(stripTaskHtml("{} 空的")).toBe("空的");
    expect(stripTaskHtml("[x] 待辦")).toBe("待辦");
    expect(stripTaskHtml("[o] 不是")).toBe("[o] 不是");
    const doc = parseDoc("- { } a\n- {o} b\n- c\n");
    expect(doc.units.map((u) => u.task)).toEqual(["open", "event", undefined]);
  });
});

describe("任務的編輯操作", () => {
  it("Enter：下一行還是未完成的任務；事件之後還是事件", () => {
    const n = splitBlock(st("- {x} 做完了", 0, 1, 9), 9)!;
    expect(n.source).toBe("- {x} 做完了\n- { } ");
    expect(n.caret).toBe(6);
    expect(splitBlock(st("- {o} 開會", 0, 1, 8), 8)!.source).toBe("- {o} 開會\n- {o} ");
  });

  it("空的任務按 Enter 離開清單", () => {
    const n = splitBlock(st("- { } a\n- { } ", 1, 2, 6), 6)!;
    expect(n.source.split("\n")[0]).toBe("- { } a");
    expect(n.source).not.toContain("[ ] \n");
    expect(parseDoc(n.source).units.filter((u) => u.task).length).toBe(1);
  });

  it("開頭按 Backspace 先拿掉任務標記", () => {
    const n = backspaceAtStart(st("- { } 買牛奶", 0, 1, 6))!;
    expect(n.source).toBe("- 買牛奶");
    expect(n.caret).toBe(2);
  });

  it("轉成任務、事件；轉回段落時一起拿掉標記", () => {
    expect(turnInto("買牛奶", "task").text).toBe("- { } 買牛奶");
    expect(turnInto("- 開會", "event").text).toBe("- {o} 開會");
    expect(turnInto("- {x} 完成", "paragraph").text).toBe("完成");
    expect(turnInto("- {x} 完成", "task").text).toBe("- { } 完成");
    // 打字不影響標記
    expect(applyText(st("- { } a", 0, 1, 7), "- { } ab", 8).source).toBe("- { } ab");
  });
});

describe("待辦清單（核取方塊）", () => {
  it("[ ] 是核取方塊（任何清單標記），{ } 是子彈筆記的任務", async () => {
    const { isCheckLine } = await import("./tasks");
    expect(isCheckLine("* [ ] 買牛奶")).toBe(true);
    expect(isCheckLine("  * [x] 完成")).toBe(true);
    expect(isCheckLine("- [ ] 也是待辦")).toBe(true);
    expect(isCheckLine("1. [x] 編號的待辦")).toBe(true);
    expect(isCheckLine("- { } 任務")).toBe(false);
    expect(isCheckLine("* {o} 事件")).toBe(false);
    expect(isCheckLine("- [o] 不是任何東西")).toBe(false);
    expect(lineTask("- {} 空的大括號")?.state).toBe("open");
    // 待辦改成其他狀態就變成子彈筆記的任務；改成完成還是待辦
    expect(setLineTask("- [ ] a", "done")).toBe("- [x] a");
    expect(setLineTask("- [ ] a", "cancelled")).toBe("- {-} a");
    expect(isCheckLine("* 普通項目")).toBe(false);
    const doc = parseDoc("* [ ] a\n* [x] b\n\n- { } c\n");
    expect(doc.units.map((u) => [u.task, !!u.check])).toEqual([
      ["open", true],
      ["done", true],
      ["open", false],
    ]);
  });

  it("轉成待辦、Enter 繼續下一個未勾選的待辦", () => {
    expect(turnInto("買牛奶", "todo").text).toBe("* [ ] 買牛奶");
    expect(turnInto("- { } 任務", "todo").text).toBe("* [ ] 任務");
    expect(turnInto("* [x] 完成", "task").text).toBe("- { } 完成");
    const n = splitBlock(st("* [x] 做完了", 0, 1, 9), 9)!;
    expect(n.source).toBe("* [x] 做完了\n* [ ] ");
  });
});

describe("排程（任務留在原處，行尾寫上日期）", () => {
  it("列出任務時分開內容與排程日期", () => {
    expect(collectTasks("- {<} 繳電費 [[2026-11-20]]\n- {o} 開會")).toEqual([
      { line: 0, state: "scheduled", text: "繳電費", due: "2026-11-20" },
      { line: 1, state: "event", text: "開會" },
    ]);
  });
  it("排程、重新排程、取消排程", async () => {
    const { scheduleLine, scheduleAt, lineDate } = await import("./tasks");
    expect(scheduleLine("- { } 繳電費", "2026-11-20")).toBe("- {<} 繳電費 [[2026-11-20]]");
    expect(scheduleLine("- {<} 繳電費 [[2026-11-20]]", "2026-12-01")).toBe("- {<} 繳電費 [[2026-12-01]]");
    expect(scheduleLine("- {<} 繳電費 [[2026-11-20]]", null)).toBe("- { } 繳電費");
    // 事件排程後還是事件
    expect(scheduleLine("- {o} 開會", "2026-11-20")).toBe("- {o} 開會 [[2026-11-20]]");
    expect(scheduleAt("a\n- { } b", 1, "2026-11-20")).toBe("a\n- {<} b [[2026-11-20]]");
    expect(scheduleAt("一般段落", 0, "2026-11-20")).toBe("一般段落");
    expect(lineDate("- {<} 繳電費 [[2026-11-20]]")).toBe("2026-11-20");
    expect(lineDate("- 筆記 [[2026-11-20]]")).toBeNull();
  });
});
