// Generates the icon preview sheet (Design/Icons.html) and the app icon source (src-tauri/icons/app-icon.svg).
// Run: node scripts/build-icons.ts   (Node 22.6+ strips the TypeScript types)
import fs from "node:fs";
import path from "node:path";
import { ICONS, ICON_GROUPS, LOGO, TYPE_ICONS } from "../src/icons/icons.ts";

const root = path.resolve(import.meta.dirname, "..");

const svg = (markup: string, size = 24, extra = "") =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"${extra}>${markup}</svg>`;

// ---------- app icon: white mark on a green rounded square ----------
const appIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a8c63"/>
      <stop offset="1" stop-color="#245f42"/>
    </linearGradient>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#bg)"/>
  <rect x="64" y="64" width="896" height="896" rx="200" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="4"/>
  <g transform="translate(176 184) scale(28)" color="#ffffff">
    ${LOGO}
  </g>
</svg>
`;
fs.writeFileSync(path.join(root, "src-tauri/icons/app-icon.svg"), appIcon);
// Favicon for the dev page uses the same artwork.
fs.writeFileSync(path.join(root, "public/banyan.svg"), appIcon);

// ---------- preview sheet ----------
const LABELS: Record<string, string> = {
    drawer: "Drawer", whiteboard: "Whiteboard", graph: "Graph", cardHub: "Card Hub", writer: "Writer", slides: "Slides",
    publisher: "Publisher", draw: "Draw", layout: "Layout", base: "Base", versions: "Version Machine",
    journalArticle: "期刊論文", book: "書籍", bookSection: "書籍章節", magazineArticle: "雜誌文章", conferencePaper: "會議論文",
    thesis: "學位論文", report: "報告", music: "音樂", cd: "CD", dvd: "DVD / 藍光", film: "電影", tvEpisode: "電視節目",
    podcast: "Podcast", video: "線上影片", concert: "演唱會", theater: "戲劇", musical: "音樂劇", opera: "歌劇", dance: "舞蹈",
    comedy: "喜劇", festival: "音樂節", talk: "演講", painting: "繪畫", artwork: "藝術品", photo: "照片", map: "地圖",
    webpage: "網頁", software: "軟體", document: "文件",
};
const GROUP_OF: Record<string, string> = {};
for (const [g, ids] of Object.entries({
    literature: ["journalArticle", "book", "bookSection", "magazineArticle", "conferencePaper", "thesis", "report"],
    media: ["music", "cd", "dvd", "film", "tvEpisode", "podcast", "video"],
    performance: ["concert", "theater", "musical", "opera", "dance", "comedy", "festival", "talk"],
    art: ["painting", "artwork", "photo", "map"],
    other: ["webpage", "software", "document"],
})) for (const id of ids) GROUP_OF[id] = g;

const cell = (name: string, markup: string, cls = "") =>
    `<figure class="cell ${cls}"><div class="glyph">${svg(markup, 24)}</div><div class="glyph sm">${svg(markup, 16)}</div><figcaption>${LABELS[name] ?? name}<code>${name}</code></figcaption></figure>`;

const html = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Banyan Icons</title>
<style>
:root{--bg:#f6f5f1;--pane:#fff;--border:#e3e1da;--text:#26251f;--muted:#8a877f;--accent:#2f7a55;
--type-literature:#3a6ea5;--type-media:#7a52a8;--type-performance:#c0612b;--type-art:#b5446e;--type-other:#6b6962}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#1a1a19;--pane:#232322;--border:#363533;--text:#e8e6e1;--muted:#8f8c85;--accent:#6bbd92;
--type-literature:#7ea9dc;--type-media:#b39ae0;--type-performance:#e8975f;--type-art:#e58aae;--type-other:#a8a59e}}
:root[data-theme=dark]{--bg:#1a1a19;--pane:#232322;--border:#363533;--text:#e8e6e1;--muted:#8f8c85;--accent:#6bbd92;
--type-literature:#7ea9dc;--type-media:#b39ae0;--type-performance:#e8975f;--type-art:#e58aae;--type-other:#a8a59e}
*{box-sizing:border-box}body{margin:0;padding:32px 16px 64px;background:var(--bg);color:var(--text);font:13px/1.4 "Segoe UI","Microsoft JhengHei",system-ui,sans-serif}
main{max-width:1080px;margin:0 auto}h1{font-size:22px;margin:0 0 4px;display:flex;align-items:center;gap:10px}
h2{font-size:12px;letter-spacing:.06em;color:var(--muted);margin:32px 0 10px;font-weight:600}
p{color:var(--muted);margin:0 0 8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px}
.cell{margin:0;background:var(--pane);border:1px solid var(--border);border-radius:8px;padding:14px 8px 10px;display:flex;flex-direction:column;align-items:center;gap:8px}
.glyph{display:flex;gap:10px;align-items:center;color:var(--text)}.glyph.sm{color:var(--muted)}
.cell.literature .glyph{color:var(--type-literature)}.cell.media .glyph{color:var(--type-media)}.cell.performance .glyph{color:var(--type-performance)}
.cell.art .glyph{color:var(--type-art)}.cell.other .glyph{color:var(--type-other)}
figcaption{text-align:center;font-size:12px}figcaption code{display:block;color:var(--muted);font:11px "Cascadia Code",Consolas,monospace;margin-top:2px}
.logo{display:flex;gap:24px;align-items:center;flex-wrap:wrap}.logo img{border-radius:22%}
.mark{width:40px;height:40px;border-radius:10px;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center}
button{position:fixed;top:16px;right:16px;border:1px solid var(--border);background:var(--pane);border-radius:6px;padding:4px 10px;cursor:pointer;color:var(--text)}
</style></head><body><main>
<button onclick="const r=document.documentElement;r.dataset.theme=r.dataset.theme==='dark'?'light':'dark'">淺色／深色</button>
<h1><span class="mark">${svg(LOGO, 26)}</span>Banyan 圖示</h1>
<p>24 × 24 網格、1.75px 線條、圓角端點，以文字顏色繪製。原始碼：<code>src/icons/icons.ts</code>；本頁由 <code>node scripts/build-icons.ts</code> 產生。</p>
<h2>App 圖示</h2>
<div class="logo">${[128, 64, 32].map((s) => `<img src="../src-tauri/icons/app-icon.svg" width="${s}" height="${s}" alt="">`).join("")}</div>
<h2>模組（${ICON_GROUPS.module.length}）</h2><div class="grid">${ICON_GROUPS.module.map((n) => cell(n, ICONS[n])).join("")}</div>
<h2>介面（${ICON_GROUPS.ui.length}）</h2><div class="grid">${ICON_GROUPS.ui.map((n) => cell(n, ICONS[n])).join("")}</div>
<h2>條目類型（${ICON_GROUPS.type.length}，依分類著色：文獻、影音、現場表演、藝術與圖像、其他）</h2>
<div class="grid">${ICON_GROUPS.type.map((n) => cell(n, TYPE_ICONS[n], GROUP_OF[n])).join("")}</div>
</main></body></html>
`;
fs.writeFileSync(path.join(root, "Design/Icons.html"), html);
console.log("wrote Design/Icons.html, src-tauri/icons/app-icon.svg, public/banyan.svg");
