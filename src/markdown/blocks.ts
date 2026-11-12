/**
 * Block structure parser: CommonMark 0.31 (the two-phase algorithm from the spec appendix),
 * plus GFM tables, task lists and footnote definitions, and BFM math, comment and callout blocks.
 *
 * Phase 1 (this file) builds the block tree line by line; phase 2 (`inlines.ts`) parses the text
 * of paragraphs, headings and table cells.
 */
import type { Align, Document, LinkRef, MdNode, ParseOptions } from "./ast.ts";
import { CLOSETAG, OPENTAG, isBlank, isSpaceOrTab, unescapeString } from "./common.ts";
import { InlineParser, type InlineContext } from "./inlines.ts";

const CODE_INDENT = 4;

type BType =
    | "document"
    | "paragraph"
    | "heading"
    | "thematicBreak"
    | "blockquote"
    | "list"
    | "listItem"
    | "codeBlock"
    | "htmlBlock"
    | "mathBlock"
    | "table"
    | "footnoteDef"
    | "commentBlock";

interface ListData {
    type: "bullet" | "ordered";
    tight: boolean;
    bulletChar: string;
    start: number;
    delimiter: string;
    padding: number;
    markerOffset: number;
}

interface TableLine {
    text: string;
    src: number;
}

/** A block while it is being built. */
interface B {
    type: BType;
    parent: B | null;
    children: B[];
    open: boolean;
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
    /** Text collected for leaf blocks, lines joined with "\n". */
    content: string;
    /** Pairs (index in `content`, source offset) where each added piece begins. */
    segs: number[];
    level?: number;
    info?: string;
    literal?: string;
    fenced?: boolean;
    fenceChar?: string;
    fenceLength?: number;
    fenceOffset?: number;
    htmlType?: number;
    list?: ListData;
    label?: string;
    align?: Align[];
    tableRows?: TableLine[];
    /** Math block opened and closed on one line. */
    closedOnOpen?: boolean;
}

const reNonSpace = /[^ \t\f\v\r\n]/;
const reBulletListMarker = /^[*+-]/;
const reOrderedListMarker = /^(\d{1,9})([.)])/;
const reATXHeadingMarker = /^#{1,6}(?:[ \t]+|$)/;
const reCodeFence = /^`{3,}(?!.*`)|^~{3,}/;
const reClosingCodeFence = /^(?:`{3,}|~{3,})(?=[ \t]*$)/;
const reSetextHeadingLine = /^(?:=+|-+)[ \t]*$/;
const reThematicBreak = /^(?:\*[ \t]*){3,}$|^(?:_[ \t]*){3,}$|^(?:-[ \t]*){3,}$/;
const reMaybeSpecial = /^[#`~*+_=<>0-9\-|$%[:]/;
const reTableDelimRow = /^\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const reFootnoteDef = /^\[\^([^\]\s]+)\]:/;
const reMathFence = /^\$\$/;
const reCommentFence = /^%%[ \t]*$/;
const reCallout = /^\[!([A-Za-z][\w-]*)\]([+-]?)[ \t]*(.*)$/;
const reTaskMarker = /^\[([ xX])\](?:[ \t]+|$)/;

const reHtmlBlockOpen = [
    /./, // unused
    /^<(?:script|pre|textarea|style)(?:\s|>|$)/i,
    /^<!--/,
    /^<[?]/,
    /^<![A-Za-z]/,
    /^<!\[CDATA\[/,
    /^<[/]?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[123456]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|[/]?[>]|$)/i,
    new RegExp("^(?:" + OPENTAG + "|" + CLOSETAG + ")\\s*$", "i"),
];
const reHtmlBlockClose = [/./, /<\/(?:script|pre|textarea|style)>/i, /-->/, /\?>/, />/, /\]\]>/];

function newBlock(type: BType, line: number, col: number): B {
    return { type, parent: null, children: [], open: true, startLine: line, startCol: col, endLine: line, endCol: 0, content: "", segs: [] };
}

function lastChild(b: B): B | undefined {
    return b.children[b.children.length - 1];
}

function unlink(b: B) {
    const p = b.parent;
    if (!p) return;
    const i = p.children.indexOf(b);
    if (i >= 0) p.children.splice(i, 1);
    b.parent = null;
}

