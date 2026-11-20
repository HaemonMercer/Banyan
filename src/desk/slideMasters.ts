/**
 * 投影片母片（參考 Keynote 的投影片版面配置、PowerPoint 的投影片母片）：
 * 一份簡報可以有好幾個母片，每個母片有
 * - 背景色 `bg`（投影片自己選過背景就照投影片的）；
 * - 每張都有的物件 `boxes`（標誌、色帶、裝飾文字…；畫在投影片內容後面，投影片上不能選）；
 * - 主文字方塊的位置 `main`（投影片自己搬過就照投影片的）；
 * - `noFoot`：這個版面不顯示頁碼與頁尾。
 *
 * 母片存在 `DeckSetup.masters`（`deckSetup.ts`），投影片用 `SlideAnim.master` 記住用哪一個；
 * 沒有設定（或指到刪掉的母片）就用第一個——第一個是預設母片。這裡都是純函式。
 */

import { cleanBoxes, cleanFrame, MAIN_FRAME, newBoxId, sameFrame, type Frame, type SlideBox } from "./slideBoxes";
import type { SlideAnim } from "./slideAnim";

export interface SlideMaster {
  id: string;
  name: string;
  bg?: string;
  boxes?: SlideBox[];
  main?: Frame;
  noFoot?: true;
}

/** 編輯母片時主文字方塊顯示的範例文字（不能編輯，只看得出字的樣子與位置） */
export const PLACEHOLDER_MD = "## Slide title\n\n- Body text\n- Second point\n- Third point";

let seq = 0;
export const newMasterId = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

/** 存檔讀回來：不認得的丟掉，代號重複的換新的 */
export function cleanMasters(raw: unknown): SlideMaster[] {
  if (!Array.isArray(raw)) return [];
  const used = new Set<string>();
  const out: SlideMaster[] = [];
  for (const o of raw) {
    if (!o || typeof o !== "object") continue;
    const r = o as Record<string, unknown>;
    let id = typeof r.id === "string" && r.id ? r.id : newMasterId();
    if (used.has(id)) id = newMasterId();
    used.add(id);
    const m: SlideMaster = { id, name: typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 80) : "Master" };
    if (typeof r.bg === "string" && /^#[0-9a-f]{6}$/i.test(r.bg)) m.bg = r.bg;
    const boxes = cleanBoxes(r.boxes);
    if (boxes.length) m.boxes = boxes;
    const main = cleanFrame(r.main);
    if (main) m.main = main;
    if (r.noFoot === true) m.noFoot = true;
    out.push(m);
  }
  return out;
}

/** 這張投影片用的母片：指定的，找不到就是第一個（預設）；沒有母片是 undefined */
export function masterOf(masters: SlideMaster[] | undefined, meta: SlideAnim | undefined): SlideMaster | undefined {
  if (!masters?.length) return undefined;
  return masters.find((m) => m.id === meta?.master) ?? masters[0];
}

/** 主文字方塊沒搬過時的位置：母片的，沒有母片是預設版面 */
export const baseFrame = (master: SlideMaster | null | undefined): Frame => master?.main ?? MAIN_FRAME;

/** 有幾張投影片用這個母片（沒指定、指到不存在的算第一個的） */
export function masterUsage(masters: SlideMaster[], anim: SlideAnim[], count: number, id: string): number {
  let n = 0;
  for (let i = 0; i < count; i++) if (masterOf(masters, anim[i])?.id === id) n++;
  return n;
}

/** 新母片的起點（New Master 選單） */
export type MasterPreset = "blank" | "header" | "side" | "band" | "frame";

export const MASTER_PRESETS: { id: MasterPreset; label: string }[] = [
  { id: "blank", label: "Blank" },
  { id: "header", label: "Header Bar" },
  { id: "side", label: "Side Panel" },
  { id: "band", label: "Bottom Band" },
  { id: "frame", label: "Framed" },
];

const shape = (f: Frame, p: Partial<SlideBox>): SlideBox => ({ id: newBoxId(), kind: "shape", shape: "rect", fill: "blue", line: null, ...f, ...p });

