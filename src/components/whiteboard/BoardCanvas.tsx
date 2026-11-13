import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { Icon, TypeIcon } from "../../icons/Icon";
import { summarize } from "../../markdown";
import Markdown, { sourceOffsetAt } from "../../markdown/Markdown";
import MarkdownEditor from "../../markdown/MarkdownEditor";
import {
    MIN_CARD_HEIGHT,
    MIN_CARD_WIDTH,
    SECTION_COLORS,
    pointsTo,
    type BoardCard,
    type CardLink,
    type Section,
} from "../../whiteboard/api";
import {
    STICKY_COLORS,
    STICKY_COLOR_NAMES,
    kindInfo,
    mindMapOutline,
    parseData,
    type StickyData,
} from "../../whiteboard/objects";
import { ImageBody, PdfBody, VideoBody } from "./BoardObjects";
import { openAnnotation, parseLocation, placeLabel, refLabel } from "../../annotator/api";
import MindMap from "./MindMap";
import TableObject from "./TableObject";
import ChartObject from "./ChartObject";
import CardMenu, { type CardMenuEntry } from "./CardMenu";
import { tableText } from "../../whiteboard/table";
import { isHomeActive } from "../../tabs";

/** Screen = board * zoom + (x, y). */
export interface Viewport {
    x: number;
    y: number;
    zoom: number;
}

