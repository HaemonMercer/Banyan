import { Document, isMap, isScalar, type Pair, type YAMLMap } from "yaml";
import type { MdNode } from "../markdown/ast.ts";
import { parseDesk } from "./markdown.ts";
import { readPage, readYaml, unquoteYaml } from "./paper.ts";
import {
    BASE_KEYS, DEFAULT_SLIDE_GROUP, DEFAULT_STYLE_GROUP, GROUP_PARAGRAPH, GROUP_TEXT, MARKS, PARAGRAPH_ONLY, PROPERTIES, SWITCHES, DEFAULT_STYLE_KEY, GLOBAL_NAME, isDefaultGroup, isGlobalKey,
    groupAt, has, isParagraphName, markName, normalizeShortcut, SHORTCUT_KEYS, findGroup, shortcutProblem, paragraphName, parseShorthand, readStyles, scanStyles, scopeAt, styleKey, writeShorthand,
} from "./styles.ts";

/**
 * Edits the `Style:` groups in the front matter for the visual style panel. Every function takes
 * the whole Markdown source and returns the new source; the YAML keeps the user's own key
 * spellings, comments and order wherever it is not changed.
 */
export type StyleSection = "text" | "paragraph";
export interface StyleEntry { group: string; section: StyleSection; name: string }

/** The fields the panel edits, with the short YAML key it writes and the CSS property it replaces. */
export const STYLE_FIELDS = {
    font: { key: "font", property: "font-family" },
    size: { key: "size", property: "font-size" },
    color: { key: "color", property: "color" },
    background: { key: "background", property: "background-color" },
    bold: { key: "bold", property: "font-weight" },
    italic: { key: "italic", property: "font-style" },
    decoration: { key: "decoration", property: "text-decoration" },
    letterSpacing: { key: "letter-spacing", property: "letter-spacing" },
    lineHeight: { key: "line-height", property: "line-height" },
    align: { key: "align", property: "text-align" },
    indent: { key: "indent", property: "text-indent" },
    marginTop: { key: "margin-top", property: "margin-top" },
    marginBottom: { key: "margin-bottom", property: "margin-bottom" },
    marginLeft: { key: "margin-left", property: "margin-left" },
    marginRight: { key: "margin-right", property: "margin-right" },
    /** Only on custom text styles: the keys that apply the style to the selection. */
    shortcut: { key: "shortcut", property: "shortcut" },
} as const;
export type StyleField = keyof typeof STYLE_FIELDS;

const keyName = (pair: Pair) => isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
const findPair = (map: YAMLMap, name: string) => (map.items as Pair[]).find((pair) => styleKey(keyName(pair)) === styleKey(name));

function ensureMap(doc: Document, parent: YAMLMap, name: string): YAMLMap {
    const pair = findPair(parent, name);
    if (pair && isMap(pair.value)) return pair.value;
    const created = doc.createNode({}) as YAMLMap;
    if (pair) pair.value = created;
    else parent.add(doc.createPair(name, created));
    return created;
}

function removePair(map: YAMLMap, pair: Pair | undefined) {
    if (pair) map.items.splice(map.items.indexOf(pair), 1);
}

/** Runs `change` on the front matter's `Style:` map, creating the front matter and the map if needed. */
/** Looks up a group's map by name; Default／預設／global also find the default group. */
type GroupMap = (name: string) => YAMLMap;
/** Reads or sets which group `Default Style:` names. */
interface DefaultRef { get(): string | undefined; set(name: string): void }

