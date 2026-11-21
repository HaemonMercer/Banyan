import type { Color } from "../editor/inline";
import { mediaUrl } from "../editor/media";
import {
  arrowHead,
  contentBounds,
  copyItems,
  edgeGeometry,
  radiusOf,
  renderOrder,
  shapeMap,
  shapePath,
  textBox,
  wrapText,
  type Dash,
  type Diagram,
  type Edge,
  type End,
  type Paint,
  type Shadow,
  type Shape,
  type Side,
} from "./draw";
import type { Rect } from "./board";
import { svgToPng } from "./imageClip";

/**
 * Draw 文件匯出：
 * - SVG、PNG（SVG 畫到 canvas）：整張圖，或只匯出一個畫板（`only`）。
 * - HTML（網頁設計）：每個畫板一段 `<section>`，裡面的圖形用絕對定位的 div（矩形、橢圓、文字、圖片），
 *   其他形狀與連線用內嵌 SVG；圖片轉成 data URL 放進檔案裡，一個檔案就能開。
 * - draw.io 檔（.drawio，未壓縮的 mxGraph XML）。
 * 匯出一律用淺色主題的顏色（和畫面上畫板裡一樣）。
 */

const TC: Record<Color, string> = {
  gray: "#787774",
  brown: "#9f6b53",
  orange: "#d9730d",
  yellow: "#cb912f",
  green: "#448361",
  blue: "#337ea9",
  purple: "#9065b0",
  pink: "#c14c8a",
  red: "#d44c47",
};
const BG: Record<Color, string> = {
  gray: "#f1f1ef",
  brown: "#f4eeee",
  orange: "#fbecdd",
  yellow: "#fbf3db",
  green: "#edf3ec",
  blue: "#e7f3f8",
  purple: "#f6f3f9",
  pink: "#faf1f5",
  red: "#fdebec",
};
const TEXT = "#2f2e2b";
const LINE = "#5f5e5a";
const EDGE = "#8a8984";
const APP_FONT = `"Segoe UI", -apple-system, "Microsoft JhengHei UI", "Microsoft JhengHei", sans-serif`;

const isHexPaint = (p: Paint): p is `#${string}` => p.startsWith("#");
export const fillOf = (p: Paint) => (p === "none" ? "none" : p === "default" ? "#ffffff" : isHexPaint(p) ? p : BG[p]);
export const strokeOf = (p: Paint) => (p === "none" ? "none" : p === "default" ? LINE : isHexPaint(p) ? p : TC[p]);
export const textOf = (p: Paint) => (p === "default" || p === "none" ? TEXT : isHexPaint(p) ? p : TC[p]);
const edgeOf = (p: Paint) => (p === "default" || p === "none" ? EDGE : strokeOf(p));
const dashOf = (d: Dash, w: number) => (d === "dashed" ? `${w * 4} ${w * 3}` : d === "dotted" ? `${w} ${w * 2}` : "");
const fontOf = (f: string) => (f ? `"${f}", ${APP_FONT}` : APP_FONT);

/** 陰影（CSS 與 SVG 濾鏡共用同一組數值） */
export const SHADOW_CSS: Record<Exclude<Shadow, "none">, string> = {
  sm: "0 1px 3px rgba(15, 15, 15, 0.12)",
  md: "0 4px 12px rgba(15, 15, 15, 0.14)",
  lg: "0 12px 32px rgba(15, 15, 15, 0.18)",
};
const SHADOW_SVG: Record<Exclude<Shadow, "none">, [number, number, number]> = { sm: [1, 1.5, 0.12], md: [4, 6, 0.14], lg: [12, 16, 0.18] };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

let ctx: CanvasRenderingContext2D | null = null;
function measure(font: string, spacing = 0) {
  ctx ??= typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  return (s: string) => {
    if (!ctx) return s.length * 7;
    ctx.font = font;
    return ctx.measureText(s).width + spacing * s.length;
  };
}

