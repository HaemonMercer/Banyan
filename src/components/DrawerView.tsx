import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { drawerApi, errorMessage, attachNotice, type Collection, type CollectionView, type ImportResult, type ItemSummary, type TagInfo } from "../drawer/api";
import { isImageType, libraryOf, type Library } from "../drawer/itemTypes";
import { useItemDrag, type DropTarget } from "../drawer/useItemDrag";
import { collectionPath } from "../drawer/collections";
import { NO_SELECTION, single, type Selection } from "../drawer/selection";
import CollectionTree, { allLabel, type LibraryView } from "./drawer/CollectionTree";
import ItemList, { type FileView } from "./drawer/ItemList";
import ItemDetail from "./drawer/ItemDetail";
import BulkEdit from "./drawer/BulkEdit";
import Reader, { canRead, type ReaderFile } from "./reader/Reader";
import "./drawer/Drawer.css";
import { ask, Toast, useToast } from "./Feedback";
import { openFileTab, opensInTab, withoutExtension } from "../tabs";

interface Props {
    /** Item to select when the view opens (e.g. coming from a whiteboard card). */
    initialItemId?: number | null;
    /** Opens a card in Whiteboard. */
    onOpenCard: (cardId: number, boardId: number) => void;
    /** Opens the Settings page at the data-location section. */
    onOpenSettings: () => void;
}

const DELETE_WARNING =
    "它們的附件檔案，以及只屬於這些條目、不在任何白板上的筆記卡片，也會一併刪除，無法復原。（文獻的附件在檔案庫中的檔案條目會保留。）";

/**
 * Where an item shows up when jumping to it: 文獻庫's "everything" view; in 檔案庫 its (first)
 * folder, so it is seen among its neighbours (所有檔案 when it is in no folder).
 */
function placeOf(library: Library, collectionIds: number[]): LibraryView {
    return library === "files" && collectionIds.length > 0 ? { kind: "collection", id: collectionIds[0] } : { kind: "all" };
}

const LIBRARY_KEY = "banyan.drawer.library";
const FILE_VIEW_KEY = "banyan.drawer.fileView";
function savedFileView(): FileView {
    try {
        return localStorage.getItem(FILE_VIEW_KEY) === "details" ? "details" : "icons";
    } catch {
        return "icons";
    }
}
function savedLibrary(): Library {
    try {
        return localStorage.getItem(LIBRARY_KEY) === "files" ? "files" : "literature";
    } catch {
        return "literature";
    }
}

/** The database-upgrade notice is shown once per run, however often Drawer mounts. */
let upgradeNoticeShown = false;

/** Toast text after files were added to 檔案庫. */
function importMessage(r: ImportResult): string {
    const parts = [r.itemIds.length > 0 ? `已加入 ${r.itemIds.length} 個檔案` : "沒有加入任何檔案"];
    if (r.skipped > 0) parts.push(`略過 ${r.skipped} 個（資料夾，或不能放進畫廊的檔案）`);
    if (r.linked.length > 0) {
        parts.push(`${r.linked.map((n) => `「${n}」`).join("、")}超過 5 GB，未複製進資料庫，只記錄了檔案位置，請勿移動或刪除原始檔案`);
    }
    if (r.failed.length > 0) parts.push(`${r.failed.length} 個無法加入：${r.failed.join("、")}`);
    return parts.join("；");
}

