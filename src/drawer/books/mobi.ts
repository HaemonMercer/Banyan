/**
 * Kindle books without DRM: MOBI / AZW / PRC (MOBI 6) and AZW3 (KF8, shown best-effort).
 *
 * A MOBI file is a Palm database: record 0 holds the PalmDOC and MOBI headers, the next records
 * the (usually PalmDOC-compressed) text, and later records the pictures. MOBI 6 text is HTML with
 * <mbp:pagebreak/> between parts and `filepos` links (byte offsets into the text). KF8 text is
 * HTML whose files are stored as skeletons followed by their fragments; here the fragments are
 * shown in order with the skeleton tags removed, which keeps the reading order without the index.
 */
import { htmlPage, sniffImage, type Book, type Chapter, type TocEntry } from "./types";

const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

/** PalmDOC LZ77 decompression. */
export function palmdocDecompress(data: Uint8Array): Uint8Array {
    const out = new Uint8Array(data.length * 8 + 16);
    let o = 0;
    const put = (v: number) => {
        out[o++] = v;
    };
    for (let i = 0; i < data.length; ) {
        const c = data[i++];
        if (c === 0 || (c >= 0x09 && c <= 0x7f)) put(c);
        else if (c <= 0x08) {
            for (let k = 0; k < c && i < data.length; k++) put(data[i++]);
        } else if (c <= 0xbf) {
            const c2 = data[i++];
            const pair = (c << 8) | c2;
            const dist = (pair >> 3) & 0x7ff;
            const len = (pair & 7) + 3;
            for (let k = 0; k < len; k++) put(out[o - dist]);
        } else {
            put(0x20);
            put(c ^ 0x80);
        }
    }
    return out.subarray(0, o);
}

/** Size of one trailing entry, read backwards from the end of `data`. */
function trailingEntrySize(data: Uint8Array, end: number): number {
    let num = 0;
    for (let i = Math.max(0, end - 4); i < end; i++) {
        const v = data[i];
        if (v & 0x80) num = 0;
        num = (num << 7) | (v & 0x7f);
    }
    return num;
}

/** Strips the extra data some writers append to each text record (flags in the MOBI header). */
function trimTrailing(data: Uint8Array, flags: number): Uint8Array {
    let end = data.length;
    for (let bits = flags >> 1; bits; bits >>= 1) {
        if (bits & 1) {
            const n = trailingEntrySize(data, end);
            if (n > 0 && n <= end) end -= n;
        }
    }
    if (flags & 1 && end > 0) end -= (data[end - 1] & 3) + 1;
    return data.subarray(0, Math.max(0, end));
}

/** One character per byte (reversible, unlike decoding as Latin-1, which is really windows-1252). */
function bytesToLatin(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return s;
}

/** "0005" in Kindle's base 32 (0-9, A-V). */
const base32 = (s: string) => parseInt(s, 32);

export class MobiBook implements Book {
    title = "";
    chapters: Chapter[] = [];
    toc: TocEntry[] = [];
    vertical = false;
    /** AZW3 shown without its index (see the file comment). */
    kf8 = false;
    private parts: string[] = [];
    private anchors = new Map<string, number>();
    private urls: string[] = [];

    static async open(buf: ArrayBuffer): Promise<MobiBook> {
        const book = new MobiBook();
        book.read(new Uint8Array(buf));
        return book;
    }

