import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../icons/Icon";
import { drawerApi, errorMessage, type ItemSummary } from "../../drawer/api";
import { itemType } from "../../drawer/itemTypes";
import { summarizeMarkdown } from "../../markdown";
import { whiteboardApi, type BoardCard, type CardHit, type LinkedCard } from "../../whiteboard/api";

/** What is being dragged from the library list onto the board. */
export type DragPayload = { kind: "card"; id: number; title: string } | { kind: "item"; id: number; title: string };

interface Props {
    boardId: number;
    /** Cards on the open board (to mark them in the list). */
    onBoard: Set<number>;
    selectedCard: BoardCard | null;
    /** Bumped whenever cards, links or titles may have changed. */
    reloadKey: number;
    onStartDrag: (e: React.PointerEvent, payload: DragPayload) => void;
    onOpenCard: (cardId: number, boardId: number | null) => void;
    onUnlink: (otherId: number) => Promise<void>;
    onDelete: (id: number) => void;
    onOpenItem: (itemId: number) => void;
    /** The selected card's Drawer items changed; reload them. */
    onItemsChanged: () => void;
    onError: (text: string) => void;
    /** Replaces the selected-card section (e.g. the editor of a selected link). */
    bottom?: React.ReactNode;
}

const untitled = (t: string) => t || "（無標題）";

/** A few lines of the card's text under its title (plain-text summary of the Markdown). */
function CardPreview({ content }: { content: string }) {
    const text = useMemo(() => (content.trim() ? summarizeMarkdown(content, 160) : ""), [content]);
    return text ? (
        <span className="wb-lib-preview">{text}</span>
    ) : (
        <span className="wb-lib-preview empty">（沒有內容）</span>
    );
}
/** How a link looks from the selected card. */
const DIR_ICONS: Record<LinkedCard["direction"], string> = { out: "→", in: "←", both: "↔", none: "—" };
const DIR_TITLES: Record<LinkedCard["direction"], string> = {
    out: "這張卡片指向它",
    in: "它指向這張卡片",
    both: "雙向箭頭",
    none: "無方向",
};
const firstAuthor = (a: string) => a.split("\n")[0] ?? "";

/**
 * Right pane. Top: every card and Drawer item, to drag onto the board (onto a card = link /
 * cite; onto empty space = place there). Bottom: the selected card's links and items.
 */
function WhiteboardSidebar(props: Props) {
    return (
        <aside className="drawer-pane wb-panel">
            <Library {...props} />
            {props.bottom ?? <SelectedCard {...props} />}
        </aside>
    );
}

function Library({ boardId, onBoard, reloadKey, onStartDrag, onOpenCard, onOpenItem, onError }: Props) {
    const [tab, setTab] = useState<"cards" | "items">("cards");
    const [query, setQuery] = useState("");
    const [cards, setCards] = useState<CardHit[]>([]);
    const [items, setItems] = useState<ItemSummary[]>([]);

    useEffect(() => {
        let stale = false;
        const t = setTimeout(() => {
            const q = query.trim();
            if (tab === "cards") {
                whiteboardApi.searchCards(q, null).then(
                    (h) => !stale && setCards(h),
                    (e) => onError(errorMessage(e)),
                );
            } else {
                drawerApi.listItems({ query: q }).then(
                    (h) => !stale && setItems(h.slice(0, 100)),
                    (e) => onError(errorMessage(e)),
                );
            }
        }, query ? 150 : 0);
        return () => {
            stale = true;
            clearTimeout(t);
        };
    }, [tab, query, reloadKey, onError]);

    const where = (h: CardHit) =>
        onBoard.has(h.cardId) ? "在這個白板" : h.boards.length > 0 ? h.boards.join("、") : "不在白板上";

    return (
        <section className="wb-library">
            <div className="wb-tabs" role="tablist">
                <button role="tab" aria-selected={tab === "cards"} className={tab === "cards" ? "active" : ""} onClick={() => setTab("cards")}>
                    <Icon name="note" /> 卡片
                </button>
                <button role="tab" aria-selected={tab === "items"} className={tab === "items" ? "active" : ""} onClick={() => setTab("items")}>
                    <Icon name="library" /> 文獻
                </button>
            </div>
            <input
                className="wb-search"
                placeholder={tab === "cards" ? "搜尋卡片標題或內容…" : "搜尋 Drawer 條目…"}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            />
            <p className="muted wb-hint">
                {tab === "cards"
                    ? "拖到卡片上：建立連結（箭頭指向那張卡片）。拖到空白處：放到白板上。點一下開啟。"
                    : "拖到卡片上：引用這筆文獻。拖到空白處：建立引用它的筆記卡片。雙擊在 Drawer 中開啟。"}
            </p>
            <ul className="wb-lib-list">
                {tab === "cards" &&
                    (cards.length === 0 ? (
                        <li className="muted wb-hit-empty">{query ? "沒有符合的卡片" : "還沒有卡片"}</li>
                    ) : (
                        cards.map((h) => (
                            <li
                                key={h.cardId}
                                className={`wb-lib-row${onBoard.has(h.cardId) ? " here" : ""}`}
                                data-lib-card={h.cardId}
                                title="拖曳到白板或卡片上"
                                onPointerDown={(e) => onStartDrag(e, { kind: "card", id: h.cardId, title: untitled(h.title) })}
                                onClick={() => onOpenCard(h.cardId, onBoard.has(h.cardId) ? boardId : h.boardId)}
                            >
                                <span className="wb-link-title"><Icon name="note" className="wb-row-icon" /> {untitled(h.title)}</span>
                                <CardPreview content={h.content} />
                                <span className="wb-link-board muted">{where(h)}</span>
                            </li>
                        ))
                    ))}
                {tab === "items" &&
                    (items.length === 0 ? (
                        <li className="muted wb-hit-empty">{query ? "沒有符合的條目" : "Drawer 裡還沒有條目"}</li>
                    ) : (
                        items.map((it) => (
                            <li
                                key={it.id}
                                className="wb-lib-row"
                                data-lib-item={it.id}
                                title="拖曳到白板或卡片上；雙擊在 Drawer 中開啟"
                                onPointerDown={(e) => onStartDrag(e, { kind: "item", id: it.id, title: untitled(it.title) })}
                                onDoubleClick={() => onOpenItem(it.id)}
                            >
                                <span className="wb-link-title">
                                    {itemType(it.itemType).icon} {untitled(it.title)}
                                </span>
                                <span className="wb-link-board muted">
                                    {[firstAuthor(it.authors), it.date].filter(Boolean).join(" · ")}
                                </span>
                            </li>
                        ))
                    ))}
            </ul>
        </section>
    );
}

