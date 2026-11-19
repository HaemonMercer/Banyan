/**
 * 簡報的動畫（參考 Keynote／PowerPoint）：每張投影片有
 * - 轉場 `transition`：進到這張投影片時的效果；
 * - 逐項顯示 `build`：放映時每按一下出現一個區塊（清單是一項一項），開頭的標題一開始就在。
 *
 * 每張投影片的設定也放這裡：主文字方塊的位置 `main`、其他物件 `boxes`（`slideBoxes.ts`）。
 *
 * 動畫不寫進 Markdown（編輯器會把註解之類的標記當成區塊），存在 `DockDoc.anim`，
 * 跟投影片一張對一張；投影片的新增、刪除、複製、搬移要用這裡同名的函式一起改。這裡都是純函式。
 */

import { cleanBoxes, cleanFrame, type Frame, type SlideBox } from "./slideBoxes";

export type Transition = "none" | "fade" | "push" | "cover" | "wipe" | "zoom";
export type Build = "none" | "appear" | "fade" | "rise" | "zoom";

export interface SlideAnim {
  transition: Transition;
  build: Build;
  /** 主文字方塊的位置大小（沒有就是預設） */
  main?: Frame;
  /** 文字方塊、圖片、形狀（陣列順序＝上下層） */
  boxes?: SlideBox[];
  /** 主文字方塊刪掉了（內容也清空；檢閱器的 Add Body Text 加回來） */
  noBody?: true;
  /** 這張的背景色（沒有是主題的背景） */
  bg?: string;
  /** 演講者備忘稿 */
  notes?: string;
  /** 放映時跳過 */
  skip?: true;
}

export const NO_ANIM: SlideAnim = { transition: "none", build: "none" };

export const TRANSITIONS: { id: Transition; label: string }[] = [
  { id: "none", label: "None" },
  { id: "fade", label: "Fade" },
  { id: "push", label: "Push" },
  { id: "cover", label: "Cover" },
  { id: "wipe", label: "Wipe" },
  { id: "zoom", label: "Zoom" },
];

export const BUILDS: { id: Build; label: string }[] = [
  { id: "none", label: "All at once" },
  { id: "appear", label: "Appear" },
  { id: "fade", label: "Fade in" },
  { id: "rise", label: "Rise" },
  { id: "zoom", label: "Zoom in" },
];

/** 轉場與逐項動畫的時間（毫秒）；CSS 用同樣的數字 */
export const TRANSITION_MS = 550;
export const BUILD_MS = 400;

const T_IDS = TRANSITIONS.map((t) => t.id);
const B_IDS = BUILDS.map((b) => b.id);

export const isAnimated = (a: SlideAnim | undefined) => !!a && (a.transition !== "none" || a.build !== "none");

/** 這張投影片有沒有任何設定（動畫、物件、改過主文字方塊的位置） */
const hasMeta = (a: SlideAnim | undefined) => isAnimated(a) || !!a?.main || !!a?.boxes?.length || !!a?.noBody || !!a?.bg || !!a?.notes || !!a?.skip;

/** 第 i 張的動畫（沒設定就是沒有動畫） */
export const animAt = (list: SlideAnim[] | undefined, i: number): SlideAnim => list?.[i] ?? NO_ANIM;

