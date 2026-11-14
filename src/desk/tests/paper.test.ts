import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PAGE, pageInk, pageInsets, paperSize, readPage, replacePageBody, runningLineOffset, runningLines, writePage } from "../paper.ts";
import { splitSlides } from "../markdown.ts";

test("YAML mode selects the document view and stays out of the slide content", () => {
    const body = "# 第一張\n\n---\n\n# 第二張";
    const source = '---\nmode: "slides"\n---\n\n' + body;
    const slides = readPage(source);
    assert.equal(slides.mode, "slides");
    assert.deepEqual(splitSlides(slides.body), ["# 第一張", "# 第二張"]);
    assert.equal(readPage(writePage(slides.page, body, slides.prefix)).mode, "slides");
    assert.equal(readPage(writePage(DEFAULT_PAGE, "", "", "writer")).mode, "writer");
    assert.equal(readPage("---\nmode: other\n---\n\n正文").mode, undefined);
});

test("page settings survive Markdown export without exposing header text as markup", () => {
    const page = { ...DEFAULT_PAGE, color: "#262626", header: { left: ["pageNumber", '研究 --> "稿"'], center: [], right: [] },
        footer: { left: [], center: ["頁尾"], right: [] }, padding: { top: 0, right: 4, bottom: 24, left: 7 } };
    const body = "# 正文\r\n\r\n::page\r\n";
    const markdown = writePage(page, body);
    assert.match(markdown, /^---\npage:\n/);
    const restored = readPage(markdown);
    assert.deepEqual(restored.page, page);
    assert.equal(restored.body, body);
    assert.deepEqual(pageInsets(page), { top: 10, right: 4, bottom: 24, left: 7 });
    assert.equal(pageInk(page.color), "#ffffff");
    assert.equal(pageInk(DEFAULT_PAGE.color), "#000000");
});

