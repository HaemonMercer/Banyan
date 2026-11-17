import { useEffect } from "react";
import { CloseIcon } from "../editor/icons";
import { SHORTCUT_GROUPS } from "./shortcuts";

/** 快捷鍵一覽（Ctrl+/）。按 Esc 或點外面關閉。 */
export function ShortcutHelp(props: { onClose: () => void }) {
  const { onClose } = props;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal shortcut-help" role="dialog" aria-modal="true" aria-label="Shortcuts">
        <div className="modal-head">
          <span className="modal-title">Keyboard shortcuts</span>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)">
            <CloseIcon />
          </button>
        </div>
        <div className="shortcut-groups">
          {SHORTCUT_GROUPS.map((g) => (
            <section key={g.title}>
              <h3>{g.title}</h3>
              {g.items.map(([keys, label]) => (
                <div key={label} className="shortcut-row">
                  <span>{label}</span>
                  <span className="shortcut-keys">
                    {keys.map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
