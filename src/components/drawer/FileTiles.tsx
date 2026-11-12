import { useEffect, useRef, useState } from "react";
import type { Collection, ItemSummary } from "../../drawer/api";
import { useAttachmentImage } from "../../drawer/images";
import { Icon, TypeIcon } from "../../icons/Icon";

/** "會議紀錄" + "會議紀錄.pdf" → "會議紀錄.pdf": the name with its extension, as Windows shows it. */
export function displayName(it: ItemSummary): string {
    const ext = /\.([^.]+)$/.exec(it.fileName ?? "")?.[1];
    const title = it.title.trim();
    if (!title) return it.fileName ?? "（無標題）";
    if (!ext || title.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) return title;
    return `${title}.${ext}`;
}

/** Loads once the element scrolls near the view. */
function useNearView<T extends HTMLElement>() {
    const ref = useRef<T>(null);
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
    return { ref, visible };
}

interface FileTileProps {
    item: ItemSummary;
    selected: boolean;
    focused: boolean;
    dragSource: boolean;
    onClick: (e: React.MouseEvent) => void;
    onPointerDown: (e: React.PointerEvent) => void;
    onOpen: () => void;
}

/** A file in the large-icons view: a thumbnail for pictures, the type's icon otherwise, and the name. */
export function FileTile({ item, selected, focused, dragSource, onClick, onPointerDown, onOpen }: FileTileProps) {
    const { ref, visible } = useNearView<HTMLDivElement>();
    const { url, failed } = useAttachmentImage(item.imageId, visible);
    const name = displayName(item);
    const ext = /\.([^.]+)$/.exec(item.fileName ?? "")?.[1]?.toUpperCase();
    return (
        <div
            ref={ref}
            data-item-id={item.id}
            className={`file-tile${selected ? " selected" : ""}${focused ? " focused" : ""}${dragSource ? " drag-source" : ""}`}
            title={`${name}\n雙擊開啟`}
            onClick={onClick}
            onPointerDown={onPointerDown}
            onDoubleClick={onOpen}
        >
            <div className="file-tile-icon">
                {url && !failed ? (
                    <img src={url} alt="" draggable={false} />
                ) : (
                    <>
                        <TypeIcon type={item.itemType} />
                        {ext && <span className="file-tile-ext">{ext}</span>}
                    </>
                )}
            </div>
            <div className="file-tile-name">{name}</div>
        </div>
    );
}

interface FolderTileProps {
    folder: Collection;
    /** Number of sub-folders, shown under the name. */
    subfolders: number;
    highlighted: boolean;
    dropTarget: boolean;
    onClick: () => void;
    onOpen: () => void;
}

/** A sub-folder in the large-icons view: double-click goes in; items can be dropped on it. */
export function FolderTile({ folder, subfolders, highlighted, dropTarget, onClick, onOpen }: FolderTileProps) {
    return (
        <div
            className={`file-tile folder-tile${highlighted ? " selected" : ""}${dropTarget ? " drop-target" : ""}`}
            data-drop-collection={folder.id}
            data-folder-id={folder.id}
            title={`${folder.name}\n雙擊開啟資料夾`}
            onClick={(e) => {
                e.stopPropagation();
                onClick();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={onOpen}
        >
            <div className="file-tile-icon">
                <Icon name={folder.view === "gallery" ? "image" : "folder"} className="folder-icon" />
            </div>
            <div className="file-tile-name">{folder.name}</div>
            {subfolders > 0 && <div className="file-tile-meta">{subfolders} 個資料夾</div>}
        </div>
    );
}
