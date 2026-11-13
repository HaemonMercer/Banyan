// Text written into a card when an annotation or a text card is dragged onto it.
// Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { extractCitations, extractLinks, parse, plainText } from "../../markdown/index.ts";
import { annotationBlock, appendBlock, cardBlock, plainToMarkdown } from "../quote.ts";

test("plain text stays plain text", () => {
    const raw = "# 不是標題\n1. 不是清單 *不是斜體* [不是連結] 而@王2020不是引用 a@b.com";
    const md = plainToMarkdown(raw);
    const doc = parse(md);
    assert.equal(doc.children.length, 1);
    assert.equal(doc.children[0].type, "paragraph");
    assert.deepEqual(extractCitations(md), []);
    assert.equal(plainText(parse(md).children).replace(/\s+/g, " ").trim(), raw.replace(/\s+/g, " "));
});

test("annotation quote with its citation and note", () => {
    const md = annotationBlock("系統一快速而直覺，\n系統二緩慢。", "kahneman2011:h3", "我的想法");
    const doc = parse(md);
    assert.equal(doc.children[0].type, "blockquote");
    assert.equal(doc.children[1].type, "paragraph");
    assert.deepEqual(
        extractCitations(md),
        ["kahneman2011:h3"],
    );
    // No key yet: just the quote.
    assert.deepEqual(extractCitations(annotationBlock("一段話", null)), []);
});

test("text card as a quote that links back", () => {
    const md = cardBlock(42, "原子習慣 | 摘要]", "- 第一點\n- 第二點");
    const doc = parse(md);
    assert.equal(doc.children.length, 1);
    assert.equal(doc.children[0].type, "blockquote");
    assert.deepEqual(
        extractLinks(md).map((l) => l.target),
        ["card:42"],
    );
});

test("appending keeps a blank line between paragraphs", () => {
    assert.equal(appendBlock("", "> a"), "> a");
    assert.equal(appendBlock("前文\n\n", "> a"), "前文\n\n> a");
});
