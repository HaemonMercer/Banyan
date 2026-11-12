// GFM extension examples (from the GFM spec) and Banyan extensions.
// Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { extractLinks, extractTags, parse, renderHtml, summarize, type ParseOptions } from "../index.ts";

const GFM: ParseOptions = { gfm: true, bfm: false };
const BFM: ParseOptions = { gfm: true, bfm: true };

function check(name: string, md: string, html: string, opts: ParseOptions = BFM) {
    test(name, () => assert.equal(renderHtml(parse(md, opts)), html));
}

const tr = (tag: string, ...cells: string[]) => "<tr>\n" + cells.map((c) => `<${tag}${c}</${tag}>\n`).join("") + "</tr>\n";
const table = (head: string, body = "") => "<table>\n<thead>\n" + head + "</thead>\n" + (body ? "<tbody>\n" + body + "</tbody>\n" : "") + "</table>\n";

// ---- GFM: tables ----
check("GFM 198 table", "| foo | bar |\n| --- | --- |\n| baz | bim |\n", table(tr("th", ">foo", ">bar"), tr("td", ">baz", ">bim")), GFM);
check(
    "GFM 199 alignment",
    "| abc | defghi |\n:-: | -----------:\nbar | baz\n",
    table(tr("th", ' align="center">abc', ' align="right">defghi'), tr("td", ' align="center">bar', ' align="right">baz')),
    GFM,
);
check(
    "GFM 200 escaped pipes",
    "| f\\|oo  |\n| ------ |\n| b `\\|` az |\n| b **\\|** im |\n",
    table(tr("th", ">f|oo"), tr("td", ">b <code>|</code> az") + tr("td", ">b <strong>|</strong> im")),
    GFM,
);
check(
    "GFM 201 ends at block quote",
    "| abc | def |\n| --- | --- |\n| bar | baz |\n> bar\n",
    table(tr("th", ">abc", ">def"), tr("td", ">bar", ">baz")) + "<blockquote>\n<p>bar</p>\n</blockquote>\n",
    GFM,
);
check(
    "GFM 202 ends at blank line",
    "| abc | def |\n| --- | --- |\n| bar | baz |\nbar\n\nbar\n",
    table(tr("th", ">abc", ">def"), tr("td", ">bar", ">baz") + tr("td", ">bar", ">")) + "<p>bar</p>\n",
    GFM,
);
check("GFM 203 header/delimiter mismatch", "| abc | def |\n| --- |\n| bar |\n", "<p>| abc | def |\n| --- |\n| bar |</p>\n", GFM);
check(
    "GFM 204 short and long rows",
    "| abc | def |\n| --- | --- |\n| bar |\n| bar | baz | boo |\n",
    table(tr("th", ">abc", ">def"), tr("td", ">bar", ">") + tr("td", ">bar", ">baz")),
    GFM,
);
check("GFM 205 header only", "| abc | def |\n| --- | --- |\n", table(tr("th", ">abc", ">def")), GFM);
check(
    "table after a paragraph line",
    "intro\n| a | b |\n|---|---|\n| 1 | 2 |\n",
    "<p>intro</p>\n" + table(tr("th", ">a", ">b"), tr("td", ">1", ">2")),
    GFM,
);
check("setext heading is not a table", "abc\n---\n", "<h2>abc</h2>\n", GFM);

// ---- GFM: task lists ----
const box = '<input type="checkbox" disabled="" /> ';
const checked = '<input type="checkbox" checked="" disabled="" /> ';
check("GFM 279 task list", "- [ ] foo\n- [x] bar\n", `<ul>\n<li>${box}foo</li>\n<li>${checked}bar</li>\n</ul>\n`, GFM);
check(
    "GFM 280 nested task list",
    "- [x] foo\n  - [ ] bar\n  - [x] baz\n- [ ] bim\n",
    `<ul>\n<li>${checked}foo\n<ul>\n<li>${box}bar</li>\n<li>${checked}baz</li>\n</ul>\n</li>\n<li>${box}bim</li>\n</ul>\n`,
    GFM,
);
check("empty brackets alone are not a task", "- [ ]\n", "<ul>\n<li>[ ]</li>\n</ul>\n", GFM);

