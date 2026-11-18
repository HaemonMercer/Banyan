/**
 * 資料庫（參考 Notion 的 Database），側邊欄「Databases」裡的獨立檔案：一列一筆資料，每一欄是有型別的屬性。
 * 存成 App 資料夾的 `databases/名稱.json`；這裡是純函式：讀寫、欄位與資料列的增刪改、排序、篩選、分組。
 * 第一個欄位永遠是標題（`title`），不能刪也不能改型別；每一列的標題可以當作同名頁面打開。
 */

export type PropType = "title" | "text" | "number" | "select" | "multi" | "date" | "checkbox" | "url";

export const PROP_TYPES: { id: PropType; name: string }[] = [
  { id: "text", name: "Text" },
  { id: "number", name: "Number" },
  { id: "select", name: "Select" },
  { id: "multi", name: "Multi-select" },
  { id: "date", name: "Date" },
  { id: "checkbox", name: "Checkbox" },
  { id: "url", name: "URL" },
];

/** 選項的顏色（跟 Notion 一樣的幾種） */
export const COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;
export type Color = (typeof COLORS)[number];

export interface Option {
  id: string;
  name: string;
  color: Color;
}

export interface Prop {
  id: string;
  name: string;
  type: PropType;
  /** select、multi 的選項（其他型別是空的） */
  options: Option[];
  /** 表格裡的欄寬（px） */
  width: number;
}

/** 一格的值：文字、數字、日期（YYYY-MM-DD）、網址是字串或數字；勾選是布林；選項是 id（多選是 id 陣列） */
export type Cell = string | number | boolean | string[] | null;

export interface Row {
  id: string;
  cells: Record<string, Cell>;
}

export type ViewType = "table" | "board";

export interface DbView {
  id: string;
  name: string;
  type: ViewType;
  /** 依哪一欄排序（null 是照資料列原本的順序，可以拖曳調整） */
  sort: { prop: string; desc: boolean } | null;
  /** 看板依哪一個單選欄位分組 */
  groupBy: string | null;
  /** 這個檢視藏起來的欄位 */
  hidden: string[];
}

export interface Database {
  props: Prop[];
  rows: Row[];
  views: DbView[];
}

export const TITLE = "title";

let counter = 0;
/** 短的隨機代號（同一個檔案裡不重複就好） */
export function newId(prefix = ""): string {
  counter = (counter + 1) % 1296;
  return prefix + Date.now().toString(36).slice(-5) + counter.toString(36).padStart(2, "0") + Math.random().toString(36).slice(2, 5);
}

const DEFAULT_WIDTH: Record<PropType, number> = {
  title: 260,
  text: 220,
  number: 110,
  select: 160,
  multi: 200,
  date: 140,
  checkbox: 90,
  url: 200,
};

export function newView(type: ViewType, name?: string, groupBy: string | null = null): DbView {
  return { id: newId("v"), name: name ?? (type === "table" ? "Table" : "Board"), type, sort: null, groupBy, hidden: [] };
}

/** 新的資料庫：標題、狀態（單選）、標籤（多選）三欄，三列空白，一個表格檢視 */
export function newDatabase(): Database {
  const status: Prop = {
    id: newId("p"),
    name: "Status",
    type: "select",
    width: DEFAULT_WIDTH.select,
    options: [
      { id: newId("o"), name: "Not started", color: "gray" },
      { id: newId("o"), name: "In progress", color: "blue" },
      { id: newId("o"), name: "Done", color: "green" },
    ],
  };
  const tags: Prop = { id: newId("p"), name: "Tags", type: "multi", width: DEFAULT_WIDTH.multi, options: [] };
  return {
    props: [{ id: TITLE, name: "Name", type: "title", options: [], width: DEFAULT_WIDTH.title }, status, tags],
    rows: [0, 1, 2].map(() => ({ id: newId("r"), cells: {} })),
    views: [newView("table")],
  };
}

/* ─── 讀寫 ─── */

const isColor = (v: unknown): v is Color => typeof v === "string" && (COLORS as readonly string[]).includes(v);
const isType = (v: unknown): v is PropType => v === "title" || PROP_TYPES.some((t) => t.id === v);

