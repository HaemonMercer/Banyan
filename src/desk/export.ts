import { invoke, isTauri } from "@tauri-apps/api/core";
import { mediaUrl } from "../editor/media";
import { splitSlides } from "./file";
import { DEFAULT_PAGE, docxPage, type PageSetup } from "./pageSetup";
import { animAt, type SlideAnim, type Transition } from "./slideAnim";
import { SLIDE_W, type Frame, type ShapeKind } from "./slideBoxes";
import { slideColors, type DeckSetup } from "./deckSetup";
import { fillOf, strokeOf } from "./drawExport";
import { mdBlocks, runsText, type MdBlock, type Run } from "./mdblocks";

/**
 * Dock 文件匯出成 Word（.docx）與 PowerPoint（.pptx）。
 * docx、pptxgenjs 很大，用到時才載入。檔案存到「下載」資料夾（Rust 指令 export_save），
 * 存好後在檔案總管裡選取它；只有前端時用瀏覽器下載。
 */

const MONO = "Consolas";

/* ─── 圖片 ─── */

interface Img {
  data: ArrayBuffer;
  type: "png" | "jpg" | "gif" | "bmp";
  w: number;
  h: number;
  dataUrl: string;
}

async function loadImage(src: string): Promise<Img | null> {
  try {
    const res = await fetch(mediaUrl(src));
    if (!res.ok) return null;
    const blob = await res.blob();
    const ext = (blob.type.split("/")[1] ?? src.split(".").pop() ?? "").toLowerCase();
    const type = ext === "jpeg" || ext === "jpg" ? "jpg" : ext === "gif" ? "gif" : ext === "bmp" ? "bmp" : ext === "png" ? "png" : null;
    if (!type) return null;
    const bmp = await createImageBitmap(blob);
    const data = await blob.arrayBuffer();
    const dataUrl = await new Promise<string>((ok, bad) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.onerror = () => bad(r.error);
      r.readAsDataURL(blob);
    });
    const out = { data, type, w: bmp.width, h: bmp.height, dataUrl } as Img;
    bmp.close();
    return out;
  } catch {
    return null;
  }
}

async function loadImages(blocks: MdBlock[]): Promise<Map<string, Img>> {
  const srcs = [...new Set(blocks.flatMap((b) => (b.type === "image" ? [b.src] : [])))];
  const map = new Map<string, Img>();
  await Promise.all(
    srcs.map(async (s) => {
      const img = await loadImage(s);
      if (img) map.set(s, img);
    }),
  );
  return map;
}

