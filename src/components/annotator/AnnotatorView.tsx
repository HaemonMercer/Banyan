import { useCallback, useEffect, useMemo, useState } from "react";
import {
    annotationApi,
    COLORS,
    openCardInWhiteboard,
    parseLocation,
    placeLabel,
    useAnnotationGeneration,
    useAnnotations,
    type AnnotatableFile,
    type Annotation,
    type AnnotationColor,
    type AnnotationInFile,
} from "../../annotator/api";
import { errorMessage } from "../../drawer/api";
import { formatSize } from "../../drawer/itemTypes";
import { Icon } from "../../icons/Icon";
import PdfView, { attachmentOutline } from "../reader/PdfView";
import type { OutlineEntry } from "../../whiteboard/pdf";
import BookView from "../reader/BookView";
import { readerKind } from "../reader/Reader";
import "../reader/Reader.css";
import "./Annotator.css";
import { AnnotationFilterBar, AnnotationRow, NoMatchingAnnotations, useAnnotationFilter } from "./AnnotationRows";
import { Toast, useToast } from "../Feedback";
import { openFileTab } from "../../tabs";

interface Props {
    /** Annotation to show when the module opens (e.g. a card's link back). */
    initialAnnotationId?: number | null;
    /** Shows the item in Drawer. */
    onOpenItem: (itemId: number) => void;
}

const FILE_KEY = "banyan.annotator.file";
const ONLY_KEY = "banyan.annotator.onlyAnnotated";
const DOC_KEY = "banyan.annotator.overviewDoc";

/** A file's annotations as text, for copying elsewhere. */
function annotationsText(title: string, list: Annotation[]): string {
    const lines = [`《${title}》的註解`, ""];
    for (const a of list) {
        const place = placeLabel(parseLocation(a));
        if (a.kind === "bookmark") {
            lines.push(`書籤：${place}`, "");
            continue;
        }
        lines.push(place, `「${a.quote.trim()}」`);
        if (a.note) lines.push(a.note);
        lines.push("");
    }
    return lines.join("\n");
}

/**
 * Annotator: read PDFs and books, highlight passages in colors, write notes, add bookmarks,
 * and turn passages into cards. Left: the files; middle: the file; right: its annotations.
 */
