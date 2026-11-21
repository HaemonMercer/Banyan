import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  ClipIcon,
  CloseIcon,
  CopyIcon,
  DocIcon,
  DrawerIcon,
  ExportIcon,
  FolderIcon,
  HashIcon,
  ImportIcon,
  LinkIcon,
  OpenIcon,
  PlusIcon,
  QuoteIcon,
  SearchIcon,
  TrashIcon,
  WandIcon,
} from "../editor/icons";
import { importMediaPath, mediaFilePath, saveMedia } from "../editor/media";
import { findBacklinks, type Source } from "../pages/refIndex";
import { dayTitle } from "../journal/journal";
import { saveExport } from "../desk/export";
import {
  bibliography,
  inText,
  parseImport,
  reference,
  STYLES,
  toBibtex,
  toHtml,
  toMarkdown,
  toText,
  type Part,
  type Style,
} from "./cite";
import { lookup, parseIdentifier } from "./lookup";
import {
  addAttachment,
  addRemark,
  moveRemark,
  remarkRef,
  removeRemark,
  updateRemark,
  type Remark,
  addCollection,
  addItems,
  addToCollection,
  allTags,
  blankItem,
  childCollections,
  collectionCounts,
  creatorSummary,
  emptyTrash,
  fieldLabel,
  filterItems,
  findDuplicate,
  ITEM_TYPES,
  moveCollection,
  notePage,
  parseLibrary,
  removeAttachment,
  removeCollection,
  removeFromCollection,
  removeItems,
  renameCollection,
  renameTag,
  setTrashed,
  sortItems,
  TYPE_FIELDS,
  typeLabel,
  updateItem,
  yearOf,
  type Attachment,
  type Creator,
  type Item,
  type ItemType,
  type Library,
  type Scope,
  type SortKey,
} from "./model";
import { loadUi, saveUi } from "./store";
import { setCiteStyle } from "./citeRef";
import { AttachmentViewer, Menu, MenuRow, openLink, PickDialog, RenameInput, reveal, TagsEditor } from "./ui";
import { FileGlyph } from "./FilesPane";
import { FilesPane, type EntryDrag } from "./FilesPane";
import { DuplicateFinder, DuplicatePrompt, type DuplicateCheck } from "./Duplicates";
import {
  addFiles,
  addFolder,
  addToFolder,
  attachFile,
  checkDuplicates,
  childFolders,
  fileScopeFrom,
  fileScopeKey,
  fileLocation,
  fileTags,
  folderCounts,
  hasUnlinked,
  linkAttachments,
  moveFolder,
  pathLabel,
  removeFolder,
  renameEntry,
  renameFileTag,
  setFilesTrashed,
  type FileEntry,
  type FileScope,
  type Place,
} from "./files";
import "./drawer.css";

/** 要在 Drawer 裡打開的備註（`item` 是條目 id）。 */
export interface DrawerFocus {
  item: string;
  remark: string;
  stamp: number;
}

/** Drawer 的兩頁（像 Desk 檔案的 Whiteboard／Dock／Tasks）：文獻庫與檔案庫。由 App 的畫面決定（`{ kind: "drawer", tab }`）。 */
export type DrawerTab = "library" | "files";
export const nextDrawerTab = (t: DrawerTab): DrawerTab => (t === "library" ? "files" : "library");

/** Library／Files 切換：跟 `DeskSwitch` 一樣只有圖示，放在 App 頂端列的標題後面（Alt+D 輪流換） */
export function DrawerSwitch(props: { tab: DrawerTab; onTab: (t: DrawerTab) => void }) {
  const item = (t: DrawerTab, label: string, icon: ReactNode) => (
    <button
      className={props.tab === t ? "on" : ""}
      role="tab"
      aria-selected={props.tab === t}
      aria-label={label}
      title={`${label} (Alt+D to switch)`}
      onClick={() => props.onTab(t)}
    >
      {icon}
    </button>
  );
  return (
    <div className="desk-switch" role="tablist" aria-label="Library or Files">
      {item("library", "Library", <DrawerIcon />)}
      {item("files", "Files", <FolderIcon />)}
    </div>
  );
}

const scopeKey = (s: Scope) => (s.kind === "collection" ? `c:${s.id}` : s.kind);
/** 文獻庫頁左欄選的範圍（舊版記的 `f:…` 是檔案庫的資料夾，交給 `fileScopeFrom`） */
function scopeFrom(k: string | undefined, lib: Library): Scope {
  if (k === "unfiled" || k === "trash") return { kind: k };
  if (k?.startsWith("c:") && lib.collections.some((c) => c.id === k.slice(2))) return { kind: "collection", id: k.slice(2) };
  return { kind: "all" };
}
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const stripExt = (n: string) => n.replace(/\.[^.]+$/, "");

/** 複製到剪貼簿：同時放 HTML（斜體）與純文字。 */
async function copyRich(text: string, html?: string) {
  try {
    if (html && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
    } else await navigator.clipboard.writeText(text);
  } catch {
    await navigator.clipboard.writeText(text).catch(() => {});
  }
}

function Cite({ parts }: { parts: Part[] }) {
  return (
    <>
      {parts.map((p, i) => (p.italic ? <i key={i}>{p.text}</i> : <Fragment key={i}>{p.text}</Fragment>))}
    </>
  );
}

type MenuState =
  | { kind: "items"; x: number; y: number }
  | { kind: "collection"; x: number; y: number; id: string }
  | { kind: "tag"; x: number; y: number; tag: string }
  | { kind: "new"; x: number; y: number }
  | { kind: "export"; x: number; y: number }
  | { kind: "folder"; x: number; y: number; id: string }
  | null;

type FolderDrag = { kind: "folder"; id: string; label: string };

type Drag = { kind: "items"; ids: string[]; label: string } | { kind: "collection"; id: string; label: string } | EntryDrag | FolderDrag;

/* ─── 主畫面 ─── */

