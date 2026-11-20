import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftIcon, MoreIcon } from "../editor/icons";
import { parseFile, type DeskFile } from "../desk/file";
import { BOARD, DeskPartPreview, PagePreview, partTitle, partVersions, previewLayout, type BoardContext } from "./Preview";
import type { VersionLog } from "./store";
import { groupByDay, versionTime, type Version } from "./versions";
import "./history.css";

/**
 * 版本歷史（參考 Google Docs 的 Version history）：左邊是選取版本的唯讀預覽（可以標出和前一個版本的差異），
 * 上面有「Restore this version」；右邊是依日期分組的版本清單，可以只看命名過的版本、命名版本、做一份副本。
 * 最上面的版本是目前的內容（Current version）。
 * Desk 檔案只看正在處理的那一部分（`part`：一份 Dock 文件或白板）：只列那一部分有改的版本、只預覽它，
 * 還原與副本也只動它（由 App 從整個檔案的版本裡取出）。
 */

const CHANGES_KEY = "banyan.history.showChanges";

const CURRENT = "current";

interface Entry {
  id: string;
  at: number;
  version?: Version;
  current: boolean;
}

export function VersionHistory(props: {
  log: VersionLog;
  docKey: string;
  kind: "markdown" | "desk";
  /** 目前的內容 */
  current: string;
  now: string;
  /** Desk 檔案：正在處理的那一部分（Dock 文件的 id，或 `board` 白板） */
  part?: string;
  /** 頁面名稱、日記的日期標題（預覽和平常的頁面一樣有標題） */
  title?: string;
  /** Desk 檔案：白板預覽要用的頁面、日記 */
  board?: BoardContext;
  /** 還原：整個文件（Desk 檔案是那個版本的整個檔案，App 只取出 part） */
  onRestore: (content: string, at: number) => void;
  onCopy: (content: string, label: string) => void;
  onClose: () => void;
}) {
  const { log, docKey, current } = props;
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [selected, setSelected] = useState(CURRENT);
  const [named, setNamed] = useState(false);
  const [changes, setChanges] = useState(() => {
    try {
      return localStorage.getItem(CHANGES_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [contents, setContents] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const part = props.kind === "desk" ? (props.part ?? BOARD) : null;

  useEffect(() => {
    let alive = true;
    const load = () => void log.list(docKey).then((v) => alive && setVersions([...v]));
    load();
    const off = log.subscribe((k) => k === docKey && load());
    return () => {
      alive = false;
      off();
    };
  }, [log, docKey]);

  useEffect(() => {
    try {
      localStorage.setItem(CHANGES_KEY, changes ? "1" : "0");
    } catch {
      /* 記不住也沒關係 */
    }
  }, [changes]);

  // Desk 檔案要讀出所有版本，才知道哪些版本改了這一部分
  useEffect(() => {
    if (part === null || !versions) return;
    for (const v of versions.slice(0, -1)) {
      if (v.id in contents) continue;
      const id = v.id;
      void log.read(docKey, id).then((c) => setContents((m) => (id in m ? m : { ...m, [id]: c })));
    }
  }, [part, versions, contents, log, docKey]);
  const files = useRef(new Map<string, DeskFile>());
  const fileOf = (json: string | undefined): DeskFile | undefined => {
    if (json === undefined) return undefined;
    let f = files.current.get(json);
    if (!f) {
      f = parseFile(json);
      files.current.set(json, f);
    }
    return f;
  };
  const partReady = part === null || (!!versions && versions.slice(0, -1).every((v) => v.id in contents));

  // 新到舊；最上面是目前的內容
  const entries = useMemo<Entry[]>(() => {
    const vs = versions ?? [];
    let list: Entry[] = vs.map((v, i) => ({ id: i === vs.length - 1 ? CURRENT : v.id, at: v.at, version: v, current: i === vs.length - 1 }));
    if (!list.length) list.push({ id: CURRENT, at: Date.now(), current: true });
    if (part !== null) {
      // 只留這一部分有改的版本；留下的最後一個就是它目前的樣子
      list = partVersions(list, (e) => fileOf(e.current ? current : contents[e.version!.id]), part);
      const last = list[list.length - 1];
      if (last) list[list.length - 1] = { ...last, id: CURRENT, current: true };
      else list = [{ id: CURRENT, at: Date.now(), current: true }];
    }
    return list.reverse();
    // fileOf 用 ref 快取，不必列進來
  }, [versions, part, contents, current]);
  const shown = named ? entries.filter((e) => e.current || e.version?.name) : entries;
  const index = Math.max(0, entries.findIndex((e) => e.id === selected));
  const entry = entries[index];
  const prev = entries[index + 1];
  const contentOf = (e: Entry | undefined): string | undefined =>
    !e ? undefined : e.current ? current : e.version ? contents[e.version.id] : undefined;

  // 讀選取的版本與前一個版本的內容
  useEffect(() => {
    for (const e of [entry, prev]) {
      if (!e || e.current || !e.version || e.version.id in contents) continue;
      const id = e.version.id;
      void log.read(docKey, id).then((c) => setContents((m) => ({ ...m, [id]: c })));
    }
  }, [entry, prev, contents, log, docKey]);

  const after = contentOf(entry);
  const before = prev ? contentOf(prev) : undefined;
  const loading = after === undefined || (changes && !!prev && before === undefined);

  // Esc 關掉（改名、選單開著時先關它們）
  const closeRef = useRef(props.onClose);
  closeRef.current = props.onClose;
  const busy = useRef(false);
  busy.current = !!renaming || !!menu;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || busy.current || (e.target as HTMLElement | null)?.closest?.("select, input")) return;
      e.preventDefault();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 上下鍵換版本
  const move = (d: number) => {
    const i = shown.findIndex((e) => e.id === entry.id);
    const next = shown[Math.min(shown.length - 1, Math.max(0, i + d))];
    if (next) setSelected(next.id);
  };

  const rename = (e: Entry, name: string) => {
    setRenaming(null);
    if (name.trim() === (e.version?.name ?? "")) return;
    // 目前的內容還沒記成版本（或就是最新的版本）就先記下來再命名
    const latest = versions?.[versions.length - 1];
    if (e.current && (!e.version || e.version.id === latest?.id)) void log.nameCurrent(docKey, current, name);
    else if (e.version) void log.rename(docKey, e.version.id, name);
  };

  const restorable = !entry.current && after !== undefined;
  const label = (e: Entry) => (e.current ? "Current version" : versionTime(e.at));

  return (
    <div className="vh">
      <div className="vh-main">
        <div className="vh-bar">
          <button className="icon-btn" onClick={props.onClose} title="Back to the document (Esc)">
            <ArrowLeftIcon />
          </button>
          <span className="vh-bar-title">{entry.version?.name ?? (entry.current ? "Current version" : versionTime(entry.at))}</span>
          {entry.version?.name && <span className="vh-bar-sub">{versionTime(entry.at)}</span>}
          <span className="vh-bar-gap" />
          {restorable && (
            <button className="vh-btn primary" onClick={() => props.onRestore(after!, entry.at)}>
              Restore this version
            </button>
          )}
        </div>
        <div className={`vh-scroll l-${previewLayout(props.kind, after ?? current, part)}`}>
          {loading || !partReady ? (
            <p className="vh-empty vh-loading">Loading…</p>
          ) : part !== null && props.board ? (
            <DeskPartPreview
              key={entry.id + (changes ? ":c" : "")}
              after={after!}
              before={before}
              changes={changes}
              part={part}
              now={props.now}
              ctx={props.board}
            />
          ) : (
            <PagePreview key={entry.id + (changes ? ":c" : "")} after={after!} before={before} changes={changes} title={props.title} />
          )}
        </div>
      </div>
      <aside className="vh-side" aria-label="Version history">
        <div className="vh-side-head">
          <h2>Version history</h2>
          {part !== null && <div className="vh-side-sub">{partTitle(current, part)}</div>}
          <select value={named ? "named" : "all"} onChange={(e) => setNamed(e.target.value === "named")} aria-label="Which versions to show">
            <option value="all">All versions</option>
            <option value="named">Named versions</option>
          </select>
        </div>
        <div
          className="vh-list"
          tabIndex={0}
          onKeyDown={(e) => {
            if (renaming) return;
            if (e.key === "ArrowDown") (e.preventDefault(), move(1));
            else if (e.key === "ArrowUp") (e.preventDefault(), move(-1));
          }}
        >
          {versions === null || !partReady ? (
            <p className="vh-empty">Loading…</p>
          ) : (
            groupByDay(shown).map((g) => (
              <section key={g.label}>
                <h3>{g.label}</h3>
                {g.items.map((e) => (
                  <div
                    key={e.id}
                    className={`vh-item${e.id === entry.id ? " on" : ""}`}
                    onClick={() => setSelected(e.id)}
                    role="button"
                    aria-current={e.id === entry.id}
                  >
                    <div className="vh-item-text">
                      {renaming === e.id ? (
                        <input
                          autoFocus
                          className="vh-name-input"
                          defaultValue={e.version?.name ?? ""}
                          placeholder={label(e)}
                          maxLength={120}
                          onClick={(ev) => ev.stopPropagation()}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter") rename(e, ev.currentTarget.value);
                            else if (ev.key === "Escape") (ev.preventDefault(), setRenaming(null));
                          }}
                          onBlur={(ev) => rename(e, ev.currentTarget.value)}
                        />
                      ) : (
                        <>
                          <div className={`vh-item-title${e.version?.name ? " named" : ""}`}>{e.version?.name ?? label(e)}</div>
                          {e.version?.name && <div className="vh-item-sub">{label(e)}</div>}
                        </>
                      )}
                      {e.version?.restored !== undefined && <div className="vh-item-sub">Restored from {versionTime(e.version.restored)}</div>}
                      {e.version?.base && <div className="vh-item-sub">Before version history started</div>}
                    </div>
                    <button
                      className="icon-btn vh-more"
                      title="More actions"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        const r = ev.currentTarget.getBoundingClientRect();
                        setMenu(menu?.id === e.id ? null : { id: e.id, x: r.right, y: r.bottom + 4 });
                      }}
                    >
                      <MoreIcon />
                    </button>
                  </div>
                ))}
              </section>
            ))
          )}
          {named && shown.length === 1 && <p className="vh-hint">No named versions yet. Use ⋯ → Name this version to keep a version you'll want to find again.</p>}
        </div>
        <label className="vh-changes">
          <input type="checkbox" checked={changes} onChange={(e) => setChanges(e.target.checked)} />
          Show changes
        </label>
      </aside>
      {menu && (
        <>
          <div className="vh-scrim" onMouseDown={() => setMenu(null)} />
          <div className="vh-menu" style={{ left: menu.x, top: menu.y }} role="menu">
            {(() => {
              const e = entries.find((x) => x.id === menu.id);
              if (!e) return null;
              const c = contentOf(e);
              return (
                <>
                  <button role="menuitem" onClick={() => (setMenu(null), setRenaming(e.id))}>
                    {e.version?.name ? "Rename" : "Name this version"}
                  </button>
                  {e.version?.name && (
                    <button role="menuitem" onClick={() => (setMenu(null), rename(e, ""))}>
                      Remove name
                    </button>
                  )}
                  <button
                    role="menuitem"
                    onClick={async () => {
                      setMenu(null);
                      const text = c ?? (e.version ? await log.read(docKey, e.version.id) : current);
                      props.onCopy(text, e.version?.name ?? label(e));
                    }}
                  >
                    Make a copy
                  </button>
                </>
              );
            })()}
          </div>
        </>
      )}
    </div>
  );
}
