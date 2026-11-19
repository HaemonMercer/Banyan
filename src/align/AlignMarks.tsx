import type { Guide, Measure } from "./align";
import "./align.css";

/**
 * 畫輔助對齊：粉紅色的對齊虛線與距離（線、兩端的短線、中間的數字）。
 * 座標是畫布（世界）座標，zoom 是目前的縮放，線寬與字的大小在畫面上不變。
 *
 * - `AlignMarks`：放在已經套用畫布變換的 `<svg>`／`<g>` 裡（Draw）。
 * - `AlignOverlay`：自己是一個 `<svg>`，放在套用畫布變換的 HTML 容器裡（白板、試算表）。
 */
export function AlignMarks(props: { guides: Guide[]; measures: Measure[]; zoom: number }) {
  const z = props.zoom;
  return (
    <g className="al-marks">
      {props.guides.map((g, i) =>
        g.axis === "x" ? (
          <line key={`g${i}`} className="al-guide" x1={g.at} x2={g.at} y1={g.from - 12 / z} y2={g.to + 12 / z} />
        ) : (
          <line key={`g${i}`} className="al-guide" y1={g.at} y2={g.at} x1={g.from - 12 / z} x2={g.to + 12 / z} />
        ),
      )}
      {props.measures.map((m, i) => (
        <MeasureMark key={`m${i}`} m={m} z={z} />
      ))}
    </g>
  );
}

export function AlignOverlay(props: { guides: Guide[]; measures: Measure[]; zoom: number }) {
  if (!props.guides.length && !props.measures.length) return null;
  return (
    <svg className="al-overlay" aria-hidden>
      <AlignMarks {...props} />
    </svg>
  );
}

function MeasureMark({ m, z }: { m: Measure; z: number }) {
  const len = Math.round(m.to - m.from);
  if (len <= 0) return null;
  const t = 4 / z;
  const mid = (m.from + m.to) / 2;
  const label = String(len);
  const w = (label.length * 6.6 + 10) / z;
  const h = 16 / z;
  const horiz = m.axis === "x";
  // 水平線的數字在線下方；垂直線的數字在線右邊
  const bx = horiz ? mid - w / 2 : m.at + 6 / z;
  const by = horiz ? m.at + 4 / z : mid - h / 2;
  return (
    <g className={`al-measure${m.equal ? " equal" : ""}`}>
      {horiz ? (
        <>
          <line x1={m.from} x2={m.to} y1={m.at} y2={m.at} />
          <line x1={m.from} x2={m.from} y1={m.at - t} y2={m.at + t} />
          <line x1={m.to} x2={m.to} y1={m.at - t} y2={m.at + t} />
        </>
      ) : (
        <>
          <line y1={m.from} y2={m.to} x1={m.at} x2={m.at} />
          <line y1={m.from} y2={m.from} x1={m.at - t} x2={m.at + t} />
          <line y1={m.to} y2={m.to} x1={m.at - t} x2={m.at + t} />
        </>
      )}
      <rect x={bx} y={by} width={w} height={h} rx={3 / z} />
      <text x={bx + w / 2} y={by + h / 2 + 0.5 / z} fontSize={11 / z}>
        {label}
      </text>
    </g>
  );
}
