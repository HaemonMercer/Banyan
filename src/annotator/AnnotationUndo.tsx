import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DELETED_EVENT, restoreAnnotation, type Annotation } from "./api";
import { Toast, type ToastState } from "../components/Feedback";

/**
 * "已刪除重點　復原": shown after an annotation is deleted anywhere in the app. 復原 (or Ctrl+Z
 * while it shows, outside a text field) puts it back.
 */
function AnnotationUndo() {
    const [deleted, setDeleted] = useState<Annotation | null>(null);
    const [failed, setFailed] = useState<string | null>(null);

    useEffect(() => {
        const on = (e: Event) => {
            setFailed(null);
            setDeleted((e as CustomEvent<Annotation>).detail);
        };
        window.addEventListener(DELETED_EVENT, on);
        return () => window.removeEventListener(DELETED_EVENT, on);
    }, []);

    const undo = () => {
        const a = deleted;
        if (!a) return;
        setDeleted(null);
        restoreAnnotation(a).catch((e) => setFailed(`無法復原：${e instanceof Error ? e.message : String(e)}`));
    };

    useEffect(() => {
        if (!deleted) return;
        const onKey = (e: KeyboardEvent) => {
            if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== "z") return;
            if ((e.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable]")) return;
            e.preventDefault();
            undo();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }); // eslint-disable-line react-hooks/exhaustive-deps

    // Made once per deletion, so the toast's timer isn't restarted by re-renders.
    const toast = useMemo<ToastState | null>(
        () =>
            failed
                ? { text: failed, kind: "error" }
                : deleted
                  ? { text: `已刪除${deleted.kind === "bookmark" ? "書籤" : "重點"}（Ctrl＋Z 復原）`, kind: "info", action: { label: "復原", run: () => undoRef.current() } }
                  : null,
        [deleted, failed],
    );
    const undoRef = useRef(undo);
    undoRef.current = undo;
    const close = useCallback(() => {
        setDeleted(null);
        setFailed(null);
    }, []);
    return <Toast toast={toast} onClose={close} />;
}

export default AnnotationUndo;
