/**
 * Citation keys → data, fetched from the backend in batches and cached for every view
 * (rendered cards, the editor, reference lists). `useCiteData(keys)` re-renders when they arrive.
 */
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useSyncExternalStore } from "react";
import { parseLocation, placeLabel } from "../annotator/api";
import { citeDataOf, type CiteItem, type ImportItem } from "./bibtex.ts";
import type { CiteData } from "./cite.ts";

interface CiteEntry {
    key: string;
    item: CiteItem;
    annotation: { id: number; kind: string; color: string; quote: string; note: string; location: string; attachmentId: number; fileName: string } | null;
}

export interface CiteHit {
    key: string;
    itemId: number;
    itemType: string;
    title: string;
    authors: string;
    date: string;
    quote: string | null;
    kind: string | null;
    color: string | null;
}

export const citeApi = {
    resolve: (keys: string[]) => invoke<CiteEntry[]>("resolve_cite_keys", { keys }),
    search: (query: string, limit = 12) => invoke<CiteHit[]>("search_citables", { query, limit }),
    annotationKey: (id: number) => invoke<string | null>("annotation_cite_key", { id }),
    setKey: (itemId: number, key: string) => invoke<string>("set_cite_key", { itemId, key }),
    items: (ids: number[] | null, library: string | null) => invoke<CiteItem[]>("list_cite_items", { ids, library }),
    import: (entries: ImportItem[], collectionId: number | null) =>
        invoke<{ keys: string[]; renamed: number }>("import_items", { entries, collectionId }),
    saveFile: (defaultName: string, content: string) => invoke<string | null>("save_text_file", { defaultName, content }),
    openBibFile: () => invoke<string | null>("open_bib_file"),
};

function toCiteData(e: CiteEntry): CiteData {
    const d = { ...citeDataOf(e.item), key: e.key };
    if (e.annotation) {
        const a = e.annotation;
        d.annotation = { id: a.id, kind: a.kind, color: a.color, quote: a.quote, note: a.note, locator: placeLabel(parseLocation(a)) };
    }
    return d;
}

// ---- the cache ----------------------------------------------------------------------------------

/** null = asked and not found. */
const cache = new Map<string, CiteData | null>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function notify() {
    version++;
    for (const l of listeners) l();
}

function flush() {
    timer = null;
    const keys = [...pending];
    pending.clear();
    if (keys.length === 0) return;
    citeApi.resolve(keys).then(
        (entries) => {
            for (const k of keys) cache.set(k, null);
            for (const e of entries) cache.set(e.key, toCiteData(e));
            notify();
        },
        () => {
            // No backend (e.g. the browser-only dev server): leave them unresolved.
            for (const k of keys) cache.set(k, null);
            notify();
        },
    );
}

/** Asks for keys not cached yet (batched). */
export function requestCites(keys: Iterable<string>) {
    for (const k of keys) {
        if (!k || cache.has(k) || pending.has(k)) continue;
        pending.add(k);
    }
    if (pending.size > 0 && timer === null) timer = setTimeout(flush, 30);
}

/** Cached data for a key: undefined = not known yet, null = no such key. */
export function getCite(key: string): CiteData | null | undefined {
    return cache.get(key);
}

/** Forget everything (an item or its key changed); views refetch what they show. */
export function invalidateCites() {
    cache.clear();
    notify();
}

export function subscribeCites(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** Resolves `keys` and re-renders when any cite data changes. Returns a lookup. */
export function useCiteData(keys: string[]): (key: string) => CiteData | null {
    const joined = keys.join("\u0000");
    const v = useSyncExternalStore(subscribeCites, () => version);
    // Re-request after `invalidateCites` (the version changes and the cache is empty).
    useEffect(() => {
        if (joined) requestCites(joined.split("\u0000"));
    }, [joined, v]);
    return (key) => cache.get(key) ?? null;
}

/** Event fired so the app opens an item in Drawer (detail: item id). */
export const OPEN_ITEM_EVENT = "banyan:open-item";

export function openItemInDrawer(itemId: number) {
    window.dispatchEvent(new CustomEvent<number>(OPEN_ITEM_EVENT, { detail: itemId }));
}
