import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
    findNode,
    layoutMindMap,
    newNodeId,
    nodeFont,
    readMindMap,
    removeNode,
    updateNode,
    type LaidNode,
    type MindMapData,
    type MindNode,
} from "../../whiteboard/objects";

interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface Props {
    cardId: number;
    data: string;
    title: string;
    rect: Rect;
    /** The card is selected on the board (node tools show only then). */
    active: boolean;
    onChange: (map: MindMapData) => void;
    /** The map grew or shrank: the card's new rectangle (the central topic stays in place). */
    onFit: (rect: Rect) => void;
}

/** Space around the nodes inside the card, and the grip bar above them. */
const PAD = 16;
const GRIP = 18;

/**
 * A Miro-style mind map drawn inside a board object. The card sizes itself to the map; the
 * central topic stays where it is as branches are added on either side.
 *
 * Keys (with a topic selected): Tab child · Enter sibling · F2 / double-click edit ·
 * Delete remove · arrows move · Alt + ↑/↓ reorder · Esc deselect.
 */
function MindMap({ cardId, data, title, rect, active, onChange, onFit }: Props) {
    const map = useMemo(() => readMindMap(data, title), [data, title]);
    /** The latest tree, also right after a change (before the board passes it back). */
    const mapRef = useRef(map);
    mapRef.current = map;
    const layout = useMemo(() => layoutMindMap(map), [map]);
    const [sel, setSel] = useState<string | null>(null);
    const [editing, setEditingState] = useState<{ id: string; draft: string; isNew: boolean } | null>(null);
    /** The edit in progress, readable at once (Enter and the blur that follows must finish it only once). */
    const editingRef = useRef(editing);
    const setEditing = (e: typeof editing) => {
        editingRef.current = e;
        setEditingState(e);
    };
    const wrapRef = useRef<HTMLDivElement>(null);

    const ox = PAD - layout.minX;
    const oy = PAD + GRIP - layout.minY;
    const width = Math.ceil(layout.maxX - layout.minX + PAD * 2);
    const height = Math.ceil(layout.maxY - layout.minY + PAD * 2 + GRIP);

    // Keep the card fitted to the map, with the central topic fixed on the board.
    const prevOffset = useRef<{ ox: number; oy: number } | null>(null);
    const rectRef = useRef(rect);
    rectRef.current = rect;
    useLayoutEffect(() => {
        const r = rectRef.current;
        const prev = prevOffset.current ?? { ox, oy };
        prevOffset.current = { ox, oy };
        const next = { x: r.x + prev.ox - ox, y: r.y + prev.oy - oy, width, height };
        if (Math.abs(next.x - r.x) + Math.abs(next.y - r.y) + Math.abs(next.width - r.width) + Math.abs(next.height - r.height) > 1) {
            onFit({ x: Math.round(next.x), y: Math.round(next.y), width, height });
        }
    }, [ox, oy, width, height]); // eslint-disable-line react-hooks/exhaustive-deps

    // Leaving the card drops the topic selection.
    useEffect(() => {
        if (!active) {
            setSel(null);
            setEditing(null);
        }
    }, [active]);

    const byId = useMemo(() => new Map(layout.nodes.map((n) => [n.node.id, n])), [layout]);

    const commit = (root: MindNode) => {
        mapRef.current = { root };
        onChange({ root });
    };
    const tree = () => mapRef.current.root;

    const addChild = (parentId: string, side?: "left" | "right") => {
        const found = findNode(tree(), parentId);
        if (!found) return;
        const child: MindNode = { id: newNodeId(), text: "", children: [] };
        if (found.depth === 0) child.side = side ?? "right";
        commit(updateNode(tree(), parentId, (n) => ({ ...n, collapsed: false, children: [...n.children, child] })));
        setSel(child.id);
        setEditing({ id: child.id, draft: "", isNew: true });
    };

    const addSibling = (id: string) => {
        const found = findNode(tree(), id);
        if (!found?.parent) return addChild(id);
        const sib: MindNode = { id: newNodeId(), text: "", children: [], ...(found.depth === 1 ? { side: found.node.side ?? "right" } : {}) };
        commit(
            updateNode(tree(), found.parent.id, (p) => {
                const i = p.children.findIndex((c) => c.id === id);
                const children = [...p.children];
                children.splice(i + 1, 0, sib);
                return { ...p, children };
            }),
        );
        setSel(sib.id);
        setEditing({ id: sib.id, draft: "", isNew: true });
    };

    const remove = (id: string) => {
        const found = findNode(tree(), id);
        if (!found?.parent) return;
        const sibs = found.parent.children;
        const i = sibs.findIndex((c) => c.id === id);
        const next = sibs[i + 1] ?? sibs[i - 1] ?? found.parent;
        commit(removeNode(tree(), id));
        setSel(next.id);
    };

    const setText = (id: string, text: string) => {
        const found = findNode(tree(), id);
        if (!found || found.node.text === text) return;
        commit(updateNode(tree(), id, (n) => ({ ...n, text })));
    };

    const toggle = (id: string) => commit(updateNode(tree(), id, (n) => ({ ...n, collapsed: !n.collapsed })));

    const reorder = (id: string, delta: number) => {
        const found = findNode(tree(), id);
        if (!found?.parent) return;
        commit(
            updateNode(tree(), found.parent.id, (p) => {
                const kids = [...p.children];
                const i = kids.findIndex((c) => c.id === id);
                // At the root, move among the branches on the same side only.
                let j = i + delta;
                while (j >= 0 && j < kids.length && found.depth === 1 && (kids[j].side ?? "right") !== (found.node.side ?? "right")) j += delta;
                if (j < 0 || j >= kids.length) return p;
                [kids[i], kids[j]] = [kids[j], kids[i]];
                return { ...p, children: kids };
            }),
        );
    };

    /** Visual neighbour for arrow keys. */
    const neighbour = (id: string, key: string): string | null => {
        const n = byId.get(id);
        if (!n) return null;
        const kids = layout.nodes.filter((x) => x.parentId === id);
        const toward = (side: "left" | "right") => {
            const list = kids.filter((k) => k.side === side);
            return list[Math.floor((list.length - 1) / 2)]?.node.id ?? null;
        };
        if (key === "ArrowRight") {
            if (n.side === "left") return n.parentId;
            return n.side === "root" ? toward("right") : kids[0]?.node.id ?? null;
        }
        if (key === "ArrowLeft") {
            if (n.side === "right") return n.parentId;
            return n.side === "root" ? toward("left") : kids[0]?.node.id ?? null;
        }
        // Up / down: the nearest topic above or below on the same side and depth.
        const same = layout.nodes.filter((x) => x.side === n.side && x.depth === n.depth && x.node.id !== id);
        const dir = key === "ArrowUp" ? -1 : 1;
        const cands = same.filter((x) => (x.y - n.y) * dir > 0).sort((a, b) => Math.abs(a.y - n.y) - Math.abs(b.y - n.y));
        return cands[0]?.node.id ?? null;
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (editing || !sel) return;
        const n = byId.get(sel);
        if (!n) return;
        let handled = true;
        if (e.key === "Tab") addChild(sel);
        else if (e.key === "Enter") addSibling(sel);
        else if (e.key === "F2") setEditing({ id: sel, draft: n.node.text, isNew: false });
        else if ((e.key === "Delete" || e.key === "Backspace") && n.depth > 0) remove(sel);
        else if (e.key === "Escape") setSel(null);
        else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) reorder(sel, e.key === "ArrowUp" ? -1 : 1);
        else if (e.key.startsWith("Arrow")) {
            const next = neighbour(sel, e.key);
            if (next) setSel(next);
        } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            // Typing replaces the topic's text, like in Miro.
            setEditing({ id: sel, draft: e.key, isNew: false });
        } else handled = false;
        if (handled) {
            e.preventDefault();
            e.stopPropagation();
        }
    };

    const finishEdit = (save: boolean) => {
        const ed = editingRef.current;
        if (!ed) return;
        setEditing(null);
        // Take the focus back right away so the next keys reach the map, not the board.
        wrapRef.current?.focus({ preventScroll: true });
        const text = ed.draft.trim();
        if (save) {
            if (ed.isNew && !text) remove(ed.id);
            else setText(ed.id, text);
        } else if (ed.isNew) {
            remove(ed.id);
        }
        // Back to the map for more keys, unless a new topic's box took the focus.
        requestAnimationFrame(() => {
            if (!document.activeElement?.classList.contains("wb-mm-input")) wrapRef.current?.focus({ preventScroll: true });
        });
    };

    // Connectors: from the parent's edge to the child's edge (deep topics are underlined, so
    // their lines meet the underline).
    const anchor = (n: LaidNode, toward: "left" | "right") => ({
        x: (toward === "right" ? n.x + n.width : n.x) + ox,
        y: (n.depth >= 2 ? n.y + n.height : n.y + n.height / 2) + oy,
    });
    const paths = layout.nodes
        .filter((n) => n.parentId)
        .map((n) => {
            const p = byId.get(n.parentId!)!;
            const out = n.side === "left" ? "left" : "right";
            const a = anchor(p, out);
            const b = anchor(n, out === "right" ? "left" : "right");
            const mx = (a.x + b.x) / 2;
            return (
                <path
                    key={n.node.id}
                    d={`M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`}
                    stroke={n.color}
                    strokeWidth={n.depth === 1 ? 2.5 : 2}
                    fill="none"
                />
            );
        });

    const selNode = sel ? byId.get(sel) : undefined;

    return (
        <div
            ref={wrapRef}
            className={`wb-mindmap${active ? " active" : ""}`}
            tabIndex={-1}
            data-role="grip"
            onKeyDown={onKeyDown}
            style={{ width, height }}
            title={active ? undefined : "拖曳空白處以移動心智圖"}
        >
            <svg className="wb-mm-lines" width={width} height={height}>
                {paths}
            </svg>
            {layout.nodes.map((n) => {
                const isEditing = editing?.id === n.node.id;
                return (
                    <div
                        key={n.node.id}
                        className={`wb-mm-node depth-${Math.min(n.depth, 2)}${sel === n.node.id ? " selected" : ""}${!n.node.text && !isEditing ? " empty" : ""}`}
                        data-role="mm-node"
                        data-mm-card={cardId}
                        style={{ left: n.x + ox, top: n.y + oy, width: n.width, height: n.height, ["--branch" as string]: n.color || undefined }}
                        onPointerDown={(e) => {
                            if (e.button !== 0 || e.shiftKey) return;
                            setSel(n.node.id);
                            if (!isEditing) requestAnimationFrame(() => wrapRef.current?.focus({ preventScroll: true }));
                        }}
                        onDoubleClick={(e) => {
                            e.stopPropagation();
                            setSel(n.node.id);
                            setEditing({ id: n.node.id, draft: n.node.text, isNew: false });
                        }}
                    >
                        {isEditing ? (
                            <textarea
                                className="wb-mm-input"
                                autoFocus
                                value={editing.draft}
                                style={{ font: nodeFont(n.depth) }}
                                placeholder="主題"
                                onFocus={(e) => {
                                    const t = e.currentTarget;
                                    t.setSelectionRange(t.value.length, t.value.length);
                                }}
                                onChange={(e) => setEditing({ ...editing, draft: e.target.value })}
                                onBlur={() => finishEdit(true)}
                                onPointerDown={(e) => e.stopPropagation()}
                                onKeyDown={(e) => {
                                    e.stopPropagation();
                                    if (e.nativeEvent.isComposing) return;
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        finishEdit(true);
                                    } else if (e.key === "Tab") {
                                        e.preventDefault();
                                        const id = editing.id;
                                        const keep = editing.draft.trim() || !editing.isNew;
                                        finishEdit(true);
                                        if (keep) addChild(id);
                                    } else if (e.key === "Escape") {
                                        e.preventDefault();
                                        finishEdit(false);
                                    }
                                }}
                            />
                        ) : (
                            <span className="wb-mm-text">{n.node.text || "主題"}</span>
                        )}
                    </div>
                );
            })}
            {layout.nodes
                .filter((n) => n.node.children.length > 0 && n.depth > 0)
                .map((n) => {
                    const right = n.side !== "left";
                    const a = anchor(n, right ? "right" : "left");
                    return (
                        <button
                            key={`t${n.node.id}`}
                            className={`wb-mm-toggle${n.node.collapsed ? " collapsed" : ""}`}
                            style={{ left: a.x + (right ? 2 : -18), top: a.y - 8, ["--branch" as string]: n.color }}
                            title={n.node.collapsed ? `展開（${n.hidden} 個主題）` : "收合"}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={() => toggle(n.node.id)}
                        >
                            {n.node.collapsed ? n.hidden : "−"}
                        </button>
                    );
                })}
            {active && selNode && !editing && (
                <>
                    {(selNode.side !== "left" || selNode.depth === 0) && (
                        <button
                            className="wb-mm-add"
                            style={{ left: selNode.x + selNode.width + ox + (selNode.node.children.length && !selNode.node.collapsed && selNode.depth > 0 ? 22 : 6), top: selNode.y + selNode.height / 2 + oy - 9 }}
                            title="新增子主題（Tab）"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={() => addChild(selNode.node.id, "right")}
                        >
                            ＋
                        </button>
                    )}
                    {(selNode.side === "left" || selNode.depth === 0) && (
                        <button
                            className="wb-mm-add"
                            style={{ left: selNode.x + ox - (selNode.node.children.length && !selNode.node.collapsed && selNode.depth > 0 ? 40 : 24), top: selNode.y + selNode.height / 2 + oy - 9 }}
                            title={selNode.depth === 0 ? "在左側新增分支" : "新增子主題（Tab）"}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={() => addChild(selNode.node.id, "left")}
                        >
                            ＋
                        </button>
                    )}
                </>
            )}
        </div>
    );
}

export default MindMap;
