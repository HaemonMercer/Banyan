import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { errorMessage } from "../../drawer/api";
import Markdown from "../../markdown/Markdown";
import { whiteboardApi, type CardDetail, type CardVersion } from "../../whiteboard/api";
import { changeStats, diffDocument, diffInline, type DiffPart } from "../../whiteboard/diff";
import { ask } from "../Feedback";

interface Props {
    card: CardDetail;
    /** The card was put back to a version. */
    onRestored: (card: CardDetail) => void;
    onClose: () => void;
    onError: (text: string) => void;
}

const untitled = (t: string) => t || "（無標題）";
const time = (ms: number) => new Date(ms).toLocaleTimeString("zh-TW", { hour: "numeric", minute: "2-digit" });
const longDate = (ms: number) =>
    new Date(ms).toLocaleString("zh-TW", { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });

/** "今天", "昨天", "11月9日" or "2025年11月9日". */
function dayLabel(ms: number): string {
    const d = new Date(ms);
    const today = new Date();
    const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((startOf(today) - startOf(d)) / 86_400_000);
    if (days === 0) return "今天";
    if (days === 1) return "昨天";
    return d.toLocaleDateString("zh-TW", d.getFullYear() === today.getFullYear() ? { month: "long", day: "numeric" } : { year: "numeric", month: "long", day: "numeric" });
}

function Parts({ parts }: { parts: DiffPart[] }) {
    return (
        <>
            {parts.map((p, i) =>
                p.kind === "same" ? (
                    <span key={i}>{p.text}</span>
                ) : p.kind === "add" ? (
                    <ins key={i} className="vh-ins">{p.text}</ins>
                ) : (
                    <del key={i} className="vh-del">{p.text}</del>
                ),
            )}
        </>
    );
}

/**
 * Google Docs-style version history of a card, over the whole window: the selected version as a
 * document (with the changes since the version before it highlighted), and the versions on the
 * right, grouped by day. Versions are recorded automatically as the card is edited.
 */
