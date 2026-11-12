import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { errorMessage } from "../../drawer/api";
import { openBook, type Book } from "../../drawer/books";
import { MobiBook, KF8_NOTE } from "../../drawer/books/mobi";
import { TxtBook } from "../../drawer/books/txt";
import { Icon } from "../../icons/Icon";
import { ReaderMessage, useFileBytes, usePosition } from "./shared";
import SearchBar from "./SearchBar";
import { clearMarks, countMatches, markMatches, rangeOffsets, unwrapAll, wrapOffsets } from "./highlight";
import { COLORS, lastColor, openCardInWhiteboard, parseLocation, placeLabel, useAnnotations, type Annotation, type AnnotationColor } from "../../annotator/api";
import { AnnotationPopover, handleMenuKey, SelectionMenu } from "./AnnotationMenus";
import type { AnnotateProps } from "./PdfView";
import { isShown } from "../../tabs";

interface Position {
    chapter: number;
    /** Read fraction of the chapter. */
    at: number;
}

/** Where to go once a chapter is shown. */
interface Pending {
    at?: number;
    fragment?: string;
    end?: boolean;
    /** Search hit in the chapter to show. */
    hit?: number;
    /** Annotation to show and flash. */
    annot?: number;
}

/** Highlight colors inside the book's pages (the frame can't see the app's CSS). */
const ANNOT_RGB: Record<AnnotationColor, string> = {
    yellow: "255, 210, 0",
    green: "70, 200, 110",
    blue: "70, 150, 255",
    pink: "255, 100, 160",
    purple: "160, 100, 255",
};

interface Hit {
    chapter: number;
    n: number;
}

const FONT_SIZES = [14, 16, 18, 20, 22, 26, 30];
const FONT_KEY = "banyan.reader.epubFont";

/** Styles for the book's pages: the app's colors, a readable column, the chosen text size and direction. */
function readerCss(fontSize: number, dark: boolean, vertical: boolean, forceHorizontal: boolean) {
    // Same colors as the app's panes (--pane, --text, --accent in tokens.css).
    const [bg, fg, link] = dark ? ["#232322", "#e8e6e1", "#6bbd92"] : ["#ffffff", "#26251f", "#2f7a55"];
    const common = `
html { background: ${bg}; color: ${fg}; }
body { font-size: ${fontSize}px !important; line-height: 1.8; background: ${bg} !important; color: ${fg} !important;
       font-family: "Noto Serif TC", "Source Han Serif TC", "PMingLiU", Georgia, serif; word-wrap: break-word; }
a { color: ${link}; }
pre { white-space: pre-wrap; }
mark.reader-hit { background: rgba(255, 200, 0, .45); color: inherit; border-radius: 2px; }
mark.reader-hit.current { background: rgba(255, 140, 0, .75); }
mark.annot { color: inherit; cursor: pointer; border-radius: 2px; }
${COLORS.map((c) => `mark.annot-${c.id} { background: rgba(${ANNOT_RGB[c.id]}, ${dark ? 0.4 : 0.35}); }`).join("\n")}
mark.annot.has-note { border-bottom: 2px dotted currentColor; }
mark.annot.active { outline: 2px solid rgba(255, 120, 0, .75); outline-offset: 1px; }
mark.annot.flash { animation: annot-flash 1.6s ease-out; }
@keyframes annot-flash { 0%, 40% { outline: 3px solid rgba(255, 120, 0, .9); } 100% { outline: 3px solid transparent; } }`;
    if (vertical) {
        return `${common}
html { writing-mode: vertical-rl !important; -epub-writing-mode: vertical-rl; height: 100%; }
body { margin: 0 !important; padding: 40px 48px !important; height: auto; max-width: none !important; }
img, svg, video { max-height: calc(100vh - 80px) !important; max-width: none !important; width: auto; }`;
    }
    return `${common}
${forceHorizontal ? "*, html, body { writing-mode: horizontal-tb !important; -epub-writing-mode: horizontal-tb !important; }" : ""}
body { max-width: 42em; margin: 0 auto !important; padding: 32px 28px 64px !important; }
img, svg, video { max-width: 100% !important; height: auto; }`;
}

