/**
 * 字預測：打字時游標下方的預測列（`PredictBar.tsx`）要顯示什麼。
 *
 * - 英文：游標前面正在打的單字（一個字母以上）→ 以它開頭的常用字（`predict/english.txt`）
 *   與使用者自己寫過的字（`setPredictCorpus`，App 傳日記與頁面）。
 * - 倉頡／速成：配合系統輸入法。組字中的字根（`日月`，或英文字母 `ab`）換成碼，
 *   列出碼以它開頭的字（倉頡：完整的碼；速成：首碼＋尾碼），還沒打完碼就能預測。
 *   碼表是 Rime 倉頡五代、字頻與聯想詞來自 rime-essay（`predict/`，`scripts/build-predict.mjs` 產生）。
 * - 英文下一個字：打完一個字、空一格後，列出常接在它後面的字（`predict/english-next.txt` 與使用者寫過的接法）。
 * - 聯想：選好字後，列出以游標前一兩個字開頭的詞，顯示接下來的字。
 *
 * 除了 `loadPredictData` 與設定，都是純函式。
 */

export type ChineseInput = "cangjie" | "quick" | "off";

export interface PredictPrefs {
  english: boolean;
  chinese: ChineseInput;
}

export const DEFAULT_PREDICT: PredictPrefs = { english: true, chinese: "cangjie" };

const KEY = "banyan.predict";

export function predictPrefs(): PredictPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<PredictPrefs>;
    return {
      english: typeof saved.english === "boolean" ? saved.english : DEFAULT_PREDICT.english,
      chinese: saved.chinese === "cangjie" || saved.chinese === "quick" || saved.chinese === "off" ? saved.chinese : DEFAULT_PREDICT.chinese,
    };
  } catch {
    return { ...DEFAULT_PREDICT };
  }
}

export function setPredictPrefs(patch: Partial<PredictPrefs>): PredictPrefs {
  const next = { ...predictPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 存不了就只在這次有效 */
  }
  emitInput();
  return next;
}

// ---- 輸入法狀態改變（右下角的輸入法標籤用） ----

const inputListeners = new Set<() => void>();
let inputVersion = 0;
const emitInput = () => {
  inputVersion++;
  inputListeners.forEach((l) => l());
};

/** 中／英或中文輸入法（倉頡、速成、Off）改變時通知；回傳取消函式（給 useSyncExternalStore） */
export function subscribeInput(l: () => void): () => void {
  inputListeners.add(l);
  return () => inputListeners.delete(l);
}

/** 每次改變就變的數字（給 useSyncExternalStore 的 snapshot） */
export const inputSnapshot = () => inputVersion;

// ---- Banyan 自己的倉頡／速成輸入（不用 Windows 的中文輸入法，用英文鍵盤打字母碼） ----

const IME_KEY = "banyan.imeChinese";
let imeChinese: boolean | null = null;

/** 現在是中文輸入（Shift 切換）；設定的中文輸入是 Off 時一律不是 */
export function imeOn(): boolean {
  if (predictPrefs().chinese === "off") return false;
  if (imeChinese === null) {
    try {
      imeChinese = localStorage.getItem(IME_KEY) !== "en";
    } catch {
      imeChinese = true;
    }
  }
  return imeChinese;
}

export function setImeOn(on: boolean) {
  imeChinese = on;
  imeTempEnglish = false;
  try {
    localStorage.setItem(IME_KEY, on ? "zh" : "en");
  } catch {
    /* 存不了就只在這次有效 */
  }
  emitInput();
}

/** 換倉頡／速成的次數（PredictBar 看到它變了就在游標下方閃一下） */
let schemeSwitched = 0;
export const schemeSwitches = () => schemeSwitched;

/** 倉頡、速成互換（Alt＋`、右下角標籤），同時切到中文；設定是 Off 時從倉頡開始 */
export function switchInputScheme() {
  const cur = predictPrefs().chinese;
  schemeSwitched++;
  setImeOn(true);
  setPredictPrefs({ chinese: cur === "cangjie" ? "quick" : "cangjie" });
}

// 中文模式下打了大寫字母：暫時打英文，打完這個字（空白、標點、Enter…）再回到中文
let imeTempEnglish = false;

/** 中文模式裡暫時打英文中 */
export const imeTemp = () => imeTempEnglish && imeOn();

export function setImeTemp(on: boolean) {
  if (imeTempEnglish === on) return;
  imeTempEnglish = on;
  emitInput();
}

/** 碼的最長長度：倉頡 5 碼、速成 2 碼 */
export const maxCode = (mode: "cangjie" | "quick") => (mode === "quick" ? 2 : 5);

/** 候選字分頁：每頁 9 個（數字鍵 1～9） */
export const PAGE_SIZE = 9;
export const pageCount = (n: number) => Math.max(1, Math.ceil(n / PAGE_SIZE));
export const pageItems = <T>(items: T[], page: number) => items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

