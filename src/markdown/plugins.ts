/**
 * Banyan's own remark plugins.
 *
 * Extension policy (see Design Document「Markdown 語法」):
 * - New features use the generic directive syntax (`:name[label]{attrs}`, `::name{attrs}`,
 *   `:::name ... :::`) and get a renderer in `directives.tsx` — the parser never changes.
 * - Only very frequent syntax gets a dedicated shorthand. So far: `[[wikilink]]`.
 */
import type { Root, Text, PhrasingContent } from "mdast";
import { findAndReplace } from "mdast-util-find-and-replace";
import { visit } from "unist-util-visit";

/** `[[target]]` or `[[target|label]]`. */
export interface WikiLink {
    type: "wikiLink";
    target: string;
    label: string;
    /** The source text, e.g. `[[target|label]]`. */
    raw: string;
    data: { hName: "a"; hProperties: Record<string, string>; hChildren: Array<{ type: "text"; value: string }> };
}

declare module "mdast" {
    interface PhrasingContentMap {
        wikiLink: WikiLink;
    }
    interface RootContentMap {
        wikiLink: WikiLink;
    }
}

const WIKI_LINK = /\[\[([^\[\]|\n]+?)(?:\|([^\[\]\n]+?))?\]\]/g;

/** Turns `[[...]]` in text into `wikiLink` nodes (rendered as `<a class="md-wikilink" data-wikilink="target">`). */
export function remarkWikiLink() {
    return (tree: Root) => {
        findAndReplace(tree, [
            [
                WIKI_LINK,
                (whole: string, rawTarget: string, rawLabel?: string) => {
                    const target = rawTarget.trim();
                    if (!target) return false;
                    const label = rawLabel?.trim() || target;
                    const node: WikiLink = {
                        type: "wikiLink",
                        target,
                        label,
                        raw: whole,
                        data: {
                            hName: "a",
                            hProperties: { className: "md-wikilink", "data-wikilink": target, href: "#" },
                            hChildren: [{ type: "text", value: label }],
                        },
                    };
                    return node as unknown as PhrasingContent;
                },
            ],
        ]);
    };
}

/**
 * Maps directive nodes to elements a renderer can recognise:
 * `<span|div data-directive="name" data-directive-kind="text|leaf|container" data-attrs="{json}">`.
 *
 * A bare text directive (`:name` with no `[label]` and no `{attrs}`) is turned back into plain
 * text, so ordinary writing such as `note:abc` or `比例 1:a` is not swallowed.
 */
export function remarkBanyanDirectives() {
    return (tree: Root) => {
        visit(tree, (node, index, parent) => {
            if (node.type !== "textDirective" && node.type !== "leafDirective" && node.type !== "containerDirective") return;
            const attrs = node.attributes ?? {};
            if (node.type === "textDirective" && node.children.length === 0 && Object.keys(attrs).length === 0) {
                if (parent && index !== undefined) {
                    const text: Text = { type: "text", value: ":" + node.name };
                    parent.children.splice(index, 1, text as never);
                }
                return;
            }
            const kind = node.type === "textDirective" ? "text" : node.type === "leafDirective" ? "leaf" : "container";
            node.data = {
                ...node.data,
                hName: kind === "text" ? "span" : "div",
                hProperties: {
                    "data-directive": node.name,
                    "data-directive-kind": kind,
                    "data-attrs": JSON.stringify(attrs),
                },
            };
        });
    };
}

/**
 * For the WYSIWYG editor: replaces syntax the editor has no dedicated node for with `bnRaw`
 * nodes that keep the exact source text. The editor shows them as rendered, uneditable chips
 * (double-click to edit the source) and writes `value` back unchanged, so nothing is lost.
 */
export interface BnRaw {
    type: "bnRaw";
    inline: boolean;
    value: string;
}

const RAW_INLINE = new Set(["wikiLink", "inlineMath", "textDirective", "linkReference", "imageReference"]);
const RAW_BLOCK = new Set(["math", "leafDirective", "containerDirective", "definition"]);

export function remarkBanyanRaw() {
    return (tree: Root, file: { value?: unknown }) => {
        const source = typeof file?.value === "string" ? file.value : "";
        visit(tree, (node, index, parent) => {
            const inline = RAW_INLINE.has(node.type);
            if (!inline && !RAW_BLOCK.has(node.type)) return;
            if (!parent || index === undefined) return;
            let value: string | undefined;
            if (node.type === "wikiLink") value = (node as unknown as WikiLink).raw;
            const pos = (node as { position?: import("unist").Position }).position;
            if (value === undefined && pos?.start.offset !== undefined && pos.end.offset !== undefined) {
                value = source.slice(pos.start.offset, pos.end.offset);
            }
            if (value === undefined) return;
            const raw: BnRaw = { type: "bnRaw", inline, value };
            parent.children.splice(index, 1, raw as never);
            return "skip";
        });
    };
}
