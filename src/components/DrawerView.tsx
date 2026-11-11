import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { drawerApi, errorMessage, linkedNotice, type Collection, type ItemSummary, type TagInfo } from "../drawer/api";
import LibrarySettings from "./drawer/LibrarySettings";
import { useItemDrag, type DropTarget } from "../drawer/useItemDrag";
import { collectionPath } from "../drawer/collections";
import { NO_SELECTION, single, type Selection } from "../drawer/selection";
import CollectionTree, { type LibraryView } from "./drawer/CollectionTree";
import ItemList from "./drawer/ItemList";
import ItemDetail from "./drawer/ItemDetail";
import BulkEdit from "./drawer/BulkEdit";
import "./drawer/Drawer.css";

interface Props {
    /** Item to select when the view opens (e.g. coming from a whiteboard card). */
    initialItemId?: number | null;
    /** Opens a card in Whiteboard. */
    onOpenCard: (cardId: number, boardId: number) => void;
}

const DELETE_WARNING = "它們的附件檔案，以及只屬於這些條目、不在任何白板上的筆記卡片，也會一併刪除，無法復原。";

function DrawerView({ initialItemId = null, onOpenCard }: Props) {
    const [collections, setCollections] = useState<Collection[]>([]);
    const [tags, setTags] = useState<TagInfo[]>([]);
    const [view, setView] = useState<LibraryView>({ kind: "all" });
    const [items, setItems] = useState<ItemSummary[]>([]);
    const [query, setQuery] = useState("");
    const [selection, setSelection] = useState<Selection>(() => single(initialItemId));
    const [detailReload, setDetailReload] = useState(0);
    /** Bumped after list-wide changes so the bulk panel re-reads what the selection has in common. */
    const [bulkReload, setBulkReload] = useState(0);
    const [dragging, setDragging] = useState(false);
    const [toast, setToast] = useState<{ text: string; kind: "error" | "info" } | null>(null);
    const [showSettings, setShowSettings] = useState(false);

    /** The one item shown in the detail pane (null when none or several are selected). */
    const selectedId = selection.ids.length === 1 ? selection.ids[0] : null;
    const selectOnly = (id: number | null) => setSelection(single(id));

    const showError = useCallback((text: string) => setToast({ text, kind: "error" }), []);
    const showInfo = useCallback((text: string) => setToast({ text, kind: "info" }), []);

    // Info toasts fade on their own; errors stay until clicked.
    useEffect(() => {
        if (toast?.kind !== "info") return;
        // Longer messages (e.g. the linked-file notice) stay up long enough to read.
        const t = setTimeout(() => setToast(null), Math.max(2500, toast.text.length * 120));
        return () => clearTimeout(t);
    }, [toast]);

    const refreshCollections = useCallback(async () => {
        try {
            setCollections(await drawerApi.listCollections());
        } catch (e) {
            showError(errorMessage(e));
        }
    }, [showError]);

    const refreshTags = useCallback(async () => {
        try {
            setTags(await drawerApi.listTags());
        } catch (e) {
            showError(errorMessage(e));
        }
    }, [showError]);

    // Keep the latest filter in a ref so `refreshItems` stays stable for children.
    const filterRef = useRef({ view, query });
    filterRef.current = { view, query };

    const refreshItems = useCallback(async () => {
        const { view, query } = filterRef.current;
        try {
            const list = await drawerApi.listItems({
                collectionId: view.kind === "collection" ? view.id : null,
                tagId: view.kind === "tag" ? view.id : null,
                unfiled: view.kind === "unfiled",
                query,
            });
            setItems(list);
        } catch (e) {
            showError(errorMessage(e));
        }
    }, [showError]);

    // A multi-selection only keeps items that are still in the list (e.g. after moving them away).
    useEffect(() => {
        setSelection((sel) => {
            if (sel.ids.length < 2) return sel;
            const present = new Set(items.map((i) => i.id));
            const ids = sel.ids.filter((id) => present.has(id));
            if (ids.length === sel.ids.length) return sel;
            return { ids, focus: ids.includes(sel.focus ?? -1) ? sel.focus : (ids[ids.length - 1] ?? null), anchor: sel.anchor };
        });
    }, [items]);

    /** Something about items changed: list rows, tag counts and the bulk summary may be stale. */
    const onItemChanged = useCallback(() => {
        refreshItems();
        refreshTags();
        setBulkReload((n) => n + 1);
    }, [refreshItems, refreshTags]);

    useEffect(() => {
        refreshCollections();
        refreshTags();
        // e.g. the saved library folder was on a drive that isn't connected.
        drawerApi.getLibraryInfo().then((info) => info.warning && showError(info.warning), () => {});
    }, [refreshCollections, refreshTags, showError]);

    const onLibraryChanged = async () => {
        setSelection(NO_SELECTION);
        setQuery("");
        setView({ kind: "all" });
        filterRef.current = { view: { kind: "all" }, query: "" };
        await refreshCollections();
        await refreshTags();
        await refreshItems();
    };

    // Reload the list when the view changes, and (debounced) when the search changes.
    useEffect(() => {
        const t = setTimeout(refreshItems, query ? 200 : 0);
        return () => clearTimeout(t);
    }, [view, query, refreshItems]);

    // Files dropped onto the window become attachments of the selected item.
    const selectedRef = useRef(selection);
    selectedRef.current = selection;
    useEffect(() => {
        let unlisten: (() => void) | undefined;
        let cancelled = false;
        getCurrentWebview()
            .onDragDropEvent(async (event) => {
                const p = event.payload;
                if (p.type === "enter" || p.type === "over") {
                    setDragging(true);
                } else if (p.type === "leave") {
                    setDragging(false);
                } else if (p.type === "drop") {
                    setDragging(false);
                    const sel = selectedRef.current;
                    if (sel.ids.length !== 1) {
                        showError(sel.ids.length === 0 ? "請先選一個條目，再把檔案拖進來" : "附件一次只能加到一個條目，請只選一個條目");
                        return;
                    }
                    try {
                        const notice = linkedNotice(await drawerApi.addAttachments(sel.ids[0], p.paths));
                        if (notice) showInfo(notice);
                        setDetailReload((n) => n + 1);
                        refreshItems();
                    } catch (e) {
                        showError(errorMessage(e));
                    }
                }
            })
            .then((fn) => {
                if (cancelled) fn();
                else unlisten = fn;
            });
        return () => {
            cancelled = true;
            unlisten?.();
        };
    }, [refreshItems, showError, showInfo]);

    const viewTitle =
        view.kind === "all"
            ? "我的文獻庫"
            : view.kind === "unfiled"
              ? "未分類"
              : view.kind === "tag"
                ? `標籤：${tags.find((t) => t.id === view.id)?.name ?? ""}`
                : collectionPath(collections, view.id);

    const createItem = async (itemType: string) => {
        try {
            const item = await drawerApi.createItem(itemType, view.kind === "collection" ? view.id : null);
            // In a tag's view, the new item gets that tag so it stays in the list.
            if (view.kind === "tag") {
                const name = tags.find((t) => t.id === view.id)?.name;
                if (name) await drawerApi.setItemTags(item.id, [name]);
                await refreshTags();
            }
            await refreshItems();
            selectOnly(item.id);
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    const deleteItems = async (ids: number[]) => {
        if (ids.length === 0) return;
        const name = items.find((i) => i.id === ids[0])?.title || "（無標題）";
        const question =
            ids.length === 1
                ? `刪除條目「${name}」？${DELETE_WARNING.replace("它們", "它").replace("這些", "這個")}`
                : `刪除選取的 ${ids.length} 個條目？${DELETE_WARNING}`;
        if (!confirm(question)) return;
        try {
            await drawerApi.deleteItems(ids);
            setSelection(NO_SELECTION);
            await refreshItems();
            await refreshTags();
            if (ids.length > 1) showInfo(`已刪除 ${ids.length} 個條目`);
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    const countLabel = (ids: number[]) => (ids.length > 1 ? `${ids.length} 個條目` : "");

    // Drag items onto a tag: they get the tag.
    const dropOnTag = async (ids: number[], tagId: number) => {
        const name = tags.find((t) => t.id === tagId)?.name ?? "";
        try {
            const added = await drawerApi.addTagToItems(ids, tagId);
            showInfo(
                added === 0
                    ? `${ids.length > 1 ? "這些條目" : ""}已經有標籤「${name}」了`
                    : `已為 ${countLabel(ids) || "條目"}加上標籤「${name}」`,
            );
            setDetailReload((n) => n + 1);
            onItemChanged();
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    // Drag items onto a folder: add them there; with Shift, move them out of the folder being viewed.
    const dropOnCollection = async (ids: number[], collectionId: number, shift: boolean) => {
        const viewing = view.kind === "collection" ? view.id : null;
        if (viewing === collectionId) return;
        const removeFrom = shift ? viewing : null;
        const name = collectionPath(collections, collectionId);
        const what = countLabel(ids);
        try {
            const added = await drawerApi.addItemsToCollection(ids, collectionId, removeFrom);
            if (removeFrom !== null) {
                showInfo(`已把${what}移到「${name}」`);
                setSelection(NO_SELECTION);
            } else {
                showInfo(added > 0 ? `已把${what}加入「${name}」` : `已經在「${name}」裡了`);
                setDetailReload((n) => n + 1);
            }
            onItemChanged();
        } catch (e) {
            showError(errorMessage(e));
        }
    };
    // Drag items onto the 關聯 section of the item shown on the right: relate them to it.
    const dropOnRelated = async (ids: number[], itemId: number) => {
        const others = ids.filter((id) => id !== itemId);
        if (others.length === 0) return;
        try {
            const added = await drawerApi.addRelatedItems(itemId, others);
            showInfo(
                added === 0
                    ? "已經是關聯條目了"
                    : `已加入 ${added} 個關聯條目${added < others.length ? `（${others.length - added} 個已經是了）` : ""}`,
            );
            setDetailReload((n) => n + 1);
            onItemChanged();
        } catch (e) {
            showError(errorMessage(e));
        }
    };
    const { drag, startDrag } = useItemDrag((ids: number[], target: DropTarget, shift: boolean) =>
        target.kind === "tag"
            ? dropOnTag(ids, target.id)
            : target.kind === "related"
              ? dropOnRelated(ids, target.id)
              : dropOnCollection(ids, target.id, shift),
    );

    /** Goes to an item (e.g. a related one); shows 我的文獻庫 when the item isn't in the current list. */
    const openItem = (id: number) => {
        if (!items.some((i) => i.id === id)) {
            setQuery("");
            setView({ kind: "all" });
        }
        selectOnly(id);
    };

    /**
     * Dragging a selected row drags the whole selection; dragging another row drags just it and
     * leaves the selection alone (so it can be dropped onto the shown item's 關聯 section).
     * A plain click still selects the row.
     */
    const startItemDrag = (e: React.PointerEvent, it: ItemSummary) => {
        if (e.button !== 0) return;
        let ids = selection.ids;
        if (!ids.includes(it.id)) {
            if (e.ctrlKey || e.metaKey || e.shiftKey) return; // modifier clicks change the selection instead
            ids = [it.id];
        }
        startDrag(e, { ids, title: ids.length > 1 ? `${ids.length} 個條目` : it.title || "（無標題）" });
    };

    const dragHint = (() => {
        if (!drag) return "";
        const target = drag.target;
        if (target === null) return "拖到左側資料夾或標籤，或右側的「關聯」";
        if (target.kind === "related") {
            return drag.itemIds.every((id) => id === target.id) ? "不能和自己建立關聯" : "加入關聯";
        }
        if (target.kind === "tag") {
            if (view.kind === "tag" && view.id === target.id) return "已有這個標籤";
            return `加上標籤「${tags.find((t) => t.id === target.id)?.name ?? ""}」`;
        }
        const name = collectionPath(collections, target.id);
        const viewing = view.kind === "collection" ? view.id : null;
        if (viewing === target.id) return "已在這個資料夾";
        return drag.move && viewing !== null ? `移到「${name}」` : `加入「${name}」`;
    })();

    const renameTag = async (id: number, name: string) => {
        try {
            const merged = await drawerApi.renameTag(id, name);
            if (merged !== id) showInfo(`已和既有的標籤「${name}」合併`);
            if (view.kind === "tag" && view.id === id) setView({ kind: "tag", id: merged });
            setDetailReload((n) => n + 1);
            onItemChanged();
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    const deleteTag = async (t: TagInfo) => {
        if (!confirm(`刪除標籤「${t.name}」？它會從 ${t.count} 個條目上移除，條目本身不受影響。`)) return;
        try {
            await drawerApi.deleteTag(t.id);
            if (view.kind === "tag" && view.id === t.id) setView({ kind: "all" });
            setDetailReload((n) => n + 1);
            onItemChanged();
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    const deleteCollection = async (c: Collection) => {
        if (!confirm(`刪除資料夾「${c.name}」和它的子資料夾？裡面的條目會保留在文獻庫中。`)) return;
        try {
            await drawerApi.deleteCollection(c.id);
            if (view.kind === "collection") setView({ kind: "all" });
            await refreshCollections();
            onItemChanged();
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    return (
        <div className="drawer">
            <CollectionTree
                collections={collections}
                view={view}
                onSelect={(v) => {
                    setView(v);
                    setSelection(NO_SELECTION);
                }}
                onCreate={async (name, parentId) => {
                    try {
                        const c = await drawerApi.createCollection(name, parentId);
                        await refreshCollections();
                        setView({ kind: "collection", id: c.id });
                    } catch (e) {
                        showError(errorMessage(e));
                    }
                }}
                onRename={async (id, name) => {
                    try {
                        await drawerApi.renameCollection(id, name);
                        await refreshCollections();
                    } catch (e) {
                        showError(errorMessage(e));
                    }
                }}
                onDelete={deleteCollection}
                onOpenSettings={() => setShowSettings(true)}
                tags={tags}
                onRenameTag={renameTag}
                onDeleteTag={deleteTag}
                dropTarget={drag?.target ?? null}
            />
            <ItemList
                title={viewTitle}
                items={items}
                selection={selection}
                onSelectionChange={setSelection}
                query={query}
                onQueryChange={setQuery}
                onCreate={createItem}
                onDelete={deleteItems}
                onDragStart={startItemDrag}
                draggingIds={drag?.itemIds ?? []}
                onError={showError}
            />
            {selection.ids.length > 1 ? (
                <BulkEdit
                    itemIds={selection.ids}
                    items={items}
                    collections={collections}
                    reloadKey={bulkReload}
                    onChanged={onItemChanged}
                    onDelete={deleteItems}
                    onClear={() => selectOnly(selection.focus)}
                    onError={showError}
                    onInfo={showInfo}
                />
            ) : selectedId !== null ? (
                <ItemDetail
                    key={selectedId}
                    itemId={selectedId}
                    collections={collections}
                    reloadKey={detailReload}
                    onChanged={onItemChanged}
                    onDelete={(id) => deleteItems([id])}
                    onError={showError}
                    onInfo={showInfo}
                    onOpenCard={onOpenCard}
                    onOpenItem={openItem}
                    relatedDropActive={drag?.target?.kind === "related"}
                />
            ) : (
                <aside className="drawer-pane drawer-detail drawer-detail-empty">
                    <p className="muted">選一個條目來查看與編輯</p>
                    <p className="muted small-hint">Ctrl＋點選或 Shift＋點選可多選，也可以從空白處拖曳框選，一次編輯多個條目。</p>
                </aside>
            )}

            {showSettings && (
                <LibrarySettings onClose={() => setShowSettings(false)} onChanged={onLibraryChanged} />
            )}
            {dragging && (
                <div className="drop-overlay">
                    {selection.ids.length === 1 ? "放開以加入附件" : "請先只選一個條目"}
                </div>
            )}
            {drag && (
                <div className="drag-ghost" style={{ left: drag.x + 14, top: drag.y + 10 }}>
                    <div className="drag-ghost-title">{drag.title}</div>
                    <div className="drag-ghost-hint">{dragHint}</div>
                </div>
            )}
            {toast && (
                <div className={`toast${toast.kind === "info" ? " info" : ""}`} onClick={() => setToast(null)}>
                    {toast.text}
                    <span className="toast-close">×</span>
                </div>
            )}
        </div>
    );
}

export default DrawerView;
