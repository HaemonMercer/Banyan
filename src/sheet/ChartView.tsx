import { useMemo, useState } from "react";
import type { Calc } from "./calc";
import { CHART_COLORS, chartData, niceTicks, shortNumber, type ChartData } from "./chart";
import type { Chart, Table } from "./model";

/** 畫布上的一張圖表（SVG）：拖曳搬動、右下角改大小；資料跟著表格即時更新。 */
export function ChartView(props: {
  chart: Chart;
  table: Table | null;
  calc: Calc;
  selected: boolean;
  onDown: (e: React.PointerEvent) => void;
  onResize: (w: number, h: number) => void;
  /** 改大小時的輔助對齊：拿拖曳中的大小，回傳吸附後的大小（alt 是按住 Alt，不吸附） */
  snapSize?: (w: number, h: number, alt: boolean) => { w: number; h: number };
  onResizeEnd?: () => void;
}) {
  const { chart: ch } = props;
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const w = size?.w ?? ch.w;
  const h = size?.h ?? ch.h;
  const data = useMemo(() => (props.table ? chartData(ch, props.table, props.calc) : null), [ch, props.table, props.calc]);

  const resize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const y0 = e.clientY;
    let out = { w: ch.w, h: ch.h };
    const move = (ev: PointerEvent) => {
      out = { w: Math.max(200, Math.round(ch.w + ev.clientX - x0)), h: Math.max(150, Math.round(ch.h + ev.clientY - y0)) };
      if (props.snapSize) {
        const sn = props.snapSize(out.w, out.h, ev.altKey);
        out = { w: Math.round(sn.w), h: Math.round(sn.h) };
      }
      setSize(out);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setSize(null);
      props.onResizeEnd?.();
      if (out.w !== ch.w || out.h !== ch.h) props.onResize(out.w, out.h);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className={`sc-chart${props.selected ? " on" : ""}`} style={{ left: ch.x, top: ch.y, width: w, height: h }} onPointerDown={props.onDown}>
      {ch.title && <div className="sc-chart-title">{ch.title}</div>}
      {!data ? (
        <div className="sc-chart-empty">The table for this chart was deleted.</div>
      ) : !data.series.length || !data.categories.length ? (
        <div className="sc-chart-empty">No numbers to chart in this range.</div>
      ) : (
        <Plot data={data} type={ch.type} w={w} h={h - (ch.title ? 30 : 8)} legend={ch.legend} />
      )}
      {props.selected && <span className="sc-chart-rs" onPointerDown={resize} />}
    </div>
  );
}

