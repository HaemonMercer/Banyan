/**
 * 輔助對齊（參考 Figma 的 smart guides）：整個 App 裡可以自由擺放的東西共用——
 * Draw 的圖形、白板的卡片／區段／心智圖、試算表畫布上的表格與圖表。
 *
 * - `snapMove`：拖曳時，每個方向在「對齊其他東西的邊或中線」與「等距」裡取比較近的，都沒有才對齊格線；
 *   回傳位移、對齊線與要顯示的距離。
 * - `snapResizeGrid`：改大小時動的邊吸到其他東西的邊或中線，沒有才對齊格線。
 * - `measureGaps`：和上下左右最近的鄰居（或包住它的框的內側）的距離。
 * - `measureBetween`：Alt 量距離。
 *
 * 座標都是畫布（世界）座標；畫在畫面上用 `AlignMarks.tsx`。這裡都是純函式。
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const boundsOf = (rects: Rect[]): Rect | null => {
  if (!rects.length) return null;
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
export { boundsOf as alignBounds };

/* ─── 對齊線 ─── */

export interface Guide {
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
}

/**
 * 拖曳時對齊其他圖形的邊或中線：回傳要修正的位移與要畫的對齊線。
 * box 是拖曳中的外框，tol 是吸附距離（白板座標）。
 */