function AnnotatorView({ initialAnnotationId = null, onOpenItem }: Props) {
    const [files, setFiles] = useState<AnnotatableFile[]>([]);
    const [fileQuery, setFileQuery] = useState("");
    const [onlyAnnotated, setOnlyAnnotated] = useState(() => localStorage.getItem(ONLY_KEY) === "1");
    const [current, setCurrent] = useState<number | null>(() => {
        const v = Number(localStorage.getItem(FILE_KEY));
        return v > 0 ? v : null;
    });
    const [overview, setOverview] = useState(false);
    /** The document picked in 所有註解: its annotations show in the right column. */
    const [overviewDoc, setOverviewDocState] = useState<number | null>(() => {
        const v = Number(localStorage.getItem(DOC_KEY));
        return v > 0 ? v : null;
    });
    const setOverviewDoc = useCallback((id: number | null) => {
        setOverviewDocState(id);
        try {
            localStorage.setItem(DOC_KEY, String(id ?? ""));
        } catch {
            /* this session only */
        }
    }, []);
    const [jumpTo, setJumpTo] = useState<{ annotation: Annotation; nonce: number } | null>(null);
    /** The annotation last gone to or opened in the text: marked in the list. */
    const [active, setActive] = useState<number | null>(null);
    const jump = useCallback((a: Annotation) => {
        setActive(a.id);
        setJumpTo((j) => ({ annotation: a, nonce: (j?.nonce ?? 0) + 1 }));
    }, []);
    const onActive = useCallback((id: number | null) => {
        if (id !== null) setActive(id);
    }, []);
    const [toolsEl, setToolsEl] = useState<HTMLDivElement | null>(null);
    const { toast, showError, showInfo, close: closeToast } = useToast();
    const generation = useAnnotationGeneration();


    useEffect(() => {
        annotationApi.files().then(setFiles, (e) => showError(errorMessage(e)));
    }, [generation, showError]);

    const open = useCallback((attachmentId: number, annotation?: Annotation) => {
        setOverview(false);
        setCurrent(attachmentId);
        try {
            localStorage.setItem(FILE_KEY, String(attachmentId));
        } catch {
            /* this session only */
        }
        setActive(null);
        if (annotation) jump(annotation);
    }, [jump]);

    // Opened from a card's "回到原文".
    useEffect(() => {
        if (initialAnnotationId === null) return;
        annotationApi.get(initialAnnotationId).then(
            (a) => open(a.attachmentId, a),
            (e) => showError(errorMessage(e)),
        );
    }, [initialAnnotationId, open, showError]);

    const file = files.find((f) => f.attachmentId === current) ?? null;
    const shown = files.filter((f) => {
        if (onlyAnnotated && f.annotationCount === 0) return false;
        const q = fileQuery.trim().toLowerCase();
        return !q || f.itemTitle.toLowerCase().includes(q) || f.fileName.toLowerCase().includes(q);
    });
    const kind = file ? readerKind({ id: file.attachmentId, fileName: file.fileName }) : null;
    const docFile = overview ? (files.find((f) => f.attachmentId === overviewDoc && f.annotationCount > 0) ?? null) : null;
    const showNotes = overview ? docFile !== null : file !== null && (kind === "pdf" || kind === "book");

    return (
        <div className={`annotator${showNotes ? "" : " no-notes"}`}>
            <nav className="drawer-pane annotator-files">
                <div className="pane-header">
                    <span>Annotator</span>
                </div>
                <div className="search">
                    <input type="search" placeholder="搜尋檔案…" value={fileQuery} onChange={(e) => setFileQuery(e.target.value)} />
                </div>
                <button className={`annotator-file overview${overview ? " selected" : ""}`} onClick={() => setOverview(true)}>
                    <Icon name="note" className="annotator-file-icon" />
                    <span className="annotator-file-text">
                        <span className="annotator-file-title">所有註解</span>
                        <span className="annotator-file-meta">{files.reduce((n, f) => n + f.annotationCount, 0)} 則，{files.filter((f) => f.annotationCount > 0).length} 個檔案</span>
                    </span>
                </button>
                <label className="annotator-only">
                    <input
                        type="checkbox"
                        checked={onlyAnnotated}
                        onChange={(e) => {
                            setOnlyAnnotated(e.target.checked);
                            try {
                                localStorage.setItem(ONLY_KEY, e.target.checked ? "1" : "0");
                            } catch {
                                /* this session only */
                            }
                        }}
                    />
                    只顯示有註解的檔案
                </label>
                <div className="annotator-file-list">
                    {shown.length === 0 && (
                        <p className="muted annotator-empty">
                            {files.length === 0 ? "還沒有 PDF 或電子書。在 Drawer 加入 PDF、EPUB、MOBI 等檔案後會出現在這裡。" : "沒有符合的檔案"}
                        </p>
                    )}
                    {shown.map((f) => (
                        <button
                            key={f.attachmentId}
                            className={`annotator-file${!overview && f.attachmentId === current ? " selected" : ""}`}
                            onClick={() => open(f.attachmentId)}
                            onMouseDown={(e) => e.button === 1 && e.preventDefault()}
                            onAuxClick={(e) => {
                                // Middle-click: in a new tab, like a browser link.
                                if (e.button === 1) openFileTab({ attachmentId: f.attachmentId, fileName: f.fileName, title: f.itemTitle || f.fileName, itemId: f.itemId });
                            }}
                            title={`${f.fileName}（${formatSize(f.size)}）\n中鍵：在新分頁開啟`}
                        >
                            <Icon name={/\.pdf$/i.test(f.fileName) ? "pdf" : "library"} className="annotator-file-icon" />
                            <span className="annotator-file-text">
                                <span className="annotator-file-title">{f.itemTitle || f.fileName}</span>
                                <span className="annotator-file-meta">
                                    {f.itemTitle ? f.fileName : formatSize(f.size)}
                                </span>
                            </span>
                            {f.annotationCount > 0 && <span className="tree-count">{f.annotationCount}</span>}
                        </button>
                    ))}
                </div>
            </nav>

            <section className="annotator-main">
                {overview ? (
                    <Overview
                        generation={generation}
                        selected={docFile?.attachmentId ?? null}
                        onSelect={setOverviewDoc}
                        onOpenFile={(id) => open(id)}
                        onError={showError}
                    />
                ) : file && (kind === "pdf" || kind === "book") ? (
                    <>
                        <header className="reader-bar">
                            <span className="reader-title" title={file.fileName}>{file.itemTitle || file.fileName}</span>
                            <div className="reader-tools" ref={setToolsEl} />
                            <button
                                className="secondary-btn"
                                onClick={() => openFileTab({ attachmentId: file.attachmentId, fileName: file.fileName, title: file.itemTitle || file.fileName, itemId: file.itemId })}
                                title="在新的分頁中開啟，可以和其他檔案切換"
                            >
                                在分頁開啟
                            </button>
                            <button className="secondary-btn" onClick={() => onOpenItem(file.itemId)} title="在 Drawer 中顯示這個條目">
                                在 Drawer 中顯示
                            </button>
                        </header>
                        <div className="reader-body">
                            {kind === "pdf" ? (
                                <PdfView key={file.attachmentId} id={file.attachmentId} toolsEl={toolsEl} onError={showError} onInfo={showInfo} jumpTo={jumpTo} onActive={onActive} />
                            ) : (
                                <BookView key={file.attachmentId} id={file.attachmentId} fileName={file.fileName} toolsEl={toolsEl} onError={showError} onInfo={showInfo} jumpTo={jumpTo} onActive={onActive} />
                            )}
                        </div>
                    </>
                ) : (
                    <div className="reader-message">
                        <Icon name="note" size={36} />
                        <p>選擇左邊的 PDF 或電子書開始閱讀。選取文字就可以畫重點、寫筆記；重點可以變成白板上的卡片。</p>
                    </div>
                )}
            </section>

            {showNotes && overview && docFile && (
                <AnnotationList
                    key={`o${docFile.attachmentId}`}
                    file={docFile}
                    active={null}
                    onJump={(a) => open(a.attachmentId, a)}
                    onOpenFile={() => open(docFile.attachmentId)}
                    onError={showError}
                    onInfo={showInfo}
                />
            )}
            {showNotes && !overview && file && (
                <AnnotationList
                    key={file.attachmentId}
                    file={file}
                    active={active}
                    onJump={jump}
                    onError={showError}
                    onInfo={showInfo}
                />
            )}

            <Toast toast={toast} onClose={closeToast} />
        </div>
    );
}