function SelectedCard({ boardId, selectedCard: card, reloadKey, onOpenCard, onUnlink, onDelete, onOpenItem, onItemsChanged, onError }: Props) {
    const [linked, setLinked] = useState<LinkedCard[]>([]);

    useEffect(() => {
        if (!card) return;
        let stale = false;
        whiteboardApi.listCardLinks(card.id).then(
            (l) => !stale && setLinked(l),
            (e) => onError(errorMessage(e)),
        );
        return () => {
            stale = true;
        };
    }, [card?.id, reloadKey, onError]);

    if (!card) {
        return (
            <section className="wb-selected wb-selected-empty">
                <p className="muted">選取一張卡片，這裡會顯示它的連結與引用的文獻。</p>
            </section>
        );
    }

    const where = (boards: string[], onBoard: number | null) =>
        boards.length === 0 ? "不在任何白板" : onBoard === boardId ? "" : boards.join("、");

    const unlinkItem = async (itemId: number) => {
        try {
            await whiteboardApi.unlinkCardItem(card.id, itemId);
            onItemsChanged();
        } catch (e) {
            onError(errorMessage(e));
        }
    };

    return (
        <section className="wb-selected">
            <div className="wb-selected-header">
                <span className="wb-selected-title" title={untitled(card.title)}>
                    {untitled(card.title)}
                </span>
                <button className="danger-btn" onClick={() => onDelete(card.id)}>
                    刪除卡片
                </button>
            </div>
            <div className="wb-selected-body">
                <h3 className="wb-section-title">
                    連結 <span className="muted">{linked.length}</span>
                </h3>
                {linked.length === 0 ? (
                    <p className="muted wb-hint">還沒有連結。從上方清單把卡片拖到這張卡片上、拖曳卡片右側的圓點，或在內容中寫 [[卡片標題]]。</p>
                ) : (
                    <ul className="wb-link-list">
                        {linked.map((l) => (
                            <li key={l.linkId}>
                                <button className="wb-link-open" onClick={() => onOpenCard(l.cardId, l.boardId)}>
                                    <span className="wb-link-title">
                                        <span className="wb-dir" title={DIR_TITLES[l.direction]}>{DIR_ICONS[l.direction]}</span>{" "}
                                        {untitled(l.title)}
                                    </span>
                                    {l.note && <span className="wb-link-note-text">「{l.note}」</span>}
                                    {where(l.boards, l.boardId) && (
                                        <span className="wb-link-board muted">{where(l.boards, l.boardId)}</span>
                                    )}
                                </button>
                                <button className="small-btn" title="移除連結" onClick={() => onUnlink(l.cardId).catch(() => {})}>
                                    ×
                                </button>
                            </li>
                        ))}
                    </ul>
                )}

                <h3 className="wb-section-title">
                    引用的文獻 <span className="muted">{card.items.length}</span>
                </h3>
                {card.items.length === 0 ? (
                    <p className="muted wb-hint">從上方「文獻」把條目拖到這張卡片上即可引用。</p>
                ) : (
                    <ul className="wb-link-list">
                        {card.items.map((it) => (
                            <li key={it.itemId}>
                                <button className="wb-link-open" title="在 Drawer 中開啟" onClick={() => onOpenItem(it.itemId)}>
                                    <span className="wb-link-title">
                                        {itemType(it.itemType).icon} {untitled(it.title)}
                                    </span>
                                    <span className="wb-link-board muted">
                                        {[firstAuthor(it.authors), it.date].filter(Boolean).join(" · ")}
                                    </span>
                                </button>
                                <button className="small-btn" title="取消引用" onClick={() => unlinkItem(it.itemId)}>
                                    ×
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </section>
    );
}

export default WhiteboardSidebar;