export interface BoardCanvasHandle {
    /** Scrolls so the card is centered (keeps the zoom). */
    centerOn: (cardId: number) => void;
    fit: () => void;
    /** Center of the visible area, in board coordinates. */
    visibleCenter: () => { x: number; y: number };
    /** A viewport point (e.g. where something was dropped) in board coordinates. */
    toBoard: (clientX: number, clientY: number) => { x: number; y: number };
}

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface Props {
    cards: BoardCard[];
    links: CardLink[];
    sections: Section[];
    /** Selected cards (one or many). */
    selectedIds: number[];
    selectedLinkId: number | null;
    selectedSectionId: number | null;
    /** The card shown in the side panel (outlined). */
    openCardId: number | null;
    onSelect: (ids: number[]) => void;
    onSelectLink: (id: number | null) => void;
    onSelectSection: (id: number | null) => void;
    /** Double-click on empty space; (x, y) in board coordinates. */
    onCreateCard: (x: number, y: number) => void;
    /** Live update while dragging or resizing cards. */
    onMoveCards: (rects: Map<number, Rect>) => void;
    /** Drag or resize finished: the cards' final rectangles. */
    onPlaceCards: (rects: Map<number, Rect>) => void;
    onEditCard: (id: number, title: string, content: string) => void;
    onSaveCard: (id: number) => void;
    /** Delete cards everywhere (asks first). */
    onDeleteCards: (ids: number[]) => void;
    /** Take cards off this board only; they stay in the library. */
    onRemoveCards: (ids: number[]) => void;
    /** Open the card in the side panel. */
    onOpenCard: (id: number) => void;
    /** A plain click (no drag, no Shift) on empty board space. */
    onBackgroundClick?: () => void;
    /** Fold / unfold cards, or turn auto height on or off (undefined = unchanged). */
    onSetDisplay: (ids: number[], display: { collapsed?: boolean; autoHeight?: boolean }) => void;
    /** Copy (or cut) cards, to paste on any board with Ctrl+V. */
    onCopyCards: (ids: number[], cut: boolean) => void;
    /** A copy of the cards next to them on this board. */
    onDuplicateCards: (ids: number[]) => void;
    onLink: (a: number, b: number) => void;
    onUnlink: (link: CardLink) => void;
    /** Double-click on a line: edit its direction and note. */
    onEditLink?: (id: number) => void;
    onOpenItem: (itemId: number) => void;
    /** Live update while a section is moved or resized. */
    onSectionChange: (s: Section) => void;
    /** Section move/resize finished: its final rectangle and the cards it carried. */
    onSectionCommit: (section: Section, movedCards: Map<number, Rect>) => void;
    onSectionEdit: (s: Section) => void;
    onDeleteSection: (id: number) => void;
    /** Card highlighted as the target of a drag from the side list. */
    dropTargetId?: number | null;
    /**
     * An object's kind data changed (mind map edited, PDF page turned, sticky recoloured…);
     * `title` / `content` are updated with it when given.
     */
    onEditData: (id: number, data: string, title?: string, content?: string) => void;
    onError: (text: string) => void;
    /** "Insert chart" in a table: a chart of that range of the table. */
    onInsertChart?: (tableId: number, range: string) => void;
    /** Floating tools drawn over the board (e.g. the insert toolbar). */
    toolbar?: ReactNode;
    handle?: Ref<BoardCanvasHandle>;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
const MIN_SECTION = 120;

/** Where the segment from the rectangle's center toward (tx, ty) leaves the rectangle. */
function edgePoint(r: Rect, tx: number, ty: number) {
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const dx = tx - cx;
    const dy = ty - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    const t = Math.min(
        dx === 0 ? Infinity : r.width / 2 / Math.abs(dx),
        dy === 0 ? Infinity : r.height / 2 / Math.abs(dy),
    );
    return t >= 1 ? { x: cx, y: cy } : { x: cx + dx * t, y: cy + dy * t };
}

/** Notes and sticky notes can have their height follow the content. */
export const canAutoHeight = (c: { kind: string }) => !c.kind || c.kind === "note" || c.kind === "sticky";
/** The card's height is set by its content right now (not folded). */
const autoFits = (c: BoardCard) => c.autoHeight && !c.collapsed && canAutoHeight(c);
/** Height of a folded card until it has been measured. */
const FOLDED_GUESS = 48;

const center = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const rectOf = (c: Rect): Rect => ({ x: c.x, y: c.y, width: c.width, height: c.height });
const intersects = (a: Rect, b: Rect) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (inner: Rect, outer: Rect) =>
    inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

/**
 * The section a card dropped at `r` belongs to: the smallest section containing the card's
 * center. Dropping a card there makes it a member (the section grows to fit it, see WhiteboardView).
 */
export function sectionAt<S extends Rect>(sections: S[], r: Rect): S | null {
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    let best: S | null = null;
    for (const s of sections) {
        if (cx < s.x || cy < s.y || cx > s.x + s.width || cy > s.y + s.height) continue;
        if (!best || s.width * s.height < best.width * best.height) best = s;
    }
    return best;
}

/** Cards that sit entirely inside the section (they move with it). */
export function cardsInSection(cards: BoardCard[], s: Rect): number[] {
    return cards.filter((c) => inside(c, s)).map((c) => c.id);
}

type Gesture =
    | { kind: "pan"; startX: number; startY: number; vx: number; vy: number }
    | { kind: "box"; sx: number; sy: number; base: number[]; cx: number; cy: number; shift: boolean }
    | { kind: "move"; ids: number[]; grabbed: number; startX: number; startY: number; rects: Map<number, Rect>; moved: boolean; last?: Map<number, Rect> }
    | { kind: "resize"; id: number; startX: number; startY: number; rect: Rect; last?: Rect; ratio: number | null; widthOnly: boolean }
    | { kind: "link"; from: number }
    | {
          kind: "section";
          section: Section;
          startX: number;
          startY: number;
          cards: Map<number, Rect>;
          moved: boolean;
          last?: { section: Section; cards: Map<number, Rect> };
      }
    | { kind: "section-resize"; section: Section; startX: number; startY: number; last?: Section };

function BoardCanvas(props: Props) {
    const { cards, links, sections, selectedIds, selectedLinkId, selectedSectionId } = props;
    const rootRef = useRef<HTMLDivElement>(null);
    const [view, setView] = useState<Viewport>({ x: 40, y: 40, zoom: 1 });
    const viewRef = useRef(view);
    viewRef.current = view;
    const gesture = useRef<Gesture | null>(null);
    // End of the link being drawn, in board coordinates.
    const [linkEnd, setLinkEnd] = useState<{ x: number; y: number; target: number | null } | null>(null);
    const [panning, setPanning] = useState(false);
    /** Selection box in board coordinates while dragging on empty space. */
    const [box, setBox] = useState<Rect | null>(null);
    /** Section the dragged card is about to join (highlighted). */
    const [joinSection, setJoinSection] = useState<number | null>(null);
    /** Space held: dragging pans instead of selecting. */
    const [spaceDown, setSpaceDown] = useState(false);
    const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

    const propsRef = useRef(props);
    propsRef.current = props;

    /** Measured heights of folded cards (drawn as just their top bar; `height` is kept for unfolding). */
    const [foldedH, setFoldedH] = useState<Map<number, number>>(() => new Map());
    const foldedRef = useRef(foldedH);
    foldedRef.current = foldedH;
    /** Pending saves of heights set by content (auto height), per card. */
    const autoSaves = useRef(new Map<number, number>());
    /** The rectangle a card takes up on the board as drawn (folded cards are short). */
    const shownRect = useCallback(
        (c: BoardCard): Rect =>
            c.collapsed ? { x: c.x, y: c.y, width: c.width, height: foldedRef.current.get(c.id) ?? FOLDED_GUESS } : rectOf(c),
        [],
    );
    /** A card reports its drawn height: folded, or following its content. */
    const onMeasure = useCallback((id: number, h: number) => {
        const p = propsRef.current;
        const c = p.cards.find((x) => x.id === id);
        if (!c || h <= 0) return;
        if (c.collapsed) {
            setFoldedH((m) => (m.get(id) === h ? m : new Map(m).set(id, h)));
            return;
        }
        if (!autoFits(c)) return;
        const height = Math.max(MIN_CARD_HEIGHT, Math.round(h));
        if (Math.abs(height - c.height) < 1) return;
        p.onMoveCards(new Map([[id, { ...rectOf(c), height }]]));
        // Save once typing settles (and with the card's position at that time).
        window.clearTimeout(autoSaves.current.get(id));
        autoSaves.current.set(
            id,
            window.setTimeout(() => {
                autoSaves.current.delete(id);
                const cur = propsRef.current.cards.find((x) => x.id === id);
                if (cur) propsRef.current.onPlaceCards(new Map([[id, rectOf(cur)]]));
            }, 600),
        );
    }, []);
    useEffect(
        () => () => {
            // Leaving the board: save heights that are still waiting.
            autoSaves.current.forEach((t, id) => {
                window.clearTimeout(t);
                const cur = propsRef.current.cards.find((x) => x.id === id);
                if (cur) propsRef.current.onPlaceCards(new Map([[id, rectOf(cur)]]));
            });
        },
        [],
    );

    const toBoard = useCallback((clientX: number, clientY: number) => {
        const r = rootRef.current!.getBoundingClientRect();
        const v = viewRef.current;
        return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom };
    }, []);

    const fit = useCallback(() => {
        const el = rootRef.current;
        const list: Rect[] = [...propsRef.current.cards.map(shownRect), ...propsRef.current.sections];
        if (!el) return;
        const { width, height } = el.getBoundingClientRect();
        if (list.length === 0) {
            setView({ x: 40, y: 40, zoom: 1 });
            return;
        }
        const minX = Math.min(...list.map((c) => c.x));
        const minY = Math.min(...list.map((c) => c.y));
        const maxX = Math.max(...list.map((c) => c.x + c.width));
        const maxY = Math.max(...list.map((c) => c.y + c.height));
        const pad = 60;
        const zoom = clampZoom(Math.min(1, (width - pad * 2) / (maxX - minX), (height - pad * 2) / (maxY - minY)));
        setView({
            zoom,
            x: width / 2 - ((minX + maxX) / 2) * zoom,
            y: height / 2 - ((minY + maxY) / 2) * zoom,
        });
    }, [shownRect]);

    useImperativeHandle(
        props.handle,
        () => ({
            fit,
            toBoard,
            visibleCenter: () => {
                const r = rootRef.current!.getBoundingClientRect();
                return toBoard(r.left + r.width / 2, r.top + r.height / 2);
            },
            centerOn: (id) => {
                const card = propsRef.current.cards.find((c) => c.id === id);
                const el = rootRef.current;
                if (!card || !el) return;
                const c = shownRect(card);
                const { width, height } = el.getBoundingClientRect();
                const z = viewRef.current.zoom;
                setView({ zoom: z, x: width / 2 - (c.x + c.width / 2) * z, y: height / 2 - (c.y + c.height / 2) * z });
            },
        }),
        [fit, toBoard, shownRect],
    );

    // Wheel: scroll pans, Ctrl + wheel (or pinch) zooms around the cursor. Needs a non-passive listener.
    useEffect(() => {
        const el = rootRef.current!;
        const onWheel = (e: WheelEvent) => {
            // Let text areas and the open editor scroll their own content.
            const ta = (e.target as HTMLElement).closest("textarea, .wb-card-md.editing");
            if (ta && !e.ctrlKey && ta.scrollHeight > ta.clientHeight) return;
            e.preventDefault();
            const v = viewRef.current;
            if (e.ctrlKey || e.metaKey) {
                const r = el.getBoundingClientRect();
                const px = e.clientX - r.left;
                const py = e.clientY - r.top;
                const zoom = clampZoom(v.zoom * Math.exp(-e.deltaY * 0.0015));
                const k = zoom / v.zoom;
                setView({ zoom, x: px - (px - v.x) * k, y: py - (py - v.y) * k });
            } else {
                setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
            }
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, []);

    // Hold Space to pan with the mouse (like Heptabase / design tools).
    useEffect(() => {
        const typing = () => {
            const el = document.activeElement;
            return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable);
        };
        const down = (e: KeyboardEvent) => {
            if (e.key === " " && !typing() && isHomeActive()) {
                e.preventDefault();
                setSpaceDown(true);
            }
        };
        const up = (e: KeyboardEvent) => e.key === " " && setSpaceDown(false);
        const blur = () => setSpaceDown(false);
        window.addEventListener("keydown", down);
        window.addEventListener("keyup", up);
        window.addEventListener("blur", blur);
        return () => {
            window.removeEventListener("keydown", down);
            window.removeEventListener("keyup", up);
            window.removeEventListener("blur", blur);
        };
    }, []);

    const zoomBy = (factor: number) => {
        const el = rootRef.current!;
        const { width, height } = el.getBoundingClientRect();
        const v = viewRef.current;
        const zoom = clampZoom(v.zoom * factor);
        const k = zoom / v.zoom;
        setView({ zoom, x: width / 2 - (width / 2 - v.x) * k, y: height / 2 - (height / 2 - v.y) * k });
    };

    const cardUnder = (clientX: number, clientY: number): number | null => {
        const el = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-card-id]");
        return el ? Number(el.dataset.cardId) : null;
    };

    const capture = (e: React.PointerEvent) => {
        rootRef.current!.setPointerCapture(e.pointerId);
        e.preventDefault();
    };
    /**
     * Pointer to capture once it starts moving. Title bars (card grips, section headers) capture
     * only when dragged: capturing on press would send the next click and double-click to the
     * board instead of the title, so renaming by double-click would never start.
     */
    const pendingCapture = useRef<{ id: number; x: number; y: number } | null>(null);
    const captureOnDrag = (e: React.PointerEvent) => {
        pendingCapture.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        e.preventDefault(); // no text selection while dragging
    };

    const onPointerDown = (e: React.PointerEvent) => {
        const target = e.target as HTMLElement;
        const cardEl = target.closest<HTMLElement>("[data-card-id]");
        const roleEl = target.closest<HTMLElement>("[data-role]");
        const role = roleEl?.dataset.role;
        const p = propsRef.current;

        // Pan: middle button anywhere, or Space + left button.
        if (e.button === 1 || (e.button === 0 && spaceDown)) {
            gesture.current = { kind: "pan", startX: e.clientX, startY: e.clientY, vx: view.x, vy: view.y };
            setPanning(true);
            capture(e);
            return;
        }
        if (e.button !== 0) return;

        // Sections: header moves the section and the cards inside it; corner resizes.
        if (role === "section-header" || role === "section-resize") {
            if (target.closest("input, button")) return;
            const section = p.sections.find((s) => s.id === Number(roleEl!.dataset.sectionId));
            if (!section) return;
            p.onSelectSection(section.id);
            p.onSelect([]);
            p.onSelectLink(null);
            if (role === "section-header") {
                const inner = new Map(
                    p.cards.filter((c) => inside(shownRect(c), section)).map((c) => [c.id, rectOf(c)] as const),
                );
                gesture.current = { kind: "section", section, startX: e.clientX, startY: e.clientY, cards: inner, moved: false };
                captureOnDrag(e);
            } else {
                gesture.current = { kind: "section-resize", section, startX: e.clientX, startY: e.clientY };
                capture(e);
            }
            return;
        }

        // Empty space (or a section's body): selection box.
        if (!cardEl && role !== "link") {
            p.onSelectLink(null);
            p.onSelectSection(null);
            const base = e.shiftKey ? [...p.selectedIds] : [];
            if (!e.shiftKey) p.onSelect([]);
            const pt = toBoard(e.clientX, e.clientY);
            gesture.current = { kind: "box", sx: pt.x, sy: pt.y, base, cx: e.clientX, cy: e.clientY, shift: e.shiftKey };
            capture(e);
            return;
        }
        if (!cardEl) return;

        const id = Number(cardEl.dataset.cardId);
        const card = p.cards.find((c) => c.id === id);
        if (!card) return;
        p.onSelectLink(null);
        p.onSelectSection(null);

        // Shift + click toggles the card in the selection (and never starts typing).
        // Inside a table, Shift + click extends the cell selection instead.
        const inTable = role === "tbl-cell" || role === "tbl-head";
        if (e.shiftKey && role !== "connect" && role !== "resize" && !inTable) {
            const next = selected.has(id) ? p.selectedIds.filter((x) => x !== id) : [...p.selectedIds, id];
            p.onSelect(next);
            if (role !== "grip") {
                e.preventDefault();
                return;
            }
        } else if (!selected.has(id) || role !== "grip") {
            p.onSelect([id]);
        }

        if (role === "grip") {
            // Moving a selected card moves the whole selection.
            const ids = selected.has(id) || e.shiftKey ? [...new Set([...p.selectedIds, id])] : [id];
            const rects = new Map(p.cards.filter((c) => ids.includes(c.id)).map((c) => [c.id, rectOf(c)] as const));
            gesture.current = { kind: "move", ids, grabbed: id, startX: e.clientX, startY: e.clientY, rects, moved: false };
            captureOnDrag(e);
            return;
        } else if (role === "resize") {
            // Images and videos keep their proportions.
            const ratio = card.kind === "image" || card.kind === "video" ? card.height / card.width : null;
            // Auto height: only the width is dragged; the content sets the height.
            const widthOnly = autoFits(card);
            gesture.current = { kind: "resize", id, startX: e.clientX, startY: e.clientY, rect: rectOf(card), ratio, widthOnly };
        } else if (role === "connect") {
            gesture.current = { kind: "link", from: id };
            setLinkEnd({ ...toBoard(e.clientX, e.clientY), target: null });
        } else {
            return; // Typing in the card: leave the pointer alone.
        }
        capture(e);
    };

    const onPointerMove = (e: React.PointerEvent) => {
        const g = gesture.current;
        if (!g) return;
        const pc = pendingCapture.current;
        if (pc && pc.id === e.pointerId) {
            // A few pixels of jitter between the clicks of a double-click is not a drag.
            if (Math.abs(e.clientX - pc.x) + Math.abs(e.clientY - pc.y) < 4) return;
            pendingCapture.current = null;
            rootRef.current!.setPointerCapture(e.pointerId);
        }
        const z = viewRef.current.zoom;
        const p = propsRef.current;
        if (g.kind === "pan") {
            setView({ ...viewRef.current, x: g.vx + e.clientX - g.startX, y: g.vy + e.clientY - g.startY });
        } else if (g.kind === "box") {
            const pt = toBoard(e.clientX, e.clientY);
            const r = { x: Math.min(g.sx, pt.x), y: Math.min(g.sy, pt.y), width: Math.abs(pt.x - g.sx), height: Math.abs(pt.y - g.sy) };
            setBox(r);
            const hits = p.cards.filter((c) => intersects(shownRect(c), r)).map((c) => c.id);
            p.onSelect([...new Set([...g.base, ...hits])]);
        } else if (g.kind === "move") {
            const dx = (e.clientX - g.startX) / z;
            const dy = (e.clientY - g.startY) / z;
            if (Math.abs(dx) + Math.abs(dy) > 0) g.moved = true;
            const next = new Map<number, Rect>();
            g.rects.forEach((r, id) => next.set(id, { ...r, x: r.x + dx, y: r.y + dy }));
            g.last = next;
            p.onMoveCards(next);
            // Highlight the section the grabbed card would join (not the one it is already in).
            const r = next.get(g.grabbed);
            const target = r ? sectionAt(p.sections, r) : null;
            const was = g.rects.get(g.grabbed);
            setJoinSection(target && was && !inside(was, target) ? target.id : null);
        } else if (g.kind === "resize") {
            const width = Math.max(MIN_CARD_WIDTH, g.rect.width + (e.clientX - g.startX) / z);
            g.last = {
                ...g.rect,
                width,
                height: g.widthOnly
                    ? g.rect.height
                    : g.ratio !== null
                      ? Math.max(MIN_CARD_HEIGHT, width * g.ratio)
                      : Math.max(MIN_CARD_HEIGHT, g.rect.height + (e.clientY - g.startY) / z),
            };
            p.onMoveCards(new Map([[g.id, g.last]]));
        } else if (g.kind === "link") {
            const target = cardUnder(e.clientX, e.clientY);
            setLinkEnd({ ...toBoard(e.clientX, e.clientY), target: target !== g.from ? target : null });
        } else if (g.kind === "section") {
            const dx = (e.clientX - g.startX) / z;
            const dy = (e.clientY - g.startY) / z;
            if (Math.abs(dx) + Math.abs(dy) > 0) g.moved = true;
            const section = { ...g.section, x: g.section.x + dx, y: g.section.y + dy };
            const next = new Map<number, Rect>();
            g.cards.forEach((r, id) => next.set(id, { ...r, x: r.x + dx, y: r.y + dy }));
            g.last = { section, cards: next };
            p.onSectionChange(section);
            if (next.size > 0) p.onMoveCards(next);
        } else if (g.kind === "section-resize") {
            g.last = {
                ...g.section,
                width: Math.max(MIN_SECTION, g.section.width + (e.clientX - g.startX) / z),
                height: Math.max(MIN_SECTION, g.section.height + (e.clientY - g.startY) / z),
            };
            p.onSectionChange(g.last);
        }
    };

    const onPointerUp = (e: React.PointerEvent) => {
        const g = gesture.current;
        gesture.current = null;
        pendingCapture.current = null;
        setPanning(false);
        setBox(null);
        setJoinSection(null);
        if (!g) return;
        const p = propsRef.current;
        if (g.kind === "box") {
            // A click (not a selection drag) on empty space.
            if (!g.shift && Math.abs(e.clientX - g.cx) + Math.abs(e.clientY - g.cy) < 4) p.onBackgroundClick?.();
        } else if (g.kind === "move") {
            if (g.moved && g.last) p.onPlaceCards(g.last);
        } else if (g.kind === "resize") {
            if (g.last) p.onPlaceCards(new Map([[g.id, g.last]]));
        } else if (g.kind === "link") {
            setLinkEnd(null);
            const target = cardUnder(e.clientX, e.clientY);
            if (target !== null && target !== g.from) p.onLink(g.from, target);
        } else if (g.kind === "section") {
            if (g.moved && g.last) p.onSectionCommit(g.last.section, g.last.cards);
        } else if (g.kind === "section-resize") {
            if (g.last) p.onSectionCommit(g.last, new Map());
        }
    };

    const onDoubleClick = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest("[data-card-id], [data-role]")) return;
        const pt = toBoard(e.clientX, e.clientY);
        props.onCreateCard(pt.x - 120, pt.y - 30);
    };

    const byId = new Map(cards.map((c) => [c.id, c]));
    const rectById = new Map(cards.map((c) => [c.id, shownRect(c)]));
    const linkingFrom = gesture.current?.kind === "link" ? rectById.get(gesture.current.from) : undefined;
    const selectedLink = links.find((l) => l.id === selectedLinkId);

    /** The top bar's fold button and "⋯" menu of a card; menu actions cover the whole selection it is part of. */
    const actionsFor = (c: BoardCard): CardActions => {
        const ids = selected.has(c.id) && selectedIds.length > 1 ? selectedIds : [c.id];
        const n = ids.length > 1 ? `（${ids.length} 張）` : "";
        const menu: CardMenuEntry[] = [];
        if (canAutoHeight(c))
            menu.push({ label: "自動適應長度", checked: c.autoHeight, onClick: () => props.onSetDisplay(ids, { autoHeight: !c.autoHeight }) });
        menu.push(
            {
                label: (c.collapsed ? "展開" : "摺疊") + n,
                icon: c.collapsed ? "chevronDown" : "chevronRight",
                onClick: () => props.onSetDisplay(ids, { collapsed: !c.collapsed }),
            },
            { label: "在側邊面板開啟", icon: "openExternal", keys: "Enter", onClick: () => props.onOpenCard(c.id) },
            "sep",
            { label: "複製" + n, keys: "Ctrl+C", onClick: () => props.onCopyCards(ids, false) },
            { label: "剪下" + n, keys: "Ctrl+X", onClick: () => props.onCopyCards(ids, true) },
            { label: "建立副本" + n, keys: "Ctrl+D", onClick: () => props.onDuplicateCards(ids) },
            "sep",
            { label: "從白板移除" + n, icon: "close", keys: "Delete", onClick: () => props.onRemoveCards(ids) },
            { label: "完全刪除" + n, icon: "trash", keys: "Shift+Del", danger: true, onClick: () => props.onDeleteCards(ids) },
        );
        return {
            menu,
            onToggleFold: () => props.onSetDisplay([c.id], { collapsed: !c.collapsed }),
            onMeasure: (h) => onMeasure(c.id, h),
        };
    };

    const segment = (a: Rect, b: Rect) => {
        const ca = center(a);
        const cb = center(b);
        return { p: edgePoint(a, cb.x, cb.y), q: edgePoint(b, ca.x, ca.y) };
    };

    return (
        <div
            ref={rootRef}
            className={`wb-canvas${panning ? " panning" : ""}${spaceDown ? " space-pan" : ""}${linkEnd ? " linking" : ""}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={onDoubleClick}
            style={{
                backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`,
                backgroundPosition: `${view.x}px ${view.y}px`,
            }}
        >
            <div
                className="wb-world"
                style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
            >
                {sections.map((s) => (
                    <SectionView
                        key={s.id}
                        section={s}
                        selected={s.id === selectedSectionId}
                        joinTarget={s.id === joinSection}
                        onEdit={props.onSectionEdit}
                        onDelete={props.onDeleteSection}
                    />
                ))}

                <svg className="wb-links">
                    <defs>
                        {["", "-sel"].map((v) => (
                            <marker
                                key={v}
                                id={`wb-arrow${v}`}
                                viewBox="0 0 10 10"
                                refX="9"
                                refY="5"
                                markerWidth="7"
                                markerHeight="7"
                                markerUnits="strokeWidth"
                                orient="auto-start-reverse"
                            >
                                <path d="M0,0 L10,5 L0,10 z" className={`wb-arrow${v}`} />
                            </marker>
                        ))}
                    </defs>
                    {links.map((l) => {
                        const a = rectById.get(l.cardA);
                        const b = rectById.get(l.cardB);
                        if (!a || !b) return null;
                        const { p, q } = segment(a, b);
                        const sel = l.id === selectedLinkId;
                        const marker = `url(#wb-arrow${sel ? "-sel" : ""})`;
                        const toB = pointsTo(l, l.cardB);
                        const toA = pointsTo(l, l.cardA);
                        return (
                            <g
                                key={l.id}
                                className={`wb-link${sel ? " selected" : ""}`}
                                data-role="link"
                                onPointerDown={(e) => {
                                    if (e.button !== 0 || spaceDown) return;
                                    e.stopPropagation();
                                    props.onSelectLink(l.id);
                                    props.onSelect([]);
                                    props.onSelectSection(null);
                                }}
                                onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    props.onEditLink?.(l.id);
                                }}
                            >
                                <line className="wb-link-hit" x1={p.x} y1={p.y} x2={q.x} y2={q.y} />
                                <line
                                    className="wb-link-line"
                                    x1={p.x}
                                    y1={p.y}
                                    x2={q.x}
                                    y2={q.y}
                                    markerEnd={toB ? marker : undefined}
                                    markerStart={toA ? marker : undefined}
                                />
                                {!toA && <circle className="wb-link-end" cx={p.x} cy={p.y} r={3.5} />}
                                {!toB && <circle className="wb-link-end" cx={q.x} cy={q.y} r={3.5} />}
                            </g>
                        );
                    })}
                    {linkingFrom && linkEnd && (() => {
                        const target = linkEnd.target !== null ? rectById.get(linkEnd.target) : undefined;
                        const { p, q } = target
                            ? segment(linkingFrom, target)
                            : { p: edgePoint(linkingFrom, linkEnd.x, linkEnd.y), q: linkEnd };
                        return <line className="wb-link-draft" x1={p.x} y1={p.y} x2={q.x} y2={q.y} />;
                    })()}
                </svg>

                {cards.map((c) =>
                    c.kind && c.kind !== "note" && c.kind !== "sticky" ? (
                        <ObjectView
                            key={c.id}
                            card={c}
                            selected={selected.has(c.id)}
                            multi={selectedIds.length > 1}
                            opened={c.id === props.openCardId}
                            linkTarget={linkEnd?.target === c.id || props.dropTargetId === c.id}
                            zoom={view.zoom}
                            actions={actionsFor(c)}
                            onOpen={props.onOpenCard}
                            onEditData={props.onEditData}
                            onFit={(r) => props.onPlaceCards(new Map([[c.id, r]]))}
                            onError={props.onError}
                            findCard={(id) => byId.get(id)}
                            onInsertChart={props.onInsertChart ? (range) => props.onInsertChart!(c.id, range) : undefined}
                        />
                    ) : (
                        <CardView
                            key={c.id}
                            card={c}
                            selected={selected.has(c.id)}
                            multi={selectedIds.length > 1}
                            opened={c.id === props.openCardId}
                            linkTarget={linkEnd?.target === c.id || props.dropTargetId === c.id}
                            onEdit={props.onEditCard}
                            onSave={props.onSaveCard}
                            actions={actionsFor(c)}
                            onOpen={props.onOpenCard}
                            onOpenItem={props.onOpenItem}
                            onEditData={props.onEditData}
                            overview={view.zoom < OVERVIEW_ZOOM}
                            zoom={view.zoom}
                        />
                    ),
                )}

                {links.map((l) => {
                    const a = rectById.get(l.cardA);
                    const b = rectById.get(l.cardB);
                    if (!l.note || !a || !b) return null;
                    const { p, q } = segment(a, b);
                    return (
                        <div
                            key={l.id}
                            className={`wb-link-note${l.id === selectedLinkId ? " selected" : ""}`}
                            data-role="link"
                            title="連結備註（雙擊編輯）"
                            style={{ left: (p.x + q.x) / 2, top: (p.y + q.y) / 2 }}
                            onPointerDown={(e) => {
                                if (e.button !== 0 || spaceDown) return;
                                e.stopPropagation();
                                props.onSelectLink(l.id);
                                props.onSelect([]);
                                props.onSelectSection(null);
                            }}
                            onDoubleClick={(e) => {
                                e.stopPropagation();
                                props.onEditLink?.(l.id);
                            }}
                        >
                            {l.note}
                        </div>
                    );
                })}

                {selectedLink && rectById.get(selectedLink.cardA) && rectById.get(selectedLink.cardB) && (() => {
                    const { p, q } = segment(rectById.get(selectedLink.cardA)!, rectById.get(selectedLink.cardB)!);
                    // Sit above the note label when there is one.
                    const lift = selectedLink.note ? 22 : 0;
                    return (
                        <button
                            className="wb-unlink"
                            data-role="link"
                            title="移除連結（Delete）"
                            style={{ left: (p.x + q.x) / 2, top: (p.y + q.y) / 2 - lift, transform: `translate(-50%, -50%) scale(${1 / view.zoom})` }}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={() => props.onUnlink(selectedLink)}
                        >
                            ×
                        </button>
                    );
                })()}

                {box && (
                    <div className="wb-select-box" style={{ left: box.x, top: box.y, width: box.width, height: box.height }} />
                )}
            </div>


            {props.toolbar && (
                <div className="wb-toolbar-wrap" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                    {props.toolbar}
                </div>
            )}

            <div className="wb-zoom" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                <button onClick={() => zoomBy(1 / 1.2)} title="縮小"><Icon name="minus" /></button>
                <button onClick={() => setView({ ...view, zoom: 1 })} title="100%" className="wb-zoom-level">
                    {Math.round(view.zoom * 100)}%
                </button>
                <button onClick={() => zoomBy(1.2)} title="放大"><Icon name="plus" /></button>
                <button onClick={fit} title="顯示全部"><Icon name="fit" /></button>
            </div>
        </div>
    );
}