interface Chapter {
    key: string;
    label: string;
    depth: number;
    /** Sorts the chapters in file order. */
    order: number;
}

/**
 * The PDF's table of contents (null while loading, or for a book: books carry their chapter in
 * each annotation's location).
 */
function usePdfOutline(file: AnnotatableFile): OutlineEntry[] | null {
    const isPdf = /\.pdf$/i.test(file.fileName);
    const [outline, setOutline] = useState<OutlineEntry[] | null>(null);
    useEffect(() => {
        setOutline(null);
        if (!isPdf) return;
        let stale = false;
        attachmentOutline(file.attachmentId).then(
            (o) => !stale && setOutline(o),
            () => !stale && setOutline([]),
        );
        return () => {
            stale = true;
        };
    }, [file.attachmentId, isPdf]);
    return outline;
}

/** The chapter an annotation is in: the book's chapter, or the PDF bookmark at or before its page. */
function chapterOf(a: Annotation, outline: OutlineEntry[] | null): Chapter | null {
    const loc = parseLocation(a);
    if (!loc) return null;
    if (loc.type === "book" || loc.type === "book-place") {
        return { key: `c${loc.chapter}`, label: loc.label || `第 ${loc.chapter + 1} 部分`, depth: 0, order: loc.chapter };
    }
    if (!outline || outline.length === 0) return null;
    let best = -1;
    outline.forEach((o, i) => {
        if (o.page !== null && o.page <= loc.page && (best < 0 || o.page >= (outline[best].page ?? 0))) best = i;
    });
    if (best < 0) return { key: "start", label: "目錄之前", depth: 0, order: -1 };
    return { key: `o${best}`, label: outline[best].title, depth: outline[best].depth, order: best };
}