function insertAfter(b: B, sibling: B) {
    const p = b.parent!;
    p.children.splice(p.children.indexOf(b) + 1, 0, sibling);
    sibling.parent = p;
}

/** Splits a table row into raw cell texts with their offsets in the row. */
export function splitTableRow(line: string): { text: string; at: number }[] {
    let s = line;
    let base = 0;
    const lead = s.match(/^[ \t]*/)![0].length;
    s = s.slice(lead);
    base += lead;
    if (s.startsWith("|")) {
        s = s.slice(1);
        base += 1;
    }
    s = s.replace(/[ \t]*$/, "");
    if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
    const cells: { text: string; at: number }[] = [];
    let cur = "";
    let curAt = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === "\\" && s[i + 1] === "|") {
            cur += "|";
            i++;
        } else if (c === "|") {
            cells.push({ text: cur, at: curAt });
            cur = "";
            curAt = i + 1;
        } else cur += c;
    }
    cells.push({ text: cur, at: curAt });
    return cells.map((c) => {
        const l = c.text.match(/^[ \t]*/)![0].length;
        return { text: c.text.trim(), at: base + c.at + l };
    });
}

function parseAlign(row: string): Align[] {
    return splitTableRow(row).map(({ text }) => {
        const left = text.startsWith(":");
        const right = text.endsWith(":");
        return left && right ? "center" : right ? "right" : left ? "left" : null;
    });
}

export class BlockParser {
    opts: Required<ParseOptions>;
    doc: B;
    tip: B;
    oldtip: B;
    currentLine = "";
    lineNumber = 0;
    lineStarts: number[] = [0];
    offset = 0;
    column = 0;
    nextNonspace = 0;
    nextNonspaceColumn = 0;
    indent = 0;
    indented = false;
    blank = false;
    partiallyConsumedTab = false;
    allClosed = true;
    lastMatchedContainer: B;
    lastLineLength = 0;
    refmap: Record<string, LinkRef> = {};
    footnoteLabels = new Set<string>();
    inline: InlineParser;
    source = "";

    constructor(opts: Required<ParseOptions>) {
        this.opts = opts;
        this.doc = newBlock("document", 1, 0);
        this.tip = this.doc;
        this.oldtip = this.doc;
        this.lastMatchedContainer = this.doc;
        this.inline = new InlineParser(opts);
    }

    // ---- line cursor --------------------------------------------------------------------------

    findNextNonspace() {
        const line = this.currentLine;
        let i = this.offset;
        let cols = this.column;
        let c = "";
        while ((c = line.charAt(i)) !== "") {
            if (c === " ") {
                i++;
                cols++;
            } else if (c === "\t") {
                i++;
                cols += 4 - (cols % 4);
            } else break;
        }
        this.blank = c === "\n" || c === "\r" || c === "";
        this.nextNonspace = i;
        this.nextNonspaceColumn = cols;
        this.indent = this.nextNonspaceColumn - this.column;
        this.indented = this.indent >= CODE_INDENT;
    }

    advanceNextNonspace() {
        this.offset = this.nextNonspace;
        this.column = this.nextNonspaceColumn;
        this.partiallyConsumedTab = false;
    }

    advanceOffset(count: number, columns = false) {
        const line = this.currentLine;
        let c: string | undefined;
        while (count > 0 && (c = line[this.offset])) {
            if (c === "\t") {
                const charsToTab = 4 - (this.column % 4);
                if (columns) {
                    this.partiallyConsumedTab = charsToTab > count;
                    const charsToAdvance = charsToTab > count ? count : charsToTab;
                    this.column += charsToAdvance;
                    this.offset += this.partiallyConsumedTab ? 0 : 1;
                    count -= charsToAdvance;
                } else {
                    this.partiallyConsumedTab = false;
                    this.column += charsToTab;
                    this.offset += 1;
                    count -= 1;
                }
            } else {
                this.partiallyConsumedTab = false;
                this.offset += 1;
                this.column += 1;
                count -= 1;
            }
        }
    }

    peek(i: number): string | undefined {
        return this.currentLine[i];
    }

    srcAt(lineOffset: number): number {
        return this.lineStarts[this.lineNumber] + lineOffset;
    }

