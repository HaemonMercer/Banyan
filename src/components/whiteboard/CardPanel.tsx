import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../drawer/api";
import { itemType } from "../../drawer/itemTypes";
import Markdown, { sourceOffsetAt } from "../../markdown/Markdown";
import MarkdownEditor from "../../markdown/MarkdownEditor";
import { PlainText } from "../PlainText";
import { whiteboardApi, type CardDetail, type LinkedCard } from "../../whiteboard/api";
import { AUTOSAVE_MS, serial } from "../../whiteboard/autosave";
import { kindInfo } from "../../whiteboard/objects";
import { ImagePreview, PdfPages, VideoPlayer } from "./BoardObjects";
import { tableText } from "../../whiteboard/table";
import TableObject from "./TableObject";
import ChartView from "./ChartView";
import { readChart } from "../../whiteboard/chart";

/** The chart as saved (the panel has no table to follow live). */
const chartProps = (data: string) => {
    const c = readChart(data);
    return { type: c.type, snapshot: c.snapshot, legend: c.legend };
};
import VersionHistory from "./VersionHistory";
import { openAnnotation, parseLocation, placeLabel, refLabel } from "../../annotator/api";

/** The panel's table is not on a board; it has no rectangle of its own. */
const PANEL_RECT = { x: 0, y: 0, width: 0, height: 0 };

interface Props {
    cardId: number;
    /** The board being viewed, if any (to say "on this board"). */
    boardId: number | null;
    /** Bumped when the card may have changed elsewhere (e.g. edited on the board). */
    reloadKey: number;
    onClose: () => void;
    /** Saved title/content/tags. */
    onSaved: (card: CardDetail) => void;
    /** Show the card on a board. */
    onLocate: (cardId: number, boardId: number) => void;
    /** Open another card in this panel. */
    onOpenCard: (cardId: number) => void;
    onOpenItem: (itemId: number) => void;
    onDelete: (cardId: number) => void;
    /** Take the card off the open board (only when it is on it). */
    onRemoveFromBoard?: (cardId: number) => void;
    onError: (text: string) => void;
}

const untitled = (t: string) => t || "（無標題）";
const DIR_ICONS: Record<LinkedCard["direction"], string> = { out: "→", in: "←", both: "↔", none: "—" };
const fmt = (ms: number) =>
    ms ? new Date(ms).toLocaleString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

/**
 * Heptabase-style card panel: the whole card, opened beside the board or the card library,
 * with its tags, links and cited Drawer items. Edits save by themselves shortly after typing
 * pauses.
 */
