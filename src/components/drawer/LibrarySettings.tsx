import { useEffect, useState } from "react";
import { drawerApi, errorMessage, type ChangeMode, type FolderCheck, type LibraryInfo } from "../../drawer/api";

interface Props {
    onClose: () => void;
    /** Called after the library location changed, so the views reload. */
    onChanged: (info: LibraryInfo) => void;
}

function LibrarySettings({ onClose, onChanged }: Props) {
    const [info, setInfo] = useState<LibraryInfo | null>(null);
    const [target, setTarget] = useState<FolderCheck | null>(null);
    const [busy, setBusy] = useState<ChangeMode | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState<string | null>(null);

    useEffect(() => {
        drawerApi.getLibraryInfo().then(setInfo, (e) => setError(errorMessage(e)));
    }, []);

    const choose = async (path: string | null) => {
        setError(null);
        setDone(null);
        if (!path) return;
        try {
            setTarget(await drawerApi.inspectLibraryDir(path));
        } catch (e) {
            setError(errorMessage(e));
        }
    };

    const apply = async (mode: ChangeMode) => {
        if (!target || !info) return;
        const oldPath = info.path;
        setBusy(mode);
        setError(null);
        try {
            const next = await drawerApi.changeLibraryDir(target.path, mode);
            setInfo(next);
            setTarget(null);
            setDone(
                mode === "move"
                    ? `已搬移到新位置。原本位置（${oldPath}）的資料仍保留著，確認無誤後可以自行刪除。`
                    : mode === "open"
                      ? "已開啟這個資料夾中的資料庫。"
                      : "已建立新的空資料庫。",
            );
            onChanged(next);
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
            <div className="modal" role="dialog" aria-labelledby="lib-title">
                <div className="modal-header">
                    <h2 id="lib-title">資料庫位置</h2>
                    <button className="icon-btn" onClick={onClose} disabled={!!busy} title="關閉">×</button>
                </div>

                <p className="muted">資料庫檔案（banyan.db）和所有附件（storage 資料夾）都放在這個資料夾裡。</p>

                <div className="path-box">
                    <code>{info?.path ?? "…"}</code>
                    {info?.isDefault && <span className="badge">預設</span>}
                </div>

                <div className="modal-actions">
                    <button className="secondary-btn" onClick={() => drawerApi.revealLibraryDir().catch((e) => setError(errorMessage(e)))}>
                        在檔案總管中開啟
                    </button>
                    {info && !info.isDefault && (
                        <button className="secondary-btn" disabled={!!busy} onClick={() => choose(info.defaultPath)}>
                            改回預設位置…
                        </button>
                    )}
                    <button className="primary-btn" disabled={!!busy} onClick={async () => choose(await drawerApi.pickLibraryDir())}>
                        變更位置…
                    </button>
                </div>

                {target && (
                    <div className="target-box">
                        <div className="target-path">
                            新位置：<code>{target.path}</code>
                        </div>
                        {target.isCurrent ? (
                            <p className="muted">這已經是目前的位置。</p>
                        ) : target.hasLibrary ? (
                            <>
                                <p>這個資料夾裡已經有一個資料庫。</p>
                                <div className="option-list">
                                    <button className="option" disabled={!!busy} onClick={() => apply("open")}>
                                        <strong>{busy === "open" ? "開啟中…" : "開啟這個資料庫"}</strong>
                                        <span>改用那裡的資料。目前的資料庫不會變動，之後可以再切換回來。</span>
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div className="option-list">
                                <button
                                    className="option"
                                    disabled={!!busy || !!target.moveBlocked}
                                    onClick={() => apply("move")}
                                >
                                    <strong>{busy === "move" ? "搬移中，請稍候…" : "把目前的資料庫搬到這裡"}</strong>
                                    <span>
                                        {target.moveBlocked ??
                                            "複製資料庫和所有附件到新位置，之後都使用新位置。原本的資料會保留。"}
                                    </span>
                                </button>
                                <button className="option" disabled={!!busy} onClick={() => apply("new")}>
                                    <strong>{busy === "new" ? "建立中…" : "在這裡建立新的空資料庫"}</strong>
                                    <span>從空白開始。目前的資料庫不會變動，之後可以再切換回來。</span>
                                </button>
                            </div>
                        )}
                        {!busy && (
                            <button className="link-btn" onClick={() => setTarget(null)}>取消</button>
                        )}
                    </div>
                )}

                {done && <p className="notice ok">{done}</p>}
                {error && <p className="notice err">{error}</p>}
            </div>
        </div>
    );
}

export default LibrarySettings;
