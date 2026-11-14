import { useEffect, useState, type CSSProperties, type InputHTMLAttributes, type KeyboardEvent } from "react";
import { pageInk, readPage } from "../../desk/paper";
import {
    addCustomStyle, addDefaultStyles, addStyleGroup, setDefaultStyle, setStyleBase, clearStyleEntry, removeStyleGroup, renameCustomStyle, renameStyleGroup, setStyleField,
    type StyleEntry, type StyleField, type StyleSection,
} from "../../desk/styleEdit";
import { GLOBAL_NAME, has, joinColor, MARKS, PARAGRAPHS, shortcutFromEvent, splitColor, styleKey, type StyleGroup, type StyleProps } from "../../desk/styles";
import { Icon } from "../../icons/Icon";
import { ask } from "../Feedback";

export const MARK_LABELS: Record<string, string> = {
    normal: "正文", bold: "粗體", italic: "斜體", underline: "底線", strike: "刪除線", highlight: "螢光",
    code: "行內程式碼", link: "連結", superscript: "上標", subscript: "下標",
};
export const PARAGRAPH_LABELS: Record<string, string> = {
    normal: "段落", heading: "所有標題", heading1: "標題 1", heading2: "標題 2", heading3: "標題 3",
    heading4: "標題 4", heading5: "標題 5", heading6: "標題 6", quote: "引言", list: "清單項目", table: "表格",
};
export const FONTS = ["Microsoft JhengHei", "PMingLiU", "DFKai-SB", "Noto Sans TC", "Noto Serif TC", "Segoe UI", "Times New Roman", "Arial", "Consolas"];

export type Selected = { section: StyleSection; key: string; custom?: boolean };

/** Plain numbers in points: "10pt" → "10"; other units stay as written. */
const points = (value: string | undefined) => value?.replace(/^(-?\d+(?:\.\d+)?)pt$/, "$1") ?? "";
/** `#rrggbb` or, with transparency, `#rrggbbaa`; other colour words aren't editable here. */
const hex = (value: string | undefined) => {
    const color = splitColor(value);
    return color ? joinColor(color.rgb, color.alpha) : "";
};
/** Transparency in percent as Word shows it: 0 is opaque, 100 is invisible. */
export const transparency = (value: string) => {
    const color = splitColor(value);
    return color && color.alpha < 1 ? String(Math.round((1 - color.alpha) * 100)) : "";
};

export function fieldValues(props: StyleProps): Record<StyleField, string> {
    const weight = props["font-weight"];
    const style = props["font-style"];
    return {
        font: (props["font-family"] ?? "").replace(/"/g, ""),
        size: points(props["font-size"]),
        color: hex(props.color),
        background: hex(props["background-color"]),
        bold: weight === undefined ? "" : Number(weight) >= 600 || weight === "bold" ? "true" : "false",
        italic: style === undefined ? "" : style === "italic" || style === "oblique" ? "true" : "false",
        decoration: props["text-decoration"] ?? "",
        letterSpacing: points(props["letter-spacing"]),
        lineHeight: props["line-height"] ?? "",
        align: props["text-align"] ?? "",
        indent: points(props["text-indent"]),
        marginTop: points(props["margin-top"]),
        marginBottom: points(props["margin-bottom"]),
        marginLeft: points(props["margin-left"]),
        marginRight: points(props["margin-right"]),
        // Shortcuts belong to custom styles, not to the CSS properties.
        shortcut: "",
    };
}

/** The entry's own settings as an inline style for the sample. */
const sampleStyle = (props: StyleProps) => Object.fromEntries(Object.entries(props).map(([property, value]) =>
    [property.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase()), value])) as CSSProperties;

function uniqueName(base: string, taken: (name: string) => boolean) {
    for (let n = 1; ; n++) if (!taken(`${base} ${n}`)) return `${base} ${n}`;
}

