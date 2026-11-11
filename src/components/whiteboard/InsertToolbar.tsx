import { useEffect, useRef, useState } from "react";
import { Icon } from "../../icons/Icon";
import type { IconName } from "../../icons/icons";

interface Props {
    onCard: () => void;
    onSticky: () => void;
    onSection: () => void;
    onImage: () => void;
    /** Returns whether the link was accepted (the box closes then). */
    onVideo: (url: string) => Promise<boolean>;
    onPdf: () => void;
    onMindMap: () => void;
    onTable: () => void;
    onChart: () => void;
}

/**
 * The board's insert tools, floating on the left edge of the canvas (like Miro's toolbar).
 * Images, PDFs and YouTube links can also be pasted or dropped onto the board.
 */
function InsertToolbar({ onCard, onSticky, onSection, onImage, onVideo, onPdf, onMindMap, onTable, onChart }: Props) {
    const [videoOpen, setVideoOpen] = useState(false);
    const tools: { icon: IconName; label: string; hint: string; run: () => void; active?: boolean }[] = [
        { icon: "note", label: "卡片", hint: "新卡片（Markdown）；也可以在空白處雙擊", run: onCard },
        { icon: "sticky", label: "便利貼", hint: "便利貼", run: onSticky },
        { icon: "section", label: "區塊", hint: "區塊（選取卡片時會包住它們）", run: onSection },
        { icon: "mindmap", label: "心智圖", hint: "心智圖：Tab 新增子主題、Enter 新增同層主題", run: onMindMap },
        { icon: "table", label: "表格", hint: "表格：可輸入公式，例如 =SUM(B2:B5)", run: onTable },
        { icon: "chart", label: "圖表", hint: "圖表：選取表格時，用它的資料畫圖；否則建立範例表格和圖表", run: onChart },
        { icon: "image", label: "圖片", hint: "圖片：選擇檔案；也可以直接貼上（Ctrl＋V）或把檔案拖進來", run: onImage },
        { icon: "video", label: "影片", hint: "YouTube 影片：貼上連結；也可以直接在白板上貼上連結", run: () => setVideoOpen((v) => !v), active: videoOpen },
        { icon: "pdf", label: "PDF", hint: "PDF：選擇檔案；也可以把檔案拖進來", run: onPdf },
    ];
    return (
        <div className="wb-toolbar" role="toolbar" aria-label="插入">
            {tools.map((t) => (
                <button
                    key={t.label}
                    className={`wb-tool${t.active ? " active" : ""}`}
                    title={t.hint}
                    onClick={() => {
                        if (t.icon !== "video") setVideoOpen(false);
                        t.run();
                    }}
                >
                    <Icon name={t.icon} />
                    <span className="wb-tool-label">{t.label}</span>
                </button>
            ))}
            {videoOpen && <VideoBox onSubmit={onVideo} onClose={() => setVideoOpen(false)} />}
        </div>
    );
}

function VideoBox({ onSubmit, onClose }: { onSubmit: (url: string) => Promise<boolean>; onClose: () => void }) {
    const [url, setUrl] = useState("");
    const [busy, setBusy] = useState(false);
    const ref = useRef<HTMLInputElement>(null);
    useEffect(() => ref.current?.focus(), []);
    const submit = async () => {
        if (!url.trim() || busy) return;
        setBusy(true);
        const ok = await onSubmit(url);
        setBusy(false);
        if (ok) onClose();
    };
    return (
        <div className="wb-tool-pop">
            <div className="wb-tool-pop-title">加入 YouTube 影片</div>
            <input
                ref={ref}
                className="wb-search"
                placeholder="https://www.youtube.com/watch?v=…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") void submit();
                    if (e.key === "Escape") onClose();
                }}
            />
            <div className="wb-tool-pop-actions">
                <button className="small-btn" onClick={onClose}>取消</button>
                <button className="primary-btn" disabled={!url.trim() || busy} onClick={() => void submit()}>
                    加入
                </button>
            </div>
        </div>
    );
}

export default InsertToolbar;
