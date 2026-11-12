import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { drawerApi, errorMessage } from "../../drawer/api";
import { Icon } from "../../icons/Icon";
import { openPdf, openPdfUrl, pageText, pdfOutline, renderPage, renderTextLayer, type OutlineEntry } from "../../whiteboard/pdf";
import { ReaderMessage, usePosition } from "./shared";
import SearchBar from "./SearchBar";
import { clearMarks, countMatches, markMatches, textRects } from "./highlight";
import { lastColor, openCardInWhiteboard, parseLocation, placeLabel, useAnnotations, type Annotation, type AnnotationColor } from "../../annotator/api";
import { AnnotationPopover, SelectionMenu } from "./AnnotationMenus";
import { isShown } from "../../tabs";

/** Fit the window's width, the whole page, or a fixed zoom (1 = 100%, 800px wide pages). */
type Zoom = "width" | "page" | number;
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const BASE = 800;
const GAP = 12;
const ZOOM_KEY = "banyan.reader.pdfZoom";

function loadZoom(): Zoom {
    try {
        const v = localStorage.getItem(ZOOM_KEY);
        if (v === "width" || v === "page") return v;
        const n = Number(v);
        return ZOOMS.includes(n) ? n : "width";
    } catch {
        return "width";
    }
}

/**
 * Opens the PDF by streaming it (only the parts needed are read); falls back to reading the whole
 * file when streaming isn't possible.
 */
async function openAttachmentPdf(id: number): Promise<PDFDocumentProxy> {
    try {
        return await openPdfUrl(drawerApi.attachmentUrl(id));
    } catch {
        return openPdf(await drawerApi.readAttachment(id));
    }
}

/**
 * Open PDF attachments, shared by everything showing the same file (the reader and the
 * annotation list's table of contents), so a file is opened once. Released a moment after the
 * last user lets go, so a remount (or going back and forth) doesn't open it again.
 */
const shared = new Map<number, { doc: Promise<PDFDocumentProxy>; users: number; timer?: number }>();
function acquirePdf(id: number): Promise<PDFDocumentProxy> {
    let e = shared.get(id);
    if (!e) {
        e = { doc: openAttachmentPdf(id), users: 0 };
        const entry = e;
        e.doc.catch(() => shared.get(id) === entry && shared.delete(id));
        shared.set(id, e);
    }
    window.clearTimeout(e.timer);
    e.users++;
    return e.doc;
}
function releasePdf(id: number) {
    const e = shared.get(id);
    if (!e) return;
    e.users--;
    if (e.users > 0) return;
    window.clearTimeout(e.timer);
    e.timer = window.setTimeout(() => {
        if (shared.get(id) !== e || e.users > 0) return;
        shared.delete(id);
        e.doc.then((d) => d.loadingTask.destroy(), () => {});
    }, 1500);
}

const outlines = new Map<number, Promise<OutlineEntry[]>>();
/**
 * A PDF attachment's table of contents (its bookmarks), read once and kept; empty when it has
 * none or can't be read. Used to group annotations by chapter.
 */
export function attachmentOutline(id: number): Promise<OutlineEntry[]> {
    let p = outlines.get(id);
    if (!p) {
        p = acquirePdf(id)
            .then((d) => pdfOutline(d))
            .finally(() => releasePdf(id));
        const mine = p;
        p.catch(() => outlines.get(id) === mine && outlines.delete(id));
        outlines.set(id, p);
    }
    return p;
}

interface Hit {
    page: number;
    /** Which hit on that page. */
    n: number;
}

/** Props the reader views share for annotating. */
export interface AnnotateProps {
    onError?: (message: string) => void;
    onInfo?: (message: string) => void;
    /** Go to (and flash) this annotation; a new nonce goes there again. */
    jumpTo?: { annotation: Annotation; nonce: number } | null;
    /** An annotation was opened in the text (its popover), or null when it closed. */
    onActive?: (id: number | null) => void;
}

/** Text selected on the pages, waiting for a color. */
interface PdfSelection {
    x: number;
    y: number;
    quote: string;
    rects: [number, number, number, number, number][];
}

/**
 * A PDF as one scrolling column of pages, drawn (with selectable text) as they come into view.
 * Table of contents, search (Ctrl+F), fit width / fit page / zoom, page numbers; highlights with
 * notes and bookmarks (Annotator).
 */
