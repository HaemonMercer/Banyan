import { useEffect, useState } from "react";
import { drawerApi, errorMessage, type ItemSummary, type RelatedItem } from "../../drawer/api";
import { itemType, shortAuthors } from "../../drawer/itemTypes";
import SectionHeader from "./SectionHeader";
import { TypeIcon } from "../../icons/Icon";

interface Props {
    itemId: number;
    related: RelatedItem[];
    /** Runs a change, then reloads the item. */
    run: (fn: () => Promise<unknown>) => void;
    /** Selects the item in the list (switching to 我的文獻庫 if it isn't shown). */
    onOpenItem: (id: number) => void;
    onError: (message: string) => void;
    /** Items are being dragged over this section. */
    dropActive: boolean;
    collapsed: boolean;
    onToggle: () => void;
}

const untitled = (t: string) => t || "（無標題）";
const year = (date: string) => date.match(/\d{4}/)?.[0] ?? "";
const byline = (it: { authors: string; date: string }) =>
    [shortAuthors(it.authors), year(it.date)].filter(Boolean).join(" · ");

const MAX_HITS = 50;

/**
 * Related items, as in Zotero: a two-way link between two items. Add by searching, or by
 * dragging items from the list onto this section; click a related item to go to it.
 */
function ItemRelated({ itemId, related, run, onOpenItem, onError, dropActive, collapsed, onToggle }: Props) {
    /** Search results while the picker is open; null when closed. */
    const [hits, setHits] = useState<ItemSummary[] | null>(null);
    const [query, setQuery] = useState("");
    const picking = hits !== null;

    useEffect(() => {
        if (!picking) return;
        let stale = false;
        const t = setTimeout(() => {
            drawerApi.listItems({ query }).then(
                (list) => !stale && setHits(list),
                (e) => onError(errorMessage(e)),
            );
        }, query ? 200 : 0);
        return () => {
            stale = true;
            clearTimeout(t);
        };
    }, [picking, query, onError]);

    const close = () => {
        setHits(null);
        setQuery("");
    };

    // Esc closes the picker, also after a click on a result (which leaves focus on the page).
    useEffect(() => {
        if (!picking) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            setHits(null);
            setQuery("");
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [picking]);

    const relatedIds = new Set(related.map((r) => r.id));
    const candidates = (hits ?? []).filter((h) => h.id !== itemId).slice(0, MAX_HITS);

    return (
        <section className={`detail-section item-related${dropActive ? " drop-target" : ""}`} data-drop-related={itemId}>
            <SectionHeader title="關聯" count={related.length} collapsed={collapsed} onToggle={onToggle}>
                <button
                    className="small-btn"
                    onClick={() => {
                        if (collapsed) onToggle();
                        if (picking) close();
                        else setHits([]);
                    }}
                >
                    {picking ? "完成" : "＋ 新增"}
                </button>
            </SectionHeader>
            <div hidden={collapsed}>
                {picking && (
                    <div className="note-search">
                        <input
                            autoFocus
                            placeholder="搜尋標題、作者…"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                        <ul>
                            {candidates.length === 0 && <li className="muted note-search-empty">沒有符合的條目</li>}
                            {candidates.map((h) => {
                                const done = relatedIds.has(h.id);
                                return (
                                    <li key={h.id}>
                                        <button
                                            disabled={done}
                                            onClick={() => run(() => drawerApi.addRelatedItems(itemId, [h.id]))}
                                        >
                                            <span className="note-search-title">
                                                {itemType(h.itemType).icon} {untitled(h.title)}
                                            </span>
                                            <span className="muted">{done ? "已關聯" : byline(h) || " "}</span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                )}

                {related.length === 0 && !picking && (
                    <p className="muted">沒有關聯的條目。按「＋ 新增」，或把清單中的條目拖到這裡。</p>
                )}
                <ul className="related-items">
                    {related.map((r) => (
                        <li key={r.id}>
                            <button
                                className="related-open"
                                title={[untitled(r.title), byline(r)].filter(Boolean).join("\n")}
                                onClick={() => onOpenItem(r.id)}
                            >
                                <TypeIcon type={r.itemType} className="type-icon" />
                                <span className="related-title">{untitled(r.title)}</span>
                                {byline(r) && <span className="related-byline">{byline(r)}</span>}
                            </button>
                            <button
                                className="related-remove"
                                title="移除關聯（兩邊都會移除）"
                                onClick={() => run(() => drawerApi.removeRelatedItem(itemId, r.id))}
                            >×</button>
                        </li>
                    ))}
                </ul>
            </div>
        </section>
    );
}

export default ItemRelated;
