import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../drawer/api";
import { itemType } from "../../drawer/itemTypes";
import CardEditor from "../../markdown/CardEditor";
import Markdown from "../../markdown/Markdown";
import { whiteboardApi, type CardDetail, type CardLink, type LinkedCard } from "../../whiteboard/api";

interface Props {
    cardId: number;
    /** The board being viewed, if any (to say "on this board"). */
    boardId: number | null;
    /** Bumped when the card may have changed elsewhere (e.g. edited on the board). */
    reloadKey: number;
    onClose: () => void;
    /** Saved title/content/tags; `created` are links made by `[[ ]]`. */
    onSaved: (card: CardDetail, created: CardLink[]) => void;
    /** Show the card on a board. */
    onLocate: (cardId: number, boardId: number) => void;
    /** Open another card in this panel. */
    onOpenCard: (cardId: number) => void;
    onOpenItem: (itemId: number) => void;
    onWikiLink: (target: string) => void;
    onDelete: (cardId: number) => void;
    onError: (text: string) => void;
}

const untitled = (t: string) => t || "（無標題）";
const DIR_ICONS: Record<LinkedCard["direction"], string> = { out: "→", in: "←", both: "↔", none: "—" };
const fmt = (ms: number) =>
    ms ? new Date(ms).toLocaleString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

/**
 * Heptabase-style card panel: the whole card, opened beside the board or the card library,
 * with its tags, links and cited Drawer items. Edits save when a field loses focus.
 */
