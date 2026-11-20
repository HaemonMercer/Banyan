/**
 * 子彈筆記（Bullet Journal）的快速記錄符號與待辦清單。
 *
 * 子彈筆記的任務與事件是清單項目，內容開頭加上大括號標記（在 CommonMark 裡只是普通文字）：
 *
 *   - { } 任務            □  未完成（也可以寫 `{}`）
 *   - {x} 任務            ☒  完成
 *   - {<} 任務 [[2026-11-20]]   ←  已排程到那一天（任務留在原處，那天的「該做的事」與行事曆會列出它）
 *   - {-} 任務            取消（刪除線）
 *   - {o} 事件            ○  事件
 *   - 筆記                –  一般清單項目就是筆記
 *
 * 方括號 `[ ]`、`[x]`（任何清單標記）是待辦清單的核取方塊，與 GitHub、Obsidian 的寫法相同。
 * 沒有傳統子彈筆記的「已遷移」（使用者決定拿掉）：要在別天做一律排程。
 */

export type TaskState = "open" | "done" | "scheduled" | "cancelled" | "event";

export const TASK_CHAR: Record<TaskState, string> = {
  open: " ",
  done: "x",
  scheduled: "<",
  cancelled: "-",
  event: "o",
};

const STATE_OF: Record<string, TaskState> = {
  "": "open",
  " ": "open",
  x: "done",
  X: "done",
  "<": "scheduled",
  "-": "cancelled",
  o: "event",
  O: "event",
};

export const TASK_LABEL: Record<TaskState, string> = {
  open: "Task",
  done: "Done",
  scheduled: "Scheduled",
  cancelled: "Cancelled",
  event: "Event",
};

/**
 * 清單標記＋任務標記：第 1 組是清單標記與空白，第 2 組是大括號裡的字（子彈筆記），
 * 第 3 組是方括號裡的字（待辦清單）。
 */
const TASK_LINE = /^([ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]+)(?:\{([ xX<\-oO]?)\}|\[([ xX])\])(?=[ \t]|$)[ \t]?/;
/** 清單項目的第一行 */
const ITEM_LINE = /^([ \t]*(?:[-+*]|\d{1,9}[.)])(?:[ \t]+|$))/;

export interface LineTask {
  state: TaskState;
  /** 待辦清單的核取方塊（`[ ]`、`[x]`），不是子彈筆記的任務 */
  check: boolean;
  /** 清單標記（含後面的空白） */
  marker: string;
  /** 清單標記＋任務標記的長度（之後是內容） */
  prefix: number;
}

/** 這一行是不是任務／事件／待辦（清單項目的第一行）。 */
export function lineTask(line: string): LineTask | null {
  const m = TASK_LINE.exec(line);
  if (!m) return null;
  const check = m[3] !== undefined;
  const state = check ? (m[3] === " " ? "open" : "done") : STATE_OF[m[2]];
  return { state, check, marker: m[1], prefix: m[0].length };
}

/** 待辦清單（核取方塊）：`- [ ] `、`* [x] `…（方括號；子彈筆記的任務用大括號）。 */
export function isCheckLine(line: string): boolean {
  return !!lineTask(line)?.check;
}

// ─── 打字快捷 ───────────────────────────────────────────────────
//
// 段落或清單項目開頭打 `{} `、`{x} `、`{o} `…變成子彈筆記的任務；打 `[] `、`[x] ` 變成待辦。
// 中文輸入法開著時，括號鍵打出來的是全形或中文括號、空白鍵可能是全形空白，
// 所以這些也都要認得（Shift＋方括號鍵是『』，方括號鍵是「」）。

const CURLY_OPEN = "{｛『";
const CURLY_CLOSE = "}｝』";
const SQUARE_OPEN = "[［「【〔";
const SQUARE_CLOSE = "]］」】〕";
/** 括號裡的字 → 狀態（含全形與常見的替代字） */
const SHORTCUT_STATE: Record<string, TaskState> = {
  "": "open",
  " ": "open",
  "\u3000": "open",
  x: "done",
  X: "done",
  ｘ: "done",
  Ｘ: "done",
  "×": "done",
  "<": "scheduled",
  "＜": "scheduled",
  "-": "cancelled",
  "－": "cancelled",
  o: "event",
  O: "event",
  ｏ: "event",
  Ｏ: "event",
  "○": "event",
  "〇": "event",
};
const cls = (chars: string) => "[" + chars.replace(/[\]\\[]/g, "\\$&") + "]";
const SHORTCUT = new RegExp(
  `^(?:${cls(CURLY_OPEN)}(.?)${cls(CURLY_CLOSE)}|${cls(SQUARE_OPEN)}(.?)${cls(SQUARE_CLOSE)})[ \\u00a0\\u3000]`,
);

