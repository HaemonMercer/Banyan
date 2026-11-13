import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "../components/Feedback";

export type AnnotationColor = "yellow" | "green" | "blue" | "pink" | "purple";
export const COLORS: { id: AnnotationColor; label: string }[] = [
    { id: "yellow", label: "黃" },
    { id: "green", label: "綠" },
    { id: "blue", label: "藍" },
    { id: "pink", label: "粉紅" },
    { id: "purple", label: "紫" },
];

const COLOR_KEY = "banyan.annotator.color";

/** The color last used for a highlight ("筆記" and new highlights start with it). */
export function lastColor(): AnnotationColor {
    try {
        const c = localStorage.getItem(COLOR_KEY);
        if (COLORS.some((x) => x.id === c)) return c as AnnotationColor;
    } catch {
        /* no storage */
    }
    return "yellow";
}

function rememberColor(c: AnnotationColor) {
    try {
        localStorage.setItem(COLOR_KEY, c);
    } catch {
        /* this session only */
    }
}

/** Where in the file (stored as JSON). */
export type AnnotationLocation =
    /** PDF highlight: rectangles as fractions of their page: [page, x, y, w, h]. */
    | { type: "pdf"; page: number; rects: [number, number, number, number, number][] }
    /** Book highlight: character offsets in the chapter's text. */
    | { type: "book"; chapter: number; start: number; end: number; label: string }
    | { type: "pdf-page"; page: number }
    | { type: "book-place"; chapter: number; at: number; label: string };

export interface Annotation {
    id: number;
    attachmentId: number;
    kind: "highlight" | "bookmark";
    color: AnnotationColor;
    quote: string;
    note: string;
    location: string;
    sortKey: number;
    /** The card made from it ("建立卡片"), if any. */
    cardId: number | null;
    createdAt: number;
    updatedAt: number;
    /** How many cards cite it. */
    cardCount: number;
}

/** An annotation cited by a card (drawn on the card, listed in its panel). */
export interface AnnotationRef {
    annotationId: number;
    attachmentId: number;
    kind: Annotation["kind"];
    color: AnnotationColor;
    quote: string;
    note: string;
    location: string;
    fileName: string;
    itemId: number;
    itemTitle: string;
}

/** A card citing an annotation. */
export interface CitingCard {
    cardId: number;
    title: string;
    boards: string[];
}

/** Short text for an annotation chip: its quote, or the place of a bookmark. */
export function refLabel(a: Pick<AnnotationRef, "kind" | "quote" | "location">, max = 24): string {
    const q = a.quote.replace(/\s+/g, " ").trim();
    if (a.kind === "bookmark" || !q) return `書籤：${placeLabel(parseLocation(a))}`;
    return q.length > max ? `${q.slice(0, max)}…` : q;
}

export interface AnnotationInFile extends Annotation {
    fileName: string;
    itemId: number;
    itemTitle: string;
}

export interface AnnotatableFile {
    attachmentId: number;
    fileName: string;
    size: number;
    itemId: number;
    itemTitle: string;
    itemType: string;
    annotationCount: number;
    lastAnnotated: number;
}

export function parseLocation(a: Pick<Annotation, "location">): AnnotationLocation | null {
    try {
        return JSON.parse(a.location) as AnnotationLocation;
    } catch {
        return null;
    }
}

/** "第 3 頁", "第二章 開始". */
export function placeLabel(loc: AnnotationLocation | null): string {
    if (!loc) return "";
    if (loc.type === "pdf" || loc.type === "pdf-page") return `第 ${loc.page} 頁`;
    return loc.label || `第 ${loc.chapter + 1} 部分`;
}

export const annotationApi = {
    list: (attachmentId: number) => invoke<Annotation[]>("list_annotations", { attachmentId }),
    create: (attachmentId: number, a: { kind: Annotation["kind"]; color: AnnotationColor; quote: string; note: string; location: AnnotationLocation; sortKey: number }) =>
        invoke<Annotation>("create_annotation", { attachmentId, ...a, location: JSON.stringify(a.location) }),
    update: (id: number, changes: { color?: AnnotationColor; note?: string }) =>
        invoke<Annotation>("update_annotation", { id, color: changes.color ?? null, note: changes.note ?? null }),
    remove: (id: number) => invoke<void>("delete_annotation", { id }),
    files: () => invoke<AnnotatableFile[]>("list_annotatable_files"),
    search: (query: string) => invoke<AnnotationInFile[]>("search_annotations", { query }),
    get: (id: number) => invoke<AnnotationInFile>("get_annotation", { id }),
    /** Returns the card's id (the same card when one was made before). */
    toCard: (id: number, place: string) => invoke<number>("annotation_to_card", { id, place }),
    /** The card cites the annotation; false when it already did. */
    linkCard: (cardId: number, annotationId: number) => invoke<boolean>("link_card_annotation", { cardId, annotationId }),
    /** Its citation key (`kahneman2011:h3`); null when its item has no key yet. */
    citeKey: (id: number) => invoke<string | null>("annotation_cite_key", { id }),
    unlinkCard: (cardId: number, annotationId: number) => invoke<void>("unlink_card_annotation", { cardId, annotationId }),
    cardsOf: (annotationId: number) => invoke<CitingCard[]>("list_annotation_cards", { annotationId }),
};

