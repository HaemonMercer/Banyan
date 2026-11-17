import { describe, expect, it } from "vitest";
import {
  canDrop,
  canIndent,
  canOutdent,
  groupOf,
  deleteBlock,
  indentBlock,
  moveBlock,
  outdentBlock,
  placeBeside,
  setColumnWidths,
} from "./layout";
import { parseDoc, renderMarkdown, type Unit } from "./markdown";
import { deactivate, insertEmptyAfter } from "./ops";

const blocks = (source: string) => parseDoc(source).blocks;
const find = (source: string, text: string): Unit => {
  const doc = parseDoc(source);
  const u = doc.blocks.find((b) => doc.lines.slice(b.start, b.end).join("\n").includes(text));
  if (!u) throw new Error(`找不到 ${text}`);
  return u;
};

const COLS = `<div class="columns">

<div class="column">

A

</div>

<div class="column">

B

</div>

</div>
`;

describe("版面標籤", () => {
  it("欄位與縮排標籤組成樹，標籤本身不是可見區塊", () => {
    const doc = parseDoc(COLS);
    expect(doc.blocks.map((b) => doc.lines[b.start])).toEqual(["A", "B"]);
    const cols = doc.tree[0];
    expect(cols.type === "container" && cols.kind).toBe("columns");
    expect(cols.type === "container" && cols.children.length).toBe(2);
  });

  it("仍是合法的 CommonMark：內容照常當 Markdown 渲染", () => {
    expect(renderMarkdown('<div class="indent">\n\n**粗**\n\n</div>\n')).toBe(
      '<div class="indent">\n<p><strong>粗</strong></p>\n</div>\n',
    );
  });

  it("沒有配對的標籤當一般 HTML 區塊", () => {
    const doc = parseDoc('<div class="column">\n\nA\n');
    expect(doc.blocks.length).toBe(2);
  });
});

describe("縮排", () => {
  it("Tab 包一層縮排", () => {
    const src = "a\n\nb\n";
    const r = indentBlock(src, find(src, "b"))!;
    expect(r.source).toBe('a\n\n<div class="indent">\n\nb\n\n</div>\n');
    expect(r.source.split("\n")[r.start]).toBe("b");
  });

  it("前一個區塊已縮排時併進去", () => {
    const src = 'a\n\n<div class="indent">\n\nb\n\n</div>\n\nc\n';
    const r = indentBlock(src, find(src, "c"))!;
    expect(r.source).toBe('a\n\n<div class="indent">\n\nb\n\nc\n\n</div>\n');
    expect(r.source.split("\n")[r.start]).toBe("c");
  });

  it("縮排只有一層：已縮排的區塊不能再縮", () => {
    const src = 'a\n\n<div class="indent">\n\nb\n\n</div>\n';
    expect(canIndent(parseDoc(src), find(src, "b"))).toBe(false);
    expect(indentBlock(src, find(src, "b"))).toBeNull();
  });

  it("舊文件裡的巢狀縮排在下次整理時攤平成一層", () => {
    const src = 'a\n\n<div class="indent">\n\n<div class="indent">\n\nb\n\n</div>\n\n</div>\n\nz\n';
    expect(deleteBlock(src, find(src, "z"))).toBe('a\n\n<div class="indent">\n\nb\n\n</div>\n');
  });

  it("第一個區塊上方沒有父區塊，不能縮排", () => {
    expect(indentBlock("a\n\nb\n", { start: 0, end: 1 })).toBeNull();
    const cols = COLS;
    expect(canIndent(parseDoc(cols), find(cols, "A"))).toBe(false);
  });

  it("空白區塊按 Tab：縮排區保留著，離開時才清掉", () => {
    const s = insertEmptyAfter({ source: "a\n", region: null, caret: 0 }, 1);
    const r = indentBlock(s.source, s.region!)!;
    expect(r.source).toBe('a\n\n<div class="indent">\n\n\n\n</div>\n');
    expect(r.source.split("\n")[r.start]).toBe("");
    expect(r.start).toBe(4);
    const left = deactivate({ source: r.source, region: { start: r.start, end: r.start + 1 }, caret: 0 });
    expect(left.state.source).toBe("a\n");
  });

  it("有子區塊的區塊縮排時，子區塊一起移進來成為同層", () => {
    const src = 'a\n\nP\n\n<div class="indent">\n\nc\n\n</div>\n';
    const r = indentBlock(src, find(src, "P"))!;
    expect(r.source).toBe('a\n\n<div class="indent">\n\nP\n\nc\n\n</div>\n');
  });

  it("Shift+Tab：唯一的區塊移出後拿掉縮排", () => {
    const src = 'a\n\n<div class="indent">\n\nb\n\n</div>\n';
    expect(canOutdent(parseDoc(src), find(src, "b"))).toBe(true);
    const r = outdentBlock(src, find(src, "b"))!;
    expect(r.source).toBe("a\n\nb\n");
    expect(r.source.split("\n")[r.start]).toBe("b");
  });

  it("Shift+Tab：中間的區塊移出後縮排分成兩段", () => {
    const src = '<div class="indent">\n\nx\n\ny\n\nz\n\n</div>\n';
    const r = outdentBlock(src, find(src, "y"))!;
    expect(r.source).toBe(
      '<div class="indent">\n\nx\n\n</div>\n\ny\n\n<div class="indent">\n\nz\n\n</div>\n',
    );
  });

  it("不在縮排裡不能減少縮排", () => {
    expect(outdentBlock("a\n", { start: 0, end: 1 })).toBeNull();
  });
});

