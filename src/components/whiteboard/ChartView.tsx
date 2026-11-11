import { useMemo, useRef, useState } from "react";
import { niceTicks, tickLabel, valueText, type ChartSnapshot, type ChartType } from "../../whiteboard/chart";

interface Props {
    type: ChartType;
    snapshot: ChartSnapshot;
    legend: boolean;
    width: number;
    height: number;
}

/** Categorical slots are used in this fixed order (never cycled): a 9th series is not drawn. */
const MAX_SERIES = 8;
const FONT = 11;
const BAR_MAX = 24;
const GAP = 2;
const RADIUS = 4;

/** Rough text width for laying out axis labels (CJK counts double). */
const textW = (s: string) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? FONT : FONT * 0.6), 0);

/** A bar with a 4px rounded data end, square at the baseline (vertical: `up` = grows upward). */
function barPath(x: number, y: number, w: number, h: number, dir: "up" | "down" | "right" | "left") {
    const r = Math.min(RADIUS, (dir === "up" || dir === "down" ? Math.min(w / 2, h) : Math.min(h / 2, w)));
    if (w <= 0 || h <= 0) return "";
    switch (dir) {
        case "up":
            return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
        case "down":
            return `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w - r}Q${x + w},${y + h} ${x + w},${y + h - r}V${y}Z`;
        case "right":
            return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
        default:
            return `M${x + w},${y}H${x + r}Q${x},${y} ${x},${y + r}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w}Z`;
    }
}

type Tip = { x: number; y: number; title: string; rows: { name: string; value: string; slot: number }[] };

/**
 * Draws a chart in SVG: column, bar, line, area or pie. Marks follow one spec — bars at most 24
 * thick with a 4px rounded end and a 2px gap, 2px lines, 8px markers with a surface ring, a 10%
 * area wash, hairline gridlines — and every chart has a hover tooltip.
 */
