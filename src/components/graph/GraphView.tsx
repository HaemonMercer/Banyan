import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "../../drawer/api";
import { itemType } from "../../drawer/itemTypes";
import { pointsTo, whiteboardApi, type Graph, type Whiteboard } from "../../whiteboard/api";
import { Icon } from "../../icons/Icon";

interface Props {
    /** All boards (for showing which boards a card is on). */
    boards: Whiteboard[];
    /** Cards on these boards; null = every card. */
    boardIds: number[] | null;
    /** Only cards with this tag; null = any. */
    tag?: string | null;
    /** What is shown, e.g. "全部卡片" or "📁 研究/論文". */
    title: string;
    /** Bumped when cards or links changed elsewhere. */
    reloadKey: number;
    onOpenCard: (cardId: number, boardId: number | null) => void;
    onOpenItem: (itemId: number) => void;
    onError: (text: string) => void;
}

/** Node keys: "c12" for card 12, "i5" for Drawer item 5. */
type Key = string;
interface Body {
    key: Key;
    x: number;
    y: number;
    vx: number;
    vy: number;
    /** Held in place while being dragged. */
    fixed: boolean;
}
interface Edge {
    key: string;
    a: Key;
    b: Key;
    /** Arrow at a / at b. */
    toA: boolean;
    toB: boolean;
    note: string;
    kind: "link" | "ref";
}

const CARD_R = 8;
const ITEM_R = 7;
const untitled = (t: string) => t || "（無標題）";
const clampZoom = (z: number) => Math.min(3, Math.max(0.15, z));

/** Stable start position from the key, so the layout looks the same each time. */
function seed(key: string, i: number, n: number) {
    let h = 0;
    for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) | 0;
    const angle = (i / Math.max(1, n)) * Math.PI * 2 + (h % 100) / 100;
    const r = 60 + Math.sqrt(n) * 40 + (Math.abs(h) % 40);
    return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
}

/**
 * Relationship graph of cards (and optionally the Drawer items they cite): a force-directed
 * layout with arrows for link direction and notes on the edges. Used by the Graph module.
 */
