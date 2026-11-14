import assert from "node:assert/strict";
import test from "node:test";
import type { MdNode } from "../../markdown/ast.ts";
import { parseDesk } from "../markdown.ts";
import { prepareYaml, readPage, unquoteYaml } from "../paper.ts";
import {
    applyStyleScopes, groupAt, joinColor, normalizeShortcut, parseShorthand, readStyles, scanStyles, scopeCss, shortcutFromEvent, splitColor,
    styleForShortcut, styleKey, writeShorthand,
} from "../styles.ts";

const example = `---
Style:
  style A:
    text:
      bold:
        color: "#fafafa"
        size: 10
      custome A:
        size: 24
    paragraph:
      heading:
        color: "#ab2943"
  Style B:
    highlight:
      size: 10
---

::push(styleA)
**f**::style(custome A){afasaf}
::pop()
`;

const kinds = (nodes: MdNode[]) => nodes.map((node) => node.kind ?? node.type);

test("style groups read text, custom and paragraph styles", () => {
    const { styles } = readPage(example);
    const a = styles!.get("stylea")!;
    assert.deepEqual(a.marks.bold, { color: "#fafafa", "font-size": "10pt" });
    assert.deepEqual(a.custom.customea, { name: "custome A", props: { "font-size": "24pt" } });
    assert.deepEqual(a.paragraph.heading, { color: "#ab2943" });
    // Marks may sit directly under a group.
    assert.deepEqual(styles!.get("styleb")!.marks.highlight, { "font-size": "10pt" });
});

test("names ignore spaces and case", () => {
    assert.equal(styleKey("Style A"), styleKey("stylea"));
    assert.equal(styleKey("custome A"), "customea");
});

test("push and pop lines split a paragraph without blank lines", () => {
    const doc = parseDesk("::push(styleA)\n**f**::style(custome A){afasaf}\n::pop()");
    assert.deepEqual(kinds(doc.children), ["stylePush", "paragraph", "stylePop"]);
    assert.equal(doc.children[0].name, "styleA");
    const [bold, styled] = doc.children[1].children!;
    assert.equal(bold.type, "strong");
    assert.equal(styled.type, "deskStyle");
    assert.equal(styled.name, "custome A");
    assert.equal(styled.children?.[0].value, "afasaf");
});

test("::style keeps nested Markdown and braces", () => {
    const [paragraph] = parseDesk("a ::style(x){**b** {c}} d").children;
    const styled = paragraph.children!.find((node) => node.type === "deskStyle")!;
    assert.deepEqual(styled.children!.map((node) => node.type), ["strong", "text"]);
    assert.equal(styled.children![1].value, " {c}");
});

