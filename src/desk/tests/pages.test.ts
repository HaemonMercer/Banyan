import assert from "node:assert/strict";
import test from "node:test";
import { parseDesk } from "../markdown.ts";
import { readPage } from "../paper.ts";
import { columnAt, pickBreaks, pickColumnBreak, splitPages } from "../pages.ts";
import { applyStyleScopes } from "../styles.ts";

const texts = (pages: ReturnType<typeof splitPages>, body: string) =>
    pages.map((page) => page.map((block) => body.slice(block.start, block.end).trim()));

test("splitPages breaks at ::page and before the blocks that hold a break offset", () => {
    const body = "one\n\ntwo\n\n- a\n- b\n\n::page\n\nthree";
    const { children } = parseDesk(body);
    assert.deepEqual(texts(splitPages(children), body), [["one", "two", "- a\n- b"], ["three"]]);
    // An offset inside the list (its first item) breaks before the whole list.
    assert.deepEqual(texts(splitPages(children, [body.indexOf("two"), body.indexOf("a\n")]), body), [["one"], ["two"], ["- a\n- b"], ["three"]]);
    // The first block, and the block right after ::page, never open another page.
    assert.deepEqual(texts(splitPages(children, [0, body.indexOf("three")]), body), [["one", "two", "- a\n- b"], ["three"]]);
});

test("splitPages keeps ::push markers with the text that follows", () => {
    const body = "one\n\n::push(A)\ntwo\n::pop()";
    const { children } = parseDesk(body);
    const pages = splitPages(children, [body.indexOf("two")]);
    assert.equal(pages.length, 2);
    assert.equal(pages[1].some((block) => block.type === "paragraph"), true);
});

test("pickBreaks starts a page before the first block that runs past the page", () => {
    const blocks = [
        { top: 0, bottom: 40, offset: 0 }, { top: 50, bottom: 90, offset: 10 },
        { top: 100, bottom: 140, offset: 20 }, { top: 150, bottom: 190, offset: 30 }, { top: 200, bottom: 240, offset: 40 },
    ];
    assert.deepEqual(pickBreaks(blocks, 0, 100), [20, 40]);
    assert.deepEqual(pickBreaks(blocks, 0, 1000), []);
    // A block without an offset stays with the one before it; a block taller than a page stays whole.
    assert.deepEqual(pickBreaks([{ top: 0, bottom: 80, offset: 0 }, { top: 80, bottom: 120, offset: null }, { top: 120, bottom: 130, offset: 5 }], 0, 100), [5]);
    assert.deepEqual(pickBreaks([{ top: 0, bottom: 500, offset: 0 }, { top: 500, bottom: 520, offset: 9 }], 0, 100), [9]);
});

test("a ::push left open on one page is closed by ::pop() on a later page", () => {
    const source = "---\nDefault Style: Default\nStyle:\n  Default:\n    normal: 11pt\n  Big:\n    normal: 16pt\n---\n\n::push(Big)\none\n\n::page\n\ntwo\n::pop()\n\nthree";
    const { body, styles } = readPage(source);
    const { sections } = applyStyleScopes(splitPages(parseDesk(body).children), styles!, "t");
    assert.equal(sections.length, 2);
    // An unmatched ::pop() would stay visible as a paragraph.
    const paragraphs: string[] = [];
    const walk = (nodes: typeof sections[number]) => nodes.forEach((node) => {
        if (node.type === "paragraph") paragraphs.push(body.slice(node.start, node.end).trim());
        else walk(node.children ?? []);
    });
    sections.forEach(walk);
    assert.deepEqual(paragraphs, ["one", "two", "three"]);
});

test("with text columns the page breaks before the first block past the last column", () => {
    // Two 90px columns with a 10px gap from x = 0.
    assert.equal(columnAt(0, 0, 90, 10), 0);
    assert.equal(columnAt(100, 0, 90, 10), 1);
    assert.equal(columnAt(200, 0, 90, 10), 2);
    const blocks = [
        { offset: 0, startColumn: 0, endColumn: 0 }, { offset: 10, startColumn: 0, endColumn: 1 },
        { offset: 20, startColumn: 1, endColumn: 2 }, { offset: 30, startColumn: 2, endColumn: 2 },
    ];
    // A block split between the columns of the page stays; the one reaching the third column moves.
    assert.deepEqual(pickColumnBreak(blocks, 2), [20]);
    assert.deepEqual(pickColumnBreak(blocks, 3), []);
    // The first block never moves, and one without an offset stays with the block before it.
    assert.deepEqual(pickColumnBreak([{ offset: 0, startColumn: 0, endColumn: 3 }], 2), []);
    assert.deepEqual(pickColumnBreak([{ offset: 0, startColumn: 0, endColumn: 0 }, { offset: null, startColumn: 2, endColumn: 2 }, { offset: 5, startColumn: 2, endColumn: 2 }], 2), [5]);
});
