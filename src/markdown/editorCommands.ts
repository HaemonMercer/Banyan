/**
 * Typing shortcuts (input rules) and keys for the Markdown editor.
 * Typing `# `, `- `, `1. `, `> `, `[ ] `, ``` ``` ```, `---`, `**粗**`, `*斜*`, `~~刪~~`, `==螢光==`,
 * `` `code` `` or `[[標題]]` turns into the formatted result; Ctrl+Z right after undoes it.
 */
import { baseKeymap, chainCommands, setBlockType, toggleMark } from "prosemirror-commands";
import { redo, undo } from "prosemirror-history";
import { InputRule, inputRules, textblockTypeInputRule, undoInputRule, wrappingInputRule } from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import type { MarkType, Node as PMNode } from "prosemirror-model";
import { liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list";
import { TextSelection, type Command, type Plugin } from "prosemirror-state";
import { schema } from "./editorCore.ts";

const N = schema.nodes;
const M = schema.marks;

/** `**text**` → text with `mark` (the delimiters are removed). */
function markRule(pattern: RegExp, mark: MarkType, attrs?: (m: RegExpMatchArray) => Record<string, unknown>): InputRule {
    return new InputRule(pattern, (state, match, start, end) => {
        const text = match[2];
        if (!text || /^\s|\s$/.test(text)) return null;
        const lead = match[1] ?? "";
        const from = start + lead.length;
        const $from = state.doc.resolve(from);
        if (!$from.parent.type.allowsMarkType(mark)) return null;
        const tr = state.tr;
        tr.replaceWith(from, end, schema.text(text, [...$from.marks().filter((m) => m.type !== mark), mark.create(attrs?.(match))]));
        tr.removeStoredMark(mark);
        return tr;
    });
}

/** `[ ] ` / `[x] ` at the start of a list item makes it a task; in a paragraph, a task list. */
const taskRule = new InputRule(/^\[([ xX]?)\]\s$/, (state, match, start, end) => {
    const $start = state.doc.resolve(start);
    const checked = match[1] === "x" || match[1] === "X";
    const item = $start.depth >= 2 ? $start.node($start.depth - 1) : null;
    if (item && item.type === N.list_item && $start.index($start.depth - 1) === 0) {
        const tr = state.tr.delete(start, end);
        tr.setNodeMarkup($start.before($start.depth - 1), undefined, { ...item.attrs, checked });
        return tr;
    }
    if ($start.parent.type !== N.paragraph) return null;
    const tr = state.tr.delete(start, end);
    const range = tr.doc.resolve(start).blockRange();
    if (!range) return null;
    tr.wrap(range, [{ type: N.bullet_list }, { type: N.list_item, attrs: { checked } }]);
    return tr;
});

/** `---` on its own line → horizontal rule. */
const ruleRule = new InputRule(/^---$/, (state, _match, start) => {
    const $start = state.doc.resolve(start);
    if ($start.parent.type !== N.paragraph || $start.parent.textContent !== "--") return null;
    const pos = $start.before();
    const tr = state.tr.replaceWith(pos, $start.after(), [N.horizontal_rule.create(), N.paragraph.create()]);
    tr.setSelection(TextSelection.create(tr.doc, pos + 2));
    return tr;
});

/** `[[標題]]` typed out → a wiki link to that title. */
const wikiRule = new InputRule(/(!?)\[\[([^[\]\n]+)\]\]$/, (state, match, start, end) => {
    const inner = match[2];
    const bar = inner.indexOf("|");
    const target = (bar >= 0 ? inner.slice(0, bar) : inner).trim();
    if (!target) return null;
    const label = bar >= 0 ? inner.slice(bar + 1).trim() : "";
    return state.tr.replaceWith(start, end, N.wiki_link.create({ target, label, embed: match[1] === "!" }));
});

export function buildInputRules(): Plugin {
    return inputRules({
        rules: [
            textblockTypeInputRule(/^(#{1,6})\s$/, N.heading, (m) => ({ level: m[1].length })),
            taskRule,
            wrappingInputRule(/^\s*[-+*]\s$/, N.bullet_list),
            wrappingInputRule(/^(\d+)[.)]\s$/, N.ordered_list, (m) => ({ order: Number(m[1]) }), (m, node) => node.childCount + node.attrs.order === Number(m[1])),
            wrappingInputRule(/^\s*>\s$/, N.blockquote),
            textblockTypeInputRule(/^```$/, N.code_block),
            ruleRule,
            wikiRule,
            markRule(/(^|[^*])\*\*([^*]+)\*\*$/, M.strong),
            markRule(/(^|[^*])\*([^*\s][^*]*)\*$/, M.em),
            markRule(/(^|[^~])~~([^~]+)~~$/, M.strike),
            markRule(/(^|[^=])==([^=]+)==$/, M.highlight),
            markRule(/(^|[^`])`([^`]+)`$/, M.code),
        ],
    });
}

/** Enter in a list: a new item (a task item starts unchecked); in an empty item: leave the list. */
const splitItem: Command = (state, dispatch) => {
    const { $from } = state.selection;
    let item: PMNode | null = null;
    for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type === N.list_item) {
            item = $from.node(d);
            break;
        }
    }
    if (!item) return false;
    const attrs = item.attrs.checked === null ? undefined : { checked: false };
    return splitListItem(N.list_item, attrs)(state, dispatch) || liftListItem(N.list_item)(state, dispatch);
};

/** Backspace at the start of a heading or code block turns it back into a paragraph. */
const unformatAtStart: Command = (state, dispatch) => {
    const { $from, empty } = state.selection;
    if (!empty || $from.parentOffset !== 0) return false;
    const t = $from.parent.type;
    if (t === N.heading || t === N.code_block) return setBlockType(N.paragraph)(state, dispatch);
    if ($from.depth >= 2 && $from.node(-1).type === N.list_item && $from.index(-1) === 0) return liftListItem(N.list_item)(state, dispatch);
    return false;
};

const lineBreak: Command = (state, dispatch) => {
    if (state.selection.$from.parent.type.spec.code) return false;
    dispatch?.(state.tr.replaceSelectionWith(N.hard_break.create({ soft: true })).scrollIntoView());
    return true;
};

export function buildKeymaps(onEscape: () => void): Plugin[] {
    return [
        keymap({
            "Mod-z": chainCommands(undoInputRule, undo),
            "Mod-y": redo,
            "Shift-Mod-z": redo,
            Backspace: chainCommands(undoInputRule, unformatAtStart),
            Enter: splitItem,
            "Shift-Enter": lineBreak,
            Tab: sinkListItem(N.list_item),
            "Shift-Tab": liftListItem(N.list_item),
            "Mod-b": toggleMark(M.strong),
            "Mod-i": toggleMark(M.em),
            "Mod-e": toggleMark(M.code),
            "Mod-Shift-x": toggleMark(M.strike),
            "Mod-Shift-h": toggleMark(M.highlight),
            "Mod-Alt-0": setBlockType(N.paragraph),
            "Mod-Alt-1": setBlockType(N.heading, { level: 1 }),
            "Mod-Alt-2": setBlockType(N.heading, { level: 2 }),
            "Mod-Alt-3": setBlockType(N.heading, { level: 3 }),
            Escape: () => {
                onEscape();
                return true;
            },
        }),
        keymap(baseKeymap),
    ];
}
