/**
 * Item-list selection: several items can be selected; `focus` is the item last clicked
 * (shown in the detail pane when it is the only one), `anchor` is where Shift-ranges start.
 */
export interface Selection {
    ids: number[];
    focus: number | null;
    anchor: number | null;
}

export const NO_SELECTION: Selection = { ids: [], focus: null, anchor: null };

export function single(id: number | null): Selection {
    return id === null ? NO_SELECTION : { ids: [id], focus: id, anchor: id };
}

/** Ids between `from` and `to` (inclusive) in list order. */
export function range(order: number[], from: number, to: number): number[] {
    const a = order.indexOf(from);
    const b = order.indexOf(to);
    if (a < 0 || b < 0) return [to];
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    return order.slice(lo, hi + 1);
}

/** Keeps ids in list order and drops duplicates / ids not in the list. */
export function inOrder(order: number[], ids: Iterable<number>): number[] {
    const set = new Set(ids);
    return order.filter((id) => set.has(id));
}

/** Click on a row: plain = only it; Ctrl = toggle it; Shift = range from the anchor (Ctrl+Shift adds the range). */
export function clickSelect(
    sel: Selection,
    order: number[],
    id: number,
    mods: { ctrl: boolean; shift: boolean },
): Selection {
    if (mods.shift && sel.anchor !== null) {
        const r = range(order, sel.anchor, id);
        const ids = mods.ctrl ? inOrder(order, [...sel.ids, ...r]) : r;
        return { ids, focus: id, anchor: sel.anchor };
    }
    if (mods.ctrl) {
        const has = sel.ids.includes(id);
        const ids = has ? sel.ids.filter((x) => x !== id) : inOrder(order, [...sel.ids, id]);
        return { ids, focus: has ? (ids[ids.length - 1] ?? null) : id, anchor: id };
    }
    return single(id);
}
