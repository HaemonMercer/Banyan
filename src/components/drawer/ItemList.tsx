import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { drawerApi, errorMessage, type Attachment, type Collection, type CollectionView, type ItemSummary } from "../../drawer/api";
import { GROUP_LABELS, formatSize, groupedTypes, type Library } from "../../drawer/itemTypes";
import { NO_SELECTION, clickSelect, inOrder, range, single, type Selection } from "../../drawer/selection";
import { TITLE_MIN_WIDTH, sortItems, useColumns } from "../../drawer/columns";
import { Icon, TypeIcon } from "../../icons/Icon";
import GalleryTile from "./GalleryTile";
import { FileTile, FolderTile, displayName } from "./FileTiles";
import { canRead, type ReaderFile } from "../reader/Reader";
import { isHomeActive, isShown } from "../../tabs";

interface Props {
    title: string;
    items: ItemSummary[];
    selection: Selection;
    onSelectionChange: (sel: Selection) => void;
    query: string;
    onQueryChange: (q: string) => void;
    onCreate: (itemType: string) => void;
    onDelete: (ids: number[]) => void;
    /** Pointer-down on a row's title may start dragging the item(s) onto a folder or tag. */
    onDragStart: (e: React.PointerEvent, item: ItemSummary) => void;
    draggingIds: number[];
    onError: (message: string) => void;
    /** "gallery" shows the items as pictures only. */
    mode: CollectionView;
    /** Present when a folder is shown: switches how it shows its items. */
    onModeChange?: (mode: CollectionView) => void;
    /** Types offered by "＋ 新條目" (a gallery offers image types only). */
    canCreate: (itemType: string) => boolean;
    /** 文獻庫 or 檔案庫: decides the columns and how items are added. */
    library: Library;
    /** 檔案庫: "＋ 加入檔案" picks files, each becoming an item (instead of "＋ 新條目"). */
    onAddFiles: () => void;
    /** 文獻庫's BibTeX menu: import a .bib file, export or copy items as BibTeX. */
    onBibtex?: (action: "import" | "exportSelected" | "exportAll" | "copySelected") => void;
    /** Opens files in the reader (pictures of a gallery, an item's attachments). */
    onRead: (files: ReaderFile[], index: number) => void;
    /** 檔案庫, like Windows Explorer: large icons or the details table. */
    fileView: FileView;
    onFileViewChange: (v: FileView) => void;
    /** 檔案庫: sub-folders of the place shown, listed before the files. */
    folders: Collection[];
    /** 檔案庫's folders, to count each folder's sub-folders. */
    allFolders: Collection[];
    onOpenFolder: (id: number) => void;
    /** 檔案庫: the path shown instead of the title; segments with onClick go there. */
    crumbs: { label: string; onClick?: () => void }[];
    /** 檔案庫: one level up (↑, Backspace, Alt+↑); absent at the top. */
    onUp?: () => void;
    /** 檔案庫: double-click / Enter on a file opens it. */
    onOpenItem: (item: ItemSummary) => void;
    /** Folder under dragged items (its tile is highlighted). */
    dropFolderId: number | null;
    /** Switches the middle column to the relation graph of the selected item. */
    onShowGraph: () => void;
}

export type FileView = "icons" | "details";

/** The title with the searched words marked (case-insensitive). */
function marked(text: string, query: string): ReactNode {
    const words = query.trim().split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0 || !text) return text;
    const escaped = words.map((w) => w.replace(/[.*+?^$()|[\]{}\\]/g, "\\$&"));
    const re = new RegExp("(" + escaped.join("|") + ")", "gi");
    const parts = text.split(re);
    if (parts.length === 1) return text;
    return parts.map((part, i) => (i % 2 === 1 ? <mark key={i} className="search-hit">{part}</mark> : part));
}

const ICON_KEY = "banyan.drawer.fileTile";
const ICON_SIZES = { min: 72, max: 200, initial: 104 };
const loadIconSize = () => {
    try {
        const v = Number(localStorage.getItem(ICON_KEY));
        return v >= ICON_SIZES.min && v <= ICON_SIZES.max ? v : ICON_SIZES.initial;
    } catch {
        return ICON_SIZES.initial;
    }
};

