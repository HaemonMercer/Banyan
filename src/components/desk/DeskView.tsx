import { useCallback, useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { deskApi, type DeskDocument, type DeskKind } from "../../desk/api";
import { parseDesk, splitSlides } from "../../desk/markdown";
import { ALIGNMENTS, DEFAULT_PAGE, MARGIN_PRESETS, MAX_COLUMNS, PAGE_NUMBER, PAPERS, RUNNING_LINE_HEIGHT, SIDES, pageInk, pageInsets, paperSize, readPage, runningLineOffset, runningLines, writePage, type DeskMode, type PageSettings, type Paper } from "../../desk/paper";
import { columnAt, pickBreaks, pickColumnBreak, splitPages, type PlacedBlock } from "../../desk/pages";
import PageSettingsDialog from "./PageSettingsDialog";
import { printDocument } from "../../desk/print";
import { applyStyleScopes, type DeskStyles } from "../../desk/styles";
import { addDefaultStyles } from "../../desk/styleEdit";
import { wordDocument } from "../../desk/word";
import { errorMessage } from "../../drawer/api";
import { Icon } from "../../icons/Icon";
import type { IconName } from "../../icons/icons";
import Markdown from "../../markdown/Markdown";
import { invalidateCites } from "../../markdown/citeStore";
import { ask } from "../Feedback";
import DeskSource from "./DeskSource";
import "./Desk.css";

const KINDS: Record<DeskKind, { label: string; icon: IconName; template: string }> = {
    document: { label: "文件", icon: "file", template: addDefaultStyles(writePage(DEFAULT_PAGE, "", "", "writer")) },
    slides: { label: "簡報", icon: "slides", template: addDefaultStyles("---\nmode: slides\n---\n\n# 簡報標題\n\n---\n\n## 第二張投影片\n", true) },
};

type Mode = "source" | "preview";
const RIBBON_TABS = { file: "檔案", home: "常用", insert: "插入", layout: "版面配置", view: "檢視" } as const;
type RibbonTab = keyof typeof RIBBON_TABS;
type SaveState = "saving" | "saved" | "failed";
const SAVE_LABELS: Record<SaveState, string> = { saving: "儲存中…", saved: "已儲存", failed: "儲存失敗" };
const SAVE_DELAY = 600;

/** "剛剛", "5 分鐘前", "昨天 14:05" or a date, for the file list. */
function editedAt(time: number) {
    const minutes = Math.floor((Date.now() - time) / 60000);
    if (minutes < 1) return "剛剛";
    if (minutes < 60) return `${minutes} 分鐘前`;
    const date = new Date(time);
    const clock = date.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
    const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(time).setHours(0, 0, 0, 0)) / 86400000);
    if (days === 0) return clock;
    if (days === 1) return `昨天 ${clock}`;
    return date.toLocaleDateString("zh-TW", { year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric", month: "numeric", day: "numeric" });
}

export default function DeskView({ beforeLeave }: { beforeLeave: RefObject<(() => Promise<boolean>) | null> }) {
    const [documents, setDocuments] = useState<DeskDocument[]>([]);
    const [selected, setSelected] = useState<string | null>(null);
    const [filter, setFilter] = useState("");
    const [mode, setMode] = useState<Mode>("source");
    const [pagePanel, setPagePanel] = useState(false);
    const [ribbon, setRibbon] = useState<RibbonTab>("home");
    const [ribbonHost, setRibbonHost] = useState<HTMLDivElement | null>(null);
    const [libraryVisible, setLibraryVisible] = useState(true);
    const [previewZoom, setPreviewZoom] = useState<number | "fit">("fit");
    const scrollPreview = useRef<HTMLDivElement | null>(null);
    const [previewWidth, setPreviewWidth] = useState(0);
    const preview = useRef<HTMLDivElement>(null);
    const observePreview = useRef<ResizeObserver | null>(null);
    const previewPane = useCallback((element: HTMLDivElement | null) => {
        observePreview.current?.disconnect();
        scrollPreview.current = element;
        if (!element) return;
        const observer = new ResizeObserver(([entry]) => setPreviewWidth(entry.contentRect.width));
        observer.observe(element);
        observePreview.current = observer;
    }, []);
    const [loading, setLoading] = useState(true);
    const [loaded, setLoaded] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
    const drafts = useRef(new Map<string, DeskDocument>());
    const saving = useRef(new Map<string, Promise<void>>());
    // Typing schedules a save instead of sending the whole document (embedded images included) per keystroke.
    const timers = useRef(new Map<string, number>());
    const kinds = useRef(new Map<string, { markdown: string; mode?: DeskMode }>());

    function flush() {
        for (const timer of timers.current.values()) clearTimeout(timer);
        const ids = [...timers.current.keys()];
        timers.current.clear();
        return Promise.all([...ids.map((id) => save(id)), ...saving.current.values()]);
    }
    const flushRef = useRef(flush);
    flushRef.current = flush;

    const load = () => {
        setLoading(true);
        setError("");
        return deskApi.list().then((items) => {
            setDocuments(items);
            setSelected(items[0]?.id ?? null);
            setLoaded(true);
        }, (e) => setError(errorMessage(e))).finally(() => setLoading(false));
    };
    useEffect(() => {
        invalidateCites();
        void load();
    }, []);
    useEffect(() => {
        beforeLeave.current = async () => {
            await flushRef.current();
            if (!drafts.current.size) return true;
            return ask({
                title: "離開 Desk？",
                message: "有檔案儲存失敗。離開會捨棄尚未儲存的修改。",
                confirm: "捨棄修改",
                danger: true,
            });
        };
        return () => { beforeLeave.current = null; };
    }, [beforeLeave]);
    useEffect(() => {
        // Save pending edits before the window closes. Never block closing for long.
        let unlisten: (() => void) | undefined;
        let disposed = false;
        const flushSoon = () => Promise.race([flushRef.current(), new Promise((done) => setTimeout(done, 2000))]).then(() => {}, () => {});
        try {
            void getCurrentWindow().onCloseRequested(() => flushSoon()).then((stop) => {
                if (disposed) stop(); else unlisten = stop;
            }, () => {});
        } catch {
            /* not running inside Tauri */
        }
        const hidden = () => { if (document.visibilityState === "hidden") void flushRef.current(); };
        document.addEventListener("visibilitychange", hidden);
        return () => {
            disposed = true;
            unlisten?.();
            document.removeEventListener("visibilitychange", hidden);
            void flushRef.current();
        };
    }, []);

    const doc = documents.find((item) => item.id === selected);
    const { page, body, prefix, invalidYaml, mode: yamlMode, styles } = useMemo(() => readPage(doc?.markdown ?? ""), [doc?.markdown]);
    // Rendering the preview can lag behind typing; React drops stale renders when more input arrives.
    const current = useMemo(() => ({ id: doc?.id, body, page, styles }), [doc?.id, body, page, styles]);
    const deferred = useDeferredValue(current);
    // Never show another document's text right after switching files.
    const { body: previewBody, page: previewPage, styles: previewStyles } = deferred.id === current.id ? deferred : current;
    const isSlides = yamlMode ? yamlMode === "slides" : doc?.kind === "slides";
    const { paper } = page;
    const sheetSize = paperSize(page);
    const insets = pageInsets(page);
    const sourcePrefix = prefix?.startsWith("<!--") ? writePage(page, "") : prefix;
    const updatePage = (fields: Partial<PageSettings>) => change({ markdown: writePage({ ...page, ...fields }, body, prefix) });
    const query = filter.trim().toLocaleLowerCase();
    const visible = documents.filter((item) => !query || item.title.toLocaleLowerCase().includes(query));

    function save(id: string): Promise<void> {
        const running = saving.current.get(id);
        if (running) return running;
        const update = async () => {
            setSaveStates((states) => ({ ...states, [id]: "saving" }));
            try {
                let draft = drafts.current.get(id);
                while (draft) {
                    const updatedAt = await deskApi.update(draft);
                    if (drafts.current.get(id) === draft) {
                        drafts.current.delete(id);
                        setDocuments((items) => items.map((item) => item.id === id ? { ...item, updatedAt } : item));
                    }
                    draft = drafts.current.get(id);
                }
                setSaveStates((states) => ({ ...states, [id]: "saved" }));
            } catch (e) {
                setSaveStates((states) => ({ ...states, [id]: "failed" }));
                setError(errorMessage(e));
            } finally {
                saving.current.delete(id);
            }
        };
        const pending = update();
        saving.current.set(id, pending);
        return pending;
    }

    function change(fields: Partial<Pick<DeskDocument, "title" | "markdown">>) {
        if (!doc) return;
        const id = doc.id;
        const draft = { ...(drafts.current.get(id) ?? doc), ...fields };
        drafts.current.set(id, draft);
        setDocuments((items) => items.map((item) => item.id === draft.id ? draft : item));
        if (saveStates[id] !== "saving") setSaveStates((states) => ({ ...states, [id]: "saving" }));
        clearTimeout(timers.current.get(id));
        timers.current.set(id, window.setTimeout(() => {
            timers.current.delete(id);
            void save(id);
        }, SAVE_DELAY));
    }

    function documentMode(item: DeskDocument) {
        const known = kinds.current.get(item.id);
        if (known?.markdown === item.markdown) return known.mode;
        const { mode } = readPage(item.markdown);
        kinds.current.set(item.id, { markdown: item.markdown, mode });
        return mode;
    }

    async function perform(action: () => Promise<void>) {
        setBusy(true);
        setError("");
        try {
            await action();
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setBusy(false);
        }
    }

    function open(id: string) {
        void flush();
        setSelected(id);
        setMode("source");
    }

    function create(kind: DeskKind, imported: boolean) {
        void perform(async () => {
            const file = imported ? await deskApi.importMarkdown() : {
                title: `未命名${KINDS[kind].label}`,
                markdown: KINDS[kind].template,
            };
            if (!file) return;
            const created = await deskApi.create(kind, file);
            setDocuments((items) => [created, ...items]);
            setFilter("");
            open(created.id);
        });
    }

    function remove(item: DeskDocument) {
        void perform(async () => {
            if (!await ask({ title: `刪除「${item.title.trim() || "未命名"}」？`, danger: true, confirm: "刪除" })) return;
            clearTimeout(timers.current.get(item.id));
            timers.current.delete(item.id);
            await saving.current.get(item.id);
            await deskApi.remove(item.id);
            drafts.current.delete(item.id);
            const remaining = documents.filter((entry) => entry.id !== item.id);
            setDocuments(remaining);
            open(remaining[0]?.id ?? "");
        });
    }

    const state = doc ? saveStates[doc.id] ?? "saved" : null;
    const zoom = previewZoom === "fit"
        ? (previewWidth ? Math.max(0.25, Math.min(1, previewWidth / (sheetSize.width * 96 / 25.4))) : 1)
        : previewZoom;
    const changeZoom = (step: number) => setPreviewZoom(Math.max(0.25, Math.min(3, Math.round((zoom + step) * 100) / 100)));
    useEffect(() => {
        const pane = scrollPreview.current;
        if (!pane) return;
        function wheel(event: WheelEvent) {
            if (!event.ctrlKey || !event.deltaY) return;
            event.preventDefault();
            setPreviewZoom((previous) => {
                const current = previous === "fit" ? zoom : previous;
                return Math.max(0.25, Math.min(3, Math.round((current + (event.deltaY < 0 ? 0.1 : -0.1)) * 100) / 100));
            });
        }
        pane.addEventListener("wheel", wheel, { passive: false });
        return () => pane.removeEventListener("wheel", wheel);
    }, [doc?.id, isSlides, zoom]);
    const paperStyle = {
        "--desk-paper-width": `${sheetSize.width}mm`,
        "--desk-paper-height": `${sheetSize.height}mm`,
        "--desk-paper-padding": SIDES.map((side) => `${insets[side]}mm`).join(" "),
        "--desk-content-height": `${sheetSize.height - insets.top - insets.bottom}mm`,
        "--desk-columns": page.columns,
        "--desk-column-gap": `${page.columnGap}mm`,
        "--desk-column-rule": page.columnRule ? "1px solid var(--border-strong)" : "none",
        "--desk-paper-left": `${insets.left}mm`,
        "--desk-paper-right": `${insets.right}mm`,
        "--desk-header-offset": `${runningLineOffset(insets.top)}mm`,
        "--desk-footer-offset": `${runningLineOffset(insets.bottom)}mm`,
        "--desk-running-line-height": `${RUNNING_LINE_HEIGHT}mm`,
        "--desk-paper-color": page.color,
        "--desk-paper-ink": pageInk(page.color),
        zoom,
    } as CSSProperties;
    return (
        <section className={`desk${doc && !libraryVisible ? " desk-library-hidden" : ""}`} aria-label="Desk">
            <aside className="desk-library" id="desk-file-library" hidden={!!doc && !libraryVisible}>
                <header className="pane-header"><Icon name="file" size={16} /> 檔案 <span className="pane-count">{loaded ? documents.length : ""}</span></header>
                <div className="desk-library-controls">
                    <div className="desk-actions">
                        <DocumentMenu label="新增" disabled={!loaded || busy} onChoose={(kind) => create(kind, false)} />
                        <DocumentMenu label="匯入 .md" disabled={!loaded || busy} onChoose={(kind) => create(kind, true)} secondary />
                    </div>
                    <input type="search" aria-label="搜尋檔名" placeholder="搜尋檔名" value={filter} onChange={(e) => setFilter(e.target.value)} />
                </div>
                <div className="desk-file-list">
                    {visible.map((item) => {
                        const mode = item.id === doc?.id ? yamlMode : documentMode(item);
                        const kind = mode === "writer" ? "document" : mode ?? item.kind;
                        return (
                        <button
                            key={item.id}
                            className="desk-file"
                            aria-current={item.id === selected ? "true" : undefined}
                            disabled={busy}
                            title={item.title}
                            onClick={() => open(item.id)}
                        >
                            <Icon name={KINDS[kind].icon} size={17} />
                            <span><strong>{item.title.trim() || "未命名"}</strong><small>{KINDS[kind].label} · {editedAt(item.updatedAt)}</small></span>
                            {saveStates[item.id] === "failed" && <Icon name="warning" size={15} />}
                        </button>
                        );
                    })}
                    {loaded && !visible.length && <p className="empty">{query ? "找不到符合的檔案" : "尚無檔案"}</p>}
                </div>
            </aside>
            <div className="desk-workspace">
                {error && (
                    <div className="desk-error" role="alert">
                        <span>{error}</span>
                        {!loaded && !loading && <button className="secondary-btn" onClick={() => void load()}>重試</button>}
                        {doc && state === "failed" && <button className="secondary-btn" onClick={() => { setError(""); void save(doc.id); }}>重試儲存</button>}
                    </div>
                )}
                {doc ? (
                    <>
                        <header className="desk-document-header">
                            <button className="icon-btn desk-library-toggle" aria-controls="desk-file-library" aria-expanded={libraryVisible}
                                aria-label={libraryVisible ? "收起檔案清單" : "展開檔案清單"} title={libraryVisible ? "收起檔案清單" : "展開檔案清單"}
                                onClick={() => setLibraryVisible(!libraryVisible)}><Icon name="layout" size={17} /></button>
                            <input aria-label="檔案名稱" placeholder="未命名" value={doc.title} readOnly={busy}
                                onChange={(e) => change({ title: e.target.value })}
                                onBlur={() => {
                                    const title = doc.title.trim() || "未命名";
                                    if (title !== doc.title) change({ title });
                                }}
                            />
                            <div className="desk-view-switch" role="group" aria-label="檔案檢視">
                                <button aria-pressed={mode === "source"} onClick={() => { setMode("source"); setRibbon("home"); }}>Markdown</button>
                                <button aria-pressed={mode === "preview"} onClick={() => { setMode("preview"); setRibbon("view"); }}>{isSlides ? "放映" : "預覽"}</button>
                            </div>
                            <span className={`desk-save-status desk-save-${state}`} role="status">{state && SAVE_LABELS[state]}</span>
                        </header>
                        <div className="desk-ribbon-tabs" role="group" aria-label="功能區">
                            {(Object.keys(RIBBON_TABS) as RibbonTab[]).map((tab) => (
                                <button key={tab} aria-pressed={ribbon === tab} onClick={() => {
                                    setRibbon(tab);
                                    if (tab !== "layout") setPagePanel(false);
                                    if (tab === "insert") setMode("source");
                                }}>{RIBBON_TABS[tab]}</button>
                            ))}
                        </div>
                        <div className="desk-ribbon" aria-label={RIBBON_TABS[ribbon]}>
                            {ribbon === "file" && <div className="desk-ribbon-group">
                            <DocumentMenu label="新增" disabled={!loaded || busy} onChoose={(kind) => create(kind, false)} />
                            <DocumentMenu label="匯入 .md" disabled={!loaded || busy} onChoose={(kind) => create(kind, true)} secondary />
                            <select className="secondary-btn" aria-label="匯出格式" value="" disabled={busy} onChange={(e) => {
                                const format = e.target.value;
                                if (!format) return;
                                void perform(async () => {
                                    if (format === "md") return deskApi.exportMarkdown(doc);
                                    const content = preview.current;
                                    if (!content) throw new Error("無法讀取文件預覽。");
                                    if (format === "pdf") return printDocument(content, doc.title, page);
                                    return deskApi.exportWord(doc.title, wordDocument(content, page));
                                });
                            }}>
                                <option value="" disabled>匯出</option>
                                <option value="md">Markdown (.md)</option>
                                {!isSlides && <>
                                    <option value="pdf">PDF（另存為 PDF）</option>
                                    <option value="docx">Word (.docx)</option>
                                </>}
                            </select>
                            <button className="icon-btn desk-delete" aria-label="刪除檔案" title="刪除檔案" disabled={busy} onClick={() => remove(doc)}>
                                <Icon name="trash" size={16} />
                            </button>
                            </div>}
                            {ribbon === "home" && mode === "preview" &&
                                <button className="secondary-btn" onClick={() => setMode("source")}><Icon name="edit" size={16} />編輯 Markdown</button>}
                            {ribbon === "layout" && !isSlides && <div className="desk-ribbon-group">
                            <label className="desk-paper-control">紙張
                                <select aria-label="紙張尺寸" value={paper} disabled={invalidYaml} onChange={(e) => updatePage({ paper: e.target.value as Paper })}>
                                    {Object.entries(PAPERS).map(([key, size]) => <option key={key} value={key}>{size.label}</option>)}
                                </select>
                            </label>
                            <label className="desk-paper-control">方向
                                <select aria-label="紙張方向" value={page.orientation} disabled={invalidYaml} onChange={(e) => updatePage({ orientation: e.target.value === "landscape" ? "landscape" : "portrait" })}>
                                    <option value="portrait">直向</option>
                                    <option value="landscape">橫向</option>
                                </select>
                            </label>
                            <label className="desk-paper-control">邊界
                                <select aria-label="邊界" disabled={invalidYaml}
                                    value={MARGIN_PRESETS.findIndex((preset) => SIDES.every((side) => preset.padding[side] === page.padding[side]))}
                                    onChange={(e) => { const preset = MARGIN_PRESETS[Number(e.target.value)]; if (preset) updatePage({ padding: { ...preset.padding } }); }}>
                                    <option value={-1} disabled>自訂</option>
                                    {MARGIN_PRESETS.map((preset, index) => <option key={preset.label} value={index}>{preset.label}</option>)}
                                </select>
                            </label>
                            <label className="desk-paper-control">欄
                                <select aria-label="文字欄數" value={page.columns} disabled={invalidYaml} onChange={(e) => updatePage({ columns: Number(e.target.value) })}>
                                    {Array.from({ length: MAX_COLUMNS }, (_, index) => <option key={index} value={index + 1}>{index === 0 ? "一欄" : `${index + 1} 欄`}</option>)}
                                </select>
                            </label>
                            <button className="secondary-btn" disabled={invalidYaml} aria-haspopup="dialog" onClick={() => setPagePanel(true)}><Icon name="settings" size={15} />頁面設定…</button>
                            </div>}
                            {ribbon === "view" && !isSlides && <label className="desk-paper-control">縮放
                                <select aria-label="預覽縮放" value={previewZoom} onChange={(e) => setPreviewZoom(e.target.value === "fit" ? "fit" : Number(e.target.value))}>
                                    <option value="fit">符合寬度</option>
                                    {[0.5, 0.75, 1, 1.25, 1.5].map((scale) => <option key={scale} value={scale}>{scale * 100}%</option>)}
                                    {previewZoom !== "fit" && ![0.5, 0.75, 1, 1.25, 1.5].includes(previewZoom) &&
                                        <option value={previewZoom}>{Math.round(previewZoom * 100)}%</option>}
                                </select>
                            </label>}
                            {ribbon === "layout" && mode !== "source" &&
                                <button className="secondary-btn" onClick={() => setMode("source")}><Icon name="layout" size={16} />編輯版面指令</button>}
                            <div ref={setRibbonHost} className="desk-ribbon-tools" />
                        </div>
                        {invalidYaml && <div className="desk-error" role="status">請在「Markdown」修正文件開頭的 YAML。</div>}
                        {!isSlides && pagePanel && !invalidYaml && (
                            <PageSettingsDialog page={page} onChange={updatePage} onClose={() => setPagePanel(false)} />
                        )}
                        <div className="desk-content" key={doc.id} inert={busy}>
                            {isSlides ? (
                                mode === "preview" ? <SlidePreview markdown={body} styles={styles} />
                                    : <DeskSource markdown={doc.markdown} bodyStart={prefix?.length} slides ribbon={ribbon} ribbonHost={ribbonHost} onChange={(markdown) => change({ markdown })} />
                            ) : (
                                <div className={`desk-document-layout${mode === "preview" ? "" : " desk-document-split"}`}>
                                    {mode === "source" && <DeskSource
                                        markdown={sourcePrefix === prefix ? doc.markdown : sourcePrefix + body}
                                        bodyStart={sourcePrefix?.length}
                                        ribbon={ribbon} ribbonHost={ribbonHost}
                                        slides={false} onChange={(markdown) => change({ markdown })}
                                    />}
                                    <section className="desk-preview-pane" aria-label="即時文件預覽">
                                        <div className="desk-preview-toolbar">
                                            <span>{mode === "preview" ? "文件預覽" : "即時預覽"}</span>
                                            <div className="desk-preview-zoom">
                                                <button className="icon-btn" aria-label="縮小" title="縮小" disabled={zoom <= 0.25} onClick={() => changeZoom(-0.1)}><Icon name="zoomOut" size={16} /></button>
                                                <span>{Math.round(zoom * 100)}%</span>
                                                <button className="icon-btn" aria-label="放大" title="放大" disabled={zoom >= 3} onClick={() => changeZoom(0.1)}><Icon name="zoomIn" size={16} /></button>
                                                <button className="icon-btn" aria-label="符合寬度" title="符合寬度" aria-pressed={previewZoom === "fit"} onClick={() => setPreviewZoom("fit")}><Icon name="fit" size={16} /></button>
                                            </div>
                                        </div>
                                        <div ref={previewPane} className="desk-paper-scroll" tabIndex={0} aria-label="文件頁面">
                                            <div className="desk-paper-stack" ref={preview} style={paperStyle}>
                                                <DeskPreview markdown={previewBody} page={previewPage} styles={previewStyles} />
                                            </div>
                                        </div>
                                    </section>
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="desk-empty">
                        {loading ? <p role="status">載入中…</p> : loaded && (
                            <>
                                <Icon name="file" size={36} />
                                <h1>Desk</h1>
                                <p>新增文件或簡報，也可以匯入 Markdown。</p>
                                <div className="desk-actions">
                                    <DocumentMenu label="新增" disabled={busy} onChoose={(kind) => create(kind, false)} />
                                    <DocumentMenu label="匯入 .md" disabled={busy} onChoose={(kind) => create(kind, true)} secondary />
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>
        </section>
    );
}

const NO_STYLES: DeskStyles = new Map();
const NO_BREAKS: number[] = [];

/** The rendered top-level blocks of a page, looking through style scopes, with their source offsets. */
function placedBlocks(body: Element): { element: Element; block: PlacedBlock }[] {
    const found: { element: Element; block: PlacedBlock }[] = [];
    const walk = (parent: Element) => {
        for (const element of parent.children) {
            if (element.classList.contains("desk-style-scope")) { walk(element); continue; }
            if (element.classList.contains("md-footnotes")) continue;
            const rect = element.getBoundingClientRect();
            if (!rect.height && !rect.width) continue;
            const source = element instanceof HTMLElement && element.dataset.o !== undefined ? element : element.querySelector<HTMLElement>("[data-o]");
            const offset = source ? Number(source.dataset.o) : NaN;
            found.push({ element, block: { top: rect.top, bottom: rect.bottom, offset: Number.isFinite(offset) ? offset : null } });
        }
    };
    walk(body);
    return found;
}

function DeskPreview({ markdown, page, styles = NO_STYLES }: { markdown: string; page?: PageSettings; styles?: DeskStyles }) {
    const headingPrefix = useId();
    const scopePrefix = "s" + headingPrefix.replace(/[^\w-]/g, "") + "-";
    const document = useMemo(() => parseDesk(markdown), [markdown]);
    const paper = page ? paperSize(page) : undefined;
    const insets = page ? pageInsets(page) : undefined;
    const columns = page?.columns ?? 1;
    // Automatic page breaks (source offsets), measured for this document, styles and page layout.
    const layoutKey = useMemo(() => ({}), [document, styles, paper?.width, paper?.height, insets?.top, insets?.bottom, insets?.left, insets?.right,
        columns, page?.columnGap]);
    const [auto, setAuto] = useState<{ key: object; breaks: number[]; passes: number }>({ key: {}, breaks: [], passes: 0 });
    const breaks = page && auto.key === layoutKey ? auto.breaks : NO_BREAKS;
    const { sections, css } = useMemo(
        () => applyStyleScopes(page ? splitPages(document.children, breaks) : [document.children], styles, scopePrefix),
        [document, styles, !page, scopePrefix, breaks]);
    const sheets = useRef<(HTMLDivElement | null)[]>([]);
    const [measure, setMeasure] = useState(0);

    useLayoutEffect(() => {
        if (!page || !paper || !insets) return;
        const fresh = auto.key !== layoutKey;
        // Each pass only adds breaks; with text columns each pass settles one more page.
        if (!fresh && auto.passes >= 200) return;
        const found: number[] = [];
        for (const sheet of sheets.current.slice(0, sections.length)) {
            const body = sheet?.querySelector(":scope > .md");
            if (!sheet || !body) continue;
            const rect = sheet.getBoundingClientRect();
            const pxPerMm = rect.width / paper.width;
            if (!pxPerMm) return;
            const placed = placedBlocks(body);
            let picked: number[];
            let tall: boolean;
            if (columns > 1) {
                // What doesn't fit flows into columns to the right of the page.
                const left = rect.left + insets.left * pxPerMm;
                const gap = page.columnGap * pxPerMm;
                const width = ((paper.width - insets.left - insets.right) * pxPerMm - gap * (columns - 1)) / columns;
                const blocks = placed.map(({ element, block }) => {
                    const pieces = [...element.getClientRects()].map((piece) => columnAt(piece.left, left, width, gap));
                    return { offset: block.offset, startColumn: Math.min(...pieces), endColumn: Math.max(...pieces) };
                });
                picked = pickColumnBreak(blocks, columns);
                tall = !picked.length && blocks.some((block) => block.endColumn >= columns);
            } else {
                const blocks = placed.map(({ block }) => block);
                const top = rect.top + insets.top * pxPerMm;
                const height = (paper.height - insets.top - insets.bottom) * pxPerMm;
                picked = pickBreaks(blocks, top, height);
                tall = !picked.length && blocks.some((block) => block.bottom - top > height + 0.5);
            }
            found.push(...picked);
            // A single block taller than the page can't move anywhere: let this page stretch to show it.
            if (tall) sheet.dataset.tall = ""; else delete sheet.dataset.tall;
        }
        const known = fresh ? [] : auto.breaks;
        const added = found.filter((offset) => !known.includes(offset));
        if (fresh || added.length) setAuto({ key: layoutKey, breaks: [...known, ...added].sort((a, b) => a - b), passes: fresh ? 1 : auto.passes + 1 });
    }, [layoutKey, auto, sections, measure]);

    // Images and fonts that load later change heights: measure again (this only adds breaks).
    useEffect(() => {
        if (!page) return;
        const observer = new ResizeObserver(() => setMeasure((count) => count + 1));
        for (const sheet of sheets.current.slice(0, sections.length)) {
            const body = sheet?.querySelector(":scope > .md");
            if (body) observer.observe(body);
        }
        return () => observer.disconnect();
    }, [sections, !page]);

    const sheet = css ? <style>{css}</style> : null;
    if (!page) return <>{sheet}<Markdown source={markdown} document={{ ...document, children: sections[0] }} outlineDocument={document} headingPrefix={headingPrefix} /></>;
    const running = (part: "header" | "footer", index: number) => ALIGNMENTS.map((side) => (
        <span key={side} style={{ textAlign: side }}>
            {runningLines(page, index)(part, side).map((item) => item === PAGE_NUMBER ? index + 1 : item).join(" ")}
        </span>
    ));
    return <>{sheet}{sections.map((children, index) => (
        <div className="desk-paper" key={index} data-columns={columns > 1 ? columns : undefined} ref={(element) => { sheets.current[index] = element; }}>
            <header className="desk-paper-header">{running("header", index)}</header>
            <Markdown source={markdown} document={{ ...document, children, footnotes: index === sections.length - 1 ? document.footnotes : [] }}
                outlineDocument={document} headingPrefix={headingPrefix} />
            <footer className="desk-paper-footer">{running("footer", index)}</footer>
        </div>
    ))}</>;
}

function DocumentMenu({ label, disabled, secondary, onChoose }: {
    label: string;
    disabled: boolean;
    secondary?: boolean;
    onChoose: (kind: DeskKind) => void;
}) {
    const id = useId();
    const menu = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState({ left: 0, top: 0 });
    return (
        <>
            <button className={secondary ? "secondary-btn" : "primary-btn"} disabled={disabled}
                popoverTarget={id} onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setPosition({ left: rect.left, top: rect.bottom });
                }}>
                {label}<Icon name="chevronDown" size={14} />
            </button>
            <div id={id} popover="auto" ref={menu} className="desk-document-menu" style={position} aria-label={label}>
                {(Object.keys(KINDS) as DeskKind[]).map((kind) => (
                    <button key={kind} className="desk-file" disabled={disabled} onClick={() => {
                        menu.current?.hidePopover();
                        onChoose(kind);
                    }}>
                        <Icon name={KINDS[kind].icon} size={16} />
                        {KINDS[kind].label}
                    </button>
                ))}
            </div>
        </>
    );
}

function SlidePreview({ markdown, styles }: { markdown: string; styles?: DeskStyles }) {
    const presentation = useRef<HTMLDivElement>(null);
    const slides = useMemo(() => splitSlides(markdown), [markdown]);
    const [index, setIndex] = useState(0);
    const [fullscreen, setFullscreen] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => {
        const onFullscreen = () => setFullscreen(document.fullscreenElement === presentation.current);
        document.addEventListener("fullscreenchange", onFullscreen);
        return () => document.removeEventListener("fullscreenchange", onFullscreen);
    }, []);
    const current = Math.min(index, slides.length - 1);
    const previous = () => setIndex(Math.max(0, current - 1));
    const next = () => setIndex(Math.min(slides.length - 1, current + 1));
    async function toggleFullscreen() {
        setError("");
        try {
            if (fullscreen) await document.exitFullscreen();
            else await presentation.current?.requestFullscreen();
        } catch {
            setError("無法切換全螢幕。");
        }
    }
    return (
        <div ref={presentation} className="desk-presentation" tabIndex={0} aria-label="投影片放映" onKeyDown={(e) => {
            if (e.key === "ArrowLeft") previous();
            else if (e.key === "ArrowRight") next();
            else return;
            e.preventDefault();
        }}>
            <div className="desk-slide"><DeskPreview markdown={slides[current]} styles={styles} /></div>
            <div className="desk-slide-controls">
                <button className="secondary-btn" disabled={current === 0} onClick={previous}>上一張</button>
                <span role="status">{current + 1} / {slides.length}</span>
                <button className="secondary-btn" disabled={current === slides.length - 1} onClick={next}>下一張</button>
                <button className="secondary-btn" onClick={() => void toggleFullscreen()}>{fullscreen ? "離開全螢幕" : "全螢幕"}</button>
            </div>
            {error && <p role="alert">{error}</p>}
        </div>
    );
}
