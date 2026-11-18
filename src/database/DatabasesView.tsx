import { useEffect, useMemo, useRef, useState } from "react";
import { DatabaseIcon, PlusIcon, TrashIcon } from "../editor/icons";
import type { Docs } from "../journal/useJournals";
import { pageKey } from "../pages/pageRef";
import { parseDatabase } from "./model";
import "./database.css";

/**
 * 所有資料庫（側邊欄「Databases」）：上方「New database」按鈕（出現輸入列，Enter 建立並開啟），
 * 下面是資料庫清單（名稱、幾列），點了開啟，滑過出現刪除。
 */
export function DatabasesView(props: {
  databases: Docs;
  onOpen: (name: string) => void;
  /** 建立（已經有同名的就開那一個） */
  onCreate: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const names = useMemo(
    () => [...(props.databases.dates ?? [])].sort((a, b) => a.localeCompare(b, "zh-Hant")),
    [props.databases.dates],
  );
  const contents = props.databases.contents;

  return (
    <div className="dbs-view">
      <h1 className="dbs-title">Databases</h1>
      <button className="dbs-new no-box" onClick={() => setAdding(true)} disabled={adding}>
        <PlusIcon /> New database
      </button>

      {props.databases.ready && !names.length && !adding ? (
        <div className="dbs-empty no-box">
          <strong>No databases yet</strong>
          Click <b>New database</b> to make a table of anything — books, projects, characters — with properties, a
          table view and a board view.
        </div>
      ) : (
        <div className="dbs-list no-box">
          {adding && (
            <NewRow
              taken={names}
              onDone={(name) => {
                setAdding(false);
                if (name) props.onCreate(name);
              }}
            />
          )}
          {names.map((n) => {
            const rows = parseDatabase(contents[n] ?? "").rows.length;
            return (
              <div
                key={n}
                className="dbs-row"
                role="button"
                tabIndex={0}
                onClick={() => props.onOpen(n)}
                onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && props.onOpen(n)}
              >
                <DatabaseIcon className="dbs-icon" />
                <span className="dbs-name">{n}</span>
                <span className="dbs-meta">{rows === 1 ? "1 row" : `${rows} rows`}</span>
                <button
                  className="dbs-del"
                  title="Delete database"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onDelete(n);
                  }}
                >
                  <TrashIcon />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 新資料庫的名稱輸入列：Enter 建立，Esc 取消，離開時有名稱就建立。 */
function NewRow(props: { taken: string[]; onDone: (name: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const [value, setValue] = useState("");
  useEffect(() => ref.current?.focus(), []);
  const finish = (v: string) => {
    if (done.current) return;
    done.current = true;
    props.onDone(v.trim());
  };
  const exists = props.taken.find((n) => pageKey(n) === pageKey(value.trim()));
  return (
    <div className="dbs-row editing">
      <DatabaseIcon className="dbs-icon" />
      <input
        ref={ref}
        className="dbs-input"
        value={value}
        placeholder="Database name"
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") finish(value);
          else if (e.key === "Escape") finish("");
        }}
        onBlur={() => finish(value)}
      />
      {exists && <span className="dbs-meta">Opens “{exists}”</span>}
    </div>
  );
}
