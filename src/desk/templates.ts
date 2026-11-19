import { boundsOf, cardRect, moveItems, type Board, type Rect } from "./board";
import { layoutMap, mapBounds, newMap } from "./mindmap";

/**
 * 白板的範本：只有心智圖（`mindmap.ts`，參考 XMind，自動排版）。
 *
 * 放上去之後就是一般的白板內容（可以搬、改、刪），白板本身沒有「類型」。
 * 這裡都是純函式：輸入舊的白板，回傳新的白板與新放上去的心智圖 id。
 */

export interface Placed {
  board: Board;
  /** 新放上去的心智圖 */
  ids: string[];
  /** 新內容的範圍（放好後讓畫面對準它） */
  bounds: Rect;
}

/** 以 (cx, cy) 為中心主題的中心放一張心智圖。 */
export function insertMindMap(b: Board, cx: number, cy: number): Placed {
  const m = newMap(0, 0);
  const r = layoutMap(m).nodes.get(m.root.id)!;
  const map = { ...m, x: cx - r.w / 2, y: cy - r.h / 2 };
  const board = { ...b, maps: [...b.maps, map] };
  return { board, ids: [map.id], bounds: mapBounds(map) };
}

/** 以 (x, y) 為左上角放一張心智圖（右鍵「Add mind map here」：從按的地方往右下長，不蓋住左上方的東西）。 */
export function insertMindMapAt(b: Board, x: number, y: number): Placed {
  const r = insertMindMap(b, x, y);
  const dx = x - r.bounds.x;
  const dy = y - r.bounds.y;
  return { board: moveItems(r.board, r.ids, dx, dy), ids: r.ids, bounds: { ...r.bounds, x, y } };
}

/**
 * 心智圖放在哪裡：白板是空的就放在 (cx, cy)；已經有東西時放在既有內容的右邊，不蓋住它們。
 */
export function mindMapSpot(b: Board, cx: number, cy: number, heights: Record<string, number> = {}): { x: number; y: number } {
  const all = boundsOf([...b.cards.map((c) => cardRect(c, heights)), ...b.sections, ...b.maps.map(mapBounds)]);
  if (!all) return { x: cx, y: cy };
  // 心智圖大約 700 寬，中心放在既有內容右邊再空 120
  return { x: all.x + all.w + 120 + 350, y: all.y + all.h / 2 };
}