// ---- GFM: strikethrough ----
check("GFM 491 strikethrough", "~~Hi~~ Hello, ~there~ world!\n", "<p><del>Hi</del> Hello, <del>there</del> world!</p>\n", GFM);
check("GFM 492 not across paragraphs", "This ~~has a\n\nnew paragraph~~.\n", "<p>This ~~has a</p>\n<p>new paragraph~~.</p>\n", GFM);
check("GFM 493 three tildes", "This will ~~~not~~~ strike.\n", "<p>This will ~~~not~~~ strike.</p>\n", GFM);
check("BFM: single tilde is not strikethrough", "~~Hi~~ ~there~\n", "<p><del>Hi</del> ~there~</p>\n");

// ---- GFM: extended autolinks ----
const a = (href: string, text = href) => `<a href="${href}">${text}</a>`;
const www = (rest: string) => a("http://" + rest.replace(/&/g, "&amp;"), rest.replace(/&/g, "&amp;"));
check("GFM 621 www", "www.commonmark.org\n", `<p>${www("www.commonmark.org")}</p>\n`, GFM);
check(
    "GFM 622 www with path",
    "Visit www.commonmark.org/help for more information.\n",
    `<p>Visit ${www("www.commonmark.org/help")} for more information.</p>\n`,
    GFM,
);
check(
    "GFM 623 trailing period",
    "Visit www.commonmark.org.\n\nVisit www.commonmark.org/a.b.\n",
    `<p>Visit ${www("www.commonmark.org")}.</p>\n<p>Visit ${www("www.commonmark.org/a.b")}.</p>\n`,
    GFM,
);
const biz = "www.google.com/search?q=Markup+(business)";
check(
    "GFM 624 parentheses",
    `${biz}\n\n${biz}))\n\n(${biz})\n\n(${biz}\n`,
    `<p>${www(biz)}</p>\n<p>${www(biz)}))</p>\n<p>(${www(biz)})</p>\n<p>(${www(biz)}</p>\n`,
    GFM,
);
check("GFM 625 inner parentheses", "www.google.com/search?q=(business))+ok\n", `<p>${www("www.google.com/search?q=(business))+ok")}</p>\n`, GFM);
check(
    "GFM 626 entity at end",
    "www.google.com/search?q=commonmark&hl=en\n\nwww.google.com/search?q=commonmark&hl;\n",
    `<p>${www("www.google.com/search?q=commonmark&hl=en")}</p>\n<p>${www("www.google.com/search?q=commonmark")}&amp;hl;</p>\n`,
    GFM,
);
check("GFM 627 stops at <", "www.commonmark.org/he<lp\n", `<p>${www("www.commonmark.org/he")}&lt;lp</p>\n`, GFM);
check(
    "GFM 628 http",
    "http://commonmark.org\n\n(Visit https://encrypted.google.com/search?q=Markup+(business))\n",
    `<p>${a("http://commonmark.org")}</p>\n<p>(Visit ${a("https://encrypted.google.com/search?q=Markup+(business)")})</p>\n`,
    GFM,
);
check("GFM 629 email", "foo@bar.baz\n", `<p>${a("mailto:foo@bar.baz", "foo@bar.baz")}</p>\n`, GFM);
check(
    "GFM 630 email with +",
    "hello@mail+xyz.example isn't valid, but hello+xyz@mail.example is.\n",
    `<p>hello@mail+xyz.example isn't valid, but ${a("mailto:hello+xyz@mail.example", "hello+xyz@mail.example")} is.</p>\n`,
    GFM,
);
check(
    "GFM 631 email endings",
    "a.b-c_d@a.b\n\na.b-c_d@a.b.\n\na.b-c_d@a.b-\n\na.b-c_d@a.b_\n",
    `<p>${a("mailto:a.b-c_d@a.b", "a.b-c_d@a.b")}</p>\n<p>${a("mailto:a.b-c_d@a.b", "a.b-c_d@a.b")}.</p>\n<p>a.b-c_d@a.b-</p>\n<p>a.b-c_d@a.b_</p>\n`,
    GFM,
);
check("URL next to Chinese", "見https://example.com，再說\n", '<p>見<a href="https://example.com">https://example.com</a>，再說</p>\n');
check("no autolink inside a word", "xhttp://a.com\n", "<p>xhttp://a.com</p>\n", GFM);

// ---- GFM: footnotes ----
check(
    "footnote",
    "Text[^1].\n\n[^1]: The note.\n",
    '<p>Text<sup class="footnote-ref"><a href="#fn-1">1</a></sup>.</p>\n<section class="footnotes">\n<ol>\n<li id="fn-1">\n<p>The note.</p>\n</li>\n</ol>\n</section>\n',
    GFM,
);
check("undefined footnote stays text", "Text[^x].\n", "<p>Text[^x].</p>\n", GFM);

