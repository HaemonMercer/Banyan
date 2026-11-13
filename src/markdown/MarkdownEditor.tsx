/**
 * WYSIWYG Markdown editor (ProseMirror, Notion-like): formatting shows as you type, the source
 * stays BFM. Untouched blocks are saved exactly as they were (see `editorCore.ts`).
 *
 * Syntax without its own editing UI (tables, math, images, HTML, footnotes…) shows rendered;
 * double-click it to edit its source.
 */
import { dropCursor } from "prosemirror-dropcursor";
import { gapCursor } from "prosemirror-gapcursor";
import { history } from "prosemirror-history";
import type { Node as PMNode, Slice } from "prosemirror-model";
import { Fragment, Slice as PMSlice } from "prosemirror-model";
import { EditorState, Plugin, Selection, TextSelection } from "prosemirror-state";
import { EditorView, type NodeView } from "prosemirror-view";
import katex from "katex";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { ICONS, type IconName } from "../icons/icons";
import { whiteboardApi, type CardHit } from "../whiteboard/api";
import { buildInputRules, buildKeymaps } from "./editorCommands.ts";
import { load, positionForOffset, save, schema, type Loaded } from "./editorCore.ts";
import { useWikiLinkHandler, type WikiLinkHandler } from "./links";
import { formatCitation, yearOf } from "./cite.ts";
import { openCited } from "./Citations";
import { citeApi, getCite, requestCites, subscribeCites, type CiteHit } from "./citeStore";
import { parse } from "./index.ts";
import Markdown from "./Markdown";
import "./editor.css";

export interface MarkdownEditorProps {
    value: string;
    onChange: (text: string) => void;
    /** Focus left the editor (or Esc). */
    onBlur: () => void;
    /** Caret position on mount, as a source offset (null = end). */
    initialOffset?: number | null;
    placeholder?: string;
    className?: string;
    /** The card being edited: left out of `[[` suggestions. */
    cardId?: number | null;
}

const CALLOUT_LABELS: Record<string, { label: string; icon: IconName; tone: string }> = {
    note: { label: "備註", icon: "note", tone: "accent" },
    info: { label: "資訊", icon: "info", tone: "info" },
    tip: { label: "提示", icon: "sparkle", tone: "accent" },
    todo: { label: "待辦", icon: "check", tone: "info" },
    example: { label: "範例", icon: "note", tone: "info" },
    question: { label: "問題", icon: "info", tone: "warning" },
    quote: { label: "引用", icon: "note", tone: "muted" },
    warning: { label: "注意", icon: "warning", tone: "warning" },
    danger: { label: "危險", icon: "warning", tone: "danger" },
};

// ---- node views ---------------------------------------------------------------------------------

/** Shared by the source-editing views: a textarea that commits on blur / Ctrl+Enter, cancels on Esc. */
function sourceInput(initial: string, multiline: boolean, done: (value: string | null) => void): HTMLTextAreaElement | HTMLInputElement {
    const input = multiline ? document.createElement("textarea") : document.createElement("input");
    input.className = "md-src-input";
    input.value = initial;
    input.spellcheck = false;
    if (input instanceof HTMLTextAreaElement) input.rows = Math.min(14, initial.split("\n").length + 1);
    let finished = false;
    const finish = (v: string | null) => {
        if (finished) return;
        finished = true;
        done(v);
    };
    input.addEventListener("keydown", (e) => {
        const ke = e as KeyboardEvent;
        if (ke.key === "Escape") {
            ke.preventDefault();
            ke.stopPropagation();
            finish(null);
        } else if (ke.key === "Enter" && (ke.ctrlKey || ke.metaKey || !multiline)) {
            ke.preventDefault();
            finish(input.value);
        }
    });
    input.addEventListener("blur", () => finish(input.value));
    return input;
}

class SourceBlockView implements NodeView {
    dom: HTMLElement;
    private root: Root;
    private node: PMNode;
    private view: EditorView;
    private getPos: () => number | undefined;
    private editing = false;
    private rendered: HTMLElement;

    constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
        this.node = node;
        this.view = view;
        this.getPos = getPos;
        this.dom = document.createElement("div");
        this.dom.className = "md-atom-block";
        this.dom.contentEditable = "false";
        this.dom.title = "雙擊編輯原文";
        this.rendered = document.createElement("div");
        this.dom.appendChild(this.rendered);
        this.root = createRoot(this.rendered);
        this.render();
        this.dom.addEventListener("dblclick", (e) => {
            e.preventDefault();
            this.edit();
        });
    }

    private render() {
        const src: string = this.node.attrs.src;
        // Definitions and comments show nothing when rendered: show their source, dimmed.
        const visible = parse(src).children.some((c) => c.type !== "commentBlock");
        this.root.render(visible ? <Markdown source={src} /> : <pre className="md-src-dim">{src}</pre>);
    }

    private edit() {
        if (this.editing) return;
        this.editing = true;
        const input = sourceInput(this.node.attrs.src, true, (value) => {
            this.editing = false;
            input.remove();
            this.rendered.style.display = "";
            const pos = this.getPos();
            if (value !== null && value !== this.node.attrs.src && pos !== undefined) {
                const tr = value.trim()
                    ? this.view.state.tr.setNodeMarkup(pos, undefined, { src: value.replace(/\s+$/, "") })
                    : this.view.state.tr.delete(pos, pos + this.node.nodeSize);
                this.view.dispatch(tr);
            }
            this.view.focus();
        });
        this.rendered.style.display = "none";
        this.dom.appendChild(input);
        input.focus();
    }

    update(node: PMNode) {
        if (node.type !== this.node.type) return false;
        if (node.attrs.src !== this.node.attrs.src) {
            this.node = node;
            this.render();
        }
        return true;
    }

    selectNode() {
        this.dom.classList.add("selected");
    }
    deselectNode() {
        this.dom.classList.remove("selected");
    }
    stopEvent(e: Event) {
        return (e.target as HTMLElement).classList?.contains("md-src-input") ?? false;
    }
    ignoreMutation() {
        return true;
    }
    destroy() {
        const root = this.root;
        queueMicrotask(() => root.unmount());
    }
}

class SourceInlineView implements NodeView {
    dom: HTMLElement;
    private node: PMNode;
    private view: EditorView;
    private getPos: () => number | undefined;

    constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
        this.node = node;
        this.view = view;
        this.getPos = getPos;
        this.dom = document.createElement("span");
        this.dom.className = "md-atom-inline";
        this.dom.contentEditable = "false";
        this.dom.title = "雙擊編輯原文";
        this.render();
        this.dom.addEventListener("dblclick", (e) => {
            e.preventDefault();
            this.edit();
        });
    }

    private render() {
        const { src, kind } = this.node.attrs as { src: string; kind: string };
        this.dom.replaceChildren();
        if (kind === "math") {
            const display = src.startsWith("$$");
            const tex = src.replace(/^\$\$?|\$\$?$/g, "");
            try {
                this.dom.innerHTML = katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: "ignore" });
            } catch {
                this.dom.textContent = src;
            }
        } else if (kind === "image") {
            const m = /^!\[([^\]]*)\]\(\s*<?([^\s>)]+)/.exec(src);
            if (m && /^(https?:|data:image\/)/i.test(m[2])) {
                const img = document.createElement("img");
                img.src = m[2];
                img.alt = m[1];
                this.dom.appendChild(img);
            } else this.dom.textContent = src;
        } else if (kind === "citation") {
            // Shown as the formatted citation once the keys are known.
            const node = parse(src).children[0]?.children?.find((n) => n.type === "citation");
            const cites = node?.cites ?? [];
            const keys = cites.map((c) => c.key);
            const known = keys.map((k) => getCite(k));
            if (known.some((d) => d === undefined)) {
                requestCites(keys);
                this.waitForCites();
            }
            this.dom.classList.add("md-cite");
            const missing = known.some((d) => d === null);
            this.dom.classList.toggle("missing", missing);
            this.dom.textContent = node && !missing && !known.includes(undefined) ? formatCitation(cites, !!node.narrative, (k) => getCite(k) ?? null) : src;
            this.dom.title = (missing ? "找不到這個引用鍵；" : "") + "雙擊編輯原文（" + src + "）";
        } else if (kind === "footnoteRef") {
            const sup = document.createElement("sup");
            sup.textContent = src;
            this.dom.appendChild(sup);
        } else {
            this.dom.classList.add("raw");
            this.dom.textContent = src;
        }
    }

    private unsubscribe: (() => void) | null = null;

    /** Re-render when the cited keys arrive. */
    private waitForCites() {
        if (this.unsubscribe) return;
        this.unsubscribe = subscribeCites(() => {
            this.unsubscribe?.();
            this.unsubscribe = null;
            this.render();
        });
    }

    destroy() {
        this.unsubscribe?.();
    }

    private edit() {
        const input = sourceInput(this.node.attrs.src, false, (value) => {
            input.remove();
            const pos = this.getPos();
            if (value !== null && value !== this.node.attrs.src && pos !== undefined) {
                // Re-read the edited source as Markdown, so it can become any inline content.
                const parsed = load(value).doc.firstChild;
                const content = parsed && parsed.type === schema.nodes.paragraph ? parsed.content : Fragment.empty;
                this.view.dispatch(this.view.state.tr.replaceWith(pos, pos + this.node.nodeSize, content));
            } else this.render();
            this.view.focus();
        });
        this.dom.replaceChildren(input);
        input.focus();
    }

    update(node: PMNode) {
        if (node.type !== this.node.type) return false;
        this.node = node;
        this.render();
        return true;
    }
    selectNode() {
        this.dom.classList.add("selected");
    }
    deselectNode() {
        this.dom.classList.remove("selected");
    }
    stopEvent(e: Event) {
        return (e.target as HTMLElement).classList?.contains("md-src-input") ?? false;
    }
    ignoreMutation() {
        return true;
    }
}

