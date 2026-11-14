import type { MdNode } from "../markdown/ast.ts";

/**
 * Desk style groups, read from the `Style:` key of the front matter:
 *
 *   Style:
 *     style A:
 *       text:                 # built-in marks (bold, italic, …) and custom text styles
 *         bold: { color: "#fafafa", size: 10 }
 *         custom A: { size: 24 }
 *       paragraph:            # paragraphs, headings, quotes, list items
 *         heading: { color: "#ab2943" }
 *     Style B:
 *       highlight: { size: 10 }   # marks may also sit directly under the group
 *
 * `::push(style A)` … `::pop()` applies a group. Only what a group writes changes; everything
 * else is inherited from the enclosing group, like CSS. `::style(custom A){…}` looks only in the
 * current group. Names ignore spaces and case.
 */
export type StyleProps = Record<string, string>;
export interface CustomStyle { name: string; props: StyleProps; shortcut?: string }

export interface StyleGroup {
    name: string;
    /** Built-in marks by canonical name (`normal` is the group's running text). */
    marks: Record<string, StyleProps>;
    /** Custom text styles by key, with the name as written and the keyboard shortcut that applies them. */
    custom: Record<string, CustomStyle>;
    paragraph: Record<string, StyleProps>;
    /** What this group writes itself, before `based-on`. */
    own?: Pick<StyleGroup, "marks" | "custom" | "paragraph">;
    /** The group named in `based-on`, as written. */
    basedOn?: string;
    /** The resolved group it is based on. */
    inherited?: StyleGroup;
    /** Named by `Default Style:`: applies to the whole document and can't be removed while it is the default. */
    global?: boolean;
}

export type DeskStyles = Map<string, StyleGroup>;

/** Style and group names ignore spaces and case: `style A`, `styleA` and `Style a` are one name. */
export const styleKey = (name: string) => name.normalize("NFKC").replace(/[\s_-]+/g, "").toLowerCase();

/** Built-in marks and the elements the preview renders them as ("" is the group's running text). */
export const MARKS: Record<string, string> = {
    normal: "", bold: "strong", italic: "em", underline: "u", strike: "del", highlight: "mark",
    code: "code", link: "a", superscript: "sup", subscript: "sub",
};
const MARK_ALIASES: Record<string, string> = {
    strong: "bold", emphasis: "italic", em: "italic", strikethrough: "strike", del: "strike",
    mark: "highlight", sup: "superscript", sub: "subscript", body: "normal",
};

export const PARAGRAPHS: Record<string, string> = {
    normal: "p", heading: "h1, h2, h3, h4, h5, h6",
    heading1: "h1", heading2: "h2", heading3: "h3", heading4: "h4", heading5: "h5", heading6: "h6",
    quote: "blockquote", list: "li", table: "table",
};
const PARAGRAPH_ALIASES: Record<string, string> = {
    paragraph: "normal", body: "normal", p: "normal", headings: "heading", blockquote: "quote", listitem: "list",
    ...Object.fromEntries([1, 2, 3, 4, 5, 6].flatMap((n) => [[`h${n}`, `heading${n}`], [`header${n}`, `heading${n}`]])),
};
export const GROUP_TEXT = new Set(["text", "texts", "textstyle"]);
export const GROUP_PARAGRAPH = new Set(["paragraph", "paragraphs", "paragraphstyle", "para"]);

export const has = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
export const markName = (key: string) => MARK_ALIASES[key] ?? key;
export const paragraphName = (key: string) => PARAGRAPH_ALIASES[key] ?? key;

/** Short names and CSS spellings (kebab or camel case) of the properties a style may set. */
export const PROPERTIES: Record<string, string> = {
    size: "font-size", fontsize: "font-size",
    font: "font-family", family: "font-family", fontfamily: "font-family",
    weight: "font-weight", fontweight: "font-weight",
    fontstyle: "font-style", variant: "font-variant", fontvariant: "font-variant",
    color: "color", colour: "color",
    background: "background-color", backgroundcolor: "background-color", highlightcolor: "background-color",
    decoration: "text-decoration", textdecoration: "text-decoration",
    transform: "text-transform", texttransform: "text-transform",
    verticalalign: "vertical-align",
    lineheight: "line-height", leading: "line-height",
    letterspacing: "letter-spacing", spacing: "letter-spacing", wordspacing: "word-spacing",
    align: "text-align", textalign: "text-align",
    indent: "text-indent", textindent: "text-indent",
    margintop: "margin-top", spacebefore: "margin-top", marginbottom: "margin-bottom", spaceafter: "margin-bottom",
    marginleft: "margin-left", indentleft: "margin-left", leftindent: "margin-left", marginright: "margin-right", indentright: "margin-right", rightindent: "margin-right",
};
/** Plain numbers in these properties are points; line height and weight stay unitless. */
const POINTS = new Set(["font-size", "letter-spacing", "word-spacing", "text-indent", "margin-top", "margin-bottom", "margin-left", "margin-right"]);
/** `bold: true` and friends, for short styles. */
export const SWITCHES: Record<string, [string, string, string]> = {
    bold: ["font-weight", "700", "400"],
    italic: ["font-style", "italic", "normal"],
    underline: ["text-decoration", "underline", "none"],
    strike: ["text-decoration", "line-through", "none"],
};

