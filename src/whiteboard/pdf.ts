import type { PDFDocumentProxy } from "pdfjs-dist";
import { cardFileBlob } from "./files";

/** pdf.js is loaded the first time a PDF is shown. */
let lib: Promise<typeof import("pdfjs-dist")> | null = null;
function pdfjs() {
    if (!lib) {
        lib = Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]).then(([m, w]) => {
            m.GlobalWorkerOptions.workerSrc = w.default;
            return m;
        });
    }
    return lib;
}

/**
 * One pdf.js worker shared by every document, so opening a PDF doesn't start (and load) a new
 * worker each time. Destroying a document leaves a worker it was given running.
 */
let sharedWorker: import("pdfjs-dist").PDFWorker | null = null;
async function worker() {
    const m = await pdfjs();
    if (!sharedWorker || sharedWorker.destroyed) sharedWorker = new m.PDFWorker();
    return sharedWorker;
}

/**
 * Where pdf.js finds its data files (served by the `pdfjs-assets` plugin in vite.config.ts): the
 * wasm decoders for JPEG 2000 / JBIG2 images (most scanned PDFs), CMaps for CJK fonts that
 * aren't embedded, the standard fonts and ICC profiles. Without them those images and that text
 * are left out ("Dependent image isn't ready yet").
 */
function assetOptions() {
    const base = new URL("pdfjs/", new URL(import.meta.env.BASE_URL, window.location.href)).href;
    return {
        wasmUrl: `${base}wasm/`,
        cMapUrl: `${base}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${base}standard_fonts/`,
        iccUrl: `${base}iccs/`,
    };
}

const docs = new Map<string, Promise<PDFDocumentProxy>>();

/** The parsed PDF of a card's file (shared by the board and the side panel). */
export function loadPdf(cardId: number, file: string): Promise<PDFDocumentProxy> {
    const k = `${cardId}/${file}`;
    let p = docs.get(k);
    if (!p) {
        p = Promise.all([pdfjs(), worker(), cardFileBlob(cardId, file)]).then(async ([m, w, blob]) =>
            m.getDocument({ ...assetOptions(), worker: w, data: new Uint8Array(await blob.arrayBuffer()) }).promise,
        );
        p.catch(() => docs.delete(k));
        docs.set(k, p);
    }
    return p;
}

/** Parses PDF bytes that aren't a card's file (e.g. a Drawer attachment shown in the detail pane). */
export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
    const [m, w] = await Promise.all([pdfjs(), worker()]);
    return m.getDocument({ ...assetOptions(), worker: w, data: new Uint8Array(data) }).promise;
}

/** Piece pdf.js reads at a time. */
const CHUNK = 512 * 1024;
/**
 * First piece read when opening by URL: gives the file's size and usually the first page's data.
 * A whole chunk, so pdf.js counts it as read instead of asking for it again.
 */
const FIRST_CHUNK = CHUNK;

async function fetchRange(url: string, begin: number, end: number) {
    const r = await fetch(url, { headers: { Range: `bytes=${begin}-${end - 1}` } });
    if (r.status !== 206 && r.status !== 200) throw new Error(`讀取失敗（${r.status}）`);
    return r;
}

/**
 * Opens a PDF from a URL (the `attachment:` protocol), reading only the parts that are needed, so
 * a large PDF shows its first pages quickly without being read into memory first.
 *
 * pdf.js's own URL loading starts with a request for the whole file (to see whether ranges are
 * supported), and the protocol can only answer that by reading the whole file. So every read
 * here is a range request: the first one also gives the size.
 */
export async function openPdfUrl(url: string): Promise<PDFDocumentProxy> {
    const [m, w] = await Promise.all([pdfjs(), worker()]);
    const first = await fetchRange(url, 0, FIRST_CHUNK);
    const head = new Uint8Array(await first.arrayBuffer());
    const total = Number(first.headers.get("Content-Range")?.split("/")[1]);
    if (first.status === 200 || !Number.isFinite(total) || total <= head.length) {
        // Small file (or no ranges): this was all of it.
        return m.getDocument({ ...assetOptions(), worker: w, data: head }).promise;
    }
    const transport = new m.PDFDataRangeTransport(total, head);
    transport.requestDataRange = (begin: number, end: number) => {
        fetchRange(url, begin, end)
            .then((r) => r.arrayBuffer())
            // One retry: a read can fail while the file is busy (e.g. being synced).
            .catch(() => fetchRange(url, begin, end).then((r) => r.arrayBuffer()))
            .then(
                (b) => transport.onDataRange(begin, new Uint8Array(b)),
                () => transport.abort(),
            );
    };
    return m.getDocument({ ...assetOptions(), worker: w, range: transport, rangeChunkSize: CHUNK, disableAutoFetch: true }).promise;
}