/**
 * The file's annotations, in file order, filterable by kind and color. When the file has a table
 * of contents they are grouped under its chapters (only chapters that have annotations).
 */
export function AnnotationList({ file, active, onJump, onOpenFile, onError, onInfo }: {
    file: AnnotatableFile;
    active: number | null;
    onJump: (a: Annotation) => void;
    /** Shown in 所有註解: opens the file in the reader. */
    onOpenFile?: () => void;
    onError: (m: string) => void;
    onInfo: (m: string) => void;
}) {
    const ann = useAnnotations(file.attachmentId, onError);
    const outline = usePdfOutline(file);
    const filtering = useAnnotationFilter(ann.annotations);
    const { list } = filtering;
    /** The list under its chapters, or null when the file has no table of contents. */
    const chapters = useMemo(() => {
        const m = new Map<string, { chapter: Chapter; list: Annotation[] }>();
        let any = false;
        for (const a of list) {
            const c = chapterOf(a, outline) ?? { key: "none", label: "其他", depth: 0, order: Number.MAX_SAFE_INTEGER };
            if (c.key !== "none") any = true;
            if (!m.has(c.key)) m.set(c.key, { chapter: c, list: [] });
            m.get(c.key)!.list.push(a);
        }
        if (!any) return null;
        return [...m.values()].sort((x, y) => x.chapter.order - y.chapter.order);
    }, [list, outline]);
    const highlights = ann.annotations.filter((a) => a.kind === "highlight").length;
    const bookmarks = ann.annotations.length - highlights;

    const toCard = async (a: Annotation) => {
        if (a.cardId) return openCardInWhiteboard(a.cardId);
        if (await ann.toCard(a.id, placeLabel(parseLocation(a)))) onInfo("已建立卡片，可以在 Whiteboard 的卡片庫或這個條目的筆記卡片中找到");
    };

    return (
        <aside className="drawer-pane annotator-notes">
            <div className="pane-header">
                <span className="annot-notes-title" title={onOpenFile ? file.fileName : undefined}>{onOpenFile ? file.itemTitle || file.fileName : "註解"}</span>
                <span className="pane-count">{highlights} 則重點、{bookmarks} 個書籤</span>
                {onOpenFile && (
                    <button className="icon-btn" title="打開這個檔案閱讀" aria-label="打開檔案" onClick={onOpenFile}>
                        <Icon name={/\.pdf$/i.test(file.fileName) ? "pdf" : "library"} />
                    </button>
                )}
                <button
                    className="icon-btn"
                    title="把這個檔案的註解複製成文字"
                    disabled={ann.annotations.length === 0}
                    onClick={() =>
                        navigator.clipboard
                            .writeText(annotationsText(file.itemTitle || file.fileName, ann.annotations))
                            .then(() => onInfo("已複製到剪貼簿"), () => onError("無法複製到剪貼簿"))
                    }
                >
                    <Icon name="file" />
                </button>
            </div>
            {ann.annotations.length > 0 && (
                <AnnotationFilterBar state={filtering} placeholder="搜尋這個檔案的註解…" />
            )}
            {ann.annotations.length === 0 ? (
                <div className="annotator-empty annot-help">
                    <p className="muted">還沒有註解。</p>
                    <ul>
                        <li>選取文字，選一個顏色畫重點（也可以按 <kbd>1</kbd>–<kbd>5</kbd>），按 <kbd>N</kbd> 畫重點並寫筆記</li>
                        <li>點一下重點可以換顏色、寫筆記、建立卡片</li>
                        <li>上方的「書籤」標記目前的位置</li>
                    </ul>
                </div>
            ) : list.length === 0 ? (
                <NoMatchingAnnotations onClear={filtering.clear} />
            ) : (
                <ul className="annot-list">
                    {(chapters ?? [{ chapter: null, list }]).map((g) => [
                        g.chapter && (
                            <li
                                key={`h${g.chapter.key}`}
                                className="annot-chapter"
                                style={{ paddingLeft: 4 + Math.min(g.chapter.depth, 3) * 10 }}
                                title={g.chapter.label}
                            >
                                <span className="annot-chapter-label">{g.chapter.label}</span>
                                <span className="annot-chapter-count">{g.list.length}</span>
                            </li>
                        ),
                        ...g.list.map((a) => (
                            <AnnotationRow
                                key={a.id}
                                a={a}
                                active={a.id === active}
                                onJump={() => onJump(a)}
                                onNote={(note) => ann.update(a.id, { note })}
                                onCard={() => toCard(a)}
                                onDelete={() => ann.remove(a.id)}
                            />
                        )),
                    ])}
                </ul>
            )}
        </aside>
    );
}

