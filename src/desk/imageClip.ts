/**
 * 把 SVG 畫成 PNG、複製到剪貼簿（Draw、心智圖的「Copy as image」共用）。
 * 匯出的 SVG 一律是淺色的固定顏色，貼到 Word、聊天軟體都一樣。
 */

/** SVG 字串 → PNG（scale 倍解析度） */
export async function svgToPng(svg: string, w: number, h: number, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((ok, bad) => {
      img.onload = () => ok();
      img.onerror = () => bad(new Error("Couldn't draw the image"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const c = canvas.getContext("2d");
    if (!c) throw new Error("Canvas isn't available");
    c.scale(scale, scale);
    c.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
    if (!blob) throw new Error("Couldn't make the PNG");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 複製 PNG 到剪貼簿。要在使用者操作（點選單、按鍵）當下呼叫：ClipboardItem 直接拿 Promise，
 * 圖還在畫的時候就先登記，才不會因為等太久失去使用者操作的權限。
 */
export async function copyPng(make: () => Promise<Blob>): Promise<void> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) throw new Error("Copying images isn't supported here");
  await navigator.clipboard.write([new ClipboardItem({ "image/png": make() })]);
}