/** Spellings of shortcut modifiers, in the order they are written: `Ctrl+Alt+Shift+1`. */
const MODIFIERS: Record<string, string> = {
    ctrl: "Ctrl", control: "Ctrl", ctl: "Ctrl", alt: "Alt", option: "Alt", opt: "Alt",
    shift: "Shift", meta: "Meta", cmd: "Meta", command: "Meta", win: "Meta", super: "Meta",
};
const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Meta"];
const NAMED_KEYS = ["Enter", "Space", "Tab", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown",
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
const KEY_ALIASES: Record<string, string> = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", del: "Delete", ins: "Insert", esc: "Escape", return: "Enter" };
/** Shortcuts the app or the editor already uses; a text style can't take them. */
const RESERVED_SHORTCUTS = new Set([
    ..."ACVXZYBIFSWH".split("").map((key) => `Ctrl+${key}`), ..."123456789".split("").map((key) => `Ctrl+${key}`),
    "Ctrl+Shift+Z", "Ctrl+Space", "Ctrl+Tab", "Ctrl+Shift+Tab", "Ctrl+PageUp", "Ctrl+PageDown", "Alt+Shift+F",
]);

/**
 * Reads a shortcut such as `Ctrl+Alt+1`, `ctrl-shift-k` or `Alt+F2` into the form the panel shows
 * (`Ctrl+Alt+1`), or null when it isn't one. It needs Ctrl, Alt or Meta, so typing isn't caught.
 */
export function normalizeShortcut(text: unknown): string | null {
    if (typeof text !== "string" || !text.trim()) return null;
    const parts = text.trim().split(/\s*[+-]\s*(?=.)/);
    const key = parts.pop()!.trim();
    const modifiers = new Set<string>();
    for (const part of parts) {
        const modifier = MODIFIERS[part.toLowerCase()];
        if (!modifier) return null;
        modifiers.add(modifier);
    }
    const lower = key.toLowerCase();
    const name = /^.$/u.test(key) ? key.toUpperCase()
        : /^f([1-9]|1[0-2])$/.test(lower) ? key.toUpperCase()
        : KEY_ALIASES[lower] ?? NAMED_KEYS.find((named) => named.toLowerCase() === lower);
    if (!name || name === "Escape" || MODIFIERS[lower]) return null;
    if (!modifiers.has("Ctrl") && !modifiers.has("Alt") && !modifiers.has("Meta")) return null;
    return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), name].join("+");
}

/** Why a shortcut can't be used, or null when it can. */
export function shortcutProblem(shortcut: string): string | null {
    if (RESERVED_SHORTCUTS.has(shortcut)) return `${shortcut} 已經是 Banyan 或編輯器的快捷鍵，請換一個（例如 Ctrl+Alt+1）。`;
    return null;
}