class WikiLinkView implements NodeView {
    dom: HTMLElement;
    private node: PMNode;
    private unsubscribe: (() => void) | null = null;

    constructor(node: PMNode, open: () => WikiLinkHandler | null) {
        this.node = node;
        this.dom = document.createElement("span");
        this.dom.addEventListener("mousedown", (e) => {
            if (!(e.ctrlKey || e.metaKey)) return;
            e.preventDefault();
            const target: string = this.node.attrs.target;
            if (target.startsWith("@")) openCited(getCite(target.slice(1)) ?? null);
            else open()?.(target);
        });
        this.render();
    }

    private render() {
        const { target, label, embed } = this.node.attrs as { target: string; label: string; embed: boolean };
        this.dom.className = "md-wikilink" + (embed ? " md-embed" : "");
        let text = label || target;
        if (target.startsWith("@")) {
            const key = target.slice(1);
            const d = getCite(key);
            if (d === undefined) {
                requestCites([key]);
                this.unsubscribe ??= subscribeCites(() => {
                    this.unsubscribe?.();
                    this.unsubscribe = null;
                    this.render();
                });
            } else if (d === null) this.dom.classList.add("missing");
            else if (!label) text = d.annotation ? `「${(d.annotation.quote || d.annotation.locator).slice(0, 30)}」` : d.title || target;
        }
        this.dom.textContent = text;
        this.dom.title = `${target}（Ctrl＋點一下開啟）`;
    }

    update(node: PMNode) {
        if (node.type !== this.node.type) return false;
        this.node = node;
        this.render();
        return true;
    }
    destroy() {
        this.unsubscribe?.();
    }
    ignoreMutation() {
        return true;
    }
}

class CalloutView implements NodeView {
    dom: HTMLElement;
    contentDOM: HTMLElement;
    private node: PMNode;
    private head: HTMLElement;
    private input: HTMLInputElement;

    constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
        this.node = node;
        this.dom = document.createElement("div");
        this.head = document.createElement("div");
        this.head.className = "md-callout-title";
        this.head.contentEditable = "false";
        this.input = document.createElement("input");
        this.input.className = "md-callout-input";
        this.input.addEventListener("change", () => {
            const pos = getPos();
            if (pos !== undefined) view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, title: this.input.value }));
        });
        this.input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                this.input.blur();
                view.focus();
            }
        });
        this.contentDOM = document.createElement("div");
        this.dom.append(this.head, this.contentDOM);
        this.render();
    }

    private render() {
        const c = CALLOUT_LABELS[this.node.attrs.kind] ?? CALLOUT_LABELS.note;
        this.dom.className = `md-callout md-tone-${c.tone}`;
        const icon = document.createElement("span");
        icon.className = "md-callout-icon";
        icon.innerHTML = `<svg class="bn-icon" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[c.icon]}</svg>`;
        this.input.value = this.node.attrs.title;
        this.input.placeholder = c.label;
        this.head.replaceChildren(icon, this.input);
    }

    update(node: PMNode) {
        if (node.type !== this.node.type) return false;
        const changed = node.attrs.kind !== this.node.attrs.kind;
        this.node = node;
        if (changed) this.render();
        else if (document.activeElement !== this.input) this.input.value = node.attrs.title;
        return true;
    }
    stopEvent(e: Event) {
        return e.target === this.input;
    }
    ignoreMutation(m: { target: Node }) {
        return this.head.contains(m.target);
    }
}

