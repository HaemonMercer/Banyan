import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { Library } from "./itemTypes";

/** How a folder shows its items: the table, or pictures only (image items only). */
export type CollectionView = "list" | "gallery";

export interface Collection {
    id: number;
    name: string;
    parentId: number | null;
    view: CollectionView;
    /** Which library the folder belongs to (文獻庫 or 檔案庫). */
    library: Library;
}

export interface ItemSummary {
    id: number;
    itemType: string;
    title: string;
    authors: string;
    date: string;
    publication: string;
    publisher: string;
    series: string;
    place: string;
    attachmentCount: number;
    /** First attachment that is a picture (shown in galleries). */
    imageId: number | null;
    /** Name of the first attachment: the file of a 檔案庫 item. */
    fileName: string | null;
    /** Total size of the attachments in bytes. */
    fileSize: number;
    createdAt: number;
    updatedAt: number;
}

export interface ItemFields {
    itemType: string;
    title: string;
    date: string;
    publication: string;
    volume: string;
    issue: string;
    pages: string;
    publisher: string;
    doi: string;
    isbn: string;
    url: string;
    abstractNote: string;
    /** The item's text pasted as-is, e.g. a news article (原文). */
    fullText: string;
    /** Length of a recording or film. */
    runningTime: string;
    /** Format or material. */
    medium: string;
    dimensions: string;
    /** Location / country / holding institution. */
    place: string;
    catalogNumber: string;
    /** Series (叢書／系列) and the position in it. */
    series: string;
    seriesNumber: string;
}

export interface Attachment {
    id: number;
    itemId: number;
    fileName: string;
    size: number;
    createdAt: number;
    /** Too large to copy (> 5 GB): only the original location is recorded. */
    linked: boolean;
    linkedPath: string | null;
    /** 檔案庫 copy of a 文獻庫 attachment: the id of the attachment whose file it shares. */
    mirrorOf: number | null;
    /** 文獻庫 attachment that also shows up in 檔案庫 as a file item. */
    mirrored: boolean;
}

/**
 * Message after files were attached: which ones were linked instead of copied, and how many
 * also showed up in 檔案庫. Null when there's nothing to say.
 */
export function attachNotice(added: Attachment[]): string | null {
    const parts: string[] = [];
    const mirrored = added.filter((a) => a.mirrored).length;
    if (mirrored > 0) {
        parts.push(
            mirrored === added.length
                ? `已加入 ${added.length} 個附件，也出現在檔案庫中`
                : `已加入 ${added.length} 個附件，其中 ${mirrored} 個也出現在檔案庫中`,
        );
    }
    const linked = added.filter((a) => a.linked);
    if (linked.length > 0) {
        const names = linked.map((a) => `「${a.fileName}」`).join("、");
        parts.push(`${names}超過 5 GB，未複製進資料庫，只記錄了檔案位置。請勿移動或刪除原始檔案。`);
    }
    return parts.length > 0 ? parts.join("。") : null;
}

/** A person credited on an item; `role` is an id from `ROLE_LABELS` ("author", "translator"…). */
export interface Creator {
    role: string;
    name: string;
}

/** An item related to another one (Zotero's "Related"; always two-way). */
export interface RelatedItem {
    id: number;
    itemType: string;
    title: string;
    authors: string;
    date: string;
}

export interface ItemDetail extends ItemFields {
    id: number;
    creators: Creator[];
    tags: string[];
    collectionIds: number[];
    attachments: Attachment[];
    /** Sorted by title. */
    related: RelatedItem[];
    createdAt: number;
    updatedAt: number;
}

export interface Counted<T> {
    value: T;
    /** How many of the selected items have it. */
    count: number;
}

/** What several selected items have in common. */
export interface BulkInfo {
    count: number;
    itemTypes: Counted<string>[];
    tags: Counted<string>[];
    collectionIds: Counted<number>[];
}

export interface TagInfo {
    id: number;
    name: string;
    /** Number of items with this tag. */
    count: number;
}

