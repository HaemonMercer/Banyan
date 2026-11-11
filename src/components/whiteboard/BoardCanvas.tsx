import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { Icon, TypeIcon } from "../../icons/Icon";
import { summarizeMarkdown } from "../../markdown";
import Markdown from "../../markdown/Markdown";
import CardEditor from "../../markdown/CardEditor";
import {
    MIN_CARD_HEIGHT,
    MIN_CARD_WIDTH,
    SECTION_COLORS,
    pointsTo,
    type BoardCard,
    type CardLink,
    type Section,
} from "../../whiteboard/api";

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
    onDeleteCard: (id: number) => void;
    /** Open the card in the side panel. */
    onOpenCard: (id: number) => void;
    onLink: (a: number, b: number) => void;
    onUnlink: (link: CardLink) => void;
    /** Double-click on a line: edit its direction and note. */
    onEditLink?: (id: number) => void;
    onOpenItem: (itemId: number) => void;
    /** Clicked a `[[wiki link]]` in a card. */
    onWikiLink: (target: string) => void;
    /** Live update while a section is moved or resized. */
    onSectionChange: (s: Section) => void;
    /** Section move/resize finished: its final rectangle and the cards it carried. */
    onSectionCommit: (section: Section, movedCards: Map<number, Rect>) => void;
    onSectionEdit: (s: Section) => void;
    onDeleteSection: (id: number) => void;
    /** Card highlighted as the target of a drag from the side list. */
    dropTargetId?: number | null;
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

const center = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const rectOf = (c: Rect): Rect => ({ x: c.x, y: c.y, width: c.width, height: c.height });
const intersects = (a: Rect, b: Rect) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (inner: Rect, outer: Rect) =>
    inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

/** Cards that sit entirely inside the section (they move with it). */
export function cardsInSection(cards: BoardCard[], s: Rect): number[] {
    return cards.filter((c) => inside(c, s)).map((c) => c.id);
}

