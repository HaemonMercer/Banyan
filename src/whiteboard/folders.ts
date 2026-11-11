import type { BoardFolder } from "./api";

/** Full path of a folder, e.g. "研究/論文". */
export function folderPath(folders: BoardFolder[], id: number | null): string {
    const parts: string[] = [];
    let cur = folders.find((f) => f.id === id);
    let guard = 0;
    while (cur && guard++ < 100) {
        parts.unshift(cur.name);
        cur = folders.find((f) => f.id === cur!.parentId);
    }
    return parts.join("/");
}

/** The folder and every folder below it. */
export function folderSubtree(folders: BoardFolder[], id: number): Set<number> {
    const out = new Set([id]);
    let grew = true;
    while (grew) {
        grew = false;
        for (const f of folders) {
            if (f.parentId !== null && out.has(f.parentId) && !out.has(f.id)) {
                out.add(f.id);
                grew = true;
            }
        }
    }
    return out;
}