function parseCell(type: PropType, v: unknown, options: Option[]): Cell {
  const ids = new Set(options.map((o) => o.id));
  switch (type) {
    case "number":
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    case "checkbox":
      return v === true;
    case "select":
      return typeof v === "string" && ids.has(v) ? v : null;
    case "multi":
      return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && ids.has(x)))] : [];
    case "date":
      return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
    default:
      return typeof v === "string" ? v : null;
  }
}

/** 讀檔；壞掉或空的就給一個新的資料庫（不會丟出錯誤） */
export function parseDatabase(json: string): Database {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json || "null");
  } catch {
    raw = {};
  }
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.props)) return newDatabase();
  const props: Prop[] = [];
  const seen = new Set<string>();
  for (const x of raw.props as unknown[]) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    if (typeof o.id !== "string" || seen.has(o.id) || !isType(o.type)) continue;
    if ((o.type === "title") !== (o.id === TITLE)) continue;
    seen.add(o.id);
    const type = o.type;
    const options: Option[] =
      type === "select" || type === "multi"
        ? (Array.isArray(o.options) ? (o.options as Record<string, unknown>[]) : [])
            .filter((p) => p && typeof p.id === "string" && typeof p.name === "string")
            .map((p) => ({ id: p.id as string, name: p.name as string, color: isColor(p.color) ? p.color : "gray" }))
        : [];
    const width = typeof o.width === "number" && o.width >= 60 ? Math.round(Math.min(800, o.width)) : DEFAULT_WIDTH[type];
    props.push({ id: o.id, name: typeof o.name === "string" ? o.name : "", type, options, width });
  }
  // 標題欄一定在最前面
  const ti = props.findIndex((p) => p.id === TITLE);
  const title = ti >= 0 ? props.splice(ti, 1)[0] : { id: TITLE, name: "Name", type: "title" as const, options: [], width: DEFAULT_WIDTH.title };
  props.unshift(title);

  const rows: Row[] = [];
  const rowIds = new Set<string>();
  for (const x of Array.isArray(raw.rows) ? (raw.rows as unknown[]) : []) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    if (typeof o.id !== "string" || rowIds.has(o.id)) continue;
    rowIds.add(o.id);
    const src = (o.cells && typeof o.cells === "object" ? o.cells : {}) as Record<string, unknown>;
    const cells: Record<string, Cell> = {};
    for (const p of props) {
      if (!(p.id in src)) continue;
      const c = parseCell(p.type, src[p.id], p.options);
      if (!isEmpty(c)) cells[p.id] = c;
    }
    rows.push({ id: o.id, cells });
  }

  const propIds = new Set(props.map((p) => p.id));
  const views: DbView[] = [];
  for (const x of Array.isArray(raw.views) ? (raw.views as unknown[]) : []) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    if (typeof o.id !== "string" || (o.type !== "table" && o.type !== "board")) continue;
    const s = o.sort as Record<string, unknown> | null | undefined;
    views.push({
      id: o.id,
      name: typeof o.name === "string" ? o.name : "",
      type: o.type,
      sort: s && typeof s.prop === "string" && propIds.has(s.prop) ? { prop: s.prop, desc: s.desc === true } : null,
      groupBy: typeof o.groupBy === "string" && props.some((p) => p.id === o.groupBy && p.type === "select") ? o.groupBy : null,
      hidden: Array.isArray(o.hidden) ? o.hidden.filter((h): h is string => typeof h === "string" && propIds.has(h) && h !== TITLE) : [],
    });
  }
  if (!views.length) views.push(newView("table"));
  return { props, rows, views };
}

export function serializeDatabase(db: Database): string {
  return (
    JSON.stringify(
      {
        version: 1,
        props: db.props.map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          width: p.width,
          ...(p.type === "select" || p.type === "multi" ? { options: p.options } : {}),
        })),
        rows: db.rows.map((r) => ({ id: r.id, cells: r.cells })),
        views: db.views,
      },
      null,
      2,
    ) + "\n"
  );
}

/* ─── 值 ─── */

export function isEmpty(c: Cell | undefined): boolean {
  return c === null || c === undefined || c === "" || c === false || (Array.isArray(c) && c.length === 0);
}

