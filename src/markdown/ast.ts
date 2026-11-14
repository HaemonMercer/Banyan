/**
 * Banyan Flavored Markdown syntax tree.
 *
 * One tree feeds every use: rendering (React / HTML), summaries, search and link extraction.
 * Every node records where it came from in the source (`start`/`end`, UTF-16 offsets), so the
 * editor can map a click back to the text and later saves can rewrite only what changed.
 */

export type BlockType =
    | "document"
    | "paragraph"
    | "heading"
    | "thematicBreak"
    | "blockquote"
    | "callout"
    | "list"
    | "listItem"
    | "codeBlock"
    | "htmlBlock"
    | "mathBlock"
    | "table"
    | "tableRow"
    | "tableCell"
    | "footnoteDef"
    | "commentBlock"
    | "bibliography"
    | "layout"
    | "pageBreak"
    | "toc";

export type InlineType =
    | "underline"
    | "superscript"
    | "subscript"
    /** Desk `::style(name){…}`: `name` as written; Desk sets `value` once the style is found. */
    | "deskStyle"
    | "text"
    | "softBreak"
    | "hardBreak"
    | "code"
    | "emphasis"
    | "strong"
    | "strike"
    | "highlight"
    | "link"
    | "image"
    | "htmlInline"
    | "math"
    | "wikiLink"
    | "tag"
    | "footnoteRef"
    | "comment"
    | "citation";

export type NodeType = BlockType | InlineType;

export type Align = "left" | "center" | "right" | null;

export interface MdNode {
    /** Relative widths of Desk columns, in source order. */
    columnWidths?: number[];
    type: NodeType;
    /** Source offsets (inline offsets inside escapes/entities are approximate). */
    start: number;
    end: number;
    children?: MdNode[];
    /** text, code, html, math, comment: the literal content. */
    value?: string;

    /** heading level (1–6). */
    level?: number;
    /** list */
    ordered?: boolean;
    listStart?: number;
    tight?: boolean;
    /** listItem: task state (`- [ ]` false, `- [x]` true), null when not a task. */
    checked?: boolean | null;
    /** codeBlock: info string (language first). */
    info?: string;
    /** link / image */
    url?: string;
    title?: string;
    /** table: column alignment. tableRow: header row. */
    align?: Align[];
    header?: boolean;
    /** callout type (`note`, `warning`…); fold: "" | "+" | "-". */
    kind?: string;
    fold?: string;
    /** callout title (inline). */
    titleChildren?: MdNode[];
    /** wikiLink: `card:42`, `@kahneman2011`, or a bare title; label is the text after `|`. */
    target?: string;
    label?: string;
    embed?: boolean;
    /** highlight colour (yellow, red, green, blue, purple). */
    color?: string;
    /** tag name, footnote label. */
    name?: string;
    /** citation: the cited keys with their locators; narrative = written as `@key` in the text. */
    cites?: CiteRef[];
    narrative?: boolean;
    /** math: display (`$$…$$`) vs inline. */
    display?: boolean;
    /** text: the literal equals the source (no escapes/entities), so offsets inside it are exact. */
    verbatim?: boolean;
}

/** One key in a citation: `[見 @kahneman2011, p. 33]`, `[-@key]`. */
export interface CiteRef {
    key: string;
    /** Text before the key (`見`). */
    prefix: string;
    /** Text after the comma (`p. 33`). */
    locator: string;
    /** `-@key`: leave the author out. */
    suppressAuthor: boolean;
}

export interface LinkRef {
    destination: string;
    title: string;
}

export interface ParseOptions {
    /** Desk named styles in running text. */
    deskDecorations?: boolean;
    /** GFM extensions: tables, strikethrough, task lists, extended autolinks, footnotes. Default true. */
    gfm?: boolean;
    /** Banyan extensions: `==`, `[[ ]]`, `#tag`, `$math$`, `%% %%`, `> [!note]`. Default true. */
    bfm?: boolean;
}

export interface Document extends MdNode {
    type: "document";
    children: MdNode[];
    /** Footnote definitions in order of first reference. */
    footnotes: MdNode[];
}
