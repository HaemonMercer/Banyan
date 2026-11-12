/**
 * EPUB books: reads the package (OPF) for the title, reading order (spine), table of contents and
 * writing direction, and turns a chapter into a document whose pictures, styles and fonts point
 * at blob URLs.
 */
import { Zip } from "./zip";
import type { Book, Chapter, TocEntry } from "./types";

const MIME: Record<string, string> = {
    xhtml: "application/xhtml+xml", html: "text/html", htm: "text/html", css: "text/css",
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", svg: "image/svg+xml",
    webp: "image/webp", ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2",
};
const mimeOf = (path: string) => MIME[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

/** "OEBPS/text/ch1.xhtml" + "../images/a.png" → "OEBPS/images/a.png" (fragment and query dropped). */
export function resolvePath(base: string, href: string): string {
    const clean = decodeURIComponent(href.split("#")[0].split("?")[0]);
    if (clean === "") return base;
    const parts = clean.startsWith("/") ? [] : base.split("/").slice(0, -1);
    for (const seg of clean.split("/")) {
        if (seg === "..") parts.pop();
        else if (seg !== "." && seg !== "") parts.push(seg);
    }
    return parts.join("/");
}

export class EpubBook implements Book {
    title = "";
    chapters: Chapter[] = [];
    toc: TocEntry[] = [];
    vertical = false;
    private zip: Zip;
    private urls = new Map<string, Promise<string>>();

    private constructor(buf: ArrayBuffer) {
        this.zip = new Zip(buf);
    }

    static async open(buf: ArrayBuffer): Promise<EpubBook> {
        const book = new EpubBook(buf);
        await book.readPackage();
        return book;
    }

    has(path: string) {
        return this.zip.has(path);
    }

    file(path: string): Promise<Uint8Array> {
        return this.zip.file(path);
    }

    text(path: string): Promise<string> {
        return this.zip.text(path);
    }

    /** Blob URL of a resource (picture, style sheet, font); style sheets get their own urls rewritten. */
    url(path: string): Promise<string> {
        let p = this.urls.get(path);
        if (!p) {
            p = (async () => {
                if (mimeOf(path) === "text/css") {
                    const css = await this.rewriteCss(await this.text(path), path);
                    return URL.createObjectURL(new Blob([css], { type: "text/css" }));
                }
                return URL.createObjectURL(new Blob([(await this.file(path)) as BlobPart], { type: mimeOf(path) }));
            })();
            this.urls.set(path, p);
        }
        return p;
    }

    private async rewriteCss(css: string, base: string): Promise<string> {
        const refs = [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)];
        let out = css;
        for (const m of refs) {
            const target = resolvePath(base, m[2]);
            if (m[2].startsWith("data:") || !this.has(target)) continue;
            out = out.replace(m[0], `url("${await this.url(target)}")`);
        }
        return out;
    }

    private async readPackage() {
        const xml = (s: string) => new DOMParser().parseFromString(s, "application/xml");
        const container = xml(await this.text("META-INF/container.xml"));
        const opfPath = container.querySelector("rootfile")?.getAttribute("full-path");
        if (!opfPath) throw new Error("不是有效的 EPUB 檔（找不到內容說明）");
        const opf = xml(await this.text(opfPath));
        this.title = opf.getElementsByTagNameNS("*", "title")[0]?.textContent?.trim() ?? "";

        const manifest = new Map<string, { href: string; type: string; props: string }>();
        for (const item of Array.from(opf.getElementsByTagNameNS("*", "item"))) {
            manifest.set(item.getAttribute("id") ?? "", {
                href: resolvePath(opfPath, item.getAttribute("href") ?? ""),
                type: item.getAttribute("media-type") ?? "",
                props: item.getAttribute("properties") ?? "",
            });
        }
        const spine = opf.getElementsByTagNameNS("*", "spine")[0];
        for (const ref of Array.from(opf.getElementsByTagNameNS("*", "itemref"))) {
            if (ref.getAttribute("linear") === "no") continue;
            const m = manifest.get(ref.getAttribute("idref") ?? "");
            if (m && this.has(m.href)) this.chapters.push({ path: m.href, label: "" });
        }
        if (this.chapters.length === 0) throw new Error("這本書沒有可以閱讀的章節");

        // Table of contents: EPUB 3 nav document, else EPUB 2 NCX.
        try {
            const nav = [...manifest.values()].find((m) => m.props.split(/\s+/).includes("nav"));
            const ncx = manifest.get(spine?.getAttribute("toc") ?? "") ?? [...manifest.values()].find((m) => m.type === "application/x-dtbncx+xml");
            if (nav) this.readNav(nav.href, xml(await this.text(nav.href)));
            else if (ncx) this.readNcx(ncx.href, xml(await this.text(ncx.href)));
        } catch {
            /* a book without a readable table of contents still opens */
        }
        this.chapters.forEach((c, i) => {
            c.label = this.toc.find((t) => t.path === c.path)?.label ?? `第 ${i + 1} 部分`;
        });

        // Vertical books (直排): right-to-left page order, or vertical writing in the style sheets.
        this.vertical = spine?.getAttribute("page-progression-direction") === "rtl";
        if (!this.vertical) {
            for (const m of manifest.values()) {
                if (m.type !== "text/css" || !this.has(m.href)) continue;
                if (/writing-mode\s*:\s*vertical-rl|-epub-writing-mode\s*:\s*vertical-rl/i.test(await this.text(m.href).catch(() => ""))) {
                    this.vertical = true;
                    break;
                }
            }
        }
    }

    private readNav(path: string, doc: Document) {
        const tocNav =
            Array.from(doc.getElementsByTagNameNS("*", "nav")).find((n) =>
                (n.getAttributeNS("http://www.idpf.org/2007/ops", "type") ?? n.getAttribute("epub:type") ?? "").includes("toc"),
            ) ?? doc.getElementsByTagNameNS("*", "nav")[0];
        if (!tocNav) return;
        const walk = (list: Element, depth: number) => {
            for (const li of Array.from(list.children)) {
                const a = Array.from(li.children).find((c) => c.localName === "a" || c.localName === "span");
                const href = a?.getAttribute("href");
                if (a && href) {
                    this.toc.push({ label: a.textContent?.trim() || "（無標題）", path: resolvePath(path, href), fragment: href.split("#")[1] ?? "", depth });
                }
                const sub = Array.from(li.children).find((c) => c.localName === "ol");
                if (sub) walk(sub, depth + 1);
            }
        };
        const ol = Array.from(tocNav.children).find((c) => c.localName === "ol");
        if (ol) walk(ol, 0);
    }

    private readNcx(path: string, doc: Document) {
        const walk = (parent: Element, depth: number) => {
            for (const np of Array.from(parent.children).filter((c) => c.localName === "navPoint")) {
                const label = np.getElementsByTagNameNS("*", "text")[0]?.textContent?.trim() || "（無標題）";
                const src = np.getElementsByTagNameNS("*", "content")[0]?.getAttribute("src") ?? "";
                if (src) this.toc.push({ label, path: resolvePath(path, src), fragment: src.split("#")[1] ?? "", depth });
                walk(np, depth + 1);
            }
        };
        const map = doc.getElementsByTagNameNS("*", "navMap")[0];
        if (map) walk(map, 0);
    }

    /**
     * The chapter as a standalone document (with its media type) for a sandboxed frame: scripts removed, pictures,
     * style sheets and fonts pointing at blob URLs, links to other chapters marked with
     * `data-chapter` so the reader can follow them.
     */
    async chapter(index: number, readerCss: string): Promise<{ content: string; type: string }> {
        const path = this.chapters[index].path;
        const source = await this.text(path);
        // Chapters are XHTML; a malformed one is read as HTML instead (as browsers do).
        let doc = new DOMParser().parseFromString(source, "application/xhtml+xml");
        const xml = doc.getElementsByTagName("parsererror").length === 0;
        if (!xml) doc = new DOMParser().parseFromString(source, "text/html");
        doc.querySelectorAll("script").forEach((s) => s.remove());
        const swap = async (el: Element, attr: string, ns?: string) => {
            const v = ns ? el.getAttributeNS(ns, attr) : el.getAttribute(attr);
            if (!v || /^(data:|https?:|mailto:|#)/.test(v)) return;
            const target = resolvePath(path, v);
            if (!this.has(target)) return;
            const url = await this.url(target);
            if (ns) el.setAttributeNS(ns, attr, url);
            else el.setAttribute(attr, url);
        };
        const xlink = "http://www.w3.org/1999/xlink";
        await Promise.all([
            ...Array.from(doc.querySelectorAll("img[src], source[src], audio[src], video[src]")).map((el) => swap(el, "src")),
            ...Array.from(doc.querySelectorAll("link[href]")).map((el) => swap(el, "href")),
            ...Array.from(doc.getElementsByTagNameNS("http://www.w3.org/2000/svg", "image")).map(async (el) => {
                await swap(el, "href", xlink);
                await swap(el, "href");
            }),
        ]);
        for (const style of Array.from(doc.querySelectorAll("style"))) {
            style.textContent = await this.rewriteCss(style.textContent ?? "", path);
        }
        for (const a of Array.from(doc.querySelectorAll("a[href]"))) {
            const href = a.getAttribute("href") ?? "";
            if (/^(https?:|mailto:)/.test(href)) {
                a.setAttribute("data-external", href);
                continue;
            }
            const target = href.startsWith("#") ? path : resolvePath(path, href);
            const chapter = this.chapters.findIndex((c) => c.path === target);
            if (chapter >= 0) a.setAttribute("data-chapter", `${chapter}#${href.split("#")[1] ?? ""}`);
        }
        const style = doc.createElement("style");
        style.textContent = readerCss;
        (doc.head ?? doc.documentElement).appendChild(style);
        return xml
            ? { content: new XMLSerializer().serializeToString(doc), type: "application/xhtml+xml" }
            : { content: "<!DOCTYPE html>" + doc.documentElement.outerHTML, type: "text/html" };
    }

    async chapterText(index: number): Promise<string> {
        const doc = new DOMParser().parseFromString(await this.text(this.chapters[index].path), "text/html");
        doc.querySelectorAll("script, style").forEach((e) => e.remove());
        return doc.body?.textContent ?? "";
    }

    /** Frees the blob URLs. */
    close() {
        for (const p of this.urls.values()) p.then((u) => URL.revokeObjectURL(u), () => {});
        this.urls.clear();
        this.zip.clear();
    }
}
