/**
 * Inline parser: CommonMark 0.31 (delimiter-run algorithm for emphasis, bracket stack for links),
 * plus GFM strikethrough, extended autolinks and footnote references, and BFM highlight,
 * `[[wiki links]]`, `#tags`, `$math$` and `%% comments %%`.
 */
import type { LinkRef, MdNode, NodeType, ParseOptions } from "./ast.ts";
import {
    ESCAPABLE,
    ESCAPED_CHAR,
    charAt,
    charBefore,
    decodeEntity,
    normalizeReference,
    normalizeURI,
    reCjk,
    reEntityHere,
    reEscapable,
    reHtmlTag,
    rePunctuation,
    reUnicodeWhitespaceChar,
    reWhitespaceChar,
    unescapeString,
} from "./common.ts";

export interface InlineContext {
    refmap: Record<string, LinkRef>;
    /** Upper-cased labels of footnote definitions. */
    footnotes: Set<string>;
    /** Upper-cased footnote labels in order of first reference. */
    footnoteOrder: string[];
}

/** Inline node while parsing: a doubly linked tree, so emphasis can re-parent runs cheaply. */
class INode {
    type: NodeType;
    value = "";
    /** Subject offsets. */
    s: number;
    e: number;
    verbatim = false;
    parent: INode | null = null;
    first: INode | null = null;
    last: INode | null = null;
    prev: INode | null = null;
    next: INode | null = null;
    props: Partial<MdNode> = {};

    constructor(type: NodeType, s: number, e: number, value = "") {
        this.type = type;
        this.s = s;
        this.e = e;
        this.value = value;
    }

    append(child: INode) {
        child.unlink();
        child.parent = this;
        if (this.last) {
            this.last.next = child;
            child.prev = this.last;
            this.last = child;
        } else {
            this.first = child;
            this.last = child;
        }
    }

    insertAfter(sibling: INode) {
        sibling.unlink();
        sibling.next = this.next;
        if (sibling.next) sibling.next.prev = sibling;
        sibling.prev = this;
        this.next = sibling;
        sibling.parent = this.parent;
        if (sibling.parent && !sibling.next) sibling.parent.last = sibling;
    }

    unlink() {
        if (this.prev) this.prev.next = this.next;
        else if (this.parent) this.parent.first = this.next;
        if (this.next) this.next.prev = this.prev;
        else if (this.parent) this.parent.last = this.prev;
        this.parent = null;
        this.next = null;
        this.prev = null;
    }
}

interface Delimiter {
    cc: string;
    numdelims: number;
    origdelims: number;
    node: INode;
    previous: Delimiter | null;
    next: Delimiter | null;
    canOpen: boolean;
    canClose: boolean;
    /** `=={pink}`: the colour text node right after the run. */
    colorNode?: INode;
}

interface Bracket {
    node: INode;
    previous: Bracket | null;
    previousDelimiter: Delimiter | null;
    index: number;
    image: boolean;
    active: boolean;
    bracketAfter: boolean;
}

const reLinkTitle = new RegExp(
    '^(?:"(' + ESCAPED_CHAR + '|\\\\[^\\\\]|[^\\\\"\\x00])*"' +
        "|'(" + ESCAPED_CHAR + "|\\\\[^\\\\]|[^\\\\'\\x00])*'" +
        "|\\((" + ESCAPED_CHAR + "|\\\\[^\\\\]|[^\\\\()\\x00])*\\))",
);
const reLinkDestinationBraces = /^(?:<(?:[^<>\n\\\x00]|\\.)*>)/;
const reEscapableChar = new RegExp("^" + ESCAPABLE);
const reTicksHere = /^`+/;
const reTicks = /`+/m;
const reEmailAutolink =
    /^<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/;
const reAutolink = /^<[A-Za-z][A-Za-z0-9.+-]{1,31}:[^<>\x00-\x20]*>/i;
const reSpnl = /^ *(?:\n *)?/;
const reInitialSpace = /^ */;
const reFinalSpace = / *$/;
const reSpaceAtEndOfLine = /^ *(?:\n|$)/;
const reLinkLabel = /^\[(?:[^\\[\]]|\\.){0,1000}\]/s;
const HIGHLIGHT_COLORS = new Set(["yellow", "green", "blue", "pink", "purple"]);
/** Characters that end a tag (besides whitespace): ASCII punctuation except `_ - /`, and CJK punctuation. */
const reTagChar = /^[\p{L}\p{N}\p{M}_\-/]/u;

