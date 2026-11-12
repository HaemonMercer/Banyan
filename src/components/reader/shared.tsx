import { useCallback, useEffect, useState, type ReactNode } from "react";
import { drawerApi, errorMessage } from "../../drawer/api";

/* Shared by the reader's views (kept apart from Reader.tsx so the views don't import it back). */

/** Saved reading position per attachment (PDF page, book chapter…), remembered between sessions. */
export function usePosition<T>(id: number) {
    const key = `banyan.reader.pos.${id}`;
    const load = useCallback((): T | null => {
        try {
            return JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
        } catch {
            return null;
        }
    }, [key]);
    const save = useCallback(
        (v: T) => {
            try {
                localStorage.setItem(key, JSON.stringify(v));
            } catch {
                /* storage unavailable */
            }
        },
        [key],
    );
    return { load, save };
}

/**
 * A URL the page can stream the file from (the `attachment:` protocol): video plays while
 * loading. A missing file shows up as the element's load error.
 */
export function useStreamUrl(id: number): { url: string | null; error: string | null } {
    return { url: drawerApi.attachmentUrl(id), error: null };
}

/** The whole file, read once (PDF, books, text). */
export function useFileBytes(id: number) {
    const [state, setState] = useState<{ data: ArrayBuffer | null; error: string | null }>({ data: null, error: null });
    useEffect(() => {
        let stale = false;
        setState({ data: null, error: null });
        drawerApi.readAttachment(id).then(
            (data) => !stale && setState({ data, error: null }),
            (e) => !stale && setState({ data: null, error: errorMessage(e) }),
        );
        return () => {
            stale = true;
        };
    }, [id]);
    return state;
}

export function ReaderMessage({ children }: { children: ReactNode }) {
    return <div className="reader-message">{children}</div>;
}
