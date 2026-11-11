import { useEffect, useRef, useState } from "react";
import type { Creator } from "../../drawer/api";
import { creatorRoles, roleLabel } from "../../drawer/itemTypes";

interface Props {
    itemType: string;
    /** Saved creators; the editor keeps its own draft and calls `onSave` when it changes. */
    creators: Creator[];
    onSave: (creators: Creator[]) => void;
}

const clean = (list: Creator[]) =>
    list.map((c) => ({ role: c.role, name: c.name.trim() })).filter((c) => c.name !== "");

/**
 * Editable list of creators: each row is a role (作者 / 編者 / 譯者 / 導演…) and a name.
 * Saves when a name field loses focus, a role changes, or a row is moved or removed.
 */
function CreatorsEditor({ itemType, creators, onSave }: Props) {
    const roles = creatorRoles(itemType);
    const primary = roles[0];
    const blank = (): Creator => ({ role: primary, name: "" });

    const [rows, setRows] = useState<Creator[]>(creators.length ? creators : [blank()]);
    const savedRef = useRef(JSON.stringify(clean(creators)));
    const inputs = useRef<(HTMLInputElement | null)[]>([]);
    const [focusRow, setFocusRow] = useState<number | null>(null);

    // Reload when the saved list changes from outside (e.g. after a save round-trip).
    useEffect(() => {
        const json = JSON.stringify(clean(creators));
        if (json !== savedRef.current) {
            savedRef.current = json;
            setRows(creators.length ? creators : [blank()]);
        }
    }, [creators]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (focusRow !== null) {
            inputs.current[focusRow]?.focus();
            setFocusRow(null);
        }
    }, [focusRow]);

    const commit = (next: Creator[]) => {
        const json = JSON.stringify(clean(next));
        if (json === savedRef.current) return;
        savedRef.current = json;
        onSave(clean(next));
    };

    const update = (i: number, patch: Partial<Creator>, save = false) => {
        const next = rows.map((r, k) => (k === i ? { ...r, ...patch } : r));
        setRows(next);
        if (save) commit(next);
    };

    const insertAfter = (i: number) => {
        const next = [...rows.slice(0, i + 1), blank(), ...rows.slice(i + 1)];
        setRows(next);
        setFocusRow(i + 1);
    };

    const remove = (i: number) => {
        const next = rows.filter((_, k) => k !== i);
        setRows(next.length ? next : [blank()]);
        commit(next);
    };

    const move = (i: number, delta: number) => {
        const j = i + delta;
        if (j < 0 || j >= rows.length) return;
        const next = [...rows];
        [next[i], next[j]] = [next[j], next[i]];
        setRows(next);
        commit(next);
    };

    return (
        <div className="creators">
            {rows.map((c, i) => {
                // Keep a role that isn't offered for this type (e.g. after changing the type).
                const options = roles.includes(c.role) ? roles : [...roles, c.role];
                return (
                    <div className="creator-row" key={i}>
                        <select
                            className="creator-role"
                            value={c.role}
                            title="身分"
                            onChange={(e) => update(i, { role: e.target.value }, true)}
                        >
                            {options.map((r) => (
                                <option key={r} value={r}>{roleLabel(r)}</option>
                            ))}
                        </select>
                        <input
                            ref={(el) => {
                                inputs.current[i] = el;
                            }}
                            className="creator-name"
                            value={c.name}
                            placeholder={`${roleLabel(c.role)}姓名`}
                            onChange={(e) => update(i, { name: e.target.value })}
                            onBlur={() => commit(rows)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    commit(rows);
                                    insertAfter(i);
                                }
                            }}
                        />
                        <span className="creator-actions">
                            <button title="上移" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                            <button title="下移" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓</button>
                            <button title="移除" onClick={() => remove(i)}>×</button>
                        </span>
                    </div>
                );
            })}
            <button className="link-btn creator-add" onClick={() => insertAfter(rows.length - 1)}>
                ＋ 新增{roleLabel(primary)}或其他身分
            </button>
        </div>
    );
}

export default CreatorsEditor;
