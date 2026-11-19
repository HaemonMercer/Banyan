import { useEffect, useState, type ReactNode } from "react";
import { FolderIcon, MonitorIcon, MoonIcon, SunIcon } from "../editor/icons";
import { setTypingPref, typingPrefs, type TypingPrefs } from "../editor/typing";
import type { ThemePref } from "./nav";
import {
  canChooseStorage,
  pickFolder,
  revealFolder,
  samePath,
  setStorage,
  storageInfo,
  type StorageInfo,
} from "./storage";
import {
  appVersion,
  canUpdate,
  checkUpdate,
  installUpdate,
  sizeText,
  updateError,
  type UpdateState,
} from "./updates";
import "./settings.css";

const THEMES: { pref: ThemePref; label: string; hint: string; icon: ReactNode }[] = [
  { pref: "system", label: "System", hint: "Follow Windows", icon: <MonitorIcon /> },
  { pref: "light", label: "Light", hint: "Always light", icon: <SunIcon /> },
  { pref: "dark", label: "Dark", hint: "Always dark", icon: <MoonIcon /> },
];

/** 選好新位置、還沒確認：dir 是 null 表示回到預設位置。 */
type Pending = { dir: string | null; shown: string };

/**
 * 設定畫面：外觀（主題）與儲存位置。
 * 換位置後重新載入整個 App，讓所有文件從新的資料夾讀進來。
 */
export function SettingsView(props: { theme: ThemePref; onTheme: (t: ThemePref) => void; saving: boolean }) {
  return (
    <div className="settings">
      <section className="set-section">
        <h2>Appearance</h2>
        <div className="set-row">
          <div className="set-label">
            <span>Theme</span>
            <small>Colors for the whole app</small>
          </div>
        </div>
        <div className="theme-cards" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button
              key={t.pref}
              role="radio"
              aria-checked={props.theme === t.pref}
              className={`theme-card${props.theme === t.pref ? " on" : ""}`}
              onClick={() => props.onTheme(t.pref)}
            >
              <span className={`theme-preview ${t.pref}`} aria-hidden>
                <span className="tp-side" />
                <span className="tp-body">
                  <span />
                  <span />
                  <span />
                </span>
              </span>
              <span className="theme-name">
                {t.icon} {t.label}
              </span>
              <small>{t.hint}</small>
            </button>
          ))}
        </div>
      </section>

      <TypingSection />
      <StorageSection saving={props.saving} />
      <UpdateSection saving={props.saving} />
    </div>
  );
}

/** 輔助打字（`editor/typing.ts`）：每條規則一個開關 */
const TYPING_RULES: { key: keyof TypingPrefs; label: string; hint: string }[] = [
  { key: "cjkPunct", label: "Chinese punctuation", hint: "In a Chinese sentence, , . ? ( \" become ，。？（「" },
  { key: "enPunct", label: "English punctuation", hint: "In an English sentence, ，。？（「 become , . ? ( \"" },
  { key: "capitalize", label: "Capitalize sentences", hint: "Start English sentences with a capital letter; a lone i becomes I" },
  { key: "spacing", label: "Space between Chinese and English", hint: "Add a space where Chinese meets English letters or numbers: 用 Banyan 寫" },
];

function TypingSection() {
  const [prefs, setPrefs] = useState(typingPrefs);
  return (
    <section className="set-section">
      <h2>Typing</h2>
      {TYPING_RULES.map((r) => (
        <label key={r.key} className="set-row set-toggle">
          <div className="set-label">
            <span>{r.label}</span>
            <small>{r.hint}</small>
          </div>
          <input
            type="checkbox"
            role="switch"
            checked={prefs[r.key]}
            onChange={(e) => setPrefs(setTypingPref(r.key, e.target.checked))}
          />
        </label>
      ))}
      <p className="set-note">Press Backspace right after a change to keep what you typed.</p>
    </section>
  );
}

