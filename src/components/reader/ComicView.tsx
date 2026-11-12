import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { errorMessage } from "../../drawer/api";
import { Comic } from "../../drawer/books";
import { Icon } from "../../icons/Icon";
import { ReaderMessage, useFileBytes, usePosition } from "./shared";
import { isHomeActive } from "../../tabs";

type Fit = "page" | "width";

/**
 * A comic archive (CBZ): one page at a time, or two side by side. ← → turn pages; with
 * 右翻 (manga) ← goes forward and two-page spreads read right to left.
 */
function ComicView({ id, toolsEl }: { id: number; toolsEl: HTMLElement | null }) {
    const { data, error } = useFileBytes(id);
    const [comic, setComic] = useState<Comic | null>(null);
    const [failed, setFailed] = useState<string | null>(null);
    const { load, save } = usePosition<number>(id);
    const [page, setPage] = useState(() => load() ?? 0);
    const [urls, setUrls] = useState<(string | null)[]>([]);
    const prefKey = "banyan.reader.comic";
    const [prefs, setPrefs] = useState<{ fit: Fit; spread: boolean; rtl: boolean }>(() => {
        try {
            return { fit: "page", spread: false, rtl: false, ...JSON.parse(localStorage.getItem(prefKey) ?? "{}") };
        } catch {
            return { fit: "page", spread: false, rtl: false };
        }
    });
    const setPref = (p: Partial<typeof prefs>) => {
        const next = { ...prefs, ...p };
        setPrefs(next);
        try {
            localStorage.setItem(prefKey, JSON.stringify(next));
        } catch {
            /* this session only */
        }
    };

    useEffect(() => {
        if (!data) return;
        try {
            const c = new Comic(data);
            setComic(c);
            setPage((p) => Math.min(p, c.pages.length - 1));
            return () => c.close();
        } catch (e) {
            setFailed(errorMessage(e));
        }
    }, [data]);

    const step = prefs.spread ? 2 : 1;
    const shown = comic ? [page, ...(prefs.spread && page + 1 < comic.pages.length ? [page + 1] : [])] : [];

    // Load the pages shown and the next ones.
    useEffect(() => {
        if (!comic) return;
        let stale = false;
        const wanted = [...shown, page + step, page + step + 1].filter((n) => n < comic.pages.length);
        Promise.all(wanted.map((n) => comic.url(n).then((u) => [n, u] as const))).then(
            (pairs) => {
                if (stale) return;
                setUrls((prev) => {
                    const next = [...prev];
                    for (const [n, u] of pairs) next[n] = u;
                    return next;
                });
            },
            (e) => !stale && setFailed(errorMessage(e)),
        );
        save(page);
        return () => {
            stale = true;
        };
    }, [comic, page, prefs.spread]); // eslint-disable-line react-hooks/exhaustive-deps

    const turn = (dir: 1 | -1) => {
        if (!comic) return;
        setPage((p) => Math.max(0, Math.min(comic.pages.length - 1, p + dir * step)));
    };

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!isHomeActive()) return;
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
            const forward = prefs.rtl ? "ArrowLeft" : "ArrowRight";
            const back = prefs.rtl ? "ArrowRight" : "ArrowLeft";
            if (e.key === forward || e.key === "PageDown" || e.key === " ") {
                e.preventDefault();
                turn(1);
            } else if (e.key === back || e.key === "PageUp") {
                e.preventDefault();
                turn(-1);
            } else if (e.key === "Home") setPage(0);
            else if (e.key === "End" && comic) setPage(comic.pages.length - 1);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }); // eslint-disable-line react-hooks/exhaustive-deps

    if (error || failed) return <ReaderMessage>無法開啟這本漫畫：{error ?? failed}</ReaderMessage>;
    if (!comic) return <ReaderMessage>載入中…</ReaderMessage>;

    const tools: ReactNode = (
        <>
            <button className="icon-btn" title="上一頁" disabled={page <= 0} onClick={() => turn(-1)}><Icon name={prefs.rtl ? "chevronRight" : "chevronLeft"} /></button>
            <span className="reader-count">{shown.map((n) => n + 1).join("–")} / {comic.pages.length}</span>
            <button className="icon-btn" title="下一頁" disabled={page + step >= comic.pages.length} onClick={() => turn(1)}><Icon name={prefs.rtl ? "chevronLeft" : "chevronRight"} /></button>
            <span className="reader-sep" />
            <button className={`small-btn${prefs.fit === "page" ? " active" : ""}`} onClick={() => setPref({ fit: "page" })}>整頁</button>
            <button className={`small-btn${prefs.fit === "width" ? " active" : ""}`} onClick={() => setPref({ fit: "width" })}>符合寬度</button>
            <button className={`small-btn${prefs.spread ? " active" : ""}`} onClick={() => setPref({ spread: !prefs.spread })} title="兩頁並排">雙頁</button>
            <button className={`small-btn${prefs.rtl ? " active" : ""}`} onClick={() => setPref({ rtl: !prefs.rtl })} title="由右往左翻（日式漫畫）">右翻</button>
        </>
    );
    const order = prefs.rtl ? [...shown].reverse() : shown;
    return (
        <div className={`reader-comic fit-${prefs.fit}${prefs.spread ? " spread" : ""}`}>
            {toolsEl && createPortal(tools, toolsEl)}
            <div
                className="reader-comic-pages"
                onClick={(e) => {
                    // Click the left or right half of the page to turn it.
                    const r = e.currentTarget.getBoundingClientRect();
                    const left = e.clientX < r.left + r.width / 2;
                    turn(left === prefs.rtl ? 1 : -1);
                }}
            >
                {order.map((n) => (urls[n] ? <img key={n} src={urls[n]!} alt={`第 ${n + 1} 頁`} draggable={false} /> : <div key={n} className="reader-comic-loading" />))}
            </div>
        </div>
    );
}

export default ComicView;
