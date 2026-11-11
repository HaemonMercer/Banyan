import { useEffect, useRef, useState } from "react";
import { usePersistentSet } from "../../drawer/usePersistentSet";
import type { BoardFolder, Whiteboard } from "../../whiteboard/api";
import { folderPath, folderSubtree } from "../../whiteboard/folders";
import { Icon } from "../../icons/Icon";

export { folderPath, folderSubtree };

/** What is being dragged inside the tree. */
type TreeDrag = { kind: "board" | "folder"; id: number; name: string; x: number; y: number; target: number | "root" | null };

interface Props {
    folders: BoardFolder[];
    boards: Whiteboard[];
    boardId: number | null;
    /** The card library is shown (instead of a board). */
    libraryActive: boolean;
    onOpenLibrary: () => void;
    onOpenBoard: (id: number) => void;
    onCreateBoard: (folderId: number | null) => void;
    /** Board being renamed (e.g. right after it was created). */
    renamingBoard: number | null;
    setRenamingBoard: (id: number | null) => void;
    onRenameBoard: (id: number, name: string) => void;
    onDeleteBoard: (b: Whiteboard) => void;
    onCreateFolder: (name: string, parentId: number | null) => Promise<void>;
    onRenameFolder: (id: number, name: string) => Promise<void>;
    onDeleteFolder: (f: BoardFolder) => void;
    onMoveBoard: (id: number, folderId: number | null) => void;
    onMoveFolder: (id: number, parentId: number | null) => void;
}

function NameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
    const [value, setValue] = useState(initial);
    const done = useRef(false);
    const finish = (save: boolean) => {
        if (done.current) return;
        done.current = true;
        onDone(save && value.trim() ? value.trim() : null);
    };
    return (
        <input
            className="tree-input"
            autoFocus
            value={value}
            onFocus={(e) => e.currentTarget.select()}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => finish(true)}
            onKeyDown={(e) => {
                if (e.key === "Enter") finish(true);
                if (e.key === "Escape") finish(false);
            }}
        />
    );
}