/** 關於與更新：目前版本、手動檢查新版本、下載安裝後重新啟動。 */
function UpdateSection(props: { saving: boolean }) {
  const [version, setVersion] = useState<string | null>(null);
  const [state, setState] = useState<UpdateState>({ kind: "idle" });
  const available = canUpdate();

  useEffect(() => {
    appVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  const check = async () => {
    setState({ kind: "checking" });
    try {
      const update = await checkUpdate();
      setState(update ? { kind: "available", update } : { kind: "latest", checked: new Date() });
    } catch (e) {
      setState({ kind: "error", message: updateError(e) });
    }
  };

  const install = async () => {
    if (state.kind !== "available") return;
    const { update } = state;
    setState({ kind: "downloading", version: update.version, done: 0, total: null });
    try {
      await installUpdate(update, (done, total) =>
        setState({ kind: "downloading", version: update.version, done, total }),
      );
    } catch (e) {
      setState({ kind: "error", message: updateError(e) });
    }
  };

  const busy = state.kind === "checking" || state.kind === "downloading";

  return (
    <section className="set-section">
      <h2>About</h2>
      <div className="set-row">
        <div className="set-label">
          <span>Banyan {version ? `v${version}` : ""}</span>
          <small>Updates are checked only when you ask</small>
        </div>
        {available && (
          <button className="set-btn" disabled={busy} onClick={check}>
            {state.kind === "checking" ? "Checking…" : "Check for updates"}
          </button>
        )}
      </div>

      {!available && <p className="set-note">Updates are available in the desktop app.</p>}
      {state.kind === "latest" && (
        <p className="set-note" role="status">
          You're on the latest version (checked at {state.checked.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}).
        </p>
      )}
      {state.kind === "available" && (
        <div className="storage-confirm" role="group" aria-label="Update available">
          <p>
            Version <strong>{state.update.version}</strong> is available.
          </p>
          {state.update.body && <p className="set-note update-notes">{state.update.body}</p>}
          <p className="set-note">Banyan restarts after installing.</p>
          <div className="set-actions">
            <button className="set-btn primary" disabled={props.saving} onClick={install}>
              Install and restart
            </button>
            <button className="set-btn" onClick={() => setState({ kind: "idle" })}>
              Later
            </button>
          </div>
          {props.saving && <p className="set-note">Waiting for changes to save…</p>}
        </div>
      )}
      {state.kind === "downloading" && (
        <div className="update-progress" role="status">
          <p className="set-note">
            Downloading {state.version}… {sizeText(state.done)}
            {state.total ? ` of ${sizeText(state.total)}` : ""}
          </p>
          <progress value={state.total ? state.done : undefined} max={state.total ?? undefined} />
        </div>
      )}
      {state.kind === "error" && (
        <p className="set-error" role="alert">
          {state.message}
        </p>
      )}
    </section>
  );
}

function StorageSection(props: { saving: boolean }) {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const available = canChooseStorage();

  useEffect(() => {
    if (!available) return;
    storageInfo()
      .then(setInfo)
      .catch((e) => setError(String(e)));
  }, [available]);

  const choose = async () => {
    setError("");
    try {
      const dir = await pickFolder(info?.dir);
      if (!dir) return;
      if (info && samePath(dir, info.dir)) return;
      setPending({ dir, shown: dir });
    } catch (e) {
      setError(String(e));
    }
  };

  const apply = async (copy: boolean) => {
    if (!pending) return;
    setBusy(true);
    setError("");
    try {
      await setStorage(pending.dir, copy);
      // 所有文件都在記憶體裡，重新載入才會從新的資料夾讀
      window.location.reload();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <section className="set-section">
      <h2>Storage</h2>
      <div className="set-row">
        <div className="set-label">
          <span>Notes folder</span>
          <small>Journals, pages, media and Desk files are saved here</small>
        </div>
      </div>

      {!available ? (
        <p className="set-note">This preview runs in a browser, so notes are kept in the browser's local storage.</p>
      ) : (
        <>
          <div className="storage-path">
            <FolderIcon />
            <code title={info?.dir}>{info?.dir ?? "…"}</code>
            {info && !info.custom && <span className="set-badge">Default</span>}
          </div>
          <div className="set-actions">
            <button className="set-btn primary" disabled={!info || busy || !!pending} onClick={choose}>
              Change…
            </button>
            <button className="set-btn" disabled={!info} onClick={() => info && revealFolder(info.dir).catch((e) => setError(String(e)))}>
              Show in Explorer
            </button>
            {info?.custom && (
              <button
                className="set-btn"
                disabled={busy || !!pending}
                onClick={() => setPending({ dir: null, shown: info.defaultDir })}
              >
                Use default folder
              </button>
            )}
          </div>

          {pending && (
            <div className="storage-confirm" role="group" aria-label="Confirm new folder">
              <p>
                Switch to <code>{pending.shown}</code>?
              </p>
              <p className="set-note">
                Copying keeps the files in the current folder and doesn't overwrite files the new folder already has. Choose
                “Switch only” to open a folder that already holds your notes, such as a synced folder. Banyan reloads
                afterwards.
              </p>
              <div className="set-actions">
                <button className="set-btn primary" disabled={busy || props.saving} onClick={() => apply(true)}>
                  Copy notes and switch
                </button>
                <button className="set-btn" disabled={busy || props.saving} onClick={() => apply(false)}>
                  Switch only
                </button>
                <button className="set-btn" disabled={busy} onClick={() => setPending(null)}>
                  Cancel
                </button>
              </div>
              {props.saving && <p className="set-note">Waiting for changes to save…</p>}
            </div>
          )}
        </>
      )}
      {error && (
        <p className="set-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