// ---------- sections ----------

const COLOR_NAMES: Record<string, string> = { "": "預設", blue: "藍", green: "綠", yellow: "黃", red: "紅", purple: "紫" };

function SectionView({
    section,
    selected,
    joinTarget,
    onEdit,
    onDelete,
}: {
    section: Section;
    selected: boolean;
    /** A card being dragged will join this section when dropped. */
    joinTarget: boolean;
    onEdit: (s: Section) => void;
    onDelete: (id: number) => void;
}) {
    const [renaming, setRenaming] = useState(false);
    const [name, setName] = useState(section.title);
    useEffect(() => setName(section.title), [section.title]);
    const finish = (save: boolean) => {
        if (!renaming) return; // Enter and the following blur: only once.
        setRenaming(false);
        if (save && name.trim() !== section.title) onEdit({ ...section, title: name.trim() });
        else setName(section.title);
    };
    return (
        <div
            className={`wb-section color-${section.color || "default"}${selected ? " selected" : ""}${joinTarget ? " join-target" : ""}`}
            style={{ left: section.x, top: section.y, width: section.width, height: section.height }}
        >
            <div
                className="wb-section-header"
                data-role="section-header"
                data-section-id={section.id}
                title="拖曳以移動區塊和裡面的卡片；雙擊標題重新命名"
                onDoubleClick={(e) => {
                    e.stopPropagation();
                    setRenaming(true);
                }}
            >
                {renaming ? (
                    <input
                        className="wb-section-input"
                        autoFocus
                        value={name}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => setName(e.target.value)}
                        onBlur={() => finish(true)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") finish(true);
                            if (e.key === "Escape") finish(false);
                        }}
                    />
                ) : (
                    <span className="wb-section-title">{section.title || "（未命名區塊）"}</span>
                )}
                <span className="wb-section-tools">
                    {SECTION_COLORS.map((c) => (
                        <button
                            key={c || "default"}
                            className={`wb-color-dot color-${c || "default"}${section.color === c ? " active" : ""}`}
                            title={`顏色：${COLOR_NAMES[c]}`}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={() => onEdit({ ...section, color: c })}
                        />
                    ))}
                    <button
                        className="wb-section-delete"
                        title="刪除區塊（卡片會保留）"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => onDelete(section.id)}
                    >
                        ×
                    </button>
                </span>
            </div>
            <div className="wb-section-resize" data-role="section-resize" data-section-id={section.id} title="拖曳以調整大小" />
        </div>
    );
}

