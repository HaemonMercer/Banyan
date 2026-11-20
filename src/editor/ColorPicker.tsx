import { useEffect, useRef, useState } from "react";
import { COLOR_LABELS, COLORS, inkCss, type Ink } from "./inline";

/**
 * 自訂顏色（所有色盤下方共用）：最近用過的自訂顏色、色彩方塊＋色相條、十六進位輸入。
 *
 * 顏色一律存成小寫的 `#rrggbb`。拖曳色彩方塊與色相條用指標事件並 preventDefault，
 * 不會搶走編輯器的焦點；十六進位輸入框會拿到焦點，所以聚焦時記住原本的選取範圍，
 * 套用前放回去（編輯器的顏色指令是照 DOM 的選取範圍做的）。
 */

export type Hex = `#${string}`;
export const isHex = (v: unknown): v is Hex => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

/** 使用者打的色碼：#abc、abc、#AABBCC 都可以；不認得是 null */
export function parseHex(text: string): Hex | null {
  let t = text.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(t)) t = [...t].map((c) => c + c).join("");
  return /^[0-9a-f]{6}$/.test(t) ? (`#${t}` as Hex) : null;
}

/** HSV（h 0–360、s、v 0–1）→ #rrggbb */
export function hsvToHex(h: number, s: number, v: number): Hex {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const to = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${to(f(5))}${to(f(3))}${to(f(1))}` as Hex;
}

/** #rrggbb → HSV */
export function hexToHsv(hex: Hex): { h: number; s: number; v: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

// ─── 最近用過的自訂顏色（所有色盤共用，存在 localStorage） ───

const RECENT_KEY = "banyan.customColors";
const RECENT_MAX = 8;
const listeners = new Set<() => void>();

export function recentColors(): Hex[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter(isHex).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** 最近用過的清單：新的放最前面，不重複 */
export const withRecent = (list: Hex[], c: Hex): Hex[] => [c, ...list.filter((x) => x !== c)].slice(0, RECENT_MAX);

export function rememberColor(c: Hex) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(withRecent(recentColors(), c.toLowerCase() as Hex)));
  } catch {
    // 存不了就算了
  }
  listeners.forEach((f) => f());
}

function useRecent(): Hex[] {
  const [list, setList] = useState(recentColors);
  useEffect(() => {
    const f = () => setList(recentColors());
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  }, []);
  return list;
}

/** 按下時不搶焦點（編輯器、試算表的輸入框都要留著焦點） */
const keep = (e: React.MouseEvent | React.PointerEvent) => e.preventDefault();

/**
 * 色盤下方的「Custom」：value 是目前的顏色（不是自訂的傳 null），onPick 套用。
 */
export function CustomColor(props: { value: string | null | undefined; onPick: (c: Hex) => void }) {
  const recent = useRecent();
  const cur = isHex(props.value) ? (props.value.toLowerCase() as Hex) : null;
  const [open, setOpen] = useState(false);
  const pick = (c: Hex) => {
    rememberColor(c);
    props.onPick(c);
  };
  const dropper = typeof window !== "undefined" && "EyeDropper" in window;
  /** 吸管（Chromium／WebView2 的 EyeDropper）：從畫面上任何地方取色 */
  const sample = async () => {
    try {
      const Ctor = (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
      const r = await new Ctor().open();
      const c = parseHex(r.sRGBHex);
      if (c) pick(c);
    } catch {
      // 按 Esc 取消
    }
  };
  return (
    <div className="custom-color editor-ui" onMouseDown={keep}>
      <div className="cc-head">
        <span className="cc-title">Custom</span>
        <div className="cc-recent">
          {recent.map((c) => (
            <button key={c} className={`cc-swatch${cur === c ? " on" : ""}`} style={{ background: c }} title={`${c} (recent)`} aria-label={`Custom color ${c}`} onClick={() => pick(c)} />
          ))}
          <button className={`cc-add${open ? " on" : ""}`} title="Choose a custom color" aria-label="Choose a custom color" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            +
          </button>
          {dropper && (
            <button className="cc-add cc-dropper" title="Pick a color from the screen" aria-label="Pick a color from the screen" onClick={sample}>
              <DropperIcon />
            </button>
          )}
        </div>
      </div>
      {open && <Picker initial={cur ?? recent[0] ?? "#2f7fd8"} onApply={pick} />}
    </div>
  );
}

function Picker(props: { initial: Hex; onApply: (c: Hex) => void }) {
  const [hsv, setHsv] = useState(() => hexToHsv(props.initial));
  const hex = hsvToHex(hsv.h, hsv.s, hsv.v);
  const [text, setText] = useState<string | null>(null);
  const saved = useRef<{ range: Range; host: HTMLElement } | null>(null);

  /** 拖曳：按下的位置馬上算一次，之後跟著指標移動 */
  const drag = (e: React.PointerEvent<HTMLElement>, at: (x: number, y: number) => void) => {
    e.preventDefault();
    const box = e.currentTarget.getBoundingClientRect();
    const run = (ev: { clientX: number; clientY: number }) =>
      at(Math.max(0, Math.min(1, (ev.clientX - box.left) / box.width)), Math.max(0, Math.min(1, (ev.clientY - box.top) / box.height)));
    run(e);
    setText(null);
    const move = (ev: PointerEvent) => run(ev);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** 輸入框拿走焦點前的選取範圍（在可編輯的元素裡才記） */
  const remember = () => {
    const sel = document.getSelection();
    if (!sel?.rangeCount) return;
    const range = sel.getRangeAt(0);
    const host = (range.startContainer.nodeType === Node.ELEMENT_NODE ? (range.startContainer as Element) : range.startContainer.parentElement)?.closest<HTMLElement>("[contenteditable='true'], [contenteditable='']");
    saved.current = host ? { range: range.cloneRange(), host } : null;
  };
  const restore = () => {
    const s = saved.current;
    saved.current = null;
    if (!s || !s.host.isConnected) return;
    s.host.focus({ preventScroll: true });
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(s.range);
  };

  const typed = text === null ? hex : parseHex(text);
  const apply = () => {
    if (!typed) return;
    restore();
    props.onApply(typed);
  };

  return (
    <div className="cc-picker">
      <div
        className="cc-sv"
        style={{ background: `hsl(${hsv.h} 100% 50%)` }}
        onPointerDown={(e) => drag(e, (x, y) => setHsv((p) => ({ ...p, s: x, v: 1 - y })))}
      >
        <div className="cc-sv-white" />
        <div className="cc-sv-black" />
        <span className="cc-knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
      </div>
      <div className="cc-hue" onPointerDown={(e) => drag(e, (x) => setHsv((p) => ({ ...p, h: Math.min(359.9, x * 360) })))}>
        <span className="cc-knob" style={{ left: `${(hsv.h / 360) * 100}%`, top: "50%", background: `hsl(${hsv.h} 100% 50%)` }} />
      </div>
      <div className="cc-row">
        <span className="cc-preview" style={{ background: typed ?? "transparent" }} />
        <input
          className={`cc-hex${typed ? "" : " bad"}`}
          data-no-predict
          spellCheck={false}
          aria-label="Hex color"
          value={text ?? hex}
          onMouseDown={(e) => e.stopPropagation()}
          onFocus={remember}
          onChange={(e) => {
            setText(e.target.value);
            const h = parseHex(e.target.value);
            if (h) setHsv(hexToHsv(h));
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              apply();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setText(null);
              restore();
            }
          }}
        />
        <button className="cc-apply" disabled={!typed} onClick={apply}>
          Apply
        </button>
      </div>
    </div>
  );
}

function DropperIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.5 2.5l3 3-1.5 1.5-3-3z" />
      <path d="M9 4l3 3-6.5 6.5H2.5v-3z" />
    </svg>
  );
}

// ─── 顏色選單（參考 Google 文件、Word：預設／主題色／標準色／自訂） ───

/** 標準色（十欄：灰階、鮮豔、淺、深；固定的色碼，不跟著深色模式） */
export const STANDARD_COLORS: Hex[] = [
  "#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff",
  "#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff",
  "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#c9daf8", "#cfe2f3", "#d9d2e9", "#ead1dc", "#e6b8af",
  "#cc0000", "#e69138", "#f1c232", "#6aa84f", "#45818e", "#3c78d8", "#3d85c6", "#674ea7", "#a64d79", "#a61c00",
] as Hex[];

const STANDARD_NAMES = ["black", "dark gray 4", "dark gray 3", "dark gray 2", "dark gray 1", "gray", "light gray 1", "light gray 2", "light gray 3", "white"];

export type ColorKind = "color" | "highlight" | "bg";

/**
 * 顏色選單：最上面「預設」（文字是 Automatic、螢光與背景是 None），主題色（色盤名稱，跟著淺色／深色），
 * 標準色（色碼），最下面自訂顏色。選了就呼叫 onPick（null 是預設）；目前的顏色打勾。
 */
export function ColorMenu(props: { kind: ColorKind; value: Ink | null; onPick: (c: Ink | null) => void; /** 「預設」那一列的文字（例如 No fill） */ noneLabel?: string }) {
  const v = props.value ? (props.value.startsWith("#") ? (props.value.toLowerCase() as Ink) : props.value) : null;
  const pre = props.kind === "color" ? "tc" : props.kind === "highlight" ? "hl" : "bg";
  const noneLabel = props.noneLabel ?? (props.kind === "color" ? "Automatic" : props.kind === "highlight" ? "No highlight" : "No background");
  const kindName = props.kind === "color" ? "text" : props.kind === "highlight" ? "highlight" : "background";
  return (
    <div className="color-pick editor-ui" onMouseDown={keep}>
      <button className={`cp-none${v === null ? " on" : ""}`} onClick={() => props.onPick(null)}>
        <span className={`cp-none-chip${props.kind === "color" && !props.noneLabel ? " color" : ""}`}>{props.kind === "color" && !props.noneLabel ? "A" : ""}</span>
        <span className="cp-none-label">{noneLabel}</span>
        {v === null && <span className="cp-check">✓</span>}
      </button>
      <div className="cp-label">Theme</div>
      <div className="cp-grid cp-theme" role="group" aria-label="Theme colors">
        {COLORS.map((c) => (
          <button
            key={c}
            className={`cp-swatch${v === c ? " on" : ""}`}
            style={{ background: inkCss(pre, c) }}
            title={`${COLOR_LABELS[c]} ${kindName} — follows light and dark mode`}
            aria-label={`${COLOR_LABELS[c]} ${kindName}`}
            aria-pressed={v === c}
            onClick={() => props.onPick(c)}
          />
        ))}
      </div>
      <div className="cp-label">Standard</div>
      <div className="cp-grid" role="group" aria-label="Standard colors">
        {STANDARD_COLORS.map((c, i) => (
          <button
            key={c}
            className={`cp-swatch${v === c ? " on" : ""}${c === "#ffffff" ? " light" : ""}`}
            style={{ background: c }}
            title={i < 10 ? `${STANDARD_NAMES[i]} (${c})` : c}
            aria-label={c}
            aria-pressed={v === c}
            onClick={() => props.onPick(c)}
          />
        ))}
      </div>
      <CustomColor value={v && !STANDARD_COLORS.includes(v as Hex) ? v : null} onPick={props.onPick} />
    </div>
  );
}
