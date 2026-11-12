import { useEffect, useRef } from "react";
import { Icon } from "../../icons/Icon";

interface Props {
    query: string;
    onQuery: (q: string) => void;
    /** 0-based index of the current hit, or -1. */
    current: number;
    total: number;
    /** Still looking through the document. */
    searching: boolean;
    onPrev: () => void;
    onNext: () => void;
    onClose: () => void;
}

/** Find-in-document bar (Ctrl+F): Enter / Shift+Enter go to the next / previous hit, Esc closes. */
function SearchBar({ query, onQuery, current, total, searching, onPrev, onNext, onClose }: Props) {
    const ref = useRef<HTMLInputElement>(null);
    useEffect(() => {
        ref.current?.focus();
        ref.current?.select();
    }, []);
    const status = !query.trim() ? "" : searching && total === 0 ? "搜尋中…" : total === 0 ? "找不到" : `${current + 1} / ${total}${searching ? "…" : ""}`;
    return (
        <div className="reader-search" role="search">
            <Icon name="search" />
            <input
                ref={ref}
                value={query}
                placeholder="在檔案中搜尋…"
                aria-label="在檔案中搜尋"
                onChange={(e) => onQuery(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        if (e.shiftKey) onPrev();
                        else onNext();
                    } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        onClose();
                    }
                }}
            />
            <span className="reader-search-status">{status}</span>
            <button className="icon-btn" title="上一個（Shift＋Enter）" disabled={total === 0} onClick={onPrev}><Icon name="chevronUp" /></button>
            <button className="icon-btn" title="下一個（Enter）" disabled={total === 0} onClick={onNext}><Icon name="chevronDown" /></button>
            <button className="icon-btn" title="關閉搜尋（Esc）" onClick={onClose}><Icon name="close" /></button>
        </div>
    );
}

export default SearchBar;
