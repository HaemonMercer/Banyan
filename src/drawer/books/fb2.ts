/**
 * FictionBook (FB2, and FBZ = a zipped FB2): an XML book. Each top-level <section> becomes a
 * chapter; FB2 elements are turned into HTML, pictures come from the embedded <binary> parts.
 */
import { esc, htmlPage, type Book, type Chapter, type TocEntry } from "./types";
import { decodeText } from "./txt";
import { Zip, isZip } from "./zip";

const XLINK = "http://www.w3.org/1999/xlink";

export class Fb2Book implements Book {
    title = "";
    chapters: Chapter[] = [];
    toc: TocEntry[] = [];
    vertical = false;
    private sections: Element[] = [];
    private images = new Map<string, string>();
    private ids = new Map<string, number>();

    static async open(buf: ArrayBuffer): Promise<Fb2Book> {
        let bytes: Uint8Array = new Uint8Array(buf);
        if (isZip(buf)) {
            const zip = new Zip(buf);
            const name = zip.names.find((n) => /\.fb2$/i.test(n));
            if (!name) throw new Error("壓縮檔裡沒有 FB2 書");
            bytes = await zip.file(name);
        }
        // The XML prolog names the encoding (often windows-1251); otherwise detect it.
        const prolog = new TextDecoder("latin1").decode(bytes.subarray(0, 200));
        const declared = /encoding=["']([\w-]+)["']/i.exec(prolog)?.[1];
        let text: string;
        try {
            text = declared ? new TextDecoder(declared).decode(bytes) : decodeText(bytes).text;
        } catch {
            text = decodeText(bytes).text;
        }
        const book = new Fb2Book();
        book.read(new DOMParser().parseFromString(text, "application/xml"));
        return book;
    }

    private read(doc: Document) {
        if (doc.getElementsByTagName("parsererror").length > 0) throw new Error("不是有效的 FB2 檔");
        const byName = (root: Element | Document, name: string) => Array.from(root.getElementsByTagNameNS("*", name));
        this.title = byName(doc, "book-title")[0]?.textContent?.trim() ?? "";
        for (const bin of byName(doc, "binary")) {
            const id = bin.getAttribute("id");
            const type = bin.getAttribute("content-type") ?? "image/jpeg";
            if (!id) continue;
            try {
                const raw = Uint8Array.from(atob((bin.textContent ?? "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
                this.images.set(id, URL.createObjectURL(new Blob([raw], { type })));
            } catch {
                /* broken picture */
            }
        }
        // The main body (not the notes body): its top-level sections are the chapters.
        const bodies = byName(doc, "body");
        const main = bodies.find((b) => !b.getAttribute("name")) ?? bodies[0];
        if (!main) throw new Error("這本書沒有內容");
        const top = Array.from(main.children).filter((c) => c.localName === "section");
        this.sections = top.length > 0 ? top : [main];
        // Notes and comments go last, as their own chapters.
        for (const b of bodies) if (b !== main) this.sections.push(b);

        this.sections.forEach((s, i) => {
            s.querySelectorAll("[id]").forEach((e) => this.ids.set(e.getAttribute("id")!, i));
            if (s.getAttribute("id")) this.ids.set(s.getAttribute("id")!, i);
            const title = Array.from(s.children).find((c) => c.localName === "title")?.textContent?.replace(/\s+/g, " ").trim();
            const label = title || (s.localName === "body" && s.getAttribute("name") === "notes" ? "註釋" : `第 ${i + 1} 部分`);
            this.chapters.push({ path: String(i), label });
            this.toc.push({ label, path: String(i), fragment: "", depth: 0 });
            // Sub-sections with titles go into the table of contents too.
            Array.from(s.children)
                .filter((c) => c.localName === "section")
                .forEach((sub) => {
                    const t = Array.from(sub.children).find((c) => c.localName === "title")?.textContent?.replace(/\s+/g, " ").trim();
                    const id = sub.getAttribute("id") ?? `s${i}-${this.toc.length}`;
                    sub.setAttribute("id", id);
                    if (t) this.toc.push({ label: t, path: String(i), fragment: id, depth: 1 });
                });
        });
    }

    /** FB2 elements as HTML. */
    private html(el: Element): string {
        const kids = () => Array.from(el.childNodes).map((n) => (n.nodeType === Node.TEXT_NODE ? esc(n.textContent ?? "") : n.nodeType === Node.ELEMENT_NODE ? this.html(n as Element) : "")).join("");
        const id = el.getAttribute("id") ? ` id="${esc(el.getAttribute("id")!)}"` : "";
        switch (el.localName) {
            case "section":
            case "body":
                return `<section${id}>${kids()}</section>`;
            case "title":
                return `<h2${id}>${kids()}</h2>`;
            case "subtitle":
                return `<h3${id}>${kids()}</h3>`;
            case "p":
                return `<p${id}>${kids()}</p>`;
            case "empty-line":
                return "<br>";
            case "emphasis":
                return `<em>${kids()}</em>`;
            case "strong":
                return `<strong>${kids()}</strong>`;
            case "strikethrough":
                return `<s>${kids()}</s>`;
            case "sup":
            case "sub":
            case "code":
                return `<${el.localName}>${kids()}</${el.localName}>`;
            case "epigraph":
            case "cite":
                return `<blockquote${id}>${kids()}</blockquote>`;
            case "text-author":
                return `<p class="author">${kids()}</p>`;
            case "poem":
            case "stanza":
                return `<div class="${el.localName}"${id}>${kids()}</div>`;
            case "v":
                return `<p class="verse">${kids()}</p>`;
            case "image": {
                const href = (el.getAttributeNS(XLINK, "href") ?? el.getAttribute("l:href") ?? el.getAttribute("href") ?? "").replace(/^#/, "");
                const url = this.images.get(href);
                return url ? `<img src="${url}" alt="">` : "";
            }
            case "a": {
                const href = el.getAttributeNS(XLINK, "href") ?? el.getAttribute("l:href") ?? el.getAttribute("href") ?? "";
                if (href.startsWith("#")) {
                    const target = this.ids.get(href.slice(1));
                    return target === undefined ? kids() : `<a href="${esc(href)}" data-chapter="${target}#${esc(href.slice(1))}">${kids()}</a>`;
                }
                return `<a href="${esc(href)}" data-external="${esc(href)}">${kids()}</a>`;
            }
            case "table":
            case "tr":
            case "td":
            case "th":
                return `<${el.localName}>${kids()}</${el.localName}>`;
            default:
                return kids();
        }
    }

    async chapter(index: number, readerCss: string) {
        const css = `${readerCss}
p { text-indent: 2em; margin: 0 0 .5em; }
h2 p, h3 p { text-indent: 0; }
blockquote { margin: 1em 2em; font-style: italic; }
.poem { margin: 1em 2em; } .verse { text-indent: 0; margin: 0; }
.author { text-align: right; font-style: normal; }`;
        return htmlPage(this.html(this.sections[index]), css, this.chapters[index].label);
    }

    async chapterText(index: number) {
        return this.sections[index].textContent ?? "";
    }

    close() {
        for (const u of this.images.values()) URL.revokeObjectURL(u);
        this.images.clear();
    }
}
