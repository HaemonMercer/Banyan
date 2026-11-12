/**
 * What a click on `[[target]]` does. Each module provides its own handler with
 * `<WikiLinkProvider>` (Whiteboard opens the side panel, Drawer switches to Whiteboard);
 * `resolveWikiTarget` turns a target into a card.
 */
import { createContext, useContext, type ReactNode } from "react";
import { whiteboardApi } from "../whiteboard/api";

export type WikiLinkHandler = (target: string) => void;

const WikiLinkContext = createContext<WikiLinkHandler | null>(null);

export function WikiLinkProvider({ onWikiLink, children }: { onWikiLink: WikiLinkHandler; children: ReactNode }) {
    return <WikiLinkContext.Provider value={onWikiLink}>{children}</WikiLinkContext.Provider>;
}

export function useWikiLinkHandler(): WikiLinkHandler | null {
    return useContext(WikiLinkContext);
}

export type WikiTarget = { cardId: number; boardId: number | null } | { error: string };

/** `card:42` → that card; a bare title → the card with exactly that title (case-insensitive). */
export async function resolveWikiTarget(target: string): Promise<WikiTarget> {
    const t = target.trim();
    const m = /^card:(\d+)$/.exec(t);
    if (m) return { cardId: Number(m[1]), boardId: null };
    if (t.startsWith("@")) return { error: `引用鍵「${t}」還不支援，之後的版本會連到文獻` };
    if (/^[a-z]+:\d+$/.test(t)) return { error: `還不支援這種連結：${t}` };
    const key = t.toLowerCase();
    const hits = await whiteboardApi.searchCards(t, null);
    const exact = hits.filter((h) => h.title.trim().toLowerCase() === key);
    if (exact.length === 0) return { error: `找不到標題為「${t}」的卡片` };
    const hit = exact.find((h) => h.boardId !== null) ?? exact[0];
    return { cardId: hit.cardId, boardId: hit.boardId };
}
