import { useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "../../drawer/api";
import { NO_SELECTION, clickSelect, inOrder, range, single, type Selection } from "../../drawer/selection";
import { Icon } from "../../icons/Icon";
import { KINDS, kindInfo, layoutMindMap, readMindMap } from "../../whiteboard/objects";
import { readTable, tableSize } from "../../whiteboard/table";
import { whiteboardApi, type BoardCard, type CardQuery, type LibraryCard, type TagCount } from "../../whiteboard/api";
import { CardFace } from "./BoardCanvas";
import { ask } from "../Feedback";

interface Props {
    /** Bumped when cards may have changed (edits in the side panel, deletes…). */
    reloadKey: number;
    /** The card open in the side panel (highlighted). */
    openCardId: number | null;
    onOpen: (cardId: number) => void;
    /** Several cards got selected: close the side panel (the bulk panel shows instead). */
    onCloseCard: () => void;
    /** "＋ 新卡片": a card on no board. */
    onCreate: () => void;
    /** Boards, for putting the selected cards on one. */
    boards: { id: number; name: string }[];
    /** Cards changed here (bulk tags, put on a board, deleted): refresh the rest of the view. */
    onChanged: () => void;
    onError: (text: string) => void;
    onInfo: (text: string) => void;
}

const untitled = (t: string) => t || "（無標題）";

type Grouping = "none" | "section";
type Filter = Required<Omit<CardQuery, "query">> & { group: Grouping };

const FILTER_KEY = "banyan.cardLibrary.filter";

function savedFilter(): Filter {
    try {
        const v = JSON.parse(localStorage.getItem(FILTER_KEY) ?? "null");
        if (v && typeof v === "object") {
            return {
                tag: typeof v.tag === "string" ? v.tag : null,
                placement: ["all", "placed", "unplaced"].includes(v.placement) ? v.placement : "all",
                sort: ["updated", "created", "title"].includes(v.sort) ? v.sort : "updated",
                group: v.group === "section" ? "section" : "none",
            };
        }
    } catch {
        /* storage unavailable */
    }
    return { tag: null, placement: "all", sort: "updated", group: "none" };
}

/** How big the card is on its board (or would be, for a card on no board). */
function faceSize(c: LibraryCard): { width: number; height: number } {
    if (c.width && c.height) return { width: c.width, height: c.height };
    if (c.kind === "table") return tableSize(readTable(c.data));
    if (c.kind === "mindmap") {
        const l = layoutMindMap(readMindMap(c.data, c.title));
        return { width: l.maxX - l.minX + 32, height: l.maxY - l.minY + 50 };
    }
    const k = KINDS[c.kind] ?? KINDS.note;
    return { width: k.width, height: k.height };
}

/** Tallest a card is drawn in the library (taller cards are scaled down further). */
const MAX_FACE_HEIGHT = 320;

/**
 * The card exactly as it looks on a board (the board's own drawing, with editing switched
 * off), scaled down to fit the tile. Drawn once the tile scrolls near the view.
 */
function Face({ card }: { card: LibraryCard }) {
    const boxRef = useRef<HTMLDivElement>(null);
    const [avail, setAvail] = useState(0);
    const [seen, setSeen] = useState(false);
    useEffect(() => {
        const el = boxRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setAvail(el.clientWidth));
        ro.observe(el);
        const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: "400px" });
        io.observe(el);
        return () => {
            ro.disconnect();
            io.disconnect();
        };
    }, []);
    const size = useMemo(() => faceSize(card), [card]);
    const scale = avail ? Math.min(1, avail / size.width, MAX_FACE_HEIGHT / size.height) : 0;
    const board: BoardCard = useMemo(
        () => ({
            id: card.id,
            kind: card.kind,
            title: card.title,
            content: card.content,
            data: card.data,
            x: 0,
            y: 0,
            width: size.width,
            height: size.height,
            collapsed: false,
            autoHeight: false,
            updatedAt: card.updatedAt,
            items: card.items,
            annotations: card.annotations,
            tags: card.tags,
        }),
        [card, size],
    );
    return (
        <div ref={boxRef} className="cl-face" style={{ height: scale ? size.height * scale : 120 }}>
            {seen && scale > 0 && (
                <div
                    className="cl-face-inner"
                    style={{ width: size.width, height: size.height, transform: `scale(${scale})`, left: (avail - size.width * scale) / 2 }}
                    aria-hidden
                    inert
                >
                    <CardFace card={board} />
                </div>
            )}
        </div>
    );
}

