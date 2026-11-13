/**
 * The WYSIWYG editor's document model (ProseMirror) and its conversion to and from BFM source.
 * No DOM here, so the round trip can be tested in node.
 *
 * Loading: `parse()` → syntax tree → ProseMirror nodes. Syntax the editor has no dedicated node
 * for (tables, math blocks, inline math, images, footnotes, HTML…) becomes an atom that keeps its
 * exact source (`md_block` / `md_inline`).
 *
 * Saving: top-level blocks the user did not touch are written back exactly as they were in the
 * source (same characters, same blank lines); only changed blocks are generated.
 */
import { Fragment, Mark, Schema, type Node as PMNode } from "prosemirror-model";
import type { Document, MdNode } from "./ast.ts";
import { parse } from "./index.ts";

// `toDOM` / `parseDOM` are plain data (no DOM needed here): how nodes look in the editor, and how
// pasted HTML (from web pages, Word) becomes nodes.
export const schema = new Schema({
    nodes: {
        doc: { content: "block+" },
        paragraph: { content: "inline*", group: "block", parseDOM: [{ tag: "p" }], toDOM: () => ["p", 0] },
        heading: {
            attrs: { level: { default: 1 } },
            content: "inline*",
            group: "block",
            defining: true,
            parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: "h" + level, attrs: { level } })),
            toDOM: (n) => ["h" + n.attrs.level, 0],
        },
        blockquote: { content: "block+", group: "block", defining: true, parseDOM: [{ tag: "blockquote" }], toDOM: () => ["blockquote", 0] },
        /** `> [!kind]± title` (shown by a node view in the editor). */
        callout: {
            attrs: { kind: { default: "note" }, fold: { default: "" }, title: { default: "" } },
            content: "block+",
            group: "block",
            defining: true,
            toDOM: (n) => ["div", { class: "md-callout", "data-kind": n.attrs.kind }, 0],
        },
        bullet_list: {
            attrs: { tight: { default: true } },
            content: "list_item+",
            group: "block",
            parseDOM: [{ tag: "ul" }],
            toDOM: () => ["ul", 0],
        },
        ordered_list: {
            attrs: { order: { default: 1 }, tight: { default: true } },
            content: "list_item+",
            group: "block",
            parseDOM: [{ tag: "ol", getAttrs: (dom) => ({ order: Number((dom as HTMLElement).getAttribute("start") ?? 1) || 1 }) }],
            toDOM: (n) => ["ol", n.attrs.order === 1 ? {} : { start: n.attrs.order }, 0],
        },
        list_item: {
            attrs: { checked: { default: null } },
            content: "paragraph block*",
            defining: true,
            parseDOM: [{ tag: "li" }],
            toDOM: () => ["li", 0],
        },
        code_block: {
            attrs: { info: { default: "" } },
            content: "text*",
            marks: "",
            group: "block",
            code: true,
            defining: true,
            parseDOM: [{ tag: "pre", preserveWhitespace: "full" }],
            toDOM: (n) => ["pre", n.attrs.info ? { "data-lang": n.attrs.info.split(/\s/)[0] } : {}, ["code", 0]],
        },
        horizontal_rule: { group: "block", parseDOM: [{ tag: "hr" }], toDOM: () => ["hr"] },
        /** Any block kept as source: table, math, HTML, comment, footnote, definitions. */
        md_block: {
            attrs: { src: { default: "" } },
            group: "block",
            atom: true,
            selectable: true,
            toDOM: (n) => ["pre", { class: "md-src" }, n.attrs.src],
        },
        text: { group: "inline" },
        hard_break: {
            attrs: { soft: { default: true } },
            inline: true,
            group: "inline",
            selectable: false,
            parseDOM: [{ tag: "br" }],
            toDOM: () => ["br"],
        },
        wiki_link: {
            attrs: { target: { default: "" }, label: { default: "" }, embed: { default: false } },
            inline: true,
            group: "inline",
            atom: true,
            toDOM: (n) => ["span", { class: "md-wikilink" }, n.attrs.label || n.attrs.target],
        },
        /** Any inline syntax kept as source: math, image, footnote reference, HTML, comment. */
        md_inline: {
            attrs: { src: { default: "" }, kind: { default: "" } },
            inline: true,
            group: "inline",
            atom: true,
            toDOM: (n) => ["code", { class: "md-src" }, n.attrs.src],
        },
    },
    marks: {
        link: {
            attrs: { href: { default: "" }, title: { default: "" } },
            inclusive: false,
            parseDOM: [{ tag: "a[href]", getAttrs: (dom) => ({ href: (dom as HTMLElement).getAttribute("href"), title: (dom as HTMLElement).getAttribute("title") ?? "" }) }],
            toDOM: (m) => ["a", { href: m.attrs.href, title: m.attrs.title || m.attrs.href }, 0],
        },
        strong: {
            parseDOM: [{ tag: "strong" }, { tag: "b", getAttrs: (dom) => ((dom as HTMLElement).style.fontWeight !== "normal" ? null : false) }],
            toDOM: () => ["strong", 0],
        },
        em: { parseDOM: [{ tag: "em" }, { tag: "i" }], toDOM: () => ["em", 0] },
        strike: { parseDOM: [{ tag: "del" }, { tag: "s" }, { tag: "strike" }], toDOM: () => ["del", 0] },
        highlight: {
            attrs: { color: { default: "" } },
            parseDOM: [{ tag: "mark" }],
            toDOM: (m) => ["mark", { class: `md-mark md-mark-${m.attrs.color || "yellow"}` }, 0],
        },
        code: { parseDOM: [{ tag: "code" }], toDOM: () => ["code", 0] },
    },
});

