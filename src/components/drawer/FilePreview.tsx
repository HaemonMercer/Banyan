import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { drawerApi, errorMessage, type Attachment } from "../../drawer/api";
import { useAttachmentImage } from "../../drawer/images";
import { formatSize } from "../../drawer/itemTypes";
import { openPdf, renderPage } from "../../whiteboard/pdf";

/** How a file can be shown in the detail pane, from its extension. */
type PreviewKind = "image" | "pdf" | "video" | "audio" | "text" | null;

const KINDS: [PreviewKind, string[]][] = [
    ["image", ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "svg"]],
    ["pdf", ["pdf"]],
    ["video", ["mp4", "webm", "m4v", "mov", "ogv"]],
    ["audio", ["mp3", "wav", "m4a", "aac", "ogg", "oga", "opus", "flac"]],
    ["text", [
        "txt", "md", "markdown", "log", "csv", "tsv", "json", "xml", "yaml", "yml", "toml", "ini", "rst", "org", "tex", "bib",
        "js", "mjs", "ts", "tsx", "jsx", "py", "rs", "c", "h", "cpp", "hpp", "cs", "java", "kt", "go", "rb",
        "php", "swift", "sh", "ps1", "bat", "html", "htm", "css", "scss", "sql", "lua", "r",
    ]],
];

/** Larger files aren't read into memory for a preview; they can still be opened. */
const LIMITS: Record<Exclude<PreviewKind, null>, number> = {
    image: 50 * 2 ** 20,
    pdf: 100 * 2 ** 20,
    video: 300 * 2 ** 20,
    audio: 200 * 2 ** 20,
    text: 2 * 2 ** 20,
};

const MIME: Record<string, string> = {
    mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", ogv: "video/ogg",
    mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", oga: "audio/ogg",
    opus: "audio/ogg", flac: "audio/flac",
};

const extOf = (name: string) => /\.([^.]+)$/.exec(name)?.[1].toLowerCase() ?? "";

export function previewKind(fileName: string): PreviewKind {
    const ext = extOf(fileName);
    return KINDS.find(([, exts]) => exts.includes(ext))?.[0] ?? null;
}

interface Props {
    attachment: Attachment;
    /** Double-click: the reader (or the default program for files it can't show). */
    onOpen: () => void;
}

/** Shows the file of a 檔案庫 item: picture, PDF pages, player, or the text. */
function FilePreview({ attachment, onOpen }: Props) {
    const kind = previewKind(attachment.fileName);
    const tooLarge = kind !== null && attachment.size > LIMITS[kind];

    let body: React.ReactNode;
    if (kind === null) body = <p className="muted">這種檔案沒有預覽，可以用預設程式開啟。</p>;
    else if (tooLarge) body = <p className="muted">檔案較大（{formatSize(attachment.size)}），不在這裡預覽，請用預設程式開啟。</p>;
    else if (kind === "image") body = <ImagePreview id={attachment.id} />;
    else if (kind === "pdf") body = <PdfPreview id={attachment.id} />;
    else if (kind === "video" || kind === "audio") body = <MediaPreview attachment={attachment} kind={kind} />;
    else body = <TextPreview id={attachment.id} />;

    return (
        <div
            className="file-preview"
            title={kind === "video" || kind === "audio" ? undefined : "雙擊閱讀"}
            onDoubleClick={kind === "video" || kind === "audio" ? undefined : onOpen}
        >
            {body}
        </div>
    );
}

function Failed({ error }: { error: string }) {
    return <p className="muted">無法讀取檔案：{error}</p>;
}

function ImagePreview({ id }: { id: number }) {
    const { url, failed } = useAttachmentImage(id, true);
    if (failed) return <Failed error="檔案可能已被移動或刪除" />;
    return url ? <img className="file-preview-image" src={url} alt="" /> : <p className="muted">載入中…</p>;
}

/** Reads the file once; `null` while loading. */
function useBytes(id: number) {
    const [state, setState] = useState<{ data: ArrayBuffer | null; error: string | null }>({ data: null, error: null });
    useEffect(() => {
        let stale = false;
        setState({ data: null, error: null });
        drawerApi.readAttachment(id).then(
            (data) => !stale && setState({ data, error: null }),
            (e) => !stale && setState({ data: null, error: errorMessage(e) }),
        );
        return () => {
            stale = true;
        };
    }, [id]);
    return state;
}

function MediaPreview({ attachment, kind }: { attachment: Attachment; kind: "video" | "audio" }) {
    const { data, error } = useBytes(attachment.id);
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        if (!data) return;
        const u = URL.createObjectURL(new Blob([data], { type: MIME[extOf(attachment.fileName)] ?? "" }));
        setUrl(u);
        return () => URL.revokeObjectURL(u);
    }, [data, attachment.fileName]);
    if (error) return <Failed error={error} />;
    if (!url) return <p className="muted">載入中…</p>;
    return kind === "video" ? (
        <video className="file-preview-video" src={url} controls preload="metadata" />
    ) : (
        <audio className="file-preview-audio" src={url} controls preload="metadata" />
    );
}

function TextPreview({ id }: { id: number }) {
    const { data, error } = useBytes(id);
    if (error) return <Failed error={error} />;
    if (!data) return <p className="muted">載入中…</p>;
    const text = new TextDecoder("utf-8").decode(data);
    return <pre className="file-preview-text">{text}</pre>;
}

function PdfPreview({ id }: { id: number }) {
    const { data, error } = useBytes(id);
    const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
    const [failed, setFailed] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const boxRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!data) return;
        let stale = false;
        let opened: PDFDocumentProxy | null = null;
        // pdf.js takes ownership of the buffer it parses, so give it a copy.
        openPdf(data.slice(0)).then(
            (d) => {
                // Released with the preview, so moving through PDFs doesn't keep them all in memory.
                if (stale) {
                    void d.loadingTask.destroy();
                    return;
                }
                opened = d;
                setDoc(d);
            },
            (e) => !stale && setFailed(errorMessage(e)),
        );
        return () => {
            stale = true;
            setDoc(null);
            void opened?.loadingTask.destroy();
        };
    }, [data]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!doc || !canvas) return;
        const width = Math.max(120, (boxRef.current?.clientWidth ?? 320) - 2);
        renderPage(doc, page, canvas, width).then(
            (h) => {
                canvas.style.width = `${width}px`;
                canvas.style.height = `${h}px`;
            },
            (e) => setFailed(errorMessage(e)),
        );
    }, [doc, page]);

    if (error || failed) return <Failed error={error ?? failed ?? ""} />;
    return (
        <div ref={boxRef} className="file-preview-pdf">
            {!doc && <p className="muted">載入中…</p>}
            <canvas ref={canvasRef} hidden={!doc} />
            {doc && doc.numPages > 1 && (
                <div className="file-preview-pages">
                    <button className="small-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ 上一頁</button>
                    <span>{page} / {doc.numPages}</span>
                    <button className="small-btn" disabled={page >= doc.numPages} onClick={() => setPage((p) => p + 1)}>下一頁 ›</button>
                </div>
            )}
        </div>
    );
}

export default FilePreview;