/** 放進 maxW×maxH 的大小（不放大） */
function fitSize(w: number, h: number, maxW: number, maxH: number) {
  const k = Math.min(1, maxW / w, maxH / h);
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

/* ─── Word ─── */

export async function toDocx(source: string, setup: PageSetup = DEFAULT_PAGE): Promise<Uint8Array> {
  const pg = docxPage(setup);
  const d = await import("docx");
  const blocks = mdBlocks(source);
  const images = await loadImages(blocks);

  const runOf = (r: Run, style?: { size?: number }) =>
    new d.TextRun({
      text: r.text,
      bold: r.bold,
      italics: r.italic,
      strike: r.strike,
      superScript: r.sup || undefined,
      subScript: r.sub || undefined,
      underline: r.underline || r.link ? {} : undefined,
      color: r.link ? "0563C1" : undefined,
      font: r.code ? MONO : undefined,
      highlight: r.highlight ? "yellow" : undefined,
      break: r.br ? 1 : undefined,
      size: style?.size,
    });
  const children = (runs: Run[]) => {
    const out: (InstanceType<typeof d.TextRun> | InstanceType<typeof d.ExternalHyperlink>)[] = [];
    for (const r of runs) {
      if (r.link && /^(https?:|mailto:)/i.test(r.link)) out.push(new d.ExternalHyperlink({ link: r.link, children: [runOf(r)] }));
      else out.push(runOf(r));
    }
    return out;
  };
  const HEADINGS = [
    d.HeadingLevel.HEADING_1,
    d.HeadingLevel.HEADING_2,
    d.HeadingLevel.HEADING_3,
    d.HeadingLevel.HEADING_4,
    d.HeadingLevel.HEADING_5,
    d.HeadingLevel.HEADING_6,
  ];

  const paras: InstanceType<typeof d.Paragraph>[] = [];
  for (const b of blocks) {
    if (b.type === "heading") {
      paras.push(new d.Paragraph({ heading: HEADINGS[b.level - 1], children: children(b.runs) }));
    } else if (b.type === "para") {
      const indent = (b.quote ? 720 * b.quote : 0) + (b.list?.cont ? 720 * (b.list.level + 1) : 0);
      paras.push(
        new d.Paragraph({
          children: children(b.runs),
          bullet: b.list && !b.list.cont && !b.list.ordered ? { level: b.list.level } : undefined,
          numbering:
            b.list && !b.list.cont && b.list.ordered ? { reference: "ordered", level: b.list.level, instance: b.list.id + 1 } : undefined,
          indent: indent ? { left: indent } : undefined,
          border: b.quote ? { left: { style: d.BorderStyle.SINGLE, size: 12, color: "BFBFBF", space: 8 } } : undefined,
        }),
      );
    } else if (b.type === "code") {
      const lines = b.text.split("\n");
      paras.push(
        new d.Paragraph({
          shading: { type: d.ShadingType.CLEAR, fill: "F3F3F3", color: "auto" },
          children: lines.map((l, i) => new d.TextRun({ text: l, font: MONO, size: 19, break: i ? 1 : undefined })),
        }),
      );
    } else if (b.type === "hr") {
      paras.push(new d.Paragraph({ border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: "BFBFBF", space: 1 } }, children: [] }));
    } else if (b.type === "pagebreak") {
      paras.push(new d.Paragraph({ children: [new d.PageBreak()] }));
    } else if (b.type === "image") {
      const img = images.get(b.src);
      if (!img) {
        if (b.alt) paras.push(new d.Paragraph({ children: [new d.TextRun({ text: b.alt, italics: true })] }));
        continue;
      }
      // A4 內文寬約 6.3 吋 ≈ 600px
      const s = fitSize(img.w, img.h, 600, 800);
      paras.push(
        new d.Paragraph({
          alignment: d.AlignmentType.CENTER,
          children: [new d.ImageRun({ type: img.type, data: img.data, transformation: { width: s.w, height: s.h }, altText: { name: b.alt || "Image", title: b.alt, description: b.alt } } as ConstructorParameters<typeof d.ImageRun>[0])],
        }),
      );
    }
  }

  /** 頁首頁尾的文字：{page}、{pages} 是 Word 的欄位 */
  const fieldRuns = (text: string) =>
    text
      .split(/(\{page\}|\{pages\})/i)
      .filter(Boolean)
      .map((part) =>
        /^\{page\}$/i.test(part)
          ? new d.TextRun({ children: [d.PageNumber.CURRENT] })
          : /^\{pages\}$/i.test(part)
            ? new d.TextRun({ children: [d.PageNumber.TOTAL_PAGES] })
            : new d.TextRun(part),
      );
  const levels = Array.from({ length: 9 }, (_, level) => ({
    level,
    format: d.LevelFormat.DECIMAL,
    text: `%${level + 1}.`,
    alignment: d.AlignmentType.START,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }));
  const doc = new d.Document({
    creator: "Banyan",
    styles: { default: { document: { run: { font: pg.font, size: pg.size }, paragraph: { spacing: { line: pg.line } } } } },
    numbering: { config: [{ reference: "ordered", levels }] },
    sections: [
      {
        properties: {
          page: {
            size: { width: pg.paper.width, height: pg.paper.height, orientation: pg.paper.landscape ? d.PageOrientation.LANDSCAPE : d.PageOrientation.PORTRAIT },
            margin: pg.margin,
          },
        },
        // 頁首、頁尾（{page}、{pages} 換成頁碼欄位）與頁碼
        headers: pg.header ? { default: new d.Header({ children: [new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: fieldRuns(pg.header) })] }) } : undefined,
        footers:
          pg.footer || pg.numbers
            ? {
                default: new d.Footer({
                  children: [
                    ...(pg.footer ? [new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: fieldRuns(pg.footer) })] : []),
                    ...(pg.numbers ? [new d.Paragraph({ alignment: d.AlignmentType.RIGHT, children: [new d.TextRun({ children: [d.PageNumber.CURRENT] })] })] : []),
                  ],
                }),
              }
            : undefined,
        children: paras,
      },
    ],
  });
  const blob = await d.Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}

