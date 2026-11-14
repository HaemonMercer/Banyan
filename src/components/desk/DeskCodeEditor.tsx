import { useLayoutEffect, useRef, type RefObject } from "react";
import { autocompletion, completionKeymap, snippetCompletion, type CompletionContext } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { yamlFrontmatter, yamlLanguage } from "@codemirror/lang-yaml";
import { cssLanguage } from "@codemirror/lang-css";
import { jsonLanguage } from "@codemirror/lang-json";
import { javascriptLanguage, typescriptLanguage } from "@codemirror/lang-javascript";
import { bracketMatching, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { linter, lintGutter } from "@codemirror/lint";
import { EditorState, Prec, Transaction } from "@codemirror/state";
import { Decoration, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, MatchDecorator, ViewPlugin } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { parseDesk } from "../../desk/markdown";
import { indentListItems } from "../../desk/lists";
import { readPage, readYaml } from "../../desk/paper";
import { BASE_KEYS, isGlobalKey, groupAt, MARKS, PARAGRAPHS, scanStyles, shortcutFromEvent, STYLE_PROPERTY_NAMES, styleKey } from "../../desk/styles";

const syntax = HighlightStyle.define([
    { tag: [tags.heading, tags.keyword, tags.propertyName], color: "var(--accent)" },
    { tag: [tags.string, tags.url, tags.link, tags.number], color: "var(--info)" },
    { tag: [tags.monospace, tags.meta, tags.comment], color: "var(--text-2)" },
    { tag: tags.strong, fontWeight: "bold" },
    { tag: tags.emphasis, fontStyle: "italic" },
]);

// Colours come from the app tokens, so the editor follows the light and dark themes.
const theme = EditorView.theme({
    "&": { height: "100%", color: "var(--text)", backgroundColor: "var(--pane)", fontSize: "var(--fs-md)" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6" },
    ".cm-content": { padding: "var(--sp-3) 0", caretColor: "var(--text)" },
    ".cm-line": { padding: "0 var(--sp-4) 0 var(--sp-2)" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
        { backgroundColor: "color-mix(in srgb, var(--accent) 22%, transparent)" },
    ".cm-gutters": { backgroundColor: "var(--pane)", color: "var(--faint)", border: "none" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 var(--sp-2) 0 var(--sp-3)", fontVariantNumeric: "tabular-nums" },
    ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--hover) 55%, transparent)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-2)" },
    ".cm-selectionMatch": { backgroundColor: "color-mix(in srgb, var(--accent) 12%, transparent)" },
    "&.cm-focused .cm-matchingBracket": { backgroundColor: "color-mix(in srgb, var(--accent) 20%, transparent)", outline: "none" },
    ".cm-tooltip": {
        border: "1px solid var(--border)", borderRadius: "var(--r-lg)", backgroundColor: "var(--raised)",
        color: "var(--text)", boxShadow: "var(--shadow-md)", overflow: "hidden",
    },
    ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-sans)", maxHeight: "16em" },
    ".cm-tooltip-autocomplete > ul > li": { padding: "2px var(--sp-2)" },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--accent-soft)", color: "var(--accent-text)" },
    ".cm-completionDetail": { color: "var(--muted)", fontStyle: "normal", marginLeft: "var(--sp-2)" },
    ".cm-completionMatchedText": { textDecoration: "none", fontWeight: "var(--fw-semibold)" },
    ".cm-panels": { backgroundColor: "var(--sidebar)", color: "var(--text)" },
    ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
    ".cm-panel.cm-search": { padding: "var(--sp-2) var(--sp-3)", fontFamily: "var(--font-sans)", fontSize: "var(--fs-sm)" },
    ".cm-panel.cm-search input, .cm-panel.cm-search button": {
        minHeight: "var(--control-h)", border: "1px solid var(--border)", borderRadius: "var(--r-md)",
        backgroundColor: "var(--input-bg)", backgroundImage: "none", color: "var(--text)", font: "inherit",
    },
    ".cm-panel.cm-search label": { color: "var(--text-2)" },
    ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--warning) 25%, transparent)", outline: "none" },
    ".cm-searchMatch-selected": { backgroundColor: "color-mix(in srgb, var(--warning) 45%, transparent)" },
    ".cm-lint-marker": { width: "0.9em", height: "0.9em" },
    ".cm-diagnostic-error": { borderLeftColor: "var(--danger)" },
    ".desk-code-directive": { color: "var(--accent)", fontWeight: "var(--fw-semibold)" },
    ".desk-code-argument": { color: "var(--info)" },
});