/** 存檔讀回來的資料：不認得的值當成沒有動畫 */
export function cleanAnim(raw: unknown): SlideAnim[] {
  if (!Array.isArray(raw)) return [];
  return trimAnim(
    raw.map((o) => {
      const r = o && typeof o === "object" ? (o as Record<string, unknown>) : {};
      const a: SlideAnim = {
        transition: T_IDS.includes(r.transition as Transition) ? (r.transition as Transition) : "none",
        build: B_IDS.includes(r.build as Build) ? (r.build as Build) : "none",
      };
      const main = cleanFrame(r.main);
      const boxes = cleanBoxes(r.boxes);
      if (main) a.main = main;
      if (boxes.length) a.boxes = boxes;
      if (r.noBody === true) a.noBody = true;
      if (typeof r.bg === "string" && /^#[0-9a-f]{6}$/i.test(r.bg)) a.bg = r.bg;
      if (typeof r.notes === "string" && r.notes.trim()) a.notes = r.notes;
      if (r.skip === true) a.skip = true;
      return a;
    }),
  );
}

/** 去掉結尾沒有動畫的投影片（存檔時不用寫） */
export function trimAnim(list: SlideAnim[]): SlideAnim[] {
  let n = list.length;
  while (n > 0 && !hasMeta(list[n - 1])) n--;
  return list.slice(0, n).map((a) => {
    const out: SlideAnim = { transition: a.transition, build: a.build };
    if (a.main) out.main = a.main;
    if (a.boxes?.length) out.boxes = a.boxes;
    if (a.noBody) out.noBody = true;
    if (a.bg) out.bg = a.bg;
    if (a.notes?.trim()) out.notes = a.notes;
    if (a.skip) out.skip = true;
    return out;
  });
}

/** 長度補到 n 張 */
const pad = (list: SlideAnim[], n: number) => Array.from({ length: Math.max(n, list.length) }, (_x, i) => list[i] ?? NO_ANIM);

/** 改第 idx 張（可以好幾張）的動畫 */
export function setAnim(list: SlideAnim[], idx: number[], patch: Partial<SlideAnim>): SlideAnim[] {
  const all = pad(list, Math.max(0, ...idx.map((i) => i + 1)));
  for (const i of idx) if (i >= 0) all[i] = { ...all[i], ...patch };
  return trimAnim(all);
}

/** 改第 i 張投影片的設定（物件、主文字方塊的位置） */
export function setMeta(list: SlideAnim[], i: number, fn: (a: SlideAnim) => SlideAnim): SlideAnim[] {
  const all = pad(list, i + 1);
  all[i] = fn(all[i]);
  return trimAnim(all);
}

/** 在第 at 個位置插入 count 張沒有動畫的投影片（編輯時打出分隔線也算） */
export function animInsert(list: SlideAnim[], at: number, count = 1): SlideAnim[] {
  if (count <= 0 || at >= list.length) return trimAnim(list);
  const all = [...list];
  all.splice(Math.max(0, at), 0, ...Array.from({ length: count }, () => NO_ANIM));
  return trimAnim(all);
}

/** 在第 at 個位置插入好幾張投影片的動畫（貼上） */
export function animSplice(list: SlideAnim[], at: number, items: SlideAnim[]): SlideAnim[] {
  const all = pad(list, at);
  all.splice(at, 0, ...items.map((a) => a ?? NO_ANIM));
  return trimAnim(all);
}

/** 兩份動畫是否一樣（不算結尾沒有動畫的） */
export function sameAnim(a: SlideAnim[], b: SlideAnim[]): boolean {
  return JSON.stringify(trimAnim(a)) === JSON.stringify(trimAnim(b));
}

/** 刪掉好幾張 */
export function animRemove(list: SlideAnim[], idx: number[]): SlideAnim[] {
  const gone = new Set(idx);
  return trimAnim(list.filter((_a, i) => !gone.has(i)));
}

/** 跟 `duplicateSlides` 一樣：複本照順序接在最後一張選取的後面 */
export function animDuplicate(list: SlideAnim[], idx: number[], total: number): SlideAnim[] {
  const all = pad(list, total);
  const pick = [...new Set(idx)].filter((i) => i >= 0 && i < total).sort((a, b) => a - b);
  if (!pick.length) return trimAnim(list);
  all.splice(pick[pick.length - 1] + 1, 0, ...pick.map((i) => all[i]));
  return trimAnim(all);
}

/** 依投影片的新順序（`order[k]` 是原本的第幾張）重排 */
export function animReorder(list: SlideAnim[], order: number[]): SlideAnim[] {
  return trimAnim(order.map((i) => animAt(list, i)));
}

/** 簡報的內容與動畫，一起改（`SlideDeck` 的 `onEdit`） */
export interface Deck {
  content: string;
  anim: SlideAnim[];
}
