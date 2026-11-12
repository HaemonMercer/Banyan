import { useCallback, useEffect, useRef, useState } from "react";

// ======================================================================
// Confirmation dialog: an in-app replacement for window.confirm (which is unstyled, shows the
// page's address and ignores the dark theme).
// ======================================================================

export interface AskOptions {
    /** The question, in a few words ("刪除白板「X」？"). */
    title: string;
    /** What will happen, if worth saying. Line breaks are kept. */
    message?: string;
    /** The confirming button's text (default 確定). */
    confirm?: string;
    /** Destructive: the confirming button is red, and Enter does not press it until it is focused. */
    danger?: boolean;
}

type Pending = AskOptions & { resolve: (ok: boolean) => void };
let show: ((p: Pending) => void) | null = null;
const queue: Pending[] = [];

/** Asks in a dialog; true when confirmed. Falls back to window.confirm if the host isn't mounted. */
export function ask(options: AskOptions | string): Promise<boolean> {
    const o = typeof options === "string" ? splitAsk(options) : options;
    if (!show) return Promise.resolve(window.confirm([o.title, o.message].filter(Boolean).join("\n")));
    return new Promise((resolve) => {
        const p = { ...o, resolve };
        if (queue.length === 0) show!(p);
        queue.push(p);
    });
}

/** "刪除 X？後面的說明" → title + message. */
export function splitAsk(q: string): AskOptions {
    // Prefer a question mark that ends a line; otherwise the first full-width one.
    const nl = q.search(/[？?]\n/);
    const i = nl >= 0 ? nl : q.indexOf("？");
    if (i < 0 || i === q.length - 1) return { title: q.trim() };
    return { title: q.slice(0, i + 1).trim(), message: q.slice(i + 1).trim() };
}

/** Mounted once (in App): shows the dialogs ask() opens, one at a time. */
export function DialogHost() {
    const [current, setCurrent] = useState<Pending | null>(null);
    const okRef = useRef<HTMLButtonElement>(null);
    const cancelRef = useRef<HTMLButtonElement>(null);
    const restoreFocus = useRef<HTMLElement | null>(null);

    useEffect(() => {
        show = (p) => {
            restoreFocus.current = document.activeElement as HTMLElement | null;
            setCurrent(p);
        };
        return () => {
            show = null;
        };
    }, []);

    const finish = useCallback((ok: boolean) => {
        const p = queue.shift();
        p?.resolve(ok);
        const next = queue[0] ?? null;
        setCurrent(next);
        if (!next) restoreFocus.current?.focus?.();
    }, []);

    useEffect(() => {
        if (!current) return;
        // A destructive action starts on 取消, so a stray Enter doesn't delete anything.
        (current.danger ? cancelRef : okRef).current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") finish(false);
            else if (e.key === "Enter" && !current.danger && document.activeElement !== cancelRef.current) finish(true);
            else if (e.key === "Tab") {
                // Keep the focus in the dialog.
                const ok = okRef.current;
                const cancel = cancelRef.current;
                if (!ok || !cancel) return;
                (document.activeElement === ok ? cancel : ok).focus();
            } else return;
            e.preventDefault();
            e.stopPropagation();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [current, finish]);

    if (!current) return null;
    return (
        <div className="modal-backdrop ask-backdrop" onMouseDown={(e) => e.target === e.currentTarget && finish(false)}>
            <div className="modal ask" role="alertdialog" aria-modal="true" aria-labelledby="ask-title" aria-describedby={current.message ? "ask-message" : undefined}>
                <h2 id="ask-title" className="ask-title">{current.title}</h2>
                {current.message && <p id="ask-message" className="ask-message">{current.message}</p>}
                <div className="modal-actions">
                    <button ref={cancelRef} className="secondary-btn" onClick={() => finish(false)}>
                        取消
                    </button>
                    <button ref={okRef} className={current.danger ? "primary-btn danger" : "primary-btn"} onClick={() => finish(true)}>
                        {current.confirm ?? "確定"}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ======================================================================
// Toasts: one message at the bottom of a module. Info fades after a while (longer for longer
// text); errors stay longer. Hovering keeps it; clicking × closes it. An action (e.g. 復原) can
// be offered.
// ======================================================================

export interface ToastState {
    text: string;
    kind: "error" | "info";
    action?: { label: string; run: () => void };
}

export function useToast() {
    const [toast, setToast] = useState<ToastState | null>(null);
    const showError = useCallback((text: string) => setToast({ text, kind: "error" }), []);
    const showInfo = useCallback((text: string, action?: ToastState["action"]) => setToast({ text, kind: "info", action }), []);
    const close = useCallback(() => setToast(null), []);
    return { toast, setToast, showError, showInfo, close };
}

export function Toast({ toast, onClose }: { toast: ToastState | null; onClose: () => void }) {
    const [hover, setHover] = useState(false);
    useEffect(() => {
        if (!toast || hover) return;
        const ms = toast.kind === "error" ? Math.max(8000, toast.text.length * 150) : Math.max(toast.action ? 6000 : 2500, toast.text.length * 110);
        const t = setTimeout(onClose, ms);
        return () => clearTimeout(t);
    }, [toast, hover, onClose]);
    useEffect(() => setHover(false), [toast]);
    if (!toast) return null;
    return (
        <div
            className={`toast${toast.kind === "info" ? " info" : ""}`}
            role={toast.kind === "error" ? "alert" : "status"}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
        >
            <span className="toast-text">{toast.text}</span>
            {toast.action && (
                <button
                    className="toast-action"
                    onClick={() => {
                        toast.action!.run();
                        onClose();
                    }}
                >
                    {toast.action.label}
                </button>
            )}
            <button className="toast-close" onClick={onClose} title="關閉" aria-label="關閉">
                ×
            </button>
        </div>
    );
}
