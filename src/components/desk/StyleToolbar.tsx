import type { deskFormatAt } from "../../desk/sourceTools";
import { setStyleField, type StyleField } from "../../desk/styleEdit";
import { pageInk, readPage } from "../../desk/paper";
import { defaultGroup, findGroup, has, joinColor, splitColor, styleKey, type StyleGroup } from "../../desk/styles";
import { Icon } from "../../icons/Icon";
import { DraftInput, fieldValues, FONTS, MARK_LABELS, PARAGRAPH_LABELS, type Selected } from "./StylePanel";

export type CursorFormat = ReturnType<typeof deskFormatAt>;

const MANAGE = "\u0000manage";
const MARK_ORDER: [string, string][] = [
    ["highlight", "highlight"], ["strong", "bold"], ["emphasis", "italic"], ["underline", "underline"],
    ["strike", "strike"], ["superscript", "superscript"], ["subscript", "subscript"],
];

/** The entry the quick controls edit: the innermost style, mark or heading around the cursor. */
export function entryAt(format: CursorFormat, group: StyleGroup | undefined): Selected {
    if (format.style && group && has(group.custom, styleKey(format.style))) return { section: "text", key: styleKey(format.style), custom: true };
    for (const [mark, key] of MARK_ORDER) if (format.marks[mark]) return { section: "text", key };
    if (format.heading) return { section: "paragraph", key: `heading${format.heading}` };
    return { section: "text", key: "normal" };
}

export const entryLabel = (entry: Selected, group: StyleGroup | undefined) =>
    entry.custom ? group?.custom[entry.key]?.name ?? entry.key
        : (entry.section === "text" ? MARK_LABELS : PARAGRAPH_LABELS)[entry.key] ?? entry.key;

/**
 * The 樣式 group of the home ribbon: which style group the cursor is in, and the basic values of
 * what the cursor is on (正文, 粗體, 標題 2, a custom style…). Everything else opens the style dialog.
 */
export default function StyleToolbar({ source, format, scopeName, onSource, onSetScope, onOpen, onError }: {
    source: string;
    format: CursorFormat;
    /** The `::push(name)` around the cursor, as written; null outside any group. */
    scopeName: string | null;
    onSource: (edit: (source: string) => string) => void;
    /** Switches the group around the cursor (or wraps the paragraph in one); null removes it. */
    onSetScope: (group: string | null) => void;
    onOpen: (initial?: { group?: string; entry?: Selected }) => void;
    onError: (message: string) => void;
}) {
    const { styles = new Map<string, StyleGroup>(), invalidYaml, page } = readPage(source);
    const base = defaultGroup(styles);
    // The default group is the "no ::push" choice; the list offers the others.
    const groups = [...styles.values()].filter((item) => item !== base);
    const group = scopeName === null ? base : findGroup(styles, scopeName);
    const entry = entryAt(format, group);
    const propsIn = (body: Pick<StyleGroup, "marks" | "custom" | "paragraph"> | undefined) => !body ? {}
        : entry.custom ? body.custom[entry.key]?.props ?? {}
        : entry.section === "text" ? body.marks[entry.key] ?? {} : body.paragraph[entry.key] ?? {};
    // Own values in the fields; what `based-on` gives shows as the placeholder.
    const values = fieldValues(propsIn(group?.own ?? group));
    const inherited = fieldValues(propsIn(group?.inherited));
    const label = entryLabel(entry, group);
    const disabled = !group || invalidYaml;
    const hint = invalidYaml ? "請先修正文件開頭的 YAML。" : group ? `調整「${group.name}」的${label}` : "游標不在樣式組內。";

    const set = (field: StyleField, value: string | null) => {
        if (!group) return;
        try {
            onSource((text) => setStyleField(text, { group: group.name, section: entry.section, name: entry.custom ? label : entry.key }, field, value || null));
        } catch (e) {
            onError(e instanceof Error ? e.message : String(e));
        }
    };
    const size = Number(values.size);
    const step = (delta: number) => set("size", String(Math.max(1, Math.round(((Number.isFinite(size) && values.size ? size : Number(inherited.size) || 11) + delta) * 10) / 10)));

    return (
        <div className="desk-format-group desk-style-quick" role="group" aria-label="樣式">
            <span className="desk-format-label">樣式</span>
            <div className="desk-format-controls">
                <select aria-label="游標所在的樣式組" title="游標所在段落使用的樣式組" disabled={invalidYaml}
                    value={scopeName === null ? "" : group?.name ?? scopeName}
                    onChange={(e) => {
                        const value = e.target.value;
                        if (value === MANAGE) onOpen(group ? { group: group.name, entry } : undefined);
                        else onSetScope(value || null);
                    }}>
                    <option value="">{base ? `${base.name}（全文）` : "無樣式組"}</option>
                    {groups.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
                    {scopeName !== null && !group && <option value={scopeName}>{scopeName}（找不到）</option>}
                    <option value={MANAGE}>新增或管理樣式組…</option>
                </select>
                <span className="desk-style-target" title={hint} aria-live="polite">{group ? label : "—"}</span>
                <DraftInput className="desk-style-quick-font" value={values.font} placeholder={inherited.font || "字型"} list="desk-style-quick-fonts"
                    aria-label={`${label}的字型`} title={hint} disabled={disabled} onCommit={(value) => set("font", value)} />
                <div className="desk-style-quick-size" role="group" aria-label="字級">
                    <button className="icon-btn" title="縮小字級" aria-label="縮小字級" disabled={disabled} onClick={() => step(-1)}><Icon name="minus" size={14} /></button>
                    <DraftInput value={values.size} placeholder={inherited.size || "pt"} inputMode="decimal" aria-label={`${label}的字級（pt）`} title={hint}
                        disabled={disabled} onCommit={(value) => set("size", value)} />
                    <button className="icon-btn" title="放大字級" aria-label="放大字級" disabled={disabled} onClick={() => step(1)}><Icon name="plus" size={14} /></button>
                </div>
                <input type="color" className="desk-style-quick-color" aria-label={`${label}的文字色`} title={hint} disabled={disabled}
                    value={(splitColor(values.color) ?? splitColor(inherited.color))?.rgb ?? pageInk(page.color)}
                    // Keep the transparency set in the style dialog.
                    onChange={(e) => set("color", joinColor(e.target.value, (splitColor(values.color) ?? splitColor(inherited.color))?.alpha ?? 1))} />
                <button className="icon-btn" title="更多樣式設定…" aria-label="更多樣式設定" onClick={() => onOpen(group ? { group: group.name, entry } : undefined)}>
                    <Icon name="settings" size={16} />
                </button>
            </div>
            <datalist id="desk-style-quick-fonts">{FONTS.map((font) => <option key={font} value={font} />)}</datalist>
        </div>
    );
}