/* ─── PowerPoint ─── */

type PptRun = { text: string; options?: Record<string, unknown> };

export async function toPptx(source: string, title: string, anim: SlideAnim[] = [], deck: DeckSetup = {}): Promise<Uint8Array> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 × 7.5 吋
  pptx.title = title;
  const W = 13.333;
  const H = 7.5;
  const M = 0.6;

  const slides = splitSlides(source).map(mdBlocks);
  // 物件裡的圖片、文字方塊的內容也要先讀進來
  const boxImages: MdBlock[] = anim.flatMap((a) => (a.boxes ?? []).filter((b) => b.kind === "image" && b.src).map((b) => ({ type: "image" as const, src: b.src!, alt: b.alt ?? "" })));
  const boxTexts = anim.map((a) => new Map((a.boxes ?? []).filter((b) => b.kind === "text").map((b) => [b.id, mdBlocks(b.text ?? "")])));
  const images = await loadImages([...slides.flat(), ...boxImages, ...boxTexts.flatMap((m) => [...m.values()].flat())]);

  const runOpts = (r: Run) => ({
    bold: r.bold,
    italic: r.italic,
    strike: r.strike ? "sngStrike" : undefined,
    superscript: r.sup || undefined,
    subscript: r.sub || undefined,
    underline: r.underline || r.link ? { style: "sng" } : undefined,
    fontFace: r.code ? MONO : undefined,
    highlight: r.highlight ? "FFF59D" : undefined,
    hyperlink: r.link && /^(https?:|mailto:)/i.test(r.link) ? { url: r.link } : undefined,
    breakLine: r.br || undefined,
  });

  /** 段落 → pptxgenjs 的文字（標題粗體、清單、引言、程式碼） */
  const paraRuns = (blocks: MdBlock[], headSize = 24): PptRun[] => {
    const runs: PptRun[] = [];
    for (const b of blocks) {
      const para: PptRun[] = [];
      if (b.type === "para") {
        for (const r of b.runs) para.push({ text: r.text, options: runOpts(r) });
        if (!para.length) para.push({ text: "" });
        const first = para[0].options ?? {};
        if (b.list && !b.list.cont) {
          para[0].options = { ...first, bullet: b.list.ordered ? { type: "number" } : true, indentLevel: b.list.level };
        } else if (b.list?.cont) para[0].options = { ...first, indentLevel: b.list.level + 1 };
        if (b.quote) para.forEach((p) => (p.options = { ...p.options, italic: true, color: "666666" }));
      } else if (b.type === "heading") {
        para.push({ text: runsText(b.runs), options: { bold: true, fontSize: b.level === 1 ? headSize + 12 : b.level === 2 ? headSize + 6 : headSize } });
      } else if (b.type === "code") {
        b.text.split("\n").forEach((l, i, all) => para.push({ text: l, options: { fontFace: MONO, fontSize: 16, breakLine: i < all.length - 1 } }));
      } else continue;
      const last = para[para.length - 1];
      last.options = { ...last.options, breakLine: true };
      runs.push(...para);
    }
    return runs;
  };

  /** 投影片的設計座標（960×540）→ 吋 */
  const k = W / SLIDE_W;
  const inch = (f: Frame) => ({ x: f.x * k, y: f.y * k, w: f.w * k, h: f.h * k });
  const hex = (c: string) => c.replace("#", "").toUpperCase();
  const PPT_SHAPE: Record<ShapeKind, string> = {
    rect: "rect",
    round: "roundRect",
    ellipse: "ellipse",
    triangle: "triangle",
    arrow: "rightArrow",
    diamond: "diamond",
    pentagon: "pentagon",
    hexagon: "hexagon",
    star: "star5",
    callout: "wedgeRoundRectCallout",
    line: "line",
  };

  slides.forEach((blocks, si) => {
    const slide = pptx.addSlide();
    const meta = animAt(anim, si);
    // 主題與這張的背景、文字顏色；頁碼、頁尾、備忘稿、跳過
    const colors = slideColors(deck, meta);
    slide.background = { color: hex(colors.bg) };
    slide.color = hex(colors.text);
    if (deck.numbers) slide.slideNumber = { x: W - 1.1, y: H - 0.5, w: 0.8, h: 0.3, fontSize: 12, color: hex(colors.muted), align: "right" } as never;
    if (deck.footer) slide.addText(deck.footer, { x: M, y: H - 0.5, w: W / 2, h: 0.3, fontSize: 12, color: hex(colors.muted) });
    if (meta.notes?.trim()) slide.addNotes(meta.notes);
    if (meta.skip) (slide as unknown as { hidden: boolean }).hidden = true;
    // 主文字方塊的範圍：沒有搬過就是原本的版面
    const area = meta.main ? inch(meta.main) : { x: M, y: M, w: W - 2 * M, h: H - 2 * M };
    const rest = [...blocks];
    const head = rest[0]?.type === "heading" ? (rest.shift() as Extract<MdBlock, { type: "heading" }>) : null;
    const picture = rest.find((b) => b.type === "image") as Extract<MdBlock, { type: "image" }> | undefined;
    const body = rest.filter((b) => b.type !== "image");

    // 只有一個大標題（和一兩行字）：標題投影片
    const titleSlide = !!head && head.level === 1 && !picture && body.every((b) => b.type === "para" && !b.list) && body.length <= 2;
    if (titleSlide && head) {
      const y = area.y + Math.max(0, (area.h - 2.7) / 2);
      slide.addText(runsText(head.runs), { x: area.x, y, w: area.w, h: 1.4, fontSize: 44, bold: true, align: "center", valign: "middle" });
      if (body.length) {
        slide.addText(
          body.map((b) => runsText((b as Extract<MdBlock, { type: "para" }>).runs)).join("\n"),
          { x: area.x, y: y + 1.5, w: area.w, h: 1.2, fontSize: 22, color: hex(colors.soft), align: "center", valign: "top" },
        );
      }
    } else {
      let top = area.y;
      if (head) {
        slide.addText(runsText(head.runs), { x: area.x, y: area.y, w: area.w, h: 1, fontSize: head.level === 1 ? 36 : 30, bold: true, valign: "middle" });
        top = area.y + 1.15;
      }
      const textW = picture ? area.w * 0.55 : area.w;
      const runs = paraRuns(body);
      const bottom = area.y + area.h;
      if (runs.length) {
        slide.addText(runs as never, { x: area.x, y: top, w: textW, h: Math.max(0.4, bottom - top), fontSize: 22, valign: "top", paraSpaceAfter: 6 });
      }
      if (picture) {
        const img = images.get(picture.src);
        const boxX = runs.length ? area.x + textW + 0.3 : area.x;
        const boxW = runs.length ? area.x + area.w - boxX : area.w;
        const boxH = Math.max(0.4, bottom - top);
        if (img) {
          const s = Math.min(boxW / img.w, boxH / img.h);
          const w = img.w * s;
          const h = img.h * s;
          slide.addImage({ data: img.dataUrl, x: boxX + (boxW - w) / 2, y: top + (boxH - h) / 2, w, h, altText: picture.alt });
        }
      }
    }

    // 文字方塊、圖片、形狀（照上下層的順序）
    for (const b of meta.boxes ?? []) {
      const f = inch(b);
      if (b.kind === "shape") {
        slide.addShape(PPT_SHAPE[b.shape ?? "rect"] as never, {
          ...f,
          fill: b.fill === null ? { type: "none" } : { color: hex(strokeOf(b.fill ?? "blue")) },
          line: b.line ? { color: hex(strokeOf(b.line)), width: 2 } : { type: "none" },
          rotate: b.rot,
        } as never);
      } else if (b.kind === "image") {
        const img = images.get(b.src ?? "");
        if (!img) continue;
        if (b.fit === "cover") {
          slide.addImage({ data: img.dataUrl, ...f, sizing: { type: "cover", w: f.w, h: f.h }, altText: b.alt, rotate: b.rot });
        } else {
          const s = Math.min(f.w / img.w, f.h / img.h);
          const w = img.w * s;
          const h = img.h * s;
          slide.addImage({ data: img.dataUrl, x: f.x + (f.w - w) / 2, y: f.y + (f.h - h) / 2, w, h, altText: b.alt, rotate: b.rot });
        }
      } else {
        const runs = paraRuns(boxTexts[si]?.get(b.id) ?? []);
        if (!runs.length) continue;
        slide.addText(runs as never, {
          ...f,
          fontSize: 20,
          valign: "top",
          paraSpaceAfter: 4,
          fill: b.fill ? { color: hex(fillOf(b.fill)) } : undefined,
          line: b.line ? { color: hex(strokeOf(b.line)), width: 2 } : undefined,
          rotate: b.rot,
        });
      }
    }
  });
  const out = (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
  // pptxgenjs 不會寫轉場：打開 zip 在每張投影片的 XML 補上（逐項顯示沒有匯出）
  if (!slides.some((_b, i) => animAt(anim, i).transition !== "none")) return out;
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(out);
  for (let i = 0; i < slides.length; i++) {
    const path = `ppt/slides/slide${i + 1}.xml`;
    const file = zip.file(path);
    if (file) zip.file(path, withTransition(await file.async("string"), animAt(anim, i).transition));
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

const PPT_TRANSITION: Record<Transition, string> = {
  none: "",
  fade: "<p:fade/>",
  push: '<p:push dir="l"/>',
  cover: '<p:cover dir="l"/>',
  wipe: '<p:wipe dir="r"/>',
  zoom: "<p:zoom/>",
};

/** 在投影片 XML 加上轉場（`<p:transition>` 要在 `<p:clrMapOvr>` 後面、`<p:timing>` 前面） */
export function withTransition(xml: string, t: Transition): string {
  if (t === "none" || xml.includes("<p:transition")) return xml;
  const tag = `<p:transition spd="med">${PPT_TRANSITION[t]}</p:transition>`;
  const at = xml.indexOf("<p:timing");
  const end = at >= 0 ? at : xml.lastIndexOf("</p:sld>");
  return end < 0 ? xml : xml.slice(0, end) + tag + xml.slice(end);
}

/* ─── 存檔 ─── */

/** 存到「下載」資料夾並在檔案總管裡選取它；回傳存好的路徑（瀏覽器下載時是 null）。 */
export async function saveExport(fileName: string, bytes: Uint8Array): Promise<string | null> {
  if (!isTauri()) {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return null;
  }
  const path = await invoke<string>("export_save", bytes, { headers: { "x-name": encodeURIComponent(fileName) } });
  try {
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await revealItemInDir(path);
  } catch {
    /* 打不開檔案總管也沒關係，檔案已經存好了 */
  }
  return path;
}
