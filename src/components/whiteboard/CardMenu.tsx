import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../icons/Icon";
import type { IconName } from "../../icons/icons";

/** One row of a card's "⋯" menu; `"sep"` draws a divider. */
export type CardMenuEntry =
    | "sep"
    | {
          label: string;
          icon?: IconName;
          /** Shortcut hint shown on the right. */
          keys?: string;
          /** Toggle rows show a check mark when on. */
          checked?: boolean;
          danger?: boolean;
          onClick: () => void;
      };

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/**
 * The "⋯" button at the right of a card's top bar and its menu. The menu is drawn on <body> so
 * the board's zoom does not scale it; its events are stopped so the board does not see them.
 */
function CardMenu({ entries, className = "" }: { entries: CardMenuEntry[]; className?: string }) {
    const btn = useRef<HTMLButtonElement>(null);
    const [at, setAt] = useState<{ x: number; y: number } | null>(null);

    useEffect(() => {
        if (!at) return;
        const key = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                setAt(null);
            }
        };
        const close = () => setAt(null);
        window.addEventListener("keydown", key, true);
        window.addEventListener("resize", close);
        return () => {
            window.removeEventListener("keydown", key, true);
            window.removeEventListener("resize", close);
        };
    }, [at]);

    const open = () => {
        const r = btn.current!.getBoundingClientRect();
        // Right-aligned under the button, kept on screen.
        const width = 220;
        setAt({ x: Math.max(8, Math.min(r.right, window.innerWidth - 8) - width), y: r.bottom + 4 });
    };

    return (
        <>
            <button
                ref={btn}
                className={`wb-card-btn wb-card-more-btn${at ? " active" : ""} ${className}`}
                title="更多動作"
                onPointerDown={stop}
                onDoubleClick={stop}
                onClick={() => (at ? setAt(null) : open())}
            >
                <Icon name="moreH" />
            </button>
            {at &&
                createPortal(
                    <div onPointerDown={stop} onDoubleClick={stop} onContextMenu={(e) => e.preventDefault()}>
                        <div className="menu-backdrop" onClick={() => setAt(null)} />
                        <ul
                            className="wb-card-menu"
                            style={{ left: at.x, top: Math.min(at.y, window.innerHeight - 40) }}
                            role="menu"
                            ref={(el) => {
                                // Flip above the button when it would run off the bottom.
                                if (!el || !btn.current) return;
                                const h = el.offsetHeight;
                                if (at.y + h > window.innerHeight - 8) {
                                    el.style.top = `${Math.max(8, btn.current.getBoundingClientRect().top - 4 - h)}px`;
                                }
                            }}
                        >
                            {entries.map((e, i) =>
                                e === "sep" ? (
                                    <li key={i} className="wb-card-menu-sep" role="separator" />
                                ) : (
                                    <li
                                        key={i}
                                        className={`wb-card-menu-item${e.danger ? " danger" : ""}`}
                                        role={e.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                                        aria-checked={e.checked}
                                        onClick={() => {
                                            setAt(null);
                                            e.onClick();
                                        }}
                                    >
                                        <span className="wb-card-menu-icon">
                                            {e.checked !== undefined ? e.checked && <Icon name="check" /> : e.icon && <Icon name={e.icon} />}
                                        </span>
                                        <span className="wb-card-menu-label">{e.label}</span>
                                        {e.keys && <span className="wb-card-menu-keys">{e.keys}</span>}
                                    </li>
                                ),
                            )}
                        </ul>
                    </div>,
                    document.body,
                )}
        </>
    );
}

export default CardMenu;
