import assert from "node:assert/strict";
import test from "node:test";
import { alignRange, deskFormatAt, formatDeskSource, setDeskHeading } from "../sourceTools.ts";

test("cursor resolves the existing alignment directive for in-place editing", () => {
    const source = "::center{對齊文字}";
    const current = deskFormatAt(source, source.indexOf("文字"));
    assert.equal(current.alignment?.name, "center");
    assert.equal(source.slice(current.alignment?.from, current.alignment?.to), "center");
});

test("Markdown paragraph format replaces heading markers and preserves YAML", () => {
    const source = "---\nmode: writer\n---\n\n## 標題 ##\n\n正文\n下一行";
    assert.equal(deskFormatAt(source, source.indexOf("標題")).heading, 2);
    const changed = setDeskHeading(source, source.indexOf("標題"), source.length, 3);
    assert.equal(changed, "---\nmode: writer\n---\n\n### 標題\n\n### 正文\n\n下一行");
    assert.equal(setDeskHeading(changed, changed.indexOf("標題"), changed.indexOf("標題"), 0),
        "---\nmode: writer\n---\n\n標題\n\n### 正文\n\n下一行");
});

test("cursor resolves Markdown emphasis and a word range", () => {
    const source = "---\nmode: writer\n---\n\n前 **word** 後\n\n普通";
    const index = source.indexOf("word");
    const current = deskFormatAt(source, index + 2);
    assert.equal(current.bold, true);
    assert.deepEqual(current.range, { from: index, to: index + 4 });
});

test("formats YAML, Markdown headings and JSON while preserving code literals", () => {
    const source = '---\npage:\n    paper: a4\n---\n\n#    標題\n\n```json\n{"a":1}\n```\n\n```md\n#    原樣\n```\n';
    const result = formatDeskSource(source);
    assert.equal(result, '---\npage:\n  paper: a4\n---\n\n# 標題\n\n```json\n{\n  "a": 1\n}\n```\n\n```md\n#    原樣\n```\n');
    assert.equal(formatDeskSource(result), result);
});

test("aligning a selection wraps only the selected text as its own block", () => {
    const source = "前面的文字 中間要置中 後面的文字\n\n下一段";
    const from = source.indexOf("中間");
    const { text, caret } = alignRange(source, from, from + "中間要置中".length, "center")!;
    assert.equal(text, "前面的文字\n\n::center{中間要置中}\n\n後面的文字\n\n下一段");
    assert.equal(text[caret], "}");
    const whole = alignRange("一\n\n二", 0, 1, "right")!;
    assert.equal(whole.text, "::right{一}\n\n二");
});

test("selecting the whole content of an alignment block switches it", () => {
    const source = "::center{ 置中的段落 }\n\n其他";
    const from = source.indexOf("置中");
    const { text } = alignRange(source, from, from + "置中的段落".length, "right")!;
    assert.equal(text, "::right{ 置中的段落 }\n\n其他");
    // Part of the block: a new block inside it.
    const part = alignRange(source, from, from + 2, "left")!;
    assert.equal(part.text, "::center{\n\n::left{置中}\n\n的段落 }\n\n其他");
    assert.equal(alignRange(source, 2, 2, "left"), null);
});
