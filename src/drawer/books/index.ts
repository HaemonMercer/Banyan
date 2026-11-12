import type { Book } from "./types";
import { EpubBook } from "./epub";
import { MobiBook } from "./mobi";
import { Fb2Book } from "./fb2";
import { TxtBook } from "./txt";
import { Zip } from "./zip";
import { sniffImage } from "./types";

export type { Book, Chapter, TocEntry } from "./types";

const ext = (name: string) => /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";

/** File extensions the book reader opens. */
export const BOOK_EXTS = ["epub", "mobi", "azw", "azw3", "prc", "fb2", "fbz", "txt"];
/** Comic archives (pictures in a ZIP). */
export const COMIC_EXTS = ["cbz"];
/** Recognized as e-books but can't be opened yet. */
export const UNSUPPORTED_BOOK = ["cbr", "cb7", "kfx", "djvu"];

export const isBookFile = (name: string) => BOOK_EXTS.includes(ext(name));
export const isComicFile = (name: string) => COMIC_EXTS.includes(ext(name));

/** Opens a book file by its extension. */
export async function openBook(fileName: string, buf: ArrayBuffer): Promise<Book> {
    switch (ext(fileName)) {
        case "epub":
            return EpubBook.open(buf);
        case "mobi":
        case "azw":
        case "azw3":
        case "prc":
            return MobiBook.open(buf);
        case "fb2":
        case "fbz":
            return Fb2Book.open(buf);
        default:
            return new TxtBook(new Uint8Array(buf), fileName.replace(/\.[^.]+$/, ""));
    }
}

const PICTURE = /\.(jpe?g|png|gif|webp|bmp|avif)$/i;

/** Natural order: "page2" before "page10". */
const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** A comic archive: its pictures in page order, each loaded when shown. */
export class Comic {
    readonly pages: string[];
    private zip: Zip;
    private urls = new Map<string, Promise<string>>();

    constructor(buf: ArrayBuffer) {
        this.zip = new Zip(buf);
        this.pages = this.zip.names
            .filter((n) => PICTURE.test(n) && !n.startsWith("__MACOSX/") && !/(^|\/)\./.test(n))
            .sort(natural.compare);
        if (this.pages.length === 0) throw new Error("這個漫畫檔裡沒有圖片");
    }

    url(index: number): Promise<string> {
        const name = this.pages[index];
        let p = this.urls.get(name);
        if (!p) {
            p = this.zip.file(name).then((bytes) => URL.createObjectURL(new Blob([bytes as BlobPart], { type: sniffImage(bytes) })));
            this.urls.set(name, p);
        }
        return p;
    }

    close() {
        for (const p of this.urls.values()) p.then((u) => URL.revokeObjectURL(u), () => {});
        this.urls.clear();
        this.zip.clear();
    }
}