function Tile({
    c,
    selected,
    focused,
    opened,
    onPointerDown,
    onClick,
}: {
    c: LibraryCard;
    selected: boolean;
    /** The card last clicked (outlined while several are selected). */
    focused: boolean;
    opened: boolean;
    onPointerDown: (e: React.PointerEvent) => void;
    onClick: (e: React.MouseEvent) => void;
}) {
    // Boards the card is on outside any section, then "board › section" for each section.
    const inSection = new Set(c.sections.map((s) => s.boardId));
    const plainBoards = c.boards.filter((b) => !inSection.has(b.id));
    return (
        <div
            className={`cl-card${selected ? " selected" : ""}${focused ? " focused" : ""}${opened ? " opened" : ""}`}
            data-card-tile={c.id}
            role="option"
            aria-selected={selected}
            title={kindInfo(c.kind).label}
            onPointerDown={onPointerDown}
            onClick={onClick}
        >
            <Face card={c} />
            <span className="cl-meta muted">
                <span className="cl-boards">
                    {c.boards.length === 0 && "不在白板上"}
                    {plainBoards.map((b) => (
                        <span key={`b${b.id}`} className="cl-place">
                            <Icon name="whiteboard" /> {b.name}
                        </span>
                    ))}
                    {c.sections.map((s) => (
                        <span key={`s${s.id}`} className={`cl-place cl-section color-${s.color || "default"}`}>
                            <Icon name="section" /> {s.boardName} › {s.title || "（未命名區塊）"}
                        </span>
                    ))}
                </span>
                {c.linkCount > 0 && <span title="連結數">↔ {c.linkCount}</span>}
                {c.itemCount > 0 && <span title="引用的文獻數">📚 {c.itemCount}</span>}
                <span title="最後修改">{new Date(c.updatedAt).toLocaleDateString("zh-TW")}</span>
            </span>
        </div>
    );
}

/** Pointer travel before a press on the library becomes a selection box. */
const MARQUEE_THRESHOLD = 4;

/**
 * Heptabase-style card library: every card, searchable, filterable by tag and placement, and
 * selectable like the Drawer's item list — click, Ctrl+click, Shift+click, Ctrl+A, a selection
 * box dragged anywhere, arrow keys — with a bulk panel for several cards.
 */