export const titleOf = (r: Row): string => (typeof r.cells[TITLE] === "string" ? (r.cells[TITLE] as string) : "");

/** 一格的文字（搜尋、排序、型別轉換用） */
export function cellText(p: Prop, c: Cell | undefined): string {
  if (isEmpty(c)) return "";
  if (p.type === "select") return p.options.find((o) => o.id === c)?.name ?? "";
  if (p.type === "multi") return (c as string[]).map((id) => p.options.find((o) => o.id === id)?.name ?? "").filter(Boolean).join(", ");
  if (p.type === "checkbox") return c ? "Yes" : "";
  return String(c);
}

/* ─── 欄位 ─── */

const mapProp = (db: Database, id: string, fn: (p: Prop) => Prop): Database => ({
  ...db,
  props: db.props.map((p) => (p.id === id ? fn(p) : p)),
});

/** 加一欄（`after` 省略是放最後） */
export function addProp(db: Database, type: PropType, name: string, after?: string): { db: Database; id: string } {
  const p: Prop = { id: newId("p"), name, type: type === "title" ? "text" : type, options: [], width: DEFAULT_WIDTH[type] };
  const props = [...db.props];
  const i = after ? props.findIndex((x) => x.id === after) : -1;
  props.splice(i >= 0 ? i + 1 : props.length, 0, p);
  return { db: { ...db, props }, id: p.id };
}

export function renameProp(db: Database, id: string, name: string): Database {
  return mapProp(db, id, (p) => ({ ...p, name }));
}

export function resizeProp(db: Database, id: string, width: number): Database {
  return mapProp(db, id, (p) => ({ ...p, width: Math.round(Math.max(60, Math.min(800, width))) }));
}

/** 刪掉一欄（標題不能刪）；資料列裡的值、檢視裡的設定一起拿掉 */
export function removeProp(db: Database, id: string): Database {
  if (id === TITLE) return db;
  return {
    props: db.props.filter((p) => p.id !== id),
    rows: db.rows.map((r) => {
      if (!(id in r.cells)) return r;
      const cells = { ...r.cells };
      delete cells[id];
      return { ...r, cells };
    }),
    views: db.views.map((v) => ({
      ...v,
      sort: v.sort?.prop === id ? null : v.sort,
      groupBy: v.groupBy === id ? null : v.groupBy,
      hidden: v.hidden.filter((h) => h !== id),
    })),
  };
}

/** 搬一欄到第 `index` 個（以搬之前的位置算；標題永遠第一） */
export function moveProp(db: Database, id: string, index: number): Database {
  const at = db.props.findIndex((p) => p.id === id);
  if (at <= 0) return db;
  const props = [...db.props];
  const [p] = props.splice(at, 1);
  props.splice(Math.max(1, Math.min(props.length, index > at ? index - 1 : index)), 0, p);
  return { ...db, props };
}

/**
 * 換型別：能轉的值盡量保留（文字 ↔ 數字、文字 → 選項會建立選項、選項 → 文字是選項名稱），轉不了的清掉。
 */
