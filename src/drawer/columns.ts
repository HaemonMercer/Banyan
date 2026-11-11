import { useCallback, useState } from "react";
import type { ItemSummary } from "./api";
import { FIELD_LABELS, itemType, shortAuthors } from "./itemTypes";

/** A column of the item list besides the title, which is always shown and takes the rest. */
export interface ColumnDef {
    id: string;
    label: string;
    /** Default width in px. */
    width: number;
    minWidth: number;
    value: (it: ItemSummary) => string;
    /** Text shown dimmer than the title. */
    secondary?: boolean;
}

const day = (ms: number) => {
    if (!ms) return "";
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const COLUMNS: ColumnDef[] = [
    { id: "authors", label: "作者", width: 120, minWidth: 50, value: (it) => shortAuthors(it.authors), secondary: true },
    { id: "itemType", label: "類型", width: 90, minWidth: 50, value: (it) => itemType(it.itemType).label, secondary: true },
    { id: "date", label: FIELD_LABELS.date, width: 80, minWidth: 50, value: (it) => it.date, secondary: true },
    { id: "publication", label: FIELD_LABELS.publication, width: 140, minWidth: 50, value: (it) => it.publication, secondary: true },
    { id: "publisher", label: FIELD_LABELS.publisher, width: 120, minWidth: 50, value: (it) => it.publisher, secondary: true },
    { id: "series", label: FIELD_LABELS.series, width: 120, minWidth: 50, value: (it) => it.series, secondary: true },
    { id: "place", label: FIELD_LABELS.place, width: 100, minWidth: 50, value: (it) => it.place, secondary: true },
    { id: "createdAt", label: "新增日期", width: 90, minWidth: 60, value: (it) => day(it.createdAt), secondary: true },
    { id: "updatedAt", label: "修改日期", width: 90, minWidth: 60, value: (it) => day(it.updatedAt), secondary: true },
    { id: "attachments", label: "附件", width: 32, minWidth: 28, value: (it) => (it.attachmentCount > 0 ? String(it.attachmentCount) : "") },
];

const DEFAULT_VISIBLE = ["authors", "date", "attachments"];
const KEY = "banyan.drawer.columns";
export const TITLE_MIN_WIDTH = 160;

interface Saved {
    visible: string[];
    widths: Record<string, number>;
}

function load(): Saved {
    try {
        const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Saved | null;
        if (v && Array.isArray(v.visible)) return { visible: v.visible, widths: v.widths ?? {} };
    } catch {
        /* fall back to the defaults */
    }
    return { visible: DEFAULT_VISIBLE, widths: {} };
}

/** Which columns the item list shows and how wide they are; remembered between sessions. */
export function useColumns() {
    const [saved, setSaved] = useState(load);
    const update = useCallback((next: Saved) => {
        setSaved(next);
        try {
            localStorage.setItem(KEY, JSON.stringify(next));
        } catch {
            /* storage unavailable: keep it for this session only */
        }
    }, []);

    const columns = COLUMNS.filter((c) => saved.visible.includes(c.id)).map((c) => ({
        ...c,
        width: Math.max(c.minWidth, saved.widths[c.id] ?? c.width),
    }));

    const toggle = (id: string) =>
        update({
            ...saved,
            visible: saved.visible.includes(id) ? saved.visible.filter((v) => v !== id) : [...saved.visible, id],
        });
    const setWidth = (id: string, width: number) => update({ ...saved, widths: { ...saved.widths, [id]: Math.round(width) } });
    const reset = () => update({ visible: DEFAULT_VISIBLE, widths: {} });

    return { columns, visible: saved.visible, toggle, setWidth, reset };
}