/* ─── 圖片 ─── */

/** 圖表用到的圖片都轉成 data URL（匯出時放進檔案裡）。讀不到的略過。 */
export async function loadImages(d: Diagram): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const s of d.shapes) {
    if (s.kind !== "image" || !s.src || out[s.src]) continue;
    if (s.src.startsWith("data:")) {
      out[s.src] = s.src;
      continue;
    }
    try {
      const res = await fetch(mediaUrl(s.src));
      if (!res.ok) continue;
      const blob = await res.blob();
      out[s.src] = await new Promise<string>((ok, bad) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result));
        r.onerror = () => bad(r.error);
        r.readAsDataURL(blob);
      });
    } catch {
      /* 讀不到的圖片不匯出 */
    }
  }
  return out;
}

/* ─── 只取一個畫板 ─── */

/** 畫板與它裡面的圖形、兩端都在裡面的連線。 */
export function frameOnly(d: Diagram, frameId: string): Diagram {
  const keep = new Set(d.shapes.filter((s) => s.id === frameId || s.parent === frameId).map((s) => s.id));
  const inside = (e: End) => "shape" in e && keep.has(e.shape);
  return { ...d, shapes: d.shapes.filter((s) => keep.has(s.id)), edges: d.edges.filter((e) => inside(e.from) && inside(e.to)) };
}

/* ─── SVG ─── */

function textSvg(
  text: string,
  box: Rect,
  st: { size: number; weight: number; italic: boolean; align: string; valign: string; color: string; font: string; lineHeight: number; spacing: number },
): string {
  if (!text.trim()) return "";
  const font = `${st.italic ? "italic " : ""}${st.weight} ${st.size}px ${fontOf(st.font)}`;
  const lines = wrapText(text, Math.max(10, box.w), measure(font, st.spacing));
  const lh = st.size * st.lineHeight;
  const total = lines.length * lh;
  const top = st.valign === "top" ? box.y : st.valign === "bottom" ? box.y + box.h - total : box.y + (box.h - total) / 2;
  const x = st.align === "left" ? box.x : st.align === "right" ? box.x + box.w : box.x + box.w / 2;
  const anchor = st.align === "left" ? "start" : st.align === "right" ? "end" : "middle";
  const spans = lines.map((l, i) => `<tspan x="${x}" y="${(top + lh * i + lh / 2).toFixed(2)}">${esc(l) || " "}</tspan>`).join("");
  return `<text font-family="${esc(fontOf(st.font))}" font-size="${st.size}" font-weight="${st.weight}"${st.italic ? ' font-style="italic"' : ""}${
    st.spacing ? ` letter-spacing="${st.spacing}"` : ""
  } fill="${st.color}" text-anchor="${anchor}" dominant-baseline="central">${spans}</text>`;
}

function shapeSvg(s: Shape, images: Record<string, string>): string {
  const st = s.style;
  const fill = s.kind === "actor" && st.fill === "default" ? "none" : fillOf(st.fill);
  const stroke = strokeOf(st.stroke);
  const dash = dashOf(st.dash, st.width);
  const r = radiusOf(s);
  const d = shapePath(s.kind, s.w, s.h, s.kind === "rounded" || s.style.radius !== null ? r : undefined);
  const attrs = `${st.opacity < 1 ? ` opacity="${st.opacity}"` : ""}${st.shadow !== "none" ? ` filter="url(#shadow-${st.shadow})"` : ""}`;
  let body = `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${st.width}"${dash ? ` stroke-dasharray="${dash}"` : ""} stroke-linejoin="round"/>`;
  if (s.kind === "image") {
    const href = s.src ? images[s.src] : undefined;
    const clip = `clip-${s.id}`;
    body =
      `<clipPath id="${clip}"><path d="${shapePath("rect", s.w, s.h, r)}"/></clipPath>` +
      (href
        ? `<image href="${esc(href)}" width="${s.w}" height="${s.h}" preserveAspectRatio="${st.fit === "contain" ? "xMidYMid meet" : "xMidYMid slice"}" clip-path="url(#${clip})"/>`
        : `<rect width="${s.w}" height="${s.h}" fill="#f1f1ef" clip-path="url(#${clip})"/>`) +
      (stroke !== "none" ? `<path d="${shapePath("rect", s.w, s.h, r)}" fill="none" stroke="${stroke}" stroke-width="${st.width}"/>` : "");
  }
  const text = s.kind === "frame" || s.kind === "image" ? "" : textSvg(s.text, textBox(s.kind, s.w, s.h), { ...st, color: textOf(st.color) });
  return `<g transform="translate(${s.x} ${s.y})"${attrs}>${body}${text}</g>`;
}