function CardPanel(props: Props) {
    const { cardId, boardId, reloadKey, onClose, onSaved, onLocate, onOpenCard, onOpenItem, onWikiLink, onDelete, onError } = props;
    const [card, setCard] = useState<CardDetail | null>(null);
    const [linked, setLinked] = useState<LinkedCard[]>([]);
    const [allTags, setAllTags] = useState<string[]>([]);
    const [tagInput, setTagInput] = useState("");
    const [editing, setEditing] = useState<{ point: { x: number; y: number } | null } | null>(null);
    /** Title/content as last saved, to skip saves that change nothing. */
    const saved = useRef({ title: "", content: "" });
    const cardRef = useRef(card);
    cardRef.current = card;
    const busy = useRef(false);

    const load = useCallback(async () => {
        try {
            const [c, l, tags] = await Promise.all([
                whiteboardApi.getCard(cardId),
                whiteboardApi.listCardLinks(cardId),
                whiteboardApi.listCardTags(),
            ]);
            setCard(c);
            setLinked(l);
            setAllTags(tags.map((t) => t.name));
            saved.current = { title: c.title, content: c.content };
        } catch (e) {
            onError(errorMessage(e));
        }
    }, [cardId, onError]);

    useEffect(() => {
        setEditing(null);
        void load();
    }, [cardId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Changes made elsewhere: reload unless the user is typing here.
    useEffect(() => {
        if (reloadKey === 0 || editing || busy.current) return;
        const el = document.activeElement;
        if (el instanceof HTMLElement && el.closest(".wb-card-panel")) return;
        void load();
    }, [reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

    const save = async () => {
        const c = cardRef.current;
        if (!c || (c.title === saved.current.title && c.content === saved.current.content)) return;
        busy.current = true;
        try {
            await whiteboardApi.updateCard(c.id, c.title, c.content);
            saved.current = { title: c.title.trim(), content: c.content };
            const created = await whiteboardApi.syncWikiLinks(c.id, c.content);
            onSaved({ ...c, title: c.title.trim() }, created);
            if (created.length > 0) setLinked(await whiteboardApi.listCardLinks(c.id));
        } catch (e) {
            onError(errorMessage(e));
        } finally {
            busy.current = false;
        }
    };

    const setTags = async (tags: string[]) => {
        const c = cardRef.current;
        if (!c) return;
        try {
            const stored = await whiteboardApi.setCardTags(c.id, tags);
            const next = { ...c, tags: stored };
            setCard(next);
            onSaved(next, []);
            setAllTags((all) => [...new Set([...all, ...stored])]);
        } catch (e) {
            onError(errorMessage(e));
        }
    };

    const addTag = () => {
        const t = tagInput.trim().replace(/^#/, "");
        setTagInput("");
        if (!t || !card || card.tags.some((x) => x.toLowerCase() === t.toLowerCase())) return;
        void setTags([...card.tags, t]);
    };

    if (!card) {
        return (
            <aside className="wb-card-panel">
                <div className="wb-cp-bar">
                    <span className="muted">載入中…</span>
                    <button className="wb-cp-close" title="關閉（Esc）" onClick={onClose}>×</button>
                </div>
            </aside>
        );
    }

    const here = boardId !== null && card.boards.some((b) => b.id === boardId);

    return (
        <aside
            className="wb-card-panel"
            onKeyDown={(e) => {
                if (e.key === "Escape" && !editing && !(e.target instanceof HTMLInputElement)) onClose();
            }}
        >
            <div className="wb-cp-bar">
                <div className="wb-cp-boards">
                    {card.boards.length === 0 ? (
                        <span className="muted">不在任何白板上</span>
                    ) : (
                        card.boards.map((b) => (
                            <button
                                key={b.id}
                                className={`wb-cp-board${b.id === boardId ? " here" : ""}`}
                                title={b.id === boardId ? "在目前白板上定位" : `到白板「${b.name}」並定位`}
                                onClick={() => onLocate(card.id, b.id)}
                            >
                                🧩 {b.name}
                            </button>
                        ))
                    )}
                </div>
                <button className="danger-btn wb-cp-delete" onClick={() => onDelete(card.id)}>刪除</button>
                <button className="wb-cp-close" title="關閉（Esc）" onClick={onClose}>×</button>
            </div>

            <div className="wb-cp-body">
                <input
                    className="wb-cp-title"
                    value={card.title}
                    placeholder="標題"
                    onChange={(e) => setCard({ ...card, title: e.target.value })}
                    onBlur={() => void save()}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            setEditing({ point: null });
                        }
                    }}
                />

                <div className="wb-cp-tags">
                    {card.tags.map((t) => (
                        <span key={t} className="wb-tag removable">
                            #{t}
                            <button title="移除標籤" onClick={() => void setTags(card.tags.filter((x) => x !== t))}>×</button>
                        </span>
                    ))}
                    <input
                        className="wb-cp-tag-input"
                        list="wb-cp-tag-list"
                        placeholder="＋ 標籤"
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") addTag();
                            if (e.key === "Backspace" && !tagInput && card.tags.length > 0) {
                                void setTags(card.tags.slice(0, -1));
                            }
                        }}
                        onBlur={addTag}
                    />
                    <datalist id="wb-cp-tag-list">
                        {allTags.filter((t) => !card.tags.includes(t)).map((t) => (
                            <option key={t} value={t} />
                        ))}
                    </datalist>
                </div>

                <div
                    className={`wb-cp-content${editing ? " editing" : ""}`}
                    tabIndex={editing ? -1 : 0}
                    title={editing ? undefined : "點一下以編輯"}
                    onFocus={(e) => {
                        if (!editing && e.target === e.currentTarget) setEditing({ point: null });
                    }}
                    onClick={(e) => {
                        if (editing || (e.target as HTMLElement).closest("a, input, button")) return;
                        setEditing({ point: { x: e.clientX, y: e.clientY } });
                    }}
                >
                    {editing ? (
                        <CardEditor
                            value={card.content}
                            excludeCardId={card.id}
                            initialPoint={editing.point}
                            placeholder="內容（支援 Markdown）"
                            onChange={(v) => setCard((c) => (c ? { ...c, content: v } : c))}
                            onBlur={() => {
                                setEditing(null);
                                void save();
                            }}
                            onWikiLink={onWikiLink}
                        />
                    ) : card.content.trim() ? (
                        <Markdown source={card.content} onWikiLink={onWikiLink} />
                    ) : (
                        <div className="wb-card-placeholder">點一下開始寫（支援 Markdown）</div>
                    )}
                </div>

                <section className="wb-cp-section">
                    <h3 className="wb-section-title">
                        連結 <span className="muted">{linked.length}</span>
                    </h3>
                    {linked.length === 0 ? (
                        <p className="muted wb-hint">還沒有連結。</p>
                    ) : (
                        <ul className="wb-link-list">
                            {linked.map((l) => (
                                <li key={l.linkId}>
                                    <button className="wb-link-open" title="在面板中開啟" onClick={() => onOpenCard(l.cardId)}>
                                        <span className="wb-link-title">
                                            <span className="wb-dir">{DIR_ICONS[l.direction]}</span> {untitled(l.title)}
                                        </span>
                                        {l.note && <span className="wb-link-note-text">「{l.note}」</span>}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                {card.items.length > 0 && (
                    <section className="wb-cp-section">
                        <h3 className="wb-section-title">
                            引用的文獻 <span className="muted">{card.items.length}</span>
                        </h3>
                        <ul className="wb-link-list">
                            {card.items.map((it) => (
                                <li key={it.itemId}>
                                    <button className="wb-link-open" title="在 Drawer 中開啟" onClick={() => onOpenItem(it.itemId)}>
                                        <span className="wb-link-title">
                                            {itemType(it.itemType).icon} {untitled(it.title)}
                                        </span>
                                        <span className="wb-link-board muted">
                                            {[it.authors.split("\n")[0], it.date].filter(Boolean).join(" · ")}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                <p className="muted wb-cp-dates">
                    建立 {fmt(card.createdAt)} · 修改 {fmt(card.updatedAt)}
                    {here ? " · 在目前白板上" : ""}
                </p>
            </div>
        </aside>
    );
}

export default CardPanel;