// ---------- cards ----------

interface CardViewProps {
    card: BoardCard;
    selected: boolean;
    /** Part of a multi-selection (shows the selection style, no editing affordances). */
    multi: boolean;
    /** Shown in the side panel. */
    opened: boolean;
    linkTarget: boolean;
    onEdit: (id: number, title: string, content: string) => void;
    onSave: (id: number) => void;
    /** Fold button and "⋯" menu; null draws neither (card library). */
    actions: CardActions | null;
    onOpen: (id: number) => void;
    onOpenItem: (itemId: number) => void;
    onEditData: (id: number, data: string) => void;
    /** Zoomed far out: show the title large and a short plain-text summary. */
    overview: boolean;
    zoom: number;
}

/** Cards whose citation list is opened (kept while the app runs). */
const openRefs = new Set<number>();

/** Below this zoom, cards switch to the overview (title + summary in a readable size). */
const OVERVIEW_ZOOM = 0.55;

/** What the top bar of a card on a board can do besides opening it. */
export interface CardActions {
    menu: CardMenuEntry[];
    onToggleFold: () => void;
    /** The card's drawn height, reported while it is folded or follows its content. */
    onMeasure: (height: number) => void;
}

/** Reports the element's height while `on`. */
function useReportHeight(ref: React.RefObject<HTMLElement | null>, on: boolean, report: ((h: number) => void) | undefined) {
    const cb = useRef(report);
    cb.current = report;
    useEffect(() => {
        const el = ref.current;
        if (!el || !on) return;
        const send = () => cb.current?.(el.offsetHeight);
        send();
        const ro = new ResizeObserver(send);
        ro.observe(el);
        return () => ro.disconnect();
    }, [ref, on]);
}