// ---- BFM ----
check("highlight", "a ==b== c\n", "<p>a <mark>b</mark> c</p>\n");
check("highlight colour", "==b=={pink} c\n", '<p><mark class="pink">b</mark> c</p>\n');
check("unknown colour stays text", "==b=={red}\n", "<p><mark>b</mark>{red}</p>\n");
check("single = is text", "a = b == c\n", "<p>a = b == c</p>\n");
check(
    "wiki link",
    "see [[card:42|心流]] and [[Plain]]\n",
    '<p>see <a class="wikilink" data-target="card:42">心流</a> and <a class="wikilink" data-target="Plain">Plain</a></p>\n',
);
check("embed", "![[@kahneman2011]]\n", '<p><a class="wikilink embed" data-target="@kahneman2011">@kahneman2011</a></p>\n');
check(
    "wiki link in a table uses \\|",
    "| a |\n|---|\n| [[x\\|y]] |\n",
    table(tr("th", ">a"), tr("td", '><a class="wikilink" data-target="x">y</a>')),
);
check("tags", "#讀書/哲學，明天 #2024 C#\n", '<p><span class="tag">#讀書/哲學</span>，明天 #2024 C#</p>\n');
check("inline math", "式 $a^2$ 與 $5 和 $10\n", '<p>式 <span class="math inline">a^2</span> 與 $5 和 $10</p>\n');
check("display math on one line", "$$x$$\n", '<div class="math display">x</div>\n');
check("math block", "$$\na\n\\\\ b\n$$\n", '<div class="math display">a\n\\\\ b</div>\n');
check("escaped dollar", "\\$x$\n", "<p>$x$</p>\n");
check("comment inline", "a %% hidden %% b\n", "<p>a  b</p>\n");
check("comment block", "%%\nsecret\n\nmore\n%%\nshown\n", "<p>shown</p>\n");
check(
    "callout",
    "> [!warning]- 小心\n> 內容\n",
    '<div class="callout callout-warning">\n<p class="callout-title">小心</p>\n<p>內容</p>\n</div>\n',
);
check("callout without body", "> [!tip]\n", '<div class="callout callout-tip">\n</div>\n');
check("CJK: bold next to full-width punctuation", "**「引號」**後面\n", "<p><strong>「引號」</strong>後面</p>\n");
check("CJK: bold before full-width punctuation", "這是**重點**。\n", "<p>這是<strong>重點</strong>。</p>\n");
check("CJK: emphasis inside a sentence", "中文*斜體*中文\n", "<p>中文<em>斜體</em>中文</p>\n");
check("full-width symbols are text", "＊不是＊ ＃不是\n", "<p>＊不是＊ ＃不是</p>\n");

test("soft breaks as <br /> when asked", () => {
    assert.equal(renderHtml(parse("a\nb\n"), { breaks: true }), "<p>a<br />\nb</p>\n");
});

test("summarize", () => {
    assert.equal(summarize("# 標題\n\n- **一**\n- [[card:1|二]]\n\n%% x %%\n"), "標題 · 一 二");
    assert.equal(summarize("a".repeat(50), 10), "aaaaaaaaa…");
});

test("extractLinks / extractTags", () => {
    assert.deepEqual(
        extractLinks("[[a]] ![[b|B]] [[a|again]]").map((l) => [l.target, l.embed]),
        [
            ["a", false],
            ["b", true],
        ],
    );
    assert.deepEqual(extractTags("#x #y/z #x"), ["x", "y/z"]);
});

test("source positions", () => {
    const src = "> **bold** text\n> more";
    const doc = parse(src);
    const p = doc.children[0].children![0];
    const strong = p.children![0];
    assert.equal(src.slice(strong.children![0].start, strong.children![0].end), "bold");
    const more = p.children!.find((n) => n.type === "text" && n.value === "more")!;
    assert.equal(src.slice(more.start, more.end), "more");
});

test("never throws on odd input", () => {
    const pieces = ["*", "_", "[", "]", "(", ")", "`", "$", "=", "~", "#", "%", "|", "\\", "<", ">", "!", "\n", " ", "a", "中", "-", "1.", ":", "^", "{", "}", "\t"];
    let seed = 1;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 3000; i++) {
        let s = "";
        const len = Math.floor(rand() * 40);
        for (let j = 0; j < len; j++) s += pieces[Math.floor(rand() * pieces.length)];
        try {
            renderHtml(parse(s));
        } catch (e) {
            throw new Error(`input ${JSON.stringify(s)}: ${(e as Error).message}`);
        }
    }
});