function edgeSvg(e: Edge, map: ReturnType<typeof shapeMap>): string {
  const g = edgeGeometry(e, map);
  if (!g) return "";
  const st = e.style;
  const color = edgeOf(st.stroke);
  const dash = dashOf(st.dash, st.width);
  let out = `<path d="${g.path}" fill="none" stroke="${color}" stroke-width="${st.width}"${dash ? ` stroke-dasharray="${dash}"` : ""} stroke-linejoin="round" stroke-linecap="round"/>`;
  for (const [a, end] of [
    [st.start, g.start],
    [st.end, g.end],
  ] as const) {
    const h = arrowHead(a, end.tip, end.dir, st.width);
    if (h) out += `<path d="${h.d}" fill="${h.filled ? color : "none"}" stroke="${color}" stroke-width="${st.width}" stroke-linejoin="round"/>`;
  }
  if (e.label.trim()) {
    const font = `400 ${st.size}px ${APP_FONT}`;
    const lines = e.label.split("\n");
    const w = Math.max(...lines.map(measure(font))) + 8;
    const h = lines.length * st.size * 1.4 + 2;
    out += `<rect x="${g.mid.x - w / 2}" y="${g.mid.y - h / 2}" width="${w}" height="${h}" fill="#ffffff"/>`;
    out += textSvg(
      e.label,
      { x: g.mid.x - w / 2, y: g.mid.y - h / 2, w, h },
      { size: st.size, weight: 400, italic: false, align: "center", valign: "middle", color: TEXT, font: "", lineHeight: 1.4, spacing: 0 },
    );
  }
  return out;
}

const SHADOW_DEFS = (Object.keys(SHADOW_SVG) as (keyof typeof SHADOW_SVG)[])
  .map((k) => {
    const [dy, sd, op] = SHADOW_SVG[k];
    return `<filter id="shadow-${k}" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="${dy}" stdDeviation="${sd}" flood-color="#0f0f0f" flood-opacity="${op}"/></filter>`;
  })
  .join("");