    // ---- tree ---------------------------------------------------------------------------------

    addLine() {
        const tip = this.tip;
        if (this.partiallyConsumedTab) {
            this.offset += 1;
            const charsToTab = 4 - (this.column % 4);
            tip.segs.push(tip.content.length, this.srcAt(this.offset));
            tip.content += " ".repeat(charsToTab);
        }
        tip.segs.push(tip.content.length, this.srcAt(this.offset));
        tip.content += this.currentLine.slice(this.offset) + "\n";
    }

    addChild(type: BType, offset: number): B {
        while (!canContain(this.tip.type, type)) this.finalize(this.tip, this.lineNumber - 1);
        const b = newBlock(type, this.lineNumber, offset);
        b.parent = this.tip;
        this.tip.children.push(b);
        this.tip = b;
        return b;
    }

    closeUnmatchedBlocks() {
        if (!this.allClosed) {
            while (this.oldtip !== this.lastMatchedContainer) {
                const parent = this.oldtip.parent!;
                this.finalize(this.oldtip, this.lineNumber - 1);
                this.oldtip = parent;
            }
            this.allClosed = true;
        }
    }

    finalize(block: B, lineNumber: number) {
        const above = block.parent;
        block.open = false;
        block.endLine = lineNumber;
        block.endCol = this.lastLineLength;
        this.finalizeBlock(block);
        this.tip = above ?? this.doc;
    }

    finalizeBlock(block: B) {
        switch (block.type) {
            case "paragraph": {
                let pos = 0;
                let hasRefs = false;
                while (block.content.charAt(0) === "[" && (pos = this.inline.parseReference(block.content, this.refmap))) {
                    shiftContent(block, pos);
                    hasRefs = true;
                }
                if (hasRefs && isBlank(block.content)) unlink(block);
                break;
            }
            case "codeBlock": {
                if (block.fenced) {
                    const nl = block.content.indexOf("\n");
                    const first = block.content.slice(0, nl);
                    block.info = unescapeString(first.trim());
                    block.literal = block.content.slice(nl + 1);
                } else {
                    const lines = block.content.split("\n");
                    while (lines.length > 0 && /^[ \t]*$/.test(lines[lines.length - 1])) lines.pop();
                    block.literal = lines.join("\n") + "\n";
                    block.endLine = block.startLine + lines.length - 1;
                    block.endCol = block.startCol + (lines[lines.length - 1]?.length ?? 0);
                }
                break;
            }
            case "htmlBlock":
                block.literal = block.content.replace(/(\n *)+$/, "");
                break;
            case "mathBlock":
            case "commentBlock":
                if (!block.closedOnOpen) {
                    const nl = block.content.indexOf("\n");
                    const extra = block.content.slice(0, nl).replace(/^(\$\$|%%)/, "").trim();
                    const body = block.content.slice(nl + 1).replace(/\n$/, "");
                    block.literal = extra ? (body ? extra + "\n" + body : extra) : body;
                }
                break;
            case "listItem":
                if (block.children.length > 0) {
                    const last = lastChild(block)!;
                    block.endLine = last.endLine;
                    block.endCol = last.endCol;
                } else {
                    block.endLine = block.startLine;
                    block.endCol = block.list!.markerOffset + block.list!.padding;
                }
                break;
            case "list": {
                const ends = (b: B, next: B | undefined) => next !== undefined && b.endLine !== next.startLine - 1;
                outer: for (let i = 0; i < block.children.length; i++) {
                    const item = block.children[i];
                    if (ends(item, block.children[i + 1])) {
                        block.list!.tight = false;
                        break;
                    }
                    for (let j = 0; j < item.children.length; j++) {
                        if (ends(item.children[j], item.children[j + 1])) {
                            block.list!.tight = false;
                            break outer;
                        }
                    }
                }
                const last = lastChild(block);
                if (last) {
                    block.endLine = last.endLine;
                    block.endCol = last.endCol;
                }
                break;
            }
            default:
                break;
        }
    }

    // ---- continuation -------------------------------------------------------------------------