export function setPropType(db: Database, id: string, type: PropType): Database {
  const old = db.props.find((p) => p.id === id);
  if (!old || old.type === type || id === TITLE || type === "title") return db;
  let options: Option[] = type === "select" || type === "multi" ? (old.type === "select" || old.type === "multi" ? old.options : []) : [];
  const optionFor = (name: string): string => {
    const n = name.trim();
    let o = options.find((x) => x.name.toLowerCase() === n.toLowerCase());
    if (!o) {
      o = { id: newId("o"), name: n, color: COLORS[options.length % COLORS.length] };
      options = [...options, o];
    }
    return o.id;
  };
  const convert = (c: Cell | undefined): Cell => {
    if (isEmpty(c)) return null;
    const text = cellText(old, c);
    switch (type) {
      case "number": {
        const n = Number(text.replace(/,/g, ""));
        return text.trim() && Number.isFinite(n) ? n : null;
      }
      case "checkbox":
        return old.type === "checkbox" ? (c ?? null) : /^(yes|true|1|x|✓)$/i.test(text.trim());
      case "select":
        if (old.type === "multi") return (c as string[])[0] ?? null;
        return text.trim() ? optionFor(text.split(",")[0]) : null;
      case "multi":
        if (old.type === "select") return [c as string];
        return [...new Set(text.split(",").map((s) => s.trim()).filter(Boolean).map(optionFor))];
      case "date":
        return /^\d{4}-\d{2}-\d{2}$/.test(text.trim()) ? text.trim() : null;
      default:
        return text;
    }
  };
  const rows = db.rows.map((r) => {
    if (!(id in r.cells)) return r;
    const cells = { ...r.cells };
    const v = convert(r.cells[id]);
    if (isEmpty(v)) delete cells[id];
    else cells[id] = v;
    return { ...r, cells };
  });
  const props = db.props.map((p) => (p.id === id ? { ...p, type, options, width: DEFAULT_WIDTH[type] } : p));
  const views = db.views.map((v) => (v.groupBy === id && type !== "select" ? { ...v, groupBy: null } : v));
  return { props, rows, views };
}

/* ─── 選項 ─── */

/** 加一個選項（同名的已經有就用它），回傳選項 id */
export function addOption(db: Database, propId: string, name: string): { db: Database; id: string } | null {
  const p = db.props.find((x) => x.id === propId);
  const n = name.trim();
  if (!p || !n || (p.type !== "select" && p.type !== "multi")) return null;
  const have = p.options.find((o) => o.name.toLowerCase() === n.toLowerCase());
  if (have) return { db, id: have.id };
  const o: Option = { id: newId("o"), name: n, color: COLORS[p.options.length % COLORS.length] };
  return { db: mapProp(db, propId, (x) => ({ ...x, options: [...x.options, o] })), id: o.id };
}

export function patchOption(db: Database, propId: string, optId: string, patch: Partial<Omit<Option, "id">>): Database {
  return mapProp(db, propId, (p) => ({ ...p, options: p.options.map((o) => (o.id === optId ? { ...o, ...patch } : o)) }));
}

/** 刪掉選項：用到它的格子一起清掉 */
export function removeOption(db: Database, propId: string, optId: string): Database {
  const next = mapProp(db, propId, (p) => ({ ...p, options: p.options.filter((o) => o.id !== optId) }));
  return {
    ...next,
    rows: next.rows.map((r) => {
      const c = r.cells[propId];
      if (c === optId) {
        const cells = { ...r.cells };
        delete cells[propId];
        return { ...r, cells };
      }
      if (Array.isArray(c) && c.includes(optId)) return { ...r, cells: { ...r.cells, [propId]: c.filter((x) => x !== optId) } };
      return r;
    }),
  };
}

/* ─── 資料列 ─── */

/** 加一列（`index` 省略是放最後），可以帶初始值；`id` 可以先決定好（畫面要馬上編輯它） */
export function addRow(db: Database, cells: Record<string, Cell> = {}, index?: number, id = newId("r")): { db: Database; id: string } {
  const row: Row = { id, cells: {} };
  for (const [k, v] of Object.entries(cells)) if (!isEmpty(v)) row.cells[k] = v;
  const rows = [...db.rows];
  rows.splice(index ?? rows.length, 0, row);
  return { db: { ...db, rows }, id: row.id };
}

export function setCell(db: Database, rowId: string, propId: string, value: Cell): Database {
  return {
    ...db,
    rows: db.rows.map((r) => {
      if (r.id !== rowId) return r;
      const cells = { ...r.cells };
      if (isEmpty(value)) delete cells[propId];
      else cells[propId] = value;
      return { ...r, cells };
    }),
  };
}

export function removeRow(db: Database, rowId: string): Database {
  return { ...db, rows: db.rows.filter((r) => r.id !== rowId) };
}

/** 複製一列，放在它下面 */
export function duplicateRow(db: Database, rowId: string): { db: Database; id: string } | null {
  const i = db.rows.findIndex((r) => r.id === rowId);
  if (i < 0) return null;
  const src = db.rows[i];
  const cells = { ...src.cells };
  if (typeof cells[TITLE] === "string" && cells[TITLE]) cells[TITLE] = `${cells[TITLE]} (copy)`;
  return addRow(db, cells, i + 1);
}