function editStyles(source: string, change: (styles: YAMLMap, doc: Document, group: GroupMap, defaults: DefaultRef) => void): string {
    const front = readYaml(source);
    if (front?.yaml.errors.length) throw new Error("請先修正文件開頭的 YAML。");
    const doc: Document = front?.yaml ?? new Document({});
    if (!isMap(doc.contents)) doc.contents = doc.createNode({}) as YAMLMap;
    const root = doc.contents as YAMLMap;
    const existing = (root.items as Pair[]).find((pair) => ["style", "styles"].includes(styleKey(keyName(pair))));
    const styles = ensureMap(doc, root, existing ? keyName(existing) : "Style");
    const stylePair = (root.items as Pair[]).find((pair) => pair.value === styles)!;
    let defaultPair = (root.items as Pair[]).find((pair) => isGlobalKey(keyName(pair)));
    const placeDefault = (name: string) => {
        if (defaultPair) removePair(root, defaultPair);
        defaultPair = doc.createPair(DEFAULT_STYLE_KEY, name) as Pair;
        root.items.splice(root.items.indexOf(stylePair), 0, defaultPair);
    };
    // Older documents: a top-level `Default:` block becomes a group under Style; a group named Default／預設 becomes the default.
    if (defaultPair && isMap(defaultPair.value)) {
        let name = GLOBAL_NAME;
        for (let n = 2; findPair(styles, name); n++) name = `${GLOBAL_NAME} ${n}`;
        styles.items.unshift(doc.createPair(name, defaultPair.value) as Pair);
        placeDefault(name);
    } else if (!defaultPair) {
        const old = (styles.items as Pair[]).find((pair) => isDefaultGroup(keyName(pair)));
        if (old) placeDefault(keyName(old));
    }
    const defaults: DefaultRef = {
        get: () => defaultPair && isScalar(defaultPair.value) && typeof defaultPair.value.value === "string" ? defaultPair.value.value : undefined,
        set: (name) => placeDefault(name),
    };
    const group: GroupMap = (name) => {
        const current = defaults.get();
        const pair = findPair(styles, name) ?? (isDefaultGroup(name) && current ? findPair(styles, current) : undefined);
        if (!pair) throw new Error(`找不到樣式組「${name}」。`);
        if (!isMap(pair.value)) pair.value = doc.createNode({});
        return pair.value as YAMLMap;
    };
    change(styles, doc, group, defaults);
    // A new group starts as `{}`; once it has entries, write it one per line.
    for (const pair of styles.items as Pair[]) if (isMap(pair.value) && pair.value.items.length) pair.value.flow = false;
    // Don't leave behind an empty `Style: {}` that this edit created.
    if (!existing && !styles.items.length) removePair(root, stylePair);
    const body = front ? source.slice(front.prefix.length) : source;
    return `---\n${unquoteYaml(doc.toString())}---\n\n${body.replace(/^(?:\r?\n)+/, "")}`;
}

function groupPair(styles: YAMLMap, group: string) {
    const pair = findPair(styles, group);
    if (!pair) throw new Error(`找不到樣式組「${group}」。`);
    return pair;
}

/** Where an entry is written: straight under the group (`h1: 22pt`) or in a `text:`／`paragraph:` section. */
function entryPair(group: YAMLMap, entry: StyleEntry) {
    const wanted = entry.section === "text" ? markName(styleKey(entry.name)) : paragraphName(styleKey(entry.name));
    const matches = (pair: Pair) => {
        const key = styleKey(keyName(pair));
        return entry.section === "text" ? markName(key) === wanted : paragraphName(key) === wanted;
    };
    const wrappers = entry.section === "text" ? GROUP_TEXT : GROUP_PARAGRAPH;
    for (const pair of group.items as Pair[]) {
        const key = styleKey(keyName(pair));
        if (wrappers.has(key) && isMap(pair.value)) {
            const found = (pair.value.items as Pair[]).find(matches);
            if (found) return { parent: pair.value, pair: found };
        }
    }
    const direct = (group.items as Pair[]).find((pair) => {
        const key = styleKey(keyName(pair));
        if (GROUP_TEXT.has(key) || GROUP_PARAGRAPH.has(key) || BASE_KEYS.has(key)) return false;
        // Paragraph spacing of the running text is written on `normal` itself.
        if (entry.section === "paragraph" && wanted === "normal") return markName(key) === "normal";
        return (entry.section === "paragraph") === isParagraphName(key) && matches(pair);
    });
    return direct ? { parent: group, pair: direct } : null;
}

/** The name a new entry gets: short paragraph names (`h1`), the custom style's own name. */
function newEntryName(entry: StyleEntry) {
    if (entry.section === "text") return entry.name;
    const key = paragraphName(styleKey(entry.name));
    return /^heading[1-6]$/.test(key) ? `h${key.slice(-1)}` : key;
}

const fieldValue = (field: StyleField, value: string | boolean | null): unknown => {
    if (value === null || value === "") return null;
    if (typeof value === "boolean") return value;
    if (["size", "letterSpacing", "lineHeight", "indent", "marginLeft", "marginRight", "marginTop", "marginBottom"].includes(field) && /^-?\d+(?:\.\d+)?$/.test(value.trim())) {
        return Number(value);
    }
    return value;
};

