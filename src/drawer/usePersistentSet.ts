import { useCallback, useState } from "react";

/**
 * A set of strings kept in localStorage — used to remember which panel sections are folded.
 * Falls back to an in-memory set when storage is unavailable.
 */
export function usePersistentSet(key: string): [Set<string>, (id: string) => void, (ids: string[]) => void] {
    const [set, setSet] = useState<Set<string>>(() => {
        try {
            const raw = localStorage.getItem(key);
            return new Set(raw ? (JSON.parse(raw) as string[]) : []);
        } catch {
            return new Set();
        }
    });

    const write = useCallback(
        (next: Set<string>) => {
            try {
                localStorage.setItem(key, JSON.stringify([...next]));
            } catch {
                /* storage unavailable: keep it for this session only */
            }
            return next;
        },
        [key],
    );

    const toggle = useCallback(
        (id: string) =>
            setSet((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return write(next);
            }),
        [write],
    );

    const replace = useCallback((ids: string[]) => setSet(write(new Set(ids))), [write]);

    return [set, toggle, replace];
}
