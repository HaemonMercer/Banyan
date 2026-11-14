import assert from "node:assert/strict";
import test from "node:test";
import { indentListItems, type TextChange } from "../lists.ts";
import { parse } from "../../markdown/index.ts";

const apply = (text: string, changes: TextChange[] | null) =>
    [...(changes ?? [])].sort((a, b) => b.from - a.from).reduce((result, { from, to, insert }) => result.slice(0, from) + insert + result.slice(to), text);
const at = (text: string, part: string) => text.indexOf(part);
const tab = (text: string, part: string, outdent = false) => apply(text, indentListItems(text, at(text, part), at(text, part), outdent));

test("Tab moves a numbered item under the one before it, starting the sub-list at 1", () => {
    const text = "1. saddsf\n2. afasfas\n3. asfa\n4. efsafsa";
    const nested = tab(text, "3. asfa");
    // The item left behind follows on from the one before the nested item.
    assert.equal(nested, "1. saddsf\n2. afasfas\n   1. asfa\n3. efsafsa");
    // The parser sees a real sub-list.
    const list = parse(nested).children[0];
    assert.equal(list.children?.length, 3);
    assert.equal(list.children?.[1].children?.[1].type, "list");
    // The next item joins the sub-list and follows on.
    assert.equal(tab(nested, "efsafsa"), "1. saddsf\n2. afasfas\n   1. asfa\n   2. efsafsa");
    // Shift+Tab brings it back after its parent.
    assert.equal(tab(nested, "1. asfa", true), "1. saddsf\n2. afasfas\n3. asfa\n4. efsafsa");
    // Items left behind are renumbered: those after a nested item follow on, those that end up under
    // an outdented item start its sub-list at 1.
    assert.equal(tab("1. a\n2. b\n3. c\n4. d", "3. c"), "1. a\n2. b\n   1. c\n3. d");
    assert.equal(tab("1. a\n   1. b\n   2. c\n   3. d", "1. b", true), "1. a\n2. b\n   1. c\n   2. d");
});

test("bullets nest by their own marker width and take their sub-items along", () => {
    const text = "- a\n- b\n  - c\n  continued\n- d";
    assert.equal(tab(text, "b"), "- a\n  - b\n    - c\n    continued\n- d");
    assert.equal(tab("10. ten\n11. eleven", "eleven"), "10. ten\n    1. eleven");
});

test("Tab on the first item, on plain text or at the top level with Shift does nothing", () => {
    assert.deepEqual(indentListItems("- a\n- b", 0, 0), []);
    assert.equal(indentListItems("just text", 0, 0), null);
    assert.deepEqual(indentListItems("- a\n- b", 5, 5, true), []);
});

test("a selection indents several items at once", () => {
    const text = "1. one\n2. two\n3. three\n4. four";
    assert.equal(apply(text, indentListItems(text, at(text, "two"), at(text, "three"))), "1. one\n   1. two\n   2. three\n2. four");
});