export class InlineParser {
    opts: Required<ParseOptions>;
    subject = "";
    pos = 0;
    delimiters: Delimiter | null = null;
    brackets: Bracket | null = null;
    refmap: Record<string, LinkRef> = {};
    ctx: InlineContext | null = null;
    reMain: RegExp;

    constructor(opts: Required<ParseOptions>) {
        this.opts = opts;
        let special = "\\n`\\[\\]\\\\!<&*_";
        if (opts.gfm) special += "~";
        if (opts.bfm) special += "=$%#";
        this.reMain = new RegExp("^[^" + special + "]+", "m");
    }

    // ---- helpers ------------------------------------------------------------------------------

    match(re: RegExp): string | null {
        const m = re.exec(this.subject.slice(this.pos));
        if (m === null) return null;
        this.pos += m.index + m[0].length;
        return m[0];
    }

    peek(): string | undefined {
        return this.pos < this.subject.length ? this.subject[this.pos] : undefined;
    }

    spnl(): true {
        this.match(reSpnl);
        return true;
    }

    text(s: number, value: string, verbatim = true): INode {
        const n = new INode("text", s, s + value.length, value);
        n.verbatim = verbatim;
        return n;
    }

    // ---- entry points -------------------------------------------------------------------------

    /** Parses `content` into inline nodes; `src(i)` maps an index in `content` to a source offset. */
    parse(content: string, ctx: InlineContext, src: (i: number) => number): MdNode[] {
        this.ctx = ctx;
        this.refmap = ctx.refmap;
        // Only spaces, tabs and line breaks are stripped: a leading full-width space (Chinese
        // paragraph indent) or no-break space stays.
        const lead = content.length - content.replace(/^[ \t\r\n]+/, "").length;
        this.subject = content.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
        this.pos = 0;
        this.delimiters = null;
        this.brackets = null;
        const root = new INode("text", 0, this.subject.length);
        while (this.parseInline(root)) {
            /* keep going */
        }
        this.processEmphasis(null);
        mergeText(root);
        if (this.opts.gfm) linkifyAll(root, this);
        const map = (i: number) => src(i + lead);
        return toNodes(root, map);
    }

    parseInline(block: INode): boolean {
        const c = this.peek();
        if (c === undefined) return false;
        let res = false;
        switch (c) {
            case "\n":
                res = this.parseNewline(block);
                break;
            case "\\":
                res = this.parseBackslash(block);
                break;
            case "`":
                res = this.parseBackticks(block);
                break;
            case "*":
            case "_":
                res = this.handleDelim(c, block);
                break;
            case "~":
                res = this.opts.gfm && this.handleDelim(c, block);
                break;
            case "=":
                res = this.opts.bfm && this.handleDelim(c, block);
                break;
            case "[":
                res = this.parseOpenBracket(block);
                break;
            case "!":
                res = this.parseBang(block);
                break;
            case "]":
                res = this.parseCloseBracket(block);
                break;
            case "<":
                res = this.parseAutolink(block) || this.parseHtmlTag(block);
                break;
            case "&":
                res = this.parseEntity(block);
                break;
            case "$":
                res = this.opts.bfm && this.parseMath(block);
                break;
            case "%":
                res = this.opts.bfm && this.parseComment(block);
                break;
            case "#":
                res = this.opts.bfm && this.parseTag(block);
                break;
            default:
                res = this.parseString(block);
                break;
        }
        if (!res) {
            const ch = charAt(this.subject, this.pos);
            block.append(this.text(this.pos, ch));
            this.pos += ch.length;
        }
        return true;
    }

    parseString(block: INode): boolean {
        const s = this.pos;
        const m = this.match(this.reMain);
        if (m === null) return false;
        block.append(this.text(s, m));
        return true;
    }

