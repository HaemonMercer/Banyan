import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { editorBus, Swatches, type EditorCommands, type EditorStatus } from "../editor/Editor";
import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon, IndentIcon, LinkIcon, OutdentIcon } from "../editor/icons";
import type { BlockType } from "../editor/ops";
import type { Color } from "../editor/inline";
import {
  BLOCK_FONTS,
  BORDER_COLORS,
  charOnly,
  removeCharStyle,
  renameCharStyle,
  blockStyleCss,
  cleanStyleName,
  formatBlockStyle,
  freeStyleName,
  parseBlockStyle,
  patchBlockStyle,
  styleModified,
  type BlockStyle,
  type SavedStyle,
  type Sides,
} from "../editor/blockStyle";
import type { BoxValue } from "../editor/layout";
import { changeCharStyles, useCharStyles } from "./styleLibrary";

/**
 * Word 與簡報的外框（參考 Apple 的 Pages、Keynote）：
 * - 上方工具列：圖示在上、名稱在下的按鈕（Insert、Table、Media…），右邊是開關檢閱器的 Format、Document；
 * - 右邊的檢閱器（Inspector）：Format 分成 Text（Word 叫 Style）、Layout，簡報另有 Style、Arrange（`FormatInspector`），跟著游標所在的段落。
 *
 * 按鈕透過 `editorBus` 操作文件裡的編輯器：編輯中就作用在選取的文字／這個段落，
 * 選了區塊就作用在選取的區塊。工具列與檢閱器有 `editor-ui` class，mousedown 時 preventDefault：
 * 按下去不會結束編輯、不會搶走焦點（輸入框、下拉選單除外）。
 */

const keepFocus = (e: React.MouseEvent) => {
  if (!(e.target as HTMLElement).closest("input, select, textarea")) e.preventDefault();
};

export function Toolbar(props: { children: ReactNode }) {
  return (
    <div className="dc-toolbar editor-ui no-box" role="toolbar" onMouseDown={keepFocus}>
      {props.children}
    </div>
  );
}

/** 工具列的按鈕：圖示在上、名稱在下（Pages、Keynote 的樣子） */
export function TBtn(props: { icon: ReactNode; label: string; title: string; on?: boolean; disabled?: boolean; accent?: boolean; onClick: () => void }) {
  return (
    <button
      className={`dc-tbtn${props.on ? " on" : ""}${props.accent ? " accent" : ""}`}
      title={props.title}
      aria-pressed={props.on === undefined ? undefined : props.on}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <span className="dc-ticon">{props.icon}</span>
      <span className="dc-tlabel">{props.label}</span>
    </button>
  );
}

