import { useCallback, useEffect, useMemo, useState } from "react";
import { errorMessage } from "../drawer/api";
import { usePersistentSet } from "../drawer/usePersistentSet";
import { whiteboardApi, type BoardFolder, type TagCount, type Whiteboard } from "../whiteboard/api";
import { folderPath, folderSubtree } from "../whiteboard/folders";
import GraphView from "./graph/GraphView";
import "./whiteboard/Whiteboard.css";
import "./graph/Graph.css";
import { Icon } from "../icons/Icon";

/** Which cards the graph shows. */
type Scope = { kind: "all" } | { kind: "folder"; id: number } | { kind: "board"; id: number };

const SCOPE_KEY = "banyan.graph.scope";

function savedScope(): Scope {
    try {
        const v = JSON.parse(localStorage.getItem(SCOPE_KEY) ?? "null");
        if (v && (v.kind === "all" || ((v.kind === "folder" || v.kind === "board") && typeof v.id === "number"))) return v;
    } catch {
        /* storage unavailable or bad value */
    }
    return { kind: "all" };
}

interface Props {
    /** Opens a card in Whiteboard (on the given board). */
    onOpenCard: (cardId: number, boardId: number) => void;
    /** Opens a Drawer item. */
    onOpenItem: (itemId: number) => void;
}

/**
 * Graph module: the relationship graph of cards and the Drawer items they cite, on its own
 * page. The left pane picks which cards to show: all of them, a folder of whiteboards, or one board.
 */
