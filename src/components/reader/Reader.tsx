import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { drawerApi, errorMessage } from "../../drawer/api";
import { Icon } from "../../icons/Icon";
import { previewKind } from "../drawer/FilePreview";
import PdfView from "./PdfView";
import BookView from "./BookView";
import ComicView from "./ComicView";
import { isBookFile, isComicFile } from "../../drawer/books";
import { ReaderMessage, useFileBytes, usePosition, useStreamUrl } from "./shared";
import "./Reader.css";
import { isHomeActive, openFileTab, opensInTab, withoutExtension } from "../../tabs";

/** A file the reader can show: an attachment, or a gallery item's picture. */
export interface ReaderFile {
    id: number;
    fileName: string;
    /** Overrides the kind guessed from the file name (gallery pictures). */
    kind?: ReaderKind;
}

export type ReaderKind = "pdf" | "book" | "comic" | "image" | "video" | "audio" | "text";

export function readerKind(file: ReaderFile): ReaderKind | null {
    if (file.kind) return file.kind;
    // EPUB, MOBI/AZW, FB2 and TXT open as books (chapters, search, text size).
    if (isBookFile(file.fileName)) return "book";
    if (isComicFile(file.fileName)) return "comic";
    return previewKind(file.fileName);
}

/** Can the reader show this file (otherwise it opens in the system's default program)? */
export const canRead = (file: ReaderFile) => readerKind(file) !== null;

interface Props {
    files: ReaderFile[];
    index: number;
    onClose: () => void;
    onError: (message: string) => void;
    onInfo?: (message: string) => void;
}

/**
 * Full-window reader: PDFs (pages, bookmarks, search, selectable text), books (EPUB, MOBI/AZW,
 * FB2, TXT), comics (CBZ), pictures (zoom, pan), videos and audio (streamed), and text.
 * ‹ › (or ← → on pictures) go through the other files. Each view puts its tools into the bar.
 */
function Reader({ files, index: startIndex, onClose, onError, onInfo }: Props) {
    const [index, setIndex] = useState(Math.min(startIndex, files.length - 1));
    /** Where the current view renders its tools (zoom, pages, chapters) with a portal. */
    const [toolsEl, setToolsEl] = useState<HTMLDivElement | null>(null);
    const file = files[index];
    const kind = readerKind(file);
    const hasPrev = index > 0;
    const hasNext = index < files.length - 1;

    const go = useCallback((delta: number) => {
        setIndex((i) => Math.max(0, Math.min(files.length - 1, i + delta)));
    }, [files.length]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!isHomeActive()) return; // a file tab is shown over it
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            } else if (kind === "image" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                e.preventDefault();
                go(e.key === "ArrowLeft" ? -1 : 1);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [kind, go, onClose]);

    const openExternally = () => drawerApi.openAttachment(file.id).catch((e) => onError(errorMessage(e)));

    let view: ReactNode;
    if (kind === "pdf") view = <PdfView key={file.id} id={file.id} toolsEl={toolsEl} onError={onError} onInfo={onInfo} />;
    else if (kind === "book") view = <BookView key={file.id} id={file.id} fileName={file.fileName} toolsEl={toolsEl} onError={onError} onInfo={onInfo} />;
    else if (kind === "comic") view = <ComicView key={file.id} id={file.id} toolsEl={toolsEl} />;
    else if (kind === "image") view = <ImageView key={file.id} id={file.id} toolsEl={toolsEl} />;
    else if (kind === "video" || kind === "audio") view = <MediaView key={file.id} id={file.id} kind={kind} />;
    else if (kind === "text") view = <TextView key={file.id} id={file.id} />;
    else
        view = (
            <ReaderMessage>
                <p>Banyan 還不能直接閱讀這種檔案。</p>
                <button className="primary-btn" onClick={openExternally}>用預設程式開啟</button>
            </ReaderMessage>
        );

    return (
        <div className="reader" role="dialog" aria-label={`閱讀：${file.fileName}`}>
            <header className="reader-bar">
                {files.length > 1 && (
                    <div className="reader-files">
                        <button className="icon-btn" title="上一個檔案" disabled={!hasPrev} onClick={() => go(-1)}>
                            <Icon name="chevronLeft" />
                        </button>
                        <span className="reader-count">{index + 1} / {files.length}</span>
                        <button className="icon-btn" title="下一個檔案" disabled={!hasNext} onClick={() => go(1)}>
                            <Icon name="chevronRight" />
                        </button>
                    </div>
                )}
                <span className="reader-title" title={file.fileName}>{file.fileName}</span>
                <div className="reader-tools" ref={setToolsEl} />
                {!file.kind && opensInTab(file.fileName) && (
                    <button
                        className="secondary-btn"
                        onClick={() => {
                            const itemId = (file as ReaderFile & { itemId?: number }).itemId ?? null;
                            openFileTab({ attachmentId: file.id, fileName: file.fileName, title: withoutExtension(file.fileName), itemId });
                            onClose();
                        }}
                        title="在分頁中開啟，可以畫重點、和其他檔案切換"
                    >
                        在分頁開啟
                    </button>
                )}
                <button className="secondary-btn" onClick={openExternally} title="用系統預設的程式開啟">預設程式開啟</button>
                <button className="icon-btn reader-close" title="關閉（Esc）" onClick={onClose}>
                    <Icon name="close" />
                </button>
            </header>
            <div className="reader-body">{view}</div>
        </div>
    );
}

