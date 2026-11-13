/**
 * The item's citation key (`@kahneman2011`): shown in 資料, editable, copyable as `[@key]`.
 * Renaming rewrites the key in every card that cites it (backend `set_cite_key`).
 */
import { useEffect, useState } from "react";
import { Icon } from "../../icons/Icon";
import { errorMessage } from "../../drawer/api";
import { citeApi, invalidateCites } from "../../markdown/citeStore";

interface Props {
    itemId: number;
    citeKey: string;
    onChanged: (key: string) => void;
    onError: (message: string) => void;
    onInfo: (message: string) => void;
}

export default function CiteKeyField({ itemId, citeKey, onChanged, onError, onInfo }: Props) {
    const [draft, setDraft] = useState(citeKey);
    useEffect(() => setDraft(citeKey), [citeKey]);

    const commit = async () => {
        const next = draft.trim().replace(/^@/, "");
        if (!next || next === citeKey) {
            setDraft(citeKey);
            return;
        }
        try {
            const saved = await citeApi.setKey(itemId, next);
            invalidateCites();
            onChanged(saved);
            onInfo(`引用鍵改成 @${saved}，卡片中的引用已一起更新`);
        } catch (e) {
            setDraft(citeKey);
            onError(errorMessage(e));
        }
    };

    return (
        <label className="field cite-key-field">
            <span title="在卡片中寫 [@引用鍵] 引用這筆資料；鍵在第一次被引用或手動修改後就固定">引用鍵</span>
            <div className="cite-key-row">
                <span className="cite-key-at">@</span>
                <input
                    value={draft}
                    spellCheck={false}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => void commit()}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            e.currentTarget.blur();
                        } else if (e.key === "Escape") {
                            setDraft(citeKey);
                        }
                    }}
                />
                <button
                    type="button"
                    className="icon-btn"
                    title={`複製 [@${citeKey}]`}
                    onClick={(e) => {
                        e.preventDefault();
                        void navigator.clipboard.writeText(`[@${citeKey}]`).then(
                            () => onInfo(`已複製 [@${citeKey}]`),
                            () => onError("無法複製到剪貼簿"),
                        );
                    }}
                >
                    <Icon name="link" />
                </button>
            </div>
        </label>
    );
}
