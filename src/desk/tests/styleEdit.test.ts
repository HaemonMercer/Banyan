import assert from "node:assert/strict";
import test from "node:test";
import { readPage } from "../paper.ts";
import {
    addCustomStyle, addDefaultStyles, addStyleGroup, clearStyleEntry, removeStyleGroup, renameCustomStyle, renameStyleGroup, setDefaultStyle, setScopeAt, setStyleBase, setStyleField,
} from "../styleEdit.ts";

const source = `---
mode: writer
# keep this comment
Style:
  style A:
    text:
      bold:
        color: "#fafafa"
        font-size: 10
      custome A:
        size: 24
  Style B:
    highlight:
      size: 10
---

::push(styleA)
**f**::style(custome A){afasaf}
::push(Style B)
::style(custome A){not A}
::pop()
::pop()
`;

const group = (markdown: string, name: string) => readPage(markdown).styles!.get(name)!;

test("a field replaces other spellings of the same property", () => {
    const next = setStyleField(source, { group: "style A", section: "text", name: "bold" }, "size", "12");
    assert.deepEqual(group(next, "stylea").marks.bold, { color: "#fafafa", "font-size": "12pt" });
    assert.doesNotMatch(next, /font-size: 10\n/);
    assert.match(next, /# keep this comment/);
    assert.ok(next.endsWith("::pop()\n::pop()\n"), "the body is unchanged");
});

test("null removes a field; switches write true or false", () => {
    let next = setStyleField(source, { group: "style A", section: "text", name: "bold" }, "color", null);
    next = setStyleField(next, { group: "style A", section: "text", name: "bold" }, "italic", true);
    assert.deepEqual(group(next, "stylea").marks.bold, { "font-size": "10pt", "font-style": "italic" });
});

test("marks written directly under a group are edited in place", () => {
    const next = setStyleField(source, { group: "styleb", section: "text", name: "mark" }, "color", "#ff0000");
    assert.match(next, /Style B:\n {4}highlight:\n {6}size: 10\n {6}color: #ff0000/);
});

test("new entries are written straight under the group as one line", () => {
    let next = setStyleField(source, { group: "style B", section: "paragraph", name: "heading" }, "align", "center");
    assert.deepEqual(group(next, "styleb").paragraph.heading, { "text-align": "center" });
    assert.match(next, /\n {4}heading: center\n/);
    next = setStyleField(next, { group: "style B", section: "paragraph", name: "heading2" }, "size", "17");
    next = setStyleField(next, { group: "style B", section: "paragraph", name: "heading2" }, "bold", true);
    assert.match(next, /\n {4}h2: 17pt bold\n/);
    assert.deepEqual(group(next, "styleb").paragraph.heading2, { "font-size": "17pt", "font-weight": "700" });
});

test("one-line styles stay one line when edited", () => {
    const short = "---\nStyle:\n  A:\n    normal: 11pt \"Noto Serif TC\" #333 after 6pt\n    bold: #c0392b\n---\n\nx";
    let next = setStyleField(short, { group: "A", section: "text", name: "bold" }, "size", "12");
    assert.match(next, /\n {4}bold: 12pt "#c0392b"|\n {4}bold: '12pt #c0392b'|\n {4}bold: 12pt #c0392b/);
    assert.deepEqual(group(next, "a").marks.bold, { color: "#c0392b", "font-size": "12pt" });
    // Text and paragraph settings share `normal`; each part is edited and cleared on its own.
    next = setStyleField(next, { group: "A", section: "paragraph", name: "normal" }, "indent", "2em");
    assert.deepEqual(group(next, "a").paragraph.normal, { "margin-bottom": "6pt", "text-indent": "2em" });
    next = clearStyleEntry(next, { group: "A", section: "paragraph", name: "normal" });
    assert.deepEqual(group(next, "a").paragraph.normal, undefined);
    assert.deepEqual(group(next, "a").marks.normal, { "font-size": "11pt", "font-family": '"Noto Serif TC"', color: "#333" });
});

test("based-on can be set, changed and removed", () => {
    let next = setStyleBase(source, "Style B", "style A");
    assert.match(next, /Style B:\n {4}based-on: style A\n/);
    assert.equal(group(next, "styleb").marks.bold?.color, "#fafafa");
    assert.equal(group(next, "styleb").inherited?.name, "style A");
    next = setStyleBase(next, "Style B", null);
    assert.equal(group(next, "styleb").marks.bold, undefined);
    assert.throws(() => setStyleBase(source, "style A", "stylea"), /自己/);
});

test("clearing an entry makes it inherit again", () => {
    const next = clearStyleEntry(source, { group: "style A", section: "text", name: "bold" });
    assert.equal(group(next, "stylea").marks.bold, undefined);
});

test("groups can be added and removed", () => {
    const added = addStyleGroup(source, "Quote");
    assert.ok(readPage(added).styles!.has("quote"));
    assert.throws(() => addStyleGroup(added, "quote"), /已經有/);
    assert.equal(readPage(removeStyleGroup(added, "Style B")).styles!.has("styleb"), false);
});

test("a front matter is created when the document has none", () => {
    // The first group of a document becomes its default.
    const next = addStyleGroup("# 標題\n", "A");
    assert.equal(next, "---\nDefault Style: A\nStyle:\n  A: {}\n---\n\n# 標題\n");
});

test("renaming a group updates its ::push lines", () => {
    const next = renameStyleGroup(source, "style A", "Report");
    assert.match(next, /\n {2}Report:\n/);
    assert.match(next, /::push\(Report\)\n\*\*f\*\*/);
    assert.match(next, /::push\(Style B\)/);
});

test("renaming a custom style updates only uses in that group", () => {
    const next = renameCustomStyle(source, "style A", "custome A", "Large");
    assert.ok(group(next, "stylea").custom.large);
    assert.match(next, /::style\(Large\)\{afasaf\}/);
    // Inside Style B the name never resolved to style A's style, so it stays.
    assert.match(next, /::style\(custome A\)\{not A\}/);
});

test("custom styles cannot reuse built-in names", () => {
    assert.throws(() => addCustomStyle(source, "style A", "Bold"), /內建標記/);
    const next = addCustomStyle(source, "Style B", "Note");
    assert.ok(group(next, "styleb").custom.note);
});

test("a changed value keeps its key and place", () => {
    const next = setStyleField(source, { group: "style A", section: "text", name: "bold" }, "size", "12");
    // Colours are written without quotes; `prepareYaml` reads them back.
    assert.match(next, /bold:\n {8}color: #fafafa\n {8}font-size: 12\n/);
    // A switch can't reuse a CSS key: `weight` is replaced by `bold`.
    const weighted = source.replace('color: "#fafafa"', "weight: 300");
    assert.match(setStyleField(weighted, { group: "style A", section: "text", name: "bold" }, "bold", true), /bold:\n {8}font-size: 10\n {8}bold: true\n/);
});

test("the group around the cursor can be changed or removed", () => {
    const at = source.indexOf("**f**");
    const changed = setScopeAt(source, at, "Style B");
    assert.match(changed, /\n::push\(Style B\)\n\*\*f\*\*/);
    const removed = setScopeAt(source, at, null);
    assert.ok(removed.endsWith("---\n\n**f**::style(custome A){afasaf}\n::push(Style B)\n::style(custome A){not A}\n::pop()\n"));
    assert.throws(() => setScopeAt(source, source.indexOf("mode"), null), /不在任何樣式組/);
});

test("paragraph entries take left and right indents", () => {
    let next = setStyleField(source, { group: "style A", section: "paragraph", name: "normal" }, "marginLeft", "12");
    next = setStyleField(next, { group: "style A", section: "paragraph", name: "normal" }, "marginRight", "1.5em");
    assert.deepEqual(group(next, "stylea").paragraph.normal, { "margin-left": "12pt", "margin-right": "1.5em" });
});

test("a new group is written one entry per line once it has entries", () => {
    let next = addStyleGroup(source, "New");
    assert.match(next, /\n {2}New: \{\}\n/);
    next = setStyleBase(next, "New", "style A");
    next = setStyleField(next, { group: "New", section: "text", name: "bold" }, "color", "#c0392b");
    assert.match(next, /\n {2}New:\n {4}based-on: style A\n {4}bold: #c0392b\n/);
});

test("Default Style names the group that applies to the whole document", () => {
    const template = addDefaultStyles("---\nmode: writer\n---\n\n");
    assert.match(template, /^---\nmode: writer\nDefault Style: Default\nStyle:\n {2}Default:\n {4}normal: 11pt "Microsoft JhengHei" line-height 1\.6 after 6pt\n {4}h1: 22pt\n/);
    assert.equal(readPage(template).styles!.get("default")?.global, true);
    const doc = "---\nDefault Style: Style A\nStyle:\n  Style A:\n    bold: #c00\n  Style B:\n    bold: #00c\n---\n\nx";
    assert.equal(readPage(doc).styles!.get("stylea")?.global, true);
    assert.equal(readPage(doc).styles!.get("styleb")?.global, undefined);
    // The default can't be removed; another group can.
    assert.throws(() => removeStyleGroup(doc, "Style A"), /預設樣式/);
    assert.doesNotMatch(removeStyleGroup(doc, "Style B"), /Style B/);
    // Switching the default, and renaming it, keep Default Style: in step.
    assert.match(setDefaultStyle(doc, "style b"), /^---\nDefault Style: Style B\n/);
    assert.match(renameStyleGroup(doc, "Style A", "內文"), /^---\nDefault Style: 內文\nStyle:\n {2}內文:\n/);
});

test("older forms move to Default Style on the first edit", () => {
    // A top-level Default: block becomes a group named Default; based-on: 預設 still finds it.
    let next = setStyleField("---\nDefault:\n  normal: 11pt\nStyle:\n  A:\n    based-on: 預設\n---\n\nx", { group: "預設", section: "text", name: "normal" }, "size", "12");
    assert.equal(next, "---\nDefault Style: Default\nStyle:\n  Default:\n    normal: 12pt\n  A:\n    based-on: 預設\n---\n\nx");
    // A group named 預設 under Style: is the default until Default Style says otherwise.
    const old = "---\nStyle:\n  預設:\n    bold: #c00\n---\n\nx";
    assert.equal(readPage(old).styles!.get("預設")?.global, true);
    next = setStyleField(old, { group: "預設", section: "text", name: "bold" }, "size", "9");
    assert.equal(next, "---\nDefault Style: 預設\nStyle:\n  預設:\n    bold: 9pt #c00\n---\n\nx");
});

test("the panel sets and clears a text style's shortcut", () => {
    const doc = "---\nStyle:\n  Default:\n    Key Point: 14pt bold\n    Note: 9pt shortcut Ctrl+Alt+2\n---\n\nx";
    const entry = { group: "Default", section: "text" as const, name: "Key Point" };
    let next = setStyleField(doc, entry, "shortcut", "ctrl+alt+1");
    assert.match(next, /\n {4}Key Point: 14pt bold shortcut Ctrl\+Alt\+1\n/);
    assert.equal(readPage(next).styles!.get("default")!.custom.keypoint.shortcut, "Ctrl+Alt+1");
    next = setStyleField(next, entry, "shortcut", null);
    assert.match(next, /\n {4}Key Point: 14pt bold\n/);
    assert.throws(() => setStyleField(doc, entry, "shortcut", "Ctrl+Alt+2"), /「Note」已經使用 Ctrl\+Alt\+2/);
    assert.throws(() => setStyleField(doc, entry, "shortcut", "Ctrl+B"), /已經是 Banyan 或編輯器的快捷鍵/);
    assert.throws(() => setStyleField(doc, entry, "shortcut", "Shift+K"), /不是可用的快捷鍵/);
    // A long-form entry keeps its own key.
    const long = "---\nStyle:\n  Default:\n    Note:\n      size: 9\n      hotkey: Ctrl+Alt+2\n---\n\nx";
    assert.match(setStyleField(long, { group: "Default", section: "text", name: "Note" }, "shortcut", "Ctrl+Alt+3"), /\n {6}hotkey: Ctrl\+Alt\+3\n/);
});