/** Left end of a card's top bar: fold / unfold, then open in the side panel. */
function CardBarStart({ card, actions, onOpen }: { card: BoardCard; actions: CardActions | null; onOpen: (id: number) => void }) {
    if (!actions) return null;
    return (
        <>
            <button
                className={`wb-card-btn wb-card-fold${card.collapsed ? " folded" : ""}`}
                title={card.collapsed ? "展開卡片" : "摺疊卡片（只留標題列）"}
                onPointerDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={actions.onToggleFold}
            >
                <Icon name={card.collapsed ? "chevronRight" : "chevronDown"} />
            </button>
            <button
                className="wb-card-btn wb-card-open"
                title="在側邊面板開啟（Enter）"
                onPointerDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={() => onOpen(card.id)}
            >
                <Icon name="openExternal" />
            </button>
        </>
    );
}

function CardView({ card, selected, multi, opened, linkTarget, onEdit, onSave, actions, onOpen, onOpenItem, onEditData, overview, zoom }: CardViewProps) {
    // Sticky notes: a coloured square of text, no title.
    const sticky = card.kind === "sticky";
    const stickyColor = sticky ? parseData<StickyData>(card.data).color ?? "yellow" : null;
    // Content shows as text; clicking it swaps in the editor with the caret at that spot.
    // `offset` is where the caret goes (null = end of the text).
    const [editing, setEditing] = useState<{ offset: number | null } | null>(null);
    // The preview shows what fits; when more is hidden, it fades out and shows "⋯".
    const previewRef = useRef<HTMLDivElement>(null);
    const [clipped, setClipped] = useState(false);
    useEffect(() => {
        const el = previewRef.current;
        if (!el || editing || overview || card.autoHeight) {
            setClipped(false);
            return;
        }
        const check = () => setClipped(el.scrollHeight > el.clientHeight + 2);
        check();
        const ro = new ResizeObserver(check);
        ro.observe(el);
        if (el.firstElementChild) ro.observe(el.firstElementChild);
        return () => ro.disconnect();
    }, [editing, overview, card.content, card.height, card.width, card.autoHeight, card.collapsed]);
    const summary = useMemo(() => (overview ? summarize(card.content, 90) : ""), [overview, card.content]);
    // Overview text grows as the board shrinks, so it stays readable on screen.
    const overviewScale = Math.min(2.6, 0.75 / zoom);
    const folded = card.collapsed;
    // Auto height (not while zoomed out, where the card shows only a summary).
    const autoFit = card.autoHeight && !folded && !overview;
    const rootRef = useRef<HTMLDivElement>(null);
    useReportHeight(rootRef, folded || autoFit, actions?.onMeasure);
    const foldedText = useMemo(() => (folded && sticky ? summarize(card.content, 60) : ""), [folded, sticky, card.content]);
    // Cited items and annotations are folded into one line until opened (remembered per card).
    const [refsOpen, setRefsOpen] = useState(() => openRefs.has(card.id));
    const toggleRefs = () => {
        const open = !refsOpen;
        if (open) openRefs.add(card.id);
        else openRefs.delete(card.id);
        setRefsOpen(open);
    };

    return (
        <div
            className={`wb-card${sticky ? ` wb-sticky sticky-${stickyColor}` : ""}${selected ? " selected" : ""}${selected && multi ? " multi" : ""}${opened ? " opened" : ""}${linkTarget ? " link-target" : ""}${overview && !editing ? " overview" : ""}${folded ? " collapsed" : ""}${autoFit ? " auto-height" : ""}`}
            ref={rootRef}
            data-card-id={card.id}
            style={{ left: card.x, top: card.y, width: card.width, height: folded || autoFit ? undefined : card.height }}
        >
            <div className="wb-card-grip" data-role="grip" title="拖曳以移動（已選取多張時一起移動）">
                <CardBarStart card={card} actions={actions} onOpen={onOpen} />
                <Icon name="grip" className="wb-grip-dots" />
                {sticky && (
                    <span className="wb-sticky-colors">
                        {STICKY_COLORS.map((c) => (
                            <button
                                key={c}
                                className={`wb-sticky-dot sticky-${c}${c === stickyColor ? " active" : ""}`}
                                title={`顏色：${STICKY_COLOR_NAMES[c]}`}
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={() => onEditData(card.id, JSON.stringify({ color: c }))}
                            />
                        ))}
                    </span>
                )}
                {actions && <CardMenu entries={actions.menu} />}
            </div>
            {folded && sticky && <div className="wb-card-folded-text">{foldedText || "（空白便利貼）"}</div>}
            {!sticky && <input
                className="wb-card-title"
                style={overview && !editing ? { fontSize: 14 * overviewScale } : undefined}
                data-card-input={card.id}
                value={card.title}
                placeholder="標題"
                onChange={(e) => onEdit(card.id, e.target.value, card.content)}
                onBlur={() => onSave(card.id)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        (e.currentTarget.parentElement?.querySelector(".wb-card-md") as HTMLElement | null)?.focus();
                    }
                }}
            />}
            {!folded && <>
            {card.tags.length > 0 && !(overview && !editing) && (
                <div className="wb-card-tags">
                    {card.tags.map((t) => (
                        <span key={t} className="wb-tag">#{t}</span>
                    ))}
                </div>
            )}
            <div
                ref={previewRef}
                className={`wb-card-md${editing ? " editing" : " preview"}${clipped ? " clipped" : ""}`}
                data-card-content={card.id}
                title={editing ? undefined : "點一下編輯；按 ↗ 在側邊面板開啟"}
                tabIndex={editing ? -1 : 0}
                onFocus={(e) => {
                    if (!editing && e.target === e.currentTarget) setEditing({ offset: null });
                }}
                onClick={(e) => {
                    if (editing || e.shiftKey || (e.target as HTMLElement).closest("a, input")) return;
                    setEditing({ offset: sourceOffsetAt(e.currentTarget, e.clientX, e.clientY) });
                }}
            >
                {editing ? (
                    <MarkdownEditor
                        value={card.content}
                        cardId={card.id}
                        initialOffset={editing.offset}
                        placeholder={sticky ? "寫點什麼…" : "內容"}
                        onChange={(v) => onEdit(card.id, card.title, v)}
                        onBlur={() => {
                            setEditing(null);
                            onSave(card.id);
                        }}
                    />
                ) : overview ? (
                    summary ? (
                        <div className="wb-card-summary" style={{ fontSize: 12 * overviewScale }}>
                            {summary}
                        </div>
                    ) : null
                ) : card.content.trim() ? (
                    <Markdown source={card.content} />
                ) : (
                    <div className="wb-card-placeholder">{sticky ? "寫點什麼…" : "內容"}</div>
                )}
            </div>
            {clipped && !editing && (
                <div className="wb-card-more" title="還有更多內容：點一下內容編輯，或按 ↗ 在側邊面板查看全部">⋯</div>
            )}
            {(card.items.length > 0 || card.annotations.length > 0) && !(overview && !editing) && (
                <button
                    className={`wb-refs-toggle${refsOpen ? " open" : ""}`}
                    title={refsOpen ? "收起引用" : "顯示引用的文獻與註解"}
                    onClick={toggleRefs}
                >
                    <Icon name={refsOpen ? "chevronDown" : "chevronRight"} />
                    <span>引用</span>
                    {card.items.length > 0 && <span className="wb-refs-count">{card.items.length} 筆文獻</span>}
                    {card.annotations.length > 0 && <span className="wb-refs-count">{card.annotations.length} 則註解</span>}
                </button>
            )}
            {refsOpen && (card.items.length > 0 || card.annotations.length > 0) && !(overview && !editing) && (
                <div className="wb-card-refs">
                    {card.items.map((it) => (
                        <button
                            key={it.itemId}
                            className="wb-ref"
                            title={"在 Drawer 中開啟：" + [it.title || "（無標題）", it.authors.split("\n")[0], it.date].filter(Boolean).join(" · ")}
                            onClick={() => onOpenItem(it.itemId)}
                        >
                            <TypeIcon type={it.itemType} className="wb-ref-icon" />
                            <span className="wb-ref-title">{it.title || "（無標題）"}</span>
                        </button>
                    ))}
                    {card.annotations.map((a) => (
                        <button
                            key={`a${a.annotationId}`}
                            className={`wb-ref wb-ref-annot annot-bg-${a.color}`}
                            title={`在 Annotator 中開啟：${a.quote || "書籤"}\n— ${a.itemTitle || a.fileName}，${placeLabel(parseLocation(a))}${a.note ? `\n筆記：${a.note}` : ""}`}
                            onClick={() => openAnnotation(a.annotationId)}
                        >
                            <span className="wb-ref-annot-mark" />
                            <span className="wb-ref-title">{refLabel(a)}</span>
                        </button>
                    ))}
                </div>
            )}
            </>}
            <div className="wb-card-connect" data-role="connect" title="拖到另一張卡片以建立連結" />
            {!folded && <div className="wb-card-resize" data-role="resize" title={autoFit ? "拖曳以調整寬度（高度隨內容）" : "拖曳以調整大小"} />}
        </div>
    );
}

