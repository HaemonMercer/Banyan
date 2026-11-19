import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarIcon, DocIcon, ImageIcon, ImportIcon, LinkIcon, ListIcon, PanelRightIcon, PlusIcon, RuleIcon, SearchIcon, TableIcon, VideoIcon } from "../editor/icons";
import { importWord, saveImported, withImportedText, WORD_IMPORT } from "./docImport";
import { GAP, PaperEditor } from "./PaperEditor";
import { DocFind } from "./DocFind";
import { countWords, DEFAULT_PAGE, docStats, FONTS, headingsOf, MARGINS, PAPERS, SIZES, SPACINGS, marginOf, paperOf, tocMarkdown, type PageSetup } from "./pageSetup";
import {
  Field,
  FormatInspector,
  Inspector,
  MenuItem,
  LayoutFormat,
  Popup,
  Section,
  Seg,
  SegBtn,
  TBtn,
  TextFormat,
  TMenu,
  Toolbar,
  useEditorRun,
  useEditorStatus,
  useFormatTab,
  usePanel,
  type StyleLib,
  type ParaStyle,
} from "./DocChrome";

/**
 * Word 文件（外觀參考 Apple Pages）：上方工具列（View、Zoom、Insert、Table、Media，右邊 Format、Document），
 * 中間是一張張紙（`PaperEditor`），右邊是檢閱器：Format（游標所在段落的文字格式）、
 * Document（紙張、邊界、頁首頁尾、字型、字級、行距、拼字檢查）。下方中間是字數（點了看詳細統計）。
 * Word 與 Google 文件共有的功能：尋找與取代（Ctrl＋F／H）、大綱、分頁符號、目錄、特殊字元、日期、列印。
 */

const STYLES: ParaStyle[] = [
  { type: "h1", label: "Title", cls: "s-title" },
  { type: "h2", label: "Heading", cls: "s-h2" },
  { type: "h3", label: "Subheading", cls: "s-h3" },
  { type: "paragraph", label: "Body", cls: "s-body" },
  { type: "quote", label: "Quote", cls: "s-quote" },
  { type: "code", label: "Code", cls: "s-code" },
];

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** Insert → Special Characters（常用的符號） */
const SYMBOLS = ["©", "®", "™", "°", "±", "×", "÷", "≠", "≤", "≥", "≈", "∞", "√", "π", "µ", "Ω", "€", "£", "¥", "¢", "§", "¶", "†", "•", "…", "–", "—", "«", "»", "“", "”", "‘", "’", "←", "→", "↑", "↓", "↔", "✓", "✗", "★", "☆", "♥", "½", "¼", "¾", "²", "³"];

const PAGE_BREAK = '<div class="page-break"></div>';

/** 拼字檢查開著嗎（個人偏好，存在 localStorage） */
function useSpell(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem("banyan.word.spell") === "1";
    } catch {
      return false;
    }
  });
  return [
    on,
    (v) => {
      setOn(v);
      try {
        localStorage.setItem("banyan.word.spell", v ? "1" : "0");
      } catch {
        /* 記不住也沒關係 */
      }
    },
  ];
}

