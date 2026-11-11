/**
 * WYSIWYG Markdown editor for cards (Milkdown = ProseMirror + remark).
 *
 * - CommonMark + GFM are edited natively (headings, lists, tables, task lists, ...).
 * - Syntax without a dedicated editor node (`[[wiki links]]`, `$math$`, directives, link
 *   references) becomes an atomic "raw" chip: rendered like the viewer, written back verbatim.
 *   Double-click a chip to edit its source.
 * - Typing `[[` suggests card titles; typing `]]` or a closing `$` turns the text into a chip.
 *
 * The editor reads `value` once on mount; changes are reported through `onChange`.
 */
import { defaultValueCtx, Editor, editorViewCtx, remarkStringifyOptionsCtx, rootCtx, serializerCtx } from "@milkdown/kit/core";
import { history } from "@milkdown/kit/plugin/history";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { InputRule } from "@milkdown/kit/prose/inputrules";
import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView, NodeViewConstructor } from "@milkdown/kit/prose/view";
import type { Node as PMNode } from "@milkdown/kit/prose/model";
import { $inputRule, $node, $prose, $remark, $view } from "@milkdown/kit/utils";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import remarkDirective from "remark-directive";
import remarkMath from "remark-math";
import type { Processor } from "unified";
import { CardSuggestList, useCardSuggestions } from "../components/CardSuggest";
import Markdown from "./Markdown";
import { remarkBanyanDirectives, remarkBanyanRaw, remarkWikiLink } from "./plugins";
import "./editor.css";

interface Props {
    value: string;
    onChange: (markdown: string) => void;
    /** Focus left the editor (not counting the suggestion list or editing a chip). */
    onBlur: () => void;
    onWikiLink?: (target: string) => void;
    /** The card being edited (left out of `[[` suggestions). */
    excludeCardId?: number | null;
    /** Put the caret here on mount (viewport coordinates of the click that opened the editor). */
    initialPoint?: { x: number; y: number } | null;
    placeholder?: string;
    className?: string;
}

