import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  CopyIcon,
  CutIcon,
  DocIcon,
  DrawerIcon,
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
  addFolder,
  childFolders,
  countRemoved,
  fileKind,
  filesIn,
  folderFileCount,
  folderPath,
  formatSize,
  locate,
  moveEntries,
  pathLabel,
  placeKey,
  placeLabel,
  placeName,
  removeEntries,
  renameEntry,
  searchFiles,
  typeName,
  type FileEntry,
  type Folder,
  type Place,
} from "./files";
import type { Library } from "./model";
import { Menu, MenuRow, RenameInput, reveal } from "./ui";

/**
 * Drawer 的檔案庫（參考 Windows 檔案總管）：上方是上一頁／下一頁／上一層、路徑與搜尋，
 * 中間是目前資料夾的內容（大圖示或詳細資料），右欄是選取的檔案。
 * 資料夾樹在 DrawerView 的左欄；拖曳（搬到別的資料夾）用 DrawerView 的 `startDrag`（指標事件）。
 */

export type EntryDrag = { kind: "entries"; ids: string[]; label: string };

type ViewMode = "icons" | "details";
const VIEW_KEY = "banyan.drawerFilesView";
function loadView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === "details" ? "details" : "icons";
  } catch {
    return "icons";
  }
}

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