type DocSort = "recent" | "title" | "count";
const DOC_SORT_KEY = "banyan.annotator.docSort";

const fileTitle = (a: { itemTitle: string; fileName: string }) => a.itemTitle || a.fileName;
const fileIcon = (fileName: string) => (/\.pdf$/i.test(fileName) ? "pdf" : "library");

/** A document with annotations, as shown in 所有註解. */
interface DocSummary {
    id: number;
    title: string;
    fileName: string;
    highlights: number;
    bookmarks: number;
    /** Highlights per color, for the color strip. */
    colors: Map<AnnotationColor, number>;
    /** Most recently changed highlights (a peek at the document's annotations). */
    recent: AnnotationInFile[];
    last: number;
}

const PEEK = 3;

/** One document as a card: title, its colors, a peek at its latest highlights, counts. */
function DocCard({ d, selected, onSelect, onOpen }: { d: DocSummary; selected: boolean; onSelect: () => void; onOpen: () => void }) {
    const total = d.highlights || 1;
    return (
        <button
            className={`annot-doc${selected ? " selected" : ""}`}
            onClick={onSelect}
            onDoubleClick={onOpen}
            title={`${d.fileName}\n點一下在右欄查看註解，雙擊打開檔案`}
            aria-pressed={selected}
        >
            <span className="annot-doc-face">
                <span className="annot-doc-head">
                    <Icon name={fileIcon(d.fileName)} className="annot-doc-icon" />
                    <span className="annot-doc-title">{d.title}</span>
                </span>
                {d.title !== d.fileName && <span className="annot-doc-file muted">{d.fileName}</span>}
                {d.highlights > 0 && (
                    <span className="annot-doc-colors" aria-hidden>
                        {COLORS.filter((c) => d.colors.get(c.id)).map((c) => (
                            <span key={c.id} className={`annot-bg-${c.id}`} style={{ flexGrow: (d.colors.get(c.id) ?? 0) / total }} />
                        ))}
                    </span>
                )}
                {d.recent.length > 0 && (
                    <span className="annot-doc-peek">
                        {d.recent.map((a) => (
                            <span key={a.id} className={`annot-doc-quote annot-bg-${a.color}`}>
                                {a.quote}
                            </span>
                        ))}
                    </span>
                )}
            </span>
            <span className="annot-tile-meta muted">
                <span>
                    {d.highlights} 則重點{d.bookmarks > 0 && `、${d.bookmarks} 個書籤`}
                </span>
                <span className="annot-tile-spacer" />
                <span title="最後註解">{new Date(d.last).toLocaleDateString("zh-TW")}</span>
            </span>
        </button>
    );
}