function VersionHistory({ card, onRestored, onClose, onError }: Props) {
    const [versions, setVersions] = useState<CardVersion[] | null>(null);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [showChanges, setShowChanges] = useState(true);
    const [namedOnly, setNamedOnly] = useState(false);
    /** Version whose name is being edited inline. */
    const [naming, setNaming] = useState<{ id: number; value: string } | null>(null);
    const [menuFor, setMenuFor] = useState<number | null>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const load = useCallback(
        async (select?: number) => {
            try {
                const list = await whiteboardApi.listCardVersions(card.id);
                setVersions(list);
                setSelectedId((cur) => {
                    const want = select ?? cur;
                    return want !== null && list.some((v) => v.id === want) ? want : (list[0]?.id ?? null);
                });
            } catch (e) {
                onError(errorMessage(e));
            }
        },
        [card.id, onError],
    );

    useEffect(() => {
        void load();
    }, [load]);

    // Close the ⋮ menu on any click elsewhere.
    useEffect(() => {
        if (menuFor === null) return;
        const close = (e: MouseEvent) => {
            if (!(e.target as HTMLElement).closest(".vh-menu, .vh-more")) setMenuFor(null);
        };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, [menuFor]);

    const latest = versions?.[0] ?? null;
    const shown = useMemo(
        () => (versions ?? []).filter((v) => !namedOnly || v.name || v.id === latest?.id),
        [versions, namedOnly, latest],
    );
    const index = shown.findIndex((v) => v.id === selectedId);
    const selected = index >= 0 ? shown[index] : (versions?.find((v) => v.id === selectedId) ?? null);
    /** Compared with the version listed below it. */
    const previous = index >= 0 ? (shown[index + 1] ?? null) : null;

    const blocks = useMemo(
        // The first version has nothing before it: shown as a plain document, like Google Docs.
        () => (selected && previous && showChanges ? diffDocument(previous.content, selected.content) : null),
        [selected, previous, showChanges],
    );
    const stats = blocks ? changeStats(blocks) : null;
    const titleParts = useMemo(
        () => (selected && showChanges && previous && previous.title !== selected.title ? diffInline(previous.title, selected.title) : null),
        [selected, previous, showChanges],
    );

    const groups = useMemo(() => {
        const out: { label: string; items: CardVersion[] }[] = [];
        for (const v of shown) {
            const label = dayLabel(v.updatedAt);
            const last = out[out.length - 1];
            if (last && last.label === label) last.items.push(v);
            else out.push({ label, items: [v] });
        }
        return out;
    }, [shown]);

    const commitName = async () => {
        if (!naming) return;
        const { id, value } = naming;
        setNaming(null);
        const v = versions?.find((x) => x.id === id);
        if (!v || v.name === value.trim()) return;
        try {
            // The current version is named through create (it never duplicates the latest state).
            if (id === latest?.id && !v.name) await whiteboardApi.createCardVersion(card.id, value);
            else await whiteboardApi.renameCardVersion(id, value);
            await load(id);
        } catch (e) {
            onError(errorMessage(e));
        }
    };

    const restore = async (v: CardVersion) => {
        setMenuFor(null);
        if (!(await ask({ title: `把卡片還原到 ${longDate(v.updatedAt)} 的版本？`, message: "目前的內容會保留在版本記錄中。", confirm: "還原" }))) return;
        try {
            onRestored(await whiteboardApi.restoreCardVersion(v.id));
        } catch (e) {
            onError(errorMessage(e));
        }
    };

    const remove = async (v: CardVersion) => {
        setMenuFor(null);
        if (!(await ask({ title: `刪除 ${longDate(v.updatedAt)} 的版本${v.name ? `「${v.name}」` : ""}？`, message: "此動作無法復原。", confirm: "刪除", danger: true }))) return;
        try {
            await whiteboardApi.deleteCardVersion(v.id);
            await load();
        } catch (e) {
            onError(errorMessage(e));
        }
    };

    const move = (step: number) => {
        const next = shown[index + step];
        if (!next) return;
        setSelectedId(next.id);
        listRef.current?.querySelector<HTMLElement>(`[data-version="${next.id}"]`)?.focus();
    };

    const isCurrent = selected !== null && selected.id === latest?.id;

    return createPortal(
        <div
            className="vh-page"
            role="dialog"
            aria-label="版本記錄"
            onKeyDown={(e) => {
                if (e.key === "Escape" && !naming) {
                    e.stopPropagation();
                    if (menuFor !== null) setMenuFor(null);
                    else onClose();
                }
            }}
        >
            <header className="vh-top">
                <button className="icon-btn vh-back" title="返回卡片（Esc）" autoFocus onClick={onClose}>←</button>
                <div className="vh-top-title">
                    <div className="vh-top-name">{selected ? (selected.name || longDate(selected.updatedAt)) : "版本記錄"}</div>
                    <div className="vh-top-sub muted">
                        {untitled(card.title)}
                        {stats && previous && (
                            <>
                                {" · "}
                                <span className="vh-plus">＋{stats.added}</span> <span className="vh-minus">－{stats.removed}</span> 字
                            </>
                        )}
                    </div>
                </div>
                {selected && !isCurrent && (
                    <button className="primary-btn" onClick={() => void restore(selected)}>還原此版本</button>
                )}
            </header>

            <div className="vh-main">
                <div className="vh-doc-wrap">
                    {selected ? (
                        <article className="vh-doc">
                            <h1 className="vh-doc-title">{titleParts ? <Parts parts={titleParts} /> : untitled(selected.title)}</h1>
                            {blocks ? (
                                blocks.length === 0 ? (
                                    <p className="muted">（沒有內容）</p>
                                ) : (
                                    blocks.map((b, i) =>
                                        b.kind === "same" ? (
                                            <Markdown key={i} source={b.text} />
                                        ) : (
                                            <div key={i} className="vh-changed">
                                                <Parts parts={b.parts} />
                                            </div>
                                        ),
                                    )
                                )
                            ) : selected.content.trim() ? (
                                <Markdown source={selected.content} />
                            ) : (
                                <p className="muted">（沒有內容）</p>
                            )}
                        </article>
                    ) : (
                        <p className="muted vh-empty">{versions === null ? "載入中…" : "還沒有版本。"}</p>
                    )}
                </div>

                <aside className="vh-side">
                    <h2 className="vh-side-title">版本記錄</h2>
                    <div className="vh-list" ref={listRef} role="listbox" aria-label="版本">
                        {groups.map((g) => (
                            <section key={g.label} className="vh-group">
                                <h3 className="vh-day">{g.label}</h3>
                                {g.items.map((v) => {
                                    const current = v.id === latest?.id;
                                    return (
                                        <div key={v.id} className={`vh-item${v.id === selectedId ? " selected" : ""}`}>
                                            <div
                                                role="option"
                                                tabIndex={0}
                                                aria-selected={v.id === selectedId}
                                                data-version={v.id}
                                                className="vh-item-main"
                                                onClick={() => setSelectedId(v.id)}
                                                onKeyDown={(e) => {
                                                    if (naming) return;
                                                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                                                        e.preventDefault();
                                                        move(e.key === "ArrowDown" ? 1 : -1);
                                                    }
                                                }}
                                            >
                                                {naming?.id === v.id ? (
                                                    <input
                                                        autoFocus
                                                        className="vh-name-input"
                                                        value={naming.value}
                                                        maxLength={100}
                                                        placeholder="版本名稱"
                                                        onClick={(e) => e.stopPropagation()}
                                                        onChange={(e) => setNaming({ id: v.id, value: e.target.value })}
                                                        onBlur={() => void commitName()}
                                                        onKeyDown={(e) => {
                                                            e.stopPropagation();
                                                            if (e.key === "Enter") void commitName();
                                                            if (e.key === "Escape") setNaming(null);
                                                        }}
                                                    />
                                                ) : v.name ? (
                                                    <div className="vh-item-name">{v.name}</div>
                                                ) : null}
                                                <div className={v.name || naming?.id === v.id ? "vh-item-time muted" : "vh-item-time"}>
                                                    {g.label === "今天" || g.label === "昨天" ? time(v.updatedAt) : longDate(v.updatedAt)}
                                                </div>
                                                {current && <div className="vh-item-current">目前版本</div>}
                                            </div>
                                            <button
                                                className="icon-btn vh-more"
                                                title="更多動作"
                                                aria-haspopup="menu"
                                                onClick={() => setMenuFor(menuFor === v.id ? null : v.id)}
                                            >
                                                ⋮
                                            </button>
                                            {menuFor === v.id && (
                                                <div className="vh-menu" role="menu">
                                                    <button
                                                        role="menuitem"
                                                        onClick={() => {
                                                            setMenuFor(null);
                                                            setSelectedId(v.id);
                                                            setNaming({ id: v.id, value: v.name });
                                                        }}
                                                    >
                                                        {v.name ? "重新命名" : "為這個版本命名"}
                                                    </button>
                                                    {!current && (
                                                        <button role="menuitem" onClick={() => void restore(v)}>還原此版本</button>
                                                    )}
                                                    {!current && (
                                                        <button role="menuitem" className="danger" onClick={() => void remove(v)}>刪除此版本</button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </section>
                        ))}
                        {versions !== null && shown.length === 0 && <p className="muted vh-empty">沒有版本。</p>}
                    </div>
                    <footer className="vh-side-foot">
                        <label>
                            <input type="checkbox" checked={namedOnly} onChange={(e) => setNamedOnly(e.target.checked)} />
                            只顯示已命名的版本
                        </label>
                        <label>
                            <input type="checkbox" checked={showChanges} onChange={(e) => setShowChanges(e.target.checked)} />
                            顯示變更
                        </label>
                    </footer>
                </aside>
            </div>
        </div>,
        document.body,
    );
}

export default VersionHistory;
