/**
 * 清單的選取規則（跟 Windows 檔案總管一樣），Dock 的文件清單與簡報縮圖共用：
 *
 * - 點一下：只選這一個，它成為起點（anchor）。
 * - Ctrl＋點：加入或移出選取，它成為起點。
 * - Shift＋點：選起點到這一個的範圍（Ctrl＋Shift 加到原本的選取）；起點不變。
 * - ↑↓：移到上一個／下一個；加 Shift 從起點延伸。
 *
 * 選取一律照清單順序排列。這裡都是純函式。
 */

export interface Picked<T> {
  sel: T[];
  anchor: T | null;
}

export const noPick = <T>(): Picked<T> => ({ sel: [], anchor: null });

const inOrder = <T>(order: T[], keep: (x: T) => boolean) => order.filter(keep);

export function clickPick<T>(order: T[], cur: Picked<T>, item: T, mods: { ctrl?: boolean; shift?: boolean }): Picked<T> {
  if (mods.shift && cur.anchor !== null && order.includes(cur.anchor) && order.includes(item)) {
    const a = order.indexOf(cur.anchor);
    const b = order.indexOf(item);
    const range = new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1));
    return { sel: inOrder(order, (x) => range.has(x) || (!!mods.ctrl && cur.sel.includes(x))), anchor: cur.anchor };
  }
  if (mods.ctrl) {
    const has = cur.sel.includes(item);
    return { sel: inOrder(order, (x) => (x === item ? !has : cur.sel.includes(x))), anchor: item };
  }
  return { sel: [item], anchor: item };
}

/** ↑↓：從 from 移到下一個；Shift 從起點延伸。回傳新的選取與移到的項目（到頭了就是 null）。 */
export function stepPick<T>(order: T[], cur: Picked<T>, from: T, dir: 1 | -1, shift: boolean): { pick: Picked<T>; to: T | null } {
  const i = order.indexOf(from);
  const to = order[i + dir];
  if (i < 0 || to === undefined) return { pick: cur, to: null };
  if (!shift) return { pick: { sel: [to], anchor: to }, to };
  const anchor = cur.anchor !== null && order.includes(cur.anchor) ? cur.anchor : from;
  return { pick: clickPick(order, { ...cur, anchor }, to, { shift: true }), to };
}

/** 清單變了以後，去掉已經不在的項目。 */
export function keepPick<T>(order: T[], cur: Picked<T>): Picked<T> {
  const sel = cur.sel.filter((x) => order.includes(x));
  const anchor = cur.anchor !== null && order.includes(cur.anchor) ? cur.anchor : null;
  return sel.length === cur.sel.length && anchor === cur.anchor ? cur : { sel, anchor };
}
