import { Fragment, useEffect, useRef, useState } from "react";
import { drawerApi, errorMessage, type Attachment, type CollectionView, type ItemSummary } from "../../drawer/api";
import { GROUP_LABELS, formatSize, groupedTypes } from "../../drawer/itemTypes";
import { NO_SELECTION, clickSelect, inOrder, range, single, type Selection } from "../../drawer/selection";
import { COLUMNS, TITLE_MIN_WIDTH, useColumns } from "../../drawer/columns";
import { Icon, TypeIcon } from "../../icons/Icon";
import GalleryTile from "./GalleryTile";

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
}

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
    title, items, selection, onSelectionChange, query, onQueryChange, onCreate, onDelete, onDragStart,
    draggingIds, onError, mode, onModeChange, canCreate,
}: Props) {
    const gallery = mode === "gallery";
    const cols = useColumns();
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
        const tiles = [...(tableRef.current?.querySelectorAll<HTMLElement>(".gallery-tile") ?? [])];
        return Math.max(1, tiles.filter((t) => t.offsetTop === tiles[0]?.offsetTop).length);
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
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
        const step = gallery ? galleryColumns() : 1;
        if (gallery && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
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
                .filter((el) => !gallery || (el.offsetLeft < right && el.offsetLeft + el.offsetWidth > left))
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
        onSelectionChange(clickSelect(selection, order, id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }));
    };

    const open = (a: Attachment) => drawerApi.openAttachment(a.id).catch((e) => onError(errorMessage(e)));
    const allOpen = withAttachments.length > 0 && withAttachments.every((id) => expanded.has(id));

    return (
        <section className="drawer-pane drawer-list">
            <div className="pane-header">
                <span className="pane-title" title={title}>{title}</span>
                <span className="pane-count">
                    {selection.ids.length > 1 ? `已選 ${selection.ids.length} / ${items.length}` : `${items.length} 個條目`}
                </span>
                {onModeChange && (
                    <div className="view-switch" role="group">
                        <button className={mode === "list" ? "active" : ""} title="清單" onClick={() => onModeChange("list")}>
                            <Icon name="table" />
                        </button>
                        <button className={mode === "gallery" ? "active" : ""} title="畫廊" onClick={() => onModeChange("gallery")}>
                            <Icon name="image" />
                        </button>
                    </div>
                )}
                {gallery ? (
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
                <div className="new-item">
                    <button className="primary-btn" onClick={() => setMenuOpen((o) => !o)}>＋ 新條目</button>
                    {menuOpen && (
                        <>
                            <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
                            <ul className="menu">
                                {groupedTypes()
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
            </div>
            <div className="search">
                <input
                    type="search"
                    placeholder="搜尋標題、作者、標籤、筆記卡片、附件…"
                    value={query}
                    onChange={(e) => onQueryChange(e.target.value)}
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
                        {COLUMNS.map((c) => (
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
                className={`item-table${gallery ? " gallery" : ""}`}
                style={
                    gallery
                        ? ({ "--tile": `${tile}px` } as React.CSSProperties)
                        : ({ "--cols": gridColumns, "--row-min": `${rowMinWidth}px` } as React.CSSProperties)
                }
                ref={tableRef}
                tabIndex={0}
                onKeyDown={onKeyDown}
                onPointerDown={(e) => {
                    // Empty space below the rows (or the empty-list message) starts a selection box.
                    const t = e.target as HTMLElement;
                    if (t === e.currentTarget || t.classList.contains("empty") || t.classList.contains("gallery-grid")) {
                        startMarquee(e, true);
                    }
                }}
            >
                {box && <div className="marquee" style={box} />}
                {!gallery && (
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
                            標題
                        </span>
                        {cols.columns.map((c) => (
                            <span key={c.id} className={`col-cell col-${c.id}`}>
                                <span
                                    className="col-resize"
                                    title="拖曳調整欄寬"
                                    onPointerDown={(e) => startResize(e, c.id, c.width, c.minWidth)}
                                />
                                {c.id === "attachments" ? <span title="附件"><Icon name="attachment" /></span> : c.label}
                            </span>
                        ))}
                    </div>
                )}
                {items.length === 0 && (
                    <div className="empty">{query ? "沒有符合的條目" : "沒有條目"}</div>
                )}
                {gallery ? (
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
                                    if (it.imageId !== null) drawerApi.openAttachment(it.imageId).catch((e) => onError(errorMessage(e)));
                                }}
                            />
                        ))}
                    </div>
                ) : items.map((it) => {
                    const isOpen = expanded.has(it.id) && it.attachmentCount > 0;
                    const children = attachments.get(it.id) ?? [];
                    return (
                        <Fragment key={it.id}>
                            <div
                                data-item-id={it.id}
                                className={`item-row${selected.has(it.id) ? " selected" : ""}${it.id === focusId && selection.ids.length > 1 ? " focused" : ""}${draggingIds.includes(it.id) ? " drag-source" : ""}`}
                                onClick={(e) => onRowClick(e, it.id)}
                                onPointerDown={(e) => onRowPointerDown(e, it)}
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
                                    {it.title || <em className="muted">（無標題）</em>}
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
                })}
            </div>
        </section>
    );
}

export default ItemList;
