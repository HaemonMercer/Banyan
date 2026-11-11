/** Light / dark theme: follows the system unless the user picks one. Stored in localStorage. */
import { useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "banyan.theme";
export const THEME_ORDER: ThemeMode[] = ["system", "light", "dark"];
export const THEME_LABEL: Record<ThemeMode, string> = { system: "跟隨系統", light: "淺色", dark: "深色" };
export const THEME_ICON = { system: "contrast", light: "sun", dark: "moon" } as const satisfies Record<ThemeMode, string>;

export function savedTheme(): ThemeMode {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        if (v === "light" || v === "dark" || v === "system") return v;
    } catch {
        /* storage unavailable */
    }
    return "system";
}

/** Sets <html data-theme>; "system" removes it so the prefers-color-scheme tokens apply. */
export function applyTheme(mode: ThemeMode) {
    const root = document.documentElement;
    if (mode === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", mode);
}

export function useTheme(): [ThemeMode, (mode: ThemeMode) => void] {
    const [mode, setMode] = useState<ThemeMode>(savedTheme);
    useEffect(() => {
        applyTheme(mode);
        try {
            localStorage.setItem(STORAGE_KEY, mode);
        } catch {
            /* storage unavailable */
        }
    }, [mode]);
    return [mode, setMode];
}
