import { useEffect, useState } from "react";
import { drawerApi } from "./api";

/**
 * Pictures of attachments, read once per session and kept as object URLs (galleries).
 * An attachment's file never changes in place, so the cache never goes stale.
 */
const urls = new Map<number, Promise<string>>();

/** Raster formats are recognized from their bytes; SVG needs its type to be named. */
function blobOf(buf: ArrayBuffer): Blob {
    const head = new TextDecoder().decode(buf.slice(0, 256)).trimStart();
    const svg = head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"));
    return svg ? new Blob([buf], { type: "image/svg+xml" }) : new Blob([buf]);
}

function imageUrl(id: number): Promise<string> {
    let p = urls.get(id);
    if (!p) {
        p = drawerApi.readAttachment(id).then((buf) => URL.createObjectURL(blobOf(buf)));
        p.catch(() => urls.delete(id)); // let a later attempt retry
        urls.set(id, p);
    }
    return p;
}

/**
 * Object URL of an attachment picture, loaded once `visible` turns true.
 * `failed` when the file can't be read (e.g. a linked file that was moved).
 */
export function useAttachmentImage(id: number | null, visible: boolean) {
    const [state, setState] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false });
    useEffect(() => {
        if (id === null || !visible) return;
        let stale = false;
        imageUrl(id).then(
            (url) => !stale && setState({ url, failed: false }),
            () => !stale && setState({ url: null, failed: true }),
        );
        return () => {
            stale = true;
        };
    }, [id, visible]);
    return id === null ? { url: null, failed: false } : state;
}