export function WordView(props: { value: string; onChange: (md: string) => void; page: PageSetup | undefined; onPage: (p: PageSetup) => void; styles?: StyleLib }) {
  const scope = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const st = useEditorStatus(scope);
  const run = useEditorRun(scope);
  const setup = props.page ?? DEFAULT_PAGE;
  const set = (patch: Partial<PageSetup>) => props.onPage({ ...setup, ...patch });
  const [panel, setPanel] = usePanel<"format" | "document">("word", "format");
  const [fmtTab, setFmtTab] = useFormatTab("word");
  const [outline, setOutline] = usePanel<"on">("word-outline", null);
  // 匯入（`docImport.ts`）：接在文件最後面，原本是空的就換掉；圖片存到 media/
  const importRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  useEffect(() => {
    if (!importNote) return;
    const t = setTimeout(() => setImportNote(null), 5000);
    return () => clearTimeout(t);
  }, [importNote]);
  const valueRef = useRef(props.value);
  valueRef.current = props.value;
  const importFile = async (f: File) => {
    setImporting(true);
    try {
      const md = await importWord(f.name, new Uint8Array(await f.arrayBuffer()), saveImported);
      if (!md.trim()) setImportNote(`There was no text in ${f.name}`);
      else {
        props.onChange(withImportedText(valueRef.current, md));
        setImportNote(`Imported ${f.name}`);
      }
    } catch (err) {
      console.error("Import failed", err);
      setImportNote(`Couldn't import ${f.name}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
    }
  };
  const [zoom, setZoom] = useState(1);
  const [pages, setPages] = useState(1);
  const [at, setAt] = useState(1);
  const [find, setFind] = useState<{ replace: boolean } | null>(null);
  const [stats, setStats] = useState(false);
  const [spell, setSpell] = useSpell();
  const words = useMemo(() => countWords(props.value), [props.value]);
  const heads = useMemo(() => headingsOf(props.value), [props.value]);
  const paper = paperOf(setup);
  const STEP = paper.h + GAP;

  // 「第幾頁」：畫面中間是哪一頁
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => setAt(Math.max(1, Math.min(pages, Math.floor((el.scrollTop + el.clientHeight / 2 - 28) / (STEP * zoom)) + 1)));
    onScroll();
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [pages, zoom, STEP]);

  const fitWidth = () => {
    const el = scroller.current;
    if (el) setZoom(Math.round(Math.max(0.5, Math.min(2, (el.clientWidth - 48) / paper.w)) * 100) / 100);
  };
  // 打開時視窗比一頁窄：縮小到整頁寬度看得到（跟 Pages 的「符合寬度」一樣）
  useEffect(() => {
    const el = scroller.current;
    if (el && el.clientWidth - 48 < paper.w) fitWidth();
    // 只在打開時做一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 打開、關掉大綱後版面變窄（寬）：紙比畫面寬就縮到符合寬度
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const el = scroller.current;
      if (el && el.clientWidth - 48 < paper.w * zoom) fitWidth();
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outline]);

  // Ctrl＋F 尋找、Ctrl＋H 取代（焦點在這份文件裡時）
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k !== "f" && k !== "h") return;
      const a = document.activeElement;
      const here = scope.current;
      if (!here || !(here.contains(a) || here.contains(document.getSelection()?.anchorNode ?? null) || a === document.body)) return;
      e.preventDefault();
      e.stopPropagation();
      setFind({ replace: k === "h" });
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);

  /** 在游標處打字（編輯中）或在後面加一段（沒在編輯） */
  const insertText = (text: string) => {
    if (st.active && st.editing) document.execCommand("insertText", false, text);
    else run((c) => c.insertMarkdown(text));
  };
  const today = () => new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  /** 大綱：點了捲到第 i 個標題 */
  const jump = (i: number) => {
    const hs = scope.current?.querySelectorAll<HTMLElement>(".paper-flow .content h1, .paper-flow .content h2, .paper-flow .content h3");
    hs?.[i]?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const m = marginOf(setup);
  const s = stats ? docStats(props.value) : null;

  return (
    <div className="office word-office" ref={scope}>
      <Toolbar>
        <TMenu icon={<ListIcon />} label="View" title="Outline, find and replace">
          {(close) => (
            <>
              <MenuItem label="Document Outline" current={outline === "on"} onClick={() => (close(), setOutline(outline ? null : "on"))} />
              <MenuItem label="Find & Replace" hint="Ctrl+F" onClick={() => (close(), setFind({ replace: false }))} />
            </>
          )}
        </TMenu>
        <TMenu icon={<SearchIcon />} label={`${Math.round(zoom * 100)}%`} title="Zoom">
          {(close) => (
            <>
              {ZOOMS.map((z) => (
                <MenuItem key={z} label={`${z * 100}%`} current={z === zoom} onClick={() => (close(), setZoom(z))} />
              ))}
              <div className="popover-sep" />
              <MenuItem label="Fit Width" onClick={() => (close(), fitWidth())} />
            </>
          )}
        </TMenu>
        <span className="dc-sep" />
        <TMenu icon={<PlusIcon />} label="Insert" title="Insert a page break, contents, a line, a link or a date">
          {(close) => (
            <>
              <MenuItem label="Page Break" onClick={() => (close(), run((c) => c.insertMarkdown(PAGE_BREAK)))} />
              <MenuItem
                label="Table of Contents"
                onClick={() => {
                  close();
                  const toc = tocMarkdown(props.value);
                  run((c) => c.insertMarkdown(toc || "**Contents**\n\nAdd headings (Title, Heading, Subheading) to build the contents."));
                }}
              />
              <MenuItem icon={<RuleIcon />} label="Horizontal Line" onClick={() => (close(), run((c) => c.insert("hr")))} />
              <div className="popover-sep" />
              <MenuItem icon={<LinkIcon />} label="Link" hint="Ctrl+K" onClick={() => (close(), run((c) => c.mark("link")))} />
              <MenuItem icon={<CalendarIcon />} label="Date" hint={today()} onClick={() => (close(), insertText(today()))} />
            </>
          )}
        </TMenu>
        <TMenu icon={<span className="dc-omega">Ω</span>} label="Symbol" title="Insert a special character">
          {(close) => (
            <div className="dc-symbols">
              {SYMBOLS.map((c) => (
                <button key={c} title={`Insert ${c}`} onClick={() => (close(), insertText(c))}>
                  {c}
                </button>
              ))}
            </div>
          )}
        </TMenu>
        <TBtn icon={<TableIcon />} label="Table" title="Insert a table" onClick={() => run((c) => c.insert("table"))} />
        <TMenu icon={<ImageIcon />} label="Media" title="Insert a picture or a video">
          {(close) => (
            <>
              <MenuItem icon={<ImageIcon />} label="Photo or Image…" onClick={() => (close(), run((c) => c.insert("image")))} />
              <MenuItem icon={<VideoIcon />} label="Video…" onClick={() => (close(), run((c) => c.insert("video")))} />
            </>
          )}
        </TMenu>
        <TBtn
          icon={<ImportIcon />}
          label={importing ? "Importing…" : "Import"}
          title="Add a document's text at the end: Word (.docx, .doc), OpenDocument (.odt), RTF, web page (.html), Markdown or plain text"
          disabled={importing}
          onClick={() => importRef.current?.click()}
        />
        <input
          ref={importRef}
          type="file"
          accept={WORD_IMPORT}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void importFile(f);
          }}
        />
        <span className="dc-gap" />
        <TBtn icon={<PanelRightIcon />} label="Format" title="Show or hide the Format inspector" on={panel === "format"} onClick={() => setPanel(panel === "format" ? null : "format")} />
        <TBtn icon={<DocIcon />} label="Document" title="Show or hide the Document inspector" on={panel === "document"} onClick={() => setPanel(panel === "document" ? null : "document")} />
      </Toolbar>
      {importNote && (
        <div className="dp-note" role="status">
          {importNote}
        </div>
      )}
      <div className="dc-main">
        {outline && (
          <nav className="dc-outline editor-ui" aria-label="Document outline">
            <h4>Outline</h4>
            {heads.length ? (
              heads.map((h, i) => (
                <button key={i} className={`l${h.level}`} title={h.text} onClick={() => jump(i)}>
                  {h.text}
                </button>
              ))
            ) : (
              <p className="dc-empty">Headings you add appear here.</p>
            )}
          </nav>
        )}
        <div className="dc-doc">
          <div className="office-scroll" ref={scroller}>
            <PaperEditor value={props.value} onChange={props.onChange} setup={setup} zoom={zoom} onPages={setPages} formatBar={false} spellCheck={spell} />
          </div>
          {find && (
            <DocFind
              root={() => scope.current?.querySelector<HTMLElement>(".paper-flow") ?? null}
              source={props.value}
              onReplace={props.onChange}
              replace={find.replace}
              onClose={() => setFind(null)}
            />
          )}
          <div className="dc-count" aria-live="polite">
            <button onClick={() => setStats((v) => !v)} title="Word count details">
              {words.toLocaleString("en-US")} {words === 1 ? "word" : "words"}
            </button>{" "}
            · Page {Math.min(at, pages)} of {pages}
          </div>
          {s && (
            <div className="dc-stats" role="dialog" aria-label="Word count" onClick={() => setStats(false)}>
              <div>
                <span>Words</span>
                <b>{s.words.toLocaleString("en-US")}</b>
              </div>
              <div>
                <span>Characters</span>
                <b>{s.chars.toLocaleString("en-US")}</b>
              </div>
              <div>
                <span>Characters (no spaces)</span>
                <b>{s.charsNoSpace.toLocaleString("en-US")}</b>
              </div>
              <div>
                <span>Paragraphs</span>
                <b>{s.paragraphs.toLocaleString("en-US")}</b>
              </div>
              <div>
                <span>Pages</span>
                <b>{pages}</b>
              </div>
            </div>
          )}
        </div>
        {panel === "format" && (
          // Word 只有文字（沒有可以自由擺放的物件）：Style（文字）與 Layout 兩個分頁，跟 Pages 一樣
          <FormatInspector tabs={["text", "layout"]} tab={fmtTab} onTab={setFmtTab}>
            {(t) =>
              t === "text" ? (
                <TextFormat st={st} run={run} styles={STYLES} lib={props.styles} code />
              ) : (
                <LayoutFormat st={st} run={run} checklist shading />
              )
            }
          </FormatInspector>
        )}
        {panel === "document" && (
          <Inspector title="Document">
            <Section title="Printer & Paper Size">
              <Field label="Paper">
                <Popup label="Paper size" value={setup.paper ?? "a4"} options={PAPERS.map((p) => ({ id: p.id, label: p.label, hint: p.hint }))} onPick={(id) => set({ paper: id === "a4" ? undefined : id })} />
              </Field>
              <Field label="Orientation">
                <Seg label="Orientation">
                  <SegBtn title="Portrait" wide on={!setup.landscape} onClick={() => set({ landscape: undefined })}>
                    Portrait
                  </SegBtn>
                  <SegBtn title="Landscape" wide on={!!setup.landscape} onClick={() => set({ landscape: true })}>
                    Landscape
                  </SegBtn>
                </Seg>
              </Field>
            </Section>
            <Section title="Document Margins">
              <Popup label="Margins" value={setup.margin} options={MARGINS.map((x) => ({ id: x.id, label: x.label, hint: x.hint }))} onPick={(id) => set({ margin: id })} />
              <div className="dc-margins">
                <span>Top {(m.tb / 96).toFixed(2)} in</span>
                <span>Bottom {(m.tb / 96).toFixed(2)} in</span>
                <span>Left {(m.lr / 96).toFixed(2)} in</span>
                <span>Right {(m.lr / 96).toFixed(2)} in</span>
              </div>
            </Section>
            <Section title="Header & Footer">
              <TextSetting label="Header" value={setup.header ?? ""} onSet={(v) => set({ header: v || undefined })} />
              <TextSetting label="Footer" value={setup.footer ?? ""} onSet={(v) => set({ footer: v || undefined })} />
              <label className="dc-check">
                <input type="checkbox" checked={setup.numbers !== false} onChange={(e) => set({ numbers: e.target.checked ? undefined : false })} /> Page numbers
              </label>
              <p className="dc-note">Type {"{page}"} or {"{pages}"} for the page number and page count.</p>
            </Section>
            <Section title="Body Text">
              <Field label="Font">
                <Popup
                  label="Font"
                  value={setup.font}
                  options={FONTS.map((f) => ({ id: f.id, label: f.label, render: <span style={{ fontFamily: f.css }}>{f.label}</span> }))}
                  onPick={(id) => set({ font: id })}
                />
              </Field>
              <Field label="Size">
                <Popup label="Font size" value={setup.size} options={SIZES.map((n) => ({ id: n, label: `${n} pt` }))} onPick={(n) => set({ size: n })} />
              </Field>
              <Field label="Spacing">
                <Popup
                  label="Line spacing"
                  value={setup.spacing}
                  options={SPACINGS.map((n) => ({ id: n, label: `${n === 1.15 ? n.toFixed(2) : n.toFixed(1)} – Lines` }))}
                  onPick={(n) => set({ spacing: n })}
                />
              </Field>
              <p className="dc-note">Applies to the whole document and to the exported .docx.</p>
            </Section>
            <Section title="Proofing">
              <label className="dc-check" style={{ marginTop: 0 }}>
                <input type="checkbox" checked={spell} onChange={(e) => setSpell(e.target.checked)} /> Check spelling while typing
              </label>
            </Section>
          </Inspector>
        )}
      </div>
    </div>
  );
}

/** 檢閱器裡的一行文字設定：離開或 Enter 才存 */
function TextSetting(props: { label: string; value: string; onSet: (v: string) => void }) {
  return (
    <Field label={props.label}>
      <input
        className="dc-input"
        key={props.value}
        defaultValue={props.value}
        placeholder="None"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        onBlur={(e) => e.target.value.trim() !== props.value && props.onSet(e.target.value.trim())}
      />
    </Field>
  );
}