/** 倉頡字母 a～y 的字根（x 是「難」） */
export const RADICALS = "日月金木水火土竹戈十大中一弓人心手口尸廿山女田難卜";

/**
 * 組字中的文字 → 倉頡碼（小寫字母）。字根、半形與全形英文字母都可以；
 * 有別的字（輸入法已經換成漢字、拼音等）回傳 null。
 */
export function compositionCode(text: string): string | null {
  let code = "";
  for (const ch of text.replace(/[\s']/g, "")) {
    const r = RADICALS.indexOf(ch);
    if (r >= 0) code += String.fromCharCode(97 + r);
    else if (/^[a-yA-Y]$/.test(ch)) code += ch.toLowerCase();
    else if (/^[ａ-ｙＡ-Ｙ]$/.test(ch)) code += String.fromCharCode((ch.charCodeAt(0) - 0xff21) % 32 + 97);
    else return null;
  }
  return code || null;
}

/** 碼 → 字根（Banyan 輸入時在預測列左邊顯示打了什麼） */
export const codeRadicals = (code: string) => [...code].map((c) => RADICALS[c.charCodeAt(0) - 97] ?? c).join("");

/** 速成碼：倉頡碼的首碼＋尾碼 */
export const quickCode = (code: string) => (code.length <= 2 ? code : code[0] + code[code.length - 1]);

export interface CharEntry {
  ch: string;
  code: string;
}

export interface PredictData {
  /** 依字頻由高到低 */
  chars: CharEntry[];
  /** 首字 → 以它開頭的詞（依詞頻由高到低） */
  phrases: Map<string, string[]>;
  /** 常用英文字（依常用程度），小寫 */
  english: string[];
  /** 內建的英文下一個字 */
  englishNext: Map<string, string[]>;
}

export function parseChars(text: string): CharEntry[] {
  const out: CharEntry[] = [];
  for (const line of text.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab > 0) out.push({ ch: line.slice(0, tab), code: line.slice(tab + 1).trim() });
  }
  return out;
}

export function parsePhrases(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const raw of text.split("\n")) {
    const w = raw.trim();
    if (!w) continue;
    const first = String.fromCodePoint(w.codePointAt(0)!);
    const list = out.get(first);
    if (list) list.push(w);
    else out.set(first, [w]);
  }
  return out;
}

export function parseWords(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.split("\n")) {
    const w = raw.trim().toLowerCase();
    if (/^[a-z]+$/.test(w)) seen.add(w);
  }
  return [...seen];
}

export interface Prediction {
  /** 選了之後插入的字 */
  text: string;
}

/** 組字中的碼 → 候選字：完整符合的在前，其次是碼以它開頭的（各自依字頻） */
export function predictChars(chars: CharEntry[], code: string, mode: "cangjie" | "quick", limit = 9): Prediction[] {
  const exact: Prediction[] = [];
  const more: Prediction[] = [];
  const seen = new Set<string>();
  for (const e of chars) {
    const c = mode === "quick" ? quickCode(e.code) : e.code;
    if (!c.startsWith(code) || seen.has(e.ch)) continue;
    const hit = { text: e.ch };
    if (c === code) {
      seen.add(e.ch);
      exact.push(hit);
      if (exact.length >= limit) break;
    } else if (more.length < limit) {
      seen.add(e.ch);
      more.push(hit);
    }
  }
  return [...exact, ...more].slice(0, limit);
}

/** 聯想：游標前的文字 → 接下來可能打的字（詞的其餘部分）；先用最後兩個字，再用最後一個字 */
export function predictNext(phrases: Map<string, string[]>, before: string, limit = 9): Prediction[] {
  const tail = [...before].slice(-2);
  const out: Prediction[] = [];
  const seen = new Set<string>();
  const add = (stem: string) => {
    if (!stem || !/^[㐀-鿿豈-﫿]+$/.test(stem)) return;
    for (const w of phrases.get(String.fromCodePoint(stem.codePointAt(0)!)) ?? []) {
      if (out.length >= limit) return;
      if (w.length <= stem.length || !w.startsWith(stem)) continue;
      const rest = w.slice(stem.length);
      if (seen.has(rest)) continue;
      seen.add(rest);
      out.push({ text: rest });
    }
  };
  if (tail.length === 2) add(tail.join(""));
  add(tail[tail.length - 1] ?? "");
  return out;
}

