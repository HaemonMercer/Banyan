import { isMap, parseDocument } from "yaml";
import { parseDesk } from "./markdown.ts";
import { prepareYaml, readPage, unquoteYaml } from "./paper.ts";
import type { MdNode } from "../markdown/ast.ts";


export function deskFormatAt(source: string, position: number) {
    const { body } = readPage(source);
    const offset = source.length - body.length;
    const result = { heading: 0, bold: false, italic: false,
        /** The innermost `::style(name)` around the cursor. */
        style: null as string | null,
        alignment: null as { name: string; from: number; to: number } | null,
        marks: {} as Partial<Record<string, { from: number; to: number }>>,
        range: null as { from: number; to: number } | null };
    if (position < offset) return result;
    function visit(nodes: MdNode[]) {
        const at = position - offset;
        const node = nodes.find((n) => n.start <= at && at < n.end)
            ?? [...nodes].reverse().find((n) => n.end === at);
        if (!node) return;
        if (node.type === "layout" && ["left", "center", "right", "justify"].includes(node.kind ?? "")) {
            const marker = /^(:::{0,1})(left|center|right|justify)/.exec(body.slice(node.start));
            if (marker) {
                const from = offset + node.start + marker[1].length;
                result.alignment = { name: marker[2], from, to: from + marker[2].length };
            }
        }
        if (node.type === "heading") {
            result.heading = node.level ?? 1;
        }
        if (node.type === "deskStyle") result.style = node.name ?? null;
        if (node.type === "strong") result.bold = true;
        if (node.type === "emphasis") result.italic = true;
        if (["strong", "emphasis", "underline", "strike", "superscript", "subscript", "highlight"].includes(node.type)) {
            result.marks[node.type] = { from: offset + node.start, to: offset + node.end };
        }
        if (node.type === "text" && node.verbatim) {
            const text = body.slice(node.start, node.end);
            const index = at - node.start;
            const word = [...text.matchAll(/[\p{L}\p{N}\p{M}_]+/gu)].find((match) =>
                match.index! <= index && index <= match.index! + match[0].length);
            if (word) result.range = { from: offset + node.start + word.index!, to: offset + node.start + word.index! + word[0].length };
        }
        if (node.children) visit(node.children);
    }
    visit(parseDesk(body).children);
    return result;
}

export function setDeskHeading(source: string, from: number, to: number, level: number) {
    const { body } = readPage(source);
    const offset = source.length - body.length;
    if (from < offset || !Number.isInteger(level) || level < 0 || level > 6) return source;
    const edits: { from: number; to: number; insert: string }[] = [];
    function visit(nodes: MdNode[]) {
        for (const node of nodes) {
            const start = offset + node.start;
            const end = offset + node.end;
            if (to < start || from > end || (from < to && to === start)) continue;
            if (node.type === "heading" || node.type === "paragraph") {
                const raw = source.slice(start, end);
                const marker = /^#{1,6}(?:[ \t]+|$)/.exec(raw);
                const insert = level ? "#".repeat(level) + " " : "";
                if (node.type === "heading") {
                    const heading = marker ? raw.slice(marker[0].length).replace(/[ \t]+#+[ \t]*$/, "")
                        : raw.replace(/\r?\n[ \t]*(?:=+|-+)[ \t]*$/, "");
                    edits.push({ from: start, to: end, insert: insert + heading });
                } else if (level) {
                    const firstLine = raw.split(/\r?\n/, 1)[0];
                    if (firstLine) {
                        const newline = /^\r?\n/.exec(raw.slice(firstLine.length))?.[0];
                        if (newline) edits.push({ from: start + firstLine.length, to: start + firstLine.length, insert: newline });
                        edits.push({ from: start, to: start, insert });
                    }
                }
            } else if (node.children && ["layout", "blockquote", "list", "listItem"].includes(node.type)) visit(node.children);
        }
    }
    visit(parseDesk(body).children);
    return edits.sort((a, b) => b.from - a.from).reduce((text, edit) => text.slice(0, edit.from) + edit.insert + text.slice(edit.to), source);
}

function frontMatter(source: string) {
    const match = /^---[^\S\r\n]*\r?\n([\s\S]*?)^---[^\S\r\n]*(?=\r?\n|$)/m.exec(source);
    if (!match || match.index !== 0) return null;
    const offset = match[0].indexOf("\n") + 1;
    const yaml = parseDocument(prepareYaml(match[1]));
    return { yaml, offset, end: offset + match[1].length };
}

export function formatDeskSource(source: string) {
    const front = frontMatter(source);
    if (front?.yaml.errors.length) throw new Error("請先修正文件開頭的 YAML。");
    const { body } = readPage(source);
    const offset = source.length - body.length;
    const nodes = parseDesk(body).children;
    let formatted = source;
    for (const node of [...nodes].reverse()) {
        const start = offset + node.start;
        if (node.type === "heading") {
            const marker = /^#{1,6}[ \t]{2,}/.exec(source.slice(start, offset + node.end));
            if (marker) formatted = formatted.slice(0, start) + marker[0].trimEnd() + " " + formatted.slice(start + marker[0].length);
        }
        if (node.type === "codeBlock" && /^json(?:\s|$)/i.test(node.info ?? "")) {
            const end = offset + node.end;
            const fence = /^(`{3,}|~{3,})[^\r\n]*(\r?\n)[\s\S]*?(?=^[ \t]*(?:`{3,}|~{3,})[ \t]*$)/m.exec(source.slice(start, end));
            if (!fence || fence.index !== 0) continue;
            try {
                const value = JSON.parse(node.value ?? "");
                // Keep numbers, key ordering and escapes intact by formatting only if the token stream is unchanged.
                const compact = (json: string) => json.replace(/"(?:\\.|[^"\\])*"|\s+/g, (token) => token.startsWith('"') ? token : "");
                const pretty = JSON.stringify(value, null, 2);
                if (compact(node.value ?? "") !== compact(pretty)) continue;
                const content = start + fence[0].indexOf("\n") + 1;
                formatted = formatted.slice(0, content) + pretty.replace(/\n/g, fence[2]) + fence[2] + formatted.slice(start + fence[0].length);
            } catch {
                // Leave incomplete JSON untouched while editing.
            }
        }
    }
    if (front && isMap(front.yaml.contents)) {
        const newline = source.includes("\r\n") ? "\r\n" : "\n";
        formatted = formatted.slice(0, front.offset) + unquoteYaml(front.yaml.toString({ indent: 2 })).replace(/\n/g, newline) + formatted.slice(front.end);
    }
    return formatted;
}

