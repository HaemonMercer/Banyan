import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChevronRightIcon,
  ClipIcon,
  CloseIcon,
  CopyIcon,
  CutIcon,
  DocIcon,
  FolderIcon,
  GalleryIcon,
  ImageIcon,
  ListIcon,
  OpenIcon,
  PasteIcon,
  PlusIcon,
  SearchIcon,
  SheetIcon,
  SlidesIcon,
  TrashIcon,
  VideoIcon,
} from "../editor/icons";
import { mediaFilePath, mediaUrl } from "../editor/media";
import { dateKey, dayTitle } from "../journal/journal";
import {
  addToFolder,
  attachedTo,
  childFolders,
  deleteFiles,
  emptyFileTrash,
  fileKind,
  fileLocation,
  fileTags,
  filterFiles,
  folderPath,
  formatSize,
  locate,
  moveFiles,
  placeKey,
  placeLabel,
  placeName,
  removeFromFolder,
  renameEntry,
  setFilesTrashed,
  setFileTags,
  sortFiles,
  typeName,
  type FileEntry,
  type FileScope,
  type FileSortKey,
  type Folder,
  type Place,
} from "./files";
import type { Library } from "./model";
import { Menu, MenuRow, RenameInput, reveal, TagsEditor } from "./ui";

/**
 * Drawer 的檔案庫頁中間與右欄：資料邏輯和文獻庫一樣——左欄（DrawerView）選範圍
 * （All Files、Unfiled Files、Trash、某個資料夾含子資料夾）與標籤，這裡列出範圍裡的檔案
 * （大圖示或詳細資料，標題列可以排序），右欄是選取的檔案（資料夾、標籤）。
 * 拖曳（放進資料夾）用 DrawerView 的 `startDrag`（指標事件）。
 */

export type EntryDrag = { kind: "entries"; ids: string[]; label: string };

type ViewMode = "icons" | "details";
const VIEW_KEY = "banyan.drawerFilesView";
const SORT_KEY = "banyan.drawerFilesSort";
function loadView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === "details" ? "details" : "icons";
  } catch {
    return "icons";
  }
}
function loadSort(): { key: FileSortKey; desc: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(SORT_KEY) ?? "null");
    if (v && ["name", "added", "type", "size"].includes(v.key)) return { key: v.key, desc: !!v.desc };
  } catch {
    /* 用預設 */
  }
  return { key: "name", desc: false };
}
const save = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* 記不住也沒關係 */
  }
};

const dateLabel = (ms: number, now: string) => (ms ? dayTitle(dateKey(new Date(ms)), now) : "");

export function FileGlyph(props: { name: string; src?: string; large?: boolean }) {
  const k = fileKind(props.name, props.src);
  const Icon = k === "image" ? ImageIcon : k === "video" ? VideoIcon : k === "sheet" ? SheetIcon : k === "slides" ? SlidesIcon : DocIcon;
  return (
    <span className={`dr-file-glyph k-${k}${props.large ? " large" : ""}`}>
      <Icon />
      {props.large && k !== "image" && k !== "video" && <span className="dr-file-ext">{props.name.split(".").pop()?.slice(0, 4).toUpperCase()}</span>}
    </span>
  );
}

/** 資料夾樹攤平（選單「Add to folder」用） */
export function flatFolders(lib: Library, parent: string | null = null, depth = 0): { f: Folder; depth: number }[] {
  return childFolders(lib, parent).flatMap((f) => [{ f, depth }, ...flatFolders(lib, f.id, depth + 1)]);
}

const SCOPE_LABEL = { all: "All Files", unfiled: "Unfiled Files", trash: "Trash" } as const;