    /** 0 = matched, 1 = not matched, 2 = line consumed (closing fence). */
    continueBlock(container: B): 0 | 1 | 2 {
        const line = this.currentLine;
        switch (container.type) {
            case "document":
            case "list":
                return 0;
            case "blockquote":
                if (!this.indented && this.peek(this.nextNonspace) === ">") {
                    this.advanceNextNonspace();
                    this.advanceOffset(1, false);
                    if (isSpaceOrTab(this.peek(this.offset))) this.advanceOffset(1, true);
                    return 0;
                }
                return 1;
            case "listItem":
            case "footnoteDef": {
                if (this.blank) {
                    if (container.children.length === 0) return 1;
                    this.advanceNextNonspace();
                    return 0;
                }
                const need = container.type === "listItem" ? container.list!.markerOffset + container.list!.padding : CODE_INDENT;
                if (this.indent >= need) {
                    this.advanceOffset(need, true);
                    return 0;
                }
                return 1;
            }
            case "heading":
            case "thematicBreak":
                return 1;
            case "codeBlock": {
                if (container.fenced) {
                    const match =
                        this.indent <= 3 &&
                        line.charAt(this.nextNonspace) === container.fenceChar &&
                        line.slice(this.nextNonspace).match(reClosingCodeFence);
                    if (match && match[0].length >= container.fenceLength!) {
                        this.lastLineLength = this.offset + this.indent + match[0].length;
                        this.finalize(container, this.lineNumber);
                        return 2;
                    }
                    let i = container.fenceOffset!;
                    while (i > 0 && isSpaceOrTab(this.peek(this.offset))) {
                        this.advanceOffset(1, true);
                        i--;
                    }
                    return 0;
                }
                if (this.indent >= CODE_INDENT) this.advanceOffset(CODE_INDENT, true);
                else if (this.blank) this.advanceNextNonspace();
                else return 1;
                return 0;
            }
            case "mathBlock":
            case "commentBlock": {
                if (container.closedOnOpen) return 1;
                const fence = container.type === "mathBlock" ? /^\$\$[ \t]*$/ : reCommentFence;
                if (this.indent <= 3 && fence.test(line.slice(this.nextNonspace))) {
                    this.lastLineLength = line.length;
                    this.finalize(container, this.lineNumber);
                    return 2;
                }
                return 0;
            }
            case "htmlBlock":
                return this.blank && (container.htmlType === 6 || container.htmlType === 7) ? 1 : 0;
            case "paragraph":
            case "table":
                return this.blank ? 1 : 0;
        }
    }

    // ---- block starts -------------------------------------------------------------------------

