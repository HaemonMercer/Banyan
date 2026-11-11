import { useEffect, useMemo, useState } from "react";
import { errorMessage } from "../../drawer/api";
import { summarizeMarkdown } from "../../markdown";
import { whiteboardApi, type CardQuery, type LibraryCard, type TagCount } from "../../whiteboard/api";

interface Props {
    /** Bumped when cards may have changed (edits in the side panel, deletes…). */
    reloadKey: number;
    /** The card open in the side panel (highlighted). */
    openCardId: number | null;
    onOpen: (cardId: number) => void;
    /** "＋ 新卡片": a card on no board. */
    onCreate: () => void;
    onError: (text: string) => void;
}

const untitled = (t: string) => t || "（無標題）";
const FILTER_KEY = "banyan.cardLibrary.filter";

function savedFilter(): Required<Omit<CardQuery, "query">> {
    try {
        const v = JSON.parse(localStorage.getItem(FILTER_KEY) ?? "null");
        if (v && typeof v === "object") {
            return {
                tag: typeof v.tag === "string" ? v.tag : null,
                placement: ["all", "placed", "unplaced"].includes(v.placement) ? v.placement : "all",
                sort: ["updated", "created", "title"].includes(v.sort) ? v.sort : "updated",
            };
        }
    } catch {
        /* storage unavailable */
    }
    return { tag: null, placement: "all", sort: "updated" };
}

function Preview({ content }: { content: string }) {
    const text = useMemo(() => (content.trim() ? summarizeMarkdown(content, 220) : ""), [content]);
    return text ? <p className="cl-preview">{text}</p> : <p className="cl-preview empty">（沒有內容）</p>;
}

/** Heptabase-style card library: every card, searchable, filterable by tag and by placement. */
function CardLibrary({ reloadKey, openCardId, onOpen, onCreate, onError }: Props) {
    const [query, setQuery] = useState("");
    const [filter, setFilterState] = useState(savedFilter);
    const [cards, setCards] = useState<LibraryCard[] | null>(null);
    const [tags, setTags] = useState<TagCount[]>([]);

    const setFilter = (patch: Partial<typeof filter>) => {
        const next = { ...filter, ...patch };
        setFilterState(next);
        try {
            localStorage.setItem(FILTER_KEY, JSON.stringify(next));
        } catch {
            /* storage unavailable */
        }
    };

    useEffect(() => {
        let stale = false;
        const t = setTimeout(() => {
            Promise.all([whiteboardApi.listCards({ ...filter, query: query.trim() }), whiteboardApi.listCardTags()]).then(
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
    }, [query, filter, reloadKey, onError]);

    // A remembered tag that no card uses any more is dropped.
    const tagMissing = filter.tag !== null && tags.length > 0 && !tags.some((t) => t.name.toLowerCase() === filter.tag!.toLowerCase());
    useEffect(() => {
        if (tagMissing) setFilter({ tag: null });
    }, [tagMissing]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div className="card-library">
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
                <select className="cl-sort" value={filter.sort} onChange={(e) => setFilter({ sort: e.target.value as typeof filter.sort })} title="排序">
                    <option value="updated">最近修改</option>
                    <option value="created">最近建立</option>
                    <option value="title">標題</option>
                </select>
                <span className="muted cl-count">{cards ? `${cards.length} 張` : "載入中…"}</span>
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
                {tags.length === 0 && <span className="muted cl-hint">在卡片面板中加上標籤後，可以在這裡依標籤篩選。</span>}
            </div>

            <div className="cl-grid">
                {cards?.length === 0 && (
                    <p className="muted cl-empty">{query || filter.tag || filter.placement !== "all" ? "沒有符合的卡片" : "還沒有卡片"}</p>
                )}
                {cards?.map((c) => (
                    <button
                        key={c.id}
                        className={`cl-card${c.id === openCardId ? " opened" : ""}`}
                        onClick={() => onOpen(c.id)}
                        title="在側邊面板開啟"
                    >
                        <span className="cl-title">{untitled(c.title)}</span>
                        {c.tags.length > 0 && (
                            <span className="cl-card-tags">
                                {c.tags.map((t) => (
                                    <span key={t} className="wb-tag">#{t}</span>
                                ))}
                            </span>
                        )}
                        <Preview content={c.content} />
                        <span className="cl-meta muted">
                            <span className="cl-boards">
                                {c.boards.length > 0 ? `🧩 ${c.boards.map((b) => b.name).join("、")}` : "不在白板上"}
                            </span>
                            {c.linkCount > 0 && <span title="連結數">↔ {c.linkCount}</span>}
                            {c.itemCount > 0 && <span title="引用的文獻數">📚 {c.itemCount}</span>}
                            <span title="最後修改">{new Date(c.updatedAt).toLocaleDateString("zh-TW")}</span>
                        </span>
                    </button>
                ))}
            </div>
        </div>
    );
}

export default CardLibrary;
