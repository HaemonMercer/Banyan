import { useEffect, useRef, useState } from "react";
import { Icon } from "../../icons/Icon";
import type { IconName } from "../../icons/icons";
import type { FileTabInfo } from "../../tabs";
import "./Tabs.css";

interface Props {
    home: { icon: IconName; label: string };
    tabs: FileTabInfo[];
    /** The file tab shown, or null for the module tab. */
    active: number | null;
    onActivate: (attachmentId: number | null) => void;
    onClose: (attachmentIds: number[]) => void;
    onMove: (from: number, to: number) => void;
    onShowItem: (itemId: number) => void;
}

/**
 * The tab bar: the module tab first (always there), then one tab per open file. Click to switch,
 * middle-click or × to close, drag to reorder, right-click for more.
 */
function TabBar({ home, tabs, active, onActivate, onClose, onMove, onShowItem }: Props) {
    const [menu, setMenu] = useState<{ x: number; y: number; index: number } | null>(null);
    const [dragFrom, setDragFrom] = useState<number | null>(null);
    const [dropAt, setDropAt] = useState<number | null>(null);
    const barRef = useRef<HTMLDivElement>(null);

    // Keep the active tab in view when there are more than fit.
    useEffect(() => {
        barRef.current?.querySelector(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, [active, tabs.length]);

    const menuTab = menu ? tabs[menu.index] : null;
    return (
        <div
            ref={barRef}
            className="tab-bar"
            role="tablist"
            aria-label="分頁"
            onWheel={(e) => {
                // A vertical wheel scrolls the tabs sideways.
                if (e.deltaY && barRef.current) barRef.current.scrollLeft += e.deltaY;
            }}
        >
            <button
                role="tab"
                aria-selected={active === null}
                className={`tab tab-home${active === null ? " active" : ""}`}
                onClick={() => onActivate(null)}
                title={`${home.label}（Ctrl＋1）`}
            >
                <Icon name={home.icon} className="tab-icon" />
                <span className="tab-title">{home.label}</span>
            </button>
            {tabs.map((t, i) => (
                <div
                    key={t.attachmentId}
                    role="tab"
                    aria-selected={active === t.attachmentId}
                    tabIndex={0}
                    className={`tab${active === t.attachmentId ? " active" : ""}${dragFrom === i ? " dragging" : ""}${dropAt === i && dragFrom !== null && dragFrom !== i ? (dragFrom < i ? " drop-after" : " drop-before") : ""}`}
                    title={`${t.title}\n${t.fileName}`}
                    draggable
                    onClick={() => onActivate(t.attachmentId)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onActivate(t.attachmentId);
                        }
                    }}
                    onMouseDown={(e) => e.button === 1 && e.preventDefault()} // no autoscroll
                    onAuxClick={(e) => {
                        if (e.button === 1) onClose([t.attachmentId]);
                    }}
                    onContextMenu={(e) => {
                        e.preventDefault();
                        setMenu({ x: e.clientX, y: e.clientY, index: i });
                    }}
                    onDragStart={(e) => {
                        setDragFrom(i);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", t.title);
                    }}
                    onDragOver={(e) => {
                        if (dragFrom === null) return;
                        e.preventDefault();
                        setDropAt(i);
                    }}
                    onDrop={(e) => {
                        e.preventDefault();
                        if (dragFrom !== null && dragFrom !== i) onMove(dragFrom, i);
                        setDragFrom(null);
                        setDropAt(null);
                    }}
                    onDragEnd={() => {
                        setDragFrom(null);
                        setDropAt(null);
                    }}
                >
                    <Icon name={/\.pdf$/i.test(t.fileName) ? "pdf" : "library"} className="tab-icon" />
                    <span className="tab-title">{t.title}</span>
                    <button
                        className="tab-close"
                        title="關閉（Ctrl＋W）"
                        aria-label={`關閉 ${t.title}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            onClose([t.attachmentId]);
                        }}
                    >
                        <Icon name="close" />
                    </button>
                </div>
            ))}
            {menu && menuTab && (
                <>
                    <div
                        className="menu-backdrop"
                        onClick={() => setMenu(null)}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            setMenu(null);
                        }}
                    />
                    <ul className="menu col-menu at-pointer tab-menu" style={{ left: menu.x, top: menu.y }} role="menu">
                        <li className="menu-item" role="menuitem" onClick={() => { setMenu(null); onClose([menuTab.attachmentId]); }}>
                            關閉
                        </li>
                        <li
                            className={`menu-item${tabs.length < 2 ? " disabled" : ""}`}
                            role="menuitem"
                            onClick={() => {
                                if (tabs.length < 2) return;
                                setMenu(null);
                                onClose(tabs.filter((x) => x.attachmentId !== menuTab.attachmentId).map((x) => x.attachmentId));
                            }}
                        >
                            關閉其他分頁
                        </li>
                        <li
                            className={`menu-item${menu.index === tabs.length - 1 ? " disabled" : ""}`}
                            role="menuitem"
                            onClick={() => {
                                if (menu.index === tabs.length - 1) return;
                                setMenu(null);
                                onClose(tabs.slice(menu.index + 1).map((x) => x.attachmentId));
                            }}
                        >
                            關閉右側的分頁
                        </li>
                        <li className="menu-item" role="menuitem" onClick={() => { setMenu(null); onClose(tabs.map((x) => x.attachmentId)); }}>
                            關閉所有檔案分頁
                        </li>
                        {menuTab.itemId !== null && (
                            <>
                                <li className="menu-sep" />
                                <li className="menu-item" role="menuitem" onClick={() => { setMenu(null); onShowItem(menuTab.itemId!); }}>
                                    在 Drawer 中顯示
                                </li>
                            </>
                        )}
                    </ul>
                </>
            )}
        </div>
    );
}

export default TabBar;