/** 搬一列到第 `index` 個（以搬之前的位置算） */
export function moveRow(db: Database, rowId: string, index: number): Database {
  const at = db.rows.findIndex((r) => r.id === rowId);
  if (at < 0) return db;
  const rows = [...db.rows];
  const [r] = rows.splice(at, 1);
  const to = Math.max(0, Math.min(rows.length, index > at ? index - 1 : index));
  if (to === at) return db;
  rows.splice(to, 0, r);
  return { ...db, rows };
}

/* ─── 檢視 ─── */

export function patchView(db: Database, viewId: string, patch: Partial<Omit<DbView, "id">>): Database {
  return { ...db, views: db.views.map((v) => (v.id === viewId ? { ...v, ...patch } : v)) };
}

export function addView(db: Database, type: ViewType): { db: Database; id: string } {
  const groupBy = type === "board" ? (db.props.find((p) => p.type === "select")?.id ?? null) : null;
  const same = db.views.filter((v) => v.type === type).length;
  const base = type === "table" ? "Table" : "Board";
  const v = newView(type, same ? `${base} ${same + 1}` : base, groupBy);
  return { db: { ...db, views: [...db.views, v] }, id: v.id };
}

/** 刪掉檢視（至少留一個） */
export function removeView(db: Database, viewId: string): Database {
  if (db.views.length <= 1) return db;
  return { ...db, views: db.views.filter((v) => v.id !== viewId) };
}

/** 要顯示的欄位（標題永遠在） */
export function visibleProps(db: Database, view: DbView): Prop[] {
  const hidden = new Set(view.hidden);
  return db.props.filter((p) => p.id === TITLE || !hidden.has(p.id));
}

function compareCells(p: Prop, a: Cell | undefined, b: Cell | undefined): number {
  // 空的永遠排最後（不管升冪降冪由呼叫端處理）
  switch (p.type) {
    case "number":
      return (a as number) - (b as number);
    case "checkbox":
      return (a ? 1 : 0) - (b ? 1 : 0);
    case "select": {
      const ia = p.options.findIndex((o) => o.id === a);
      const ib = p.options.findIndex((o) => o.id === b);
      return ia - ib;
    }
    default:
      return cellText(p, a).localeCompare(cellText(p, b), undefined, { numeric: true, sensitivity: "base" });
  }
}

/** 檢視裡看到的資料列：依搜尋字篩選（任一欄的文字），再依檢視的排序；空值排最後 */
export function viewRows(db: Database, view: DbView, query = ""): Row[] {
  const q = query.trim().toLowerCase();
  let rows = q ? db.rows.filter((r) => db.props.some((p) => cellText(p, r.cells[p.id]).toLowerCase().includes(q))) : db.rows;
  const s = view.sort;
  const p = s && db.props.find((x) => x.id === s.prop);
  if (s && p) {
    const dir = s.desc ? -1 : 1;
    rows = rows
      .map((r, i) => ({ r, i }))
      .sort((x, y) => {
        const a = x.r.cells[p.id];
        const b = y.r.cells[p.id];
        const ea = isEmpty(a) && p.type !== "checkbox";
        const eb = isEmpty(b) && p.type !== "checkbox";
        if (ea !== eb) return ea ? 1 : -1;
        return (ea ? 0 : dir * compareCells(p, a, b)) || x.i - y.i;
      })
      .map((x) => x.r);
  }
  return rows;
}

/** 看板的欄：分組欄位的每個選項一欄，最後是「沒有」 */
export function boardGroups(db: Database, view: DbView, rows: Row[]): { option: Option | null; rows: Row[] }[] {
  const p = db.props.find((x) => x.id === view.groupBy && x.type === "select");
  if (!p) return [{ option: null, rows }];
  const groups = p.options.map((o) => ({ option: o as Option | null, rows: rows.filter((r) => r.cells[p.id] === o.id) }));
  groups.push({ option: null, rows: rows.filter((r) => !p.options.some((o) => o.id === r.cells[p.id])) });
  return groups;
}