/**
 * 純文字開頭是不是任務或待辦的快捷（`{} `、`{x} `、`『』 `…是任務；`[] `、`[x] `、`「」 `…是待辦）。
 * 回傳狀態、是不是待辦、快捷的長度；不是就是 null。待辦只有未完成與完成。
 */
export function taskShortcut(plain: string): { state: TaskState; check: boolean; length: number } | null {
  const m = SHORTCUT.exec(plain);
  if (!m) return null;
  const check = m[1] === undefined;
  const state = SHORTCUT_STATE[check ? m[2] : m[1]];
  if (!state || (check && state !== "open" && state !== "done")) return null;
  return { state, check, length: m[0].length };
}

/**
 * 從所見即所得的行內 Markdown 去掉開頭的快捷（裡面的字可能被跳脫成 `\[`、`\<`、`&lt;`）。
 * 去不掉就回傳 null。
 */
export function stripTaskShortcut(content: string): string | null {
  const close = CURLY_CLOSE + SQUARE_CLOSE;
  const ch = String.raw`(?:\\?[^\\&${close.replace(/[\]\\[]/g, "\\$&")}]|&[a-z]+;|&#\d+;)`;
  const open = cls(CURLY_OPEN + SQUARE_OPEN);
  const re = new RegExp(String.raw`^\\?${open}${ch}?\\?${cls(close)}(?: |\u00a0|\u3000|&nbsp;)`);
  const m = re.exec(content);
  return m ? content.slice(m[0].length) : null;
}

/** 開頭的星號（待辦清單的快捷 `*[] `；全形＊、後面可以空一格） */
const STAR = /^[*＊][ \u00a0\u3000]?/;

/**
 * 純文字開頭是不是星號＋待辦快捷：`*[] `、`*[x] `、`＊【】 `…（`[] ` 本身就是待辦，
 * 這是給習慣先打星號的寫法）。
 */
export function todoShortcut(plain: string): { state: "open" | "done"; length: number } | null {
  const star = STAR.exec(plain);
  if (!star) return null;
  const t = taskShortcut(plain.slice(star[0].length));
  if (!t || !t.check || (t.state !== "open" && t.state !== "done")) return null;
  return { state: t.state, length: star[0].length + t.length };
}

/** 從行內 Markdown 去掉開頭的待辦快捷（星號會被跳脫成 `\*`）；去不掉就是 null。 */
export function stripTodoShortcut(content: string): string | null {
  const star = /^(?:\\?\*|＊)(?: |\u00a0|\u3000|&nbsp;)?/.exec(content);
  return star ? stripTaskShortcut(content.slice(star[0].length)) : null;
}

/** 標記的寫法：子彈筆記的任務是 `{ } `，待辦清單是 `[ ] `／`[x] `。 */
export function taskMark(state: TaskState, check = false): string {
  if (check) return state === "done" ? "[x] " : "[ ] ";
  return `{${TASK_CHAR[state]}} `;
}

/**
 * 設定清單項目第一行的狀態；state 為 null 時拿掉標記（變回筆記）。
 * 待辦改成未完成／完成時仍是待辦，改成其他狀態就變成子彈筆記的任務。
 * 不是清單項目就加上 `- `（新的標記是子彈筆記的任務，check 為 true 時是待辦）。
 */
export function setLineTask(line: string, state: TaskState | null, check = false): string {
  const t = lineTask(line);
  if (t) {
    const rest = line.slice(t.prefix);
    const box = t.check && (state === "open" || state === "done");
    return state ? t.marker + taskMark(state, box) + rest : t.marker + rest;
  }
  if (!state) return line;
  const m = ITEM_LINE.exec(line);
  if (m) {
    const marker = /[ \t]$/.test(m[1]) ? m[1] : m[1] + " ";
    return marker + taskMark(state, check) + line.slice(m[1].length);
  }
  return "- " + taskMark(state, check) + line.replace(/^[ \t]+/, "");
}

/**
 * 下一個狀態（點符號時）：任務、已排程 → 完成；完成、取消 → 回到任務（有排程日期的回到已排程）；事件不變。
 */
export function cycleState(state: TaskState, scheduled = false): TaskState {
  if (state === "event") return "event";
  if (state === "open" || state === "scheduled") return "done";
  return scheduled ? "scheduled" : "open";
}

export interface TaskItem {
  /** 行號（0 起算） */
  line: number;
  state: TaskState;
  /** 內容（行內 Markdown，不含標記與排程日期） */
  text: string;
  /** 排程到的日期（行尾的 `[[YYYY-MM-DD]]`） */
  due?: string;
}

