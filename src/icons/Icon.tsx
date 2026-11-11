import { itemType } from "../drawer/itemTypes";
import { ICONS, TYPE_ICONS, type IconName } from "./icons";
import "./icons.css";

interface IconProps {
    name: IconName;
    /** Pixel size; defaults to 1em so the icon follows the surrounding text. */
    size?: number;
    className?: string;
    title?: string;
}

function Svg({ markup, size, className, title }: { markup: string; size?: number; className: string; title?: string }) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            width={size ?? "1em"}
            height={size ?? "1em"}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden={title ? undefined : true}
            role={title ? "img" : undefined}
            dangerouslySetInnerHTML={{ __html: (title ? `<title>${title}</title>` : "") + markup }}
        />
    );
}

/** A line icon from the Banyan set (src/icons/icons.ts), drawn in the current text color. */
export function Icon({ name, size, className, title }: IconProps) {
    return <Svg markup={ICONS[name]} size={size} className={`bn-icon${className ? ` ${className}` : ""}`} title={title} />;
}

/** The icon of a Drawer item type, tinted by its group (文獻、影音、現場表演、藝術與圖像、其他). */
export function TypeIcon({ type, size, className }: { type: string; size?: number; className?: string }) {
    const t = itemType(type);
    const markup = TYPE_ICONS[t.id] ?? TYPE_ICONS.document;
    return (
        <span className={`bn-type-icon type-${t.group}${className ? ` ${className}` : ""}`} title={t.label}>
            <Svg markup={markup} size={size} className="bn-icon" />
        </span>
    );
}
