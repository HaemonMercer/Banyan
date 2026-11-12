import { useEffect, useRef, useState } from "react";
import {
    annotationApi,
    COLORS,
    openCardInWhiteboard,
    parseLocation,
    placeLabel,
    type Annotation,
    type AnnotationColor,
    type CitingCard,
} from "../../annotator/api";
import { Icon } from "../../icons/Icon";
import "../reader/Reader.css";
import "./Annotator.css";

/**
 * The parts of an annotation list, shared by the Annotator's right column and Whiteboard's 註解
 * tab: the row, the search and filter bar, and "沒有符合的註解".
 */

export type AnnotationFilter = "all" | "highlight" | "bookmark" | AnnotationColor;

const formatDate = (t: number) => new Date(t).toLocaleDateString("zh-TW", { year: "numeric", month: "numeric", day: "numeric" });

/** One annotation in a list: color, place and date, quote, editable note, citing cards, card, delete. */
export function AnnotationRow({ a, active, onJump, onNote, onCard, onDelete, source, jumpTitle = "前往原文", onPointerDown, rowTitle }: {
    a: Annotation;
    /** Gone to / open in the text. */
    active?: boolean;
    onJump: () => void;
    onNote?: (note: string) => void;
    onCard?: () => void;
    onDelete?: () => void;
    /** File name, when the list spans several files. */
    source?: string;
    jumpTitle?: string;
    /** Pressing on the row outside its controls (e.g. Whiteboard's drag). */
    onPointerDown?: (e: React.PointerEvent) => void;
    rowTitle?: string;
}) {
    const [editing, setEditing] = useState(false);
    const [note, setNote] = useState(a.note);
    /** Cards citing it, shown when asked for. */
    const [citing, setCiting] = useState<CitingCard[] | null>(null);
    useEffect(() => setCiting(null), [a.cardCount]);
    const toggleCiting = () =>
        citing ? setCiting(null) : annotationApi.cardsOf(a.id).then(setCiting, () => setCiting([]));
    useEffect(() => setNote(a.note), [a.note]);
    const place = placeLabel(parseLocation(a));
    const save = () => {
        setEditing(false);
        if (note !== a.note) onNote?.(note);
    };
    const ref = useRef<HTMLLIElement>(null);
    useEffect(() => {
        if (active) ref.current?.scrollIntoView({ block: "nearest" });
    }, [active]);
    return (
        <li
            ref={ref}
            className={`annot-row annot-bg-${a.color}${a.kind === "bookmark" ? " bookmark" : ""}${active ? " active" : ""}${onPointerDown ? " draggable" : ""}`}
            title={rowTitle}
            onPointerDown={
                onPointerDown &&
                ((e) => {
                    // The row's controls (actions, note, citing cards) are not handles.
                    if ((e.target as HTMLElement).closest(".annot-row-actions, .annot-row-note, .annot-note-input, .annot-row-add-note, .annot-row-cited, .annot-row-cards")) return;
                    onPointerDown(e);
                })
            }
        >
            <button className="annot-row-main" onClick={onJump} title={jumpTitle}>
                <span className="annot-row-place" title={[place, source].filter(Boolean).join(" · ")}>
                    {a.kind === "bookmark" && <Icon name="tag" />}
                    <span className="annot-row-place-label">{place}</span>
                    <span className="annot-row-date"> · {formatDate(a.createdAt)}</span>
                    {source && <span className="annot-row-source"> · {source}</span>}
                </span>
                {a.kind === "highlight" && <span className="annot-row-quote">{a.quote}</span>}
            </button>
            {(onCard || onDelete) && (
                <span className="annot-row-actions">
                    {onCard && a.kind === "highlight" && (
                        <button className="icon-btn" onClick={onCard} title={a.cardId ? "開啟用這段做的卡片" : "用這段建立卡片"} aria-label={a.cardId ? "開啟卡片" : "建立卡片"}>
                            <Icon name="cards" />
                        </button>
                    )}
                    {onDelete && (
                        <button className="icon-btn danger" onClick={onDelete} title="刪除" aria-label="刪除">
                            <Icon name="trash" />
                        </button>
                    )}
                </span>
            )}
            {editing ? (
                <textarea
                    className="annot-note-input"
                    autoFocus
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onBlur={save}
                    placeholder="寫下筆記…（Ctrl＋Enter 儲存，Esc 取消）"
                    onKeyDown={(e) => {
                        if (e.key === "Escape") {
                            setNote(a.note);
                            setEditing(false);
                        } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save();
                    }}
                />
            ) : a.note ? (
                <p className={`annot-row-note${onNote ? " editable" : ""}`} onClick={() => onNote && setEditing(true)} title={onNote ? "點一下編輯筆記" : undefined}>{a.note}</p>
            ) : onNote ? (
                <button className="annot-row-add-note" onClick={() => setEditing(true)}>＋ 筆記</button>
            ) : null}
            {a.cardCount > 0 && (
                <button className="annot-row-cited" onClick={toggleCiting} title="引用這段註解的卡片">
                    <Icon name="cards" /> {a.cardCount} 張卡片引用 <Icon name={citing ? "chevronUp" : "chevronDown"} />
                </button>
            )}
            {citing && (
                <ul className="annot-row-cards">
                    {citing.map((c) => (
                        <li key={c.cardId}>
                            <button onClick={() => openCardInWhiteboard(c.cardId)} title="在 Whiteboard 開啟這張卡片">
                                <span className="annot-row-card-title">{c.title || "（無標題）"}</span>
                                <span className="muted">{c.boards.length ? c.boards.join("、") : "不在白板上"}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </li>
    );
}

const passes = (a: Annotation, f: AnnotationFilter) =>
    f === "all" ? true : f === "highlight" || f === "bookmark" ? a.kind === f : a.kind === "highlight" && a.color === f;

/**
 * Search and filter state for a list of annotations. The search matches the quote, the note and
 * the place, plus whatever `extra` gives (e.g. the file's name when the list spans files).
 */
export function useAnnotationFilter<T extends Annotation>(annotations: T[], extra?: (a: T) => string) {
    const [filter, setFilter] = useState<AnnotationFilter>("all");
    const [query, setQuery] = useState("");
    const q = query.trim().toLowerCase();
    const matching = q
        ? annotations.filter(
              (a) =>
                  a.quote.toLowerCase().includes(q) ||
                  a.note.toLowerCase().includes(q) ||
                  placeLabel(parseLocation(a)).toLowerCase().includes(q) ||
                  (extra?.(a).toLowerCase().includes(q) ?? false),
          )
        : annotations;
    return {
        filter,
        setFilter,
        query,
        setQuery,
        /** Annotations passing the search and the filter. */
        list: matching.filter((a) => passes(a, filter)),
        /** How many pass the search and the filter `f` (the number on each filter). */
        count: (f: AnnotationFilter) => matching.filter((a) => passes(a, f)).length,
        clear: () => {
            setFilter("all");
            setQuery("");
        },
    };
}

/** The search box and 全部／重點／書籤／color filters (with counts) above a list. */
export function AnnotationFilterBar({ state, placeholder }: { state: ReturnType<typeof useAnnotationFilter>; placeholder: string }) {
    const { filter, setFilter, query, setQuery, count } = state;
    return (
        <>
            <div className="search">
                <input
                    type="search"
                    placeholder={placeholder}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && setQuery("")}
                />
            </div>
            <div className="annot-filters" role="group" aria-label="篩選">
                {(["all", "highlight", "bookmark"] as const).map((f) => (
                    <button key={f} className={`small-btn${filter === f ? " active" : ""}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                        {{ all: "全部", highlight: "重點", bookmark: "書籤" }[f]}
                        <span className="annot-filter-count">{count(f)}</span>
                    </button>
                ))}
                <span className="annot-colors">
                    {COLORS.map((c) => {
                        const n = count(c.id);
                        return (
                            <button
                                key={c.id}
                                className={`annot-dot annot-bg-${c.id}${filter === c.id ? " current" : ""}${n === 0 ? " none" : ""}`}
                                title={`只看${c.label}色（${n}）`}
                                aria-label={`只看${c.label}色`}
                                aria-pressed={filter === c.id}
                                onClick={() => setFilter(filter === c.id ? "all" : c.id)}
                            />
                        );
                    })}
                </span>
            </div>
        </>
    );
}

/** Nothing passes the search and filters. */
export function NoMatchingAnnotations({ onClear }: { onClear: () => void }) {
    return (
        <p className="muted annotator-empty">
            沒有符合的註解。
            <button className="link-btn" onClick={onClear}>清除篩選</button>
        </p>
    );
}
