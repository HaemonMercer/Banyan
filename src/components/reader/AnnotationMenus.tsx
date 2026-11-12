import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { COLORS, lastColor, parseLocation, placeLabel, type Annotation, type AnnotationColor } from "../../annotator/api";
import { Icon } from "../../icons/Icon";

/** Keeps a floating box (fixed position) inside the window. */
function useClamped(x: number, y: number) {
    const ref = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ left: x, top: y });
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        setPos({
            left: Math.max(8, Math.min(x - r.width / 2, window.innerWidth - r.width - 8)),
            top: y + r.height + 8 > window.innerHeight ? Math.max(8, y - r.height - 28) : y,
        });
    }, [x, y]);
    return { ref, pos };
}

const inField = (e: KeyboardEvent) => !!(e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]");

/**
 * The open menu's (or popover's) keys. A book's text is in a frame whose key presses don't reach the
 * window, so the book passes them here first (true when the menu used the key).
 */
let menuKey: ((e: KeyboardEvent) => boolean) | null = null;
export function handleMenuKey(e: KeyboardEvent): boolean {
    return menuKey?.(e) ?? false;
}

function ColorDots({ current, recent, onPick }: {
    current?: AnnotationColor;
    /** The color last used (a small mark), when nothing is current. */
    recent?: AnnotationColor;
    onPick: (c: AnnotationColor) => void;
}) {
    return (
        <span className="annot-colors" role="group" aria-label="顏色">
            {COLORS.map((c, i) => (
                <button
                    key={c.id}
                    className={`annot-dot annot-bg-${c.id}${current === c.id ? " current" : ""}${recent === c.id ? " recent" : ""}`}
                    title={`${c.label}色（${i + 1}）`}
                    aria-label={`${c.label}色`}
                    aria-pressed={current === c.id}
                    onMouseDown={(e) => e.preventDefault()} // keep the text selection
                    onClick={() => onPick(c.id)}
                />
            ))}
        </span>
    );
}

/**
 * Shown under selected text: highlight in a color (1–5), highlight with a note in the last color
 * (N), copy (C). Esc closes it.
 */
export function SelectionMenu({ x, y, onColor, onNote, onCopy, onDismiss }: {
    x: number;
    y: number;
    onColor: (c: AnnotationColor) => void;
    onNote: () => void;
    onCopy: () => void;
    onDismiss: () => void;
}) {
    const { ref, pos } = useClamped(x, y);
    const recent = lastColor();
    useEffect(() => {
        const handler = (e: KeyboardEvent): boolean => {
            if (e.ctrlKey || e.metaKey || e.altKey || inField(e)) return false;
            const k = e.key.toLowerCase();
            const n = Number(e.key);
            if (Number.isInteger(n) && n >= 1 && n <= COLORS.length) onColor(COLORS[n - 1].id);
            else if (k === "n") onNote();
            else if (k === "c") onCopy();
            else if (e.key === "Escape") onDismiss();
            else return false;
            e.preventDefault();
            e.stopPropagation();
            return true;
        };
        menuKey = handler;
        const onWin = (e: KeyboardEvent) => void handler(e);
        window.addEventListener("keydown", onWin, true);
        return () => {
            if (menuKey === handler) menuKey = null;
            window.removeEventListener("keydown", onWin, true);
        };
    });
    return (
        <div ref={ref} className="annot-menu" style={pos} role="toolbar" aria-label="標註選取的文字">
            <ColorDots recent={recent} onPick={onColor} />
            <span className="reader-sep" />
            <button className="small-btn" onMouseDown={(e) => e.preventDefault()} onClick={onNote} title="畫重點並寫筆記（N）">
                <Icon name="note" /> 筆記
            </button>
            <button className="small-btn" onMouseDown={(e) => e.preventDefault()} onClick={onCopy} title="複製文字（C）">
                複製
            </button>
        </div>
    );
}

/** Opened by clicking a highlight: color, note, card, delete. */
export function AnnotationPopover({ annotation, x, y, focusNote, onClose, onColor, onNote, onCard, onDelete }: {
    annotation: Annotation;
    x: number;
    y: number;
    /** Put the cursor in the note right away (after "筆記"). */
    focusNote?: boolean;
    onClose: () => void;
    onColor: (c: AnnotationColor) => void;
    onNote: (note: string) => void;
    onCard: () => void;
    onDelete: () => void;
}) {
    const { ref, pos } = useClamped(x, y);
    const [note, setNote] = useState(annotation.note);
    const noteRef = useRef<HTMLTextAreaElement>(null);
    /** The note last saved (blur and closing both save; only once). */
    const saved = useRef(annotation.note);
    const save = () => {
        if (note === saved.current) return;
        saved.current = note;
        onNote(note);
    };
    const close = () => {
        save();
        onClose();
    };
    useEffect(() => {
        if (focusNote) noteRef.current?.focus();
    }, [focusNote]);
    // Clicking elsewhere or Esc closes it (saving the note); 1–5 recolor while not writing.
    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) close();
        };
        const handler = (e: KeyboardEvent): boolean => {
            if (e.key === "Escape") close();
            else if (e.ctrlKey || e.metaKey || e.altKey || inField(e)) return false;
            else {
                const n = Number(e.key);
                if (!(Number.isInteger(n) && n >= 1 && n <= COLORS.length)) return false;
                onColor(COLORS[n - 1].id);
            }
            e.preventDefault();
            e.stopPropagation();
            return true;
        };
        menuKey = handler;
        const onKey = (e: KeyboardEvent) => void handler(e);
        window.addEventListener("mousedown", onDown, true);
        window.addEventListener("keydown", onKey, true);
        return () => {
            if (menuKey === handler) menuKey = null;
            window.removeEventListener("mousedown", onDown, true);
            window.removeEventListener("keydown", onKey, true);
        };
    });
    const place = placeLabel(parseLocation(annotation));
    const date = new Date(annotation.createdAt).toLocaleDateString("zh-TW", { year: "numeric", month: "numeric", day: "numeric" });
    return (
        <div ref={ref} className={`annot-menu annot-popover annot-bg-${annotation.color}`} style={pos} role="dialog" aria-label="註解">
            <div className="annot-popover-head">
                <span>{place}</span>
                <span className="muted">· {date}</span>
                {annotation.cardCount > 0 && (
                    <span className="annot-popover-cited" title="引用這段的卡片數">
                        <Icon name="cards" /> {annotation.cardCount}
                    </span>
                )}
                <button className="icon-btn annot-popover-close" onClick={close} title="關閉（Esc）" aria-label="關閉">
                    <Icon name="close" />
                </button>
            </div>
            {annotation.quote && <blockquote className="annot-popover-quote">{annotation.quote}</blockquote>}
            <textarea
                ref={noteRef}
                className="annot-note-input"
                rows={3}
                placeholder="寫下筆記…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onBlur={save}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        close();
                    }
                }}
            />
            <div className="annot-popover-row">
                <ColorDots current={annotation.color} onPick={onColor} />
                <span className="annot-popover-actions">
                    <button className="small-btn" onClick={() => { save(); onCard(); }} title={annotation.cardId ? "開啟用這段做的卡片" : "用這段建立一張卡片（可放到白板）"}>
                        <Icon name="cards" /> {annotation.cardId ? "開啟卡片" : "建立卡片"}
                    </button>
                    <button className="small-btn danger" onClick={onDelete} title="刪除這個重點">
                        <Icon name="trash" />
                    </button>
                </span>
            </div>
        </div>
    );
}
