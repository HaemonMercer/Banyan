import { invoke, isTauri } from "@tauri-apps/api/core";
import { mediaUrl } from "../editor/media";
import { splitSlides } from "./file";
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

export async function toDocx(source: string): Promise<Uint8Array> {
  const d = await import("docx");
  const blocks = mdBlocks(source);
  const images = await loadImages(blocks);

  const runOf = (r: Run, style?: { size?: number }) =>
    new d.TextRun({
      text: r.text,
      bold: r.bold,
      italics: r.italic,
      strike: r.strike,
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

  const levels = Array.from({ length: 9 }, (_, level) => ({
    level,
    format: d.LevelFormat.DECIMAL,
    text: `%${level + 1}.`,
    alignment: d.AlignmentType.START,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }));
  const doc = new d.Document({
    creator: "Banyan",
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    numbering: { config: [{ reference: "ordered", levels }] },
    sections: [
      {
        properties: {
          page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } },
        },
        children: paras,
      },
    ],
  });
  const blob = await d.Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}

/* ─── PowerPoint ─── */

type PptRun = { text: string; options?: Record<string, unknown> };

export async function toPptx(source: string, title: string): Promise<Uint8Array> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 × 7.5 吋
  pptx.title = title;
  const W = 13.333;
  const H = 7.5;
  const M = 0.6;

  const slides = splitSlides(source).map(mdBlocks);
  const images = await loadImages(slides.flat());

  const runOpts = (r: Run) => ({
    bold: r.bold,
    italic: r.italic,
    strike: r.strike ? "sngStrike" : undefined,
    underline: r.underline || r.link ? { style: "sng" } : undefined,
    fontFace: r.code ? MONO : undefined,
    highlight: r.highlight ? "FFF59D" : undefined,
    hyperlink: r.link && /^(https?:|mailto:)/i.test(r.link) ? { url: r.link } : undefined,
    breakLine: r.br || undefined,
  });

  for (const blocks of slides) {
    const slide = pptx.addSlide();
    const rest = [...blocks];
    const head = rest[0]?.type === "heading" ? (rest.shift() as Extract<MdBlock, { type: "heading" }>) : null;
    const picture = rest.find((b) => b.type === "image") as Extract<MdBlock, { type: "image" }> | undefined;
    const body = rest.filter((b) => b.type !== "image");

    // 只有一個大標題（和一兩行字）：標題投影片
    const titleSlide = !!head && head.level === 1 && !picture && body.every((b) => b.type === "para" && !b.list) && body.length <= 2;
    if (titleSlide && head) {
      slide.addText(runsText(head.runs), { x: M, y: H * 0.3, w: W - 2 * M, h: 1.4, fontSize: 44, bold: true, align: "center", valign: "middle" });
      if (body.length) {
        slide.addText(
          body.map((b) => runsText((b as Extract<MdBlock, { type: "para" }>).runs)).join("\n"),
          { x: M, y: H * 0.3 + 1.5, w: W - 2 * M, h: 1.2, fontSize: 22, color: "666666", align: "center", valign: "top" },
        );
      }
      continue;
    }

    let top = M;
    if (head) {
      slide.addText(runsText(head.runs), { x: M, y: M, w: W - 2 * M, h: 1, fontSize: head.level === 1 ? 36 : 30, bold: true, valign: "middle" });
      top = M + 1.15;
    }
    const textW = picture ? (W - 2 * M) * 0.55 : W - 2 * M;
    const runs: PptRun[] = [];
    for (const b of body) {
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
        para.push({ text: runsText(b.runs), options: { bold: true, fontSize: 24 } });
      } else if (b.type === "code") {
        b.text.split("\n").forEach((l, i, all) => para.push({ text: l, options: { fontFace: MONO, fontSize: 16, breakLine: i < all.length - 1 } }));
      } else continue;
      const last = para[para.length - 1];
      last.options = { ...last.options, breakLine: true };
      runs.push(...para);
    }
    if (runs.length) {
      slide.addText(runs as never, { x: M, y: top, w: textW, h: H - top - M, fontSize: 22, valign: "top", paraSpaceAfter: 6 });
    }
    if (picture) {
      const img = images.get(picture.src);
      const boxX = runs.length ? M + textW + 0.3 : M;
      const boxW = runs.length ? W - boxX - M : W - 2 * M;
      const boxH = H - top - M;
      if (img) {
        const k = Math.min(boxW / img.w, boxH / img.h);
        const w = img.w * k;
        const h = img.h * k;
        slide.addImage({ data: img.dataUrl, x: boxX + (boxW - w) / 2, y: top + (boxH - h) / 2, w, h, altText: picture.alt });
      }
    }
  }
  const out = (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
  return out;
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