const CODE_KEYS: Record<string, string> = {
    Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'",
    Comma: ",", Period: ".", Slash: "/", Backslash: "\\", Backquote: "`",
};
/** The shortcut a key press makes, or null for a modifier alone or a press that couldn't be one. */
export function shortcutFromEvent(event: { key: string; code?: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }) {
    if (["Control", "Alt", "Shift", "Meta", "AltGraph"].includes(event.key)) return null;
    // The physical key, so Shift+1 stays "1" and Alt combinations don't depend on the layout.
    const code = event.code ?? "";
    const key = /^Key[A-Z]$/.test(code) ? code.slice(3) : /^(?:Digit|Numpad)\d$/.test(code) ? code.slice(-1)
        : CODE_KEYS[code] ?? (event.key === " " ? "Space" : event.key);
    const modifiers = [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Meta"].filter(Boolean);
    return normalizeShortcut([...modifiers, key].join("+"));
}

/** The custom text style of `group` that `shortcut` applies. */
export function styleForShortcut(group: StyleGroup | undefined, shortcut: string) {
    return Object.values(group?.custom ?? {}).find((style) => style.shortcut === shortcut);
}

/** Names the editor offers in completions. */
export const STYLE_PROPERTY_NAMES = ["size", "color", "font", "weight", "bold", "italic", "underline", "background",
    "line-height", "letter-spacing", "align", "indent", "margin-top", "margin-bottom", "shortcut"];

export function cssValue(property: string, value: unknown): string | null {
    if (typeof value === "number" && Number.isFinite(value)) return POINTS.has(property) ? `${value}pt` : String(value);
    if (typeof value !== "string") return null;
    const text = value.trim();
    if (!text) return null;
    if (property === "font-family") {
        const families = text.split(",").map((family) => family.trim().replace(/^(["'])(.*)\1$/, "$2"));
        if (!families.every((family) => /^[\p{L}\p{N} ._-]+$/u.test(family))) return null;
        return families.map((family) => `"${family}"`).join(", ");
    }
    if (POINTS.has(property) && /^-?\d+(?:\.\d+)?$/.test(text)) return `${text}pt`;
    // Only simple values: no declarations, blocks, strings, URLs or escapes can leak into the stylesheet.
    if (!/^[\p{L}\p{N}\s#%.,()+-/]+$/u.test(text) || /url\s*\(|expression\s*\(/i.test(text)) return null;
    return text;
}

/** Keywords of the one-line shorthand and the short property they set. */
const SHORTHAND_WORDS: Record<string, [string, unknown]> = {
    bold: ["bold", true], regular: ["bold", false],
    italic: ["italic", true], upright: ["italic", false],
    underline: ["decoration", "underline"], strike: ["decoration", "line-through"], "line-through": ["decoration", "line-through"],
    left: ["align", "left"], center: ["align", "center"], right: ["align", "right"], justify: ["align", "justify"],
    uppercase: ["transform", "uppercase"], lowercase: ["transform", "lowercase"], capitalize: ["transform", "capitalize"],
    "small-caps": ["variant", "small-caps"],
};
/** Shorthand properties written as `name value`, e.g. `line-height 1.7`, `after 6pt`. */
const SHORTHAND_PAIRS: Record<string, string> = {
    size: "size", font: "font", color: "color", background: "background", bg: "background", weight: "weight",
    "line-height": "line-height", spacing: "letter-spacing", "letter-spacing": "letter-spacing", "word-spacing": "word-spacing",
    indent: "indent", "left-indent": "margin-left", "right-indent": "margin-right",
    before: "margin-top", after: "margin-bottom", decoration: "decoration", transform: "transform", variant: "variant",
    "vertical-align": "vertical-align", shortcut: "shortcut",
};
const LENGTH = /^-?\d+(?:\.\d+)?(?:pt|px|em|rem|%)?$/i;
const HEX = /^#[0-9a-f]{3,8}$/i;

/** Splits on spaces, keeping "quoted names" together. */
function tokens(text: string) {
    return [...text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((match) => ({ text: match[1] ?? match[2] ?? match[3], quoted: match[3] === undefined }));
}

/** Plain numbers stay numbers (points); anything with a unit stays as written. */
const lengthValue = (value: string) => /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : value;

/**
 * Reads a one-line style such as `11pt "Noto Serif TC" #c0392b bold center line-height 1.7 after 6pt`
 * into the long form (`{ size: 11, font: "Noto Serif TC", … }`). A bare length is the size,
 * `#rgb` the colour, keywords switch things on, `name value` sets a property, and other words
 * make up the font name.
 */
export function parseShorthand(text: string): Record<string, unknown> {
    const style: Record<string, unknown> = {};
    const list = tokens(text);
    const fonts: string[] = [];
    let joinFont = false;
    for (let i = 0; i < list.length; i++) {
        const { text: token, quoted } = list[i];
        const word = token.toLowerCase();
        const pair = quoted ? undefined : SHORTHAND_PAIRS[word];
        if (pair && i + 1 < list.length) {
            style[pair] = lengthValue(list[++i].text);
            joinFont = false;
        } else if (quoted) {
            fonts.push(token);
            joinFont = false;
        } else if (HEX.test(token)) {
            style.color = token;
            joinFont = false;
        } else if (LENGTH.test(token)) {
            style.size = lengthValue(token.replace(/pt$/i, ""));
            joinFont = false;
        } else if (SHORTHAND_WORDS[word]) {
            style[SHORTHAND_WORDS[word][0]] = SHORTHAND_WORDS[word][1];
            joinFont = false;
        } else if (joinFont) {
            // Unquoted words next to each other make one font name: Microsoft JhengHei.
            fonts[fonts.length - 1] += " " + token;
        } else {
            fonts.push(token);
            joinFont = true;
        }
    }
    if (fonts.length) style.font = fonts.join(", ");
    return style;
}

const SHORT_FOR_PROPERTY: Record<string, string> = {
    "font-size": "size", "font-family": "font", color: "color", "background-color": "background", "font-weight": "weight",
    "font-style": "italic", "text-decoration": "decoration", "text-align": "align", "text-transform": "transform", "font-variant": "variant",
};
/** The shorthand's name for a long-form key (`font-size` → `size`), or null when it has none. */
function shortKey(key: string): string | null {
    const normalized = styleKey(key);
    if (normalized === "bold" || normalized === "italic") return normalized;
    if (SHORTCUT_KEYS.has(normalized)) return "shortcut";
    const property = PROPERTIES[normalized];
    return property ? SHORT_FOR_PROPERTY[property] ?? property : null;
}
const SHORTHAND_ORDER = ["size", "font", "color", "bold", "weight", "italic", "decoration", "align", "transform", "variant", "background",
    "line-height", "letter-spacing", "word-spacing", "text-indent", "margin-left", "margin-right", "margin-top", "margin-bottom", "vertical-align", "shortcut"];
const PAIR_FOR: Record<string, string> = {
    "letter-spacing": "spacing", "text-indent": "indent", "margin-left": "left-indent", "margin-right": "right-indent",
    "margin-top": "before", "margin-bottom": "after",
};
const LENGTH_PAIRS = new Set(["letter-spacing", "word-spacing", "text-indent", "margin-left", "margin-right", "margin-top", "margin-bottom"]);
const asLength = (value: unknown) => typeof value === "number" ? `${value}pt` : String(value);

/** Writes the long form back as one line, or null when something can't be said in the shorthand. */
export function writeShorthand(style: Record<string, unknown>): string | null {
    const entries: [string, unknown][] = [];
    for (const [key, value] of Object.entries(style)) {
        const short = shortKey(key);
        if (!short || value === null || value === undefined || typeof value === "object") return null;
        entries.push([short, value]);
    }
    entries.sort(([a], [b]) => SHORTHAND_ORDER.indexOf(a) - SHORTHAND_ORDER.indexOf(b));
    const parts: string[] = [];
    for (const [key, value] of entries) {
        const text = String(value).trim();
        if (key === "size") parts.push(asLength(value));
        else if (key === "font") parts.push(...text.split(",").map((family) => family.trim().replace(/^["']|["']$/g, "")).filter(Boolean).map((family) => `"${family}"`));
        else if (key === "color" && HEX.test(text)) parts.push(text);
        else if (key === "bold" && typeof value === "boolean") parts.push(value ? "bold" : "regular");
        else if (key === "italic" && typeof value === "boolean") parts.push(value ? "italic" : "upright");
        else if (key === "decoration" && text === "underline") parts.push("underline");
        else if (key === "decoration" && text === "line-through") parts.push("strike");
        else if (key === "align" && ["left", "center", "right", "justify"].includes(text)) parts.push(text);
        else if (!text || /[\s"']/.test(text)) return null;
        else parts.push(PAIR_FOR[key] ?? key, LENGTH_PAIRS.has(key) ? asLength(value) : text);
    }
    return parts.join(" ");
}

export function readProps(value: unknown): StyleProps {
    const props: StyleProps = {};
    if (typeof value === "string") value = parseShorthand(value);
    if (!value || typeof value !== "object" || Array.isArray(value)) return props;
    for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
        const key = styleKey(name);
        const toggle = SWITCHES[key];
        if (toggle && typeof raw === "boolean") {
            props[toggle[0]] = raw ? toggle[1] : toggle[2];
            continue;
        }
        const property = PROPERTIES[key];
        const css = property && cssValue(property, raw);
        if (property && css) props[property] = css;
    }
    return props;
}

/** Keys that name the group a group is based on (`based-on: 報告`). */
export const BASE_KEYS = new Set(["basedon", "base", "extends", "inherit", "inherits"]);
/** Properties written on the running text (`normal`) that belong on paragraphs, not on the whole group. */
export const PARAGRAPH_ONLY = ["margin-top", "margin-bottom", "margin-left", "margin-right", "text-indent", "text-align"];

type StyleBody = Pick<StyleGroup, "marks" | "custom" | "paragraph">;
const emptyBody = (): StyleBody => ({ marks: {}, custom: {}, paragraph: {} });

/** Is this a paragraph entry when written straight under a group (`h1`, `quote`)? */
export const isParagraphName = (name: string) => {
    const key = styleKey(name);
    return has(PARAGRAPHS, paragraphName(key)) && !has(MARKS, markName(key));
};

/** Keys that hold a custom text style's keyboard shortcut (`shortcut: Ctrl+Alt+1`). */
export const SHORTCUT_KEYS = new Set(["shortcut", "hotkey", "keys"]);

/** The shortcut written on a style, in one line (`… shortcut Ctrl+Alt+1`) or as a key. */
export function readShortcut(value: unknown): string | undefined {
    if (typeof value === "string") value = parseShorthand(value);
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const entry = Object.entries(value as Record<string, unknown>).find(([name]) => SHORTCUT_KEYS.has(styleKey(name)));
    const shortcut = normalizeShortcut(entry?.[1]);
    // Shortcuts the app or editor already uses are ignored, so Ctrl+B stays bold.
    return shortcut && !shortcutProblem(shortcut) ? shortcut : undefined;
}

function readGroupBody(body: unknown) {
    const own = emptyBody();
    let basedOn: string | undefined;
    const addText = (textName: string, value: unknown) => {
        const key = markName(styleKey(textName));
        const props = readProps(value);
        if (key === "normal") {
            // `normal` is the running text; its spacing, indents and alignment go to paragraphs.
            const paragraph: StyleProps = {};
            for (const property of PARAGRAPH_ONLY) {
                if (props[property]) {
                    paragraph[property] = props[property];
                    delete props[property];
                }
            }
            if (Object.keys(paragraph).length) own.paragraph.normal = { ...own.paragraph.normal, ...paragraph };
        }
        if (has(MARKS, key)) own.marks[key] = { ...own.marks[key], ...props };
        else {
            const shortcut = readShortcut(value) ?? own.custom[key]?.shortcut;
            own.custom[key] = { name: textName, props: { ...own.custom[key]?.props, ...props }, ...(shortcut ? { shortcut } : {}) };
        }
    };
    const addParagraph = (key: string, value: unknown) => { own.paragraph[key] = { ...own.paragraph[key], ...readProps(value) }; };
    const entries = body && typeof body === "object" && !Array.isArray(body) ? Object.entries(body as Record<string, unknown>) : [];
    for (const [key, value] of entries) {
        const normalized = styleKey(key);
        const children = value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value as Record<string, unknown>) : [];
        if (BASE_KEYS.has(normalized)) {
            if (typeof value === "string" && value.trim()) basedOn = value.trim();
        } else if (GROUP_TEXT.has(normalized)) {
            for (const [child, props] of children) addText(child, props);
        } else if (GROUP_PARAGRAPH.has(normalized)) {
            for (const [child, props] of children) {
                const paragraph = paragraphName(styleKey(child));
                if (has(PARAGRAPHS, paragraph)) addParagraph(paragraph, props);
            }
        } else if (isParagraphName(key)) addParagraph(paragraphName(normalized), value);
        else addText(key, value);
    }
    return { own, basedOn };
}

function mergeBody(base: StyleBody, own: StyleBody): StyleBody {
    const merged = emptyBody();
    for (const section of ["marks", "paragraph"] as const) {
        for (const key of new Set([...Object.keys(base[section]), ...Object.keys(own[section])])) {
            merged[section][key] = { ...base[section][key], ...own[section][key] };
        }
    }
    for (const key of new Set([...Object.keys(base.custom), ...Object.keys(own.custom)])) {
        const shortcut = own.custom[key]?.shortcut ?? base.custom[key]?.shortcut;
        merged.custom[key] = {
            name: own.custom[key]?.name ?? base.custom[key].name, props: { ...base.custom[key]?.props, ...own.custom[key]?.props },
            ...(shortcut ? { shortcut } : {}),
        };
    }
    return merged;
}

/** Reads the `Style:` key (any case) of the parsed front matter, resolving `based-on`. */
export function readStyles(frontMatter: unknown): DeskStyles {
    const styles: DeskStyles = new Map();
    const top = frontMatter && typeof frontMatter === "object" && !Array.isArray(frontMatter) ? Object.entries(frontMatter as Record<string, unknown>) : [];
    const rootValue = top.find(([key]) => ["style", "styles"].includes(styleKey(key)))?.[1];
    const root = rootValue && typeof rootValue === "object" && !Array.isArray(rootValue) ? Object.entries(rootValue as Record<string, unknown>) : [];
    // `Default Style: name` picks the group that applies to the whole document. Older documents
    // wrote the settings in a top-level `Default:` block (read as a group named Default), or named a
    // group Default／預設 under `Style:`.
    const defaultValue = top.find(([key]) => isGlobalKey(key))?.[1];
    const legacyBody = defaultValue && typeof defaultValue === "object" && !Array.isArray(defaultValue) ? defaultValue : undefined;
    const read = new Map<string, { name: string; own: StyleBody; basedOn?: string }>();
    if (legacyBody && !root.some(([name]) => styleKey(name) === GLOBAL_KEY)) read.set(GLOBAL_KEY, { name: GLOBAL_NAME, ...readGroupBody(legacyBody) });
    for (const [name, body] of root) read.set(styleKey(name), { name, ...readGroupBody(body) });
    const defaultName = typeof defaultValue === "string" && defaultValue.trim() ? defaultValue.trim()
        : legacyBody ? GLOBAL_NAME : root.find(([name]) => isDefaultGroup(name))?.[0];
    const defaultKey = defaultName ? styleKey(defaultName) : undefined;
    // based-on: Default／預設 also finds the default group under another name.
    const keyOf = (name: string) => read.has(styleKey(name)) || !isDefaultGroup(name) || !defaultKey ? styleKey(name) : defaultKey;
    const resolving = new Set<string>();
    const resolve = (key: string): StyleGroup | undefined => {
        const done = styles.get(key);
        if (done) return done;
        const entry = read.get(key);
        // A loop of based-on (A → B → A) stops where it closes.
        if (!entry || resolving.has(key)) return undefined;
        resolving.add(key);
        const base = entry.basedOn ? resolve(keyOf(entry.basedOn)) : undefined;
        resolving.delete(key);
        const group: StyleGroup = {
            name: entry.name, ...(base ? mergeBody(base, entry.own) : entry.own), own: entry.own, basedOn: entry.basedOn, inherited: base,
            ...(key === defaultKey ? { global: true } : {}),
        };
        styles.set(key, group);
        return group;
    };
    for (const key of read.keys()) resolve(key);
    // Keep the order the groups are written in.
    return new Map([...read.keys()].map((key) => [key, styles.get(key)!]));
}

const declarations = (props: StyleProps) => Object.entries(props).map(([property, value]) => `${property}: ${value};`).join(" ");

/** CSS for one `::push` scope. Scopes are emitted in source order, so an inner scope wins over an outer one. */
export function scopeCss(id: string, group: StyleGroup) {
    // The attribute is doubled to outrank the preview's own `.md …` rules.
    const scope = `[data-desk-scope="${id}"][data-desk-scope="${id}"]`;
    const rules: string[] = [];
    const rule = (selector: string, props: StyleProps | undefined) => {
        if (props && Object.keys(props).length) rules.push(`${selector} { ${declarations(props)} }`);
    };
    for (const [mark, props] of Object.entries(group.marks)) {
        rule(MARKS[mark] ? `${scope} ${MARKS[mark]}` : scope, props);
    }
    for (const [key, props] of Object.entries(group.paragraph)) {
        rule(PARAGRAPHS[key].split(", ").map((element) => `${scope} ${element}`).join(", "), props);
    }
    for (const [key, { props }] of Object.entries(group.custom)) rule(`${scope} [data-desk-text="${id}:${key}"]`, props);
    return rules.join("\n");
}

type Scope = { id: string; group?: StyleGroup };

/** Names of the group that applies to the whole document without `::push`. */
/** Names that find the default group: `based-on: Default` and `::push(Default)`; 預設 is the older Chinese name. */
export const DEFAULT_GROUP_NAMES = ["default", "預設", "global"];
/** The name new documents give their default group. */
export const GLOBAL_NAME = "Default";
const GLOBAL_KEY = styleKey(GLOBAL_NAME);
export const isDefaultGroup = (name: string) => DEFAULT_GROUP_NAMES.some((candidate) => styleKey(candidate) === styleKey(name));
/** The top-level key naming the default group (`Default Style: Style A`), and older spellings. */
export const DEFAULT_STYLE_KEY = "Default Style";
export const isGlobalKey = (key: string) => ["defaultstyle", "default", "global", "預設", "預設樣式", "defaultformat"].includes(styleKey(key));
/** The group `Default Style:` names: it applies to the whole document. */
export function defaultGroup(styles: DeskStyles) {
    for (const group of styles.values()) if (group.global) return group;
    return undefined;
}
/** A group by name; Default／預設／global also find the default group. */
export function findGroup(styles: DeskStyles, name: string) {
    return styles.get(styleKey(name)) ?? (isDefaultGroup(name) ? defaultGroup(styles) : undefined);
}

/** The group new documents start with. Plain numbers are points. */
export const DEFAULT_STYLE_GROUP = {
    normal: '11pt "Microsoft JhengHei" line-height 1.6 after 6pt',
    h1: "22pt", h2: "17pt", h3: "14pt",
};
export const DEFAULT_SLIDE_GROUP = {
    normal: '20pt "Microsoft JhengHei"',
    h1: "40pt", h2: "30pt",
};

/**
 * Turns the `::push`/`::pop` markers of `parseDesk` into nested `styleScope` layout nodes and
 * resolves `::style(…)` spans against the current group. Top-level scopes continue across pages.
 */
export function applyStyleScopes(sections: MdNode[][], styles: DeskStyles, prefix: string) {
    const css: string[] = [];
    let count = 0;
    const wrapper = (scope: Scope, start: number): MdNode =>
        ({ type: "layout", kind: "styleScope", value: scope.id, start, end: start, children: [] });

    function resolve(nodes: MdNode[] | undefined, scope: Scope | undefined): MdNode[] | undefined {
        return nodes?.map((node) => {
            if (node.type === "deskStyle") {
                const key = styleKey(node.name ?? "");
                const found = scope?.group && has(scope.group.custom, key);
                return { ...node, value: found ? `${scope!.id}:${key}` : undefined, children: resolve(node.children, scope) };
            }
            if (node.type === "layout" && node.kind !== "column" && node.kind !== "columns") {
                return { ...node, children: build(node.children ?? [], [], scope) };
            }
            return node.children ? { ...node, children: resolve(node.children, scope) } : node;
        });
    }

    /** `open` scopes stay open at the end; the caller passes them on to the next page. */
    function build(nodes: MdNode[], open: Scope[], outer?: Scope, fixed = 0): MdNode[] {
        const root: MdNode[] = [];
        const targets = [root];
        for (const scope of open) {
            const node = wrapper(scope, nodes[0]?.start ?? 0);
            targets[targets.length - 1].push(node);
            targets.push(node.children!);
        }
        for (const node of nodes) {
            if (node.type === "layout" && node.kind === "stylePush") {
                const group = findGroup(styles, node.name ?? "");
                const scope = { id: `${prefix}${count++}`, group };
                if (group) css.push(scopeCss(scope.id, group));
                open.push(scope);
                const child = wrapper(scope, node.start);
                targets[targets.length - 1].push(child);
                targets.push(child.children!);
            } else if (node.type === "layout" && node.kind === "stylePop" && open.length > fixed) {
                open.pop();
                targets.pop();
            } else if (node.type === "layout" && node.kind === "stylePop") {
                // An unmatched `::pop()` stays visible, like other unmatched markers.
                targets[targets.length - 1].push({ ...node, type: "paragraph", kind: undefined });
            } else {
                const scope = open[open.length - 1] ?? outer;
                const [resolved] = resolve([node], scope)!;
                targets[targets.length - 1].push(node.type === "layout" && (node.kind === "columns")
                    ? { ...node, children: node.children?.map((column) => ({ ...column, children: build(column.children ?? [], [], scope) })) }
                    : resolved);
            }
        }
        return root;
    }

    // The default group (`Default Style:`) applies to the whole document under every ::push.
    const base = defaultGroup(styles);
    const open: Scope[] = [];
    const baseCss = base ? scopeCss(`${prefix}d`, base) : "";
    if (base && (baseCss || Object.keys(base.custom).length)) {
        open.push({ id: `${prefix}d`, group: base });
        if (baseCss) css.push(baseCss);
    }
    // Only the default group is fixed; a ::push left open on one page is closed by a ::pop() on a later one.
    const fixed = open.length;
    const result = sections.map((children) => build(children, open, undefined, fixed));
    return { sections: result, css: css.join("\n") };
}

export interface StyleScan {
    /** Unknown groups, styles missing from the current group and unmatched `::pop()`, as body offsets. */
    problems: { from: number; to: number; message: string }[];
    /** The default group, in effect wherever no `::push` is. */
    base?: StyleGroup;
    /** Where each `::push` applies, in source order. */
    scopes: { from: number; to: number; group?: StyleGroup; name: string; push: { from: number; to: number }; pop?: { from: number; to: number } }[];
}

/** Walks a parsed Desk body the way `applyStyleScopes` does, for editor warnings and completions. */
export function scanStyles(nodes: MdNode[], styles: DeskStyles, end: number): StyleScan {
    const scan: StyleScan = { problems: [], scopes: [], base: defaultGroup(styles) };
    type Open = { group?: StyleGroup; scope: StyleScan["scopes"][number] };

    function inline(list: MdNode[] | undefined, group: StyleGroup | undefined) {
        for (const node of list ?? []) {
            if (node.type === "deskStyle") {
                const key = styleKey(node.name ?? "");
                if (!group) scan.problems.push({ from: node.start, to: node.end, message: `::style(${node.name}) 要寫在 ::push(…) 和 ::pop() 之間，或在 YAML 用 Default Style: 指定預設樣式組。` });
                else if (!has(group.custom, key)) scan.problems.push({ from: node.start, to: node.end, message: `樣式組「${group.name}」沒有「${node.name}」。` });
            }
            if (node.type === "layout" && node.kind !== "columns" && node.kind !== "column") blocks(node.children ?? [], group, node.end);
            else if (node.type === "layout" && node.kind === "columns") for (const column of node.children ?? []) blocks(column.children ?? [], group, column.end);
            else inline(node.children, group);
        }
    }

    function blocks(list: MdNode[], outer: StyleGroup | undefined, close: number) {
        const open: Open[] = [];
        for (const node of list) {
            if (node.type === "layout" && node.kind === "stylePush") {
                const group = findGroup(styles, node.name ?? "");
                if (!group) scan.problems.push({ from: node.start, to: node.end, message: `YAML 的 Style 沒有樣式組「${node.name}」。` });
                const scope: StyleScan["scopes"][number] = { from: node.end, to: close, group, name: node.name ?? "", push: { from: node.start, to: node.end } };
                scan.scopes.push(scope);
                open.push({ group, scope });
            } else if (node.type === "layout" && node.kind === "stylePop") {
                const last = open.pop();
                if (last) { last.scope.to = node.start; last.scope.pop = { from: node.start, to: node.end }; }
                else scan.problems.push({ from: node.start, to: node.end, message: "這個 ::pop() 沒有對應的 ::push(…)。" });
            } else {
                inline([node], open.length ? open[open.length - 1].group : outer);
            }
        }
    }

    blocks(nodes, scan.base, end);
    return scan;
}

/** The group in effect at `offset`: the innermost scope around it, else the default group. */
export function groupAt(scan: StyleScan, offset: number) {
    const scope = scopeAt(scan, offset);
    return scope ? scope.group : scan.base;
}

/** The innermost `::push` scope around `offset`. */
export function scopeAt(scan: StyleScan, offset: number) {
    let found: StyleScan["scopes"][number] | undefined;
    for (const scope of scan.scopes) if (scope.from <= offset && offset <= scope.to) found = scope;
    return found;
}

/** A colour as `#rrggbb` plus its opacity (0–1). Reads `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` and `transparent`. */
export function splitColor(value: string | undefined): { rgb: string; alpha: number } | null {
    const text = value?.trim().toLowerCase();
    if (!text) return null;
    if (text === "transparent") return { rgb: "#000000", alpha: 0 };
    const match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
    if (!match) return null;
    const digits = match[1].length <= 4 ? [...match[1]].map((digit) => digit + digit).join("") : match[1];
    return { rgb: "#" + digits.slice(0, 6), alpha: digits.length === 8 ? Math.round(parseInt(digits.slice(6), 16) / 255 * 100) / 100 : 1 };
}

/** Writes `#rrggbb`, or `#rrggbbaa` when not fully opaque. */
export function joinColor(rgb: string, alpha: number) {
    const opacity = Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 1));
    return opacity >= 1 ? rgb.toLowerCase() : rgb.toLowerCase() + Math.round(opacity * 255).toString(16).padStart(2, "0");
}