// ---- loading ------------------------------------------------------------------------------------

/** Where inline source positions land inside one textblock (for putting the caret at a click). */
interface Point {
    src: number;
    len: number;
    at: number;
    verbatim: boolean;
}

export interface Loaded {
    doc: PMNode;
    /** Source text of each top-level block, matched to the original nodes. */
    originals: { node: PMNode; src: string }[];
    /** For each textblock in document order: its source points. */
    points: Point[][];
    /** Text before the first block (blank lines). */
    lead: string;
}

const reCalloutLine = /^[ \t]*>[ \t]?\[!([A-Za-z][\w-]*)\]([+-]?)[ \t]*(.*)$/;

export function load(source: string): Loaded {
    const tree: Document = parse(source);
    const points: Point[][] = [];

    /** Source of a nested block with the container prefixes (`> `, list indent) of its later lines removed. */
    const sourceOf = (n: MdNode): string => {
        const text = source.slice(n.start, n.end).replace(/\s+$/, "");
        const col = n.start - (source.lastIndexOf("\n", n.start - 1) + 1);
        if (col === 0) return text;
        return text
            .split("\n")
            .map((line, i) => {
                if (i === 0) return line;
                let k = 0;
                while (k < col && k < line.length && /[ >\t]/.test(line[k])) k++;
                return line.slice(k);
            })
            .join("\n");
    };

    const inline = (nodes: MdNode[] | undefined, marks: readonly Mark[], out: PMNode[], pts: Point[], at: { n: number }) => {
        for (const n of nodes ?? []) {
            const push = (node: PMNode, p?: Omit<Point, "at">) => {
                if (p) pts.push({ ...p, at: at.n });
                out.push(node);
                at.n += node.nodeSize;
            };
            const wrap = (mark: Mark) => inline(n.children, mark.addToSet(marks), out, pts, at);
            switch (n.type) {
                case "text":
                    if (n.value) push(schema.text(n.value, marks), { src: n.start, len: n.value.length, verbatim: !!n.verbatim });
                    break;
                case "tag":
                    push(schema.text("#" + (n.name ?? ""), marks), { src: n.start, len: (n.name?.length ?? 0) + 1, verbatim: true });
                    break;
                case "softBreak":
                case "hardBreak":
                    push(schema.nodes.hard_break.create({ soft: n.type === "softBreak" }, null, marks));
                    break;
                case "code":
                    if (n.value) push(schema.text(n.value, schema.marks.code.create().addToSet(marks)), { src: n.start, len: 0, verbatim: false });
                    break;
                case "emphasis":
                    wrap(schema.marks.em.create());
                    break;
                case "strong":
                    wrap(schema.marks.strong.create());
                    break;
                case "strike":
                    wrap(schema.marks.strike.create());
                    break;
                case "highlight":
                    wrap(schema.marks.highlight.create({ color: n.color ?? "" }));
                    break;
                case "link":
                    wrap(schema.marks.link.create({ href: n.url ?? "", title: n.title ?? "" }));
                    break;
                case "wikiLink":
                    push(schema.nodes.wiki_link.create({ target: n.target, label: n.label ?? "", embed: !!n.embed }, null, marks), {
                        src: n.start,
                        len: 0,
                        verbatim: false,
                    });
                    break;
                default:
                    // math, image, footnoteRef, htmlInline, comment
                    push(schema.nodes.md_inline.create({ src: source.slice(n.start, n.end), kind: n.type }, null, marks), {
                        src: n.start,
                        len: 0,
                        verbatim: false,
                    });
            }
        }
    };

    const textblock = (n: MdNode): PMNode[] => {
        const out: PMNode[] = [];
        const pts: Point[] = [];
        inline(n.children, Mark.none, out, pts, { n: 0 });
        points.push(pts);
        return out;
    };

    const emptyParagraph = () => {
        points.push([]);
        return schema.nodes.paragraph.create();
    };

    const atom = (n: MdNode) => schema.nodes.md_block.create({ src: sourceOf(n) });

    const block = (n: MdNode): PMNode => {
        switch (n.type) {
            case "paragraph":
                return schema.nodes.paragraph.create(null, textblock(n));
            case "heading":
                return schema.nodes.heading.create({ level: n.level }, textblock(n));
            case "thematicBreak":
                return schema.nodes.horizontal_rule.create();
            case "codeBlock": {
                const text = (n.value ?? "").replace(/\n$/, "");
                points.push([]);
                return schema.nodes.code_block.create({ info: n.info ?? "" }, text ? schema.text(text) : null);
            }
            case "blockquote": {
                const kids = (n.children ?? []).map(block);
                if (kids.length === 0) kids.push(emptyParagraph());
                return schema.nodes.blockquote.create(null, kids);
            }
            case "callout": {
                const eol = source.indexOf("\n", n.start);
                const m = reCalloutLine.exec(source.slice(source.lastIndexOf("\n", n.start - 1) + 1, eol < 0 ? source.length : eol));
                if (!m) return atom(n);
                const kids = (n.children ?? []).map(block);
                if (kids.length === 0) kids.push(emptyParagraph());
                return schema.nodes.callout.create({ kind: m[1], fold: m[2], title: m[3].trim() }, kids);
            }
            case "list": {
                const items = n.children ?? [];
                if (items.some((it) => it.children?.[0] && it.children[0].type !== "paragraph")) return atom(n);
                const pmItems = items.map((it) => {
                    const kids = (it.children ?? []).map(block);
                    if (kids.length === 0) kids.push(emptyParagraph());
                    return schema.nodes.list_item.create({ checked: it.checked ?? null }, kids);
                });
                return n.ordered
                    ? schema.nodes.ordered_list.create({ order: n.listStart ?? 1, tight: !!n.tight }, pmItems)
                    : schema.nodes.bullet_list.create({ tight: !!n.tight }, pmItems);
            }
            default:
                // table, mathBlock, htmlBlock, commentBlock, footnoteDef
                return atom(n);
        }
    };

    // Top level: blocks plus any source between them that is not a block (link and footnote
    // definitions, which the parser takes out of the tree) as atoms.
    const tops: { start: number; node: PMNode }[] = [];
    let cursor = 0;
    const gap = (from: number, to: number) => {
        const text = source.slice(from, to);
        if (text.trim()) {
            const s = from + (text.length - text.replace(/^\s+/, "").length);
            tops.push({ start: s, node: schema.nodes.md_block.create({ src: text.trim() }) });
        }
    };
    for (const c of tree.children) {
        if (c.start > cursor) gap(cursor, c.start);
        tops.push({ start: c.start, node: block(c) });
        cursor = Math.max(cursor, c.end);
    }
    gap(cursor, source.length);

    if (tops.length === 0) {
        const doc = schema.nodes.doc.create(null, emptyParagraph());
        return { doc, originals: [], points, lead: source };
    }
    const lead = source.slice(0, tops[0].start);
    const originals = tops.map((t, i) => ({
        node: t.node,
        src: source.slice(t.start, i + 1 < tops.length ? tops[i + 1].start : source.length),
    }));
    const doc = schema.nodes.doc.create(null, Fragment.fromArray(tops.map((t) => t.node)));
    // Textblocks were converted depth-first in source order (gap atoms have none), so `points`
    // is already in document order.
    return { doc, originals, points, lead };
}

