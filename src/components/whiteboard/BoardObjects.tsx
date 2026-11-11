import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Icon } from "../../icons/Icon";
import { errorMessage } from "../../drawer/api";
import { whiteboardApi } from "../../whiteboard/api";
import { useCardFileUrl } from "../../whiteboard/files";
import {
    parseData,
    youTubeEmbed,
    youTubeThumb,
    type ImageData,
    type PdfData,
    type VideoData,
} from "../../whiteboard/objects";
import { loadPdf, renderPage } from "../../whiteboard/pdf";

// ---------- image ----------

/** An image filling its object; dragging it moves the object. */
export function ImageBody({ cardId, data, title }: { cardId: number; data: string; title: string }) {
    const d = parseData<ImageData>(data);
    const { url, error } = useCardFileUrl(cardId, d.file);
    return (
        <div className="wb-obj-media" data-role="grip">
            {!d.file ? (
                <div className="wb-obj-empty">正在加入圖片…</div>
            ) : error ? (
                <div className="wb-obj-empty">無法顯示圖片：{error}</div>
            ) : url ? (
                <img className="wb-obj-image" src={url} alt={title || d.file} draggable={false} />
            ) : (
                <div className="wb-obj-empty">載入中…</div>
            )}
            {title && <div className="wb-obj-caption">{title}</div>}
        </div>
    );
}

// ---------- YouTube ----------

/**
 * A YouTube video: its thumbnail until played, then the embedded player. The player only takes
 * the mouse while the object is selected, so the board can still be panned over it.
 */
export function VideoBody({ data, title, selected }: { data: string; title: string; selected: boolean }) {
    const d = parseData<VideoData>(data);
    const [playing, setPlaying] = useState(false);
    if (!d.videoId) return <div className="wb-obj-empty">影片連結無效</div>;
    const v = d as VideoData;
    return (
        <div className="wb-obj-media wb-obj-video" data-role={playing ? undefined : "grip"}>
            {playing ? (
                <iframe
                    className={`wb-obj-iframe${selected ? "" : " inert"}`}
                    src={youTubeEmbed(v, true)}
                    title={title || "YouTube 影片"}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    referrerPolicy="strict-origin-when-cross-origin"
                    allowFullScreen
                />
            ) : (
                <>
                    <img className="wb-obj-image cover" src={youTubeThumb(v.videoId)} alt="" draggable={false} />
                    <button
                        className="wb-obj-play"
                        title="播放"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => setPlaying(true)}
                    >
                        <Icon name="video" />
                    </button>
                    {title && <div className="wb-obj-caption">{title}</div>}
                </>
            )}
        </div>
    );
}

/** The player in the side panel. */
export function VideoPlayer({ data, title }: { data: string; title: string }) {
    const d = parseData<VideoData>(data);
    if (!d.videoId) return <p className="muted">影片連結無效</p>;
    return (
        <div className="wb-cp-video">
            <iframe
                src={youTubeEmbed(d as VideoData, false)}
                title={title || "YouTube 影片"}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
            />
        </div>
    );
}

// ---------- PDF ----------

function usePdf(cardId: number, file: string | undefined) {
    const [state, setState] = useState<{ doc: PDFDocumentProxy | null; error: string | null }>({ doc: null, error: null });
    useEffect(() => {
        if (!file) return;
        let stale = false;
        loadPdf(cardId, file).then(
            (doc) => !stale && setState({ doc, error: null }),
            (e) => !stale && setState({ doc: null, error: errorMessage(e) }),
        );
        return () => {
            stale = true;
        };
    }, [cardId, file]);
    return state;
}

