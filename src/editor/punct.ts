/**
 * 輔助打字：正在打中文時，半形標點自動換成中文（全形）標點。
 *
 * 輸入法在英文模式（或設定成半形標點）時，打 `,` `.` `?` 會是半形；
 * 正在打的這句是中文（前一個字是中文，或中文句子裡夾的英文後面，見 `inChinese`）就換成 `，` `。` `？`。
 * 引號、括號依前面有沒有沒關上的開頭決定開或關。
 * 純函式；編輯器（`RichBlock.tsx`）在 beforeinput 時呼叫，換掉後立刻按 Backspace 會還原成原本的半形。設定與其他規則在 `typing.ts`。
 */

/** 中文字或中文標點（漢字、注音、假名、CJK 標點、全形字元） */
export function isCjk(ch: string | undefined): boolean {
  if (!ch) return false;
  return /[　-〿぀-ヿ㄀-ㄯㆠ-ㆿ㐀-䶿一-鿿豈-﫿＀-￯]/.test(ch);
}

/** 中文的句尾：後面接的是新的一句 */
const CJK_END = /[。！？…]/;

/**
 * 游標前面正在打的這句是不是中文：
 * - 前一個字是中文就是；
 * - 中文夾英文（`我在用 Banyan`）：往回跳過英文、數字、空白與符號，先碰到中文字或中文的句中標點就是，
 *   碰到半形的 `.` `!` `?`（英文的句尾）、中文句尾（`。` 後面是另一句）或開頭就不是。
 */
export function inChinese(before: string): boolean {
  if (isCjk(before.slice(-1))) return true;
  for (let i = before.length - 1, n = 0; i >= 0 && n < 300; i--, n++) {
    const c = before[i];
    if (c === "\n" || CJK_END.test(c)) return false;
    // 英文的句尾：後面空一格（`v1.2`、`e.g` 中間的點不算）
    if (/[.!?]/.test(c) && /\s/.test(before[i + 1] ?? "")) return false;
    if (isCjk(c)) return true;
  }
  return false;
}

/** 游標前面這個「字」像網址、路徑、Email（`https:`、`a/b`、`me@x`）：不換 */
function inTechWord(before: string): boolean {
  const word = /\S*$/.exec(before)?.[0] ?? "";
  return /[/@\\]|:\/|^(https?|ftp|mailto|file|www)$/i.test(word);
}

/** 直接對應的標點（正在打的這句要是中文） */
const SIMPLE: Record<string, string> = {
  ",": "，",
  ".": "。",
  "?": "？",
  "!": "！",
  ":": "：",
  ";": "；",
};

/** 成對的：半形鍵 → [開, 關]；同一個鍵開關共用的是引號 */
const PAIRS: { open: string; close: string; keys: [string, string] }[] = [
  { open: "（", close: "）", keys: ["(", ")"] },
  { open: "「", close: "」", keys: ['"', '"'] },
  { open: "『", close: "』", keys: ["'", "'"] },
];

/** before 裡最後一個 open 後面沒有 close：還開著 */
function unclosed(before: string, open: string, close: string): boolean {
  const o = before.lastIndexOf(open);
  return o >= 0 && before.indexOf(close, o) < 0;
}

/**
 * 游標在正在打的 Markdown 語法裡面：標點是語法的一部分，不換。
 * - 前一個字是 `\`（跳脫，使用者要的就是半形）；
 * - 行內程式碼裡（這一行的反引號是奇數個）；
 * - 連結、圖片的網址與標題裡（`[文字](` 後面還沒關上）；
 * - HTML 標籤或自動連結裡（`<span style="`、`<https:`，`<` 後面還沒有 `>`）。
 */
