import { describe, expect, it } from "vitest";
import {
  canDrop,
  canIndent,
  blockAlign,
  blockBg,
  blocksMarkdown,
  canOutdent,
  groupOf,
  deleteBlock,
  deleteBlocks,
  duplicateBlocks,
  indentBlocks,
  moveBlocks,
  pasteAfter,
  pasteInto,
  placeBesideMany,
  topLevel,
  indentBlock,
  moveBlock,
  outdentBlock,
  placeBeside,
  setBlockAlign,
  setBlockBg,
  setBlocksBg,
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

  it("空白區塊按 Tab：縮排區保留著，離開後成為空白的子區塊", () => {
    const s = insertEmptyAfter({ source: "a\n", region: null, caret: 0 }, 1);
    const r = indentBlock(s.source, s.region!)!;
    expect(r.source).toBe('a\n\n<div class="indent">\n\n\n\n</div>\n');
    expect(r.source.split("\n")[r.start]).toBe("");
    expect(r.start).toBe(4);
    const left = deactivate({ source: r.source, region: { start: r.start, end: r.start + 1 }, caret: 0 });
    expect(left.state.source).toBe('a\n\n<div class="indent">\n\n&nbsp;\n\n</div>\n');
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

  it("在欄位中新增空白區塊後離開，空白區塊留在欄位裡", () => {
    const s = insertEmptyAfter({ source: COLS, region: null, caret: 0 }, find(COLS, "A").end);
    expect(deactivate(s).state.source).toBe(COLS.replace("A\n", "A\n\n&nbsp;\n"));
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

describe("多選", () => {
  const SRC = "A\n\nB\n\nC\n\nD\n";
  const pick = (src: string, ...names: string[]) => names.map((n) => find(src, n));

  it("刪除多個區塊", () => {
    expect(deleteBlocks(SRC, pick(SRC, "B", "D"))).toBe("A\n\nC\n");
  });

  it("一起搬移，保持原本順序並回傳新位置", () => {
    const r = moveBlocks(SRC, pick(SRC, "A", "C"), find(SRC, "D"), "after");
    expect(r.source).toBe("B\n\nD\n\nA\n\nC\n");
    expect(r.starts.map((l) => r.source.split("\n")[l])).toEqual(["A", "C"]);
  });

  it("目標是選取的區塊之一時不動", () => {
    expect(moveBlocks(SRC, pick(SRC, "A", "C"), find(SRC, "C"), "after").source).toBe(SRC);
  });

  it("一起放到旁邊成為新的一欄", () => {
    const out = placeBesideMany(SRC, pick(SRC, "B", "C"), find(SRC, "A"), "right");
    expect(out).toContain('<div class="column">\n\nB\n\nC\n\n</div>');
    expect(out.endsWith("</div>\n\nD\n")).toBe(true);
  });

  it("建立副本放在最後一個選取區塊後面", () => {
    const r = duplicateBlocks(SRC, pick(SRC, "A", "B"));
    expect(r.source).toBe("A\n\nB\n\nA\n\nB\n\nC\n\nD\n");
    expect(r.starts).toEqual([4, 6]);
  });

  it("選了父區塊時，它的子區塊不重複計算", () => {
    const src = 'P\n\n<div class="indent">\n\nc\n\n</div>\n\nQ\n';
    expect(topLevel(parseDoc(src), pick(src, "P", "c")).length).toBe(1);
    expect(deleteBlocks(src, pick(src, "P", "c"))).toBe("Q\n");
    expect(blocksMarkdown(src, pick(src, "P", "c", "Q"))).toBe(
      'P\n\n<div class="indent">\n\nc\n\n</div>\n\nQ',
    );
  });

  it("多個區塊一起縮排：成為同一個父區塊的子區塊，選取保留", () => {
    const r = indentBlocks(SRC, pick(SRC, "B", "C"), false);
    expect(r.source).toBe('A\n\n<div class="indent">\n\nB\n\nC\n\n</div>\n\nD\n');
    expect(r.starts.map((l) => r.source.split("\n")[l])).toEqual(["B", "C"]);
    const back = indentBlocks(r.source, pick(r.source, "B", "C"), true);
    expect(back.source).toBe(SRC);
  });

  it("貼上 Markdown 到選取區塊後面", () => {
    const r = pasteAfter(SRC, find(SRC, "B"), "X\n\n- y\n");
    expect(r.source).toBe("A\n\nB\n\nX\n\n- y\n\nC\n\nD\n");
    expect(r.starts.map((l) => r.source.split("\n")[l])).toEqual(["X", "- y"]);
  });
});

describe("在編輯中的區塊貼上區塊", () => {
  const BLOCKS = '## 標題\n\n- a\n- b\n\n<div class="indent">\n\n子\n\n</div>';

  it("空白區塊：直接換成貼上的區塊", () => {
    const r = pasteInto("x\n\n\n\ny\n", { start: 2, end: 3 }, 0, 0, BLOCKS);
    expect(r.source).toBe(`x\n\n${BLOCKS}\n\ny\n`);
    expect(r.starts.map((l) => r.source.split("\n")[l])).toEqual(["## 標題", "- a", "- b", "子"]);
  });

  it("文字中間：在游標處切開，前後各成一個區塊", () => {
    const r = pasteInto("前後\n", { start: 0, end: 1 }, 1, 1, "P1\n\nP2\n");
    expect(r.source).toBe("前\n\nP1\n\nP2\n\n後\n");
    expect(r.starts).toEqual([2, 4]);
  });

  it("選取的文字被貼上的區塊取代", () => {
    const r = pasteInto("abc\n", { start: 0, end: 1 }, 1, 2, "X\n");
    expect(r.source).toBe("a\n\nX\n\nc\n");
  });

  it("在欄位裡貼上，區塊留在欄位裡", () => {
    const src = '<div class="columns">\n\n<div class="column">\n\nA\n\n</div>\n\n<div class="column">\n\n\n\n</div>\n\n</div>\n';
    const r = pasteInto(src, { start: 10, end: 11 }, 0, 0, "P1\n\nP2");
    expect(r.source).toContain('<div class="column">\n\nP1\n\nP2\n\n</div>');
  });
});

describe("複製的清單保持緊湊", () => {
  it("同一份清單中相鄰的項目之間不加空行", () => {
    const src = "## 標\n\n- a\n- b\n\nP\n";
    const doc = parseDoc(src);
    expect(blocksMarkdown(src, doc.blocks)).toBe("## 標\n\n- a\n- b\n\nP");
  });

  it("搬移整份清單的項目時清單仍是緊湊的", () => {
    const src = "- a\n- b\n\nP\n";
    const r = moveBlocks(src, parseDoc(src).blocks.slice(0, 2), find(src, "P"), "after");
    expect(r.source).toBe("P\n\n- a\n- b\n");
  });
});

describe("整組多欄", () => {
  const SRC = "X\n\n" + COLS + "\nY\n";
  const all = (src: string, ...names: string[]) => names.map((n) => find(src, n));

  it("多欄裡的區塊全選時，整組多欄當成一個單位", () => {
    const xs = topLevel(parseDoc(SRC), all(SRC, "A", "B"));
    expect(xs.length).toBe(1);
    expect(xs[0].whole).toBe("columns");
  });

  it("搬移時多欄排版保持原樣，搬完選取裡面的區塊", () => {
    const r = moveBlocks(SRC, all(SRC, "A", "B"), find(SRC, "Y"), "after");
    expect(r.source).toBe("X\n\nY\n\n" + COLS);
    expect(r.starts.map((l) => r.source.split("\n")[l])).toEqual(["A", "B"]);
  });

  it("傳入已經組好的整組多欄（拖曳時）也能搬", () => {
    const picked = topLevel(parseDoc(SRC), all(SRC, "A", "B"));
    const r = moveBlocks(SRC, picked, find(SRC, "Y"), "after");
    expect(r.source).toBe("X\n\nY\n\n" + COLS);
  });

  it("連同上方的段落一起搬", () => {
    const r = moveBlocks(SRC, all(SRC, "X", "A", "B"), find(SRC, "Y"), "after");
    expect(r.source).toBe("Y\n\nX\n\n" + COLS);
  });

  it("只選其中一欄時照常把區塊搬出來", () => {
    const r = moveBlocks(SRC, all(SRC, "A"), find(SRC, "Y"), "after");
    expect(r.source).toBe("X\n\nB\n\nY\n\nA\n");
  });

  it("複製、建立副本、刪除都保留整組多欄", () => {
    expect(blocksMarkdown(SRC, all(SRC, "A", "B"))).toBe(COLS.trimEnd());
    const d = duplicateBlocks(SRC, all(SRC, "A", "B"));
    expect(d.source).toBe("X\n\n" + COLS + "\n" + COLS + "\nY\n");
    expect(deleteBlocks(SRC, all(SRC, "A", "B"))).toBe("X\n\nY\n");
  });

  it("整組多欄不能放進欄位裡", () => {
    const two = SRC + "\n" + COLS.replace("A", "C").replace("B", "D");
    const doc = parseDoc(two);
    const [whole] = topLevel(doc, all(two, "A", "B"));
    expect(canDrop(doc, whole, find(two, "C"))).toBe(false);
    expect(canDrop(doc, whole, find(two, "Y"))).toBe(true);
  });
});

describe("區塊背景顏色", () => {
  it("包一層 <div class=\"bg-…\">，再設定就換色，拿掉就還原", () => {
    const src = "a\n\nb\n";
    const r = setBlockBg(src, find(src, "b"), "blue");
    expect(r.source).toBe('a\n\n<div class="bg-blue">\n\nb\n\n</div>\n');
    expect(r.source.split("\n")[r.start]).toBe("b");
    expect(renderMarkdown(r.source)).toBe('<p>a</p>\n<div class="bg-blue">\n<p>b</p>\n</div>\n');
    const doc = parseDoc(r.source);
    expect(blockBg(doc, find(r.source, "b"))).toBe("blue");
    const g = setBlockBg(r.source, find(r.source, "b"), "green");
    expect(g.source).toBe('a\n\n<div class="bg-green">\n\nb\n\n</div>\n');
    expect(setBlockBg(g.source, find(g.source, "b"), null).source).toBe(src);
  });

  it("自訂顏色：<div class=\"bg\" style=\"background: #…\">", () => {
    const src = "a\n\nb\n";
    const r = setBlockBg(src, find(src, "b"), "#ddeeff");
    expect(r.source).toBe('a\n\n<div class="bg" style="background: #ddeeff">\n\nb\n\n</div>\n');
    expect(blockBg(parseDoc(r.source), find(r.source, "b"))).toBe("#ddeeff");
    expect(setBlockBg(r.source, find(r.source, "b"), "red").source).toBe('a\n\n<div class="bg-red">\n\nb\n\n</div>\n');
    expect(setBlockBg(r.source, find(r.source, "b"), null).source).toBe(src);
  });

  it("清單項目套用到整份清單", () => {
    const src = "- a\n- b\n";
    expect(setBlockBg(src, find(src, "- b"), "red").source).toBe('<div class="bg-red">\n\n- a\n- b\n\n</div>\n');
  });

  it("搬移有背景色的區塊時背景色跟著走", () => {
    const src = 'x\n\n<div class="bg-blue">\n\nb\n\n</div>\n\ny\n';
    expect(moveBlock(src, find(src, "b"), find(src, "y"), "after")).toBe(
      'x\n\ny\n\n<div class="bg-blue">\n\nb\n\n</div>\n',
    );
  });

  it("有背景色的區塊可以有子區塊，也可以縮排", () => {
    const src = '<div class="bg-blue">\n\nP\n\n</div>\n\nc\n';
    const r = indentBlock(src, find(src, "c"))!;
    expect(r.source).toBe('<div class="bg-blue">\n\nP\n\n</div>\n\n<div class="indent">\n\nc\n\n</div>\n');
    expect(groupOf(parseDoc(r.source), find(r.source, "P"))).toEqual({ start: 0, end: 11 });
    const r2 = indentBlock(src.replace("c\n", "Q\n\nc\n"), find(src.replace("c\n", "Q\n\nc\n"), "Q"));
    expect(r2?.source).toContain('<div class="indent">\n\nQ\n\n</div>');
  });

  it("多個區塊一起設定背景色", () => {
    const src = "a\n\nb\n";
    const r = setBlocksBg(src, parseDoc(src).blocks, "yellow");
    expect(r.source).toBe('<div class="bg-yellow">\n\na\n\n</div>\n\n<div class="bg-yellow">\n\nb\n\n</div>\n');
    expect(r.starts.map((l) => r.source.split("\n")[l])).toEqual(["a", "b"]);
  });
});

describe("對齊", () => {
  const IMG = "![圖](media/a.png)";

  it("置中、靠右、改回靠左", () => {
    const src = `a\n\n${IMG}\n`;
    const c = setBlockAlign(src, find(src, IMG), "center");
    expect(c.source).toBe(`a\n\n<div class="align-center">\n\n${IMG}\n\n</div>\n`);
    expect(c.source.split("\n")[c.start]).toBe(IMG);
    expect(renderMarkdown(c.source)).toContain('<div class="align-center">\n<p><img src="media/a.png" alt="圖" /></p>\n</div>');
    expect(blockAlign(parseDoc(c.source), find(c.source, IMG))).toBe("center");
    const r = setBlockAlign(c.source, find(c.source, IMG), "right");
    expect(r.source).toBe(`a\n\n<div class="align-right">\n\n${IMG}\n\n</div>\n`);
    expect(setBlockAlign(r.source, find(r.source, IMG), "left").source).toBe(src);
  });

  it("可以同時有背景色與對齊，兩者互不影響", () => {
    const src = `${IMG}\n`;
    const a = setBlockAlign(src, find(src, IMG), "center");
    const b = setBlockBg(a.source, find(a.source, IMG), "blue");
    const doc = parseDoc(b.source);
    expect(blockAlign(doc, find(b.source, IMG))).toBe("center");
    expect(blockBg(doc, find(b.source, IMG))).toBe("blue");
    const back = setBlockBg(b.source, find(b.source, IMG), null);
    expect(back.source).toBe(a.source);
  });

  it("搬移時對齊跟著走", () => {
    const src = `x\n\n<div class="align-center">\n\n${IMG}\n\n</div>\n\ny\n`;
    expect(moveBlock(src, find(src, IMG), find(src, "y"), "after")).toBe(
      `x\n\ny\n\n<div class="align-center">\n\n${IMG}\n\n</div>\n`,
    );
  });
});

describe("圖說位置", () => {
  const IMG = '![圖](media/a.png "說明")';
  const at = (s: string) => {
    const lines = s.split("\n");
    const i = lines.indexOf(IMG);
    return { start: i, end: i + 1 };
  };
  it("上方是 caption-top 容器，下方拿掉，和對齊可以同時存在", async () => {
    const { captionPos, setCaptionPos } = await import("./layout");
    const src = `a\n\n${IMG}\n`;
    expect(captionPos(parseDoc(src), at(src))).toBe("bottom");
    const top = setCaptionPos(src, at(src), "top").source;
    expect(top).toBe(`a\n\n<div class="caption-top">\n\n${IMG}\n\n</div>\n`);
    expect(captionPos(parseDoc(top), at(top))).toBe("top");
    const both = setBlockAlign(top, at(top), "center").source;
    expect(blockAlign(parseDoc(both), at(both))).toBe("center");
    expect(captionPos(parseDoc(both), at(both))).toBe("top");
    const back = setCaptionPos(both, at(both), "bottom").source;
    expect(back).toBe(`a\n\n<div class="align-center">\n\n${IMG}\n\n</div>\n`);
  });
});

describe("圖片大小", () => {
  const IMG = "![圖](media/a.png)";
  const at = (s: string) => {
    const i = s.split("\n").indexOf(IMG);
    return { start: i, end: i + 1 };
  };
  it("寬度是 width-N 容器，原始大小拿掉，和對齊、圖說位置並存", async () => {
    const { blockSize, setBlockSize, setCaptionPos, captionPos } = await import("./layout");
    const src = `${IMG}\n`;
    expect(blockSize(parseDoc(src), at(src))).toBeNull();
    let s = setBlockSize(src, at(src), "50").source;
    expect(s).toBe(`<div class="width-50">\n\n${IMG}\n\n</div>\n`);
    s = setBlockAlign(s, at(s), "center").source;
    s = setCaptionPos(s, at(s), "top").source;
    s = setBlockSize(s, at(s), "75").source;
    const d = parseDoc(s);
    expect([blockSize(d, at(s)), blockAlign(d, at(s)), captionPos(d, at(s))]).toEqual(["75", "center", "top"]);
    expect(renderMarkdown(s)).toContain('<div class="width-75">');
    s = setBlockSize(s, at(s), null).source;
    expect(s).not.toContain("width-");
    expect(blockAlign(parseDoc(s), at(s))).toBe("center");
  });
});