/** 照範本做一個新母片 */
export function presetMaster(preset: MasterPreset, name: string): SlideMaster {
  const m: SlideMaster = { id: newMasterId(), name };
  if (preset === "header") {
    m.boxes = [shape({ x: 0, y: 0, w: 960, h: 18 }, {})];
    m.main = { x: 72, y: 64, w: 816, h: 420 };
  } else if (preset === "side") {
    m.boxes = [shape({ x: 0, y: 0, w: 220, h: 540 }, { fill: "gray" })];
    m.main = { x: 264, y: 56, w: 640, h: 428 };
  } else if (preset === "band") {
    m.boxes = [shape({ x: 0, y: 500, w: 960, h: 40 }, {})];
    m.main = { x: 72, y: 48, w: 816, h: 420 };
    m.noFoot = true;
  } else if (preset === "frame") {
    m.boxes = [shape({ x: 24, y: 24, w: 912, h: 492 }, { fill: null, line: "gray" })];
    m.main = { x: 80, y: 64, w: 800, h: 412 };
  }
  return m;
}

/** 名稱不重複：`Master`、`Master 2`… */
export function uniqueName(masters: SlideMaster[], base: string): string {
  const names = new Set(masters.map((m) => m.name.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!names.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

/** 加在 after 這個母片後面（沒有就是最後） */
export function insertMaster(masters: SlideMaster[], m: SlideMaster, after?: string): SlideMaster[] {
  const at = after ? masters.findIndex((x) => x.id === after) : -1;
  if (at < 0) return [...masters, m];
  return [...masters.slice(0, at + 1), m, ...masters.slice(at + 1)];
}

/** 複製一個母片（物件換新代號），接在它後面；回傳新的清單與複本 */
export function duplicateMaster(masters: SlideMaster[], id: string): { masters: SlideMaster[]; copy: SlideMaster | null } {
  const src = masters.find((m) => m.id === id);
  if (!src) return { masters, copy: null };
  const copy: SlideMaster = structuredClone(src);
  copy.id = newMasterId();
  copy.name = uniqueName(masters, `${src.name} copy`);
  if (copy.boxes) copy.boxes = copy.boxes.map((b) => ({ ...b, id: newBoxId() }));
  return { masters: insertMaster(masters, copy, id), copy };
}

export const removeMaster = (masters: SlideMaster[], id: string) => masters.filter((m) => m.id !== id);

export function updateMaster(masters: SlideMaster[], id: string, fn: (m: SlideMaster) => SlideMaster): SlideMaster[] {
  return masters.map((m) => (m.id === id ? tidy(fn(m)) : m));
}

/** 搬到最前面＝設成預設母片 */
export function makeDefault(masters: SlideMaster[], id: string): SlideMaster[] {
  const m = masters.find((x) => x.id === id);
  return m ? [m, ...masters.filter((x) => x.id !== id)] : masters;
}

/** 依新順序（拖曳）：把 id 搬到 before 這個位置之前 */
export function moveMaster(masters: SlideMaster[], id: string, before: number): SlideMaster[] {
  const from = masters.findIndex((m) => m.id === id);
  if (from < 0) return masters;
  const out = masters.filter((m) => m.id !== id);
  const at = Math.max(0, Math.min(before > from ? before - 1 : before, out.length));
  out.splice(at, 0, masters[from]);
  return out;
}

/** 拿掉空的欄位（存檔不用寫） */
function tidy(m: SlideMaster): SlideMaster {
  const out: SlideMaster = { id: m.id, name: m.name.trim() || "Master" };
  if (m.bg) out.bg = m.bg;
  if (m.boxes?.length) out.boxes = m.boxes;
  if (m.main && !sameFrame(m.main, MAIN_FRAME)) out.main = m.main;
  if (m.noFoot) out.noFoot = true;
  return out;
}

/** 編輯母片時借用投影片的畫布：母片 → 投影片設定 */
export function masterAsMeta(m: SlideMaster): SlideAnim {
  const a: SlideAnim = { transition: "none", build: "none" };
  if (m.boxes?.length) a.boxes = m.boxes;
  if (m.main) a.main = m.main;
  if (m.bg) a.bg = m.bg;
  return a;
}

/** 畫布改好的投影片設定寫回母片（只拿物件、主文字方塊的位置、背景） */
export function metaIntoMaster(m: SlideMaster, a: SlideAnim): SlideMaster {
  const out: SlideMaster = { ...m, boxes: a.boxes, main: a.main, bg: a.bg };
  return tidy(out);
}