/** 有下拉選單的工具列按鈕 */
export function TMenu(props: { icon: ReactNode; label: string; title: string; disabled?: boolean; children: (close: () => void) => ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, open, () => setOpen(false));
  return (
    <div className="dc-menu-wrap" ref={ref}>
      <button className={`dc-tbtn${open ? " on" : ""}`} title={props.title} aria-haspopup="menu" aria-expanded={open} disabled={props.disabled} onClick={() => setOpen((v) => !v)}>
        <span className="dc-ticon">{props.icon}</span>
        <span className="dc-tlabel">
          {props.label} <span className="dc-caret">▾</span>
        </span>
      </button>
      {open && (
        <div className={`popover block-menu dc-menu${props.align === "right" ? " right" : ""}`} role="menu">
          {props.children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function useOutside(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close();
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
    };
  });
}

/** 選單裡的一項（打勾表示目前的） */
export function MenuItem(props: { label: ReactNode; hint?: string; icon?: ReactNode; current?: boolean; onClick: () => void }) {
  return (
    <button role="menuitem" className={props.current ? "current" : ""} onClick={props.onClick}>
      {props.icon && <span className="glyph">{props.icon}</span>}
      <span className="label">{props.label}</span>
      {props.hint && <span className="hint">{props.hint}</span>}
      {props.current && <span className="check">✓</span>}
    </button>
  );
}

/** 右邊的檢閱器：上方是分頁（只有一頁就是標題），下面是一段一段的設定 */
export function Inspector(props: { title: string; children: ReactNode; tabs?: { id: string; label: string }[]; tab?: string; onTab?: (id: string) => void }) {
  return (
    <aside className="dc-insp editor-ui no-box" onMouseDown={keepFocus} aria-label={props.title}>
      {props.tabs ? (
        <div className="dc-insp-tabs" role="tablist">
          {props.tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={t.id === props.tab} className={t.id === props.tab ? "on" : ""} onClick={() => props.onTab?.(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="dc-insp-title">{props.title}</div>
      )}
      <div className="dc-insp-body">{props.children}</div>
    </aside>
  );
}

export function Section(props: { title?: string; children: ReactNode }) {
  return (
    <section className="dc-sec">
      {props.title && <h4>{props.title}</h4>}
      {props.children}
    </section>
  );
}

/** 一行：左邊名稱、右邊控制項 */
export function Field(props: { label: string; children: ReactNode }) {
  return (
    <div className="dc-field">
      <span>{props.label}</span>
      <div className="dc-field-ctl">{props.children}</div>
    </div>
  );
}

/** 分段按鈕（對齊、縮排…） */
export function Seg(props: { children: ReactNode; label: string }) {
  return (
    <div className="dc-seg" role="group" aria-label={props.label}>
      {props.children}
    </div>
  );
}

export function SegBtn(props: { title: string; on?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <button className={`${props.on ? "on" : ""}${props.wide ? " wide" : ""}`} title={props.title} aria-label={props.title} aria-pressed={props.on} disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

/** 像 macOS 彈出式選單的按鈕：顯示目前的值，點了列出選項 */
export function Popup<T extends string | number>(props: {
  value: T | null;
  options: { id: T; label: string; render?: ReactNode; hint?: string }[];
  placeholder?: string;
  disabled?: boolean;
  big?: boolean;
  label: string;
  onPick: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, open, () => setOpen(false));
  const cur = props.options.find((o) => o.id === props.value);
  return (
    <div className={`dc-popup${props.big ? " big" : ""}`} ref={ref}>
      <button aria-label={props.label} aria-haspopup="listbox" aria-expanded={open} disabled={props.disabled} onClick={() => setOpen((v) => !v)}>
        <span className="dc-popup-val">{cur ? cur.label : (props.placeholder ?? "—")}</span>
        <span className="dc-caret">⌄</span>
      </button>
      {open && (
        <div className="popover block-menu dc-menu dc-popup-menu" role="listbox">
          {props.options.map((o) => (
            <MenuItem
              key={String(o.id)}
              label={o.render ?? o.label}
              hint={o.hint}
              current={o.id === props.value}
              onClick={() => {
                setOpen(false);
                props.onPick(o.id);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** 顏色按鈕：一個色塊，點了列出顏色 */
function ColorWell(props: { kind: "color" | "highlight" | "bg"; value: Color | null; disabled?: boolean; title: string; onPick: (c: Color | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, open, () => setOpen(false));
  const cls = props.value ? `${props.kind === "color" ? "tc" : props.kind === "highlight" ? "hl" : "bg"}-${props.value}` : "";
  return (
    <div className="dc-well-wrap" ref={ref}>
      <button className="dc-well" title={props.title} aria-label={props.title} disabled={props.disabled} onClick={() => setOpen((v) => !v)}>
        <span className={`dc-well-swatch ${props.kind} ${cls}`}>{props.kind === "bg" ? "" : "A"}</span>
        <span className="dc-caret">⌄</span>
      </button>
      {open && (
        <div className="popover dc-menu dc-swatch-menu right">
          <Swatches
            kind={props.kind}
            value={props.value}
            onPick={(c) => {
              setOpen(false);
              props.onPick(c);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** 文件裡的編輯器的狀態；active 是最後操作的編輯器在這份文件（scope）裡 */
export function useEditorStatus(scope: RefObject<HTMLElement | null>): EditorStatus & { active: boolean } {
  const st = useSyncExternalStore(editorBus.subscribe, editorBus.status);
  return { ...st, active: !!(st.root && scope.current?.contains(st.root)) };
}

/** 對文件裡的編輯器下指令；還沒操作過文件就先讓它成為最後操作的編輯器 */
export function useEditorRun(scope: RefObject<HTMLElement | null>) {
  return (fn: (c: EditorCommands) => void) => {
    const el = scope.current;
    if (!el) return;
    if (!editorBus.run(el, fn) && editorBus.focusWithin(el)) editorBus.run(el, fn);
  };
}

type Status = EditorStatus & { active: boolean };
type Run = (fn: (c: EditorCommands) => void) => void;

export type ParaStyle = { type: BlockType; label: string; cls: string };

const MARKS = [
  { mark: "bold", title: "Bold (Ctrl+B)", icon: <b>B</b> },
  { mark: "italic", title: "Italic (Ctrl+I)", icon: <i style={{ fontFamily: "Georgia, serif" }}>I</i> },
  { mark: "underline", title: "Underline (Ctrl+U)", icon: <u>U</u> },
  { mark: "strike", title: "Strikethrough (Ctrl+Shift+X)", icon: <s>S</s> },
  { mark: "sup", title: "Superscript (Ctrl+.)", icon: <span className="fb-script">x<sup>2</sup></span> },
  { mark: "sub", title: "Subscript (Ctrl+,)", icon: <span className="fb-script">x<sub>2</sub></span> },
] as const;

const LISTS: { id: BlockType; label: string }[] = [
  { id: "paragraph", label: "None" },
  { id: "bullet", label: "Bullet" },
  { id: "ordered", label: "Numbered" },
  { id: "todo", label: "Checklist" },
];

/* ─── 檢閱器的 Format 分頁（參考 Pages／Keynote） ─── */

/**
 * Format 檢閱器的分頁（Word 只有 Text 與 Layout，Text 分頁在 Word 叫「Style」，跟 Pages 一樣）：
 * - Text：段落樣式、字元樣式、字型（字型、字級、字距、粗斜體、底線、刪除線、上下標、顏色、螢光、程式碼、連結）、清除格式。
 *   規則只有一條：有選取文字就作用在選取的字，沒有就作用在整段（存在區塊樣式裡，`editor/blockStyle.ts`）。
 * - Layout：對齊、縮排、清單、間距（行距、段前、段後）、左右縮排、框線與底色（框線、圓角、內距、底色）。
 * - Style：簡報的投影片背景、物件的填色與框線（Word 沒有）。
 * - Arrange：物件的位置、大小、旋轉、對齊與上下層（只有簡報選了物件時有）。
 * 跟著游標所在（或選取）的段落；Word 和簡報共用。
 */
export type FormatTab = "style" | "text" | "layout" | "arrange";

const TAB_LABELS: Record<FormatTab, string> = { style: "Style", text: "Text", layout: "Layout", arrange: "Arrange" };

/** 記住上次看的分頁（每種文件一份）；看的分頁這次沒有（例如沒選物件的 Arrange）就顯示第一個 */
export function useFormatTab(key: string, initial: FormatTab = "text"): [FormatTab, (t: FormatTab) => void] {
  const [tab, setTab] = usePanel<FormatTab>(`${key}-format-tab`, initial);
  return [tab ?? initial, setTab];
}

/** 有分頁的 Format 檢閱器：tabs 是這次可以看的分頁（依順序）；沒有 Style 分頁時 Text 分頁叫「Style」（Pages 的叫法） */
export function FormatInspector(props: { tabs: FormatTab[]; tab: FormatTab; onTab: (t: FormatTab) => void; children: (tab: FormatTab) => ReactNode }) {
  const shown = props.tabs.includes(props.tab) ? props.tab : props.tabs[0];
  const label = (t: FormatTab) => (t === "text" && !props.tabs.includes("style") ? "Style" : TAB_LABELS[t]);
  return (
    <Inspector title="Format" tabs={props.tabs.map((t) => ({ id: t, label: label(t) }))} tab={shown} onTab={(id) => props.onTab(id as FormatTab)}>
      {props.children(shown)}
    </Inspector>
  );
}

/** 游標不在文字裡時的提示 */
function NeedText(props: { hint?: string }) {
  return (
    <Section>
      <p className="dc-empty">{props.hint ?? "Click in the text, or select some paragraphs, to format them."}</p>
    </Section>
  );
}

const canFormat = (st: Status) => st.active && (st.editing || st.selected > 0);

/** 小的「⋯」選單：樣式的新增、更新、改名、刪除這類不常用的動作 */
function MoreMenu(props: { label: string; items: { label: string; title?: string; disabled?: boolean; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, open, () => setOpen(false));
  const items = props.items.filter((x) => !x.disabled);
  return (
    <div className="dc-more-wrap" ref={ref}>
      <button className="dc-more" title={props.label} aria-label={props.label} aria-haspopup="menu" aria-expanded={open} disabled={!items.length} onClick={() => setOpen((v) => !v)}>
        ⋯
      </button>
      {open && (
        <div className="popover block-menu dc-menu dc-more-menu" role="menu">
          {items.map((x) => (
            <MenuItem
              key={x.label}
              label={<span title={x.title}>{x.label}</span>}
              onClick={() => {
                setOpen(false);
                x.onClick();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 已存的樣式（每份文件都能用，`styleLibrary.ts`）。
 * change 一次改好樣式清單與所有文件裡用到它的區塊（restyle 對每個區塊樣式算出新的，null 是拿掉）。
 */
export interface StyleLib {
  styles: SavedStyle[];
  change: (styles: SavedStyle[], restyle?: (v: BoxValue) => BoxValue | null) => void;
}

/**
 * Text 分頁（Word 叫 Style）：段落樣式、字元樣式、字型、清除格式。
 * 粗斜體、底線、刪除線與文字顏色：有選取文字就作用在選取的字，沒有就作用在整段。
 */
export function TextFormat(props: { st: Status; run: Run; styles: ParaStyle[]; lib?: StyleLib; code?: boolean; hint?: string }) {
  const { st, run } = props;
  if (!canFormat(st)) return <NeedText hint={props.hint} />;
  const sel = st.editing && st.textSel;
  const rich = st.active && st.editing && st.formattable;
  const m = st.marks;
  const s: BlockStyle = parseBlockStyle(st.box);
  const set = (patch: Partial<BlockStyle>) => run((c) => c.box((v) => ({ ...v, css: patchBlockStyle(v.css, patch) })));
  /** 標題本來就是粗體：整段的粗體按鈕對標題是切換成「一般」 */
  const heading = st.type === "h1" || st.type === "h2" || st.type === "h3";
  const paraBold = s.weight ? s.weight === "bold" : heading;
  const many = !st.editing && st.selected > 1;
  /** 粗斜體、底線、刪除線：有選取作用在選取的字，沒有就是整段 */
  const toggle = (mark: "bold" | "italic" | "underline" | "strike") => {
    if (sel) return run((c) => c.mark(mark));
    if (mark === "bold") return set({ weight: paraBold ? (heading ? "normal" : undefined) : heading ? undefined : "bold" });
    set({ [mark]: !s[mark] || undefined });
  };
  const on = (mark: "bold" | "italic" | "underline" | "strike") => (sel ? !!m?.[mark] : mark === "bold" ? paraBold : !!s[mark]);
  const saved = props.lib?.styles.find((x) => x.name === st.boxName);
  return (
    <>
      {many && (
        <Section>
          <p className="dc-note">Showing the first selected paragraph. Changes apply to all {st.selected}.</p>
        </Section>
      )}
      <ParagraphStyles st={st} run={run} styles={props.styles} lib={props.lib} />
      <CharStyles st={st} run={run} text={rich} />
      <Section title="Font">
        <Popup
          label="Font"
          value={s.font ?? ""}
          options={[{ id: "", label: "Default" }, ...BLOCK_FONTS.map((f) => ({ id: f.css, label: f.label, render: <span style={{ fontFamily: f.css }}>{f.label}</span> }))]}
          onPick={(font) => set({ font: font || undefined })}
        />
        <div className="dc-nums">
          <PtField label="Size (pt)" value={s.size} placeholder="Default" onSet={(size) => set({ size: size || undefined })} />
          <PtField label="Spacing (pt)" value={s.tracking} step={0.5} onSet={(tracking) => set({ tracking: tracking || undefined })} />
        </div>
        <div className="dc-row dc-font-row">
          <Seg label="Character style">
            {(MARKS.slice(0, 4) as unknown as { mark: "bold" | "italic" | "underline" | "strike"; title: string; icon: ReactNode }[]).map((x) => (
              <SegBtn key={x.mark} title={`${x.title}${sel ? "" : " — whole paragraph"}`} on={on(x.mark)} disabled={sel && !rich} onClick={() => toggle(x.mark)}>
                {x.icon}
              </SegBtn>
            ))}
          </Seg>
          <ColorWell
            kind="color"
            value={sel ? (m?.color ?? null) : ((s.color as Color | undefined) ?? null)}
            title={sel ? "Text color" : "Text color — whole paragraph"}
            onPick={(c) => (sel ? run((x) => x.color("color", c)) : set({ color: c ?? undefined }))}
          />
        </div>
        <div className="dc-row dc-font-row">
          <Seg label="More text styles">
            {MARKS.slice(4).map((x) => (
              <SegBtn key={x.mark} title={x.title} on={!!m?.[x.mark]} disabled={!rich} onClick={() => run((c) => c.mark(x.mark))}>
                {x.icon}
              </SegBtn>
            ))}
            {props.code && (
              <SegBtn title="Inline code (Ctrl+E)" on={!!m?.code} disabled={!rich} onClick={() => run((c) => c.mark("code"))}>
                <span className="dc-mono">{"</>"}</span>
              </SegBtn>
            )}
            <SegBtn title="Link (Ctrl+K)" on={!!m?.link} disabled={!rich} onClick={() => run((c) => c.mark("link"))}>
              <LinkIcon />
            </SegBtn>
          </Seg>
          <ColorWell kind="highlight" value={m?.highlight ?? null} disabled={!sel || !rich} title="Highlight (select some text)" onPick={(c) => run((x) => x.color("highlight", c))} />
        </div>
        <p className="dc-note">{sel ? "Changes apply to the selected text." : "Nothing selected: changes apply to the whole paragraph."}</p>
      </Section>
      <Section>
        <button
          className="dp-btn"
          disabled={sel ? !rich : !st.box || (!!saved && !styleModified(props.lib!.styles, saved.name, st.box))}
          title={sel ? "Remove bold, italic, colors and other text styles from the selection" : "Remove this paragraph's own font, spacing and border (back to its paragraph style)"}
          onClick={() => {
            if (sel) document.execCommand("removeFormat");
            else run((c) => c.box(() => (saved ? { css: saved.css, name: saved.name } : { css: "" })));
          }}
        >
          Clear Formatting
        </button>
      </Section>
    </>
  );
}

/**
 * 段落樣式（參考 Pages 的段落樣式選單）：一個選單裡有內建的（標題、內文、引言…，只換段落類型）與
 * 已存的（`StyleLib`，所有文件共用；段落類型＋區塊樣式）。
 * - 選已存的：寫上它的區塊樣式與名稱，有記段落類型就一起換；
 * - 從已存的換成內建的：拿掉那個樣式的區塊樣式，沒套用已存的就只換類型；
 * - 區塊改過（區塊樣式跟已存的不一樣）：選單下面一行「Update／Revert」；
 * - 「⋯」：New Style（用這個段落現在的類型與樣子）、Rename、Delete（段落保留樣子，不再連到樣式）。
 */
function ParagraphStyles(props: { st: Status; run: Run; styles: ParaStyle[]; lib?: StyleLib }) {
  const { st, run, lib } = props;
  const [naming, setNaming] = useState<"new" | "rename" | null>(null);
  const saved = lib?.styles ?? [];
  const cur = saved.find((x) => x.name === st.boxName) ?? null;
  const modified = !!cur && styleModified(saved, cur.name, st.box);
  const builtIn = props.styles.find((s) => s.type === st.type);
  const clsOf = (t?: BlockType) => props.styles.find((s) => s.type === t)?.cls ?? "s-body";
  const apply = (x: SavedStyle) =>
    run((c) => {
      c.box(() => ({ css: x.css, name: x.name }));
      if (x.type && x.type !== st.type) c.turnInto(x.type);
    });
  const update = () => {
    if (!lib || !cur) return;
    const css = formatBlockStyle(parseBlockStyle(st.box));
    lib.change(
      saved.map((x) => (x.name === cur.name ? { ...x, css } : x)),
      (v) => (v.name === cur.name ? { ...v, css } : v),
    );
  };
  const finish = (raw: string) => {
    const mode = naming;
    setNaming(null);
    if (!lib || !mode || !cleanStyleName(raw)) return;
    if (mode === "new") {
      const name = freeStyleName(saved, raw);
      const type = st.type ?? undefined;
      lib.change([...saved, { name, css: formatBlockStyle(parseBlockStyle(st.box)), ...(type ? { type } : {}) }]);
      run((c) => c.box((v) => ({ ...v, name })));
    } else if (cur) {
      const name = freeStyleName(saved, raw, cur.name);
      if (name === cur.name) return;
      lib.change(
        saved.map((x) => (x.name === cur.name ? { ...x, name } : x)),
        (v) => (v.name === cur.name ? { ...v, name } : v),
      );
    }
  };
  return (
    <Section title="Paragraph Style">
      <div className="dc-style-line">
        <Popup
          big
          label="Paragraph style"
          value={cur ? `s:${cur.name}` : !st.boxName && builtIn ? `t:${builtIn.type}` : null}
          placeholder={
            st.boxName ? `${st.boxName} (missing)` : st.type === "bullet" || st.type === "ordered" || st.type === "todo" ? "List" : "Mixed"
          }
          options={[
            ...props.styles.map((s) => ({ id: `t:${s.type}`, label: s.label, render: <span className={`dc-style ${s.cls}`}>{s.label}</span> })),
            ...saved.map((x) => ({
              id: `s:${x.name}`,
              label: modified && x.name === cur?.name ? `${x.name}*` : x.name,
              hint: "Saved",
              render: (
                <span className={`dc-style dc-style-sample ${clsOf(x.type)}`} style={blockStyleCss(x.css)}>
                  {x.name}
                </span>
              ),
            })),
          ]}
          onPick={(id) => {
            if (id.startsWith("s:")) {
              const x = saved.find((y) => y.name === id.slice(2));
              if (x) apply(x);
              return;
            }
            const t = id.slice(2) as BlockType;
            run((c) => {
              if (st.boxName) c.box(() => ({ css: "" }));
              c.turnInto(t);
            });
          }}
        />
        {lib && (
          <MoreMenu
            label="Paragraph style actions"
            items={[
              { label: "New Style from Paragraph…", title: "Save this paragraph's type and look as a style you can use in any document", onClick: () => setNaming("new") },
              { label: `Update “${cur?.name}”`, disabled: !modified, title: "Change the style to look like this paragraph, everywhere it's used", onClick: update },
              { label: "Revert to Style", disabled: !modified, onClick: () => cur && apply(cur) },
              { label: "Rename Style…", disabled: !cur, onClick: () => setNaming("rename") },
              {
                label: "Delete Style",
                disabled: !cur,
                title: "Paragraphs that use it keep their look",
                onClick: () => cur && lib.change(saved.filter((x) => x.name !== cur.name), (v) => (v.name === cur.name ? { css: v.css } : v)),
              },
            ]}
          />
        )}
      </div>
      {modified && !naming && (
        <div className="dc-style-mod">
          <span>Changed from the style</span>
          <button className="dc-link-btn" onClick={update} title={`Change “${cur!.name}” everywhere it's used`}>
            Update
          </button>
          <button className="dc-link-btn" onClick={() => apply(cur!)}>
            Revert
          </button>
        </div>
      )}
      {naming && <NameInput initial={naming === "rename" && cur ? cur.name : freeStyleName(saved, "Style")} onDone={finish} />}
    </Section>
  );
}

/**
 * 字元樣式（參考 Pages）：套用在選取的文字（`<span data-cs="名稱">`），所有文件共用（`styleLibrary.ts`）。
 * 樣子在共用的樣式表裡，改樣式設定所有用到它的字一起變。「⋯」：New Style（用選取文字的粗斜體、底線、
 * 刪除線、顏色建一個並套用；用預設名稱，打名字的輸入框會讓編輯器失去選取）、Edit（展開設定）、Rename、Delete。
 */
function CharStyles(props: { st: Status; run: Run; text: boolean }) {
  const { st, run, text } = props;
  const list = useCharStyles();
  const [naming, setNaming] = useState(false);
  const [editing, setEditing] = useState(false);
  const m = st.marks;
  const curName = m?.charStyle ?? null;
  const cur = list.find((x) => x.name === curName) ?? null;
  const s: BlockStyle = cur ? parseBlockStyle(cur.css) : {};
  const NONE = "\u0000none";
  const edit = (patch: Partial<BlockStyle>) =>
    cur && changeCharStyles(list.map((x) => (x.name === cur.name ? { ...x, css: formatBlockStyle(charOnly({ ...parseBlockStyle(x.css), ...patch })) } : x)));
  const create = () => {
    const name = freeStyleName(list, "Character Style");
    const css = formatBlockStyle(
      charOnly({
        weight: m?.bold ? "bold" : undefined,
        italic: m?.italic || undefined,
        underline: m?.underline || undefined,
        strike: m?.strike || undefined,
        color: m?.color ?? undefined,
      }),
    );
    changeCharStyles([...list, { name, css }]);
    run((c) => c.charStyle(name));
  };
  const finish = (raw: string) => {
    setNaming(false);
    if (!cur || !cleanStyleName(raw)) return;
    const name = freeStyleName(list, raw, cur.name);
    if (name === cur.name) return;
    changeCharStyles(
      list.map((x) => (x.name === cur.name ? { ...x, name } : x)),
      (src) => renameCharStyle(src, cur.name, name),
    );
  };
  return (
    <Section title="Character Style">
      <div className="dc-style-line">
        <Popup
          label="Character style"
          disabled={!text}
          value={cur ? cur.name : curName ? null : NONE}
          placeholder={curName ? `${curName} (missing)` : "None"}
          options={[
            { id: NONE, label: "None" },
            ...list.map((x) => ({
              id: x.name,
              label: x.name,
              render: (
                <span className="dc-style-sample" style={blockStyleCss(formatBlockStyle(charOnly(parseBlockStyle(x.css))))}>
                  {x.name}
                </span>
              ),
            })),
          ]}
          onPick={(id) => run((c) => c.charStyle(id === NONE ? null : id))}
        />
        <MoreMenu
          label="Character style actions"
          items={[
            { label: "New Style from Selection", disabled: !text || !st.textSel, title: "Save the selected text's look as a character style and apply it", onClick: create },
            { label: editing ? "Hide Style Settings" : "Edit Style…", disabled: !cur, title: "Change this style everywhere it's used", onClick: () => setEditing((v) => !v) },
            { label: "Rename Style…", disabled: !cur, onClick: () => setNaming(true) },
            {
              label: "Delete Style",
              disabled: !cur,
              title: "Text that uses it goes back to plain text",
              onClick: () => cur && changeCharStyles(list.filter((x) => x.name !== cur.name), (src) => removeCharStyle(src, cur.name)),
            },
          ]}
        />
      </div>
      {naming && <NameInput initial={cur?.name ?? ""} onDone={finish} />}
      {cur && editing && (
        <div className="dc-cs-edit">
          <p className="dc-note">Changes to “{cur.name}” apply everywhere it's used.</p>
          <Popup
            label="Character style font"
            value={s.font ?? ""}
            options={[{ id: "", label: "Same as paragraph" }, ...BLOCK_FONTS.map((f) => ({ id: f.css, label: f.label, render: <span style={{ fontFamily: f.css }}>{f.label}</span> }))]}
            onPick={(font) => edit({ font: font || undefined })}
          />
          <div className="dc-nums">
            <PtField label="Size (pt)" value={s.size} placeholder="Same" onSet={(size) => edit({ size: size || undefined })} />
            <PtField label="Spacing (pt)" value={s.tracking} step={0.5} onSet={(tracking) => edit({ tracking: tracking || undefined })} />
          </div>
          <div className="dc-row dc-font-row">
            <Seg label="Character style look">
              <SegBtn title="Bold" on={s.weight === "bold"} onClick={() => edit({ weight: s.weight === "bold" ? undefined : "bold" })}>
                <b>B</b>
              </SegBtn>
              <SegBtn title="Italic" on={!!s.italic} onClick={() => edit({ italic: !s.italic || undefined })}>
                <i style={{ fontFamily: "Georgia, serif" }}>I</i>
              </SegBtn>
              <SegBtn title="Underline" on={!!s.underline} onClick={() => edit({ underline: !s.underline || undefined })}>
                <u>U</u>
              </SegBtn>
              <SegBtn title="Strikethrough" on={!!s.strike} onClick={() => edit({ strike: !s.strike || undefined })}>
                <s>S</s>
              </SegBtn>
            </Seg>
            <ColorWell kind="color" value={(s.color as Color | undefined) ?? null} title="Character style color" onPick={(c) => edit({ color: c ?? undefined })} />
          </div>
        </div>
      )}
    </Section>
  );
}

/**
 * Layout 分頁（參考 Pages 的 Layout）：對齊與縮排、清單、間距（行距、段前、段後）、
 * 左右縮排、框線與底色（底色、框線、圓角、內距）。空白的欄位跟著文件的預設。
 */
export function LayoutFormat(props: { st: Status; run: Run; checklist?: boolean; shading?: boolean; hint?: string }) {
  const { st, run } = props;
  if (!canFormat(st)) return <NeedText hint={props.hint} />;
  const listType = LISTS.some((l) => l.id === st.type) ? st.type : "paragraph";
  const s: BlockStyle = parseBlockStyle(st.box);
  const set = (patch: Partial<BlockStyle>) => run((c) => c.box((v) => ({ ...v, css: patchBlockStyle(v.css, patch) })));
  const margin: Sides = s.margin ?? [0, 0, 0, 0];
  /** 外距的一邊（段前＝上、段後＝下、左右縮排＝左右） */
  const side = (i: number) => (n: number | undefined) => {
    const next = [...margin] as Sides;
    next[i] = n ?? 0;
    set({ margin: next });
  };
  return (
    <>
      <Section title="Alignment">
        <div className="dc-row">
          <Seg label="Alignment">
            <SegBtn title="Align left" on={st.align === "left"} onClick={() => run((c) => c.align("left"))}>
              <AlignLeftIcon />
            </SegBtn>
            <SegBtn title="Center" on={st.align === "center"} onClick={() => run((c) => c.align("center"))}>
              <AlignCenterIcon />
            </SegBtn>
            <SegBtn title="Align right" on={st.align === "right"} onClick={() => run((c) => c.align("right"))}>
              <AlignRightIcon />
            </SegBtn>
          </Seg>
          <Seg label="Indent">
            <SegBtn title="Decrease indent (Shift+Tab)" onClick={() => run((c) => c.indent(true))}>
              <OutdentIcon />
            </SegBtn>
            <SegBtn title="Increase indent (Tab)" onClick={() => run((c) => c.indent(false))}>
              <IndentIcon />
            </SegBtn>
          </Seg>
        </div>
      </Section>
      <Section title="Bullets & Lists">
        <Popup
          label="Bullets and lists"
          value={listType as BlockType}
          options={LISTS.filter((l) => props.checklist || l.id !== "todo").map((l) => ({ id: l.id, label: l.label }))}
          onPick={(t) => run((c) => c.turnInto(t))}
        />
      </Section>
      <Section title="Spacing">
        <Field label="Line">
          <Popup
            label="Line spacing"
            value={s.line ?? 0}
            options={[{ id: 0, label: "Default" }, ...LINE_SPACINGS.map((l) => ({ id: l, label: String(l) }))]}
            onPick={(line) => set({ line: line || undefined })}
          />
        </Field>
        <div className="dc-nums">
          <PtField label="Before (pt)" value={s.margin ? margin[0] : undefined} onSet={side(0)} />
          <PtField label="After (pt)" value={s.margin ? margin[2] : undefined} onSet={side(2)} />
        </div>
      </Section>
      <Section title="Indents">
        <div className="dc-nums">
          <PtField label="Left (pt)" value={s.margin ? margin[3] : undefined} onSet={side(3)} />
          <PtField label="Right (pt)" value={s.margin ? margin[1] : undefined} onSet={side(1)} />
          <PtField label="First line (pt)" value={s.firstLine} onSet={(firstLine) => set({ firstLine: firstLine || undefined })} />
        </div>
      </Section>
      <Section title="Border & Fill">
        {props.shading && (
          <Field label="Fill">
            <ColorWell kind="bg" value={st.bg} title="Paragraph background" onPick={(c) => run((x) => x.blockBg(c))} />
          </Field>
        )}
        {/* 第一格是「沒有框線」；再按一次選中的顏色也是拿掉框線 */}
        <div className="dc-border-colors" role="group" aria-label="Border color">
          <button
            className={`dc-border-color none${s.border ? "" : " on"}`}
            title="No border"
            aria-label="No border"
            onClick={() => set({ border: undefined, borderColor: undefined })}
          />
          {BORDER_COLORS.map((c) => {
            const on = !!s.border && (s.borderColor ?? "default") === c;
            return (
              <button
                key={c}
                className={`dc-border-color${on ? " on" : ""}`}
                title={on ? "Remove border" : c === "default" ? "Gray border" : `${c[0].toUpperCase() + c.slice(1)} border`}
                aria-label={`Border color ${c}`}
                aria-pressed={on}
                style={{ borderColor: c === "default" ? "var(--ed-faint)" : `var(--tc-${c})` }}
                onClick={() => set(on ? { border: undefined, borderColor: undefined } : { border: s.border || 1, borderColor: c })}
              />
            );
          })}
        </div>
        <div className="dc-nums">
          <PtField label="Border (pt)" value={s.border} step={0.5} onSet={(border) => set({ border: border || undefined })} />
          <PtField label="Corners (pt)" value={s.radius} onSet={(radius) => set({ radius: radius || undefined })} />
        </div>
        <SidesField label="Padding" value={s.padding} onSet={(padding) => set({ padding })} />
      </Section>
    </>
  );
}

/** 樣式名稱的輸入框：Enter 確定、Esc 或離開取消 */
function NameInput(props: { initial: string; onDone: (name: string) => void }) {
  const [v, setV] = useState(props.initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="dc-name-input"
      value={v}
      aria-label="Style name"
      maxLength={40}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => props.onDone("")}
      onKeyDown={(e) => {
        if (e.key === "Enter") props.onDone(v);
        if (e.key === "Escape") props.onDone("");
      }}
    />
  );
}

/** 數字輸入（pt）：Enter 或離開時套用，空白是拿掉這一項，Esc 還原；上下鍵加減（Shift 一次 10） */
function PtField(props: { label: string; value: number | undefined; placeholder?: string; step?: number; onSet: (v: number | undefined) => void }) {
  const shown = props.value === undefined ? "" : String(props.value);
  const [v, setV] = useState(shown);
  useEffect(() => setV(shown), [shown]);
  const done = () => {
    const t = v.trim();
    if (t === shown) return;
    if (t === "") return props.onSet(undefined);
    const n = Number(t);
    if (Number.isFinite(n) && n >= 0) props.onSet(n);
    else setV(shown);
  };
  return (
    <label className="dc-num">
      <input
        value={v}
        inputMode="decimal"
        placeholder={props.placeholder ?? "0"}
        onChange={(e) => setV(e.target.value)}
        onBlur={done}
        onKeyDown={(e) => {
          if (e.key === "Enter") done();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const d = (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : (props.step ?? 1));
            props.onSet(Math.max(0, +((props.value ?? 0) + d).toFixed(2)));
          }
          if (e.key === "Escape") setV(shown);
        }}
        aria-label={props.label}
      />
      <span>{props.label}</span>
    </label>
  );
}

/** 畫面上的順序：上、下、左、右（排成 2×2）；i 是 Sides 裡的位置 */
const SIDE_FIELDS = [
  { label: "Top", i: 0 },
  { label: "Bottom", i: 2 },
  { label: "Left", i: 3 },
  { label: "Right", i: 1 },
];

/**
 * 四邊（上右下左，pt）：連起來（預設，四邊一樣時）只有一格 All sides，一次改四邊；
 * 分開是四格。右上角的鍊條切換。
 */
function SidesField(props: { label: string; value: Sides | undefined; onSet: (v: Sides | undefined) => void }) {
  const cur: Sides = props.value ?? [0, 0, 0, 0];
  const same = cur.every((x) => x === cur[0]);
  const [linked, setLinked] = useState(same);
  const showLinked = linked && same;
  return (
    <div className="dc-sides" role="group" aria-label={props.label}>
      <div className="dc-sides-head">
        <span>{props.label} (pt)</span>
        <button
          className={`dc-link${showLinked ? " on" : ""}`}
          title={showLinked ? "Set each side separately" : "Use one value for all sides"}
          aria-pressed={showLinked}
          onClick={() => {
            if (showLinked) setLinked(false);
            else {
              setLinked(true);
              // 連起來：四邊都用上邊的值
              if (!same) props.onSet([cur[0], cur[0], cur[0], cur[0]]);
            }
          }}
        >
          <LinkIcon />
        </button>
      </div>
      {showLinked ? (
        <div className="dc-nums">
          <PtField label="All sides" value={props.value ? cur[0] : undefined} onSet={(n) => props.onSet(n ? [n, n, n, n] : undefined)} />
        </div>
      ) : (
        <div className="dc-nums dc-nums-4">
          {SIDE_FIELDS.map(({ label: l, i }) => (
            <PtField
              key={l}
              label={l}
              value={props.value ? cur[i] : undefined}
              onSet={(n) => {
                const next = [...cur] as Sides;
                next[i] = n ?? 0;
                props.onSet(next);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const LINE_SPACINGS = [1, 1.15, 1.5, 2, 2.5, 3];

/** 檢閱器開著哪一個（記住，下次打開一樣） */
export function usePanel<T extends string>(key: string, initial: T | null): [T | null, (p: T | null) => void] {
  const [panel, setPanelRaw] = useState<T | null>(() => {
    try {
      const v = localStorage.getItem(`banyan.inspector.${key}`);
      return v === null ? initial : v === "" ? null : (v as T);
    } catch {
      return initial;
    }
  });
  const setPanel = (p: T | null) => {
    setPanelRaw(p);
    try {
      localStorage.setItem(`banyan.inspector.${key}`, p ?? "");
    } catch {
      /* 記不住也沒關係 */
    }
  };
  return [panel, setPanel];
}