export function FilesPane(props: {
  lib: Library;
  /** 左欄選的範圍 */
  scope: FileScope;
  onScope: (s: FileScope) => void;
  /** 左欄選的標籤（每個都要有） */
  tags: string[];
  sel: string[];
  onSel: (ids: string[]) => void;
  onModify: (fn: (lib: Library) => Library) => void;
  /** 加入檔案（DrawerView 先檢查重複；null 是 Unfiled） */
  onAdd: (folder: string | null, files: File[]) => void;
  /** 新資料夾（在左欄的樹裡改名） */
  onNewFolder: (parent: string | null) => void;
  onView: (f: FileEntry) => void;
  onFindDuplicates: () => void;
  onShowPlace: (p: Place) => void;
  onCreateItem: (f: FileEntry) => void;
  /** 把檔案附加到選的條目 */
  onAttachTo: (fileId: string) => void;
  startDrag: (e: React.PointerEvent, d: EntryDrag) => void;
  dropTarget: string | null;
  onNotice: (s: string) => void;
  now: string;
}) {
  const { lib, scope, sel, onSel, onModify } = props;
  const [view, setView] = useState<ViewMode>(loadView);
  const [sort, setSort] = useState(loadSort);
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; on: "entries" | "blank" } | null>(null);
  /** 剪下的檔案與剪下時所在的資料夾（貼上＝從那裡搬到這裡） */
  const [clip, setClip] = useState<{ ids: string[]; from: string | null } | null>(null);
  const anchor = useRef<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLInputElement>(null);

  useEffect(() => save(VIEW_KEY, view), [view]);
  useEffect(() => save(SORT_KEY, JSON.stringify(sort)), [sort]);
  const scopeId = scope.kind === "folder" ? scope.id : scope.kind;
  useEffect(() => setQuery(""), [scopeId]);

  const inTrash = scope.kind === "trash";
  const folder = scope.kind === "folder" ? scope.id : null;
  const searching = query.trim().length > 0;
  const shown = useMemo(() => sortFiles(filterFiles(lib, scope, query, props.tags), sort.key, sort.desc), [lib, scope, query, props.tags, sort]);
  const order = useMemo(() => shown.map((f) => f.id), [shown]);
  const fileById = useMemo(() => new Map(lib.files.map((f) => [f.id, f])), [lib.files]);
  const tagNames = useMemo(() => fileTags(lib).map((t) => t.tag), [lib]);
  const path = folderPath(lib, folder);
  const trashCount = lib.files.filter((f) => f.trashed).length;

  // 選取的東西不在畫面上了就拿掉
  useEffect(() => {
    const vis = new Set(order);
    if (!sel.every((id) => vis.has(id))) onSel(sel.filter((id) => vis.has(id)));
  }, [order, sel, onSel]);

  const selFiles = sel.map((id) => fileById.get(id)).filter((f): f is FileEntry => !!f);
  const one = sel.length === 1 ? (fileById.get(sel[0]) ?? null) : null;

  const pick = (e: React.PointerEvent | React.MouseEvent, id: string) => {
    if (e.shiftKey && anchor.current) {
      const a = order.indexOf(anchor.current);
      const b = order.indexOf(id);
      if (a >= 0 && b >= 0) {
        const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
        onSel(e.ctrlKey || e.metaKey ? [...new Set([...sel, ...range])] : range);
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      onSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
      anchor.current = id;
      return;
    }
    if (!sel.includes(id)) onSel([id]);
    anchor.current = id;
  };

  const open = (id: string) => {
    const f = fileById.get(id);
    if (f) props.onView(f);
  };

  const selectNext = (ids: string[]) => {
    const idx = order.indexOf(ids[ids.length - 1]);
    const next = order.slice(idx + 1).find((x) => !ids.includes(x)) ?? [...order.slice(0, idx)].reverse().find((x) => !ids.includes(x));
    onSel(next ? [next] : []);
  };

  /** 刪除：先移到垃圾桶；在垃圾桶裡是永久刪除（和文獻庫一樣） */
  const trash = (ids: string[]) => {
    if (!ids.length) return;
    if (inTrash) {
      const what = ids.length === 1 ? `“${fileById.get(ids[0])?.name ?? "this file"}”` : `${ids.length} files`;
      const att = ids.reduce((n, id) => n + attachedTo(lib, id).length, 0);
      const also = att ? ` ${att === 1 ? "It's attached to an item — that attachment" : `They're attached to items — those ${att} attachments`} will be removed too.` : "";
      if (!window.confirm(`Delete ${what} permanently?${also} This can't be undone.`)) return;
      onModify((l) => deleteFiles(l, ids));
    } else {
      onModify((l) => setFilesTrashed(l, ids, true));
      props.onNotice(ids.length === 1 ? "Moved 1 file to the Trash" : `Moved ${ids.length} files to the Trash`);
    }
    selectNext(ids);
  };

  const restore = (ids: string[]) => {
    if (!ids.length) return;
    onModify((l) => setFilesTrashed(l, ids, false));
    props.onNotice(ids.length === 1 ? "Restored 1 file" : `Restored ${ids.length} files`);
    selectNext(ids);
  };

  const emptyTrash = () => {
    const att = lib.files.filter((f) => f.trashed).reduce((n, f) => n + attachedTo(lib, f.id).length, 0);
    const also = att ? ` Item attachments that use them (${att}) will be removed too.` : "";
    if (trashCount && window.confirm(`Delete all ${trashCount === 1 ? "1 file" : `${trashCount} files`} in the Trash permanently?${also} This can't be undone.`)) onModify(emptyFileTrash);
  };

  const cut = (ids: string[]) => {
    if (!ids.length || inTrash) return;
    setClip({ ids, from: folder });
    props.onNotice(`Cut ${ids.length === 1 ? "1 file" : `${ids.length} files`} — open a folder and press Ctrl+V to move`);
  };

  const paste = () => {
    if (!clip || !folder) return;
    const ids = clip.ids.filter((id) => fileById.has(id));
    if (!ids.length) return;
    onModify((l) => moveFiles(l, ids, clip.from, folder));
    setClip(null);
    onSel(ids);
    props.onNotice(`Moved ${ids.length === 1 ? "1 file" : `${ids.length} files`} to ${path.map((f) => f.name).join(" › ")}`);
  };

  const addTo = (f: Folder) => {
    onModify((l) => addToFolder(l, sel, f.id));
    props.onNotice(`Added to “${f.name}”`);
  };

  const sortBy = (k: FileSortKey) => setSort((s) => (s.key === k ? { key: k, desc: !s.desc } : { key: k, desc: k === "added" || k === "size" }));

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input, textarea, select")) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const idx = order.indexOf(anchor.current ?? sel[0] ?? "");
    const step = (d: number) => {
      const next = order[Math.max(0, Math.min(order.length - 1, idx < 0 ? 0 : idx + d))];
      if (!next) return;
      anchor.current = next;
      onSel(e.shiftKey ? [...new Set([...sel, next])] : [next]);
      bodyRef.current?.querySelector(`[data-entry="${next}"]`)?.scrollIntoView({ block: "nearest" });
    };
    // 大圖示一列有幾個（左右是一格、上下是一列）
    const perRow = () => {
      const tiles = bodyRef.current?.querySelectorAll<HTMLElement>(".dr-tile");
      if (!tiles?.length) return 1;
      const top = tiles[0].offsetTop;
      let n = 0;
      for (const t of tiles) if (t.offsetTop === top) n++;
      return Math.max(1, n);
    };
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const d = view === "icons" ? perRow() : 1;
      step(e.key === "ArrowDown" ? d : -d);
    } else if (view === "icons" && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      e.preventDefault();
      step(e.key === "ArrowRight" ? 1 : -1);
    } else if (e.key === "Enter" && sel.length === 1) {
      e.preventDefault();
      open(sel[0]);
    } else if (e.key === "Delete" || (e.key === "Backspace" && ctrl)) {
      e.preventDefault();
      trash(sel);
    } else if (e.key === "F2" && sel.length === 1 && !inTrash) {
      e.preventDefault();
      setRenaming(sel[0]);
    } else if (ctrl && e.code === "KeyA") {
      e.preventDefault();
      onSel(order);
    } else if (ctrl && e.code === "KeyX" && sel.length) {
      e.preventDefault();
      cut(sel);
    } else if (ctrl && e.code === "KeyV" && clip) {
      e.preventDefault();
      paste();
    } else if (ctrl && e.shiftKey && e.code === "KeyN" && !inTrash) {
      e.preventDefault();
      props.onNewFolder(folder);
    }
  };

  const entryProps = (id: string, label: string) => ({
    "data-entry": id,
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest("input")) return;
      bodyRef.current?.focus({ preventScroll: true });
      pick(e, id);
      if (e.shiftKey || e.ctrlKey || e.metaKey) return;
      const ids = sel.includes(id) ? [id, ...sel.filter((x) => x !== id)] : [id];
      props.startDrag(e, { kind: "entries", ids, label: ids.length === 1 ? label : `${ids.length} files` });
    },
    onDoubleClick: (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("input")) return;
      open(id);
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!sel.includes(id)) onSel([id]);
      setMenu({ x: e.clientX, y: e.clientY, on: "entries" });
    },
  });

  const nameOrRename = (id: string, name: string) =>
    renaming === id ? (
      <RenameInput
        value={name}
        onDone={(v) => {
          setRenaming(null);
          if (v !== null && v.trim() && v !== name) onModify((l) => renameEntry(l, id, v));
          bodyRef.current?.focus({ preventScroll: true });
        }}
      />
    ) : (
      <span className="dr-entry-name" title={name}>
        {name}
      </span>
    );

  const isCut = (id: string) => !!clip?.ids.includes(id);
  const empty = !shown.length;
  const head = (k: FileSortKey, label: string, cls = "") => (
    <button className={`${cls}${sort.key === k ? " sorted" : ""}`} onClick={() => sortBy(k)}>
      {label}
      {sort.key === k && <span className="dr-sort">{sort.desc ? "▾" : "▴"}</span>}
    </button>
  );

  return (
    <>
      <section className="dr-main dr-files">
        <div className="dr-toolbar">
          <div className="dr-crumbs">
            {scope.kind === "folder" ? (
              path.map((f, i) => (
                <span key={f.id} className="dr-crumb-wrap">
                  {i > 0 && <ChevronRightIcon />}
                  <button
                    className={`dr-crumb${props.dropTarget === `f:${f.id}` ? " drop" : ""}`}
                    data-drop={`f:${f.id}`}
                    onClick={() => props.onScope({ kind: "folder", id: f.id })}
                  >
                    {i === 0 && <FolderIcon />} {f.name}
                  </button>
                </span>
              ))
            ) : (
              <span className="dr-crumb here">
                {inTrash ? <TrashIcon /> : <FolderIcon />} {SCOPE_LABEL[scope.kind]}
              </span>
            )}
          </div>
          <label className="dr-search dr-files-search">
            <SearchIcon />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
              placeholder={`Search ${scope.kind === "folder" ? (path[path.length - 1]?.name ?? "folder") : SCOPE_LABEL[scope.kind]}`}
              spellCheck={false}
            />
          </label>
        </div>
        <div className="dr-toolbar dr-files-actions">
          {inTrash ? (
            trashCount > 0 && (
              <button className="dr-btn danger" onClick={emptyTrash}>
                <TrashIcon /> Empty Trash
              </button>
            )
          ) : (
            <>
              <button className="dr-btn primary" onClick={() => addRef.current?.click()}>
                <PlusIcon /> Add files
              </button>
              <button className="dr-btn" onClick={() => props.onNewFolder(folder)} title={folder ? "New folder inside this one (Ctrl+Shift+N)" : "New folder (Ctrl+Shift+N)"}>
                <FolderIcon /> New folder
              </button>
              <button className="dr-btn" onClick={props.onFindDuplicates} title="Find files with the same content">
                <CopyIcon /> Find duplicates
              </button>
            </>
          )}
          <div className="dr-seg" role="group" aria-label="View">
            <button className={view === "icons" ? "on" : ""} title="Large icons" onClick={() => setView("icons")}>
              <GalleryIcon />
            </button>
            <button className={view === "details" ? "on" : ""} title="Details" onClick={() => setView("details")}>
              <ListIcon />
            </button>
          </div>
          <input
            ref={addRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) props.onAdd(folder, [...e.target.files]);
              e.target.value = "";
            }}
          />
        </div>

        <div
          className={`dr-files-body ${view}${folder && props.dropTarget === `f:${folder}` ? " drop" : ""}`}
          ref={bodyRef}
          tabIndex={0}
          data-drop={folder ? `f:${folder}` : inTrash ? "f-trash" : undefined}
          onKeyDown={onKey}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("dr-tiles")) onSel([]);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            onSel([]);
            setMenu({ x: e.clientX, y: e.clientY, on: "blank" });
          }}
        >
          {view === "details" && !empty && (
            <div className="dr-frow dr-head">
              {head("name", "Name")}
              {searching || scope.kind === "all" ? <span>Folder</span> : head("added", "Date added")}
              {head("type", "Type")}
              {head("size", "Size", "dr-fsize")}
            </div>
          )}
          {view === "icons" ? (
            <div className="dr-tiles">
              {shown.map((f) => (
                <div key={f.id} className={`dr-tile${sel.includes(f.id) ? " on" : ""}${isCut(f.id) ? " cut" : ""}`} {...entryProps(f.id, f.name)}>
                  <span className="dr-tile-art">
                    {fileKind(f.name, f.src) === "image" ? <img src={mediaUrl(f.src)} alt="" loading="lazy" draggable={false} /> : <FileGlyph name={f.name} src={f.src} large />}
                  </span>
                  {nameOrRename(f.id, f.name)}
                </div>
              ))}
            </div>
          ) : (
            shown.map((f) => (
              <div key={f.id} className={`dr-frow${sel.includes(f.id) ? " on" : ""}${isCut(f.id) ? " cut" : ""}`} {...entryProps(f.id, f.name)}>
                <span className="dr-fname">
                  <FileGlyph name={f.name} src={f.src} />
                  {nameOrRename(f.id, f.name)}
                </span>
                <span>{searching || scope.kind === "all" ? fileLocation(lib, f) : dateLabel(f.added, props.now)}</span>
                <span>{typeName(f.name, f.src)}</span>
                <span className="dr-fsize">{formatSize(f.size)}</span>
              </div>
            ))
          )}
          {empty && (
            <div className="dr-empty">
              {searching || props.tags.length ? (
                <>No files match</>
              ) : inTrash ? (
                <>The Trash is empty</>
              ) : scope.kind === "unfiled" ? (
                <>Every file is in a folder</>
              ) : (
                <>
                  <strong>{folder ? "This folder is empty" : "Keep your files here"}</strong>
                  {folder
                    ? "Drop files here, or drag files from All Files onto the folder in the left column — a file can be in several folders."
                    : "Drop files onto this window, or click Add files. Sort them into folders and tags — the same file is only kept once."}
                </>
              )}
            </div>
          )}
        </div>
        <div className="dr-status">
          {sel.length > 1 ? `${sel.length} of ${shown.length} selected` : `${shown.length} ${shown.length === 1 ? "file" : "files"}`}
          {clip && <span className="dr-status-cut">{clip.ids.length} cut · {folder ? "Ctrl+V to move here" : "open a folder to paste"}</span>}
        </div>
      </section>

      <aside className="dr-detail">
        {one ? (
          <FileDetail
            key={one.id}
            file={one}
            lib={lib}
            now={props.now}
            tagNames={tagNames}
            onOpen={() => props.onView(one)}
            onRename={() => setRenaming(one.id)}
            onTrash={() => trash([one.id])}
            onRestore={() => restore([one.id])}
            onShowPlace={props.onShowPlace}
            onCreateItem={() => props.onCreateItem(one)}
            onAttachTo={() => props.onAttachTo(one.id)}
            onTags={(tags) => onModify((l) => setFileTags(l, one.id, tags))}
            onRemoveFrom={(id) => onModify((l) => removeFromFolder(l, [one.id], id))}
            onScope={props.onScope}
          />
        ) : sel.length > 1 ? (
          <div className="dr-multi">
            <strong>{sel.length} files selected</strong>
            <span className="dr-muted">{selFiles.some((f) => f.size) ? formatSize(selFiles.reduce((a, f) => a + f.size, 0)) : ""}</span>
            <div className="dr-actions">
              {inTrash ? (
                <>
                  <button className="dr-btn" onClick={() => restore(sel)}>
                    <OpenIcon /> Restore
                  </button>
                  <button className="dr-btn danger" onClick={() => trash(sel)}>
                    <TrashIcon /> Delete permanently
                  </button>
                </>
              ) : (
                <>
                  <button className="dr-btn" onClick={() => cut(sel)}>
                    <CutIcon /> Cut
                  </button>
                  <button className="dr-btn danger" onClick={() => trash(sel)}>
                    <TrashIcon /> Move to Trash
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="dr-detail-empty">{shown.length ? `${shown.length} ${shown.length === 1 ? "file" : "files"} · select one to see its details` : ""}</div>
        )}
      </aside>

      {menu && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {menu.on === "entries" ? (
            inTrash ? (
              <>
                {sel.length > 1 && <div className="popover-count">{sel.length} files selected</div>}
                <MenuRow icon={<OpenIcon />} label="Restore to Files" onClick={() => (setMenu(null), restore(sel))} />
                <MenuRow icon={<TrashIcon />} label="Delete permanently…" danger onClick={() => (setMenu(null), trash(sel))} />
              </>
            ) : (
              <>
                {sel.length > 1 && <div className="popover-count">{sel.length} files selected</div>}
                {sel.length === 1 && <MenuRow icon={<OpenIcon />} label="Open" hint="Enter" onClick={() => (setMenu(null), open(sel[0]))} />}
                {one && mediaFilePath(one.src) && <MenuRow icon={<FolderIcon />} label="Show in folder" onClick={() => (setMenu(null), void reveal(one.src))} />}
                {one && <MenuRow icon={<ClipIcon />} label="Attach to item…" onClick={() => (setMenu(null), props.onAttachTo(one.id))} />}
                {one && <MenuRow icon={<DocIcon />} label="Create item from file" onClick={() => (setMenu(null), props.onCreateItem(one))} />}
                {lib.folders.length > 0 && (
                  <>
                    <div className="popover-sep" />
                    <div className="popover-title">Add to folder</div>
                    <div className="dr-menu-scroll">
                      {flatFolders(lib).map(({ f, depth }) => (
                        <MenuRow key={f.id} icon={<FolderIcon />} label={`${" ".repeat(depth)}${f.name}`} onClick={() => (setMenu(null), addTo(f))} />
                      ))}
                    </div>
                  </>
                )}
                <div className="popover-sep" />
                {folder && (
                  <MenuRow
                    icon={<CloseIcon />}
                    label="Remove from folder"
                    onClick={() => {
                      setMenu(null);
                      onModify((l) => removeFromFolder(l, sel, folder));
                    }}
                  />
                )}
                <MenuRow icon={<CutIcon />} label="Cut" hint="Ctrl+X" onClick={() => (setMenu(null), cut(sel))} />
                {sel.length === 1 && <MenuRow icon={<DocIcon />} label="Rename" hint="F2" onClick={() => (setMenu(null), setRenaming(sel[0]))} />}
                <MenuRow icon={<TrashIcon />} label="Move to Trash" hint="Del" danger onClick={() => (setMenu(null), trash(sel))} />
              </>
            )
          ) : inTrash ? (
            <MenuRow icon={<TrashIcon />} label="Empty Trash…" danger onClick={() => (setMenu(null), emptyTrash())} />
          ) : (
            <>
              <MenuRow icon={<FolderIcon />} label="New folder" hint="Ctrl+Shift+N" onClick={() => (setMenu(null), props.onNewFolder(folder))} />
              <MenuRow icon={<PlusIcon />} label="Add files…" onClick={() => (setMenu(null), addRef.current?.click())} />
              {clip && folder && (
                <MenuRow icon={<PasteIcon />} label={`Paste ${clip.ids.length === 1 ? "1 file" : `${clip.ids.length} files`} here`} hint="Ctrl+V" onClick={() => (setMenu(null), paste())} />
              )}
              <div className="popover-sep" />
              <MenuRow icon={<CopyIcon />} label="Find duplicates…" onClick={() => (setMenu(null), props.onFindDuplicates())} />
            </>
          )}
        </Menu>
      )}
    </>
  );
}