    /** 0 = no match, 1 = matched a container, 2 = matched a leaf (no more starts). */
    tryStarts(container: B): 0 | 1 | 2 {
        const line = this.currentLine;
        const rest = line.slice(this.nextNonspace);
        const c = rest.charAt(0);

        // Block quote
        if (!this.indented && c === ">") {
            this.advanceNextNonspace();
            this.advanceOffset(1, false);
            if (isSpaceOrTab(this.peek(this.offset))) this.advanceOffset(1, true);
            this.closeUnmatchedBlocks();
            this.addChild("blockquote", this.nextNonspace);
            return 1;
        }

        // ATX heading
        let m: RegExpMatchArray | null;
        if (!this.indented && (m = rest.match(reATXHeadingMarker))) {
            this.advanceNextNonspace();
            this.advanceOffset(m[0].length, false);
            this.closeUnmatchedBlocks();
            const h = this.addChild("heading", this.nextNonspace);
            h.level = m[0].trim().length;
            const text = line
                .slice(this.offset)
                .replace(/^[ \t]*#+[ \t]*$/, "")
                .replace(/[ \t]+#+[ \t]*$/, "");
            h.segs.push(0, this.srcAt(this.offset));
            h.content = text;
            this.advanceOffset(line.length - this.offset);
            return 2;
        }

        // Fenced code block
        if (!this.indented && (m = rest.match(reCodeFence))) {
            const fenceLength = m[0].length;
            this.closeUnmatchedBlocks();
            const b = this.addChild("codeBlock", this.nextNonspace);
            b.fenced = true;
            b.fenceLength = fenceLength;
            b.fenceChar = m[0][0];
            b.fenceOffset = this.indent;
            this.advanceNextNonspace();
            this.advanceOffset(fenceLength, false);
            return 2;
        }

        // BFM: math block `$$`
        if (this.opts.bfm && !this.indented && reMathFence.test(rest)) {
            this.closeUnmatchedBlocks();
            const b = this.addChild("mathBlock", this.nextNonspace);
            const after = rest.slice(2);
            const close = after.search(/\$\$[ \t]*$/);
            if (close >= 0 && after.slice(0, close).trim() !== "") {
                b.literal = after.slice(0, close).trim();
                b.closedOnOpen = true;
                this.advanceOffset(line.length - this.offset);
                this.lastLineLength = line.length;
                this.finalize(b, this.lineNumber);
                return 2;
            }
            this.advanceNextNonspace();
            return 2;
        }

        // BFM: comment block `%%` on its own line
        if (this.opts.bfm && !this.indented && reCommentFence.test(rest)) {
            this.closeUnmatchedBlocks();
            this.addChild("commentBlock", this.nextNonspace);
            this.advanceNextNonspace();
            return 2;
        }

        // HTML block
        if (!this.indented && c === "<") {
            for (let t = 1; t <= 7; t++) {
                if (
                    reHtmlBlockOpen[t].test(rest) &&
                    (t < 7 || (container.type !== "paragraph" && !(!this.allClosed && !this.blank && this.tip.type === "paragraph")))
                ) {
                    this.closeUnmatchedBlocks();
                    const b = this.addChild("htmlBlock", this.offset);
                    b.htmlType = t;
                    return 2;
                }
            }
        }

        // GFM: table (delimiter row under a paragraph line)
        if (
            this.opts.gfm &&
            !this.indented &&
            container.type === "paragraph" &&
            reTableDelimRow.test(rest) &&
            (rest.includes("|") || /(^|[^\\])\|/.test(lastLineOf(container.content))) &&
            this.startTable(container, rest)
        ) {
            return 2;
        }

        // Setext heading
        if (!this.indented && container.type === "paragraph" && (m = rest.match(reSetextHeadingLine))) {
            this.closeUnmatchedBlocks();
            let pos = 0;
            while (container.content.charAt(0) === "[" && (pos = this.inline.parseReference(container.content, this.refmap))) {
                shiftContent(container, pos);
            }
            if (container.content.length > 0) {
                const h = newBlock("heading", container.startLine, container.startCol);
                h.level = m[0][0] === "=" ? 1 : 2;
                h.content = container.content;
                h.segs = container.segs;
                insertAfter(container, h);
                unlink(container);
                this.tip = h;
                this.advanceOffset(line.length - this.offset, false);
                return 2;
            }
            return 0;
        }

        // Thematic break
        if (!this.indented && reThematicBreak.test(rest)) {
            this.closeUnmatchedBlocks();
            this.addChild("thematicBreak", this.nextNonspace);
            this.advanceOffset(line.length - this.offset, false);
            return 2;
        }

        // GFM: footnote definition
        if (this.opts.gfm && !this.indented && container.type !== "paragraph" && (m = rest.match(reFootnoteDef))) {
            this.closeUnmatchedBlocks();
            const b = this.addChild("footnoteDef", this.nextNonspace);
            b.label = m[1];
            this.footnoteLabels.add(m[1].toUpperCase());
            this.advanceNextNonspace();
            this.advanceOffset(m[0].length, false);
            if (isSpaceOrTab(this.peek(this.offset))) this.advanceOffset(1, true);
            return 1;
        }

        // List item
        let data: ListData | null;
        if ((!this.indented || container.type === "list") && (data = this.parseListMarker(container))) {
            this.closeUnmatchedBlocks();
            if (this.tip.type !== "list" || !listsMatch(this.tip.list!, data)) {
                const list = this.addChild("list", this.nextNonspace);
                list.list = data;
            }
            const item = this.addChild("listItem", this.nextNonspace);
            item.list = data;
            return 1;
        }

        // Indented code block
        if (this.indented && this.tip.type !== "paragraph" && this.tip.type !== "table" && !this.blank) {
            this.advanceOffset(CODE_INDENT, true);
            this.closeUnmatchedBlocks();
            this.addChild("codeBlock", this.offset);
            return 2;
        }

        return 0;
    }

    startTable(paragraph: B, delimRow: string): boolean {
        const align = parseAlign(delimRow);
        const content = paragraph.content.replace(/\n$/, "");
        const nl = content.lastIndexOf("\n");
        const headerText = content.slice(nl + 1);
        if (splitTableRow(headerText).length !== align.length) return false;
        this.closeUnmatchedBlocks();
        const headerSrc = mapIndex(paragraph, nl + 1);
        const headerLine = paragraph.startLine + (content.slice(0, nl + 1).match(/\n/g)?.length ?? 0);
        if (nl >= 0) {
            // Lines above the header stay a paragraph.
            paragraph.content = content.slice(0, nl + 1);
            this.finalize(paragraph, this.lineNumber - 2);
        } else {
            this.tip = paragraph.parent!;
            unlink(paragraph);
        }
        const table = this.addChild("table", 0);
        table.startLine = headerLine;
        table.startCol = headerSrc - this.lineStarts[headerLine];
        table.align = align;
        table.tableRows = [{ text: headerText, src: headerSrc }];
        this.advanceOffset(this.currentLine.length - this.offset, false);
        return true;
    }

    parseListMarker(container: B): ListData | null {
        const rest = this.currentLine.slice(this.nextNonspace);
        let m: RegExpMatchArray | null;
        const data: ListData = { type: "bullet", tight: true, bulletChar: "", start: 0, delimiter: "", padding: 0, markerOffset: this.indent };
        if (this.indent >= 4) return null;
        if ((m = rest.match(reBulletListMarker))) {
            data.type = "bullet";
            data.bulletChar = m[0][0];
        } else if ((m = rest.match(reOrderedListMarker)) && (container.type !== "paragraph" || m[1] === "1")) {
            data.type = "ordered";
            data.start = parseInt(m[1], 10);
            data.delimiter = m[2];
        } else return null;
        let nextc = this.peek(this.nextNonspace + m[0].length);
        if (!(nextc === undefined || nextc === "\t" || nextc === " ")) return null;
        if (container.type === "paragraph" && !reNonSpace.test(this.currentLine.slice(this.nextNonspace + m[0].length))) return null;
        this.advanceNextNonspace();
        this.advanceOffset(m[0].length, true);
        const spacesStartCol = this.column;
        const spacesStartOffset = this.offset;
        do {
            this.advanceOffset(1, true);
            nextc = this.peek(this.offset);
        } while (this.column - spacesStartCol < 5 && isSpaceOrTab(nextc));
        const blankItem = this.peek(this.offset) === undefined;
        const spacesAfterMarker = this.column - spacesStartCol;
        if (spacesAfterMarker >= 5 || spacesAfterMarker < 1 || blankItem) {
            data.padding = m[0].length + 1;
            this.column = spacesStartCol;
            this.offset = spacesStartOffset;
            if (isSpaceOrTab(this.peek(this.offset))) this.advanceOffset(1, true);
        } else {
            data.padding = m[0].length + spacesAfterMarker;
        }
        return data;
    }

    // ---- main loop ----------------------------------------------------------------------------

    incorporateLine(ln: string) {
        let container = this.doc;
        this.oldtip = this.tip;
        this.offset = 0;
        this.column = 0;
        this.blank = false;
        this.partiallyConsumedTab = false;
        this.lineNumber++;
        if (ln.indexOf("\u0000") !== -1) ln = ln.replace(/\0/g, "�");
        this.currentLine = ln;

        let last: B | undefined;
        while ((last = lastChild(container)) && last.open) {
            container = last;
            this.findNextNonspace();
            const r = this.continueBlock(container);
            if (r === 2) return;
            if (r === 1) {
                container = container.parent!;
                break;
            }
        }

        this.allClosed = container === this.oldtip;
        this.lastMatchedContainer = container;

        let matchedLeaf = container.type !== "paragraph" && container.type !== "table" && acceptsLines(container.type);
        while (!matchedLeaf) {
            this.findNextNonspace();
            if (!this.indented && !reMaybeSpecial.test(ln.slice(this.nextNonspace))) {
                this.advanceNextNonspace();
                break;
            }
            const r = this.tryStarts(container);
            if (r === 1) {
                container = this.tip;
            } else if (r === 2) {
                container = this.tip;
                matchedLeaf = true;
            } else {
                this.advanceNextNonspace();
                break;
            }
        }

        if (!this.allClosed && !this.blank && this.tip.type === "paragraph") {
            // Lazy paragraph continuation
            this.addLine();
        } else {
            this.closeUnmatchedBlocks();
            const t = container.type;
            if (t === "table") {
                if (!this.blank && this.offset < ln.length) {
                    container.tableRows!.push({ text: ln.slice(this.offset), src: this.srcAt(this.offset) });
                }
            } else if (acceptsLines(t)) {
                if (!container.closedOnOpen) this.addLine();
                if (
                    t === "htmlBlock" &&
                    container.htmlType! >= 1 &&
                    container.htmlType! <= 5 &&
                    reHtmlBlockClose[container.htmlType!].test(this.currentLine.slice(this.offset))
                ) {
                    this.lastLineLength = ln.length;
                    this.finalize(container, this.lineNumber);
                }
            } else if (this.offset < ln.length && !this.blank) {
                this.addChild("paragraph", this.offset);
                this.advanceNextNonspace();
                this.addLine();
            }
        }
        this.lastLineLength = ln.length;
    }

    parse(input: string): B {
        this.source = input;
        const lines: string[] = [];
        const re = /\r\n|\n|\r/g;
        let at = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(input))) {
            lines.push(input.slice(at, m.index));
            at = m.index + m[0].length;
            this.lineStarts.push(at);
        }
        if (at < input.length || lines.length === 0) {
            lines.push(input.slice(at));
        } else {
            // Input ends with a newline: no extra empty line.
        }
        // lineStarts[n] = offset of line n (1-based): shift so index 1 is line 1.
        this.lineStarts = [0, 0, ...this.lineStarts.slice(1)];
        for (const l of lines) this.incorporateLine(l);
        while (this.tip !== this.doc) this.finalize(this.tip, lines.length);
        this.finalize(this.doc, lines.length);
        this.doc.open = false;
        return this.doc;
    }
}