const MARQUEE_THRESHOLD = 4;
const TILE_KEY = "banyan.drawer.galleryTile";
const TILE_SIZES = { min: 80, max: 360, initial: 160 };
const loadTile = () => {
    try {
        const v = Number(localStorage.getItem(TILE_KEY));
        return v >= TILE_SIZES.min && v <= TILE_SIZES.max ? v : TILE_SIZES.initial;
    } catch {
        return TILE_SIZES.initial;
    }
};

function ItemList({
    title, items: unsorted, selection, onSelectionChange, query, onQueryChange, onCreate, onDelete, onDragStart,
    draggingIds, onError, mode, onModeChange, canCreate, library, onAddFiles, onRead, onBibtex,
    fileView, onFileViewChange, folders, allFolders, onOpenFolder, crumbs, onUp, onOpenItem, dropFolderId,
    onShowGraph,
}: Props) {
    const gallery = mode === "gallery";
    const files = library === "files";
    /** 檔案庫's large icons (a gallery folder keeps showing pictures only). */
    const icons = files && !gallery && fileView === "icons";
    /** Items laid out in a grid rather than rows. */
    const grid = gallery || icons;
    const [iconSize, setIconSize] = useState(loadIconSize);
    const changeIconSize = (v: number) => {
        setIconSize(v);
        try {
            localStorage.setItem(ICON_KEY, String(v));
        } catch {
            /* this session only */
        }
    };
    /** A folder clicked once (highlighted; Enter opens it). */
    const [folderFocus, setFolderFocus] = useState<number | null>(null);
    const folderKey = folders.map((f) => f.id).join(",");
    useEffect(() => setFolderFocus(null), [folderKey]);
    const cols = useColumns(library);
    const items = useMemo(
        () => sortItems(unsorted, cols.sort, cols.all, (it) => (files ? displayName(it) : it.title)),
        [unsorted, cols.sort, cols.all, files],
    );
    const sortLabel = (key: string) => (key === "title" ? (files ? "名稱" : "標題") : (cols.all.find((c) => c.id === key)?.label ?? ""));
    /** A column header that sorts by it (▲ / ▼ shows the current order). */
    const sortHeader = (key: string, content: ReactNode) => {
        const on = cols.sort?.key === key ? cols.sort.dir : null;
        return (
            <button
                className={`col-sort${on ? " on" : ""}`}
                title={on ? `依「${sortLabel(key)}」${on === "asc" ? "遞增" : "遞減"}排序，再按一次${on === (cols.all.find((c) => c.id === key)?.sortValue ? "desc" : "asc") ? "反向" : "恢復預設（最近修改的在前）"}` : `依「${sortLabel(key)}」排序`}
                aria-sort={on === "asc" ? "ascending" : on === "desc" ? "descending" : undefined}
                onClick={() => cols.cycleSort(key)}
            >
                {content}
                {on && <Icon name={on === "asc" ? "arrowUp" : "arrowDown"} className="col-sort-arrow" />}
            </button>
        );
    };
    const searchRef = useRef<HTMLInputElement>(null);
    // Ctrl+F searches the list (unless the reader, which has its own search, is open).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "f" || e.shiftKey || e.altKey) return;
            if (!isHomeActive() || !isShown(searchRef.current) || document.querySelector(".reader, .modal-backdrop")) return;
            e.preventDefault();
            searchRef.current?.focus();
            searchRef.current?.select();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);
    const [colMenu, setColMenu] = useState<{ x: number; y: number; atPointer?: boolean } | null>(null);
    const [tile, setTile] = useState(loadTile);
    const changeTile = (v: number) => {
        setTile(v);
        try {
            localStorage.setItem(TILE_KEY, String(v));
        } catch {
            /* keep it for this session only */
        }
    };
    const GAP = 8; // matches var(--sp-2)
    const gridColumns = `minmax(${TITLE_MIN_WIDTH}px, 1fr) ${cols.columns.map((c) => `${c.width}px`).join(" ")}`;
    const rowMinWidth = TITLE_MIN_WIDTH + cols.columns.reduce((n, c) => n + c.width + GAP, 0) + 24;

    /** Drag the left edge of a column's header to resize it (the title column takes the rest). */
    const startResize = (e: React.PointerEvent, id: string, width: number, minWidth: number) => {
        e.preventDefault();
        e.stopPropagation();
        const x0 = e.clientX;
        document.body.classList.add("col-resizing");
        const onMove = (ev: PointerEvent) => cols.setWidth(id, Math.max(minWidth, width - (ev.clientX - x0)));
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            document.body.classList.remove("col-resizing");
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    const order = items.map((i) => i.id);
    const selected = new Set(selection.ids);
    const focusId = selection.focus;
    const tableRef = useRef<HTMLDivElement>(null);
    /** Selection box in the table's content coordinates. */
    const [box, setBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
    /** Set right after a box selection so the click that ends it doesn't reset the selection. */
    const suppressClick = useRef(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [bibMenuOpen, setBibMenuOpen] = useState(false);
    /** Items whose attachments are shown as child rows. */
    const [expanded, setExpanded] = useState<Set<number>>(new Set());
    const [attachments, setAttachments] = useState<Map<number, Attachment[]>>(new Map());

    // Bring a newly focused row into view (e.g. after jumping to a related item), once its row exists.
    const scrollPending = useRef<number | null>(null);
    useEffect(() => {
        scrollPending.current = focusId;
    }, [focusId]);
    useEffect(() => {
        const id = scrollPending.current;
        if (id === null) return;
        const row = tableRef.current?.querySelector(`[data-item-id="${id}"]`);
        if (!row) return;
        row.scrollIntoView({ block: "nearest" });
        scrollPending.current = null;
    }, [focusId, items]);

    // (Re)load attachments of expanded items whenever the list reloads (e.g. a file was added).
    useEffect(() => {
        let cancelled = false;
        const wanted = items.filter((it) => expanded.has(it.id) && it.attachmentCount > 0);
        Promise.all(wanted.map(async (it) => [it.id, await drawerApi.listAttachments(it.id)] as const))
            .then((pairs) => {
                if (!cancelled) setAttachments(new Map(pairs));
            })
            .catch((e) => onError(errorMessage(e)));
        return () => {
            cancelled = true;
        };
    }, [items, expanded, onError]);

    const setOpen = (ids: number[], open: boolean) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            ids.forEach((id) => (open ? next.add(id) : next.delete(id)));
            return next;
        });
    const withAttachments = items.filter((it) => it.attachmentCount > 0).map((it) => it.id);

    /** Tiles per row in the gallery (those level with the first). */
    const galleryColumns = () => {
        const tiles = [...(tableRef.current?.querySelectorAll<HTMLElement>(".gallery-tile, .file-tile[data-item-id]") ?? [])];
        return Math.max(1, tiles.filter((t) => t.offsetTop === tiles[0]?.offsetTop).length);
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (files && onUp && (e.key === "Backspace" || (e.altKey && e.key === "ArrowUp"))) {
            e.preventDefault();
            onUp();
            return;
        }
        if (files && e.key === "Enter") {
            e.preventDefault();
            if (folderFocus !== null) onOpenFolder(folderFocus);
            else {
                const it = items.find((i) => i.id === focusId);
                if (it) onOpenItem(it);
            }
            return;
        }
        if (items.length === 0) return;
        const idx = focusId === null ? -1 : order.indexOf(focusId);
        const moveTo = (next: number) => {
            e.preventDefault();
            const id = order[Math.max(0, Math.min(order.length - 1, next))];
            // Shift+↑/↓ extends the selection from the anchor.
            onSelectionChange(
                e.shiftKey && selection.anchor !== null
                    ? { ids: range(order, selection.anchor, id), focus: id, anchor: selection.anchor }
                    : single(id),
            );
        };
        const step = grid ? galleryColumns() : 1;
        if (grid && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
            moveTo(e.key === "ArrowLeft" ? Math.max(0, idx - 1) : idx + 1);
        } else if (e.key === "ArrowDown") moveTo(idx + step);
        else if (e.key === "ArrowUp") moveTo(idx < 0 ? 0 : Math.max(0, idx - step));
        else if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            onSelectionChange({ ids: [...order], focus: focusId ?? order[0], anchor: order[0] });
        } else if (e.key === "Escape") {
            onSelectionChange(single(focusId));
        } else if (e.key === "ArrowRight" && focusId !== null) {
            e.preventDefault();
            setOpen(selection.ids.length ? selection.ids : [focusId], true);
        } else if (e.key === "ArrowLeft" && focusId !== null) {
            e.preventDefault();
            setOpen(selection.ids.length ? selection.ids : [focusId], false);
        } else if (e.key === "+" || e.key === "=") {
            setOpen(withAttachments, true);
        } else if (e.key === "-") {
            setExpanded(new Set());
        } else if (e.key === "Delete" && selection.ids.length > 0) {
            onDelete(selection.ids);
        }
    };

    /**
     * Box (rubber-band) selection: drag from empty space, or from a row outside its title.
     * Ctrl adds to the current selection. The list scrolls when the pointer leaves it.
     */
    const startMarquee = (e: React.PointerEvent, onBlank: boolean) => {
        const table = tableRef.current;
        if (!table || e.button !== 0) return;
        const toContent = (cx: number, cy: number) => {
            const r = table.getBoundingClientRect();
            return { x: cx - r.left + table.scrollLeft, y: cy - r.top + table.scrollTop };
        };
        const start = toContent(e.clientX, e.clientY);
        const base = e.ctrlKey || e.metaKey ? selection.ids : [];
        let pointer = { x: e.clientX, y: e.clientY };
        let active = false;
        let scrollTimer: number | undefined;

        const apply = () => {
            const cur = toContent(pointer.x, pointer.y);
            const top = Math.min(start.y, cur.y);
            const bottom = Math.max(start.y, cur.y);
            const left = Math.min(start.x, cur.x);
            const right = Math.max(start.x, cur.x);
            setBox({ top, left, width: right - left, height: bottom - top });
            const hit = [...table.querySelectorAll<HTMLElement>("[data-item-id]")]
                .filter((el) => el.offsetTop < bottom && el.offsetTop + el.offsetHeight > top)
                .filter((el) => !grid || (el.offsetLeft < right && el.offsetLeft + el.offsetWidth > left))
                .map((el) => Number(el.dataset.itemId));
            onSelectionChange({
                ids: inOrder(order, [...base, ...hit]),
                focus: hit.length ? (cur.y >= start.y ? hit[hit.length - 1] : hit[0]) : (base[base.length - 1] ?? null),
                anchor: hit.length ? (cur.y >= start.y ? hit[0] : hit[hit.length - 1]) : selection.anchor,
            });
        };
        const autoScroll = () => {
            const r = table.getBoundingClientRect();
            const step = pointer.y < r.top + 16 ? -14 : pointer.y > r.bottom - 16 ? 14 : 0;
            if (step) {
                table.scrollTop += step;
                apply();
            }
        };
        const onMove = (ev: PointerEvent) => {
            pointer = { x: ev.clientX, y: ev.clientY };
            if (!active) {
                if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < MARQUEE_THRESHOLD) return;
                active = true;
                document.body.classList.add("box-selecting");
                scrollTimer = window.setInterval(autoScroll, 30);
            }
            apply();
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
            window.clearInterval(scrollTimer);
            document.body.classList.remove("box-selecting");
            setBox(null);
            if (active) {
                suppressClick.current = true;
                setTimeout(() => (suppressClick.current = false), 0);
            } else if (onBlank && !(e.ctrlKey || e.metaKey)) {
                onSelectionChange(NO_SELECTION); // plain click on empty space clears the selection
            }
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
    };

    const onRowPointerDown = (e: React.PointerEvent, it: ItemSummary) => {
        const target = e.target as HTMLElement;
        if (target.closest(".twisty")) return;
        // Title: drag the item(s) to a folder or tag. Elsewhere on the row: draw a selection box.
        if (target.closest(".col-title")) onDragStart(e, it);
        else startMarquee(e, false);
    };

    const onRowClick = (e: React.MouseEvent, id: number) => {
        if (suppressClick.current) return;
        setFolderFocus(null);
        onSelectionChange(clickSelect(selection, order, id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }));
    };

    /** Readable files open in the reader (with the item's other attachments); others in their program. */
    const open = (a: Attachment) => {
        const files = attachments.get(a.itemId) ?? [a];
        if (canRead(a)) onRead(files.filter(canRead), files.filter(canRead).findIndex((f) => f.id === a.id));
        else drawerApi.openAttachment(a.id).catch((e) => onError(errorMessage(e)));
    };
    const allOpen = withAttachments.length > 0 && withAttachments.every((id) => expanded.has(id));

    return (
        <section className="drawer-pane drawer-list">
            <div className="pane-header">
                {files ? (
                    <>
                        <button className="icon-btn" title="上一層（Backspace）" disabled={!onUp} onClick={onUp}>
                            <Icon name="arrowUp" />
                        </button>
                        <nav className="crumbs" aria-label="位置" title={title}>
                            {crumbs.map((c, i) => (
                                <Fragment key={i}>
                                    {i > 0 && <Icon name="chevronRight" className="crumb-sep" />}
                                    {c.onClick && i < crumbs.length - 1 ? (
                                        <button className="crumb" onClick={c.onClick}>{c.label}</button>
                                    ) : (
                                        <span className="crumb current">{c.label}</span>
                                    )}
                                </Fragment>
                            ))}
                        </nav>
                    </>
                ) : (
                    <span className="pane-title" title={title}>{title}</span>
                )}
                <span className="pane-count">
                    {selection.ids.length > 1
                        ? `已選 ${selection.ids.length} / ${items.length}`
                        : files
                          ? [folders.length > 0 && `${folders.length} 個資料夾`, `${items.length} 個檔案`].filter(Boolean).join("、")
                          : `${items.length} 個條目`}
                </span>
                {files && !gallery && (
                    <div className="view-switch" role="group" aria-label="檢視">
                        <button className={icons ? "active" : ""} title="大圖示" onClick={() => onFileViewChange("icons")}>
                            <Icon name="cards" />
                        </button>
                        <button className={!icons ? "active" : ""} title="詳細資料" onClick={() => onFileViewChange("details")}>
                            <Icon name="table" />
                        </button>
                    </div>
                )}
                <button
                    className="icon-btn graph-toggle"
                    title="切換成關聯圖（以選取的條目為中心）"
                    disabled={items.length === 0}
                    onClick={onShowGraph}
                >
                    <Icon name="related" />
                </button>
                {onModeChange && !files && (
                    <div className="view-switch" role="group">
                        <button className={mode === "list" ? "active" : ""} title="清單" onClick={() => onModeChange("list")}>
                            <Icon name="table" />
                        </button>
                        <button className={mode === "gallery" ? "active" : ""} title="畫廊" onClick={() => onModeChange("gallery")}>
                            <Icon name="image" />
                        </button>
                    </div>
                )}
                {grid && (
                    <select
                        className="sort-select"
                        title="排序"
                        aria-label="排序"
                        value={cols.sort ? `${cols.sort.key}:${cols.sort.dir}` : ""}
                        onChange={(e) => {
                            const [key, dir] = e.target.value.split(":");
                            cols.setSort(key ? { key, dir: dir as "asc" | "desc" } : null);
                        }}
                    >
                        <option value="">最近修改的在前</option>
                        <option value="title:asc">{files ? "名稱" : "標題"}（A → Z）</option>
                        <option value="title:desc">{files ? "名稱" : "標題"}（Z → A）</option>
                        {cols.all
                            .filter((c) => c.sortValue || c.id === "date" || c.id === "itemType")
                            .flatMap((c) => [
                                <option key={`${c.id}d`} value={`${c.id}:desc`}>{c.label}（{c.sortValue ? "新／大的在前" : "Z → A"}）</option>,
                                <option key={`${c.id}a`} value={`${c.id}:asc`}>{c.label}（{c.sortValue ? "舊／小的在前" : "A → Z"}）</option>,
                            ])}
                    </select>
                )}
                {icons ? (
                    <input
                        className="tile-size"
                        type="range"
                        min={ICON_SIZES.min}
                        max={ICON_SIZES.max}
                        value={iconSize}
                        title="圖示大小"
                        onChange={(e) => changeIconSize(Number(e.target.value))}
                    />
                ) : gallery ? (
                    <input
                        className="tile-size"
                        type="range"
                        min={TILE_SIZES.min}
                        max={TILE_SIZES.max}
                        value={tile}
                        title="圖片大小"
                        onChange={(e) => changeTile(Number(e.target.value))}
                    />
                ) : (
                    <button
                        className="icon-btn"
                        title="顯示的欄位"
                        onClick={(e) => {
                            const r = e.currentTarget.getBoundingClientRect();
                            setColMenu({ x: r.right, y: r.bottom + 4 });
                        }}
                    >
                        <Icon name="settings" />
                    </button>
                )}
                {!files && onBibtex && (
                    <div className="new-item">
                        <button className="secondary-btn" onClick={() => setBibMenuOpen((o) => !o)} title="匯入或匯出 BibTeX（.bib）">
                            BibTeX
                        </button>
                        {bibMenuOpen && (
                            <>
                                <div className="menu-backdrop" onClick={() => setBibMenuOpen(false)} />
                                <ul className="menu">
                                    {(
                                        [
                                            ["import", "匯入 .bib 檔…", true],
                                            ["exportSelected", `匯出選取的 ${selection.ids.length} 筆…`, selection.ids.length > 0],
                                            ["copySelected", "複製選取條目的 BibTeX", selection.ids.length > 0],
                                            ["exportAll", "匯出整個文獻庫…", true],
                                        ] as const
                                    )
                                        .filter(([, , show]) => show)
                                        .map(([action, label]) => (
                                            <li
                                                key={action}
                                                className="menu-item"
                                                onClick={() => {
                                                    setBibMenuOpen(false);
                                                    onBibtex(action);
                                                }}
                                            >
                                                {label}
                                            </li>
                                        ))}
                                </ul>
                            </>
                        )}
                    </div>
                )}
                {files ? (
                    <button className="primary-btn" onClick={onAddFiles} title="選擇檔案，每個檔案成為一個條目">＋ 加入檔案</button>
                ) : (
                <div className="new-item">
                    <button className="primary-btn" onClick={() => setMenuOpen((o) => !o)}>＋ 新條目</button>
                    {menuOpen && (
                        <>
                            <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
                            <ul className="menu">
                                {groupedTypes(library)
                                    .map(([group, types]) => [group, types.filter((t) => canCreate(t.id))] as const)
                                    .filter(([, types]) => types.length > 0)
                                    .map(([group, types]) => (
                                    <li key={group} className="menu-group">
                                        <div className="menu-group-label">{GROUP_LABELS[group]}</div>
                                        <ul>
                                            {types.map((t) => (
                                                <li
                                                    key={t.id}
                                                    className="menu-item"
                                                    onClick={() => {
                                                        setMenuOpen(false);
                                                        onCreate(t.id);
                                                    }}
                                                >
                                                    <TypeIcon type={t.id} className="menu-type-icon" /> {t.label}
                                                </li>
                                            ))}
                                        </ul>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </div>
                )}
            </div>
            <div className="search">
                <input
                    ref={searchRef}
                    type="search"
                    placeholder="搜尋標題、作者、標籤、筆記卡片、附件…（Ctrl＋F）"
                    value={query}
                    onChange={(e) => onQueryChange(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Escape") {
                            e.preventDefault();
                            if (query) onQueryChange("");
                            else tableRef.current?.focus();
                        } else if (e.key === "ArrowDown" || (e.key === "Enter" && items.length > 0)) {
                            e.preventDefault();
                            if (items.length > 0 && !items.some((it) => selected.has(it.id))) onSelectionChange(single(items[0].id));
                            tableRef.current?.focus();
                        }
                    }}
                />
            </div>
            {colMenu && (
                <>
                    <div
                        className="menu-backdrop"
                        onClick={() => setColMenu(null)}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            setColMenu(null);
                        }}
                    />
                    <ul className={`menu col-menu${colMenu.atPointer ? " at-pointer" : ""}`} style={{ left: colMenu.x, top: colMenu.y }}>
                        <li className="menu-item disabled">
                            <span className="col-check"><Icon name="check" /></span>標題
                        </li>
                        {cols.all.map((c) => (
                            <li key={c.id} className="menu-item" onClick={() => cols.toggle(c.id)}>
                                <span className="col-check">{cols.visible.includes(c.id) && <Icon name="check" />}</span>
                                {c.label}
                            </li>
                        ))}
                        <li className="menu-sep" />
                        <li
                            className="menu-item"
                            onClick={() => {
                                cols.reset();
                                setColMenu(null);
                            }}
                        >
                            <span className="col-check" />還原預設
                        </li>
                    </ul>
                </>
            )}
            <div
                className={`item-table${gallery ? " gallery" : ""}${icons ? " icons" : ""}`}
                style={
                    grid
                        ? ({ "--tile": `${icons ? iconSize : tile}px` } as React.CSSProperties)
                        : ({ "--cols": gridColumns, "--row-min": `${rowMinWidth}px` } as React.CSSProperties)
                }
                ref={tableRef}
                tabIndex={0}
                onKeyDown={onKeyDown}
                onPointerDown={(e) => {
                    // Empty space below the rows (or the empty-list message) starts a selection box.
                    const t = e.target as HTMLElement;
                    if (t === e.currentTarget || t.classList.contains("empty") || t.classList.contains("gallery-grid") || t.classList.contains("file-grid")) {
                        setFolderFocus(null);
                        startMarquee(e, true);
                    }
                }}
            >
                {box && <div className="marquee" style={box} />}
                {!grid && (
                    <div
                        className="item-row item-head"
                        onContextMenu={(e) => {
                            e.preventDefault();
                            setColMenu({ x: e.clientX, y: e.clientY, atPointer: true });
                        }}
                    >
                        <span className="col-title">
                            <button
                                className="twisty"
                                title={allOpen ? "全部摺疊（-）" : "全部展開附件（+）"}
                                disabled={withAttachments.length === 0}
                                onClick={() => (allOpen ? setExpanded(new Set()) : setOpen(withAttachments, true))}
                            >
                                <Icon name={allOpen ? "chevronDown" : "chevronRight"} />
                            </button>
                            {sortHeader("title", files ? "名稱" : "標題")}
                        </span>
                        {cols.columns.map((c) => (
                            <span key={c.id} className={`col-cell col-${c.id}`}>
                                <span
                                    className="col-resize"
                                    title="拖曳調整欄寬"
                                    onPointerDown={(e) => startResize(e, c.id, c.width, c.minWidth)}
                                />
                                {sortHeader(c.id, c.id === "attachments" ? <Icon name="attachment" /> : c.label)}
                            </span>
                        ))}
                    </div>
                )}
                {items.length === 0 && folders.length === 0 && (
                    <div className="empty">
                        {query ? (
                            <>
                                <p>沒有符合「{query.trim()}」的{files ? "檔案" : "條目"}</p>
                                <button className="secondary-btn" onClick={() => { onQueryChange(""); searchRef.current?.focus(); }}>清除搜尋</button>
                            </>
                        ) : files ? (
                            <>
                                <p>沒有檔案。把檔案拖進視窗，或</p>
                                <button className="secondary-btn" onClick={onAddFiles}>＋ 加入檔案</button>
                            </>
                        ) : (
                            <>
                                <p>{gallery ? "這個畫廊還沒有圖片" : "這裡還沒有條目"}</p>
                                <button className="secondary-btn" onClick={() => setMenuOpen(true)}>＋ 新條目</button>
                            </>
                        )}
                    </div>
                )}
                {icons ? (
                    <div className="file-grid">
                        {folders.map((f) => (
                            <FolderTile
                                key={`f${f.id}`}
                                folder={f}
                                subfolders={allFolders.filter((c) => c.parentId === f.id).length}
                                highlighted={folderFocus === f.id}
                                dropTarget={dropFolderId === f.id}
                                onClick={() => {
                                    setFolderFocus(f.id);
                                    onSelectionChange(NO_SELECTION);
                                    tableRef.current?.focus();
                                }}
                                onOpen={() => onOpenFolder(f.id)}
                            />
                        ))}
                        {items.map((it) => (
                            <FileTile
                                key={it.id}
                                item={it}
                                selected={selected.has(it.id)}
                                focused={it.id === focusId && selection.ids.length > 1}
                                dragSource={draggingIds.includes(it.id)}
                                onClick={(e) => onRowClick(e, it.id)}
                                onPointerDown={(e) => onDragStart(e, it)}
                                onOpen={() => onOpenItem(it)}
                            />
                        ))}
                    </div>
                ) : gallery ? (
                    <div className="gallery-grid">
                        {items.map((it) => (
                            <GalleryTile
                                key={it.id}
                                item={it}
                                selected={selected.has(it.id)}
                                focused={it.id === focusId && selection.ids.length > 1}
                                dragSource={draggingIds.includes(it.id)}
                                onClick={(e) => onRowClick(e, it.id)}
                                onPointerDown={(e) => onDragStart(e, it)}
                                onOpen={() => {
                                    // Through the gallery's pictures, starting at this one.
                                    const pictures = items.filter((i) => i.imageId !== null);
                                    const files = pictures.map((i): ReaderFile => ({ id: i.imageId!, fileName: i.title || "圖片", kind: "image" }));
                                    if (it.imageId !== null) onRead(files, pictures.indexOf(it));
                                }}
                            />
                        ))}
                    </div>
                ) : [
                    ...(files ? folders : []).map((f) => (
                        <div
                            key={`f${f.id}`}
                            className={`item-row folder-row${folderFocus === f.id ? " selected" : ""}${dropFolderId === f.id ? " drop-target" : ""}`}
                            data-drop-collection={f.id}
                            title={`${f.name}\n雙擊開啟資料夾`}
                            onClick={() => {
                                setFolderFocus(f.id);
                                onSelectionChange(NO_SELECTION);
                            }}
                            onDoubleClick={() => onOpenFolder(f.id)}
                        >
                            <span className="col-title">
                                <span className="twisty" />
                                <Icon name={f.view === "gallery" ? "image" : "folder"} className="type-icon folder-icon" />
                                {f.name}
                            </span>
                            {cols.columns.map((c) => (
                                <span key={c.id} className={`col-cell col-${c.id} secondary`}>{c.id === "itemType" ? "資料夾" : ""}</span>
                            ))}
                        </div>
                    )),
                    ...items.map((it) => {
                    const isOpen = expanded.has(it.id) && it.attachmentCount > 0;
                    const children = attachments.get(it.id) ?? [];
                    return (
                        <Fragment key={it.id}>
                            <div
                                data-item-id={it.id}
                                className={`item-row${selected.has(it.id) ? " selected" : ""}${it.id === focusId && selection.ids.length > 1 ? " focused" : ""}${draggingIds.includes(it.id) ? " drag-source" : ""}`}
                                onClick={(e) => onRowClick(e, it.id)}
                                onPointerDown={(e) => onRowPointerDown(e, it)}
                                onDoubleClick={files ? (e) => !(e.target as HTMLElement).closest(".twisty") && onOpenItem(it) : undefined}
                            >
                                <span className="col-title">
                                    {it.attachmentCount > 0 ? (
                                        <button
                                            className="twisty"
                                            title={isOpen ? "摺疊附件" : "顯示附件"}
                                            onPointerDown={(e) => e.stopPropagation()}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setOpen([it.id], !isOpen);
                                            }}
                                        >
                                            <Icon name={isOpen ? "chevronDown" : "chevronRight"} />
                                        </button>
                                    ) : (
                                        <span className="twisty" />
                                    )}
                                    <TypeIcon type={it.itemType} className="type-icon" />
                                    {files ? marked(displayName(it), query) : it.title ? marked(it.title, query) : <em className="muted">（無標題）</em>}
                                </span>
                                {cols.columns.map((c) => (
                                    <span key={c.id} className={`col-cell col-${c.id}${c.secondary ? " secondary" : ""}`}>
                                        {c.value(it)}
                                    </span>
                                ))}
                            </div>
                            {isOpen &&
                                children.map((a) => (
                                    <div
                                        key={`a${a.id}`}
                                        className={`item-row attachment-row${a.linked ? " linked" : ""}`}
                                        title={a.linked ? `連結檔案（未複製）：${a.linkedPath}\n雙擊開啟` : "雙擊開啟"}
                                        onClick={() => onSelectionChange(single(it.id))}
                                        onDoubleClick={() => open(a)}
                                    >
                                        <span className="col-title">
                                            <Icon name={a.linked ? "link" : "attachment"} className="type-icon" />
                                            {a.fileName}
                                            {a.linked && <span className="badge">連結</span>}
                                        </span>
                                        <span className="col-size muted">{formatSize(a.size)}</span>
                                    </div>
                                ))}
                        </Fragment>
                    );
                }),
                ]}
            </div>
        </section>
    );
}

export default ItemList;
