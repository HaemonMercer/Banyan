import { useEffect, useMemo, useState } from "react";
import type { BoardCard } from "../../whiteboard/api";
import { CHART_TYPES, chartText, readChart, snapshotFromTable, type ChartData } from "../../whiteboard/chart";
import ChartView from "./ChartView";

interface Props {
    card: BoardCard;
    /** The object is selected on the board (the chart tools show). */
    active: boolean;
    /** Another card on this board, by id (the chart's table), when there is one. */
    findCard?: (id: number) => BoardCard | undefined;
    /** Chart settings or numbers changed: new data, and the numbers as text for `content`. */
    onChange: (data: string, content: string) => void;
}

/** Height of the object's grip bar above the chart. */
const GRIP = 18;

/**
 * A chart on the board. With its table on the same board it follows the table live (and keeps
 * its snapshot up to date); elsewhere it draws the snapshot.
 */
function ChartObject({ card, active, findCard, onChange }: Props) {
    const chart = useMemo(() => readChart(card.data), [card.data]);
    const table = chart.source ? findCard?.(chart.source.cardId) : undefined;
    const live = useMemo(
        () => (table && table.kind === "table" && chart.source ? snapshotFromTable(table.data, chart.source.range, chart.seriesBy) : null),
        [table?.data, chart.source?.range, chart.seriesBy], // eslint-disable-line react-hooks/exhaustive-deps
    );
    const snapshot = live ?? chart.snapshot;

    // Keep the stored snapshot in step with the table, so the chart looks right everywhere.
    const liveKey = live ? JSON.stringify(live) : "";
    useEffect(() => {
        if (!live || liveKey === JSON.stringify(chart.snapshot)) return;
        const next: ChartData = { ...chart, snapshot: live };
        onChange(JSON.stringify(next), chartText(live));
    }, [liveKey]); // eslint-disable-line react-hooks/exhaustive-deps

    const set = (patch: Partial<ChartData>) => {
        const next = { ...chart, ...patch };
        const snap =
            table && next.source ? snapshotFromTable(table.data, next.source.range, next.seriesBy) ?? next.snapshot : next.snapshot;
        onChange(JSON.stringify({ ...next, snapshot: snap }), chartText(snap));
    };

    const [rangeDraft, setRangeDraft] = useState<string | null>(null);
    const commitRange = () => {
        if (rangeDraft === null || !chart.source) return;
        const r = rangeDraft.trim().toUpperCase();
        setRangeDraft(null);
        if (r && r !== chart.source.range && /^\$?[A-Z]{1,3}\$?\d+(:\$?[A-Z]{1,3}\$?\d+)?$/.test(r)) set({ source: { ...chart.source, range: r } });
    };

    return (
        <>
            <div className="wb-obj-media wb-obj-chart" data-role="grip">
                <ChartView type={chart.type} snapshot={snapshot} legend={chart.legend} width={card.width - 2} height={Math.max(40, card.height - GRIP - 2)} />
            </div>
            {active && (
                <div className="wb-chart-tools" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                    <div className="wb-chart-types" role="radiogroup" aria-label="圖表類型">
                        {CHART_TYPES.map((t) => (
                            <button key={t.type} className={chart.type === t.type ? "on" : ""} onClick={() => set({ type: t.type })}>
                                {t.label}
                            </button>
                        ))}
                    </div>
                    <span className="wb-tbl-sep" />
                    <button className="wb-chart-btn" title="切換列／欄：改用另一個方向當作數列" onClick={() => set({ seriesBy: chart.seriesBy === "col" ? "row" : "col" })}>
                        切換列／欄
                    </button>
                    <label className="xl-check">
                        <input type="checkbox" checked={chart.legend} onChange={() => set({ legend: !chart.legend })} /> 圖例
                    </label>
                    {chart.source && (
                        <>
                            <span className="wb-tbl-sep" />
                            <span className="wb-chart-src" title={table ? `資料來自表格「${table.title || "表格"}」` : "表格不在這個白板上，顯示的是最後一次的資料"}>
                                {table ? table.title || "表格" : "（表格不在此白板）"}
                            </span>
                            <input
                                className="wb-chart-range"
                                value={rangeDraft ?? chart.source.range}
                                aria-label="資料範圍"
                                title="資料範圍，例如 A1:C5"
                                onFocus={() => setRangeDraft(chart.source!.range)}
                                onChange={(e) => setRangeDraft(e.target.value)}
                                onBlur={commitRange}
                                onKeyDown={(e) => {
                                    e.stopPropagation();
                                    if (e.key === "Enter") commitRange();
                                    if (e.key === "Escape") setRangeDraft(null);
                                }}
                            />
                        </>
                    )}
                </div>
            )}
        </>
    );
}

export default ChartObject;