describe("多欄", () => {
  it("拖到區塊右邊變成兩欄", () => {
    const src = "A\n\nB\n";
    expect(placeBeside(src, find(src, "B"), find(src, "A"), "right")).toBe(COLS);
  });

  it("拖到區塊左邊", () => {
    const src = "B\n\nA\n";
    const swapped = COLS.replace("\nA\n", "\n@\n").replace("\nB\n", "\nA\n").replace("\n@\n", "\nB\n");
    expect(placeBeside(src, find(src, "B"), find(src, "A"), "left")).toBe(swapped);
  });

  it("拖到欄位中的區塊旁邊會新增一欄", () => {
    const src = COLS + "\nC\n";
    const out = placeBeside(src, find(src, "C"), find(src, "B"), "right");
    const doc = parseDoc(out);
    const cols = doc.tree[0];
    expect(cols.type === "container" && cols.children.length).toBe(3);
    expect(doc.blocks.map((b) => doc.lines[b.start])).toEqual(["A", "B", "C"]);
  });

  it("把欄位裡最後一個區塊拖出來，只剩一欄時取消多欄", () => {
    const out = moveBlock(COLS, find(COLS, "B"), null);
    expect(out).toBe("A\n\nB\n");
  });

  it("刪掉欄位裡的區塊，同樣會收掉欄位", () => {
    expect(deleteBlock(COLS, find(COLS, "A"))).toBe("B\n");
  });

  it("三欄刪掉一欄後仍是兩欄", () => {
    const three = placeBeside(COLS + "\nC\n", find(COLS + "\nC\n", "C"), find(COLS, "B"), "right");
    const out = deleteBlock(three, find(three, "B"));
    const doc = parseDoc(out);
    const cols = doc.tree[0];
    expect(cols.type === "container" && cols.children.length).toBe(2);
  });

  it("在欄位內上下搬移", () => {
    const src = COLS.replace("A\n", "A\n\nA2\n");
    const out = moveBlock(src, find(src, "A2"), find(src, "A"), "before");
    const doc = parseDoc(out);
    expect(doc.blocks.map((b) => doc.lines[b.start])).toEqual(["A2", "A", "B"]);
  });

  it("把清單項目旁邊放東西時包住整份清單", () => {
    const src = "- a\n- b\n\nX\n";
    const out = placeBeside(src, find(src, "X"), find(src, "- b"), "right");
    expect(out).toContain('<div class="column">\n\n- a\n- b\n\n</div>');
  });

  it("欄寬寫在欄位標籤上", () => {
    const out = setColumnWidths(COLS, [
      { line: 2, width: 0.6 },
      { line: 8, width: 1.4 },
    ]);
    expect(out).toContain('<div class="column" style="flex: 0.6">');
    expect(out).toContain('<div class="column" style="flex: 1.4">');
    const cols = parseDoc(out).tree[0];
    expect(cols.type === "container" && cols.children.map((c) => c.type === "container" && c.width)).toEqual([0.6, 1.4]);
    expect(setColumnWidths(out, [{ line: 2, width: 1 }])).toContain('<div class="column">\n');
  });

  it("在欄位中新增空白區塊後離開，欄位保持原樣", () => {
    const s = insertEmptyAfter({ source: COLS, region: null, caret: 0 }, find(COLS, "A").end);
    expect(deactivate(s).state.source).toBe(COLS);
  });
});

