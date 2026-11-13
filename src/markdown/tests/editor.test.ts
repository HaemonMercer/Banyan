// The editor's load/save round trip.
// Run: npm test
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { EditorState, TextSelection } from "prosemirror-state";
import { load, positionForOffset, save, schema } from "../editorCore.ts";
import { parse, renderHtml } from "../index.ts";

const require = createRequire(import.meta.url);
const spec = require("commonmark-spec") as { tests: { markdown: string; number: number }[] };

/**
 * Examples whose meaning cannot survive regeneration, because the editor model cannot hold it:
 * the same mark nested in itself (`*a *b**`), line breaks inside a setext heading, links without text.
 */
const UNREPRESENTABLE = new Set([81, 82, 95, 369, 373, 389, 407, 408, 409, 417, 418, 419, 425, 426, 427, 432, 461, 463, 464, 465, 466, 468, 484, 487]);

const html = (md: string) => renderHtml(parse(md));

const SAMPLES = [
    "# 研究筆記\n\n這是**粗體**、*斜體*、~~刪除~~、==螢光==、==粉紅=={pink}、`code`，連到 [[card:42|心流理論]] 與 #讀書/哲學。\n第二行。",
    "> [!warning]- 小心\n> 內容 $E = mc^2$\n> - 清單\n\n- [ ] 待辦\n- [x] 完成\n  1. 子項目\n  2. 再一個",
    "| a | b |\n|:--|--:|\n| 1 | [[x\\|y]] |\n\n$$\n\\int x\\,dx\n$$\n\n%%\n秘密\n%%\n\n文字[^1]\n\n[^1]: 腳註\n\n[ref]: https://example.com",
    "見https://example.com，再說 www.commonmark.org/help 與 foo@bar.baz\n\n![圖](https://example.com/a.png \"標題\") <b>html</b> \\# 不是標題",
    "　　全形空格開頭的段落\n\n1) 第一\n2) 第二\n\n* 甲\n* 乙\n\n- 丙",
];

test("unchanged documents save byte for byte (CommonMark examples)", () => {
    for (const t of spec.tests) {
        const md = t.markdown.replace(/→/g, "\t");
        const l = load(md);
        assert.equal(save(l.doc, l), md, `example ${t.number}`);
    }
});

test("unchanged documents save byte for byte (Banyan samples)", () => {
    for (const md of SAMPLES) {
        const l = load(md);
        assert.equal(save(l.doc, l), md);
    }
});

test("regenerated documents keep their meaning (CommonMark examples)", () => {
    for (const t of spec.tests) {
        if (UNREPRESENTABLE.has(t.number)) continue;
        const md = t.markdown.replace(/→/g, "\t");
        const out = save(load(md).doc, null);
        assert.equal(html(out), html(md), `example ${t.number}: ${JSON.stringify(out)}`);
    }
});

test("regenerated documents keep their meaning (Banyan samples)", () => {
    for (const md of SAMPLES) {
        const out = save(load(md).doc, null);
        assert.equal(html(out), html(md), JSON.stringify(out));
    }
});

test("editing one block leaves the others as written", () => {
    const md = "# 標題  \n\n*  隨意的   清單\n*  第二項\n\n要改的段落\n\n[ref]: /url\n\n最後   一段";
    const l = load(md);
    const state = EditorState.create({ doc: l.doc, schema });
    let paraPos = -1;
    state.doc.forEach((node, pos) => {
        if (node.textContent === "要改的段落") paraPos = pos;
    });
    assert.ok(paraPos >= 0);
    const tr = state.tr.insertText("新的", paraPos + 1);
    const out = save(tr.doc, l);
    assert.equal(out, "# 標題  \n\n*  隨意的   清單\n*  第二項\n\n新的要改的段落\n\n[ref]: /url\n\n最後   一段");
});

test("typed text that looks like syntax stays text", () => {
    const cases = [
        "# 不是標題",
        "1. 不是清單",
        "- 不是清單",
        "> 不是引用",
        "*星號* 與 _底線_ 與 snake_case_name",
        "$5 和 $10，以及 $x$",
        "[[不是連結]] 與 [方括號](不是連結)",
        "==不是螢光== ~~不是刪除~~ %%不是註解%%",
        "<div> 與 &amp; 與 C:\\Users\\",
        "!結尾驚嘆號!",
        "---",
        "```",
        "寄到 a@b.com 或找 @某人，@kahneman2011 不是引用",
    ];
    for (const text of cases) {
        const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, schema.text(text)));
        const out = save(doc, null);
        const tree = parse(out);
        assert.equal(tree.children.length, 1, `${text} → ${out}`);
        assert.equal(tree.children[0].type, "paragraph", `${text} → ${out}`);
        const textOf = (nodes: typeof tree.children): string =>
            nodes.map((n) => (n.type === "tag" ? "#" + n.name : n.type === "link" ? textOf(n.children ?? []) : n.type === "citation" ? "<cite>" : n.value ?? "")).join("");
        const plain = textOf(tree.children[0].children ?? []);
        assert.equal(plain, text, `${text} → ${out}`);
    }
});

test("new blocks are separated from the old ones", () => {
    const md = "段落\n- 清單";
    const l = load(md);
    // Replace the list with a paragraph: it must not join the paragraph above.
    const tr = EditorState.create({ doc: l.doc }).tr;
    const listPos = l.doc.child(0).nodeSize;
    tr.replaceWith(listPos, listPos + l.doc.child(1).nodeSize, schema.nodes.paragraph.create(null, schema.text("新段落")));
    const out = save(tr.doc, l);
    assert.equal(html(out), "<p>段落</p>\n<p>新段落</p>\n");
});

test("click offsets map to editor positions", () => {
    const md = "> **粗體** 文字\n\n- [ ] 待辦一";
    const l = load(md);
    const at = (needle: string, k = 0) => {
        const pos = positionForOffset(l, md.indexOf(needle) + k)!;
        const state = EditorState.create({ doc: l.doc, selection: TextSelection.create(l.doc, pos) });
        const $p = state.selection.$from;
        return $p.parent.textBetween($p.parentOffset, Math.min($p.parent.content.size, $p.parentOffset + 2));
    };
    assert.equal(at("粗體", 1), "體 ");
    assert.equal(at("文字"), "文字");
    assert.equal(at("待辦一", 2), "一");
});
