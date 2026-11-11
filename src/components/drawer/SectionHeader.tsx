import type { ReactNode } from "react";
import { Icon } from "../../icons/Icon";

interface Props {
    title: string;
    /** Shown after the title, e.g. how many tags or attachments. */
    count?: number;
    collapsed: boolean;
    onToggle: () => void;
    /** Buttons on the right (still usable while folded). */
    children?: ReactNode;
}

/** Clickable header that folds or unfolds a detail-pane section. */
function SectionHeader({ title, count, collapsed, onToggle, children }: Props) {
    return (
        <h3 className="section-head">
            <button className="section-toggle" aria-expanded={!collapsed} onClick={onToggle}>
                <span className="section-caret"><Icon name={collapsed ? "chevronRight" : "chevronDown"} /></span>
                {title}
                {count !== undefined && count > 0 && <span className="section-count">{count}</span>}
            </button>
            {children && <span className="section-actions">{children}</span>}
        </h3>
    );
}

export default SectionHeader;
