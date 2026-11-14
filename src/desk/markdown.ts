import type { Document, MdNode } from "../markdown/ast.ts";
import { parse } from "../markdown/index.ts";
import { closingBrace } from "../markdown/inlines.ts";

const blockKinds: Record<string, string> = {
    "::cols": "columns",
    "::cols 2:1": "columns",
    "::center": "center",
    "::right": "right",
    "::left": "left",
    "::justify": "justify",
    "::box": "box",
    "::::columns": "columns",
    '::::columns{widths="2 1"}': "columns",
    ":::center": "center",
    ":::right": "right",
    ":::left": "left",
    ":::justify": "justify",
    ":::box": "box",
};

const reScopeLine = /^[ \t]*::(?:push\([ \t]*([^()\r\n]*[^()\s][^()\r\n]*?)[ \t]*\)|pop\(\))[ \t]*$/m;
const reLegacyAlign =/^(:::{0,1})(left|center|right|justify)[ \t]*\r?\n([\s\S]+?)^\1[ \t]*(?=\r?\n|$)/my;

function addColumn(columns: MdNode, start: number) {
    const children = columns.children!;
    const previous = children[children.length - 1];
    if (previous) previous.end = start;
    const column: MdNode = { type: "layout", kind: "column", start, end: start, children: [] };
    children.push(column);
    return column;
}

export function columnWidths(ratio: string): number[] | null {
    const parts = ratio.split(":").map((part) => part.trim());
    if (parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) return null;
    const widths = parts.map(Number);
    const total = widths.reduce((sum, width) => sum + width, 0);
    return Number.isFinite(total) && widths.every((width) => width > 0 && width / total > 0) ? widths : null;
}