// ─── 排程 ──────────────────────────────────────────────────────
//
// 排程不搬動任務：在原本那行標成 `[<]`，行尾加上排到的日期 `[[2026-11-20]]`。
// 那一天的日記上方「該做的事」與行事曆會列出它；它也是普通的頁面連結，
// 所以那天的反向連結也找得到。沒有「手動附加日期」的操作，日期只由排程寫入。

const DATE_SUFFIX = /[ \t]+\[\[(\d{4}-\d{2}-\d{2})\]\][ \t]*$/;

/** 任務行的排程日期（行尾的日期連結；不是任務就是 null）。 */
export function lineDate(line: string): string | null {
  if (!lineTask(line)) return null;
  return DATE_SUFFIX.exec(line)?.[1] ?? null;
}

/** 設定或拿掉行尾的日期。 */
export function setLineDate(line: string, date: string | null): string {
  const base = line.replace(DATE_SUFFIX, "").replace(/[ \t]+$/, "");
  return date ? `${base} [[${date}]]` : base;
}

/**
 * 排程到某一天：任務標成 `<`（事件還是事件），行尾寫上日期。
 * date 為 null 時取消排程：拿掉日期，已排程的回到任務。
 */
export function scheduleLine(line: string, date: string | null): string {
  const t = lineTask(line);
  if (!t) return line;
  let out = setLineDate(line, date);
  if (date && t.state !== "event") out = setLineTask(out, "scheduled");
  if (!date && t.state === "scheduled") out = setLineTask(out, "open");
  return out;
}

export function scheduleAt(source: string, line: number, date: string | null): string {
  const lines = source.split("\n");
  if (line < 0 || line >= lines.length || !lineTask(lines[line])) return source;
  lines[line] = scheduleLine(lines[line], date);
  return lines.join("\n");
}

/** 文件裡所有的任務與事件（含巢狀清單裡的）；程式碼區塊裡的不算。 */
export function collectTasks(source: string): TaskItem[] {
  const out: TaskItem[] = [];
  let fence: string | null = null;
  source.split("\n").forEach((line, i) => {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0].repeat(f[1].length);
      else if (line.trim().startsWith(fence)) fence = null;
      return;
    }
    if (fence) return;
    const t = lineTask(line);
    if (!t) return;
    const due = DATE_SUFFIX.exec(line);
    const text = (due ? line.slice(0, due.index) : line).slice(t.prefix).trim();
    out.push(due ? { line: i, state: t.state, text, due: due[1] } : { line: i, state: t.state, text });
  });
  return out;
}

/** 改某一行的任務狀態。 */
export function setTaskAt(source: string, line: number, state: TaskState | null): string {
  const lines = source.split("\n");
  if (line < 0 || line >= lines.length) return source;
  lines[line] = setLineTask(lines[line], state);
  return lines.join("\n");
}

const EMPTY = /^(?:[ \t]*|&nbsp;)$/;

/**
 * 在文件最後加上幾個清單項目（`- { } 內容`）。
 * 最後一行是同類的清單項目就直接接在後面（同一份清單），否則空一行另起。
 */
export function appendItems(source: string, items: string[]): string {
  if (!items.length) return source;
  const lines = source.split("\n");
  while (lines.length && EMPTY.test(lines[lines.length - 1])) lines.pop();
  const add = items.map((t) => (ITEM_LINE.test(t) ? t : `- ${t}`));
  if (!lines.length) return add.join("\n") + "\n";
  const last = lines[lines.length - 1];
  const tight = /^[-+*][ \t]/.test(last) && add[0].startsWith(last[0]);
  return [...lines, ...(tight ? [] : [""]), ...add].join("\n") + "\n";
}

/** 渲染後的清單項目 HTML 去掉開頭的任務標記（畫面上改用符號顯示）。 */
export function stripTaskHtml(html: string): string {
  // 渲染後 < 會變成 &lt;
  return html.replace(/^(\s*(?:<p>)?)(?:\{(?:[ xX<\-oO]|&lt;)?\}|\[[ xX]\])(?:[ \t]|(?=<\/p>|\n|$))/, "$1");
}

// ─── 排程：把任務加到另一天的日記 ───────────────────────────

/** 要求把一個清單項目加到某天日記的最後面（App 監聽這個事件）。 */
export const APPEND_EVENT = "banyan:append";

export interface AppendRequest {
  date: string;
  item: string;
}

export function requestAppend(date: string, item: string): void {
  window.dispatchEvent(new CustomEvent<AppendRequest>(APPEND_EVENT, { detail: { date, item } }));
}