export function DrawerView(props: {
  /** 文獻庫 JSON；還沒讀進來是 undefined */
  json: string | undefined;
  onModify: (fn: (lib: Library) => Library) => void;
  sources: Source[];
  now: string;
  onOpenNotes: (it: Item) => void;
  onOpenSource: (s: Source) => void;
  /** 從別的地方點了備註的引用（`[[@引用鍵#r1]]`）：選取條目、打開 Remarks 分頁；stamp 每次點都不同 */
  focus?: DrawerFocus | null;
  /** 文獻庫或檔案庫 */
  tab: DrawerTab;
  onTab: (t: DrawerTab) => void;
}) {
  const lib = useMemo(() => parseLibrary(props.json ?? ""), [props.json]);
  const { onModify, tab, onTab } = props;
  const ui = useMemo(loadUi, []);
  const [scope, setScope] = useState<Scope>(() => scopeFrom(ui.scope, lib));
  const [fileScope, setFileScope] = useState<FileScope>(() => fileScopeFrom(ui.folder ?? (ui.scope?.startsWith("f:") ? ui.scope : undefined), lib));
  /** 檔案庫頁打開的資料夾（範圍不是資料夾時是 null） */
  const folder = fileScope.kind === "folder" ? fileScope.id : null;
  const [fileTagSel, setFileTagSel] = useState<string[]>([]);
  /** 附加的對話框：從檔案庫選檔案附加到條目，或把檔案附加到選的條目 */
  const [picking, setPicking] = useState<{ kind: "files"; item: string } | { kind: "items"; file: string } | null>(null);
  const files = tab === "files";
  /** 到文獻庫的某個範圍／檔案庫的某個資料夾（換到那一頁） */
  const goLibrary = (s: Scope) => {
    setScope(s);
    if (files) onTab("library");
  };
  const goFiles = (s: FileScope) => {
    setFileScope(s);
    if (!files) onTab("files");
  };
  const [fileSel, setFileSel] = useState<string[]>([]);
  const [dupAsk, setDupAsk] = useState<{ checks: DuplicateCheck[]; total: number; skip: () => void; all: () => void } | null>(null);
  const [dupTool, setDupTool] = useState(false);
  const [query, setQuery] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const [sort, setSort] = useState<SortKey>(() => (["title", "creator", "year", "added", "type"].includes(ui.sort ?? "") ? (ui.sort as SortKey) : "added"));
  const [desc, setDesc] = useState(() => ui.desc ?? true);
  const [style, setStyle] = useState<Style>(() => (ui.style === "mla" ? "mla" : "apa"));
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(ui.collapsed ?? []));
  const [menu, setMenu] = useState<MenuState>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [identify, setIdentify] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ name: string; src: string } | null>(null);
  const [drag, setDrag] = useState<(Drag & { x: number; y: number }) | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const focusTitle = useRef(false);

  useEffect(() => {
    saveUi({ scope: scopeKey(scope), folder: fileScopeKey(fileScope), sort, desc, style, collapsed: [...collapsed] });
  }, [scope, fileScope, sort, desc, style, collapsed]);
  // 編輯器裡的 [[@引用鍵]] 跟著用同一種格式
  useEffect(() => setCiteStyle(style), [style]);

  // 收藏被刪掉了就回到全部
  useEffect(() => {
    if (scope.kind === "collection" && props.json !== undefined && !lib.collections.some((c) => c.id === scope.id)) setScope({ kind: "all" });
    // 資料夾被刪掉了就回到 My Files
    if (folder && props.json !== undefined && !lib.folders.some((f) => f.id === folder)) setFileScope({ kind: "all" });
  }, [lib, scope, folder, props.json]);

  // 每個檔案附件都存在檔案庫（`linkAttachments`）：附加檔案、拖檔案建條目、舊資料，一律在這裡補上
  useEffect(() => {
    if (props.json !== undefined && hasUnlinked(lib)) onModify(linkAttachments);
  }, [lib, props.json, onModify]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const shown = useMemo(() => sortItems(filterItems(lib, scope, query, tags), sort, desc), [lib, scope, query, tags, sort, desc]);
  const counts = useMemo(() => collectionCounts(lib), [lib]);
  const tagList = useMemo(() => allTags(lib), [lib]);
  const fileTagList = useMemo(() => fileTags(lib), [lib]);
  const fileCounts = useMemo(() => folderCounts(lib), [lib]);
  const byId = useMemo(() => new Map(lib.items.map((i) => [i.id, i])), [lib]);
  const selected = sel.map((id) => byId.get(id)).filter((i): i is Item => !!i);
  const current = selected.length === 1 ? selected[0] : null;
  const total = lib.items.filter((i) => !i.trashed).length;

  // 從引用點過來：選取條目（清掉搜尋與標籤篩選，範圍換成它所在的地方）
  const focusStamp = props.focus?.stamp;
  useEffect(() => {
    const f = props.focus;
    const it = f && byId.get(f.item);
    if (!it) return;
    goLibrary(it.trashed ? { kind: "trash" } : { kind: "all" });
    setQuery("");
    setTags([]);
    setSel([it.id]);
    // 只在每次點引用時執行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusStamp]);
  const trashCount = lib.items.length - total;

  // 選取的條目不在畫面上了就拿掉
  useEffect(() => {
    const vis = new Set(shown.map((i) => i.id));
    setSel((s) => (s.every((id) => vis.has(id)) ? s : s.filter((id) => vis.has(id))));
  }, [shown]);

  useEffect(() => {
    if (focusTitle.current && current) {
      focusTitle.current = false;
      titleRef.current?.focus();
    }
  }, [current]);

  const scopeCollection = scope.kind === "collection" ? scope.id : null;

  /** 加入新條目：放進目前的收藏，選取第一個。 */
  const addNew = useCallback(
    (items: Item[], coll: string | null = scopeCollection) => {
      if (!items.length) return;
      const withColl = items.map((it) => (coll && !it.collections.includes(coll) ? { ...it, collections: [...it.collections, coll] } : it));
      onModify((l) => addItems(l, withColl));
      if (scope.kind === "trash" || (scope.kind === "unfiled" && coll)) setScope({ kind: "all" });
      if (files) onTab("library");
      setQuery("");
      setTags([]);
      setSel(withColl.map((i) => i.id));
    },
    [onModify, onTab, files, scope.kind, scopeCollection],
  );

  const newItem = (type: ItemType) => {
    focusTitle.current = true;
    addNew([blankItem(type)]);
  };

  const patch = (id: string, p: Partial<Item>) => onModify((l) => updateItem(l, id, p));

  const trash = (ids: string[]) => {
    if (!ids.length) return;
    if (scope.kind === "trash") {
      if (!window.confirm(ids.length === 1 ? "Delete this item permanently? This can't be undone." : `Delete ${ids.length} items permanently? This can't be undone.`)) return;
      onModify((l) => removeItems(l, ids));
    } else {
      onModify((l) => setTrashed(l, ids, true));
      setNotice(ids.length === 1 ? "Moved 1 item to the Trash" : `Moved ${ids.length} items to the Trash`);
    }
    // 選取下一個
    const idx = shown.findIndex((i) => i.id === ids[ids.length - 1]);
    const next = shown.slice(idx + 1).find((i) => !ids.includes(i.id)) ?? [...shown.slice(0, idx)].reverse().find((i) => !ids.includes(i.id));
    setSel(next ? [next.id] : []);
  };

  /* ─── 複製引用 ─── */

  const copyReference = (items: Item[]) => {
    if (!items.length) return;
    const refs = bibliography(items, style);
    if (refs.length === 1) void copyRich(toText(refs[0]), toHtml(refs[0]));
    // 好幾筆：純文字是 Markdown 清單（貼進編輯器就是一筆一個區塊、保留斜體）
    else void copyRich(refs.map((r) => `- ${toMarkdown(r)}`).join("\n"), refs.map((r) => `<p>${toHtml(r)}</p>`).join(""));
    setNotice(refs.length === 1 ? "Copied the reference" : `Copied ${refs.length} references`);
  };
  const copyInText = (items: Item[]) => {
    const t = items.map((i) => inText(i, style).slice(1, -1)).join("; ");
    void copyRich(`(${t})`);
    setNotice("Copied the in-text citation");
  };
  const copyLink = (items: Item[]) => {
    void copyRich(items.map((i) => `[[${notePage(i)}]]`).join(" "));
    setNotice("Copied — paste it in a journal or page to cite");
  };
  const copyRemark = (it: Item, r: Remark, embed: boolean) => {
    void copyRich(`${embed ? "!" : ""}[[${remarkRef(it, r)}]]`);
    setNotice(embed ? "Copied — paste it on its own line to show this remark" : "Copied — paste it in a journal or page to cite this remark");
  };
  const copyBibtex = (items: Item[]) => {
    void copyRich(toBibtex(items));
    setNotice("Copied BibTeX");
  };

  /* ─── 匯入、匯出 ─── */

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const found: Item[] = [];
    for (const f of [...files]) found.push(...parseImport(await f.text()));
    if (!found.length) {
      setNotice("Nothing to import — use a BibTeX (.bib) or CSL-JSON (.json) file");
      return;
    }
    const fresh = found.filter((it) => !findDuplicate(lib, it));
    addNew(fresh);
    const dup = found.length - fresh.length;
    setNotice(`Imported ${fresh.length} ${fresh.length === 1 ? "item" : "items"}${dup ? ` · skipped ${dup} already in your library` : ""}`);
  };

  const exportBib = async (items: Item[]) => {
    if (!items.length) return;
    const name = scope.kind === "collection" ? (lib.collections.find((c) => c.id === scope.id)?.name ?? "Drawer") : "Drawer";
    const path = await saveExport(`${name}.bib`, new TextEncoder().encode(toBibtex(items) + "\n"));
    setNotice(path ? `Saved ${baseName(path)} to Downloads` : `Exported ${items.length} items`);
  };

  /* ─── 附件 ─── */

  /** 存進 media/（內容雜湊命名），失敗的略過並顯示原因。 */
  const saveAll = async (files: File[]) => {
    const saved: { name: string; src: string; size: number }[] = [];
    for (const f of files) {
      try {
        saved.push({ name: f.name, src: await saveMedia(f), size: f.size });
      } catch (err) {
        setNotice(`Couldn't add ${f.name}: ${String(err)}`);
      }
    }
    return saved;
  };

  /** 加入檔案前檢查重複內容：有重複就先問（略過重複的、照樣加入或取消）。 */
  const guardDuplicates = <T extends { name: string; src: string }>(entries: T[], apply: (keep: T[]) => void) => {
    if (!entries.length) return;
    const checks = checkDuplicates(lib, entries);
    if (!checks.length) return apply(entries);
    const dup = new Set<T>(checks.map((c) => c.entry));
    setDupAsk({
      checks,
      total: entries.length,
      skip: () => {
        const keep = entries.filter((e) => !dup.has(e));
        if (keep.length) apply(keep);
        setNotice(`Skipped ${dup.size === 1 ? "1 file" : `${dup.size} files`} already in your Drawer`);
      },
      all: () => apply(entries),
    });
  };

  /** 附加到條目，同時存進檔案庫（同樣內容的檔案已經在檔案庫就連到那一筆，不另外存，所以不用問重複） */
  const attachSaved = (id: string, saved: { name: string; src: string }[]) => {
    if (!saved.length) return;
    onModify((l) => linkAttachments(saved.reduce((acc, s) => addAttachment(acc, id, { name: s.name, src: s.src, kind: "file" }), l)));
    setNotice(`Attached ${saved.length === 1 ? "1 file" : `${saved.length} files`} — ${saved.length === 1 ? "it's" : "they're"} also in Files`);
  };

  const attachFiles = async (id: string, files: File[]) => attachSaved(id, await saveAll(files));

  /** 加進檔案庫（放進資料夾，null 是 Unfiled），切到看得到它們的範圍並選取新的檔案。 */
  const addIntoFiles = (folder: string | null, saved: { name: string; src: string; size?: number }[]) =>
    guardDuplicates(saved, (keep) => {
      let ids: string[] = [];
      onModify((l) => {
        const r = addFiles(l, folder, keep);
        ids = r.ids;
        return r.lib;
      });
      goFiles(folder ? { kind: "folder", id: folder } : fileScope.kind === "unfiled" ? fileScope : { kind: "all" });
      setFileTagSel([]);
      setFileSel(ids);
      setNotice(`Added ${ids.length === 1 ? "1 file" : `${ids.length} files`}${folder ? ` to ${pathLabel(lib, folder)}` : ""}`);
    });

  /** 用檔案庫的檔案建一個條目（檔案留在檔案庫，附件連到它）。 */
  const convertToItem = (f: FileEntry) => {
    const it = blankItem("other");
    it.title = stripExt(f.name);
    it.attachments = [{ id: `a${it.id}`, name: f.name, src: f.src, kind: "file", added: Date.now(), file: f.id }];
    addNew([it], null);
    setNotice(`Made a new item with “${f.name}” attached — fill in its details to cite it`);
  };

  /** 到某個重複檔案所在的地方。 */
  const showPlace = (p: Place) => {
    setDupAsk(null);
    setDupTool(false);
    if (p.kind === "file") {
      goFiles(p.file.trashed ? { kind: "trash" } : { kind: "all" });
      setFileTagSel([]);
      setFileSel([p.file.id]);
    } else {
      goLibrary(p.item.trashed ? { kind: "trash" } : { kind: "all" });
      setQuery("");
      setTags([]);
      setSel([p.item.id]);
    }
  };

  // 從檔案總管拖進來的檔案（Tauri 的原生拖放）：放在條目上就附加，否則每個檔案一個新條目
  const dropRef = useRef<(paths: string[], x: number, y: number) => void>(() => {});
  dropRef.current = (paths, x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el?.closest(".drawer")) return;
    const row = el.closest<HTMLElement>("[data-item]")?.dataset.item;
    const coll = el.closest<HTMLElement>("[data-drop]")?.dataset.drop;
    // 放在檔案庫（資料夾、麵包屑、左欄的資料夾）就加進那個資料夾；檔案庫頁的其他地方加進目前的資料夾（不是資料夾就是 Unfiled）
    const toFolder = coll?.startsWith("f:") ? coll.slice(2) || null : coll?.startsWith("f-") ? null : files && !el.closest(".dr-side") ? folder : undefined;
    void (async () => {
      const saved: { name: string; src: string }[] = [];
      for (const p of paths) {
        try {
          saved.push({ name: baseName(p), src: await importMediaPath(p) });
        } catch (err) {
          setNotice(`Couldn't add ${baseName(p)}: ${String(err)}`);
        }
      }
      if (!saved.length) return;
      if (toFolder !== undefined) {
        addIntoFiles(toFolder, saved);
        return;
      }
      if (row && byId.has(row)) {
        attachSaved(row, saved);
        setSel([row]);
        return;
      }
      guardDuplicates(saved, (keep) => {
        const items = keep.map((s) => {
          const it = blankItem("other");
          it.title = stripExt(s.name);
          it.attachments = [{ id: `a${it.id}`, name: s.name, src: s.src, kind: "file", added: Date.now() }];
          return it;
        });
        addNew(items, coll?.startsWith("c:") ? coll.slice(2) : scopeCollection);
      });
    })();
  };
  useEffect(() => {
    if (!isTauri()) return;
    let off: (() => void) | undefined;
    let alive = true;
    void import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
      getCurrentWebview()
        .onDragDropEvent((ev) => {
          if (ev.payload.type !== "drop") return;
          const r = window.devicePixelRatio;
          dropRef.current(ev.payload.paths, ev.payload.position.x / r, ev.payload.position.y / r);
        })
        .then((fn) => {
          if (alive) off = fn;
          else fn();
        }),
    );
    return () => {
      alive = false;
      off?.();
    };
  }, []);

  /* ─── 選取與拖曳（指標事件；拖到左欄的收藏） ─── */

  const pickRow = (e: React.PointerEvent | React.MouseEvent, id: string) => {
    if (e.shiftKey && anchor.current) {
      const a = shown.findIndex((i) => i.id === anchor.current);
      const b = shown.findIndex((i) => i.id === id);
      if (a >= 0 && b >= 0) {
        const range = shown.slice(Math.min(a, b), Math.max(a, b) + 1).map((i) => i.id);
        setSel(e.ctrlKey || e.metaKey ? [...new Set([...sel, ...range])] : range);
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
      anchor.current = id;
      return;
    }
    if (!sel.includes(id)) setSel([id]);
    anchor.current = id;
  };

  const startDrag = (e: React.PointerEvent, d: Drag) => {
    if (e.button !== 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    let on = false;
    const move = (ev: PointerEvent) => {
      if (!on && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      on = true;
      setDrag({ ...d, x: ev.clientX, y: ev.clientY });
      const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-drop]");
      const drop = t?.dataset.drop ?? null;
      // 檔案庫的東西只能放在檔案庫的目標（`f:資料夾`、`f-trash`），條目與收藏不能放進資料夾；資料夾不能丟進垃圾桶
      const fileDrag = d.kind === "entries" || d.kind === "folder";
      const ok = drop && fileDrag === drop.startsWith("f") && !(d.kind === "folder" && (drop === `f:${d.id}` || drop.startsWith("f-")));
      setDropTarget(ok ? drop : null);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", esc);
      setDrag(null);
      setDropTarget(null);
      if (!on) {
        // 沒拖動：點一下只選這一個（按下時保留多選，才能拖整組）
        if (d.kind === "items" && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) setSel([d.ids[0]]);
        if (d.kind === "entries" && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && files) setFileSel([d.ids[0]]);
        return;
      }
      const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-drop]")?.dataset.drop;
      if (!t) return;
      if (d.kind === "entries") {
        if (t === "f-trash") {
          onModify((l) => setFilesTrashed(l, d.ids, true));
          setNotice(d.ids.length === 1 ? "Moved 1 file to the Trash" : `Moved ${d.ids.length} files to the Trash`);
          return;
        }
        const to = t.startsWith("f:") ? t.slice(2) : "";
        if (!to) return;
        // 放進資料夾（原本的資料夾保留，像把條目加進收藏）
        onModify((l) => addToFolder(l, d.ids, to));
        setNotice(`Added ${d.ids.length === 1 ? "1 file" : `${d.ids.length} files`} to “${pathLabel(lib, to)}”`);
      } else if (d.kind === "folder") {
        if (t.startsWith("f:") && t.slice(2) !== d.id) onModify((l) => moveFolder(l, d.id, t.slice(2) || null));
      } else if (d.kind === "items") {
        if (t.startsWith("c:")) {
          const c = t.slice(2);
          onModify((l) => addToCollection(l, d.ids, c));
          const name = lib.collections.find((x) => x.id === c)?.name;
          setNotice(`Added ${d.ids.length === 1 ? "1 item" : `${d.ids.length} items`} to “${name}”`);
        } else if (t === "trash") trash(d.ids);
        else if (t === "unfiled" && scopeCollection) onModify((l) => removeFromCollection(l, d.ids, scopeCollection));
      } else {
        if (t.startsWith("f:")) return;
        if (t.startsWith("c:") && t.slice(2) !== d.id) onModify((l) => moveCollection(l, d.id, t.slice(2)));
        else if (t === "all" || t === "top") onModify((l) => moveCollection(l, d.id, null));
      }
    };
    const esc = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      on = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", esc);
      setDrag(null);
      setDropTarget(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", esc);
  };

  const onTableKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input, textarea, select")) return;
    const idx = shown.findIndex((i) => i.id === (anchor.current ?? sel[0]));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = shown[Math.max(0, Math.min(shown.length - 1, idx + (e.key === "ArrowDown" ? 1 : -1)))];
      if (!next) return;
      anchor.current = next.id;
      setSel(e.shiftKey ? [...new Set([...sel, next.id])] : [next.id]);
      tableRef.current?.querySelector(`[data-item="${next.id}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      trash(sel);
    } else if ((e.ctrlKey || e.metaKey) && e.code === "KeyA") {
      e.preventDefault();
      setSel(shown.map((i) => i.id));
    } else if ((e.ctrlKey || e.metaKey) && e.code === "KeyC" && selected.length) {
      e.preventDefault();
      if (e.shiftKey) copyInText(selected);
      else copyReference(selected);
    } else if (e.key === "Enter" && current) {
      e.preventDefault();
      titleRef.current?.focus();
    }
  };

  const sortBy = (k: SortKey) => {
    if (sort === k) setDesc(!desc);
    else {
      setSort(k);
      setDesc(k === "added" || k === "year");
    }
  };

  /* ─── 左欄 ─── */

  const newCollection = (parent: string | null) => {
    let made = "";
    onModify((l) => {
      const r = addCollection(l, "New Collection", parent);
      made = r.id;
      return r.lib;
    });
    if (parent) setCollapsed((c) => new Set([...c].filter((x) => x !== parent)));
    // modify 是同步的（文獻庫已經讀進來），直接進入改名
    if (made) {
      setScope({ kind: "collection", id: made });
      setRenaming(made);
    }
  };

  const scopeRow = (s: Scope, icon: ReactNode, label: string, count: number, drop: string) => (
    <button
      className={`dr-scope${scopeKey(scope) === scopeKey(s) ? " on" : ""}${dropTarget === drop ? " drop" : ""}`}
      data-drop={drop}
      onClick={() => {
        setScope(s);
        setSel([]);
      }}
    >
      <span className="dr-twisty" />
      {icon}
      <span className="dr-scope-name">{label}</span>
      {count > 0 && <span className="dr-count">{count}</span>}
    </button>
  );

  const renderTree = (parent: string | null, depth: number): ReactNode =>
    childCollections(lib, parent).map((c) => {
      const kids = childCollections(lib, c.id).length > 0;
      const open = !collapsed.has(c.id);
      const s: Scope = { kind: "collection", id: c.id };
      return (
        <Fragment key={c.id}>
          <div
            className={`dr-scope${scopeKey(scope) === scopeKey(s) ? " on" : ""}${dropTarget === `c:${c.id}` ? " drop" : ""}`}
            style={{ paddingLeft: 6 + depth * 14 }}
            data-drop={`c:${c.id}`}
            role="button"
            tabIndex={0}
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest("input, .dr-twisty")) return;
              startDrag(e, { kind: "collection", id: c.id, label: c.name });
            }}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("input, .dr-twisty")) return;
              setScope(s);
              setSel([]);
            }}
            onDoubleClick={() => setRenaming(c.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ kind: "collection", x: e.clientX, y: e.clientY, id: c.id });
            }}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter") setScope(s);
              if (e.key === "F2") setRenaming(c.id);
            }}
          >
            <span
              className={`dr-twisty${kids ? "" : " none"}${open ? " open" : ""}`}
              onClick={() =>
                kids &&
                setCollapsed((cs) => {
                  const n = new Set(cs);
                  if (n.has(c.id)) n.delete(c.id);
                  else n.add(c.id);
                  return n;
                })
              }
            >
              {kids && <ChevronRightIcon />}
            </span>
            <FolderIcon />
            {renaming === c.id ? (
              <RenameInput
                value={c.name}
                onDone={(v) => {
                  setRenaming(null);
                  if (v !== null) onModify((l) => renameCollection(l, c.id, v));
                }}
              />
            ) : (
              <span className="dr-scope-name">{c.name}</span>
            )}
            {(counts.get(c.id) ?? 0) > 0 && <span className="dr-count">{counts.get(c.id)}</span>}
          </div>
          {kids && open && renderTree(c.id, depth + 1)}
        </Fragment>
      );
    });

  const newFolder = (parent: string | null) => {
    let made = "";
    onModify((l) => {
      const r = addFolder(l, parent);
      made = r.id;
      return r.lib;
    });
    if (parent) setCollapsed((c) => new Set([...c].filter((x) => x !== parent)));
    if (made) {
      goFiles({ kind: "folder", id: made });
      setRenaming(made);
    }
  };

  const deleteFolder = (id: string) => {
    const f = lib.folders.find((x) => x.id === id);
    if (!f) return;
    if (!window.confirm(`Delete the folder “${f.name}” and its subfolders? The files stay in All Files.`)) return;
    onModify((l) => removeFolder(l, id));
  };

  const renderFolders = (parent: string | null, depth: number): ReactNode =>
    childFolders(lib, parent).map((f) => {
      const kids = childFolders(lib, f.id).length > 0;
      const open = !collapsed.has(f.id);
      const on = folder === f.id;
      const n = fileCounts.get(f.id) ?? 0;
      return (
        <Fragment key={f.id}>
          <div
            className={`dr-scope${on ? " on" : ""}${dropTarget === `f:${f.id}` ? " drop" : ""}`}
            style={{ paddingLeft: 6 + depth * 14 }}
            data-drop={`f:${f.id}`}
            role="button"
            tabIndex={0}
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest("input, .dr-twisty")) return;
              startDrag(e, { kind: "folder", id: f.id, label: f.name });
            }}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("input, .dr-twisty")) return;
              setFileScope({ kind: "folder", id: f.id });
              setFileSel([]);
            }}
            onDoubleClick={() => setRenaming(f.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ kind: "folder", x: e.clientX, y: e.clientY, id: f.id });
            }}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter") setFileScope({ kind: "folder", id: f.id });
              if (e.key === "F2") setRenaming(f.id);
            }}
          >
            <span
              className={`dr-twisty${kids ? "" : " none"}${open ? " open" : ""}`}
              onClick={() =>
                kids &&
                setCollapsed((cs) => {
                  const s = new Set(cs);
                  if (s.has(f.id)) s.delete(f.id);
                  else s.add(f.id);
                  return s;
                })
              }
            >
              {kids && <ChevronRightIcon />}
            </span>
            <FolderIcon />
            {renaming === f.id ? (
              <RenameInput
                value={f.name}
                onDone={(v) => {
                  setRenaming(null);
                  if (v !== null) onModify((l) => renameEntry(l, f.id, v));
                }}
              />
            ) : (
              <span className="dr-scope-name">{f.name}</span>
            )}
            {n > 0 && <span className="dr-count">{n}</span>}
          </div>
          {kids && open && renderFolders(f.id, depth + 1)}
        </Fragment>
      );
    });

  const empty = props.json !== undefined && !lib.items.length;
  const inTrash = scope.kind === "trash";
  const liveFiles = lib.files.filter((x) => !x.trashed);
  // 左欄的標籤：各頁各自的
  const sideTags = files ? fileTagList : tagList;
  const sideSel = files ? fileTagSel : tags;
  const setSideSel = files ? setFileTagSel : setTags;

  const fileScopeRow = (sc: FileScope, icon: ReactNode, label: string, count: number, drop: string) => (
    <button
      className={`dr-scope${fileScopeKey(fileScope) === fileScopeKey(sc) ? " on" : ""}${dropTarget === drop ? " drop" : ""}`}
      data-drop={drop}
      onClick={() => {
        setFileScope(sc);
        setFileSel([]);
      }}
    >
      <span className="dr-twisty" />
      {icon}
      <span className="dr-scope-name">{label}</span>
      {count > 0 && <span className="dr-count">{count}</span>}
    </button>
  );

  return (
    <div className={`drawer${drag ? " dragging" : ""}`}>
      <aside className="dr-side">
        {files ? (
          <>
        {/* 和文獻庫一樣：上面是固定的範圍（全部、沒有資料夾的、垃圾桶），下面是資料夾樹 */}
        <div className="dr-side-head">
          <span>Files</span>
        </div>
        <div className="dr-fixed">
          {fileScopeRow({ kind: "all" }, <DrawerIcon />, "All Files", liveFiles.length, "f-all")}
          {fileScopeRow({ kind: "unfiled" }, <DocIcon />, "Unfiled Files", liveFiles.filter((x) => !x.folders.length).length, "f-unfiled")}
          {fileScopeRow({ kind: "trash" }, <TrashIcon />, "Trash", lib.files.length - liveFiles.length, "f-trash")}
        </div>
        <div className={`dr-side-head dr-coll-head${dropTarget === "f:" ? " drop" : ""}`} data-drop="f:">
          <span>Folders</span>
          <button className="icon-btn" title="New folder" onClick={() => newFolder(null)}>
            <PlusIcon />
          </button>
        </div>
        <div className="dr-tree dr-ftree">
          {lib.folders.length ? (
            renderFolders(null, 0)
          ) : (
            <button className="dr-coll-empty" onClick={() => newFolder(null)}>
              <PlusIcon /> New folder
            </button>
          )}
        </div>
          </>
        ) : (
          <>
        {/* 上面是固定的範圍（全部、未分類、垃圾桶），下面是使用者自己的收藏 */}
        <div className="dr-side-head">
          <span>Library</span>
        </div>
        <div className="dr-fixed">
          {scopeRow({ kind: "all" }, <DrawerIcon />, "My Library", total, "all")}
          {scopeRow({ kind: "unfiled" }, <DocIcon />, "Unfiled Items", lib.items.filter((i) => !i.trashed && !i.collections.length).length, "unfiled")}
          {scopeRow({ kind: "trash" }, <TrashIcon />, "Trash", trashCount, "trash")}
        </div>
        <div className={`dr-side-head dr-coll-head${drag?.kind === "collection" && dropTarget === "top" ? " drop" : ""}`} data-drop="top">
          <span>Collections</span>
          <button className="icon-btn" title="New collection" onClick={() => newCollection(null)}>
            <PlusIcon />
          </button>
        </div>
        <div className="dr-tree">
          {lib.collections.length ? (
            renderTree(null, 0)
          ) : (
            <button className="dr-coll-empty" onClick={() => newCollection(null)}>
              <PlusIcon /> New collection
            </button>
          )}
        </div>
          </>
        )}
        {sideTags.length > 0 && (
          <div className="dr-tags">
            <div className="dr-side-head">
              <span>Tags</span>
              {sideSel.length > 0 && (
                <button className="dr-link" onClick={() => setSideSel([])}>
                  Clear
                </button>
              )}
            </div>
            <div className="dr-tag-list">
              {sideTags.map(({ tag, count }) => (
                <button
                  key={tag}
                  className={`dr-tag${sideSel.includes(tag) ? " on" : ""}`}
                  title={`${count} ${count === 1 ? (files ? "file" : "item") : files ? "files" : "items"}`}
                  onClick={() => setSideSel((ts) => (ts.includes(tag) ? ts.filter((t) => t !== tag) : [...ts, tag]))}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ kind: "tag", x: e.clientX, y: e.clientY, tag });
                  }}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>

      {files ? (
        <FilesPane
          lib={lib}
          scope={fileScope}
          onScope={(sc) => {
            setFileScope(sc);
            setFileSel([]);
          }}
          tags={fileTagSel}
          onNewFolder={newFolder}
          sel={fileSel}
          onSel={setFileSel}
          onModify={onModify}
          onAdd={(folder, list) => void saveAll(list).then((saved) => addIntoFiles(folder, saved))}
          onView={setViewing}
          onFindDuplicates={() => setDupTool(true)}
          onShowPlace={showPlace}
          onCreateItem={convertToItem}
          onAttachTo={(fileId) => setPicking({ kind: "items", file: fileId })}
          startDrag={startDrag}
          dropTarget={dropTarget}
          onNotice={setNotice}
          now={props.now}
        />
      ) : (
      <>
      <section className="dr-main">
        <div className="dr-toolbar">
          <button className="dr-btn primary" onClick={(e) => setMenu({ kind: "new", x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().bottom + 4 })}>
            <PlusIcon /> New item
          </button>
          <button className={`dr-btn${identify ? " on" : ""}`} onClick={() => setIdentify((v) => !v)} title="Add items by DOI, ISBN, arXiv ID or URL">
            <WandIcon /> Add by identifier
          </button>
          <button className="dr-btn" onClick={() => importRef.current?.click()} title="Import BibTeX (.bib) or CSL-JSON (.json)">
            <ImportIcon /> Import
          </button>
          <button className="dr-btn" onClick={(e) => setMenu({ kind: "export", x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().bottom + 4 })}>
            <ExportIcon /> Export
          </button>
          {inTrash && trashCount > 0 && (
            <button
              className="dr-btn danger"
              onClick={() => window.confirm(`Delete all ${trashCount} items in the Trash permanently? This can't be undone.`) && onModify(emptyTrash)}
            >
              <TrashIcon /> Empty Trash
            </button>
          )}
          <label className="dr-search">
            <SearchIcon />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
              placeholder="Search title, creator, year, tag…"
              spellCheck={false}
            />
          </label>
          <input
            ref={importRef}
            type="file"
            accept=".bib,.bibtex,.json,application/json,application/x-bibtex"
            multiple
            hidden
            onChange={(e) => {
              void importFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        {identify && (
          <IdentifierBox
            onClose={() => setIdentify(false)}
            onFound={(items) => {
              const fresh: Item[] = [];
              const dups: Item[] = [];
              for (const it of items) {
                const d = findDuplicate(lib, it) ?? fresh.find((f) => findDuplicate({ items: [f], collections: [], folders: [], files: [] }, it));
                if (d) dups.push(d);
                else fresh.push(it);
              }
              addNew(fresh);
              if (!fresh.length && dups.length) setSel(dups.map((d) => d.id));
              if (dups.length) setNotice(`${dups.length === 1 ? "1 item is" : `${dups.length} items are`} already in your library`);
            }}
          />
        )}

        <div className="dr-table" ref={tableRef} tabIndex={0} onKeyDown={onTableKey}>
          <div className="dr-row dr-head">
            {(
              [
                ["title", "Title"],
                ["creator", "Creator"],
                ["year", "Year"],
              ] as [SortKey, string][]
            ).map(([k, label]) => (
              <button key={k} className={`dr-col-${k}${sort === k ? " sorted" : ""}`} onClick={() => sortBy(k)}>
                {label}
                {sort === k && <span className="dr-sort">{desc ? "▾" : "▴"}</span>}
              </button>
            ))}
            <button className={`dr-col-att${sort === "added" ? " sorted" : ""}`} onClick={() => sortBy("added")} title="Sort by date added">
              <ClipIcon />
            </button>
          </div>
          {shown.map((it) => (
            <div
              key={it.id}
              data-item={it.id}
              className={`dr-row${sel.includes(it.id) ? " on" : ""}`}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                tableRef.current?.focus({ preventScroll: true });
                pickRow(e, it.id);
                if (e.shiftKey || e.ctrlKey || e.metaKey) return;
                const ids = sel.includes(it.id) ? [it.id, ...sel.filter((x) => x !== it.id)] : [it.id];
                startDrag(e, { kind: "items", ids, label: ids.length === 1 ? it.title || "Untitled" : `${ids.length} items` });
              }}
              onDoubleClick={() => {
                const a = it.attachments[0];
                if (a) setViewing(a);
                else if (it.url || it.doi) void openLink(it.doi ? `https://doi.org/${it.doi}` : it.url);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!sel.includes(it.id)) setSel([it.id]);
                setMenu({ kind: "items", x: e.clientX, y: e.clientY });
              }}
            >
              <span className="dr-col-title">
                <TypeGlyph type={it.type} />
                <span className="dr-cell-text">{it.title || <em className="dr-untitled">Untitled</em>}</span>
              </span>
              <span className="dr-col-creator">{creatorSummary(it)}</span>
              <span className="dr-col-year">{yearOf(it.date)}</span>
              <span className="dr-col-att">{it.attachments.length > 0 && <ClipIcon />}</span>
            </div>
          ))}
          {props.json !== undefined && !shown.length && (
            <div className="dr-empty">
              {empty ? (
                <>
                  <strong>Your drawer is empty</strong>
                  Collect papers, books and web pages here. Click <b>Add by identifier</b> and paste a DOI, ISBN or arXiv ID, <b>Import</b> a
                  BibTeX file, or drop PDFs onto this window.
                </>
              ) : inTrash ? (
                <>The Trash is empty</>
              ) : query || tags.length ? (
                <>No items match</>
              ) : (
                <>No items in this collection yet — drag items here from My Library</>
              )}
            </div>
          )}
        </div>
        <div className="dr-status">
          {sel.length > 1 ? `${sel.length} of ${shown.length} selected` : `${shown.length} ${shown.length === 1 ? "item" : "items"}`}
          {notice && <span className="dr-notice">{notice}</span>}
        </div>
      </section>

      <aside className="dr-detail">
        {current ? (
          <ItemPane
            key={current.id}
            item={current}
            lib={lib}
            style={style}
            onStyle={setStyle}
            titleRef={titleRef}
            sources={props.sources}
            now={props.now}
            onPatch={(p) => patch(current.id, p)}
            onAttach={(files) => void attachFiles(current.id, files)}
            onAddLink={(url) => onModify((l) => addAttachment(l, current.id, { name: url, src: url, kind: "link" }))}
            onRemoveAttachment={(a) => onModify((l) => removeAttachment(l, current.id, a))}
            onFromFiles={() => setPicking({ kind: "files", item: current.id })}
            onShowFile={(fileId) => {
              const f = lib.files.find((x) => x.id === fileId);
              if (!f) return;
              goFiles(f.trashed ? { kind: "trash" } : { kind: "all" });
              setFileTagSel([]);
              setFileSel([f.id]);
            }}
            onView={setViewing}
            onOpenNotes={() => props.onOpenNotes(current)}
            onOpenSource={props.onOpenSource}
            onCopy={(what) =>
              what === "ref" ? copyReference([current]) : what === "intext" ? copyInText([current]) : what === "bib" ? copyBibtex([current]) : copyLink([current])
            }
            onRemoveFromCollection={(c) => onModify((l) => removeFromCollection(l, [current.id], c))}
            focus={props.focus?.item === current.id ? props.focus : null}
            onAddRemark={() => onModify((l) => addRemark(l, current.id).lib)}
            onEditRemark={(r, p) => onModify((l) => updateRemark(l, current.id, r, p))}
            onRemoveRemark={(r) => onModify((l) => removeRemark(l, current.id, r))}
            onMoveRemark={(r, dir) => onModify((l) => moveRemark(l, current.id, r, dir))}
            onCopyRemark={(r, embed) => copyRemark(current, r, embed)}
          />
        ) : selected.length > 1 ? (
          <div className="dr-multi">
            <strong>{selected.length} items selected</strong>
            <div className="dr-cite-box">
              {bibliography(selected, style).map((r, i) => (
                <p key={i}>
                  <Cite parts={r} />
                </p>
              ))}
            </div>
            <div className="dr-actions">
              <button className="dr-btn" onClick={() => copyReference(selected)}>
                <CopyIcon /> Copy bibliography
              </button>
              <button className="dr-btn" onClick={() => copyInText(selected)}>
                <QuoteIcon /> Copy citation
              </button>
              <button className="dr-btn" onClick={() => void exportBib(selected)}>
                <ExportIcon /> Export BibTeX
              </button>
            </div>
          </div>
        ) : (
          <div className="dr-detail-empty">{shown.length ? "Select an item to see its details" : ""}</div>
        )}
      </aside>
      </>
      )}

      {viewing && <AttachmentViewer att={viewing} onClose={() => setViewing(null)} />}

      {drag && (
        <div className="dr-ghost" style={{ left: drag.x + 12, top: drag.y + 8 }}>
          {drag.kind === "collection" || drag.kind === "folder" ? <FolderIcon /> : <DocIcon />}
          {drag.label}
        </div>
      )}

      {menu?.kind === "new" && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <div className="popover-title">New item</div>
          {ITEM_TYPES.map((t) => (
            <MenuRow
              key={t.type}
              icon={<TypeGlyph type={t.type} />}
              label={t.label}
              onClick={() => {
                setMenu(null);
                newItem(t.type);
              }}
            />
          ))}
        </Menu>
      )}
      {menu?.kind === "export" && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <MenuRow
            icon={<ExportIcon />}
            label={selected.length > 1 ? `Export ${selected.length} selected items (.bib)` : `Export ${shown.length} items in view (.bib)`}
            onClick={() => {
              setMenu(null);
              void exportBib(selected.length > 1 ? selected : shown);
            }}
          />
          <MenuRow
            icon={<CopyIcon />}
            label="Copy bibliography of items in view"
            onClick={() => {
              setMenu(null);
              copyReference(shown);
            }}
          />
        </Menu>
      )}
      {menu?.kind === "items" && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {selected.length > 1 && <div className="popover-count">{selected.length} items selected</div>}
          {inTrash ? (
            <>
              <MenuRow
                icon={<OpenIcon />}
                label="Restore to Library"
                onClick={() => {
                  setMenu(null);
                  onModify((l) => setTrashed(l, sel, false));
                }}
              />
              <MenuRow
                icon={<TrashIcon />}
                label="Delete permanently…"
                danger
                onClick={() => {
                  setMenu(null);
                  trash(sel);
                }}
              />
            </>
          ) : (
            <>
              <MenuRow icon={<CopyIcon />} label={selected.length > 1 ? "Copy bibliography" : "Copy reference"} hint="Ctrl+C" onClick={() => (setMenu(null), copyReference(selected))} />
              <MenuRow icon={<QuoteIcon />} label="Copy in-text citation" hint="Ctrl+Shift+C" onClick={() => (setMenu(null), copyInText(selected))} />
              <MenuRow icon={<LinkIcon />} label="Copy link for notes" onClick={() => (setMenu(null), copyLink(selected))} />
              <MenuRow icon={<CopyIcon />} label="Copy BibTeX" onClick={() => (setMenu(null), copyBibtex(selected))} />
              {current && <MenuRow icon={<DocIcon />} label="Open notes" onClick={() => (setMenu(null), props.onOpenNotes(current))} />}
              {lib.collections.length > 0 && (
                <>
                  <div className="popover-sep" />
                  <div className="popover-title">Add to collection</div>
                  <div className="dr-menu-scroll">
                    {flatCollections(lib).map(({ c, depth }) => (
                      <MenuRow
                        key={c.id}
                        icon={<FolderIcon />}
                        label={`${" ".repeat(depth)}${c.name}`}
                        onClick={() => {
                          setMenu(null);
                          onModify((l) => addToCollection(l, sel, c.id));
                          setNotice(`Added to “${c.name}”`);
                        }}
                      />
                    ))}
                  </div>
                </>
              )}
              <div className="popover-sep" />
              {scopeCollection && (
                <MenuRow
                  icon={<CloseIcon />}
                  label="Remove from collection"
                  onClick={() => {
                    setMenu(null);
                    onModify((l) => removeFromCollection(l, sel, scopeCollection));
                  }}
                />
              )}
              <MenuRow icon={<TrashIcon />} label="Move to Trash" hint="Del" danger onClick={() => (setMenu(null), trash(sel))} />
            </>
          )}
        </Menu>
      )}
      {menu?.kind === "collection" && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <MenuRow icon={<PlusIcon />} label="New subcollection" onClick={() => (setMenu(null), newCollection(menu.id))} />
          <MenuRow icon={<DocIcon />} label="Rename" hint="F2" onClick={() => (setMenu(null), setRenaming(menu.id))} />
          {lib.collections.find((c) => c.id === menu.id)?.parent && (
            <MenuRow icon={<FolderIcon />} label="Move to top level" onClick={() => (setMenu(null), onModify((l) => moveCollection(l, menu.id, null)))} />
          )}
          <div className="popover-sep" />
          <MenuRow
            icon={<TrashIcon />}
            label="Delete collection…"
            danger
            onClick={() => {
              setMenu(null);
              const c = lib.collections.find((x) => x.id === menu.id);
              if (c && window.confirm(`Delete the collection “${c.name}” and its subcollections? The items stay in My Library.`)) onModify((l) => removeCollection(l, menu.id));
            }}
          />
        </Menu>
      )}
      {menu?.kind === "folder" && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <MenuRow icon={<OpenIcon />} label="Open" onClick={() => (setMenu(null), goFiles({ kind: "folder", id: menu.id }))} />
          <MenuRow icon={<PlusIcon />} label="New folder inside" onClick={() => (setMenu(null), newFolder(menu.id))} />
          <MenuRow icon={<DocIcon />} label="Rename" hint="F2" onClick={() => (setMenu(null), setRenaming(menu.id))} />
          {lib.folders.find((f) => f.id === menu.id)?.parent && (
            <MenuRow icon={<FolderIcon />} label="Move to top level" onClick={() => (setMenu(null), onModify((l) => moveFolder(l, menu.id, null)))} />
          )}
          <div className="popover-sep" />
          <MenuRow icon={<TrashIcon />} label="Delete folder…" danger onClick={() => (setMenu(null), deleteFolder(menu.id))} />
        </Menu>
      )}
      {dupAsk && (
        <DuplicatePrompt
          lib={lib}
          checks={dupAsk.checks}
          total={dupAsk.total}
          onCancel={() => setDupAsk(null)}
          onSkip={() => {
            setDupAsk(null);
            dupAsk.skip();
          }}
          onAddAll={() => {
            setDupAsk(null);
            dupAsk.all();
          }}
          onShow={showPlace}
        />
      )}
      {picking?.kind === "files" && (
        <PickDialog
          title="Attach from Files"
          icon={<ClipIcon />}
          placeholder="Search Files"
          options={lib.files
            .filter((f) => !f.trashed)
            .sort((a, b) => b.added - a.added)
            .map((f) => ({ id: f.id, label: f.name, sub: fileLocation(lib, f), icon: <FileGlyph name={f.name} src={f.src} /> }))}
          done={new Set(byId.get(picking.item)?.attachments.flatMap((a) => (a.file ? [a.file] : [])) ?? [])}
          empty="No files in Files yet."
          onPick={(id) => onModify((l) => attachFile(l, picking.item, id))}
          onClose={() => setPicking(null)}
        />
      )}
      {picking?.kind === "items" && (
        <PickDialog
          title="Attach to item"
          icon={<ClipIcon />}
          placeholder="Search by title, creator, year"
          options={sortItems(
            lib.items.filter((i) => !i.trashed),
            "added",
            true,
          ).map((i) => ({ id: i.id, label: i.title || "Untitled", sub: [creatorSummary(i), yearOf(i.date)].filter(Boolean).join(" · "), icon: <DocIcon /> }))}
          done={new Set(lib.items.filter((i) => i.attachments.some((a) => a.file === picking.file)).map((i) => i.id))}
          empty="No items in My Library yet."
          onPick={(id) => {
            onModify((l) => attachFile(l, id, picking.file));
            setNotice(`Attached to “${byId.get(id)?.title || "Untitled"}”`);
          }}
          onClose={() => setPicking(null)}
        />
      )}
      {dupTool && <DuplicateFinder lib={lib} onModify={onModify} onShow={showPlace} onClose={() => setDupTool(false)} onNotice={setNotice} />}
      {menu?.kind === "tag" && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <MenuRow
            icon={<HashIcon />}
            label="Rename tag…"
            onClick={() => {
              setMenu(null);
              const to = window.prompt(`Rename the tag “${menu.tag}” to:`, menu.tag);
              if (to?.trim() && to.trim() !== menu.tag) {
                onModify((l) => (files ? renameFileTag : renameTag)(l, menu.tag, to));
                setSideSel((ts) => ts.map((t) => (t === menu.tag ? to.trim() : t)));
              }
            }}
          />
          <MenuRow
            icon={<TrashIcon />}
            label="Delete tag…"
            danger
            onClick={() => {
              setMenu(null);
              if (window.confirm(`Remove the tag “${menu.tag}” from every ${files ? "file" : "item"}?`)) {
                onModify((l) => (files ? renameFileTag : renameTag)(l, menu.tag, ""));
                setSideSel((ts) => ts.filter((t) => t !== menu.tag));
              }
            }}
          />
        </Menu>
      )}
    </div>
  );
}

