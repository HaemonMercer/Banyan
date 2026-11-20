/**
 * 插入圖片的對話框（參考 Google 文件／雲端硬碟的「插入圖片」）用的資料與登記處。
 *
 * Drawer 的圖片本來就存在 `media/`（檔案庫的檔案、條目的附件），插入只是在文件裡寫同一個
 * `media/檔名`，不複製檔案；之後在 Drawer 改名、搬動、刪掉紀錄都不影響已經插入的圖。
 *
 * App 載入文獻庫後呼叫 `setDrawerLibrary`，並用 `setImagePicker` 登記對話框（`ImagePicker.tsx`）；
 * 編輯器、Word、簡報呼叫 `pickImages()`。編輯器只 import 這裡，不載入 Drawer 或 Desk 的其他模組。
 */
import { emptyLibrary, type Library } from "./model";
import { fingerprint, fileLocation } from "./files";

export interface DrawerImage {
  /** 檔案庫 `F:檔案id`，附件 `A:條目id:附件id` */
  id: string;
  /** 顯示名稱（含副檔名） */
  name: string;
  /** `media/檔名` 或 data URL（瀏覽器預覽） */
  src: string;
  /** 在 Drawer 的哪裡：`My Files › 研究`、`Attached to “標題”` */
  where: string;
  added: number;
}

/** 對話框的分頁：最近、My Files（資料夾）、附件、上傳、網址 */
export type ImageTab = "recent" | "files" | "attachments" | "upload" | "url";

/** 選好要插入的圖片 */
export interface PickedImage {
  src: string;
  alt: string;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i;

/** 是不是圖片（看名稱的副檔名；data URL 看 MIME） */
export const isImageFile = (name: string, src: string) => IMAGE_EXT.test(name) || IMAGE_EXT.test(src) || src.startsWith("data:image/");

const newest = (a: DrawerImage, b: DrawerImage) => b.added - a.added;

/** 檔案庫的圖片（垃圾桶的不算）；folder 給了就只看直接放在那個資料夾的（null 是沒有資料夾的），新加的在前面 */
export function fileImages(lib: Library, folder?: string | null): DrawerImage[] {
  return lib.files
    .filter((f) => !f.trashed && (folder === undefined || (folder === null ? !f.folders.length : f.folders.includes(folder))) && isImageFile(f.name, f.src))
    .map((f) => ({ id: `F:${f.id}`, name: f.name, src: f.src, where: fileLocation(lib, f), added: f.added }))
    .sort(newest);
}

/** 條目附件裡的圖片（垃圾桶裡的條目不算），新加的在前面 */
export function attachmentImages(lib: Library): DrawerImage[] {
  const out: DrawerImage[] = [];
  for (const it of lib.items) {
    if (it.trashed) continue;
    for (const a of it.attachments)
      if (a.kind === "file" && isImageFile(a.name, a.src))
        out.push({ id: `A:${it.id}:${a.id}`, name: a.name, src: a.src, where: `Attached to “${it.title || "Untitled"}”`, added: a.added });
  }
  return out.sort(newest);
}

/** 文獻庫裡所有的圖片（檔案庫＋附件），同樣內容只留一個，新加的在前面 */
export function drawerImages(lib: Library): DrawerImage[] {
  const seen = new Set<string>();
  return [...fileImages(lib), ...attachmentImages(lib)].sort(newest).filter((img) => {
    const k = fingerprint(img.src);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 依名稱或位置搜尋（不分大小寫，空白分開的每個詞都要有） */
export function searchImages(list: DrawerImage[], query: string): DrawerImage[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((img) => {
    const hay = `${img.name} ${img.where}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** 插入圖片時的替代文字：檔名去掉副檔名 */
export const imageAlt = (img: Pick<DrawerImage, "name">) => img.name.replace(/\.[^.]+$/, "");

/** 網址的圖片：看起來像 http(s) 網址才接受；替代文字是網址最後一段的檔名 */
export function urlImage(raw: string): PickedImage | null {
  const s = raw.trim();
  if (!/^https?:\/\/\S+$/i.test(s)) return null;
  let last = "";
  try {
    last = decodeURIComponent(new URL(s).pathname.split("/").filter(Boolean).pop() ?? "");
  } catch {
    return null;
  }
  return { src: s, alt: last.replace(/\.[^.]+$/, "") };
}

/* ─── 登記處 ─── */

let library: Library = emptyLibrary();
export interface PickOptions {
  /** 一開始的分頁（預設 recent） */
  tab?: ImageTab;
  /** 可以一次選好幾張（預設可以） */
  multiple?: boolean;
}
let picker: ((opts: PickOptions) => Promise<PickedImage[]>) | null = null;

export function setDrawerLibrary(lib: Library): void {
  library = lib;
}

export const getDrawerLibrary = () => library;

/** App 登記對話框（選好回傳圖片，取消回傳空陣列） */
export function setImagePicker(fn: typeof picker): void {
  picker = fn;
}

/** 打開「插入圖片」對話框；沒有登記（測試）就是空陣列。 */
export function pickImages(opts: PickOptions = {}): Promise<PickedImage[]> {
  return picker ? picker(opts) : Promise.resolve([]);
}
