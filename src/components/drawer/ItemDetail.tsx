import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../icons/Icon";
import { drawerApi, errorMessage, attachNotice, pickFields, type Collection, type ItemDetail as Item, type ItemFields } from "../../drawer/api";
import { collectionPath } from "../../drawer/collections";
import CreatorsEditor from "./CreatorsEditor";
import ItemCards from "./ItemCards";
import ItemRelated from "./ItemRelated";
import SectionHeader from "./SectionHeader";
import ItemFullText, { firstLine } from "./ItemFullText";
import { usePersistentSet } from "../../drawer/usePersistentSet";
import { GROUP_LABELS, fieldLabel, formatSize, groupedTypes, isImageType, itemType, libraryOf } from "../../drawer/itemTypes";
import FilePreview from "./FilePreview";
import { canRead, type ReaderFile } from "../reader/Reader";
import { ask, splitAsk } from "../Feedback";
import CiteKeyField from "./CiteKeyField";

interface Props {
    itemId: number;
    collections: Collection[];
    /** Bumped by the parent when the item changed elsewhere (e.g. files dropped on the window). */
    reloadKey: number;
    onChanged: () => void;
    onDelete: (id: number) => void;
    /** The item is gone (a 檔案庫 item whose last file was removed). */
    onRemoved: () => void;
    onError: (message: string) => void;
    onInfo: (message: string) => void;
    /** Opens a note card in Whiteboard. */
    onOpenCard: (cardId: number, boardId: number) => void;
    /** Goes to another item (a related one). */
    onOpenItem: (id: number) => void;
    /** Items are being dragged over the 關聯 section. */
    relatedDropActive: boolean;
    /** Opens files in the full-window reader. */
    onRead: (files: ReaderFile[], index: number) => void;
    /** The relation graph is shown in the middle column. */
    graphOpen: boolean;
    onToggleGraph: () => void;
}