class ListItemView implements NodeView {
    dom: HTMLElement;
    contentDOM: HTMLElement;
    private box: HTMLInputElement | null = null;

    constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
        this.dom = document.createElement("li");
        this.contentDOM = document.createElement("div");
        this.contentDOM.className = "md-li-body";
        if (node.attrs.checked !== null) {
            this.dom.className = "md-task";
            const box = document.createElement("input");
            box.type = "checkbox";
            box.checked = !!node.attrs.checked;
            box.contentEditable = "false";
            box.addEventListener("mousedown", (e) => e.preventDefault());
            // Let the box toggle itself (cancelling the click would undo the new state).
            box.addEventListener("click", () => {
                const pos = getPos();
                if (pos === undefined) return;
                const current = view.state.doc.nodeAt(pos);
                view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...current?.attrs, checked: !current?.attrs.checked }));
            });
            this.box = box;
            this.dom.append(box);
        }
        this.dom.append(this.contentDOM);
    }

    update(node: PMNode) {
        if (node.type !== schema.nodes.list_item) return false;
        if ((node.attrs.checked === null) !== (this.box === null)) return false;
        if (this.box) this.box.checked = !!node.attrs.checked;
        return true;
    }
    stopEvent(e: Event) {
        return e.target === this.box;
    }
    ignoreMutation(m: { target: Node }) {
        return m.target === this.box;
    }
}

// ---- editor -------------------------------------------------------------------------------------

interface Suggest {
    /** `[[` → cards, `@` → items and annotations to cite. */
    mode: "card" | "cite";
    query: string;
    from: number;
    to: number;
    x: number;
    y: number;
}

