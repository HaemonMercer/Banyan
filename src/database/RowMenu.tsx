import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** 右鍵／「⋯」選單的位置與項目；above：選單往上開（右下角對齊 x、y） */
export type Menu = { x: number; y: number; above?: boolean; items: { label: string; icon: ReactNode; run: () => void }[] };

/** 小選單（放到 body，不超出視窗）；點外面或 Esc 關閉。 */
export function RowMenu(props: Menu & { onClose: () => void }) {
  const { onClose } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: props.x, top: props.y });
  useEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r) {
      setPos({
        left: Math.max(8, Math.min(props.above ? props.x - r.width : props.x, window.innerWidth - r.width - 8)),
        top: Math.max(8, Math.min(props.above ? props.y - r.height : props.y, window.innerHeight - r.height - 8)),
      });
    }
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
    };
  }, [props.x, props.y, props.above, onClose]);
  return createPortal(
    <div ref={ref} className="popover prop-menu" style={{ position: "fixed", ...pos }} role="menu">
      {props.items.map((it) => (
        <button
          key={it.label}
          role="menuitem"
          onClick={() => {
            onClose();
            it.run();
          }}
        >
          <span className="glyph">{it.icon}</span>
          {it.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
