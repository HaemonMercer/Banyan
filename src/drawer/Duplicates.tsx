import { useEffect, useMemo } from "react";
import { CloseIcon, CopyIcon, TrashIcon } from "../editor/icons";
import { duplicateGroups, extraCopies, placeKey, placeLabel, removeEntries, removePlace, type Place } from "./files";
import type { Library } from "./model";
import { PlaceRow } from "./FilesPane";

/**
 * 重複內容：加入檔案前的確認（`DuplicatePrompt`）與整個 Drawer 的重複檢查工具（`DuplicateFinder`）。
 * 比對方式見 `files.ts` 的 `fingerprint`（同樣內容的檔案，不管檔名、資料夾）。
 */

function useEsc(onClose: () => void) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);
}

export interface DuplicateCheck {
  entry: { name: string; src: string };
  existing: Place[];
  sameBatch: boolean;
}

/** 要加入的檔案有些已經在 Drawer 裡：略過重複的（預設）、照樣加入，或取消。 */
export function DuplicatePrompt(props: {
  lib: Library;
  checks: DuplicateCheck[];
  /** 這批共有幾個檔案 */
  total: number;
  onSkip: () => void;
  onAddAll: () => void;
  onCancel: () => void;
  onShow: (p: Place) => void;
}) {
  useEsc(props.onCancel);
  const { checks, total } = props;
  const fresh = total - checks.length;
  return (
    <div className="dr-dialog-back" onPointerDown={(e) => e.target === e.currentTarget && props.onCancel()}>
      <div className="dr-dialog" role="dialog" aria-label="Duplicate files">
        <div className="dr-dialog-head">
          <CopyIcon />
          <strong>{checks.length === 1 ? "This file is already in your Drawer" : `${checks.length} files are already in your Drawer`}</strong>
          <button className="icon-btn" onClick={props.onCancel} title="Cancel (Esc)">
            <CloseIcon />
          </button>
        </div>
        <p className="dr-dialog-text">Same content, even if the name is different. Keeping one copy makes it easier to find and cite.</p>
        <div className="dr-dialog-list">
          {checks.map((c, i) => (
            <div key={i} className="dr-dup-item">
              <div className="dr-dup-new">{c.entry.name}</div>
              {c.sameBatch ? (
                <div className="dr-place-where">Picked more than once in this batch</div>
              ) : (
                c.existing.map((p) => <PlaceRow key={placeKey(p)} lib={props.lib} place={p} onShow={() => props.onShow(p)} />)
              )}
            </div>
          ))}
        </div>
        <div className="dr-dialog-foot">
          <button className="dr-btn" onClick={props.onAddAll}>
            Add anyway
          </button>
          <button className="dr-btn primary" onClick={props.onSkip} autoFocus>
            {fresh > 0 ? `Skip duplicates · add ${fresh === 1 ? "1 file" : `${fresh} files`}` : "Don't add"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 檢查整個 Drawer（檔案庫＋條目附件）裡內容相同的檔案。 */
export function DuplicateFinder(props: {
  lib: Library;
  onModify: (fn: (lib: Library) => Library) => void;
  onShow: (p: Place) => void;
  onClose: () => void;
  onNotice: (s: string) => void;
}) {
  useEsc(props.onClose);
  const { lib, onModify } = props;
  const groups = useMemo(() => duplicateGroups(lib), [lib]);
  const extras = groups.flatMap(extraCopies);

  const removeExtras = () => {
    if (!extras.length) return;
    if (!window.confirm(`Delete ${extras.length === 1 ? "1 extra copy" : `${extras.length} extra copies`} from My Files? The oldest copy of each file stays.`)) return;
    onModify((l) => removeEntries(l, extras.map((f) => f.id)));
    props.onNotice(`Removed ${extras.length === 1 ? "1 duplicate" : `${extras.length} duplicates`}`);
  };
  const removeOne = (p: Place) => {
    const what = p.kind === "file" ? `Delete “${p.file.name}” from ${placeLabel(lib, p)}?` : `Remove the attachment “${p.att.name}” from “${p.item.title || "Untitled"}”?`;
    if (!window.confirm(what)) return;
    onModify((l) => removePlace(l, p));
  };

  return (
    <div className="dr-dialog-back" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="dr-dialog wide" role="dialog" aria-label="Find duplicates">
        <div className="dr-dialog-head">
          <CopyIcon />
          <strong>Duplicate files</strong>
          <button className="icon-btn" onClick={props.onClose} title="Close (Esc)">
            <CloseIcon />
          </button>
        </div>
        {groups.length ? (
          <>
            <p className="dr-dialog-text">
              {groups.length === 1 ? "1 file is" : `${groups.length} files are`} stored more than once, in My Files or attached to items. Files with the same content
              match even when their names differ.
            </p>
            <div className="dr-dialog-list">
              {groups.map((g) => (
                <div key={placeKey(g[0])} className="dr-dup-item">
                  <div className="dr-dup-new">
                    {g.length} copies
                  </div>
                  {g.map((p, i) => (
                    <PlaceRow
                      key={placeKey(p)}
                      lib={lib}
                      place={p}
                      onShow={() => props.onShow(p)}
                      actions={
                        i === 0 ? (
                          <span className="dr-dup-keep">Oldest</span>
                        ) : (
                          <button className="icon-btn" title={p.kind === "file" ? "Delete this copy" : "Remove this attachment"} onClick={() => removeOne(p)}>
                            <TrashIcon />
                          </button>
                        )
                      }
                    />
                  ))}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="dr-empty">
            <strong>No duplicates</strong>
            Every file in My Files and every attachment is stored once.
          </div>
        )}
        <div className="dr-dialog-foot">
          {extras.length > 0 && (
            <button className="dr-btn danger" onClick={removeExtras} title="Keep the oldest copy in My Files, delete the others (attachments stay)">
              <TrashIcon /> Delete {extras.length === 1 ? "1 extra copy" : `${extras.length} extra copies`} in My Files
            </button>
          )}
          <button className="dr-btn primary" onClick={props.onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
