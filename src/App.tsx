import { useState } from "react";
import "./App.css";
import DrawerView from "./components/DrawerView.tsx";
import GraphModule from "./components/GraphModule.tsx";
import WhiteboardView from "./components/WhiteboardView.tsx";
import SettingsView, { type SettingsSection } from "./components/settings/SettingsView.tsx";
import { Icon } from "./icons/Icon";
import type { IconName } from "./icons/icons";
import { useTheme } from "./theme";

type Module = "drawer" | "whiteboard" | "graph" | "settings";

const MODULES: { id: Module; icon: IconName; label: string }[] = [
    { id: "drawer", icon: "drawer", label: "Drawer" },
    { id: "whiteboard", icon: "whiteboard", label: "Whiteboard" },
    { id: "graph", icon: "graph", label: "Graph" },
];

const STORAGE_KEY = "banyan.module";

function savedModule(): Module {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        if (v === "drawer" || v === "whiteboard" || v === "graph" || v === "settings") return v;
    } catch {
        /* storage unavailable */
    }
    return "drawer";
}

function App() {
    const [module, setModule] = useState<Module>(savedModule);
    const [theme, setTheme] = useTheme();
    /** Settings stays mounted once opened, so an update download survives switching modules. */
    const [settingsOpened, setSettingsOpened] = useState(module === "settings");
    const [settingsJump, setSettingsJump] = useState<{ key: number; section: SettingsSection | null }>({ key: 0, section: null });
    // Jumping between modules: which item or card to show when the other module opens.
    const [nav, setNav] = useState<{ key: number; itemId: number | null; card: { cardId: number; boardId: number } | null }>(
        { key: 0, itemId: null, card: null },
    );

    const choose = (m: Module) => {
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
            <main className="app-main">
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
                ) : module === "whiteboard" ? (
                    <WhiteboardView key={nav.key} initialCard={nav.card} onOpenItem={openItem} />
                ) : (
                    <GraphModule onOpenCard={openCard} onOpenItem={openItem} />
                )}
            </main>
        </div>
    );
}

export default App;
