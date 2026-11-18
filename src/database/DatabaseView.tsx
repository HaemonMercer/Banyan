import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  BoardIcon,
  CalendarIcon,
  CheckboxIcon,
  CloseIcon,
  CopyIcon,
  DatabaseIcon,
  DocIcon,
  GripIcon,
  HashIcon,
  LinkIcon,
  MoreIcon,
  MultiIcon,
  OpenIcon,
  PlusIcon,
  PropsIcon,
  SearchIcon,
  SelectIcon,
  SortIcon,
  TextIcon,
  TrashIcon,
} from "../editor/icons";
import { dayTitle } from "../journal/journal";
import "./database.css";
import { RowMenu, type Menu } from "./RowMenu";
import {
  COLORS,
  PROP_TYPES,
  TITLE,
  addOption,
  addProp,
  addRow,
  addView,
  boardGroups,
  duplicateRow,
  isEmpty,
  moveProp,
  moveRow,
  newId,
  parseDatabase,
  patchOption,
  patchView,
  removeOption,
  removeProp,
  removeRow,
  removeView,
  renameProp,
  resizeProp,
  setCell,
  setPropType,
  titleOf,
  viewRows,
  visibleProps,
  type Cell,
  type Color,
  type Database,
  type DbView,
  type Option,
  type Prop,
  type PropType,
  type Row,
} from "./model";

/**
 * 資料庫的畫面（參考 Notion 的 Database）：上面是檢視的分頁（表格、看板）與工具（搜尋、排序、欄位、分組、New），
 * 下面是表格或看板；點一列的 Open（或看板的卡片）從右邊打開那一列，編輯全部的欄位。
 * 改資料一律透過 `onModify`（拿最新的資料庫改，避免連續修改互相蓋掉）。
 */

const VIEW_KEY = "banyan.dbView.";

function loadViewId(name: string): string {
  try {
    return localStorage.getItem(VIEW_KEY + name) ?? "";
  } catch {
    return "";
  }
}
function saveViewId(name: string, id: string) {
  try {
    localStorage.setItem(VIEW_KEY + name, id);
  } catch {
    /* 存不了就算了 */
  }
}

export const TYPE_ICON: Record<PropType, (p: { className?: string }) => ReactNode> = {
  title: TextIcon,
  text: TextIcon,
  number: HashIcon,
  select: SelectIcon,
  multi: MultiIcon,
  date: CalendarIcon,
  checkbox: CheckboxIcon,
  url: LinkIcon,
};

/** 文字類（就地打字編輯） */
const TEXTUAL: PropType[] = ["title", "text", "number", "url"];

type Pop =
  | { kind: "prop"; prop: string; anchor: DOMRect }
  | { kind: "newProp"; anchor: DOMRect }
  | { kind: "options"; row: string; prop: string; anchor: DOMRect }
  | { kind: "date"; row: string; prop: string; anchor: DOMRect }
  | { kind: "sort" | "props" | "group" | "addView"; anchor: DOMRect };

type Editing = { row: string; prop: string; where: "table" | "peek" } | null;

