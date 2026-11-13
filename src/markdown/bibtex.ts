/**
 * BibTeX / BibLaTeX reading and writing (see `Design/Markdown Language.md`「書目格式」).
 * Pure functions, tested in `tests/bibtex.test.ts`.
 */
import { creatorRoles } from "../drawer/itemTypes.ts";
import type { CiteData } from "./cite.ts";

// ---- the item shape exchanged with the backend (`list_cite_items` / `import_items`) ------------

export interface BibCreator {
    role: string;
    name: string;
}

/** An item as `list_cite_items` returns it. */
export interface CiteItem {
    id: number;
    citeKey: string;
    itemType: string;
    primaryRole: string;
    title: string;
    creators: BibCreator[];
    date: string;
    publication: string;
    volume: string;
    issue: string;
    pages: string;
    publisher: string;
    place: string;
    doi: string;
    isbn: string;
    url: string;
    series: string;
    seriesNumber: string;
    runningTime: string;
    medium: string;
    dimensions: string;
    catalogNumber: string;
    abstractNote: string;
    tags: string[];
}

/** An entry for `import_items` (field names are database columns). */
export interface ImportItem {
    itemType: string;
    citeKey: string;
    fields: Record<string, string>;
    creators: BibCreator[];
    tags: string[];
}

/** Citation data for an item. */
export function citeDataOf(item: CiteItem): CiteData {
    const main = item.creators.filter((c) => c.role === item.primaryRole).map((c) => c.name);
    return {
        key: item.citeKey,
        itemId: item.id,
        itemType: item.itemType,
        title: item.title,
        authors: main.length > 0 ? main : item.creators.filter((c) => c.role !== "editor" && c.role !== "translator").map((c) => c.name),
        editors: item.creators.filter((c) => c.role === "editor").map((c) => c.name),
        date: item.date,
        publication: item.publication,
        volume: item.volume,
        issue: item.issue,
        pages: item.pages,
        publisher: item.publisher,
        place: item.place,
        doi: item.doi,
        url: item.url,
        isbn: item.isbn,
        series: item.series,
        seriesNumber: item.seriesNumber,
    };
}

// ---- types ---------------------------------------------------------------------------------------

const PERFORMANCE = ["concert", "theater", "musical", "opera", "dance", "comedy", "festival", "talk"];

/** Banyan type → [BibLaTeX type, entrysubtype or type field]. */
function bibType(itemType: string): [string, string] {
    switch (itemType) {
        case "journalArticle":
            return ["article", ""];
        case "magazineArticle":
            return ["article", "magazine"];
        case "news":
            return ["article", "newspaper"];
        case "book":
            return ["book", ""];
        case "bookSection":
            return ["incollection", ""];
        case "conferencePaper":
            return ["inproceedings", ""];
        case "thesis":
            return ["thesis", ""];
        case "report":
            return ["report", ""];
        case "webpage":
            return ["online", ""];
        case "software":
            return ["software", ""];
        case "music":
        case "cd":
            return ["audio", ""];
        case "podcast":
            return ["audio", "podcast"];
        case "film":
        case "dvd":
        case "tvEpisode":
        case "video":
            return ["video", ""];
        case "painting":
        case "artwork":
        case "photo":
            return ["artwork", ""];
        default:
            // Performances, maps, documents, files: @misc with the Banyan type kept.
            return ["misc", itemType];
    }
}

/** BibLaTeX / BibTeX type (+ subtype) → Banyan type. */
function banyanType(type: string, sub: string): string {
    const t = type.toLowerCase();
    const s = sub.toLowerCase();
    switch (t) {
        case "article":
            return s === "newspaper" ? "news" : s === "magazine" ? "magazineArticle" : "journalArticle";
        case "book":
        case "mvbook":
        case "booklet":
            return "book";
        case "incollection":
        case "inbook":
        case "bookinbook":
            return "bookSection";
        case "inproceedings":
        case "conference":
        case "proceedings":
            return "conferencePaper";
        case "thesis":
        case "phdthesis":
        case "mastersthesis":
            return "thesis";
        case "report":
        case "techreport":
            return "report";
        case "online":
        case "www":
        case "electronic":
            return "webpage";
        case "software":
            return "software";
        case "audio":
        case "music":
            return s === "podcast" ? "podcast" : "music";
        case "video":
        case "movie":
            return "film";
        case "artwork":
            return "artwork";
        case "performance":
            return "concert";
        default:
            if (s && !s.startsWith("file") && (PERFORMANCE.includes(s) || ["map", "document", "painting", "photo", "artwork", "dvd", "cd", "tvEpisode", "video"].includes(s)))
                return s;
            return "document";
    }
}

