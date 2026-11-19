import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CODE_LANGUAGES, langLabel, normLang } from "./codeHighlight";

/**
 * 程式碼區塊右上角的工具：語言（點了打開語言選單）與複製。
 * 編輯器的程式碼區塊與白板的程式碼卡片共用；按下去不會開始編輯（mousedown／pointerdown 不往外傳）。
 */
export function CodeTools(props: { lang: string; code: () => string; onLang: (lang: string) => void; className?: string }) {
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);
  const stop = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <div
      className={`code-tools editor-ui${menu ? " open" : ""}${props.className ? ` ${props.className}` : ""}`}
      onMouseDown={stop}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button
        ref={btn}
        className="ct-lang"
        title="Change language"
        onClick={() => {
          if (menu) return setMenu(null);
          const r = btn.current!.getBoundingClientRect();
          setMenu({ left: r.right, top: r.bottom + 4 });
        }}
      >
        {langLabel(props.lang)} ▾
      </button>
      <button
        className="ct-copy"
        title="Copy code"
        onClick={() => {
          void copyText(props.code()).then((ok) => setCopied(ok));
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      {menu && (
        <LangMenu
          at={menu}
          lang={props.lang}
          onPick={(l) => {
            setMenu(null);
            if (l !== normLang(props.lang)) props.onLang(l);
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function LangMenu(props: { at: { left: number; top: number }; lang: string; onPick: (lang: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: props.at.left, top: props.at.top });
  const current = normLang(props.lang);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // 右邊對齊按鈕；超出視窗就往上開
    const left = Math.max(8, props.at.left - r.width);
    const top = props.at.top + r.height > window.innerHeight - 8 ? Math.max(8, props.at.top - r.height - 36) : props.at.top;
    setPos({ left, top });
    el.querySelector(".current")?.scrollIntoView({ block: "nearest" });
  }, [props.at.left, props.at.top]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) props.onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
    };
  });
  return createPortal(
    <div
      ref={ref}
      className="popover code-lang-menu editor-ui"
      style={pos}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {CODE_LANGUAGES.map((l) => (
        <button key={l.id || "plain"} className={l.id === current ? "current" : ""} onClick={() => props.onPick(l.id)}>
          <span className="label">{l.label}</span>
          {l.id === current && <span className="check">✓</span>}
        </button>
      ))}
    </div>,
    document.body,
  );
}

/** 複製文字：先用剪貼簿 API，不行（沒有權限）就用 execCommand。 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    const active = document.activeElement as HTMLElement | null;
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    active?.focus({ preventScroll: true });
    return ok;
  }
}
