import { useCallback, useState } from "react";
import type { Annotation } from "../../annotator/api";
import { drawerApi, errorMessage } from "../../drawer/api";
import { Icon } from "../../icons/Icon";
import type { FileTabInfo } from "../../tabs";
import { AnnotationList } from "../annotator/AnnotatorView";
import { Toast, useToast } from "../Feedback";
import BookView from "../reader/BookView";
import PdfView from "../reader/PdfView";
import { readerKind } from "../reader/Reader";
import { ReaderMessage } from "../reader/shared";

const NOTES_KEY = "banyan.tabs.notes";

/**
 * A PDF or book in its own tab: the reader with its tools, and the file's annotations on the right
 * (can be hidden). Highlighting, notes and cards work as in the Annotator.
 */
function FileTab({ tab, onOpenItem }: { tab: FileTabInfo; onOpenItem: (itemId: number) => void }) {
    const { toast, showError, showInfo, close } = useToast();
    const [toolsEl, setToolsEl] = useState<HTMLDivElement | null>(null);
    const [jumpTo, setJumpTo] = useState<{ annotation: Annotation; nonce: number } | null>(null);
    const [active, setActive] = useState<number | null>(null);
    const [notesOpen, setNotesOpen] = useState(() => {
        try {
            return localStorage.getItem(NOTES_KEY) !== "0";
        } catch {
            return true;
        }
    });
    const toggleNotes = () => {
        setNotesOpen((o) => {
            try {
                localStorage.setItem(NOTES_KEY, o ? "0" : "1");
            } catch {
                /* this session only */
            }
            return !o;
        });
    };
    const jump = useCallback((a: Annotation) => {
        setActive(a.id);
        setJumpTo((j) => ({ annotation: a, nonce: (j?.nonce ?? 0) + 1 }));
    }, []);
    const onActive = useCallback((id: number | null) => {
        if (id !== null) setActive(id);
    }, []);

    const kind = readerKind({ id: tab.attachmentId, fileName: tab.fileName });
    const annotatable = kind === "pdf" || kind === "book";
    const showNotes = annotatable && notesOpen;
    const openExternally = () => drawerApi.openAttachment(tab.attachmentId).catch((e) => showError(errorMessage(e)));

    return (
        <div className={`file-tab${showNotes ? "" : " no-notes"}`}>
            <section className="annotator-main">
                <header className="reader-bar">
                    <span className="reader-title" title={tab.fileName}>{tab.title}</span>
                    <div className="reader-tools" ref={setToolsEl} />
                    {annotatable && (
                        <button
                            className={`icon-btn file-tab-notes${notesOpen ? " active" : ""}`}
                            onClick={toggleNotes}
                            title={notesOpen ? "隱藏註解" : "顯示註解"}
                            aria-pressed={notesOpen}
                        >
                            <Icon name="note" />
                        </button>
                    )}
                    {tab.itemId !== null && (
                        <button className="secondary-btn" onClick={() => onOpenItem(tab.itemId!)} title="在 Drawer 中顯示這個條目">
                            在 Drawer 中顯示
                        </button>
                    )}
                    <button className="secondary-btn" onClick={openExternally} title="用系統預設的程式開啟">預設程式開啟</button>
                </header>
                <div className="reader-body">
                    {kind === "pdf" ? (
                        <PdfView id={tab.attachmentId} toolsEl={toolsEl} onError={showError} onInfo={showInfo} jumpTo={jumpTo} onActive={onActive} />
                    ) : kind === "book" ? (
                        <BookView id={tab.attachmentId} fileName={tab.fileName} toolsEl={toolsEl} onError={showError} onInfo={showInfo} jumpTo={jumpTo} onActive={onActive} />
                    ) : (
                        <ReaderMessage>
                            <p>這種檔案不能在分頁中閱讀。</p>
                            <button className="primary-btn" onClick={openExternally}>用預設程式開啟</button>
                        </ReaderMessage>
                    )}
                </div>
            </section>
            {showNotes && (
                <AnnotationList
                    file={{
                        attachmentId: tab.attachmentId,
                        fileName: tab.fileName,
                        size: 0,
                        itemId: tab.itemId ?? 0,
                        itemTitle: tab.title,
                        itemType: "",
                        annotationCount: 0,
                        lastAnnotated: 0,
                    }}
                    active={active}
                    onJump={jump}
                    onError={showError}
                    onInfo={showInfo}
                />
            )}
            <Toast toast={toast} onClose={close} />
        </div>
    );
}

export default FileTab;