const propertyOf = (name: string) => {
    const key = styleKey(name);
    return SHORTCUT_KEYS.has(key) ? "shortcut" : PROPERTIES[key] ?? SWITCHES[key]?.[0];
};

/** An entry's settings as ordered [key, value] pairs, from a map or a one-line shorthand. */
function entryItems(value: unknown): [string, unknown][] {
    if (isMap(value)) return (value.items as Pair[]).map((pair) => [keyName(pair), isScalar(pair.value) ? pair.value.value : pair.value]);
    if (isScalar(value) && typeof value.value === "string") return Object.entries(parseShorthand(value.value));
    return [];
}

/** Writes settings back on `pair`: as a one-line shorthand when it was one (or is new), else as a map. */
function writeEntry(doc: Document, parent: YAMLMap, pair: Pair, items: [string, unknown][], short: boolean) {
    if (!items.length) {
        removePair(parent, pair);
        return;
    }
    const line = short ? writeShorthand(Object.fromEntries(items)) : null;
    pair.value = line !== null ? doc.createNode(line) : doc.createNode(Object.fromEntries(items));
}

const isShort = (value: unknown) => value === null || value === undefined || (isScalar(value) && (value.value === null || typeof value.value === "string"))
    || (isMap(value) && !value.items.length);

/** Sets one field of an entry, replacing any other spelling of the same property; `null` removes it. */
export function setStyleField(source: string, entry: StyleEntry, field: StyleField, value: string | boolean | null) {
    if (field === "shortcut" && typeof value === "string" && value.trim()) value = checkShortcut(source, entry, value);
    return editStyles(source, (_styles, doc, groupMap) => {
        const group = groupMap(entry.group);
        let found = entryPair(group, entry);
        if (!found) {
            const created = doc.createPair(newEntryName(entry), null) as Pair;
            group.add(created);
            found = { parent: group, pair: created };
        }
        const { pair, parent } = found;
        const { key, property } = STYLE_FIELDS[field];
        const next = fieldValue(field, value);
        const short = isShort(pair.value);
        if (!short && isMap(pair.value)) {
            // A long-form map: keep the user's key and its place when the value fits it (`font-size: 10`
            // stays `font-size`), but `weight: 700` can't hold `bold: true`.
            const map = pair.value;
            const same = (map.items as Pair[]).filter((item) => propertyOf(keyName(item)) === property);
            const switchField = Boolean(SWITCHES[styleKey(key)]);
            const keep = next === null ? undefined : same.find((item) => {
                const name = styleKey(keyName(item));
                return name === styleKey(key) || (!switchField && !SWITCHES[name]);
            });
            for (const item of same) if (item !== keep) removePair(map, item);
            if (keep) keep.value = doc.createNode(next);
            else if (next !== null) map.add(doc.createPair(key, next));
            if (!map.items.length) removePair(parent, pair);
            return;
        }
        const items = entryItems(pair.value).filter(([name]) => propertyOf(name) !== property);
        if (next !== null) items.push([key, next]);
        writeEntry(doc, parent, pair, items, true);
    });
}

/** The shortcut as the panel writes it; throws when it isn't one, is taken by the app, or by another style of the group. */
function checkShortcut(source: string, entry: StyleEntry, value: string) {
    const shortcut = normalizeShortcut(value);
    if (!shortcut) throw new Error(`「${value}」不是可用的快捷鍵。請包含 Ctrl、Alt 或 Meta，例如 Ctrl+Alt+1。`);
    const problem = shortcutProblem(shortcut);
    if (problem) throw new Error(problem);
    const styles = readPage(source).styles;
    const group = styles && findGroup(styles, entry.group);
    const other = Object.entries(group?.custom ?? {}).find(([key, style]) => style.shortcut === shortcut && key !== styleKey(entry.name));
    if (other) throw new Error(`樣式組「${group!.name}」的「${other[1].name}」已經使用 ${shortcut}。`);
    return shortcut;
}

/** Removes an entry's settings, so it inherits again. On `normal`, text and paragraph settings are cleared separately. */
export function clearStyleEntry(source: string, entry: StyleEntry) {
    return editStyles(source, (_styles, doc, groupMap) => {
        const group = groupMap(entry.group);
        const found = entryPair(group, entry);
        if (!found) return;
        const { pair, parent } = found;
        if (markName(styleKey(keyName(pair))) !== "normal" || parent !== group) {
            removePair(parent, pair);
            return;
        }
        const keepParagraph = entry.section === "text";
        const items = entryItems(pair.value).filter(([name]) => PARAGRAPH_ONLY.includes(propertyOf(name) ?? "") === keepParagraph);
        writeEntry(doc, parent, pair, items, isShort(pair.value));
    });
}