const deskTokens = new MatchDecorator({
    regexp: /:::{0,2}(?:Col|pagebreak|page|toc|refs|bibliography|cols|columns|column|next|left|center|right|justify|box|push|pop|style)\b(?:\([^)\n]*\))?/g,
    decorate: (add, from, to, match, view) => {
        if (!isMarkdownProse(view.state, from + 1)) return;
        const argument = match[0].search(/[({]/);
        const end = argument < 0 ? to : from + argument;
        add(from, end, Decoration.mark({ class: "desk-code-directive" }));
        if (end < to) add(end, to, Decoration.mark({ class: "desk-code-argument" }));
    },
});

function isMarkdownProse(state: EditorState, position: number) {
    for (let node = syntaxTree(state).resolveInner(position, -1); node; ) {
        if (/^(Frontmatter|FencedCode|CodeBlock|InlineCode|HTMLBlock|CommentBlock|Comment|Link|Image)$/.test(node.name)) return false;
        if (!node.parent) break;
        node = node.parent;
    }
    return true;
}

const directives = ViewPlugin.fromClass(class {
    decorations;
    constructor(view: EditorView) { this.decorations = deskTokens.createDeco(view); }
    update(update: Parameters<typeof deskTokens.updateDeco>[0]) {
        this.decorations = syntaxTree(update.startState) !== syntaxTree(update.state)
            ? deskTokens.createDeco(update.view) : deskTokens.updateDeco(update, this.decorations);
    }
}, { decorations: (plugin) => plugin.decorations });

const commands = [
    snippetCompletion("::Col(){${左欄}},{${右欄}}", { label: "::Col", detail: "雙欄" }),
    snippetCompletion("::Col(${2:1:1}){${第一欄}},{${第二欄}},{${第三欄}}", { label: "::Col", detail: "自訂多欄比例" }),
    ...["left", "center", "right", "justify"].map((name) =>
        snippetCompletion("::" + name + "{${段落}}", { label: "::" + name, type: "keyword" })),
    snippetCompletion("::box{${內容}}", { label: "::box", detail: "框線區塊" }),
    ...["::page", "::toc", "::refs"].map((label) => ({ label, type: "keyword" })),
    snippetCompletion("::push(${樣式組})\n${}\n::pop()", { label: "::push", detail: "套用樣式組" }),
    { label: "::pop()", type: "keyword", detail: "結束樣式組" },
    snippetCompletion("::style(${樣式}){${文字}}", { label: "::style", detail: "目前樣式組的文字樣式" }),
];
const codeLanguages = new Map([
    ["js", javascriptLanguage], ["javascript", javascriptLanguage],
    ["ts", typescriptLanguage], ["typescript", typescriptLanguage],
    ["css", cssLanguage], ["json", jsonLanguage], ["yaml", yamlLanguage], ["yml", yamlLanguage],
]);

const yamlValues: Record<string, string[]> = {
    mode: ["writer", "slides"], paper: ["a4", "a3", "a5", "b5", "letter", "legal"], pageNumbers: ["true", "false"],
    orientation: ["portrait", "landscape"], columns: ["1", "2", "3", "4"], columnGap: ["6", "8", "12"],
    columnRule: ["true", "false"], differentFirstPage: ["true", "false"],
    padding: ["18", "20", "(20, 18, 20, 18)"],
    color: ['"#222222"', '"#ffffff"', '"#ab2943"'],
    size: ["10", "12", "14", "18", "24"], weight: ["400", "600", "700"],
    bold: ["true", "false"], italic: ["true", "false"], underline: ["true", "false"],
    align: ["left", "center", "right", "justify"], background: ['"#fff3a3"'],
};

function yamlParents(source: string, indent: number) {
    const path: { key: string; indent: number }[] = [];
    for (const line of source.split("\n").slice(1)) {
        // Style group names may contain spaces (`style A:`).
        const entry = /^( *)(?:([\p{L}\p{N}_-](?:[\p{L}\p{N} _-]*[\p{L}\p{N}_-])?)|"([^"]+)"|'([^']+)')[ \t]*:/u.exec(line);
        if (!entry) continue;
        while (path.length && path[path.length - 1].indent >= entry[1].length) path.pop();
        path.push({ key: entry[2] ?? entry[3] ?? entry[4], indent: entry[1].length });
    }
    return path.filter((entry) => entry.indent < indent).map((entry) => entry.key);
}