/** ProseMirror position for a source offset (null = unknown). */
export function positionForOffset(loaded: Loaded, offset: number | null): number | null {
    if (offset === null) return null;
    let i = 0;
    let best: number | null = null;
    let bestSrc = -1;
    loaded.doc.descendants((node, pos) => {
        if (!node.isTextblock) return true;
        const pts = loaded.points[i++] ?? [];
        for (const p of pts) {
            if (p.src > offset) break;
            if (p.src >= bestSrc) {
                bestSrc = p.src;
                const inside = p.verbatim ? Math.min(offset - p.src, p.len) : 0;
                best = pos + 1 + p.at + inside;
            }
        }
        if (pts.length === 0 && best === null) best = pos + 1;
        return false;
    });
    return best;
}

// ---- saving -------------------------------------------------------------------------------------

/** Writes the document as BFM, reusing the original source of untouched top-level blocks. */
export function save(doc: PMNode, loaded: Pick<Loaded, "originals" | "lead"> | null): string {
    const used = new Set<number>();
    const originals = loaded?.originals ?? [];
    const findOriginal = (node: PMNode, index: number): string | null => {
        let at = originals.findIndex((o, i) => !used.has(i) && o.node === node);
        if (at < 0 && originals[index] && !used.has(index) && originals[index].node.eq(node)) at = index;
        if (at < 0) at = originals.findIndex((o, i) => !used.has(i) && o.node.eq(node));
        if (at < 0) return null;
        used.add(at);
        return originals[at].src;
    };

    let out = "";
    let first = true;
    let prevGenerated = false;
    let prev: { node: PMNode; text: string } | null = null;
    doc.forEach((node, _offset, index) => {
        const orig = findOriginal(node, index);
        if (orig !== null) {
            if (first) out += loaded?.lead ?? "";
            else if (prevGenerated) out += "\n\n";
            out += orig;
            prevGenerated = false;
            prev = { node, text: orig };
        } else {
            const text = blockToMarkdown(node, prev);
            if (text === "") return; // empty paragraphs are not kept
            if (!first) {
                if (prevGenerated) out += "\n\n";
                else if (!out.endsWith("\n\n")) out += out.endsWith("\n") ? "\n" : "\n\n";
            }
            out += text;
            prevGenerated = true;
            prev = { node, text };
        }
        first = false;
    });
    return out;
}

