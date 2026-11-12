/** What every book format gives the reader (EPUB, MOBI/AZW, FB2, TXT). */

export interface Chapter {
    /** Identifies the chapter inside the book (a path, or an index for formats without files). */
    path: string;
    /** From the table of contents, or "第 N 部分". */
    label: string;
}

export interface TocEntry {
    label: string;
    path: string;
    /** Anchor inside the chapter, if any. */
    fragment: string;
    depth: number;
}

export interface Book {
    title: string;
    /** Reading order. */
    chapters: Chapter[];
    /** Table of contents (may be empty: the reader then lists the chapters). */
    toc: TocEntry[];
    /** Written top-to-bottom, right-to-left (Chinese / Japanese vertical books). */
    vertical: boolean;
    /**
     * The chapter as a standalone document for a sandboxed frame, with `readerCss` added.
     * Links to other chapters carry `data-chapter="<index>#<anchor>"`, outside links `data-external`.
     */
    chapter(index: number, readerCss: string): Promise<{ content: string; type: string }>;
    /** The chapter's plain text (for searching the whole book). */
    chapterText(index: number): Promise<string>;
    /** Frees blob URLs. */
    close(): void;
}

/** Escapes text for HTML. */
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A complete HTML page around a chapter's body. */
export function htmlPage(body: string, css: string, title = ""): { content: string; type: string } {
    return {
        content: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body>${body}</body></html>`,
        type: "text/html",
    };
}

/** Picture type from its first bytes (books often don't say). */
export function sniffImage(bytes: Uint8Array): string {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
    if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return "image/webp";
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "image/bmp";
    const head = new TextDecoder().decode(bytes.slice(0, 200));
    return /<svg/i.test(head) ? "image/svg+xml" : "application/octet-stream";
}
