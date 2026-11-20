import { describe, expect, it } from "vitest";
import { addNote, emptyBoard } from "./board";
import {
  addDoc,
  appendMarkdown,
  cardsDiagram,
  cardsMarkdown,
  emptyFile,
  moveDoc,
  parseFile,
  removeDoc,
  serializeFile,
  splitSlides,
  joinSlides,
  setSlide,
  insertSlide,
  removeSlide,
  moveSlide,
  moveSlides,
  removeSlides,
  duplicateSlides,
  moveDocs,
  removeDocs,
  moveGroup,
  sameSlide,
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
  it("空的投影片保留；第一行的縮排不動", () => {
    expect(splitSlides("A\n\n---\n\n---\n\nB")).toEqual(["A", "", "B"]);
    expect(splitSlides("\n    code\n\n---\n\nB")).toEqual(["    code", "B"]);
  });
  it("改、插入、刪除、搬移投影片", () => {
    const md = "# A\n\n---\n\n## B\n";
    expect(setSlide(md, 1, "## B2\n\ntext\n")).toBe("# A\n\n---\n\n## B2\n\ntext\n");
    expect(splitSlides(insertSlide(md, 1))).toEqual(["# A", "", "## B"]);
    expect(removeSlide(md, 0)).toBe("## B\n");
    expect(removeSlide("# A\n", 0)).toBe("\n");
    expect(moveSlide(md, 1, 0)).toBe("## B\n\n---\n\n# A\n");
    expect(joinSlides(splitSlides(md))).toBe(md);
    expect(sameSlide("## B\n", "## B")).toBe(true);
  });
  it("好幾張一起刪、複製、搬移", () => {
    const md = joinSlides(["A", "B", "C", "D"]);
    expect(splitSlides(removeSlides(md, [1, 3]))).toEqual(["A", "C"]);
    expect(removeSlides(md, [0, 1, 2, 3])).toBe("\n");
    const d = duplicateSlides(md, [2, 0]);
    expect(splitSlides(d.md)).toEqual(["A", "B", "C", "A", "C", "D"]);
    expect(d.added).toEqual([3, 4]);
    const m = moveSlides(md, [1, 3], 0);
    expect(splitSlides(m.md)).toEqual(["B", "D", "A", "C"]);
    expect(m.moved).toEqual([0, 1]);
    expect(splitSlides(moveSlides(md, [0, 1], 4).md)).toEqual(["C", "D", "A", "B"]);
    expect(splitSlides(moveSlides(md, [0, 2], 2).md)).toEqual(["B", "A", "C", "D"]);
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

describe("好幾份文件", () => {
  it("一起搬移、刪除", () => {
    let f = emptyFile();
    for (const t of ["A", "B", "C", "D"]) f = addDoc(f, "note", t).file;
    const id = (t: string) => f.docs.find((d) => d.title === t)!.id;
    const titles = (x: typeof f) => x.docs.map((d) => d.title);
    expect(titles(moveDocs(f, [id("A"), id("C")], 4))).toEqual(["B", "D", "A", "C"]);
    expect(titles(moveDocs(f, [id("D"), id("B")], 0))).toEqual(["B", "D", "A", "C"]);
    expect(titles(moveDocs(f, [id("B")], 1))).toEqual(["A", "B", "C", "D"]);
    expect(titles(removeDocs(f, [id("A"), id("D")]))).toEqual(["B", "C"]);
    expect(moveGroup([1, 2, 3], () => false, 1)).toEqual([1, 2, 3]);
  });
});

describe("Draw 文件", () => {
  it("新的 Draw 文件有範例流程圖，存檔寫成 draw 物件、讀回來一樣", () => {
    const r = addDoc(emptyFile(), "draw");
    const doc = r.file.docs[0];
    expect(doc.title).toBe("Diagram");
    const saved = JSON.parse(serializeFile(r.file));
    expect(saved.docs[0].content).toBeUndefined();
    expect(saved.docs[0].draw.shapes.length).toBeGreaterThan(0);
    expect(parseFile(serializeFile(r.file)).docs[0]).toEqual(doc);
  });
  it("卡片送到圖表：便利貼變便利貼，頁面變標題", () => {
    const f = addNote(emptyBoard(), 0, 0, "An idea");
    const json = cardsDiagram("", f.board.cards, (c) => ({ title: "", content: c.text }));
    const d = JSON.parse(json);
    expect(d.shapes).toHaveLength(1);
    expect(d.shapes[0]).toMatchObject({ kind: "note", text: "An idea" });
  });
});

describe("已存的區塊樣式 styles", () => {
  it("Word、簡報存得回來；空的不寫；其他文件種類不留", () => {
    let f = addDoc(emptyFile(), "word").file;
    f = addDoc(f, "note").file;
    f = { ...f, docs: f.docs.map((d) => ({ ...d, styles: [{ name: "Card", css: "padding: 6pt" }] })) };
    const saved = JSON.parse(serializeFile(f));
    expect(saved.docs[0].styles).toEqual([{ name: "Card", css: "padding: 6pt" }]);
    expect(saved.docs[1].styles).toBeUndefined();
    const back = parseFile(serializeFile(f));
    expect(back.docs[0].styles).toEqual([{ name: "Card", css: "padding: 6pt 6pt 6pt 6pt" }]);
    expect(back.docs[1].styles).toBeUndefined();
    const none = addDoc(emptyFile(), "slides").file;
    expect(JSON.parse(serializeFile(none)).docs[0].styles).toBeUndefined();
  });
});
