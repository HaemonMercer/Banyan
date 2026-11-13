/**
 * Citation data and APA (7th) formatting: in-text citations (`(Kahneman, 2011, p. 33)`) and
 * reference-list entries. Pure functions (no DOM, no backend), tested in `tests/cite.test.ts`.
 *
 * Chinese / Japanese / Korean names are written in full and use full-width punctuation
 * (`（王小明，2020）`), as Chinese APA usage does.
 */
import type { CiteRef } from "./ast.ts";

/** An item or annotation as citations need it (from the database or a ```bibtex block). */
export interface CiteData {
    key: string;
    /** The Drawer item (absent for entries written in the document). */
    itemId?: number;
    itemType: string;
    title: string;
    /** Names of the type's main role (authors, directors…), in order. */
    authors: string[];
    editors: string[];
    date: string;
    publication: string;
    volume: string;
    issue: string;
    pages: string;
    publisher: string;
    place: string;
    doi: string;
    url: string;
    isbn: string;
    series: string;
    seriesNumber: string;
    /** Citing an annotation: the highlight / bookmark. */
    annotation?: {
        id: number;
        kind: string;
        color: string;
        quote: string;
        note: string;
        /** Where it is (`第 33 頁`), used as the locator when the citation gives none. */
        locator: string;
    };
    /** Written in the document (```bibtex), not in Drawer. */
    local?: boolean;
}

/** Inline text with optional italics, for reference entries. */
export interface Run {
    text: string;
    italic?: boolean;
}

const reCjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
export const isCjk = (s: string) => reCjk.test(s);

/** `Kahneman, Daniel` / `Daniel Kahneman` → `Kahneman`; CJK names stay whole (`王小明`). */
export function familyName(name: string): string {
    const n = name.trim();
    if (isCjk(n)) return n;
    const comma = n.indexOf(",");
    if (comma >= 0) return n.slice(0, comma).trim();
    const words = n.split(/\s+/);
    return words[words.length - 1] ?? n;
}

/** `Kahneman, Daniel` / `Daniel Kahneman` → `Kahneman, D.`; `Jean-Paul Sartre` → `Sartre, J.-P.` */
export function referenceName(name: string): string {
    const n = name.trim();
    if (isCjk(n)) return n;
    let family: string;
    let given: string;
    const comma = n.indexOf(",");
    if (comma >= 0) {
        family = n.slice(0, comma).trim();
        given = n.slice(comma + 1).trim();
    } else {
        const words = n.split(/\s+/);
        family = words.pop() ?? "";
        given = words.join(" ");
    }
    const initials = given
        .split(/\s+/)
        .filter(Boolean)
        .map((w) =>
            w
                .split("-")
                .map((p) => (p ? p[0].toUpperCase() + "." : ""))
                .join("-"),
        )
        .join(" ");
    return initials ? `${family}, ${initials}` : family;
}

export function yearOf(date: string): string {
    return /(?<!\d)\d{4}(?!\d)/.exec(date)?.[0] ?? "";
}

function cjkEntry(d: CiteData): boolean {
    return d.authors.length > 0 ? isCjk(d.authors[0]) : isCjk(d.title);
}

/** Short author part of an in-text citation. */
export function citeAuthor(d: CiteData): string {
    const cjk = cjkEntry(d);
    const names = d.authors.map(familyName);
    if (names.length === 0) {
        const t = d.title.trim() || d.key;
        return cjk ? `《${t}》` : t.length > 40 ? t.slice(0, 39) + "…" : t;
    }
    if (names.length === 1) return names[0];
    if (names.length === 2) return cjk ? `${names[0]}、${names[1]}` : `${names[0]} & ${names[1]}`;
    return cjk ? `${names[0]}等` : `${names[0]} et al.`;
}

function citeYear(d: CiteData): string {
    return yearOf(d.date) || (cjkEntry(d) ? "無日期" : "n.d.");
}

/** `p. 33`, `頁 12` or nothing: a bare number becomes a page. */
function locatorText(locator: string, cjk: boolean): string {
    const l = locator.trim();
    if (!l) return "";
    if (/^\d+$/.test(l)) return cjk ? `頁 ${l}` : `p. ${l}`;
    if (/^\d+\s*[-–]\s*\d+$/.test(l)) return cjk ? `頁 ${l.replace(/\s*[-–]\s*/, "–")}` : `pp. ${l.replace(/\s*[-–]\s*/, "–")}`;
    return l;
}

/**
 * In-text citation, e.g. `(Kahneman, 2011, p. 33; Tversky & Kahneman, 1974)` or, narrative,
 * `Kahneman (2011)`. `lookup` returns null for keys that are not known.
 */