export function snapGuides(box: Rect, others: Rect[], tol: number): { dx: number; dy: number; guides: Guide[] } {
  const xs = [box.x, box.x + box.w / 2, box.x + box.w];
  const ys = [box.y, box.y + box.h / 2, box.y + box.h];
  let bx: { d: number; at: number } | null = null;
  let by: { d: number; at: number } | null = null;
  for (const o of others) {
    for (const t of [o.x, o.x + o.w / 2, o.x + o.w])
      for (const v of xs) if (Math.abs(t - v) <= tol && (!bx || Math.abs(t - v) < Math.abs(bx.d))) bx = { d: t - v, at: t };
    for (const t of [o.y, o.y + o.h / 2, o.y + o.h])
      for (const v of ys) if (Math.abs(t - v) <= tol && (!by || Math.abs(t - v) < Math.abs(by.d))) by = { d: t - v, at: t };
  }
  const dx = bx?.d ?? 0;
  const dy = by?.d ?? 0;
  const moved = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
  const guides: Guide[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
  if (bx) {
    const on = others.filter((o) => [o.x, o.x + o.w / 2, o.x + o.w].some((t) => near(t, bx!.at)));
    const y0 = Math.min(moved.y, ...on.map((o) => o.y));
    const y1 = Math.max(moved.y + moved.h, ...on.map((o) => o.y + o.h));
    guides.push({ axis: "x", at: bx.at, from: y0, to: y1 });
  }
  if (by) {
    const on = others.filter((o) => [o.y, o.y + o.h / 2, o.y + o.h].some((t) => near(t, by!.at)));
    const x0 = Math.min(moved.x, ...on.map((o) => o.x));
    const x1 = Math.max(moved.x + moved.w, ...on.map((o) => o.x + o.w));
    guides.push({ axis: "y", at: by.at, from: x0, to: x1 });
  }
  return { dx, dy, guides };
}

/* ─── 輔助對齊：間距、等距吸附、改大小吸附、量距離（參考 Figma） ─── */

/** 一段量距離的線：axis "x" 是水平線（從 x=from 到 x=to，畫在 y=at），"y" 是垂直線。equal 是等距的標記。 */
export interface Measure {
  axis: "x" | "y";
  from: number;
  to: number;
  at: number;
  equal?: boolean;
}

const right = (r: Rect) => r.x + r.w;
const bottom = (r: Rect) => r.y + r.h;
const overlapY = (a: Rect, b: Rect) => a.y < bottom(b) && bottom(a) > b.y;
const overlapX = (a: Rect, b: Rect) => a.x < right(b) && right(a) > b.x;
/** outer 包住 inner（不是同一個框） */
const encloses = (outer: Rect, inner: Rect) =>
  outer.x <= inner.x && outer.y <= inner.y && right(outer) >= right(inner) && bottom(outer) >= bottom(inner) && (outer.w > inner.w || outer.h > inner.h);
const midOverlap = (a0: number, a1: number, b0: number, b1: number) => (Math.max(a0, b0) + Math.min(a1, b1)) / 2;

/**
 * 拖曳時顯示的間距：往上下左右各找最近的鄰居（在同一列／同一欄有重疊的），
 * 包住它的框（例如畫板）也算，量到框的內側。
 */
export function measureGaps(box: Rect, others: Rect[]): Measure[] {
  type Best = { gap: number; m: Measure } | null;
  let l: Best = null;
  let r: Best = null;
  let u: Best = null;
  let d: Best = null;
  const take = (cur: Best, gap: number, m: Measure): Best => (gap >= 0.5 && (!cur || gap < cur.gap) ? { gap, m } : cur);
  const cy = box.y + box.h / 2;
  const cx = box.x + box.w / 2;
  for (const o of others) {
    if (encloses(o, box)) {
      l = take(l, box.x - o.x, { axis: "x", from: o.x, to: box.x, at: cy });
      r = take(r, right(o) - right(box), { axis: "x", from: right(box), to: right(o), at: cy });
      u = take(u, box.y - o.y, { axis: "y", from: o.y, to: box.y, at: cx });
      d = take(d, bottom(o) - bottom(box), { axis: "y", from: bottom(box), to: bottom(o), at: cx });
      continue;
    }
    if (encloses(box, o)) continue;
    if (overlapY(o, box)) {
      const at = midOverlap(box.y, bottom(box), o.y, bottom(o));
      if (right(o) <= box.x) l = take(l, box.x - right(o), { axis: "x", from: right(o), to: box.x, at });
      if (o.x >= right(box)) r = take(r, o.x - right(box), { axis: "x", from: right(box), to: o.x, at });
    }
    if (overlapX(o, box)) {
      const at = midOverlap(box.x, right(box), o.x, right(o));
      if (bottom(o) <= box.y) u = take(u, box.y - bottom(o), { axis: "y", from: bottom(o), to: box.y, at });
      if (o.y >= bottom(box)) d = take(d, o.y - bottom(box), { axis: "y", from: bottom(box), to: o.y, at });
    }
  }
  return [l, r, u, d].filter((b): b is { gap: number; m: Measure } => !!b).map((b) => b.m);
}

/**
 * 等距吸附：拖曳的框和左右（上下）鄰居的間距，等於同一列裡其他兩個圖形之間的間距時吸過去；
 * 夾在兩個圖形中間時也會吸到正中間。回傳位移與要畫的等距標記。
 */
export function snapSpacing(box: Rect, others: Rect[], tol: number): { dx: number; dy: number; marks: Measure[] } {
  const axis = (h: boolean) => {
    const lo = (r: Rect) => (h ? r.x : r.y);
    const len = (r: Rect) => (h ? r.w : r.h);
    const hi = (r: Rect) => lo(r) + len(r);
    const crossOverlap = (a: Rect, b: Rect) => (h ? overlapY(a, b) : overlapX(a, b));
    const at = (a: Rect, b: Rect) => (h ? midOverlap(a.y, bottom(a), b.y, bottom(b)) : midOverlap(a.x, right(a), b.x, right(b)));
    const row = others.filter((o) => crossOverlap(o, box) && !encloses(o, box) && !encloses(box, o));
    // 同一列裡相鄰兩個圖形的間距
    const pairs: { a: Rect; b: Rect; gap: number }[] = [];
    const sorted = [...row].sort((a, b) => lo(a) - lo(b));
    for (const a of sorted) {
      let next: Rect | null = null;
      for (const b of sorted) if (lo(b) >= hi(a) && crossOverlap(a, b) && (!next || lo(b) < lo(next))) next = b;
      if (next) pairs.push({ a, b: next, gap: lo(next) - hi(a) });
    }
    let L: Rect | null = null;
    let R: Rect | null = null;
    for (const o of row) {
      if (hi(o) <= lo(box) + tol && lo(o) < lo(box) && (!L || hi(o) > hi(L))) L = o;
      if (lo(o) >= hi(box) - tol && hi(o) > hi(box) && (!R || lo(o) < lo(R))) R = o;
    }
    let best: { d: number; gap: number } | null = null;
    const consider = (d: number, gap: number) => {
      if (gap > 0 && Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, gap };
    };
    for (const p of pairs) {
      if (L) consider(hi(L) + p.gap - lo(box), p.gap);
      if (R) consider(lo(R) - p.gap - hi(box), p.gap);
    }
    if (L && R) {
      const gap = (lo(R) - hi(L) - len(box)) / 2;
      consider(hi(L) + gap - lo(box), gap);
    }
    if (!best) return { d: 0, marks: [] as Measure[] };
    const { d, gap } = best as { d: number; gap: number };
    const moved = h ? { ...box, x: box.x + d } : { ...box, y: box.y + d };
    const eq = (g: number) => Math.abs(g - gap) < 0.5;
    const mark = (a: Rect, b: Rect): Measure => ({ axis: h ? "x" : "y", from: hi(a), to: lo(b), at: at(a, b), equal: true });
    const marks: Measure[] = pairs.filter((p) => eq(p.gap)).map((p) => mark(p.a, p.b));
    if (L && eq(lo(moved) - hi(L))) marks.push(mark(L, moved));
    if (R && eq(lo(R) - hi(moved))) marks.push(mark(moved, R));
    return { d, marks };
  };
  const x = axis(true);
  const y = axis(false);
  return { dx: x.d, dy: y.d, marks: [...x.marks, ...y.marks] };
}

/** 改大小時，正在動的邊吸到其他圖形的邊或中線（h 是控制點）。 */
export function snapResize(r: Rect, h: string, others: Rect[], tol: number, min = 10): { rect: Rect; guides: Guide[] } {
  const out = { ...r };
  const guides: Guide[] = [];
  const pick = (v: number, lines: number[]) => {
    let best: number | null = null;
    for (const t of lines) if (Math.abs(t - v) <= tol && (best === null || Math.abs(t - v) < Math.abs(best - v))) best = t;
    return best;
  };
  const xs = others.flatMap((o) => [o.x, o.x + o.w / 2, right(o)]);
  const ys = others.flatMap((o) => [o.y, o.y + o.h / 2, bottom(o)]);
  if (h.includes("e")) {
    const t = pick(right(out), xs);
    if (t !== null && t - out.x >= min) out.w = t - out.x;
  }
  if (h.includes("w")) {
    const t = pick(out.x, xs);
    if (t !== null && right(out) - t >= min) {
      out.w = right(out) - t;
      out.x = t;
    }
  }
  if (h.includes("s")) {
    const t = pick(bottom(out), ys);
    if (t !== null && t - out.y >= min) out.h = t - out.y;
  }
  if (h.includes("n")) {
    const t = pick(out.y, ys);
    if (t !== null && bottom(out) - t >= min) {
      out.h = bottom(out) - t;
      out.y = t;
    }
  }
  const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
  const edgesX = [h.includes("e") ? right(out) : null, h.includes("w") ? out.x : null].filter((v): v is number => v !== null);
  const edgesY = [h.includes("s") ? bottom(out) : null, h.includes("n") ? out.y : null].filter((v): v is number => v !== null);
  for (const v of edgesX) {
    const on = others.filter((o) => [o.x, o.x + o.w / 2, right(o)].some((t) => near(t, v)));
    if (on.length) guides.push({ axis: "x", at: v, from: Math.min(out.y, ...on.map((o) => o.y)), to: Math.max(bottom(out), ...on.map(bottom)) });
  }
  for (const v of edgesY) {
    const on = others.filter((o) => [o.y, o.y + o.h / 2, bottom(o)].some((t) => near(t, v)));
    if (on.length) guides.push({ axis: "y", at: v, from: Math.min(out.x, ...on.map((o) => o.x)), to: Math.max(right(out), ...on.map(right)) });
  }
  return { rect: out, guides };
}

/**
 * Alt 量距離：a 是選取的範圍，b 是滑過的圖形（或所在的畫板）。
 * 一個包住另一個時量四邊的內距；分開時量水平與垂直的間距；重疊（沒有包住）時量對應邊的差。
 */
export function measureBetween(a: Rect, b: Rect): Measure[] {
  const [inner, outer] = encloses(b, a) ? [a, b] : encloses(a, b) ? [b, a] : [null, null];
  if (inner && outer) {
    const cy = inner.y + inner.h / 2;
    const cx = inner.x + inner.w / 2;
    return [
      { axis: "x" as const, from: outer.x, to: inner.x, at: cy },
      { axis: "x" as const, from: right(inner), to: right(outer), at: cy },
      { axis: "y" as const, from: outer.y, to: inner.y, at: cx },
      { axis: "y" as const, from: bottom(inner), to: bottom(outer), at: cx },
    ].filter((m) => m.to - m.from >= 0.5);
  }
  const out: Measure[] = [];
  const cy = overlapY(a, b) ? midOverlap(a.y, bottom(a), b.y, bottom(b)) : a.y + a.h / 2;
  const cx = overlapX(a, b) ? midOverlap(a.x, right(a), b.x, right(b)) : a.x + a.w / 2;
  if (right(a) <= b.x) out.push({ axis: "x", from: right(a), to: b.x, at: cy });
  else if (right(b) <= a.x) out.push({ axis: "x", from: right(b), to: a.x, at: cy });
  else {
    // 水平方向重疊：量左邊與右邊的差
    if (Math.abs(a.x - b.x) >= 0.5) out.push({ axis: "x", from: Math.min(a.x, b.x), to: Math.max(a.x, b.x), at: cy });
    if (Math.abs(right(a) - right(b)) >= 0.5) out.push({ axis: "x", from: Math.min(right(a), right(b)), to: Math.max(right(a), right(b)), at: cy });
  }
  if (bottom(a) <= b.y) out.push({ axis: "y", from: bottom(a), to: b.y, at: cx });
  else if (bottom(b) <= a.y) out.push({ axis: "y", from: bottom(b), to: a.y, at: cx });
  else {
    if (Math.abs(a.y - b.y) >= 0.5) out.push({ axis: "y", from: Math.min(a.y, b.y), to: Math.max(a.y, b.y), at: cx });
    if (Math.abs(bottom(a) - bottom(b)) >= 0.5) out.push({ axis: "y", from: Math.min(bottom(a), bottom(b)), to: Math.max(bottom(a), bottom(b)), at: cx });
  }
  return out;
}

/**
 * 拖曳時的吸附：box 是原本的外框，(dx, dy) 是滑鼠的位移；grid 是格線間距（null 不對齊格線）。
 * 每個方向在「對齊邊與中線」和「等距」裡取比較近的，都沒有才對齊格線。
 */
export function snapMove(
  box: Rect,
  dx: number,
  dy: number,
  others: Rect[],
  tol: number,
  grid: number | null,
): { dx: number; dy: number; guides: Guide[]; measures: Measure[] } {
  const raw = { ...box, x: box.x + dx, y: box.y + dy };
  const g = snapGuides(raw, others, tol);
  const sp = snapSpacing(raw, others, tol);
  const hasGx = g.guides.some((x) => x.axis === "x");
  const hasGy = g.guides.some((x) => x.axis === "y");
  const sx = sp.dx !== 0 && (!hasGx || Math.abs(sp.dx) < Math.abs(g.dx));
  const sy = sp.dy !== 0 && (!hasGy || Math.abs(sp.dy) < Math.abs(g.dy));
  const gx = hasGx && !sx;
  const gy = hasGy && !sy;
  dx += gx ? g.dx : sx ? sp.dx : 0;
  dy += gy ? g.dy : sy ? sp.dy : 0;
  const onGrid = (v: number) => (grid ? Math.round(v / grid) * grid : v);
  if (!gx && !sx && grid) dx = onGrid(box.x + dx) - box.x;
  if (!gy && !sy && grid) dy = onGrid(box.y + dy) - box.y;
  const final = { ...box, x: box.x + dx, y: box.y + dy };
  const guides = snapGuides(final, others, 0.5).guides.filter((x) => (x.axis === "x" ? gx : gy));
  const eq = snapSpacing(final, others, 0.5).marks;
  const eqAxes = new Set(eq.map((m) => m.axis));
  const measures = [...eq, ...measureGaps(final, others).filter((m) => !eqAxes.has(m.axis))];
  return { dx, dy, guides, measures };
}

/**
 * 改大小時的吸附：先吸到其他東西的邊或中線，沒有的邊才對齊格線。h 是控制點（n、s、e、w 的組合）。
 * base 是開始拖曳時的外框（左邊、上邊對齊格線時，右邊、下邊不動）。
 */
export function snapResizeGrid(
  r: Rect,
  base: Rect,
  h: string,
  others: Rect[],
  tol: number,
  grid: number | null,
  min = 10,
): { rect: Rect; guides: Guide[]; measures: Measure[] } {
  const sr = snapResize(r, h, others, tol, min);
  let out = sr.rect;
  const sxed = sr.guides.some((g) => g.axis === "x");
  const syed = sr.guides.some((g) => g.axis === "y");
  if (grid) {
    const on = (v: number) => Math.round(v / grid) * grid;
    if (!sxed && h.includes("e")) out = { ...out, w: Math.max(min, on(out.x + out.w) - out.x) };
    if (!syed && h.includes("s")) out = { ...out, h: Math.max(min, on(out.y + out.h) - out.y) };
    if (!sxed && h.includes("w")) {
      const left = Math.min(on(out.x), base.x + base.w - min);
      out = { ...out, x: left, w: base.x + base.w - left };
    }
    if (!syed && h.includes("n")) {
      const top = Math.min(on(out.y), base.y + base.h - min);
      out = { ...out, y: top, h: base.y + base.h - top };
    }
  }
  return { rect: out, guides: sr.guides, measures: measureGaps(out, others) };
}