function GraphView({ boards, boardIds, tag = null, title, reloadKey, onOpenCard, onOpenItem, onError }: Props) {
    const [graph, setGraph] = useState<Graph | null>(null);
    const [showItems, setShowItems] = useState(true);
    const [selected, setSelected] = useState<Key | null>(null);
    const [, setTick] = useState(0);
    const bodies = useRef(new Map<Key, Body>());
    const alpha = useRef(1);
    const raf = useRef<number | null>(null);
    const svgRef = useRef<SVGSVGElement>(null);
    const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
    const viewRef = useRef(view);
    viewRef.current = view;
    const gesture = useRef<
        | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
        | { kind: "node"; key: Key; sx: number; sy: number; moved: boolean }
        | null
    >(null);


    useEffect(() => {
        let stale = false;
        whiteboardApi.getGraph(boardIds, tag).then(
            (g) => !stale && setGraph(g),
            (e) => onError(errorMessage(e)),
        );
        return () => {
            stale = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [JSON.stringify(boardIds), tag, reloadKey, onError]);

    // Nodes and edges for the current data and options.
    const { nodes, edges } = useMemo(() => {
        const nodes: { key: Key; kind: "card" | "item"; id: number; label: string; icon?: string; boardIds?: number[] }[] = [];
        const edges: Edge[] = [];
        if (!graph) return { nodes, edges };
        for (const c of graph.cards) nodes.push({ key: `c${c.id}`, kind: "card", id: c.id, label: untitled(c.title), boardIds: c.boardIds });
        for (const l of graph.links) {
            edges.push({
                key: `l${l.id}`,
                a: `c${l.cardA}`,
                b: `c${l.cardB}`,
                toA: pointsTo(l, l.cardA),
                toB: pointsTo(l, l.cardB),
                note: l.note,
                kind: "link",
            });
        }
        if (showItems) {
            for (const it of graph.items) {
                nodes.push({ key: `i${it.itemId}`, kind: "item", id: it.itemId, label: untitled(it.title), icon: itemType(it.itemType).icon });
            }
            for (const r of graph.refs) {
                edges.push({ key: `r${r.cardId}-${r.itemId}`, a: `c${r.cardId}`, b: `i${r.itemId}`, toA: false, toB: false, note: "", kind: "ref" });
            }
        }
        return { nodes, edges };
    }, [graph, showItems]);
    // The animation loop outlives renders; it reads the current edges from here.
    const edgesRef = useRef(edges);
    edgesRef.current = edges;

    // Keep bodies for nodes that stay; place new ones; then (re)start the simulation.
    useEffect(() => {
        const old = bodies.current;
        const next = new Map<Key, Body>();
        nodes.forEach((n, i) => {
            const b = old.get(n.key);
            if (b) next.set(n.key, b);
            else {
                // Next to a neighbour already placed, else on a seeded ring.
                const nb = edges.find((e) => (e.a === n.key && old.has(e.b)) || (e.b === n.key && old.has(e.a)));
                const anchor = nb ? old.get(nb.a === n.key ? nb.b : nb.a)! : null;
                const p = anchor ? { x: anchor.x + (Math.random() - 0.5) * 40, y: anchor.y + (Math.random() - 0.5) * 40 } : seed(n.key, i, nodes.length);
                next.set(n.key, { key: n.key, ...p, vx: 0, vy: 0, fixed: false });
            }
        });
        const firstLayout = old.size === 0;
        bodies.current = next;
        alpha.current = 1;
        // Settle most of the layout right away (bounded work for big graphs), then animate the rest.
        const n = next.size;
        const warmup = Math.min(250, Math.floor(4e6 / (n * n + 1)));
        for (let i = 0; i < warmup; i++) step();
        if (warmup > 0) setTick((t) => t + 1);
        run();
        if (firstLayout) {
            // Fit once the warmed-up layout is on screen.
            const t = setTimeout(fit, 30);
            return () => clearTimeout(t);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [nodes, edges]);

    useEffect(() => () => {
        if (raf.current !== null) cancelAnimationFrame(raf.current);
        raf.current = null;
    }, []);

    const step = () => {
        const list = [...bodies.current.values()];
        const a = alpha.current;
        // Repulsion between every pair.
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                const p = list[i];
                const q = list[j];
                let dx = q.x - p.x;
                let dy = q.y - p.y;
                let d2 = dx * dx + dy * dy;
                if (d2 < 0.01) {
                    dx = Math.random() - 0.5;
                    dy = Math.random() - 0.5;
                    d2 = 0.25;
                }
                const d = Math.sqrt(d2);
                const f = Math.min(30, 5000 / d2) * a;
                const fx = (dx / d) * f;
                const fy = (dy / d) * f;
                p.vx -= fx;
                p.vy -= fy;
                q.vx += fx;
                q.vy += fy;
            }
        }
        // Springs along edges.
        for (const e of edgesRef.current) {
            const p = bodies.current.get(e.a);
            const q = bodies.current.get(e.b);
            if (!p || !q) continue;
            const dx = q.x - p.x;
            const dy = q.y - p.y;
            const d = Math.max(1, Math.hypot(dx, dy));
            const rest = e.kind === "ref" ? 70 : 130;
            const f = (d - rest) * 0.06 * a;
            p.vx += (dx / d) * f;
            p.vy += (dy / d) * f;
            q.vx -= (dx / d) * f;
            q.vy -= (dy / d) * f;
        }
        for (const b of list) {
            // Gentle pull to the middle keeps separate groups on screen.
            b.vx -= b.x * 0.008 * a;
            b.vy -= b.y * 0.008 * a;
            if (b.fixed) {
                b.vx = b.vy = 0;
                continue;
            }
            b.vx *= 0.55;
            b.vy *= 0.55;
            b.x += b.vx;
            b.y += b.vy;
        }
        alpha.current *= 0.985;
    };

    const run = () => {
        if (raf.current !== null) return;
        const frame = () => {
            step();
            step();
            setTick((t) => t + 1);
            if (alpha.current > 0.02 || gesture.current?.kind === "node") {
                raf.current = requestAnimationFrame(frame);
            } else {
                raf.current = null;
            }
        };
        raf.current = requestAnimationFrame(frame);
    };

    const fit = useCallback(() => {
        const svg = svgRef.current;
        const list = [...bodies.current.values()];
        if (!svg || list.length === 0) {
            if (svg) {
                const r = svg.getBoundingClientRect();
                setView({ x: r.width / 2, y: r.height / 2, zoom: 1 });
            }
            return;
        }
        const r = svg.getBoundingClientRect();
        const minX = Math.min(...list.map((b) => b.x)) - 80;
        const maxX = Math.max(...list.map((b) => b.x)) + 80;
        const minY = Math.min(...list.map((b) => b.y)) - 40;
        const maxY = Math.max(...list.map((b) => b.y)) + 40;
        const zoom = clampZoom(Math.min(1.4, r.width / (maxX - minX), r.height / (maxY - minY)));
        setView({ zoom, x: r.width / 2 - ((minX + maxX) / 2) * zoom, y: r.height / 2 - ((minY + maxY) / 2) * zoom });
    }, []);

    // Wheel zooms around the cursor (non-passive so the page doesn't scroll).
    useEffect(() => {
        const svg = svgRef.current!;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const r = svg.getBoundingClientRect();
            const v = viewRef.current;
            const px = e.clientX - r.left;
            const py = e.clientY - r.top;
            const zoom = clampZoom(v.zoom * Math.exp(-e.deltaY * 0.0015));
            const k = zoom / v.zoom;
            setView({ zoom, x: px - (px - v.x) * k, y: py - (py - v.y) * k });
        };
        svg.addEventListener("wheel", onWheel, { passive: false });
        return () => svg.removeEventListener("wheel", onWheel);
    }, []);

    const toWorld = (cx: number, cy: number) => {
        const r = svgRef.current!.getBoundingClientRect();
        const v = viewRef.current;
        return { x: (cx - r.left - v.x) / v.zoom, y: (cy - r.top - v.y) / v.zoom };
    };

    const onPointerDown = (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        const key = (e.target as Element).closest<SVGGElement>("[data-node]")?.dataset.node;
        svgRef.current!.setPointerCapture(e.pointerId);
        if (key) {
            gesture.current = { kind: "node", key, sx: e.clientX, sy: e.clientY, moved: false };
        } else {
            gesture.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
            setSelected(null);
        }
    };
    const onPointerMove = (e: React.PointerEvent) => {
        const g = gesture.current;
        if (!g) return;
        if (g.kind === "pan") {
            setView({ ...viewRef.current, x: g.vx + e.clientX - g.sx, y: g.vy + e.clientY - g.sy });
            return;
        }
        if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 4) return;
        g.moved = true;
        const b = bodies.current.get(g.key);
        if (!b) return;
        const p = toWorld(e.clientX, e.clientY);
        b.x = p.x;
        b.y = p.y;
        b.fixed = true;
        alpha.current = Math.max(alpha.current, 0.3);
        run();
    };
    const onPointerUp = () => {
        const g = gesture.current;
        gesture.current = null;
        if (g?.kind === "node") {
            const b = bodies.current.get(g.key);
            if (b) b.fixed = false;
            if (!g.moved) setSelected((s) => (s === g.key ? null : g.key));
        }
    };

    const nodeByKey = new Map(nodes.map((n) => [n.key, n]));
    const open = (key: Key) => {
        const n = nodeByKey.get(key);
        if (!n) return;
        if (n.kind === "item") onOpenItem(n.id);
        else onOpenCard(n.id, n.boardIds?.[0] ?? null);
    };

    // Neighbours of the selected node stay bright; everything else fades.
    const near = useMemo(() => {
        if (!selected) return null;
        const s = new Set([selected]);
        for (const e of edges) {
            if (e.a === selected) s.add(e.b);
            if (e.b === selected) s.add(e.a);
        }
        return s;
    }, [selected, edges]);

    const radius = (k: Key) => (k.startsWith("i") ? ITEM_R : CARD_R);
    const sel = selected ? nodeByKey.get(selected) : undefined;
    const boardName = (id: number) => boards.find((b) => b.id === id)?.name ?? "";

    return (
        <div className="wb-graph">
            <div className="wb-graph-bar">
                <span className="wb-graph-title" title={title}>{title}</span>
                <label className="wb-graph-check">
                    <input type="checkbox" checked={showItems} onChange={(e) => setShowItems(e.target.checked)} /> 顯示文獻
                </label>
                <span className="muted wb-graph-count">
                    {graph ? `${graph.cards.length} 張卡片 · ${graph.links.length} 條連結` : "載入中…"}
                </span>
                <span className="muted wb-tips">拖曳節點調整位置 · 點一下顯示相鄰 · 雙擊開啟 · 滾輪縮放</span>
                <button
                    className="small-btn"
                    title="重新排列"
                    onClick={() => {
                        alpha.current = 1;
                        run();
                    }}
                >
                    <Icon name="refresh" />
                </button>
                <button className="small-btn" title="顯示全部" onClick={fit}><Icon name="fit" /></button>
            </div>
            <svg
                ref={svgRef}
                className={`wb-graph-svg${gesture.current?.kind === "pan" ? " panning" : ""}`}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onDoubleClick={(e) => {
                    const key = (e.target as Element).closest<SVGGElement>("[data-node]")?.dataset.node;
                    if (key) open(key);
                }}
            >
                <defs>
                    <marker id="wb-g-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" markerUnits="strokeWidth" orient="auto-start-reverse">
                        <path d="M0,0 L10,5 L0,10 z" className="wb-g-arrow" />
                    </marker>
                </defs>
                <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
                    {edges.map((e) => {
                        const p = bodies.current.get(e.a);
                        const q = bodies.current.get(e.b);
                        if (!p || !q) return null;
                        const dx = q.x - p.x;
                        const dy = q.y - p.y;
                        const d = Math.max(1, Math.hypot(dx, dy));
                        // Stop at the node's edge so arrowheads stay visible.
                        const ra = radius(e.a) + (e.toA ? 2 : 0);
                        const rb = radius(e.b) + (e.toB ? 2 : 0);
                        const x1 = p.x + (dx / d) * ra;
                        const y1 = p.y + (dy / d) * ra;
                        const x2 = q.x - (dx / d) * rb;
                        const y2 = q.y - (dy / d) * rb;
                        const faded = near && !(near.has(e.a) && near.has(e.b) && (e.a === selected || e.b === selected));
                        return (
                            <g key={e.key} className={`wb-g-edge ${e.kind}${faded ? " faded" : ""}`}>
                                <line
                                    x1={x1}
                                    y1={y1}
                                    x2={x2}
                                    y2={y2}
                                    markerEnd={e.toB ? "url(#wb-g-arrow)" : undefined}
                                    markerStart={e.toA ? "url(#wb-g-arrow)" : undefined}
                                />
                                {e.note && (
                                    <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} className="wb-g-note">
                                        {e.note}
                                    </text>
                                )}
                            </g>
                        );
                    })}
                    {nodes.map((n) => {
                        const b = bodies.current.get(n.key);
                        if (!b) return null;
                        const faded = near && !near.has(n.key);
                        const isSel = n.key === selected;
                        return (
                            <g
                                key={n.key}
                                data-node={n.key}
                                className={`wb-g-node ${n.kind}${faded ? " faded" : ""}${isSel ? " selected" : ""}`}
                                transform={`translate(${b.x} ${b.y})`}
                            >
                                <title>{n.kind === "card" ? `${n.label}（雙擊開啟）` : `${n.label}（雙擊在 Drawer 中開啟）`}</title>
                                {n.kind === "card" ? (
                                    <circle r={CARD_R} />
                                ) : (
                                    <rect x={-ITEM_R} y={-ITEM_R} width={ITEM_R * 2} height={ITEM_R * 2} rx={3} />
                                )}
                                <text y={radius(n.key) + 13} className="wb-g-label">
                                    {n.kind === "item" ? `${n.icon} ` : ""}
                                    {n.label.length > 18 ? n.label.slice(0, 17) + "…" : n.label}
                                </text>
                            </g>
                        );
                    })}
                </g>
            </svg>
            {graph && graph.cards.length === 0 && <div className="wb-empty muted">這個範圍裡還沒有卡片</div>}
            {sel && (
                <div className="wb-graph-info">
                    <div className="wb-graph-info-title">
                        {sel.kind === "item" ? `${sel.icon} ` : "🗒 "}
                        {sel.label}
                    </div>
                    <div className="muted wb-graph-info-sub">
                        {sel.kind === "item"
                            ? "Drawer 條目"
                            : sel.boardIds && sel.boardIds.length > 0
                              ? sel.boardIds.map(boardName).join("、")
                              : "不在任何白板上"}
                        {" · "}
                        {(near?.size ?? 1) - 1} 個相鄰
                    </div>
                    <button className="primary-btn" onClick={() => open(sel.key)}>
                        {sel.kind === "item" ? "在 Drawer 中開啟" : "在白板中開啟"}
                    </button>
                </div>
            )}
        </div>
    );
}

export default GraphView;
