import { restyleBoxes } from "../editor/layout";
import type { StyleLib } from "./DocChrome";
import { adoptStyles, changeStyles, useSavedStyles } from "./styleLibrary";
import { printPaper, printSheet, printSlides } from "./print";
import { activeTableId } from "../sheet/SheetView";
import { toCsv } from "../sheet/xlsx";
import { DeckContext, isDefaultDeck } from "./deckSetup";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Editor } from "../editor/Editor";
import { Calc } from "../sheet/calc";
import { parseWorkbook, serializeWorkbook, type Workbook } from "../sheet/model";
import { SheetView } from "../sheet/SheetView";
import { toXlsx } from "../sheet/xlsx";
import {
  ChevronRightIcon,
  CloseIcon,
  DocIcon,
  DrawIcon,
  ExportIcon,
  FolderIcon,
  ImportIcon,
  NoteIcon,
  OpenIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  ReopenIcon,
  SheetIcon,
  SlidesIcon,
  SplitIcon,
  TrashIcon,
} from "../editor/icons";
import { activeDoc, cleanPanes, closeTab, cycleGroup, cycleTab, moveTab, nextDoc, onePane, openDoc, openDocs, openToSide, pinTab, reopenTab, splitGroup, tabCount, type Panes, type Side } from "./panes";
import { PaneLayout, paneTargetAt, type PaneDrop, type TabInfo } from "./DockGroups";
import { saveExport, toDocx, toPptx } from "./export";
import { DrawView } from "./DrawView";
import { parseDiagram } from "./draw";
import { loadImages, toDrawio, toHtml, toPng, toSvg } from "./drawExport";
import { WordView } from "./WordView";
import { isDefaultPage } from "./pageSetup";
import { clickPick, keepPick, noPick, stepPick, type Picked } from "./selection";
import { Presenter, SlideDeck } from "./SlideDeck";
import { trimAnim, type Deck } from "./slideAnim";
import { templatesFor } from "./docTemplates";
import { DocPreview, TemplateGallery } from "./TemplateGallery";
import {
  addDoc,
  addFolder,
  dockOrder,
  dockOutline,
  DOCK_KINDS,
  folderOf,
  freeTitle,
  kindLabel,
  moveFolder,
  placeDocs,
  removeDocs,
  removeFolder,
  renameFolder,
  splitSlides,
  updateDoc,
  type DeskFile,
  type DockDoc,
  type DockFolder,
  type DockKind,
} from "./file";
import { DOCK_IMPORT, importAsDoc, saveImported } from "./docImport";
import { loadCollapsed, loadDockDoc, loadPanes, saveCollapsed, saveDockDoc, savePanes } from "./store";
import { newId } from "./board";

/**
 * Dock：把白板上的想法整理成可以發表的文件。左邊是這個檔案的文件清單（拖曳排序），右邊編輯。
 *
 * - Note：一般頁面。
 * - Word：直接在 A4 紙上寫，邊寫邊分頁（`PaperEditor.tsx`）；匯出 .docx。
 * - Slides：左邊縮圖、中間直接編輯 16:9 投影片（`SlideDeck.tsx`）；內容仍是 Markdown，
 *   單獨一行的 `---`（前面空一行）分張；「Present」全螢幕放映；匯出 .pptx。
 * - Excel：參考 Numbers 的試算表（`src/sheet/`）：畫布上擺表格與圖表、公式、格式；工具列「To Whiteboard」
 *   把選的列變成便利貼；匯出 .xlsx。
 * - Draw：參考 draw.io 的圖表（`DrawView.tsx`）；匯出網頁 .html（每個畫板一段）、.png、.svg 或 .drawio（draw.io 可以直接開）。
 */

export const kindIcon = (k: DockKind) =>
  k === "slides" ? <SlidesIcon /> : k === "word" ? <DocIcon /> : k === "sheet" ? <SheetIcon /> : k === "draw" ? <DrawIcon /> : <NoteIcon />;