function CardPanel(props: Props) {
    const { cardId, boardId, reloadKey, onClose, onSaved, onLocate, onOpenCard, onOpenItem, onDelete, onError } = props;
    const [card, setCard] = useState<CardDetail | null>(null);
    const [linked, setLinked] = useState<LinkedCard[]>([]);
    const [allTags, setAllTags] = useState<string[]>([]);
    const [tagInput, setTagInput] = useState("");
    const [editing, setEditing] = useState<{ offset: number | null } | null>(null);
    /** Title (trimmed) and content as last saved, to skip saves that change nothing. */
    const saved = useRef({ title: "", content: "", data: "" });
    const cardRef = useRef(card);
    cardRef.current = card;
    const busy = useRef(false);
    const queueSave = useRef(serial()).current;
    /** Google Docs-style save indicator; null until the first edit. */
    const [status, setStatus] = useState<"unsaved" | "saving" | "saved" | null>(null);
    const [history, setHistory] = useState(false);

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
            saved.current = { title: c.title, content: c.content, data: c.data };
        } catch (e) {
            onError(errorMessage(e));
        }
    }, [cardId, onError]);

    useEffect(() => {
        setEditing(null);
        setHistory(false);
        void load();
    }, [cardId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Changes made elsewhere: reload unless the user is typing here.
    useEffect(() => {
        if (reloadKey === 0 || editing || history || busy.current) return;
        const el = document.activeElement;
        if (el instanceof HTMLElement && el.closest(".wb-card-panel")) return;
        void load();
    }, [reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

    const isSaved = (c: CardDetail) =>
        c.title.trim() === saved.current.title && c.content === saved.current.content && (c.data ?? "") === (saved.current.data ?? "");

    /** Writes the title and content if they changed (autosave). */
    const persist = () =>
        queueSave(async () => {
            const c = cardRef.current;
            if (!c || isSaved(c)) return;
            busy.current = true;
            setStatus("saving");
            try {
                // Objects other than notes keep their kind's data too (e.g. a table edited here).
                if (c.kind && c.kind !== "note") await whiteboardApi.updateCardData(c.id, c.title, c.content, c.data);
                else await whiteboardApi.updateCard(c.id, c.title, c.content);
                if (c.content !== saved.current.content) await whiteboardApi.syncWikiLinks(c.id, c.content);
                saved.current = { title: c.title.trim(), content: c.content, data: c.data };
                onSaved({ ...c, title: c.title.trim() });
                setStatus(cardRef.current && isSaved(cardRef.current) ? "saved" : "unsaved");
            } catch (e) {
                setStatus("unsaved");
                onError(errorMessage(e));
            } finally {
                busy.current = false;
            }
        });

    // Autosave shortly after typing pauses, like Google Docs.
    useEffect(() => {
        if (!card || isSaved(card)) return;
        setStatus("unsaved");
        const t = window.setTimeout(() => void persist(), AUTOSAVE_MS);
        return () => window.clearTimeout(t);
    }, [card?.title, card?.content, card?.data]); // eslint-disable-line react-hooks/exhaustive-deps

    // Closing the panel or switching cards never loses typing.
    useEffect(() => () => void persist(), []); // eslint-disable-line react-hooks/exhaustive-deps

    /** A field was left: save what is left. */
    const save = () => persist();

    const openHistory = async () => {
        setEditing(null);
        await save();
        setHistory(true);
    };

    /** A version was restored: show it and update the board. */
    const restored = async (c: CardDetail) => {
        setCard(c);
        saved.current = { title: c.title, content: c.content, data: c.data };
        setStatus("saved");
        setHistory(false);
        onSaved(c);
    };

    const setTags = async (tags: string[]) => {
        const c = cardRef.current;
        if (!c) return;
        try {
            const stored = await whiteboardApi.setCardTags(c.id, tags);
            const next = { ...c, tags: stored };
            setCard(next);
            onSaved(next);
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
            className={`wb-card-panel${card.kind === "table" ? " wide" : ""}`}
            onKeyDown={(e) => {
                if (e.key === "Escape" && !editing && !history && !(e.target instanceof HTMLInputElement)) onClose();
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
                {status && (
                    <span className={`wb-cp-status${status === "saved" ? " done" : ""}`} aria-live="polite">
                        {status === "saved" ? "已儲存" : "儲存中…"}
                    </span>
                )}
                <button
                    className="small-btn wb-cp-history"
                    title="版本記錄：查看、命名與還原這張卡片的歷史版本"
                    onClick={() => void openHistory()}
                >
                    🕘 版本記錄
                </button>
                {here && props.onRemoveFromBoard && (
                    <button
                        className="small-btn wb-cp-remove"
                        title="從目前白板移除：卡片仍保留在卡片庫和其他白板"
                        onClick={() => props.onRemoveFromBoard!(card.id)}
                    >
                        從白板移除
                    </button>
                )}
                <button className="danger-btn wb-cp-delete" title="完全刪除：從所有白板和卡片庫中刪除" onClick={() => onDelete(card.id)}>完全刪除</button>
                <button className="wb-cp-close" title="關閉（Esc）" onClick={onClose}>×</button>
            </div>

            {history && (
                <VersionHistory card={card} onRestored={(c) => void restored(c)} onClose={() => setHistory(false)} onError={onError} />
            )}

            <div className="wb-cp-body">
                {card.kind && card.kind !== "note" && (
                    <div className="wb-cp-kind muted">{kindInfo(card.kind).label}</div>
                )}
                <input
                    className="wb-cp-title"
                    value={card.title}
                    placeholder="標題"
                    readOnly={card.kind === "mindmap"}
                    title={card.kind === "mindmap" ? "心智圖的標題就是中心主題，請在白板上修改" : undefined}
                    onChange={(e) => setCard({ ...card, title: e.target.value })}
                    onBlur={() => void save()}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            setEditing({ offset: null });
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

                {card.kind === "image" && <ImagePreview cardId={card.id} data={card.data} onError={onError} />}
                {card.kind === "video" && <VideoPlayer data={card.data} title={card.title} />}
                {card.kind === "pdf" && <PdfPages cardId={card.id} data={card.data} onError={onError} />}

                {card.kind === "table" ? (
                    // The sheet itself, editable like Excel (saved like any edit in the panel).
                    <TableObject
                        variant="panel"
                        data={card.data}
                        rect={PANEL_RECT}
                        zoom={1}
                        active
                        onChange={(t) => setCard((c) => (c ? { ...c, data: JSON.stringify(t), content: tableText(t) } : c))}
                        onFit={() => {}}
                    />
                ) : card.kind === "chart" ? (
                    <div className="wb-cp-chart">
                        <ChartView {...chartProps(card.data)} width={420} height={280} />
                    </div>
                ) : card.kind === "mindmap" ? (
                    <div className="wb-cp-content wb-cp-outline">
                        <PlainText text={card.content} />
                    </div>
                ) : (
                <div
                    className={`wb-cp-content${editing ? " editing" : ""}`}
                    tabIndex={editing ? -1 : 0}
                    title={editing ? undefined : "點一下以編輯"}
                    onFocus={(e) => {
                        if (!editing && e.target === e.currentTarget) setEditing({ offset: null });
                    }}
                    onClick={(e) => {
                        if (editing || (e.target as HTMLElement).closest("a, input, button")) return;
                        setEditing({ offset: sourceOffsetAt(e.currentTarget, e.clientX, e.clientY) });
                    }}
                >
                    {editing ? (
                        <MarkdownEditor
                            value={card.content}
                            cardId={card.id}
                            initialOffset={editing.offset}
                            placeholder={card.kind && card.kind !== "note" && card.kind !== "sticky" ? "筆記" : "內容"}
                            onChange={(v) => setCard((c) => (c ? { ...c, content: v } : c))}
                            onBlur={() => {
                                setEditing(null);
                                void save();
                            }}
                        />
                    ) : card.content.trim() ? (
                        <Markdown source={card.content} />
                    ) : (
                        <div className="wb-card-placeholder">
                            {card.kind && card.kind !== "note" && card.kind !== "sticky" ? "點一下寫筆記" : "點一下開始寫"}
                        </div>
                    )}
                </div>
                )}

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

                {card.annotations.length > 0 && (
                    <section className="wb-cp-section">
                        <h3 className="wb-section-title">
                            引用的註解 <span className="muted">{card.annotations.length}</span>
                        </h3>
                        <ul className="wb-link-list">
                            {card.annotations.map((a) => (
                                <li key={a.annotationId} className={`wb-annot-ref annot-bg-${a.color}`}>
                                    <button className="wb-link-open" title="在 Annotator 中開啟原文" onClick={() => openAnnotation(a.annotationId)}>
                                        <span className="wb-link-title">{refLabel(a, 60)}</span>
                                        <span className="wb-link-board muted">
                                            {untitled(a.itemTitle || a.fileName)} · {placeLabel(parseLocation(a))}
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