function GraphModule({ onOpenCard, onOpenItem }: Props) {
    const [boards, setBoards] = useState<Whiteboard[]>([]);
    const [folders, setFolders] = useState<BoardFolder[]>([]);
    const [scope, setScopeState] = useState<Scope>(savedScope);
    const [collapsed, toggleCollapsed] = usePersistentSet("banyan.graph.collapsedFolders");
    const [toast, setToast] = useState<string | null>(null);
    const [tags, setTags] = useState<TagCount[]>([]);
    /** Only cards with this tag (combined with the scope). */
    const [tag, setTag] = useState<string | null>(null);
    const showError = useCallback((text: string) => setToast(text), []);

    const setScope = (s: Scope) => {
        setScopeState(s);
        try {
            localStorage.setItem(SCOPE_KEY, JSON.stringify(s));
        } catch {
            /* storage unavailable */
        }
    };

    useEffect(() => {
        Promise.all([whiteboardApi.listWhiteboards(), whiteboardApi.listFolders(), whiteboardApi.listCardTags()]).then(
            ([b, f, t]) => {
                setBoards(b);
                setFolders(f);
                setTags(t);
            },
            (e) => showError(errorMessage(e)),
        );
    }, [showError]);

    // A saved board or folder that no longer exists falls back to everything.
    const valid =
        scope.kind === "all" ||
        (scope.kind === "board" ? boards.some((b) => b.id === scope.id) : folders.some((f) => f.id === scope.id));
    const effective: Scope = valid || boards.length + folders.length === 0 ? scope : { kind: "all" };

    const boardIds = useMemo((): number[] | null => {
        if (effective.kind === "all") return null;
        if (effective.kind === "board") return [effective.id];
        const sub = folderSubtree(folders, effective.id);
        return boards.filter((b) => b.folderId !== null && sub.has(b.folderId)).map((b) => b.id);
    }, [effective.kind, effective.kind === "all" ? 0 : effective.id, boards, folders]); // eslint-disable-line react-hooks/exhaustive-deps

    const title =
        effective.kind === "all"
            ? "全部卡片"
            : effective.kind === "folder"
              ? folderPath(folders, effective.id)
              : boards.find((b) => b.id === effective.id)?.name ?? "";

    const isSel = (s: Scope) =>
        s.kind === effective.kind && (s.kind === "all" || (effective.kind !== "all" && s.id === effective.id));

    const renderLevel = (parentId: number | null, depth: number): React.ReactNode => (
        <>
            {folders
                .filter((f) => f.parentId === parentId)
                .map((f) => {
                    const hasKids = folders.some((x) => x.parentId === f.id) || boards.some((b) => b.folderId === f.id);
                    const open = !collapsed.has(String(f.id));
                    return (
                        <li key={`f${f.id}`}>
                            <div
                                className={`tree-row${isSel({ kind: "folder", id: f.id }) ? " selected" : ""}`}
                                style={{ paddingLeft: 8 + depth * 14 }}
                                title={`${folderPath(folders, f.id)}（含子資料夾裡的白板）`}
                                onClick={() => setScope({ kind: "folder", id: f.id })}
                            >
                                <span
                                    className="tree-twisty"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        toggleCollapsed(String(f.id));
                                    }}
                                >
                                    {hasKids ? <Icon name={open ? "chevronDown" : "chevronRight"} /> : ""}
                                </span>
                                <Icon name={open && hasKids ? "folderOpen" : "folder"} className="tree-icon" />
                                <span className="tree-label">{f.name}</span>
                            </div>
                            {open && hasKids && <ul>{renderLevel(f.id, depth + 1)}</ul>}
                        </li>
                    );
                })}
            {boards
                .filter((b) => b.folderId === parentId)
                .map((b) => (
                    <li key={`b${b.id}`}>
                        <div
                            className={`tree-row${isSel({ kind: "board", id: b.id }) ? " selected" : ""}`}
                            style={{ paddingLeft: 8 + depth * 14 }}
                            onClick={() => setScope({ kind: "board", id: b.id })}
                            title={b.name}
                        >
                            <span className="tree-twisty" />
                            <Icon name="board" className="tree-icon" />
                            <span className="tree-label">{b.name}</span>
                            <span className="wb-board-count muted">{b.cardCount}</span>
                        </div>
                    </li>
                ))}
        </>
    );

    return (
        <div className="graph-module">
            <aside className="drawer-pane drawer-tree graph-scope">
                <div className="pane-header">
                    <span className="pane-title">關係圖</span>
                </div>
                <ul className="tree">
                    <li>
                        <div
                            className={`tree-row${effective.kind === "all" ? " selected" : ""}`}
                            onClick={() => setScope({ kind: "all" })}
                            title="所有卡片，包括不在任何白板上的"
                        >
                            <span className="tree-twisty" />
                            <Icon name="graph" className="tree-icon" />
                            <span className="tree-label">全部卡片</span>
                        </div>
                    </li>
                </ul>
                <ul className="tree tree-collections">{renderLevel(null, 0)}</ul>
                <p className="muted graph-scope-hint">選擇範圍：全部卡片、一個資料夾（含子資料夾）或一個白板。</p>
                {tags.length > 0 && (
                    <div className="graph-tags">
                        <div className="graph-tags-title">標籤</div>
                        <button className={`wb-tag cl-tag${tag === null ? " active" : ""}`} onClick={() => setTag(null)}>
                            全部
                        </button>
                        {tags.map((t) => (
                            <button
                                key={t.name}
                                className={`wb-tag cl-tag${tag === t.name ? " active" : ""}`}
                                onClick={() => setTag(tag === t.name ? null : t.name)}
                            >
                                #{t.name} <span className="cl-tag-count">{t.count}</span>
                            </button>
                        ))}
                    </div>
                )}
            </aside>
            <GraphView
                boards={boards}
                boardIds={boardIds}
                tag={tag}
                title={tag ? `${title} · #${tag}` : title}
                reloadKey={0}
                onOpenCard={(cardId, boardId) => {
                    if (boardId === null) showError("這張卡片不在任何白板上，無法在白板中開啟");
                    else onOpenCard(cardId, boardId);
                }}
                onOpenItem={onOpenItem}
                onError={showError}
            />
            {toast && (
                <div className="toast" onClick={() => setToast(null)}>
                    {toast}
                    <span className="toast-close">×</span>
                </div>
            )}
        </div>
    );
}

export default GraphModule;
