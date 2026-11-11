import { useEffect, useRef, useState } from "react";
import type { ItemSummary } from "../../drawer/api";
import { useAttachmentImage } from "../../drawer/images";
import { TypeIcon } from "../../icons/Icon";

interface Props {
    item: ItemSummary;
    selected: boolean;
    focused: boolean;
    dragSource: boolean;
    onClick: (e: React.MouseEvent) => void;
    onPointerDown: (e: React.PointerEvent) => void;
    onOpen: () => void;
}

/** One picture in a gallery folder. The picture loads when the tile scrolls into view. */
function GalleryTile({ item, selected, focused, dragSource, onClick, onPointerDown, onOpen }: Props) {
    const ref = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el || visible) return;
        const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), {
            rootMargin: "200px",
        });
        io.observe(el);
        return () => io.disconnect();
    }, [visible]);
    const { url, failed } = useAttachmentImage(item.imageId, visible);

    return (
        <div
            ref={ref}
            data-item-id={item.id}
            className={`gallery-tile${selected ? " selected" : ""}${focused ? " focused" : ""}${dragSource ? " drag-source" : ""}`}
            title={item.title || "（無標題）"}
            onClick={onClick}
            onPointerDown={onPointerDown}
            onDoubleClick={onOpen}
        >
            {url ? (
                <img src={url} alt={item.title} draggable={false} />
            ) : (
                <div className={`gallery-placeholder${failed ? " failed" : ""}`}>
                    {item.imageId === null || failed ? <TypeIcon type={item.itemType} /> : null}
                </div>
            )}
        </div>
    );
}

export default GalleryTile;