/** 游標前面正在打的英文單字（一個字母以上，前面不能緊接數字或撇號） */
export function wordBefore(before: string): string | null {
  const m = /(?:^|[^A-Za-z0-9'])([A-Za-z]+)$/.exec(before);
  return m ? m[1] : null;
}

/** 游標前面剛打完的英文字（後面空一格）：預測下一個字用；回傳小寫 */
export function wordAfter(before: string): string | null {
  const m = /(?:^|[^A-Za-z0-9'])([A-Za-z]+(?:'[A-Za-z]+)?) $/.exec(before);
  return m ? m[1].toLowerCase() : null;
}

/** 內建的「下一個字」：每行第一個字後面是常接在它後面的字 */
export function parseNextWords(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [w, ...next] = line.split(/\s+/);
    out.set(w.toLowerCase(), next);
  }
  return out;
}

/** 使用者文件裡相連的英文字（中間只有空白）：前一個字（小寫）→ 下一個字 → 次數 */
export function countPairs(texts: Iterable<string>): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const t of texts) {
    for (const m of t.matchAll(/([A-Za-z]+(?:'[A-Za-z]+)?)[ \t]+(?=([A-Za-z]+(?:'[A-Za-z]+)?))/g)) {
      const a = m[1].toLowerCase();
      const b = m[2] === "I" || /^I'/.test(m[2]) ? m[2] : m[2].toLowerCase();
      let next = out.get(a);
      if (!next) out.set(a, (next = new Map()));
      next.set(b, (next.get(b) ?? 0) + 1);
    }
  }
  return out;
}

/** 下一個字：使用者寫過的接法排前面（次數多的先），其次是內建的 */
export function predictAfter(
  common: Map<string, string[]>,
  mine: Map<string, Map<string, number>>,
  prev: string,
  limit = 5,
): Prediction[] {
  const score = new Map<string, number>();
  (common.get(prev) ?? []).forEach((w, i) => score.set(w, 1 / (i + 10)));
  for (const [w, n] of mine.get(prev) ?? []) score.set(w, (score.get(w) ?? 0) + n);
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([w]) => ({ text: w }));
}

/** 使用者文件裡的英文字出現次數 */
export function countWords(texts: Iterable<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of texts) {
    for (const m of t.matchAll(/[A-Za-z]{4,}/g)) {
      const w = m[0].toLowerCase();
      out.set(w, (out.get(w) ?? 0) + 1);
    }
  }
  return out;
}

/**
 * 英文補完：以 prefix 開頭、比它長的字。使用者寫過兩次以上的字排前面（次數多的先），其次是常用字。
 * 大小寫跟著打的字：開頭大寫就大寫開頭，全部大寫（兩個字母以上）就全部大寫。
 */
export function predictWords(common: string[], mine: Map<string, number>, prefix: string, limit = 5): Prediction[] {
  const p = prefix.toLowerCase();
  const score = new Map<string, number>();
  common.forEach((w, i) => {
    if (w.length > p.length && w.startsWith(p)) score.set(w, 1 / (i + 10));
  });
  for (const [w, n] of mine) {
    if (n < 2 || w.length <= p.length || !w.startsWith(p)) continue;
    score.set(w, (score.get(w) ?? 0) + n);
  }
  const cased = (w: string) =>
    prefix.length >= 2 && prefix === prefix.toUpperCase()
      ? w.toUpperCase()
      : prefix[0] === prefix[0].toUpperCase()
        ? w[0].toUpperCase() + w.slice(1)
        : w;
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([w]) => ({ text: cased(prefix + w.slice(p.length)) }));
}

// ---- 資料（第一次用到時才載入，不放進主程式） ----

let data: PredictData | null = null;
let loading: Promise<PredictData> | null = null;

export function loadPredictData(): Promise<PredictData> {
  loading ??= Promise.all([
    import("./predict/cangjie.txt?raw"),
    import("./predict/phrases.txt?raw"),
    import("./predict/english.txt?raw"),
    import("./predict/english-next.txt?raw"),
  ]).then(([c, p, e, n]) => {
    data = {
      chars: parseChars(c.default),
      phrases: parsePhrases(p.default),
      english: parseWords(e.default),
      englishNext: parseNextWords(n.default),
    };
    return data;
  });
  return loading;
}

/** 已經載入的資料；還沒載入時開始載入並回傳 null */
export function predictData(): PredictData | null {
  if (!data) void loadPredictData().catch(() => (loading = null));
  return data;
}

let corpus: string[] = [];
let corpusWords: Map<string, number> | null = null;
let corpusPairs: Map<string, Map<string, number>> | null = null;

let recount: ReturnType<typeof setTimeout> | null = null;

/**
 * App 傳使用者的文件（日記、頁面），英文補完會優先用裡面寫過的字。
 * 在日記、頁面打字時每個字都會傳一次：已經算過就先沿用舊的，停下來 3 秒後才在背景重算
 * （每打一個字就重算所有文件會讓打字變慢）。
 */
export function setPredictCorpus(texts: string[]) {
  corpus = texts;
  if (!corpusWords && !corpusPairs) return;
  if (recount) clearTimeout(recount);
  recount = setTimeout(() => {
    recount = null;
    corpusWords = null;
    corpusPairs = null;
  }, 3000);
}

export function myPairs(): Map<string, Map<string, number>> {
  corpusPairs ??= countPairs(corpus);
  return corpusPairs;
}

export function myWords(): Map<string, number> {
  corpusWords ??= countWords(corpus);
  return corpusWords;
}