function indent(text: string, first: string, rest: string): string {
    return text
        .split("\n")
        .map((line, i) => (i === 0 ? first + line : line === "" ? rest.trimEnd() : rest + line))
        .join("\n");
}

/**
 * One block as BFM. `prev` is the block written just before it at the same level: a list right
 * after a list of the same kind switches marker so the two do not merge.
 */
export function blockToMarkdown(node: PMNode, prev: { node: PMNode; text: string } | null = null): string {
    switch (node.type.name) {
        case "paragraph":
            return inlineToMarkdown(node);
        case "heading": {
            let text = inlineToMarkdown(node, true);
            // A trailing run of # would be read as the closing sequence.
            text = text.replace(/(^|[ \t])(#+)([ \t]*)$/, (_m, sp: string, hashes: string, tail: string) => sp + "\\" + hashes + tail);
            return "#".repeat(node.attrs.level) + (text ? " " + text : "");
        }
        case "horizontal_rule":
            return "---";
        case "code_block": {
            const text = node.textContent;
            const info: string = node.attrs.info ?? "";
            const ch = info.includes("`") ? "~" : "`";
            const runs = text.match(ch === "`" ? /`{3,}/g : /~{3,}/g) ?? [];
            const fence = ch.repeat(Math.max(3, ...runs.map((r) => r.length + 1)));
            return fence + info + "\n" + text + (text ? "\n" : "") + fence;
        }
        case "blockquote":
            return indent(children(node), "> ", "> ");
        case "callout": {
            const head = `> [!${node.attrs.kind}]${node.attrs.fold ?? ""}${node.attrs.title ? " " + node.attrs.title : ""}`;
            const body = children(node);
            return body ? head + "\n" + indent(body, "> ", "> ") : head;
        }
        case "bullet_list":
        case "ordered_list": {
            const ordered = node.type.name === "ordered_list";
            const prevMarker = prev && prev.node.type === node.type ? /^\s*(?:[-+*]|\d+([.)]))/.exec(prev.text)?.[0].trim() : null;
            const bullet = prevMarker === "-" ? "*" : "-";
            const delim = prevMarker?.endsWith(".") ? ")" : ".";
            const tight = !!node.attrs.tight;
            const items: string[] = [];
            let n = node.attrs.order ?? 1;
            node.forEach((item) => {
                const marker = ordered ? `${n++}${delim} ` : `${bullet} `;
                const checked = item.attrs.checked;
                const task = checked === null || checked === undefined ? "" : checked ? "[x] " : "[ ] ";
                const body = children(item, tight ? "\n" : "\n\n");
                items.push(indent(task + body, marker, " ".repeat(marker.length)));
            });
            return items.join(tight ? "\n" : "\n\n");
        }
        case "md_block":
            return node.attrs.src;
        default:
            return children(node);
    }
}

function children(node: PMNode, sep = "\n\n"): string {
    const parts: string[] = [];
    let prev: { node: PMNode; text: string } | null = null;
    node.forEach((c) => {
        const text = blockToMarkdown(c, prev);
        parts.push(text);
        prev = { node: c, text };
    });
    return parts.join(sep);
}

// ---- inline -------------------------------------------------------------------------------------

const MARK_ORDER = ["link", "strong", "em", "strike", "highlight", "code"];

function markOpen(m: Mark): string {
    switch (m.type.name) {
        case "strong":
            return "**";
        case "em":
            return "*";
        case "strike":
            return "~~";
        case "highlight":
            return "==";
        case "link":
            return "[";
        default:
            return "";
    }
}

function markClose(m: Mark): string {
    switch (m.type.name) {
        case "strong":
            return "**";
        case "em":
            return "*";
        case "strike":
            return "~~";
        case "highlight":
            return "==" + (m.attrs.color && m.attrs.color !== "yellow" ? `{${m.attrs.color}}` : "");
        case "link": {
            const href: string = m.attrs.href ?? "";
            const dest =
                href === "" || /[\s<>]/.test(href) || !balanced(href)
                    ? `<${href.replace(/[<>\n]/g, (c) => encodeURIComponent(c))}>`
                    : href.replace(/\\/g, "\\\\");
            const title: string = m.attrs.title ?? "";
            return "](" + dest + (title ? ` "${title.replace(/["\\]/g, "\\$&")}"` : "") + ")";
        }
        default:
            return "";
    }
}