function ItemDetail({
    itemId, collections, reloadKey, onChanged, onDelete, onRemoved, onError, onInfo, onOpenCard, onOpenItem, relatedDropActive, onRead,
    graphOpen, onToggleGraph,
}: Props) {
    const [item, setItem] = useState<Item | null>(null);
    const [draft, setDraft] = useState<ItemFields | null>(null);
    const [tagInput, setTagInput] = useState("");
    /** Series names already in the library, offered while typing a series. */
    const [seriesOptions, setSeriesOptions] = useState<string[]>([]);
    /** Folded sections, shared by all items and remembered between sessions. */
    const [folded, toggleFolded, setFolded] = usePersistentSet("banyan.drawer.detailFolded");

    // Refs so the unmount/switch flush sees the latest values.
    const savedRef = useRef<string>("");
    const draftRef = useRef<ItemFields | null>(null);
    const idRef = useRef(itemId);
    draftRef.current = draft;

    const load = useCallback(async () => {
        try {
            const it = await drawerApi.getItem(itemId);
            setItem(it);
            const fields = pickFields(it);
            setDraft(fields);
            savedRef.current = JSON.stringify(fields);
            idRef.current = it.id;
        } catch (e) {
            onError(errorMessage(e));
        }
    }, [itemId, onError]);

    const save = useCallback(async () => {
        const d = draftRef.current;
        if (!d) return;
        const json = JSON.stringify(d);
        if (json === savedRef.current) return;
        savedRef.current = json;
        try {
            await drawerApi.updateItem(idRef.current, d);
            onChanged();
            // An automatic citation key follows the title, authors and year.
            const fresh = await drawerApi.getItem(idRef.current);
            setItem((p) => (p && p.id === fresh.id ? { ...p, citeKey: fresh.citeKey } : p));
        } catch (e) {
            onError(errorMessage(e));
        }
    }, [onChanged, onError]);

    useEffect(() => {
        load();
        // Flush pending edits before switching to another item.
        return () => {
            save();
        };
    }, [load, save]);

    useEffect(() => {
        if (!itemType(draft?.itemType ?? "").fields.includes("series")) return;
        let stale = false;
        drawerApi.fieldValues("series").then((v) => !stale && setSeriesOptions(v), () => {});
        return () => {
            stale = true;
        };
    }, [itemId, draft?.itemType]);

    useEffect(() => {
        if (reloadKey > 0) load();
    }, [reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!item || !draft) return <aside className="drawer-pane drawer-detail" />;

    const SECTIONS = ["preview", "info", "fullText", "cards", "tags", "folders", "attachments", "related"];
    const allFolded = SECTIONS.every((s) => folded.has(s));
    /** Opens a folded section, e.g. when its "add" button is used. */
    const unfold = (id: string) => folded.has(id) && toggleFolded(id);

    const type = itemType(draft.itemType);
    /** A 檔案庫 item: the file comes first, and there are no bibliographic fields or people. */
    const library = libraryOf(draft.itemType);
    const isFile = library === "files";
    const mainFile = isFile ? item.attachments[0] : undefined;
    /** The item's files the reader can show; ‹ › in the reader go through them. */
    const readable = item.attachments.filter(canRead);
    const read = (id: number) => onRead(readable, Math.max(0, readable.findIndex((a) => a.id === id)));
    const openFile = (a: { id: number; fileName: string }) =>
        canRead(a) ? read(a.id) : run(() => drawerApi.openAttachment(a.id));
    const set = (key: keyof ItemFields, value: string) => setDraft({ ...draft, [key]: value });

    const run = async (fn: () => Promise<unknown>) => {
        try {
            await fn();
            await load();
            onChanged();
        } catch (e) {
            onError(errorMessage(e));
        }
    };

    const addTag = () => {
        const tag = tagInput.trim();
        setTagInput("");
        if (!tag || item.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return;
        run(() => drawerApi.setItemTags(item.id, [...item.tags, tag]));
    };

    const toggleCollection = (cid: number, on: boolean) => {
        const ids = on ? [...item.collectionIds, cid] : item.collectionIds.filter((x) => x !== cid);
        run(() => drawerApi.setItemCollections(item.id, ids));
    };

    // Folders shown by full path ("資料夾/資料夾01"), sorted.
    const withPaths = (cols: Collection[]) =>
        cols
            .map((c) => ({ id: c.id, path: collectionPath(collections, c.id) }))
            .sort((a, b) => a.path.localeCompare(b.path));
    const memberOf = withPaths(collections.filter((c) => item.collectionIds.includes(c.id)));
    const addable = withPaths(
        collections.filter((c) => !item.collectionIds.includes(c.id) && (c.view !== "gallery" || isImageType(draft.itemType))),
    );
    /** In a gallery, the type stays an image type. */
    const inGallery = collections.some((c) => c.view === "gallery" && item.collectionIds.includes(c.id));

    return (
        <aside className="drawer-pane drawer-detail">
            <div className="pane-header">
                <select
                    value={draft.itemType}
                    onChange={(e) => {
                        setDraft({ ...draft, itemType: e.target.value });
                        draftRef.current = { ...draft, itemType: e.target.value };
                        save();
                    }}
                >
                    {groupedTypes(library).map(([group, types]) => (
                        <optgroup key={group} label={GROUP_LABELS[group]}>
                            {types.map((t) => (
                                <option key={t.id} value={t.id} disabled={inGallery && !isImageType(t.id)}>
                                    {t.icon} {t.label}
                                </option>
                            ))}
                        </optgroup>
                    ))}
                </select>
                <button
                    className={`icon-btn graph-toggle${graphOpen ? " active" : ""}`}
                    title={graphOpen ? "關閉關聯圖，回到條目清單" : "關聯圖：在中欄顯示這個條目和卡片、關聯條目的關係"}
                    aria-pressed={graphOpen}
                    onClick={onToggleGraph}
                >
                    <Icon name="related" />
                </button>
                <button
                    className="secondary-btn fold-all"
                    title={allFolded ? "展開所有區塊" : "收合所有區塊"}
                    onClick={() => setFolded(allFolded ? [] : SECTIONS)}
                >
                    {allFolded ? "全部展開" : "全部收合"}
                </button>
                <button className="danger-btn" onClick={() => onDelete(item.id)}>刪除條目</button>
            </div>

            <div className="detail-body detail-title" onBlur={save}>
                <textarea
                    className="title-input"
                    rows={2}
                    placeholder={type.titleLabel ?? "標題"}
                    value={draft.title}
                    onChange={(e) => set("title", e.target.value)}
                />
            </div>

            {mainFile && (
                <section className="detail-section">
                    <SectionHeader title="預覽" collapsed={folded.has("preview")} onToggle={() => toggleFolded("preview")}>
                        {canRead(mainFile) && (
                            <button className="small-btn" title="在 Banyan 中閱讀（整個視窗）" onClick={() => read(mainFile.id)}>閱讀</button>
                        )}
                        <button className="small-btn" title="用預設程式開啟" onClick={() => run(() => drawerApi.openAttachment(mainFile.id))}>開啟</button>
                        <button className="small-btn" title="在檔案總管中顯示" onClick={() => run(() => drawerApi.revealAttachment(mainFile.id))}>位置</button>
                    </SectionHeader>
                    {!folded.has("preview") && (
                        <>
                            <FilePreview key={mainFile.id} attachment={mainFile} onOpen={() => openFile(mainFile)} />
                            <p className="file-preview-meta muted" title={mainFile.linked ? `連結檔案（未複製）：${mainFile.linkedPath}` : mainFile.fileName}>
                                {mainFile.fileName} · {formatSize(mainFile.size)}{mainFile.linked ? " · 連結" : ""}
                                {mainFile.mirrorOf !== null ? " · 與文獻共用（見「關聯」）" : ""}
                            </p>
                        </>
                    )}
                </section>
            )}

            <section className="detail-section">
                <SectionHeader title="資料" collapsed={folded.has("info")} onToggle={() => toggleFolded("info")} />
                <div hidden={folded.has("info")} onBlur={save}>
                {!isFile && (
                    <CreatorsEditor
                        key={item.id}
                        itemType={draft.itemType}
                        creators={item.creators}
                        onSave={(creators) => run(() => drawerApi.setItemCreators(item.id, creators))}
                    />
                )}

                {type.fields.map((key) => (
                    <label className="field" key={key}>
                        <span>{fieldLabel(type, key)}</span>
                        <input
                            value={draft[key]}
                            list={key === "series" ? "series-options" : undefined}
                            onChange={(e) => set(key, e.target.value)}
                        />
                    </label>
                ))}

                {type.fields.includes("series") && (
                    <datalist id="series-options">
                        {seriesOptions.map((s) => (
                            <option key={s} value={s} />
                        ))}
                    </datalist>
                )}

                <label className="field">
                    <span>{isFile ? "說明" : "摘要"}</span>
                    <textarea rows={4} value={draft.abstractNote} onChange={(e) => set("abstractNote", e.target.value)} />
                </label>
                <CiteKeyField
                    key={item.id}
                    itemId={item.id}
                    citeKey={item.citeKey}
                    onChanged={(k) => setItem((p) => (p && p.id === item.id ? { ...p, citeKey: k } : p))}
                    onError={onError}
                    onInfo={onInfo}
                />
                </div>
            </section>

            {(type.fullText || draft.fullText !== "") && (
                <ItemFullText
                    value={draft.fullText}
                    onChange={(text) => {
                        // Pasting into a new item: its first line becomes the title.
                        const next = { ...draft, fullText: text };
                        if (!draft.title.trim() && !draft.fullText.trim()) next.title = firstLine(text);
                        setDraft(next);
                        draftRef.current = next;
                    }}
                    onSave={save}
                    onError={onError}
                    collapsed={folded.has("fullText")}
                    onToggle={() => toggleFolded("fullText")}
                />
            )}

            <ItemCards
                itemId={item.id}
                onOpenCard={onOpenCard}
                onChanged={onChanged}
                onError={onError}
                onInfo={onInfo}
                collapsed={folded.has("cards")}
                onToggle={() => toggleFolded("cards")}
            />

            <section className="detail-section">
                <SectionHeader
                    title="標籤"
                    count={item.tags.length}
                    collapsed={folded.has("tags")}
                    onToggle={() => toggleFolded("tags")}
                />
                <div className="tags" hidden={folded.has("tags")}>
                    {item.tags.map((t) => (
                        <span className="tag" key={t}>
                            {t}
                            <button
                                title="移除標籤"
                                onClick={() => run(() => drawerApi.setItemTags(item.id, item.tags.filter((x) => x !== t)))}
                            >×</button>
                        </span>
                    ))}
                    <input
                        className="tag-input"
                        placeholder="新增標籤…"
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") addTag();
                        }}
                        onBlur={addTag}
                    />
                </div>
            </section>

            <section className="detail-section">
                <SectionHeader
                    title="資料夾"
                    count={memberOf.length}
                    collapsed={folded.has("folders")}
                    onToggle={() => toggleFolded("folders")}
                />
                <div hidden={folded.has("folders")}>
                {memberOf.length > 0 ? (
                    <ul className="folder-paths">
                        {memberOf.map(({ id, path }) => (
                            <li key={id} title={path}>
                                <span className="folder-path-text"><Icon name="folder" /> {path}</span>
                                <button title="從這個資料夾移出" onClick={() => toggleCollection(id, false)}>×</button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="muted">不在任何資料夾（未分類）</p>
                )}
                {collections.length === 0 ? (
                    <p className="muted">還沒有資料夾</p>
                ) : (
                    addable.length > 0 && (
                        <select
                            className="folder-add"
                            value=""
                            onChange={(e) => e.target.value && toggleCollection(Number(e.target.value), true)}
                        >
                            <option value="">＋ 加入資料夾…</option>
                            {addable.map(({ id, path }) => (
                                <option key={id} value={id}>{path}</option>
                            ))}
                        </select>
                    )
                )}
                </div>
            </section>

            <section className="detail-section">
                <SectionHeader
                    title={isFile ? "檔案" : "附件"}
                    count={item.attachments.length}
                    collapsed={folded.has("attachments")}
                    onToggle={() => toggleFolded("attachments")}
                >
                    <button
                        className="small-btn"
                        onClick={() =>
                            run(async () => {
                                const notice = attachNotice(await drawerApi.pickAttachments(item.id));
                                if (notice) onInfo(notice);
                                unfold("attachments");
                            })
                        }
                    >
                        ＋ 加入檔案
                    </button>
                </SectionHeader>
                <div hidden={folded.has("attachments")}>
                <ul className="attachments">
                    {item.attachments.map((a) => (
                        <li
                            key={a.id}
                            className={a.linked ? "linked" : undefined}
                            onDoubleClick={() => openFile(a)}
                        >
                            <span
                                className="att-name"
                                title={a.linked ? `連結檔案（未複製）：${a.linkedPath}` : a.fileName}
                            >
                                <Icon name={a.linked ? "link" : "attachment"} /> {a.fileName}
                            </span>
                            {a.linked && <span className="badge">連結</span>}
                            {a.mirrorOf !== null && <span className="badge" title="這個檔案屬於關聯的文獻條目，和它共用同一份檔案">文獻</span>}
                            {a.mirrored && <span className="badge" title="這個附件也以檔案條目出現在檔案庫中">檔案庫</span>}
                            <span className="att-size">{formatSize(a.size)}</span>
                            <span className="att-actions">
                                {canRead(a) && <button title="在 Banyan 中閱讀" onClick={() => read(a.id)}>閱讀</button>}
                                <button title="用預設程式開啟" onClick={() => run(() => drawerApi.openAttachment(a.id))}>開啟</button>
                                <button title="在檔案總管中顯示" onClick={() => run(() => drawerApi.revealAttachment(a.id))}>位置</button>
                                <button
                                    title={a.linked || a.mirrorOf !== null ? "移除" : "刪除附件"}
                                    onClick={async () => {
                                        // A 檔案庫 item is its file: removing the last one removes the item.
                                        const lastFile = libraryOf(item.itemType) === "files" && item.attachments.length === 1;
                                        const message =
                                            (a.mirrorOf !== null
                                                ? `從這個條目移除「${a.fileName}」？\n檔案仍保留在原本的文獻條目中。`
                                                : (a.linked
                                                      ? `移除「${a.fileName}」的連結？\n原始檔案（${a.linkedPath}）不會被刪除。`
                                                      : `刪除附件「${a.fileName}」？檔案會一併刪除。`) +
                                                  (a.mirrored ? "\n檔案庫中對應的檔案也會移除。" : "")) +
                                            (lastFile ? "\n這是條目唯一的檔案，條目也會一併移除。" : "");
                                        if (!(await ask({ ...splitAsk(message), confirm: a.mirrorOf !== null || a.linked ? "移除" : "刪除", danger: true }))) return;
                                        drawerApi.deleteAttachment(a.id).then(
                                            (removed) => {
                                                if (removed) {
                                                    onRemoved();
                                                } else {
                                                    void load();
                                                    onChanged();
                                                }
                                            },
                                            (e) => onError(errorMessage(e)),
                                        );
                                    }}
                                >{a.linked || a.mirrorOf !== null ? "移除" : "刪除"}</button>
                            </span>
                        </li>
                    ))}
                </ul>
                </div>
            </section>

            <ItemRelated
                itemId={item.id}
                related={item.related}
                run={run}
                onOpenItem={onOpenItem}
                onError={onError}
                dropActive={relatedDropActive}
                collapsed={folded.has("related")}
                onToggle={() => toggleFolded("related")}
            />
        </aside>
    );
}

export default ItemDetail;
