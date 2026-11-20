import { useEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { highlightCode } from "../editor/codeHighlight";
import { renderEmbedded } from "../editor/embed";
import { mediaUrl, PURIFY } from "../editor/media";
import { addImported, baseName, unzip } from "../sheet/importer";
import { importTables, readSpreadsheet } from "../sheet/formats";
import { newWorkbook, serializeWorkbook } from "../sheet/model";
import { SheetView } from "../sheet/SheetView";
import { codeLang, decodeText, docxHtml, looksText, pptxSlides, previewKind, type SlideText } from "./preview";

/**
 * Drawer 的檔案檢視：依種類顯示（`preview.ts`）。
 * 要讀內容的種類（文字、程式碼、Markdown、CSV、Excel、Word、PowerPoint）用 fetch 讀進來；
 * App 裡是 asset protocol 的網址，瀏覽器預覽是 data URL。
 * 只是預覽：試算表可以捲動、換工作表、選取複製，但改了不會存。
 */

/** 文字超過這麼多就只顯示前面一段 */
const MAX_TEXT = 2_000_000;
/** 超過這麼多就不上色（highlight.js 處理大檔很慢） */
const MAX_HIGHLIGHT = 200_000;

type Loaded =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "text"; text: string; lang: string; cut: boolean }
  | { kind: "markdown"; html: string; cut: boolean }
  | { kind: "html"; html: string }
  | { kind: "sheet"; json: string }
  | { kind: "slides"; slides: SlideText[] }
  | { kind: "none" };

const noop = () => {};

async function load(name: string, src: string): Promise<Loaded> {
  const kind = previewKind(name, src);
  const res = await fetch(mediaUrl(src));
  if (!res.ok) throw new Error(`Couldn't read the file (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const text = () => {
    const all = decodeText(bytes.length > MAX_TEXT ? bytes.subarray(0, MAX_TEXT) : bytes);
    return { text: all, cut: bytes.length > MAX_TEXT };
  };
  switch (kind) {
    case "markdown": {
      const t = text();
      return { kind: "markdown", html: renderEmbedded(t.text), cut: t.cut };
    }
    case "code": {
      const t = text();
      return { kind: "text", text: t.text, lang: codeLang(name) ?? "", cut: t.cut };
    }
    case "table":
    case "xlsx": {
      // 試算表的匯入（`sheet/formats.ts`）：CSV 自動判斷編碼（含 Big5）、.xlsx／.xls／.ods
      const got = await readSpreadsheet(name, bytes);
      if (got.kind === "workbook") {
        if (!got.sheets.length) return { kind: "error", message: "This workbook has no sheets" };
        return { kind: "sheet", json: serializeWorkbook(addImported(newWorkbook(), got.sheets).wb) };
      }
      // 新試算表本來有一個空白表格，拿掉，只放匯入的表格
      const blank = newWorkbook().sheets[0];
      const wb = { sheets: [{ ...blank, name: baseName(name), tables: [] }] };
      return { kind: "sheet", json: serializeWorkbook(importTables(wb, blank.id, got.tables, 40).wb) };
    }
    case "docx": {
      const html = docxHtml(await unzip(bytes));
      if (html === null) return { kind: "error", message: "This file isn't a Word document" };
      return { kind: "html", html: DOMPurify.sanitize(html, PURIFY) as string };
    }
    case "pptx": {
      const slides = pptxSlides(await unzip(bytes));
      if (slides === null) return { kind: "error", message: "This file isn't a PowerPoint presentation" };
      return { kind: "slides", slides };
    }
    default: {
      // 不認得的副檔名：內容是文字就當純文字
      if (!looksText(bytes)) return { kind: "none" };
      const t = text();
      return { kind: "text", text: t.text, lang: "", cut: t.cut };
    }
  }
}

function Notice(props: { cut: boolean }) {
  return props.cut ? <div className="dr-pv-cut">Showing the first 2 MB of this file.</div> : null;
}

/** 文件裡的連結不能讓 App 的視窗跳走：攔下來交給 `onLink`（用瀏覽器打開）。 */
function catchLinks(onLink: (href: string) => void) {
  return (e: React.MouseEvent) => {
    const a = (e.target as Element).closest("a");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") ?? "";
    if (/^(https?:|mailto:)/i.test(href)) onLink(href);
  };
}

export function FilePreview(props: { name: string; src: string; onLink: (href: string) => void }) {
  const { name, src } = props;
  const kind = previewKind(name, src);
  const url = mediaUrl(src);
  const direct = kind === "image" || kind === "video" || kind === "audio" || kind === "pdf" || kind === "html";
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });

  useEffect(() => {
    if (direct) return;
    let live = true;
    setLoaded({ kind: "loading" });
    load(name, src).then(
      (l) => live && setLoaded(l),
      (e: unknown) => live && setLoaded({ kind: "error", message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [name, src, direct]);

  const code = useMemo(
    () => (loaded.kind === "text" ? (loaded.text.length <= MAX_HIGHLIGHT && loaded.lang ? highlightCode(loaded.text, loaded.lang) : null) : null),
    [loaded],
  );

  if (kind === "image") return <img src={url} alt={name} />;
  if (kind === "video") return <video src={url} controls />;
  if (kind === "audio") return <audio src={url} controls />;
  // HTML 不讓它跑程式（sandbox）
  if (kind === "pdf" || kind === "html") return <iframe src={url} title={name} sandbox={kind === "html" ? "" : undefined} />;

  switch (loaded.kind) {
    case "loading":
      return <div className="dr-empty">Opening…</div>;
    case "error":
      return (
        <div className="dr-empty">
          <strong>Can't open this file</strong>
          {loaded.message}
        </div>
      );
    case "none":
      return (
        <div className="dr-empty">
          <strong>Can't preview this file here</strong>
          Banyan opens text, code, Markdown, CSV, Excel (.xlsx), Word (.docx), PowerPoint (.pptx), PDF, images, audio and video.
        </div>
      );
    case "text":
      return (
        <div className="dr-pv-scroll">
          <Notice cut={loaded.cut} />
          <pre className="dr-pv-code">
            {code !== null ? <code className="hljs" dangerouslySetInnerHTML={{ __html: code }} /> : <code>{loaded.text}</code>}
          </pre>
        </div>
      );
    case "markdown":
    case "html":
      return (
        <div className="dr-pv-scroll">
          {loaded.kind === "markdown" && <Notice cut={loaded.cut} />}
          <div className="dr-pv-page content" onClick={catchLinks(props.onLink)} dangerouslySetInnerHTML={{ __html: loaded.html }} />
        </div>
      );
    case "sheet":
      return (
        <div className="dr-pv-sheet">
          <SheetView json={loaded.json} onModify={noop} />
        </div>
      );
    case "slides":
      return (
        <div className="dr-pv-scroll">
          {loaded.slides.length ? (
            <div className="dr-pv-slides">
              {loaded.slides.map((s, i) => (
                <div className="dr-pv-slide" key={i}>
                  <span className="dr-pv-num">{i + 1}</span>
                  {s.title && <h2>{s.title}</h2>}
                  {s.body.map((b, j) => (
                    <p key={j}>{b}</p>
                  ))}
                  {!s.title && !s.body.length && <p className="dr-pv-blank">No text on this slide</p>}
                </div>
              ))}
            </div>
          ) : (
            <div className="dr-empty">This presentation has no slides</div>
          )}
        </div>
      );
  }
}
