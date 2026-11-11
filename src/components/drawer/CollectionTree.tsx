import { useEffect, useState } from "react";
import type { Collection, TagInfo } from "../../drawer/api";
import { collectionPath } from "../../drawer/collections";
import type { DropTarget } from "../../drawer/useItemDrag";
import { usePersistentSet } from "../../drawer/usePersistentSet";
import { Icon } from "../../icons/Icon";

export type LibraryView =
    | { kind: "all" }
    | { kind: "unfiled" }
    | { kind: "collection"; id: number }
    | { kind: "tag"; id: number };

interface Props {
    collections: Collection[];
    view: LibraryView;
    onSelect: (view: LibraryView) => void;
    onCreate: (name: string, parentId: number | null) => Promise<void>;
    onRename: (id: number, name: string) => Promise<void>;
    onDelete: (collection: Collection) => void;
    onOpenSettings: () => void;
    tags: TagInfo[];
    onRenameTag: (id: number, name: string) => Promise<void>;
    onDeleteTag: (tag: TagInfo) => void;
    /** Folder or tag currently under a dragged item (highlighted; folders auto-expand after a moment). */
    dropTarget: DropTarget | null;
}

/** Inline text box used for both "new folder" and "rename". */
function NameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
    const [value, setValue] = useState(initial);
    const finish = (save: boolean) => onDone(save && value.trim() ? value.trim() : null);
    return (
        <input
            className="tree-input"
            autoFocus
            value={value}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => finish(true)}
            onKeyDown={(e) => {
                if (e.key === "Enter") finish(true);
                if (e.key === "Escape") finish(false);
            }}
        />
    );
}

