import type { Collection } from "./api";

/** Full path of a folder, e.g. "資料夾/資料夾01". */
export function collectionPath(collections: Collection[], id: number): string {
    const byId = new Map(collections.map((c) => [c.id, c]));
    const parts: string[] = [];
    const seen = new Set<number>();
    let cur = byId.get(id);
    while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        parts.unshift(cur.name);
        cur = cur.parentId === null ? undefined : byId.get(cur.parentId);
    }
    return parts.join("/");
}