    parseNewline(block: INode): boolean {
        const s = this.pos;
        this.pos += 1;
        const lastc = block.last;
        if (lastc && lastc.type === "text" && lastc.value.endsWith(" ")) {
            const hard = lastc.value[lastc.value.length - 2] === " ";
            lastc.value = lastc.value.replace(reFinalSpace, "");
            lastc.e = lastc.s + lastc.value.length;
            block.append(new INode(hard ? "hardBreak" : "softBreak", s, s + 1));
        } else {
            block.append(new INode("softBreak", s, s + 1));
        }
        this.match(reInitialSpace);
        return true;
    }

    parseBackslash(block: INode): boolean {
        const s = this.pos;
        this.pos += 1;
        if (this.peek() === "\n") {
            this.pos += 1;
            block.append(new INode("hardBreak", s, this.pos));
        } else if (reEscapable.test(this.subject.charAt(this.pos))) {
            block.append(this.text(s, this.subject.charAt(this.pos), false));
            this.pos += 1;
        } else {
            block.append(this.text(s, "\\"));
        }
        return true;
    }

    parseBackticks(block: INode): boolean {
        const s = this.pos;
        const ticks = this.match(reTicksHere);
        if (ticks === null) return false;
        const afterOpenTicks = this.pos;
        let matched: string | null;
        while ((matched = this.match(reTicks)) !== null) {
            if (matched === ticks) {
                let contents = this.subject.slice(afterOpenTicks, this.pos - ticks.length).replace(/\n/gm, " ");
                if (contents.length > 0 && /[^ ]/.test(contents) && contents[0] === " " && contents[contents.length - 1] === " ") {
                    contents = contents.slice(1, contents.length - 1);
                }
                block.append(new INode("code", s, this.pos, contents));
                return true;
            }
        }
        this.pos = afterOpenTicks;
        block.append(this.text(s, ticks));
        return true;
    }

    parseAutolink(block: INode): boolean {
        const s = this.pos;
        let m: string | null;
        if ((m = this.match(reEmailAutolink))) {
            const dest = m.slice(1, m.length - 1);
            const node = new INode("link", s, this.pos);
            node.props.url = normalizeURI("mailto:" + dest);
            node.props.title = "";
            node.append(this.text(s + 1, dest));
            block.append(node);
            return true;
        }
        if ((m = this.match(reAutolink))) {
            const dest = m.slice(1, m.length - 1);
            const node = new INode("link", s, this.pos);
            node.props.url = normalizeURI(dest);
            node.props.title = "";
            node.append(this.text(s + 1, dest));
            block.append(node);
            return true;
        }
        return false;
    }

    parseHtmlTag(block: INode): boolean {
        const s = this.pos;
        const m = this.match(reHtmlTag);
        if (m === null) return false;
        block.append(new INode("htmlInline", s, this.pos, m));
        return true;
    }

    parseEntity(block: INode): boolean {
        const s = this.pos;
        const m = this.match(reEntityHere);
        if (m === null) return false;
        block.append(this.text(s, decodeEntity(m), false));
        return true;
    }

    // ---- BFM inline syntax --------------------------------------------------------------------

    /** `$x$` / `$$x$$`: the opener is not followed by a space, the closer not preceded by one nor followed by a digit. */
    parseMath(block: INode): boolean {
        const s = this.pos;
        const sub = this.subject;
        let n = 0;
        while (sub[s + n] === "$") n++;
        if (n > 2) return false;
        const open = s + n;
        if (open >= sub.length || /\s/.test(sub[open])) return false;
        let i = open;
        while (i < sub.length) {
            const c = sub[i];
            if (c === "\\" && i + 1 < sub.length) {
                i += 2;
                continue;
            }
            if (c === "\n" && /^\n[ \t]*\n/.test(sub.slice(i))) return false;
            if (c === "$") {
                let k = 0;
                while (sub[i + k] === "$") k++;
                if (k === n && !/\s/.test(sub[i - 1]) && !(n === 1 && /[0-9]/.test(sub[i + k] ?? ""))) {
                    const value = sub.slice(open, i);
                    const node = new INode("math", s, i + k, value);
                    node.props.display = n === 2;
                    block.append(node);
                    this.pos = i + k;
                    return true;
                }
                i += k;
                continue;
            }
            i++;
        }
        return false;
    }