    private read(b: Uint8Array) {
        if (b.length < 78 || !["BOOKMOBI", "TEXtREAd"].includes(ascii(b, 60, 8))) throw new Error("不是有效的 MOBI / AZW 檔");
        const count = u16(b, 76);
        const offsets = Array.from({ length: count }, (_, i) => u32(b, 78 + i * 8));
        const rec = (i: number) => b.subarray(offsets[i], i + 1 < count ? offsets[i + 1] : b.length);

        const r0 = rec(0);
        const compression = u16(r0, 0);
        const textLength = u32(r0, 4);
        const textRecords = u16(r0, 8);
        const encryption = u16(r0, 12);
        if (encryption !== 0) throw new Error("這本書有 DRM（數位版權保護），無法開啟");
        if (compression === 17480) throw new Error("這本書使用 HUFF/CDIC 壓縮，還不支援。可以先轉成 EPUB 再加入");
        const isMobi = r0.length > 20 && ascii(r0, 16, 4) === "MOBI";
        const headerLength = isMobi ? u32(r0, 20) : 0;
        const encoding = isMobi ? u32(r0, 28) : 1252;
        const version = isMobi ? u32(r0, 36) : 0;
        const firstImage = isMobi ? u32(r0, 108) : 0xffffffff;
        const extraFlags = isMobi && headerLength >= 0xe4 ? u16(r0, 0xf2) : 0;
        const fdst = isMobi && headerLength >= 0xb4 ? u32(r0, 0xc0) : 0xffffffff;
        this.kf8 = version === 8;

        // Title: EXTH 503 (updated title), else the full name.
        if (isMobi) {
            const nameOff = u32(r0, 84);
            const nameLen = u32(r0, 88);
            this.title = new TextDecoder(encoding === 65001 ? "utf-8" : "windows-1252").decode(r0.subarray(nameOff, nameOff + nameLen));
            if (u32(r0, 128) & 0x40) {
                const ex = 16 + headerLength;
                if (ascii(r0, ex, 4) === "EXTH") {
                    let p = ex + 12;
                    for (let n = u32(r0, ex + 8); n > 0 && p + 8 <= r0.length; n--) {
                        const type = u32(r0, p);
                        const len = u32(r0, p + 4);
                        if (type === 503 && len > 8) this.title = new TextDecoder("utf-8").decode(r0.subarray(p + 8, p + len));
                        p += Math.max(8, len);
                    }
                }
            }
        }

        // The text, decompressed record by record.
        const chunks: Uint8Array[] = [];
        let total = 0;
        for (let i = 1; i <= textRecords && i < count; i++) {
            const data = trimTrailing(rec(i), extraFlags);
            const plain = compression === 2 ? palmdocDecompress(data) : data;
            chunks.push(plain);
            total += plain.length;
        }
        const raw = new Uint8Array(total);
        let at = 0;
        for (const c of chunks) {
            raw.set(c, at);
            at += c.length;
        }
        let text: Uint8Array = raw.subarray(0, Math.min(textLength || total, total));

        // KF8: only the first flow is the book's HTML (the others are style sheets, SVG…).
        const flows: Uint8Array[] = [];
        if (this.kf8 && fdst !== 0xffffffff && fdst < count && ascii(rec(fdst), 0, 4) === "FDST") {
            const f = rec(fdst);
            const n = u32(f, 8);
            for (let k = 0; k < n; k++) flows.push(text.subarray(u32(f, 12 + k * 8), u32(f, 16 + k * 8)));
            if (flows[0]?.length) text = flows[0];
        }

        const decode = (bytes: Uint8Array) => new TextDecoder(encoding === 65001 ? "utf-8" : "windows-1252").decode(bytes);
        const picture = (n: number) => {
            const i = firstImage + n - 1;
            if (firstImage === 0xffffffff || i >= count || n < 1) return "";
            const bytes = rec(i);
            const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: sniffImage(bytes) }));
            this.urls.push(url);
            return url;
        };

        let html: string;
        if (this.kf8) {
            html = decode(text);
            // Style sheets from the other flows.
            html = html.replace(/kindle:flow:([0-9A-V]+)\?mime=text\/css/gi, (_, id) => {
                const css = flows[base32(id)];
                if (!css) return "";
                const url = URL.createObjectURL(new Blob([decode(css)], { type: "text/css" }));
                this.urls.push(url);
                return url;
            });
            html = html.replace(/kindle:embed:([0-9A-V]+)(\?mime=[\w/+.-]+)?/gi, (_, id) => picture(base32(id)));
            // Positions inside the book need the KF8 index, which isn't read: such links don't go anywhere.
            html = html.replace(/href=["']kindle:pos:[^"']*["']/gi, "");
            // Each skeleton (an <html> document) starts a new part; its own tags are dropped.
            this.parts = html
                .split(/(?=<html[\s>])/i)
                .map((p) =>
                    p
                        .replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>|<\/?html[^>]*>|<\/?body[^>]*>/gi, "")
                        .replace(/<head[\s>][\s\S]*?<\/head>/gi, (head) => (head.match(/<link[^>]*>|<style[\s\S]*?<\/style>/gi) ?? []).join("")),
                )
                .filter((p) => p.replace(/<[^>]*>/g, "").trim() !== "" || /<img/i.test(p));
        } else {
            // filepos links point at byte offsets: put an anchor there before decoding.
            let latin = bytesToLatin(text);
            const targets = new Set<number>();
            for (const m of latin.matchAll(/filepos=["']?0*(\d+)/gi)) targets.add(Number(m[1]));
            for (const pos of [...targets].sort((a, z) => z - a)) {
                if (pos <= latin.length) latin = `${latin.slice(0, pos)}<a id="filepos${pos}"></a>${latin.slice(pos)}`;
            }
            html = decode(Uint8Array.from(latin, (ch) => ch.charCodeAt(0)));
            html = html.replace(/<a([^>]*?)\sfilepos=["']?0*(\d+)["']?/gi, '<a$1 href="#filepos$2"');
            html = html.replace(/<img([^>]*?)\s(?:hi|lo)?recindex=["']?(\d+)["']?/gi, (_, attrs, n) => `<img${attrs} src="${picture(Number(n))}"`);
            this.parts = html.split(/<mbp:pagebreak\s*\/?>/i).filter((p) => p.replace(/<[^>]*>/g, "").trim() !== "" || /<img/i.test(p));
        }
        if (this.parts.length === 0) throw new Error("這本書沒有可以閱讀的內容");

        this.parts.forEach((p, i) => {
            for (const m of p.matchAll(/\sid=["']([^"']+)["']/gi)) this.anchors.set(m[1], i);
            const heading = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(p)?.[1]?.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
            const label = heading && heading.length <= 60 ? heading : `第 ${i + 1} 部分`;
            this.chapters.push({ path: String(i), label });
            if (heading) this.toc.push({ label, path: String(i), fragment: "", depth: 0 });
        });
    }

    async chapter(index: number, readerCss: string) {
        const doc = new DOMParser().parseFromString(`<body>${this.parts[index]}</body>`, "text/html");
        doc.querySelectorAll("script").forEach((s) => s.remove());
        for (const a of Array.from(doc.querySelectorAll("a[href]"))) {
            const href = a.getAttribute("href") ?? "";
            if (/^(https?:|mailto:)/.test(href)) a.setAttribute("data-external", href);
            else if (href.startsWith("#")) {
                const target = this.anchors.get(href.slice(1));
                if (target !== undefined) a.setAttribute("data-chapter", `${target}#${href.slice(1)}`);
            }
        }
        const css = `${readerCss}\np { margin: 0 0 .5em; }`;
        const styles = Array.from(doc.querySelectorAll("link[rel~=stylesheet], link[href], style")).map((e) => e.outerHTML).join("");
        doc.querySelectorAll("link, style").forEach((e) => e.remove());
        const page = htmlPage(doc.body.innerHTML, css, this.chapters[index].label);
        // The book's own style sheets go before the reader's, so the reader's settings win.
        return { ...page, content: page.content.replace("<style>", `${styles}<style>`) };
    }

    async chapterText(index: number) {
        return new DOMParser().parseFromString(`<body>${this.parts[index]}</body>`, "text/html").body.textContent ?? "";
    }

    close() {
        for (const u of this.urls) URL.revokeObjectURL(u);
        this.urls = [];
    }
}

/** Shown when a book opens but some of it may look off. */
export const KF8_NOTE = "AZW3 書以簡化方式顯示：內容與圖片依序呈現，但書內連結無法跳轉，部分版面可能和 Kindle 不同。";