function yamlKeys(parents: string[]) {
    const parent = parents[parents.length - 1];
    if (!parent) return ["mode", "page", "Default Style", "Style"];
    // Default: is one group itself; Style: holds named groups.
    const global = isGlobalKey(parents[0]);
    if (global || ["style", "styles"].includes(styleKey(parents[0]))) {
        const depth = global ? parents.length : parents.length - 1;
        if (depth === 0) return [];
        if (depth === 1) return [...(global ? [] : ["based-on"]), ...Object.keys(MARKS), "h1", "h2", "h3", "h4", "h5", "h6", "heading", "quote", "list", "table", "text", "paragraph"];
        if (depth === 2 && styleKey(parent) === "text") return Object.keys(MARKS);
        if (depth === 2 && styleKey(parent) === "paragraph") return Object.keys(PARAGRAPHS);
        return STYLE_PROPERTY_NAMES;
    }
    if (parent === "page") return ["paper", "orientation", "padding", "columns", "columnGap", "columnRule", "color", "header", "footer", "pageNumbers", "differentFirstPage"];
    if (parent === "padding") return ["top", "right", "bottom", "left"];
    if (parent === "header" || parent === "footer") return ["left", "center", "right"];
    return [];
}

/** Tab／Shift+Tab on Markdown list items: nest under the item above or move back out (not in YAML or code). */
function indentList(view: EditorView, outdent: boolean) {
    const { from, to } = view.state.selection.main;
    if (!isMarkdownProse(view.state, view.state.doc.lineAt(from).to)) return false;
    const changes = indentListItems(view.state.doc.toString(), from, to, outdent);
    if (!changes) return false;
    if (changes.length) view.dispatch({ changes, scrollIntoView: true, userEvent: outdent ? "delete.dedent" : "input.indent" });
    return true;
}