function DrawerView({ initialItemId = null, onOpenCard, onOpenSettings }: Props) {
    const [library, setLibrary] = useState<Library>(savedLibrary);
    /** Every folder of both libraries; `collections` below is the shown library's. */
    const [allCollections, setCollections] = useState<Collection[]>([]);
    const collections = allCollections.filter((c) => c.library === library);
    const [tags, setTags] = useState<TagInfo[]>([]);
    const [view, setView] = useState<LibraryView>({ kind: "all" });
    const [items, setItems] = useState<ItemSummary[]>([]);
    const [query, setQuery] = useState("");
    const [selection, setSelection] = useState<Selection>(() => single(initialItemId));
    const [detailReload, setDetailReload] = useState(0);
    /** Bumped after list-wide changes so the bulk panel re-reads what the selection has in common. */
    const [bulkReload, setBulkReload] = useState(0);
    const [dragging, setDragging] = useState(false);
    const { toast, showError, showInfo, close: closeToast } = useToast();
    /** Files open in the full-window reader, and which one is shown first. */
    const [reader, setReader] = useState<{ files: ReaderFile[]; index: number } | null>(null);
    const itemsRef = useRef<ItemSummary[]>([]);
    itemsRef.current = items;
    /** PDFs and books open in a tab of their own; other files in the full-window reader. */
    const openReader = useCallback((files: ReaderFile[], index: number) => {
        const f = files[index];
        if (f && !f.kind && opensInTab(f.fileName)) {
            const itemId = (f as ReaderFile & { itemId?: number }).itemId ?? null;
            const item = itemsRef.current.find((i) => i.id === itemId);
            openFileTab({ attachmentId: f.id, fileName: f.fileName, title: item?.title || withoutExtension(f.fileName), itemId });
            return;
        }
        setReader({ files, index });
    }, []);
    /** 檔案庫's view: large icons or details (like Windows Explorer); remembered. */
    const [fileView, setFileView] = useState<FileView>(savedFileView);
    const changeFileView = (v: FileView) => {
        setFileView(v);
        try {
            localStorage.setItem(FILE_VIEW_KEY, v);
        } catch {
            /* this session only */
        }
    };

    const shownCollection = view.kind === "collection" ? collections.find((c) => c.id === view.id) : undefined;
    /** The folder being viewed is a gallery: pictures only, image items only. */
    const gallery = shownCollection?.view === "gallery";
    const galleryRef = useRef<number | null>(null);
    galleryRef.current = gallery && view.kind === "collection" ? view.id : null;

    /** The one item shown in the detail pane (null when none or several are selected). */
    const selectedId = selection.ids.length === 1 ? selection.ids[0] : null;
    const selectOnly = (id: number | null) => setSelection(single(id));


    const refreshCollections = useCallback(async () => {
        try {
            setCollections(await drawerApi.listCollections());
        } catch (e) {
            showError(errorMessage(e));
        }
    }, [showError]);

    const libraryRef = useRef(library);
    libraryRef.current = library;

    /** Shows the other library (文獻庫 / 檔案庫) from its "everything" view. */
    const switchLibrary = useCallback((next: Library) => {
        setLibrary(next);
        setView({ kind: "all" });
        setQuery("");
        setSelection(NO_SELECTION);
        try {
            localStorage.setItem(LIBRARY_KEY, next);
        } catch {
            /* keep it for this session only */
        }
    }, []);

    // An item opened from elsewhere (a whiteboard card) may be in the other library, or (檔案庫)
    // inside a folder rather than at the top level.
    useEffect(() => {
        if (initialItemId === null) return;
        drawerApi.getItem(initialItemId).then((it) => {
            const l = libraryOf(it.itemType);
            if (l !== libraryRef.current) setLibrary(l);
            setView(placeOf(l, it.collectionIds));
            setSelection(single(it.id));
        }, () => {});
    }, [initialItemId]);

    const refreshTags = useCallback(async () => {
        try {
            setTags(await drawerApi.listTags(libraryRef.current));
        } catch (e) {
            showError(errorMessage(e));
        }
    }, [showError]);

    // Keep the latest filter in a ref so `refreshItems` stays stable for children.
    const filterRef = useRef({ view, query, library });
    filterRef.current = { view, query, library };

    const refreshItems = useCallback(async () => {
        const { view, query, library } = filterRef.current;
        try {
            const list = await drawerApi.listItems({
                collectionId: view.kind === "collection" ? view.id : null,
                tagId: view.kind === "tag" ? view.id : null,
                unfiled: view.kind === "unfiled",
                query,
                library,
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
        // e.g. the saved library folder was on a drive that isn't connected.
        // or the database was just upgraded after a Banyan update.
        drawerApi.getLibraryInfo().then((info) => {
            if (info.warning) showError(info.warning);
            else if (info.notice && !upgradeNoticeShown) {
                upgradeNoticeShown = true;
                showInfo(info.notice);
            }
        }, () => {});
    }, [refreshCollections, showError, showInfo]);

    useEffect(() => {
        refreshTags();
    }, [library, refreshTags]);

    // Reload the list when the view or library changes, and (debounced) when the search changes.
    useEffect(() => {
        const t = setTimeout(refreshItems, query ? 200 : 0);
        return () => clearTimeout(t);
    }, [view, query, library, refreshItems]);

    /**
     * 檔案庫: files become items in the folder being viewed (or unfiled); in a tag's view they
     * also get the tag, so they stay in the list.
     */
    const addFiles = useCallback(async (pick: (collectionId: number | null) => Promise<ImportResult>) => {
        const { view } = filterRef.current;
        try {
            const r = await pick(view.kind === "collection" ? view.id : null);
            if (r.itemIds.length === 0 && r.skipped === 0 && r.failed.length === 0) return; // picker cancelled
            if (view.kind === "tag" && r.itemIds.length > 0) {
                const name = tagsRef.current.find((t) => t.id === view.id)?.name;
                if (name) await drawerApi.bulkAddTag(r.itemIds, name);
            }
            const msg = importMessage(r);
            if (r.itemIds.length === 0 || r.failed.length > 0) showError(msg);
            else showInfo(msg);
            await refreshItems();
            await refreshTags();
            if (r.itemIds.length > 0) setSelection(r.itemIds.length === 1 ? single(r.itemIds[0]) : NO_SELECTION);
        } catch (e) {
            showError(errorMessage(e));
        }
    }, [refreshItems, refreshTags, showError, showInfo]);
    const tagsRef = useRef(tags);
    tagsRef.current = tags;

    // Files dropped onto the window: in 檔案庫 each becomes an item; in 文獻庫 they become
    // attachments of the selected item.
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
                    if (libraryRef.current === "files") {
                        await addFiles((cid) => drawerApi.importFiles(cid, p.paths));
                        return;
                    }
                    // Onto a gallery (with no single item selected): each picture becomes a 照片 item.
                    const galleryId = galleryRef.current;
                    if (galleryId !== null && sel.ids.length !== 1) {
                        try {
                            const ids = await drawerApi.importImages(galleryId, p.paths);
                            const skipped = p.paths.length - ids.length;
                            if (ids.length === 0) showError("沒有可以加入的圖片（支援 PNG、JPG、GIF、WebP、BMP、AVIF、SVG）");
                            else showInfo(`已加入 ${ids.length} 張圖片${skipped > 0 ? `，略過 ${skipped} 個不是圖片的檔案` : ""}`);
                            await refreshItems();
                            if (ids.length === 1) setSelection(single(ids[0]));
                        } catch (e) {
                            showError(errorMessage(e));
                        }
                        return;
                    }
                    if (sel.ids.length !== 1) {
                        showError(sel.ids.length === 0 ? "請先選一個條目，再把檔案拖進來" : "附件一次只能加到一個條目，請只選一個條目");
                        return;
                    }
                    try {
                        const notice = attachNotice(await drawerApi.addAttachments(sel.ids[0], p.paths));
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
    }, [refreshItems, showError, showInfo, addFiles]);

    const viewTitle =
        view.kind === "all"
            ? allLabel(library)
            : view.kind === "unfiled"
              ? "未分類"
              : view.kind === "tag"
                ? `標籤：${tags.find((t) => t.id === view.id)?.name ?? ""}`
                : collectionPath(collections, view.id);

    // ---------- 檔案庫 as a file explorer ----------

    /**
     * Sub-folders shown before the files, inside a folder. 所有檔案 lists every file and no folders
     * (the folders are in the left pane).
     */
    const shownFolders =
        library === "files" && !query.trim() && view.kind === "collection"
            ? collections.filter((c) => c.parentId === view.id)
            : [];
    const goToFolder = (id: number | null) => {
        setView(id === null ? { kind: "all" } : { kind: "collection", id });
        setSelection(NO_SELECTION);
    };
    /** 所有檔案 › 工作文件 › 2026: each part goes there. */
    const crumbs: { label: string; onClick?: () => void }[] = [{ label: allLabel("files"), onClick: () => goToFolder(null) }];
    if (view.kind === "collection") {
        const chain: Collection[] = [];
        for (let c = collections.find((x) => x.id === view.id); c; c = collections.find((x) => x.id === c!.parentId)) {
            chain.unshift(c);
        }
        chain.forEach((c) => crumbs.push({ label: c.name, onClick: () => goToFolder(c.id) }));
    } else if (view.kind !== "all") {
        crumbs.push({ label: viewTitle });
    }
    const goUp =
        view.kind === "all"
            ? undefined
            : () => goToFolder(view.kind === "collection" ? (collections.find((c) => c.id === view.id)?.parentId ?? null) : null);

    /** Double-click a file: the reader when it can show it, otherwise the default program. */
    const openFileItem = async (it: ItemSummary) => {
        try {
            const files = await drawerApi.listAttachments(it.id);
            if (files.length === 0) {
                showInfo("這個條目沒有檔案");
                return;
            }
            const readable = files.filter(canRead);
            if (canRead(files[0])) openReader(readable, readable.indexOf(files[0]));
            else await drawerApi.openAttachment(files[0].id);
        } catch (e) {
            showError(errorMessage(e));
        }
    };

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
                ? { title: `刪除條目「${name}」？`, message: DELETE_WARNING.replace("它們", "它").replace("這些", "這個") }
                : { title: `刪除選取的 ${ids.length} 個條目？`, message: DELETE_WARNING };
        if (!(await ask({ title: question.title, message: question.message, confirm: "刪除", danger: true }))) return;
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
    /** How many of the items can't go into the folder because it's a gallery. */
    const notForGallery = (ids: number[], collectionId: number) => {
        if (collections.find((c) => c.id === collectionId)?.view !== "gallery") return 0;
        return items.filter((i) => ids.includes(i.id) && !isImageType(i.itemType)).length;
    };

    const setCollectionView = async (mode: CollectionView) => {
        if (view.kind !== "collection" || shownCollection?.view === mode) return;
        try {
            await drawerApi.setCollectionView(view.id, mode);
            await refreshCollections();
        } catch (e) {
            showError(errorMessage(e));
        }
    };

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

    /**
     * Drag items onto a folder. 文獻庫: add them there; with Shift, move them out of the folder being
     * viewed. 檔案庫 (like Windows Explorer): move them; with Ctrl, keep them where they are too.
     */
    const moves = (keys: { shift: boolean; ctrl: boolean }) => (library === "files" ? !keys.ctrl : keys.shift);
    const dropOnCollection = async (ids: number[], collectionId: number, keys: { shift: boolean; ctrl: boolean }) => {
        const viewing = view.kind === "collection" ? view.id : null;
        if (viewing === collectionId) return;
        const removeFrom = moves(keys) ? viewing : null;
        const name = collectionPath(collections, collectionId);
        const what = countLabel(ids) || (library === "files" ? "檔案" : "條目");
        if (notForGallery(ids, collectionId) > 0) {
            showError(`「${name}」是畫廊，只能放圖片類的條目（繪畫、藝術品、照片、地圖）`);
            return;
        }
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
    const { drag, startDrag } = useItemDrag((ids: number[], target: DropTarget, keys) =>
        target.kind === "tag"
            ? dropOnTag(ids, target.id)
            : target.kind === "related"
              ? dropOnRelated(ids, target.id)
              : dropOnCollection(ids, target.id, keys),
    );

    /**
     * Goes to an item (e.g. a related one); shows its library's "everything" view when the item
     * isn't in the current list.
     */
    const openItem = async (id: number) => {
        if (!items.some((i) => i.id === id)) {
            try {
                const it = await drawerApi.getItem(id);
                const l = libraryOf(it.itemType);
                if (l !== library) switchLibrary(l);
                setQuery("");
                setView(placeOf(l, it.collectionIds));
            } catch (e) {
                showError(errorMessage(e));
                return;
            }
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
        if (target === null) return "";
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
        if (notForGallery(drag.itemIds, target.id) > 0) return "畫廊只能放圖片類的條目";
        // 所有檔案, 未分類 and tags have nothing to move out of: the items are just put in the folder.
        if (library === "files") return viewing === null ? `放進「${name}」` : drag.copy ? `也放進「${name}」` : `移到「${name}」`;
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
        if (!(await ask({ title: `刪除標籤「${t.name}」？`, message: `它會從 ${t.count} 個條目上移除，條目本身不受影響。`, confirm: "刪除", danger: true }))) return;
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
        if (!(await ask({ title: `刪除資料夾「${c.name}」和它的子資料夾？`, message: "裡面的條目會保留在 Drawer 中。", confirm: "刪除", danger: true }))) return;
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
        <div className={`drawer${gallery && selection.ids.length === 0 ? " drawer-wide" : ""}`}>
            <CollectionTree
                library={library}
                onLibraryChange={switchLibrary}
                collections={collections}
                view={view}
                onSelect={(v) => {
                    setView(v);
                    setSelection(NO_SELECTION);
                }}
                onCreate={async (name, parentId, mode) => {
                    try {
                        const c = await drawerApi.createCollection(name, parentId, mode, library);
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
                onOpenSettings={onOpenSettings}
                tags={tags}
                onRenameTag={renameTag}
                onDeleteTag={deleteTag}
                dropTarget={drag?.target ?? null}
            />
            <ItemList
                key={library}
                library={library}
                onAddFiles={() => addFiles(drawerApi.pickImportFiles)}
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
                mode={gallery ? "gallery" : "list"}
                onModeChange={view.kind === "collection" ? setCollectionView : undefined}
                canCreate={gallery ? isImageType : () => true}
                onRead={openReader}
                fileView={fileView}
                onFileViewChange={changeFileView}
                folders={shownFolders}
                allFolders={collections}
                onOpenFolder={(id) => goToFolder(id)}
                crumbs={crumbs}
                onUp={goUp}
                onOpenItem={openFileItem}
                dropFolderId={drag?.target?.kind === "collection" ? drag.target.id : null}
            />
            {selection.ids.length > 1 ? (
                <BulkEdit
                    library={library}
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
                    onRemoved={() => {
                        setSelection(NO_SELECTION);
                        void refreshItems();
                        void refreshTags();
                    }}
                    onError={showError}
                    onInfo={showInfo}
                    onOpenCard={onOpenCard}
                    onOpenItem={openItem}
                    onRead={openReader}
                    relatedDropActive={drag?.target?.kind === "related"}
                />
            ) : gallery ? null : (
                <aside className="drawer-pane drawer-detail drawer-detail-empty" />
            )}

            {reader && <Reader files={reader.files} index={reader.index} onClose={() => setReader(null)} onError={showError} onInfo={showInfo} />}
            {dragging && (
                <div className="drop-overlay">
                    {library === "files"
                        ? gallery
                            ? "放開以加入圖片"
                            : "放開以加入檔案"
                        : selection.ids.length === 1
                          ? "放開以加入附件"
                          : gallery
                            ? "放開以加入圖片"
                            : "請先只選一個條目"}
                </div>
            )}
            {drag && (
                <div className="drag-ghost" style={{ left: drag.x + 14, top: drag.y + 10 }}>
                    <div className="drag-ghost-title">{drag.title}</div>
                    <div className="drag-ghost-hint">{dragHint}</div>
                </div>
            )}
            <Toast toast={toast} onClose={closeToast} />
        </div>
    );
}

export default DrawerView;
