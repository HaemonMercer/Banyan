/**
 * 頁面摘要：清單、卡片上顯示的一小段純文字。
 * 去掉 Markdown 記號、HTML 標籤（版面容器、顏色）、圖片、程式碼區塊與 `&nbsp;` 空白區塊；
 * `[[頁面]]` 留下名稱、`[文字](網址)` 留下文字。開頭跟頁面同名的標題略過（卡片已經有標題）。
 */
export function excerpt(md: string, title = "", max = 220): string {
  const lines: string[] = [];
  let fence: string | null = null;
  let first = true;
  for (const raw of md.split("\n")) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(raw);
    if (f) {
      if (!fence) fence = f[1];
      else if (raw.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (fence) continue;
    let line = raw.trim();
    if (!line) continue;
    // 版面容器、整行 HTML 標籤
    if (/^<\/?[a-z][^>]*>$/i.test(line)) continue;
    // 參考連結定義
    if (/^\[[^\]]+\]:\s/.test(line)) continue;
    // 分隔線
    if (/^([-*_])(\s*\1){2,}$/.test(line)) continue;
    const heading = /^#{1,6}\s+/.test(line);
    line = line
      .replace(/^#{1,6}\s+/, "")
      .replace(/\s+#+\s*$/, "")
      .replace(/^>\s?/, "")
      .replace(/^(?:[-*+]|\d+[.)])\s+/, "")
      .replace(/^[{[][ xX<\-o]?[}\]]\s+/, "");
    if (first && heading && title && line.trim().toLowerCase() === title.trim().toLowerCase()) {
      first = false;
      continue;
    }
    first = false;
    line = line
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/(\*\*|__|\*|_|~~|`+)/g, "")
      .replace(/\\([!-/:-@[-`{-~])/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (line) lines.push(line);
    if (lines.join(" ").length > max) break;
  }
  const text = lines.join(" ");
  return text.length > max ? text.slice(0, max).trimEnd() + "…" : text;
}

/** 卡片預覽的一段：文字或圖片（圖片是原始碼裡的路徑，顯示時用 `mediaUrl` 轉換）。 */
export type PreviewPart = { kind: "text"; text: string } | { kind: "image"; src: string };

const MD_IMAGE = /!\[(?:[^\]\\]|\\.)*\]\((<[^>]*>|[^()\s]+)(?:\s+"(?:[^"\\]|\\.)*")?\)/;
const HTML_IMAGE = /<img\b[^>]*\bsrc="([^"]+)"/i;

/**
 * 卡片預覽（像 Heptabase 的卡片庫）：依原本的順序，文字摘要與第一張圖片。
 * 文字規則同 `excerpt`；圖片前後的文字分成兩段，只取第一張圖片。
 */
export function preview(md: string, title = "", max = 220): PreviewPart[] {
  const parts: PreviewPart[] = [];
  let buf: string[] = [];
  let image = false;
  let fence: string | null = null;
  const flush = () => {
    const text = excerpt(buf.join("\n"), parts.length ? "" : title, max);
    if (text) parts.push({ kind: "text", text });
    buf = [];
  };
  for (const raw of md.split("\n")) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(raw);
    if (f) {
      if (!fence) fence = f[1];
      else if (raw.trim().startsWith(fence)) fence = null;
      buf.push(raw);
      continue;
    }
    const m = !fence && !image ? (MD_IMAGE.exec(raw) ?? HTML_IMAGE.exec(raw)) : null;
    if (!m) {
      buf.push(raw);
      continue;
    }
    buf.push(raw.slice(0, m.index));
    flush();
    parts.push({ kind: "image", src: m[1].replace(/^<|>$/g, "") });
    image = true;
    buf.push(raw.slice(m.index + m[0].length));
  }
  flush();
  return parts;
}