test("YAML updates preserve unrelated metadata and visual edits preserve the original YAML", () => {
    const markdown = '---\r\ntitle: 報告\r\npage:\r\n  paper: A5 # 紙張\r\n  custom: keep\r\n  padding: {left: 25, custom: keep}\r\n---\r\n\r\n正文';
    const { page, body, prefix } = readPage(markdown);
    assert.equal(page.paper, "a5");
    assert.equal(page.padding.left, 25);
    assert.equal(replacePageBody("新版", page, prefix), markdown.replace("正文", "新版"));
    const updated = writePage({ ...page, footer: { ...page.footer, center: ["頁尾"] } }, body, prefix);
    assert.match(updated, /title: 報告/);
    assert.match(updated, /# 紙張/);
    assert.equal(updated.match(/custom: keep/g)?.length, 2);
    assert.deepEqual(readPage(updated).page.footer.center, ["頁尾"]);
    assert.equal(readPage("---\n\n一般段落\n\n---\n").body, "---\n\n一般段落\n\n---\n");
    assert.equal(readPage("---\npage: [\n---\n\n正文").invalidYaml, true);
});

test("editing the body upgrades legacy page settings", () => {
    const old = '<!-- desk-page {"paper":"letter","header":"報告"} -->\n\n舊文';
    const { page, prefix } = readPage(old);
    const updated = replacePageBody("新版", page, prefix);
    assert.match(updated, /^---\npage:\n/);
    assert.deepEqual(readPage(updated).page.header.center, ["報告"]);
    assert.equal(readPage(updated).body, "新版");
});

test("page numbering defaults on and can be disabled through YAML", () => {
    assert.equal(readPage("正文").page.pageNumbers, true);
    const page = { ...DEFAULT_PAGE, padding: { ...DEFAULT_PAGE.padding, bottom: 0 } };
    assert.equal(pageInsets(page).bottom, 10);
    const disabled = readPage(writePage({ ...page, pageNumbers: false }, "正文")).page;
    assert.equal(disabled.pageNumbers, false);
    assert.equal(pageInsets(disabled).bottom, 0);
});

test("padding accepts a uniform value or a top-right-bottom-left tuple", () => {
    const withPadding = (padding: string) => readPage(`---\npage:\n  padding: ${padding}\n---\n\n正文`).page.padding;
    assert.deepEqual(withPadding("20"), { top: 20, right: 20, bottom: 20, left: 20 });
    assert.deepEqual(withPadding("(10, 20.5, 30, 40)"), { top: 10, right: 20.5, bottom: 30, left: 40 });
    assert.deepEqual(withPadding("(10, nope, 30, 40)"), DEFAULT_PAGE.padding);
    assert.match(writePage(DEFAULT_PAGE, ""), /padding: 18\n/);
    assert.match(writePage({ ...DEFAULT_PAGE, padding: withPadding("(10, 20, 30, 40)") }, ""), /padding: \(10, 20, 30, 40\)/);
});

test("running lines move with the effective top and bottom insets", () => {
    const page = { ...DEFAULT_PAGE, padding: { top: 20, right: 18, bottom: 2, left: 18 } };
    const insets = pageInsets(page);
    assert.equal(runningLineOffset(insets.top), 8);
    assert.equal(runningLineOffset(insets.bottom), 3);
    assert.equal(runningLineOffset(pageInsets({ ...page, padding: { ...page.padding, bottom: 30 } }).bottom), 13);
});

test("page settings validate external Markdown and preserve malformed comments", () => {
    const malformed = "<!-- desk-page nope -->\n\n正文";
    const read = readPage(malformed);
    assert.deepEqual({ page: read.page, body: read.body }, { page: DEFAULT_PAGE, body: malformed });
    assert.equal(read.styles?.size, 0);
    const { page, body } = readPage('<!-- desk-page {"color":"red;","padding":{"left":900,"right":-4}} -->\n\n正文');
    assert.deepEqual(page.padding, { top: 18, right: 0, bottom: 18, left: 60 });
    assert.equal(page.color, DEFAULT_PAGE.color);
    assert.equal(body, "正文");
});

test("orientation, columns and the first page are read, clamped and written only when set", () => {
    const { page } = readPage("---\npage:\n  paper: B5 (JIS)\n  orientation: landscape\n  columns: 9\n  columnGap: 12\n  columnRule: true\n  differentFirstPage: true\n---\n\nx");
    assert.equal(page.paper, "b5");
    assert.deepEqual(paperSize(page), { width: 257, height: 182 });
    assert.equal(page.columns, 4);
    assert.equal(page.columnGap, 12);
    assert.equal(page.columnRule, true);
    assert.equal(page.differentFirstPage, true);
    assert.deepEqual(runningLines(page, 0)("footer", "center"), []);
    assert.deepEqual(runningLines(page, 1)("footer", "center"), ["pageNumber"]);
    assert.equal(readPage("---\npage:\n  paper: tabloid\n  columns: two\n---\n\nx").page.paper, "a4");

    // Defaults stay out of the YAML; setting them back removes the keys.
    const plain = writePage(DEFAULT_PAGE, "x");
    assert.doesNotMatch(plain, /orientation|columns|columnGap|columnRule|differentFirstPage/);
    const wide = writePage({ ...DEFAULT_PAGE, orientation: "landscape", columns: 2 }, "x", plain.slice(0, plain.indexOf("x")));
    assert.match(wide, /\n {2}orientation: landscape\n/);
    // The default gap stays out too.
    assert.match(wide, /\n {2}columns: 2\n/);
    assert.doesNotMatch(wide, /columnGap/);
    assert.match(writePage({ ...DEFAULT_PAGE, columns: 3, columnGap: 12 }, "x"), /\n {2}columns: 3\n {2}columnGap: 12\n/);
    assert.equal(readPage(wide).page.columns, 2);
    const back = writePage(DEFAULT_PAGE, "x", wide.slice(0, wide.indexOf("x")));
    assert.doesNotMatch(back, /orientation|columns|columnGap/);
});