function lastLineOf(content: string): string {
    const c = content.replace(/\n$/, "");
    return c.slice(c.lastIndexOf("\n") + 1);
}

function shiftContent(b: B, pos: number) {
    b.content = b.content.slice(pos);
    const segs: number[] = [];
    for (let i = 0; i < b.segs.length; i += 2) {
        const ci = b.segs[i] - pos;
        const src = b.segs[i + 1];
        if (ci >= 0) segs.push(ci, src);
        else if (i + 2 >= b.segs.length || b.segs[i + 2] - pos > 0) segs.push(0, src - ci);
    }
    b.segs = segs;
}

/** Source offset of index `i` in a block's collected content. */
function mapIndex(b: B, i: number): number {
    let src = b.segs.length > 1 ? b.segs[1] : 0;
    let ci = 0;
    for (let k = 0; k < b.segs.length; k += 2) {
        if (b.segs[k] <= i) {
            ci = b.segs[k];
            src = b.segs[k + 1];
        } else break;
    }
    return src + (i - ci);
}

function canContain(parent: BType, child: BType): boolean {
    switch (parent) {
        case "document":
        case "blockquote":
        case "listItem":
        case "footnoteDef":
            return child !== "listItem";
        case "list":
            return child === "listItem";
        default:
            return false;
    }
}