describe("子區塊", () => {
  const SRC = 'X\n\nP\n\n<div class="indent">\n\nc\n\n</div>\n\nQ\n';

  it("縮排的區塊是上方區塊的子區塊", () => {
    const doc = parseDoc(SRC);
    expect(groupOf(doc, find(SRC, "P"))).toEqual({ start: 2, end: 9 });
    expect(groupOf(doc, find(SRC, "X"))).toEqual({ start: 0, end: 1 });
  });

  it("搬移父區塊時子區塊跟著走", () => {
    expect(moveBlock(SRC, find(SRC, "P"), find(SRC, "Q"), "after")).toBe(
      'X\n\nQ\n\nP\n\n<div class="indent">\n\nc\n\n</div>\n',
    );
  });

  it("放在父區塊後面時接在子區塊之後", () => {
    expect(moveBlock(SRC, find(SRC, "X"), find(SRC, "P"), "after")).toBe(
      'P\n\n<div class="indent">\n\nc\n\n</div>\n\nX\n\nQ\n',
    );
  });

  it("放在子區塊旁邊就成為子區塊", () => {
    expect(moveBlock(SRC, find(SRC, "Q"), find(SRC, "c"), "after")).toBe(
      'X\n\nP\n\n<div class="indent">\n\nc\n\nQ\n\n</div>\n',
    );
  });

  it("有子區塊的區塊不能放進縮排，也不能放進自己的子區塊", () => {
    const doc = parseDoc(SRC);
    expect(canDrop(doc, find(SRC, "P"), find(SRC, "c"))).toBe(false);
    expect(moveBlock(SRC, find(SRC, "P"), find(SRC, "c"), "after")).toBe(SRC);
    const two = SRC.replace("Q\n", "Q\n\n<div class=\"indent\">\n\nq\n\n</div>\n");
    expect(canDrop(parseDoc(two), find(two, "P"), find(two, "q"))).toBe(false);
  });

  it("刪除父區塊連同子區塊", () => {
    const doc = parseDoc(SRC);
    expect(deleteBlock(SRC, groupOf(doc, find(SRC, "P")))).toBe("X\n\nQ\n");
  });

  it("把父區塊放到旁邊成欄時子區塊一起進欄位", () => {
    const out = placeBeside(SRC, find(SRC, "P"), find(SRC, "X"), "right");
    expect(out).toContain('<div class="column">\n\nP\n\n<div class="indent">\n\nc\n\n</div>\n\n</div>');
  });
});

describe("清理", () => {
  it("一般文件不受影響", () => {
    expect(blocks("a\n\nb\n").length).toBe(2);
    expect(deleteBlock("a\n\nb\n\nc\n", { start: 2, end: 3 })).toBe("a\n\nc\n");
  });
});