/** Records a key combination: press it in the field; Backspace or Delete clears it. */
function ShortcutInput({ value, inherited, onCommit }: { value: string; inherited?: string; onCommit: (value: string | null) => void }) {
    const [hint, setHint] = useState("");
    return (
        <span className="desk-style-shortcut">
            <input value={value} readOnly placeholder={hint || inherited || "按下組合鍵"} aria-label="快捷鍵"
                title="在這裡按下組合鍵（需包含 Ctrl、Alt 或 Meta，例如 Ctrl+Alt+1）；Backspace 清除"
                onBlur={() => setHint("")}
                onKeyDown={(e) => {
                    if (e.key === "Tab" || (e.key === "Escape" && !value)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.key === "Escape") return;
                    if ((e.key === "Backspace" || e.key === "Delete") && !e.ctrlKey && !e.altKey && !e.metaKey) {
                        if (value) onCommit(null);
                        return;
                    }
                    const shortcut = shortcutFromEvent(e);
                    if (shortcut) { setHint(""); if (shortcut !== value) onCommit(shortcut); }
                    else if (!["Control", "Alt", "Shift", "Meta"].includes(e.key)) setHint("需包含 Ctrl、Alt 或 Meta");
                }} />
            {value && <button className="icon-btn" title="清除快捷鍵" aria-label="清除快捷鍵" onClick={() => onCommit(null)}><Icon name="close" size={13} /></button>}
        </span>
    );
}

/** A text field that keeps what is typed and commits on Enter or when it loses focus. */
export function DraftInput({ value, onCommit, ...props }: { value: string; onCommit: (value: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    const commit = () => { if (draft.trim() !== value) onCommit(draft.trim()); };
    return <input {...props} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            // Escape first undoes the typing; only an unchanged field lets it close a dialog.
            else if (e.key === "Escape" && draft !== value) { e.preventDefault(); setDraft(value); }
        }} />;
}

