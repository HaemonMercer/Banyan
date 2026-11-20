import { createContext } from "react";
import type { SlideAnim } from "./slideAnim";
import { cleanMasters, masterOf, type SlideMaster } from "./slideMasters";

/**
 * 簡報整份的設定（像 Keynote／PowerPoint／Google 簡報的主題、頁碼、頁尾）：存在 `DockDoc.deck`，沒改過就不寫。
 * 每張投影片自己的背景色在 `SlideAnim.bg`。主題的顏色是固定的色碼（畫面、放映、匯出 .pptx 都一樣，不跟淺色／深色模式）。
 */

export type DeckTheme = "white" | "paper" | "slate" | "ocean" | "forest" | "sunset" | "black";

export interface ThemeColors {
  bg: string;
  text: string;
  soft: string;
  muted: string;
  faint: string;
  accent: string;
  code: string;
}

export const DECK_THEMES: { id: DeckTheme; label: string; c: ThemeColors }[] = [
  { id: "white", label: "White", c: { bg: "#ffffff", text: "#2f2e2b", soft: "#4f4d48", muted: "#8f8c85", faint: "#e6e4df", accent: "#2f7fd8", code: "#f6f5f3" } },
  { id: "paper", label: "Paper", c: { bg: "#f7f2e8", text: "#3b3226", soft: "#5c4f3d", muted: "#97886f", faint: "#e4d9c3", accent: "#b5562f", code: "#efe6d5" } },
  { id: "slate", label: "Slate", c: { bg: "#eef1f5", text: "#1f2a37", soft: "#3e4c5c", muted: "#7b8796", faint: "#d5dbe3", accent: "#4a63d8", code: "#e2e7ee" } },
  { id: "ocean", label: "Ocean", c: { bg: "#0f3a5f", text: "#f2f7fb", soft: "#c9dceb", muted: "#8fb1cc", faint: "#24557c", accent: "#5ec4f2", code: "#164a74" } },
  { id: "forest", label: "Forest", c: { bg: "#1f3d2c", text: "#f1f6ef", soft: "#cfe0c9", muted: "#93b08b", faint: "#2f5641", accent: "#9bd27a", code: "#28503a" } },
  { id: "sunset", label: "Sunset", c: { bg: "#fff1e8", text: "#4a2318", soft: "#6e3a2a", muted: "#b0705c", faint: "#f6d6c4", accent: "#e0582f", code: "#fbe3d4" } },
  { id: "black", label: "Black", c: { bg: "#141414", text: "#f5f5f5", soft: "#d4d4d4", muted: "#9a9a9a", faint: "#2e2e2e", accent: "#f0b429", code: "#222222" } },
];

/** 每張投影片可以換的背景色（null＝跟著主題） */
export const SLIDE_BGS: { id: string; label: string; dark: boolean }[] = [
  { id: "#ffffff", label: "White", dark: false },
  { id: "#f4f4f2", label: "Light gray", dark: false },
  { id: "#fbf3db", label: "Cream", dark: false },
  { id: "#ddebf1", label: "Light blue", dark: false },
  { id: "#ddedea", label: "Mint", dark: false },
  { id: "#fbe4e4", label: "Rose", dark: false },
  { id: "#1f2a37", label: "Navy", dark: true },
  { id: "#141414", label: "Black", dark: true },
];

export interface DeckSetup {
  theme?: DeckTheme;
  /** 投影片右下角的頁碼 */
  numbers?: boolean;
  /** 投影片左下角的頁尾文字 */
  footer?: string;
  /** 投影片母片（`slideMasters.ts`；第一個是預設） */
  masters?: SlideMaster[];
}

export const DeckContext = createContext<DeckSetup>({});

export const themeOf = (d: DeckSetup | undefined) => DECK_THEMES.find((t) => t.id === d?.theme) ?? DECK_THEMES[0];

export function cleanDeck(raw: unknown): DeckSetup {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: DeckSetup = {};
  if (DECK_THEMES.some((t) => t.id === o.theme) && o.theme !== "white") out.theme = o.theme as DeckTheme;
  if (o.numbers === true) out.numbers = true;
  if (typeof o.footer === "string" && o.footer.trim()) out.footer = o.footer.slice(0, 200);
  const masters = cleanMasters(o.masters);
  if (masters.length) out.masters = masters;
  return out;
}

export const isDefaultDeck = (d: DeckSetup | undefined) => !d || Object.keys(cleanDeck(d)).length === 0;

/** 投影片背景色是深色：文字換成淺色 */
const darkBg = (hex: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum < 110;
};

/**
 * 這張投影片的顏色：主題，背景另外選過（投影片自己的，沒有就是母片的）就照背景決定深淺。
 * master 沒給就照投影片的設定找；null 是不看母片（編輯母片時，背景已經在 meta 裡）。
 */
export function slideColors(deck: DeckSetup | undefined, meta: SlideAnim | undefined, master: SlideMaster | null = masterOf(deck?.masters, meta) ?? null): ThemeColors {
  const base = themeOf(deck).c;
  const bg = meta?.bg ?? master?.bg;
  if (!bg) return base;
  if (darkBg(bg) === darkBg(base.bg)) return { ...base, bg };
  const flip = darkBg(bg) ? DECK_THEMES.find((t) => t.id === "black")!.c : DECK_THEMES[0].c;
  return { ...flip, accent: base.accent, bg };
}

/** 投影片元素的 style：覆蓋編輯器的顏色變數（文字、背景、程式碼底色） */
export function slideStyle(deck: DeckSetup | undefined, meta: SlideAnim | undefined, master?: SlideMaster | null): React.CSSProperties {
  const c = master === undefined ? slideColors(deck, meta) : slideColors(deck, meta, master);
  return {
    background: c.bg,
    ["--ed-text" as string]: c.text,
    ["--ed-text-soft" as string]: c.soft,
    ["--ed-muted" as string]: c.muted,
    ["--ed-faint" as string]: c.faint,
    ["--ed-bg" as string]: c.bg,
    ["--ed-code-bg" as string]: c.code,
    ["--ed-accent" as string]: c.accent,
    ["--sl-accent" as string]: c.accent,
  };
}
