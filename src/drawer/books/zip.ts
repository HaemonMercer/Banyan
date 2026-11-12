/**
 * Reading ZIP files (EPUB, CBZ, FBZ) without a library: the central directory is parsed by hand
 * and deflated entries are inflated with the browser's DecompressionStream.
 */

interface ZipEntry {
    name: string;
    method: number;
    compressedSize: number;
    localOffset: number;
}

export class Zip {
    /** Entry names, in the archive's order. */
    readonly names: string[];
    private entries = new Map<string, ZipEntry>();
    private cache = new Map<string, Promise<Uint8Array>>();

    constructor(private buf: ArrayBuffer) {
        const view = new DataView(buf);
        // End of central directory: signature 0x06054b50, within the last 64 KB + 22 bytes.
        let eocd = -1;
        for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65_557); i--) {
            if (view.getUint32(i, true) === 0x06054b50) {
                eocd = i;
                break;
            }
        }
        if (eocd < 0) throw new Error("不是有效的壓縮檔（找不到 ZIP 目錄）");
        const count = view.getUint16(eocd + 10, true);
        let p = view.getUint32(eocd + 16, true);
        const utf8 = new TextDecoder("utf-8");
        for (let n = 0; n < count; n++) {
            if (view.getUint32(p, true) !== 0x02014b50) break;
            const method = view.getUint16(p + 10, true);
            const compressedSize = view.getUint32(p + 20, true);
            const nameLen = view.getUint16(p + 28, true);
            const extraLen = view.getUint16(p + 30, true);
            const commentLen = view.getUint16(p + 32, true);
            const localOffset = view.getUint32(p + 42, true);
            const name = utf8.decode(new Uint8Array(buf, p + 46, nameLen));
            this.entries.set(name, { name, method, compressedSize, localOffset });
            p += 46 + nameLen + extraLen + commentLen;
        }
        this.names = [...this.entries.keys()];
    }

    has(name: string) {
        return this.entries.has(name);
    }

    /** The entry's bytes (inflated once, then cached). */
    file(name: string): Promise<Uint8Array> {
        let p = this.cache.get(name);
        if (!p) {
            const e = this.entries.get(name);
            if (!e) return Promise.reject(new Error(`找不到 ${name}`));
            const view = new DataView(this.buf);
            if (view.getUint32(e.localOffset, true) !== 0x04034b50) return Promise.reject(new Error(`無法讀取 ${name}`));
            const start = e.localOffset + 30 + view.getUint16(e.localOffset + 26, true) + view.getUint16(e.localOffset + 28, true);
            const raw = new Uint8Array(this.buf, start, e.compressedSize);
            if (e.method === 0) p = Promise.resolve(raw);
            else if (e.method === 8) p = inflateRaw(raw);
            else return Promise.reject(new Error(`不支援的壓縮方式（${e.method}）`));
            this.cache.set(name, p);
        }
        return p;
    }

    async text(name: string): Promise<string> {
        return new TextDecoder("utf-8").decode(await this.file(name));
    }

    /** Forgets inflated entries (they can be inflated again). */
    clear() {
        this.cache.clear();
    }
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const isZip = (buf: ArrayBuffer) => buf.byteLength > 4 && new DataView(buf).getUint32(0, true) === 0x04034b50;