export function Dock(props: {
  /** Desk 檔案名稱（匯出的預設檔名） */
  name: string;
  file: DeskFile;
  onChange: (fn: (f: DeskFile) => DeskFile) => void;
  active: string | null;
  onActive: (id: string | null) => void;
  onOpenPage: (title: string) => void;
  hasPage: (title: string) => boolean;
  /** 把文字變成白板上的便利貼（資料庫的列） */
  onSendNotes: (texts: string[]) => void;
}) {
  const { file, onChange } = props;
  const doc = file.docs.find((d) => d.id === props.active) ?? dockOrder(file)[0] ?? null;
  const [adding, setAdding] = useState(false);
  const [pickRaw, setPick] = useState<Picked<string>>(noPick);
  // 文件被刪掉或換了檔案：去掉不在的
  const pick = keepPick(
    file.docs.map((d) => d.id),
    pickRaw,
  );

  // Word、簡報、Excel 先挑範本（`docTemplates.ts`）
  const [choosing, setChoosing] = useState<DockKind | null>(null);
  const create = (kind: DockKind) => {
    setAdding(false);
    if (templatesFor(kind).length) setChoosing(kind);
    else make(kind);
  };
  const make = (kind: DockKind, tplId?: string) => {
    setChoosing(null);
    const tpl = templatesFor(kind).find((t) => t.id === tplId);
    // 空白範本用預設的標題與內容；其他範本用範本名稱當標題
    const title = tpl && !tpl.id.endsWith("-blank") ? freeTitle(file, tpl.label) : undefined;
    // 先用目前的檔案決定新文件（標題、id），再加到最新的檔案裡
    const r = tpl && title ? addDoc(file, kind, title, tpl.make(title)) : addDoc(file, kind);
    // 新文件放在開著的文件所在的資料夾（像 Finder 在目前的資料夾裡新增）
    const at = doc ? folderOf(file, doc) : null;
    const made = { ...r.file.docs[r.file.docs.length - 1], ...(at ? { folder: at.id } : {}) };
    onChange((f) => ({ ...f, docs: [...f.docs, made] }));
    if (at) toggle(at.id, true);
    pinNext.current = r.id;
    props.onActive(r.id);
  };

  // 匯入檔案變成新文件（`docImport.ts`）：種類看副檔名，標題是檔名，放在開著的文件所在的資料夾
  const importRef = useRef<HTMLInputElement>(null);
  const [importNote, setImportNote] = useState<{ text: string; error?: boolean } | null>(null);
  useEffect(() => {
    if (!importNote) return;
    const t = setTimeout(() => setImportNote(null), importNote.error ? 8000 : 4000);
    return () => clearTimeout(t);
  }, [importNote]);
  const importNew = async (f: File) => {
    setImportNote({ text: `Importing ${f.name}…` });
    try {
      const got = await importAsDoc(f.name, new Uint8Array(await f.arrayBuffer()), saveImported);
      const r = addDoc(file, got.kind, freeTitle(file, got.title), got.content);
      const at = doc ? folderOf(file, doc) : null;
      const made = { ...r.file.docs[r.file.docs.length - 1], ...(got.anim ? { anim: got.anim } : {}), ...(at ? { folder: at.id } : {}) };
      onChange((x) => ({ ...x, docs: [...x.docs, made] }));
      pinNext.current = made.id;
      props.onActive(made.id);
      setImportNote({ text: `Imported ${f.name} as ${kindLabel(got.kind)}` });
    } catch (err) {
      console.error("Import failed", err);
      setImportNote({ text: `Couldn't import ${f.name}: ${err instanceof Error ? err.message : String(err)}`, error: true });
    }
  };

  // 沒記住開哪份（或記住的已經不在）時，App 開的是清單上的第一份；記下來，之後排序、搬進資料夾時畫面不會跳到別份
  useEffect(() => {
    const kept = loadDockDoc(props.name);
    if (doc && (!kept || !file.docs.some((d) => d.id === kept))) saveDockDoc(props.name, doc.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.name, doc?.id]);

  /* ─── 分割視窗（`panes.ts`、`DockGroups.tsx`）：操作中群組的作用中分頁就是 App 的 `active` ─── */
  const order = useMemo(() => dockOrder(file).map((d) => d.id), [file]);
  const exists = (id: string) => file.docs.some((d) => d.id === id);
  const [panesRaw, setPanes] = useState<Panes>(() => loadPanes(props.name) ?? onePane(doc?.id ?? null));
  const loadedFor = useRef(props.name);
  if (loadedFor.current !== props.name) {
    // 換了檔案（同一個 Dock 元件）：讀那個檔案的窗格
    loadedFor.current = props.name;
    setPanes(loadPanes(props.name) ?? onePane(doc?.id ?? null));
  }
  const panes = cleanPanes(panesRaw, exists, doc?.id ?? null);
  /** 下一次 App 換到這份文件時開成固定分頁（新增、匯入的文件）；其他（清單點一下、連結、上一頁）開成預覽分頁 */
  const pinNext = useRef<string | null>(null);
  useEffect(() => {
    if (!doc) return;
    const pin = pinNext.current === doc.id;
    pinNext.current = null;
    setPanes((p) => openDoc(cleanPanes(p, exists, doc.id), doc.id, { preview: !pin }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id]);
  const panesKey = JSON.stringify(panes);
  useEffect(() => savePanes(props.name, panes), [props.name, panesKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // 拖曳、改大小的處理掛在 window 上，拿的是按下時的 render：一律從最新的狀態改
  const latest = useRef({ panes, doc: doc?.id ?? null });
  latest.current = { panes, doc: doc?.id ?? null };
  /** 改窗格；操作中的分頁換了文件就告訴 App */
  const updatePanes = (fn: (p: Panes) => Panes) => {
    const cur = latest.current.panes;
    const next = fn(cur);
    if (next === cur) return;
    latest.current = { ...latest.current, panes: next };
    setPanes(next);
    const id = activeDoc(next);
    if (id && id !== latest.current.doc) {
      latest.current.doc = id;
      props.onActive(id);
    }
  };
  const split = (side: Side) => updatePanes((p) => splitGroup(p, side, nextDoc(p, order)));
  const reopen = () => updatePanes((p) => reopenTab(p, exists));
  const canReopen = panes.closed.length > 0;
  // Alt＋\ 往右分割（加 Shift 往下）、Alt＋W 關掉作用中分頁、Alt＋Shift＋T 重新打開、Alt＋PageUp／PageDown 換分頁（加 Shift 換群組）
  // （App 的快捷鍵不管 Shift，也沒用到這些鍵）
  const keysRef = useRef({ split, reopen, updatePanes });
  keysRef.current = { split, reopen, updatePanes };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const k = keysRef.current;
      if (e.code === "Backslash") !e.repeat && k.split(e.shiftKey ? "down" : "right");
      else if (e.code === "KeyW" && !e.shiftKey) !e.repeat && k.updatePanes((p) => (activeDoc(p) ? closeTab(p, activeDoc(p)!) : p));
      else if (e.code === "KeyT" && e.shiftKey) !e.repeat && k.reopen();
      else if (e.code === "PageDown" || e.code === "PageUp") k.updatePanes((p) => (e.shiftKey ? cycleGroup : cycleTab)(p, e.code === "PageDown" ? 1 : -1));
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);
  /** 清單把文件拖進分割視窗：放置位置（`paneTargetAt`） */
  const splitRef = useRef<HTMLDivElement>(null);
  const [outside, setOutside] = useState<PaneDrop | null>(null);
  const outsideRef = useRef<PaneDrop | null>(null);
  const paneDrag = {
    over: (x: number, y: number) => {
      const t = paneTargetAt(x, y, splitRef.current);
      outsideRef.current = t;
      setOutside(t);
      return !!t;
    },
    drop: (id: string) => {
      const t = outsideRef.current;
      outsideRef.current = null;
      setOutside(null);
      if (!t) return false;
      updatePanes((p) => moveTab(p, id, t));
      return true;
    },
  };
  const pinIf = (id: string) => updatePanes((p) => pinTab(p, id));
  const info = (id: string): TabInfo | null => {
    const d = file.docs.find((x) => x.id === id);
    return d ? { title: d.title, icon: kindIcon(d.kind), hint: kindLabel(d.kind) } : null;
  };
  const renderDoc = (id: string) => {
    const d = file.docs.find((x) => x.id === id);
    if (!d) return null;
    return (
      <DocPane
        key={d.id}
        fileName={props.name}
        doc={d}
        onChange={(patch) => {
          pinIf(d.id);
          onChange((f) => updateDoc(f, d.id, patch));
        }}
        onAdoptStyles={(renames) =>
          // 舊的每份文件一份樣式已經併進共用的清單：拿掉文件裡的，撞名改了名的區塊跟著改
          onChange((f) => {
            const x = f.docs.find((y) => y.id === d.id);
            if (!x) return f;
            const content = renames.size ? restyleBoxes(x.content, (v) => (v.name && renames.has(v.name) ? { ...v, name: renames.get(v.name) } : v)) : x.content;
            return updateDoc(f, d.id, { styles: undefined, content });
          })
        }
        onEditDeck={(fn) => {
          pinIf(d.id);
          onChange((f) => {
            const x = f.docs.find((y) => y.id === d.id);
            if (!x) return f;
            const next = fn({ content: x.content, anim: x.anim ?? [] });
            const anim = trimAnim(next.anim);
            return updateDoc(f, x.id, { content: next.content, anim: anim.length ? anim : undefined });
          });
        }}
        onModifySheet={(fn) => {
          pinIf(d.id);
          onChange((f) => {
            const x = f.docs.find((y) => y.id === d.id);
            return x ? updateDoc(f, x.id, { content: serializeWorkbook(fn(parseWorkbook(x.content))) }) : f;
          });
        }}
        onOpenPage={props.onOpenPage}
        hasPage={props.hasPage}
        onSendNotes={props.onSendNotes}
      />
    );
  };

  /* 資料夾：收合狀態記在 localStorage（每個檔案一份） */
  const [collapsed, setCollapsed] = useState<string[]>(() => loadCollapsed(props.name));
  useEffect(() => setCollapsed(loadCollapsed(props.name)), [props.name]);
  const toggle = (id: string, open?: boolean) =>
    setCollapsed((c) => {
      const shut = c.includes(id);
      const want = open === undefined ? !shut : !open;
      if (want === shut) return c;
      const next = want ? [...c, id] : c.filter((x) => x !== id);
      saveCollapsed(props.name, next);
      return next;
    });
  // 開著的文件在收起來的資料夾裡（例如從連結打開）：展開
  const docFolder = doc ? folderOf(file, doc)?.id : undefined;
  useEffect(() => {
    if (docFolder && collapsed.includes(docFolder)) toggle(docFolder, true);
    // 只在換文件時檢查，使用者之後還是可以收起來
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id, docFolder]);
  /** 正在改名的文件或資料夾 */
  const [renaming, setRenaming] = useState<string | null>(null);
  const newFolder = (ids?: string[]) => {
    setAdding(false);
    const id = newId();
    onChange((f) => addFolder(f, undefined, ids ?? [], id).file);
    setRenaming(id);
  };
  const deleteDocs = (ids: string[]) => {
    const gone = file.docs.filter((d) => ids.includes(d.id));
    if (!gone.length) return;
    const what = gone.length === 1 ? `“${gone[0].title}”` : `${gone.length} documents`;
    if (!window.confirm(`Delete ${what} from the Dock? This can't be undone.`)) return;
    onChange((f) => removeDocs(f, ids));
    setPick(noPick());
    if (doc && ids.includes(doc.id)) props.onActive(file.docs.find((d) => !ids.includes(d.id))?.id ?? null);
  };
  /** 刪掉資料夾：預設把文件搬出來；withDocs 連文件一起刪（要確認） */
  const deleteFolder = (id: string, withDocs: boolean) => {
    const folder = file.folders?.find((x) => x.id === id);
    if (!folder) return;
    const inside = file.docs.filter((d) => d.folder === id);
    const n = inside.length;
    const docs = `${n} ${n === 1 ? "document" : "documents"}`;
    if (withDocs) {
      if (!window.confirm(`Delete the folder “${folder.name}” and its ${docs}? This can't be undone.`)) return;
    } else if (n && !window.confirm(`Delete the folder “${folder.name}”? Its ${docs} will move out of the folder.`)) return;
    onChange((f) => removeFolder(f, id, withDocs));
    if (withDocs) {
      const ids = inside.map((d) => d.id);
      setPick(noPick());
      if (doc && ids.includes(doc.id)) props.onActive(file.docs.find((d) => !ids.includes(d.id))?.id ?? null);
    }
  };
  const gallery = useMemo(
    () =>
      choosing
        ? templatesFor(choosing).map((t) => ({ id: t.id, label: t.label, hint: t.hint, preview: <DocPreview kind={choosing} content={t.make(t.label === "Blank" ? kindLabel(choosing) : t.label)} /> }))
        : [],
    [choosing],
  );

  return (
    <div className="dock">
      <aside className="dock-side no-box">
        <div className="ds-head">
          <span>Documents</span>
          {canReopen && (
            <button className="icon-btn" title="Reopen closed tab (Alt+Shift+T)" onClick={reopen}>
              <ReopenIcon />
            </button>
          )}
          <button className="icon-btn" title="New document" onClick={() => setAdding((v) => !v)}>
            <PlusIcon />
          </button>
        </div>
        {adding && (
          <KindPicker
            onPick={create}
            onFolder={() => newFolder()}
            onImport={() => {
              setAdding(false);
              importRef.current?.click();
            }}
            onClose={() => setAdding(false)}
          />
        )}
        <input
          ref={importRef}
          type="file"
          accept={DOCK_IMPORT}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void importNew(f);
          }}
        />
        {importNote && (
          <p className={`ds-import-note${importNote.error ? " error" : ""}`} role="status">
            {importNote.text}
          </p>
        )}
        {choosing && (
          <TemplateGallery
            title={`Choose a ${kindLabel(choosing) === "Excel" ? "spreadsheet" : kindLabel(choosing) === "Slides" ? "presentation" : "document"} template`}
            items={gallery}
            onPick={(id) => make(choosing, id)}
            onClose={() => setChoosing(null)}
          />
        )}
        <DocList
          file={file}
          onChange={onChange}
          active={doc?.id ?? null}
          pick={pick}
          onPick={setPick}
          onOpen={props.onActive}
          onOpenSide={(id) => updatePanes((p) => openToSide(p, id))}
          open={tabCount(panes) > 1 ? openDocs(panes) : undefined}
          paneDrag={paneDrag}
          onDelete={deleteDocs}
          onDeleteFolder={deleteFolder}
          onNewFolder={newFolder}
          collapsed={collapsed}
          onToggle={toggle}
          renaming={renaming}
          onRenaming={setRenaming}
        />
        {!file.docs.length && !file.folders?.length && !adding && <p className="ds-empty">Nothing here yet. Send cards from the whiteboard, or start a document with +.</p>}
      </aside>
      <section className="dock-main">
        {doc && tabCount(panes) ? (
          <div className="dock-panes" ref={splitRef}>
            <PaneLayout
              panes={panes}
              onUpdate={updatePanes}
              info={info}
              renderDoc={renderDoc}
              onSplit={split}
              onReopen={canReopen ? reopen : undefined}
              outside={outside}
              containerRef={splitRef}
            />
          </div>
        ) : (
          <div className="dock-start">
            <h2>Shape your ideas into something to publish</h2>
            <p>Pick what to make. You can also select cards on the whiteboard and choose Send to Dock.</p>
            <div className="dock-kinds">
              {DOCK_KINDS.map((k) => (
                <button key={k.kind} className="dock-kind no-box" onClick={() => create(k.kind)}>
                  <span className="dk-icon">{kindIcon(k.kind)}</span>
                  <strong>{k.label}</strong>
                  <span>{k.hint}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function KindPicker(props: { onPick: (k: DockKind) => void; onFolder: () => void; onImport: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.(".ds-head")) props.onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
    };
  });
  return (
    <div className="ds-kinds" ref={ref}>
      {DOCK_KINDS.map((k) => (
        <button key={k.kind} onClick={() => props.onPick(k.kind)}>
          {kindIcon(k.kind)}
          <span>{k.label}</span>
        </button>
      ))}
      <div className="ds-sep" />
      <button onClick={props.onImport} title="Word, PowerPoint, Excel, OpenDocument, RTF, CSV, Markdown, web pages…">
        <ImportIcon />
        <span>Import a File…</span>
      </button>
      <button onClick={props.onFolder}>
        <FolderIcon />
        <span>Folder</span>
      </button>
    </div>
  );
}

/** 清單上的一列：資料夾或文件（文件記得所在的資料夾，null＝不在資料夾裡） */
type ListRow = { type: "folder"; folder: DockFolder; count: number; open: boolean } | { type: "doc"; doc: DockDoc; folder: string | null };

/** 拖曳文件時放下的位置：放進哪裡、排在哪份前面，以及畫面上的標記 */
type DocDrop = { folder: string | null; before: string | null; mark: { id: string; where: "before" | "after" | "in" } | "end" };

/** 右鍵選單：文件（整組）、資料夾或清單的空白處 */
type ListMenuAt = { x: number; y: number; docs?: string[]; folder?: string; above?: boolean };

/**
 * 文件清單：資料夾（一層，排在前面；點了收合）＋文件。點文件開啟；Ctrl／Shift＋點群選（不開啟），
 * ↑↓（加 Shift 延伸）、Ctrl＋A、Delete、Esc；拖曳（指標事件）排序、拖進／拖出資料夾，拖選取中的文件時整組一起搬；
 * 拖資料夾排資料夾的順序；右鍵選單有 Move to；滑過出現改名與刪除（選取中的就刪整組）。
 */
function DocList(props: {
  file: DeskFile;
  onChange: (fn: (f: DeskFile) => DeskFile) => void;
  active: string | null;
  pick: Picked<string>;
  onPick: (p: Picked<string>) => void;
  onOpen: (id: string) => void;
  /** 在旁邊的新窗格打開（分割視窗）；不能再分割時是 undefined */
  onOpenSide?: (id: string) => void;
  /** 分割視窗開著的分頁（清單上標出來） */
  open?: string[];
  /** 把文件拖進分割視窗（`over` 回傳指標是不是在分割視窗上，`drop` 回傳有沒有放進去） */
  paneDrag?: { over: (x: number, y: number) => boolean; drop: (id: string) => boolean };
  onDelete: (ids: string[]) => void;
  onDeleteFolder: (id: string, withDocs: boolean) => void;
  /** 新增資料夾（可以把文件一起放進去），然後改名 */
  onNewFolder: (ids?: string[]) => void;
  collapsed: string[];
  onToggle: (id: string, open?: boolean) => void;
  /** 正在改名的文件或資料夾（連按兩下、F2 或滑過時的筆） */
  renaming: string | null;
  onRenaming: (id: string | null) => void;
}) {
  const { file, pick, onPick, renaming, onRenaming, onChange } = props;
  const [drag, setDrag] = useState<{ ids: string[]; drop: DocDrop | null } | null>(null);
  /** 拖資料夾：放在第 before 個資料夾前面 */
  const [fdrag, setFdrag] = useState<{ id: string; before: number } | null>(null);
  const [menu, setMenu] = useState<ListMenuAt | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const outline = dockOutline(file);
  const folders = outline.folders.map((x) => x.folder);
  const rows: ListRow[] = [];
  for (const g of outline.folders) {
    const open = !props.collapsed.includes(g.folder.id);
    rows.push({ type: "folder", folder: g.folder, count: g.docs.length, open });
    if (open) for (const d of g.docs) rows.push({ type: "doc", doc: d, folder: g.folder.id });
  }
  for (const d of outline.loose) rows.push({ type: "doc", doc: d, folder: null });
  /** 看得到的文件（鍵盤上下、Shift＋點、Ctrl＋A 用） */
  const order = rows.flatMap((r) => (r.type === "doc" ? [r.doc.id] : []));
  const rowKey = (r: ListRow) => (r.type === "doc" ? r.doc.id : r.folder.id);

  const focusRow = (id: string) =>
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`.dl-row[data-id="${CSS.escape(id)}"]`)?.focus());
  /** 這份文件被刪除、拖曳或搬動時，一起處理的文件：在多選裡就是整組 */
  const groupOf = (id: string) => (pick.sel.length > 1 && pick.sel.includes(id) ? pick.sel : [id]);
  const rowEls = () => [...(listRef.current?.querySelectorAll<HTMLElement>(".dl-row") ?? [])];

  /** 拖曳文件時，指標底下的放置位置 */
  const dropAt = (y: number): DocDrop | null => {
    const els = rowEls();
    if (!els.length) return { folder: null, before: null, mark: "end" };
    if (y < els[0].getBoundingClientRect().top) {
      const r = rows[0];
      return r.type === "doc" ? { folder: r.folder, before: r.doc.id, mark: { id: r.doc.id, where: "before" } } : { folder: r.folder.id, before: null, mark: { id: r.folder.id, where: "in" } };
    }
    for (let i = 0; i < els.length; i++) {
      const box = els[i].getBoundingClientRect();
      if (y < box.top || y >= box.bottom) continue;
      const r = rows[i];
      if (!r) return null;
      if (r.type === "folder") return { folder: r.folder.id, before: null, mark: { id: r.folder.id, where: "in" } };
      if (y < box.top + box.height / 2) return { folder: r.folder, before: r.doc.id, mark: { id: r.doc.id, where: "before" } };
      const next = rows[i + 1];
      const before = next?.type === "doc" && next.folder === r.folder ? next.doc.id : null;
      return { folder: r.folder, before, mark: { id: r.doc.id, where: "after" } };
    }
    return { folder: null, before: null, mark: "end" };
  };

  const down = (e: React.PointerEvent, d: DockDoc) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".dl-del, .dl-ren, .dl-rename")) return;
    const mods = { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey };
    const x0 = e.clientX;
    const y0 = e.clientY;
    const ids = groupOf(d.id);
    let started = false;
    let drop: DocDrop | null = null;
    let toPane = false;
    const move = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      started = true;
      // 拖到右邊的分割視窗：放進群組或分割（像從 VS Code 的檔案總管拖進編輯器）
      toPane = ids.length === 1 && !!props.paneDrag?.over(ev.clientX, ev.clientY);
      drop = toPane ? null : dropAt(ev.clientY);
      setDrag({ ids, drop });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (started && toPane && props.paneDrag?.drop(ids[0])) return;
      if (!started) {
        if (mods.ctrl || mods.shift) return onPick(clickPick(order, pick, d.id, mods));
        onPick({ sel: [d.id], anchor: d.id });
        // Alt＋點擊：在旁邊的窗格打開（像 VS Code）
        if (mods.alt && props.onOpenSide) return props.onOpenSide(d.id);
        return props.onOpen(d.id);
      }
      if (ids.length === 1 && !pick.sel.includes(d.id)) onPick({ sel: [d.id], anchor: d.id });
      const to = drop;
      if (to) {
        onChange((f) => placeDocs(f, ids, to.folder, to.before));
        if (to.folder) props.onToggle(to.folder, true);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** 資料夾：點了收合／展開，拖曳排順序 */
  const downFolder = (e: React.PointerEvent, folder: DockFolder) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".dl-del, .dl-ren, .dl-rename")) return;
    const y0 = e.clientY;
    let started = false;
    let before = -1;
    const move = (ev: PointerEvent) => {
      if (!started && Math.abs(ev.clientY - y0) < 4) return;
      started = true;
      const heads = [...(listRef.current?.querySelectorAll<HTMLElement>(".dl-row.folder") ?? [])];
      before = heads.findIndex((h) => {
        const r = h.getBoundingClientRect();
        return ev.clientY < r.top + r.height / 2;
      });
      if (before < 0) before = heads.length;
      setFdrag({ id: folder.id, before });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setFdrag(null);
      if (!started) return props.onToggle(folder.id);
      if (before >= 0) onChange((f) => moveFolder(f, folder.id, before));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const key = (e: React.KeyboardEvent, d: DockDoc, folder: string | null) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const r = stepPick(order, pick.sel.length ? pick : { sel: [d.id], anchor: d.id }, d.id, e.key === "ArrowDown" ? 1 : -1, e.shiftKey);
      if (r.to) {
        onPick(r.pick);
        if (!e.shiftKey) props.onOpen(r.to);
        focusRow(r.to);
      }
    } else if (e.key === "ArrowLeft" && folder) focusRow(folder);
    else if (ctrl && e.key.toLowerCase() === "a") onPick({ sel: order, anchor: order[0] ?? null });
    else if (e.key === "Delete" || e.key === "Backspace") props.onDelete(pick.sel.length ? pick.sel : [d.id]);
    else if (e.key === "Escape") onPick({ sel: [], anchor: null });
    else if (e.key === "F2") onRenaming(d.id);
    else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setMenu({ x: r.left + 24, y: r.bottom, docs: groupOf(d.id) });
    } else if (e.key === "Enter") {
      onPick({ sel: [d.id], anchor: d.id });
      props.onOpen(d.id);
    } else return;
    // 不讓編輯器（掛在 window 上的選取按鍵）也處理
    e.preventDefault();
    e.stopPropagation();
  };

  const keyFolder = (e: React.KeyboardEvent, row: Extract<ListRow, { type: "folder" }>) => {
    const id = row.folder.id;
    const i = rows.findIndex((r) => rowKey(r) === id);
    if (e.key === "Enter" || e.key === " ") props.onToggle(id);
    else if (e.key === "ArrowRight") row.open && row.count ? focusRow(rowKey(rows[i + 1])) : props.onToggle(id, true);
    else if (e.key === "ArrowLeft") props.onToggle(id, false);
    else if (e.key === "ArrowDown" && rows[i + 1]) focusRow(rowKey(rows[i + 1]));
    else if (e.key === "ArrowUp" && i > 0) focusRow(rowKey(rows[i - 1]));
    else if (e.key === "F2") onRenaming(id);
    else if (e.key === "Delete" || e.key === "Backspace") props.onDeleteFolder(id, false);
    else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setMenu({ x: r.left + 24, y: r.bottom, folder: id });
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const openMenu = (e: React.MouseEvent, at: Omit<ListMenuAt, "x" | "y">) => {
    e.preventDefault();
    e.stopPropagation();
    if (at.docs && at.docs.length === 1 && !pick.sel.includes(at.docs[0])) onPick({ sel: [at.docs[0]], anchor: at.docs[0] });
    setMenu({ x: e.clientX, y: e.clientY, ...at });
  };

  const dropMark = (id: string) => {
    const m = drag?.drop?.mark;
    if (fdrag) {
      // 資料夾的放置線：排在第 before 個資料夾前面；最後面就畫在最後一個資料夾群的最後一列下面
      const heads = folders;
      if (fdrag.before < heads.length) return heads[fdrag.before].id === id ? " drop-before" : "";
      const lastGroup = rows.filter((r) => r.type === "folder" || r.folder !== null);
      return lastGroup.length && rowKey(lastGroup[lastGroup.length - 1]) === id ? " drop-after" : "";
    }
    if (!m || m === "end" || m.id !== id) return "";
    return m.where === "in" ? " drop-in" : m.where === "before" ? " drop-before" : " drop-after";
  };

  const renameRow = (id: string, value: string, done: (t: string) => void) => (
    <RenameInput
      value={value}
      onDone={(t) => {
        onRenaming(null);
        if (t !== null && t !== value) done(t);
        focusRow(id);
      }}
    />
  );

  return (
    <>
      <div
        className={`dl${drag || fdrag ? " dragging" : ""}`}
        ref={listRef}
        role="listbox"
        aria-multiselectable
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest(".dl-row")) return;
          openMenu(e, {});
        }}
      >
        {rows.map((r) =>
          r.type === "folder" ? (
            <div
              key={r.folder.id}
              data-id={r.folder.id}
              className={`dl-row folder${r.open ? " open" : ""}${fdrag?.id === r.folder.id ? " moving" : ""}${dropMark(r.folder.id)}`}
              role="option"
              aria-selected={false}
              aria-expanded={r.open}
              tabIndex={0}
              onPointerDown={(e) => downFolder(e, r.folder)}
              onKeyDown={(e) => keyFolder(e, r)}
              onContextMenu={(e) => openMenu(e, { folder: r.folder.id })}
              onDoubleClick={(e) => {
                if (!(e.target as HTMLElement).closest(".dl-del, .dl-ren, .dl-rename")) onRenaming(r.folder.id);
              }}
              title={`${r.folder.name} · ${r.count} ${r.count === 1 ? "document" : "documents"}`}
            >
              <span className="dl-chev" aria-hidden>
                <ChevronRightIcon />
              </span>
              <span className="dl-icon">
                <FolderIcon />
              </span>
              {renaming === r.folder.id ? (
                renameRow(r.folder.id, r.folder.name, (name) => onChange((f) => renameFolder(f, r.folder.id, name)))
              ) : (
                <>
                  <span className="dl-title">{r.folder.name}</span>
                  <span className="dl-kind">{r.count || ""}</span>
                  <button className="dl-ren" title="Rename folder (F2)" aria-label="Rename folder" onClick={() => onRenaming(r.folder.id)}>
                    ✎
                  </button>
                </>
              )}
              <button className="dl-del" title="Delete folder (documents move out)" onClick={() => props.onDeleteFolder(r.folder.id, false)}>
                <TrashIcon />
              </button>
            </div>
          ) : (
            <div
              key={r.doc.id}
              data-id={r.doc.id}
              className={`dl-row${r.folder ? " in-folder" : ""}${r.doc.id === props.active ? " on" : props.open?.includes(r.doc.id) ? " open" : ""}${pick.sel.includes(r.doc.id) ? " sel" : ""}${
                drag?.ids.includes(r.doc.id) ? " moving" : ""
              }${dropMark(r.doc.id)}`}
              role="option"
              aria-selected={pick.sel.includes(r.doc.id)}
              tabIndex={0}
              onPointerDown={(e) => down(e, r.doc)}
              onKeyDown={(e) => key(e, r.doc, r.folder)}
              onContextMenu={(e) => openMenu(e, { docs: groupOf(r.doc.id) })}
              onDoubleClick={(e) => {
                if (!(e.target as HTMLElement).closest(".dl-del, .dl-ren, .dl-rename")) onRenaming(r.doc.id);
              }}
              title={`${r.doc.title} · ${kindLabel(r.doc.kind)} · double-click or F2 to rename`}
            >
              <span className="dl-icon">{kindIcon(r.doc.kind)}</span>
              {renaming === r.doc.id ? (
                renameRow(r.doc.id, r.doc.title, (title) => onChange((f) => updateDoc(f, r.doc.id, { title })))
              ) : (
                <>
                  <span className="dl-title">{r.doc.title}</span>
                  <span className="dl-kind">{kindLabel(r.doc.kind)}</span>
                  <button className="dl-ren" title="Rename (F2)" aria-label="Rename" onClick={() => onRenaming(r.doc.id)}>
                    ✎
                  </button>
                </>
              )}
              <button
                className="dl-del"
                title={groupOf(r.doc.id).length > 1 ? `Delete ${groupOf(r.doc.id).length} documents` : "Delete document"}
                onClick={() => props.onDelete(groupOf(r.doc.id))}
              >
                <TrashIcon />
              </button>
            </div>
          ),
        )}
        {/* 拖到這裡：搬出資料夾、排在最後面 */}
        {drag && folders.length > 0 && <div className={`dl-tail${drag.drop?.mark === "end" ? " drop" : ""}`}>Move out of folders</div>}
      </div>
      {pick.sel.length > 1 && (
        <div className="dl-bar">
          <span>{pick.sel.length} selected</span>
          <span className="dp-gap" />
          <button onClick={() => props.onDelete(pick.sel)} title="Delete the selected documents">
            <TrashIcon /> Delete
          </button>
          <button
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({ x: r.left, y: r.top - 4, docs: pick.sel, above: true });
            }}
            title="Move the selected documents to a folder"
          >
            <FolderIcon /> Move
          </button>
          <button onClick={() => onPick({ sel: [], anchor: null })} title="Clear the selection (Esc)">
            <CloseIcon />
          </button>
        </div>
      )}
      {menu && (
        <ListMenu
          at={menu}
          file={file}
          onClose={() => setMenu(null)}
          act={{
            open: (id) => {
              onPick({ sel: [id], anchor: id });
              props.onOpen(id);
            },
            rename: onRenaming,
            moveTo: (ids, folder) => {
              onChange((f) => placeDocs(f, ids, folder, null));
              if (folder) props.onToggle(folder, true);
            },
            openSide: props.onOpenSide,
            newFolder: props.onNewFolder,
            deleteDocs: props.onDelete,
            deleteFolder: props.onDeleteFolder,
          }}
        />
      )}
    </>
  );
}

