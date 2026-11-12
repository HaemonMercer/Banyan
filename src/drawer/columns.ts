import { useCallback, useState } from "react";
import type { ItemSummary } from "./api";
import { FIELD_LABELS, formatSize, itemType, shortAuthors, type Library } from "./itemTypes";

/** A column of the item list besides the title, which is always shown and takes the rest. */
export interface ColumnDef {
    id: string;
    label: string;
    /** Default width in px. */
    width: number;
    minWidth: number;
    value: (it: ItemSummary) => string;
    /** What it sorts by, when not its text (numbers: dates, sizes, counts). */
    sortValue?: (it: ItemSummary) => number;
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
    { id: "createdAt", label: "新增日期", width: 90, minWidth: 60, value: (it) => day(it.createdAt), sortValue: (it) => it.createdAt, secondary: true },
    { id: "updatedAt", label: "修改日期", width: 90, minWidth: 60, value: (it) => day(it.updatedAt), sortValue: (it) => it.updatedAt, secondary: true },
    { id: "attachments", label: "附件", width: 32, minWidth: 28, value: (it) => (it.attachmentCount > 0 ? String(it.attachmentCount) : ""), sortValue: (it) => it.attachmentCount },
];

const extension = (name: string | null) => {
    const m = /\.([^.]+)$/.exec(name ?? "");
    return m ? m[1].toUpperCase() : "";
};

/** Columns of 檔案庫's list: about the file rather than bibliographic data. */
export const FILE_COLUMNS: ColumnDef[] = [
    { id: "itemType", label: "類型", width: 80, minWidth: 50, value: (it) => itemType(it.itemType).label, secondary: true },
    { id: "extension", label: "副檔名", width: 64, minWidth: 40, value: (it) => extension(it.fileName), secondary: true },
    { id: "fileSize", label: "大小", width: 76, minWidth: 50, value: (it) => (it.attachmentCount > 0 ? formatSize(it.fileSize) : ""), sortValue: (it) => (it.attachmentCount > 0 ? it.fileSize : -1), secondary: true },
    { id: "fileName", label: "檔名", width: 160, minWidth: 60, value: (it) => it.fileName ?? "", secondary: true },
    { id: "date", label: "日期", width: 80, minWidth: 50, value: (it) => it.date, secondary: true },
    { id: "createdAt", label: "加入日期", width: 90, minWidth: 60, value: (it) => day(it.createdAt), sortValue: (it) => it.createdAt, secondary: true },
    { id: "updatedAt", label: "修改日期", width: 90, minWidth: 60, value: (it) => day(it.updatedAt), sortValue: (it) => it.updatedAt, secondary: true },
    { id: "attachments", label: "附件", width: 32, minWidth: 28, value: (it) => (it.attachmentCount > 1 ? String(it.attachmentCount) : ""), sortValue: (it) => it.attachmentCount },
];

const SETS: Record<Library, { all: ColumnDef[]; defaults: string[]; key: string }> = {
    literature: { all: COLUMNS, defaults: ["authors", "date", "attachments"], key: "banyan.drawer.columns" },
    files: { all: FILE_COLUMNS, defaults: ["itemType", "fileSize", "createdAt"], key: "banyan.drawer.columns.files" },
};
export const TITLE_MIN_WIDTH = 160;

/** How the list is ordered: by the title or a column, or (null) recently modified first. */
export interface Sort {
    key: string;
    dir: "asc" | "desc";
}

interface Saved {
    visible: string[];
    widths: Record<string, number>;
    sort?: Sort | null;
}

const collator = new Intl.Collator("zh-Hant", { numeric: true, sensitivity: "base" });

/**
 * The items in the chosen order. Empty values go last either way; ties keep the server's order
 * (recently modified first).
 */
export function sortItems(items: ItemSummary[], sort: Sort | null | undefined, columns: ColumnDef[], title: (it: ItemSummary) => string): ItemSummary[] {
    if (!sort) return items;
    const col = columns.find((c) => c.id === sort.key);
    if (sort.key !== "title" && !col) return items;
    const key = (it: ItemSummary): string | number => (sort.key === "title" ? title(it) : col!.sortValue ? col!.sortValue(it) : col!.value(it));
    const sign = sort.dir === "asc" ? 1 : -1;
    const keyed = items.map((it, i) => ({ it, i, k: key(it) }));
    const empty = (k: string | number) => k === "" || (typeof k === "number" && k < 0);
    keyed.sort((a, b) => {
        const ea = empty(a.k);
        const eb = empty(b.k);
        if (ea !== eb) return ea ? 1 : -1;
        const c = typeof a.k === "number" && typeof b.k === "number" ? a.k - b.k : collator.compare(String(a.k), String(b.k));
        return c !== 0 ? sign * c : a.i - b.i;
    });
    return keyed.map((x) => x.it);
}

function load(library: Library): Saved {
    const { key, defaults } = SETS[library];
    try {
        const v = JSON.parse(localStorage.getItem(key) ?? "null") as Saved | null;
        if (v && Array.isArray(v.visible)) return { visible: v.visible, widths: v.widths ?? {}, sort: v.sort ?? null };
    } catch {
        /* fall back to the defaults */
    }
    return { visible: defaults, widths: {} };
}

/**
 * Which columns the item list shows and how wide they are, per library; remembered between sessions.
 * The list remounts when the library changes (`key`), so the library is fixed for a hook's lifetime.
 */
export function useColumns(library: Library) {
    const { all, defaults, key } = SETS[library];
    const [saved, setSaved] = useState(() => load(library));
    const update = useCallback((next: Saved) => {
        setSaved(next);
        try {
            localStorage.setItem(key, JSON.stringify(next));
        } catch {
            /* storage unavailable: keep it for this session only */
        }
    }, [key]);

    const columns = all.filter((c) => saved.visible.includes(c.id)).map((c) => ({
        ...c,
        width: Math.max(c.minWidth, saved.widths[c.id] ?? c.width),
    }));

    const toggle = (id: string) =>
        update({
            ...saved,
            visible: saved.visible.includes(id) ? saved.visible.filter((v) => v !== id) : [...saved.visible, id],
        });
    const setWidth = (id: string, width: number) => update({ ...saved, widths: { ...saved.widths, [id]: Math.round(width) } });
    const reset = () => update({ visible: defaults, widths: {}, sort: saved.sort });
    /**
     * A header was clicked: sort by it ascending (dates and sizes newest / largest first), then
     * the other way, then back to the default order.
     */
    const cycleSort = (key: string) => {
        const first: Sort["dir"] = all.find((c) => c.id === key)?.sortValue ? "desc" : "asc";
        const cur = saved.sort;
        const next: Sort | null = cur?.key !== key ? { key, dir: first } : cur.dir === first ? { key, dir: first === "asc" ? "desc" : "asc" } : null;
        update({ ...saved, sort: next });
    };

    const setSort = (sort: Sort | null) => update({ ...saved, sort });

    return { all, columns, visible: saved.visible, toggle, setWidth, reset, sort: saved.sort ?? null, cycleSort, setSort };
}
