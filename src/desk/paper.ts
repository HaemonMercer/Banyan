import { isMap, parseDocument, stringify } from "yaml";
import { readStyles, type DeskStyles } from "./styles.ts";

/** Paper sizes in millimetres, portrait. */
export const PAPERS = {
    a3: { label: "A3", width: 297, height: 420 },
    a4: { label: "A4", width: 210, height: 297 },
    a5: { label: "A5", width: 148, height: 210 },
    b5: { label: "B5 (JIS)", width: 182, height: 257 },
    letter: { label: "Letter", width: 215.9, height: 279.4 },
    legal: { label: "Legal", width: 215.9, height: 355.6 },
};

export type Paper = keyof typeof PAPERS;
export type DeskMode = "writer" | "slides";

export const SIDES = ["top", "right", "bottom", "left"] as const;
export const ALIGNMENTS = ["left", "center", "right"] as const;
export const PAGE_NUMBER = "pageNumber";
export type RunningLine = Record<(typeof ALIGNMENTS)[number], string[]>;
const emptyLine = (): RunningLine => ({ left: [], center: [], right: [] });
export type Orientation = "portrait" | "landscape";
export type PageSettings = {
    paper: Paper;
    orientation: Orientation;
    /** Text columns on every page (1–4), the gap between them in mm, and a line between them. */
    columns: number;
    columnGap: number;
    columnRule: boolean;
    /** The first page has no header or footer (a cover or title page). */
    differentFirstPage: boolean;
    padding: Record<(typeof SIDES)[number], number>;
    color: string;
    header: RunningLine;
    footer: RunningLine;
    pageNumbers: boolean;
};

export const DEFAULT_PAGE: PageSettings = {
    paper: "a4", orientation: "portrait", columns: 1, columnGap: 8, columnRule: false, differentFirstPage: false,
    padding: { top: 18, right: 18, bottom: 18, left: 18 },
    color: "#ffffff", header: emptyLine(), footer: { ...emptyLine(), center: [PAGE_NUMBER] }, pageNumbers: true,
};

function readPadding(value: unknown): PageSettings["padding"] {
    const tuple = typeof value === "string" ? /^\(([^()]*)\)$/.exec(value.trim())?.[1].split(",").map((part) => {
        const number = part.trim();
        return /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(number) ? Number(number) : NaN;
    }) : undefined;
    const sides = tuple?.length === SIDES.length && tuple.every(Number.isFinite) ? tuple : null;
    const mapping = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const padding = { ...DEFAULT_PAGE.padding };
    for (const [index, side] of SIDES.entries()) {
        const amount = typeof value === "number" ? value : sides?.[index] ?? mapping[side];
        if (typeof amount === "number" && Number.isFinite(amount)) padding[side] = Math.max(0, Math.min(60, amount));
    }
    return padding;
}

function writePadding(padding: PageSettings["padding"]) {
    const values = SIDES.map((side) => padding[side]);
    return values.every((value) => value === values[0]) ? values[0] : `(${values.join(", ")})`;
}

function readLine(value: unknown, legacyNumber: boolean): RunningLine {
    const line = emptyLine();
    const clean = (text: string) => text.replace(/[\r\n]/g, " ").slice(0, 150);
    if (!value || typeof value === "string") {
        if (typeof value === "string" && value) line.center.push(clean(value));
        if (legacyNumber) line.center.push(PAGE_NUMBER);
    } else if (typeof value === "object" && !Array.isArray(value)) {
        const entries = value as Record<string, unknown>;
        for (const side of ALIGNMENTS) {
            const entry = entries[side];
            const items = Array.isArray(entry) ? entry : [entry];
            line[side] = items.filter((item): item is string => typeof item === "string" && !!item.trim()).map(clean);
        }
    }
    return line;
}

export function lineParts(line: RunningLine, side: (typeof ALIGNMENTS)[number], numbered: boolean) {
    return line[side].filter((part) => numbered || part !== PAGE_NUMBER);
}

const metadata = /^<!-- desk-page ([^\r\n]*?) -->\r?\n\r?\n/;
const frontMatter = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)(?:\r?\n)?/m;

/**
 * In YAML ` #` starts a comment, so `bold: 10pt #c0392b` would lose its colour. Quote plain values
 * that hold a `#colour` before parsing; other comments stay comments.
 */
