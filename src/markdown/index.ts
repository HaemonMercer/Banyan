/**
 * Shared Markdown layer (文字模型). Built on unified / remark:
 *
 *   remark-parse → mdast → remark plugins → (remark-rehype → hast → React)
 *
 * Every module (Whiteboard cards, Drawer note cards, later Writer / Layout / Publisher)
 * should go through `remarkPlugins` so they all accept the same syntax.
 */
/// <reference types="mdast-util-directive" />
import type { Root } from "mdast";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified, type PluggableList } from "unified";
import { visit } from "unist-util-visit";
import { remarkBanyanDirectives, remarkWikiLink } from "./plugins";

export { registerDirective, type DirectiveProps, type DirectiveRenderer } from "./directives";

/** The syntax Banyan accepts, in order. */
export const remarkPlugins: PluggableList = [remarkGfm, remarkMath, remarkDirective, remarkBanyanDirectives, remarkWikiLink];

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkDirective).use(remarkBanyanDirectives).use(remarkWikiLink);

/** Parses Markdown into an mdast tree with all Banyan plugins applied. */
export function parseMarkdown(source: string): Root {
    return parser.runSync(parser.parse(source)) as Root;
}

/** Distinct `[[targets]]` in a document, in order of appearance (for backlinks / link indexing). */
export function extractWikiLinks(source: string): string[] {
    const seen = new Set<string>();
    visit(parseMarkdown(source), "wikiLink", (node) => {
        seen.add((node as { target: string }).target);
    });
    return [...seen];
}

const BLOCK_CONTAINERS = new Set(["list", "listItem", "blockquote", "table", "tableRow", "containerDirective"]);

/**
 * A short plain-text summary of a document (e.g. for a zoomed-out card): blocks joined by
 * " · ", `[[links]]` as their label, math as its source, cut at `max` characters.
 */
export function summarizeMarkdown(source: string, max = 120): string {
    const textOf = (node: unknown): string => {
        const n = node as { type: string; value?: string; label?: string; target?: string; children?: unknown[] };
        if (n.type === "wikiLink") return n.label || n.target || "";
        if (typeof n.value === "string" && n.type !== "html") return n.value;
        // List items, table cells and the like are separate pieces of text; inline runs are not.
        const sep = BLOCK_CONTAINERS.has(n.type) ? " " : "";
        return (n.children ?? []).map(textOf).join(sep);
    };
    const blocks: string[] = [];
    let length = 0;
    for (const block of parseMarkdown(source).children) {
        if (block.type === "definition" || block.type === "html") continue;
        const t = textOf(block).replace(/\s+/g, " ").trim();
        if (!t) continue;
        blocks.push(t);
        length += t.length;
        if (length > max) break;
    }
    const out = blocks.join(" · ");
    return out.length > max ? out.slice(0, max - 1).trimEnd() + "…" : out;
}
