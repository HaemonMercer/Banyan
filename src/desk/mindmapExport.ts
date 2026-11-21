import { layoutMap, lineHeight, type MindMap, type TopicNode } from "./mindmap";

/**
 * 心智圖 → SVG（複製成圖片用）。位置、大小、顏色都來自 `layoutMap`，外觀照 `board.css` 的 `.mm-*`
 * （填色、圓角、連線粗細）；CSS 變數換成淺色主題的固定值，所以在深色模式複製出來也是白底。
 */

/** layoutMap 會用到的 CSS 變數（淺色主題的值） */
const LIGHT: Record<string, string> = {
  "--mm-root-bg": "#2f3437",
  "--mm-root-fg": "#ffffff",
  "--ed-text": "#2f2e2b",
  "--board-bg": "#ffffff",
  "--board-card": "#ffffff",
};
const TEXT = LIGHT["--ed-text"];
const CARD = LIGHT["--board-card"];
const FALLBACK_FONT = `"Segoe UI", -apple-system, "Microsoft JhengHei UI", "Microsoft JhengHei", sans-serif`;
const PAD = 20;
const BORDER = 1.5;

/** CSS 顏色裡的 var(--x) 換成固定值 */
export const solidColor = (c: string) => c.replace(/var\((--[\w-]+)\)/g, (_, k: string) => LIGHT[k] ?? TEXT);

/** #rrggbb 和白色混合（color-mix 的 p%） */
function mixWhite(hex: string, p: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return CARD;
  const n = parseInt(m[1], 16);
  const ch = (v: number) => Math.round(v * p + 255 * (1 - p)).toString(16).padStart(2, "0");
  return `#${ch(n >> 16)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function radius(n: TopicNode): number {
  if (n.shape === "pill") return n.h / 2;
  if (n.shape === "rect") return 2;
  if (n.shape === "rounded") return n.depth === 0 ? 10 : 8;
  return 4;
}

function topicSvg(n: TopicNode, text: string, left: boolean, font: string): string {
  const c = solidColor(n.color);
  let box = "";
  let color = TEXT;
  if (n.fill !== "none") {
    const fill = n.fill === "solid" ? c : n.fill === "soft" ? mixWhite(c, 0.16) : CARD;
    const stroke = n.fill === "soft" ? ` stroke-opacity="0.45"` : "";
    const r = Math.min(radius(n), (n.h - BORDER) / 2);
    box =
      `<rect x="${n.x + BORDER / 2}" y="${n.y + BORDER / 2}" width="${n.w - BORDER}" height="${n.h - BORDER}" rx="${r}" ` +
      `fill="${fill}" stroke="${c}" stroke-width="${BORDER}"${stroke}/>`;
    if (n.fill === "solid") color = solidColor(n.on);
  }
  const s = n.style;
  const lines = (text || "").split("\n");
  const lh = lineHeight(s.font);
  const top = n.y + n.h / 2 - (lines.length * lh) / 2;
  const x = left ? n.x + BORDER + s.padX : n.x + n.w / 2;
  const spans = lines.map((l, i) => `<tspan x="${x}" y="${(top + lh * i + lh / 2).toFixed(2)}">${esc(l) || " "}</tspan>`).join("");
  const label =
    `<text font-family="${esc(font)}" font-size="${s.font}" font-weight="${s.weight}" fill="${color}" ` +
    `text-anchor="${left ? "start" : "middle"}" dominant-baseline="central" xml:space="preserve">${spans}</text>`;
  return box + label;
}

/** 收起的主題旁邊的數字（藏了幾個） */
function foldSvg(n: TopicNode, font: string): string {
  const c = solidColor(n.color);
  const label = String(n.hidden);
  const w = Math.max(16, label.length * 6 + 9);
  return (
    `<rect x="${n.fold.x - w / 2}" y="${n.fold.y - 8}" width="${w}" height="16" rx="8" fill="#ffffff" stroke="${c}" stroke-width="${BORDER}"/>` +
    `<text x="${n.fold.x}" y="${n.fold.y}" font-family="${esc(font)}" font-size="10" font-weight="700" fill="${c}" text-anchor="middle" dominant-baseline="central">${label}</text>`
  );
}

/** 整張心智圖的 SVG（白底、四周留 20px） */
export function mapSvg(m: MindMap): { svg: string; w: number; h: number } {
  const L = layoutMap(m);
  const texts = new Map<string, string>();
  const walk = (t: MindMap["root"]) => {
    texts.set(t.id, t.text);
    t.children.forEach(walk);
  };
  walk(m.root);
  // 和量字寬（`measureText`）用同一個字型
  const font = (typeof document !== "undefined" && document.body && getComputedStyle(document.body).fontFamily) || FALLBACK_FONT;
  const b = L.bounds;
  const x0 = Math.floor(b.x - PAD);
  const y0 = Math.floor(b.y - PAD);
  const w = Math.ceil(b.w + PAD * 2);
  const h = Math.ceil(b.h + PAD * 2);
  let body = "";
  for (const l of L.links) {
    body += `<path d="${l.d}" fill="none" stroke="${solidColor(l.color)}" stroke-width="${l.depth === 1 ? 2.6 : 1.6}" stroke-linecap="round"/>`;
  }
  for (const id of L.order) {
    const n = L.nodes.get(id)!;
    if (n.shape === "underline") {
      const y = n.y + n.h;
      body += `<path d="M ${n.x} ${y} L ${n.x + n.w} ${y}" fill="none" stroke="${solidColor(n.color)}" stroke-width="1.6" stroke-linecap="round"/>`;
    }
  }
  for (const id of L.order) {
    const n = L.nodes.get(id)!;
    // 子主題靠左（組織圖置中），和畫面上一樣
    body += topicSvg(n, texts.get(id) ?? "", n.depth >= 2 && L.structure !== "org", font);
    if (n.hidden && n.depth > 0) body += foldSvg(n, font);
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x0} ${y0} ${w} ${h}">` +
    `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="#ffffff"/>${body}</svg>`;
  return { svg, w, h };
}