export function inMarkdownSyntax(before: string): boolean {
  if (before.endsWith("\\")) return true;
  const line = before.slice(before.lastIndexOf("\n") + 1);
  if ((line.match(/`/g)?.length ?? 0) % 2 === 1) return true;
  const link = line.lastIndexOf("](");
  if (link >= 0 && line.indexOf(")", link + 2) < 0) return true;
  const tag = line.search(/<[A-Za-z/!][^<>]*$/);
  return tag >= 0;
}

/**
 * 游標在只會打英文的 Markdown 語法裡：Banyan 的倉頡／速成在這裡打字母一律是英文（`predictor.ts`）。
 * - 行內程式碼、程式碼區塊的 ```` ``` ```` 語言（這一行的反引號是奇數個）；
 * - 連結、圖片的網址（`[文字](` 後面還沒關上）；
 * - HTML 標籤、自動連結（`<` 後面還沒有 `>`）；
 * - 任務標記 `{x}`、核取方塊 `[x]`（行首或清單標記後面剛打了 `{`／`[`）。
 * 連結文字、`[[頁面]]` 的名稱可能是中文，照常。
 */
export function markdownEnglish(before: string): boolean {
  const line = before.slice(before.lastIndexOf("\n") + 1);
  if ((line.match(/`/g)?.length ?? 0) % 2 === 1) return true;
  const link = line.lastIndexOf("](");
  if (link >= 0 && line.indexOf(")", link + 2) < 0) return true;
  if (/<$|<[A-Za-z/!][^<>]*$/.test(line)) return true;
  return /^\s*(?:(?:[-*+]|\d+[.)])\s+)?\{$/.test(line) || /^\s*(?:[-*+]|\d+[.)])\s+\[$/.test(line);
}

/** 會被轉換的鍵（`[` 只用來把 `！[` 改回圖片語法 `![`） */
export const PUNCT_KEYS = new Set([...Object.keys(SIMPLE), "(", ")", '"', "'", "["]);

/**
 * 在 before（游標前面的文字）後面打 key：要換成什麼。
 * `remove` 是先刪掉游標前幾個字（`。` 後面再打 `.` 變成 `……`）。不轉換回傳 null。
 */
export function cjkPunct(before: string, key: string): { text: string; remove: number } | null {
  const prev = before.slice(-1);
  if (inMarkdownSyntax(before)) return null;
  // 圖片 `![`：`!` 已經換成 `！`，緊接著打 `[` 就換回來
  if (key === "[") return prev === "！" ? { text: "![", remove: 1 } : null;
  // 數字後面的 . , : 是小數、千分位、時間（`3.14`、`1,000`、`14:00`）
  if (/[0-9]/.test(prev) && (key === "." || key === "," || key === ":")) return null;
  const cjk = inChinese(before) && (isCjk(prev) || !inTechWord(before));
  if (key === ".") {
    if (prev === "。") return { text: "……", remove: 1 };
    return cjk ? { text: "。", remove: 0 } : null;
  }
  if (SIMPLE[key]) return cjk ? { text: SIMPLE[key], remove: 0 } : null;
  // 開括號、引號緊接在英文字後面多半是英文本身（`it's`、`f(x)`），要在中文字或空白後面
  const openOk = isCjk(prev) || (cjk && /\s/.test(prev));
  for (const p of PAIRS) {
    if (!p.keys.includes(key)) continue;
    const isOpen = unclosed(before, p.open, p.close);
    // 關：前面有還開著的（不管前一個字是不是中文，例如「abc"）
    if (key === p.keys[1] && isOpen) return { text: p.close, remove: 0 };
    // 開：前一個字是中文，或中文句子裡的空白後面
    if (key === p.keys[0] && openOk && (p.keys[0] !== p.keys[1] || !isOpen)) return { text: p.open, remove: 0 };
    return null;
  }
  return null;
}

/**
 * 一次輸入好幾個字（輸入法一次送出「好,」、貼上以外的整串輸入）：逐字換。
 * 有換才回傳；`remove` 是先刪掉游標前幾個字。
 */
export function cjkPunctText(before: string, data: string): { text: string; remove: number } | null {
  let out = "";
  let remove = 0;
  let changed = false;
  for (const c of data) {
    const r = PUNCT_KEYS.has(c) ? cjkPunct(before.slice(0, before.length - remove) + out, c) : null;
    if (!r) {
      out += c;
      continue;
    }
    changed = true;
    const fromOut = Math.min(r.remove, out.length);
    out = out.slice(0, out.length - fromOut);
    remove += r.remove - fromOut;
    out += r.text;
  }
  return changed ? { text: out, remove } : null;
}
