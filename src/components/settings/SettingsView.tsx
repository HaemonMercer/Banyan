import { useEffect, useRef } from "react";
import { Icon } from "../../icons/Icon";
import { THEME_ICON, THEME_LABEL, THEME_ORDER, type ThemeMode } from "../../theme";
import LibraryPanel from "./LibraryPanel";
import UpdatePanel from "./UpdatePanel";
import "./Settings.css";

export type SettingsSection = "appearance" | "update" | "library";

interface Props {
    theme: ThemeMode;
    onTheme: (mode: ThemeMode) => void;
    /** Section to scroll to; `jump.key` changes each time something asks for it. */
    jump: { key: number; section: SettingsSection | null };
}

const THEME_HINT: Record<ThemeMode, string> = {
    system: "依照作業系統的淺色／深色設定",
    light: "一律使用淺色",
    dark: "一律使用深色",
};

/** Settings page: 外觀、更新、資料儲存位置. */
function SettingsView({ theme, onTheme, jump }: Props) {
    const refs = {
        appearance: useRef<HTMLElement>(null),
        update: useRef<HTMLElement>(null),
        library: useRef<HTMLElement>(null),
    };

    useEffect(() => {
        if (jump.section) refs[jump.section].current?.scrollIntoView({ block: "start" });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [jump.key]);

    return (
        <div className="settings">
            <div className="settings-inner">
                <h1 className="settings-title">設定</h1>

                <section className="settings-section" ref={refs.appearance} aria-labelledby="set-appearance">
                    <h2 id="set-appearance"><Icon name="contrast" /> 外觀</h2>
                    <p className="muted">選擇介面的色彩主題。</p>
                    <div className="theme-choices" role="radiogroup" aria-labelledby="set-appearance">
                        {THEME_ORDER.map((m) => (
                            <button
                                key={m}
                                role="radio"
                                aria-checked={theme === m}
                                className={`theme-choice${theme === m ? " active" : ""}`}
                                title={THEME_HINT[m]}
                                onClick={() => onTheme(m)}
                            >
                                <Icon name={THEME_ICON[m]} size={22} />
                                <span>{THEME_LABEL[m]}</span>
                            </button>
                        ))}
                    </div>
                </section>

                <section className="settings-section" ref={refs.update} aria-labelledby="set-update">
                    <h2 id="set-update"><Icon name="refresh" /> 更新</h2>
                    <UpdatePanel />
                </section>

                <section className="settings-section" ref={refs.library} aria-labelledby="set-library">
                    <h2 id="set-library"><Icon name="database" /> 資料儲存位置</h2>
                    <LibraryPanel />
                </section>
            </div>
        </div>
    );
}

export default SettingsView;