export function formatCitation(cites: CiteRef[], narrative: boolean, lookup: (key: string) => CiteData | null): string {
    const parts = cites.map((c) => ({ c, d: lookup(c.key) }));
    const cjk = parts.length > 0 && parts.every((p) => p.d && cjkEntry(p.d));
    const sep = cjk ? "，" : ", ";
    const piece = ({ c, d }: { c: CiteRef; d: CiteData | null }, withAuthor: boolean) => {
        if (!d) return "@" + c.key;
        const loc = locatorText(c.locator || d.annotation?.locator || "", cjk);
        const bits = [withAuthor && !c.suppressAuthor ? citeAuthor(d) : "", citeYear(d), loc].filter(Boolean);
        return (c.prefix ? c.prefix + " " : "") + bits.join(sep);
    };
    if (narrative && parts.length === 1) {
        const p = parts[0];
        if (!p.d) return "@" + p.c.key;
        const inner = piece({ c: { ...p.c, prefix: "" }, d: p.d }, false);
        return cjk ? `${citeAuthor(p.d)}（${inner}）` : `${citeAuthor(p.d)} (${inner})`;
    }
    const body = parts.map((p) => piece(p, true)).join(cjk ? "；" : "; ");
    return cjk ? `（${body}）` : `(${body})`;
}

function joinNames(names: string[], cjk: boolean): string {
    if (cjk) return names.join("、");
    if (names.length <= 1) return names.join("");
    if (names.length === 2) return `${names[0]}, & ${names[1]}`;
    return names.slice(0, -1).join(", ") + ", & " + names[names.length - 1];
}

const ARTICLE_TYPES = new Set(["journalArticle", "magazineArticle", "news"]);
const CHAPTER_TYPES = new Set(["bookSection", "conferencePaper"]);

/** One reference-list entry (APA). */
export function formatReference(d: CiteData): Run[] {
    const cjk = cjkEntry(d);
    const runs: Run[] = [];
    const add = (text: string, italic = false) => {
        if (text) runs.push(italic ? { text, italic } : { text });
    };
    const end = (s: string) => (/[.?!。？！]$/.test(s) ? s : s + (cjk ? "。" : "."));
    const year = yearOf(d.date) || (cjk ? "無日期" : "n.d.");
    const names = d.authors.map(referenceName);
    const title = d.title.trim() || (cjk ? "（無標題）" : "Untitled");
    if (names.length > 0) add(joinNames(names, cjk) + (cjk ? `（${year}）。` : ` (${year}). `));

    if (ARTICLE_TYPES.has(d.itemType)) {
        add(end(title) + (cjk ? "" : " "));
        if (d.publication) {
            add(d.publication, !cjk);
            if (cjk) add("，");
            if (d.volume) {
                if (!cjk) add(", ");
                add(d.volume, !cjk);
            }
            if (d.issue) add(`(${d.issue})`);
            if (d.pages) add((cjk ? "，" : ", ") + d.pages.replace(/\s*-\s*/, "–"));
            add(cjk ? "。" : ". ");
        }
    } else if (CHAPTER_TYPES.has(d.itemType)) {
        add(end(title) + (cjk ? "" : " "));
        if (d.publication) {
            add(cjk ? "載於" : "In ");
            if (d.editors.length > 0) add(joinNames(d.editors.map(referenceName), cjk) + (cjk ? "（編），" : ` (Ed${d.editors.length > 1 ? "s" : ""}.), `));
            add(cjk ? `《${d.publication}》` : d.publication, !cjk);
            if (d.pages) add(cjk ? `（頁 ${d.pages}）` : ` (pp. ${d.pages.replace(/\s*-\s*/, "–")})`);
            add(cjk ? "。" : ". ");
        }
        if (d.publisher) add(end(d.publisher) + (cjk ? "" : " "));
    } else {
        add(cjk ? `《${title}》` : title, !cjk);
        if (d.seriesNumber || d.volume) add(cjk ? `（第 ${d.seriesNumber || d.volume} 冊）` : ` (Vol. ${d.seriesNumber || d.volume})`);
        add(cjk ? "。" : ". ");
        const source = d.publisher || d.publication;
        if (source) add(end(source) + (cjk ? "" : " "));
    }
    if (names.length === 0) add(cjk ? `（${year}）。` : `(${year}). `);
    if (d.doi) add(`https://doi.org/${d.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")}`);
    else if (d.url) add(d.url);
    // Tidy: no trailing space.
    if (runs.length) runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, "");
    return runs;
}

/** Plain-text form of a reference (tooltips, copying). */
export const referenceText = (d: CiteData) => formatReference(d).map((r) => r.text).join("");

/** Sorting key for the reference list: first author (or title), then year. */
export function referenceSortKey(d: CiteData): string {
    const first = d.authors[0] ? familyName(d.authors[0]) : d.title;
    return `${first.toLowerCase()}\u0000${yearOf(d.date)}\u0000${d.title.toLowerCase()}`;
}

/** `kahneman2011:h3` → `kahneman2011` (the item an annotation key belongs to). */
export const itemKeyOf = (key: string) => key.replace(/:[hb]\d+$/, "");
