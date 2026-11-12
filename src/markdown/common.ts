/** Shared lexical helpers (CommonMark 0.31 definitions). */
import { ENTITIES } from "./entities.ts";

export const ESCAPABLE = "[!\"#$%&'()*+,./:;<=>?@[\\\\\\]^_`{|}~-]";
export const ESCAPED_CHAR = "\\\\" + ESCAPABLE;
const ENTITY = "&(?:#x[a-f0-9]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,31});";

export const reEscapable = new RegExp("^" + ESCAPABLE);
export const reEntityHere = new RegExp("^" + ENTITY, "i");
const reEntityOrEscapedChar = new RegExp("\\\\" + ESCAPABLE + "|" + ENTITY, "gi");
const reBackslashOrAmp = /[\\&]/;

const TAGNAME = "[A-Za-z][A-Za-z0-9-]*";
const ATTRIBUTENAME = "[a-zA-Z_:][a-zA-Z0-9:._-]*";
const UNQUOTEDVALUE = "[^\"'=<>`\\x00-\\x20]+";
const SINGLEQUOTEDVALUE = "'[^']*'";
const DOUBLEQUOTEDVALUE = '"[^"]*"';
const ATTRIBUTEVALUE = "(?:" + UNQUOTEDVALUE + "|" + SINGLEQUOTEDVALUE + "|" + DOUBLEQUOTEDVALUE + ")";
const ATTRIBUTEVALUESPEC = "(?:\\s*=\\s*" + ATTRIBUTEVALUE + ")";
const ATTRIBUTE = "(?:\\s+" + ATTRIBUTENAME + ATTRIBUTEVALUESPEC + "?)";
export const OPENTAG = "<" + TAGNAME + ATTRIBUTE + "*\\s*/?>";
export const CLOSETAG = "</" + TAGNAME + "\\s*[>]";
const HTMLCOMMENT = "<!-->|<!--->|<!--[\\s\\S]*?-->";
const PROCESSINGINSTRUCTION = "[<][?][\\s\\S]*?[?][>]";
const DECLARATION = "<![A-Za-z]+[^>]*>";
const CDATA = "<!\\[CDATA\\[[\\s\\S]*?\\]\\]>";
const HTMLTAG = "(?:" + OPENTAG + "|" + CLOSETAG + "|" + HTMLCOMMENT + "|" + PROCESSINGINSTRUCTION + "|" + DECLARATION + "|" + CDATA + ")";
export const reHtmlTag = new RegExp("^" + HTMLTAG);

/** Decodes one entity such as `&amp;`, `&#35;`, `&#x22;`; unknown names stay as written. */
export function decodeEntity(entity: string): string {
    const body = entity.slice(1, -1);
    if (body[0] === "#") {
        const hex = body[1] === "x" || body[1] === "X";
        let code = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
        if (!(code > 0) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) code = 0xfffd;
        return String.fromCodePoint(code);
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, body) ? ENTITIES[body] : entity;
}

function unescapeChar(s: string): string {
    return s.charCodeAt(0) === 92 /* \ */ ? s.charAt(1) : decodeEntity(s);
}

/** Replaces backslash escapes and entities with the characters they stand for. */
export function unescapeString(s: string): string {
    return reBackslashOrAmp.test(s) ? s.replace(reEntityOrEscapedChar, unescapeChar) : s;
}

/** Link label → lookup key: collapse whitespace, case-fold. Expects the brackets included. */
export function normalizeReference(label: string): string {
    return label
        .slice(1, label.length - 1)
        .trim()
        .replace(/[ \t\r\n]+/g, " ")
        .toLowerCase()
        .toUpperCase();
}

const reUrlSafe = /[A-Za-z0-9;/?:@&=+$,\-_.!~*'()#]/;
const reHex2 = /^[0-9A-Fa-f]{2}/;

/** Percent-encodes a URL the way commonmark.js does (existing `%XX` kept). */
export function normalizeURI(uri: string): string {
    let out = "";
    for (let i = 0; i < uri.length; i++) {
        const ch = uri[i];
        if (reUrlSafe.test(ch)) {
            out += ch;
        } else if (ch === "%" && reHex2.test(uri.slice(i + 1, i + 3))) {
            out += "%";
        } else {
            const code = uri.charCodeAt(i);
            if (code >= 0xd800 && code <= 0xdbff && i + 1 < uri.length) {
                const next = uri.charCodeAt(i + 1);
                if (next >= 0xdc00 && next <= 0xdfff) {
                    out += encodeURIComponent(uri[i] + uri[i + 1]);
                    i++;
                    continue;
                }
            }
            if (code >= 0xd800 && code <= 0xdfff) out += "%EF%BF%BD";
            else out += encodeURIComponent(ch);
        }
    }
    return out;
}

export function escapeXml(s: string): string {
    return s.replace(/[&<>"]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"));
}

export const reWhitespaceChar = /^[ \t\n\x0b\x0c\x0d]/;
export const reUnicodeWhitespaceChar = /^[\t\n\f\r \p{Zs}]/u;
export const rePunctuation = /^[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~\p{P}\p{S}]/u;
/** Chinese / Japanese / Korean characters, including full-width forms (BFM emphasis rule). */
export const reCjk = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-￯]/u;

export function isSpaceOrTab(c: string | undefined): boolean {
    return c === " " || c === "\t";
}

export function isBlank(s: string): boolean {
    return !/[^ \t\f\v\r\n]/.test(s);
}

/** The code point that ends just before `index` (handles surrogate pairs). */
export function charBefore(s: string, index: number): string {
    if (index <= 0) return "\n";
    const low = s.charCodeAt(index - 1);
    if (low >= 0xdc00 && low <= 0xdfff && index >= 2) {
        const high = s.charCodeAt(index - 2);
        if (high >= 0xd800 && high <= 0xdbff) return s.slice(index - 2, index);
    }
    return s.charAt(index - 1);
}

/** The code point that starts at `index`. */
export function charAt(s: string, index: number): string {
    if (index >= s.length) return "\n";
    const cp = s.codePointAt(index)!;
    return String.fromCodePoint(cp);
}