function CardLibrary({ reloadKey, openCardId, onOpen, onCloseCard, onCreate, boards, onChanged, onError, onInfo }: Props) {
    const [query, setQuery] = useState("");
    const [filter, setFilterState] = useState(savedFilter);
    const [cards, setCards] = useState<LibraryCard[] | null>(null);
    const [tags, setTags] = useState<TagCount[]>([]);
    const [selection, setSelection] = useState<Selection>(NO_SELECTION);
    const [box, setBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
    const [ownReload, setOwnReload] = useState(0);
    const bodyRef = useRef<HTMLDivElement>(null);
    /** Set right after a box selection so the click that ends it does not reset the selection. */
    const suppressClick = useRef(false);

    const setFilter = (patch: Partial<Filter>) => {
        const next = { ...filter, ...patch };
        setFilterState(next);
        try {
            localStorage.setItem(FILTER_KEY, JSON.stringify(next));
        } catch {
            /* storage unavailable */
        }
    };

    const { tag, placement, sort } = filter;
    useEffect(() => {
        let stale = false;
        const t = setTimeout(() => {
            Promise.all([whiteboardApi.listCards({ tag, placement, sort, query: query.trim() }), whiteboardApi.listCardTags()]).then(
                ([list, tagList]) => {
                    if (stale) return;
                    setCards(list);
                    setTags(tagList);
                },
                (e) => onError(errorMessage(e)),
            );
        }, query ? 150 : 0);
        return () => {
            stale = true;
            clearTimeout(t);
        };
    }, [query, tag, placement, sort, reloadKey, ownReload, onError]);

    // A remembered tag that no card uses any more is dropped.
    const tagMissing = filter.tag !== null && tags.length > 0 && !tags.some((t) => t.name.toLowerCase() === filter.tag!.toLowerCase());
    useEffect(() => {
        if (tagMissing) setFilter({ tag: null });
    }, [tagMissing]); // eslint-disable-line react-hooks/exhaustive-deps

    /** Cards by section ("board › section"); a card in several sections shows in each. */
    const groups = useMemo(() => {
        if (!cards || filter.group !== "section") return null;
        const map = new Map<string, { label: string; color: string; cards: LibraryCard[] }>();
        const loose: LibraryCard[] = [];
        for (const c of cards) {
            if (c.sections.length === 0) loose.push(c);
            for (const s of c.sections) {
                const key = `${s.boardId}:${s.id}`;
                if (!map.has(key)) map.set(key, { label: `${s.boardName} › ${s.title || "（未命名區塊）"}`, color: s.color, cards: [] });
                map.get(key)!.cards.push(c);
            }
        }
        const list = [...map.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label, "zh-Hant"));
        if (loose.length) list.push(["none", { label: "不在區塊中", color: "", cards: loose }]);
        return list;
    }, [cards, filter.group]);

    /** Card ids in the order they are shown (first appearance when grouped). */
    const order = useMemo(() => {
        const list = groups ? groups.flatMap(([, g]) => g.cards) : cards ?? [];
        return [...new Set(list.map((c) => c.id))];
    }, [groups, cards]);

    // The selection only keeps cards that are still listed (after a search, a filter, a delete).
    useEffect(() => {
        if (selection.ids.length === 0) return;
        const kept = inOrder(order, selection.ids);
        if (kept.length !== selection.ids.length) {
            setSelection({ ids: kept, focus: kept.includes(selection.focus ?? -1) ? selection.focus : (kept[0] ?? null), anchor: kept.includes(selection.anchor ?? -1) ? selection.anchor : (kept[0] ?? null) });
        }
    }, [order]); // eslint-disable-line react-hooks/exhaustive-deps

    // The open card (from the board, or a link) is the selection when nothing else is.
    useEffect(() => {
        if (openCardId !== null && selection.ids.length <= 1) setSelection(single(openCardId));
    }, [openCardId]); // eslint-disable-line react-hooks/exhaustive-deps

    /** One card selected opens it in the side panel; several close the panel and show the bulk panel. */
    const select = (sel: Selection) => {
        setSelection(sel);
        if (sel.ids.length === 1) onOpen(sel.ids[0]);
        else onCloseCard();
    };

    const selected = useMemo(() => new Set(selection.ids), [selection.ids]);

    const onTileClick = (e: React.MouseEvent, id: number) => {
        if (suppressClick.current) return;
        e.stopPropagation();
        select(clickSelect(selection, order, id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }));
        bodyRef.current?.focus({ preventScroll: true });
    };

    /**
     * Selection box: drag from anywhere in the library (empty space or a card). Ctrl adds to the
     * current selection. The list scrolls when the pointer leaves it.
     */
    const startMarquee = (e: React.PointerEvent, onBlank: boolean) => {
        const body = bodyRef.current;
        if (!body || e.button !== 0) return;
        const toContent = (cx: number, cy: number) => {
            const r = body.getBoundingClientRect();
            return { x: cx - r.left + body.scrollLeft, y: cy - r.top + body.scrollTop };
        };
        const start = toContent(e.clientX, e.clientY);
        const base = e.ctrlKey || e.metaKey ? selection.ids : [];
        let pointer = { x: e.clientX, y: e.clientY };
        let active = false;
        let scrollTimer: number | undefined;
        let latest: Selection | null = null;

        const apply = () => {
            const cur = toContent(pointer.x, pointer.y);
            const top = Math.min(start.y, cur.y);
            const bottom = Math.max(start.y, cur.y);
            const left = Math.min(start.x, cur.x);
            const right = Math.max(start.x, cur.x);
            setBox({ top, left, width: right - left, height: bottom - top });
            const br = body.getBoundingClientRect();
            const hit = [...body.querySelectorAll<HTMLElement>("[data-card-tile]")]
                .filter((el) => {
                    const r = el.getBoundingClientRect();
                    const t = r.top - br.top + body.scrollTop;
                    const l = r.left - br.left + body.scrollLeft;
                    return t < bottom && t + r.height > top && l < right && l + r.width > left;
                })
                .map((el) => Number(el.dataset.cardTile));
            const ids = inOrder(order, [...base, ...hit]);
            latest = {
                ids,
                focus: hit.length ? (cur.y >= start.y ? hit[hit.length - 1] : hit[0]) : (base[base.length - 1] ?? null),
                anchor: hit.length ? (cur.y >= start.y ? hit[0] : hit[hit.length - 1]) : selection.anchor,
            };
            setSelection(latest);
        };
        const autoScroll = () => {
            const r = body.getBoundingClientRect();
            const step = pointer.y < r.top + 16 ? -14 : pointer.y > r.bottom - 16 ? 14 : 0;
            if (step) {
                body.scrollTop += step;
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
                // Settle the side panel for what the box selected.
                if (latest) select(latest);
            } else if (onBlank && !(e.ctrlKey || e.metaKey)) {
                select(NO_SELECTION); // a plain click on empty space clears the selection
            }
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        bodyRef.current?.focus({ preventScroll: true });
    };

    /** The tile next to `id` in a direction, by where the tiles are drawn. */
    const neighbour = (id: number, key: string): number | null => {
        const body = bodyRef.current;
        if (!body) return null;
        const i = order.indexOf(id);
        if (key === "ArrowLeft") return order[i - 1] ?? null;
        if (key === "ArrowRight") return order[i + 1] ?? null;
        const el = body.querySelector<HTMLElement>(`[data-card-tile="${id}"]`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const down = key === "ArrowDown";
        let best: { id: number; d: number } | null = null;
        for (const t of body.querySelectorAll<HTMLElement>("[data-card-tile]")) {
            const tr = t.getBoundingClientRect();
            const dy = down ? tr.top - r.bottom : r.top - tr.bottom;
            if (dy < -1) continue;
            const d = dy * 4 + Math.abs(tr.left + tr.width / 2 - cx);
            if (!best || d < best.d) best = { id: Number(t.dataset.cardTile), d };
        }
        return best?.id ?? null;
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if ((e.target as HTMLElement).closest("input, select, textarea")) return;
        if ((e.key === "a" || e.key === "A") && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            select({ ids: [...order], focus: selection.focus ?? order[0] ?? null, anchor: order[0] ?? null });
        } else if (e.key === "Escape" && selection.ids.length > 1) {
            e.preventDefault();
            e.stopPropagation();
            select(single(selection.focus)); // keep only the card last clicked, like the Drawer
        } else if (e.key === "Delete" && selection.ids.length > 0) {
            e.preventDefault();
            void deleteSelected();
        } else if (e.key.startsWith("Arrow") && order.length) {
            e.preventDefault();
            const from = selection.focus ?? order[0];
            const to = selection.focus === null ? from : neighbour(from, e.key);
            if (to === null) return;
            select(e.shiftKey && selection.anchor !== null ? { ids: range(order, selection.anchor, to), focus: to, anchor: selection.anchor } : single(to));
            bodyRef.current?.querySelector(`[data-card-tile="${to}"]`)?.scrollIntoView({ block: "nearest" });
        }
    };

    // ---------- several cards at once ----------

    const chosen = useMemo(() => (cards ?? []).filter((c) => selected.has(c.id)), [cards, selected]);

    const afterBulk = () => {
        setOwnReload((n) => n + 1);
        onChanged();
    };

    const deleteSelected = async () => {
        const ids = selection.ids;
        if (ids.length === 0) return;
        const name = ids.length > 1 ? `這 ${ids.length} 張卡片` : `卡片「${untitled(chosen[0]?.title ?? "")}」`;
        if (!(await ask({ title: `完全刪除${name}？`, message: "會從所有白板和卡片庫中消失，連結也會一併移除，無法復原。", confirm: "完全刪除", danger: true }))) return;
        try {
            await whiteboardApi.deleteCards(ids);
            select(NO_SELECTION);
            onInfo(`已刪除 ${ids.length} 張卡片`);
            afterBulk();
        } catch (e) {
            onError(errorMessage(e));
        }
    };

    const tagAll = async (name: string) => {
        const t = name.trim().replace(/^#/, "");
        if (!t) return;
        try {
            for (const c of chosen) {
                if (!c.tags.some((x) => x.toLowerCase() === t.toLowerCase())) await whiteboardApi.setCardTags(c.id, [...c.tags, t]);
            }
            onInfo(`已為 ${chosen.length} 張卡片加上 #${t}`);
            afterBulk();
        } catch (e) {
            onError(errorMessage(e));
        }
    };

    const untagAll = async (name: string) => {
        try {
            for (const c of chosen) {
                if (c.tags.some((x) => x.toLowerCase() === name.toLowerCase())) {
                    await whiteboardApi.setCardTags(c.id, c.tags.filter((x) => x.toLowerCase() !== name.toLowerCase()));
                }
            }
            afterBulk();
        } catch (e) {
            onError(errorMessage(e));
        }
    };

    const putOnBoard = async (boardId: number) => {
        const todo = chosen.filter((c) => !c.boards.some((b) => b.id === boardId));
        try {
            for (const c of todo) await whiteboardApi.addCardToBoard(boardId, c.id);
            const skipped = chosen.length - todo.length;
            const name = boards.find((b) => b.id === boardId)?.name ?? "";
            onInfo(`已把 ${todo.length} 張卡片放到「${name}」${skipped ? `（${skipped} 張原本就在上面）` : ""}`);
            afterBulk();
        } catch (e) {
            onError(errorMessage(e));
        }
    };

    const grid = (list: LibraryCard[]) => (
        <div className="cl-grid">
            {list.map((c) => (
                <Tile
                    key={c.id}
                    c={c}
                    selected={selected.has(c.id)}
                    focused={selection.ids.length > 1 && selection.focus === c.id}
                    opened={c.id === openCardId}
                    onPointerDown={(e) => startMarquee(e, false)}
                    onClick={(e) => onTileClick(e, c.id)}
                />
            ))}
        </div>
    );

    return (
        <div className={`card-library${selection.ids.length > 1 ? " with-bulk" : ""}`}>
            <div className="cl-toolbar">
                <input
                    className="wb-search cl-search"
                    placeholder="搜尋卡片標題或內容…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && setQuery("")}
                />
                <div className="wb-seg" role="radiogroup" aria-label="位置">
                    {(
                        [
                            ["all", "全部"],
                            ["placed", "在白板上"],
                            ["unplaced", "不在白板上"],
                        ] as const
                    ).map(([v, label]) => (
                        <button key={v} className={filter.placement === v ? "active" : ""} onClick={() => setFilter({ placement: v })}>
                            {label}
                        </button>
                    ))}
                </div>
                <select className="cl-sort" value={filter.sort} onChange={(e) => setFilter({ sort: e.target.value as Filter["sort"] })} title="排序">
                    <option value="updated">最近修改</option>
                    <option value="created">最近建立</option>
                    <option value="title">標題</option>
                </select>
                <select className="cl-sort" value={filter.group} onChange={(e) => setFilter({ group: e.target.value as Grouping })} title="分組">
                    <option value="none">不分組</option>
                    <option value="section">依區塊分組</option>
                </select>
                <span className="muted cl-count">
                    {cards ? (selection.ids.length > 1 ? `已選 ${selection.ids.length} / ${cards.length} 張` : `${cards.length} 張`) : "載入中…"}
                </span>
                <button className="primary-btn" onClick={onCreate}>＋ 新卡片</button>
            </div>

            <div className="cl-tags">
                <button className={`wb-tag cl-tag${filter.tag === null ? " active" : ""}`} onClick={() => setFilter({ tag: null })}>
                    全部標籤
                </button>
                {tags.map((t) => (
                    <button
                        key={t.name}
                        className={`wb-tag cl-tag${filter.tag?.toLowerCase() === t.name.toLowerCase() ? " active" : ""}`}
                        onClick={() => setFilter({ tag: filter.tag?.toLowerCase() === t.name.toLowerCase() ? null : t.name })}
                    >
                        #{t.name} <span className="cl-tag-count">{t.count}</span>
                    </button>
                ))}
            </div>

            <div className="cl-main">
                <div
                    ref={bodyRef}
                    className="cl-body"
                    tabIndex={0}
                    role="listbox"
                    aria-multiselectable
                    onKeyDown={onKeyDown}
                    onPointerDown={(e) => {
                        if (!(e.target as HTMLElement).closest("[data-card-tile]")) startMarquee(e, true);
                    }}
                >
                    {cards?.length === 0 && (
                        <p className="muted cl-empty">{query || filter.tag || filter.placement !== "all" ? "沒有符合的卡片" : "還沒有卡片"}</p>
                    )}
                    {groups
                        ? groups.map(([key, g]) => (
                              <section key={key} className="cl-group">
                                  <h3 className={`cl-group-title color-${g.color || "default"}`}>
                                      {key !== "none" && <Icon name="section" />} {g.label} <span className="muted">{g.cards.length}</span>
                                  </h3>
                                  {grid(g.cards)}
                              </section>
                          ))
                        : cards && grid(cards)}
                    {box && <div className="marquee" style={box} />}
                </div>

                {selection.ids.length > 1 && (
                    <BulkCards
                        cards={chosen}
                        boards={boards}
                        allTags={tags.map((t) => t.name)}
                        onTag={(t) => void tagAll(t)}
                        onUntag={(t) => void untagAll(t)}
                        onPutOnBoard={(b) => void putOnBoard(b)}
                        onDelete={() => void deleteSelected()}
                        onClear={() => select(single(selection.focus))}
                    />
                )}
            </div>
        </div>
    );
}

const PREVIEW = 6;

/** Right of the library when several cards are selected (like the Drawer's bulk edit). */
function BulkCards({
    cards,
    boards,
    allTags,
    onTag,
    onUntag,
    onPutOnBoard,
    onDelete,
    onClear,
}: {
    cards: LibraryCard[];
    boards: { id: number; name: string }[];
    allTags: string[];
    onTag: (tag: string) => void;
    onUntag: (tag: string) => void;
    onPutOnBoard: (boardId: number) => void;
    onDelete: () => void;
    onClear: () => void;
}) {
    const [tagInput, setTagInput] = useState("");
    const [board, setBoard] = useState<number | "">("");
    const n = cards.length;
    // Tags on the selected cards, with how many of them have each.
    const tagCounts = useMemo(() => {
        const m = new Map<string, { name: string; count: number }>();
        for (const c of cards) {
            for (const t of c.tags) {
                const k = t.toLowerCase();
                m.set(k, { name: m.get(k)?.name ?? t, count: (m.get(k)?.count ?? 0) + 1 });
            }
        }
        return [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    }, [cards]);
    const kinds = useMemo(() => {
        const m = new Map<string, number>();
        for (const c of cards) m.set(c.kind, (m.get(c.kind) ?? 0) + 1);
        return [...m.entries()];
    }, [cards]);
    const addTag = () => {
        if (!tagInput.trim()) return;
        onTag(tagInput);
        setTagInput("");
    };
    return (
        <aside className="cl-bulk">
            <div className="cl-bulk-head">
                <span className="cl-bulk-title">已選取 {n} 張卡片</span>
                <button className="small-btn" onClick={onClear} title="只保留最後點選的卡片（Esc）">取消多選</button>
            </div>
            <ul className="cl-bulk-list">
                {cards.slice(0, PREVIEW).map((c) => (
                    <li key={c.id}>
                        <Icon name={kindInfo(c.kind).icon} /> {untitled(c.title)}
                    </li>
                ))}
                {n > PREVIEW && <li className="muted">還有 {n - PREVIEW} 張</li>}
            </ul>
            <p className="muted cl-bulk-kinds">{kinds.map(([k, count]) => `${kindInfo(k).label} ${count}`).join(" · ")}</p>

            <section className="cl-bulk-section">
                <h3 className="wb-section-title">標籤</h3>
                {tagCounts.length > 0 && (
                    <div className="cl-bulk-tags">
                        {tagCounts.map((t) => (
                            <span key={t.name} className="wb-tag removable">
                                #{t.name} <span className="muted">{t.count === n ? "全部" : `${t.count}/${n}`}</span>
                                <button title="從選取的卡片移除" onClick={() => onUntag(t.name)}>×</button>
                            </span>
                        ))}
                    </div>
                )}
                <div className="cl-bulk-form">
                    <input
                        className="wb-search"
                        list="cl-bulk-tag-list"
                        placeholder="為全部加上標籤…"
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addTag()}
                    />
                    <datalist id="cl-bulk-tag-list">
                        {allTags.map((t) => (
                            <option key={t} value={t} />
                        ))}
                    </datalist>
                    <button className="small-btn" disabled={!tagInput.trim()} onClick={addTag}>加上</button>
                </div>
            </section>

            <section className="cl-bulk-section">
                <h3 className="wb-section-title">放到白板</h3>
                <div className="cl-bulk-form">
                    <select className="cl-sort" value={board} onChange={(e) => setBoard(e.target.value ? Number(e.target.value) : "")}>
                        <option value="">選擇白板…</option>
                        {boards.map((b) => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                    </select>
                    <button className="small-btn" disabled={board === ""} onClick={() => board !== "" && onPutOnBoard(board)}>放上</button>
                </div>
            </section>

            <button className="danger-btn cl-bulk-delete" onClick={onDelete}>完全刪除 {n} 張卡片（Delete）</button>
        </aside>
    );
}

export default CardLibrary;
