import { Fragment, useEffect, useRef, useState } from "react";
import { drawerApi, errorMessage, type Attachment, type ItemSummary } from "../../drawer/api";
import { GROUP_LABELS, formatSize, groupedTypes, shortAuthors } from "../../drawer/itemTypes";
import { NO_SELECTION, clickSelect, inOrder, range, single, type Selection } from "../../drawer/selection";
import { Icon, TypeIcon } from "../../icons/Icon";

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
}

const MARQUEE_THRESHOLD = 4;

function ItemList({
    title, items, selection, onSelectionChange, query, onQueryChange, onCreate, onDelete, onDragStart,
    draggingIds, onError,
}: Props) {
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
        if (e.key === "ArrowDown") moveTo(idx + 1);
        else if (e.key === "ArrowUp") moveTo(idx < 0 ? 0 : idx - 1);
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
            setBox({ top, left, width: Math.abs(cur.x - start.x), height: bottom - top });
            const hit = [...table.querySelectorAll<HTMLElement>("[data-item-id]")]
                .filter((el) => el.offsetTop < bottom && el.offsetTop + el.offsetHeight > top)
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
                <div className="new-item">
                    <button className="primary-btn" onClick={() => setMenuOpen((o) => !o)}>＋ 新條目</button>
                    {menuOpen && (
                        <>
                            <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
                            <ul className="menu">
                                {groupedTypes().map(([group, types]) => (
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
            <div
                className="item-table"
                ref={tableRef}
                tabIndex={0}
                onKeyDown={onKeyDown}
                onPointerDown={(e) => {
                    // Empty space below the rows (or the empty-list message) starts a selection box.
                    const t = e.target as HTMLElement;
                    if (t === e.currentTarget || t.classList.contains("empty")) startMarquee(e, true);
                }}
            >
                {box && <div className="marquee" style={box} />}
                <div className="item-row item-head">
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
                    <span className="col-author">作者</span>
                    <span className="col-date">日期</span>
                    <span className="col-att" title="附件"><Icon name="attachment" /></span>
                </div>
                {items.length === 0 && (
                    <div className="empty">{query ? "沒有符合的條目" : "這裡還沒有條目，按「＋ 新條目」開始"}</div>
                )}
                {items.map((it) => {
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
                                <span className="col-author">{shortAuthors(it.authors)}</span>
                                <span className="col-date">{it.date}</span>
                                <span className="col-att">{it.attachmentCount > 0 ? it.attachmentCount : ""}</span>
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
                                        <span className="col-date muted">{formatSize(a.size)}</span>
                                        <span className="col-att" />
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