test("scopes nest, continue across pages and resolve styles in the current group only", () => {
    const { styles, body } = readPage(example.replace("::pop()", "::push(Style B)\n\n::style(custome A){inner}\n\n::pop()\n\n::page\n\nnext\n\n::pop()"));
    const doc = parseDesk(body);
    const pages: MdNode[][] = [[]];
    for (const block of doc.children) {
        if (block.type === "pageBreak") pages.push([]);
        else pages[pages.length - 1].push(block);
    }
    const { sections, css } = applyStyleScopes(pages, styles!, "t");
    const [outer] = sections[0];
    assert.equal(outer.kind, "styleScope");
    assert.equal(outer.value, "t0");
    const [paragraph, inner] = outer.children!;
    assert.equal(paragraph.children![1].value, "t0:customea");
    assert.equal(inner.kind, "styleScope");
    // Style B has no "custome A": only the current group counts.
    assert.equal(inner.children![0].children![0].value, undefined);
    // The outer scope is still open on the next page.
    assert.equal(sections[1][0].kind, "styleScope");
    assert.equal(sections[1][0].value, "t0");
    assert.match(css, /\[data-desk-scope="t0"\]\[data-desk-scope="t0"\] strong \{ color: #fafafa; font-size: 10pt; \}/);
    assert.ok(css.indexOf('"t1"') > css.indexOf('"t0"'), "inner scopes come later so they win");
});

test("an unmatched ::pop() stays visible", () => {
    const { sections } = applyStyleScopes([parseDesk("::pop()").children], new Map(), "t");
    assert.equal(sections[0][0].type, "paragraph");
});

test("unsafe values are dropped", () => {
    const styles = readStyles({ Style: { a: { bold: { color: "red; background: url(x)", size: "12", font: "Noto Sans TC, serif" } } } });
    assert.deepEqual(styles.get("a")!.marks.bold, { "font-size": "12pt", "font-family": '"Noto Sans TC", "serif"' });
    assert.equal(scopeCss("x", styles.get("a")!).includes("url"), false);
});

test("switches and CSS spellings", () => {
    const styles = readStyles({ style: { a: { text: { normal: { bold: true, "line-height": 1.6, letterSpacing: 1 } } } } });
    assert.deepEqual(styles.get("a")!.marks.normal, { "font-weight": "700", "line-height": "1.6", "letter-spacing": "1pt" });
});

test("the scan reports unknown names and finds the group at a position", () => {
    const source = "::push(style A)\n\n::style(custome A){ok} ::style(nope){x}\n\n::push(missing)\n\n::pop()\n\n::pop()\n\n::pop()";
    const { styles } = readPage(example);
    const scan = scanStyles(parseDesk(source).children, styles!, source.length);
    assert.deepEqual(scan.problems.map((problem) => source.slice(problem.from, problem.to)),
        ["::style(nope){x}", "::push(missing)", "::pop()"]);
    assert.equal(groupAt(scan, source.indexOf("ok"))?.name, "style A");
    assert.equal(groupAt(scan, source.length), undefined);
});

test("the 預設 group applies to the whole document without ::push", () => {
    const source = "---\nStyle:\n  預設:\n    bold:\n      color: \"#ff0000\"\n    custom:\n      size: 20\n  A:\n    bold:\n      size: 9\n---\n\n**a** ::style(custom){b}\n\n::push(A)\n**c**\n::pop()\n::pop()";
    const { body, styles } = readPage(source);
    const { sections, css } = applyStyleScopes([parseDesk(body).children], styles!, "t");
    const [base] = sections[0];
    assert.equal(base.kind, "styleScope");
    assert.equal(base.value, "td");
    assert.match(css, /\[data-desk-scope="td"\]\[data-desk-scope="td"\] strong \{ color: #ff0000; \}/);
    // ::style resolves against the default group outside any ::push.
    assert.equal(base.children![0].children!.find((node) => node.type === "deskStyle")!.value, "td:custom");
    // The extra ::pop() can't close the default group, so it stays visible.
    assert.equal(base.children!.at(-1)!.type, "paragraph");
    const scan = scanStyles(parseDesk(body).children, styles!, body.length);
    assert.equal(groupAt(scan, body.indexOf("**a**"))?.name, "預設");
    assert.equal(groupAt(scan, body.indexOf("**c**"))?.name, "A");
});

test("one-line styles read sizes, colours, keywords, pairs and font names", () => {
    assert.deepEqual(parseShorthand('11pt "Noto Serif TC" #c0392b bold center line-height 1.7 after 6pt'),
        { size: 11, font: "Noto Serif TC", color: "#c0392b", bold: true, align: "center", "line-height": 1.7, "margin-bottom": "6pt" });
    assert.deepEqual(parseShorthand("12 Microsoft JhengHei italic"), { size: 12, font: "Microsoft JhengHei", italic: true });
    assert.deepEqual(parseShorthand("1.2em underline regular upright"), { size: "1.2em", decoration: "underline", bold: false, italic: false });
    assert.deepEqual(writeShorthand({ "font-size": 14, color: "#2f7a55", bold: true, "margin-top": 6 }), "14pt #2f7a55 bold before 6pt");
    assert.equal(writeShorthand({ font: "A, B" }), '"A" "B"');
    assert.equal(writeShorthand({ color: "rgb(1, 2, 3)" }), null);
});

test("the flat layout sorts entries by name and moves normal's spacing to paragraphs", () => {
    const styles = readStyles({ Style: { R: { normal: "11pt indent 2em after 6pt center", h1: "22pt bold", quote: "#666", 重點: "14pt bold" } } });
    const r = styles.get("r")!;
    assert.deepEqual(r.marks.normal, { "font-size": "11pt" });
    assert.deepEqual(r.paragraph.normal, { "text-indent": "2em", "margin-bottom": "6pt", "text-align": "center" });
    assert.deepEqual(r.paragraph.heading1, { "font-size": "22pt", "font-weight": "700" });
    assert.deepEqual(r.paragraph.quote, { color: "#666" });
    assert.deepEqual(r.custom.重點.props, { "font-size": "14pt", "font-weight": "700" });
});

test("based-on merges the base group and survives loops", () => {
    const styles = readStyles({ Style: {
        Report: { normal: "11pt", bold: "#c00", h1: "22pt" },
        Appendix: { "based-on": "report", normal: "10pt", h1: "center" },
        A: { "based-on": "B", bold: "#111" }, B: { "based-on": "A", italic: "#222" },
    } });
    const appendix = styles.get("appendix")!;
    assert.deepEqual(appendix.marks, { normal: { "font-size": "10pt" }, bold: { color: "#c00" } });
    assert.deepEqual(appendix.paragraph.heading1, { "font-size": "22pt", "text-align": "center" });
    assert.deepEqual(appendix.own?.marks.bold, undefined);
    assert.equal(appendix.inherited?.name, "Report");
    assert.ok(styles.get("a") && styles.get("b"), "a based-on loop still yields both groups");
});

test("#colours need no quotes in YAML", () => {
    assert.equal(prepareYaml("    bold: 10pt #c0392b\n    color: #fff\n    size: 10 # note"), "    bold: '10pt #c0392b'\n    color: '#fff'\n    size: 10 # note");
    assert.equal(unquoteYaml("    bold: \"10pt #c0392b\"\n    a: '#fff'\n    b: 'x: #fff'\n    c: \"# x\""), "    bold: 10pt #c0392b\n    a: #fff\n    b: 'x: #fff'\n    c: \"# x\"");
});

test("colours keep their transparency", () => {
    assert.deepEqual(splitColor("#C0392B80"), { rgb: "#c0392b", alpha: 0.5 });
    assert.deepEqual(splitColor("#f008"), { rgb: "#ff0000", alpha: 0.53 });
    assert.deepEqual(splitColor("#333"), { rgb: "#333333", alpha: 1 });
    assert.deepEqual(splitColor("transparent"), { rgb: "#000000", alpha: 0 });
    assert.equal(splitColor("red"), null);
    assert.equal(joinColor("#C0392B", 1), "#c0392b");
    assert.equal(joinColor("#c0392b", 0.5), "#c0392b80");
    assert.equal(joinColor("#c0392b", 0), "#c0392b00");
    // In YAML and the one-line form, 8-digit colours and `transparent` read as colours.
    const styles = readStyles({ Style: { A: { bold: "#c0392b80", highlight: "background transparent" } } });
    assert.deepEqual(styles.get("a")!.marks.bold, { color: "#c0392b80" });
    assert.deepEqual(styles.get("a")!.marks.highlight, { "background-color": "transparent" });
    assert.equal(writeShorthand({ color: "#c0392b80", background: "transparent" }), "#c0392b80 background transparent");
});

test("custom text styles carry a keyboard shortcut", () => {
    assert.equal(normalizeShortcut("ctrl-alt-1"), "Ctrl+Alt+1");
    assert.equal(normalizeShortcut("Shift + Alt + k"), "Alt+Shift+K");
    assert.equal(normalizeShortcut("Ctrl+F5"), "Ctrl+F5");
    assert.equal(normalizeShortcut("Shift+K"), null);
    assert.equal(normalizeShortcut("Ctrl+Hyper+K"), null);
    assert.equal(shortcutFromEvent({ key: "!", code: "Digit1", ctrlKey: true, altKey: false, shiftKey: true, metaKey: false }), "Ctrl+Shift+1");
    assert.equal(shortcutFromEvent({ key: "Control", code: "ControlLeft", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false }), null);
    assert.equal(shortcutFromEvent({ key: "a", code: "KeyA", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }), null);

    const styles = readStyles({ Style: {
        Default: { "Key Point": "14pt #2f7a55 bold shortcut Ctrl+Alt+1", Note: { size: 9, shortcut: "ctrl+alt+2" }, Loud: "bold shortcut Ctrl+B" },
        Report: { "based-on": "Default", "Key Point": "16pt" },
    } });
    const base = styles.get("default")!;
    assert.equal(base.custom.keypoint.shortcut, "Ctrl+Alt+1");
    assert.equal(base.custom.keypoint.props["font-size"], "14pt");
    assert.equal(base.custom.note.shortcut, "Ctrl+Alt+2");
    // Shortcuts the editor already uses are ignored.
    assert.equal(base.custom.loud.shortcut, undefined);
    // based-on keeps the shortcut.
    assert.equal(styleForShortcut(styles.get("report"), "Ctrl+Alt+1")?.props["font-size"], "16pt");
    assert.equal(styleForShortcut(base, "Ctrl+Alt+9"), undefined);
    assert.equal(writeShorthand({ size: 14, shortcut: "Ctrl+Alt+1", bold: true }), "14pt bold shortcut Ctrl+Alt+1");
});
