import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import DrawerView from "./components/DrawerView.tsx";
import DeskView from "./components/desk/DeskView.tsx";
import WhiteboardView from "./components/WhiteboardView.tsx";
import AnnotatorView from "./components/annotator/AnnotatorView.tsx";
import AnnotationUndo from "./annotator/AnnotationUndo.tsx";
import { DialogHost } from "./components/Feedback.tsx";
import "./components/annotator/Annotator.css";
import SettingsView, { type SettingsSection } from "./components/settings/SettingsView.tsx";
import { Icon } from "./icons/Icon";
import type { IconName } from "./icons/icons";
import { useTheme } from "./theme";
import TabBar from "./components/tabs/TabBar.tsx";
import FileTab from "./components/tabs/FileTab.tsx";
import { OPEN_TAB_EVENT, setHomeActive, type FileTabInfo } from "./tabs";

type Module = "drawer" | "whiteboard" | "annotator" | "desk" | "settings";

const MODULES: { id: Module; icon: IconName; label: string }[] = [
    { id: "drawer", icon: "drawer", label: "Drawer" },
    { id: "whiteboard", icon: "whiteboard", label: "Whiteboard" },
    { id: "annotator", icon: "annotator", label: "Annotator" },
    { id: "desk", icon: "file", label: "Desk" },
];

const STORAGE_KEY = "banyan.module";

function savedModule(): Module {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        if (v === "settings" || MODULES.some((module) => module.id === v)) return v as Module;
    } catch {
        /* storage unavailable */
    }
    return "drawer";
}

const TABS_KEY = "banyan.tabs";

/** Open file tabs and the one shown, restored at start. */
function savedTabs(): { tabs: FileTabInfo[]; active: number | null } {
    try {
        const v = JSON.parse(localStorage.getItem(TABS_KEY) ?? "null") as { tabs?: FileTabInfo[]; active?: number | null } | null;
        const tabs = Array.isArray(v?.tabs) ? v!.tabs.filter((t) => typeof t?.attachmentId === "number" && typeof t.fileName === "string") : [];
        const active = tabs.some((t) => t.attachmentId === v?.active) ? v!.active! : null;
        return { tabs, active };
    } catch {
        return { tabs: [], active: null };
    }
}