/** Left pane: whiteboards sorted into nested folders. Drag boards or folders onto a folder to move them. */
function BoardTree(props: Props) {
    const { folders, boards, boardId } = props;
    const [collapsed, toggleCollapsed] = usePersistentSet("banyan.whiteboard.collapsedFolders");
    const [renamingFolder, setRenamingFolder] = useState<number | null>(null);
    /** undefined = not adding; null = top level; number = inside that folder. */
    const [addingUnder, setAddingUnder] = useState<number | null | undefined>(undefined);
    const [drag, setDrag] = useState<TreeDrag | null>(null);
    const [menu, setMenu] = useState(false);

    const isOpen = (id: number) => !collapsed.has(String(id));
    const open = (id: number) => {
        if (!isOpen(id)) toggleCollapsed(String(id));
    };

    // Keep the open board's folders expanded.
    useEffect(() => {
        const b = boards.find((x) => x.id === boardId);
        let f = folders.find((x) => x.id === b?.folderId);
        let guard = 0;
        while (f && guard++ < 100) {
            if (collapsed.has(String(f.id))) toggleCollapsed(String(f.id));
            f = folders.find((x) => x.id === f!.parentId);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [boardId, boards.length, folders.length]);

    // Hovering a closed folder while dragging opens it.
    useEffect(() => {
        const t = drag?.target;
        if (typeof t !== "number" || isOpen(t)) return;
        const timer = setTimeout(() => open(t), 700);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [drag?.target]);

    const startDrag = (e: React.PointerEvent, kind: "board" | "folder", id: number, name: string) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest("input, button")) return;
        const sx = e.clientX;
        const sy = e.clientY;
        let current: TreeDrag | null = null;
        const targetAt = (x: number, y: number): number | "root" | null => {
            const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop-folder]");
            if (!el) return null;
            const v = el.dataset.dropFolder!;
            return v === "root" ? "root" : Number(v);
        };
        const move = (ev: PointerEvent) => {
            if (!current && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
            current = { kind, id, name, x: ev.clientX, y: ev.clientY, target: targetAt(ev.clientX, ev.clientY) };
            setDrag(current);
        };
        const cleanup = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("keydown", key, true);
            setDrag(null);
        };
        const up = (ev: PointerEvent) => {
            const d = current;
            cleanup();
            if (!d) return;
            const t = targetAt(ev.clientX, ev.clientY);
            if (t === null) return;
            const dest = t === "root" ? null : t;
            if (kind === "board") props.onMoveBoard(id, dest);
            else props.onMoveFolder(id, dest);
        };
        const key = (ev: KeyboardEvent) => {
            if (ev.key === "Escape") {
                ev.stopPropagation();
                current = null;
                cleanup();
            }
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("keydown", key, true);
    };

    const dragHint = (() => {
        if (!drag) return "";
        if (drag.target === null) return "拖到資料夾上";
        const destName = drag.target === "root" ? "最上層" : `「${folderPath(folders, drag.target)}」`;
        if (drag.kind === "folder" && typeof drag.target === "number" && folderSubtree(folders, drag.id).has(drag.target)) {
            return "不能移到自己裡面";
        }
        return `移到${destName}`;
    })();

    const renderBoard = (b: Whiteboard, depth: number) => (
        <li key={`b${b.id}`}>
            <div
                className={`tree-row${b.id === boardId ? " selected" : ""}${drag?.kind === "board" && drag.id === b.id ? " dragging" : ""}`}
                style={{ paddingLeft: 8 + depth * 14 }}
                onClick={() => props.onOpenBoard(b.id)}
                onDoubleClick={() => props.setRenamingBoard(b.id)}
                onPointerDown={(e) => startDrag(e, "board", b.id, b.name)}
                title={b.folderId !== null ? `${folderPath(folders, b.folderId)}/${b.name}` : b.name}
            >
                <span className="tree-twisty" />
                <Icon name="board" className="tree-icon" />
                {props.renamingBoard === b.id ? (
                    <NameInput
                        initial={b.name}
                        onDone={(name) => {
                            props.setRenamingBoard(null);
                            if (name && name !== b.name) props.onRenameBoard(b.id, name);
                        }}
                    />
                ) : (
                    <span className="tree-label">{b.name}</span>
                )}
                <span className="wb-board-count muted">{b.cardCount}</span>
                <span className="tree-actions" onClick={(e) => e.stopPropagation()}>
                    <button title="重新命名" onClick={() => props.setRenamingBoard(b.id)}><Icon name="edit" /></button>
                    <button title="刪除白板" onClick={() => props.onDeleteBoard(b)}><Icon name="trash" /></button>
                </span>
            </div>
        </li>
    );

    const renderLevel = (parentId: number | null, depth: number): React.ReactNode => (
        <>
            {folders
                .filter((f) => f.parentId === parentId)
                .map((f) => {
                    const opened = isOpen(f.id);
                    const kids = folders.some((x) => x.parentId === f.id) || boards.some((b) => b.folderId === f.id);
                    return (
                        <li key={`f${f.id}`}>
                            <div
                                className={`tree-row wb-folder-row${drag?.target === f.id ? " drop-target" : ""}`}
                                style={{ paddingLeft: 8 + depth * 14 }}
                                data-drop-folder={f.id}
                                title={folderPath(folders, f.id)}
                                onClick={() => toggleCollapsed(String(f.id))}
                                onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    setRenamingFolder(f.id);
                                }}
                                onPointerDown={(e) => startDrag(e, "folder", f.id, f.name)}
                            >
                                <span className="tree-twisty">{kids ? <Icon name={opened ? "chevronDown" : "chevronRight"} /> : ""}</span>
                                <Icon name={opened && kids ? "folderOpen" : "folder"} className="tree-icon" />
                                {renamingFolder === f.id ? (
                                    <NameInput
                                        initial={f.name}
                                        onDone={async (name) => {
                                            setRenamingFolder(null);
                                            if (name && name !== f.name) await props.onRenameFolder(f.id, name);
                                        }}
                                    />
                                ) : (
                                    <span className="tree-label">{f.name}</span>
                                )}
                                <span className="tree-actions" onClick={(e) => e.stopPropagation()}>
                                    <button
                                        title="在這個資料夾新增白板"
                                        onClick={() => {
                                            open(f.id);
                                            props.onCreateBoard(f.id);
                                        }}
                                    ><Icon name="board" /></button>
                                    <button
                                        title="新增子資料夾"
                                        onClick={() => {
                                            open(f.id);
                                            setAddingUnder(f.id);
                                        }}
                                    ><Icon name="plus" /></button>
                                    <button title="重新命名" onClick={() => setRenamingFolder(f.id)}><Icon name="edit" /></button>
                                    <button title="刪除資料夾" onClick={() => props.onDeleteFolder(f)}><Icon name="trash" /></button>
                                </span>
                            </div>
                            {opened && (kids || addingUnder === f.id) && <ul>{renderLevel(f.id, depth + 1)}</ul>}
                        </li>
                    );
                })}
            {addingUnder === parentId && (
                <li>
                    <div className="tree-row" style={{ paddingLeft: 8 + depth * 14 }}>
                        <span className="tree-twisty" />
                        <Icon name="folder" className="tree-icon" />
                        <NameInput
                            initial="新資料夾"
                            onDone={async (name) => {
                                setAddingUnder(undefined);
                                if (name) await props.onCreateFolder(name, parentId);
                            }}
                        />
                    </div>
                </li>
            )}
            {boards.filter((b) => b.folderId === parentId).map((b) => renderBoard(b, depth))}
        </>
    );

    return (
        <aside className="drawer-pane drawer-tree wb-boards">
            <div
                className={`pane-header wb-boards-header${drag?.target === "root" ? " drop-target" : ""}`}
                data-drop-folder="root"
                title="拖到這裡：移到最上層"
            >
                <span className="pane-title">白板</span>
                <div className="wb-new-menu">
                    <button className="icon-btn" title="新增" onClick={() => setMenu((m) => !m)}><Icon name="plus" /></button>
                    {menu && (
                        <>
                            <div className="menu-backdrop" onClick={() => setMenu(false)} />
                            <ul className="wb-mini-menu">
                                <li>
                                    <button
                                        onClick={() => {
                                            setMenu(false);
                                            props.onCreateBoard(null);
                                        }}
                                    ><Icon name="board" /> 新白板</button>
                                </li>
                                <li>
                                    <button
                                        onClick={() => {
                                            setMenu(false);
                                            setAddingUnder(null);
                                        }}
                                    ><Icon name="folderPlus" /> 新資料夾</button>
                                </li>
                            </ul>
                        </>
                    )}
                </div>
            </div>
            <ul className="tree">
                <li>
                    <div
                        className={`tree-row${props.libraryActive ? " selected" : ""}`}
                        onClick={props.onOpenLibrary}
                        title="所有卡片，包括不在任何白板上的"
                    >
                        <span className="tree-twisty" />
                        <Icon name="cards" className="tree-icon" />
                        <span className="tree-label">卡片庫</span>
                    </div>
                </li>
            </ul>
            <ul className="tree tree-collections">{renderLevel(null, 0)}</ul>
            {boards.length === 0 && folders.length === 0 && addingUnder === undefined && (
                <p className="muted wb-boards-empty">還沒有白板，按 ＋ 新增</p>
            )}
            {drag && (
                <div className="drag-ghost" style={{ left: drag.x + 14, top: drag.y + 10 }}>
                    <div className="drag-ghost-title"><Icon name={drag.kind === "board" ? "board" : "folder"} /> {drag.name}</div>
                    <div className="drag-ghost-hint">{dragHint}</div>
                </div>
            )}
        </aside>
    );
}

export default BoardTree;
