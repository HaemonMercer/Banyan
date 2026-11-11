/**
 * Manual "check for updates": opened from the rail, checks the update endpoint once, and on the
 * user's say-so downloads, verifies (signature) and installs the new version, then restarts.
 * Nothing is checked in the background.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

/** Marks the endpoint in tauri.conf.json that still has to be filled in. */
const PLACEHOLDER = "OWNER/REPO";

type State =
    | { kind: "checking" }
    | { kind: "unconfigured" }
    | { kind: "upToDate" }
    | { kind: "available"; update: Update }
    | { kind: "downloading"; update: Update; done: number; total: number | null }
    | { kind: "installed"; update: Update }
    | { kind: "error"; message: string; detail: string };

function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(raw: string | undefined): string | null {
    if (!raw) return null;
    const d = new Date(raw.replace(" ", "T").replace(/ \+00:00:00$/, "Z"));
    return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString("zh-TW");
}

/** Turns the plugin's English errors into something the user can act on. */
function explain(e: unknown): { message: string; detail: string } {
    const detail = typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
    const d = detail.toLowerCase();
    if (d.includes("signature"))
        return { message: "下載的更新檔簽章不符，已停止安裝。這可能是更新檔損壞或不是官方發布的版本。", detail };
    if (d.includes("valid release json") || d.includes("404") || d.includes("not found"))
        return { message: "找不到更新資訊（latest.json）。可能還沒有發布任何版本，或更新來源的網址不正確。", detail };
    if (d.includes("network") || d.includes("dns") || d.includes("connect") || d.includes("timed out") || d.includes("request"))
        return { message: "無法連線到更新伺服器，請確認網路連線後再試一次。", detail };
    return { message: "檢查更新時發生錯誤。", detail };
}

interface Props {
    onClose: () => void;
}

function UpdateDialog({ onClose }: Props) {
    const [version, setVersion] = useState<string | null>(null);
    const [endpoints, setEndpoints] = useState<string[]>([]);
    const [state, setState] = useState<State>({ kind: "checking" });
    const updateRef = useRef<Update | null>(null);

    const runCheck = useCallback(async () => {
        setState({ kind: "checking" });
        try {
            const list = await invoke<string[]>("update_endpoints");
            setEndpoints(list);
            if (list.length === 0 || list.some((u) => u.includes(PLACEHOLDER))) {
                setState({ kind: "unconfigured" });
                return;
            }
            const update = await check();
            updateRef.current = update;
            setState(update ? { kind: "available", update } : { kind: "upToDate" });
        } catch (e) {
            setState({ kind: "error", ...explain(e) });
        }
    }, []);

    useEffect(() => {
        getVersion().then(setVersion, () => setVersion(null));
        runCheck();
        // Release the update handle the plugin keeps on the Rust side.
        return () => {
            updateRef.current?.close().catch(() => {});
        };
    }, [runCheck]);

    const install = async (update: Update) => {
        let done = 0;
        let total: number | null = null;
        setState({ kind: "downloading", update, done, total });
        try {
            await update.downloadAndInstall((ev) => {
                if (ev.event === "Started") total = ev.data.contentLength ?? null;
                else if (ev.event === "Progress") done += ev.data.chunkLength;
                setState({ kind: "downloading", update, done, total });
            });
            // On Windows the installer closes the app itself; elsewhere we restart into the new version.
            setState({ kind: "installed", update });
        } catch (e) {
            setState({ kind: "error", ...explain(e) });
        }
    };

    const busy = state.kind === "checking" || state.kind === "downloading";

    return (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
            <div className="modal update-dialog" role="dialog" aria-labelledby="update-title">
                <div className="modal-header">
                    <h2 id="update-title">檢查更新</h2>
                    <button className="icon-btn" onClick={onClose} disabled={state.kind === "downloading"} title="關閉">
                        ×
                    </button>
                </div>

                <p className="muted">目前版本：{version ?? "…"}</p>

                {state.kind === "checking" && <p>正在檢查是否有新版本…</p>}

                {state.kind === "unconfigured" && (
                    <div className="notice err">
                        尚未設定更新來源。請把 <code>src-tauri/tauri.conf.json</code> 裡
                        <code>plugins.updater.endpoints</code> 的 <code>{PLACEHOLDER}</code> 改成 GitHub repository 名稱。
                    </div>
                )}

                {state.kind === "upToDate" && <p className="notice ok">已經是最新版本。</p>}

                {(state.kind === "available" || state.kind === "downloading" || state.kind === "installed") && (
                    <div className="update-info">
                        <p>
                            <strong>新版本 {state.update.version}</strong>
                            {formatDate(state.update.date) && <span className="muted">（{formatDate(state.update.date)} 發布）</span>}
                        </p>
                        {state.update.body && <pre className="update-notes">{state.update.body}</pre>}
                    </div>
                )}

                {state.kind === "downloading" && (
                    <div className="update-progress">
                        <div className="update-bar">
                            <div
                                className={`update-bar-fill${state.total ? "" : " indeterminate"}`}
                                style={state.total ? { width: `${Math.min(100, (state.done / state.total) * 100)}%` } : undefined}
                            />
                        </div>
                        <span className="muted">
                            下載中… {formatBytes(state.done)}
                            {state.total ? ` / ${formatBytes(state.total)}` : ""}
                        </span>
                    </div>
                )}

                {state.kind === "installed" && <p className="notice ok">新版本已安裝，重新啟動後生效。</p>}

                {state.kind === "error" && (
                    <div className="notice err">
                        {state.message}
                        <details className="update-detail">
                            <summary>詳細資訊</summary>
                            <code>{state.detail}</code>
                        </details>
                    </div>
                )}

                {endpoints.length > 0 && state.kind !== "unconfigured" && (
                    <p className="muted update-source" title={endpoints.join("\n")}>
                        更新來源：{endpoints[0]}
                    </p>
                )}

                <div className="modal-actions">
                    {state.kind === "available" && (
                        <>
                            <button className="secondary-btn" onClick={onClose}>稍後</button>
                            <button className="primary-btn" onClick={() => install(state.update)}>下載並安裝</button>
                        </>
                    )}
                    {state.kind === "installed" && (
                        <>
                            <button className="secondary-btn" onClick={onClose}>稍後重新啟動</button>
                            <button className="primary-btn" onClick={() => relaunch()}>立即重新啟動</button>
                        </>
                    )}
                    {(state.kind === "upToDate" || state.kind === "error" || state.kind === "unconfigured") && (
                        <>
                            <button className="secondary-btn" onClick={runCheck}>再檢查一次</button>
                            <button className="primary-btn" onClick={onClose}>關閉</button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export default UpdateDialog;
