import { useEffect, useState } from "react";
import { drawerApi, errorMessage, type BulkInfo, type Collection, type ItemSummary } from "../../drawer/api";
import { collectionPath } from "../../drawer/collections";
import {
    FIELD_LABELS, GROUP_LABELS, ROLE_LABELS, creatorRoles, groupedTypes, itemType, roleLabel, type FieldKey,
} from "../../drawer/itemTypes";
import { usePersistentSet } from "../../drawer/usePersistentSet";
import SectionHeader from "./SectionHeader";
import { Icon, TypeIcon } from "../../icons/Icon";

interface Props {
    itemIds: number[];
    /** Current list rows, for showing the selected titles. */
    items: ItemSummary[];
    collections: Collection[];
    /** Bumped by the parent after changes made elsewhere (e.g. dragging the selection to a folder). */
    reloadKey: number;
    onChanged: () => void;
    onDelete: (ids: number[]) => void;
    /** Keep only one item selected. */
    onClear: () => void;
    onError: (message: string) => void;
    onInfo: (message: string) => void;
}

/** Fields that can be set on many items at once (title and type are handled separately). */
const BULK_FIELDS: { key: FieldKey | "abstractNote"; label: string }[] = [
    ...(Object.keys(FIELD_LABELS) as FieldKey[]).map((key) => ({ key, label: FIELD_LABELS[key] })),
    { key: "abstractNote", label: "摘要" },
];

/** "catalogNumber" -> "catalog_number" (database column name). */
const column = (key: string) => key.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());

const PREVIEW = 6;