/**
 * A book (EPUB, MOBI/AZW, FB2, TXT), one chapter at a time: table of contents, search through the
 * whole book, text size, vertical / horizontal writing, remembered position.
 */
function BookView({ id, fileName, toolsEl, onError, onInfo, jumpTo, onActive }: { id: number; fileName: string; toolsEl: HTMLElement | null } & AnnotateProps) {
    const { data, error } = useFileBytes(id);
    const [book, setBook] = useState<Book | null>(null);
    const [failed, setFailed] = useState<string | null>(null);
    const { load, save } = usePosition<Position>(id);
    const [chapter, setChapter] = useState(() => load()?.chapter ?? 0);
    const [src, setSrc] = useState<string | null>(null);
    const [tocOpen, setTocOpen] = useState(false);
    const [fontSize, setFontSize] = useState(() => {
        const v = Number(localStorage.getItem(FONT_KEY));
        return FONT_SIZES.includes(v) ? v : 18;
    });
    /** The reader's choice for this book; null = the book's own direction. */
    const layoutKey = `banyan.reader.layout.${id}`;
    const [layout, setLayout] = useState<"vertical" | "horizontal" | null>(() => {
        try {
            const v = localStorage.getItem(layoutKey);
            return v === "vertical" || v === "horizontal" ? v : null;
        } catch {
            return null;
        }
    });
    const [note, setNote] = useState<string | null>(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [hits, setHits] = useState<Hit[]>([]);
    const [hitIndex, setHitIndex] = useState(-1);
    const [searching, setSearching] = useState(false);
    const frameRef = useRef<HTMLIFrameElement>(null);
    const ann = useAnnotations(id, onError);
    const annRef = useRef(ann.annotations);
    annRef.current = ann.annotations;
    const [selected, setSelected] = useState<{ x: number; y: number; quote: string; start: number; end: number } | null>(null);
    const [popover, setPopover] = useState<{ id: number; x: number; y: number; focusNote?: boolean } | null>(null);
    useEffect(() => {
        onActive?.(popover?.id ?? null);
        // The open highlight stands out in the text.
        const doc = frameRef.current?.contentDocument;
        doc?.querySelectorAll("mark.annot.active").forEach((m) => m.classList.remove("active"));
        if (popover) doc?.querySelectorAll(`mark.annot[data-annot="${popover.id}"]`).forEach((m) => m.classList.add("active"));
    }, [popover?.id]); // eslint-disable-line react-hooks/exhaustive-deps
    const pending = useRef<Pending | null>(load() ? { at: load()!.at } : null);

    const vertical = book ? (layout ?? (book.vertical ? "vertical" : "horizontal")) === "vertical" : false;

    useEffect(() => {
        if (!data) return;
        let stale = false;
        let opened: Book | null = null;
        openBook(fileName, data).then(
            (b) => {
                opened = b;
                if (stale) return b.close();
                if (b instanceof MobiBook && b.kf8) setNote(KF8_NOTE);
                if (b instanceof TxtBook && b.encoding !== "UTF-8") setNote(`文字編碼：${b.encoding}（自動判斷）`);
                setChapter((c) => Math.min(c, b.chapters.length - 1));
                setBook(b);
            },
            (e) => !stale && setFailed(errorMessage(e)),
        );
        return () => {
            stale = true;
            opened?.close();
        };
    }, [data, fileName]);

    // Build the chapter's page.
    useEffect(() => {
        if (!book) return;
        const n = Math.min(chapter, book.chapters.length - 1);
        let stale = false;
        let url: string | null = null;
        const root = document.documentElement;
        const dark = root.dataset.theme === "dark" || (root.dataset.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
        book.chapter(n, readerCss(fontSize, dark, vertical, book.vertical && !vertical)).then(
            ({ content, type }) => {
                if (stale) return;
                url = URL.createObjectURL(new Blob([content], { type }));
                setSrc(url);
            },
            (e) => !stale && setFailed(errorMessage(e)),
        );
        return () => {
            stale = true;
            if (url) URL.revokeObjectURL(url);
        };
    }, [book, chapter, fontSize, vertical]);

    const scroller = () => frameRef.current?.contentDocument?.scrollingElement as HTMLElement | null | undefined;
    /** How far through the chapter (0–1); vertical books scroll leftwards. */
    const progress = (el: HTMLElement) => {
        const max = vertical ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
        return max > 0 ? Math.min(1, Math.abs(vertical ? el.scrollLeft : el.scrollTop) / max) : 0;
    };
    const scrollToFraction = (el: HTMLElement, at: number) => {
        if (vertical) el.scrollLeft = -at * Math.max(0, el.scrollWidth - el.clientWidth);
        else el.scrollTop = at * Math.max(0, el.scrollHeight - el.clientHeight);
    };
    const atEnd = (el: HTMLElement) => progress(el) >= 0.999 || (vertical ? el.scrollWidth <= el.clientWidth + 2 : el.scrollHeight <= el.clientHeight + 2);
    const atStart = (el: HTMLElement) => progress(el) <= 0.001;

    const go = (n: number, where: Pending = { at: 0 }) => {
        if (!book) return;
        const next = Math.max(0, Math.min(book.chapters.length - 1, n));
        pending.current = where;
        setTocOpen(false);
        if (next === chapter) applyPending();
        else setChapter(next);
    };

    /**
     * Paints the chapter's highlights, then the search hits (in that order, so offsets line up).
     * Returns the search marks and the first mark of each highlight.
     */
    const paint = () => {
        const doc = frameRef.current?.contentDocument;
        const marks = new Map<number, HTMLElement>();
        if (!doc?.body) return { hits: [] as HTMLElement[], marks };
        clearMarks(doc.body);
        unwrapAll(doc.body, "mark.annot");
        for (const a of annRef.current) {
            const loc = parseLocation(a);
            if (loc?.type !== "book" || loc.chapter !== chapter) continue;
            const els = wrapOffsets(doc.body, loc.start, loc.end, () => {
                const m = doc.createElement("mark");
                m.className = `annot annot-${a.color}${a.note ? " has-note" : ""}`;
                m.dataset.annot = String(a.id);
                if (a.note) m.title = a.note;
                return m;
            });
            if (els[0]) marks.set(a.id, els[0]);
        }
        const hits = searchOpen && query.trim() ? markMatches(doc.body, query) : [];
        return { hits, marks };
    };
    const markHits = () => paint().hits;

    function applyPending() {
        const doc = frameRef.current?.contentDocument;
        const el = scroller();
        const { hits: marks, marks: annots } = paint();
        const cur = hits[hitIndex];
        if (cur && cur.chapter === chapter && marks[cur.n]) marks[cur.n].classList.add("current");
        const p = pending.current;
        pending.current = null;
        if (!doc || !el || !p) return;
        if (p.annot !== undefined && annots.get(p.annot)) {
            const m = annots.get(p.annot)!;
            m.scrollIntoView({ block: "center", inline: "center" });
            doc.querySelectorAll(`mark.annot[data-annot="${p.annot}"]`).forEach((x) => {
                x.classList.add("flash");
                setTimeout(() => x.classList.remove("flash"), 1700);
            });
        } else if (p.hit !== undefined && marks[p.hit]) marks[p.hit].scrollIntoView({ block: "center", inline: "center" });
        else if (p.fragment) doc.getElementById(p.fragment)?.scrollIntoView();
        else if (p.end) scrollToFraction(el, 1);
        else scrollToFraction(el, p.at ?? 0);
    }

    // Once the page is in the frame: position, links, keys, wheel, remembering where we are.
    const onFrameLoad = () => {
        const doc = frameRef.current?.contentDocument;
        if (!doc) return;
        applyPending();
        doc.addEventListener("click", (e) => {
            const a = (e.target as Element).closest?.("a");
            if (!a) return;
            e.preventDefault();
            const ext = a.getAttribute("data-external");
            const ch = a.getAttribute("data-chapter");
            if (ext) openUrl(ext).catch(() => window.open(ext, "_blank", "noopener"));
            else if (ch) {
                const [n, fragment] = ch.split("#");
                go(Number(n), fragment ? { fragment } : { at: 0 });
            } else if (a.getAttribute("href")?.startsWith("#")) {
                doc.getElementById(a.getAttribute("href")!.slice(1))?.scrollIntoView();
            }
        });
        doc.addEventListener("keydown", (e) => {
            if (!handleMenuKey(e)) onKey(e);
        });
        // Selecting text offers the highlight menu; clicking a highlight opens it.
        doc.addEventListener("mouseup", (e) => {
            const frame = frameRef.current?.getBoundingClientRect();
            if (!frame) return;
            const sel = doc.getSelection();
            if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
                const range = sel.getRangeAt(0);
                const off = rangeOffsets(doc.body, range);
                const quote = sel.toString().replace(/\s+/g, " ").trim();
                if (!off || !quote) return;
                const r = range.getBoundingClientRect();
                setPopover(null);
                setSelected({ x: frame.left + r.left + r.width / 2, y: frame.top + r.bottom + 8, quote, ...off });
                return;
            }
            setSelected(null);
            const mark = (e.target as Element).closest?.("mark.annot") as HTMLElement | null;
            if (mark?.dataset.annot) setPopover({ id: Number(mark.dataset.annot), x: frame.left + e.clientX, y: frame.top + e.clientY + 14 });
        });
        if (vertical) {
            // The mouse wheel scrolls a vertical book sideways, in reading direction.
            doc.addEventListener(
                "wheel",
                (e) => {
                    const el = scroller();
                    if (!el || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
                    e.preventDefault();
                    el.scrollLeft -= e.deltaY;
                },
                { passive: false },
            );
        }
        doc.addEventListener("scroll", () => {
            const el = scroller();
            if (el) save({ chapter, at: progress(el) });
            setSelected(null);
        });
        save({ chapter, at: scroller() ? progress(scroller()!) : 0 });
        frameRef.current?.contentWindow?.focus();
    };

    /**
     * Chapters: ← → (in a vertical book ← goes forward). Space / PageDown at the end of a chapter
     * continue into the next one. Ctrl+F searches. Esc passes on to close the reader.
     */
    const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
            e.preventDefault();
            setSearchOpen(true);
            return;
        }
        const el = scroller();
        const forward = vertical ? "ArrowLeft" : "ArrowRight";
        const back = vertical ? "ArrowRight" : "ArrowLeft";
        if (e.key === forward) go(chapter + 1);
        else if (e.key === back) go(chapter - 1);
        else if ((e.key === "PageDown" || (e.key === " " && !e.shiftKey)) && el) {
            e.preventDefault();
            if (atEnd(el)) go(chapter + 1);
            else if (vertical) el.scrollBy({ left: -el.clientWidth * 0.9 });
            else el.scrollBy({ top: el.clientHeight * 0.9 });
        } else if ((e.key === "PageUp" || (e.key === " " && e.shiftKey)) && el) {
            e.preventDefault();
            if (atStart(el)) go(chapter - 1, { end: true });
            else if (vertical) el.scrollBy({ left: el.clientWidth * 0.9 });
            else el.scrollBy({ top: -el.clientHeight * 0.9 });
        }
    };

    // ---------- annotations ----------

    // Repaint the chapter's highlights when they change (made, recolored, deleted elsewhere).
    useEffect(() => {
        if (frameRef.current?.contentDocument?.body) paint();
    }, [ann.annotations]); // eslint-disable-line react-hooks/exhaustive-deps

    const highlight = async (color: AnnotationColor, withNote: boolean) => {
        const s = selected;
        if (!s || !book) return;
        const a = await ann.create({
            kind: "highlight",
            color,
            quote: s.quote,
            note: "",
            location: { type: "book", chapter, start: s.start, end: s.end, label: book.chapters[chapter]?.label ?? "" },
            sortKey: chapter * 1e7 + s.start,
        });
        frameRef.current?.contentDocument?.getSelection()?.removeAllRanges();
        setSelected(null);
        if (a && withNote) setPopover({ id: a.id, x: s.x, y: s.y, focusNote: true });
    };

    /** A bookmark near the current place in this chapter. */
    const bookmarkHere = (): Annotation | undefined => {
        const el = scroller();
        const at = el ? progress(el) : 0;
        return ann.annotations.find((a) => {
            const loc = parseLocation(a);
            return loc?.type === "book-place" && loc.chapter === chapter && Math.abs(loc.at - at) < 0.08;
        });
    };
    const toggleBookmark = async () => {
        if (!book) return;
        const here = bookmarkHere();
        if (here) return void ann.remove(here.id);
        const el = scroller();
        const at = el ? progress(el) : 0;
        const label = book.chapters[chapter]?.label ?? "";
        await ann.create({ kind: "bookmark", color: "blue", quote: "", note: "", location: { type: "book-place", chapter, at, label }, sortKey: chapter * 1e7 + at * 1e6 });
        onInfo?.(`已在「${label}」加上書籤`);
    };

    const toCard = async (a: Annotation) => {
        if (a.cardId) return openCardInWhiteboard(a.cardId);
        const card = await ann.toCard(a.id, placeLabel(parseLocation(a)));
        if (card) onInfo?.("已建立卡片，可以在 Whiteboard 的卡片庫或這個條目的筆記卡片中找到");
    };

    // Go to an annotation picked elsewhere (the Annotator's list).
    useEffect(() => {
        if (!jumpTo || !book) return;
        const loc = parseLocation(jumpTo.annotation);
        if (loc?.type === "book") go(loc.chapter, { annot: jumpTo.annotation.id });
        else if (loc?.type === "book-place") go(loc.chapter, { at: loc.at });
    }, [jumpTo?.nonce, book]); // eslint-disable-line react-hooks/exhaustive-deps

    // ---------- search through the whole book ----------

    useEffect(() => {
        setHitIndex(-1);
        if (!book || !searchOpen || !query.trim()) {
            setHits([]);
            setSearching(false);
            markHits();
            return;
        }
        let stale = false;
        setSearching(true);
        const start = chapter;
        const t = setTimeout(async () => {
            const found: Hit[] = [];
            let chosen = false;
            for (let c = 0; c < book.chapters.length && !stale; c++) {
                const n = countMatches(await book.chapterText(c).catch(() => ""), query);
                for (let k = 0; k < n; k++) found.push({ chapter: c, n: k });
                const first = found.findIndex((h) => h.chapter >= start);
                if (!chosen && first >= 0) {
                    chosen = true;
                    setHits([...found]);
                    setHitIndex(first);
                } else if (c % 10 === 0) setHits([...found]);
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
    }, [book, searchOpen, query]); // eslint-disable-line react-hooks/exhaustive-deps

    // Go to the current hit.
    useEffect(() => {
        const cur = hits[hitIndex];
        if (cur) go(cur.chapter, { hit: cur.n });
    }, [hitIndex, hits]); // eslint-disable-line react-hooks/exhaustive-deps

    const nextHit = (dir: 1 | -1) => {
        if (hits.length > 0) setHitIndex((i) => (i + dir + hits.length) % hits.length);
    };

    useEffect(() => {
        const onWinKey = (e: KeyboardEvent) => {
            // Only the book on screen (not one in a hidden tab).
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f" && isShown(frameRef.current)) {
                e.preventDefault();
                setSearchOpen(true);
            }
        };
        window.addEventListener("keydown", onWinKey);
        return () => window.removeEventListener("keydown", onWinKey);
    }, []);

    if (error || failed) return <ReaderMessage>無法開啟這本書：{error ?? failed}</ReaderMessage>;
    if (!book) return <ReaderMessage>載入中…</ReaderMessage>;

    const keepPlace = () => {
        const el = scroller();
        pending.current = { at: el ? progress(el) : 0 };
    };
    const fi = FONT_SIZES.indexOf(fontSize);
    const setFont = (v: number) => {
        keepPlace();
        setFontSize(v);
        try {
            localStorage.setItem(FONT_KEY, String(v));
        } catch {
            /* this session only */
        }
    };
    const toggleLayout = () => {
        const next = vertical ? "horizontal" : "vertical";
        keepPlace();
        setLayout(next);
        try {
            localStorage.setItem(layoutKey, next);
        } catch {
            /* this session only */
        }
    };

    const tools: ReactNode = (
        <>
            <button className={`small-btn${tocOpen ? " active" : ""}`} onClick={() => setTocOpen((o) => !o)}>
                <Icon name="library" /> 目錄
            </button>
            <button className={`small-btn${searchOpen ? " active" : ""}`} onClick={() => setSearchOpen((o) => !o)} title="搜尋全書（Ctrl＋F）">
                <Icon name="search" /> 搜尋
            </button>
            <span className="reader-sep" />
            <button className="icon-btn" title={vertical ? "上一章（→）" : "上一章（←）"} disabled={chapter <= 0} onClick={() => go(chapter - 1)}><Icon name="chevronLeft" /></button>
            <span className="reader-count" title={book.chapters[chapter]?.label}>{chapter + 1} / {book.chapters.length}</span>
            <button className="icon-btn" title={vertical ? "下一章（←）" : "下一章（→）"} disabled={chapter >= book.chapters.length - 1} onClick={() => go(chapter + 1)}><Icon name="chevronRight" /></button>
            <span className="reader-sep" />
            <button className="small-btn" title="字變小" disabled={fi <= 0} onClick={() => setFont(FONT_SIZES[fi - 1])}>A−</button>
            <button className="small-btn" title="字變大" disabled={fi >= FONT_SIZES.length - 1} onClick={() => setFont(FONT_SIZES[fi + 1])}>A＋</button>
            <button className="small-btn" title="在目前的位置加上或移除書籤" onClick={toggleBookmark}>
                <Icon name="tag" /> 書籤
            </button>
            <button className="small-btn" title={vertical ? "改為橫排" : "改為直排（由右至左）"} onClick={toggleLayout}>
                {vertical ? "橫排" : "直排"}
            </button>
        </>
    );

    const current = book.chapters[chapter]?.path;
    const entries = book.toc.length > 0 ? book.toc : book.chapters.map((c) => ({ label: c.label, path: c.path, fragment: "", depth: 0 }));
    return (
        <div className="reader-epub">
            {toolsEl && createPortal(tools, toolsEl)}
            {tocOpen && (
                <nav className="reader-toc" aria-label="目錄">
                    {book.title && <div className="reader-toc-title">{book.title}</div>}
                    <ul>
                        {entries.map((t, i) => {
                            const n = book.chapters.findIndex((c) => c.path === t.path);
                            return (
                                <li key={i}>
                                    <button
                                        className={t.path === current ? "active" : ""}
                                        style={{ paddingLeft: 12 + t.depth * 14 }}
                                        disabled={n < 0}
                                        onClick={() => go(n, t.fragment ? { fragment: t.fragment } : { at: 0 })}
                                    >
                                        <span className="reader-toc-label">{t.label}</span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </nav>
            )}
            <div className="reader-pdf-main">
                {note && (
                    <div className="reader-note">
                        {note}
                        <button className="icon-btn" title="關閉" onClick={() => setNote(null)}><Icon name="close" /></button>
                    </div>
                )}
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
                            frameRef.current?.contentWindow?.focus();
                        }}
                    />
                )}
                {src && (
                    <iframe
                        ref={frameRef}
                        className="reader-epub-frame"
                        title={book.chapters[chapter]?.label ?? "內容"}
                        sandbox="allow-same-origin"
                        src={src}
                        onLoad={onFrameLoad}
                    />
                )}
            </div>
            {selected && (
                <SelectionMenu
                    x={selected.x}
                    y={selected.y}
                    onColor={(c) => highlight(c, false)}
                    onNote={() => highlight(lastColor(), true)}
                    onCopy={() => {
                        navigator.clipboard?.writeText(selected.quote).then(() => onInfo?.("已複製"), () => {});
                        frameRef.current?.contentDocument?.getSelection()?.removeAllRanges();
                        setSelected(null);
                    }}
                    onDismiss={() => {
                        frameRef.current?.contentDocument?.getSelection()?.removeAllRanges();
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

export default BookView;