function acceptsLines(t: BType): boolean {
    return t === "paragraph" || t === "codeBlock" || t === "htmlBlock" || t === "mathBlock" || t === "commentBlock";
}

function listsMatch(a: ListData, b: ListData): boolean {
    return a.type === b.type && a.delimiter === b.delimiter && a.bulletChar === b.bulletChar;
}

// ---- phase 2: convert to the public tree and parse inlines --------------------------------------

export function parseDocument(input: string, options: ParseOptions = {}): Document {
    const opts: Required<ParseOptions> = { gfm: options.gfm ?? true, bfm: options.bfm ?? true };
    const p = new BlockParser(opts);
    const root = p.parse(input);
    const ctx: InlineContext = { refmap: p.refmap, footnotes: p.footnoteLabels, footnoteOrder: [] };
    const off = (line: number, col: number) => (p.lineStarts[line] ?? input.length) + col;

    const convert = (b: B): MdNode | null => {
        const start = Math.min(off(b.startLine, b.startCol), input.length);
        const end = Math.max(start, Math.min(off(b.endLine, b.endCol), input.length));
        const node: MdNode = { type: b.type as MdNode["type"], start, end };
        const kids = () => b.children.map(convert).filter((n): n is MdNode => n !== null);
        switch (b.type) {
            case "document":
            case "blockquote":
            case "footnoteDef":
                if (b.type === "footnoteDef") node.name = b.label;
                if (b.type === "blockquote" && opts.bfm) toCallout(node, b);
                node.children = kids();
                return node;
            case "list":
                node.ordered = b.list!.type === "ordered";
                node.listStart = b.list!.start;
                node.tight = b.list!.tight;
                node.children = kids();
                return node;
            case "listItem": {
                node.checked = null;
                const first = b.children[0];
                if (opts.gfm && first && first.type === "paragraph") {
                    const m = first.content.match(reTaskMarker);
                    if (m && first.content.length > m[0].length && !isBlank(first.content.slice(m[0].length))) {
                        node.checked = m[1] !== " ";
                        shiftContent(first, m[0].length);
                    }
                }
                node.children = kids();
                return node;
            }
            case "paragraph":
            case "heading":
                if (b.type === "heading") node.level = b.level;
                node.children = p.inline.parse(b.content, ctx, (i) => mapIndex(b, i));
                return node;
            case "thematicBreak":
                return node;
            case "codeBlock":
                node.value = b.literal ?? "";
                node.info = b.info ?? "";
                return node;
            case "htmlBlock":
                node.value = b.literal ?? "";
                return node;
            case "mathBlock":
                node.value = b.literal ?? "";
                return node;
            case "commentBlock":
                node.value = b.literal ?? "";
                return node;
            case "table": {
                const width = b.align!.length;
                node.align = b.align;
                const rows: MdNode[] = [];
                b.tableRows!.forEach((row, ri) => {
                    const cells = splitTableRow(row.text).slice(0, width);
                    while (cells.length < width) cells.push({ text: "", at: row.text.length });
                    rows.push({
                        type: "tableRow",
                        header: ri === 0,
                        start: row.src,
                        end: row.src + row.text.length,
                        children: cells.map((c) => ({
                            type: "tableCell" as const,
                            start: row.src + c.at,
                            end: row.src + c.at + c.text.length,
                            children: p.inline.parse(c.text, ctx, (i) => row.src + c.at + i),
                        })),
                    });
                });
                node.children = rows;
                return node;
            }
        }
    };

    /** `> [!note] Title` → callout. */
    const toCallout = (node: MdNode, b: B) => {
        const first = b.children[0];
        if (!first || first.type !== "paragraph") return;
        const nl = first.content.indexOf("\n");
        const line = nl >= 0 ? first.content.slice(0, nl) : first.content;
        const m = line.match(reCallout);
        if (!m) return;
        node.type = "callout";
        node.kind = m[1].toLowerCase();
        node.fold = m[2];
        const titleAt = line.length - m[3].length;
        node.titleChildren = m[3].trim() ? p.inline.parse(m[3], ctx, (i) => mapIndex(first, titleAt + i)) : [];
        // The first paragraph loses its first line.
        shiftContent(first, nl >= 0 ? nl + 1 : first.content.length);
        if (isBlank(first.content)) b.children.shift();
    };

    const doc = convert(root) as Document;
    doc.start = 0;
    doc.end = input.length;
    // Footnotes: keep definitions that are referenced, in order of first reference.
    const defs = new Map<string, MdNode>();
    const collect = (nodes: MdNode[]) => {
        for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            if (n.type === "footnoteDef") {
                const key = n.name!.toUpperCase();
                if (!defs.has(key)) defs.set(key, n);
                nodes.splice(i, 1);
                i--;
            } else if (n.children) collect(n.children);
        }
    };
    collect(doc.children);
    doc.footnotes = ctx.footnoteOrder.map((k) => defs.get(k)).filter((n): n is MdNode => n !== undefined);
    return doc;
}
