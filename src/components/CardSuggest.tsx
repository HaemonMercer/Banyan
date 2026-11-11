import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { whiteboardApi, type CardHit } from "../whiteboard/api";
import "./CardSuggest.css";

const MAX_HITS = 8;

/** Card titles matching `query` (null = closed), for `[[` completion. Distinct titles, at most 8. */
export function useCardSuggestions(query: string | null, excludeCardId: number | null) {
    const [hits, setHits] = useState<CardHit[]>([]);
    useEffect(() => {
        if (query === null) {
            setHits([]);
            return;
        }
        let stale = false;
        const t = setTimeout(() => {
            whiteboardApi.searchCards(query.trim(), excludeCardId).then(
                (list) => {
                    if (stale) return;
                    const q = query.trim().toLowerCase();
                    const seen = new Set<string>();
                    setHits(
                        list
                            .filter((h) => {
                                const key = h.title.trim().toLowerCase();
                                if (!key || seen.has(key) || !key.includes(q)) return false;
                                seen.add(key);
                                return true;
                            })
                            .slice(0, MAX_HITS),
                    );
                },
                () => !stale && setHits([]),
            );
        }, query ? 120 : 0);
        return () => {
            stale = true;
            clearTimeout(t);
        };
    }, [query, excludeCardId]);
    return hits;
}

interface ListProps {
    hits: CardHit[];
    active: number;
    /** Viewport position (top-left of the list). */
    x: number;
    y: number;
    onPick: (title: string) => void;
    onHover: (index: number) => void;
}

/** Floating suggestion list (portal to body, so it is not clipped or scaled by the board). */
export function CardSuggestList({ hits, active, x, y, onPick, onHover }: ListProps) {
    if (hits.length === 0) return null;
    return createPortal(
        <ul className="wiki-complete" style={{ left: Math.min(x, window.innerWidth - 260), top: y }} role="listbox">
            {hits.map((h, i) => (
                <li
                    key={h.cardId}
                    role="option"
                    aria-selected={i === active}
                    className={i === active ? "active" : undefined}
                    // Keep focus in the editor.
                    onMouseDown={(e) => {
                        e.preventDefault();
                        onPick(h.title.trim());
                    }}
                    onMouseEnter={() => onHover(i)}
                >
                    <span className="wiki-complete-title">{h.title}</span>
                    <span className="wiki-complete-boards">{h.boards.length > 0 ? h.boards.join("、") : "不在白板上"}</span>
                </li>
            ))}
        </ul>,
        document.body,
    );
}