function FileDetail(props: {
  file: FileEntry;
  lib: Library;
  now: string;
  tagNames: string[];
  onOpen: () => void;
  onRename: () => void;
  onTrash: () => void;
  onRestore: () => void;
  onShowPlace: (p: Place) => void;
  onCreateItem: () => void;
  onAttachTo: () => void;
  onTags: (tags: string[]) => void;
  onRemoveFrom: (folder: string) => void;
  onScope: (s: FileScope) => void;
}) {
  const { file, lib } = props;
  // 連到這一筆的附件列在 Attached to；Same file also in 只列另外存放的副本
  const others = locate(lib, file.src).filter((p) => (p.kind === "file" ? p.file.id !== file.id : p.att.file !== file.id));
  const attached = attachedTo(lib, file.id);
  const kind = fileKind(file.name, file.src);
  const folders = file.folders.filter((id) => lib.folders.some((f) => f.id === id));
  return (
    <div className="dr-fdetail">
      <button className="dr-fdetail-art" onClick={props.onOpen} title="Open">
        {kind === "image" ? <img src={mediaUrl(file.src)} alt="" /> : <FileGlyph name={file.name} src={file.src} large />}
      </button>
      <strong className="dr-fdetail-name">{file.name}</strong>
      <dl className="dr-fmeta">
        <dt>Type</dt>
        <dd>{typeName(file.name, file.src)}</dd>
        {file.size > 0 && (
          <>
            <dt>Size</dt>
            <dd>{formatSize(file.size)}</dd>
          </>
        )}
        <dt>Folders</dt>
        <dd className="dr-ffolders">
          {folders.length ? (
            folders.map((id) => (
              <span key={id} className="dr-ffolder">
                <button className="dr-link" onClick={() => props.onScope({ kind: "folder", id })}>
                  {folderPath(lib, id)
                    .map((f) => f.name)
                    .join(" › ")}
                </button>
                {!file.trashed && (
                  <button className="icon-btn" title="Remove from this folder" onClick={() => props.onRemoveFrom(id)}>
                    <CloseIcon />
                  </button>
                )}
              </span>
            ))
          ) : (
            <span className="dr-muted">Unfiled{file.trashed ? "" : " — drag it onto a folder"}</span>
          )}
        </dd>
        <dt>Added</dt>
        <dd>{dateLabel(file.added, props.now)}</dd>
        {file.trashed && (
          <>
            <dt>Status</dt>
            <dd>In the Trash</dd>
          </>
        )}
      </dl>
      {!file.trashed && (
        <div className="dr-ftags">
          <span className="dr-ftags-label">Tags</span>
          <TagsEditor tags={file.tags} all={props.tagNames} onChange={props.onTags} />
        </div>
      )}
      <div className="dr-actions">
        <button className="dr-btn" onClick={props.onOpen}>
          <OpenIcon /> Open
        </button>
        {mediaFilePath(file.src) && (
          <button className="dr-btn" onClick={() => void reveal(file.src)}>
            <FolderIcon /> Show in folder
          </button>
        )}
        {file.trashed ? (
          <>
            <button className="dr-btn" onClick={props.onRestore}>
              <OpenIcon /> Restore
            </button>
            <button className="dr-btn danger" onClick={props.onTrash}>
              <TrashIcon /> Delete permanently
            </button>
          </>
        ) : (
          <>
            <button className="dr-btn" onClick={props.onAttachTo} title="Attach this file to an item in My Library">
              <ClipIcon /> Attach to item…
            </button>
            <button className="dr-btn" onClick={props.onCreateItem} title="Make a new item with this file attached so you can cite it (the file stays here)">
              <DocIcon /> Create item
            </button>
            <button className="dr-btn danger" onClick={props.onTrash}>
              <TrashIcon /> Move to Trash
            </button>
          </>
        )}
      </div>
      {attached.length > 0 && (
        <div className="dr-attached">
          <strong>Attached to</strong>
          {attached.map(({ item, att }) => (
            <div key={`${item.id}:${att.id}`} className="dr-place">
              <DocIcon />
              <span className="dr-place-text">
                <span className="dr-place-name">{item.title || "Untitled"}</span>
                <span className="dr-place-where">{item.trashed ? "In the Trash" : "My Library"}</span>
              </span>
              <button className="dr-link" onClick={() => props.onShowPlace({ kind: "attachment", item, att })}>
                Show
              </button>
            </div>
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div className="dr-dup-note">
          <strong>Same file also in</strong>
          {others.map((p) => (
            <PlaceRow key={placeKey(p)} lib={lib} place={p} onShow={() => props.onShowPlace(p)} />
          ))}
        </div>
      )}
    </div>
  );
}

export function PlaceRow(props: { lib: Library; place: Place; onShow: () => void; actions?: ReactNode }) {
  const p = props.place;
  return (
    <div className="dr-place">
      <FileGlyph name={placeName(p)} src={p.kind === "file" ? p.file.src : p.att.src} />
      <span className="dr-place-text">
        <span className="dr-place-name">{placeName(p)}</span>
        <span className="dr-place-where">{placeLabel(props.lib, p)}</span>
      </span>
      <button className="dr-link" onClick={props.onShow}>
        Show
      </button>
      {props.actions}
    </div>
  );
}