function CollectionTree({
    collections, view, onSelect, onCreate, onRename, onDelete, onOpenSettings,
    tags, onRenameTag, onDeleteTag, dropTarget,
}: Props) {
    const dropTargetId = dropTarget?.kind === "collection" ? dropTarget.id : null;
    const dropTagId = dropTarget?.kind === "tag" ? dropTarget.id : null;
    const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
    /** Folded sections of this pane ("folders", "tags"), remembered between sessions. */
    const [folded, toggleFolded] = usePersistentSet("banyan.drawer.leftFolded");
    const [renamingTag, setRenamingTag] = useState<number | null>(null);
    const [renaming, setRenaming] = useState<number | null>(null);
    /** `undefined` = not adding; `null` = adding at top level; number = adding under that parent. */
    const [addingUnder, setAddingUnder] = useState<number | null | undefined>(undefined);

    // Hovering a collapsed folder while dragging opens it, so sub-folders are reachable.
    useEffect(() => {
        if (dropTargetId === null || !collapsed.has(dropTargetId)) return;
        const t = setTimeout(() => {
            setCollapsed((prev) => {
                const next = new Set(prev);
                next.delete(dropTargetId);
                return next;
            });
        }, 700);
        return () => clearTimeout(t);
    }, [dropTargetId, collapsed]);

    const childrenOf = (parentId: number | null) => collections.filter((c) => c.parentId === parentId);

    const toggle = (id: number) =>
        setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const finishAdd = async (name: string | null) => {
        const parent = addingUnder;
        setAddingUnder(undefined);
        if (name && parent !== undefined) await onCreate(name, parent);
    };

    const renderNodes = (parentId: number | null, depth: number) => (
        <>
            {childrenOf(parentId).map((c) => {
                const kids = childrenOf(c.id);
                const isOpen = !collapsed.has(c.id);
                const selected = view.kind === "collection" && view.id === c.id;
                return (
                    <li key={c.id}>
                        <div
                            className={`tree-row${selected ? " selected" : ""}${dropTargetId === c.id ? " drop-target" : ""}`}
                            style={{ paddingLeft: 8 + depth * 14 }}
                            data-drop-collection={c.id}
                            title={collectionPath(collections, c.id)}
                            onClick={() => onSelect({ kind: "collection", id: c.id })}
                            onDoubleClick={() => setRenaming(c.id)}
                        >
                            <span
                                className="tree-twisty"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    toggle(c.id);
                                }}
                            >
                                {kids.length > 0 ? <Icon name={isOpen ? "chevronDown" : "chevronRight"} /> : ""}
                            </span>
                            <Icon name="folder" className="tree-icon" />
                            {renaming === c.id ? (
                                <NameInput
                                    initial={c.name}
                                    onDone={async (name) => {
                                        setRenaming(null);
                                        if (name && name !== c.name) await onRename(c.id, name);
                                    }}
                                />
                            ) : (
                                <span className="tree-label">{c.name}</span>
                            )}
                            <span className="tree-actions" onClick={(e) => e.stopPropagation()}>
                                <button
                                    title="新增子資料夾"
                                    onClick={() => {
                                        setCollapsed((p) => {
                                            const n = new Set(p);
                                            n.delete(c.id);
                                            return n;
                                        });
                                        setAddingUnder(c.id);
                                    }}
                                ><Icon name="plus" /></button>
                                <button title="重新命名" onClick={() => setRenaming(c.id)}><Icon name="edit" /></button>
                                <button title="刪除資料夾" onClick={() => onDelete(c)}><Icon name="trash" /></button>
                            </span>
                        </div>
                        {isOpen && (kids.length > 0 || addingUnder === c.id) && (
                            <ul>{renderNodes(c.id, depth + 1)}</ul>
                        )}
                    </li>
                );
            })}
            {addingUnder === parentId && (
                <li>
                    <div className="tree-row" style={{ paddingLeft: 8 + depth * 14 }}>
                        <span className="tree-twisty" />
                        <Icon name="folder" className="tree-icon" />
                        <NameInput initial="新資料夾" onDone={finishAdd} />
                    </div>
                </li>
            )}
        </>
    );

    const sectionHead = (id: string, title: string, count: number | null, action?: React.ReactNode) => (
        <div className="tree-section-head">
            <button className="tree-section-toggle" aria-expanded={!folded.has(id)} onClick={() => toggleFolded(id)}>
                <span className="section-caret"><Icon name={folded.has(id) ? "chevronRight" : "chevronDown"} /></span>
                {title}
                {count !== null && count > 0 && <span className="section-count">{count}</span>}
            </button>
            {action}
        </div>
    );

    return (
        <nav className="drawer-pane drawer-tree">
            <div className="pane-header">
                <span>文獻庫</span>
            </div>
            <ul className="tree">
                <li>
                    <div
                        className={`tree-row${view.kind === "all" ? " selected" : ""}`}
                        onClick={() => onSelect({ kind: "all" })}
                    >
                        <span className="tree-twisty" />
                        <Icon name="library" className="tree-icon" />
                        <span className="tree-label">我的文獻庫</span>
                    </div>
                </li>
                <li>
                    <div
                        className={`tree-row${view.kind === "unfiled" ? " selected" : ""}`}
                        onClick={() => onSelect({ kind: "unfiled" })}
                    >
                        <span className="tree-twisty" />
                        <Icon name="inbox" className="tree-icon" />
                        <span className="tree-label">未分類</span>
                    </div>
                </li>
            </ul>
            <div className="tree-scroll">
                {sectionHead(
                    "folders",
                    "資料夾",
                    collections.length,
                    <button
                        className="icon-btn"
                        title="新增資料夾"
                        onClick={() => {
                            if (folded.has("folders")) toggleFolded("folders");
                            setAddingUnder(null);
                        }}
                    ><Icon name="plus" /></button>,
                )}
                {!folded.has("folders") && (
                    <ul className="tree tree-collections">
                        {renderNodes(null, 0)}
                        {collections.length === 0 && addingUnder === undefined && (
                            <li className="tree-empty muted">按 ＋ 新增資料夾</li>
                        )}
                    </ul>
                )}

                {sectionHead("tags", "標籤", tags.length)}
                {!folded.has("tags") && (
                    <ul className="tree tree-tags">
                        {tags.length === 0 && <li className="tree-empty muted">在右欄為條目加上標籤後會出現在這裡</li>}
                        {tags.map((t) => {
                            const selected = view.kind === "tag" && view.id === t.id;
                            return (
                                <li key={t.id}>
                                    <div
                                        className={`tree-row${selected ? " selected" : ""}${dropTagId === t.id ? " drop-target" : ""}`}
                                        data-drop-tag={t.id}
                                        title={`${t.name}（${t.count} 個條目）`}
                                        onClick={() => onSelect({ kind: "tag", id: t.id })}
                                        onDoubleClick={() => setRenamingTag(t.id)}
                                    >
                                        <span className="tree-twisty" />
                                        <Icon name="tag" className="tree-icon" />
                                        {renamingTag === t.id ? (
                                            <NameInput
                                                initial={t.name}
                                                onDone={async (name) => {
                                                    setRenamingTag(null);
                                                    if (name && name !== t.name) await onRenameTag(t.id, name);
                                                }}
                                            />
                                        ) : (
                                            <span className="tree-label">{t.name}</span>
                                        )}
                                        <span className="tree-count">{t.count}</span>
                                        <span className="tree-actions" onClick={(e) => e.stopPropagation()}>
                                            <button title="重新命名標籤" onClick={() => setRenamingTag(t.id)}><Icon name="edit" /></button>
                                            <button title="刪除標籤" onClick={() => onDeleteTag(t)}><Icon name="trash" /></button>
                                        </span>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
            <button className="tree-footer" onClick={onOpenSettings} title="選擇資料庫和附件存放的資料夾">
                <Icon name="database" /> 資料庫位置
            </button>
        </nav>
    );
}

export default CollectionTree;
