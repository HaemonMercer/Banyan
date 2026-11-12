import { useEffect, useState } from "react";
import { drawerApi, errorMessage, type BackupInfo, type ChangeMode, type FolderCheck, type LibraryInfo } from "../../drawer/api";
import { formatSize } from "../../drawer/itemTypes";
import { ask } from "../Feedback";

const formatTime = (t: number) =>
    new Date(t).toLocaleString("zh-TW", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Settings → 資料儲存位置: where banyan.db and the storage folder live, and moving / switching it.
 * Drawer and Whiteboard reload on their own when the user goes back to them (they remount).
 */
function LibraryPanel() {
    const [info, setInfo] = useState<LibraryInfo | null>(null);
    const [target, setTarget] = useState<FolderCheck | null>(null);
    const [busy, setBusy] = useState<ChangeMode | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState<string | null>(null);
    const [backups, setBackups] = useState<BackupInfo[]>([]);
    const [restoring, setRestoring] = useState<string | null>(null);

    const loadBackups = () => drawerApi.listBackups().then(setBackups, (e) => setError(errorMessage(e)));

    useEffect(() => {
        drawerApi.getLibraryInfo().then(setInfo, (e) => setError(errorMessage(e)));
        loadBackups();
    }, []);

    const restore = async (b: BackupInfo) => {
        const ok = await ask({
            title: `還原 ${formatTime(b.createdAt)} 的備份？`,
            message:
                "資料庫會回到那時的內容，之後新增或修改的條目、卡片、白板與註解都會消失。\n" +
                "還原前，目前的資料庫會先另存一份到備份資料夾，需要時可以再還原回來。\n" +
                "附件檔案（storage 資料夾）不會變動：之後才加入的附件檔案會留在資料夾中，但不再出現在 Banyan 裡。",
            confirm: "還原",
            danger: true,
        });
        if (!ok) return;
        setRestoring(b.name);
        setError(null);
        setDone(null);
        try {
            const next = await drawerApi.restoreBackup(b.name);
            setInfo(next);
            setDone(next.notice);
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setRestoring(null);
            loadBackups();
        }
    };

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
            loadBackups();
            setDone(
                mode === "move"
                    ? `已搬移到新位置。原本位置（${oldPath}）的資料仍保留著，確認無誤後可以自行刪除。`
                    : mode === "open"
                      ? "已開啟這個資料夾中的資料庫。"
                      : "已建立新的空資料庫。",
            );
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setBusy(null);
        }
    };

    return (
        <>
            <p className="muted">資料庫檔案（banyan.db）和所有附件（storage 資料夾）都放在這個資料夾裡。</p>

            <div className="path-box">
                <code>{info?.path ?? "…"}</code>
                {info?.isDefault && <span className="badge">預設</span>}
            </div>
            {info?.warning && <p className="notice err">{info.warning}</p>}
            {info?.notice && info.notice !== done && <p className="notice ok">{info.notice}</p>}

            <div className="settings-actions">
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

            <h3 className="settings-subhead">更新時的資料庫保護</h3>
            <p className="muted">
                Banyan 更新後若需要升級資料庫，會先檢查檔案是否完整，並把原本的資料庫備份到 backups
                資料夾（保留最近 5 份），{""}再一次完成升級；升級失敗會全部還原。由較新版 Banyan 建立的資料庫不會被開啟，以免損壞。{""}
                需要時可以把資料庫還原成下列任一份備份（較舊的備份會自動升級到目前的版本）。
            </p>
            {backups.length > 0 ? (
                <ul className="backup-list">
                    {backups.map((b) => (
                        <li key={b.name}>
                            <div className="backup-info">
                                <span>
                                    {formatTime(b.createdAt)}
                                    {b.beforeRestore && <span className="badge">還原前</span>}
                                </span>
                                <span className="muted">
                                    資料庫第 {b.version} 版 · {formatSize(b.size)}
                                </span>
                            </div>
                            <button className="secondary-btn" disabled={!!restoring || !!busy} onClick={() => restore(b)}>
                                {restoring === b.name ? "還原中…" : "還原…"}
                            </button>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="muted">目前沒有備份。</p>
            )}
            {backups.length > 0 && (
                <div className="settings-actions">
                    <button className="secondary-btn" onClick={() => drawerApi.revealBackups().catch((e) => setError(errorMessage(e)))}>
                        開啟備份資料夾
                    </button>
                </div>
            )}

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
        </>
    );
}

export default LibraryPanel;