/** 整張圖（或一個畫板）的 SVG。整張圖四周留 20px；畫板剛好是畫板的大小。 */
export function toSvg(d: Diagram, images: Record<string, string> = {}, only?: string): { svg: string; w: number; h: number } {
  const frame = only ? d.shapes.find((s) => s.id === only && s.kind === "frame") : undefined;
  const dd = frame ? frameOnly(d, frame.id) : d;
  const b = frame ? { x: frame.x, y: frame.y, w: frame.w, h: frame.h } : (contentBounds(dd) ?? { x: 0, y: 0, w: 100, h: 60 });
  const pad = frame ? 0 : 20;
  const x = Math.floor(b.x - pad);
  const y = Math.floor(b.y - pad);
  const w = Math.ceil(b.w + pad * 2);
  const h = Math.ceil(b.h + pad * 2);
  const map = shapeMap(dd);
  // 畫板：先畫畫板，裡面的圖形裁在畫板範圍內
  const order = renderOrder(dd);
  let body = "";
  let clipDefs = "";
  for (let i = 0; i < order.length; i++) {
    const s = order[i];
    if (s.kind !== "frame") {
      body += shapeSvg(s, images);
      continue;
    }
    body += shapeSvg(s, images);
    if (!frame) body += `<text x="${s.x}" y="${s.y - 8}" font-family="${esc(APP_FONT)}" font-size="12" fill="#8a8984">${esc(s.text)}</text>`;
    const kids: string[] = [];
    while (order[i + 1]?.parent === s.id) kids.push(shapeSvg(order[++i], images));
    if (kids.length) {
      clipDefs += `<clipPath id="frame-${s.id}"><path transform="translate(${s.x} ${s.y})" d="${shapePath("frame", s.w, s.h, radiusOf(s))}"/></clipPath>`;
      body += `<g clip-path="url(#frame-${s.id})">${kids.join("")}</g>`;
    }
  }
  body += dd.edges.map((e) => edgeSvg(e, map)).join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}">` +
    `<defs>${SHADOW_DEFS}${clipDefs}</defs>` +
    (frame ? "" : `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff"/>`) +
    `${body}</svg>`;
  return { svg, w, h };
}

/** PNG（兩倍解析度）。 */
export async function toPng(d: Diagram, scale = 2, only?: string): Promise<Uint8Array> {
  return new Uint8Array(await (await pngBlob(d, scale, only)).arrayBuffer());
}

/** PNG 的 Blob（複製到剪貼簿用） */
export async function pngBlob(d: Diagram, scale = 2, only?: string): Promise<Blob> {
  const { svg, w, h } = toSvg(d, await loadImages(d), only);
  return svgToPng(svg, w, h, scale);
}

/** 選取的項目單獨成一張圖（複製成圖片用）；選了一個畫板就是那個畫板 */
export function selectionDiagram(d: Diagram, ids: string[]): { diagram: Diagram; only?: string } {
  const frame = ids.length === 1 ? d.shapes.find((s) => s.id === ids[0] && s.kind === "frame") : undefined;
  if (frame) return { diagram: d, only: frame.id };
  const clip = copyItems(d, ids);
  return { diagram: { ...d, shapes: clip.shapes, edges: clip.edges } };
}

/* ─── HTML ─── */

const px = (n: number) => `${Math.round(n * 100) / 100}px`;
/** 用 div 就能畫的形狀（其他用內嵌 SVG） */
const BOXY = new Set<Shape["kind"]>(["rect", "rounded", "ellipse", "text", "image", "frame"]);

function textCss(s: Shape): string {
  const st = s.style;
  return [
    `display:flex`,
    `flex-direction:column`,
    `justify-content:${st.valign === "top" ? "flex-start" : st.valign === "bottom" ? "flex-end" : "center"}`,
    `text-align:${st.align}`,
    `font-family:${fontOf(st.font).replace(/"/g, "'")}`,
    `font-size:${px(st.size)}`,
    `font-weight:${st.weight}`,
    ...(st.italic ? ["font-style:italic"] : []),
    `line-height:${st.lineHeight}`,
    ...(st.spacing ? [`letter-spacing:${px(st.spacing)}`] : []),
    `color:${textOf(st.color)}`,
  ].join(";");
}