export interface ItemFilter {
    collectionId?: number | null;
    tagId?: number | null;
    unfiled?: boolean;
    query?: string;
    /** Only this library's items; every item when absent. */
    library?: Library;
}

/** Files added to 檔案庫. */
export interface ImportResult {
    itemIds: number[];
    /** Folders, and non-pictures dropped onto a gallery. */
    skipped: number;
    /** Names of files too large to copy (only their location was recorded). */
    linked: string[];
    /** Files that couldn't be added ("name：reason"); the others still were. */
    failed: string[];
}

export const drawerApi = {
    listCollections: () => invoke<Collection[]>("list_collections"),
    /** A sub-folder always goes into its parent's library. */
    createCollection: (name: string, parentId: number | null, view: CollectionView, library: Library) =>
        invoke<Collection>("create_collection", { name, parentId, view, library }),
    setCollectionView: (id: number, view: CollectionView) => invoke<void>("set_collection_view", { id, view }),
    renameCollection: (id: number, name: string) => invoke<void>("rename_collection", { id, name }),
    deleteCollection: (id: number) => invoke<void>("delete_collection", { id }),

    /** With a library: only its items are counted, and tags none of them use are left out. */
    listTags: (library?: Library) => invoke<TagInfo[]>("list_tags", { library: library ?? null }),
    /** Returns the resulting tag id (different when the rename merged into an existing tag). */
    renameTag: (id: number, name: string) => invoke<number>("rename_tag", { id, name }),
    deleteTag: (id: number) => invoke<void>("delete_tag", { id }),
    /** Returns how many items newly got the tag. */
    addTagToItems: (itemIds: number[], tagId: number) => invoke<number>("add_tag_to_items", { itemIds, tagId }),
    bulkInfo: (itemIds: number[]) => invoke<BulkInfo>("bulk_info", { itemIds }),
    /** Returns how many items newly got the tag. */
    bulkAddTag: (itemIds: number[], name: string) => invoke<number>("bulk_add_tag", { itemIds, name }),
    bulkRemoveTag: (itemIds: number[], name: string) => invoke<void>("bulk_remove_tag", { itemIds, name }),
    removeItemsFromCollection: (itemIds: number[], collectionId: number) =>
        invoke<void>("remove_items_from_collection", { itemIds, collectionId }),
    bulkSetType: (itemIds: number[], itemType: string) => invoke<void>("bulk_set_type", { itemIds, itemType }),
    /** `field` is a database column name, e.g. "publisher"; an empty value clears it. */
    bulkSetField: (itemIds: number[], field: string, value: string) =>
        invoke<void>("bulk_set_field", { itemIds, field, value }),
    /** Returns how many items got the person. */
    bulkAddCreator: (itemIds: number[], creator: Creator) => invoke<number>("bulk_add_creator", { itemIds, creator }),
    deleteItems: (itemIds: number[]) => invoke<void>("delete_items", { itemIds }),
    listItems: (filter: ItemFilter) => invoke<ItemSummary[]>("list_items", { filter }),
    getItem: (id: number) => invoke<ItemDetail>("get_item", { id }),
    createItem: (itemType: string, collectionId: number | null) =>
        invoke<ItemDetail>("create_item", { itemType, collectionId }),
    updateItem: (id: number, fields: ItemFields) => invoke<void>("update_item", { id, fields }),
    deleteItem: (id: number) => invoke<void>("delete_item", { id }),
    setItemCreators: (id: number, creators: Creator[]) => invoke<void>("set_item_creators", { id, creators }),
    setItemTags: (id: number, tags: string[]) => invoke<void>("set_item_tags", { id, tags }),
    setItemCollections: (id: number, collectionIds: number[]) =>
        invoke<void>("set_item_collections", { id, collectionIds }),
    /** Returns how many items were newly added. `removeFrom` turns it into a move. */
    addItemsToCollection: (itemIds: number[], collectionId: number, removeFrom: number | null) =>
        invoke<number>("add_items_to_collection", { itemIds, collectionId, removeFrom }),

    /** Values already used in a field (database column name, e.g. "series"), most used first. */
    fieldValues: (field: string) => invoke<string[]>("field_values", { field }),
    /** Returns how many relations are new (self, duplicates and missing items are skipped). */
    addRelatedItems: (itemId: number, relatedIds: number[]) =>
        invoke<number>("add_related_items", { itemId, relatedIds }),
    removeRelatedItem: (itemId: number, relatedId: number) =>
        invoke<void>("remove_related_item", { itemId, relatedId }),
    /** Relates every pair of the items to each other; returns how many relations are new. */
    relateItems: (itemIds: number[]) => invoke<number>("relate_items", { itemIds }),

    listAttachments: (itemId: number) => invoke<Attachment[]>("list_attachments", { itemId }),
    pickAttachments: (itemId: number) => invoke<Attachment[]>("pick_attachments", { itemId }),
    addAttachments: (itemId: number, paths: string[]) =>
        invoke<Attachment[]>("add_attachments", { itemId, paths }),
    openAttachment: (id: number) => invoke<void>("open_attachment", { id }),
    readAttachment: (id: number) => invoke<ArrayBuffer>("read_attachment", { id }),
    /**
     * URL the page streams the file from (the `attachment:` protocol, by id): videos play while
     * loading, and pdf.js reads only the parts it needs. See src-tauri/src/file_protocol.rs.
     */
    attachmentUrl: (id: number) => convertFileSrc(String(id), "attachment"),
    /** Picture files dropped onto a gallery become 照片 items there; returns their ids. */
    importImages: (collectionId: number, paths: string[]) =>
        invoke<number[]>("import_images", { collectionId, paths }),
    /** Each file becomes a 檔案庫 item (typed by extension) in the folder, or unfiled. */
    importFiles: (collectionId: number | null, paths: string[]) =>
        invoke<ImportResult>("import_files", { collectionId, paths }),
    pickImportFiles: (collectionId: number | null) => invoke<ImportResult>("pick_import_files", { collectionId }),
    revealAttachment: (id: number) => invoke<void>("reveal_attachment", { id }),
    /** True when the item went too (a 檔案庫 item left without any file). */
    deleteAttachment: (id: number) => invoke<boolean>("delete_attachment", { id }),

    getLibraryInfo: () => invoke<LibraryInfo>("get_library_info"),
    pickLibraryDir: () => invoke<string | null>("pick_library_dir"),
    inspectLibraryDir: (path: string) => invoke<FolderCheck>("inspect_library_dir", { path }),
    changeLibraryDir: (path: string, mode: ChangeMode) =>
        invoke<LibraryInfo>("change_library_dir", { path, mode }),
    revealLibraryDir: () => invoke<void>("reveal_library_dir"),
    /** Opens the folder with the copies made before database upgrades. */
    revealBackups: () => invoke<void>("reveal_backups"),
};

export interface LibraryInfo {
    path: string;
    defaultPath: string;
    isDefault: boolean;
    /** Shown once, e.g. when the saved location was missing at startup. */
    warning: string | null;
    /** Shown once: the database was upgraded after a Banyan update (a backup was made first). */
    notice: string | null;
    /** Copies made before database upgrades (the newest few are kept). */
    backupCount: number;
}

export interface FolderCheck {
    path: string;
    hasLibrary: boolean;
    isCurrent: boolean;
    moveBlocked: string | null;
}

/** move: copy the current library there and switch; open: use the library already there; new: empty library. */
export type ChangeMode = "move" | "open" | "new";

export function pickFields(item: ItemDetail): ItemFields {
    const {
        itemType, title, date, publication, volume, issue, pages,
        publisher, doi, isbn, url, abstractNote,
        runningTime, medium, dimensions, place, catalogNumber, series, seriesNumber, fullText,
    } = item;
    return {
        itemType, title, date, publication, volume, issue, pages,
        publisher, doi, isbn, url, abstractNote,
        runningTime, medium, dimensions, place, catalogNumber, series, seriesNumber, fullText,
    };
}

export function errorMessage(e: unknown): string {
    return typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
}