export function FilesPane(props: {
  lib: Library;
  /** 目前的資料夾（null 是 My Files） */
  folder: string | null;
  onFolder: (f: string | null) => void;
  sel: string[];
  onSel: (ids: string[]) => void;
  onModify: (fn: (lib: Library) => Library) => void;
  /** 加入檔案（DrawerView 先檢查重複） */
  onAdd: (folder: string | null, files: File[]) => void;
  onView: (f: FileEntry) => void;
  onFindDuplicates: () => void;
  onShowPlace: (p: Place) => void;
  onCreateItem: (f: FileEntry) => void;
  startDrag: (e: React.PointerEvent, d: EntryDrag) => void;
  dropTarget: string | null;
  onNotice: (s: string) => void;
  now: string;
}) {
  const { lib, folder, sel, onSel, onModify, onFolder } = props;
  const [view, setView] = useState<ViewMode>(loadView);
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; on: "entries" | "blank" } | null>(null);
  const [clip, setClip] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* 記不住也沒關係 */
    }
  }, [view]);

  // 上一頁／下一頁（像檔案總管）：資料夾改變時記下來源
  const hist = useRef<{ back: (string | null)[]; fwd: (string | null)[]; last: string | null; jump: boolean }>({ back: [], fwd: [], last: folder, jump: false });
  useEffect(() => {
    const h = hist.current;
    if (h.last === folder) return;
    if (!h.jump) {
      h.back.push(h.last);
      h.fwd = [];
    }
    h.jump = false;
    h.last = folder;
    setQuery("");
  }, [folder]);
  const goBack = () => {
    const h = hist.current;
    const to = h.back.pop();
    if (to === undefined) return;
    h.fwd.push(folder);
    h.jump = true;
    onFolder(to);
  };
  const goFwd = () => {
    const h = hist.current;
    const to = h.fwd.pop();
    if (to === undefined) return;
    h.back.push(folder);
    h.jump = true;
    onFolder(to);
  };
  const parentOf = (id: string | null) => (id ? (lib.folders.find((f) => f.id === id)?.parent ?? null) : null);
  const goUp = () => {
    if (!folder) return;
    onFolder(parentOf(folder));
    onSel([folder]);
  };

  const searching = query.trim().length > 0;
  const { folders, files } = useMemo(
    () => (searching ? searchFiles(lib, folder, query) : { folders: childFolders(lib, folder), files: filesIn(lib, folder) }),
    [lib, folder, query, searching],
  );
  const order = useMemo(() => [...folders.map((f) => f.id), ...files.map((f) => f.id)], [folders, files]);
  const folderById = useMemo(() => new Map(lib.folders.map((f) => [f.id, f])), [lib.folders]);
  const fileById = useMemo(() => new Map(lib.files.map((f) => [f.id, f])), [lib.files]);
  const path = folderPath(lib, folder);

  // 選取的東西不在畫面上了就拿掉
  useEffect(() => {
    const vis = new Set(order);
    if (!sel.every((id) => vis.has(id))) onSel(sel.filter((id) => vis.has(id)));
  }, [order, sel, onSel]);

  const selFiles = sel.map((id) => fileById.get(id)).filter((f): f is FileEntry => !!f);
  const selFolders = sel.map((id) => folderById.get(id)).filter((f): f is Folder => !!f);
  const one = sel.length === 1 ? (fileById.get(sel[0]) ?? null) : null;
  const oneFolder = sel.length === 1 ? (folderById.get(sel[0]) ?? null) : null;

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
    if (folderById.has(id)) {
      onFolder(id);
      onSel([]);
      return;
    }
    const f = fileById.get(id);
    if (f) props.onView(f);
  };

  const newFolder = () => {
    let made = "";
    onModify((l) => {
      const r = addFolder(l, folder);
      made = r.id;
      return r.lib;
    });
    if (made) {
      setQuery("");
      onSel([made]);
      setRenaming(made);
    }
  };

  const remove = (ids: string[]) => {
    if (!ids.length) return;
    const n = countRemoved(lib, ids);
    const what =
      n.folders && n.files
        ? `${n.folders === 1 ? "1 folder" : `${n.folders} folders`} and ${n.files === 1 ? "1 file" : `${n.files} files`}`
        : n.folders
          ? n.folders === 1
            ? "this folder"
            : `${n.folders} folders`
          : n.files === 1
            ? `“${fileById.get(ids[0])?.name ?? "this file"}”`
            : `${n.files} files`;
    if (!window.confirm(`Delete ${what} from your Drawer? This can't be undone.`)) return;
    onModify((l) => removeEntries(l, ids));
    const idx = order.indexOf(ids[ids.length - 1]);
    const next = order.slice(idx + 1).find((x) => !ids.includes(x)) ?? [...order.slice(0, idx)].reverse().find((x) => !ids.includes(x));
    onSel(next ? [next] : []);
  };

  const paste = () => {
    const ids = clip.filter((id) => fileById.has(id) || folderById.has(id));
    if (!ids.length) return;
    onModify((l) => moveEntries(l, ids, folder));
    setClip([]);
    onSel(ids);
    props.onNotice(`Moved ${ids.length === 1 ? "1 item" : `${ids.length} items`} to ${pathLabel(lib, folder)}`);
  };

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
    } else if (e.key === "Backspace") {
      e.preventDefault();
      goUp();
    } else if (e.key === "Delete") {
      e.preventDefault();
      remove(sel);
    } else if (e.key === "F2" && sel.length === 1) {
      e.preventDefault();
      setRenaming(sel[0]);
    } else if (ctrl && e.code === "KeyA") {
      e.preventDefault();
      onSel(order);
    } else if (ctrl && e.code === "KeyX" && sel.length) {
      e.preventDefault();
      setClip(sel);
      props.onNotice(`Cut ${sel.length === 1 ? "1 item" : `${sel.length} items`} — open a folder and press Ctrl+V to move`);
    } else if (ctrl && e.code === "KeyV" && clip.length) {
      e.preventDefault();
      paste();
    } else if (ctrl && e.shiftKey && e.code === "KeyN") {
      e.preventDefault();
      newFolder();
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
      props.startDrag(e, { kind: "entries", ids, label: ids.length === 1 ? label : `${ids.length} items` });
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

  const cut = (id: string) => clip.includes(id);
  const dropCls = (id: string) => (props.dropTarget === `f:${id}` ? " drop" : "");
  const empty = !folders.length && !files.length;

  return (
    <>
      <section className="dr-main dr-files">
        <div className="dr-toolbar">
          <div className="dr-nav">
            <button className="icon-btn" title="Back" disabled={!hist.current.back.length} onClick={goBack}>
              <ArrowLeftIcon />
            </button>
            <button className="icon-btn" title="Forward" disabled={!hist.current.fwd.length} onClick={goFwd}>
              <ArrowRightIcon />
            </button>
            <button className="icon-btn" title="Up (Backspace)" disabled={!folder} onClick={goUp}>
              <ArrowUpIcon />
            </button>
          </div>
          <div className="dr-crumbs">
            <button className={`dr-crumb${props.dropTarget === "f:" ? " drop" : ""}`} data-drop="f:" onClick={() => onFolder(null)}>
              <DrawerIcon /> My Files
            </button>
            {path.map((f) => (
              <span key={f.id} className="dr-crumb-wrap">
                <ChevronRightIcon />
                <button className={`dr-crumb${dropCls(f.id)}`} data-drop={`f:${f.id}`} onClick={() => onFolder(f.id)}>
                  {f.name}
                </button>
              </span>
            ))}
          </div>
          <label className="dr-search dr-files-search">
            <SearchIcon />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
              placeholder={`Search ${path.length ? path[path.length - 1].name : "My Files"}`}
              spellCheck={false}
            />
          </label>
        </div>
        <div className="dr-toolbar dr-files-actions">
          <button className="dr-btn primary" onClick={() => addRef.current?.click()}>
            <PlusIcon /> Add files
          </button>
          <button className="dr-btn" onClick={newFolder} title="New folder (Ctrl+Shift+N)">
            <FolderIcon /> New folder
          </button>
          <button className="dr-btn" onClick={props.onFindDuplicates} title="Find files with the same content">
            <CopyIcon /> Find duplicates
          </button>
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
          className={`dr-files-body ${view}${props.dropTarget === `f:${folder ?? ""}` ? " drop" : ""}`}
          ref={bodyRef}
          tabIndex={0}
          data-drop={`f:${folder ?? ""}`}
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
              <span>Name</span>
              <span>{searching ? "Folder" : "Date added"}</span>
              <span>Type</span>
              <span className="dr-fsize">Size</span>
            </div>
          )}
          {view === "icons" ? (
            <div className="dr-tiles">
              {folders.map((f) => (
                <div key={f.id} className={`dr-tile${sel.includes(f.id) ? " on" : ""}${cut(f.id) ? " cut" : ""}${dropCls(f.id)}`} data-drop={`f:${f.id}`} {...entryProps(f.id, f.name)}>
                  <span className="dr-tile-art folder">
                    <FolderIcon />
                  </span>
                  {nameOrRename(f.id, f.name)}
                </div>
              ))}
              {files.map((f) => (
                <div key={f.id} className={`dr-tile${sel.includes(f.id) ? " on" : ""}${cut(f.id) ? " cut" : ""}`} {...entryProps(f.id, f.name)}>
                  <span className="dr-tile-art">
                    {fileKind(f.name, f.src) === "image" ? <img src={mediaUrl(f.src)} alt="" loading="lazy" draggable={false} /> : <FileGlyph name={f.name} src={f.src} large />}
                  </span>
                  {nameOrRename(f.id, f.name)}
                </div>
              ))}
            </div>
          ) : (
            <>
              {folders.map((f) => (
                <div key={f.id} className={`dr-frow${sel.includes(f.id) ? " on" : ""}${cut(f.id) ? " cut" : ""}${dropCls(f.id)}`} data-drop={`f:${f.id}`} {...entryProps(f.id, f.name)}>
                  <span className="dr-fname">
                    <FolderIcon className="dr-folder-glyph" />
                    {nameOrRename(f.id, f.name)}
                  </span>
                  <span>{searching ? pathLabel(lib, f.parent) : dateLabel(f.added, props.now)}</span>
                  <span>File folder</span>
                  <span className="dr-fsize" />
                </div>
              ))}
              {files.map((f) => (
                <div key={f.id} className={`dr-frow${sel.includes(f.id) ? " on" : ""}${cut(f.id) ? " cut" : ""}`} {...entryProps(f.id, f.name)}>
                  <span className="dr-fname">
                    <FileGlyph name={f.name} src={f.src} />
                    {nameOrRename(f.id, f.name)}
                  </span>
                  <span>{searching ? pathLabel(lib, f.folder) : dateLabel(f.added, props.now)}</span>
                  <span>{typeName(f.name, f.src)}</span>
                  <span className="dr-fsize">{formatSize(f.size)}</span>
                </div>
              ))}
            </>
          )}
          {empty && (
            <div className="dr-empty">
              {searching ? (
                <>No files match</>
              ) : (
                <>
                  <strong>{folder ? "This folder is empty" : "Keep your files here"}</strong>
                  Drop files onto this window, or click <b>Add files</b>. Make folders to sort them — the same file is only kept once.
                </>
              )}
            </div>
          )}
        </div>
        <div className="dr-status">
          {sel.length > 1 ? `${sel.length} items selected` : `${order.length} ${order.length === 1 ? "item" : "items"}`}
          {clip.length > 0 && <span className="dr-status-cut">{clip.length} cut · Ctrl+V to move here</span>}
        </div>
      </section>

      <aside className="dr-detail">
        {one ? (
          <FileDetail
            key={one.id}
            file={one}
            lib={lib}
            now={props.now}
            onOpen={() => props.onView(one)}
            onRename={() => setRenaming(one.id)}
            onDelete={() => remove([one.id])}
            onShowPlace={props.onShowPlace}
            onCreateItem={() => props.onCreateItem(one)}
          />
        ) : oneFolder ? (
          <div className="dr-fdetail">
            <span className="dr-fdetail-art folder">
              <FolderIcon />
            </span>
            <strong className="dr-fdetail-name">{oneFolder.name}</strong>
            <dl className="dr-fmeta">
              <dt>Location</dt>
              <dd>{pathLabel(lib, oneFolder.parent)}</dd>
              <dt>Contains</dt>
              <dd>
                {childFolders(lib, oneFolder.id).length} folders · {folderFileCount(lib, oneFolder.id)} files
              </dd>
              <dt>Created</dt>
              <dd>{dateLabel(oneFolder.added, props.now)}</dd>
            </dl>
            <div className="dr-actions">
              <button className="dr-btn" onClick={() => open(oneFolder.id)}>
                <OpenIcon /> Open
              </button>
              <button className="dr-btn" onClick={() => setRenaming(oneFolder.id)}>
                Rename
              </button>
            </div>
          </div>
        ) : sel.length > 1 ? (
          <div className="dr-multi">
            <strong>{sel.length} items selected</strong>
            <span className="dr-muted">
              {selFolders.length ? `${selFolders.length} folders · ` : ""}
              {selFiles.length} files{selFiles.some((f) => f.size) ? ` · ${formatSize(selFiles.reduce((a, f) => a + f.size, 0))}` : ""}
            </span>
            <div className="dr-actions">
              <button className="dr-btn" onClick={() => setClip(sel)}>
                <CutIcon /> Cut
              </button>
              <button className="dr-btn danger" onClick={() => remove(sel)}>
                <TrashIcon /> Delete
              </button>
            </div>
          </div>
        ) : (
          <div className="dr-detail-empty">
            {lib.files.length ? `${lib.files.length} files in your Drawer · select one to see its details` : ""}
          </div>
        )}
      </aside>

      {menu && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {menu.on === "entries" ? (
            <>
              {sel.length > 1 && <div className="popover-count">{sel.length} items selected</div>}
              {sel.length === 1 && <MenuRow icon={<OpenIcon />} label="Open" hint="Enter" onClick={() => (setMenu(null), open(sel[0]))} />}
              {one && mediaFilePath(one.src) && <MenuRow icon={<FolderIcon />} label="Show in folder" onClick={() => (setMenu(null), void reveal(one.src))} />}
              {one && <MenuRow icon={<DocIcon />} label="Convert to Drawer item" onClick={() => (setMenu(null), props.onCreateItem(one))} />}
              <div className="popover-sep" />
              <MenuRow icon={<CutIcon />} label="Cut" hint="Ctrl+X" onClick={() => (setMenu(null), setClip(sel))} />
              {sel.length === 1 && <MenuRow icon={<DocIcon />} label="Rename" hint="F2" onClick={() => (setMenu(null), setRenaming(sel[0]))} />}
              <MenuRow icon={<TrashIcon />} label="Delete…" hint="Del" danger onClick={() => (setMenu(null), remove(sel))} />
            </>
          ) : (
            <>
              <MenuRow icon={<FolderIcon />} label="New folder" hint="Ctrl+Shift+N" onClick={() => (setMenu(null), newFolder())} />
              <MenuRow icon={<PlusIcon />} label="Add files…" onClick={() => (setMenu(null), addRef.current?.click())} />
              {clip.length > 0 && <MenuRow icon={<PasteIcon />} label={`Paste ${clip.length === 1 ? "1 item" : `${clip.length} items`} here`} hint="Ctrl+V" onClick={() => (setMenu(null), paste())} />}
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
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onShowPlace: (p: Place) => void;
  onCreateItem: () => void;
}) {
  const { file, lib } = props;
  const others = locate(lib, file.src).filter((p) => !(p.kind === "file" && p.file.id === file.id));
  const kind = fileKind(file.name, file.src);
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
        <dt>Location</dt>
        <dd>{pathLabel(lib, file.folder)}</dd>
        <dt>Added</dt>
        <dd>{dateLabel(file.added, props.now)}</dd>
      </dl>
      <div className="dr-actions">
        <button className="dr-btn" onClick={props.onOpen}>
          <OpenIcon /> Open
        </button>
        {mediaFilePath(file.src) && (
          <button className="dr-btn" onClick={() => void reveal(file.src)}>
            <FolderIcon /> Show in folder
          </button>
        )}
        <button className="dr-btn" onClick={props.onCreateItem} title="Move this file into a new Drawer item (as its attachment) so you can cite it">
          <DocIcon /> Convert to item
        </button>
        <button className="dr-btn danger" onClick={props.onDelete}>
          <TrashIcon /> Delete
        </button>
      </div>
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