/** Right-pane panel shown when several items are selected: edit them all at once. */
function BulkEdit({ itemIds, items, collections, reloadKey, onChanged, onDelete, onClear, onError, onInfo }: Props) {
    const [info, setInfo] = useState<BulkInfo | null>(null);
    const [folded, toggleFolded] = usePersistentSet("banyan.drawer.bulkFolded");
    const [tagInput, setTagInput] = useState("");
    const [field, setField] = useState<string>("date");
    const [value, setValue] = useState("");
    const [role, setRole] = useState("author");
    const [person, setPerson] = useState("");
    const [busy, setBusy] = useState(false);
    const n = itemIds.length;
    const key = itemIds.join(",");

    useEffect(() => {
        let stale = false;
        drawerApi.bulkInfo(itemIds).then(
            (i) => !stale && setInfo(i),
            (e) => onError(errorMessage(e)),
        );
        return () => {
            stale = true;
        };
    }, [key, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

    /** Runs one bulk change, then refreshes the summary and the list. */
    const run = async (fn: () => Promise<unknown>, done?: string) => {
        setBusy(true);
        try {
            await fn();
            setInfo(await drawerApi.bulkInfo(itemIds));
            onChanged();
            if (done) onInfo(done);
        } catch (e) {
            onError(errorMessage(e));
        } finally {
            setBusy(false);
        }
    };

    const ofN = (count: number) => (count === n ? "全部" : `${count}/${n}`);

    // Roles: those of the shared type, or every role when the selection mixes types.
    const sharedType = info && info.itemTypes.length === 1 ? info.itemTypes[0].value : null;
    const roles = sharedType ? creatorRoles(sharedType) : Object.keys(ROLE_LABELS);

    const titles = itemIds
        .map((id) => items.find((i) => i.id === id))
        .filter((i): i is ItemSummary => !!i);
    const memberOf = (info?.collectionIds ?? [])
        .map((c) => ({ ...c, path: collectionPath(collections, c.value) }))
        .sort((a, b) => a.path.localeCompare(b.path));
    const addable = collections
        .filter((c) => !memberOf.some((m) => m.value === c.id && m.count === n))
        .map((c) => ({ id: c.id, path: collectionPath(collections, c.id) }))
        .sort((a, b) => a.path.localeCompare(b.path));
    const fieldLabel = BULK_FIELDS.find((f) => f.key === field)?.label ?? field;

    const addTag = () => {
        const tag = tagInput.trim();
        if (!tag) return;
        setTagInput("");
        run(() => drawerApi.bulkAddTag(itemIds, tag), `已為 ${n} 個條目加上標籤「${tag}」`);
    };

    const section = (id: string, title: string, count: number | undefined, body: React.ReactNode) => (
        <section className="detail-section">
            <SectionHeader title={title} count={count} collapsed={folded.has(id)} onToggle={() => toggleFolded(id)} />
            <div hidden={folded.has(id)}>{body}</div>
        </section>
    );

    return (
        <aside className={`drawer-pane drawer-detail bulk-edit${busy ? " busy" : ""}`}>
            <div className="pane-header">
                <span className="bulk-title">已選取 {n} 個條目</span>
                <button className="secondary-btn fold-all" onClick={onClear} title="只保留一個選取的條目（Esc）">
                    取消多選
                </button>
                <button className="danger-btn" onClick={() => onDelete(itemIds)}>刪除 {n} 個</button>
            </div>

            <div className="detail-body">
                <ul className="bulk-titles">
                    {titles.slice(0, PREVIEW).map((it) => (
                        <li key={it.id}>
                            <TypeIcon type={it.itemType} className="type-icon" />
                            {it.title || <em className="muted">（無標題）</em>}
                        </li>
                    ))}
                    {titles.length > PREVIEW && <li className="muted">…還有 {titles.length - PREVIEW} 個</li>}
                </ul>
            </div>

            {section("tags", "標籤", info?.tags.length, (
                <>
                    <div className="tags">
                        {info?.tags.map((t) => (
                            <span className="tag" key={t.value} title={`${t.count} 個條目有這個標籤`}>
                                {t.value}
                                <span className="tag-share">{ofN(t.count)}</span>
                                <button
                                    title="從所有選取的條目移除"
                                    onClick={() => run(() => drawerApi.bulkRemoveTag(itemIds, t.value), `已從 ${n} 個條目移除標籤「${t.value}」`)}
                                >×</button>
                            </span>
                        ))}
                        <input
                            className="tag-input"
                            placeholder="為全部加上標籤…"
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && addTag()}
                        />
                    </div>
                </>
            ))}

            {section("folders", "資料夾", memberOf.length, (
                <>
                    {memberOf.length > 0 ? (
                        <ul className="folder-paths">
                            {memberOf.map((m) => (
                                <li key={m.value} title={m.path}>
                                    <span className="folder-path-text"><Icon name="folder" /> {m.path}</span>
                                    <span className="tag-share">{ofN(m.count)}</span>
                                    <button
                                        title="把所有選取的條目移出這個資料夾"
                                        onClick={() =>
                                            run(() => drawerApi.removeItemsFromCollection(itemIds, m.value), `已把 ${n} 個條目移出「${m.path}」`)
                                        }
                                    >×</button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="muted">都不在任何資料夾</p>
                    )}
                    {addable.length > 0 && (
                        <select
                            className="folder-add"
                            value=""
                            onChange={(e) => {
                                const id = Number(e.target.value);
                                if (!id) return;
                                const path = collectionPath(collections, id);
                                run(() => drawerApi.addItemsToCollection(itemIds, id, null), `已把 ${n} 個條目加入「${path}」`);
                            }}
                        >
                            <option value="">＋ 全部加入資料夾…</option>
                            {addable.map((c) => (
                                <option key={c.id} value={c.id}>{c.path}</option>
                            ))}
                        </select>
                    )}
                </>
            ))}

            {section("type", "類型", undefined, (
                <>
                    <p className="bulk-line">
                        {info?.itemTypes.map((t) => `${itemType(t.value).icon} ${itemType(t.value).label} ${t.count}`).join("、")}
                    </p>
                    <select
                        className="folder-add"
                        value=""
                        onChange={(e) => {
                            const t = e.target.value;
                            if (!t || !confirm(`把 ${n} 個條目的類型都改為「${itemType(t).label}」？各欄位的內容會保留。`)) return;
                            run(() => drawerApi.bulkSetType(itemIds, t), `已把 ${n} 個條目改為「${itemType(t).label}」`);
                        }}
                    >
                        <option value="">全部改為…</option>
                        {groupedTypes().map(([group, types]) => (
                            <optgroup key={group} label={GROUP_LABELS[group]}>
                                {types.map((t) => (
                                    <option key={t.id} value={t.id}>{t.icon} {t.label}</option>
                                ))}
                            </optgroup>
                        ))}
                    </select>
                </>
            ))}

            {section("field", "設定欄位", undefined, (
                <div className="bulk-form">
                    <select value={field} onChange={(e) => setField(e.target.value)}>
                        {BULK_FIELDS.map((f) => (
                            <option key={f.key} value={f.key}>{f.label}</option>
                        ))}
                    </select>
                    <input
                        placeholder="新的值（留空表示清空）"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                    />
                    <button
                        className="primary-btn"
                        onClick={() => {
                            const v = value.trim();
                            const q = v
                                ? `把 ${n} 個條目的「${fieldLabel}」都設為「${v}」？原本的內容會被取代。`
                                : `清空 ${n} 個條目的「${fieldLabel}」？`;
                            if (!confirm(q)) return;
                            run(() => drawerApi.bulkSetField(itemIds, column(field), v), `已更新 ${n} 個條目的「${fieldLabel}」`);
                            setValue("");
                        }}
                    >套用</button>
                </div>
            ))}

            {section("related", "關聯", undefined, (
                <div className="bulk-line">
                    <button
                        className="secondary-btn"
                        onClick={() =>
                            run(async () => {
                                const added = await drawerApi.relateItems(itemIds);
                                onInfo(added === 0 ? `這 ${n} 個條目已經互相關聯了` : `已讓 ${n} 個條目互相關聯（新增 ${added} 組）`);
                            })
                        }
                    >讓這 {n} 個條目互相關聯</button>
                </div>
            ))}

            {section("creators", "加入人員", undefined, (
                <div className="bulk-form">
                    <select value={roles.includes(role) ? role : roles[0]} onChange={(e) => setRole(e.target.value)}>
                        {roles.map((r) => (
                            <option key={r} value={r}>{roleLabel(r)}</option>
                        ))}
                    </select>
                    <input placeholder="姓名，例如同一位譯者" value={person} onChange={(e) => setPerson(e.target.value)} />
                    <button
                        className="primary-btn"
                        disabled={!person.trim()}
                        onClick={() => {
                            const r = roles.includes(role) ? role : roles[0];
                            const name = person.trim();
                            setPerson("");
                            run(async () => {
                                const added = await drawerApi.bulkAddCreator(itemIds, { role: r, name });
                                onInfo(`已為 ${added} 個條目加上${roleLabel(r)}「${name}」${added < n ? `（${n - added} 個已經有了）` : ""}`);
                            });
                        }}
                    >加入</button>
                </div>
            ))}
        </aside>
    );
}

export default BulkEdit;
