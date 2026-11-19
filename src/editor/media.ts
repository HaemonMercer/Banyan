import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";

/**
 * 媒體檔案（圖片、GIF、影片）。
 *
 * 在 App 裡：檔案複製到 App 資料夾的 media/（Rust 指令 save_media、import_media），
 * Markdown 寫相對路徑 `media/檔名`，顯示時換成 asset protocol 的網址。
 * 只有前端（瀏覽器預覽）時：沒有地方存檔，改用 data URL 直接寫進 Markdown。
 *
 * 寫法都是 CommonMark：
 *   圖片、GIF：![說明](media/xxx.png)
 *   影片：HTML 區塊（CommonMark 沒有影片語法）
 *     <video src="media/xxx.mp4" controls>
 *     </video>
 */

export type MediaKind = "image" | "video";

let base: string | null = null;

/** App 啟動時取得 media 資料夾位置（之後顯示圖片才能換成網址）。 */
export async function initMedia(): Promise<void> {
  if (!isTauri()) return;
  try {
    base = await invoke<string>("media_dir");
  } catch {
    base = null;
  }
}

const IMAGE_EXT = /^(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i;
const VIDEO_EXT = /^(mp4|webm|ogv|mov|m4v)$/i;

/** 依檔名或 MIME 類型判斷是圖片還是影片。 */
export function kindOf(name: string, type = ""): MediaKind | null {
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  const ext = name.split(".").pop() ?? "";
  if (IMAGE_EXT.test(ext)) return "image";
  if (VIDEO_EXT.test(ext)) return "video";
  return null;
}

function extOf(file: File): string {
  const fromName = file.name.includes(".") ? file.name.split(".").pop()! : "";
  if (fromName) return fromName;
  const sub = file.type.split("/")[1] ?? "bin";
  return sub === "jpeg" ? "jpg" : sub.replace(/\W.*$/, "");
}

function dataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** 存一個檔案（貼上、選擇檔案），回傳 Markdown 裡要寫的位置。 */
export async function saveMedia(file: File): Promise<string> {
  if (!isTauri()) return dataUrl(file);
  const buf = await file.arrayBuffer();
  return invoke<string>("save_media", buf, { headers: { "x-ext": extOf(file) } });
}

/** 複製磁碟上的檔案（從檔案總管拖進來的），回傳 Markdown 裡要寫的位置。 */
export async function importMediaPath(path: string): Promise<string> {
  return invoke<string>("import_media", { path });
}

/** `media/檔名` 換成可以顯示的網址；其他（http、data URL）原樣。 */
export function mediaUrl(src: string): string {
  const m = /^media\/([\w.-]+)$/.exec(src);
  if (!m || !base) return src;
  const sep = base.includes("\\") ? "\\" : "/";
  return convertFileSrc(base + sep + m[1]);
}

/** `media/檔名` 在磁碟上的完整路徑（在檔案總管顯示用）；不是 App 裡的媒體檔就是 null。 */
export function mediaFilePath(src: string): string | null {
  const m = /^media\/([\w.-]+)$/.exec(src);
  if (!m || !base) return null;
  const sep = base.includes("\\") ? "\\" : "/";
  return base + sep + m[1];
}

/** 渲染後的 HTML 裡，把 `media/…` 的 src 換成可以顯示的網址（原本的路徑留在 data-src，轉回 Markdown 時用）。 */
export function resolveMedia(html: string): string {
  if (!base || !html.includes("media/")) return html;
  return html.replace(
    /\b(src|poster)="(media\/[\w.-]+)"/g,
    (_, attr: string, src: string) => `${attr}="${mediaUrl(src)}" data-${attr}="${src}"`,
  );
}

/** 顯示用的 HTML 清理設定：允許影片，允許 Tauri 的 asset 網址。 */
export const PURIFY = {
  ADD_TAGS: ["video", "source"],
  ADD_ATTR: ["controls", "preload", "playsinline", "loop", "muted", "poster"],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|asset|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
};

const escapeAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAlt = (s: string) => s.replace(/[\\[\]]/g, "\\$&");

/** 插入媒體時的 Markdown（圖片是一個只有圖片的段落，影片是 HTML 區塊）。 */
export function mediaMarkdown(src: string, kind: MediaKind, alt = ""): string {
  if (kind === "video") return `<video src="${escapeAttr(src)}" controls>\n</video>`;
  const dest = /[\s()<>]/.test(src) ? `<${src}>` : src;
  return `![${escapeAlt(alt)}](${dest})`;
}

/** 區塊是不是只有一張圖片或一段影片（點了選取，不進入文字編輯）。 */
export function isMediaBlock(text: string): MediaKind | null {
  const t = text.trim();
  if (/^!\[(?:[^\]\\]|\\.)*\]\((?:[^()\s]+|<[^>]*>)(?:\s+"[^"]*")?\)$/.test(t)) return "image";
  if (/^<video\b[^>]*>\s*<\/video>$/i.test(t)) return "video";
  return null;
}

// ─── 圖說（標題） ───────────────────────────────────────────────
//
// CommonMark 沒有圖說語法，用圖片本身的標題：![說明](media/x.png "圖說")，
// 影片用 title 屬性。編輯器把它顯示在圖片、影片下方；其他軟體會顯示成滑鼠提示。

const IMAGE_BLOCK = /^!\[((?:[^\]\\]|\\.)*)\]\(((?:[^()\s]+|<[^>]*>))(?:\s+"((?:[^"\\]|\\.)*)")?\)$/;
const VIDEO_OPEN = /^(<video\b)([^>]*)(>)/i;

const unescapeMd = (s: string) => s.replace(/\\(.)/g, "$1");
const unescapeHtml = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** 媒體區塊的圖說（沒有就是空字串）；不是媒體區塊時回傳 null。 */
export function mediaCaption(text: string): string | null {
  const t = text.trim();
  const img = IMAGE_BLOCK.exec(t);
  if (img) return img[3] !== undefined ? unescapeMd(img[3]) : "";
  if (isMediaBlock(t) === "video") {
    const m = /\btitle="([^"]*)"/i.exec(t);
    return m ? unescapeHtml(m[1]) : "";
  }
  return null;
}

/** 設定媒體區塊的圖說（空字串表示拿掉）；不是媒體區塊時原樣回傳。 */
export function setMediaCaption(text: string, caption: string): string {
  const cap = caption.replace(/\s*\n\s*/g, " ").trim();
  const t = text.trim();
  const img = IMAGE_BLOCK.exec(t);
  if (img) {
    const title = cap ? ` "${cap.replace(/[\\"]/g, "\\$&")}"` : "";
    return `![${img[1]}](${img[2]}${title})`;
  }
  if (isMediaBlock(t) === "video") {
    return t.replace(VIDEO_OPEN, (_, open: string, attrs: string, close: string) => {
      const rest = attrs.replace(/\s+title="[^"]*"/i, "");
      return open + rest + (cap ? ` title="${escapeAttr(cap)}"` : "") + close;
    });
  }
  return text;
}
