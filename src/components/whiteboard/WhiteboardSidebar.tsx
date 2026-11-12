import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../icons/Icon";
import type { IconName } from "../../icons/icons";
import { drawerApi, errorMessage, type ItemSummary } from "../../drawer/api";
import { itemType } from "../../drawer/itemTypes";
import { summarize } from "../../markdown";
import { kindInfo } from "../../whiteboard/objects";
import { whiteboardApi, type BoardCard, type CardHit, type LinkedCard } from "../../whiteboard/api";
import {
    annotationApi,
    deleteAnnotation,
    openAnnotation,
    parseLocation,
    placeLabel,
    refLabel,
    refreshAnnotations,
    useAnnotationGeneration,
    type AnnotationInFile,
} from "../../annotator/api";
import { AnnotationFilterBar, AnnotationRow, NoMatchingAnnotations, useAnnotationFilter } from "../annotator/AnnotationRows";

/** What is being dragged from the library list onto the board. */
export type DragPayload =
    | { kind: "card"; id: number; title: string }
    | { kind: "item"; id: number; title: string }
    | { kind: "annotation"; id: number; title: string };

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
    /** Delete the card everywhere (asks first). */
    onDelete: (id: number) => void;
    /** Take the card off this board only. */
    onRemove: (id: number) => void;
    onOpenItem: (itemId: number) => void;
    /** Show an annotation in the Annotator (not right after a drag). */
    onOpenAnnotation: (annotationId: number) => void;
    /** The selected card's Drawer items changed; reload them. */
    onItemsChanged: () => void;
    onError: (text: string) => void;
    /** Replaces the selected-card section (e.g. the editor of a selected link). */
    bottom?: React.ReactNode;
}

const untitled = (t: string) => t || "（無標題）";

/** A few lines of the card's text under its title. */
function CardPreview({ content, kind }: { content: string; kind?: string }) {
    const text = useMemo(() => (content.trim() ? summarize(content, 160) : ""), [content]);
    return text ? (
        <span className="wb-lib-preview">{text}</span>
    ) : (
        <span className="wb-lib-preview empty">{kind && kind !== "note" && kind !== "sticky" ? kindInfo(kind).label : "（沒有內容）"}</span>
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

/** The right pane's tabs: a column of icons on its right edge, like the app's module rail. */
type Tab = "cards" | "literature" | "files" | "annotations";
const TABS: { id: Tab; label: string; icon: IconName; title: string }[] = [
    { id: "cards", label: "卡片", icon: "note", title: "卡片庫：每張卡片" },
    { id: "literature", label: "文獻", icon: "library", title: "Drawer 文獻庫：書目資料" },
    { id: "files", label: "檔案庫", icon: "folder", title: "Drawer 檔案庫：個人檔案" },
    { id: "annotations", label: "註解", icon: "annotator", title: "Annotator：PDF 與電子書中的重點與書籤" },
];

/**
 * Right pane, in tabs (卡片 · 文獻 · 檔案庫 · 註解): every card, 文獻庫 item, 檔案庫 file or
 * annotation, to drag onto the board (onto a card = link / cite; onto empty space = place there).
 * Bottom: the selected card's links, items and annotations.
 */
function WhiteboardSidebar(props: Props) {
    const [tab, setTab] = useState<Tab>("cards");
    return (
        <aside className="drawer-pane wb-panel">
            <div className="wb-panel-main">
                <Library {...props} tab={tab} />
                {props.bottom ?? <SelectedCard {...props} />}
            </div>
            <nav className="app-rail wb-panel-rail" role="tablist" aria-label="白板側欄" aria-orientation="vertical">
                {TABS.map((t) => (
                    <button
                        key={t.id}
                        role="tab"
                        aria-selected={tab === t.id}
                        className={`rail-btn${tab === t.id ? " active" : ""}`}
                        title={t.title}
                        onClick={() => setTab(t.id)}
                    >
                        <Icon name={t.icon} size={20} className="rail-icon" />
                        <span className="rail-label">{t.label}</span>
                    </button>
                ))}
            </nav>
        </aside>
    );
}

function Library(props: Props & { tab: Tab }) {
    return props.tab === "annotations" ? <AnnotationsTab {...props} /> : <ListTab {...props} />;
}

/** Most annotations listed at once (the search and filters narrow them down). */
const MAX_ANNOTATIONS = 200;

/**
 * 註解: every annotation, shown and handled as in the Annotator's right column (shared rows,
 * search and filters), plus the file each is from. Drag one onto a card to cite it, or onto empty
 * space to place its card; click the quote to go to it in the Annotator.
 */
function AnnotationsTab({ reloadKey, onStartDrag, onOpenCard, onOpenAnnotation, onError }: Props) {
    const generation = useAnnotationGeneration();
    const [all, setAll] = useState<AnnotationInFile[] | null>(null);
    useEffect(() => {
        let stale = false;
        annotationApi.search("").then(
            (l) => !stale && setAll(l),
            (e) => onError(errorMessage(e)),
        );
        return () => {
            stale = true;
        };
    }, [generation, reloadKey, onError]);
    const filtering = useAnnotationFilter(all ?? [], (a) => `${a.itemTitle} ${a.fileName}`);
    const shown = filtering.list.slice(0, MAX_ANNOTATIONS);

    const act = async (fn: () => Promise<unknown>) => {
        try {
            await fn();
        } catch (e) {
            onError(errorMessage(e));
        }
    };
    const toCard = (a: AnnotationInFile) =>
        act(async () => {
            const cardId = a.cardId ?? (await annotationApi.toCard(a.id, placeLabel(parseLocation(a))));
            if (a.cardId === null) await refreshAnnotations();
            onOpenCard(cardId, null);
        });

    return (
        <section className="wb-library wb-annot-tab">
            {all !== null && all.length > 0 && <AnnotationFilterBar state={filtering} placeholder="搜尋重點、筆記、檔名…" />}
            {all === null ? (
                <p className="muted annotator-empty">載入中…</p>
            ) : all.length === 0 ? (
                <p className="muted annotator-empty">還沒有註解。在 Annotator 中閱讀 PDF 或電子書時畫重點。</p>
            ) : shown.length === 0 ? (
                <NoMatchingAnnotations onClear={filtering.clear} />
            ) : (
                <ul className="annot-list">
                    {shown.map((a) => (
                        <AnnotationRow
                            key={a.id}
                            a={a}
                            source={untitled(a.itemTitle || a.fileName)}
                            jumpTitle="在 Annotator 中前往原文"
                            rowTitle="拖曳到卡片上讓它引用；拖到空白處放上這段註解的卡片"
                            onPointerDown={(e) => onStartDrag(e, { kind: "annotation", id: a.id, title: refLabel(a) })}
                            onJump={() => onOpenAnnotation(a.id)}
                            onNote={(note) => void act(async () => (await annotationApi.update(a.id, { note }), await refreshAnnotations()))}
                            onCard={() => void toCard(a)}
                            onDelete={() => void act(() => deleteAnnotation(a))}
                        />
                    ))}
                    {filtering.list.length > shown.length && (
                        <li className="muted annotator-empty">還有 {filtering.list.length - shown.length} 則，用搜尋或篩選縮小範圍</li>
                    )}
                </ul>
            )}
        </section>
    );
}

/** 卡片、文獻、檔案庫: a search box over a list to drag from. */
function ListTab({ tab, boardId, onBoard, reloadKey, onStartDrag, onOpenCard, onOpenItem, onError }: Props & { tab: Tab }) {
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
                drawerApi.listItems({ query: q, library: tab === "files" ? "files" : "literature" }).then(
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
            <input
                className="wb-search"
                placeholder={
                    tab === "cards" ? "搜尋卡片標題或內容…" : tab === "files" ? "搜尋檔案庫…" : "搜尋文獻庫…"
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            />
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
                                <CardPreview content={h.content} kind={h.kind} />
                                <span className="wb-link-board muted">{where(h)}</span>
                            </li>
                        ))
                    ))}
                {(tab === "literature" || tab === "files") &&
                    (items.length === 0 ? (
                        <li className="muted wb-hit-empty">
                            {query ? "沒有符合的條目" : tab === "files" ? "檔案庫裡還沒有檔案" : "文獻庫裡還沒有條目"}
                        </li>
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
                                    {(tab === "files" ? [it.fileName, it.date] : [firstAuthor(it.authors), it.date])
                                        .filter(Boolean)
                                        .join(" · ")}
                                </span>
                            </li>
                        ))
                    ))}
            </ul>
        </section>
    );
}

