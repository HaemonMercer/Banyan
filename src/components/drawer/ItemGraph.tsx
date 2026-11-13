import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "../../drawer/api";
import { itemType } from "../../drawer/itemTypes";
import { graphApi, type GraphEdge, type GraphNode, type ItemGraph as Graph } from "../../drawer/graph";
import { Icon } from "../../icons/Icon";
import { ICONS, TYPE_ICONS, type IconName } from "../../icons/icons";
import { usePersistentSet } from "../../drawer/usePersistentSet";
import "./ItemGraph.css";

interface Props {
    itemId: number;
    /** Bumped when items, cards or links may have changed. */
    reloadKey: number;
    /** Selects an item in Drawer (which also makes it the center). */
    onOpenItem: (id: number) => void;
    /** Opens a card in Whiteboard (boardId 0: in the side panel, for cards on no board). */
    onOpenCard: (cardId: number, boardId: number) => void;
    onClose: () => void;
    onError: (message: string) => void;
}

interface Body {
    x: number;
    y: number;
    vx: number;
    vy: number;
    /** Held in place (the center, or a node being dragged). */
    fixed: boolean;
}

const RING = 150;
const R = { center: 16, item: 12, card: 10, board: 9 };
const clampZoom = (z: number) => Math.min(3, Math.max(0.2, z));
const untitled = (t: string) => t || "（無標題）";
const short = (t: string, n = 16) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

const CARD_ICONS: Record<string, IconName> = {
    note: "note",
    sticky: "sticky",
    image: "image",
    video: "video",
    pdf: "pdf",
    mindmap: "mindmap",
    table: "table",
    chart: "chart",
};

/** An icon from the Banyan set drawn inside the graph's SVG, centered on (0, 0). */
function GIcon({ markup, size }: { markup: string; size: number }) {
    return (
        <svg
            x={-size / 2}
            y={-size / 2}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.9}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="ig-icon"
            dangerouslySetInnerHTML={{ __html: markup }}
        />
    );
}

const radius = (n: GraphNode, center: string) => (n.key === center ? R.center : R[n.kind]);

/** Start position: on the node's ring, spread by order; stable for the same graph. */
function seed(i: number, n: number, depth: number) {
    const angle = (i / Math.max(1, n)) * Math.PI * 2 + depth * 0.7;
    return { x: Math.cos(angle) * RING * depth, y: Math.sin(angle) * RING * depth };
}

/** How a node is described in the info box. */
function describe(n: GraphNode): string {
    if (n.kind === "item") return itemType(n.subtype).label;
    if (n.kind === "board") return "白板";
    return n.boardId === null ? "卡片 · 不在任何白板上" : "卡片";
}

function edgeLabel(e: GraphEdge): string {
    if (e.kind === "cite") {
        const parts = [e.direct && "引用條目", e.annotations > 0 && `引用 ${e.annotations} 則註解`].filter(Boolean);
        return parts.join("、");
    }
    if (e.kind === "related") return "關聯";
    if (e.kind === "board") return "在白板上";
    return e.note || "卡片連結";
}

/**
 * Relation graph around one Drawer item: the cards citing it (or its annotations), its related
 * items, the links among those cards and the boards they are on; deeper levels follow the same
 * connections outward. Shown in place of Drawer's item list.
 */
