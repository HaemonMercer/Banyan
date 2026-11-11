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

const docs = new Map<string, Promise<PDFDocumentProxy>>();

/** The parsed PDF of a card's file (shared by the board and the side panel). */
export function loadPdf(cardId: number, file: string): Promise<PDFDocumentProxy> {
    const k = `${cardId}/${file}`;
    let p = docs.get(k);
    if (!p) {
        p = Promise.all([pdfjs(), cardFileBlob(cardId, file)]).then(async ([m, blob]) =>
            m.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise,
        );
        p.catch(() => docs.delete(k));
        docs.set(k, p);
    }
    return p;
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