const reSuggest = /\[\[([^[\]\n|]*)$/;
/** `@query` or `[@query` after a space, an opening bracket or Chinese punctuation. */
const reCiteSuggest = /(?:^|[\s(（「『【，。、；：])(\[?@)([^\s@\[\]();,，。]*)$/;

function placeholderPlugin(text: string) {
    return new Plugin({
        props: {
            attributes: (state): Record<string, string> => {
                const d = state.doc;
                const empty = d.childCount === 1 && d.firstChild!.isTextblock && d.firstChild!.content.size === 0;
                return empty ? { class: "md-editor-empty", "data-placeholder": text } : {};
            },
        },
    });
}

export default function MarkdownEditor({ value, onChange, onBlur, initialOffset = null, placeholder = "", className, cardId = null }: MarkdownEditorProps) {
    const host = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const loadedRef = useRef<Loaded | null>(null);
    const props = useRef({ onChange, onBlur });
    props.current = { onChange, onBlur };
    const wikiHandler = useWikiLinkHandler();
    const wikiRef = useRef(wikiHandler);
    wikiRef.current = wikiHandler;

    const [suggest, setSuggest] = useState<Suggest | null>(null);
    const [hits, setHits] = useState<Hit[]>([]);
    const [active, setActive] = useState(0);
    const suggestRef = useRef({ suggest, hits, active });
    suggestRef.current = { suggest, hits, active };

    const pick = (hit: Hit | null) => {
        const view = viewRef.current;
        const s = suggestRef.current.suggest;
        if (!view || !s) return;
        let node: PMNode;
        if (s.mode === "cite") {
            if (!hit || hit.kind !== "cite") return;
            node = schema.nodes.md_inline.create({ src: `[@${hit.cite.key}]`, kind: "citation" });
        } else {
            const attrs = hit?.kind === "card" ? { target: `card:${hit.card.cardId}`, label: hit.card.title.trim() } : { target: s.query.trim(), label: "" };
            if (!attrs.target) return;
            node = schema.nodes.wiki_link.create(attrs);
        }
        view.dispatch(view.state.tr.replaceWith(s.from, s.to, node).insertText(" "));
        setSuggest(null);
        view.focus();
    };
    const pickRef = useRef(pick);
    pickRef.current = pick;

    useLayoutEffect(() => {
        const loaded = load(value);
        loadedRef.current = loaded;
        let last = value;

        const updateSuggest = (view: EditorView) => {
            const { $from, empty } = view.state.selection;
            if (!empty || $from.parent.type.spec.code) return setSuggest(null);
            const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 60), $from.parentOffset, "\n", "￼");
            const coords = view.coordsAtPos($from.pos);
            const m = reSuggest.exec(before);
            if (m) return setSuggest({ mode: "card", query: m[1], from: $from.pos - m[0].length, to: $from.pos, x: coords.left, y: coords.bottom });
            const c = reCiteSuggest.exec(before);
            if (c) {
                const len = c[1].length + c[2].length;
                return setSuggest({ mode: "cite", query: c[2], from: $from.pos - len, to: $from.pos, x: coords.left, y: coords.bottom });
            }
            setSuggest(null);
        };

        const state = EditorState.create({
            doc: loaded.doc,
            plugins: [
                buildInputRules(),
                ...buildKeymaps(() => viewRef.current?.dom.blur()),
                history(),
                dropCursor({ color: "var(--accent)" }),
                gapCursor(),
                placeholderPlugin(placeholder),
            ],
        });

        const view = new EditorView(host.current!, {
            state,
            nodeViews: {
                md_block: (node, v, getPos) => new SourceBlockView(node, v, getPos),
                md_inline: (node, v, getPos) => new SourceInlineView(node, v, getPos),
                wiki_link: (node) => new WikiLinkView(node, () => wikiRef.current),
                callout: (node, v, getPos) => new CalloutView(node, v, getPos),
                list_item: (node, v, getPos) => new ListItemView(node, v, getPos),
            },
            dispatchTransaction(tr) {
                const next = view.state.apply(tr);
                view.updateState(next);
                if (tr.docChanged) {
                    const text = save(next.doc, loadedRef.current);
                    if (text !== last) {
                        last = text;
                        props.current.onChange(text);
                    }
                }
                updateSuggest(view);
            },
            handleKeyDown(_v, e) {
                const { suggest: s, hits: h, active: a } = suggestRef.current;
                if (!s) return false;
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    if (h.length === 0) return false;
                    setActive((a + (e.key === "ArrowDown" ? 1 : h.length - 1)) % h.length);
                    return true;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                    if (h.length === 0 && (s.mode === "cite" || !s.query.trim())) return false;
                    pickRef.current(h[a] ?? null);
                    return true;
                }
                if (e.key === "Escape") {
                    setSuggest(null);
                    return true;
                }
                return false;
            },
            // Pasted plain text is Markdown.
            clipboardTextParser(text): Slice {
                const doc = load(text).doc;
                return new PMSlice(doc.content, 1, 1);
            },
            clipboardTextSerializer(slice) {
                const doc = schema.topNodeType.createAndFill(null, slice.content.firstChild?.isInline ? schema.nodes.paragraph.create(null, slice.content) : slice.content);
                return doc ? save(doc, null) : slice.content.textBetween(0, slice.content.size, "\n\n");
            },
        });
        viewRef.current = view;

        // Caret where the user clicked in the rendered text.
        const pos = positionForOffset(loaded, initialOffset);
        const sel = pos === null ? Selection.atEnd(view.state.doc) : TextSelection.near(view.state.doc.resolve(Math.min(pos, view.state.doc.content.size)));
        view.dispatch(view.state.tr.setSelection(sel));
        view.focus();

        return () => {
            view.destroy();
            viewRef.current = null;
        };
        // Mount once: later `value` changes come from this editor itself.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Suggestions: `[[` → cards whose title matches; `@` → items and annotations to cite.
    const query = suggest?.query ?? null;
    const mode = suggest?.mode ?? null;
    useEffect(() => {
        if (query === null || mode === null) {
            setHits([]);
            return;
        }
        let stale = false;
        const t = setTimeout(() => {
            if (mode === "cite") {
                citeApi.search(query.trim(), 8).then(
                    (list) => {
                        if (stale) return;
                        setHits(list.map((c) => ({ kind: "cite" as const, cite: c })));
                        setActive(0);
                    },
                    () => !stale && setHits([]),
                );
                return;
            }
            whiteboardApi.searchCards(query.trim(), cardId).then(
                (list) => {
                    if (stale) return;
                    const q = query.trim().toLowerCase();
                    const seen = new Set<string>();
                    setHits(
                        list
                            .filter((h) => {
                                const key = h.title.trim().toLowerCase();
                                if (!key || seen.has(key) || !key.includes(q)) return false;
                                seen.add(key);
                                return true;
                            })
                            .slice(0, 8)
                            .map((card) => ({ kind: "card" as const, card })),
                    );
                    setActive(0);
                },
                () => !stale && setHits([]),
            );
        }, 100);
        return () => {
            stale = true;
            clearTimeout(t);
        };
    }, [query, mode, cardId]);

    return (
        <div
            className={`md md-editor${className ? " " + className : ""}`}
            onBlur={(e) => {
                const to = e.relatedTarget as Node | null;
                if (to && e.currentTarget.contains(to)) return;
                // A source field inside the editor takes focus: still editing.
                setTimeout(() => {
                    const el = document.activeElement;
                    if (el && host.current?.contains(el)) return;
                    setSuggest(null);
                    props.current.onBlur();
                }, 0);
            }}
        >
            <div ref={host} />
            {suggest && (
                <SuggestList
                    hits={hits}
                    mode={suggest.mode}
                    query={suggest.query}
                    active={active}
                    x={suggest.x}
                    y={suggest.y}
                    onPick={(h) => pick(h)}
                    onHover={setActive}
                />
            )}
        </div>
    );
}

type Hit = { kind: "card"; card: CardHit } | { kind: "cite"; cite: CiteHit };

function SuggestList(props: {
    hits: Hit[];
    mode: "card" | "cite";
    query: string;
    active: number;
    x: number;
    y: number;
    onPick: (h: Hit | null) => void;
    onHover: (i: number) => void;
}) {
    const { hits, mode, query, active, x, y, onPick, onHover } = props;
    const hint =
        mode === "cite"
            ? query.trim()
                ? "沒有符合的文獻或註解"
                : "輸入作者、標題或引用鍵搜尋文獻"
            : query.trim()
              ? `沒有符合的卡片；按 Enter 連到「${query.trim()}」`
              : "輸入卡片標題搜尋";
    const el = (
        <ul
            className={`wiki-complete${mode === "cite" ? " cite" : ""}`}
            style={{ left: Math.min(x, window.innerWidth - (mode === "cite" ? 340 : 270)), top: y + 2 }}
            role="listbox"
            // The list is portalled to <body>, but React events still bubble to the editor's
            // ancestors (the board would treat a click here as a click on empty canvas and end
            // the editing). Keep them here; preventing pointerdown also keeps the editor's focus.
            onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
            }}
            onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
        >
            {hits.map((h, i) => (
                <li
                    key={h.kind === "card" ? `c${h.card.cardId}` : h.cite.key}
                    role="option"
                    aria-selected={i === active}
                    className={i === active ? "active" : undefined}
                    onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        onPick(h);
                    }}
                    onMouseEnter={() => onHover(i)}
                >
                    {h.kind === "card" ? (
                        <>
                            <span className="wiki-complete-title">{h.card.title}</span>
                            <span className="wiki-complete-boards">{h.card.boards.length > 0 ? h.card.boards.join("、") : "不在白板上"}</span>
                        </>
                    ) : (
                        <>
                            <span className="wiki-complete-title">
                                {h.cite.quote !== null ? `「${h.cite.quote || "書籤"}」` : h.cite.title || "（無標題）"}
                                <span className="wiki-complete-sub">
                                    {h.cite.quote !== null ? h.cite.title : [h.cite.authors.split("\n")[0], yearOf(h.cite.date)].filter(Boolean).join("，")}
                                </span>
                            </span>
                            <span className="wiki-complete-boards">@{h.cite.key}</span>
                        </>
                    )}
                </li>
            ))}
            {hits.length === 0 && (
                <li className="wiki-complete-hint" onMouseDown={(e) => e.preventDefault()}>
                    {hint}
                </li>
            )}
        </ul>
    );
    // Portal to body, so the list is not clipped or scaled by the board.
    return createPortal(el, document.body);
}