function ChartView({ type, snapshot, legend, width, height }: Props) {
    const [tip, setTip] = useState<Tip | null>(null);
    const [hover, setHover] = useState<number | null>(null);
    const svgRef = useRef<SVGSVGElement>(null);
    const series = snapshot.series.slice(0, MAX_SERIES);
    const labels = snapshot.labels;
    const n = labels.length;
    const pie = type === "pie";

    // Legend: categories for a pie, series otherwise (only when there are two or more).
    const legendItems = pie ? labels.map((l, i) => ({ name: l, slot: i })) : series.map((s, i) => ({ name: s.name, slot: i }));
    const showLegend = legend && legendItems.length >= 2;
    const legendH = showLegend ? 22 : 0;

    const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
    const ticks = useMemo(() => niceTicks(all.length ? Math.min(...all) : 0, all.length ? Math.max(...all) : 1), [all.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
    const maxAbs = Math.max(...ticks.map(Math.abs));
    const tickTexts = ticks.map((t) => tickLabel(t, maxAbs));
    const lo = ticks[0];
    const hi = ticks[ticks.length - 1];

    if (n === 0 || series.length === 0) {
        return (
            <div className="wb-chart-empty" style={{ width, height }}>
                沒有可以畫的數字
            </div>
        );
    }

    const pad = 8;
    const horizontal = type === "bar";
    const catLabelW = horizontal ? Math.min(width * 0.3, Math.max(...labels.map(textW)) + 8) : 0;
    const valLabelW = horizontal ? 0 : Math.max(...tickTexts.map(textW)) + 8;
    const plot = {
        x: pad + (horizontal ? catLabelW : valLabelW),
        // Room under the legend for the top tick label (it is centred on the gridline).
        y: pad + legendH + (showLegend ? 8 : 6),
        w: Math.max(10, width - pad * 2 - (horizontal ? catLabelW : valLabelW) - 6),
        h: Math.max(10, height - pad * 2 - legendH - (showLegend ? 8 : 6) - 18),
    };
    const scaleV = (v: number) => (horizontal ? plot.x + ((v - lo) / (hi - lo)) * plot.w : plot.y + plot.h - ((v - lo) / (hi - lo)) * plot.h);
    const base = scaleV(0);
    const band = (horizontal ? plot.h : plot.w) / n;
    const center = (i: number) => (horizontal ? plot.y + band * (i + 0.5) : plot.x + band * (i + 0.5));
    // Category labels: skip some when they would collide.
    const every = horizontal ? 1 : Math.max(1, Math.ceil((Math.max(...labels.map(textW)) + 8) / band));

    const showTip = (i: number, px: number, py: number) => {
        setHover(i);
        setTip({
            x: px,
            y: py,
            title: labels[i],
            rows: series.map((s, k) => ({ name: s.name, value: valueText(s.values[i]), slot: k })),
        });
    };
    /** Line / area: the nearest category to the pointer (crosshair). */
    const onPlotMove = (e: React.PointerEvent) => {
        const svg = svgRef.current;
        if (!svg) return;
        const r = svg.getBoundingClientRect();
        const k = width / r.width;
        const px = (e.clientX - r.left) * k;
        const py = (e.clientY - r.top) * k;
        const i = Math.max(0, Math.min(n - 1, Math.floor(((horizontal ? py - plot.y : px - plot.x) / band))));
        showTip(i, px, py);
    };

    let marks: React.ReactNode = null;
    if (pie) {
        const s = series[0];
        const vals = s.values.map((v) => (v !== null && v > 0 ? v : 0));
        const total = vals.reduce((a, b) => a + b, 0) || 1;
        const cx = plot.x - (horizontal ? 0 : valLabelW) + (width - pad * 2) / 2;
        const cy = plot.y + (height - pad * 2 - legendH) / 2;
        const rad = Math.max(10, Math.min(width - pad * 2, height - pad * 2 - legendH) / 2 - 4);
        let a = -Math.PI / 2;
        marks = vals.map((v, i) => {
            const a0 = a;
            const a1 = a + (v / total) * Math.PI * 2;
            a = a1;
            if (v <= 0) return null;
            const large = a1 - a0 > Math.PI ? 1 : 0;
            const d =
                v >= total
                    ? `M${cx},${cy - rad}A${rad},${rad} 0 1 1 ${cx - 0.01},${cy - rad}Z`
                    : `M${cx},${cy}L${cx + rad * Math.cos(a0)},${cy + rad * Math.sin(a0)}A${rad},${rad} 0 ${large} 1 ${cx + rad * Math.cos(a1)},${cy + rad * Math.sin(a1)}Z`;
            return (
                <path
                    key={i}
                    d={d}
                    className={`wb-chart-slice${hover === i ? " hot" : ""}`}
                    style={{ fill: `var(--s${(i % MAX_SERIES) + 1})` }}
                    onPointerMove={(e) => {
                        const r = svgRef.current!.getBoundingClientRect();
                        const k = width / r.width;
                        setHover(i);
                        setTip({
                            x: (e.clientX - r.left) * k,
                            y: (e.clientY - r.top) * k,
                            title: labels[i],
                            rows: [{ name: s.name, value: `${valueText(s.values[i])}（${((v / total) * 100).toFixed(1)}%）`, slot: i % MAX_SERIES }],
                        });
                    }}
                    onPointerLeave={() => {
                        setHover(null);
                        setTip(null);
                    }}
                />
            );
        });
    } else if (type === "column" || type === "bar") {
        const k = series.length;
        const groupW = band * 0.72;
        const barW = Math.max(2, Math.min(BAR_MAX, (groupW - GAP * (k - 1)) / k));
        const total = barW * k + GAP * (k - 1);
        marks = labels.map((_, i) => (
            <g key={i} className={hover === i ? "hot" : undefined}>
                {/* The whole band is the hover target, bigger than the marks. */}
                <rect
                    className="wb-chart-hit"
                    x={horizontal ? plot.x : plot.x + band * i}
                    y={horizontal ? plot.y + band * i : plot.y}
                    width={horizontal ? plot.w : band}
                    height={horizontal ? band : plot.h}
                    onPointerMove={(e) => {
                        const r = svgRef.current!.getBoundingClientRect();
                        const kk = width / r.width;
                        showTip(i, (e.clientX - r.left) * kk, (e.clientY - r.top) * kk);
                    }}
                    onPointerLeave={() => {
                        setHover(null);
                        setTip(null);
                    }}
                />
                {series.map((s, j) => {
                    const v = s.values[i];
                    if (v === null) return null;
                    const start = center(i) - total / 2 + j * (barW + GAP);
                    const end = scaleV(v);
                    const d = horizontal
                        ? barPath(Math.min(base, end), start, Math.abs(end - base), barW, v >= 0 ? "right" : "left")
                        : barPath(start, Math.min(base, end), barW, Math.abs(end - base), v >= 0 ? "up" : "down");
                    return <path key={j} d={d} className="wb-chart-bar" style={{ fill: `var(--s${j + 1})` }} />;
                })}
            </g>
        ));
    } else {
        // Line / area
        marks = series.map((s, j) => {
            const pts = s.values.map((v, i) => (v === null ? null : { x: center(i), y: scaleV(v) }));
            const segs: { x: number; y: number }[][] = [];
            let cur: { x: number; y: number }[] = [];
            pts.forEach((p) => {
                if (p) cur.push(p);
                else if (cur.length) {
                    segs.push(cur);
                    cur = [];
                }
            });
            if (cur.length) segs.push(cur);
            return (
                <g key={j} style={{ ["--c" as string]: `var(--s${j + 1})` }}>
                    {type === "area" &&
                        segs.map((sg, k) => (
                            <path
                                key={`a${k}`}
                                className="wb-chart-area"
                                d={`M${sg[0].x},${base}${sg.map((p) => `L${p.x},${p.y}`).join("")}L${sg[sg.length - 1].x},${base}Z`}
                            />
                        ))}
                    {segs.map((sg, k) => (
                        <path key={`l${k}`} className="wb-chart-line" d={sg.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join("")} />
                    ))}
                    {pts.map((p, i) =>
                        p && (n <= 24 || hover === i) ? <circle key={i} className={`wb-chart-dot${hover === i ? " hot" : ""}`} cx={p.x} cy={p.y} r={hover === i ? 5 : 4} /> : null,
                    )}
                </g>
            );
        });
    }

    return (
        <div className="wb-chart" style={{ width, height }}>
            <svg ref={svgRef} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="圖表">
                {showLegend && (
                    <g className="wb-chart-legend">
                        {(() => {
                            let x = pad;
                            return legendItems.slice(0, 12).map((it) => {
                                const w = 14 + textW(it.name) + 12;
                                const g = (
                                    <g key={it.slot} transform={`translate(${x},${pad + 4})`}>
                                        <rect width={10} height={10} rx={2} y={0} style={{ fill: `var(--s${(it.slot % MAX_SERIES) + 1})` }} />
                                        <text x={14} y={9}>{it.name}</text>
                                    </g>
                                );
                                x += w;
                                return g;
                            });
                        })()}
                    </g>
                )}

                {!pie && (
                    <g className="wb-chart-axes">
                        {ticks.map((t, i) =>
                            horizontal ? (
                                <g key={i}>
                                    <line className={t === 0 ? "base" : ""} x1={scaleV(t)} x2={scaleV(t)} y1={plot.y} y2={plot.y + plot.h} />
                                    <text x={scaleV(t)} y={plot.y + plot.h + 14} textAnchor="middle">{tickTexts[i]}</text>
                                </g>
                            ) : (
                                <g key={i}>
                                    <line className={t === 0 ? "base" : ""} x1={plot.x} x2={plot.x + plot.w} y1={scaleV(t)} y2={scaleV(t)} />
                                    <text x={plot.x - 6} y={scaleV(t) + 4} textAnchor="end">{tickTexts[i]}</text>
                                </g>
                            ),
                        )}
                        {labels.map((l, i) =>
                            i % every !== 0 ? null : horizontal ? (
                                <text key={`c${i}`} x={plot.x - 6} y={center(i) + 4} textAnchor="end">{l.length > 14 ? `${l.slice(0, 13)}…` : l}</text>
                            ) : (
                                <text key={`c${i}`} x={center(i)} y={plot.y + plot.h + 14} textAnchor="middle">{l}</text>
                            ),
                        )}
                    </g>
                )}

                {(type === "line" || type === "area") && hover !== null && (
                    <line className="wb-chart-crosshair" x1={center(hover)} x2={center(hover)} y1={plot.y} y2={plot.y + plot.h} />
                )}
                {marks}
                {(type === "line" || type === "area") && (
                    <rect
                        className="wb-chart-hit"
                        x={plot.x}
                        y={plot.y}
                        width={plot.w}
                        height={plot.h}
                        onPointerMove={onPlotMove}
                        onPointerLeave={() => {
                            setHover(null);
                            setTip(null);
                        }}
                    />
                )}
            </svg>
            {snapshot.series.length > MAX_SERIES && <div className="wb-chart-note">只顯示前 {MAX_SERIES} 個數列</div>}
            {tip && (
                <div
                    className="wb-chart-tip"
                    style={{ left: Math.min(tip.x + 12, width - 150), top: Math.max(4, tip.y - 12) }}
                >
                    <div className="wb-chart-tip-title">{tip.title}</div>
                    {tip.rows.map((r) => (
                        <div key={r.slot} className="wb-chart-tip-row">
                            <span className="wb-chart-swatch" style={{ background: `var(--s${(r.slot % MAX_SERIES) + 1})` }} />
                            <span className="wb-chart-tip-name">{r.name}</span>
                            <span className="wb-chart-tip-value">{r.value}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default ChartView;