function elementHtml(s: Shape, f: Rect, images: Record<string, string>): string {
  const st = s.style;
  const base = [
    `left:${px(s.x - f.x)}`,
    `top:${px(s.y - f.y)}`,
    `width:${px(s.w)}`,
    `height:${px(s.h)}`,
    ...(st.opacity < 1 ? [`opacity:${st.opacity}`] : []),
    ...(st.shadow !== "none" ? [`box-shadow:${SHADOW_CSS[st.shadow]}`] : []),
  ];
  const label = s.name ? ` data-name="${esc(s.name)}"` : "";
  const textHtml = esc(s.text).replace(/\n/g, "<br>");
  if (BOXY.has(s.kind)) {
    const radius = s.kind === "ellipse" ? "50%" : px(radiusOf(s));
    const box = [
      ...base,
      ...(st.fill !== "none" ? [`background:${fillOf(st.fill)}`] : []),
      ...(st.stroke !== "none" && st.width > 0 ? [`border:${px(st.width)} ${st.dash} ${strokeOf(st.stroke)}`] : []),
      ...(radius !== "0px" ? [`border-radius:${radius}`] : []),
    ];
    if (s.kind === "image") {
      const src = s.src ? images[s.src] : undefined;
      return src
        ? `<img${label} src="${esc(src)}" alt="${esc(s.name ?? "")}" style="${[...box, `object-fit:${st.fit}`].join(";")}">`
        : `<div${label} style="${[...box, "background:#f1f1ef"].join(";")}"></div>`;
    }
    const tb = textBox(s.kind, s.w, s.h);
    const pad = s.kind === "ellipse" ? `${px(tb.y)} ${px(tb.x)}` : px(tb.x);
    return `<div${label} class="t" style="${[...box, `padding:${pad}`, textCss(s)].join(";")}">${textHtml}</div>`;
  }
  // 其他形狀：SVG 外框＋文字疊在文字範圍上
  const fill = s.kind === "actor" && st.fill === "default" ? "none" : fillOf(st.fill);
  const dash = dashOf(st.dash, st.width);
  const svg = `<svg${label} style="${[...base, "overflow:visible"].join(";")}" viewBox="0 0 ${s.w} ${s.h}"><path d="${shapePath(s.kind, s.w, s.h)}" fill="${fill}" stroke="${strokeOf(
    st.stroke,
  )}" stroke-width="${st.width}"${dash ? ` stroke-dasharray="${dash}"` : ""} stroke-linejoin="round"/></svg>`;
  if (!s.text.trim()) return svg;
  const tb = textBox(s.kind, s.w, s.h);
  return `${svg}<div class="t" style="${[`left:${px(s.x - f.x + tb.x)}`, `top:${px(s.y - f.y + tb.y)}`, `width:${px(tb.w)}`, `height:${px(tb.h)}`, textCss(s)].join(";")}">${textHtml}</div>`;
}

/**
 * 網頁：每個畫板一段 `<section class="frame">`；沒有畫板時，整張圖當成一個畫板。
 * only 是只匯出那個畫板。
 */