/** One PDF page on the board, with page buttons. */
export function PdfBody({
    cardId,
    data,
    width,
    zoom,
    onPage,
    onError,
}: {
    cardId: number;
    data: string;
    width: number;
    zoom: number;
    onPage: (page: number) => void;
    onError: (text: string) => void;
}) {
    const d = parseData<PdfData>(data);
    const { doc, error } = usePdf(cardId, d.file);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const pages = doc?.numPages ?? d.pages ?? 0;
    const page = Math.min(Math.max(1, d.page ?? 1), Math.max(1, pages));
    // Re-render when the page, width or zoom change (zoom: sharper text when zoomed in).
    const [renderZoom, setRenderZoom] = useState(zoom);
    useEffect(() => {
        const t = setTimeout(() => setRenderZoom(zoom), 250);
        return () => clearTimeout(t);
    }, [zoom]);
    useEffect(() => {
        if (!doc || !canvasRef.current) return;
        renderPage(doc, page, canvasRef.current, width, renderZoom).catch((e) => onError(errorMessage(e)));
    }, [doc, page, width, renderZoom]); // eslint-disable-line react-hooks/exhaustive-deps

    const go = (p: number) => onPage(Math.min(Math.max(1, p), pages));
    return (
        <>
            <div className="wb-obj-media wb-obj-pdf" data-role="grip">
                {!d.file ? (
                    <div className="wb-obj-empty">正在加入 PDF…</div>
                ) : error ? (
                    <div className="wb-obj-empty">無法顯示 PDF：{error}</div>
                ) : (
                    <canvas ref={canvasRef} className="wb-obj-pdf-page" />
                )}
            </div>
            <div className="wb-obj-bar" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                <button className="wb-obj-btn" disabled={page <= 1} title="上一頁" onClick={() => go(page - 1)}>
                    <Icon name="chevronLeft" />
                </button>
                <span className="wb-obj-pages">
                    {pages ? `${page} / ${pages}` : "…"}
                </span>
                <button className="wb-obj-btn" disabled={page >= pages} title="下一頁" onClick={() => go(page + 1)}>
                    <Icon name="chevronRight" />
                </button>
                <span className="wb-obj-file" title={d.file}>{d.file}</span>
                {d.file && (
                    <button
                        className="wb-obj-btn"
                        title="用系統預設的程式開啟"
                        onClick={() => whiteboardApi.openCardFile(cardId, d.file!).catch((e) => onError(errorMessage(e)))}
                    >
                        <Icon name="openExternal" />
                    </button>
                )}
            </div>
        </>
    );
}

/** One page in the side panel, drawn when scrolled near. */
function PanelPage({ doc, page, width }: { doc: PDFDocumentProxy; page: number; width: number }) {
    const ref = useRef<HTMLCanvasElement>(null);
    const [seen, setSeen] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const io = new IntersectionObserver((es) => es.some((x) => x.isIntersecting) && setSeen(true), { rootMargin: "600px" });
        io.observe(el);
        return () => io.disconnect();
    }, []);
    useEffect(() => {
        if (seen && ref.current) void renderPage(doc, page, ref.current, width).catch(() => {});
    }, [seen, doc, page, width]);
    return <canvas ref={ref} className="wb-cp-pdf-page" style={{ width, aspectRatio: seen ? undefined : "1 / 1.414" }} data-page={page} />;
}

/** Every page of the PDF, scrolling, in the side panel. */
export function PdfPages({ cardId, data, onError }: { cardId: number; data: string; onError: (t: string) => void }) {
    const d = parseData<PdfData>(data);
    const { doc, error } = usePdf(cardId, d.file);
    const boxRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    useEffect(() => {
        const el = boxRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setWidth(Math.floor(el.clientWidth)));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return (
        <div className="wb-cp-pdf" ref={boxRef}>
            <div className="wb-cp-pdf-bar">
                <span className="wb-obj-file" title={d.file}>📄 {d.file}{doc ? ` · ${doc.numPages} 頁` : ""}</span>
                {d.file && (
                    <>
                        <button className="small-btn" onClick={() => whiteboardApi.openCardFile(cardId, d.file!).catch((e) => onError(errorMessage(e)))}>
                            開啟
                        </button>
                        <button className="small-btn" onClick={() => whiteboardApi.revealCardFile(cardId, d.file!).catch((e) => onError(errorMessage(e)))}>
                            顯示位置
                        </button>
                    </>
                )}
            </div>
            {error && <p className="muted">無法顯示 PDF：{error}</p>}
            {doc && width > 0 && Array.from({ length: doc.numPages }, (_, i) => <PanelPage key={i} doc={doc} page={i + 1} width={width} />)}
        </div>
    );
}

/** The image, large, in the side panel. */
export function ImagePreview({ cardId, data, onError }: { cardId: number; data: string; onError: (t: string) => void }) {
    const d = parseData<ImageData>(data);
    const { url, error } = useCardFileUrl(cardId, d.file);
    return (
        <div className="wb-cp-image">
            {url && <img src={url} alt={d.file} />}
            {error && <p className="muted">無法顯示圖片：{error}</p>}
            {d.file && (
                <div className="wb-cp-pdf-bar">
                    <span className="wb-obj-file" title={d.file}>🖼 {d.file}{d.width ? ` · ${d.width} × ${d.height}` : ""}</span>
                    <button className="small-btn" onClick={() => whiteboardApi.openCardFile(cardId, d.file!).catch((e) => onError(errorMessage(e)))}>
                        開啟
                    </button>
                    <button className="small-btn" onClick={() => whiteboardApi.revealCardFile(cardId, d.file!).catch((e) => onError(errorMessage(e)))}>
                        顯示位置
                    </button>
                </div>
            )}
        </div>
    );
}