/** `[[` + the text typed so far, ending at the caret. */
const OPEN_LINK = /\[\[([^\[\]|\n]*)$/;

interface Callbacks {
    onChange: (md: string) => void;
    onBlur: () => void;
    onWikiLink?: (target: string) => void;
    onUpdate: (view: EditorView) => void;
    onKey: (view: EditorView, e: KeyboardEvent) => boolean;
    /** True while a chip's source is being edited in a dialog. */
    suppressBlur: boolean;
}

/**
 * remark-directive escapes `:` in text on save (`10:30` → `10\:30`). Not needed here: a bare
 * `:word` is plain text in Banyan (see `remarkBanyanDirectives`), so drop that escape rule.
 */
function remarkNoColonEscape(this: Processor) {
    const exts = (this.data("toMarkdownExtensions") ?? []) as Array<{ unsafe?: Array<{ character: string }> }>;
    for (const ext of exts) {
        if (ext.unsafe) ext.unsafe = ext.unsafe.filter((u) => u.character !== ":");
    }
}

function rawView(inline: boolean, cb: { current: Callbacks }): NodeViewConstructor {
    return (initial, view, getPos) => {
        let node: PMNode = initial;
        const dom = document.createElement(inline ? "span" : "div");
        dom.className = `bn-raw ${inline ? "bn-raw-inline" : "bn-raw-block"}`;
        dom.contentEditable = "false";
        dom.title = "雙擊以編輯原始文字";
        const root = createRoot(dom);
        const render = () =>
            root.render(
                <Markdown inline={inline} source={node.attrs.value} onWikiLink={(t) => cb.current.onWikiLink?.(t)} />,
            );
        render();
        dom.addEventListener("dblclick", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const pos = getPos();
            if (pos === undefined) return;
            cb.current.suppressBlur = true;
            const next = window.prompt("編輯原始文字（清空即刪除）", node.attrs.value);
            cb.current.suppressBlur = false;
            view.focus();
            if (next === null || next === node.attrs.value) return;
            const tr = next.trim()
                ? view.state.tr.setNodeMarkup(pos, undefined, { value: next })
                : view.state.tr.delete(pos, pos + node.nodeSize);
            view.dispatch(tr);
        });
        return {
            dom,
            update: (n) => {
                if (n.type !== node.type) return false;
                node = n;
                render();
                return true;
            },
            // Let clicks on links inside the chip reach React.
            stopEvent: (e) => e.type === "mousedown" && !!(e.target as HTMLElement).closest?.("a"),
            ignoreMutation: () => true,
            destroy: () => queueMicrotask(() => root.unmount()),
        };
    };
}

function banyanPlugins(cb: { current: Callbacks }) {
    const rawInline = $node("bn_raw_inline", () => ({
        group: "inline",
        inline: true,
        atom: true,
        selectable: true,
        attrs: { value: { default: "" } },
        parseDOM: [{ tag: "span[data-bn-raw]", getAttrs: (d) => ({ value: (d as HTMLElement).dataset.bnRaw ?? "" }) }],
        toDOM: (n) => ["span", { "data-bn-raw": n.attrs.value, class: "bn-raw bn-raw-inline" }, n.attrs.value],
        parseMarkdown: {
            match: (n) => n.type === "bnRaw" && n.inline === true,
            runner: (state, n, type) => {
                state.addNode(type, { value: n.value as string });
            },
        },
        toMarkdown: {
            match: (n) => n.type.name === "bn_raw_inline",
            runner: (state, n) => {
                state.addNode("bnRaw", undefined, n.attrs.value);
            },
        },
    }));
    const rawBlock = $node("bn_raw_block", () => ({
        group: "block",
        atom: true,
        selectable: true,
        attrs: { value: { default: "" } },
        parseDOM: [{ tag: "div[data-bn-raw]", getAttrs: (d) => ({ value: (d as HTMLElement).dataset.bnRaw ?? "" }) }],
        toDOM: (n) => ["div", { "data-bn-raw": n.attrs.value, class: "bn-raw bn-raw-block" }, n.attrs.value],
        parseMarkdown: {
            match: (n) => n.type === "bnRaw" && n.inline !== true,
            runner: (state, n, type) => {
                state.addNode(type, { value: n.value as string });
            },
        },
        toMarkdown: {
            match: (n) => n.type.name === "bn_raw_block",
            runner: (state, n) => {
                state.addNode("bnRaw", undefined, n.attrs.value);
            },
        },
    }));

    const mathRule = $inputRule(
        (ctx) =>
            new InputRule(/(^|[^\\$])(\$[^$\n]+\$)$/, (state, match, start, end) =>
                state.tr.replaceWith(start + match[1].length, end, rawInline.type(ctx).create({ value: match[2] })),
            ),
    );

    const bridge = $prose(
        () =>
            new Plugin({
                view: () => ({ update: (view) => cb.current.onUpdate(view) }),
                // Any complete `[[...]]` in plain text becomes a chip, however it got there
                // (typed, pasted, undone), so it is never saved as escaped `\[\[`.
                appendTransaction: (trs, _old, state) => {
                    if (!trs.some((t) => t.docChanged)) return null;
                    const found: Array<{ from: number; to: number; value: string }> = [];
                    state.doc.descendants((node, pos, parent) => {
                        if (parent?.type.spec.code) return false;
                        if (!node.isText) return true;
                        if (node.marks.some((m) => m.type.spec.code)) return false;
                        for (const m of node.text!.matchAll(/\[\[([^\[\]\n]+)\]\]/g)) {
                            found.push({ from: pos + m.index!, to: pos + m.index! + m[0].length, value: m[0] });
                        }
                        return false;
                    });
                    if (found.length === 0) return null;
                    const type = state.schema.nodes.bn_raw_inline;
                    const tr = state.tr;
                    for (const f of found.reverse()) tr.replaceWith(f.from, f.to, type.create({ value: f.value }));
                    return tr;
                },
                props: {
                    handleKeyDown: (view, e) => cb.current.onKey(view, e),
                    handleDOMEvents: {
                        blur: () => {
                            if (!cb.current.suppressBlur) cb.current.onBlur();
                            return false;
                        },
                    },
                },
            }),
    );

    return [
        $remark("bnMath", () => remarkMath),
        $remark("bnDirective", () => remarkDirective),
        $remark("bnNoColonEscape", () => remarkNoColonEscape),
        $remark("bnDirectives", () => remarkBanyanDirectives),
        $remark("bnWikiLink", () => remarkWikiLink),
        $remark("bnRaw", () => remarkBanyanRaw as never),
        rawInline,
        rawBlock,
        $view(rawInline, () => rawView(true, cb)),
        $view(rawBlock, () => rawView(false, cb)),
        mathRule,
        bridge,
    ].flat();
}

function CardEditor({ value, onChange, onBlur, onWikiLink, excludeCardId = null, initialPoint, placeholder, className }: Props) {
    const host = useRef<HTMLDivElement>(null);
    const editorRef = useRef<Editor | null>(null);
    const [suggest, setSuggest] = useState<{ from: number; query: string; x: number; y: number } | null>(null);
    const [active, setActive] = useState(0);
    const [empty, setEmpty] = useState(!value.trim());
    const hits = useCardSuggestions(suggest?.query ?? null, excludeCardId);
    const lastDoc = useRef<PMNode | null>(null);

    const suggestRef = useRef(suggest);
    suggestRef.current = suggest;
    const hitsRef = useRef(hits);
    hitsRef.current = hits;
    const activeRef = useRef(active);
    activeRef.current = active;

    useEffect(() => setActive(0), [hits]);

    const insert = (view: EditorView, title: string) => {
        const s = suggestRef.current;
        if (!s) return;
        const type = view.state.schema.nodes.bn_raw_inline;
        view.dispatch(view.state.tr.replaceWith(s.from, view.state.selection.from, type.create({ value: `[[${title}]]` })));
        setSuggest(null);
        view.focus();
    };

    const cb = useRef<Callbacks>(null as unknown as Callbacks);
    cb.current = {
        onChange,
        onBlur,
        onWikiLink,
        suppressBlur: cb.current?.suppressBlur ?? false,
        onUpdate: (view) => {
            const doc = view.state.doc;
            if (lastDoc.current && !doc.eq(lastDoc.current)) {
                const editor = editorRef.current;
                if (editor) onChange(editor.ctx.get(serializerCtx)(doc));
            }
            lastDoc.current = doc;
            setEmpty(doc.childCount <= 1 && doc.textContent === "" && doc.firstChild?.type.name === "paragraph");

            const { $from, empty: collapsed } = view.state.selection;
            const m = collapsed ? OPEN_LINK.exec($from.parent.textBetween(0, $from.parentOffset, undefined, "￼")) : null;
            if (!m) {
                if (suggestRef.current) setSuggest(null);
                return;
            }
            const from = $from.pos - m[1].length - 2;
            const at = view.coordsAtPos(from);
            setSuggest({ from, query: m[1], x: at.left, y: at.bottom + 2 });
        },
        onKey: (view, e) => {
            const open = suggestRef.current !== null && hitsRef.current.length > 0;
            if (open) {
                const n = hitsRef.current.length;
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
                    return true;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                    insert(view, hitsRef.current[activeRef.current].title.trim());
                    return true;
                }
                if (e.key === "Escape") {
                    setSuggest(null);
                    return true;
                }
            }
            if (e.key === "Escape") {
                (view.dom as HTMLElement).blur();
                return true;
            }
            return false;
        },
    };

    useEffect(() => {
        let destroyed = false;
        let editor: Editor | null = null;
        Editor.make()
            .config((ctx) => {
                ctx.set(rootCtx, host.current!);
                ctx.set(defaultValueCtx, value);
                ctx.update(remarkStringifyOptionsCtx, (o) => ({
                    ...o,
                    handlers: { ...o.handlers, bnRaw: (n: { value: string }) => n.value },
                }));
            })
            .use(commonmark)
            .use(gfm)
            .use(history)
            .use(banyanPlugins(cb))
            .create()
            .then((e) => {
                if (destroyed) {
                    e.destroy();
                    return;
                }
                editor = e;
                editorRef.current = e;
                const view = e.ctx.get(editorViewCtx);
                lastDoc.current = view.state.doc;
                const p = initialPoint ? view.posAtCoords({ left: initialPoint.x, top: initialPoint.y }) : null;
                const sel = p
                    ? TextSelection.near(view.state.doc.resolve(p.pos))
                    : TextSelection.atEnd(view.state.doc);
                view.dispatch(view.state.tr.setSelection(sel));
                view.focus();
            });
        return () => {
            destroyed = true;
            editor?.destroy();
            editorRef.current = null;
        };
        // Mount once: `value` is the starting content.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const view = () => editorRef.current?.ctx.get(editorViewCtx);

    return (
        <>
            <div
                ref={host}
                className={`md card-editor${empty ? " is-empty" : ""}${className ? " " + className : ""}`}
                data-placeholder={placeholder}
            />
            {suggest && (
                <CardSuggestList
                    hits={hits}
                    active={active}
                    x={suggest.x}
                    y={suggest.y}
                    onHover={setActive}
                    onPick={(t) => {
                        const v = view();
                        if (v) insert(v, t);
                    }}
                />
            )}
        </>
    );
}

export default CardEditor;
