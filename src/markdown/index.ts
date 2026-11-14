/**
 * Banyan Flavored Markdown engine (see `Design/Markdown Language.md`).
 *
 *   source ─ parse() ─▶ syntax tree ─┬─ <Markdown> (React, `Markdown.tsx`)
 *                                    ├─ renderHtml()
 *                                    ├─ summarize() / plainText()
 *                                    └─ extractLinks()
 *
 * Everything goes through the one `parse()`, so every view agrees on what the text means.
 */
import type { Document, MdNode, ParseOptions } from "./ast.ts";
import { parseDocument } from "./blocks.ts";

export type { Align, Document, MdNode, NodeType, ParseOptions } from "./ast.ts";
export { renderHtml } from "./html.ts";

const cache = new Map<string, Document>();
const CACHE_MAX = 300;

/** Parses BFM. Results are cached (cards re-render often with the same text); treat them as read-only. */
export function parse(source: string, options?: ParseOptions): Document {
    if (options) return parseDocument(source, options);
    const hit = cache.get(source);
    if (hit) {
        cache.delete(source);
        cache.set(source, hit);
        return hit;
    }
    const doc = parseDocument(source);
    cache.set(source, doc);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    return doc;
}

const BLOCKISH = new Set(["listItem", "tableRow", "tableCell", "callout", "blockquote", "list", "table"]);

/** The readable text of nodes (links as their text, `[[links]]` as their label, math as source). */
export function plainText(nodes: MdNode[] | undefined): string {
    let s = "";
    for (const n of nodes ?? []) {
        switch (n.type) {
            case "text":
            case "code":
            case "math":
            case "codeBlock":
            case "mathBlock":
                s += n.value ?? "";
                break;
            case "softBreak":
            case "hardBreak":
                s += " ";
                break;
            case "wikiLink":
                s += n.label || n.target || "";
                break;
            case "tag":
                s += "#" + (n.name ?? "");
                break;
            case "htmlInline":
            case "htmlBlock":
            case "comment":
            case "commentBlock":
            case "footnoteRef":
                break;
            default:
                if (n.type === "callout" && n.titleChildren?.length) s += plainText(n.titleChildren) + " ";
                s += BLOCKISH.has(n.type)
                    ? (n.children ?? []).map((c) => plainText([c])).join(" ")
                    : plainText(n.children);
        }
    }
    return s;
}

/**
 * A one-line summary (zoomed-out cards, lists): blocks joined by " · ", cut at `max` characters.
 */
export function summarize(source: string, max = 120): string {
    const blocks: string[] = [];
    let length = 0;
    for (const block of parse(source).children) {
        if (block.type === "htmlBlock" || block.type === "commentBlock" || block.type === "thematicBreak") continue;
        const t = plainText([block]).replace(/\s+/g, " ").trim();
        if (!t) continue;
        blocks.push(t);
        length += t.length;
        if (length > max) break;
    }
    const out = blocks.join(" · ");
    return out.length > max ? out.slice(0, max - 1).trimEnd() + "…" : out;
}

export interface ExtractedLink {
    target: string;
    label: string;
    embed: boolean;
}

/** `[[links]]` in order of appearance, each target once. */
export function extractLinks(source: string): ExtractedLink[] {
    const seen = new Map<string, ExtractedLink>();
    const walk = (nodes: MdNode[] | undefined) => {
        for (const n of nodes ?? []) {
            if (n.type === "wikiLink" && n.target && !seen.has(n.target)) {
                seen.set(n.target, { target: n.target, label: n.label ?? "", embed: !!n.embed });
            }
            walk(n.children);
            walk(n.titleChildren);
        }
    };
    walk(parse(source).children);
    return [...seen.values()];
}

/** `#tags` in order of appearance, each once. */
export function extractTags(source: string): string[] {
    const seen = new Set<string>();
    const walk = (nodes: MdNode[] | undefined) => {
        for (const n of nodes ?? []) {
            if (n.type === "tag" && n.name) seen.add(n.name);
            walk(n.children);
            walk(n.titleChildren);
        }
    };
    walk(parse(source).children);
    return [...seen];
}

/**
 * Keys cited in a document (`[@key]`, `@key`, `[[@key]]`, `![[@key]]`), each once, in order of
 * first appearance. Annotation keys (`key:h3`) are kept as written.
 */
export function extractCitations(source: string | Document): string[] {
    const seen = new Set<string>();
    const walk = (nodes: MdNode[] | undefined) => {
        for (const n of nodes ?? []) {
            if (n.type === "citation") for (const c of n.cites ?? []) seen.add(c.key);
            if (n.type === "wikiLink" && n.target?.startsWith("@")) seen.add(n.target.slice(1));
            walk(n.children);
            walk(n.titleChildren);
        }
    };
    const document = typeof source === "string" ? parse(source) : source;
    walk(document.children);
    walk(document.footnotes);
    return [...seen];
}