/**
 * 所有註解: the documents that have annotations, as cards. Clicking one shows its annotations in
 * the right column (by chapter when it has a table of contents); double-click opens it.
 */
function Overview({ generation, selected, onSelect, onOpenFile, onError }: {
    generation: number;
    selected: number | null;
    onSelect: (attachmentId: number | null) => void;
    onOpenFile: (attachmentId: number) => void;
    onError: (m: string) => void;
}) {
    const [query, setQuery] = useState("");
    const [all, setAll] = useState<AnnotationInFile[] | null>(null);
    const [sort, setSortState] = useState<DocSort>(() => {
        const v = localStorage.getItem(DOC_SORT_KEY);
        return v === "title" || v === "count" ? v : "recent";
    });
    const setSort = (v: DocSort) => {
        setSortState(v);
        try {
            localStorage.setItem(DOC_SORT_KEY, v);
        } catch {
            /* this session only */
        }
    };
    useEffect(() => {
        let stale = false;
        const t = setTimeout(
            () => annotationApi.search(query.trim()).then((l) => !stale && setAll(l), (e) => onError(errorMessage(e))),
            query ? 200 : 0,
        );
        return () => {
            stale = true;
            clearTimeout(t);
        };
    }, [query, generation, onError]);

    const docs = useMemo(() => {
        const m = new Map<number, DocSummary>();
        // Newest first (the order the search returns).
        for (const a of all ?? []) {
            let d = m.get(a.attachmentId);
            if (!d) {
                d = { id: a.attachmentId, title: fileTitle(a), fileName: a.fileName, highlights: 0, bookmarks: 0, colors: new Map(), recent: [], last: 0 };
                m.set(a.attachmentId, d);
            }
            d.last = Math.max(d.last, a.updatedAt);
            if (a.kind === "bookmark") {
                d.bookmarks++;
                continue;
            }
            d.highlights++;
            d.colors.set(a.color, (d.colors.get(a.color) ?? 0) + 1);
            if (d.recent.length < PEEK && a.quote.trim()) d.recent.push(a);
        }
        const list = [...m.values()];
        if (sort === "title") list.sort((x, y) => x.title.localeCompare(y.title, "zh-Hant"));
        else if (sort === "count") list.sort((x, y) => y.highlights + y.bookmarks - (x.highlights + x.bookmarks) || y.last - x.last);
        else list.sort((x, y) => y.last - x.last);
        return list;
    }, [all, sort]);

    const total = (all ?? []).length;

    return (
        <div className="annotator-overview annot-lib">
            <div className="annot-lib-toolbar">
                <input
                    type="search"
                    className="annot-lib-search"
                    placeholder="搜尋重點、筆記、檔名…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && setQuery("")}
                />
                <select className="annot-lib-select" value={sort} onChange={(e) => setSort(e.target.value as DocSort)} title="排序">
                    <option value="recent">最近註解</option>
                    <option value="title">標題</option>
                    <option value="count">註解數</option>
                </select>
                <span className="muted annot-lib-count">{all ? `${docs.length} 份文件、${total} 則${query ? "符合" : ""}` : "載入中…"}</span>
            </div>
            <div
                className="annot-lib-body"
                onClick={(e) => {
                    if (!(e.target as HTMLElement).closest(".annot-doc")) onSelect(null);
                }}
            >
                {all !== null && docs.length === 0 && (
                    <p className="muted annot-lib-empty">
                        {query ? "沒有符合的註解" : "還沒有任何註解。打開 PDF 或電子書，選取文字就可以畫重點。"}
                        {query && (
                            <button className="link-btn" onClick={() => setQuery("")}>
                                清除搜尋
                            </button>
                        )}
                    </p>
                )}
                <div className="annot-lib-grid">
                    {docs.map((d) => (
                        <DocCard key={d.id} d={d} selected={d.id === selected} onSelect={() => onSelect(d.id)} onOpen={() => onOpenFile(d.id)} />
                    ))}
                </div>
            </div>
        </div>
    );
}

export default AnnotatorView;
