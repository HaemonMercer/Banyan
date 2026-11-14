import assert from "node:assert/strict";
import test from "node:test";
import { columnWidths, parseDesk, splitSlides } from "../markdown.ts";
import { readPage } from "../paper.ts";

test("unfinished box preserves paragraph alignment and pagination that follow it", () => {
    const source = "---\npage:\n  paper: a5\n---\n::box\n\n::right{adfasfd}\n\n段落\n\n::page\n\n**afassfa**";
    const [opener, aligned, normal, page, styled] = parseDesk(readPage(source).body).children;
    assert.equal(opener.children?.[0].value, "::box");
    assert.equal(aligned.kind, "right");
    assert.equal(normal.children?.[0].value, "段落");
    assert.equal(page.type, "pageBreak");
    assert.equal(styled.children?.[0].type, "strong");
});

test("Desk boxes accept empty braces, Markdown and nested layout", () => {
    const [empty, box, legacy] = parseDesk("::box{}\n\n::box{\n# 標題\n\n::center{**置中**}\n}\n\n::box\n\n舊寫法\n\n::").children;
    assert.equal(empty.kind, "box");
    assert.deepEqual(empty.children, []);
    assert.equal(box.kind, "box");
    assert.equal(box.children?.[0].type, "heading");
    assert.equal(box.children?.[1].kind, "center");
    assert.equal(legacy.kind, "box");
});

test("Desk alignment works with braces and with compact legacy blocks", () => {
    for (const kind of ["left", "center", "right", "justify"]) {
        assert.equal(parseDesk(`::${kind}{**正文**}`).children[0].kind, kind);
        assert.equal(parseDesk(`::${kind}\n正文\n::`).children[0].kind, kind);
        assert.equal(parseDesk(`::${kind}\n\n正文\n\n::`).children[0].kind, kind);
    }
    const nested = parseDesk("::Col(){::center{左}},{::right{右}}").children[0];
    assert.equal(nested.children?.[0].children?.[0].kind, "center");
    assert.equal(nested.children?.[1].children?.[0].kind, "right");
});

test("Col accepts its opening brace and subsequent columns on separate lines", () => {
    const source = "---\r\nmode: writer\r\n---\r\n::Col(3:1:1)\r\n{左欄\r\n# sadfasf\r\n\r\n},\r\n{右欄},\r\n{FFFadfa}\r\n\r\n後續正文";
    const [columns, tail] = parseDesk(readPage(source).body).children;
    assert.equal(columns.kind, "columns");
    assert.deepEqual(columns.columnWidths, [3, 1, 1]);
    assert.equal(columns.children?.length, 3);
    assert.equal(columns.children?.[0].children?.[1].type, "heading");
    assert.equal(tail.children?.[0].value, "後續正文");
    assert.equal(parseDesk("::Col()\n{甲}\n{乙}\n{丙}").children[0].children?.length, 3);
});

test("writer preview recognizes three columns directly after the YAML closing fence", () => {
    const source = '---\nmode: writer\npage:\n  paper: a4\n  padding: 18\n  color: "#ffffff"\n  header:\n    left: []\n    center: []\n    right: []\n  footer:\n    left: []\n    center:\n      - pageNumber\n    right: []\n  pageNumbers: true\n---\n::Col(){左欄},{右欄},{FFF}\n';
    const { mode, body } = readPage(source);
    assert.equal(mode, "writer");
    const [columns] = parseDesk(body).children;
    assert.equal(columns.kind, "columns");
    assert.deepEqual(columns.children?.map((column) => column.children?.[0].children?.[0].value), ["左欄", "右欄", "FFF"]);
});

test("custom two-column ratios accept positive decimals and retain equal defaults", () => {
    assert.deepEqual(parseDesk("::Col(3:2){左},{右}").children[0].columnWidths, [3, 2]);
    assert.deepEqual(parseDesk("::Col(1 : 2.5){左},{右}").children[0].columnWidths, [1, 2.5]);
    assert.equal(parseDesk("::Col(){左},{右}").children[0].columnWidths, undefined);
    assert.equal(parseDesk("::Col(1:0){左},{右}").children[0].type, "paragraph");
    assert.equal(columnWidths("-1:2"), null);
    assert.equal(parseDesk("::Col(1:2:3){左},{右}").children[0].type, "paragraph");
});

test("compact Col creates one column per outer brace group", () => {
    const [columns] = parseDesk("::Col(2:1:1:2){**一**},{},\n{::center{三}}{四}").children;
    assert.deepEqual(columns.columnWidths, [2, 1, 1, 2]);
    assert.equal(columns.children?.length, 4);
    assert.equal(columns.children?.[1].children?.length, 0);
    assert.equal(columns.children?.[2].children?.[0].kind, "center");
    assert.equal(parseDesk("::Col(){一}{二}{三}").children[0].children?.length, 3);
    assert.equal(parseDesk("::Col(){一}").children[0].children?.length, 1);
});

