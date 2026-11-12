import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Dragging items onto folders or tags in the left pane, built on pointer events.
 *
 * HTML5 drag-and-drop is not used on purpose: on Windows, Tauri's native file-drop handling
 * (which gives us real file paths for attachments) swallows HTML5 drag events inside the page.
 *
 * Drop targets are elements with `data-drop-collection="<id>"`, `data-drop-tag="<id>"`, or
 * `data-drop-related="<item id>"` (the 關聯 section of an item's detail pane).
 */
export type DropTarget = { kind: "collection" | "tag" | "related"; id: number };

export interface ItemDrag {
    /** The dragged items (all selected items when dragging a selected row). */
    itemIds: number[];
    title: string;
    x: number;
    y: number;
    /** Folder, tag or 關聯 section under the pointer, if any. */
    target: DropTarget | null;
    /** Shift held: move instead of add (folders only, 文獻庫). */
    move: boolean;
    /** Ctrl held: keep the items where they are too (folders only, 檔案庫). */
    copy: boolean;
}

const DRAG_THRESHOLD = 5;

function targetAt(x: number, y: number): DropTarget | null {
    const el = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>("[data-drop-collection],[data-drop-tag],[data-drop-related]");
    if (!el) return null;
    if (el.dataset.dropCollection) return { kind: "collection", id: Number(el.dataset.dropCollection) };
    if (el.dataset.dropRelated) return { kind: "related", id: Number(el.dataset.dropRelated) };
    return { kind: "tag", id: Number(el.dataset.dropTag) };
}

export function useItemDrag(onDrop: (itemIds: number[], target: DropTarget, keys: { shift: boolean; ctrl: boolean }) => void) {
    const [drag, setDrag] = useState<ItemDrag | null>(null);
    const onDropRef = useRef(onDrop);
    onDropRef.current = onDrop;
    const cleanupRef = useRef<(() => void) | null>(null);

    useEffect(() => () => cleanupRef.current?.(), []);

    const startDrag = useCallback((e: React.PointerEvent, item: { ids: number[]; title: string }) => {
        if (e.button !== 0) return;
        cleanupRef.current?.();
        const startX = e.clientX;
        const startY = e.clientY;
        let current: ItemDrag | null = null;

        const update = (x: number, y: number, move: boolean, copy: boolean) => {
            current = { itemIds: item.ids, title: item.title, x, y, target: targetAt(x, y), move, copy };
            setDrag(current);
        };

        const onMove = (ev: PointerEvent) => {
            if (!current && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
            if (!current) document.body.classList.add("dragging-item");
            update(ev.clientX, ev.clientY, ev.shiftKey, ev.ctrlKey || ev.metaKey);
        };
        const onUp = (ev: PointerEvent) => {
            const dropped = current;
            cleanup();
            if (dropped && dropped.target !== null) {
                onDropRef.current(dropped.itemIds, dropped.target, { shift: ev.shiftKey, ctrl: ev.ctrlKey || ev.metaKey });
            }
        };
        const onKey = (ev: KeyboardEvent) => {
            if (ev.key === "Escape") cleanup();
            else if (ev.key === "Shift" && current) update(current.x, current.y, ev.type === "keydown", current.copy);
            else if ((ev.key === "Control" || ev.key === "Meta") && current) update(current.x, current.y, current.move, ev.type === "keydown");
        };
        const cleanup = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", cleanup);
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("keyup", onKey);
            window.removeEventListener("blur", cleanup);
            document.body.classList.remove("dragging-item");
            current = null;
            cleanupRef.current = null;
            setDrag(null);
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", cleanup);
        window.addEventListener("keydown", onKey);
        window.addEventListener("keyup", onKey);
        window.addEventListener("blur", cleanup);
        cleanupRef.current = cleanup;
    }, []);

    return { drag, startDrag };
}