// ---------- other objects (image, video, PDF, mind map) ----------

interface ObjectViewProps {
    card: BoardCard;
    selected: boolean;
    multi: boolean;
    opened: boolean;
    linkTarget: boolean;
    zoom: number;
    actions: CardActions | null;
    onOpen: (id: number) => void;
    onEditData: (id: number, data: string, title?: string, content?: string) => void;
    onFit: (r: Rect) => void;
    onError: (text: string) => void;
    /** Another card on the board (a chart's table). */
    findCard?: (id: number) => BoardCard | undefined;
    /** Tables: make a chart of a range. */
    onInsertChart?: (range: string) => void;
}

function ObjectView({ card, selected, multi, opened, linkTarget, zoom, actions, onOpen, onEditData, onFit, onError, findCard, onInsertChart }: ObjectViewProps) {
    const info = kindInfo(card.kind);
    const folded = card.collapsed;
    const rootRef = useRef<HTMLDivElement>(null);
    useReportHeight(rootRef, folded, actions?.onMeasure);
    const mindmap = card.kind === "mindmap";
    const table = card.kind === "table";
    /** Sized by their content: no resize corner, double-click edits inside. */
    const selfSized = mindmap || table;
    const active = selected && !multi;
    /** Tables, videos and PDFs can be renamed right on the board (double-click the title). */
    const renamable = card.kind === "table" || card.kind === "chart" || card.kind === "video" || card.kind === "pdf";
    const [renaming, setRenaming] = useState<string | null>(null);
    const finishRename = (save: boolean) => {
        if (renaming === null) return;
        const name = renaming.trim();
        setRenaming(null);
        if (save && name !== card.title) onEditData(card.id, card.data, name);
    };
    let body: ReactNode = null;
    if (folded) body = null;
    else if (card.kind === "image") body = <ImageBody cardId={card.id} data={card.data} title={card.title} />;
    else if (card.kind === "video") body = <VideoBody data={card.data} title={card.title} selected={active} />;
    else if (card.kind === "pdf")
        body = (
            <PdfBody
                cardId={card.id}
                data={card.data}
                width={card.width}
                zoom={zoom}
                onError={onError}
                onPage={(page) => onEditData(card.id, JSON.stringify({ ...parseData(card.data), page }))}
            />
        );
    else if (mindmap)
        body = (
            <MindMap
                cardId={card.id}
                data={card.data}
                title={card.title}
                rect={card}
                active={active}
                onChange={(m) => onEditData(card.id, JSON.stringify(m), m.root.text.trim(), mindMapOutline(m))}
                onFit={onFit}
            />
        );
    else if (table)
        body = (
            <TableObject
                data={card.data}
                rect={card}
                zoom={zoom}
                active={active}
                onChange={(t) => onEditData(card.id, JSON.stringify(t), undefined, tableText(t))}
                onFit={onFit}
                onInsertChart={onInsertChart}
            />
        );
    else if (card.kind === "chart")
        body = (
            <ChartObject
                card={card}
                active={active}
                findCard={findCard}
                onChange={(data, content) => onEditData(card.id, data, undefined, content)}
            />
        );
    return (
        <div
            className={`wb-card wb-obj kind-${card.kind}${selected ? " selected" : ""}${selected && multi ? " multi" : ""}${opened ? " opened" : ""}${linkTarget ? " link-target" : ""}${folded ? " collapsed" : ""}`}
            ref={rootRef}
            data-card-id={card.id}
            style={{ left: card.x, top: card.y, width: card.width, height: folded ? undefined : card.height }}
            onDoubleClick={selfSized && !folded ? undefined : () => onOpen(card.id)}
        >
            <div className="wb-card-grip wb-obj-grip" data-role="grip" title={`${info.label}：拖曳以移動；雙擊在側邊面板開啟`}>
                <CardBarStart card={card} actions={actions} onOpen={onOpen} />
                <Icon name={info.icon} className="wb-obj-kind" />
                {renaming !== null ? (
                    <input
                        className="wb-obj-title-input"
                        autoFocus
                        value={renaming}
                        placeholder={info.label}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => setRenaming(e.target.value)}
                        onBlur={() => finishRename(true)}
                        onPointerDown={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.nativeEvent.isComposing) return;
                            if (e.key === "Enter") finishRename(true);
                            if (e.key === "Escape") finishRename(false);
                        }}
                    />
                ) : (
                    <span
                        className={`wb-obj-title${renamable ? " renamable" : ""}`}
                        title={renamable ? "雙擊以重新命名" : undefined}
                        onDoubleClick={
                            renamable
                                ? (e) => {
                                      e.stopPropagation();
                                      setRenaming(card.title);
                                  }
                                : undefined
                        }
                    >
                        {card.kind === "image" ? (folded ? card.title || info.label : "") : card.title || (renamable ? info.label : "")}
                    </span>
                )}
                {actions && <CardMenu entries={actions.menu} />}
            </div>
            {body}
            <div className="wb-card-connect" data-role="connect" title="拖到另一張卡片以建立連結" />
            {!selfSized && !folded && <div className="wb-card-resize" data-role="resize" title="拖曳以調整大小" />}
        </div>
    );
}

// ---------- a card as drawn on the board, for showing elsewhere (card library) ----------

const noop = () => {};

/**
 * Draws a card exactly as it looks on a board at 100% (same components and styles), with every
 * editing tool switched off. The caller positions it (it is drawn at 0, 0).
 */
export function CardFace({ card }: { card: BoardCard }) {
    const c = { ...card, x: 0, y: 0 };
    if (c.kind && c.kind !== "note" && c.kind !== "sticky") {
        return (
            <ObjectView
                card={c}
                selected={false}
                multi={false}
                opened={false}
                linkTarget={false}
                zoom={1}
                actions={null}
                onOpen={noop}
                onEditData={noop}
                onFit={noop}
                onError={noop}
            />
        );
    }
    return (
        <CardView
            card={c}
            selected={false}
            multi={false}
            opened={false}
            linkTarget={false}
            onEdit={noop}
            onSave={noop}
            actions={null}
            onOpen={noop}
            onOpenItem={noop}
            onEditData={noop}
            overview={false}
            zoom={1}
        />
    );
}

export default BoardCanvas;
