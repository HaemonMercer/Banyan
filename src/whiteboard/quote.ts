// Text written into a card when something textual is dragged onto it (an annotation's quote, another
// text card). Pure functions so they can be tested in node.
import { escapeText } from "../markdown/editorCore.ts";

/** Markdown that shows exactly this plain text (line breaks kept, syntax characters escaped). */
export function plainToMarkdown(text: string): string {
    return text
        .replace(/\r\n?/g, "\n")
        .trim()
        .split("\n")
        .map((l) => escapeText(l.trim(), "", ""))
        .join("\n");
}

/** Every line of `markdown` inside a blockquote. */
export function quoteLines(markdown: string): string {
    return markdown
        .split("\n")
        .map((l) => (l.trim() ? `> ${l}` : ">"))
        .join("\n");
}

/** An annotation's quote as a blockquote ending with its citation (`[@key]`), then its note. */
export function annotationBlock(quote: string, key: string | null, note = ""): string {
    let body = plainToMarkdown(quote);
    if (key) body += ` [@${key}]`;
    let out = quoteLines(body);
    if (note.trim()) out += "\n\n" + plainToMarkdown(note);
    return out;
}

/** A text card's title and content as a blockquote, ending with a link back to the card. */
export function cardBlock(id: number, title: string, content: string): string {
    const name = title.trim().replace(/[\]|\n]/g, " ");
    const parts: string[] = [];
    if (name) parts.push(`**${plainToMarkdown(name)}**`);
    if (content.trim()) parts.push(content.replace(/\r\n?/g, "\n").trim());
    parts.push(`— [[card:${id}|${name || "卡片"}]]`);
    return quoteLines(parts.join("\n\n"));
}

/** `content` with `block` added as a new paragraph at the end. */
export function appendBlock(content: string, block: string): string {
    const base = content.replace(/\s+$/, "");
    return base ? `${base}\n\n${block}` : block;
}