    /** `%% hidden %%` */
    parseComment(block: INode): boolean {
        const s = this.pos;
        if (!this.subject.startsWith("%%", s)) return false;
        const close = this.subject.indexOf("%%", s + 2);
        if (close < 0) return false;
        block.append(new INode("comment", s, close + 2, this.subject.slice(s + 2, close).trim()));
        this.pos = close + 2;
        return true;
    }

    /** `#標籤`, `#a/b`. Not after a letter or digit, not all digits. */
    parseTag(block: INode): boolean {
        const s = this.pos;
        const before = charBefore(this.subject, s);
        if (/[\p{L}\p{N}_&#\\]/u.test(before)) return false;
        let i = s + 1;
        while (i < this.subject.length) {
            const ch = charAt(this.subject, i);
            if (!reTagChar.test(ch)) break;
            i += ch.length;
        }
        let name = this.subject.slice(s + 1, i);
        name = name.replace(/[/\-]+$/, "");
        if (!name || /^[0-9]+$/.test(name)) return false;
        const node = new INode("tag", s, s + 1 + name.length);
        node.props.name = name;
        node.append(this.text(s, "#" + name));
        block.append(node);
        this.pos = s + 1 + name.length;
        return true;
    }

    /** `[[target]]`, `[[target|label]]`, `![[…]]` (when `embed`). */
    parseWikiLink(block: INode, embed: boolean): boolean {
        const s = this.pos - (embed ? 1 : 0);
        const body = this.pos + 2;
        let i = body;
        while (i < this.subject.length) {
            const c = this.subject[i];
            if (c === "\\" && i + 1 < this.subject.length) {
                i += 2;
                continue;
            }
            if (c === "\n" || c === "[") return false;
            if (c === "]") break;
            i++;
        }
        if (this.subject.slice(i, i + 2) !== "]]") return false;
        const inner = this.subject.slice(body, i);
        const bar = findUnescaped(inner, "|");
        const target = unescapeString(bar >= 0 ? inner.slice(0, bar) : inner).trim();
        if (!target) return false;
        const label = bar >= 0 ? unescapeString(inner.slice(bar + 1)).trim() : "";
        const node = new INode("wikiLink", s, i + 2);
        node.props.target = target;
        node.props.label = label;
        node.props.embed = embed;
        block.append(node);
        this.pos = i + 2;
        return true;
    }

    // ---- emphasis -----------------------------------------------------------------------------

    scanDelims(cc: string): { numdelims: number; canOpen: boolean; canClose: boolean } | null {
        let numdelims = 0;
        const startpos = this.pos;
        while (this.peek() === cc) {
            numdelims++;
            this.pos++;
        }
        if (numdelims === 0) return null;
        const charBef = charBefore(this.subject, startpos);
        const charAft = charAt(this.subject, this.pos);
        const afterWs = reUnicodeWhitespaceChar.test(charAft);
        const afterPunct = rePunctuation.test(charAft);
        const beforeWs = reUnicodeWhitespaceChar.test(charBef);
        const beforePunct = rePunctuation.test(charBef);
        // BFM: a CJK character next to the run counts like punctuation on the far side.
        const cjk = this.opts.bfm;
        const beforeCjk = cjk && reCjk.test(charBef);
        const afterCjk = cjk && reCjk.test(charAft);
        const left = !afterWs && (!afterPunct || beforeWs || beforePunct || beforeCjk);
        const right = !beforeWs && (!beforePunct || afterWs || afterPunct || afterCjk);
        let canOpen: boolean;
        let canClose: boolean;
        if (cc === "_") {
            canOpen = left && (!right || beforePunct);
            canClose = right && (!left || afterPunct);
        } else {
            canOpen = left;
            canClose = right;
        }
        this.pos = startpos;
        return { numdelims, canOpen, canClose };
    }

    handleDelim(cc: string, block: INode): boolean {
        const res = this.scanDelims(cc);
        if (!res) return false;
        const { numdelims } = res;
        const startpos = this.pos;
        this.pos += numdelims;
        const node = this.text(startpos, this.subject.slice(startpos, this.pos));
        block.append(node);
        // Strikethrough: one or two tildes (BFM: two only); highlight: exactly two.
        const usable =
            cc === "~" ? numdelims === 2 || (numdelims === 1 && !this.opts.bfm) : cc === "=" ? numdelims === 2 : true;
        if (usable && (res.canOpen || res.canClose)) {
            const d: Delimiter = {
                cc,
                numdelims,
                origdelims: numdelims,
                node,
                previous: this.delimiters,
                next: null,
                canOpen: res.canOpen,
                canClose: res.canClose,
            };
            if (cc === "=" && res.canClose) {
                const m = /^\{([a-z]+)\}/.exec(this.subject.slice(this.pos));
                if (m && HIGHLIGHT_COLORS.has(m[1])) {
                    const colorNode = this.text(this.pos, m[0]);
                    colorNode.props.color = m[1];
                    block.append(colorNode);
                    d.colorNode = colorNode;
                    this.pos += m[0].length;
                }
            }
            if (d.previous) d.previous.next = d;
            this.delimiters = d;
        }
        return true;
    }

    removeDelimiter(d: Delimiter) {
        if (d.previous !== null) d.previous.next = d.next;
        if (d.next === null) this.delimiters = d.previous;
        else d.next.previous = d.previous;
    }

    processEmphasis(stackBottom: Delimiter | null) {
        const openersBottom: Record<string, Delimiter | null> = {};
        let closer = this.delimiters;
        while (closer !== null && closer.previous !== stackBottom) closer = closer.previous;
        while (closer !== null) {
            const cc = closer.cc;
            if (!closer.canClose) {
                closer = closer.next;
                continue;
            }
            const key =
                cc === "_" || cc === "*" ? cc + (closer.canOpen ? "o" : "c") + (closer.origdelims % 3) : cc + closer.origdelims;
            const bottom = key in openersBottom ? openersBottom[key] : stackBottom;
            let opener = closer.previous;
            let found = false;
            while (opener !== null && opener !== stackBottom && opener !== bottom) {
                if (cc === "*" || cc === "_") {
                    const oddMatch =
                        (closer.canOpen || opener.canClose) &&
                        closer.origdelims % 3 !== 0 &&
                        (opener.origdelims + closer.origdelims) % 3 === 0;
                    if (opener.cc === cc && opener.canOpen && !oddMatch) {
                        found = true;
                        break;
                    }
                } else if (opener.cc === cc && opener.canOpen && opener.numdelims === closer.numdelims) {
                    found = true;
                    break;
                }
                opener = opener.previous;
            }
            const oldCloser = closer;
            if (!found) {
                closer = closer.next;
            } else {
                const o = opener!;
                const useDelims = cc === "*" || cc === "_" ? (closer.numdelims >= 2 && o.numdelims >= 2 ? 2 : 1) : closer.numdelims;
                const openerInl = o.node;
                const closerInl = closer.node;
                o.numdelims -= useDelims;
                closer.numdelims -= useDelims;
                openerInl.value = openerInl.value.slice(0, openerInl.value.length - useDelims);
                openerInl.e -= useDelims;
                closerInl.value = closerInl.value.slice(0, closerInl.value.length - useDelims);
                const type: NodeType =
                    cc === "~" ? "strike" : cc === "=" ? "highlight" : useDelims === 1 ? "emphasis" : "strong";
                const wrap = new INode(type, openerInl.e, closerInl.s + closerInl.value.length + useDelims);
                if (cc === "=" && closer.colorNode) {
                    wrap.props.color = closer.colorNode.props.color;
                    wrap.e = closer.colorNode.e;
                    closer.colorNode.unlink();
                }
                let tmp = openerInl.next;
                while (tmp && tmp !== closerInl) {
                    const next = tmp.next;
                    wrap.append(tmp);
                    tmp = next;
                }
                openerInl.insertAfter(wrap);
                // Remove delimiters between opener and closer.
                if (o.next !== closer) {
                    o.next = closer;
                    closer.previous = o;
                }
                if (o.numdelims === 0) {
                    openerInl.unlink();
                    this.removeDelimiter(o);
                }
                if (closer.numdelims === 0) {
                    closerInl.unlink();
                    const tempstack = closer.next;
                    this.removeDelimiter(closer);
                    closer = tempstack;
                }
            }
            if (!found) {
                openersBottom[key] = oldCloser.previous;
                if (!oldCloser.canOpen) this.removeDelimiter(oldCloser);
            }
        }
        while (this.delimiters !== null && this.delimiters !== stackBottom) this.removeDelimiter(this.delimiters);
    }

    // ---- links --------------------------------------------------------------------------------

    addBracket(node: INode, index: number, image: boolean) {
        if (this.brackets !== null) this.brackets.bracketAfter = true;
        this.brackets = { node, previous: this.brackets, previousDelimiter: this.delimiters, index, image, active: true, bracketAfter: false };
    }

    removeBracket() {
        this.brackets = this.brackets!.previous;
    }

    parseOpenBracket(block: INode): boolean {
        const startpos = this.pos;
        if (this.opts.bfm && this.subject[startpos + 1] === "[" && this.parseWikiLink(block, false)) return true;
        if (this.opts.gfm && this.subject[startpos + 1] === "^" && this.parseFootnoteRef(block)) return true;
        this.pos += 1;
        const node = this.text(startpos, "[");
        block.append(node);
        this.addBracket(node, startpos, false);
        return true;
    }

    parseFootnoteRef(block: INode): boolean {
        const s = this.pos;
        const m = /^\[\^([^\]\s]+)\]/.exec(this.subject.slice(s));
        if (!m || !this.ctx) return false;
        const key = m[1].toUpperCase();
        if (!this.ctx.footnotes.has(key)) return false;
        if (!this.ctx.footnoteOrder.includes(key)) this.ctx.footnoteOrder.push(key);
        const node = new INode("footnoteRef", s, s + m[0].length);
        node.props.name = m[1];
        node.props.label = String(this.ctx.footnoteOrder.indexOf(key) + 1);
        block.append(node);
        this.pos = s + m[0].length;
        return true;
    }

    parseBang(block: INode): boolean {
        const startpos = this.pos;
        if (this.opts.bfm && this.subject.startsWith("[[", startpos + 1)) {
            this.pos += 1;
            if (this.parseWikiLink(block, true)) return true;
            this.pos = startpos;
        }
        this.pos += 1;
        if (this.peek() === "[") {
            this.pos += 1;
            const node = this.text(startpos, "![");
            block.append(node);
            this.addBracket(node, startpos + 1, true);
        } else {
            block.append(this.text(startpos, "!"));
        }
        return true;
    }

    parseLinkTitle(): string | null {
        const title = this.match(reLinkTitle);
        if (title === null) return null;
        return unescapeString(title.slice(1, title.length - 1));
    }

    parseLinkDestination(): string | null {
        const res = this.match(reLinkDestinationBraces);
        if (res !== null) return normalizeURI(unescapeString(res.slice(1, res.length - 1)));
        if (this.peek() === "<") return null;
        const savepos = this.pos;
        let openparens = 0;
        let c: string | undefined;
        while ((c = this.peek()) !== undefined) {
            if (c === "\\" && reEscapableChar.test(this.subject.charAt(this.pos + 1))) {
                this.pos += 1;
                if (this.peek() !== undefined) this.pos += 1;
            } else if (c === "(") {
                this.pos += 1;
                openparens += 1;
            } else if (c === ")") {
                if (openparens < 1) break;
                this.pos += 1;
                openparens -= 1;
            } else if (reWhitespaceChar.test(c) || c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f) {
                break;
            } else {
                this.pos += 1;
            }
        }
        if (this.pos === savepos && c !== ")") return null;
        if (openparens !== 0) return null;
        return normalizeURI(unescapeString(this.subject.slice(savepos, this.pos)));
    }

    parseLinkLabel(): number {
        const m = this.match(reLinkLabel);
        if (m === null || m.length > 1001) return 0;
        return m.length;
    }

    parseCloseBracket(block: INode): boolean {
        const closeAt = this.pos;
        this.pos += 1;
        const startpos = this.pos;
        const opener = this.brackets;
        if (opener === null) {
            block.append(this.text(closeAt, "]"));
            return true;
        }
        if (!opener.active) {
            block.append(this.text(closeAt, "]"));
            this.removeBracket();
            return true;
        }
        const isImage = opener.image;
        const savepos = this.pos;
        let matched = false;
        let dest: string | null = null;
        let title: string | null = null;

        if (this.peek() === "(") {
            this.pos++;
            if (this.spnl() && (dest = this.parseLinkDestination()) !== null && this.spnl()) {
                if (reWhitespaceChar.test(this.subject.charAt(this.pos - 1))) title = this.parseLinkTitle();
                if (this.spnl() && this.peek() === ")") {
                    this.pos += 1;
                    matched = true;
                }
            }
            if (!matched) this.pos = savepos;
        }

        if (!matched) {
            const beforelabel = this.pos;
            const n = this.parseLinkLabel();
            let reflabel: string | null = null;
            if (n > 2) reflabel = this.subject.slice(beforelabel, beforelabel + n);
            else if (!opener.bracketAfter) reflabel = this.subject.slice(opener.index, startpos);
            if (n === 0) this.pos = savepos;
            if (reflabel) {
                const link = this.refmap[normalizeReference(reflabel)];
                if (link) {
                    dest = link.destination;
                    title = link.title;
                    matched = true;
                }
            }
        }

        if (matched) {
            const node = new INode(isImage ? "image" : "link", opener.node.s, this.pos);
            node.props.url = dest ?? "";
            node.props.title = title ?? "";
            let tmp = opener.node.next;
            while (tmp) {
                const next = tmp.next;
                node.append(tmp);
                tmp = next;
            }
            block.append(node);
            this.processEmphasis(opener.previousDelimiter);
            this.removeBracket();
            opener.node.unlink();
            if (!isImage) {
                let o = this.brackets;
                while (o !== null) {
                    if (!o.image) o.active = false;
                    o = o.previous;
                }
            }
            return true;
        }
        this.removeBracket();
        this.pos = startpos;
        block.append(this.text(closeAt, "]"));
        return true;
    }

    /** Parses a link reference definition at the start of `s`; returns characters consumed (0 = none). */
    parseReference(s: string, refmap: Record<string, LinkRef>): number {
        this.subject = s;
        this.pos = 0;
        const startpos = this.pos;
        const matchChars = this.parseLinkLabel();
        if (matchChars === 0) return 0;
        const rawlabel = this.subject.slice(0, matchChars);
        if (this.peek() === ":") this.pos++;
        else {
            this.pos = startpos;
            return 0;
        }
        this.spnl();
        const dest = this.parseLinkDestination();
        if (dest === null) {
            this.pos = startpos;
            return 0;
        }
        const beforetitle = this.pos;
        this.spnl();
        let title: string | null = null;
        if (this.pos !== beforetitle) title = this.parseLinkTitle();
        if (title === null) {
            title = "";
            this.pos = beforetitle;
        }
        let atLineEnd = true;
        if (this.match(reSpaceAtEndOfLine) === null) {
            if (title === "") atLineEnd = false;
            else {
                title = "";
                this.pos = beforetitle;
                atLineEnd = this.match(reSpaceAtEndOfLine) !== null;
            }
        }
        if (!atLineEnd) {
            this.pos = startpos;
            return 0;
        }
        const normlabel = normalizeReference(rawlabel);
        if (normlabel === "") {
            this.pos = startpos;
            return 0;
        }
        if (!refmap[normlabel]) refmap[normlabel] = { destination: dest, title };
        return this.pos - startpos;
    }
}

function findUnescaped(s: string, ch: string): number {
    for (let i = 0; i < s.length; i++) {
        if (s[i] === "\\") i++;
        else if (s[i] === ch) return i;
    }
    return -1;
}

/** Joins neighbouring text nodes (keeps offsets exact only when both are verbatim and adjacent). */
function mergeText(parent: INode) {
    let n = parent.first;
    while (n) {
        if (n.first) mergeText(n);
        const next = n.next;
        if (n.type === "text" && next && next.type === "text" && !n.props.color && !next.props.color) {
            const adjacent = n.verbatim && next.verbatim && n.s + n.value.length === next.s;
            if (adjacent || (!n.verbatim && !next.verbatim)) {
                n.value += next.value;
                n.e = next.e;
                next.unlink();
                continue;
            }
            if (n.value === "") {
                const after = n.next;
                n.unlink();
                n = after;
                continue;
            }
        }
        n = next;
    }
}

// ---- GFM extended autolinks -------------------------------------------------------------------

const reAutoUrl = /(?:https?:\/\/|www\.)[^\s<]*|[a-zA-Z0-9._+-]+@[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+/g;

function trimUrl(url: string): string {
    // Trailing punctuation is not part of the link.
    for (;;) {
        const before = url;
        url = url.replace(/[?!.,:*_~'"]+$/, "");
        if (url.endsWith(")")) {
            const open = (url.match(/\(/g) ?? []).length;
            const close = (url.match(/\)/g) ?? []).length;
            if (close > open) url = url.slice(0, -1);
        }
        const ent = url.match(/&[a-zA-Z0-9]+;$/);
        if (ent) url = url.slice(0, -ent[0].length);
        if (url === before) return url;
    }
}

function linkifyAll(parent: INode, p: InlineParser) {
    let n = parent.first;
    while (n) {
        const next = n.next;
        if (n.type === "link" || n.type === "image" || n.type === "wikiLink" || n.type === "tag") {
            n = next;
            continue;
        }
        if (n.first) linkifyAll(n, p);
        if (n.type === "text") linkifyText(n, p);
        n = next;
    }
}

function linkifyText(node: INode, p: InlineParser) {
    const text = node.value;
    reAutoUrl.lastIndex = 0;
    let m: RegExpExecArray | null;
    let last = 0;
    const parts: INode[] = [];
    while ((m = reAutoUrl.exec(text))) {
        const at = m.index;
        const before = node.prev;
        const prev =
            at > 0
                ? text[at - 1]
                : !before || before.type === "softBreak" || before.type === "hardBreak"
                  ? ""
                  : before.type === "text"
                    ? before.value.slice(-1)
                    : "x";
        if (prev && !/[\s*_~(]/.test(prev) && !(p.opts.bfm && reCjk.test(prev))) continue;
        // A URL ends where Chinese / Japanese / Korean text or full-width punctuation begins.
        let url = m[0].replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-￯][\s\S]*$/u, "");
        const isEmail = !/^(?:https?:\/\/|www\.)/.test(url);
        if (isEmail) {
            if (/[-_]$/.test(url)) continue;
            url = url.replace(/\.$/, "");
        } else {
            url = trimUrl(url);
            const host = url.replace(/^https?:\/\//, "").split(/[/?#]/)[0];
            if (!/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(host) || (url.startsWith("www.") && !host.includes("."))) continue;
            if (host.split(".").slice(-2).some((seg) => seg.includes("_"))) continue;
        }
        if (!url) continue;
        if (at > last) parts.push(p.text(node.s + last, text.slice(last, at), node.verbatim));
        const link = new INode("link", node.s + at, node.s + at + url.length);
        link.props.url = isEmail ? "mailto:" + url : url.startsWith("www.") ? "http://" + url : url;
        link.props.title = "";
        link.append(p.text(node.s + at, url, node.verbatim));
        parts.push(link);
        last = at + url.length;
        reAutoUrl.lastIndex = last;
    }
    if (parts.length === 0) return;
    if (last < text.length) parts.push(p.text(node.s + last, text.slice(last), node.verbatim));
    let at = node;
    for (const part of parts) {
        at.insertAfter(part);
        at = part;
    }
    node.unlink();
}

// ---- output -----------------------------------------------------------------------------------

function toNodes(parent: INode, map: (i: number) => number): MdNode[] {
    const out: MdNode[] = [];
    for (let n = parent.first; n; n = n.next) {
        if (n.type === "text" && n.value === "") continue;
        const node: MdNode = { type: n.type, start: map(n.s), end: map(Math.max(n.s, n.e)), ...n.props };
        if (n.type === "text" || n.type === "code" || n.type === "htmlInline" || n.type === "math" || n.type === "comment") {
            node.value = n.value;
        }
        if (n.type === "text") node.verbatim = n.verbatim;
        if (n.first) node.children = toNodes(n, map);
        else if (n.type === "emphasis" || n.type === "strong" || n.type === "strike" || n.type === "highlight" || n.type === "link" || n.type === "image" || n.type === "tag")
            node.children = [];
        out.push(node);
    }
    return out;
}