/** The innermost short-form alignment block (`::center{…}` and friends) around `position`, as source offsets. */
export function alignmentBlockAt(source: string, position: number) {
    const { body } = readPage(source);
    const offset = source.length - body.length;
    const at = position - offset;
    let found: { name: string; nameFrom: number; nameTo: number; innerFrom: number; innerTo: number } | null = null;
    function visit(nodes: MdNode[] | undefined) {
        for (const node of nodes ?? []) {
            if (node.type !== "layout" || at < node.start || at > node.end) continue;
            const open = ["left", "center", "right", "justify"].includes(node.kind ?? "")
                ? /^::(left|center|right|justify)(?:\(\))?\s*\{/.exec(body.slice(node.start)) : null;
            if (open) {
                found = {
                    name: open[1], nameFrom: offset + node.start + 2, nameTo: offset + node.start + 2 + open[1].length,
                    innerFrom: offset + node.start + open[0].length, innerTo: offset + node.end - 1,
                };
            }
            visit(node.children);
        }
    }
    visit(parseDesk(body).children);
    return found as { name: string; nameFrom: number; nameTo: number; innerFrom: number; innerTo: number } | null;
}

/**
 * Aligns exactly the text from `from` to `to`: switches the alignment block whose whole content
 * that is, or wraps just that text in `::name{…}`, on its own lines so it parses as a block.
 * Returns the new source and where the cursor goes (inside the block), or null for an empty range.
 */
export function alignRange(source: string, from: number, to: number, name: string) {
    const { body } = readPage(source);
    const start0 = Math.max(from, source.length - body.length);
    let start = start0;
    let end = Math.max(start, to);
    while (start < end && /\s/.test(source[start])) start++;
    while (end > start && /\s/.test(source[end - 1])) end--;
    if (start === end) return null;
    const block = alignmentBlockAt(source, start);
    if (block) {
        let innerFrom = block.innerFrom;
        let innerTo = block.innerTo;
        while (innerFrom < innerTo && /\s/.test(source[innerFrom])) innerFrom++;
        while (innerTo > innerFrom && /\s/.test(source[innerTo - 1])) innerTo--;
        if (innerFrom === start && innerTo === end) {
            return { text: source.slice(0, block.nameFrom) + name + source.slice(block.nameTo), caret: end - block.name.length + name.length };
        }
    }
    const before = source.slice(0, start);
    const after = source.slice(end);
    // A block needs a blank line on each side; don't add one where there already is one.
    const prefix = !before.trim() || /\n[ \t]*\n[ \t]*$/.test(before) ? "" : /\n[ \t]*$/.test(before) ? "\n" : "\n\n";
    const suffix = !after.trim() || /^[ \t]*\n[ \t]*\n/.test(after) ? "" : /^[ \t]*\n/.test(after) ? "\n" : "\n\n";
    const wrapped = `::${name}{${source.slice(start, end)}}`;
    // Drop the spaces that sat between the selection and the new line breaks.
    const head = prefix ? before.replace(/[ \t]+$/, "") : before;
    const tail = suffix ? after.replace(/^[ \t]+/, "") : after;
    return { text: head + prefix + wrapped + suffix + tail, caret: head.length + prefix.length + wrapped.length - 1 };
}