/** Adds an empty group; the first group of a document becomes its default. */
export function addStyleGroup(source: string, name: string) {
    return editStyles(source, (styles, doc, _group, defaults) => {
        if (findPair(styles, name)) throw new Error(`已經有樣式組「${name}」。`);
        styles.add(doc.createPair(name, doc.createNode({})));
        if (!defaults.get()) defaults.set(name);
    });
}

/** Removes a group; the document's default group can't be removed while it is the default. */
export function removeStyleGroup(source: string, name: string) {
    return editStyles(source, (styles, _doc, _group, defaults) => {
        const pair = groupPair(styles, name);
        const current = defaults.get();
        if (current && styleKey(current) === styleKey(keyName(pair))) {
            throw new Error(`「${keyName(pair)}」是文件的預設樣式，請先把其他樣式組設為預設再刪除。`);
        }
        removePair(styles, pair);
    });
}

/** Makes a group the document's default (`Default Style: name`). */
export function setDefaultStyle(source: string, name: string) {
    return editStyles(source, (styles, _doc, _group, defaults) => defaults.set(keyName(groupPair(styles, name))));
}

/** Sets (or with null removes) the group a group is based on. */
export function setStyleBase(source: string, group: string, base: string | null) {
    if (base && styleKey(base) === styleKey(group)) throw new Error("樣式組不能以自己為基礎。");
    return editStyles(source, (styles, doc, groupMap) => {
        const map = groupMap(group);
        if (base && !findPair(styles, base) && !isDefaultGroup(base)) throw new Error(`找不到樣式組「${base}」。`);
        const existing = (map.items as Pair[]).filter((pair) => BASE_KEYS.has(styleKey(keyName(pair))));
        if (base && existing[0]) existing[0].value = doc.createNode(base);
        for (const pair of base ? existing.slice(1) : existing) removePair(map, pair);
        if (base && !existing[0]) map.items.unshift(doc.createPair("based-on", base));
    });
}

export function addCustomStyle(source: string, group: string, name: string) {
    if (has(MARKS, markName(styleKey(name)))) throw new Error(`「${name}」是內建標記，請換一個名稱。`);
    if (isParagraphName(name) || BASE_KEYS.has(styleKey(name)) || GROUP_TEXT.has(styleKey(name)) || GROUP_PARAGRAPH.has(styleKey(name))) {
        throw new Error(`「${name}」是段落或設定的名稱，請換一個名稱。`);
    }
    return editStyles(source, (_styles, doc, groupMap) => {
        const map = groupMap(group);
        if (entryPair(map, { group, section: "text", name })) throw new Error(`樣式組「${group}」已經有「${name}」。`);
        map.add(doc.createPair(name, doc.createNode({})));
    });
}

/** Replaces each `[from, to)` range of `text` (relative to `offset`) with `insert`. */
function replaceRanges(text: string, ranges: { from: number; to: number }[], insert: string) {
    return [...ranges].sort((a, b) => b.from - a.from).reduce((result, { from, to }) => result.slice(0, from) + insert + result.slice(to), text);
}

function walk(nodes: MdNode[] | undefined, visit: (node: MdNode) => void) {
    for (const node of nodes ?? []) {
        visit(node);
        walk(node.children, visit);
    }
}

/** Renames a group and the `::push(…)` lines that use it. */
export function renameStyleGroup(source: string, from: string, to: string) {
    if (!to.trim()) throw new Error("名稱不能空白。");
    if (styleKey(from) === styleKey(to) && from === to) return source;
    const renamed = editStyles(source, (styles, _doc, _group, defaults) => {
        const clash = findPair(styles, to);
        const pair = groupPair(styles, from);
        if (clash && clash !== pair) throw new Error(`已經有樣式組「${to}」。`);
        // Keep `Default Style:` pointing at the renamed group.
        const current = defaults.get();
        const wasDefault = current !== undefined && styleKey(current) === styleKey(keyName(pair));
        if (isScalar(pair.key)) pair.key.value = to;
        else pair.key = to;
        if (wasDefault) defaults.set(to);
    });
    const front = readYaml(renamed)!;
    const body = renamed.slice(front.prefix.length);
    const ranges: { from: number; to: number }[] = [];
    walk(parseDesk(body).children, (node) => {
        if (node.type === "layout" && node.kind === "stylePush" && styleKey(node.name ?? "") === styleKey(from)) {
            const at = body.indexOf("(", node.start) + 1;
            ranges.push({ from: at, to: body.indexOf(")", at) });
        }
    });
    return front.prefix + replaceRanges(body, ranges, to);
}