export function toHtml(d: Diagram, title: string, images: Record<string, string> = {}, only?: string): string {
  const order = renderOrder(d);
  let frames = order.filter((s) => s.kind === "frame" && (!only || s.id === only));
  const sections: string[] = [];
  const map = shapeMap(d);
  const edgesIn = (r: Rect) =>
    d.edges.filter((e) => {
      const g = edgeGeometry(e, map);
      if (!g) return false;
      const inside = (p: { x: number; y: number }) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
      return inside(g.start.tip) && inside(g.end.tip);
    });
  const linesSvg = (r: Rect, edges: Edge[]) =>
    edges.length
      ? `<svg class="lines" width="${r.w}" height="${r.h}" viewBox="${r.x} ${r.y} ${r.w} ${r.h}">${edges.map((e) => edgeSvg(e, map)).join("")}</svg>`
      : "";
  if (!frames.length && !only) {
    // 沒有畫板：整張圖是一頁
    const b = contentBounds({ ...d, shapes: d.shapes.filter((s) => s.kind !== "frame") }) ?? { x: 0, y: 0, w: 400, h: 300 };
    const r = { x: b.x - 20, y: b.y - 20, w: b.w + 40, h: b.h + 40 };
    const kids = order.filter((s) => s.kind !== "frame" && !s.parent);
    sections.push(
      `<section class="frame" style="width:${px(r.w)};height:${px(r.h)};background:#ffffff">\n${kids
        .map((s) => "  " + elementHtml(s, r, images))
        .join("\n")}\n  ${linesSvg(r, edgesIn(r))}\n</section>`,
    );
  }
  frames = frames.length ? frames : [];
  for (const f of frames) {
    const r = { x: f.x, y: f.y, w: f.w, h: f.h };
    const kids = order.filter((s) => s.parent === f.id);
    const st = f.style;
    const style = [
      `width:${px(f.w)}`,
      `height:${px(f.h)}`,
      ...(st.fill !== "none" ? [`background:${fillOf(st.fill)}`] : []),
      ...(st.stroke !== "none" && st.width > 0 ? [`border:${px(st.width)} ${st.dash} ${strokeOf(st.stroke)}`] : []),
      ...(radiusOf(f) ? [`border-radius:${px(radiusOf(f))}`] : []),
      ...(st.shadow !== "none" ? [`box-shadow:${SHADOW_CSS[st.shadow]}`] : []),
    ];
    sections.push(
      `<section class="frame" aria-label="${esc(f.text)}" style="${style.join(";")}">\n${kids.map((s) => "  " + elementHtml(s, r, images)).join("\n")}${
        linesSvg(r, edgesIn(r)) ? "\n  " + linesSvg(r, edgesIn(r)) : ""
      }\n</section>`,
    );
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
* { box-sizing: border-box; }
body { margin: 0; padding: 40px 16px; background: #f4f3f0; font-family: ${APP_FONT}; color: ${TEXT}; }
.frame { position: relative; margin: 0 auto 40px; overflow: hidden; }
.frame > * { position: absolute; margin: 0; }
.frame > .t { white-space: pre-wrap; overflow-wrap: anywhere; }
.frame > .lines { left: 0; top: 0; overflow: visible; pointer-events: none; }
</style>
</head>
<body>
${sections.join("\n")}
</body>
</html>
`;
}

/* ─── draw.io ─── */

const DRAWIO_SHAPE: Record<Shape["kind"], string> = {
  rect: "rounded=0;whiteSpace=wrap;",
  rounded: "rounded=1;whiteSpace=wrap;arcSize=20;",
  ellipse: "ellipse;whiteSpace=wrap;",
  diamond: "rhombus;whiteSpace=wrap;",
  triangle: "triangle;direction=north;whiteSpace=wrap;",
  hexagon: "shape=hexagon;perimeter=hexagonPerimeter2;whiteSpace=wrap;fixedSize=1;",
  parallelogram: "shape=parallelogram;perimeter=parallelogramPerimeter;whiteSpace=wrap;fixedSize=1;",
  cylinder: "shape=cylinder3;whiteSpace=wrap;boundedLbl=1;size=10;",
  document: "shape=document;whiteSpace=wrap;boundedLbl=1;",
  cloud: "ellipse;shape=cloud;whiteSpace=wrap;",
  note: "shape=note;whiteSpace=wrap;size=14;",
  actor: "shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;outlineConnect=0;",
  text: "text;whiteSpace=wrap;",
  frame: "rounded=0;whiteSpace=wrap;container=1;verticalAlign=top;align=left;",
  image: "shape=image;imageAspect=0;",
};
const DRAWIO_ARROW = { none: "none", arrow: "classic", open: "open", diamond: "diamond", circle: "oval" } as const;
const SIDE_XY: Record<Side, [number, number]> = { top: [0.5, 0], right: [1, 0.5], bottom: [0.5, 1], left: [0, 0.5] };

const htmlValue = (s: string) => esc(esc(s).replace(/\n/g, "<br>"));

function dashStyle(d: Dash) {
  return d === "dashed" ? "dashed=1;" : d === "dotted" ? "dashed=1;dashPattern=1 3;" : "";
}

/** draw.io（diagrams.net）的檔案。 */
export function toDrawio(d: Diagram, title: string, images: Record<string, string> = {}): string {
  const cells: string[] = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  const id = (x: string) => `b-${x}`;
  for (const s of d.shapes) {
    const st = s.style;
    const img = s.kind === "image" && s.src && images[s.src] ? `image=${images[s.src].replace(";base64", "")};` : "";
    const style =
      DRAWIO_SHAPE[s.kind] +
      img +
      "html=1;" +
      `fillColor=${s.kind === "actor" && st.fill === "default" ? "none" : fillOf(st.fill)};` +
      `strokeColor=${strokeOf(st.stroke)};strokeWidth=${st.width};${dashStyle(st.dash)}` +
      `fontColor=${textOf(st.color)};fontSize=${st.size};fontStyle=${(st.weight >= 600 ? 1 : 0) + (st.italic ? 2 : 0)};` +
      (st.font ? `fontFamily=${st.font};` : "") +
      (s.kind === "actor" ? "" : `align=${st.align};verticalAlign=${st.valign};`) +
      (st.opacity < 1 ? `opacity=${Math.round(st.opacity * 100)};` : "") +
      (st.radius !== null && radiusOf(s) && s.kind !== "rounded" ?`rounded=1;absoluteArcSize=1;arcSize=${radiusOf(s) * 2};` : "") +
      (st.shadow !== "none" ? "shadow=1;" : "");
    const parent = s.parent ? id(s.parent) : "1";
    const pf = s.parent ? d.shapes.find((x) => x.id === s.parent) : undefined;
    const x = pf ? s.x - pf.x : s.x;
    const y = pf ? s.y - pf.y : s.y;
    cells.push(
      `<mxCell id="${id(s.id)}" value="${htmlValue(s.kind === "image" ? "" : s.text)}" style="${style}" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="${y}" width="${s.w}" height="${s.h}" as="geometry"/></mxCell>`,
    );
  }
  for (const e of d.edges) {
    const st = e.style;
    let style =
      (st.route === "straight" ? "" : st.route === "curved" ? "edgeStyle=orthogonalEdgeStyle;curved=1;" : "edgeStyle=orthogonalEdgeStyle;rounded=1;") +
      `html=1;strokeColor=${edgeOf(st.stroke)};strokeWidth=${st.width};${dashStyle(st.dash)}` +
      `endArrow=${DRAWIO_ARROW[st.end]};endFill=${st.end === "open" ? 0 : 1};startArrow=${DRAWIO_ARROW[st.start]};startFill=${st.start === "open" ? 0 : 1};` +
      `fontSize=${st.size};fontColor=${TEXT};`;
    const attach = (end: End, which: "exit" | "entry") => {
      if (!("shape" in end) || !end.side) return;
      const [x, y] = SIDE_XY[end.side];
      style += `${which}X=${x};${which}Y=${y};${which}Dx=0;${which}Dy=0;`;
    };
    attach(e.from, "exit");
    attach(e.to, "entry");
    const src = "shape" in e.from ? ` source="${id(e.from.shape)}"` : "";
    const dst = "shape" in e.to ? ` target="${id(e.to.shape)}"` : "";
    const pts =
      ("shape" in e.from ? "" : `<mxPoint x="${e.from.x}" y="${e.from.y}" as="sourcePoint"/>`) +
      ("shape" in e.to ? "" : `<mxPoint x="${e.to.x}" y="${e.to.y}" as="targetPoint"/>`);
    cells.push(
      `<mxCell id="${id(e.id)}" value="${htmlValue(e.label)}" style="${style}" edge="1" parent="1"${src}${dst}><mxGeometry relative="1" as="geometry">${pts}</mxGeometry></mxCell>`,
    );
  }
  return (
    `<mxfile host="Banyan">\n  <diagram name="${esc(title)}" id="banyan">\n    <mxGraphModel grid="${d.grid ? 1 : 0}" gridSize="10" guides="1" connect="1" arrows="1" page="0">\n      <root>\n        ` +
    cells.join("\n        ") +
    `\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n`
  );
}