function compactColumns(source: string, start: number) {
    const header = /^::Col\(([^)\r\n]*)\)\s*\{/.exec(source.slice(start));
    if (!header) return null;
    const widths = header[1].trim() ? columnWidths(header[1]) : undefined;
    if (widths === null) return null;
    let at = start + header[0].length;
    const columns: { start: number; end: number }[] = [];
    while (true) {
        const from = at;
        at = closingBrace(source, from);
        if (at < 0) return null;
        columns.push({ start: from, end: at++ });
        const separator = /^\s*(?:,\s*)?\{/.exec(source.slice(at));
        if (!separator) break;
        at += separator[0].length;
    }
    if (!/^[ \t]*(?:\r?\n|\r|$)/.test(source.slice(at))) return null;
    if (widths && widths.length !== columns.length) return null;
    return { columns, end: at, widths };
}

function offsetNode(node: MdNode, offset: number): MdNode {
    return {
        ...node, start: node.start + offset, end: node.end + offset,
        children: node.children?.map((child) => offsetNode(child, offset)),
        titleChildren: node.titleChildren?.map((child) => offsetNode(child, offset)),
    };
}

// The editor, the cursor toolbar and the preview all parse the same text on every keystroke.
// Keep only a few recent results: documents can hold megabytes of embedded images.
const cache = new Map<string, Document>();
const CACHE_MAX = 4;

/** Desk directives are standalone Markdown blocks. Unmatched markers stay visible. Results are cached; treat them as read-only. */
export function parseDesk(markdown: string): Document {
    const hit = cache.get(markdown);
    if (hit) {
        cache.delete(markdown);
        cache.set(markdown, hit);
        return hit;
    }
    const doc = parseDeskBlocks(markdown);
    cache.set(markdown, doc);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    return doc;
}

function parseDeskBlocks(markdown: string): Document {
    const doc = parse(markdown, { deskDecorations: true });
    const literalBlocks = doc.children.filter((node) => node.type === "codeBlock" || node.type === "mathBlock" || node.type === "htmlBlock");
    const footnotes = [...doc.footnotes];
    const stack: { marker: string; node: MdNode; opener: MdNode; parent: MdNode[]; column?: MdNode }[] = [];
    const children: MdNode[] = [];
    let consumed = 0;
    for (const block of doc.children) {
        const current = stack[stack.length - 1];
        const output = (current?.column ?? current?.node)?.children ?? children;
        if (block.start < consumed) {
            if (block.end > consumed) {
                output.push(...parseDeskBlocks(markdown.slice(consumed, block.end)).children.map((child) => offsetNode(child, consumed)));
            }
            continue;
        }
        const compact = block.type === "paragraph" ? compactColumns(markdown, block.start) : null;
        const source = block.type === "paragraph" ? markdown.slice(block.start) : "";
        const open = /^::(left|center|right|justify|box)(?:\(\))?\s*\{/.exec(source);
        // Sticky: only a match at the start of the block counts, so never scan the rest of the document for one.
        reLegacyAlign.lastIndex = 0;
        const legacyAlign = source.startsWith("::") ? reLegacyAlign.exec(source) : null;
        if (!open && legacyAlign?.index === 0 && legacyAlign[0].length <= block.end - block.start) {
            const start = block.start + legacyAlign[0].indexOf("\n") + 1;
            output.push({
                ...block, end: block.start + legacyAlign[0].length, type: "layout", kind: legacyAlign[2],
                children: parseDeskBlocks(legacyAlign[3]).children.map((child) => offsetNode(child, start)),
            });
            consumed = block.start + legacyAlign[0].length;
            output.push(...parseDeskBlocks(markdown.slice(consumed, block.end)).children.map((child) => offsetNode(child, consumed)));
            continue;
        }
        const start = block.start + (open?.[0].length ?? 0);
        const end = open ? closingBrace(markdown, start, literalBlocks) : -1;
        if (open && end >= 0 && (end >= block.end || !markdown.slice(end + 1, block.end).split(/\r?\n/, 1)[0].trim())) {
            const inner = parseDeskBlocks(markdown.slice(start, end));
            footnotes.push(...inner.footnotes.map((note) => offsetNode(note, start)));
            output.push({
                ...block, end: end + 1, type: "layout", kind: open[1],
                children: inner.children.map((child) => offsetNode(child, start)),
            });
            consumed = end + 1;
            output.push(...parseDeskBlocks(markdown.slice(consumed, block.end)).children.map((child) => offsetNode(child, consumed)));
            continue;
        }
        if (compact) {
            output.push({
                type: "layout", kind: "columns", start: block.start, end: compact.end,
                columnWidths: compact.widths,
                children: compact.columns.map(({ start, end }) => ({
                    type: "layout", kind: "column", start, end,
                    children: parseDeskBlocks(markdown.slice(start, end)).children.map((child) => offsetNode(child, start)),
                })),
            });
            consumed = compact.end;
            output.push(...parseDeskBlocks(markdown.slice(consumed, block.end)).children.map((child) => offsetNode(child, consumed)));
            continue;
        }
        // `::push(name)` / `::pop()` lines may sit inside a paragraph without blank lines around them.
        const scopeLine = block.type === "paragraph" ? reScopeLine.exec(markdown.slice(block.start, block.end)) : null;
        if (scopeLine) {
            const from = block.start + scopeLine.index;
            const to = from + scopeLine[0].length;
            if (from > block.start) {
                output.push(...parseDeskBlocks(markdown.slice(block.start, from)).children.map((child) => offsetNode(child, block.start)));
            }
            const text = scopeLine[0].trim();
            output.push({
                type: "layout", kind: scopeLine[1] === undefined ? "stylePop" : "stylePush", name: scopeLine[1]?.trim(), start: from, end: to,
                children: [{ type: "text", value: text, start: from + scopeLine[0].indexOf(text), end: from + scopeLine[0].indexOf(text) + text.length }],
            });
            if (to < block.end) {
                output.push(...parseDeskBlocks(markdown.slice(to, block.end)).children.map((child) => offsetNode(child, to)));
            }
            consumed = block.end;
            continue;
        }
        const marker = block.type === "paragraph" ? markdown.slice(block.start, block.end).trim() : "";
        const kind = Object.prototype.hasOwnProperty.call(blockKinds, marker) ? blockKinds[marker] : undefined;
        if (current && marker === current.marker &&
            (current.column || current.node.kind !== "columns" || (output.length > 0 && output.every((n) => n.kind === "column")))) {
            stack.pop();
            current.node.end = block.end;
            if (current.column) current.column.end = block.start;
            const parent = stack[stack.length - 1];
            ((parent?.column ?? parent?.node)?.children ?? children).push(current.node);
        } else if (marker === "::next" && current?.column && current.node.children?.length === 1) {
            current.column = addColumn(current.node, block.end);
        } else if (kind || (marker === ":::column" && current?.node.kind === "columns" && !current.column)) {
            const short = !marker.startsWith(":::");
            const node: MdNode = {
                ...block, type: "layout", kind: kind ?? "column", children: [],
                value: marker === "::cols 2:1" || marker.includes("widths") ? "wide" : undefined,
            };
            stack.push({
                marker: short ? "::" : marker.startsWith("::::") ? "::::" : ":::",
                node,
                column: short && kind === "columns" ? addColumn(node, block.end) : undefined,
                opener: block,
                parent: output,
            });
        } else if (marker === "::page" || marker === "::pagebreak") {
            output.push({ ...block, type: "pageBreak", children: [] });
        } else if (marker === "::toc" || marker === "::toc{depth=3}") {
            output.push({ ...block, type: "toc", children: [] });
        } else if (marker === "::refs") {
            output.push({ ...block, type: "bibliography", children: [] });
        } else {
            output.push(block);
        }
    }
    // Keep the unfinished marker visible while preserving already parsed siblings and directives.
    for (const frame of stack.reverse()) {
        const parsed = frame.node.kind === "columns" ? frame.node.children!.flatMap((node) =>
            node.kind === "column" ? node.children ?? [] : [node]) : frame.node.children!;
        frame.parent.push(frame.opener, ...parsed);
    }
    return { ...doc, children, footnotes: [...new Map(footnotes.map((note) => [note.name?.toUpperCase(), note])).values()] };
}

export function splitSlides(markdown: string): string[] {
    const slides: string[] = [];
    let start = 0;
    for (const block of parseDesk(markdown).children) {
        if (block.type !== "thematicBreak" || markdown.slice(block.start, block.end).trim() !== "---") continue;
        slides.push(markdown.slice(start, block.start).trim());
        start = block.end;
    }
    slides.push(markdown.slice(start).trim());
    return slides;
}