function App() {
    const [module, setModule] = useState<Module>(savedModule);
    const beforeLeavingDesk = useRef<(() => Promise<boolean>) | null>(null);
    const [theme, setTheme] = useTheme();
    /** Settings stays mounted once opened, so an update download survives switching modules. */
    const [settingsOpened, setSettingsOpened] = useState(module === "settings");
    const [settingsJump, setSettingsJump] = useState<{ key: number; section: SettingsSection | null }>({ key: 0, section: null });
    // Jumping between modules: which item or card to show when the other module opens.
    const [nav, setNav] = useState<{
        key: number;
        itemId: number | null;
        card: { cardId: number; boardId: number } | null;
        annotationId?: number | null;
    }>({ key: 0, itemId: null, card: null });

    const [tabs, setTabs] = useState<FileTabInfo[]>(() => savedTabs().tabs);
    /** The file tab shown, or null for the module tab. */
    const [activeTab, setActiveTab] = useState<number | null>(() => savedTabs().active);
    setHomeActive(activeTab === null);
    useEffect(() => {
        try {
            localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, active: activeTab }));
        } catch {
            /* this session only */
        }
    }, [tabs, activeTab]);

    const closeTabs = useCallback((ids: number[]) => {
        setTabs((list) => {
            const next = list.filter((t) => !ids.includes(t.attachmentId));
            // Closing the shown tab shows its neighbor (the one after it, else before; else the module).
            setActiveTab((a) => {
                if (a === null || !ids.includes(a)) return a;
                const i = list.findIndex((t) => t.attachmentId === a);
                const after = list.slice(i + 1).find((t) => !ids.includes(t.attachmentId));
                const before = list.slice(0, i).reverse().find((t) => !ids.includes(t.attachmentId));
                return (after ?? before)?.attachmentId ?? null;
            });
            return next;
        });
    }, []);
    const moveTab = (from: number, to: number) =>
        setTabs((list) => {
            const next = [...list];
            const [t] = next.splice(from, 1);
            next.splice(to, 0, t);
            return next;
        });

    // Opening a file in a tab (from Drawer, the Annotator, the reader).
    useEffect(() => {
        const onOpen = (e: Event) => {
            const t = (e as CustomEvent<FileTabInfo>).detail;
            setTabs((list) => (list.some((x) => x.attachmentId === t.attachmentId) ? list : [...list, t]));
            setActiveTab(t.attachmentId);
        };
        window.addEventListener(OPEN_TAB_EVENT, onOpen);
        return () => window.removeEventListener(OPEN_TAB_EVENT, onOpen);
    }, []);

    // Ctrl+W closes the file tab; Ctrl+Tab / Ctrl+Shift+Tab (or Ctrl+PageDown / PageUp) go through
    // the tabs; Ctrl+1 is the module, Ctrl+2…8 the files, Ctrl+9 the last.
    useEffect(() => {
        if (tabs.length === 0) return;
        const onKey = (e: KeyboardEvent) => {
            if (!(e.ctrlKey || e.metaKey) || e.altKey || document.querySelector(".modal-backdrop")) return;
            const order: (number | null)[] = [null, ...tabs.map((t) => t.attachmentId)];
            const at = order.indexOf(activeTab);
            const k = e.key.toLowerCase();
            if (k === "w" && !e.shiftKey) {
                if (activeTab === null) return;
                closeTabs([activeTab]);
            } else if (e.key === "Tab" || e.key === "PageDown" || e.key === "PageUp") {
                const dir = e.key === "PageUp" || (e.key === "Tab" && e.shiftKey) ? -1 : 1;
                setActiveTab(order[(at + dir + order.length) % order.length]);
            } else if (!e.shiftKey && /^[1-9]$/.test(e.key)) {
                const n = Number(e.key);
                setActiveTab(n === 9 ? order[order.length - 1] : (order[n - 1] ?? activeTab));
            } else return;
            e.preventDefault();
            e.stopPropagation();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [tabs, activeTab, closeTabs]);

    const choose = async (m: Module) => {
        if (m !== "desk" && beforeLeavingDesk.current && !await beforeLeavingDesk.current()) return;
        setActiveTab(null);
        setModule(m);
        if (m === "settings") setSettingsOpened(true);
        try {
            localStorage.setItem(STORAGE_KEY, m);
        } catch {
            /* storage unavailable */
        }
    };

    const openItem = (itemId: number) => {
        setNav((n) => ({ key: n.key + 1, itemId, card: null }));
        choose("drawer");
    };
    const openCard = (cardId: number, boardId: number) => {
        setNav((n) => ({ key: n.key + 1, itemId: null, card: { cardId, boardId } }));
        choose("whiteboard");
    };
    const openAnnotation = (annotationId: number) => {
        setNav((n) => ({ key: n.key + 1, itemId: null, card: null, annotationId }));
        choose("annotator");
    };

    // From anywhere (a card's "回到原文", an annotation's "開啟卡片"), without passing callbacks down.
    useEffect(() => {
        const onAnnotation = (e: Event) => openAnnotation((e as CustomEvent<number>).detail);
        // A card made from an annotation is on no board: Whiteboard opens it in its side panel.
        const onCard = (e: Event) => openCard((e as CustomEvent<number>).detail, 0);
        window.addEventListener("banyan:open-annotation", onAnnotation);
        window.addEventListener("banyan:open-card", onCard);
        // A citation or `[[@key]]` clicked: the cited item in Drawer.
        const onItem = (e: Event) => openItem((e as CustomEvent<number>).detail);
        window.addEventListener("banyan:open-item", onItem);
        return () => {
            window.removeEventListener("banyan:open-annotation", onAnnotation);
            window.removeEventListener("banyan:open-card", onCard);
            window.removeEventListener("banyan:open-item", onItem);
        };
    });

    const openSettings = (section: SettingsSection) => {
        setSettingsJump((j) => ({ key: j.key + 1, section }));
        choose("settings");
    };

    return (
        <div className="app">
            <nav className="app-rail">
                <div className="rail-brand" title="Banyan">
                    <Icon name="logo" size={22} />
                </div>
                {MODULES.map((m) => (
                    <button
                        key={m.id}
                        className={`rail-btn${module === m.id ? " active" : ""}`}
                        title={m.label}
                        onClick={() => choose(m.id)}
                    >
                        <Icon name={m.icon} size={20} className="rail-icon" />
                        <span className="rail-label">{m.label}</span>
                    </button>
                ))}
                <div className="rail-spacer" />
                <button
                    className={`rail-btn rail-theme${module === "settings" ? " active" : ""}`}
                    title="設定：外觀、更新、資料儲存位置"
                    onClick={() => choose("settings")}
                >
                    <Icon name="settings" size={18} className="rail-icon" />
                    <span className="rail-label">設定</span>
                </button>
            </nav>
            <main className={`app-main${tabs.length > 0 ? " has-tabs" : ""}`}>
                {tabs.length > 0 && (
                    <TabBar
                        home={module === "settings" ? { icon: "settings", label: "設定" } : MODULES.find((m) => m.id === module)!}
                        tabs={tabs}
                        active={activeTab}
                        onActivate={setActiveTab}
                        onClose={closeTabs}
                        onMove={moveTab}
                        onShowItem={openItem}
                    />
                )}
                <div className="home-page" hidden={activeTab !== null}>
                {settingsOpened && (
                    <div hidden={module !== "settings"} style={{ height: "100%" }}>
                        <SettingsView theme={theme} onTheme={setTheme} jump={settingsJump} />
                    </div>
                )}
                {module === "settings" ? null : module === "drawer" ? (
                    <DrawerView
                        key={nav.key}
                        initialItemId={nav.itemId}
                        onOpenCard={openCard}
                        onOpenSettings={() => openSettings("library")}
                    />
                ) : module === "annotator" ? (
                    <AnnotatorView key={nav.key} initialAnnotationId={nav.annotationId ?? null} onOpenItem={openItem} />
                ) : module === "desk" ? (
                    <DeskView beforeLeave={beforeLeavingDesk} />
                ) : (
                    <WhiteboardView key={nav.key} initialCard={nav.card} onOpenItem={openItem} />
                )}
                </div>
                {(() => {
                    const t = tabs.find((x) => x.attachmentId === activeTab);
                    // Only the shown file is mounted; each reader remembers its place.
                    return t ? <FileTab key={t.attachmentId} tab={t} onOpenItem={openItem} /> : null;
                })()}
            </main>
            <AnnotationUndo />
            <DialogHost />
        </div>
    );
}

export default App;
