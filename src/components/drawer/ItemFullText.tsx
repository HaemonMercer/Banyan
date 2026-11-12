import SectionHeader from "./SectionHeader";
import { ask } from "../Feedback";

interface Props {
    value: string;
    onChange: (text: string) => void;
    /** Saves the item (also called on blur). */
    onSave: () => void;
    onError: (message: string) => void;
    collapsed: boolean;
    onToggle: () => void;
}

/** First non-empty line of a pasted text, used as the title of a new item. */
export function firstLine(text: string): string {
    const line = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
    return line.length > 200 ? line.slice(0, 200) : line;
}

/** 原文: the item's text pasted as-is (line breaks and spacing kept), e.g. a news article. */
function ItemFullText({ value, onChange, onSave, onError, collapsed, onToggle }: Props) {
    const chars = [...value.replace(/\s/g, "")].length;

    const pasteFromClipboard = async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (!text) return onError("剪貼簿裡沒有文字");
            if (value.trim() && !(await ask({ title: "用剪貼簿的內容取代目前的原文？", confirm: "取代" }))) return;
            onChange(text);
            setTimeout(onSave, 0);
        } catch {
            onError("無法讀取剪貼簿，請在原文欄中按 Ctrl＋V 貼上");
        }
    };

    return (
        <section className="detail-section item-full-text">
            <SectionHeader title="原文" collapsed={collapsed} onToggle={onToggle}>
                {chars > 0 && <span className="muted full-text-count">{chars.toLocaleString()} 字</span>}
                <button
                    className="small-btn"
                    onClick={() => {
                        if (collapsed) onToggle();
                        pasteFromClipboard();
                    }}
                >
                    貼上
                </button>
            </SectionHeader>
            <div hidden={collapsed}>
                <textarea
                    className="full-text"
                    value={value}
                    placeholder="貼上原文"
                    spellCheck={false}
                    onChange={(e) => onChange(e.target.value)}
                    onBlur={onSave}
                />
            </div>
        </section>
    );
}

export default ItemFullText;