/** 清單的右鍵選單（放到 body，跟投影片縮圖的選單一樣） */
function ListMenu(props: {
  at: ListMenuAt;
  file: DeskFile;
  onClose: () => void;
  act: {
    open: (id: string) => void;
    openSide?: (id: string) => void;
    rename: (id: string) => void;
    moveTo: (ids: string[], folder: string | null) => void;
    newFolder: (ids?: string[]) => void;
    deleteDocs: (ids: string[]) => void;
    deleteFolder: (id: string, withDocs: boolean) => void;
  };
}) {
  const { at, file, act, onClose } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      left: Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(at.above ? at.y - r.height : at.y, window.innerHeight - r.height - 8)),
    });
  }, [at.x, at.y, at.above]);
  useEffect(() => {
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    const scroll = (e: Event) => !ref.current?.contains(e.target as Node) && onClose();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);
  useEffect(() => ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(), []);
  const item = (label: string, icon: React.ReactNode, fn: () => void, opts: { hint?: string; disabled?: boolean; danger?: boolean; key?: string } = {}) => (
    <button
      key={opts.key}
      role="menuitem"
      className={opts.danger ? "danger" : undefined}
      disabled={opts.disabled}
      onClick={() => {
        onClose();
        fn();
      }}
    >
      <span className="glyph">{icon}</span>
      <span className="label">{label}</span>
      {opts.hint && <span className="hint">{opts.hint}</span>}
    </button>
  );

  let body: React.ReactNode;
  if (at.docs?.length) {
    const ids = at.docs;
    const docs = file.docs.filter((d) => ids.includes(d.id));
    const here = new Set(docs.map((d) => folderOf(file, d)?.id ?? null));
    const only = here.size === 1 ? [...here][0] : undefined;
    const many = ids.length > 1;
    body = (
      <>
        {many && <div className="popover-title">{ids.length} documents</div>}
        {!many && item("Open", <OpenIcon />, () => act.open(ids[0]), { hint: "Enter" })}
        {!many && act.openSide && item("Open to the side", <SplitIcon />, () => act.openSide!(ids[0]), { hint: "Alt+click" })}
        {!many && item("Rename", <PencilIcon />, () => act.rename(ids[0]), { hint: "F2" })}
        <div className="popover-sep" />
        <div className="popover-title">Move to</div>
        {(file.folders ?? []).map((x) =>
          item(x.name, only === x.id ? <span className="check">✓</span> : <FolderIcon />, () => act.moveTo(ids, x.id), { disabled: only === x.id, key: x.id }),
        )}
        {item("No folder", only === null ? <span className="check">✓</span> : <CloseIcon />, () => act.moveTo(ids, null), { disabled: only === null })}
        {item(many ? "New folder with selection" : "New folder with document", <PlusIcon />, () => act.newFolder(ids))}
        <div className="popover-sep" />
        {item(many ? `Delete ${ids.length} documents` : "Delete", <TrashIcon />, () => act.deleteDocs(ids), { hint: "Del", danger: true })}
      </>
    );
  } else if (at.folder) {
    const id = at.folder;
    const n = file.docs.filter((d) => d.folder === id).length;
    body = (
      <>
        {item("Rename folder", <PencilIcon />, () => act.rename(id), { hint: "F2" })}
        <div className="popover-sep" />
        {item("Delete folder", <TrashIcon />, () => act.deleteFolder(id, false), { hint: n ? "Keep documents" : "Del" })}
        {n > 0 && item(`Delete folder and ${n} ${n === 1 ? "document" : "documents"}`, <TrashIcon />, () => act.deleteFolder(id, true), { danger: true })}
      </>
    );
  } else body = item("New folder", <FolderIcon />, () => act.newFolder());

  return createPortal(
    <div
      className="popover block-menu dl-menu"
      ref={ref}
      style={pos}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        e.stopPropagation();
        const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const k = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(k + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }}
    >
      {body}
    </div>,
    document.body,
  );
}