// ---------- pictures ----------

const ZOOMS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];

function ImageView({ id, toolsEl }: { id: number; toolsEl: HTMLElement | null }) {
    const { url, error } = useStreamUrl(id);
    /** null = fit the window. */
    const [zoom, setZoom] = useState<number | null>(null);
    const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
    const boxRef = useRef<HTMLDivElement>(null);
    const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

    /** The zoom "fit" currently amounts to. */
    const fitZoom = () => {
        const box = boxRef.current;
        if (!box || !natural) return 1;
        return Math.min(1, box.clientWidth / natural.w, box.clientHeight / natural.h);
    };
    const step = (dir: 1 | -1) => {
        const current = zoom ?? fitZoom();
        const next = dir > 0 ? ZOOMS.find((z) => z > current + 1e-6) : [...ZOOMS].reverse().find((z) => z < current - 1e-6);
        setZoom(next ?? current);
    };

    const shown = Math.round((zoom ?? fitZoom()) * 100);
    const tools = (
            <>
                <button className="icon-btn" title="縮小" onClick={() => step(-1)}><Icon name="zoomOut" /></button>
                <span className="reader-zoom">{shown}%</span>
                <button className="icon-btn" title="放大" onClick={() => step(1)}><Icon name="zoomIn" /></button>
                <button className={`small-btn${zoom === null ? " active" : ""}`} onClick={() => setZoom(null)}>符合視窗</button>
                <button className={`small-btn${zoom === 1 ? " active" : ""}`} onClick={() => setZoom(1)}>原始大小</button>
            </>
    );

    if (error) return <ReaderMessage>無法讀取檔案：{error}</ReaderMessage>;
    return (
        <>
        {toolsEl && createPortal(tools, toolsEl)}
        <div
            ref={boxRef}
            className={`reader-image${zoom === null ? " fit" : ""}`}
            onWheel={(e) => {
                if (!e.ctrlKey) return;
                e.preventDefault();
                step(e.deltaY < 0 ? 1 : -1);
            }}
            onPointerDown={(e) => {
                const box = boxRef.current;
                if (!box || zoom === null) return;
                drag.current = { x: e.clientX, y: e.clientY, left: box.scrollLeft, top: box.scrollTop };
                box.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
                const d = drag.current;
                const box = boxRef.current;
                if (!d || !box) return;
                box.scrollLeft = d.left - (e.clientX - d.x);
                box.scrollTop = d.top - (e.clientY - d.y);
            }}
            onPointerUp={() => (drag.current = null)}
            onDoubleClick={() => setZoom((z) => (z === null ? 1 : null))}
        >
            {url && (
                <img
                    src={url}
                    alt=""
                    draggable={false}
                    onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                    onError={() => setNatural(null)}
                    style={zoom !== null && natural ? { width: natural.w * zoom, height: natural.h * zoom } : undefined}
                />
            )}
        </div>
        </>
    );
}

// ---------- video and audio ----------

function MediaView({ id, kind }: { id: number; kind: "video" | "audio" }) {
    const { url, error } = useStreamUrl(id);
    const [failed, setFailed] = useState(false);
    const { load, save } = usePosition<number>(id);
    if (error) return <ReaderMessage>無法讀取檔案：{error}</ReaderMessage>;
    if (failed) return <ReaderMessage>無法播放這個檔案，可能是格式不受支援（例如部分 MKV、AVI、WMV）。請用預設程式開啟。</ReaderMessage>;
    if (!url) return <ReaderMessage>載入中…</ReaderMessage>;
    const common = {
        src: url,
        controls: true,
        autoPlay: true,
        onError: () => setFailed(true),
        onLoadedMetadata: (e: React.SyntheticEvent<HTMLMediaElement>) => {
            const t = load();
            if (t && t < e.currentTarget.duration - 5) e.currentTarget.currentTime = t;
        },
        onTimeUpdate: (e: React.SyntheticEvent<HTMLMediaElement>) => save(Math.floor(e.currentTarget.currentTime)),
    };
    return kind === "video" ? (
        <div className="reader-media"><video {...common} /></div>
    ) : (
        <div className="reader-media audio"><audio {...common} /></div>
    );
}

// ---------- text ----------

function TextView({ id }: { id: number }) {
    const { data, error } = useFileBytes(id);
    if (error) return <ReaderMessage>無法讀取檔案：{error}</ReaderMessage>;
    if (!data) return <ReaderMessage>載入中…</ReaderMessage>;
    const text = new TextDecoder("utf-8").decode(data);
    return (
        <div className="reader-scroll">
            <article className="reader-page reader-text">
                <pre>{text}</pre>
            </article>
        </div>
    );
}

export default Reader;