async function openLink(href: string) {
  const url = /^[a-z][a-z0-9+.-]*:/i.test(href) ? href : `https://${href}`;
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

export function DatabaseView(props: {
  /** 資料庫名稱（記住上次的檢視用） */
  name: string;
  /** 資料庫檔案的內容（JSON；還沒有檔案是空字串） */
  json: string;
  /** 清單都讀進來了（沒有檔案時才建立） */
  ready: boolean;
  onModify: (fn: (db: Database) => Database) => void;
  onOpenPage: (title: string) => void;
  hasPage: (title: string) => boolean;
}) {
  const { onModify } = props;
  const db = useMemo(() => parseDatabase(props.json), [props.json]);
  // 沒有檔案（例如只在清單上）就建立一個
  const modifyRef = useRef(onModify);
  modifyRef.current = onModify;
  useEffect(() => {
    if (props.ready && !props.json.trim()) modifyRef.current((d) => d);
  }, [props.ready, props.json]);

  const [viewId, setViewIdState] = useState(() => loadViewId(props.name));
  const view = db.views.find((v) => v.id === viewId) ?? db.views[0];
  const setViewId = (id: string) => {
    setViewIdState(id);
    saveViewId(props.name, id);
  };
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [pop, setPop] = useState<Pop | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [peek, setPeek] = useState<string | null>(null);
  const [renamingView, setRenamingView] = useState<string | null>(null);

  const rows = viewRows(db, view, query);
  const cols = visibleProps(db, view);
  const canArrange = !view.sort && !query.trim();
  const apply = (fn: (d: Database) => Database) => onModify(fn);
  const anchorOf = (e: React.MouseEvent) => (e.currentTarget as HTMLElement).getBoundingClientRect();

  /** 點一格：勾選直接切換、選項與日期開選單、文字類就地編輯 */
  const editCell = (row: Row, prop: Prop, el: HTMLElement, where: "table" | "peek") => {
    const anchor = el.getBoundingClientRect();
    if (prop.type === "checkbox") apply((d) => setCell(d, row.id, prop.id, !row.cells[prop.id]));
    else if (prop.type === "select" || prop.type === "multi") setPop({ kind: "options", row: row.id, prop: prop.id, anchor });
    else if (prop.type === "date") setPop({ kind: "date", row: row.id, prop: prop.id, anchor });
    else setEditing({ row: row.id, prop: prop.id, where });
  };
  const commitText = (rowId: string, prop: Prop, raw: string | null) => {
    setEditing(null);
    if (raw === null) return;
    let v: Cell = raw.trim() ? (prop.type === "title" ? raw.trim() : raw) : null;
    if (prop.type === "number") {
      const n = Number(raw.replace(/,/g, "").trim());
      v = raw.trim() && Number.isFinite(n) ? n : null;
    }
    apply((d) => setCell(d, rowId, prop.id, v));
  };

  const newRow = (cells: Record<string, Cell> = {}, open: "title" | "peek" = "title") => {
    const id = newId("r");
    apply((d) => addRow(d, cells, undefined, id).db);
    if (open === "peek") setPeek(id);
    else setEditing({ row: id, prop: TITLE, where: "table" });
  };

  const rowMenu = (row: Row): Menu["items"] => [
    { label: "Open", icon: <OpenIcon />, run: () => setPeek(row.id) },
    ...(titleOf(row).trim() ? [{ label: "Open as page", icon: <DocIcon />, run: () => props.onOpenPage(titleOf(row).trim()) }] : []),
    { label: "Duplicate", icon: <CopyIcon />, run: () => apply((d) => duplicateRow(d, row.id)?.db ?? d) },
    { label: "Delete", icon: <TrashIcon />, run: () => apply((d) => removeRow(d, row.id)) },
  ];

  /** 一格的內容（表格、看板、右邊的那一列共用） */
  const cell = (row: Row, prop: Prop, where: "table" | "peek") => {
    const value = row.cells[prop.id];
    if (editing && editing.row === row.id && editing.prop === prop.id && editing.where === where && TEXTUAL.includes(prop.type)) {
      return (
        <TextInput
          initial={isEmpty(value) ? "" : String(value)}
          numeric={prop.type === "number"}
          onDone={(v) => commitText(row.id, prop, v)}
        />
      );
    }
    return <CellValue prop={prop} value={value} />;
  };

  const tabs = (
    <div className="db-tabs" role="tablist">
      {db.views.map((v) =>
        renamingView === v.id ? (
          <TextInput
            key={v.id}
            className="db-tab-input"
            initial={v.name}
            onDone={(name) => {
              setRenamingView(null);
              if (name?.trim()) apply((d) => patchView(d, v.id, { name: name.trim() }));
            }}
          />
        ) : (
          <button
            key={v.id}
            role="tab"
            aria-selected={v.id === view.id}
            className={`db-tab${v.id === view.id ? " on" : ""}`}
            onClick={() => setViewId(v.id)}
            onDoubleClick={() => setRenamingView(v.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setViewId(v.id);
              setMenu({
                x: e.clientX,
                y: e.clientY,
                items: [
                  { label: "Rename", icon: <TextIcon />, run: () => setRenamingView(v.id) },
                  ...(db.views.length > 1
                    ? [{ label: "Delete view", icon: <TrashIcon />, run: () => apply((d) => removeView(d, v.id)) }]
                    : []),
                ],
              });
            }}
            title={`${v.name} · double-click to rename, right-click for more`}
          >
            {v.type === "table" ? <DatabaseIcon /> : <BoardIcon />}
            {v.name}
          </button>
        ),
      )}
      <button className="db-tab add" onClick={(e) => setPop({ kind: "addView", anchor: anchorOf(e) })} title="Add a view">
        <PlusIcon />
      </button>
    </div>
  );

  const tools = (
    <div className="db-tools">
      {searching || query ? (
        <label className="db-search">
          <SearchIcon />
          <input
            autoFocus
            value={query}
            placeholder="Search…"
            onChange={(e) => setQuery(e.target.value)}
            onBlur={() => !query && setSearching(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQuery("");
                setSearching(false);
                e.stopPropagation();
              }
            }}
          />
          {query && (
            <button onClick={() => setQuery("")} title="Clear the search">
              <CloseIcon />
            </button>
          )}
        </label>
      ) : (
        <button className="db-tool" onClick={() => setSearching(true)} title="Search the rows">
          <SearchIcon />
        </button>
      )}
      <button
        className={`db-tool${view.sort ? " on" : ""}`}
        onClick={(e) => setPop({ kind: "sort", anchor: anchorOf(e) })}
        title={view.sort ? `Sorted by ${db.props.find((p) => p.id === view.sort!.prop)?.name || "Untitled"}` : "Sort"}
      >
        <SortIcon />
      </button>
      <button
        className={`db-tool${view.hidden.length ? " on" : ""}`}
        onClick={(e) => setPop({ kind: "props", anchor: anchorOf(e) })}
        title="Properties — show or hide columns"
      >
        <PropsIcon />
      </button>
      {view.type === "board" && (
        <button className="db-tool text" onClick={(e) => setPop({ kind: "group", anchor: anchorOf(e) })} title="Group the board by a Select property">
          Group: {db.props.find((p) => p.id === view.groupBy)?.name || "None"}
        </button>
      )}
      <button className="db-new" onClick={() => (view.type === "board" ? newRow(firstGroupCells(db, view), "peek") : newRow())}>
        <PlusIcon /> New
      </button>
    </div>
  );

  const peekRow = peek ? db.rows.find((r) => r.id === peek) : undefined;

  return (
    <div className="db">
      <div className="db-bar">
        {tabs}
        {tools}
      </div>
      {view.type === "table" ? (
        <Table
          db={db}
          view={view}
          rows={rows}
          cols={cols}
          canArrange={canArrange}
          editing={editing}
          cell={cell}
          hasPage={props.hasPage}
          onEdit={(row, prop, el) => editCell(row, prop, el, "table")}
          onOpen={(row) => setPeek(row.id)}
          onRowMenu={(row, x, y) => setMenu({ x, y, items: rowMenu(row) })}
          onHeader={(prop, anchor) => setPop({ kind: "prop", prop: prop.id, anchor })}
          onNewProp={(anchor) => setPop({ kind: "newProp", anchor })}
          onNewRow={() => newRow()}
          onModify={apply}
        />
      ) : (
        <Board
          db={db}
          view={view}
          rows={rows}
          canArrange={canArrange}
          onOpen={(row) => setPeek(row.id)}
          onRowMenu={(row, x, y) => setMenu({ x, y, items: rowMenu(row) })}
          onNew={(cells) => newRow(cells, "peek")}
          onModify={apply}
          onGroup={(anchor) => setPop({ kind: "group", anchor })}
        />
      )}

      {peekRow && (
        <Peek
          key={peekRow.id}
          db={db}
          row={peekRow}
          cell={cell}
          hasPage={props.hasPage}
          onEdit={(prop, el) => editCell(peekRow, prop, el, "peek")}
          onTitle={(t) => apply((d) => setCell(d, peekRow.id, TITLE, t.trim() || null))}
          onOpenPage={() => titleOf(peekRow).trim() && props.onOpenPage(titleOf(peekRow).trim())}
          onDelete={() => {
            setPeek(null);
            apply((d) => removeRow(d, peekRow.id));
          }}
          onNewProp={(anchor) => setPop({ kind: "newProp", anchor })}
          onProp={(prop, anchor) => setPop({ kind: "prop", prop: prop.id, anchor })}
          onClose={() => setPeek(null)}
        />
      )}

      {pop && (
        <Popover anchor={pop.anchor} onClose={() => setPop(null)} wide={pop.kind === "options" || pop.kind === "prop"}>
          {pop.kind === "prop" && (
            <PropMenu
              db={db}
              view={view}
              propId={pop.prop}
              onModify={apply}
              onClose={() => setPop(null)}
            />
          )}
          {pop.kind === "newProp" && (
            <TypeList
              onPick={(type) => {
                const name = PROP_TYPES.find((t) => t.id === type)!.name;
                const anchor = pop.anchor;
                let made = "";
                apply((d) => {
                  const r = addProp(d, type, uniqueName(d, name));
                  made = r.id;
                  return r.db;
                });
                // 加好了接著改名稱
                setTimeout(() => made && setPop({ kind: "prop", prop: made, anchor }));
                setPop(null);
              }}
            />
          )}
          {pop.kind === "options" &&
            (() => {
              const prop = db.props.find((p) => p.id === pop.prop);
              const row = db.rows.find((r) => r.id === pop.row);
              if (!prop || !row) return null;
              const multi = prop.type === "multi";
              const value = row.cells[prop.id];
              const chosen: string[] = multi ? ((value as string[]) ?? []) : value ? [value as string] : [];
              return (
                <OptionPicker
                  prop={prop}
                  chosen={chosen}
                  onPick={(id) => {
                    apply((d) => {
                      const cur = d.rows.find((r) => r.id === row.id)?.cells[prop.id];
                      if (!multi) return setCell(d, row.id, prop.id, cur === id ? null : id);
                      const list = (cur as string[]) ?? [];
                      return setCell(d, row.id, prop.id, list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
                    });
                    if (!multi) setPop(null);
                  }}
                  onCreate={(name) => {
                    apply((d) => {
                      const r = addOption(d, prop.id, name);
                      if (!r) return d;
                      const cur = r.db.rows.find((x) => x.id === row.id)?.cells[prop.id];
                      return setCell(r.db, row.id, prop.id, multi ? [...((cur as string[]) ?? []), r.id] : r.id);
                    });
                    if (!multi) setPop(null);
                  }}
                  onEditOption={(id, patch) => apply((d) => patchOption(d, prop.id, id, patch))}
                  onDeleteOption={(id) => apply((d) => removeOption(d, prop.id, id))}
                  onClose={() => setPop(null)}
                />
              );
            })()}
          {pop.kind === "date" &&
            (() => {
              const row = db.rows.find((r) => r.id === pop.row);
              const value = (row?.cells[pop.prop] as string | undefined) ?? "";
              return (
                <div className="db-date">
                  <input
                    type="date"
                    autoFocus
                    defaultValue={value}
                    onChange={(e) => apply((d) => setCell(d, pop.row, pop.prop, e.target.value || null))}
                    onKeyDown={(e) => e.key === "Enter" && setPop(null)}
                  />
                  {value && (
                    <button
                      className="db-link-btn"
                      onClick={() => {
                        apply((d) => setCell(d, pop.row, pop.prop, null));
                        setPop(null);
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
              );
            })()}
          {pop.kind === "sort" && (
            <div className="db-list">
              <div className="db-pop-title">Sort by</div>
              {db.props.map((p) => {
                const Icon = TYPE_ICON[p.type];
                return (
                  <button
                    key={p.id}
                    className={view.sort?.prop === p.id ? "on" : ""}
                    onClick={() => apply((d) => patchView(d, view.id, { sort: { prop: p.id, desc: view.sort?.prop === p.id ? view.sort.desc : false } }))}
                  >
                    <Icon /> {p.name || "Untitled"}
                    {view.sort?.prop === p.id && <span className="db-check">✓</span>}
                  </button>
                );
              })}
              {view.sort && (
                <>
                  <div className="db-sep" />
                  <button onClick={() => apply((d) => patchView(d, view.id, { sort: { ...view.sort!, desc: false } }))} className={view.sort.desc ? "" : "on"}>
                    Ascending {!view.sort.desc && <span className="db-check">✓</span>}
                  </button>
                  <button onClick={() => apply((d) => patchView(d, view.id, { sort: { ...view.sort!, desc: true } }))} className={view.sort.desc ? "on" : ""}>
                    Descending {view.sort.desc && <span className="db-check">✓</span>}
                  </button>
                  <div className="db-sep" />
                  <button onClick={() => apply((d) => patchView(d, view.id, { sort: null }))}>Remove sort — back to manual order</button>
                </>
              )}
            </div>
          )}
          {pop.kind === "props" && (
            <div className="db-list">
              <div className="db-pop-title">Shown in this view</div>
              {db.props.map((p) => {
                const Icon = TYPE_ICON[p.type];
                const shown = !view.hidden.includes(p.id);
                return (
                  <button
                    key={p.id}
                    disabled={p.id === TITLE}
                    onClick={() =>
                      apply((d) =>
                        patchView(d, view.id, { hidden: shown ? [...view.hidden, p.id] : view.hidden.filter((h) => h !== p.id) }),
                      )
                    }
                  >
                    <Icon /> {p.name || "Untitled"}
                    <span className={`db-toggle${shown ? " on" : ""}`} />
                  </button>
                );
              })}
            </div>
          )}
          {pop.kind === "group" && (
            <div className="db-list">
              <div className="db-pop-title">Group by</div>
              {db.props
                .filter((p) => p.type === "select")
                .map((p) => (
                  <button key={p.id} className={view.groupBy === p.id ? "on" : ""} onClick={() => apply((d) => patchView(d, view.id, { groupBy: p.id }))}>
                    <SelectIcon /> {p.name || "Untitled"}
                    {view.groupBy === p.id && <span className="db-check">✓</span>}
                  </button>
                ))}
              {!db.props.some((p) => p.type === "select") && (
                <button
                  onClick={() => {
                    let made = "";
                    apply((d) => {
                      const r = addProp(d, "select", uniqueName(d, "Status"));
                      made = r.id;
                      return patchView(r.db, view.id, { groupBy: r.id });
                    });
                    void made;
                    setPop(null);
                  }}
                >
                  <PlusIcon /> Add a Select property to group by
                </button>
              )}
            </div>
          )}
          {pop.kind === "addView" && (
            <div className="db-list">
              <div className="db-pop-title">Add a view</div>
              {(["table", "board"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    let made = "";
                    apply((d) => {
                      const r = addView(d, t);
                      made = r.id;
                      return r.db;
                    });
                    setTimeout(() => made && setViewId(made));
                    setPop(null);
                  }}
                >
                  {t === "table" ? <DatabaseIcon /> : <BoardIcon />} {t === "table" ? "Table" : "Board"}
                </button>
              ))}
            </div>
          )}
        </Popover>
      )}
      {menu && <RowMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

function uniqueName(db: Database, base: string): string {
  const names = new Set(db.props.map((p) => p.name.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

/** 看板上「New」：放在第一欄 */
function firstGroupCells(db: Database, view: DbView): Record<string, Cell> {
  const p = db.props.find((x) => x.id === view.groupBy && x.type === "select");
  return p?.options[0] ? { [p.id]: p.options[0].id } : {};
}

/* ─── 一格的顯示 ─── */

export function Pill(props: { option: Option; onRemove?: () => void }) {
  return (
    <span className={`db-pill c-${props.option.color}`}>
      {props.option.name}
      {props.onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            props.onRemove!();
          }}
          title="Remove"
        >
          <CloseIcon />
        </button>
      )}
    </span>
  );
}

function CellValue(props: { prop: Prop; value: Cell | undefined }) {
  const { prop, value } = props;
  if (prop.type === "checkbox") return <span className={`db-checkbox${value ? " on" : ""}`}>{value ? "✓" : ""}</span>;
  if (isEmpty(value)) return null;
  switch (prop.type) {
    case "select": {
      const o = prop.options.find((x) => x.id === value);
      return o ? <Pill option={o} /> : null;
    }
    case "multi":
      return (
        <span className="db-pills">
          {(value as string[]).map((id) => {
            const o = prop.options.find((x) => x.id === id);
            return o ? <Pill key={id} option={o} /> : null;
          })}
        </span>
      );
    case "date":
      return <span>{dayTitle(value as string)}</span>;
    case "number":
      return <span className="db-num">{(value as number).toLocaleString()}</span>;
    case "url":
      return (
        <span className="db-url">
          <span className="db-url-text">{String(value)}</span>
          <button
            className="db-url-go"
            onClick={(e) => {
              e.stopPropagation();
              void openLink(String(value));
            }}
            title="Open the link"
          >
            <OpenIcon />
          </button>
        </span>
      );
    default:
      return <span className="db-text">{String(value)}</span>;
  }
}

/** 就地輸入：Enter 或離開就存，Esc 取消 */
function TextInput(props: { initial: string; numeric?: boolean; className?: string; onDone: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    props.onDone(v);
  };
  return (
    <input
      ref={ref}
      className={`db-input${props.className ? ` ${props.className}` : ""}`}
      defaultValue={props.initial}
      inputMode={props.numeric ? "decimal" : undefined}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.currentTarget.value);
        else if (e.key === "Escape") finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}

/* ─── 表格 ─── */

function Table(props: {
  db: Database;
  view: DbView;
  rows: Row[];
  cols: Prop[];
  canArrange: boolean;
  editing: Editing;
  cell: (row: Row, prop: Prop, where: "table" | "peek") => ReactNode;
  hasPage: (title: string) => boolean;
  onEdit: (row: Row, prop: Prop, el: HTMLElement) => void;
  onOpen: (row: Row) => void;
  onRowMenu: (row: Row, x: number, y: number) => void;
  onHeader: (prop: Prop, anchor: DOMRect) => void;
  onNewProp: (anchor: DOMRect) => void;
  onNewRow: () => void;
  onModify: (fn: (d: Database) => Database) => void;
}) {
  const { db, view, rows, cols } = props;
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [drag, setDrag] = useState<{ row: string; over: string | null; after: boolean } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const width = (p: Prop) => widths[p.id] ?? p.width;
  const sortOf = (p: Prop) => (view.sort?.prop === p.id ? (view.sort.desc ? " ↓" : " ↑") : "");

  const resize = (e: React.PointerEvent, p: Prop) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const w0 = width(p);
    let w = w0;
    const move = (ev: PointerEvent) => {
      w = Math.max(60, Math.min(800, w0 + ev.clientX - x0));
      setWidths((m) => ({ ...m, [p.id]: w }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (w !== w0) props.onModify((d) => resizeProp(d, p.id, w));
      setWidths((m) => {
        const n = { ...m };
        delete n[p.id];
        return n;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** 拖左邊的握把調整順序（沒有排序、沒有搜尋時）；沒拖動就是開選單 */
  const grab = (e: React.PointerEvent, row: Row) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    let on = false;
    let last: { over: string | null; after: boolean } = { over: null, after: false };
    const move = (ev: PointerEvent) => {
      if (!on && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      if (!props.canArrange) return;
      on = true;
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-row]");
      if (el && bodyRef.current?.contains(el) && el.dataset.row !== row.id) {
        const r = el.getBoundingClientRect();
        last = { over: el.dataset.row!, after: ev.clientY > r.top + r.height / 2 };
      } else last = { over: null, after: false };
      setDrag({ row: row.id, ...last });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (!on) {
        props.onRowMenu(row, ev.clientX, ev.clientY);
        return;
      }
      const target = last.over;
      if (!target) return;
      props.onModify((d) => {
        const i = d.rows.findIndex((r) => r.id === target);
        return i < 0 ? d : moveRow(d, row.id, i + (last.after ? 1 : 0));
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const total = cols.reduce((n, p) => n + width(p), 0);
  return (
    <div className="db-scroll">
      <div className="db-table" style={{ minWidth: total + 140 }}>
        <div className="db-tr db-head">
          {cols.map((p) => {
            const Icon = TYPE_ICON[p.type];
            return (
              <div key={p.id} className="db-th" style={{ width: width(p) }}>
                <button className="db-th-btn" onClick={(e) => props.onHeader(p, e.currentTarget.getBoundingClientRect())}>
                  <Icon />
                  <span className="db-th-name">{p.name || "Untitled"}</span>
                  {sortOf(p) && <span className="db-sorted">{sortOf(p)}</span>}
                </button>
                <span className="db-resize" onPointerDown={(e) => resize(e, p)} title="Drag to resize" />
              </div>
            );
          })}
          <button className="db-th db-add-prop" onClick={(e) => props.onNewProp(e.currentTarget.getBoundingClientRect())} title="Add a property">
            <PlusIcon />
          </button>
        </div>
        <div ref={bodyRef}>
          {rows.map((row) => {
            const dropping = drag?.over === row.id ? (drag.after ? " drop-after" : " drop-before") : "";
            return (
              <div
                key={row.id}
                data-row={row.id}
                className={`db-tr${drag?.row === row.id ? " lifted" : ""}${dropping}`}
                onContextMenu={(e) => {
                  e.preventDefault();
                  props.onRowMenu(row, e.clientX, e.clientY);
                }}
              >
                <button
                  className={`db-grip${props.canArrange ? "" : " fixed"}`}
                  onPointerDown={(e) => grab(e, row)}
                  title={props.canArrange ? "Drag to move · click for options" : "Click for options (sorted or searching — can't drag)"}
                >
                  <GripIcon />
                </button>
                {cols.map((p) => (
                  <div
                    key={p.id}
                    className={`db-td t-${p.type}${props.editing?.row === row.id && props.editing.prop === p.id && props.editing.where === "table" ? " editing" : ""}`}
                    style={{ width: width(p) }}
                    onClick={(e) => props.onEdit(row, p, e.currentTarget)}
                  >
                    {p.id === TITLE && props.hasPage(titleOf(row).trim()) && <DocIcon className="db-has-page" />}
                    {props.cell(row, p, "table")}
                    {p.id === TITLE && !(props.editing?.row === row.id && props.editing.prop === TITLE) && (
                      <button
                        className="db-open"
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onOpen(row);
                        }}
                      >
                        <OpenIcon /> Open
                      </button>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        <button className="db-new-row" onClick={props.onNewRow}>
          <PlusIcon /> New
        </button>
        <div className="db-count">
          {rows.length === db.rows.length ? `${rows.length} row${rows.length === 1 ? "" : "s"}` : `${rows.length} of ${db.rows.length} rows`}
        </div>
      </div>
    </div>
  );
}

/* ─── 看板 ─── */

function Board(props: {
  db: Database;
  view: DbView;
  rows: Row[];
  canArrange: boolean;
  onOpen: (row: Row) => void;
  onRowMenu: (row: Row, x: number, y: number) => void;
  onNew: (cells: Record<string, Cell>) => void;
  onModify: (fn: (d: Database) => Database) => void;
  onGroup: (anchor: DOMRect) => void;
}) {
  const { db, view } = props;
  const group = db.props.find((p) => p.id === view.groupBy && p.type === "select");
  const groups = boardGroups(db, view, props.rows);
  const shown = visibleProps(db, view).filter((p) => p.id !== TITLE && p.id !== group?.id);
  const [drag, setDrag] = useState<{ row: string; col: string | null; before: string | null } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dragged = useRef(false);

  const startDrag = (e: React.PointerEvent, row: Row) => {
    if (e.button !== 0) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let on = false;
    let last: { col: string | null; before: string | null } | null = null;
    dragged.current = false;
    const move = (ev: PointerEvent) => {
      if (!on && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      on = true;
      dragged.current = true;
      const hit = document.elementFromPoint(ev.clientX, ev.clientY);
      const colEl = hit?.closest<HTMLElement>("[data-col]");
      if (!colEl || !rootRef.current?.contains(colEl)) {
        last = null;
      } else {
        // 放在哪一張卡片前面：游標下面第一張卡片（自己不算）
        const cards = [...colEl.querySelectorAll<HTMLElement>("[data-card]")].filter((c) => c.dataset.card !== row.id);
        const next = cards.find((c) => {
          const r = c.getBoundingClientRect();
          return ev.clientY < r.top + r.height / 2;
        });
        last = { col: colEl.dataset.col ?? "", before: next?.dataset.card ?? null };
      }
      setDrag({ row: row.id, col: last?.col ?? null, before: last?.before ?? null });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      setTimeout(() => (dragged.current = false));
      if (!on || !last) return;
      const { col, before } = last;
      props.onModify((d) => {
        let next = group ? setCell(d, row.id, group.id, col || null) : d;
        if (props.canArrange) {
          if (before) {
            const i = next.rows.findIndex((r) => r.id === before);
            if (i >= 0) next = moveRow(next, row.id, i);
          } else {
            // 放在那一欄最後：排在那一欄最後一張的後面
            const inCol = next.rows.filter((r) => r.id !== row.id && (group ? (r.cells[group.id] ?? "") === (col ?? "") : true));
            const lastRow = inCol[inCol.length - 1];
            if (lastRow) next = moveRow(next, row.id, next.rows.findIndex((r) => r.id === lastRow.id) + 1);
          }
        }
        return next;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div ref={rootRef} className={`db-board${drag ? " dragging" : ""}`}>
      {!group && (
        <p className="db-board-hint">
          Pick a Select property to group the cards by —{" "}
          <button className="db-link-btn" onClick={(e) => props.onGroup(e.currentTarget.getBoundingClientRect())}>
            Group by…
          </button>
        </p>
      )}
      <div className="db-cols">
        {groups.map(({ option, rows }) => {
          const col = option?.id ?? "";
          const over = drag?.col === col;
          return (
            <div key={col || "none"} data-col={col} className={`db-col${over ? " over" : ""}`}>
              <div className="db-col-head">
                {option ? <Pill option={option} /> : <span className="db-none">{group ? `No ${group.name || "value"}` : "All"}</span>}
                <span className="db-col-count">{rows.length}</span>
              </div>
              {rows.map((row) => (
                <div key={row.id} className="db-card-slot">
                  {drag && over && drag.before === row.id && <div className="db-card-drop" />}
                  <div
                    data-card={row.id}
                    className={`db-card${drag?.row === row.id ? " lifted" : ""}`}
                    onPointerDown={(e) => startDrag(e, row)}
                    onClick={() => !dragged.current && props.onOpen(row)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      props.onRowMenu(row, e.clientX, e.clientY);
                    }}
                  >
                    <div className={`db-card-title${titleOf(row) ? "" : " empty"}`}>{titleOf(row) || "Untitled"}</div>
                    {shown
                      .filter((p) => !isEmpty(row.cells[p.id]))
                      .map((p) => (
                        <div key={p.id} className="db-card-prop" title={p.name}>
                          <CellValue prop={p} value={row.cells[p.id]} />
                        </div>
                      ))}
                  </div>
                </div>
              ))}
              {drag && over && drag.before === null && <div className="db-card-drop" />}
              <button className="db-col-new" onClick={() => props.onNew(group && option ? { [group.id]: option.id } : {})}>
                <PlusIcon /> New
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── 右邊打開的一列 ─── */

function Peek(props: {
  db: Database;
  row: Row;
  cell: (row: Row, prop: Prop, where: "table" | "peek") => ReactNode;
  hasPage: (title: string) => boolean;
  onEdit: (prop: Prop, el: HTMLElement) => void;
  onTitle: (t: string) => void;
  onOpenPage: () => void;
  onDelete: () => void;
  onNewProp: (anchor: DOMRect) => void;
  onProp: (prop: Prop, anchor: DOMRect) => void;
  onClose: () => void;
}) {
  const { db, row, onClose } = props;
  const ref = useRef<HTMLDivElement>(null);
  const title = titleOf(row);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current?.contains(t) || t.closest?.(".db-pop, .popover")) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector(".db-pop, .prop-menu")) return;
      onClose();
    };
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);
  return createPortal(
    <div ref={ref} className="db-peek" role="dialog" aria-label={title || "Untitled"}>
      <div className="db-peek-bar">
        <button className="icon-btn" onClick={onClose} title="Close (Esc)">
          <CloseIcon />
        </button>
        <span className="db-peek-spacer" />
        <button className="db-peek-btn" onClick={props.onOpenPage} disabled={!title.trim()} title={title.trim() ? `Open the page “${title.trim()}”` : "Give it a name first"}>
          <DocIcon /> {props.hasPage(title.trim()) ? "Open page" : "Open as page"}
        </button>
        <button className="icon-btn" onClick={props.onDelete} title="Delete this row">
          <TrashIcon />
        </button>
      </div>
      <textarea
        className="db-peek-title"
        defaultValue={title}
        placeholder="Untitled"
        rows={1}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        onBlur={(e) => e.currentTarget.value !== title && props.onTitle(e.currentTarget.value)}
      />
      <div className="db-peek-props">
        {db.props
          .filter((p) => p.id !== TITLE)
          .map((p) => {
            const Icon = TYPE_ICON[p.type];
            return (
              <div key={p.id} className="db-peek-row">
                <button className="db-peek-name" onClick={(e) => props.onProp(p, e.currentTarget.getBoundingClientRect())}>
                  <Icon /> <span>{p.name || "Untitled"}</span>
                </button>
                <div className={`db-peek-value t-${p.type}`} onClick={(e) => props.onEdit(p, e.currentTarget)}>
                  {props.cell(row, p, "peek")}
                  {isEmpty(row.cells[p.id]) && p.type !== "checkbox" && <span className="db-empty">Empty</span>}
                </div>
              </div>
            );
          })}
        <button className="db-peek-add" onClick={(e) => props.onNewProp(e.currentTarget.getBoundingClientRect())}>
          <PlusIcon /> Add a property
        </button>
      </div>
    </div>,
    document.body,
  );
}

/* ─── 選單 ─── */

/** 貼著某個位置的浮動選單（portal 到 body）；點外面或 Esc 關掉 */
function Popover(props: { anchor: DOMRect; onClose: () => void; wide?: boolean; children: ReactNode }) {
  const { anchor, onClose } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 4 });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const below = anchor.bottom + 4;
    const top = below + r.height > window.innerHeight - 8 ? Math.max(8, anchor.top - r.height - 4) : below;
    setPos({ left: Math.max(8, Math.min(anchor.left, window.innerWidth - r.width - 8)), top });
  }, [anchor]);
  useEffect(() => {
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);
  return createPortal(
    <div ref={ref} className={`popover db-pop${props.wide ? " wide" : ""}`} style={{ position: "fixed", ...pos }}>
      {props.children}
    </div>,
    document.body,
  );
}

function TypeList(props: { current?: PropType; onPick: (t: PropType) => void }) {
  return (
    <div className="db-list">
      <div className="db-pop-title">Type</div>
      {PROP_TYPES.map((t) => {
        const Icon = TYPE_ICON[t.id];
        return (
          <button key={t.id} className={props.current === t.id ? "on" : ""} onClick={() => props.onPick(t.id)}>
            <Icon /> {t.name}
            {props.current === t.id && <span className="db-check">✓</span>}
          </button>
        );
      })}
    </div>
  );
}

/** 點欄名：改名稱、型別、排序、藏起來、左右搬、刪掉 */
function PropMenu(props: { db: Database; view: DbView; propId: string; onModify: (fn: (d: Database) => Database) => void; onClose: () => void }) {
  const { db, view, propId, onModify, onClose } = props;
  const prop = db.props.find((p) => p.id === propId);
  const [types, setTypes] = useState(false);
  if (!prop) return null;
  const title = prop.id === TITLE;
  const at = db.props.indexOf(prop);
  if (types) {
    return (
      <TypeList
        current={prop.type}
        onPick={(t) => {
          onModify((d) => setPropType(d, prop.id, t));
          setTypes(false);
        }}
      />
    );
  }
  const Icon = TYPE_ICON[prop.type];
  return (
    <div className="db-list">
      <input
        className="db-name-input"
        autoFocus
        defaultValue={prop.name}
        placeholder="Property name"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          const v = e.target.value;
          onModify((d) => renameProp(d, prop.id, v));
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" || e.key === "Escape") onClose();
        }}
      />
      {!title && (
        <button onClick={() => setTypes(true)}>
          <Icon /> Type
          <span className="db-hint">{PROP_TYPES.find((t) => t.id === prop.type)?.name}</span>
        </button>
      )}
      <div className="db-sep" />
      <button
        onClick={() => {
          onModify((d) => patchView(d, view.id, { sort: { prop: prop.id, desc: false } }));
          onClose();
        }}
      >
        <SortIcon /> Sort ascending
      </button>
      <button
        onClick={() => {
          onModify((d) => patchView(d, view.id, { sort: { prop: prop.id, desc: true } }));
          onClose();
        }}
      >
        <SortIcon /> Sort descending
      </button>
      {!title && (
        <>
          <button
            onClick={() => {
              onModify((d) => patchView(d, view.id, { hidden: [...view.hidden, prop.id] }));
              onClose();
            }}
          >
            <PropsIcon /> Hide in this view
          </button>
          {at > 1 && (
            <button onClick={() => onModify((d) => moveProp(d, prop.id, at - 1))}>
              <span className="db-arrow">←</span> Move left
            </button>
          )}
          {at < db.props.length - 1 && (
            <button onClick={() => onModify((d) => moveProp(d, prop.id, at + 2))}>
              <span className="db-arrow">→</span> Move right
            </button>
          )}
          <div className="db-sep" />
          <button
            className="danger"
            onClick={() => {
              onModify((d) => removeProp(d, prop.id));
              onClose();
            }}
          >
            <TrashIcon /> Delete property
          </button>
        </>
      )}
    </div>
  );
}

/** 選項：搜尋或新增、點了選取（多選可以選好幾個）、每個選項可以改名、換色、刪掉 */
function OptionPicker(props: {
  prop: Prop;
  chosen: string[];
  onPick: (id: string) => void;
  onCreate: (name: string) => void;
  onEditOption: (id: string, patch: Partial<Omit<Option, "id">>) => void;
  onDeleteOption: (id: string) => void;
  onClose: () => void;
}) {
  const { prop, chosen } = props;
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<string | null>(null);
  const query = q.trim().toLowerCase();
  const list = prop.options.filter((o) => o.name.toLowerCase().includes(query));
  const exact = prop.options.find((o) => o.name.toLowerCase() === query);
  const editing = prop.options.find((o) => o.id === edit);

  if (editing) {
    return (
      <div className="db-list">
        <input
          className="db-name-input"
          autoFocus
          defaultValue={editing.name}
          onChange={(e) => e.target.value.trim() && props.onEditOption(editing.id, { name: e.target.value.trim() })}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" || e.key === "Escape") {
              e.preventDefault();
              setEdit(null);
            }
          }}
        />
        <button
          className="danger"
          onClick={() => {
            props.onDeleteOption(editing.id);
            setEdit(null);
          }}
        >
          <TrashIcon /> Delete option
        </button>
        <div className="db-sep" />
        <div className="db-pop-title">Color</div>
        {COLORS.map((c: Color) => (
          <button key={c} className={editing.color === c ? "on" : ""} onClick={() => props.onEditOption(editing.id, { color: c })}>
            <span className={`db-swatch c-${c}`} /> {c[0].toUpperCase() + c.slice(1)}
            {editing.color === c && <span className="db-check">✓</span>}
          </button>
        ))}
        <div className="db-sep" />
        <button onClick={() => setEdit(null)}>← Back</button>
      </div>
    );
  }

  return (
    <div className="db-list db-options">
      <div className="db-chosen">
        {chosen.map((id) => {
          const o = prop.options.find((x) => x.id === id);
          return o ? <Pill key={id} option={o} onRemove={() => props.onPick(id)} /> : null;
        })}
        <input
          autoFocus
          value={q}
          placeholder={prop.options.length ? "Search for an option…" : "Type to add an option…"}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              if (exact) props.onPick(exact.id);
              else if (query) props.onCreate(q.trim());
              else if (list[0]) props.onPick(list[0].id);
              setQ("");
            } else if (e.key === "Backspace" && !q && chosen.length) {
              props.onPick(chosen[chosen.length - 1]);
            } else if (e.key === "Escape") props.onClose();
          }}
        />
      </div>
      <div className="db-pop-title">{prop.type === "multi" ? "Select one or more" : "Select an option"}</div>
      {list.map((o) => (
        <div key={o.id} className={`db-opt${chosen.includes(o.id) ? " on" : ""}`}>
          <button className="db-opt-pick" onClick={() => props.onPick(o.id)}>
            <Pill option={o} />
            {chosen.includes(o.id) && <span className="db-check">✓</span>}
          </button>
          <button className="db-opt-more" onClick={() => setEdit(o.id)} title="Rename, color or delete">
            <MoreIcon />
          </button>
        </div>
      ))}
      {query && !exact && (
        <button
          onClick={() => {
            props.onCreate(q.trim());
            setQ("");
          }}
        >
          <PlusIcon /> Create <span className="db-pill c-gray">{q.trim()}</span>
        </button>
      )}
    </div>
  );
}
