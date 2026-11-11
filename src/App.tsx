import { useState } from "react";
import "./App.css";
import DrawerView from "./components/DrawerView.tsx";
import GraphModule from "./components/GraphModule.tsx";
import UpdateDialog from "./components/UpdateDialog.tsx";
import WhiteboardView from "./components/WhiteboardView.tsx";
import { Icon } from "./icons/Icon";
import type { IconName } from "./icons/icons";
import { THEME_ICON, THEME_LABEL, useTheme } from "./theme";

type Module = "drawer" | "whiteboard" | "graph";

const MODULES: { id: Module; icon: IconName; label: string }[] = [
    { id: "drawer", icon: "drawer", label: "Drawer" },
    { id: "whiteboard", icon: "whiteboard", label: "Whiteboard" },
    { id: "graph", icon: "graph", label: "Graph" },
];

const STORAGE_KEY = "banyan.module";

function savedModule(): Module {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        if (v === "drawer" || v === "whiteboard" || v === "graph") return v;
    } catch {
        /* storage unavailable */
    }
    return "drawer";
}

function App() {
    const [module, setModule] = useState<Module>(savedModule);
    const [theme, cycleTheme] = useTheme();
    const [showUpdate, setShowUpdate] = useState(false);
    // Jumping between modules: which item or card to show when the other module opens.
    const [nav, setNav] = useState<{ key: number; itemId: number | null; card: { cardId: number; boardId: number } | null }>(
        { key: 0, itemId: null, card: null },
    );

    const choose = (m: Module) => {
        setModule(m);
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
                <button className="rail-btn rail-theme" title="檢查是否有新版本" onClick={() => setShowUpdate(true)}>
                    <Icon name="refresh" size={18} className="rail-icon" />
                    <span className="rail-label">更新</span>
                </button>
                <button
                    className="rail-btn rail-theme"
                    title={`外觀：${THEME_LABEL[theme]}（點一下切換）`}
                    onClick={cycleTheme}
                >
                    <Icon name={THEME_ICON[theme]} size={18} className="rail-icon" />
                    <span className="rail-label">{THEME_LABEL[theme]}</span>
                </button>
            </nav>
            <main className="app-main">
                {module === "drawer" ? (
                    <DrawerView key={nav.key} initialItemId={nav.itemId} onOpenCard={openCard} />
                ) : module === "whiteboard" ? (
                    <WhiteboardView key={nav.key} initialCard={nav.card} onOpenItem={openItem} />
                ) : (
                    <GraphModule onOpenCard={openCard} onOpenItem={openItem} />
                )}
            </main>
            {showUpdate && <UpdateDialog onClose={() => setShowUpdate(false)} />}
        </div>
    );
}

export default App;