export function completeDeskSource(context: CompletionContext) {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    const yaml = /^---\n[\s\S]*?^---[ \t]*$/m.exec(context.state.doc.toString());
    if (yaml?.index === 0 && line.number > 1 && context.pos < yaml[0].lastIndexOf("---")) {
        const parents = yamlParents(context.state.sliceDoc(0, line.from), before.length - before.trimStart().length);
        const running = parents.some((parent) => parent === "header" || parent === "footer");
        const pageNumber = /^\s*(?:-\s+|(?:left|center|right):\s*\[\s*)(\w*)$/.exec(before);
        if (running && pageNumber) return {
            from: context.pos - pageNumber[1].length,
            options: [{ label: "pageNumber", detail: "目前頁碼" }],
        };
        const keys = yamlKeys(parents);
        // Default Style: one of the groups under Style:.
        const defaultStyle = parents.length === 0 ? /^([^:\s][^:]*?)[ \t]*:[ \t]*([^\r\n]*)$/.exec(before) : null;
        if (defaultStyle && isGlobalKey(defaultStyle[1])) {
            const { styles = new Map() } = readPage(context.state.doc.toString());
            return {
                from: context.pos - defaultStyle[2].length,
                options: [...styles.values()].map((group) => ({ label: group.name, type: "constant", detail: group.global ? "目前的預設" : undefined })),
            };
        }
        const value = /^[ \t]*([\w-]+):[ \t]*(["']?)([^"'\r\n]*)$/.exec(before);
        const inGroup = (parents.length === 2 && ["style", "styles"].includes(styleKey(parents[0]))) || (parents.length === 1 && isGlobalKey(parents[0]));
        if (inGroup && value && BASE_KEYS.has(styleKey(value[1]))) {
            // based-on: the other groups.
            const { styles = new Map() } = readPage(context.state.doc.toString());
            return {
                from: context.pos - value[3].length,
                options: [...styles.values()].filter((group) => styleKey(group.name) !== styleKey(parents[1])).map((group) => ({ label: group.name, type: "constant" })),
            };
        }
        // A style line is free-form shorthand (`bold: 12pt #c0392b`): don't offer true／false for it.
        if (inGroup && value) return null;
        const property = value?.[1].replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase());
        const keyName = value && (keys.includes(value[1]) ? value[1] : property);
        const choices = keyName && keys.includes(keyName) && Object.prototype.hasOwnProperty.call(yamlValues, keyName) ? yamlValues[keyName] : null;
        if (value && choices) return {
            from: context.pos - value[3].length,
            options: choices.map((label) => {
                const raw = label.replace(/^"(.*)"$/, "$1");
                return {
                    label: value[2] ? raw : label, type: "enum",
                    apply: value[2] ? raw + (line.text[before.length] === value[2] ? "" : value[2]) : label,
                };
            }),
        };
        const key = /^[ \t]*((?:["']?\*?[\w -]+)?)$/.exec(before);
        if (key && (key[1] || context.explicit)) return {
            from: context.pos - key[1].length,
            options: keys.map((label) => ({ label, apply: label + ": ", type: "property" })),
        };
        return null;
    }
    if (!isMarkdownProse(context.state, context.pos)) return null;
    const named = /::(push|style)\(([^()\n]*)$/.exec(before);
    if (named) {
        const source = context.state.doc.toString();
        const { body, styles = new Map() } = readPage(source);
        const offset = source.length - body.length;
        const names = named[1] === "push"
            ? [...styles.values()].map((group) => ({ label: group.name, detail: "樣式組" }))
            : Object.values(groupAt(scanStyles(parseDesk(body).children, styles, body.length), context.pos - offset)?.custom ?? {})
                .map(({ name }) => ({ label: name, detail: "文字樣式" }));
        return { from: context.pos - named[2].length, options: names.map((option) => ({ ...option, type: "constant" })), validFor: /^[^()\n]*$/ };
    }
    const directive = /::[\w]*$/.exec(before);
    const column = /::Col\(([\d:. \t]*)$/.exec(before);
    if (column) return { from: context.pos - column[1].length, options: ["1:1", "2:1", "3:2", "2:1:1", "1:1:1"].map((label) => ({ label, type: "constant" })) };
    if (directive) return { from: context.pos - directive[0].length, options: commands };
    return context.explicit ? { from: context.pos, options: commands } : null;
}

export default function DeskCodeEditor({ value, onChange, editor, onFormat, onCursor, onMark, onShortcut }: {
    value: string;
    onChange: (value: string) => void;
    editor: RefObject<EditorView | null>;
    onFormat: () => void;
    onCursor: () => void;
    onMark?: (mark: "bold" | "italic") => void;
    /** A key combination such as `Ctrl+Alt+1`; returns true when it applied a text style. */
    onShortcut?: (shortcut: string) => boolean;
}) {
    const host = useRef<HTMLDivElement>(null);
    const emitted = useRef<string | null>(null);
    const callbacks = useRef({ onChange, onFormat, onCursor, onMark, onShortcut, value });
    callbacks.current = { onChange, onFormat, onCursor, onMark, onShortcut, value };
    useLayoutEffect(() => {
        let releaseTab = false;
        const view = new EditorView({
            parent: host.current!,
            state: EditorState.create({
                doc: value,
                extensions: [
                    yamlFrontmatter({ content: markdown({ codeLanguages: (info) => codeLanguages.get(info.toLowerCase()) ?? null }) }),
                    theme, EditorView.lineWrapping,
                    syntaxHighlighting(syntax), directives, lintGutter(),
                    linter((view) => {
                        const source = view.state.doc.toString();
                        const front = readYaml(source);
                        if (!front?.yaml.errors.length) {
                            const { body, styles = new Map() } = readPage(source);
                            const offset = source.length - body.length;
                            return scanStyles(parseDesk(body).children, styles, body.length).problems.map((problem) => ({
                                from: offset + problem.from, to: offset + problem.to, severity: "warning" as const, message: problem.message,
                            }));
                        }
                        return front.yaml.errors.map((error) => {
                            const index = Math.min(view.state.doc.lines, (error.linePos?.[0].line ?? 1) + 1);
                            const line = view.state.doc.line(index);
                            const from = Math.min(line.to, line.from + (error.linePos?.[0].col ?? 1) - 1);
                            return { from, to: Math.min(line.to, from + 1), severity: "error" as const,
                                message: error.code === "MISSING_CHAR" ? "YAML 缺少引號或結尾符號。請檢查這一行。" : `YAML 語法錯誤（${error.code}）。` };
                        });
                    }),
                    lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), history(), highlightSelectionMatches(),
                    indentUnit.of("  "), indentOnInput(), bracketMatching(),
                    autocompletion({ override: [completeDeskSource], icons: false }),
                    keymap.of([...completionKeymap, ...searchKeymap, ...historyKeymap, ...defaultKeymap,
                        { key: "Alt-Shift-f", run: () => { callbacks.current.onFormat(); return true; } },
                        ...(["bold", "italic"] as const).map((mark) => ({
                            key: mark === "bold" ? "Mod-b" : "Mod-i",
                            run: () => {
                                const onMark = callbacks.current.onMark;
                                if (!onMark) return false;
                                onMark(mark);
                                return true;
                            },
                        }))]),
                    // Text style shortcuts from the YAML come before the editor's own keys.
                    Prec.highest(EditorView.domEventHandlers({ keydown: (event) => {
                        const onShortcut = callbacks.current.onShortcut;
                        const shortcut = onShortcut && !event.isComposing ? shortcutFromEvent(event) : null;
                        if (!shortcut || !onShortcut!(shortcut)) return false;
                        event.preventDefault();
                        return true;
                    } })),
                    Prec.low(keymap.of([
                        { key: "Tab", run: (view) => { if (releaseTab) { releaseTab = false; return false; } return indentList(view, false) || indentMore(view); } },
                        { key: "Shift-Tab", run: (view) => indentList(view, true) || indentLess(view) },
                    ])),
                    EditorView.domEventHandlers({ keydown: (event) => {
                        if (event.key === "Escape") releaseTab = true;
                        else if (event.key !== "Tab") releaseTab = false;
                    } }),
                    EditorView.contentAttributes.of({ "aria-label": "Markdown 原始碼", spellcheck: "false" }),
                    EditorView.updateListener.of((update) => {
                        if (update.selectionSet || update.docChanged) callbacks.current.onCursor();
                        if (update.docChanged && !update.transactions.some((tr) => tr.annotation(Transaction.remote))) {
                            const text = update.state.doc.toString();
                            emitted.current = callbacks.current.value.includes("\r\n") ? text.replace(/\n/g, "\r\n") : text;
                            callbacks.current.onChange(emitted.current);
                        }
                    }),
                ],
            }),
        });
        editor.current = view;
        return () => { editor.current = null; view.destroy(); };
    }, [editor]);
    useLayoutEffect(() => {
        const view = editor.current;
        // The usual case is our own edit coming back; skip comparing the whole document.
        if (!view || value === emitted.current || view.state.doc.toString() === value.replace(/\r\n?/g, "\n")) return;
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value },
            annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)] });
    }, [editor, value]);
    return <div ref={host} className="desk-code-editor" />;
}