type Gesture =
    | { kind: "pan"; startX: number; startY: number; vx: number; vy: number }
    | { kind: "box"; sx: number; sy: number; base: number[] }
    | { kind: "move"; ids: number[]; startX: number; startY: number; rects: Map<number, Rect>; moved: boolean; last?: Map<number, Rect> }
    | { kind: "resize"; id: number; startX: number; startY: number; rect: Rect; last?: Rect }
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
    /** Space held: dragging pans instead of selecting. */
    const [spaceDown, setSpaceDown] = useState(false);
    const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

    const propsRef = useRef(props);
    propsRef.current = props;

    const toBoard = useCallback((clientX: number, clientY: number) => {
        const r = rootRef.current!.getBoundingClientRect();
        const v = viewRef.current;
        return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom };
    }, []);

    const fit = useCallback(() => {
        const el = rootRef.current;
        const list: Rect[] = [...propsRef.current.cards, ...propsRef.current.sections];
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
    }, []);

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
                const c = propsRef.current.cards.find((c) => c.id === id);
                const el = rootRef.current;
                if (!c || !el) return;
                const { width, height } = el.getBoundingClientRect();
                const z = viewRef.current.zoom;
                setView({ zoom: z, x: width / 2 - (c.x + c.width / 2) * z, y: height / 2 - (c.y + c.height / 2) * z });
            },
        }),
        [fit, toBoard],
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
            if (e.key === " " && !typing()) {
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
                    p.cards.filter((c) => inside(c, section)).map((c) => [c.id, rectOf(c)] as const),
                );
                gesture.current = { kind: "section", section, startX: e.clientX, startY: e.clientY, cards: inner, moved: false };
            } else {
                gesture.current = { kind: "section-resize", section, startX: e.clientX, startY: e.clientY };
            }
            capture(e);
            return;
        }

        // Empty space (or a section's body): selection box.
        if (!cardEl && role !== "link") {
            p.onSelectLink(null);
            p.onSelectSection(null);
            const base = e.shiftKey ? [...p.selectedIds] : [];
            if (!e.shiftKey) p.onSelect([]);
            const pt = toBoard(e.clientX, e.clientY);
            gesture.current = { kind: "box", sx: pt.x, sy: pt.y, base };
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
        if (e.shiftKey && role !== "connect" && role !== "resize") {
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
            gesture.current = { kind: "move", ids, startX: e.clientX, startY: e.clientY, rects, moved: false };
        } else if (role === "resize") {
            gesture.current = { kind: "resize", id, startX: e.clientX, startY: e.clientY, rect: rectOf(card) };
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
        const z = viewRef.current.zoom;
        const p = propsRef.current;
        if (g.kind === "pan") {
            setView({ ...viewRef.current, x: g.vx + e.clientX - g.startX, y: g.vy + e.clientY - g.startY });
        } else if (g.kind === "box") {
            const pt = toBoard(e.clientX, e.clientY);
            const r = { x: Math.min(g.sx, pt.x), y: Math.min(g.sy, pt.y), width: Math.abs(pt.x - g.sx), height: Math.abs(pt.y - g.sy) };
            setBox(r);
            const hits = p.cards.filter((c) => intersects(c, r)).map((c) => c.id);
            p.onSelect([...new Set([...g.base, ...hits])]);
        } else if (g.kind === "move") {
            const dx = (e.clientX - g.startX) / z;
            const dy = (e.clientY - g.startY) / z;
            if (Math.abs(dx) + Math.abs(dy) > 0) g.moved = true;
            const next = new Map<number, Rect>();
            g.rects.forEach((r, id) => next.set(id, { ...r, x: r.x + dx, y: r.y + dy }));
            g.last = next;
            p.onMoveCards(next);
        } else if (g.kind === "resize") {
            g.last = {
                ...g.rect,
                width: Math.max(MIN_CARD_WIDTH, g.rect.width + (e.clientX - g.startX) / z),
                height: Math.max(MIN_CARD_HEIGHT, g.rect.height + (e.clientY - g.startY) / z),
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
        setPanning(false);
        setBox(null);
        if (!g) return;
        const p = propsRef.current;
        if (g.kind === "move") {
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
    const linkingFrom = gesture.current?.kind === "link" ? byId.get(gesture.current.from) : undefined;
    const selectedLink = links.find((l) => l.id === selectedLinkId);

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
                        const a = byId.get(l.cardA);
                        const b = byId.get(l.cardB);
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
                        const target = linkEnd.target !== null ? byId.get(linkEnd.target) : undefined;
                        const { p, q } = target
                            ? segment(linkingFrom, target)
                            : { p: edgePoint(linkingFrom, linkEnd.x, linkEnd.y), q: linkEnd };
                        return <line className="wb-link-draft" x1={p.x} y1={p.y} x2={q.x} y2={q.y} />;
                    })()}
                </svg>

                {cards.map((c) => (
                    <CardView
                        key={c.id}
                        card={c}
                        selected={selected.has(c.id)}
                        multi={selectedIds.length > 1}
                        opened={c.id === props.openCardId}
                        linkTarget={linkEnd?.target === c.id || props.dropTargetId === c.id}
                        onEdit={props.onEditCard}
                        onSave={props.onSaveCard}
                        onDelete={props.onDeleteCard}
                        onOpen={props.onOpenCard}
                        onOpenItem={props.onOpenItem}
                        onWikiLink={props.onWikiLink}
                        overview={view.zoom < OVERVIEW_ZOOM}
                        zoom={view.zoom}
                    />
                ))}

                {links.map((l) => {
                    const a = byId.get(l.cardA);
                    const b = byId.get(l.cardB);
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

                {selectedLink && byId.get(selectedLink.cardA) && byId.get(selectedLink.cardB) && (() => {
                    const { p, q } = segment(byId.get(selectedLink.cardA)!, byId.get(selectedLink.cardB)!);
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

            {cards.length === 0 && sections.length === 0 && (
                <div className="wb-empty muted">在空白處雙擊以新增卡片</div>
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
    onEdit,
    onDelete,
}: {
    section: Section;
    selected: boolean;
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
            className={`wb-section color-${section.color || "default"}${selected ? " selected" : ""}`}
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
    onDelete: (id: number) => void;
    onOpen: (id: number) => void;
    onOpenItem: (itemId: number) => void;
    onWikiLink: (target: string) => void;
    /** Zoomed far out: show the title large and a short plain-text summary. */
    overview: boolean;
    zoom: number;
}

/** Below this zoom, cards switch to the overview (title + summary in a readable size). */
const OVERVIEW_ZOOM = 0.55;

function CardView({ card, selected, multi, opened, linkTarget, onEdit, onSave, onDelete, onOpen, onOpenItem, onWikiLink, overview, zoom }: CardViewProps) {
    // Content shows as rendered Markdown; clicking it swaps in the WYSIWYG editor at that spot.
    // `point` is where the caret goes (null = end of the text).
    const [editing, setEditing] = useState<{ point: { x: number; y: number } | null } | null>(null);
    // The preview shows what fits; when more is hidden, it fades out and shows "⋯".
    const previewRef = useRef<HTMLDivElement>(null);
    const [clipped, setClipped] = useState(false);
    useEffect(() => {
        const el = previewRef.current;
        if (!el || editing || overview) {
            setClipped(false);
            return;
        }
        const check = () => setClipped(el.scrollHeight > el.clientHeight + 2);
        check();
        const ro = new ResizeObserver(check);
        ro.observe(el);
        if (el.firstElementChild) ro.observe(el.firstElementChild);
        return () => ro.disconnect();
    }, [editing, overview, card.content, card.height, card.width]);
    const summary = useMemo(() => (overview ? summarizeMarkdown(card.content, 90) : ""), [overview, card.content]);
    // Overview text grows as the board shrinks, so it stays readable on screen.
    const overviewScale = Math.min(2.6, 0.75 / zoom);

    return (
        <div
            className={`wb-card${selected ? " selected" : ""}${selected && multi ? " multi" : ""}${opened ? " opened" : ""}${linkTarget ? " link-target" : ""}${overview && !editing ? " overview" : ""}`}
            data-card-id={card.id}
            style={{ left: card.x, top: card.y, width: card.width, height: card.height }}
        >
            <div className="wb-card-grip" data-role="grip" title="拖曳以移動（已選取多張時一起移動）">
                <Icon name="grip" className="wb-grip-dots" />
                <button
                    className="wb-card-open"
                    title="在側邊面板開啟（Enter）"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onOpen(card.id)}
                >
                    <Icon name="openExternal" />
                </button>
                <button
                    className="wb-card-delete"
                    title="刪除卡片"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onDelete(card.id)}
                >
                    <Icon name="close" />
                </button>
            </div>
            <input
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
            />
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
                    if (!editing && e.target === e.currentTarget) setEditing({ point: null });
                }}
                onClick={(e) => {
                    if (editing || e.shiftKey || (e.target as HTMLElement).closest("a, input")) return;
                    setEditing({ point: { x: e.clientX, y: e.clientY } });
                }}
            >
                {editing ? (
                    <CardEditor
                        value={card.content}
                        excludeCardId={card.id}
                        initialPoint={editing.point}
                        placeholder="內容（支援 Markdown）"
                        onChange={(v) => onEdit(card.id, card.title, v)}
                        onBlur={() => {
                            setEditing(null);
                            onSave(card.id);
                        }}
                        onWikiLink={onWikiLink}
                    />
                ) : overview ? (
                    summary ? (
                        <div className="wb-card-summary" style={{ fontSize: 12 * overviewScale }}>
                            {summary}
                        </div>
                    ) : null
                ) : card.content.trim() ? (
                    <Markdown source={card.content} onWikiLink={onWikiLink} />
                ) : (
                    <div className="wb-card-placeholder">內容（支援 Markdown）</div>
                )}
            </div>
            {clipped && !editing && (
                <div className="wb-card-more" title="還有更多內容：點一下內容編輯，或按 ↗ 在側邊面板查看全部">⋯</div>
            )}
            {card.items.length > 0 && !(overview && !editing) && (
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
                </div>
            )}
            <div className="wb-card-connect" data-role="connect" title="拖到另一張卡片以建立連結" />
            <div className="wb-card-resize" data-role="resize" title="拖曳以調整大小" />
        </div>
    );
}

export default BoardCanvas;