function SelectedCard({ boardId, selectedCard: card, reloadKey, onOpenCard, onUnlink, onDelete, onRemove, onOpenItem, onItemsChanged, onError }: Props) {
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

    // Nothing selected: the list above fills the column.
    if (!card) return null;

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
    const unlinkAnnotation = async (annotationId: number) => {
        try {
            await annotationApi.unlinkCard(card.id, annotationId);
            onItemsChanged();
            refreshAnnotations();
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
                <button className="small-btn" onClick={() => onRemove(card.id)} title="從這個白板移除（Delete）：卡片仍保留在卡片庫">
                    從白板移除
                </button>
                <button className="danger-btn" onClick={() => onDelete(card.id)} title="完全刪除（Shift＋Delete）：從所有白板和卡片庫中刪除">
                    刪除
                </button>
            </div>
            <div className="wb-selected-body">
                <h3 className="wb-section-title">
                    連結 <span className="muted">{linked.length}</span>
                </h3>
                {linked.length === 0 ? (
                    <p className="muted wb-hint">還沒有連結。</p>
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
                    <p className="muted wb-hint">還沒有引用的文獻。</p>
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

                <h3 className="wb-section-title">
                    引用的註解 <span className="muted">{card.annotations.length}</span>
                </h3>
                {card.annotations.length === 0 ? (
                    <p className="muted wb-hint">還沒有引用的註解。從上方「註解」分頁拖到卡片上。</p>
                ) : (
                    <ul className="wb-link-list">
                        {card.annotations.map((a) => (
                            <li key={a.annotationId} className={`wb-annot-ref annot-bg-${a.color}`}>
                                <button className="wb-link-open" title="在 Annotator 中開啟原文" onClick={() => openAnnotation(a.annotationId)}>
                                    <span className="wb-link-title">{refLabel(a, 60)}</span>
                                    <span className="wb-link-board muted">
                                        {untitled(a.itemTitle || a.fileName)} · {placeLabel(parseLocation(a))}
                                    </span>
                                </button>
                                <button className="small-btn" title="取消引用" onClick={() => unlinkAnnotation(a.annotationId)}>
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