function PdfView({ id, toolsEl, onError, onInfo, jumpTo, onActive }: { id: number; toolsEl: HTMLElement | null } & AnnotateProps) {
    const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
    const [failed, setFailed] = useState<string | null>(null);
    /** Height / width of each page (the first page's until a page is measured). */
    const [ratios, setRatios] = useState<number[]>([]);
    const [zoom, setZoomState] = useState<Zoom>(loadZoom);
    const [box, setBox] = useState({ w: 800, h: 600 });
    const [page, setPage] = useState(1);
    const [pageInput, setPageInput] = useState("1");
    const [outline, setOutline] = useState<OutlineEntry[] | null>(null);
    const [sideOpen, setSideOpen] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [hits, setHits] = useState<Hit[]>([]);
    const [hitIndex, setHitIndex] = useState(-1);
    const [searching, setSearching] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const canvases = useRef(new Map<number, HTMLCanvasElement>());
    const texts = useRef(new Map<number, HTMLDivElement>());
    /** Width each page's canvas / text layer was last drawn at. */
    const drawn = useRef(new Map<number, number>());
    const textDrawn = useRef(new Map<number, number>());
    const { load, save } = usePosition<number>(id);
    const restored = useRef(false);
    const ann = useAnnotations(id, onError);
    const pageEls = useRef(new Map<number, HTMLDivElement>());
    const [selected, setSelected] = useState<PdfSelection | null>(null);
    const [popover, setPopover] = useState<{ id: number; x: number; y: number; focusNote?: boolean } | null>(null);
    useEffect(() => {
        onActive?.(popover?.id ?? null);
    }, [popover?.id]); // eslint-disable-line react-hooks/exhaustive-deps
    const [flash, setFlash] = useState<number | null>(null);

    useEffect(() => {
        let stale = false;
        // Released when the view goes away (another file, or the reader closed), so paging
        // through PDFs doesn't keep every one of them in memory.
        acquirePdf(id).then(
            async (d) => {
                if (stale) return;
                const first = (await d.getPage(1)).getViewport({ scale: 1 });
                if (stale) return;
                setRatios(Array(d.numPages).fill(first.height / first.width));
                setDoc(d);
                attachmentOutline(id).then((o) => !stale && setOutline(o), () => !stale && setOutline([]));
            },
            (e) => !stale && setFailed(errorMessage(e)),
        );
        return () => {
            stale = true;
            releasePdf(id);
        };
    }, [id]);

    // Follow the window's size.
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
        ro.observe(el);
        return () => ro.disconnect();
    }, [doc]);

    const fitWidth = Math.max(200, box.w - 48);
    const width = Math.round(
        zoom === "width"
            ? fitWidth
            : zoom === "page"
              ? Math.min(fitWidth, (box.h - 2 * GAP) / (ratios[page - 1] ?? 1.4))
              : BASE * zoom,
    );
    const tops: number[] = [];
    let y = GAP;
    for (const r of ratios) {
        tops.push(y);
        y += Math.round(width * r) + GAP;
    }
    const total = y;
    const topsRef = useRef(tops);
    topsRef.current = tops;

    const scrollToPage = useCallback((n: number) => {
        const t = topsRef.current;
        const p = Math.max(1, Math.min(t.length, n));
        scrollRef.current?.scrollTo({ top: t[p - 1] - GAP });
    }, []);

    /** Marks the search hits in a page's text layer; the current hit is scrolled into view. */
    const markPage = useCallback(
        (n: number, reveal: boolean) => {
            const layer = texts.current.get(n);
            if (!layer) return;
            clearMarks(layer);
            if (!searchOpen || !query.trim()) return;
            const marks = markMatches(layer, query);
            const cur = hits[hitIndex];
            if (cur && cur.page === n && marks[cur.n]) {
                marks[cur.n].classList.add("current");
                if (reveal) marks[cur.n].scrollIntoView({ block: "center", inline: "nearest" });
            }
        },
        [searchOpen, query, hits, hitIndex],
    );
    const markPageRef = useRef(markPage);
    markPageRef.current = markPage;

    // Draw the pages in or near view (canvas, then text layer); redraw when the width changes.
    const drawVisible = () => {
        const el = scrollRef.current;
        if (!doc || !el) return;
        const top = el.scrollTop - el.clientHeight;
        const bottom = el.scrollTop + el.clientHeight * 2;
        tops.forEach((t, i) => {
            const n = i + 1;
            const h = Math.round(width * ratios[i]);
            if (t + h < top || t > bottom) return;
            const canvas = canvases.current.get(n);
            if (canvas && drawn.current.get(n) !== width) {
                drawn.current.set(n, width);
                renderPage(doc, n, canvas, width).then(
                    (realH) => {
                        canvas.style.width = `${width}px`;
                        canvas.style.height = `${realH}px`;
                        const r = realH / width;
                        if (Math.abs(r - ratios[i]) > 0.001) setRatios((prev) => prev.map((v, j) => (j === i ? r : v)));
                    },
                    () => drawn.current.delete(n),
                );
            }
            const layer = texts.current.get(n);
            if (layer && textDrawn.current.get(n) !== width) {
                textDrawn.current.set(n, width);
                renderTextLayer(doc, n, layer, width).then(
                    () => markPageRef.current(n, true),
                    () => textDrawn.current.delete(n),
                );
            }
        });
        const mid = el.scrollTop + el.clientHeight / 3;
        let current = 1;
        tops.forEach((t, i) => {
            if (t <= mid) current = i + 1;
        });
        setPage(current);
    };
    useEffect(drawVisible); // eslint-disable-line react-hooks/exhaustive-deps

    // Back to the page read last time.
    useEffect(() => {
        if (!doc || restored.current || ratios.length === 0) return;
        restored.current = true;
        const last = load();
        if (last && last > 1) requestAnimationFrame(() => scrollToPage(last));
    }); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        setPageInput(String(page));
        if (restored.current) save(page);
    }, [page, save]);

    const setZoom = (z: Zoom) => {
        const keep = page;
        setZoomState(z);
        try {
            localStorage.setItem(ZOOM_KEY, String(z));
        } catch {
            /* this session only */
        }
        requestAnimationFrame(() => requestAnimationFrame(() => scrollToPage(keep)));
    };
    const shownZoom = width / BASE;
    const stepZoom = (dir: 1 | -1) => {
        const next = dir > 0 ? ZOOMS.find((z) => z > shownZoom + 0.01) : [...ZOOMS].reverse().find((z) => z < shownZoom - 0.01);
        if (next) setZoom(next);
    };

    // ---------- annotations ----------

    /** Highlight rectangles per page: [annotation id, color, x, y, w, h]. */
    const rectsByPage = new Map<number, [number, AnnotationColor, number, number, number, number][]>();
    /** Highlights with a note (their last rectangle gets a small mark). */
    const noted = new Set<number>();
    const bookmarkedPages = new Map<number, Annotation>();
    for (const a of ann.annotations) {
        const loc = parseLocation(a);
        if (loc?.type === "pdf") {
            if (a.note) noted.add(a.id);
            for (const [p, x, y2, w, h] of loc.rects) {
                if (!rectsByPage.has(p)) rectsByPage.set(p, []);
                rectsByPage.get(p)!.push([a.id, a.color, x, y2, w, h]);
            }
        } else if (loc?.type === "pdf-page") bookmarkedPages.set(loc.page, a);
    }

    /** Text selected on the pages: offer the highlight menu. A plain click on a highlight opens it. */
    const onPagesMouseUp = (e: React.MouseEvent) => {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            if (!scrollRef.current?.contains(range.commonAncestorContainer)) return;
            const rects: PdfSelection["rects"] = [];
            for (const r of textRects(range)) {
                const cx = r.left + r.width / 2;
                const cy = r.top + r.height / 2;
                for (const [n, el] of pageEls.current) {
                    const pr = el.getBoundingClientRect();
                    if (cx >= pr.left && cx <= pr.right && cy >= pr.top && cy <= pr.bottom) {
                        const f = (v: number) => Math.round(v * 10000) / 10000;
                        rects.push([n, f((r.left - pr.left) / pr.width), f((r.top - pr.top) / pr.height), f(r.width / pr.width), f(r.height / pr.height)]);
                        break;
                    }
                }
            }
            if (rects.length === 0) return;
            const box = range.getBoundingClientRect();
            setPopover(null);
            setSelected({ x: box.left + box.width / 2, y: box.bottom + 8, quote: sel.toString().replace(/\s+/g, " ").trim(), rects });
            return;
        }
        setSelected(null);
        const hit = annotationAt(e.clientX, e.clientY);
        if (hit !== null) setPopover({ id: hit, x: e.clientX, y: e.clientY + 14 });
    };

    /** The highlight under the pointer (the newest when they overlap). */
    const annotationAt = (cx: number, cy: number): number | null => {
        for (const [n, el] of pageEls.current) {
            const pr = el.getBoundingClientRect();
            if (cx < pr.left || cx > pr.right || cy < pr.top || cy > pr.bottom) continue;
            const fx = (cx - pr.left) / pr.width;
            const fy = (cy - pr.top) / pr.height;
            const hit = [...(rectsByPage.get(n) ?? [])].reverse().find(([, , x, y2, w, h]) => fx >= x && fx <= x + w && fy >= y2 && fy <= y2 + h);
            return hit ? hit[0] : null;
        }
        return null;
    };

    /** Over a highlight: a pointing hand, and its note as a tooltip (like a book's). */
    const hoverRef = useRef<number | null>(null);
    const onPagesMouseMove = (e: React.MouseEvent) => {
        if (e.buttons !== 0) return; // selecting
        const hit = annotationAt(e.clientX, e.clientY);
        if (hit === hoverRef.current) return;
        hoverRef.current = hit;
        const el = scrollRef.current;
        if (!el) return;
        el.classList.toggle("over-annot", hit !== null);
        const a = hit === null ? undefined : ann.annotations.find((x) => x.id === hit);
        el.title = a ? a.note || "點一下編輯重點" : "";
    };

    const highlight = async (color: AnnotationColor, withNote: boolean) => {
        const s = selected;
        if (!s) return;
        const first = Math.min(...s.rects.map((r) => r[0]));
        const top = Math.min(...s.rects.filter((r) => r[0] === first).map((r) => r[2]));
        const a = await ann.create({ kind: "highlight", color, quote: s.quote, note: "", location: { type: "pdf", page: first, rects: s.rects }, sortKey: first + top });
        window.getSelection()?.removeAllRanges();
        setSelected(null);
        if (a && withNote) setPopover({ id: a.id, x: s.x, y: s.y, focusNote: true });
    };

    const toggleBookmark = async () => {
        const here = bookmarkedPages.get(page);
        if (here) await ann.remove(here.id);
        else {
            await ann.create({ kind: "bookmark", color: "blue", quote: "", note: "", location: { type: "pdf-page", page }, sortKey: page });
            onInfo?.(`已在第 ${page} 頁加上書籤`);
        }
    };

    const toCard = async (a: Annotation) => {
        if (a.cardId) return openCardInWhiteboard(a.cardId);
        const card = await ann.toCard(a.id, placeLabel(parseLocation(a)));
        if (card) onInfo?.("已建立卡片，可以在 Whiteboard 的卡片庫或這個條目的筆記卡片中找到");
    };

    // Go to an annotation picked elsewhere (the Annotator's list), and flash it.
    useEffect(() => {
        if (!jumpTo || !doc || ratios.length === 0) return;
        const loc = parseLocation(jumpTo.annotation);
        if (!loc || (loc.type !== "pdf" && loc.type !== "pdf-page")) return;
        const t = topsRef.current;
        const p = Math.max(1, Math.min(t.length, loc.page));
        const y0 = loc.type === "pdf" ? Math.min(...loc.rects.filter((r) => r[0] === p).map((r) => r[2])) : 0;
        const h = (t[p] ?? t[p - 1] + width * ratios[p - 1]) - t[p - 1];
        scrollRef.current?.scrollTo({ top: Math.max(0, t[p - 1] + (Number.isFinite(y0) ? y0 : 0) * h - 120) });
        setFlash(jumpTo.annotation.id);
        const off = setTimeout(() => setFlash(null), 1600);
        return () => clearTimeout(off);
    }, [jumpTo?.nonce, doc, ratios.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

    // ---------- search ----------

    // Look through every page's text for the query (in order; results show as they come).
    useEffect(() => {
        setHitIndex(-1);
        if (!doc || !searchOpen || !query.trim()) {
            setHits([]);
            setSearching(false);
            return;
        }
        let stale = false;
        setSearching(true);
        const startPage = page;
        const t = setTimeout(async () => {
            const found: Hit[] = [];
            let chosen = false;
            for (let n = 1; n <= doc.numPages && !stale; n++) {
                const c = countMatches(await pageText(doc, n).catch(() => ""), query);
                for (let k = 0; k < c; k++) found.push({ page: n, n: k });
                // Start at the first hit on or after the page being read.
                const first = found.findIndex((h) => h.page >= startPage);
                if (!chosen && first >= 0) {
                    chosen = true;
                    setHits([...found]);
                    setHitIndex(first);
                } else if (n % 25 === 0) setHits([...found]);
            }
            if (stale) return;
            setHits(found);
            if (!chosen) setHitIndex(found.length > 0 ? 0 : -1);
            setSearching(false);
        }, 250);
        return () => {
            stale = true;
            clearTimeout(t);
        };
    }, [doc, searchOpen, query]); // eslint-disable-line react-hooks/exhaustive-deps

    // Show the current hit: go to its page, and re-mark the pages already drawn.
    useEffect(() => {
        const cur = hits[hitIndex];
        if (cur) scrollToPage(cur.page);
        texts.current.forEach((_, n) => markPage(n, true));
    }, [hitIndex, hits, markPage, scrollToPage]);

    const nextHit = (dir: 1 | -1) => {
        if (hits.length === 0) return;
        setHitIndex((i) => (i + dir + hits.length) % hits.length);
    };

    // Ctrl+F opens the search.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            // Only the PDF on screen (not one in a hidden tab).
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f" && isShown(scrollRef.current)) {
                e.preventDefault();
                setSearchOpen(true);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    if (failed) return <ReaderMessage>無法讀取 PDF：{failed}</ReaderMessage>;
    if (!doc) return <ReaderMessage>載入中…</ReaderMessage>;

    const currentBookmark = outline ? outline.reduce((best, o, i) => (o.page !== null && o.page <= page ? i : best), -1) : -1;
    const tools: ReactNode = (
        <>
            <button className={`small-btn${sideOpen ? " active" : ""}`} onClick={() => setSideOpen((o) => !o)} title="PDF 的目錄（書籤）">
                <Icon name="library" /> 目錄
            </button>
            <button className={`small-btn${bookmarkedPages.has(page) ? " active" : ""}`} onClick={toggleBookmark} title={bookmarkedPages.has(page) ? "移除這一頁的書籤" : "在這一頁加上書籤"}>
                <Icon name="tag" /> 書籤
            </button>
            <button className={`small-btn${searchOpen ? " active" : ""}`} onClick={() => setSearchOpen((o) => !o)} title="搜尋（Ctrl＋F）">
                <Icon name="search" /> 搜尋
            </button>
            <span className="reader-sep" />
            <input
                className="reader-page-input"
                value={pageInput}
                aria-label="頁碼"
                onChange={(e) => setPageInput(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") scrollToPage(Number(pageInput) || 1);
                }}
            />
            <span className="reader-count">/ {doc.numPages}</span>
            <span className="reader-sep" />
            <button className="icon-btn" title="縮小" onClick={() => stepZoom(-1)}><Icon name="zoomOut" /></button>
            <select
                className="reader-zoom-select"
                aria-label="縮放"
                value={typeof zoom === "number" ? String(zoom) : zoom}
                onChange={(e) => {
                    const v = e.target.value;
                    setZoom(v === "width" || v === "page" ? v : Number(v));
                }}
            >
                <option value="width">符合寬度（{Math.round(fitWidth / BASE * 100)}%）</option>
                <option value="page">整頁</option>
                {ZOOMS.map((z) => (
                    <option key={z} value={String(z)}>{Math.round(z * 100)}%</option>
                ))}
            </select>
            <button className="icon-btn" title="放大" onClick={() => stepZoom(1)}><Icon name="zoomIn" /></button>
        </>
    );

    return (
        <div className="reader-pdf-wrap">
            {toolsEl && createPortal(tools, toolsEl)}
            {sideOpen && (
                <nav className="reader-toc" aria-label="目錄">
                    {outline === null ? (
                        <p className="muted reader-toc-note">讀取中…</p>
                    ) : outline.length === 0 ? (
                        <p className="muted reader-toc-note">這個 PDF 沒有目錄。</p>
                    ) : (
                        <ul>
                            {outline.map((o, i) => (
                                <li key={i}>
                                    <button
                                        style={{ paddingLeft: 12 + o.depth * 14 }}
                                        disabled={o.page === null}
                                        className={i === currentBookmark ? "active" : ""}
                                        onClick={() => o.page && scrollToPage(o.page)}
                                    >
                                        <span className="reader-toc-label">{o.title}</span>
                                        {o.page && <span className="reader-toc-page">{o.page}</span>}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </nav>
            )}
            <div className="reader-pdf-main">
                {searchOpen && (
                    <SearchBar
                        query={query}
                        onQuery={setQuery}
                        current={hitIndex}
                        total={hits.length}
                        searching={searching}
                        onPrev={() => nextHit(-1)}
                        onNext={() => nextHit(1)}
                        onClose={() => {
                            setSearchOpen(false);
                            scrollRef.current?.focus();
                        }}
                    />
                )}
                <div
                    ref={scrollRef}
                    className="reader-scroll reader-pdf"
                    tabIndex={0}
                    onScroll={drawVisible}
                    onMouseUp={onPagesMouseUp}
                    onMouseMove={onPagesMouseMove}
                    onKeyDown={(e) => {
                        if (e.key === "PageDown" || e.key === "ArrowRight") {
                            e.preventDefault();
                            scrollToPage(page + 1);
                        } else if (e.key === "PageUp" || e.key === "ArrowLeft") {
                            e.preventDefault();
                            scrollToPage(page - 1);
                        } else if (e.key === "Home") scrollToPage(1);
                        else if (e.key === "End") scrollToPage(ratios.length);
                    }}
                >
                    <div style={{ height: total, minWidth: width + 48, position: "relative" }}>
                        {tops.map((t, i) => (
                            <div
                                key={i}
                                className="reader-pdf-page"
                                style={{ top: t, width, height: Math.round(width * ratios[i]), left: `max(24px, calc(50% - ${width / 2}px))` }}
                                ref={(d) => {
                                    if (d) pageEls.current.set(i + 1, d);
                                    else pageEls.current.delete(i + 1);
                                }}
                            >
                                <canvas
                                    ref={(c) => {
                                        if (c) canvases.current.set(i + 1, c);
                                        else canvases.current.delete(i + 1);
                                    }}
                                />
                                {rectsByPage.has(i + 1) && (
                                    <div className="annot-layer">
                                        {rectsByPage.get(i + 1)!.map(([aid, color, x, y2, w, h], k, all) => (
                                            <div
                                                key={`${aid}-${k}`}
                                                className={`annot-rect annot-bg-${color}${flash === aid ? " flash" : ""}${popover?.id === aid ? " active" : ""}${noted.has(aid) && !all.slice(k + 1).some((r) => r[0] === aid) ? " noted" : ""}`}
                                                style={{ left: `${x * 100}%`, top: `${y2 * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
                                            />
                                        ))}
                                    </div>
                                )}
                                {bookmarkedPages.has(i + 1) && <div className={`annot-page-mark${flash === bookmarkedPages.get(i + 1)!.id ? " flash" : ""}`} title="書籤" />}
                                <div
                                    className="textLayer"
                                    ref={(d) => {
                                        if (d) texts.current.set(i + 1, d);
                                        else texts.current.delete(i + 1);
                                    }}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            {selected && (
                <SelectionMenu
                    x={selected.x}
                    y={selected.y}
                    onColor={(c) => highlight(c, false)}
                    onNote={() => highlight(lastColor(), true)}
                    onCopy={() => {
                        navigator.clipboard?.writeText(selected.quote).then(() => onInfo?.("已複製"), () => {});
                        window.getSelection()?.removeAllRanges();
                        setSelected(null);
                    }}
                    onDismiss={() => {
                        window.getSelection()?.removeAllRanges();
                        setSelected(null);
                    }}
                />
            )}
            {popover && (() => {
                const a = ann.annotations.find((x) => x.id === popover.id);
                if (!a) return null;
                return (
                    <AnnotationPopover
                        key={a.id}
                        annotation={a}
                        x={popover.x}
                        y={popover.y}
                        focusNote={popover.focusNote}
                        onClose={() => setPopover(null)}
                        onColor={(c) => ann.update(a.id, { color: c })}
                        onNote={(note) => ann.update(a.id, { note })}
                        onCard={() => toCard(a)}
                        onDelete={() => {
                            ann.remove(a.id);
                            setPopover(null);
                        }}
                    />
                );
            })()}
        </div>
    );
}

export default PdfView;
