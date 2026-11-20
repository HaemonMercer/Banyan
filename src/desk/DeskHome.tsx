import { useEffect, useMemo, useRef, useState } from "react";
import { CloseIcon, PencilIcon, PlusIcon, SearchIcon, TemplateIcon, TrashIcon } from "../editor/icons";
import { RenameField } from "./DeskView";
import type { Docs } from "../journal/useJournals";
import { pageKey } from "../pages/pageRef";
import { parseFile, type DeskFile } from "./file";
import { boardThumb, freeName, lastActive, matchFile, sortFiles, timeAgo, type FileActivity } from "./home";
import { loadActivity } from "./store";
import { FILE_TEMPLATES, fileFromTemplate, templateOfFile } from "./deskTemplates";
import { TemplateGallery, type GalleryItem } from "./TemplateGallery";
import "./board.css";
import "./desk.css";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * Desk 首頁（側邊欄「Desk」）：標題列（搜尋、New file）＋檔案卡片（白板縮圖、檔名、文件數、最近時間），
 * 最近打開或編輯的排前面。
 */
export function DeskView(props: {
  files: Docs;
  /** 使用者存的檔案範本（`desk-templates/`） */
  templates: Docs;
  onOpen: (name: string) => void;
  /** content：範本產生的檔案內容 */
  onCreate: (name: string, content: string) => void;
  onDelete: (name: string) => void;
  /** 改名（App 搬檔案、連結與紀錄）；回傳錯誤訊息 */
  onRename: (from: string, to: string) => Promise<string | null>;
}) {
  const { templates } = props;
  const [renaming, setRenaming] = useState<string | null>(null);
  // New file：先挑範本（choosing），再打名稱（adding：預設名稱與檔案內容）
  const [choosing, setChoosing] = useState(false);
  const [adding, setAdding] = useState<{ base: string; content: string } | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(""), 3000);
    return () => window.clearTimeout(t);
  }, [notice]);
  const [query, setQuery] = useState("");
  // 相對時間每分鐘更新；活動紀錄在打開首頁時讀一次（檔案頁會更新它）
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const activity = useMemo<Record<string, FileActivity>>(loadActivity, [props.files.dates]);

  const names = useMemo(() => [...(props.files.dates ?? [])], [props.files.dates]);
  const contents = props.files.contents;
  const entries = useMemo(() => names.map((name) => ({ name, file: parseFile(contents[name] ?? "") })), [names, contents]);
  const shown = useMemo(() => sortFiles(entries.filter((e) => matchFile(e, query)), activity), [entries, query, activity]);

  const userTemplates = useMemo(
    () => [...(templates.dates ?? [])].filter((n) => templates.contents[n]?.trim()).sort((a, b) => a.localeCompare(b)),
    [templates.dates, templates.contents],
  );
  const gallery = useMemo<GalleryItem[]>(() => {
    if (!choosing) return [];
    const builtin = FILE_TEMPLATES.map((t) => ({ id: "b:" + t.id, label: t.label, hint: t.hint, preview: <FilePreview file={t.make()} /> }));
    const mine = userTemplates.map((n) => {
      const file = parseFile(templates.contents[n] ?? "");
      return {
        id: "u:" + n,
        label: n,
        hint: `Your template · ${plural(file.docs.length, "doc")}`,
        preview: <FilePreview file={file} />,
        onDelete: () => {
          if (window.confirm(`Delete the template “${n}”? Files made from it are kept.`)) templates.update(n, "");
        },
      };
    });
    return [...builtin, ...mine];
  }, [choosing, userTemplates, templates]);
  const pickTemplate = (id: string) => {
    setChoosing(false);
    if (id.startsWith("u:")) {
      const n = id.slice(2);
      setAdding({ base: n, content: fileFromTemplate(null, templates.contents[n] ?? "") });
    } else {
      const t = FILE_TEMPLATES.find((f) => "b:" + f.id === id) ?? FILE_TEMPLATES[0];
      setAdding({ base: t.id === "blank" ? "Untitled" : t.label, content: fileFromTemplate(t.id) });
    }
  };
  /** 把檔案（白板＋Dock）存成範本 */
  const saveTemplate = (name: string) => {
    const tn = freeName(userTemplates, name, pageKey);
    templates.update(tn, templateOfFile(contents[name] ?? ""));
    setNotice(`Saved “${tn}” as a template — pick it from New file`);
  };

  return (
    <div className="dbs-view desk-home">
      <div className="dh-head no-box">
        <h1 className="dbs-title">Desk</h1>
        {names.length > 0 && (
          <label className="dh-search">
            <SearchIcon />
            <input
              value={query}
              placeholder="Search"
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            />
            {query && (
              <button className="dh-clear" title="Clear search" onClick={() => setQuery("")}>
                <CloseIcon />
              </button>
            )}
          </label>
        )}
        <button className="dh-create" onClick={() => setChoosing(true)} disabled={!!adding || choosing}>
          <PlusIcon /> New file
        </button>
      </div>
      {notice && <div className="dh-notice no-box">{notice}</div>}

      {choosing && (
        <TemplateGallery
          title="Choose a template"
          items={gallery}
          onPick={pickTemplate}
          onClose={() => setChoosing(false)}
          footer="Save any file as a template with the template button on its card."
        />
      )}

      {adding && (
        <NewFile
          taken={names}
          base={adding.base}
          onDone={(name) => {
            const content = adding.content;
            setAdding(null);
            if (name) props.onCreate(name, content);
          }}
        />
      )}

      {props.files.ready && !names.length ? (
        !adding && (
          <div className="dbs-empty no-box">
            <strong>Your desk is clear</strong>
            Each file has a Whiteboard for ideas and a Dock for documents.
          </div>
        )
      ) : shown.length ? (
        <div className="dh-grid no-box">
          {shown.map((e) => (
            <FileCard
              key={e.name}
              name={e.name}
              file={e.file}
              activity={activity[e.name]}
              now={now}
              onOpen={() => props.onOpen(e.name)}
              onDelete={() => props.onDelete(e.name)}
              onSaveTemplate={() => saveTemplate(e.name)}
              renaming={renaming === e.name}
              onStartRename={() => setRenaming(e.name)}
              onRename={(to) => {
                setRenaming(null);
                if (to !== null && to.trim() && to.trim() !== e.name) {
                  void props.onRename(e.name, to).then((err) => err && setNotice(err));
                }
              }}
            />
          ))}
        </div>
      ) : (
        props.files.ready && <div className="dh-none no-box">No files match “{query.trim()}”.</div>
      )}
    </div>
  );
}