function balanced(s: string): boolean {
    let depth = 0;
    for (const c of s) {
        if (c === "(") depth++;
        else if (c === ")" && --depth < 0) return false;
    }
    return depth === 0;
}

function codeSpan(text: string): string {
    const runs = text.match(/`+/g) ?? [];
    let n = 1;
    while (runs.some((r) => r.length === n)) n++;
    const fence = "`".repeat(n);
    const pad = text.startsWith("`") || text.endsWith("`") || (/^ .* $/.test(text) && text.trim() !== "") ? " " : "";
    return fence + pad + text + pad + fence;
}

const reAutolinkText = /^(?:https?:\/\/[^\s<]+|www\.[^\s<]+|[a-zA-Z0-9._+-]+@[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+)$/;

/** A URL / e-mail link written so it links again: bare when that works here, else `<url>`. */
function autolink(text: string, href: string, before: string): string {
    const prev = before.slice(-1);
    if (prev === "" || /[\s(*_~]/.test(prev) || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(prev)) {
        const n = parse(text).children[0]?.children?.[0];
        if (n && n.type === "link" && n.url === href && n.end - n.start === text.length) return text;
    }
    if (href === text && !/[\s<>]/.test(text)) return "<" + text + ">";
    return "[" + escapeText(text, "x", "", true) + "](" + href + ")";
}

function autolinkMatches(text: string, href: string): boolean {
    return href === text || href === "http://" + text || href === "mailto:" + text;
}

/** Inline content as BFM. `flat`: line breaks become spaces (headings). */
export function inlineToMarkdown(parent: PMNode, flat = false): string {
    type Piece = { kind: "text" | "raw" | "auto"; text: string; marks: readonly Mark[]; href?: string };
    const pieces: Piece[] = [];
    const plainMarks = (marks: readonly Mark[]) => marks.filter((m) => m.type.name !== "code");
    parent.forEach((node) => {
        if (node.isText) {
            const text = node.text!;
            if (node.marks.some((m) => m.type.name === "code")) {
                pieces.push({ kind: "raw", text: codeSpan(text), marks: plainMarks(node.marks) });
                return;
            }
            const link = node.marks.find((m) => m.type.name === "link");
            if (link && node.marks.length === 1 && reAutolinkText.test(text) && autolinkMatches(text, link.attrs.href)) {
                pieces.push({ kind: "auto", text, marks: [], href: link.attrs.href });
                return;
            }
            pieces.push({ kind: "text", text, marks: node.marks });
        } else if (node.type.name === "hard_break") {
            if (flat) pieces.push({ kind: "text", text: " ", marks: node.marks });
            else pieces.push({ kind: "raw", text: node.attrs.soft ? "\n" : "\\\n", marks: node.marks });
        } else if (node.type.name === "wiki_link") {
            const esc = (s: string) => s.replace(/[\]|\\[]/g, "\\$&");
            const t: string = node.attrs.target;
            const l: string = node.attrs.label;
            pieces.push({ kind: "raw", text: (node.attrs.embed ? "!" : "") + "[[" + esc(t) + (l ? "|" + esc(l) : "") + "]]", marks: node.marks });
        } else if (node.type.name === "md_inline") {
            pieces.push({ kind: "raw", text: node.attrs.src, marks: node.marks });
        }
    });

    let out = "";
    let open: Mark[] = [];
    const closeTo = (keep: number) => {
        while (open.length > keep) out += markClose(open.pop()!);
    };
    /** How many of the open marks (from the outside) are all still wanted. */
    const keepCount = (want: readonly Mark[]) => {
        let k = 0;
        while (k < open.length && open[k].isInSet(want)) k++;
        return k;
    };
    for (let i = 0; i < pieces.length; i++) {
        const p = pieces[i];
        const want = plainMarks(p.marks);
        let text = p.text;
        let keep = keepCount(want);
        const opening = want.some((m) => !m.isInSet(open.slice(0, keep)));
        // Whitespace at the start of a piece that opens marks goes before the delimiters.
        if (p.kind === "text" && opening) {
            const lead = /^[ \t]+/.exec(text)?.[0] ?? "";
            if (lead && lead.length < text.length) {
                closeTo(keep);
                out += escapeText(lead, out, text.slice(lead.length), false);
                text = text.slice(lead.length);
            }
        }
        closeTo(keep);
        // Marks that last longer open first (outside), so they need not close early.
        const span = (m: Mark) => {
            let k = i + 1;
            while (k < pieces.length && m.isInSet(pieces[k].marks)) k++;
            return k - i;
        };
        const toOpen = want
            .filter((m) => !m.isInSet(open))
            .sort((a, b) => span(b) - span(a) || MARK_ORDER.indexOf(a.type.name) - MARK_ORDER.indexOf(b.type.name));
        // `!` right before a link would make it an image.
        if (toOpen[0]?.type.name === "link" && /(^|[^\\])!$/.test(out)) out = out.slice(0, -1) + "\\!";
        for (const m of toOpen) {
            out += markOpen(m);
            open.push(m);
        }
        // Whitespace at the end of a piece before marks close goes after the delimiters.
        let trail = "";
        const next = pieces[i + 1];
        const nextMarks = next ? plainMarks(next.marks) : [];
        const closing = open.some((m) => !m.isInSet(nextMarks));
        if (p.kind === "text" && closing) {
            const t = /[ \t]+$/.exec(text)?.[0] ?? "";
            if (t && t.length < text.length) {
                trail = t;
                text = text.slice(0, text.length - t.length);
            }
        }
        const inLink = open.some((m) => m.type.name === "link");
        if (p.kind === "text") out += escapeText(text, out, trail || next?.text || "", inLink);
        else if (p.kind === "auto") out += autolink(text, p.href!, out);
        else out += text;
        if (trail) {
            let k = 0;
            while (k < open.length && open[k].isInSet(nextMarks)) k++;
            closeTo(k);
            out += trail;
        }
    }
    closeTo(0);
    return out;
}

const reEntityLike = /^&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/;
const reLineStartSyntax =
    /^(?:#{1,6}(?:[ \t]|$)|>|[-+*](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$)|(?:[-*_][ \t]*){3,}$|=+[ \t]*$|`{3}|~{3}|\$\$|%%|\[\^|\[!)/;

/** Escapes characters that would otherwise start Markdown syntax. */
export function escapeText(text: string, before: string, after: string, inLink = false): string {
    let s = "";
    let lineStart = before === "" || before.endsWith("\n");
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        const prev = i > 0 ? text[i - 1] : before.slice(-1);
        const next = i + 1 < text.length ? text[i + 1] : after.charAt(0);
        if (lineStart) {
            // Spaces at the start of a line would be dropped by the parser (or start code): leave
            // them out. (A full-width space, the Chinese paragraph indent, is kept.)
            if (c === " ") continue;
            lineStart = false;
            if (c === "\t") {
                s += "&#9;";
                continue;
            }
            const rest = text.slice(i);
            if (reLineStartSyntax.test(rest)) {
                const m = /^\d{1,9}/.exec(rest);
                if (m) {
                    s += m[0] + "\\" + rest[m[0].length];
                    i += m[0].length;
                } else s += "\\" + c;
                continue;
            }
        }
        switch (c) {
            case "\n":
                s += "&#10;";
                break;
            case "\\":
                s += i === text.length - 1 || /[!-/:-@[-`{-~]/.test(next) ? "\\\\" : "\\";
                break;
            case "*":
            case "`":
            case "[":
                s += "\\" + c;
                break;
            case "]":
                s += inLink ? "\\]" : "]";
                break;
            case "_":
                s += /[\p{L}\p{N}]/u.test(prev) && /[\p{L}\p{N}]/u.test(next) ? "_" : "\\_";
                break;
            case "~":
            case "=":
            case "%":
                s += next === c || prev === c ? "\\" + c : c;
                break;
            case "$":
                s += prev === "$" || next === "$" || (/\S/.test(next) && text.indexOf("$", i + 1) >= 0) ? "\\$" : "$";
                break;
            case "<":
                s += /[A-Za-z/!?]/.test(next) ? "\\<" : "<";
                break;
            case "&":
                s += reEntityLike.test(text.slice(i)) ? "\\&" : "&";
                break;
            case "!":
                s += next === "[" ? "\\!" : "!";
                break;
            case "@":
                // `@key` in typed text would become a citation (e-mails, `a@b`, stay as they are).
                s +=
                    /[\p{L}\p{N}_]/u.test(next) && !(/[A-Za-z0-9_+.\-/\\]/.test(prev) && prev !== "")
                        ? "\\@"
                        : "@";
                break;
            default:
                s += c;
        }
    }
    return s;
}