/* ─── 一份文件 ─── */

function DocPane(props: {
  fileName: string;
  doc: DockDoc;
  onChange: (patch: Partial<Omit<DockDoc, "id">>) => void;
  onModifySheet: (fn: (wb: Workbook) => Workbook) => void;
  /** 拿最新的內容與動畫改（簡報用） */
  onEditDeck: (fn: (d: Deck) => Deck) => void;
  /** 文件裡舊的已存樣式併進共用清單之後：拿掉文件裡的清單，renames 是撞名改掉的名稱 */
  onAdoptStyles: (renames: Map<string, string>) => void;
  onOpenPage: (title: string) => void;
  hasPage: (title: string) => boolean;
  onSendNotes: (texts: string[]) => void;
}) {
  const { doc, onChange } = props;
  /** 簡報：目前編輯的投影片 */
  const [current, setCurrent] = useState(0);
  const [present, setPresent] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 5000);
    return () => clearTimeout(t);
  }, [note]);
  const onContent = useCallback((content: string) => onChange({ content }), [onChange]);
  // 已存的區塊樣式：所有文件共用（styleLibrary.ts）
  const shared = useSavedStyles();
  const styleLib: StyleLib = useMemo(() => ({ styles: shared, change: changeStyles }), [shared]);
  const adopt = useRef(props.onAdoptStyles);
  adopt.current = props.onAdoptStyles;
  const oldStyles = doc.styles;
  useEffect(() => {
    if (!oldStyles?.length) return;
    let live = true;
    void adoptStyles(oldStyles).then((renames) => live && adopt.current(renames));
    return () => {
      live = false;
    };
  }, [oldStyles]);
  const slides = useMemo(() => (doc.kind === "slides" ? splitSlides(doc.content) : []), [doc.kind, doc.content]);

  const [exportMenu, setExportMenu] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const exportDoc = async (format?: ExportFormat) => {
    setExportMenu(false);
    // 列印／存成 PDF：系統的列印對話框
    if (format === "print") {
      const el = body.current;
      if (!el) return;
      if (doc.kind === "word") printPaper(el);
      else if (doc.kind === "slides") printSlides(el);
      else if (doc.kind === "sheet") printSheet(el);
      return;
    }
    setBusy(true);
    try {
      const base = doc.title.trim() || props.fileName;
      let name: string;
      let bytes: Uint8Array;
      if (doc.kind === "word" && format === "md") {
        name = `${base}.md`;
        bytes = new TextEncoder().encode(doc.content);
      } else if (doc.kind === "sheet" && format === "csv") {
        const wb = parseWorkbook(doc.content);
        const tid = activeTableId();
        const t = wb.sheets.flatMap((x) => x.tables).find((x) => x.id === tid) ?? wb.sheets[0].tables[0];
        if (!t) throw new Error("There is no table to export");
        name = `${base}${t.name && wb.sheets.flatMap((x) => x.tables).length > 1 ? ` - ${t.name}` : ""}.csv`;
        // 開頭加 BOM：Excel 才認得 UTF-8 的中文
        bytes = new TextEncoder().encode("﻿" + toCsv(t, new Calc(wb)));
      } else if (doc.kind === "word") {
        name = `${base}.docx`;
        bytes = await toDocx(doc.content, doc.page);
      } else if (doc.kind === "slides") {
        name = `${base}.pptx`;
        bytes = await toPptx(doc.content, base, doc.anim ?? [], doc.deck ?? {});
      } else if (doc.kind === "draw") {
        const d = parseDiagram(doc.content);
        const f = (format ?? "png") as "html" | "png" | "svg" | "drawio";
        name = `${base}.${f}`;
        const images = f === "png" ? {} : await loadImages(d);
        bytes =
          f === "png"
            ? await toPng(d)
            : new TextEncoder().encode(f === "html" ? toHtml(d, base, images) : f === "svg" ? toSvg(d, images).svg : toDrawio(d, base, images));
      } else if (doc.kind === "sheet") {
        name = `${base}.xlsx`;
        const wb = parseWorkbook(doc.content);
        bytes = toXlsx(wb, new Calc(wb));
      } else {
        name = `${base}.md`;
        bytes = new TextEncoder().encode(doc.content);
      }
      const path = await saveExport(name, bytes);
      setNote(path ? `Saved to ${path}` : `Downloaded ${name}`);
    } catch (err) {
      console.error("Export failed", err);
      setNote(`Couldn't export: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`doc-pane kind-${doc.kind}`}>
      <div className="dp-head">
        <TitleInput value={doc.title} onChange={(title) => onChange({ title })} />
        <span className="dp-kind">
          {kindIcon(doc.kind)} {kindLabel(doc.kind)}
          {doc.kind === "slides" && ` · ${slides.length} ${slides.length === 1 ? "slide" : "slides"}`}
        </span>
        <span className="dp-gap" />
        {doc.kind === "slides" && (
          <button className="dp-btn" onClick={() => setPresent(Math.min(current, slides.length - 1))} disabled={!slides.length} title="Present from this slide, full screen (Esc to stop)">
            <PlayIcon /> Present
          </button>
        )}
        {EXPORTS[doc.kind] ? (
          <ExportMenu items={EXPORTS[doc.kind]!} open={exportMenu} busy={busy} onToggle={() => setExportMenu((v) => !v)} onClose={() => setExportMenu(false)} onPick={exportDoc} />
        ) : (
          <button className="dp-btn primary" onClick={() => exportDoc()} disabled={busy} title="Save to your Downloads folder">
            <ExportIcon />{" "}
            {busy
              ? "Exporting…"
              : doc.kind === "word"
                ? "Export .docx"
                : doc.kind === "slides"
                  ? "Export .pptx"
                  : doc.kind === "sheet"
                    ? "Export .xlsx"
                    : "Export .md"}
          </button>
        )}
      </div>
      {note && (
        <div className="dp-note" role="status">
          {note}
        </div>
      )}
      <div className="dp-body" ref={body}>
        {doc.kind === "sheet" ? (
          <SheetView json={doc.content} onModify={props.onModifySheet} onSendNotes={props.onSendNotes} />
        ) : doc.kind === "draw" ? (
          <DrawView docId={doc.id} title={doc.title} value={doc.content} onChange={onContent} />
        ) : doc.kind === "word" ? (
          <WordView
            value={doc.content}
            onChange={onContent}
            page={doc.page}
            onPage={(page) => onChange({ page: isDefaultPage(page) ? undefined : page })}
            styles={styleLib}
          />
        ) : doc.kind === "slides" ? (
          <SlideDeck
            content={doc.content}
            slides={slides}
            current={Math.min(current, slides.length - 1)}
            onCurrent={setCurrent}
            anim={doc.anim ?? []}
            onEdit={props.onEditDeck}
            onPresent={setPresent}
            deck={doc.deck ?? {}}
            onDeck={(deck) => onChange({ deck: isDefaultDeck(deck) ? undefined : deck })}
            styles={styleLib}
          />
        ) : (
          <div className="dp-write">
            <Editor value={doc.content} onChange={onContent} placeholder="Start writing…" />
          </div>
        )}
      </div>
      {present !== null && slides.length > 0 && (
        <DeckContext.Provider value={doc.deck ?? {}}>
          <Presenter slides={slides} anim={doc.anim ?? []} start={present} onClose={() => setPresent(null)} />
        </DeckContext.Provider>
      )}
    </div>
  );
}

type ExportFormat = "html" | "png" | "svg" | "drawio" | "docx" | "md" | "pptx" | "xlsx" | "csv" | "print";

/** 各種文件的匯出選項（Word、Google 文件都有：下載成各種格式、列印／PDF） */
const EXPORTS: Partial<Record<DockKind, { id: ExportFormat; label: string; hint: string }[]>> = {
  word: [
    { id: "docx", label: "Word document", hint: ".docx" },
    { id: "md", label: "Markdown", hint: ".md" },
    { id: "print", label: "Print or Save as PDF…", hint: "PDF" },
  ],
  slides: [
    { id: "pptx", label: "PowerPoint", hint: ".pptx" },
    { id: "print", label: "Print or Save as PDF…", hint: "PDF" },
  ],
  sheet: [
    { id: "xlsx", label: "Excel workbook", hint: ".xlsx" },
    { id: "csv", label: "CSV (selected table)", hint: ".csv" },
    { id: "print", label: "Print or Save as PDF…", hint: "PDF" },
  ],
  draw: [
    { id: "html", label: "Web page", hint: ".html" },
    { id: "png", label: "PNG image", hint: ".png" },
    { id: "svg", label: "SVG vector", hint: ".svg" },
    { id: "drawio", label: "draw.io file", hint: ".drawio" },
  ],
};

/** 匯出選單 */
function ExportMenu(props: {
  items: { id: ExportFormat; label: string; hint: string }[];
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onClose: () => void;
  onPick: (f: ExportFormat) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!props.open) return;
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && props.onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
    };
  });
  return (
    <div className="dp-export" ref={ref}>
      <button className="dp-btn primary" onClick={props.onToggle} disabled={props.busy} title="Save to your Downloads folder">
        <ExportIcon /> {props.busy ? "Exporting…" : "Export"}
      </button>
      {props.open && (
        <div className="popover dp-export-menu">
          {props.items.map((it) => (
            <button key={it.id} onClick={() => props.onPick(it.id)}>
              {it.label}
              <span className="hint">{it.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 清單裡改名的輸入框：Enter 或離開完成（空的不改）、Esc 取消；按鍵不傳給清單 */
function RenameInput(props: { value: string; onDone: (title: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (t: string | null) => {
    if (done.current) return;
    done.current = true;
    props.onDone(t === null ? null : t.trim() || null);
  };
  return (
    <input
      ref={ref}
      className="dl-rename"
      defaultValue={props.value}
      spellCheck={false}
      aria-label="Document name"
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") finish(e.currentTarget.value);
        else if (e.key === "Escape") finish(null);
      }}
    />
  );
}

function TitleInput(props: { value: string; onChange: (v: string) => void }) {
  const [v, setV] = useState(props.value);
  useEffect(() => setV(props.value), [props.value]);
  const commit = () => {
    const t = v.trim();
    if (t && t !== props.value) props.onChange(t);
    else setV(props.value);
  };
  return (
    <input
      className="dp-title"
      value={v}
      spellCheck={false}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setV(props.value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}