export function Plot(props: { data: ChartData; type: Chart["type"]; w: number; h: number; legend: boolean }) {
  const { data, type, w } = props;
  const legendH = props.legend ? 24 : 0;
  const h = Math.max(60, props.h - legendH);
  const color = (i: number) => CHART_COLORS[i % CHART_COLORS.length];

  const legend = props.legend && (
    <div className="sc-legend">
      {(type === "pie" ? data.categories : data.series.map((s) => s.name)).map((n, i) => (
        <span key={i}>
          <i style={{ background: color(i) }} />
          {n || "—"}
        </span>
      ))}
    </div>
  );

  if (type === "pie") {
    const vals = data.series[0].values.map((v) => Math.max(0, v ?? 0));
    const total = vals.reduce((a, b) => a + b, 0);
    const r = Math.max(10, Math.min(w, h) / 2 - 14);
    const cx = w / 2;
    const cy = h / 2;
    let a = -Math.PI / 2;
    return (
      <>
        <svg width={w} height={h} className="sc-plot">
          {total > 0 &&
            vals.map((v, i) => {
              if (!v) return null;
              const da = (v / total) * Math.PI * 2;
              const a0 = a;
              a += da;
              const mid = a0 + da / 2;
              const big = da > Math.PI ? 1 : 0;
              const p = (ang: number, rr = r) => `${cx + rr * Math.cos(ang)},${cy + rr * Math.sin(ang)}`;
              const d = da >= Math.PI * 2 - 1e-6 ? `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0` : `M${cx},${cy}L${p(a0)}A${r},${r} 0 ${big} 1 ${p(a)}Z`;
              return (
                <g key={i}>
                  <path d={d} fill={color(i)} stroke="var(--sv-chart-bg)" strokeWidth={1.5}>
                    <title>{`${data.categories[i]}: ${shortNumber(v)} (${Math.round((v / total) * 100)}%)`}</title>
                  </path>
                  {v / total > 0.06 && (
                    <text x={cx + r * 0.62 * Math.cos(mid)} y={cy + r * 0.62 * Math.sin(mid)} className="sc-pie-label">
                      {Math.round((v / total) * 100)}%
                    </text>
                  )}
                </g>
              );
            })}
        </svg>
        {legend}
      </>
    );
  }

  const all = data.series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all);
  const ticks = niceTicks(lo, hi);
  const t0 = ticks[0];
  const t1 = ticks[ticks.length - 1];
  const horizontal = type === "bar";
  const left = horizontal ? Math.min(120, 12 + Math.max(...data.categories.map((c) => c.length)) * 6.5) : 12 + Math.max(...ticks.map((t) => shortNumber(t).length)) * 6.5;
  const right = 14;
  const top = 10;
  const bottom = horizontal ? 22 : 24;
  const pw = Math.max(10, w - left - right);
  const ph = Math.max(10, h - top - bottom);
  const n = data.categories.length;
  const k = data.series.length;
  // 數值 → 位置（直的：y；橫的：x）
  const at = (v: number) => (horizontal ? left + ((v - t0) / (t1 - t0)) * pw : top + ph - ((v - t0) / (t1 - t0)) * ph);
  const band = (horizontal ? ph : pw) / n;
  const zero = at(0);
  const every = Math.max(1, Math.ceil((n * 46) / (horizontal ? ph * 2.2 : pw)));

  return (
    <>
      <svg width={w} height={h} className="sc-plot">
        {ticks.map((t) =>
          horizontal ? (
            <g key={t}>
              <line x1={at(t)} x2={at(t)} y1={top} y2={top + ph} className="sc-grid" />
              <text x={at(t)} y={top + ph + 15} className="sc-axis" textAnchor="middle">
                {shortNumber(t)}
              </text>
            </g>
          ) : (
            <g key={t}>
              <line x1={left} x2={left + pw} y1={at(t)} y2={at(t)} className="sc-grid" />
              <text x={left - 6} y={at(t) + 4} className="sc-axis" textAnchor="end">
                {shortNumber(t)}
              </text>
            </g>
          ),
        )}
        {data.categories.map((c, i) =>
          i % every ? null : horizontal ? (
            <text key={i} x={left - 6} y={top + band * (i + 0.5) + 4} className="sc-axis" textAnchor="end">
              {c.length > 16 ? c.slice(0, 15) + "…" : c}
            </text>
          ) : (
            <text key={i} x={left + band * (i + 0.5)} y={top + ph + 16} className="sc-axis" textAnchor="middle">
              {c.length > 12 ? c.slice(0, 11) + "…" : c}
            </text>
          ),
        )}
        {(type === "column" || type === "bar") &&
          data.series.map((s, si) =>
            s.values.map((v, i) => {
              if (v === null) return null;
              const gap = band * 0.2;
              const bw = (band - gap) / k;
              const off = band * i + gap / 2 + bw * si;
              const a = Math.min(zero, at(v));
              const len = Math.abs(at(v) - zero);
              return horizontal ? (
                <rect key={`${si}-${i}`} x={a} y={top + off} width={Math.max(1, len)} height={Math.max(1, bw - 1)} fill={color(si)} rx={2}>
                  <title>{`${s.name} · ${data.categories[i]}: ${shortNumber(v)}`}</title>
                </rect>
              ) : (
                <rect key={`${si}-${i}`} x={left + off} y={a} width={Math.max(1, bw - 1)} height={Math.max(1, len)} fill={color(si)} rx={2}>
                  <title>{`${s.name} · ${data.categories[i]}: ${shortNumber(v)}`}</title>
                </rect>
              );
            }),
          )}
        {(type === "line" || type === "area") &&
          data.series.map((s, si) => {
            const pts = s.values.map((v, i) => (v === null ? null : ([left + band * (i + 0.5), at(v)] as const)));
            const segs: (readonly [number, number])[][] = [[]];
            pts.forEach((p) => (p ? segs[segs.length - 1].push(p) : segs.push([])));
            return (
              <g key={si}>
                {segs
                  .filter((g) => g.length)
                  .map((g, gi) => (
                    <g key={gi}>
                      {type === "area" && (
                        <path d={`M${g[0][0]},${zero}` + g.map(([x, y]) => `L${x},${y}`).join("") + `L${g[g.length - 1][0]},${zero}Z`} fill={color(si)} opacity={0.22} />
                      )}
                      <polyline points={g.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke={color(si)} strokeWidth={2} strokeLinejoin="round" />
                    </g>
                  ))}
                {pts.map((p, i) =>
                  p ? (
                    <circle key={i} cx={p[0]} cy={p[1]} r={3} fill={color(si)}>
                      <title>{`${s.name} · ${data.categories[i]}: ${shortNumber(s.values[i]!)}`}</title>
                    </circle>
                  ) : null,
                )}
              </g>
            );
          })}
        {horizontal ? <line x1={zero} x2={zero} y1={top} y2={top + ph} className="sc-zero" /> : <line x1={left} x2={left + pw} y1={zero} y2={zero} className="sc-zero" />}
      </svg>
      {legend}
    </>
  );
}
