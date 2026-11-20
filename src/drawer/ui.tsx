import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { ClipIcon, CloseIcon, FolderIcon } from "../editor/icons";
import { mediaFilePath } from "../editor/media";
import { FilePreview } from "./FilePreview";

/** Drawer 文獻庫與檔案庫共用的小元件：浮動選單、改名輸入框、附件／檔案檢視。 */

/* ─── 浮動選單（沿用白板的 .popover.block-menu） ─── */

export function Menu(props: { x: number; y: number; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: props.x, top: props.y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(props.x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(props.y, window.innerHeight - r.height - 8)),
    });
  }, [props.x, props.y]);
  const { onClose } = props;
  useEffect(() => {
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);
  return (
    <div className={`popover block-menu dr-menu ${props.className ?? ""}`} ref={ref} style={{ position: "fixed", ...pos }}>
      {props.children}
    </div>
  );
}

export function MenuRow(props: { icon?: ReactNode; label: string; hint?: string; danger?: boolean; onClick: () => void }) {
  return (
    <button className={props.danger ? "danger" : undefined} onClick={props.onClick}>
      <span className="glyph">{props.icon}</span>
      <span className="label">{props.label}</span>
      {props.hint && <span className="hint">{props.hint}</span>}
    </button>
  );
}


export async function openLink(url: string) {
  if (!/^https?:\/\//i.test(url)) return;
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else window.open(url, "_blank", "noopener");
}


export function RenameInput(props: { value: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(props.value);
  const done = useRef(false);
  const finish = (x: string | null) => {
    if (done.current) return;
    done.current = true;
    props.onDone(x);
  };
  return (
    <input
      className="dr-rename"
      value={v}
      autoFocus
      onFocus={(e) => e.target.select()}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => finish(v)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") finish(v);
        if (e.key === "Escape") finish(null);
      }}
    />
  );
}


export async function reveal(src: string) {
  const p = mediaFilePath(src);
  if (!p) return;
  try {
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await revealItemInDir(p);
  } catch {
    /* 打不開檔案總管就算了 */
  }
}

/* ─── 附件檢視（內容依種類由 FilePreview 顯示） ─── */

export function AttachmentViewer(props: { att: { name: string; src: string }; onClose: () => void }) {
  const { att, onClose } = props;
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="dr-viewer">
      <div className="dr-viewer-bar">
        <ClipIcon />
        <span className="dr-viewer-name">{att.name}</span>
        {mediaFilePath(att.src) && (
          <button className="dr-btn" onClick={() => void reveal(att.src)}>
            <FolderIcon /> Show in folder
          </button>
        )}
        <button className="icon-btn" onClick={onClose} title="Close (Esc)">
          <CloseIcon />
        </button>
      </div>
      <div className="dr-viewer-body">
        <FilePreview name={att.name} src={att.src} onLink={(href) => void openLink(href)} />
      </div>
    </div>
  );
}

/* ─── 標籤 ─── */

/** 標籤編輯（條目與檔案共用）：Enter 或逗號加入、Backspace 拿掉最後一個 */
export function TagsEditor(props: { tags: string[]; all: string[]; onChange: (t: string[]) => void }) {
  const [v, setV] = useState("");
  const add = () => {
    const t = v.trim();
    if (t && !props.tags.includes(t)) props.onChange([...props.tags, t]);
    setV("");
  };
  return (
    <div className="dr-tag-edit">
      {props.tags.map((t) => (
        <span className="dr-tag on" key={t}>
          {t}
          <button title="Remove tag" onClick={() => props.onChange(props.tags.filter((x) => x !== t))}>
            <CloseIcon />
          </button>
        </span>
      ))}
      <input
        value={v}
        list="dr-tag-options"
        placeholder={props.tags.length ? "Add…" : "Add a tag…"}
        onChange={(e) => setV(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !v && props.tags.length) props.onChange(props.tags.slice(0, -1));
        }}
      />
      <datalist id="dr-tag-options">
        {props.all
          .filter((t) => !props.tags.includes(t))
          .map((t) => (
            <option key={t} value={t} />
          ))}
      </datalist>
    </div>
  );
}

/* ─── 選一筆的對話框（條目附加檔案庫的檔案、檔案附加到條目） ─── */

export interface PickOption {
  id: string;
  label: string;
  sub?: string;
  icon?: ReactNode;
}

/** 搜尋＋清單，點一下就選（對話框不關，可以連續選好幾筆）；Enter 選第一筆、Esc 關掉 */
export function PickDialog(props: {
  title: string;
  icon: ReactNode;
  placeholder: string;
  options: PickOption[];
  /** 已經選過的（打勾、不能再選） */
  done?: Set<string>;
  empty: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = props.options.filter((o) => words.every((w) => `${o.label}\n${o.sub ?? ""}`.toLowerCase().includes(w))).slice(0, 200);
  const pick = (o: PickOption) => {
    if (!props.done?.has(o.id)) props.onPick(o.id);
  };
  return (
    <div className="dr-dialog-back" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="dr-dialog" role="dialog" aria-label={props.title}>
        <div className="dr-dialog-head">
          {props.icon}
          <strong>{props.title}</strong>
          <button className="icon-btn" onClick={props.onClose} title="Close (Esc)">
            <CloseIcon />
          </button>
        </div>
        <div className="dr-pick-search">
          <input
            autoFocus
            value={q}
            placeholder={props.placeholder}
            spellCheck={false}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") props.onClose();
              else if (e.key === "Enter" && !e.nativeEvent.isComposing && shown[0]) pick(shown[0]);
            }}
          />
        </div>
        <div className="dr-dialog-list">
          {shown.map((o) => {
            const done = !!props.done?.has(o.id);
            return (
              <button key={o.id} className={`dr-pick-row${done ? " done" : ""}`} disabled={done} onClick={() => pick(o)}>
                {o.icon}
                <span className="dr-place-text">
                  <span className="dr-place-name">{o.label}</span>
                  {o.sub && <span className="dr-place-where">{o.sub}</span>}
                </span>
                {done && <span className="dr-pick-done">Attached</span>}
              </button>
            );
          })}
          {!shown.length && <div className="dr-empty">{props.options.length ? "Nothing matches" : props.empty}</div>}
        </div>
        <div className="dr-dialog-foot">
          <button className="dr-btn primary" onClick={props.onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