export default function StylePanel({ source, onSource, onApplyGroup, onApplyText, onError, initial }: {
    /** The whole Markdown source. */
    source: string;
    /** Runs an edit on the editor's current text and puts the result in the editor. */
    onSource: (edit: (source: string) => string) => void;
    onApplyGroup: (name: string) => void;
    onApplyText: (name: string, group: string) => void;
    onError: (message: string) => void;
    /** Group and entry to show first, e.g. the ones at the cursor. */
    initial?: { group?: string; entry?: Selected };
}) {
    const { styles = new Map<string, StyleGroup>(), invalidYaml, page, mode } = readPage(source);
    const groups = [...styles.values()];
    const [groupName, setGroupName] = useState<string | null>(initial?.group ?? null);
    const group = groups.find((item) => styleKey(item.name) === styleKey(groupName ?? "")) ?? groups[0];
    const [selected, setSelected] = useState<Selected>(initial?.entry ?? { section: "text", key: "normal" });
    const customs = group ? Object.entries(group.custom) : [];
    const current = selected.custom ? group?.custom[selected.key] : undefined;
    // The fields show what this group writes; what it gets from `based-on` shows as the placeholder.
    const propsIn = (body: Pick<StyleGroup, "marks" | "custom" | "paragraph"> | undefined): StyleProps => !body ? {}
        : selected.custom ? body.custom[selected.key]?.props ?? {}
        : selected.section === "text" ? body.marks[selected.key] ?? {} : body.paragraph[selected.key] ?? {};
    const props = propsIn(group?.own ?? group);
    const values = fieldValues(props);
    const inherited = fieldValues(propsIn(group?.inherited));
    const merged = propsIn(group);
    const keep = (field: StyleField, label?: string) => inherited[field] ? label ?? inherited[field] : "";
    const entry: StyleEntry | null = group ? { group: group.name, section: selected.section, name: current?.name ?? selected.key } : null;

    const run = (edit: (text: string) => string) => {
        try {
            onSource(edit);
        } catch (e) {
            onError(e instanceof Error ? e.message : String(e));
        }
    };
    const set = (field: StyleField, value: string | boolean | null) => {
        if (entry) run((text) => setStyleField(text, entry, field, value === "" ? null : value));
    };

    if (invalidYaml) return <div className="desk-style-panel desk-style-empty">請先在 Markdown 修正文件開頭的 YAML，再調整樣式。</div>;

    const addGroup = () => {
        const name = uniqueName("Style", (candidate) => styles.has(styleKey(candidate)));
        run((text) => addStyleGroup(text, name));
        setGroupName(name);
        setSelected({ section: "text", key: "normal" });
    };

    // Every document has its default format (`Default Style:`), so there is always a group to show.
    if (!group) {
        return (
            <div className="desk-style-panel desk-style-empty">
                <span>還沒有樣式組。第一個樣式組會成為文件的預設樣式（YAML 的 <code>Default Style:</code>），套用到整份文件。</span>
                <button className="primary-btn" onClick={() => {
                    run((text) => addDefaultStyles(text, mode === "slides"));
                    setGroupName(GLOBAL_NAME);
                }}><Icon name="plus" size={14} />建立預設樣式</button>
                <button className="secondary-btn" onClick={addGroup}>新增空白樣式組</button>
            </div>
        );
    }
    const isDefault = Boolean(group.global);

    const entryButton = (section: StyleSection, key: string, label: string, shortcut: string | undefined, isSet: boolean, custom = false) => (
        <button key={`${section}-${key}`} className="desk-style-entry" data-set={isSet || undefined} title={shortcut ? `快捷鍵 ${shortcut}` : undefined}
            aria-pressed={selected.section === section && selected.key === key && !!selected.custom === custom}
            onClick={() => setSelected({ section, key, custom })}>
            {label}
        </button>
    );
    const triState = (field: "bold" | "italic", on: string, off: string) => (
        <label>{field === "bold" ? "粗細" : "斜體"}
            <select value={values[field]} onChange={(e) => set(field, e.target.value === "" ? null : e.target.value === "true")}>
                <option value="">{keep(field, inherited[field] === "true" ? on : off) || "—"}</option><option value="true">{on}</option><option value="false">{off}</option>
            </select>
        </label>
    );
    const colour = (field: "color" | "background", label: string) => {
        const own = splitColor(values[field]);
        const base = splitColor(inherited[field]);
        const rgb = own?.rgb ?? base?.rgb ?? (field === "color" ? "#000000" : "#ffffff");
        return (
            <label className="desk-style-colour-field">{label}
                <span className="desk-style-colour">
                    <input type="color" value={rgb} aria-label={label}
                        onChange={(e) => set(field, joinColor(e.target.value, own?.alpha ?? base?.alpha ?? 1))} />
                    <span className="desk-style-unit" title="透明度：0 為不透明，100 為完全透明">
                        <DraftInput value={transparency(values[field])} placeholder={transparency(inherited[field]) || "0"} inputMode="numeric"
                            aria-label={`${label}透明度`}
                            onCommit={(value) => {
                                const percent = Number(value || 0);
                                if (!Number.isFinite(percent)) return;
                                set(field, joinColor(rgb, 1 - Math.max(0, Math.min(100, percent)) / 100));
                            }} />
                        <small>%</small>
                    </span>
                    {values[field] && <button className="icon-btn" title={`清除${label}`} aria-label={`清除${label}`} onClick={() => set(field, null)}><Icon name="close" size={13} /></button>}
                </span>
            </label>
        );
    };
    const number = (field: StyleField, label: string, unit: string, placeholder = keep(field)) => (
        <label>{label}
            <span className="desk-style-unit">
                <DraftInput value={values[field]} placeholder={placeholder} inputMode="decimal" aria-label={label}
                    onCommit={(value) => set(field, value)} />
                {unit && <small>{unit}</small>}
            </span>
        </label>
    );
    // Spacing, indents and alignment of the running text are set on 段落.
    const paragraphFields = selected.section === "paragraph";
    const entryLabel = selected.custom ? current?.name ?? "" : (selected.section === "text" ? MARK_LABELS : PARAGRAPH_LABELS)[selected.key];

    return (
        <div className="desk-style-panel" role="group" aria-label="樣式組">
            <div className="desk-style-groups">
                <span className="desk-format-label">樣式組</span>
                <div className="desk-style-chips" role="group" aria-label="選擇樣式組">
                    {groups.map((item) => (
                        <button key={item.name} className="desk-style-chip" aria-pressed={item === group}
                            title={item.global ? "文件預設樣式：套用到整份文件" : undefined}
                            onClick={() => { setGroupName(item.name); setSelected({ section: "text", key: "normal" }); }}>
                            {item.name}{item.global && <small>全文</small>}
                        </button>
                    ))}
                    <button className="icon-btn" title="新增樣式組" aria-label="新增樣式組" onClick={addGroup}><Icon name="plus" size={15} /></button>
                </div>
                <span className="desk-style-group-actions">
                    <DraftInput value={group.name} aria-label="樣式組名稱" title="樣式組名稱（Enter 確認，會一併更新 ::push）"
                        onCommit={(name) => {
                            if (!name) return;
                            run((text) => renameStyleGroup(text, group.name, name));
                            setGroupName(name);
                        }} />
                    <label className="desk-style-base" title="以另一個樣式組為基礎，這裡只寫要改的部分（based-on）">基於
                        <select value={groups.find((item) => group.basedOn && styleKey(item.name) === styleKey(group.basedOn))?.name ?? ""}
                            onChange={(e) => run((text) => setStyleBase(text, group.name, e.target.value || null))}>
                            <option value="">（無）</option>
                            {groups.filter((item) => item !== group).map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
                        </select>
                    </label>
                    {isDefault ? <small className="desk-style-note" title="YAML 的 Default Style: 指向這個樣式組">文件預設樣式・套用到整份文件</small> : <>
                    <button className="secondary-btn" title="用 ::push 和 ::pop 包住游標所在或選取的段落" onClick={() => onApplyGroup(group.name)}>
                        <Icon name="check" size={14} />套用到段落
                    </button>
                    <button className="secondary-btn" title="讓這個樣式組套用到整份文件（Default Style）" onClick={() => run((text) => setDefaultStyle(text, group.name))}>
                        設為預設
                    </button>
                    <button className="icon-btn desk-delete" title="刪除樣式組" aria-label="刪除樣式組" onClick={async () => {
                        if (!await ask({ title: `刪除樣式組「${group.name}」？`, message: "正文中的 ::push 會保留，並標示為找不到的樣式組。", confirm: "刪除", danger: true })) return;
                        run((text) => removeStyleGroup(text, group.name));
                        setGroupName(null);
                    }}><Icon name="trash" size={15} /></button>
                    </>}
                </span>
            </div>
            <div className="desk-style-body">
                <div className="desk-style-list" role="group" aria-label="文字">
                    <span className="desk-format-label">自訂文字樣式</span>
                    {customs.map(([key, { name, shortcut }]) => entryButton("text", key, name, shortcut, Object.keys((group.own ?? group).custom[key]?.props ?? {}).length > 0, true))}
                    <button className="small-btn" title="新增 ::style(名稱){…} 用的文字樣式" onClick={() => {
                        const name = uniqueName("Custom", (candidate) => has(group.custom, styleKey(candidate)));
                        run((text) => addCustomStyle(text, group.name, name));
                        setSelected({ section: "text", key: styleKey(name), custom: true });
                    }}><Icon name="plus" size={13} />新增</button>
                    <span className="desk-format-label">內建文字</span>
                    {Object.keys(MARKS).map((key) => entryButton("text", key, MARK_LABELS[key], undefined, Object.keys((group.own ?? group).marks[key] ?? {}).length > 0))}
                </div>
                <div className="desk-style-list" role="group" aria-label="段落">
                    <span className="desk-format-label">段落</span>
                    {Object.keys(PARAGRAPHS).map((key) => entryButton("paragraph", key, PARAGRAPH_LABELS[key], undefined, Object.keys((group.own ?? group).paragraph[key] ?? {}).length > 0))}
                </div>
                <div className="desk-style-editor" role="group" aria-label={`${entryLabel}的設定`}>
                    <div className="desk-style-editor-head">
                        {selected.custom && current ? (
                            <DraftInput className="desk-style-name" value={current.name} aria-label="樣式名稱" title="樣式名稱（Enter 確認，會一併更新 ::style）"
                                onCommit={(name) => {
                                    if (!name) return;
                                    run((text) => renameCustomStyle(text, group.name, current.name, name));
                                    setSelected({ section: "text", key: styleKey(name), custom: true });
                                }} />
                        ) : <strong>{entryLabel}</strong>}
                        <span className="desk-style-sample" style={{ background: page.color, color: pageInk(page.color), ...sampleStyle(merged) }}>範例 Sample 123</span>
                        {selected.custom && current && (
                            <button className="secondary-btn" title={`用 ::style 包住選取的文字${current.shortcut ? `（${current.shortcut}）` : ""}`} onClick={() => onApplyText(current.name, group.name)}>
                                <Icon name="check" size={14} />套用到文字
                            </button>
                        )}
                        <button className="small-btn" disabled={!Object.keys(props).length && !selected.custom}
                            title={selected.custom ? "刪除這個自訂樣式" : "清除這個項目的所有設定"}
                            onClick={() => {
                                if (!entry) return;
                                run((text) => clearStyleEntry(text, entry));
                                if (selected.custom) setSelected({ section: "text", key: "normal" });
                            }}>{selected.custom ? "刪除樣式" : "清除設定"}</button>
                    </div>
                    <div className="desk-style-fields">
                        {selected.custom && current && (
                            <label>快捷鍵
                                <ShortcutInput value={(group.own ?? group).custom[selected.key]?.shortcut ?? ""} inherited={group.inherited?.custom[selected.key]?.shortcut} onCommit={(value) => set("shortcut", value)} />
                            </label>
                        )}
                        <label>字型
                            <DraftInput value={values.font} placeholder={keep("font")} list="desk-style-fonts" aria-label="字型" onCommit={(value) => set("font", value)} />
                        </label>
                        {number("size", "字級", "pt")}
                        {colour("color", "文字色")}
                        {colour("background", "底色")}
                        {triState("bold", "粗體", "一般")}
                        {triState("italic", "斜體", "正體")}
                        <label>裝飾
                            <select value={values.decoration} onChange={(e) => set("decoration", e.target.value)}>
                                <option value="">{keep("decoration") || "—"}</option>
                                <option value="none">無</option>
                                <option value="underline">底線</option>
                                <option value="line-through">刪除線</option>
                                <option value="underline line-through">底線＋刪除線</option>
                                {values.decoration && !["none", "underline", "line-through", "underline line-through"].includes(values.decoration) &&
                                    <option value={values.decoration}>{values.decoration}</option>}
                            </select>
                        </label>
                        {number("letterSpacing", "字距", "pt")}
                        {number("lineHeight", "行高", "倍")}
                        {paragraphFields && <>
                            <label>對齊
                                <select value={values.align} onChange={(e) => set("align", e.target.value)}>
                                    <option value="">{keep("align") || "—"}</option>
                                    <option value="left">靠左</option>
                                    <option value="center">置中</option>
                                    <option value="right">靠右</option>
                                    <option value="justify">左右對齊</option>
                                </select>
                            </label>
                            {number("marginLeft", "左縮排", "pt")}
                            {number("marginRight", "右縮排", "pt")}
                            {number("indent", "首行縮排", "pt")}
                            {number("marginTop", "段前", "pt")}
                            {number("marginBottom", "段後", "pt")}
                        </>}
                    </div>
                </div>
            </div>
            <datalist id="desk-style-fonts">{FONTS.map((font) => <option key={font} value={font} />)}</datalist>
        </div>
    );
}
