import { mediaMarkdown } from "../editor/media";
import { MEDIA_MIN, MEDIA_W, type MediaType } from "./board";

/**
 * 白板上的媒體卡片（圖片、GIF、影片、嵌入影片）的純函式：
 * 貼上的網址是哪一種媒體、YouTube／Vimeo 的嵌入網址、卡片大小、送到 Dock 時的 Markdown。
 * 存檔（`media/`）與顯示（asset protocol）沿用編輯器的 `src/editor/media.ts`。
 */

const IMAGE_URL = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;
const VIDEO_URL = /\.(mp4|webm|ogv|mov|m4v)$/i;

function parseUrl(text: string): URL | null {
  const t = text.trim();
  if (!/^https?:\/\/\S+$/i.test(t)) return null;
  try {
    return new URL(t);
  } catch {
    return null;
  }
}

/** YouTube 的影片代號（watch?v=、youtu.be/、shorts/、embed/、live/）；不是 YouTube 就是 null。 */
function youtubeId(u: URL): string | null {
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, "");
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else {
      const m = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(u.pathname);
      id = m ? m[1] : null;
    }
  }
  return id && /^[\w-]{6,}$/.test(id) ? id : null;
}

/** YouTube 的開始時間（t=90、t=1m30s、start=90）→ 秒 */
function youtubeStart(u: URL): number {
  const t = u.searchParams.get("t") ?? u.searchParams.get("start");
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

/** Vimeo 的影片代號（vimeo.com/123、player.vimeo.com/video/123） */
function vimeoId(u: URL): string | null {
  const host = u.hostname.replace(/^www\./, "");
  if (host === "vimeo.com") {
    const m = /^\/(?:.*\/)?(\d+)(?:\/|$)/.exec(u.pathname);
    return m ? m[1] : null;
  }
  if (host === "player.vimeo.com") {
    const m = /^\/video\/(\d+)/.exec(u.pathname);
    return m ? m[1] : null;
  }
  return null;
}

/** YouTube、Vimeo 網址 → 可以放進 iframe 的嵌入網址；其他是 null。 */
export function embedUrl(url: string): string | null {
  const u = parseUrl(url);
  if (!u) return null;
  const yt = youtubeId(u);
  if (yt) {
    const start = youtubeStart(u);
    return `https://www.youtube.com/embed/${yt}${start ? `?start=${start}` : ""}`;
  }
  const vm = vimeoId(u);
  if (vm) return `https://player.vimeo.com/video/${vm}`;
  return null;
}

/**
 * 貼上的文字是不是一個媒體網址（整段只有一個網址）：YouTube／Vimeo 是嵌入，
 * 結尾是影片副檔名是影片，圖片副檔名是圖片；其他（一般網頁）是 null。
 */
export function mediaFromUrl(text: string): { src: string; type: MediaType } | null {
  const u = parseUrl(text);
  if (!u) return null;
  const src = text.trim();
  if (embedUrl(src)) return { src, type: "embed" };
  if (VIDEO_URL.test(u.pathname)) return { src, type: "video" };
  if (IMAGE_URL.test(u.pathname)) return { src, type: "image" };
  return null;
}

/**
 * 卡片大小：照原始比例，長邊不超過 max（小圖保持原大），短邊不小於 MEDIA_MIN。
 * 不知道原始大小（0）時用 16:9。
 */
export function fitMediaSize(nw: number, nh: number, max = MEDIA_W): { w: number; h: number } {
  if (!(nw > 0 && nh > 0)) return { w: max, h: Math.round((max * 9) / 16) };
  const k = Math.min(1, max / Math.max(nw, nh));
  return { w: Math.max(MEDIA_MIN, Math.round(nw * k)), h: Math.max(MEDIA_MIN, Math.round(nh * k)) };
}

/**
 * 照比例改大小：拖右下角時，寬高取變化比較大的那一邊，另一邊跟著比例。
 * ratio＝高÷寬。
 */
export function resizeKeepRatio(w: number, h: number, ratio: number): { w: number; h: number } {
  if (!(ratio > 0)) return { w: Math.max(MEDIA_MIN, w), h: Math.max(MEDIA_MIN, h) };
  // 以寬為準與以高為準，取比較大的（游標拉到哪裡，卡片至少蓋到那裡）
  const byW = { w, h: w * ratio };
  const byH = { w: h / ratio, h };
  const r = byW.h >= h ? byW : byH;
  const min = Math.max(MEDIA_MIN / r.w, MEDIA_MIN / r.h, 1);
  return { w: Math.round(r.w * min), h: Math.round(r.h * min) };
}

/** 送到 Dock 時的 Markdown：圖片 `![](…)`、影片 HTML 區塊、嵌入影片是網址（自動連結）。 */
export function mediaCardMarkdown(ref: { src: string; type: MediaType }): string {
  if (ref.type === "embed") return `<${ref.src}>`;
  return mediaMarkdown(ref.src, ref.type);
}
