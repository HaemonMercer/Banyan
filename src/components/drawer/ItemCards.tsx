import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../icons/Icon";
import { errorMessage } from "../../drawer/api";
import Markdown from "../../markdown/Markdown";
import CardEditor from "../../markdown/CardEditor";
import SectionHeader from "./SectionHeader";
import { whiteboardApi, type CardHit, type ItemCard, type Whiteboard } from "../../whiteboard/api";
import { AUTOSAVE_MS, serial } from "../../whiteboard/autosave";

interface Props {
    itemId: number;
    /** Opens the card in Whiteboard. */
    onOpenCard: (cardId: number, boardId: number) => void;
    /** Card text or links changed (the list may need to re-run a search). */
    onChanged: () => void;
    onError: (message: string) => void;
    onInfo: (message: string) => void;
    /** Section folded (controlled by the detail pane). */
    collapsed: boolean;
    onToggle: () => void;
}

const untitled = (t: string) => t || "（無標題）";

/**
 * Note cards about an item, Heptabase-style: notes are cards that refer to the item, can be
 * edited here, and can be put on any whiteboard.
 */
function ItemCards({ itemId, onOpenCard, onChanged, onError, onInfo, collapsed, onToggle }: Props) {
    const [cards, setCards] = useState<ItemCard[]>([]);
    /** Title + content of each card as last saved. */
    const saved = useRef<Record<number, string>>({});
    /** Cards whose saved text has not had its `[[ ]]` links synced yet. */
    const unsynced = useRef(new Set<number>());
    const cardsRef = useRef<ItemCard[]>([]);
    const queueSave = useRef(serial()).current;
    const [boards, setBoards] = useState<Whiteboard[]>([]);
    const [hits, setHits] = useState<CardHit[] | null>(null);
    const [query, setQuery] = useState("");
    /** The one note card opened for editing; the others show only their title. */
    const [openId, setOpenId] = useState<number | null>(null);
    /**
     * The open card's content is rendered Markdown until clicked; then the WYSIWYG editor opens
     * with the caret at `point` (null = end of the text).
     */
    const [editing, setEditing] = useState<{ point: { x: number; y: number } | null } | null>(null);

    /** `[[title]]` in a note: open the card with that title in Whiteboard. */
    const openWikiLink = async (target: string) => {
        const key = target.trim().toLowerCase();
        try {
            const hits = await whiteboardApi.searchCards(target, null);
            const hit = hits.find((h) => h.title.trim().toLowerCase() === key);
            if (!hit) onInfo(`找不到標題為「${target}」的卡片`);
            else if (hit.boardId === null) onInfo(`「${hit.title}」不在任何白板上`);
            else onOpenCard(hit.cardId, hit.boardId);
        } catch (e) {
            onError(errorMessage(e));
        }
    };

    const load = useCallback(async () => {
        try {
            const [list, bs] = await Promise.all([
                whiteboardApi.listItemCards(itemId),
                whiteboardApi.listWhiteboards(),
            ]);
            setCards(list);
            saved.current = Object.fromEntries(list.map((c) => [c.cardId, c.title + "\u0000" + c.content]));
            setBoards(bs);
        } catch (e) {
            onError(errorMessage(e));
        }
    }, [itemId, onError]);

    useEffect(() => {
        load();
    }, [load]);

    // Card search for "連結已有卡片".
    useEffect(() => {
        if (hits === null) return;
        let stale = false;
        const t = setTimeout(() => {
            whiteboardApi.searchCards(query, null).then(
                (h) => !stale && setHits(h),
                (e) => onError(errorMessage(e)),
            );
        }, query ? 150 : 0);
        return () => {
            stale = true;
            clearTimeout(t);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query, hits === null, onError]);

    const edit = (cardId: number, title: string, content: string) =>
        setCards((list) => list.map((c) => (c.cardId === cardId ? { ...c, title, content } : c)));

    cardsRef.current = cards;

    /** Writes a card's text if it changed (autosave); `[[ ]]` links wait for `save`. */
    const persist = (cardId: number) =>
        queueSave(async () => {
            const c = cardsRef.current.find((x) => x.cardId === cardId);
            if (!c) return;
            const key = c.title + "\u0000" + c.content;
            if (saved.current[cardId] === key) return;
            try {
                await whiteboardApi.updateCard(cardId, c.title, c.content);
                saved.current[cardId] = key;
                unsynced.current.add(cardId);
            } catch (e) {
                onError(errorMessage(e));
            }
        });

    // Autosave the open card shortly after typing pauses.
    const open = cards.find((c) => c.cardId === openId);
    useEffect(() => {
        if (!open || saved.current[open.cardId] === open.title + "\u0000" + open.content) return;
        const t = window.setTimeout(() => void persist(open.cardId), AUTOSAVE_MS);
        return () => window.clearTimeout(t);
    }, [open?.cardId, open?.title, open?.content]); // eslint-disable-line react-hooks/exhaustive-deps

    /** The editor closed: save what is left and make the `[[ ]]` links. */
    const save = async (c: ItemCard) => {
        await persist(c.cardId);
        if (!unsynced.current.has(c.cardId)) return;
        unsynced.current.delete(c.cardId);
        const latest = cardsRef.current.find((x) => x.cardId === c.cardId) ?? c;
        try {
            const created = await whiteboardApi.syncWikiLinks(c.cardId, latest.content);
            if (created.length > 0) onInfo(`依 [[ ]] 建立了 ${created.length} 條連結`);
            onChanged();
        } catch (e) {
            onError(errorMessage(e));
        }
    };

    const run = async (fn: () => Promise<unknown>) => {
        try {
            await fn();
            await load();
            onChanged();
        } catch (e) {
            onError(errorMessage(e));
        }
    };

    const create = () =>
        run(async () => {
            const c = await whiteboardApi.createItemCard(itemId);
            setOpenId(c.cardId);
            setEditing({ point: null }); // the editor focuses itself
        });

    const linkedIds = new Set(cards.map((c) => c.cardId));

    return (
        <section className="detail-section item-cards">
            <SectionHeader title="筆記卡片" count={cards.length} collapsed={collapsed} onToggle={onToggle}>
                <button
                    className="small-btn"
                    onClick={() => {
                        if (collapsed) onToggle();
                        create();
                    }}
                >＋ 新增</button>
                <button
                    className="small-btn"
                    onClick={() => {
                        if (collapsed) onToggle();
                        setHits((h) => (h === null ? [] : null));
                    }}
                >
                    {hits === null ? "連結已有卡片" : "收起"}
                </button>
            </SectionHeader>
            <div hidden={collapsed}>

            {hits !== null && (
                <div className="note-search">
                    <input
                        autoFocus
                        placeholder="搜尋卡片標題或內容…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Escape") {
                                setHits(null);
                                setQuery("");
                            }
                        }}
                    />
                    <ul>
                        {hits.length === 0 && <li className="muted note-search-empty">沒有符合的卡片</li>}
                        {hits.map((h) => {
                            const done = linkedIds.has(h.cardId);
                            return (
                                <li key={h.cardId}>
                                    <button
                                        disabled={done}
                                        onClick={() => run(() => whiteboardApi.linkCardItem(h.cardId, itemId))}
                                    >
                                        <span className="note-search-title">{untitled(h.title)}</span>
                                        <span className="muted">
                                            {done ? "已連結" : h.boards.length > 0 ? h.boards.join("、") : "不在白板上"}
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}


            <ul className="note-cards">
                {cards.map((c) =>
                    openId !== c.cardId ? (
                        <li key={c.cardId} className="note-row">
                            <button
                                className="note-row-title"
                                title={c.content ? c.content.slice(0, 200) : "（沒有內容）"}
                                onClick={() => {
                                    setOpenId(c.cardId);
                                    setEditing(null);
                                }}
                            >
                                <Icon name="note" className="wb-row-icon" /> {untitled(c.title)}
                            </button>
                            {c.boardId !== null && (
                                <button
                                    className="note-row-board"
                                    title={`在白板中開啟（${c.boards.join("、")}）`}
                                    onClick={() => onOpenCard(c.cardId, c.boardId!)}
                                >
                                    <Icon name="board" />
                                </button>
                            )}
                        </li>
                    ) : (
                    <li key={c.cardId} className="note-card">
                        <input
                            className="note-card-title"
                            value={c.title}
                            placeholder="標題"
                            onChange={(e) => edit(c.cardId, e.target.value, c.content)}
                            onBlur={() => save(c)}
                        />
                        <div
                            className={`note-card-md${editing ? " editing" : ""}`}
                            data-note-content={c.cardId}
                            tabIndex={editing ? -1 : 0}
                            title={editing ? undefined : "點一下以編輯"}
                            onFocus={(e) => {
                                if (!editing && e.target === e.currentTarget) setEditing({ point: null });
                            }}
                            onClick={(e) => {
                                if (editing || (e.target as HTMLElement).closest("a, input")) return;
                                setEditing({ point: { x: e.clientX, y: e.clientY } });
                            }}
                        >
                            {editing ? (
                                <CardEditor
                                    value={c.content}
                                    excludeCardId={c.cardId}
                                    initialPoint={editing.point}
                                    placeholder="寫下關於這個條目的想法…（支援 Markdown）"
                                    onChange={(v) => edit(c.cardId, c.title, v)}
                                    onBlur={() => {
                                        setEditing(null);
                                        save(c);
                                    }}
                                    onWikiLink={(t) => void openWikiLink(t)}
                                />
                            ) : c.content.trim() ? (
                                <Markdown source={c.content} onWikiLink={(t) => void openWikiLink(t)} />
                            ) : (
                                <div className="note-card-placeholder">寫下關於這個條目的想法…（支援 Markdown）</div>
                            )}
                        </div>
                        <div className="note-card-footer">
                            {c.boardId !== null ? (
                                <button
                                    className="note-board"
                                    title="在白板中開啟"
                                    onClick={async () => {
                                        await save(c);
                                        onOpenCard(c.cardId, c.boardId!);
                                    }}
                                >
                                    <Icon name="board" /> {c.boards.join("、")}
                                </button>
                            ) : boards.length > 0 ? (
                                <select
                                    className="note-add-board"
                                    value=""
                                    onChange={(e) => {
                                        const b = Number(e.target.value);
                                        if (!b) return;
                                        run(async () => {
                                            await save(c);
                                            await whiteboardApi.addCardToBoard(b, c.cardId);
                                            onInfo(`已放到「${boards.find((x) => x.id === b)?.name}」`);
                                        });
                                    }}
                                >
                                    <option value="">🧩 放到白板…</option>
                                    {boards.map((b) => (
                                        <option key={b.id} value={b.id}>{b.name}</option>
                                    ))}
                                </select>
                            ) : (
                                <span className="muted">不在白板上</span>
                            )}
                            <button
                                className="note-unlink"
                                title="取消這張卡片和條目的連結（卡片保留）"
                                onClick={() => run(() => whiteboardApi.unlinkCardItem(c.cardId, itemId))}
                            >
                                取消連結
                            </button>
                            <button
                                className="note-collapse"
                                title="收合，只顯示名稱"
                                onClick={async () => {
                                    await save(c);
                                    setOpenId(null);
                                }}
                            >
                                收合
                            </button>
                        </div>
                    </li>
                    ),
                )}
            </ul>
            </div>
        </section>
    );
}

export default ItemCards;