// ---- writing -------------------------------------------------------------------------------------

/** Escapes LaTeX special characters (`&`, `%`, `$`, `#`, `_`, braces). */
export function texEscape(s: string): string {
    return s.replace(/\\/g, "\\textbackslash{}").replace(/([&%$#_{}])/g, "\\$1").replace(/\n+/g, " ");
}

const BIB_ROLE: Record<string, string> = { author: "author", editor: "editor", translator: "translator" };

/** One item as a BibLaTeX entry. */
export function toBibtex(item: CiteItem): string {
    const [type, sub] = bibType(item.itemType);
    const fields: [string, string][] = [];
    const put = (name: string, value: string | undefined, raw = false) => {
        const v = (value ?? "").trim();
        if (v) fields.push([name, raw ? v : texEscape(v)]);
    };
    put("title", item.title);
    // Names: the type's main role is the author (a film's director, a song's performer…).
    const byRole = new Map<string, string[]>();
    for (const c of item.creators) {
        const role = c.role === item.primaryRole ? "author" : (BIB_ROLE[c.role] ?? "editora");
        if (!byRole.has(role)) byRole.set(role, []);
        byRole.get(role)!.push(texEscape(c.name));
    }
    for (const role of ["author", "editor", "translator", "editora"]) {
        const names = byRole.get(role);
        if (names?.length) fields.push([role, names.join(" and ")]);
    }
    const otherRole = item.creators.find((c) => c.role !== item.primaryRole && !BIB_ROLE[c.role]);
    if (otherRole) put("editoratype", otherRole.role);
    put("date", item.date);
    if (type === "article") put("journaltitle", item.publication);
    else if (type === "incollection" || type === "inproceedings") put("booktitle", item.publication);
    else if (type === "online") put("organization", item.publication);
    else put("howpublished", item.publication);
    put("volume", item.volume);
    put("number", type === "article" ? item.issue : item.seriesNumber || item.issue);
    put("pages", item.pages);
    put("publisher", item.publisher);
    put("location", item.place);
    put("series", item.series);
    put("doi", item.doi, true);
    put("isbn", item.isbn, true);
    put("url", item.url, true);
    put("abstract", item.abstractNote);
    if (item.tags.length) put("keywords", item.tags.join(", "));
    if (sub) put(type === "misc" ? "type" : "entrysubtype", sub);
    // Banyan extensions (ignored by other tools).
    put("runtime", item.runningTime);
    put("medium", item.medium);
    put("dimensions", item.dimensions);
    put("catalognumber", item.catalogNumber);
    const width = Math.max(...fields.map(([n]) => n.length), 0);
    const body = fields.map(([n, v]) => `  ${n.padEnd(width)} = {${v}}`).join(",\n");
    return `@${type}{${item.citeKey}${body ? ",\n" + body : ""}\n}`;
}

export function toBibtexFile(items: CiteItem[]): string {
    return items.map(toBibtex).join("\n\n") + "\n";
}

// ---- reading -------------------------------------------------------------------------------------

export interface BibEntry {
    type: string;
    key: string;
    /** Field names lower-cased; values with braces and simple LaTeX removed. */
    fields: Record<string, string>;
}

const ACCENTS: Record<string, Record<string, string>> = {
    "'": { a: "á", e: "é", i: "í", o: "ó", u: "ú", y: "ý", c: "ć", n: "ń", s: "ś", z: "ź", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú" },
    "`": { a: "à", e: "è", i: "ì", o: "ò", u: "ù", A: "À", E: "È" },
    "^": { a: "â", e: "ê", i: "î", o: "ô", u: "û", A: "Â", E: "Ê" },
    '"': { a: "ä", e: "ë", i: "ï", o: "ö", u: "ü", y: "ÿ", A: "Ä", O: "Ö", U: "Ü" },
    "~": { a: "ã", n: "ñ", o: "õ", A: "Ã", N: "Ñ", O: "Õ" },
    c: { c: "ç", C: "Ç", s: "ş" },
    v: { c: "č", s: "š", z: "ž", r: "ř", e: "ě", C: "Č", S: "Š", Z: "Ž" },
};

/** LaTeX → text: accents, escaped characters, dashes, braces. */
export function texToText(s: string): string {
    let t = s;
    t = t.replace(/\{?\\([`'^"~cv])\s*\{?\\?([A-Za-z])\}?\}?/g, (m, acc: string, ch: string) => ACCENTS[acc]?.[ch] ?? m);
    t = t
        .replace(/\\textbackslash(\{\})?/g, "\\")
        .replace(/\\(ss|o|O|ae|AE|aa|AA|l|L)\b(\{\})?/g, (_m, c: string) => ({ ss: "ß", o: "ø", O: "Ø", ae: "æ", AE: "Æ", aa: "å", AA: "Å", l: "ł", L: "Ł" })[c] ?? c)
        .replace(/\\([&%$#_{}])/g, "$1")
        .replace(/\\(textit|textbf|emph|textsc|mkbibquote|enquote)\{/g, "{")
        .replace(/---/g, "—")
        .replace(/--/g, "–")
        .replace(/~/g, " ")
        .replace(/[{}]/g, "");
    return t.replace(/\s+/g, " ").trim();
}

/** Parses a .bib file. `@string` macros are expanded; `@comment` and `@preamble` are skipped. */
export function parseBibtex(text: string): BibEntry[] {
    const entries: BibEntry[] = [];
    const strings: Record<string, string> = {
        jan: "1", feb: "2", mar: "3", apr: "4", may: "5", jun: "6", jul: "7", aug: "8", sep: "9", oct: "10", nov: "11", dec: "12",
    };
    let i = 0;
    const n = text.length;
    const skipWs = () => {
        while (i < n) {
            if (/\s/.test(text[i])) i++;
            else if (text[i] === "%") while (i < n && text[i] !== "\n") i++;
            else break;
        }
    };
    const readBraced = (): string => {
        // at "{"
        let depth = 0;
        const start = i + 1;
        for (; i < n; i++) {
            if (text[i] === "\\") {
                i++;
                continue;
            }
            if (text[i] === "{") depth++;
            else if (text[i] === "}" && --depth === 0) break;
        }
        const v = text.slice(start, i);
        i++;
        return v;
    };
    const readQuoted = (): string => {
        let depth = 0;
        const start = i + 1;
        for (i++; i < n; i++) {
            if (text[i] === "\\") {
                i++;
                continue;
            }
            if (text[i] === "{") depth++;
            else if (text[i] === "}") depth--;
            else if (text[i] === '"' && depth === 0) break;
        }
        const v = text.slice(start, i);
        i++;
        return v;
    };
    const readValue = (): string => {
        let out = "";
        for (;;) {
            skipWs();
            if (text[i] === "{") out += readBraced();
            else if (text[i] === '"') out += readQuoted();
            else {
                const m = /^[^\s,#}]+/.exec(text.slice(i));
                if (!m) break;
                i += m[0].length;
                out += /^\d+$/.test(m[0]) ? m[0] : (strings[m[0].toLowerCase()] ?? m[0]);
            }
            skipWs();
            if (text[i] === "#") {
                i++;
                continue;
            }
            break;
        }
        return out;
    };
    while (i < n) {
        const at = text.indexOf("@", i);
        if (at < 0) break;
        i = at + 1;
        const tm = /^\s*([A-Za-z]+)\s*([{(])/.exec(text.slice(i));
        if (!tm) continue;
        const type = tm[1].toLowerCase();
        i += tm[0].length;
        const close = tm[2] === "{" ? "}" : ")";
        if (type === "comment" || type === "preamble") {
            // Skip to the matching close.
            let depth = 1;
            for (; i < n && depth > 0; i++) {
                if (text[i] === tm[2]) depth++;
                else if (text[i] === close) depth--;
            }
            continue;
        }
        if (type === "string") {
            skipWs();
            const nm = /^[^\s=]+/.exec(text.slice(i));
            if (!nm) continue;
            i += nm[0].length;
            skipWs();
            if (text[i] === "=") i++;
            strings[nm[0].toLowerCase()] = readValue();
            skipWs();
            if (text[i] === close) i++;
            continue;
        }
        skipWs();
        const km = /^[^\s,]*/.exec(text.slice(i))!;
        const key = km[0].replace(/[})]$/, "");
        i += km[0].length;
        const fields: Record<string, string> = {};
        for (;;) {
            skipWs();
            if (text[i] === ",") {
                i++;
                skipWs();
            }
            if (i >= n || text[i] === close) {
                i++;
                break;
            }
            const fm = /^([A-Za-z][\w\-:.+]*)\s*=/.exec(text.slice(i));
            if (!fm) {
                // Malformed: skip to the next comma or the end of the entry.
                while (i < n && text[i] !== "," && text[i] !== close) i++;
                continue;
            }
            i += fm[0].length;
            fields[fm[1].toLowerCase()] = readValue();
        }
        entries.push({ type, key, fields });
    }
    return entries;
}

/** Splits `A and B and {C and D}` at top-level `and`s. */
export function splitNames(value: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let cur = "";
    const words = value.split(/(\s+and\s+|[{}])/i);
    for (const w of words) {
        if (w === "{") depth++;
        else if (w === "}") depth--;
        if (depth === 0 && /^\s+and\s+$/i.test(w)) {
            out.push(cur);
            cur = "";
        } else cur += w;
    }
    out.push(cur);
    return out.map(texToText).filter(Boolean);
}

/** A parsed entry as a Banyan item to import. */
export function toImportItem(e: BibEntry): ImportItem {
    const f = e.fields;
    const get = (...names: string[]) => {
        for (const n of names) if (f[n] !== undefined && f[n].trim()) return texToText(f[n]);
        return "";
    };
    const itemType = banyanType(e.type, f.entrysubtype ? texToText(f.entrysubtype) : f.type ? texToText(f.type) : "");
    const article = ["journalArticle", "magazineArticle", "news"].includes(itemType);
    let date = get("date");
    if (!date) {
        const y = get("year");
        const m = get("month");
        date = y && m && /^\d{1,2}$/.test(m) ? `${y}-${m.padStart(2, "0")}` : y;
    }
    const fields: Record<string, string> = {
        title: get("title"),
        date,
        publication: get("journaltitle", "journal", "booktitle", "organization", "howpublished"),
        volume: get("volume"),
        pages: get("pages"),
        publisher: get("publisher", "institution", "school"),
        place: get("location", "address"),
        series: get("series"),
        doi: get("doi"),
        isbn: get("isbn"),
        url: get("url"),
        abstract_note: get("abstract"),
        running_time: get("runtime"),
        medium: get("medium"),
        dimensions: get("dimensions"),
        catalog_number: get("catalognumber"),
    };
    const number = get("number", "issue");
    if (article || !fields.series) fields.issue = number;
    else fields.series_number = number;
    for (const k of Object.keys(fields)) if (!fields[k]) delete fields[k];

    const main = creatorRoles(itemType)[0] ?? "author";
    const creators: BibCreator[] = [];
    const add = (field: string, role: string) => {
        if (f[field]) for (const name of splitNames(f[field])) creators.push({ role, name });
    };
    add("author", main);
    add("editor", creatorRoles(itemType).includes("editor") ? "editor" : "contributor");
    add("translator", "translator");
    add("editora", f.editoratype ? texToText(f.editoratype) : "contributor");
    const tags = (f.keywords ? texToText(f.keywords) : "")
        .split(/[,;]/)
        .map((t) => t.trim())
        .filter(Boolean);
    return { itemType, citeKey: e.key, fields, creators, tags };
}

/** Entries of a ```bibtex block as citation data (they cite nothing in Drawer). */
export function bibtexCiteData(text: string): CiteData[] {
    return parseBibtex(text).map((e) => {
        const item = toImportItem(e);
        const main = creatorRoles(item.itemType)[0] ?? "author";
        return {
            key: e.key,
            itemType: item.itemType,
            title: item.fields.title ?? "",
            authors: item.creators.filter((c) => c.role === main).map((c) => c.name),
            editors: item.creators.filter((c) => c.role === "editor").map((c) => c.name),
            date: item.fields.date ?? "",
            publication: item.fields.publication ?? "",
            volume: item.fields.volume ?? "",
            issue: item.fields.issue ?? "",
            pages: item.fields.pages ?? "",
            publisher: item.fields.publisher ?? "",
            place: item.fields.place ?? "",
            doi: item.fields.doi ?? "",
            url: item.fields.url ?? "",
            isbn: item.fields.isbn ?? "",
            series: item.fields.series ?? "",
            seriesNumber: item.fields.series_number ?? "",
            local: true,
        };
    });
}