function ItemGraph({ itemId, reloadKey, onOpenItem, onOpenCard, onClose, onError }: Props) {
    const [graph, setGraph] = useState<Graph | null>(null);
    const [depth, setDepth] = useState(() => {
        try {
            const d = Number(localStorage.getItem("banyan.drawer.graphDepth"));
            return d >= 1 && d <= 3 ? d : 1;
        } catch {
            return 1;
        }
    });
    const [hidden, toggleHidden] = usePersistentSet("banyan.drawer.graphHidden");
    const showBoards = !hidden.has("boards");
    const [selected, setSelected] = useState<string | null>(null);
    const [, setTick] = useState(0);
    const bodies = useRef(new Map<string, Body>());
    const alpha = useRef(1);
    const raf = useRef<number | null>(null);
    const svgRef = useRef<SVGSVGElement>(null);
    const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
    const viewRef = useRef(view);
    viewRef.current = view;
    const gesture = useRef<
        | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
        | { kind: "node"; key: string; sx: number; sy: number; moved: boolean }
        | null
    >(null);

    useEffect(() => {
        try {
            localStorage.setItem("banyan.drawer.graphDepth", String(depth));
        } catch {
            /* storage unavailable */
        }
    }, [depth]);

    useEffect(() => {
        let stale = false;
        graphApi.itemGraph(itemId, depth).then(
            (g) => !stale && setGraph(g),
            (e) => !stale && onError(errorMessage(e)),
        );
        return () => {
            stale = true;
        };
    }, [itemId, depth, reloadKey, onError]);

    // The selection belongs to the graph it was made in.
    useEffect(() => setSelected(null), [itemId]);

    const { nodes, edges, center } = useMemo(() => {
        if (!graph || graph.center !== `i${itemId}`) return { nodes: [] as GraphNode[], edges: [] as GraphEdge[], center: "" };
        const nodes = graph.nodes.filter((n) => showBoards || n.kind !== "board");
        const keep = new Set(nodes.map((n) => n.key));
        const edges = graph.edges.filter((e) => keep.has(e.a) && keep.has(e.b));
        return { nodes, edges, center: graph.center };
    }, [graph, itemId, showBoards]);
    const edgesRef = useRef(edges);
    edgesRef.current = edges;
    const nodeByKey = useMemo(() => new Map(nodes.map((n) => [n.key, n])), [nodes]);
    const nodesRef = useRef(nodeByKey);
    nodesRef.current = nodeByKey;

    const step = useCallback(() => {
        const list = [...bodies.current.entries()];
        const a = alpha.current;
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                const p = list[i][1];
                const q = list[j][1];
                let dx = q.x - p.x;
                let dy = q.y - p.y;
                let d2 = dx * dx + dy * dy;
                if (d2 < 0.01) {
                    dx = Math.random() - 0.5;
                    dy = Math.random() - 0.5;
                    d2 = 0.25;
                }
                const d = Math.sqrt(d2);
                const f = Math.min(40, 9000 / d2) * a;
                p.vx -= (dx / d) * f;
                p.vy -= (dy / d) * f;
                q.vx += (dx / d) * f;
                q.vy += (dy / d) * f;
            }
        }
        for (const e of edgesRef.current) {
            const p = bodies.current.get(e.a);
            const q = bodies.current.get(e.b);
            if (!p || !q) continue;
            const dx = q.x - p.x;
            const dy = q.y - p.y;
            const d = Math.max(1, Math.hypot(dx, dy));
            const rest = e.kind === "board" ? 80 : 120;
            const f = (d - rest) * 0.05 * a;
            p.vx += (dx / d) * f;
            p.vy += (dy / d) * f;
            q.vx -= (dx / d) * f;
            q.vy -= (dy / d) * f;
        }
        for (const [key, b] of list) {
            // A soft pull towards the node's ring keeps levels readable.
            const depth = nodesRef.current.get(key)?.depth ?? 1;
            const d = Math.max(1, Math.hypot(b.x, b.y));
            const pull = (d - RING * depth) * 0.02 * a;
            b.vx -= (b.x / d) * pull;
            b.vy -= (b.y / d) * pull;
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
    }, []);

    const run = useCallback(() => {
        if (raf.current !== null) return;
        const frame = () => {
            step();
            step();
            setTick((t) => t + 1);
            if (alpha.current > 0.02 || gesture.current?.kind === "node") raf.current = requestAnimationFrame(frame);
            else raf.current = null;
        };
        raf.current = requestAnimationFrame(frame);
    }, [step]);

    const fit = useCallback(() => {
        const svg = svgRef.current;
        if (!svg) return;
        const r = svg.getBoundingClientRect();
        const list = [...bodies.current.values()];
        if (list.length === 0) {
            setView({ x: r.width / 2, y: r.height / 2, zoom: 1 });
            return;
        }
        const minX = Math.min(...list.map((b) => b.x)) - 80;
        const maxX = Math.max(...list.map((b) => b.x)) + 80;
        const minY = Math.min(...list.map((b) => b.y)) - 40;
        const maxY = Math.max(...list.map((b) => b.y)) + 50;
        const zoom = clampZoom(Math.min(1.3, r.width / (maxX - minX), r.height / (maxY - minY)));
        setView({ zoom, x: r.width / 2 - ((minX + maxX) / 2) * zoom, y: r.height / 2 - ((minY + maxY) / 2) * zoom });
    }, []);

    // Keep bodies of nodes that stay; place new ones on their rings; then settle and fit.
    useEffect(() => {
        const old = bodies.current;
        const next = new Map<string, Body>();
        const perDepth = new Map<number, GraphNode[]>();
        for (const n of nodes) perDepth.set(n.depth, [...(perDepth.get(n.depth) ?? []), n]);
        let added = 0;
        for (const n of nodes) {
            const b = old.get(n.key);
            if (b && n.key !== center) {
                next.set(n.key, { ...b, fixed: false });
                continue;
            }
            const ring = perDepth.get(n.depth)!;
            const p = n.key === center ? { x: 0, y: 0 } : seed(ring.indexOf(n), ring.length, n.depth);
            next.set(n.key, { ...p, vx: 0, vy: 0, fixed: n.key === center });
            added++;
        }
        bodies.current = next;
        alpha.current = 1;
        const count = next.size;
        const warmup = Math.min(300, Math.floor(4e6 / (count * count + 1)));
        for (let i = 0; i < warmup; i++) step();
        setTick((t) => t + 1);
        run();
        if (added > 0) {
            const t = setTimeout(fit, 30);
            return () => clearTimeout(t);
        }
    }, [nodes, center, step, run, fit]);

    useEffect(
        () => () => {
            if (raf.current !== null) cancelAnimationFrame(raf.current);
            raf.current = null;
        },
        [],
    );

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
    const nodeAt = (t: EventTarget) => (t as Element).closest<SVGGElement>("[data-node]")?.dataset.node;

    const onPointerDown = (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        const key = nodeAt(e.target);
        svgRef.current!.setPointerCapture(e.pointerId);
        gesture.current = key
            ? { kind: "node", key, sx: e.clientX, sy: e.clientY, moved: false }
            : { kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
        if (!key) setSelected(null);
    };
    const onPointerMove = (e: React.PointerEvent) => {
        const g = gesture.current;
        if (!g) return;
        if (g.kind === "pan") {
            setView({ ...viewRef.current, x: g.vx + e.clientX - g.sx, y: g.vy + e.clientY - g.sy });
            return;
        }
        if (g.key === center) return;
        if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 4) return;
        g.moved = true;
        const b = bodies.current.get(g.key);
        if (!b) return;
        Object.assign(b, toWorld(e.clientX, e.clientY), { fixed: true });
        alpha.current = Math.max(alpha.current, 0.3);
        run();
    };
    const onPointerUp = () => {
        const g = gesture.current;
        gesture.current = null;
        if (g?.kind !== "node") return;
        const b = bodies.current.get(g.key);
        if (b && g.key !== center) b.fixed = false;
        if (!g.moved) setSelected((s) => (s === g.key ? null : g.key));
    };

    /** A board node opens through one of its cards in the graph. */
    const boardCard = (boardKey: string) => {
        const e = edges.find((x) => x.kind === "board" && x.b === boardKey);
        return e ? nodeByKey.get(e.a) : undefined;
    };
    const open = (n: GraphNode) => {
        if (n.kind === "item") {
            if (n.key !== center) onOpenItem(n.id);
        } else if (n.kind === "card") {
            onOpenCard(n.id, n.boardId ?? 0);
        } else {
            const c = boardCard(n.key);
            if (c) onOpenCard(c.id, n.id);
        }
    };

    // The selected node's neighbours stay bright; everything else fades.
    const near = useMemo(() => {
        if (!selected) return null;
        const s = new Set([selected]);
        for (const e of edges) {
            if (e.a === selected) s.add(e.b);
            if (e.b === selected) s.add(e.a);
        }
        return s;
    }, [selected, edges]);

    const sel = selected ? nodeByKey.get(selected) : undefined;
    const centerNode = nodeByKey.get(center);
    const counts = useMemo(() => {
        const c = { item: 0, card: 0, board: 0 };
        for (const n of graph?.nodes ?? []) c[n.kind]++;
        return c;
    }, [graph]);
    const selEdges = sel ? edges.filter((e) => e.a === sel.key || e.b === sel.key) : [];

    return (
        <section className="drawer-pane drawer-list item-graph">
            <div className="pane-header">
                <button className="icon-btn" title="回到條目清單" onClick={onClose}>
                    <Icon name="arrowLeft" />
                </button>
                <span className="pane-title" title={centerNode ? untitled(centerNode.title) : ""}>
                    關聯圖{centerNode ? `：${untitled(centerNode.title)}` : ""}
                </span>
                <span className="pane-count">
                    {graph ? `${counts.item} 個條目 · ${counts.card} 張卡片 · ${counts.board} 個白板` : "載入中…"}
                </span>
            </div>
            <div className="ig-bar">
                <div className="wb-seg" role="group" aria-label="範圍">
                    {[1, 2, 3].map((d) => (
                        <button key={d} className={d === depth ? "active" : ""} title={`顯示 ${d} 層以內的關係`} onClick={() => setDepth(d)}>
                            {d} 層
                        </button>
                    ))}
                </div>
                <label className="ig-check">
                    <input type="checkbox" checked={showBoards} onChange={() => toggleHidden("boards")} /> 顯示白板
                </label>
                <span className="ig-spacer" />
                <button
                    className="icon-btn"
                    title="重新排列"
                    onClick={() => {
                        alpha.current = 1;
                        run();
                    }}
                >
                    <Icon name="refresh" />
                </button>
                <button className="icon-btn" title="顯示全部" onClick={fit}>
                    <Icon name="fit" />
                </button>
            </div>
            <div className="ig-stage">
                <svg
                    ref={svgRef}
                    className={`ig-svg${gesture.current?.kind === "pan" ? " panning" : ""}`}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    onDoubleClick={(e) => {
                        const key = nodeAt(e.target);
                        const n = key ? nodeByKey.get(key) : undefined;
                        if (n) open(n);
                    }}
                >
                    <defs>
                        <marker id="ig-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" markerUnits="strokeWidth" orient="auto-start-reverse">
                            <path d="M0,0 L10,5 L0,10 z" className="ig-arrow" />
                        </marker>
                    </defs>
                    <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
                        {[1, 2, 3].filter((d) => d <= depth).map((d) => (
                            <circle key={d} r={RING * d} className="ig-ring" />
                        ))}
                        {edges.map((e) => {
                            const p = bodies.current.get(e.a);
                            const q = bodies.current.get(e.b);
                            const na = nodeByKey.get(e.a);
                            const nb = nodeByKey.get(e.b);
                            if (!p || !q || !na || !nb) return null;
                            const dx = q.x - p.x;
                            const dy = q.y - p.y;
                            const d = Math.max(1, Math.hypot(dx, dy));
                            const toA = e.kind === "link" && (e.direction === 2 || e.direction === 3);
                            const toB = e.kind === "link" && (e.direction === 1 || e.direction === 3);
                            const ra = radius(na, center) + (toA ? 3 : 1);
                            const rb = radius(nb, center) + (toB ? 3 : 1);
                            const x1 = p.x + (dx / d) * ra;
                            const y1 = p.y + (dy / d) * ra;
                            const x2 = q.x - (dx / d) * rb;
                            const y2 = q.y - (dy / d) * rb;
                            const faded = near && !(e.a === selected || e.b === selected);
                            const cls = e.kind === "cite" && !e.direct ? "cite annotation" : e.kind;
                            return (
                                <g key={`${e.kind}:${e.a}-${e.b}`} className={`ig-edge ${cls}${faded ? " faded" : ""}`}>
                                    <title>{edgeLabel(e)}</title>
                                    <line x1={x1} y1={y1} x2={x2} y2={y2} markerEnd={toB ? "url(#ig-arrow)" : undefined} markerStart={toA ? "url(#ig-arrow)" : undefined} />
                                    {e.kind === "link" && e.note && (
                                        <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} className="ig-note">
                                            {short(e.note, 12)}
                                        </text>
                                    )}
                                    {e.kind === "cite" && e.annotations > 0 && (
                                        <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} className="ig-note">
                                            {e.annotations} 則註解
                                        </text>
                                    )}
                                </g>
                            );
                        })}
                        {nodes.map((n) => {
                            const b = bodies.current.get(n.key);
                            if (!b) return null;
                            const isCenter = n.key === center;
                            const r = radius(n, center);
                            const faded = near && !near.has(n.key);
                            const group = n.kind === "item" ? itemType(n.subtype).group : "";
                            const markup =
                                n.kind === "item"
                                    ? (TYPE_ICONS[itemType(n.subtype).id] ?? TYPE_ICONS.document)
                                    : n.kind === "board"
                                      ? ICONS.board
                                      : ICONS[CARD_ICONS[n.subtype] ?? "note"];
                            const hint = n.kind === "item" ? (isCenter ? "中心條目" : "雙擊設為中心") : n.kind === "card" ? "雙擊在白板中開啟" : "雙擊開啟白板";
                            return (
                                <g
                                    key={n.key}
                                    data-node={n.key}
                                    className={`ig-node ${n.kind}${isCenter ? " center" : ""}${group ? ` type-${group}` : ""}${faded ? " faded" : ""}${n.key === selected ? " selected" : ""}`}
                                    transform={`translate(${b.x} ${b.y})`}
                                >
                                    <title>{`${untitled(n.title)}（${describe(n)}，${hint}）`}</title>
                                    {n.kind === "card" ? (
                                        <rect x={-r * 1.25} y={-r} width={r * 2.5} height={r * 2} rx={4} className="ig-shape" />
                                    ) : n.kind === "board" ? (
                                        <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={2} className="ig-shape" />
                                    ) : (
                                        <circle r={r} className="ig-shape" />
                                    )}
                                    <GIcon markup={markup} size={r * 1.15} />
                                    <text y={r + 13} className="ig-label">
                                        {short(untitled(n.title), isCenter ? 22 : 16)}
                                    </text>
                                </g>
                            );
                        })}
                    </g>
                </svg>
                {graph && nodes.length <= 1 && (
                    <div className="ig-empty muted">
                        這個條目還沒有關聯的條目或卡片。
                        <br />
                        在右欄「筆記卡片」新增卡片、在白板上引用它，或加入「關聯」條目後就會出現在這裡。
                    </div>
                )}
                {graph?.truncated && <div className="ig-truncated muted">項目太多，只顯示最近的 150 個</div>}
                {!sel && <div className="ig-legend" aria-label="圖例">
                    <span><i className="ig-key cite" />引用</span>
                    <span><i className="ig-key annotation" />引用註解</span>
                    <span><i className="ig-key related" />關聯</span>
                    <span><i className="ig-key link" />卡片連結</span>
                </div>}
                {sel && (
                    <div className="ig-info">
                        <div className="ig-info-title" title={untitled(sel.title)}>{untitled(sel.title)}</div>
                        <div className="muted ig-info-sub">
                            {describe(sel)} · {near ? near.size - 1 : 0} 個相鄰
                        </div>
                        {selEdges.length > 0 && (
                            <ul className="ig-info-edges">
                                {selEdges.slice(0, 6).map((e) => {
                                    const other = nodeByKey.get(e.a === sel.key ? e.b : e.a);
                                    return (
                                        <li key={`${e.kind}:${e.a}-${e.b}`}>
                                            <span className="muted">{edgeLabel(e)}</span> {untitled(other?.title ?? "")}
                                        </li>
                                    );
                                })}
                                {selEdges.length > 6 && <li className="muted">⋯ 還有 {selEdges.length - 6} 個</li>}
                            </ul>
                        )}
                        {sel.kind === "item" && sel.key !== center && (
                            <button className="primary-btn" onClick={() => open(sel)}>設為中心</button>
                        )}
                        {sel.kind === "card" && (
                            <button className="primary-btn" onClick={() => open(sel)}>
                                {sel.boardId === null ? "開啟卡片" : "在白板中開啟"}
                            </button>
                        )}
                        {sel.kind === "board" && boardCard(sel.key) && (
                            <button className="primary-btn" onClick={() => open(sel)}>開啟白板</button>
                        )}
                    </div>
                )}
            </div>
        </section>
    );
}

export default ItemGraph;