function FileCard(props: {
  name: string;
  file: DeskFile;
  activity: FileActivity | undefined;
  now: number;
  onOpen: () => void;
  onDelete: () => void;
  onSaveTemplate: () => void;
  renaming: boolean;
  onStartRename: () => void;
  onRename: (to: string | null) => void;
}) {
  const when = lastActive(props.activity);
  const edited = props.activity?.edited && props.activity.edited >= (props.activity.opened ?? 0);
  return (
    <div
      className="dh-card"
      role="button"
      tabIndex={0}
      onClick={props.onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter") props.onOpen();
        else if (e.key === "Delete") props.onDelete();
        else if (e.key === "F2") props.onStartRename();
      }}
    >
      <BoardThumb file={props.file} />
      <button
        className="dh-ren"
        title="Rename (F2)"
        onClick={(e) => {
          e.stopPropagation();
          props.onStartRename();
        }}
      >
        <PencilIcon />
      </button>
      <button
        className="dh-tpl"
        title="Save as template"
        onClick={(e) => {
          e.stopPropagation();
          props.onSaveTemplate();
        }}
      >
        <TemplateIcon />
      </button>
      <button
        className="dh-del"
        title="Delete file"
        onClick={(e) => {
          e.stopPropagation();
          props.onDelete();
        }}
      >
        <TrashIcon />
      </button>
      <div className="dh-body">
        {props.renaming ? (
          <RenameField value={props.name} className="dh-name-input" onDone={props.onRename} />
        ) : (
          <div className="dh-name" onDoubleClick={(e) => (e.stopPropagation(), props.onStartRename())} title="Double-click to rename">
            {props.name}
          </div>
        )}
        <div className="dh-meta" title={when ? new Date(when).toLocaleString("en-US") : undefined}>
          {plural(props.file.docs.length, "doc")}
          {when > 0 && ` · ${edited ? "Edited" : "Opened"} ${timeAgo(when, props.now)}`}
        </div>
      </div>
    </div>
  );
}

/** 白板縮圖（SVG）：區段、連線、卡片、心智圖主題的方塊 */
function BoardThumb(props: { file: DeskFile }) {
  const t = useMemo(() => boardThumb(props.file.board), [props.file.board]);
  if (!t) return <div className="dh-thumb blank" />;
  const { view } = t;
  // 太小的方塊放大一點才看得到
  const r = Math.max(6, view.w / 60);
  return (
    <svg className="dh-thumb" viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
      {t.items.map((it, i) => {
        if (it.kind === "edge") return <line key={i} className="edge" x1={it.x1} y1={it.y1} x2={it.x2} y2={it.y2} vectorEffect="non-scaling-stroke" />;
        const cls =
          it.kind === "section"
            ? `section${it.color ? ` c-${it.color}` : ""}`
            : it.kind === "card"
              ? `card${it.note ? " note" : ""}${it.color ? ` c-${it.color}` : ""}`
              : `topic${it.root ? " root" : ""}`;
        return <rect key={i} className={cls} x={it.r.x} y={it.r.y} width={it.r.w} height={it.r.h} rx={r} vectorEffect="non-scaling-stroke" />;
      })}
    </svg>
  );
}

/** 範本縮圖：白板縮圖＋ Dock 文件數 */
function FilePreview(props: { file: DeskFile }) {
  return (
    <span className="tgal-file">
      <BoardThumb file={props.file} />
      {props.file.docs.length > 0 && <span className="tgal-docs">{props.file.docs.map((d) => d.title).join(" · ")}</span>}
    </span>
  );
}

function NewFile(props: { taken: string[]; base: string; onDone: (name: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const [value, setValue] = useState(() => freeName(props.taken, props.base, pageKey));
  useEffect(() => ref.current?.select(), []);
  const finish = (v: string) => {
    if (done.current) return;
    done.current = true;
    props.onDone(v.trim());
  };
  const exists = props.taken.find((n) => pageKey(n) === pageKey(value.trim()));
  return (
    <div className="dh-new">
      <input
        ref={ref}
        className="dbs-input"
        value={value}
        placeholder="File name"
        spellCheck={false}
        aria-label="New file name"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") finish(value);
          else if (e.key === "Escape") finish("");
        }}
        onBlur={() => finish("")}
      />
      <span className="dh-new-hint">{exists ? `Enter opens “${exists}”` : "Enter to create · Esc to cancel"}</span>
    </div>
  );
}
