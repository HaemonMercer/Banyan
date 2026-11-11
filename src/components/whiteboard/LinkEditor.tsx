import { useEffect, useRef, useState } from "react";
import { directionFor, type CardLink, type LinkDirection } from "../../whiteboard/api";

interface Props {
    link: CardLink;
    titleA: string;
    titleB: string;
    /** Bumped to put the cursor in the note box (e.g. after double-clicking the line). */
    focusKey: number;
    onChange: (direction: LinkDirection, note: string) => Promise<void>;
    onUnlink: () => void;
}

const short = (t: string) => (t.length > 14 ? t.slice(0, 13) + "…" : t);

/** Right pane, when a line is selected: which way it points, and its note. */
function LinkEditor({ link, titleA, titleB, focusKey, onChange, onUnlink }: Props) {
    const [note, setNote] = useState(link.note);
    const noteRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => setNote(link.note), [link.id, link.note]);
    useEffect(() => {
        if (focusKey > 0) noteRef.current?.focus();
    }, [focusKey]);

    const a = link.cardA;
    const options: { dir: LinkDirection; label: string; title: string }[] = [
        { dir: directionFor(link, a, "forward"), label: `${short(titleA)} → ${short(titleB)}`, title: "單向：從前者指向後者" },
        { dir: directionFor(link, a, "backward"), label: `${short(titleB)} → ${short(titleA)}`, title: "單向：反過來" },
        { dir: 3, label: "↔ 雙向箭頭", title: "兩邊都有箭頭" },
        { dir: 0, label: "— 無方向", title: "不畫箭頭" },
    ];

    const saveNote = () => {
        if (note.trim() !== link.note) void onChange(link.direction, note.trim());
    };

    return (
        <section className="wb-selected wb-link-editor">
            <div className="wb-selected-header">
                <span className="wb-selected-title">連結</span>
                <button className="danger-btn" onClick={onUnlink}>移除連結</button>
            </div>
            <div className="wb-selected-body">
                <h3 className="wb-section-title">方向</h3>
                <div className="wb-dir-options" role="radiogroup">
                    {options.map((o) => (
                        <button
                            key={o.dir}
                            role="radio"
                            aria-checked={link.direction === o.dir}
                            className={link.direction === o.dir ? "active" : ""}
                            title={o.title}
                            onClick={() => link.direction !== o.dir && void onChange(o.dir, note.trim())}
                        >
                            {o.label}
                        </button>
                    ))}
                </div>
                <h3 className="wb-section-title">備註</h3>
                <textarea
                    ref={noteRef}
                    className="wb-link-note-input"
                    rows={3}
                    placeholder="例如：支持、反駁、導致、是…的例子"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onBlur={saveNote}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            e.currentTarget.blur();
                        }
                        if (e.key === "Escape") {
                            setNote(link.note);
                            e.stopPropagation();
                        }
                    }}
                />
            </div>
        </section>
    );
}

export default LinkEditor;