function flatCollections(lib: Library): { c: Library["collections"][number]; depth: number }[] {
  const out: { c: Library["collections"][number]; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const c of childCollections(lib, parent)) {
      out.push({ c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

const TYPE_GLYPH: Record<ItemType, string> = {
  article: "M4 2.5h6l2.5 2.5v8.5H4zM6 7h4.5M6 9.5h4.5M6 12h2.5",
  book: "M3.5 3a1 1 0 0 1 1-1H12v10H4.5a1 1 0 0 0-1 1zM3.5 13a1 1 0 0 0 1 1H12M6 5h3.5",
  chapter: "M3.5 3a1 1 0 0 1 1-1H12v10H4.5a1 1 0 0 0-1 1zM3.5 13a1 1 0 0 0 1 1H12M9.5 2v4l1-1 1 1",
  conference: "M2.5 3.5h11v7h-11zM8 10.5V13M5.5 13.5h5M5 6h6M5 8h4",
  thesis: "M8 3 1.5 6 8 9l6.5-3zM4 7.25V11c0 1 1.8 2 4 2s4-1 4-2V7.25",
  report: "M4 2.5h8v11H4zM6 10.5V9M8 10.5V6.5M10 10.5V8",
  webpage: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM2 8h12M8 2c1.7 1.6 2.5 3.6 2.5 6S9.7 12.4 8 14M8 2C6.3 3.6 5.5 5.6 5.5 8s.8 4.4 2.5 6",
  other: "M4 2.5h5.5L12 5v8.5H4zM9.5 2.5V5H12",
};

function TypeGlyph({ type }: { type: ItemType }) {
  return (
    <svg className="dr-type" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <title>{typeLabel(type)}</title>
      <path d={TYPE_GLYPH[type]} />
    </svg>
  );
}

/* ─── 用識別碼新增 ─── */

function IdentifierBox(props: { onFound: (items: Item[]) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const run = async () => {
    const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    setBusy(true);
    const found: Item[] = [];
    const errs: string[] = [];
    const left: string[] = [];
    for (const line of lines) {
      const id = parseIdentifier(line);
      if (!id) {
        errs.push(`“${line}” isn't a DOI, ISBN, arXiv ID or URL.`);
        left.push(line);
        continue;
      }
      try {
        found.push(await lookup(id));
      } catch (err) {
        errs.push(err instanceof Error ? err.message : String(err));
        left.push(line);
      }
    }
    setBusy(false);
    setErrors(errs);
    setText(left.join("\n"));
    if (found.length) props.onFound(found);
    if (!errs.length) props.onClose();
  };
  return (
    <div className="dr-identify">
      <textarea
        autoFocus
        rows={Math.min(5, Math.max(1, text.split("\n").length))}
        value={text}
        data-no-predict
        placeholder="Paste a DOI, ISBN, arXiv ID or URL — one per line"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void run();
          }
          if (e.key === "Escape") props.onClose();
        }}
        disabled={busy}
        spellCheck={false}
      />
      <button className="dr-btn primary" onClick={() => void run()} disabled={busy || !text.trim()}>
        {busy ? "Looking up…" : "Add"}
      </button>
      <button className="icon-btn" onClick={props.onClose} title="Close (Esc)">
        <CloseIcon />
      </button>
      {errors.length > 0 && (
        <ul className="dr-errors">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─── 右欄：條目的資料 ─── */

function Field(props: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; link?: string }) {
  return (
    <label className="dr-field">
      <span className="dr-field-label">
        {props.link ? (
          <a
            href={props.link}
            onClick={(e) => {
              e.preventDefault();
              void openLink(props.link!);
            }}
            title={`Open ${props.link}`}
          >
            {props.label}
          </a>
        ) : (
          props.label
        )}
      </span>
      <input
        className={props.mono ? "mono" : undefined}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
        spellCheck={false}
      />
    </label>
  );
}

/** 引用鍵：改完（Enter 或離開）才寫入，重複或空的就還原。 */
function KeyField(props: { value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(props.value);
  useEffect(() => setV(props.value), [props.value]);
  return (
    <label className="dr-field">
      <span className="dr-field-label">Citation Key</span>
      <input
        className="mono"
        data-no-assist
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => (v.trim() && v !== props.value ? props.onCommit(v) : setV(props.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setV(props.value);
        }}
        spellCheck={false}
        title="Used for the notes page (@key) and BibTeX"
      />
    </label>
  );
}

function CreatorsEditor(props: { creators: Creator[]; onChange: (cs: Creator[]) => void }) {
  const cs = props.creators;
  const set = (i: number, p: Partial<Creator>) => props.onChange(cs.map((c, j) => (j === i ? { ...c, ...p } : c)));
  return (
    <div className="dr-creators">
      {cs.map((c, i) => (
        <div className="dr-creator" key={i}>
          <select value={c.role} onChange={(e) => set(i, { role: e.target.value as Creator["role"] })} title="Role">
            <option value="author">Author</option>
            <option value="editor">Editor</option>
          </select>
          <input
            value={c.family}
            placeholder="Last"
            onChange={(e) => set(i, { family: e.target.value })}
            onPaste={(e) => {
              // 貼上「Smith, John; Lee, Ann」整串時拆成好幾位
              const t = e.clipboardData.getData("text/plain");
              if (!/[;,]|\sand\s/.test(t) || c.family || c.given) return;
              e.preventDefault();
              const names = t
                .split(/\s*;\s*|\s+and\s+/i)
                .map((s) => s.trim())
                .filter(Boolean)
                .map((s): Creator => {
                  const k = s.indexOf(",");
                  if (k >= 0) return { family: s.slice(0, k).trim(), given: s.slice(k + 1).trim(), role: c.role };
                  const sp = s.lastIndexOf(" ");
                  return sp < 0 ? { family: s, given: "", role: c.role } : { family: s.slice(sp + 1), given: s.slice(0, sp), role: c.role };
                });
              props.onChange([...cs.slice(0, i), ...names, ...cs.slice(i + 1)]);
            }}
          />
          <input value={c.given} placeholder="First" onChange={(e) => set(i, { given: e.target.value })} />
          <button className="icon-btn" title="Remove" onClick={() => props.onChange(cs.filter((_, j) => j !== i))}>
            <CloseIcon />
          </button>
        </div>
      ))}
      <button className="dr-link" onClick={() => props.onChange([...cs, { family: "", given: "", role: "author" }])}>
        <PlusIcon /> Add creator
      </button>
    </div>
  );
}

type PaneTab = "info" | "remarks" | "attachments" | "cite";

/** 備註的文字框：跟著內容長高。 */
function RemarkText(props: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [props.value]);
  return (
    <textarea
      ref={ref}
      className="dr-remark-text"
      rows={2}
      value={props.value}
      placeholder="Write a remark — a quote, a finding, a thought…"
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}

function ItemPane(props: {
  item: Item;
  lib: Library;
  style: Style;
  onStyle: (s: Style) => void;
  titleRef: React.RefObject<HTMLTextAreaElement | null>;
  sources: Source[];
  now: string;
  onPatch: (p: Partial<Item>) => void;
  onAttach: (files: File[]) => void;
  onAddLink: (url: string) => void;
  onRemoveAttachment: (id: string) => void;
  /** 從檔案庫選檔案附加 */
  onFromFiles: () => void;
  /** 在檔案庫打開附件存的那一筆 */
  onShowFile: (fileId: string) => void;
  onView: (a: Attachment) => void;
  onOpenNotes: () => void;
  onOpenSource: (s: Source) => void;
  onCopy: (what: "ref" | "intext" | "bib" | "link") => void;
  onRemoveFromCollection: (id: string) => void;
  focus: DrawerFocus | null;
  onAddRemark: () => void;
  onEditRemark: (id: string, p: Partial<Pick<Remark, "text" | "page">>) => void;
  onRemoveRemark: (id: string) => void;
  onMoveRemark: (id: string, dir: -1 | 1) => void;
  onCopyRemark: (r: Remark, embed: boolean) => void;
}) {
  const it = props.item;
  const [tab, setTab] = useState<PaneTab>(props.focus ? "remarks" : "info");
  /** 標出來的備註（從引用點過來的，或剛新增的） */
  const [lit, setLit] = useState<string | null>(props.focus?.remark ?? null);
  const remarksRef = useRef<HTMLDivElement>(null);
  /** 按了 Add remark：等新的備註出現後把游標放進去 */
  const adding = useRef(false);
  const focusStamp = props.focus?.stamp;
  useEffect(() => {
    if (!props.focus) return;
    setTab("remarks");
    setLit(props.focus.remark);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusStamp]);
  useLayoutEffect(() => {
    if (tab !== "remarks") return;
    const box = remarksRef.current;
    if (adding.current) {
      adding.current = false;
      const last = it.remarks[it.remarks.length - 1];
      if (last) setLit(last.id);
      const boxes = box?.querySelectorAll<HTMLTextAreaElement>(".dr-remark textarea");
      boxes?.[boxes.length - 1]?.focus();
      return;
    }
    if (lit) box?.querySelector(`[data-remark="${lit}"]`)?.scrollIntoView({ block: "nearest" });
  }, [tab, lit, it.remarks]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [linking, setLinking] = useState(false);
  const [linkText, setLinkText] = useState("");
  const tf = TYPE_FIELDS[it.type];
  const tagNames = useMemo(() => allTags(props.lib).map((t) => t.tag), [props.lib]);
  /** 每個備註被幾份文件引用（`[[@引用鍵#r1]]`） */
  const remarkCites = useMemo(() => {
    const m = new Map<string, ReturnType<typeof findBacklinks>>();
    if (it.key) for (const r of it.remarks) m.set(r.id, findBacklinks(remarkRef(it, r), props.sources));
    return m;
  }, [it, props.sources]);
  // 引用條目或它的備註都算
  const citedIn = useMemo(() => {
    if (!it.key) return [];
    // 同一個區塊同時引用條目與備註只算一次
    const out = new Map<string, { source: Source; starts: Set<number> }>();
    for (const list of [findBacklinks(notePage(it), props.sources), ...remarkCites.values()]) {
      for (const m of list) {
        const k = `${m.source.kind}:${m.source.key}`;
        const had = out.get(k) ?? { source: m.source, starts: new Set<number>() };
        for (const b of m.blocks) had.starts.add(b.start);
        out.set(k, had);
      }
    }
    return [...out.values()].map((v) => ({ source: v.source, blocks: v.starts.size }));
  }, [it, props.sources, remarkCites]);
  const notesExist = props.sources.some((s) => s.kind === "page" && s.key.toLowerCase() === notePage(it).toLowerCase());
  const colls = it.collections.map((id) => props.lib.collections.find((c) => c.id === id)).filter((c): c is Library["collections"][number] => !!c);

  // 標題框跟著內容長高
  useLayoutEffect(() => {
    const el = props.titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [it.title, props.titleRef, tab]);

  return (
    <div className="dr-pane">
      <div className="dr-pane-head">
        <select className="dr-type-select" value={it.type} onChange={(e) => props.onPatch({ type: e.target.value as ItemType })}>
          {ITEM_TYPES.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </select>
        <textarea
          ref={props.titleRef}
          className="dr-title"
          rows={1}
          value={it.title}
          placeholder="Title"
          onChange={(e) => props.onPatch({ title: e.target.value.replace(/\n/g, " ") })}
          onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
        />
        <div className="dr-tabs">
          {(
            [
              ["info", "Info", 0],
              ["remarks", "Remarks", it.remarks.length],
              ["attachments", "Attachments", it.attachments.length],
              ["cite", "Cite", 0],
            ] as [PaneTab, string, number][]
          ).map(([k, label, n]) => (
            <button key={k} className={tab === k ? "on" : undefined} onClick={() => setTab(k)}>
              {label}
              {n > 0 && <span className="dr-tab-n">{n}</span>}
            </button>
          ))}
          <button className="dr-notes-btn" onClick={props.onOpenNotes} title={`Open the page ${notePage(it)}`}>
            <DocIcon /> {notesExist ? "Notes" : "New note"}
          </button>
        </div>
      </div>

      <div className="dr-pane-body">
        {tab === "info" && (
          <>
            <div className="dr-section">
              <div className="dr-section-title">Creators</div>
              <CreatorsEditor creators={it.creators} onChange={(creators) => props.onPatch({ creators })} />
            </div>
            <div className="dr-section dr-fields">
              {tf.fields.map((f) => (
                <Field
                  key={f}
                  label={fieldLabel(it.type, f)}
                  value={it[f]}
                  mono={f === "doi" || f === "isbn" || f === "url"}
                  placeholder={f === "date" || f === "accessed" ? "YYYY-MM-DD" : undefined}
                  link={f === "doi" && it.doi ? `https://doi.org/${it.doi}` : f === "url" && /^https?:\/\//.test(it.url) ? it.url : undefined}
                  onChange={(v) => props.onPatch({ [f]: v })}
                />
              ))}
              <KeyField value={it.key} onCommit={(key) => props.onPatch({ key })} />
            </div>
            <div className="dr-section">
              <div className="dr-section-title">Abstract</div>
              <textarea
                className="dr-abstract"
                value={it.abstract}
                rows={it.abstract ? 6 : 2}
                placeholder="Add an abstract…"
                onChange={(e) => props.onPatch({ abstract: e.target.value })}
              />
            </div>
            <div className="dr-section">
              <div className="dr-section-title">Tags</div>
              <TagsEditor tags={it.tags} all={tagNames} onChange={(tags) => props.onPatch({ tags })} />
            </div>
            {colls.length > 0 && (
              <div className="dr-section">
                <div className="dr-section-title">In collections</div>
                <div className="dr-tag-edit">
                  {colls.map((c) => (
                    <span className="dr-tag coll" key={c.id}>
                      <FolderIcon /> {c.name}
                      <button title="Remove from this collection" onClick={() => props.onRemoveFromCollection(c.id)}>
                        <CloseIcon />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="dr-section">
              <div className="dr-section-title">Cited in</div>
              {citedIn.length ? (
                <div className="dr-cited">
                  {citedIn.map((m) => (
                    <button key={`${m.source.kind}:${m.source.key}`} className="dr-cited-row" onClick={() => props.onOpenSource(m.source)}>
                      <DocIcon />
                      <span>{m.source.kind === "day" ? dayTitle(m.source.key, props.now) : m.source.key}</span>
                      <span className="dr-count">{m.blocks}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="dr-hint">
                  Write <code>[[{notePage(it)}]]</code> in a journal or page to cite this item.
                </p>
              )}
            </div>
            <p className="dr-dates">
              Added {new Date(it.added).toLocaleDateString()} · Modified {new Date(it.modified).toLocaleDateString()}
            </p>
          </>
        )}

        {tab === "remarks" && (
          <div className="dr-section dr-remarks" ref={remarksRef}>
            {it.remarks.map((r, i) => {
              const cites = remarkCites.get(r.id) ?? [];
              return (
                <div key={r.id} data-remark={r.id} className={`dr-remark${lit === r.id ? " lit" : ""}`} onFocus={() => setLit(r.id)}>
                  <RemarkText value={r.text} onChange={(text) => props.onEditRemark(r.id, { text })} />
                  <div className="dr-remark-foot">
                    <label className="dr-remark-page" title="Page or location, added to the in-text citation">
                      Page
                      <input value={r.page} placeholder="—" onChange={(e) => props.onEditRemark(r.id, { page: e.target.value })} />
                    </label>
                    <code className="dr-remark-ref" title="Cite this remark anywhere with this link">
                      [[{remarkRef(it, r)}]]
                    </code>
                    <span className="dr-remark-tools">
                      <button className="icon-btn" title="Copy link to cite this remark" onClick={() => props.onCopyRemark(r, false)}>
                        <LinkIcon />
                      </button>
                      <button className="icon-btn" title="Copy embed (shows the remark's text)" onClick={() => props.onCopyRemark(r, true)}>
                        <QuoteIcon />
                      </button>
                      <button className="icon-btn" title="Move up" disabled={i === 0} onClick={() => props.onMoveRemark(r.id, -1)}>
                        <ArrowUpIcon />
                      </button>
                      <button className="icon-btn" title="Move down" disabled={i === it.remarks.length - 1} onClick={() => props.onMoveRemark(r.id, 1)}>
                        <ArrowDownIcon />
                      </button>
                      <button
                        className="icon-btn"
                        title={cites.length ? "Delete remark (citations to it will cite the item)" : "Delete remark"}
                        onClick={() => props.onRemoveRemark(r.id)}
                      >
                        <TrashIcon />
                      </button>
                    </span>
                  </div>
                  {cites.length > 0 && (
                    <div className="dr-cited">
                      {cites.map((m) => (
                        <button key={`${m.source.kind}:${m.source.key}`} className="dr-cited-row" onClick={() => props.onOpenSource(m.source)}>
                          <DocIcon />
                          <span>{m.source.kind === "day" ? dayTitle(m.source.key, props.now) : m.source.key}</span>
                          <span className="dr-count">{m.blocks.length}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {!it.remarks.length && (
              <p className="dr-hint">
                Remarks are short notes on this item — quotes, findings, thoughts — each with an optional page. Cite one anywhere with{" "}
                <code>[[{notePage(it)}#r1]]</code>, or put <code>![[{notePage(it)}#r1]]</code> on its own line to show it.
              </p>
            )}
            <div className="dr-actions">
              <button
                className="dr-btn"
                disabled={!it.key}
                onClick={() => {
                  adding.current = true;
                  props.onAddRemark();
                }}
              >
                <PlusIcon /> Add remark
              </button>
            </div>
          </div>
        )}

        {tab === "attachments" && (
          <div className="dr-section">
            {it.attachments.map((a) => (
              <div key={a.id} className="dr-att">
                {a.kind === "link" ? <LinkIcon /> : <ClipIcon />}
                <button className="dr-att-name" onClick={() => (a.kind === "link" ? void openLink(a.src) : props.onView(a))} title={a.kind === "link" ? a.src : "Open"}>
                  {a.name}
                </button>
                {a.kind === "file" && mediaFilePath(a.src) && (
                  <button className="icon-btn" title="Show in folder" onClick={() => void reveal(a.src)}>
                    <FolderIcon />
                  </button>
                )}
                {a.file && props.lib.files.some((f) => f.id === a.file) && (
                  <button className="icon-btn" title="Show in Files" onClick={() => props.onShowFile(a.file!)}>
                    <DrawerIcon />
                  </button>
                )}
                <button className="icon-btn" title="Remove attachment (the file stays in Files)" onClick={() => props.onRemoveAttachment(a.id)}>
                  <TrashIcon />
                </button>
              </div>
            ))}
            {!it.attachments.length && <p className="dr-hint">Attach the PDF or other files for this item, or drop files onto its row. Attached files are kept in Files too.</p>}
            <div className="dr-actions">
              <button className="dr-btn" onClick={() => fileRef.current?.click()}>
                <ClipIcon /> Attach file…
              </button>
              <button className="dr-btn" onClick={props.onFromFiles} title="Attach a file that's already in Files">
                <FolderIcon /> From Files…
              </button>
              <button className="dr-btn" onClick={() => setLinking(true)}>
                <LinkIcon /> Attach link…
              </button>
            </div>
            {linking && (
              <form
                className="dr-link-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const u = linkText.trim();
                  if (u) props.onAddLink(/^\w+:\/\//.test(u) ? u : `https://${u}`);
                  setLinkText("");
                  setLinking(false);
                }}
              >
                <input autoFocus data-no-predict value={linkText} placeholder="https://…" onChange={(e) => setLinkText(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setLinking(false)} />
                <button className="dr-btn primary" type="submit">
                  Add
                </button>
              </form>
            )}
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                props.onAttach([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
          </div>
        )}

        {tab === "cite" && (
          <div className="dr-section">
            <div className="dr-style">
              {STYLES.map((s) => (
                <button key={s.style} className={props.style === s.style ? "on" : undefined} onClick={() => props.onStyle(s.style)}>
                  {s.label}
                </button>
              ))}
            </div>
            <div className="dr-section-title">Reference</div>
            <div className="dr-cite-box">
              <Cite parts={reference(it, props.style)} />
            </div>
            <div className="dr-section-title">In-text</div>
            <div className="dr-cite-box">{inText(it, props.style)}</div>
            <div className="dr-actions">
              <button className="dr-btn" onClick={() => props.onCopy("ref")}>
                <CopyIcon /> Copy reference
              </button>
              <button className="dr-btn" onClick={() => props.onCopy("intext")}>
                <QuoteIcon /> Copy citation
              </button>
              <button className="dr-btn" onClick={() => props.onCopy("link")}>
                <LinkIcon /> Copy [[{notePage(it)}]]
              </button>
              <button className="dr-btn" onClick={() => props.onCopy("bib")}>
                <CopyIcon /> Copy BibTeX
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
