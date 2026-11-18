import { describe, expect, it } from "vitest";
import { addNote, emptyBoard } from "./board";
import {
  addDoc,
  appendMarkdown,
  cardsMarkdown,
  emptyFile,
  moveDoc,
  parseFile,
  removeDoc,
  serializeFile,
  splitSlides,
  updateDoc,
} from "./file";
import { mdBlocks, runsText } from "./mdblocks";

describe("Desk 檔案", () => {
  it("白板與 Dock 的文件一起存、讀回來一樣", () => {
    let f = emptyFile();
    f = { ...f, board: addNote(emptyBoard(), 0, 0, "想法").board };
    f = addDoc(f, "word").file;
    f = addDoc(f, "slides").file;
    f = addDoc(f, "note", "雜記", "內容").file;
    const back = parseFile(serializeFile(f));
    expect(back.board.cards[0].text).toBe("想法");
    expect(back.docs.map((d) => [d.title, d.kind])).toEqual([
      ["Document", "word"],
      ["Slides", "slides"],
      ["雜記", "note"],
    ]);
    expect(back.docs[0].content).toBe("# Document\n");
    expect(serializeFile(back)).toBe(serializeFile(f));
  });

  it("壞掉的檔案也能開", () => {
    expect(parseFile("{oops")).toEqual(emptyFile());
    const f = parseFile(JSON.stringify({ docs: [{ id: "a", kind: "weird" }, { nope: 1 }] }));
    expect(f.docs).toEqual([{ id: "a", title: "Untitled", kind: "note", content: "" }]);
  });

  it("新文件的標題不重複；改、刪、排序", () => {
    let f = addDoc(emptyFile(), "word").file;
    f = addDoc(f, "word").file;
    expect(f.docs.map((d) => d.title)).toEqual(["Document", "Document 2"]);
    const [a, b] = f.docs;
    f = moveDoc(f, b.id, 0);
    expect(f.docs.map((d) => d.id)).toEqual([b.id, a.id]);
    f = updateDoc(f, a.id, { title: "報告" });
    expect(f.docs[1].title).toBe("報告");
    f = removeDoc(f, b.id);
    expect(f.docs.map((d) => d.title)).toEqual(["報告"]);
  });
});

describe("簡報分張", () => {
  it("空行後面單獨一行的 --- 分張", () => {
    expect(splitSlides("# A\n\n---\n\n## B\n- x\n\n---\n\n## C")).toEqual(["# A", "## B\n- x", "## C"]);
  });
  it("文字下面的 --- 是標題底線；程式碼裡的不算", () => {
    expect(splitSlides("Title\n---\n\nbody")).toEqual(["Title\n---\n\nbody"]);
    expect(splitSlides("```\n\n---\n```\n\n---\n\nB")).toEqual(["```\n\n---\n```", "B"]);
  });
  it("空的文件是一張空投影片", () => {
    expect(splitSlides("")).toEqual([""]);
  });
});

describe("送到 Dock", () => {
  const b = addNote(addNote(emptyBoard(), 0, 0, "第一").board, 0, 200, "第二").board;
  const page = { ...b.cards[0], id: "p", ref: { kind: "page" as const, name: "研究" }, text: "" };
  const src = (c: (typeof b.cards)[number]) =>
    c.ref.kind === "note" ? { title: "", content: c.text } : { title: "研究", content: "筆記內容" };

  it("便利貼接成段落；頁面加上標題", () => {
    expect(cardsMarkdown([...b.cards, page], src, "word")).toBe("第一\n\n第二\n\n## 研究\n\n筆記內容");
  });
  it("簡報每張卡片一張投影片", () => {
    expect(cardsMarkdown(b.cards, src, "slides")).toBe("第一\n\n---\n\n第二");
  });
  it("接在最後面", () => {
    expect(appendMarkdown("# 報告\n", "新的", "word")).toBe("# 報告\n\n新的\n");
    expect(appendMarkdown("# 封面\n", "新的", "slides")).toBe("# 封面\n\n---\n\n新的\n");
    expect(appendMarkdown("", "新的", "slides")).toBe("新的\n");
    expect(appendMarkdown("x", "  ", "note")).toBe("x");
  });
});

describe("匯出用的段落", () => {
  it("標題、段落、格式、連結", () => {
    const bl = mdBlocks("# 標題\n\n**粗** *斜* `碼` <u>底</u> <s>刪</s> [連結](https://a.b) [[頁面]]");
    expect(bl[0]).toEqual({ type: "heading", level: 1, runs: [{ text: "標題" }] });
    const p = bl[1];
    if (p.type !== "para") throw new Error();
    expect(runsText(p.runs)).toBe("粗 斜 碼 底 刪 連結 頁面");
    expect(p.runs.find((r) => r.text === "粗")?.bold).toBe(true);
    expect(p.runs.find((r) => r.text === "斜")?.italic).toBe(true);
    expect(p.runs.find((r) => r.text === "碼")?.code).toBe(true);
    expect(p.runs.find((r) => r.text === "底")?.underline).toBe(true);
    expect(p.runs.find((r) => r.text === "刪")?.strike).toBe(true);
    expect(p.runs.find((r) => r.text === "連結")?.link).toBe("https://a.b");
  });

  it("清單的層級、編號、任務符號", () => {
    const bl = mdBlocks("- { } 任務\n  - 子項\n\n1. 一\n2. 二\n");
    const paras = bl.filter((b) => b.type === "para");
    expect(paras.map((p) => (p.type === "para" ? [runsText(p.runs), p.list?.level, p.list?.ordered] : null))).toEqual([
      ["☐ 任務", 0, false],
      ["子項", 1, false],
      ["一", 0, true],
      ["二", 0, true],
    ]);
  });

  it("程式碼、分隔線、只有圖片的段落、排版標籤略過", () => {
    const bl = mdBlocks('```\nx = 1\n```\n\n---\n\n![圖](media/a.png)\n\n<div class="indent">\n\n文字\n\n</div>\n');
    expect(bl.map((b) => b.type)).toEqual(["code", "hr", "image", "para"]);
    expect(bl[2]).toEqual({ type: "image", src: "media/a.png", alt: "圖" });
  });
});