test("slide boundaries ignore fenced and nested horizontal rules", () => {
    const first = "# 標題\r\n\r\n```md\r\n---\r\n```\r\n\r\n> ---";
    assert.deepEqual(splitSlides(`${first}\r\n\r\n---\r\n\r\n# 下一張`), [first, "# 下一張"]);
    assert.deepEqual(splitSlides("標題\n---"), ["標題\n---"]);
    assert.deepEqual(splitSlides("標題\n\n***\n\n內文"), ["標題\n\n***\n\n內文"]);
});

test("Desk layout preserves nested Markdown and slide separators inside columns", () => {
    const source = '::::columns{widths="2 1"}\n\n:::column\n\n# 標題\n\n---\n\n[@smith]\n\n:::\n\n:::column\n\n:::box\n\n![[@smith:h1]]\n\n:::\n\n:::\n\n::::';
    const [columns, toc, pageBreak] = parseDesk(source + "\n\n::toc{depth=3}\n\n::pagebreak").children;
    assert.equal(columns.kind, "columns");
    assert.equal(columns.value, "wide");
    assert.equal(columns.children?.[0].children?.[0].type, "heading");
    assert.equal(columns.children?.[1].children?.[0].kind, "box");
    assert.equal(toc.type, "toc");
    assert.equal(pageBreak.type, "pageBreak");
    assert.deepEqual(splitSlides(source + "\n\n---\n\n第二張"), [source, "第二張"]);
});

test("unfinished layout directives and fenced examples remain ordinary Markdown", () => {
    assert.deepEqual(parseDesk(":::center\n\n# 標題").children.map((node) => node.type), ["paragraph", "heading"]);
    assert.equal(parseDesk("```md\n::toc\n```").children[0].type, "codeBlock");
});

test("short Desk directives render columns, nested alignment and document blocks", () => {
    const source = "::cols 2:1\r\n\r\n# 主欄\r\n\r\n::next\r\n\r\n::center\r\n\r\n側欄\r\n\r\n::\r\n\r\n::";
    const [columns, toc, page, refs] = parseDesk(source + "\r\n\r\n::toc\r\n\r\n::page\r\n\r\n::refs").children;
    assert.equal(columns.value, "wide");
    assert.deepEqual(columns.children?.map((column) => column.kind), ["column", "column"]);
    assert.equal(columns.children?.[0].children?.[0].type, "heading");
    assert.equal(columns.children?.[1].children?.[0].kind, "center");
    assert.deepEqual([toc.type, page.type, refs.type], ["toc", "pageBreak", "bibliography"]);
    assert.equal(parseDesk("::box\n\n內容").children[0].type, "paragraph");
});

test("compact columns accept Markdown, balanced braces and multiple paragraphs", () => {
    const source = "::Col(2:1){# 主欄\n\n[@smith] 與 `{x}`},{**側欄**, 右側}\n後續段落";
    const [columns, tail] = parseDesk(source).children;
    assert.deepEqual(columns.columnWidths, [2, 1]);
    assert.deepEqual(columns.children?.[0].children?.map((node) => node.type), ["heading", "paragraph"]);
    assert.equal(columns.children?.[1].children?.[0].children?.[0].type, "strong");
    assert.equal(tail.type, "paragraph");
    assert.equal(parseDesk("::Col(){左欄},{右欄}").children[0].kind, "columns");
    assert.equal(parseDesk("::Col(){左欄},{未結束").children[0].type, "paragraph");
    assert.equal(parseDesk("```md\n::Col(){左欄},{右欄}\n```").children[0].type, "codeBlock");
});

test("parseDesk reuses the result for unchanged text", () => {
    const source = "::center{置中}\n\n段落";
    assert.equal(parseDesk(source), parseDesk(source));
});

test("long embedded image URLs keep their destination", () => {
    const data = "data:image/png;base64," + "A".repeat(200_000) + "+/=";
    const image = parseDesk(`![圖](${data})`).children[0].children?.[0];
    assert.equal(image?.type, "image");
    assert.equal(image?.url, data);
});

test("legacy alignment blocks after other directives still parse", () => {
    const doc = parseDesk("::center{上方}\n\n::right\n靠右\n::\n\n結尾");
    assert.deepEqual(doc.children.map((node) => node.kind ?? node.type), ["center", "right", "paragraph"]);
});
