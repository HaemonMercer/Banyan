const TYPES = new Map([
    ["png", "image/png"], ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"],
    ["gif", "image/gif"], ["webp", "image/webp"], ["bmp", "image/bmp"], ["avif", "image/avif"],
]);

export const DESK_IMAGE_ACCEPT = [...TYPES.keys()].map((extension) => "." + extension).join(",");
export const DESK_IMAGE_LIMIT = 10 * 1024 * 1024;
export const isDeskImage = (name: string) => TYPES.has(name.split(".").pop()?.toLowerCase() ?? "");

export async function embedDeskImage(file: File) {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const type = TYPES.get(extension);
    if (!type) throw new Error("請選擇 PNG、JPEG、GIF、WebP、BMP 或 AVIF 圖片。");
    if (file.size === 0 || file.size > DESK_IMAGE_LIMIT) throw new Error("圖片必須小於或等於 10 MB，且不能是空檔案。");
    const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reader.onabort = () => reject(new Error("無法讀取圖片。"));
        reader.readAsDataURL(file.slice(0, file.size, type));
    });
    const image = new Image();
    image.src = data;
    await image.decode().catch(() => { throw new Error("無法解碼圖片，請確認檔案格式。"); });
    const label = file.name.replace(/\.[^.]+$/, "").replace(/[\r\n]/g, " ").replace(/[\\\[\]]/g, "\\$&");
    return `![${label}](${data})`;
}
