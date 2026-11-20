import { useEffect, useRef } from "react";
import { CloseIcon, PlusIcon } from "../editor/icons";
import { COND_LABEL, LOOK_STYLE, NO_VALUE } from "./features";
import { cellName, colName, FUNCTION_NAMES } from "./formula";
import { addRule, COND_OPS, LOOKS, patchRule, patchTable, removeRule, type Cond, type CondOp, type Filter, type Look, type Rect, type Table, type Workbook } from "./model";

/** Format 面板的「Conditional Highlighting」、「Filter」，以及尋找列、函式自動完成。 */

type Run = (fn: (w: Workbook) => Workbook) => void;

/** 條件：運算子＋值（between 兩個值）；值在離開輸入框或按 Enter 時才存 */
function CondEditor(props: { cond: Cond; onChange: (patch: Partial<Cond>) => void }) {
  const { cond } = props;
  const commit = (k: "value" | "value2") => (e: React.FocusEvent<HTMLInputElement>) => e.target.value !== (cond[k] ?? "") && props.onChange({ [k]: e.target.value });
  const enter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === "Enter") e.currentTarget.blur();
  };
  return (
    <div className="sv-cond">
      <select value={cond.op} onChange={(e) => props.onChange({ op: e.target.value as CondOp })}>
        {COND_OPS.map((op) => (
          <option key={op} value={op}>
            {COND_LABEL[op]}
          </option>
        ))}
      </select>
      {!NO_VALUE.includes(cond.op) && (
        <div className="sv-cond-values">
          <input key={`a${cond.value}`} defaultValue={cond.value} placeholder="Value" onBlur={commit("value")} onKeyDown={enter} />
          {cond.op === "between" && (
            <>
              <span>and</span>
              <input key={`b${cond.value2}`} defaultValue={cond.value2 ?? ""} placeholder="Value" onBlur={commit("value2")} onKeyDown={enter} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

const overlaps = (a: Rect, b: Rect) => a.r0 <= b.r1 && b.r0 <= a.r1 && a.c0 <= b.c1 && b.c0 <= a.c1;
const rangeName = (r: Rect) => (r.r0 === r.r1 && r.c0 === r.c1 ? cellName(r.r0, r.c0) : `${cellName(r.r0, r.c0)}:${cellName(r.r1, r.c1)}`);

/** 條件式醒目提示：選取範圍碰到的規則，與「Add a Rule」（套用在選取範圍） */
export function RulesSection(props: { t: Table; rect: Rect; run: Run }) {
  const { t, rect, run } = props;
  const rules = t.rules.filter((r) => overlaps(r, rect));
  return (
    <section>
      <h4>Conditional Highlighting</h4>
      {rules.map((r) => (
        <div key={r.id} className="sv-rule">
          <div className="sv-rule-head">
            <span>Cells {rangeName(r)}</span>
            <button className="sv-x" title="Delete this rule" onClick={() => run((w) => removeRule(w, t.id, r.id))}>
              <CloseIcon />
            </button>
          </div>
          <CondEditor cond={r} onChange={(p) => run((w) => patchRule(w, t.id, r.id, p))} />
          <div className="sv-looks">
            {LOOKS.map((l) => (
              <LookChip key={l} look={l} on={r.look === l} onClick={() => run((w) => patchRule(w, t.id, r.id, { look: l }))} />
            ))}
          </div>
        </div>
      ))}
      <button
        className="sv-add"
        onClick={() => run((w) => addRule(w, t.id, { ...rect, op: "gt", value: "0", look: "green" }).wb)}
        title="Highlight cells in the selection that match a condition"
      >
        <PlusIcon /> Add a Rule for {rangeName(rect)}
      </button>
    </section>
  );
}

function LookChip(props: { look: Look; on: boolean; onClick: () => void }) {
  const s = LOOK_STYLE[props.look];
  return (
    <button className={`sv-look${props.on ? " on" : ""}`} title={s.label} onClick={props.onClick} style={{ background: s.fill, color: s.color, fontWeight: s.bold ? 700 : undefined }}>
      A
    </button>
  );
}

/** 篩選：開關、每條規則（欄＋條件），全部符合的列才顯示 */
export function FilterSection(props: { t: Table; hidden: number; col: number; run: Run }) {
  const { t, run } = props;
  const set = (filters: Filter[], on = t.filterOn) => run((w) => patchTable(w, t.id, { filters, filterOn: on }));
  return (
    <section>
      <h4>Filter</h4>
      <label className="sv-check">
        <input type="checkbox" checked={t.filterOn} disabled={!t.filters.length} onChange={(e) => set(t.filters, e.target.checked)} /> Filter rows
        {t.filterOn && t.filters.length > 0 && <span className="sv-muted">· {props.hidden} hidden</span>}
      </label>
      {t.filters.map((f, i) => (
        <div key={i} className="sv-rule">
          <div className="sv-rule-head">
            <select value={f.col} onChange={(e) => set(t.filters.map((x, j) => (j === i ? { ...x, col: Number(e.target.value) } : x)))}>
              {Array.from({ length: t.cols }, (_x, c) => (
                <option key={c} value={c}>
                  Column {colName(c)}
                  {t.hr ? ` · ${headerText(t, c)}` : ""}
                </option>
              ))}
            </select>
            <button className="sv-x" title="Delete this filter" onClick={() => set(t.filters.filter((_x, j) => j !== i), t.filters.length > 1 && t.filterOn)}>
              <CloseIcon />
            </button>
          </div>
          <CondEditor cond={f} onChange={(p) => set(t.filters.map((x, j) => (j === i ? { ...x, ...p } : x)))} />
        </div>
      ))}
      <button className="sv-add" onClick={() => set([...t.filters, { col: props.col, op: "contains", value: "" }], true)} title="Only show rows that match">
        <PlusIcon /> Add a Filter
      </button>
      {t.filters.length > 1 && <p className="sv-note">Rows must match all filters. Header and footer rows always show.</p>}
    </section>
  );
}

const headerText = (t: Table, c: number) => {
  const v = t.cells[`${t.hr - 1},${c}`]?.v ?? "";
  return v.length > 14 ? v.slice(0, 13) + "…" : v;
};

/* ─── 尋找與取代 ─── */

export interface FindState {
  q: string;
  by: string;
  matchCase: boolean;
  whole: boolean;
  replace: boolean;
  i: number;
}

export function FindBar(props: {
  state: FindState;
  count: number;
  onChange: (s: FindState) => void;
  onStep: (d: 1 | -1) => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
}) {
  const { state: s, count } = props;
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const keys = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") props.onClose();
    else if (e.key === "Enter") {
      e.preventDefault();
      props.onStep(e.shiftKey ? -1 : 1);
    }
  };
  return (
    <div className="sv-find" onKeyDown={keys}>
      <input ref={ref} value={s.q} placeholder="Find" spellCheck={false} onChange={(e) => props.onChange({ ...s, q: e.target.value, i: 0 })} />
      <span className="sv-find-count">{s.q ? (count ? `${Math.min(s.i, count - 1) + 1} of ${count}` : "No results") : ""}</span>
      <button className="sv-btn" disabled={!count} onClick={() => props.onStep(-1)} title="Previous (Shift+Enter)">
        ‹
      </button>
      <button className="sv-btn" disabled={!count} onClick={() => props.onStep(1)} title="Next (Enter)">
        ›
      </button>
      <label className="sv-find-opt" title="Match case">
        <input type="checkbox" checked={s.matchCase} onChange={(e) => props.onChange({ ...s, matchCase: e.target.checked, i: 0 })} /> Aa
      </label>
      <label className="sv-find-opt" title="Whole cell">
        <input type="checkbox" checked={s.whole} onChange={(e) => props.onChange({ ...s, whole: e.target.checked, i: 0 })} /> Whole cell
      </label>
      {s.replace ? (
        <>
          <input value={s.by} placeholder="Replace with" spellCheck={false} onChange={(e) => props.onChange({ ...s, by: e.target.value })} />
          <button className="sv-btn labeled" disabled={!count} onClick={props.onReplace}>
            Replace
          </button>
          <button className="sv-btn labeled" disabled={!count} onClick={props.onReplaceAll}>
            All
          </button>
        </>
      ) : (
        <button className="sv-btn labeled" onClick={() => props.onChange({ ...s, replace: true })} title="Replace (Ctrl+H)">
          Replace…
        </button>
      )}
      <span className="sv-gap" />
      <button className="sv-btn" onClick={props.onClose} title="Close (Esc)">
        <CloseIcon />
      </button>
    </div>
  );
}

/* ─── 函式自動完成 ─── */

/** 游標前面正在打的函式名稱（前面是 = 或運算子、括號、逗號）；不是就回傳 null */
export function fnPrefix(text: string, caret: number): string | null {
  if (!text.startsWith("=")) return null;
  const m = /(?:^=|[=(+\-*/^&,:<>;\s])([A-Za-z][A-Za-z0-9.]*)$/.exec(text.slice(0, caret));
  if (!m) return null;
  // 已經是一個儲存格參照（A1、AB12）就不提示
  if (/^[A-Za-z]{1,3}\d+$/.test(m[1])) return null;
  return m[1];
}

/** 常用的排前面（打「SU」先出 SUM），其次短的、再照字母 */
const POPULAR = ["SUM", "AVERAGE", "IF", "COUNT", "MIN", "MAX", "ROUND", "COUNTIF", "SUMIF", "VLOOKUP", "TODAY", "CONCAT", "IFERROR", "AND", "OR", "LEFT", "LEN"];
const rank = (n: string) => {
  const i = POPULAR.indexOf(n);
  return i < 0 ? 100 : i;
};

export const fnMatches = (prefix: string) =>
  FUNCTION_NAMES.filter((n) => n.startsWith(prefix.toUpperCase()))
    .sort((a, b) => rank(a) - rank(b) || a.length - b.length || a.localeCompare(b))
    .slice(0, 8);

export function FnList(props: { at: DOMRect; items: string[]; index: number; onPick: (name: string) => void }) {
  return (
    <div className="sv-ac" style={{ left: props.at.left, top: props.at.bottom + 2 }} onMouseDown={(e) => e.preventDefault()}>
      {props.items.map((n, i) => (
        <button key={n} className={i === props.index ? "on" : ""} onClick={() => props.onPick(n)}>
          <b>{n}</b>
          <span>{FN_ARGS[n] !== undefined ? `(${FN_ARGS[n]})` : "(…)"}</span>
        </button>
      ))}
      <p>Tab to insert</p>
    </div>
  );
}

export const FN_ARGS: Record<string, string> = {
  SUM: "value, …",
  AVERAGE: "value, …",
  AVG: "value, …",
  MIN: "value, …",
  MAX: "value, …",
  COUNT: "value, …",
  COUNTA: "value, …",
  COUNTBLANK: "range",
  COUNTIF: "range, condition",
  SUMIF: "range, condition, [sum-range]",
  AVERAGEIF: "range, condition, [average-range]",
  PRODUCT: "value, …",
  MEDIAN: "value, …",
  IF: "condition, if-true, [if-false]",
  IFERROR: "value, if-error",
  AND: "condition, …",
  OR: "condition, …",
  NOT: "condition",
  ISBLANK: "value",
  ISNUMBER: "value",
  ISTEXT: "value",
  ISERROR: "value",
  ROUND: "number, [digits]",
  ROUNDUP: "number, [digits]",
  ROUNDDOWN: "number, [digits]",
  INT: "number",
  ABS: "number",
  SIGN: "number",
  SQRT: "number",
  POWER: "number, power",
  EXP: "number",
  LN: "number",
  LOG10: "number",
  PI: "",
  MOD: "number, divisor",
  CEILING: "number, [step]",
  FLOOR: "number, [step]",
  CONCAT: "text, …",
  CONCATENATE: "text, …",
  LEN: "text",
  UPPER: "text",
  LOWER: "text",
  PROPER: "text",
  TRIM: "text",
  LEFT: "text, [count]",
  RIGHT: "text, [count]",
  MID: "text, start, count",
  FIND: "find, text, [start]",
  SEARCH: "find, text, [start]",
  SUBSTITUTE: "text, find, replace",
  REPT: "text, times",
  VALUE: "text",
  TODAY: "",
  NOW: "",
  DATE: "year, month, day",
  YEAR: "date",
  MONTH: "date",
  DAY: "date",
  WEEKDAY: "date",
  DAYS: "end-date, start-date",
  EDATE: "date, months",
  VLOOKUP: "search-for, range, column, [approximate]",
  INDEX: "range, row, [column]",
  MATCH: "search-for, range, [match-type]",
  IFNA: "value, if-na",
  SUMIFS: "sum-range, range, condition, …",
  AVERAGEIFS: "average-range, range, condition, …",
  MAXIFS: "max-range, range, condition, …",
  MINIFS: "min-range, range, condition, …",
  COUNTIFS: "range, condition, …",
  XLOOKUP: "search-for, search-range, result-range, [if-not-found]",
  HLOOKUP: "search-for, range, row, [approximate]",
  IFS: "condition, value, …",
  SWITCH: "value, case, result, …, [default]",
  CHOOSE: "index, value, …",
  TEXTJOIN: "separator, skip-empty, text, …",
  TEXT: "value, format",
  LARGE: "range, k",
  SMALL: "range, k",
  RANK: "value, range, [ascending]",
  STDEV: "value, …",
  STDEVP: "value, …",
  VAR: "value, …",
  VARP: "value, …",
  MODE: "value, …",
  SUMPRODUCT: "range, …",
  RAND: "",
  RANDBETWEEN: "low, high",
  TRUNC: "number, [digits]",
  LOG: "number, [base]",
  ISODD: "number",
  ISEVEN: "number",
  ISNA: "value",
  NA: "",
  HOUR: "time",
  MINUTE: "time",
  SECOND: "time",
  TIME: "hour, minute, second",
  EOMONTH: "date, months",
  NETWORKDAYS: "start-date, end-date",
  EXACT: "text, text",
  CHAR: "number",
  UNICHAR: "number",
  CODE: "text",
};