/**
 * Lays the page's text over its canvas as invisible, selectable text (pdf.js text layer), so
 * text can be selected, copied and searched. `container` covers the page at `cssWidth`.
 */
const textLayers = new WeakMap<HTMLElement, { cancel: () => void }>();
export async function renderTextLayer(doc: PDFDocumentProxy, pageNo: number, container: HTMLElement, cssWidth: number) {
    const m = await pdfjs();
    const page = await doc.getPage(pageNo);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: cssWidth / base.width });
    textLayers.get(container)?.cancel();
    container.replaceChildren();
    // The text layer sizes itself from these (pdf.js's viewer sets them on the page).
    container.style.setProperty("--total-scale-factor", String(viewport.scale));
    container.style.setProperty("--scale-round-x", "1px");
    container.style.setProperty("--scale-round-y", "1px");
    const layer = new m.TextLayer({ textContentSource: page.streamTextContent(), container, viewport });
    textLayers.set(container, layer);
    try {
        await layer.render();
    } finally {
        if (textLayers.get(container) === layer) textLayers.delete(container);
    }
}

/** The text of each page (for searching), read once per document. */
const pageTexts = new WeakMap<PDFDocumentProxy, Promise<string>[]>();
export function pageText(doc: PDFDocumentProxy, pageNo: number): Promise<string> {
    let list = pageTexts.get(doc);
    if (!list) {
        list = [];
        pageTexts.set(doc, list);
    }
    if (!list[pageNo]) {
        list[pageNo] = doc
            .getPage(pageNo)
            .then((p) => p.getTextContent())
            .then((tc) => tc.items.map((it) => ("str" in it ? it.str : "")).join(""));
    }
    return list[pageNo];
}

export interface OutlineEntry {
    title: string;
    /** 1-based, or null when the destination can't be resolved. */
    page: number | null;
    depth: number;
}

/** The PDF's bookmarks, flattened with their depth and resolved to page numbers. */
export async function pdfOutline(doc: PDFDocumentProxy): Promise<OutlineEntry[]> {
    const tree = (await doc.getOutline()) ?? [];
    const out: OutlineEntry[] = [];
    const resolve = async (dest: unknown): Promise<number | null> => {
        try {
            const explicit = typeof dest === "string" ? await doc.getDestination(dest) : (dest as unknown[] | null);
            const target = explicit?.[0];
            if (typeof target === "number") return target + 1;
            if (target && typeof target === "object") return (await doc.getPageIndex(target as never)) + 1;
        } catch {
            /* unresolved bookmark */
        }
        return null;
    };
    const walk = async (items: Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>, depth: number) => {
        for (const it of items) {
            out.push({ title: it.title || "（無標題）", page: await resolve(it.dest), depth });
            if (it.items?.length) await walk(it.items, depth + 1);
        }
    };
    await walk(tree, 0);
    return out;
}

/** Page count of PDF bytes (used right after a PDF is added). */
export async function pdfPageCount(cardId: number, file: string): Promise<number> {
    return (await loadPdf(cardId, file)).numPages;
}

/**
 * Draws one page into the canvas, `cssWidth` wide (sharp on high-DPI screens and when zoomed in).
 * Returns the page's height for that width. A render already running on the canvas is cancelled.
 */
const running = new WeakMap<HTMLCanvasElement, { cancel: () => void }>();
export async function renderPage(doc: PDFDocumentProxy, pageNo: number, canvas: HTMLCanvasElement, cssWidth: number, scale = 1) {
    const page = await doc.getPage(Math.min(Math.max(1, pageNo), doc.numPages));
    const base = page.getViewport({ scale: 1 });
    const k = (cssWidth / base.width) * Math.min(3, Math.max(1, (window.devicePixelRatio || 1) * scale));
    const viewport = page.getViewport({ scale: k });
    running.get(canvas)?.cancel();
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const task = page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport });
    running.set(canvas, task);
    try {
        await task.promise;
    } catch (e) {
        if ((e as { name?: string })?.name !== "RenderingCancelledException") throw e;
    } finally {
        if (running.get(canvas) === task) running.delete(canvas);
    }
    return (base.height / base.width) * cssWidth;
}
