import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { undo, redo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { Icon } from "../../icons/Icon";
import { annotationApi, parseLocation, placeLabel } from "../../annotator/api";
import { drawerApi, errorMessage } from "../../drawer/api";
import { citeApi } from "../../markdown/citeStore";
import type { EditorView } from "@codemirror/view";
import { alignRange, deskFormatAt, formatDeskSource, setDeskHeading } from "../../desk/sourceTools";
import { columnWidths, parseDesk } from "../../desk/markdown";
import { readPage } from "../../desk/paper";
import { defaultGroup, groupAt, scanStyles, scopeAt, styleForShortcut, styleKey } from "../../desk/styles";
import { setScopeAt } from "../../desk/styleEdit";
import { DESK_IMAGE_ACCEPT, DESK_IMAGE_LIMIT, embedDeskImage, isDeskImage } from "../../desk/images";
import { Toast, useToast } from "../Feedback";
import DeskCodeEditor from "./DeskCodeEditor";
import StylePanel, { type Selected } from "./StylePanel";
import StyleToolbar from "./StyleToolbar";

const layouts: Record<string, (selection: string) => string> = {
    "雙欄": (s) => `::Col(){${s || "左欄內容"}},{右欄內容}`,
    "寬窄雙欄": (s) => `::Col(2:1){${s || "主欄內容"}},{側欄內容}`,
    "靠左": (s) => `::left{${s || "靠左內容"}}`,
    "置中": (s) => `::center{${s || "置中內容"}}`,
    "靠右": (s) => `::right{${s || "靠右內容"}}`,
    "左右對齊": (s) => `::justify{${s || "左右對齊內容"}}`,
    "框線區塊": (s) => `::box{${s || "框內內容"}}`,
    "目錄": (s) => ["::toc", s].filter(Boolean).join("\n\n"),
    "分頁線": (s) => ["::page", s].filter(Boolean).join("\n\n"),
    "參考文獻": (s) => ["::refs", s].filter(Boolean).join("\n\n"),
};

const ALIGN_ICONS = { left: "alignLeft", center: "alignCenter", right: "alignRight", justify: "alignJustify" } as const;

type Source = "drawer" | "annotator" | "images";
type Result = { id: string; title: string; detail: string; key?: string; annotationId?: number;
    image?: { id: number; name: string; size: number } };

export default function DeskSource({ markdown, slides, bodyStart = 0, onChange, ribbon, ribbonHost }: {
    markdown: string;
    slides: boolean;
    bodyStart?: number;
    onChange: (markdown: string) => void;
    ribbon: string;
    ribbonHost: HTMLDivElement | null;
}) {
    const editor = useRef<EditorView>(null);
    const imagePicker = useRef<HTMLInputElement>(null);
    const [columnRatio, setColumnRatio] = useState<string | null>(null);
    const [source, setSource] = useState<Source | null>(null);
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<Result[]>([]);
    const [loading, setLoading] = useState(false);
    const [inserting, setInserting] = useState(false);
    const [error, setError] = useState("");
    const [cursorFormat, setCursorFormat] = useState(() => deskFormatAt("", 0));
    const decorations = [cursorFormat.marks.underline ? "underline" : "", cursorFormat.marks.strike ? "line-through" : ""];
    const vertical = cursorFormat.marks.superscript ? "super" : cursorFormat.marks.subscript ? "sub" : "baseline";
    const { toast, showError, showInfo, close: closeToast } = useToast();

    useEffect(() => {
        if (!source) return;
        let active = true;
        setLoading(true);
        setResults([]);
        setError("");
        const timer = setTimeout(async () => {
            try {
                const found: Result[] = source === "drawer"
                    ? (await citeApi.search(query, 30)).filter((item) => !item.kind).map((item) => ({
                        id: item.key, key: item.key, title: item.title,
                        detail: [item.authors, item.date, `@${item.key}`].filter(Boolean).join(" · "),
                    }))
                    : source === "images"
                    ? (await drawerApi.listItems({ library: "files", query })).flatMap((item) =>
                        item.imageId !== null && item.fileName && isDeskImage(item.fileName) ? [{
                            id: String(item.imageId), title: item.title || item.fileName, detail: item.fileName,
                            image: { id: item.imageId, name: item.fileName, size: item.fileSize },
                        }] : []).slice(0, 30)
                    : (await annotationApi.search(query)).slice(0, 30).map((item) => ({
                        id: String(item.id), annotationId: item.id, title: item.itemTitle || item.fileName,
                        detail: [placeLabel(parseLocation(item)), item.quote || item.note || "書籤"].filter(Boolean).join(" · "),
                    }));
                if (active) setResults(found);
            } catch (e) {
                if (active) setError(errorMessage(e));
            } finally {
                if (active) setLoading(false);
            }
        }, 180);
        return () => { active = false; clearTimeout(timer); };
    }, [source, query]);

    /**
     * Replaces the selection (or, with `wholeParagraph`, the paragraph around it) by `make(selection)`.
     * The cursor ends after the inserted text, or `caretBack` characters before its end, e.g. inside
     * a block that was just wrapped, so the next command acts on that block.
     */
    function insert(make: (selection: string) => string, block: boolean, wholeParagraph = false, caretBack?: number) {
        const view = editor.current;
        if (!view) return;
        const value = view.state.doc.toString();
        const limit = markdown.slice(0, bodyStart).replace(/\r\n?/g, "\n").length;
        const selection = view.state.selection.main;
        let start = Math.max(limit, selection.from);
        let end = Math.max(start, selection.to);
        if (wholeParagraph) {
            const before = /\n[ \t]*\n(?![\s\S]*\n[ \t]*\n)/.exec(value.slice(limit, start));
            const after = /\n[ \t]*\n/.exec(value.slice(end));
            start = before ? limit + before.index + before[0].length : limit;
            end = after ? end + after.index : value.length;
        }
        const before = value.slice(0, start);
        const after = value.slice(end);
        // A block needs a blank line on each side; don't add one where there already is one.
        const prefix = !block || !before || /\n[ \t]*\n$/.test(before) ? "" : before.endsWith("\n") ? "\n" : "\n\n";
        const suffix = !block || !after || /^[ \t]*\n[ \t]*\n/.test(after) ? "" : after.startsWith("\n") ? "\n" : "\n\n";
        const made = make(value.slice(start, end));
        const text = prefix + made + suffix;
        const anchor = caretBack === undefined ? start + text.length : start + prefix.length + made.length - caretBack;
        view.dispatch({ changes: { from: start, to: end, insert: text }, selection: { anchor }, scrollIntoView: true });
        view.focus();
    }

    async function insertImage(load: () => Promise<File>, fromDrawer = false) {
        setError("");
        setInserting(true);
        try {
            const image = await embedDeskImage(await load());
            insert((selection) => [selection, image].filter(Boolean).join("\n\n"), true);
            if (fromDrawer) setSource(null);
        } catch (error) {
            if (fromDrawer) setError(errorMessage(error));
            else showError(errorMessage(error));
        } finally {
            setInserting(false);
        }
    }

    /** Puts `action(text)` in the editor as one minimal change, so undo and the cursor behave. Returns false when nothing changed. */
    function replaceSource(action: (source: string) => string) {
        const view = editor.current;
        if (!view) return false;
        const source = view.state.doc.toString();
        const next = action(source);
        if (next === source) return false;
        let from = 0;
        while (from < source.length && from < next.length && source[from] === next[from]) from++;
        let end = 0;
        while (end < source.length - from && end < next.length - from && source[source.length - 1 - end] === next[next.length - 1 - end]) end++;
        view.dispatch({ changes: { from, to: source.length - end, insert: next.slice(from, next.length - end) } });
        return true;
    }

    function transform(action: (source: string) => string, message: string, focus = true) {
        const view = editor.current;
        if (!view) return;
        try {
            const changed = replaceSource(action);
            showInfo(changed ? message : "原始碼無需變更。");
            if (focus) view.focus();
        } catch (e) {
            showError(errorMessage(e));
        }
    }

    // The format toolbar follows the cursor. Only the home ribbon shows it, and a burst of typing needs one update.
    const formatTimer = useRef<number | undefined>(undefined);
    const showsFormat = ribbon === "home";
    const [cursorScope, setCursorScope] = useState<string | null>(null);
    function syncFormat() {
        clearTimeout(formatTimer.current);
        if (!showsFormat) return;
        formatTimer.current = window.setTimeout(() => {
            const view = editor.current;
            if (!view) return;
            const source = view.state.doc.toString();
            const position = view.state.selection.main.from;
            setCursorFormat(deskFormatAt(source, position));
            const { body, styles = new Map() } = readPage(source);
            const scope = scopeAt(scanStyles(parseDesk(body).children, styles, body.length), position - (source.length - body.length));
            setCursorScope(scope ? scope.name : null);
        }, 80);
    }
    const [styleDialog, setStyleDialog] = useState<{ group?: string; entry?: Selected } | null>(null);

    /** Wraps the paragraph at the cursor (or the selected ones) in a style group. */
    function applyGroup(name: string) {
        insert((selection) => `::push(${name})\n${selection || "段落內容"}\n::pop()`, true, true, "\n::pop()".length);
    }

    function setScope(group: string | null) {
        const view = editor.current;
        if (!view) return;
        try {
            if (cursorScope !== null) replaceSource((text) => setScopeAt(text, view.state.selection.main.from, group));
            else if (group) applyGroup(group);
            view.focus();
        } catch (e) {
            showError(errorMessage(e));
        }
    }

    function applyText(name: string, group: string) {
        const view = editor.current;
        if (!view) return;
        if (view.state.selection.main.empty) { showInfo("請先選取要套用樣式的文字。"); return; }
        // `::style` only looks in the current group, so check the selection is inside it.
        const source = view.state.doc.toString();
        const { body, styles = new Map() } = readPage(source);
        const offset = source.length - body.length;
        const here = groupAt(scanStyles(parseDesk(body).children, styles, body.length), view.state.selection.main.from - offset);
        if (styleKey(here?.name ?? "") !== styleKey(group)) {
            showInfo(`選取的文字不在「${group}」的範圍內。請先用「套用到段落」把段落放進這個樣式組。`);
            return;
        }
        insert((selection) => `::style(${name}){${selection}}`, false);
    }
    /** Applies the custom text style of the group at the cursor that `shortcut` names. */
    function applyShortcut(shortcut: string) {
        const view = editor.current;
        if (!view) return false;
        const source = view.state.doc.toString();
        const { body, styles = new Map() } = readPage(source);
        const offset = source.length - body.length;
        const selection = view.state.selection.main;
        if (selection.from < offset) return false;
        const group = groupAt(scanStyles(parseDesk(body).children, styles, body.length), selection.from - offset);
        const style = styleForShortcut(group, shortcut);
        if (!style) {
            // Only say something when another group uses it; otherwise the key keeps its usual meaning.
            const elsewhere = [...styles.values()].find((other) => styleForShortcut(other, shortcut));
            if (!elsewhere) return false;
            showInfo(group ? `${shortcut} 是樣式組「${elsewhere.name}」的文字樣式，游標所在的「${group.name}」沒有。`
                : `${shortcut} 是樣式組「${elsewhere.name}」的文字樣式，請先把段落放進這個樣式組。`);
            return true;
        }
        // Without a selection, the cursor ends inside the empty braces, ready to type in the style.
        if (selection.empty) insert(() => `::style(${style.name}){}`, false, false, 1);
        else insert((text) => `::style(${style.name}){${text}}`, false);
        return true;
    }

    useEffect(() => {
        syncFormat();
        return () => clearTimeout(formatTimer.current);
    }, [showsFormat]);

    function textRange(view: EditorView) {
        const selection = view.state.selection.main;
        const limit = markdown.slice(0, bodyStart).replace(/\r\n?/g, "\n").length;
        if (selection.from < limit) return null;
        return selection.empty ? deskFormatAt(view.state.doc.toString(), selection.from).range : selection;
    }

    /** Opens 更多樣式 on the paragraph entry at the cursor (段落 or 標題 n) of the group in effect there. */
    function openParagraphStyles() {
        const view = editor.current;
        const source = view?.state.doc.toString() ?? markdown;
        const { styles = new Map() } = readPage(source);
        const group = cursorScope ?? defaultGroup(styles)?.name;
        const key = cursorFormat.heading ? `heading${cursorFormat.heading}` : "normal";
        setStyleDialog(group ? { group, entry: { section: "paragraph", key } } : {});
    }

    function applyAlignment(name: string) {
        const view = editor.current;
        if (!view) return;
        const selection = view.state.selection.main;
        if (!selection.empty) {
            // A selection: align just that text.
            const result = alignRange(view.state.doc.toString(), selection.from, selection.to, name);
            if (result && replaceSource(() => result.text)) view.dispatch({ selection: { anchor: result.caret }, scrollIntoView: true });
            view.focus();
            return;
        }
        const { alignment } = deskFormatAt(view.state.doc.toString(), selection.from);
        if (alignment) {
            if (alignment.name !== name) view.dispatch({ changes: { from: alignment.from, to: alignment.to, insert: name } });
            view.focus();
            return;
        }
        insert((selection) => `::${name}{${selection || "段落內容"}}`, true, true, 1);
    }

    function toggleMark(type: string, marker: string) {
        const view = editor.current;
        const range = view && textRange(view);
        if (!view || !range) { showInfo("請選取正文，或將游標放在文字上。"); return; }
        const mark = deskFormatAt(view.state.doc.toString(), range.from).marks[type];
        if (mark && range.to <= mark.to && view.state.sliceDoc(mark.from, mark.from + marker.length) === marker
            && view.state.sliceDoc(mark.to - marker.length, mark.to) === marker) {
            const text = view.state.sliceDoc(mark.from + marker.length, mark.to - marker.length);
            view.dispatch({ changes: { ...mark, insert: text }, selection: { anchor: mark.from, head: mark.from + text.length } });
        } else {
            const text = view.state.sliceDoc(range.from, range.to);
            if (!text.trim() || (["underline", "superscript", "subscript"].includes(type) && text.includes("\n"))) return;
            view.dispatch({ changes: { ...range, insert: marker + text + marker },
                selection: { anchor: range.from + marker.length, head: range.to + marker.length } });
        }
        view.focus();
    }

    function setHeading(level: number) {
        const selection = editor.current?.state.selection.main;
        if (selection) transform((source) => setDeskHeading(source, selection.from, selection.to, level), "已更新段落格式。");
    }

    function runEditorCommand(command: (view: EditorView) => boolean) {
        const view = editor.current;
        if (view) { view.focus(); command(view); }
    }

    function toggle(next: Source) {
        setSource(source === next ? null : next);
        setQuery("");
    }

    async function cite(result: Result, embed: boolean) {
        setInserting(true);
        setError("");
        try {
            const key = result.key ?? await citeApi.annotationKey(result.annotationId!);
            if (!key) throw new Error("找不到這筆標註的引用鍵。");
            insert((selection) => embed ? [selection, `![[@${key}]]`].filter(Boolean).join("\n\n") : selection + `[@${key}]`, embed);
            setSource(null);
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setInserting(false);
        }
    }

    return (
        <div className="desk-source">
            {styleDialog && createPortal(
                <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setStyleDialog(null); }}>
                    <div className="modal desk-style-dialog" role="dialog" aria-modal="true" aria-labelledby="desk-style-dialog-title"
                        onKeyDown={(e) => { if (e.key === "Escape" && !e.defaultPrevented) { e.stopPropagation(); setStyleDialog(null); } }}>
                        <div className="modal-header">
                            <h2 id="desk-style-dialog-title">樣式</h2>
                            <button className="icon-btn" autoFocus aria-label="關閉" title="關閉（Esc）" onClick={() => setStyleDialog(null)}><Icon name="close" size={16} /></button>
                        </div>
                        <StylePanel source={markdown} initial={styleDialog}
                            onSource={(edit) => { replaceSource(edit); }}
                            onApplyGroup={applyGroup} onApplyText={applyText} onError={showError} />
                    </div>
                </div>, document.body)}
            {ribbonHost && createPortal(<div className="desk-ribbon-group">
                <input ref={imagePicker} type="file" accept={DESK_IMAGE_ACCEPT} hidden onChange={(e) => {
                    const file = e.currentTarget.files?.[0];
                    e.currentTarget.value = "";
                    if (file) void insertImage(async () => file);
                }} />
                {ribbon === "insert" && <>
                    <button className="secondary-btn" disabled={inserting} onClick={() => imagePicker.current?.click()}><Icon name="image" size={16} />本機圖片</button>
                    <button className="secondary-btn" disabled={inserting} onClick={() => toggle("images")}><Icon name="drawer" size={16} />Drawer 圖片</button>
                    <button className="secondary-btn" disabled={inserting} onClick={() => toggle("drawer")}><Icon name="library" size={16} />引用文獻</button>
                    <button className="secondary-btn" disabled={inserting} onClick={() => toggle("annotator")}><Icon name="annotator" size={16} />插入標註</button>
                </>}
                {ribbon === "layout" && <select aria-label="插入排版區塊" value="" onChange={(e) => {
                    if (e.target.value === "自訂多欄") {
                        setColumnRatio("2:1");
                        return;
                    }
                    const layout = layouts[e.target.value];
                    if (layout) insert(layout, true);
                }}>
                    <option value="" disabled>插入排版</option>
                    {Object.keys(layouts).map((name) => <option key={name}>{name}</option>)}
                    <option>自訂多欄</option>
                </select>}
                {ribbon === "home" && <div className="desk-classic-toolbar">
                    <div className="desk-classic-row" role="group" aria-label="編輯命令">
                        <button className="icon-btn" title="復原（Ctrl+Z）" aria-label="復原" onClick={() => runEditorCommand(undo)}><Icon name="undo" size={16} /></button>
                        <button className="icon-btn" title="重做（Ctrl+Y）" aria-label="重做" onClick={() => runEditorCommand(redo)}><Icon name="redo" size={16} /></button>
                        <button className="icon-btn" title="搜尋（Ctrl+F）" aria-label="搜尋" onClick={() => runEditorCommand(openSearchPanel)}><Icon name="search" size={16} /></button>
                        <button className="icon-btn" title="原始碼排版（Alt+Shift+F）" aria-label="原始碼排版" onClick={() => transform(formatDeskSource, "已排版。")}><Icon name="layout" size={16} /></button>
                    </div>
                    {!slides && <div className="desk-classic-row" aria-label="格式工具列">
                        <div className="desk-format-group" role="group" aria-label="文字格式">
                            <span className="desk-format-label">文字格式</span>
                            <div className="desk-format-controls">
                                <div className="desk-format-buttons">
                                    <button className="secondary-btn" title="粗體（Ctrl+B）" aria-label="粗體" aria-pressed={cursorFormat.bold}
                                        onClick={() => toggleMark("strong", "**")}><strong>B</strong></button>
                                    <button className="secondary-btn" title="斜體（Ctrl+I）" aria-label="斜體" aria-pressed={cursorFormat.italic}
                                        onClick={() => toggleMark("emphasis", "*")}><em>I</em></button>
                                    <button className="secondary-btn" title="底線" aria-label="底線" aria-pressed={decorations.includes("underline")}
                                        onClick={() => toggleMark("underline", "++")}><u>U</u></button>
                                    <button className="secondary-btn" title="刪除線" aria-label="刪除線" aria-pressed={decorations.includes("line-through")}
                                        onClick={() => toggleMark("strike", "~~")}><s>S</s></button>
                                    {(["super", "sub"] as const).map((name) => <button key={name} className="secondary-btn"
                                        title={name === "super" ? "上標" : "下標"} aria-label={name === "super" ? "上標" : "下標"}
                                        aria-pressed={vertical === name} onClick={() => toggleMark(name === "super" ? "superscript" : "subscript", name === "super" ? "^" : "~")}>
                                        {name === "super" ? "x²" : "x₂"}
                                    </button>)}
                                    <button className="secondary-btn" title="高亮" aria-label="高亮" aria-pressed={!!cursorFormat.marks.highlight}
                                        onClick={() => toggleMark("highlight", "==")}><Icon name="highlight" size={16} /></button>
                                </div>
                            </div>
                        </div>
                        <div className="desk-format-group" role="group" aria-label="段落格式">
                            <span className="desk-format-label">段落格式</span>
                            <div className="desk-format-controls">
                                <select aria-label="Markdown 段落格式" value={cursorFormat.heading} onChange={(e) => setHeading(Number(e.target.value))}>
                                    <option value={0}>正文</option>
                                    {[1, 2, 3, 4, 5, 6].map((level) => <option key={level} value={level}>標題 {level}</option>)}
                                </select>
                                {([["left", "靠左"], ["center", "置中"], ["right", "靠右"], ["justify", "左右對齊"]] as const).map(([align, label]) =>
                                    <button key={align} className="secondary-btn desk-align-button" title={label} aria-label={label} aria-pressed={(cursorFormat.alignment?.name ?? "left") === align}
                                        onClick={() => applyAlignment(align)}><Icon name={ALIGN_ICONS[align]} size={16} /></button>)}
                                <button className="icon-btn" title="段落的縮排、間距、行高（更多樣式）" aria-label="段落的更多樣式"
                                    onClick={openParagraphStyles}><Icon name="settings" size={16} /></button>
                            </div>
                        </div>
                    </div>}
                    <StyleToolbar source={markdown} format={cursorFormat} scopeName={cursorScope}
                        onSource={(edit) => { replaceSource(edit); }} onSetScope={setScope}
                        onOpen={(initial) => setStyleDialog(initial ?? {})} onError={showError} />
                </div>}
            </div>, ribbonHost)}
            {columnRatio !== null && <form className="desk-source-tools" onSubmit={(e) => {
                e.preventDefault();
                const widths = columnWidths(columnRatio);
                if (!widths) return;
                insert((selection) => {
                    const columns = widths.map((_, i) => `{${(i === 0 && selection) || `第 ${i + 1} 欄內容`}}`);
                    return `::Col(${columnRatio.replace(/\s/g, "")})${columns.join(",")}`;
                }, true);
                setColumnRatio(null);
            }}>
                <label>欄寬比例 <input autoFocus value={columnRatio} placeholder="例如 2:1:1" onChange={(e) => setColumnRatio(e.target.value)} /></label>
                <button className="primary-btn" disabled={columnWidths(columnRatio) === null}>插入分欄</button>
                <button className="secondary-btn" type="button" onClick={() => setColumnRatio(null)}>取消</button>
            </form>}
            {source && (
                <section className="desk-source-picker" aria-label={source === "images" ? "搜尋 Drawer 檔案庫圖片" : source === "drawer" ? "搜尋 Drawer" : "搜尋 Annotator"}>
                    <div className="desk-picker-header">
                        <strong>{source === "images" ? "Drawer 圖片" : source === "drawer" ? "Drawer 文獻" : "Annotator 標註"}</strong>
                        <button className="secondary-btn" disabled={inserting} onClick={() => setSource(null)}>關閉</button>
                    </div>
                    <input type="search" aria-label="搜尋來源" disabled={inserting} placeholder={source === "images" ? "搜尋圖片標題或檔名" : source === "drawer" ? "搜尋標題、作者或引用鍵" : "搜尋引文、筆記或檔名"} value={query} onChange={(e) => setQuery(e.target.value)} />
                    {error && <p role="alert">{error}</p>}
                    {loading ? <p role="status">搜尋中…</p> : !error && !results.length && <p>找不到符合的資料。</p>}
                    <ul>
                        {results.map((result) => (
                            <li key={result.id}>
                                <span><strong>{result.title || "未命名"}</strong><small>{result.detail}</small></span>
                                {source === "drawer" && <button className="secondary-btn" disabled={inserting} onClick={() => void cite(result, false)}>引用</button>}
                                {result.image ? <button className="secondary-btn" disabled={inserting} onClick={() => void insertImage(async () => {
                                    const { id, name, size } = result.image!;
                                    if (size > DESK_IMAGE_LIMIT) throw new Error("圖片必須小於或等於 10 MB。");
                                    return new File([await drawerApi.readAttachment(id)], name);
                                }, true)}>嵌入圖片</button> : (
                                    <button className="secondary-btn" disabled={inserting} onClick={() => void cite(result, true)}>{source === "drawer" ? "插入來源卡" : "插入標註"}</button>
                                )}
                            </li>
                        ))}
                    </ul>
                </section>
            )}
            {slides && <p className="muted">用空行隔開獨立一行的 --- 來切換投影片。</p>}
            <DeskCodeEditor value={markdown} onChange={onChange} editor={editor} onShortcut={applyShortcut}
                onFormat={() => transform(formatDeskSource, "已排版。")} onCursor={syncFormat}
                onMark={slides ? undefined : (mark) => mark === "bold" ? toggleMark("strong", "**") : toggleMark("emphasis", "*")} />
            <Toast toast={toast} onClose={closeToast} />
        </div>
    );
}