export function prepareYaml(text: string) {
    return text.replace(/^([ \t]*(?:-[ \t]+)?[^\s#:'"-][^:#\r\n]*?:[ \t]+)([^'"[{|>\s#][^\r\n]*?|#[0-9a-fA-F]{3,8}(?:[ \t][^\r\n]*?)?)[ \t]*$/gm, (line, key: string, value: string) =>
        /(?:^|[ \t])#[0-9a-fA-F]{3,8}(?=[ \t]|$)/.test(value) ? `${key}'${value.replace(/'/g, "''")}'` : line);
}

/** The reverse of `prepareYaml` for written YAML: drop quotes that are only there because of a `#colour`. */
export function unquoteYaml(text: string) {
    return text.replace(/^([ \t]*[^\s#:'"-][^:#\r\n]*?:[ \t]+)(?:'((?:[^']|'')*)'|"([^"\\]*)")[ \t]*$/gm, (line, key: string, single?: string, double?: string) => {
        const value = single !== undefined ? single.replace(/''/g, "'") : double!;
        const hex = /(?:^|[ \t])#[0-9a-fA-F]{3,8}(?=[ \t]|$)/;
        // Safe only when every ` #` starts a colour, the first character is plain and nothing else needs quoting.
        const safe = hex.test(value) && !/^[\s'"[\]{}|>&*!%@`,?:-]/.test(value) && !/\s$/.test(value)
            && !/: |[ \t]#(?![0-9a-fA-F]{3,8}(?:[ \t]|$))/.test(value) && !/^(?:true|false|null|~|-?\d[\d.]*)$/i.test(value);
        return safe ? key + value : line;
    });
}

export function readYaml(markdown: string) {
    if (!markdown.startsWith("---") && !markdown.startsWith("\uFEFF---")) return null;
    const match = frontMatter.exec(markdown);
    if (match?.index !== 0) return null;
    // YAML reserves a leading asterisk for aliases. Accept the Desk default-style key in both forms.
    const yaml = parseDocument(prepareYaml(match[1]).replace(/^([ \t]+)\*normal(?=[ \t]*:)/gm, '$1"*normal"'));
    if (!isMap(yaml.contents) && (!yaml.errors.length || !/^\s*page\s*:/m.test(match[1]))) return null;
    return { yaml, prefix: match[0] };
}

/** `styles`: the `Style:` groups of the front matter (see `styles.ts`). */
type PageRead = { page: PageSettings; body: string; prefix?: string; invalidYaml?: boolean; mode?: DeskMode; styles?: DeskStyles };
const pageCache = new Map<string, PageRead>();
const PAGE_CACHE_MAX = 4;

/** Splits off and reads the front matter. Results are cached; treat them as read-only. */
export function readPage(markdown: string): PageRead {
    const hit = pageCache.get(markdown);
    if (hit) {
        pageCache.delete(markdown);
        pageCache.set(markdown, hit);
        return hit;
    }
    const read = readPageUncached(markdown);
    if (!read.invalidYaml) {
        // Every document has a default format, also one without front matter.
        try {
            read.styles = readStyles(read.prefix ? readYaml(markdown)?.yaml.toJS({ maxAliasCount: 0 }) : undefined);
        } catch {
            read.styles = readStyles(undefined);
        }
    }
    pageCache.set(markdown, read);
    if (pageCache.size > PAGE_CACHE_MAX) pageCache.delete(pageCache.keys().next().value!);
    return read;
}

function readPageUncached(markdown: string): PageRead {
    const front = readYaml(markdown);
    const match = metadata.exec(markdown);
    if (!front && !match) return { page: DEFAULT_PAGE, body: markdown };
    const prefix = front?.prefix ?? match![0];
    const body = markdown.slice(prefix.length);
    if (front?.yaml.errors.length) return { page: DEFAULT_PAGE, body, prefix, invalidYaml: true };
    try {
        const parsed = front ? front.yaml.toJS({ maxAliasCount: 0 }) : null;
        const value = (front ? parsed?.page ?? {} : JSON.parse(match![1])) as Partial<PageSettings> | null;
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            return front ? { page: DEFAULT_PAGE, body, prefix } : { page: DEFAULT_PAGE, body: markdown };
        }
        const pageNumbers = typeof value.pageNumbers === "boolean" ? value.pageNumbers : DEFAULT_PAGE.pageNumbers;
        const paper = String(value.paper).toLowerCase().replace(/[\s()_-]|jis/g, "");
        const columns = Number(value.columns);
        const gap = typeof value.columnGap === "number" ? value.columnGap : NaN;
        return {
            page: {
                paper: Object.prototype.hasOwnProperty.call(PAPERS, paper) ? paper as Paper : "a4",
                orientation: String(value.orientation).toLowerCase() === "landscape" ? "landscape" : "portrait",
                columns: Number.isInteger(columns) ? Math.max(1, Math.min(MAX_COLUMNS, columns)) : 1,
                columnGap: Number.isFinite(gap) ? Math.max(0, Math.min(30, gap)) : DEFAULT_PAGE.columnGap,
                columnRule: value.columnRule === true,
                differentFirstPage: value.differentFirstPage === true,
                padding: readPadding(value.padding),
                color: typeof value.color === "string" && /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : DEFAULT_PAGE.color,
                header: readLine(value.header, false),
                footer: readLine(value.footer, true),
                pageNumbers,
            },
            body,
            prefix,
            ...(parsed?.mode === "writer" || parsed?.mode === "slides" ? { mode: parsed.mode as DeskMode } : {}),
        };
    } catch {
        return front ? { page: DEFAULT_PAGE, body, prefix, invalidYaml: true } : { page: DEFAULT_PAGE, body: markdown };
    }
}

export const MAX_COLUMNS = 4;
/** Settings written only when they differ from the default, so plain documents keep a short YAML. */
const OPTIONAL: (keyof PageSettings)[] = ["orientation", "columns", "columnGap", "columnRule", "differentFirstPage"];
const isDefault = (page: PageSettings, key: keyof PageSettings) => (OPTIONAL.includes(key) && page[key] === DEFAULT_PAGE[key])
    // The gap and the line only mean something with more than one column.
    || (page.columns === 1 && (key === "columnGap" || key === "columnRule"));
const written = (page: PageSettings) => Object.fromEntries(Object.entries({ ...page, padding: writePadding(page.padding) })
    .filter(([key]) => !isDefault(page, key as keyof PageSettings)));

export function writePage(page: PageSettings, body: string, prefix = "", mode?: DeskMode) {
    const front = readYaml(prefix);
    if (front) {
        if (front.yaml.errors.length) return prefix + body;
        if (mode) front.yaml.set("mode", mode);
        if (!isMap(front.yaml.get("page", true))) {
            front.yaml.set("page", front.yaml.createNode(written(page)));
            return `---\n${front.yaml.toString()}---\n\n${body}`;
        }
        for (const [key, value] of Object.entries(page)) {
            if (isDefault(page, key as keyof PageSettings)) {
                front.yaml.deleteIn(["page", key]);
            } else if (key === "padding" && isMap(front.yaml.getIn(["page", "padding"], true))) {
                for (const side of SIDES) front.yaml.setIn(["page", "padding", side], page.padding[side]);
            } else {
                front.yaml.setIn(["page", key], key === "padding" ? writePadding(page.padding) : value);
            }
        }
        return `---\n${front.yaml.toString()}---\n\n${body}`;
    }
    return `---\n${stringify({ mode, page: written(page) })}---\n\n${body}`;
}

export function replacePageBody(markdown: string, page: PageSettings, prefix?: string) {
    if (!prefix) return markdown;
    return metadata.test(prefix) ? writePage(page, markdown) : prefix + markdown;
}

/** The sheet as laid out: the paper turned for landscape. */
export function paperSize(page: Pick<PageSettings, "paper" | "orientation">) {
    const { width, height } = PAPERS[page.paper];
    return page.orientation === "landscape" ? { width: height, height: width } : { width, height };
}

/** Margin presets, like a word processor's (mm). */
export const MARGIN_PRESETS: { label: string; padding: PageSettings["padding"] }[] = [
    { label: "標準", padding: { top: 18, right: 18, bottom: 18, left: 18 } },
    { label: "窄", padding: { top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 } },
    { label: "中等", padding: { top: 25.4, right: 19.1, bottom: 25.4, left: 19.1 } },
    { label: "寬", padding: { top: 25.4, right: 50.8, bottom: 25.4, left: 50.8 } },
    { label: "Word 預設", padding: { top: 25.4, right: 31.8, bottom: 25.4, left: 31.8 } },
];

/** The header and footer of one page: empty on the first page when `differentFirstPage` is on. */
export function runningLines(page: PageSettings, index: number) {
    const blank = index === 0 && page.differentFirstPage;
    return (part: "header" | "footer", side: (typeof ALIGNMENTS)[number]) => blank ? [] : lineParts(page[part], side, page.pageNumbers);
}

export function pageInsets(page: PageSettings) {
    return {
        ...page.padding,
        top: Math.max(page.padding.top, ALIGNMENTS.some((side) => lineParts(page.header, side, page.pageNumbers).length) ? 10 : 0),
        bottom: Math.max(page.padding.bottom, ALIGNMENTS.some((side) => lineParts(page.footer, side, page.pageNumbers).length) ? 10 : 0),
    };
}

export const RUNNING_LINE_HEIGHT = 4;

export function runningLineOffset(inset: number) {
    return Math.max(0, (inset - RUNNING_LINE_HEIGHT) / 2);
}

export function pageInk(color: string) {
    const [r, g, b] = color.slice(1).match(/../g)!.map((hex) => {
        const c = parseInt(hex, 16) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? "#000000" : "#ffffff";
}

