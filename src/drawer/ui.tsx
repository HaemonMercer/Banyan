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
