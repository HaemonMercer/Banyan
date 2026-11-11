import { useEffect, useState } from "react";
import { errorMessage } from "../drawer/api";
import { whiteboardApi } from "./api";

/**
 * Files of board objects (images, PDFs), read once per session and kept as Blobs.
 * Stored names never change (a new file gets a new name), so the cache never goes stale.
 */
const blobs = new Map<string, Promise<Blob>>();
const urls = new Map<string, string>();

const key = (cardId: number, file: string) => `${cardId}/${file}`;

const MIME: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    avif: "image/avif",
    pdf: "application/pdf",
};

export function cardFileBlob(cardId: number, file: string): Promise<Blob> {
    const k = key(cardId, file);
    let p = blobs.get(k);
    if (!p) {
        const type = MIME[file.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";
        p = whiteboardApi.readCardFile(cardId, file).then((buf) => new Blob([buf], { type }));
        p.catch(() => blobs.delete(k)); // let a later attempt retry
        blobs.set(k, p);
    }
    return p;
}

export async function cardFileUrl(cardId: number, file: string): Promise<string> {
    const k = key(cardId, file);
    const have = urls.get(k);
    if (have) return have;
    const url = URL.createObjectURL(await cardFileBlob(cardId, file));
    urls.set(k, url);
    return url;
}

/** Remembers a file the page already has (e.g. a pasted image), so it shows without a read. */
export function primeCardFile(cardId: number, file: string, blob: Blob) {
    blobs.set(key(cardId, file), Promise.resolve(blob));
}

/** Object URL of a card's file; `error` when it cannot be read. */
export function useCardFileUrl(cardId: number, file: string | undefined) {
    const [state, setState] = useState<{ url: string | null; error: string | null }>({ url: null, error: null });
    useEffect(() => {
        if (!file) {
            setState({ url: null, error: null });
            return;
        }
        let stale = false;
        const have = urls.get(key(cardId, file));
        setState({ url: have ?? null, error: null });
        if (!have) {
            cardFileUrl(cardId, file).then(
                (url) => !stale && setState({ url, error: null }),
                (e) => !stale && setState({ url: null, error: errorMessage(e) }),
            );
        }
        return () => {
            stale = true;
        };
    }, [cardId, file]);
    return state;
}

/** Natural size of an image blob or URL. */
export function imageSize(src: Blob | string): Promise<{ width: number; height: number }> {
    return new Promise((resolve) => {
        const img = new Image();
        const url = typeof src === "string" ? src : URL.createObjectURL(src);
        img.onload = () => {
            resolve({ width: img.naturalWidth, height: img.naturalHeight });
            if (typeof src !== "string") URL.revokeObjectURL(url);
        };
        img.onerror = () => resolve({ width: 0, height: 0 });
        img.src = url;
    });
}