/** Renames a custom text style and the `::style(…)` uses that resolve to it in that group. */
export function renameCustomStyle(source: string, group: string, from: string, to: string) {
    if (!to.trim()) throw new Error("名稱不能空白。");
    if (has(MARKS, markName(styleKey(to)))) throw new Error(`「${to}」是內建標記，請換一個名稱。`);
    const before = readYaml(source);
    const beforeBody = before ? source.slice(before.prefix.length) : source;
    const styles = readStyles(before?.yaml.toJS({ maxAliasCount: 0 }));
    const scan = scanStyles(parseDesk(beforeBody).children, styles, beforeBody.length);
    const uses: number[] = [];
    walk(parseDesk(beforeBody).children, (node) => {
        if (node.type === "deskStyle" && styleKey(node.name ?? "") === styleKey(from) && styleKey(groupAt(scan, node.start)?.name ?? "") === styleKey(group)) {
            uses.push(node.start);
        }
    });
    const renamed = editStyles(source, (_styles, _doc, groupMap) => {
        const target = groupMap(group);
        const found = entryPair(target, { group, section: "text", name: from });
        if (!found) throw new Error(`樣式組「${group}」沒有「${from}」。`);
        const clash = entryPair(target, { group, section: "text", name: to });
        if (clash && clash.pair !== found.pair) throw new Error(`樣式組「${group}」已經有「${to}」。`);
        if (isScalar(found.pair.key)) found.pair.key.value = to;
        else found.pair.key = to;
    });
    const front = readYaml(renamed)!;
    // The front matter may have changed length; `::style` offsets are relative to the unchanged body.
    const body = renamed.slice(front.prefix.length);
    const shift = body.length - beforeBody.length;
    const ranges = uses.map((start) => {
        const at = start + shift + "::style(".length;
        return { from: at, to: body.indexOf(")", at) };
    });
    return front.prefix + replaceRanges(body, ranges, to);
}

/** Removes the line holding `[from, to)` together with its line break. */
function removeLine(text: string, from: number, to: number) {
    const start = text.lastIndexOf("\n", from - 1) + 1;
    const next = text.indexOf("\n", to);
    // The last line has no break of its own: take the one before it instead.
    if (next < 0) return start > 0 ? text.slice(0, start - 1) : "";
    return text.slice(0, start) + text.slice(next + 1);
}

/**
 * Changes the innermost `::push` around `position` (a source offset) to another group, or with
 * `null` removes that `::push` and its `::pop()` so the text no longer uses a group.
 */
export function setScopeAt(source: string, position: number, group: string | null) {
    const { body, styles = new Map() } = readPage(source);
    const offset = source.length - body.length;
    const scope = scopeAt(scanStyles(parseDesk(body).children, styles, body.length), position - offset);
    if (!scope) throw new Error("游標不在任何樣式組內。");
    if (group === null) {
        const withoutPop = scope.pop ? removeLine(body, scope.pop.from, scope.pop.to) : body;
        return source.slice(0, offset) + removeLine(withoutPop, scope.push.from, scope.push.to);
    }
    const open = body.indexOf("(", scope.push.from) + 1;
    const close = body.lastIndexOf(")", scope.push.to);
    return source.slice(0, offset) + body.slice(0, open) + group + body.slice(close);
}

/** Adds a group named Default with common settings and makes it the default; slides get larger sizes. */
export function addDefaultStyles(source: string, slides = false) {
    return editStyles(source, (styles, doc, _group, defaults) => {
        if (defaults.get()) throw new Error("文件已經有預設樣式。");
        let name = GLOBAL_NAME;
        for (let n = 2; findPair(styles, name); n++) name = `${GLOBAL_NAME} ${n}`;
        styles.items.unshift(doc.createPair(name, doc.createNode(slides ? DEFAULT_SLIDE_GROUP : DEFAULT_STYLE_GROUP)) as Pair);
        defaults.set(name);
    });
}