/** Reloads the cached lists after a change made outside them (e.g. a card now cites one). */
export async function refreshAnnotations() {
    await Promise.all([...lists.keys()].map((id) => reload(id).catch(() => {})));
    if (lists.size === 0) {
        // No file's list is open (e.g. only Whiteboard's list): still tell the lists of all files.
        generation++;
        anyListeners.forEach((f) => f());
    }
}

// ---------- a shared, live list per file ----------
// The reader and the Annotator's side list show the same annotations; changes made in either
// show up in both. Lists are keyed by the attachment the reader opened. A 文獻庫 attachment and
// its 檔案庫 copy share annotations on the server under two keys here, so a change reloads every
// cached list, and a list is loaded afresh whenever a view of it opens.

const lists = new Map<number, Annotation[]>();
const listeners = new Map<number, Set<() => void>>();
/** Bumped when any annotation changes (the overview reloads). */
let generation = 0;
const anyListeners = new Set<() => void>();

function emit(attachmentId: number) {
    generation++;
    listeners.get(attachmentId)?.forEach((f) => f());
    anyListeners.forEach((f) => f());
}

async function reload(attachmentId: number) {
    lists.set(attachmentId, await annotationApi.list(attachmentId));
    emit(attachmentId);
}

/** The file's annotations (kept up to date) and the actions on them. */
export function useAnnotations(attachmentId: number | null, onError?: (message: string) => void) {
    const [, force] = useState(0);
    useEffect(() => {
        if (attachmentId === null) return;
        const f = () => force((n) => n + 1);
        let set = listeners.get(attachmentId);
        if (!set) listeners.set(attachmentId, (set = new Set()));
        set.add(f);
        reload(attachmentId).catch((e) => onError?.(String(e)));
        return () => {
            set!.delete(f);
        };
    }, [attachmentId]); // eslint-disable-line react-hooks/exhaustive-deps

    const run = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
        try {
            const r = await fn();
            await refreshAnnotations();
            return r;
        } catch (e) {
            onError?.(typeof e === "string" ? e : e instanceof Error ? e.message : String(e));
            return null;
        }
    };
    return {
        annotations: attachmentId === null ? [] : (lists.get(attachmentId) ?? []),
        create: (a: Parameters<typeof annotationApi.create>[1]) => {
            if (a.kind === "highlight") rememberColor(a.color);
            return run(() => annotationApi.create(attachmentId!, a));
        },
        update: (id: number, changes: { color?: AnnotationColor; note?: string }) => {
            if (changes.color) rememberColor(changes.color);
            return run(() => annotationApi.update(id, changes));
        },
        /**
         * Deletes it. One made into or cited by cards asks first (undoing would not bring the cards'
         * links back); any other can be undone from the toast that follows. False when not deleted.
         */
        remove: async (id: number): Promise<boolean> => {
            const a = attachmentId === null ? undefined : lists.get(attachmentId)?.find((x) => x.id === id);
            if (!a) return (await run(async () => (await annotationApi.remove(id), true))) === true;
            try {
                return await deleteAnnotation(a);
            } catch (e) {
                onError?.(typeof e === "string" ? e : e instanceof Error ? e.message : String(e));
                return false;
            }
        },
        toCard: (id: number, place: string) => run(() => annotationApi.toCard(id, place)),
    };
}

/**
 * Deletes an annotation (from any list: the Annotator's, Whiteboard's). One made into or cited by
 * cards asks first (undoing would not bring the cards' links back); any other can be undone from
 * the toast that follows. False when not deleted; throws when the delete fails.
 */
export async function deleteAnnotation(a: Annotation): Promise<boolean> {
    const linked = a.cardId !== null || a.cardCount > 0;
    if (linked) {
        const what = a.kind === "bookmark" ? "書籤" : "重點";
        const cards = a.cardCount > 0 ? `有 ${a.cardCount} 張卡片引用這個${what}` : `這個${what}已經做成卡片`;
        const ok = await ask({ title: `刪除這個${what}？`, message: `${cards}。刪除後卡片上的引用會消失（卡片本身保留），而且無法復原。`, confirm: "刪除", danger: true });
        if (!ok) return false;
    }
    await annotationApi.remove(a.id);
    await refreshAnnotations();
    if (!linked) window.dispatchEvent(new CustomEvent<Annotation>(DELETED_EVENT, { detail: a }));
    return true;
}

/** Re-renders when any annotation changes (for the overview and file counts). */
export function useAnnotationGeneration() {
    const [g, setG] = useState(generation);
    useEffect(() => {
        const f = () => setG(generation);
        anyListeners.add(f);
        return () => {
            anyListeners.delete(f);
        };
    }, []);
    return g;
}

/** Sent with the deleted annotation, so it can be put back (see AnnotationUndo). */
export const DELETED_EVENT = "banyan:annotation-deleted";

/** Puts a deleted annotation back (as a new one with the same content). */
export async function restoreAnnotation(a: Annotation) {
    const location = parseLocation(a);
    if (!location) throw new Error("註解的位置格式不正確");
    await annotationApi.create(a.attachmentId, { kind: a.kind, color: a.color, quote: a.quote, note: a.note, location, sortKey: a.sortKey });
    await refreshAnnotations();
}

/** Asks the app to show an annotation in the Annotator (e.g. from a card's link back). */
export function openAnnotation(id: number) {
    window.dispatchEvent(new CustomEvent("banyan:open-annotation", { detail: id }));
}

/** Asks the app to show a card in Whiteboard's side panel (a card made from an annotation). */
export function openCardInWhiteboard(cardId: number) {
    window.dispatchEvent(new CustomEvent("banyan:open-card", { detail: cardId }));
}
