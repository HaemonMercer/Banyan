import { useState, type ReactNode } from "react";
import { Icon } from "../../icons/Icon";

const STORE = "banyan.wb.foldSections";

/** Sections the user opened or closed (by name), shared by the right column and the side panel. */
function readState(): Record<string, boolean> {
    try {
        return JSON.parse(localStorage.getItem(STORE) ?? "{}") as Record<string, boolean>;
    } catch {
        return {};
    }
}

/**
 * A titled list in the right column or side panel that folds to its title and count.
 * `defaultOpen` is used until the user opens or closes it; after that the choice is remembered.
 */
function FoldSection({
    name,
    title,
    count,
    defaultOpen = false,
    children,
}: {
    /** Key for remembering the state, e.g. "items". */
    name: string;
    title: string;
    count: number;
    defaultOpen?: boolean;
    children: ReactNode;
}) {
    const [open, setOpen] = useState(() => readState()[name] ?? defaultOpen);
    const toggle = () => {
        const next = !open;
        setOpen(next);
        try {
            localStorage.setItem(STORE, JSON.stringify({ ...readState(), [name]: next }));
        } catch {
            // Storage unavailable: the section still toggles for now.
        }
    };
    return (
        <>
            <h3 className="wb-section-title wb-fold-title">
                <button className="wb-fold-btn" aria-expanded={open} onClick={toggle} title={open ? "收起" : "展開"}>
                    <Icon name={open ? "chevronDown" : "chevronRight"} />
                    {title} <span className="muted">{count}</span>
                </button>
            </h3>
            {open && children}
        </>
    );
}

export default FoldSection;
