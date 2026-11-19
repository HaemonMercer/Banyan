/**
 * 輔助打字（中文與英文）：打字時依正在打的這句是中文還是英文自動修正。
 *
 * - 中文標點（`punct.ts`）：中文句子裡打半形 `,` `.` `?` … 換成 `，` `。` `？` …
 * - 英文標點：英文句子裡（輸入法還在中文模式）打出的 `，` `。` `？` `（` `「` … 換回 `,` `.` `?` `(` `"` …
 * - 句首大寫：英文句子開頭（區塊開頭、`. ` `! ` `? ` 後面）的小寫字母換成大寫；單獨的 `i` 換成 `I`。
 * - 中英之間加空格（盤古之白）：中文字緊接英文字母或數字（或反過來）時自動空一格。預設關。
 *
 * 純函式；編輯器（`RichBlock.tsx`）在 beforeinput（一般打字）與 compositionend（輸入法選好字）時呼叫，
 * 換掉後立刻按 Backspace 會還原成原本打的字。
 */
import { cjkPunct, isCjk, PUNCT_KEYS } from "./punct";

export interface TypingPrefs {
  /** 中文句子裡的半形標點換成中文標點 */
  cjkPunct: boolean;
  /** 英文句子裡的中文標點換成半形 */
  enPunct: boolean;
  /** 英文句首大寫、單獨的 i 換成 I */
  capitalize: boolean;
  /** 中英之間加空格 */
  spacing: boolean;
}

export const DEFAULT_TYPING: TypingPrefs = { cjkPunct: true, enPunct: true, capitalize: true, spacing: false };

const KEY = "banyan.typing";
/** 第一版只有中文標點，關掉時存 `off` */
const OLD_KEY = "banyan.cjkPunct";

export function typingPrefs(): TypingPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<TypingPrefs>) : {};
    const old = localStorage.getItem(OLD_KEY) === "off" ? { cjkPunct: false } : {};
    const out = { ...DEFAULT_TYPING, ...old };
    for (const k of Object.keys(DEFAULT_TYPING) as (keyof TypingPrefs)[]) if (typeof saved[k] === "boolean") out[k] = saved[k]!;
    return out;
  } catch {
    return { ...DEFAULT_TYPING };
  }
}

export function setTypingPref(key: keyof TypingPrefs, on: boolean): TypingPrefs {
  const next = { ...typingPrefs(), [key]: on };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
    localStorage.removeItem(OLD_KEY);
  } catch {
    /* 存不了就只在這次有效 */
  }
  return next;
}

/** 中日韓的「字」（漢字、注音、假名、韓文），不含標點 */
export const isCjkLetter = (ch: string | undefined) =>
  !!ch && /[぀-ヿ㄀-ㄯㆠ-ㆿ㐀-䶿一-鿿가-힯豈-﫿]/.test(ch);
const isLatin = (ch: string | undefined) => !!ch && /[A-Za-z]/.test(ch);
const isAlnum = (ch: string | undefined) => !!ch && /[A-Za-z0-9]/.test(ch);

/**
 * 游標前面正在打的這句是不是英文：往回找到這句的開頭（換行、中文句尾、後面空一格的 `.` `!` `?`），
 * 中間有英文字母、沒有中日韓的字。
 */
export function inEnglish(before: string): boolean {
  let latin = false;
  for (let i = before.length - 1, n = 0; i >= 0 && n < 300; i--, n++) {
    const c = before[i];
    if (c === "\n" || /[。！？]/.test(c)) break;
    if (/[.!?]/.test(c) && /\s/.test(before[i + 1] ?? "")) break;
    if (isCjkLetter(c)) return false;
    if (isLatin(c)) latin = true;
  }
  return latin;
}

/** 中文標點 → 英文標點（英文句子裡） */
const HALF: Record<string, string> = {
  "，": ",",
  "、": ",",
  "。": ".",
  "？": "?",
  "！": "!",
  "：": ":",
  "；": ";",
  "（": "(",
  "）": ")",
  "「": '"',
  "」": '"',
  "『": "'",
  "』": "'",
  "“": '"',
  "”": '"',
  "‘": "'",
  "’": "'",
};

/** 句點後面不是句尾的縮寫（`e.g. `、`Mr. `） */
const ABBR = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|cf|mr|mrs|ms|dr|st|no|fig|vol|p|pp|a\.m|p\.m|jr|sr|inc|ltd|co)\.\s+$/i;

/** 游標在英文句子的開頭：區塊開頭，或英文句尾 `. ` `! ` `? ` 後面 */
export function sentenceStart(before: string): boolean {
  if (before === "") return true;
  if (!/[.!?]["')\]]?\s+$/.test(before) || ABBR.test(before)) return false;
  // 句尾前面要是英文（`3. ` 這種編號、中文後面的半形句點不算）
  const end = before.replace(/["')\]]?\s+$/, "").slice(0, -1);
  return isLatin(end.slice(-1)) && inEnglish(end);
}

type Change = { text: string; remove: number };

/** 一個字：依設定換成什麼（不換回傳 null） */
function assistChar(ctx: string, c: string, p: TypingPrefs): Change | null {
  let r: Change | null = null;
  if (p.cjkPunct && PUNCT_KEYS.has(c)) r = cjkPunct(ctx, c);
  if (!r && p.enPunct && HALF[c] && inEnglish(ctx) && !isCjk(ctx.slice(-1))) r = { text: HALF[c], remove: 0 };
  if (!r && p.capitalize && /[a-z]/.test(c) && sentenceStart(ctx)) {
    // 區塊開頭只有一個字母還不知道是不是英文，先換（Backspace 可以還原）
    r = { text: c.toUpperCase(), remove: 0 };
  }
  if (!r && p.capitalize && /[\s,.!?;:']/.test(c) && /(^|[\s"(])i$/.test(ctx) && !isCjk(ctx.slice(-2, -1))) {
    // 單獨的 i（`i am`、`i'm`）
    r = { text: "I" + c, remove: 1 };
  }
  // 中英之間加空格：看換完的字和它前面的字
  if (p.spacing) {
    const ch = r ? r.text.slice(-1) : c;
    const base = r ? ctx.slice(0, ctx.length - r.remove) + r.text.slice(0, -1) : ctx;
    const prev = base.slice(-1);
    if ((isCjkLetter(prev) && isAlnum(ch)) || (isAlnum(prev) && isCjkLetter(ch))) {
      r = r ? { text: r.text.slice(0, -1) + " " + ch, remove: r.remove } : { text: " " + c, remove: 0 };
    }
  }
  return r;
}

/**
 * 在 before（游標前面的文字）後面輸入 data（一個字或輸入法一次送出的一串）：逐字依設定換。
 * 有換才回傳；`remove` 是先刪掉游標前幾個字。
 */
export function assistText(before: string, data: string, p: TypingPrefs): Change | null {
  let out = "";
  let remove = 0;
  let changed = false;
  for (const c of data) {
    const r = assistChar(before.slice(0, before.length - remove) + out, c, p);
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
