import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../icons/Icon";
import { errorMessage } from "../drawer/api";
import {
    whiteboardApi,
    type BoardCard,
    type BoardFolder,
    type CardDetail,
    type CardLink,
    type LinkDirection,
    type Section,
    type Whiteboard,
} from "../whiteboard/api";
import BoardCanvas, { type BoardCanvasHandle, type Rect } from "./whiteboard/BoardCanvas";
import BoardTree, { folderSubtree } from "./whiteboard/BoardTree";
import CardLibrary from "./whiteboard/CardLibrary";
import CardPanel from "./whiteboard/CardPanel";
import LinkEditor from "./whiteboard/LinkEditor";
import WhiteboardSidebar, { type DragPayload } from "./whiteboard/WhiteboardSidebar";
import "./whiteboard/Whiteboard.css";

const untitled = (t: string) => t || "（無標題）";
const samePair = (l: CardLink, a: number, b: number) =>
    (l.cardA === a && l.cardB === b) || (l.cardA === b && l.cardB === a);

interface Props {
    /** Card to open when the view mounts (e.g. coming from a Drawer item). */
    initialCard?: { cardId: number; boardId: number } | null;
    /** Opens a Drawer item. */
    onOpenItem: (itemId: number) => void;
}

function WhiteboardView({ initialCard = null, onOpenItem }: Props) {
    const [boards, setBoards] = useState<Whiteboard[]>([]);
    const [boardId, setBoardId] = useState<number | null>(null);
    /** A board's canvas, or the card library. */
    const [mode, setMode] = useState<"board" | "library">("board");
    const [cards, setCards] = useState<BoardCard[]>([]);
    const [links, setLinks] = useState<CardLink[]>([]);
    const [sections, setSections] = useState<Section[]>([]);
    /** Selected cards on the board (Shift-click or drag a box for several). */
    const [selection, setSelection] = useState<number[]>([]);
    const [selectedLinkId, setSelectedLinkId] = useState<number | null>(null);
    const [selectedSectionId, setSelectedSectionId] = useState<number | null>(null);
    /** Card shown in the side panel (Heptabase's "open card"). */
    const [openCardId, setOpenCardId] = useState<number | null>(null);
    const [linksVersion, setLinksVersion] = useState(0);
    const [renamingId, setRenamingId] = useState<number | null>(null);
    const [folders, setFolders] = useState<BoardFolder[]>([]);
    /** Bumped to focus the note box of the selected link. */
    const [noteFocus, setNoteFocus] = useState(0);
    const [toast, setToast] = useState<{ text: string; kind: "error" | "info" } | null>(null);

    const canvas = useRef<BoardCanvasHandle>(null);
    const cardsRef = useRef(cards);
    cardsRef.current = cards;
    const sectionsRef = useRef(sections);
    sectionsRef.current = sections;
    /** Cards whose title or content changed since the last save. */
    const dirty = useRef(new Set<number>());
    /** Card to select and scroll to once the next board has loaded. */
    const pendingFocus = useRef<number | null>(initialCard?.cardId ?? null);

    const selectedCardId = selection.length === 1 ? selection[0] : null;
    const selectOne = (id: number | null) => setSelection(id === null ? [] : [id]);

    const showError = useCallback((text: string) => setToast({ text, kind: "error" }), []);
    const showInfo = useCallback((text: string) => setToast({ text, kind: "info" }), []);
    const bumpLinks = () => setLinksVersion((n) => n + 1);

    useEffect(() => {
        if (toast?.kind !== "info") return;
        const t = setTimeout(() => setToast(null), 2500);
        return () => clearTimeout(t);
    }, [toast]);

    const refreshBoards = useCallback(async () => {
        try {
            const list = await whiteboardApi.listWhiteboards();
            setBoards(list);
            return list;
        } catch (e) {
            showError(errorMessage(e));
            return [];
        }
    }, [showError]);

    const refreshFolders = useCallback(async () => {
        try {
            setFolders(await whiteboardApi.listFolders());
        } catch (e) {
            showError(errorMessage(e));
        }
    }, [showError]);

    useEffect(() => {
        refreshFolders();
        refreshBoards().then((list) => {
            const start = list.find((b) => b.id === initialCard?.boardId) ?? list[0];
            if (start) setBoardId((id) => id ?? start.id);
        });
    }, [refreshBoards]); // eslint-disable-line react-hooks/exhaustive-deps

    // Load the open board.
    useEffect(() => {
        setSelection([]);
        setSelectedLinkId(null);
        setSelectedSectionId(null);
        if (boardId === null) {
            setCards([]);
            setLinks([]);
            setSections([]);
            return;
        }
        let stale = false;
        whiteboardApi.getWhiteboard(boardId).then(
            (b) => {
                if (stale) return;
                setCards(b.cards);
                setLinks(b.links);
                setSections(b.sections);
                cardsRef.current = b.cards;
                const focus = pendingFocus.current;
                pendingFocus.current = null;
                requestAnimationFrame(() => {
                    if (focus !== null && b.cards.some((c) => c.id === focus)) {
                        selectOne(focus);
                        requestAnimationFrame(() => canvas.current?.centerOn(focus));
                    } else {
                        canvas.current?.fit();
                    }
                });
            },
            (e) => !stale && showError(errorMessage(e)),
        );
        return () => {
            stale = true;
        };
    }, [boardId, showError]);

    const openBoard = (id: number) => {
        setMode("board");
        setBoardId(id);
    };

    // ---------- boards ----------

    const createBoard = async (folderId: number | null = null) => {
        try {
            const n = boards.length + 1;
            const b = await whiteboardApi.createWhiteboard(`白板 ${n}`, folderId);
            await refreshBoards();
            openBoard(b.id);
            setRenamingId(b.id);
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    const renameBoard = async (id: number, name: string) => {
        setRenamingId(null);
        const old = boards.find((b) => b.id === id);
        if (!old || !name.trim() || name.trim() === old.name) return;
        try {
            await whiteboardApi.renameWhiteboard(id, name);
            await refreshBoards();
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    const deleteBoard = async (b: Whiteboard) => {
        if (!confirm(`刪除白板「${b.name}」？上面的 ${b.cardCount} 張卡片和它們的連結也會一併刪除，無法復原。`)) return;
        try {
            await whiteboardApi.deleteWhiteboard(b.id);
            const list = await refreshBoards();
            if (boardId === b.id) setBoardId(list[0]?.id ?? null);
            bumpLinks();
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    // ---------- folders ----------

    const folderAction = async (fn: () => Promise<unknown>) => {
        try {
            await fn();
            await Promise.all([refreshFolders(), refreshBoards()]);
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    const deleteFolder = (f: BoardFolder) => {
        if (!confirm(`刪除資料夾「${f.name}」和它的子資料夾？裡面的白板會保留，移到最上層。`)) return;
        void folderAction(() => whiteboardApi.deleteFolder(f.id));
    };

    // ---------- cards ----------

    const createCard = async (x: number, y: number) => {
        if (boardId === null) return;
        try {
            const c = await whiteboardApi.createCard(boardId, Math.round(x), Math.round(y));
            setCards((list) => [...list, c]);
            selectOne(c.id);
            setSelectedLinkId(null);
            refreshBoards();
            requestAnimationFrame(() =>
                document.querySelector<HTMLInputElement>(`[data-card-input="${c.id}"]`)?.focus(),
            );
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    const moveCards = (rects: Map<number, Rect>) =>
        setCards((list) => list.map((c) => (rects.has(c.id) ? { ...c, ...rects.get(c.id)! } : c)));

    /** Saves where cards ended up (positions come from the gesture, not possibly stale state). */
    const placeCards = async (rects: Map<number, Rect>) => {
        if (boardId === null || rects.size === 0) return;
        moveCards(rects);
        const places = [...rects].map(([cardId, r]) => ({ cardId, x: r.x, y: r.y, width: r.width, height: r.height }));
        try {
            await whiteboardApi.placeCards(boardId, places);
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    const editCard = (id: number, title: string, content: string) => {
        dirty.current.add(id);
        setCards((list) => list.map((c) => (c.id === id ? { ...c, title, content } : c)));
    };

    /** Adds `[[ ]]` links that were just created to the board, if both ends are on it. */
    const showCreatedLinks = (created: CardLink[]) => {
        if (created.length === 0) return;
        const onBoard = (n: number) => cardsRef.current.some((x) => x.id === n);
        const shown = created.filter((l) => onBoard(l.cardA) && onBoard(l.cardB));
        setLinks((list) => [...list, ...shown.filter((l) => !list.some((x) => x.id === l.id))]);
        showInfo(`依 [[ ]] 建立了 ${created.length} 條連結`);
    };

    const saveCard = async (id: number) => {
        if (!dirty.current.has(id)) return;
        dirty.current.delete(id);
        const c = cardsRef.current.find((c) => c.id === id);
        if (!c) return;
        try {
            await whiteboardApi.updateCard(id, c.title, c.content);
            showCreatedLinks(await whiteboardApi.syncWikiLinks(id, c.content));
            bumpLinks(); // titles shown in lists and the side panel
        } catch (e) {
            dirty.current.add(id);
            showError(errorMessage(e));
        }
    };

    /** Deletes cards (on this board or not) after confirming. */
    const deleteCards = async (ids: number[], title?: string) => {
        if (ids.length === 0) return;
        const n = links.filter((l) => ids.includes(l.cardA) || ids.includes(l.cardB)).length;
        const extra = n > 0 ? `${ids.length > 1 ? "它們" : "它"}的 ${n} 條連結也會一併移除，` : "";
        const name =
            ids.length > 1
                ? `這 ${ids.length} 張卡片`
                : `卡片「${untitled(title ?? cardsRef.current.find((c) => c.id === ids[0])?.title ?? "")}」`;
        if (!confirm(`刪除${name}？${extra}無法復原。`)) return;
        try {
            ids.forEach((id) => dirty.current.delete(id));
            await whiteboardApi.deleteCards(ids);
            setCards((list) => list.filter((c) => !ids.includes(c.id)));
            setLinks((list) => list.filter((l) => !ids.includes(l.cardA) && !ids.includes(l.cardB)));
            setSelection((s) => s.filter((x) => !ids.includes(x)));
            if (openCardId !== null && ids.includes(openCardId)) setOpenCardId(null);
            refreshBoards();
            bumpLinks();
        } catch (e) {
            showError(errorMessage(e));
        }
    };
    const deleteCard = (id: number) => deleteCards([id]);

    /** Reloads the Drawer items a card refers to. */
    const refreshCardItems = async (cardId: number) => {
        try {
            const items = await whiteboardApi.listCardItems(cardId);
            setCards((list) => list.map((c) => (c.id === cardId ? { ...c, items } : c)));
            bumpLinks();
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    /** Reloads the open board (after cards were added to it). */
    const reloadBoard = async (select: number | null) => {
        if (boardId === null) return;
        const b = await whiteboardApi.getWhiteboard(boardId);
        setCards(b.cards);
        setLinks(b.links);
        setSections(b.sections);
        cardsRef.current = b.cards;
        if (select !== null) {
            selectOne(select);
            setSelectedLinkId(null);
        }
        refreshBoards();
        bumpLinks();
    };

    // ---------- sections ----------

    /** A new section: around the selected cards, or in the middle of the view. */
    const createSection = async () => {
        if (boardId === null) return;
        const chosen = cardsRef.current.filter((c) => selection.includes(c.id));
        let r: Rect;
        if (chosen.length > 0) {
            const minX = Math.min(...chosen.map((c) => c.x));
            const minY = Math.min(...chosen.map((c) => c.y));
            const maxX = Math.max(...chosen.map((c) => c.x + c.width));
            const maxY = Math.max(...chosen.map((c) => c.y + c.height));
            r = { x: minX - 30, y: minY - 56, width: maxX - minX + 60, height: maxY - minY + 86 };
        } else {
            const c = canvas.current?.visibleCenter() ?? { x: 0, y: 0 };
            r = { x: c.x - 260, y: c.y - 170, width: 520, height: 340 };
        }
        try {
            const s = await whiteboardApi.createSection(boardId, "新區塊", Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height));
            setSections((list) => [...list, s]);
            setSelection([]);
            setSelectedSectionId(s.id);
            // Start renaming right away.
            requestAnimationFrame(() =>
                document
                    .querySelector(`[data-role="section-header"][data-section-id="${s.id}"]`)
                    ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
            );
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    const sectionChange = (s: Section) => setSections((list) => list.map((x) => (x.id === s.id ? s : x)));

    const sectionCommit = async (s: Section, movedCards: Map<number, Rect>) => {
        sectionChange(s);
        try {
            await whiteboardApi.updateSection(s);
            await placeCards(movedCards);
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    /** Rename or recolour: only title and colour change, on the latest position (never a stale one). */
    const sectionEdit = async (patch: Section) => {
        const cur = sectionsRef.current.find((x) => x.id === patch.id);
        if (!cur) return;
        const next = { ...cur, title: patch.title, color: patch.color };
        sectionChange(next);
        try {
            await whiteboardApi.updateSection(next);
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    const deleteSection = async (id: number) => {
        try {
            await whiteboardApi.deleteSection(id);
            setSections((list) => list.filter((x) => x.id !== id));
            if (selectedSectionId === id) setSelectedSectionId(null);
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    // ---------- tags on several cards ----------

    const tagSelection = async (tag: string) => {
        const t = tag.trim().replace(/^#/, "");
        if (!t) return;
        try {
            const updated = await Promise.all(
                cardsRef.current
                    .filter((c) => selection.includes(c.id))
                    .map(async (c) => [c.id, await whiteboardApi.setCardTags(c.id, [...c.tags, t])] as const),
            );
            const map = new Map(updated);
            setCards((list) => list.map((c) => (map.has(c.id) ? { ...c, tags: map.get(c.id)! } : c)));
            showInfo(`已為 ${updated.length} 張卡片加上 #${t}`);
            bumpLinks();
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    // ---------- links ----------

    /** Links two cards; a new link points from `a` to `b`. */
    const link = async (a: number, b: number) => {
        if (links.some((l) => samePair(l, a, b))) {
            showInfo("這兩張卡片已經連結了");
            return;
        }
        try {
            const l = await whiteboardApi.linkCards(a, b, true);
            const onBoard = cardsRef.current.some((c) => c.id === a) && cardsRef.current.some((c) => c.id === b);
            if (onBoard) setLinks((list) => (list.some((x) => x.id === l.id) ? list : [...list, l]));
            bumpLinks();
        } catch (e) {
            showError(errorMessage(e));
            throw e;
        }
    };

    const updateLink = async (id: number, direction: LinkDirection, note: string) => {
        try {
            const l = await whiteboardApi.updateLink(id, direction, note);
            setLinks((list) => list.map((x) => (x.id === id ? l : x)));
            bumpLinks();
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    const unlink = async (a: number, b: number) => {
        try {
            await whiteboardApi.unlinkCards(a, b);
            setLinks((list) => list.filter((l) => !samePair(l, a, b)));
            setSelectedLinkId(null);
            bumpLinks();
        } catch (e) {
            showError(errorMessage(e));
            throw e;
        }
    };

    // ---------- keyboard ----------

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const el = document.activeElement;
            const typing =
                el instanceof HTMLInputElement ||
                el instanceof HTMLTextAreaElement ||
                el instanceof HTMLSelectElement ||
                (el instanceof HTMLElement && el.isContentEditable);
            if (typing) return;
            if (e.key === "Escape") {
                if (selection.length > 0 || selectedLinkId !== null || selectedSectionId !== null) {
                    setSelection([]);
                    setSelectedLinkId(null);
                    setSelectedSectionId(null);
                } else if (openCardId !== null) {
                    setOpenCardId(null);
                }
                return;
            }
            if (mode !== "board") return;
            if (e.key === "Enter" && selectedCardId !== null) {
                e.preventDefault();
                setOpenCardId(selectedCardId);
                return;
            }
            if ((e.key === "a" || e.key === "A") && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                setSelection(cardsRef.current.map((c) => c.id));
                return;
            }
            if (e.key !== "Delete" && e.key !== "Backspace") return;
            const l = links.find((l) => l.id === selectedLinkId);
            if (l) {
                e.preventDefault();
                unlink(l.cardA, l.cardB).catch(() => {});
            } else if (selectedSectionId !== null) {
                e.preventDefault();
                void deleteSection(selectedSectionId);
            } else if (selection.length > 0 && e.key === "Delete") {
                e.preventDefault();
                void deleteCards(selection);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    // ---------- drag from the side list ----------

    const [drag, setDrag] = useState<{ payload: DragPayload; x: number; y: number } | null>(null);
    /** Where the drag would drop: a card on the board, empty board space, or nowhere. */
    const [dropAt, setDropAt] = useState<{ kind: "card"; cardId: number } | { kind: "board" } | null>(null);
    /** Set right after a drop so the row's click does not also open the card. */
    const justDropped = useRef(false);

    const dropTarget = (clientX: number, clientY: number) => {
        const el = document.elementFromPoint(clientX, clientY);
        if (!el?.closest(".wb-canvas") || el.closest(".wb-zoom")) return null;
        const cardEl = el.closest<HTMLElement>("[data-card-id]");
        return cardEl ? { kind: "card" as const, cardId: Number(cardEl.dataset.cardId) } : { kind: "board" as const };
    };

    const startDrag = (e: React.PointerEvent, payload: DragPayload) => {
        if (e.button !== 0) return;
        const sx = e.clientX;
        const sy = e.clientY;
        let started = false;
        const move = (ev: PointerEvent) => {
            if (!started && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 5) return;
            started = true;
            ev.preventDefault();
            setDrag({ payload, x: ev.clientX, y: ev.clientY });
            setDropAt(dropTarget(ev.clientX, ev.clientY));
        };
        const finish = (ev: PointerEvent | null) => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("keydown", key, true);
            setDrag(null);
            setDropAt(null);
            if (!started) return;
            justDropped.current = true;
            setTimeout(() => (justDropped.current = false), 0);
            if (!ev) return;
            const target = dropTarget(ev.clientX, ev.clientY);
            if (target) drop(payload, target, ev.clientX, ev.clientY);
        };
        const up = (ev: PointerEvent) => finish(ev);
        const key = (ev: KeyboardEvent) => {
            if (ev.key === "Escape") {
                ev.preventDefault();
                ev.stopPropagation();
                finish(null);
            }
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("keydown", key, true);
    };

    const drop = async (
        payload: DragPayload,
        target: { kind: "card"; cardId: number } | { kind: "board" },
        clientX: number,
        clientY: number,
    ) => {
        if (boardId === null) return;
        const titleOf = (id: number) => untitled(cardsRef.current.find((c) => c.id === id)?.title ?? "");
        try {
            if (target.kind === "card") {
                if (payload.kind === "card") {
                    if (payload.id === target.cardId) return;
                    if (links.some((l) => samePair(l, payload.id, target.cardId))) {
                        showInfo("這兩張卡片已經連結了");
                        return;
                    }
                    await link(payload.id, target.cardId);
                    showInfo(`已連結「${payload.title}」與「${titleOf(target.cardId)}」`);
                } else {
                    const card = cardsRef.current.find((c) => c.id === target.cardId);
                    if (card?.items.some((i) => i.itemId === payload.id)) {
                        showInfo("這張卡片已經引用了這筆文獻");
                        return;
                    }
                    await whiteboardApi.linkCardItem(target.cardId, payload.id);
                    await refreshCardItems(target.cardId);
                    selectOne(target.cardId);
                    showInfo(`「${titleOf(target.cardId)}」已引用「${payload.title}」`);
                }
                return;
            }
            // Empty board space: put the card there (its top-left a little left of the cursor).
            const p = canvas.current?.toBoard(clientX, clientY) ?? { x: 0, y: 0 };
            const x = Math.round(p.x - 40);
            const y = Math.round(p.y - 20);
            if (payload.kind === "card") {
                if (cardsRef.current.some((c) => c.id === payload.id)) {
                    locateCard(payload.id, boardId);
                    showInfo("這張卡片已經在這個白板上");
                    return;
                }
                await whiteboardApi.addCardToBoard(boardId, payload.id, x, y);
                await reloadBoard(payload.id);
            } else {
                const note = await whiteboardApi.createItemCard(payload.id);
                await whiteboardApi.addCardToBoard(boardId, note.cardId, x, y);
                await reloadBoard(note.cardId);
                showInfo(`已建立筆記卡片「${untitled(note.title)}」`);
            }
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    const dragHint = (() => {
        if (!drag) return "";
        const p = drag.payload;
        if (!dropAt) return "放開以取消（Esc 取消）";
        if (dropAt.kind === "board") {
            if (p.kind === "item") return "放開：建立引用它的筆記卡片";
            return cards.some((c) => c.id === p.id) ? "已在這個白板上" : "放開：放到白板上";
        }
        const target = untitled(cards.find((c) => c.id === dropAt.cardId)?.title ?? "");
        if (p.kind === "card") {
            if (p.id === dropAt.cardId) return "就是這張卡片";
            return links.some((l) => samePair(l, p.id, dropAt.cardId)) ? "已經連結了" : `連結到「${target}」`;
        }
        return cards.find((c) => c.id === dropAt.cardId)?.items.some((i) => i.itemId === p.id)
            ? "已經引用了"
            : `讓「${target}」引用`;
    })();

    // ---------- opening and locating cards ----------

    /** Shows the card on a board: select it and scroll to it (switching boards if needed). */
    const locateCard = (cardId: number, onBoard: number | null) => {
        if (mode === "board" && cardsRef.current.some((c) => c.id === cardId)) {
            selectOne(cardId);
            setSelectedLinkId(null);
            canvas.current?.centerOn(cardId);
        } else if (onBoard !== null) {
            setMode("board");
            if (onBoard === boardId && cardsRef.current.some((c) => c.id === cardId)) {
                requestAnimationFrame(() => {
                    selectOne(cardId);
                    canvas.current?.centerOn(cardId);
                });
            } else {
                pendingFocus.current = cardId;
                setBoardId(onBoard);
            }
        } else {
            showInfo("這張卡片不在任何白板上");
        }
    };

    /** Opens the card in the side panel; on the open board it is also selected and scrolled to. */
    const openPanel = (cardId: number) => {
        setOpenCardId(cardId);
        if (mode === "board" && cardsRef.current.some((c) => c.id === cardId)) {
            selectOne(cardId);
            setSelectedLinkId(null);
            canvas.current?.centerOn(cardId);
        }
    };

    /** The side panel saved a card: mirror it on the board. */
    const panelSaved = (c: CardDetail, created: CardLink[]) => {
        setCards((list) => list.map((x) => (x.id === c.id ? { ...x, title: c.title, content: c.content, tags: c.tags } : x)));
        showCreatedLinks(created);
        bumpLinks();
    };

    /** `[[title]]` in a card: open the card with that title (this board first, then anywhere). */
    const openWikiLink = async (target: string) => {
        const key = target.trim().toLowerCase();
        const here = cardsRef.current.find((c) => c.title.trim().toLowerCase() === key);
        if (here) {
            openPanel(here.id);
            return;
        }
        try {
            const hits = await whiteboardApi.searchCards(target, null);
            const hit = hits.find((h) => h.title.trim().toLowerCase() === key);
            if (hit) setOpenCardId(hit.cardId);
            else showInfo(`找不到標題為「${target}」的卡片`);
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    const createLooseCard = async () => {
        try {
            const c = await whiteboardApi.createLooseCard();
            setOpenCardId(c.id);
            bumpLinks();
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    const selectedCard = cards.find((c) => c.id === selectedCardId) ?? null;
    const selectedLink = links.find((l) => l.id === selectedLinkId) ?? null;
    const titleOf = (id: number) => untitled(cards.find((c) => c.id === id)?.title ?? "");
    const board = boards.find((b) => b.id === boardId);
    const showSidebar = mode === "board" && boardId !== null;

    const sidebarBottom = selectedLink ? (
        <LinkEditor
            link={selectedLink}
            titleA={titleOf(selectedLink.cardA)}
            titleB={titleOf(selectedLink.cardB)}
            focusKey={noteFocus}
            onChange={(d, n) => updateLink(selectedLink.id, d, n)}
            onUnlink={() => void unlink(selectedLink.cardA, selectedLink.cardB).catch(() => {})}
        />
    ) : selection.length > 1 ? (
        <MultiSelection
            count={selection.length}
            onSection={() => void createSection()}
            onTag={(t) => void tagSelection(t)}
            onDelete={() => void deleteCards(selection)}
            onClear={() => setSelection([])}
        />
    ) : undefined;

    return (
        <div className={`whiteboard${showSidebar ? " with-panel" : ""}${drag ? " dragging" : ""}`}>
            <BoardTree
                folders={folders}
                boards={boards}
                boardId={mode === "board" ? boardId : null}
                libraryActive={mode === "library"}
                onOpenLibrary={() => setMode("library")}
                onOpenBoard={openBoard}
                onCreateBoard={(f) => void createBoard(f)}
                renamingBoard={renamingId}
                setRenamingBoard={setRenamingId}
                onRenameBoard={(id, name) => void renameBoard(id, name)}
                onDeleteBoard={deleteBoard}
                onCreateFolder={(name, parentId) => folderAction(() => whiteboardApi.createFolder(name, parentId))}
                onRenameFolder={(id, name) => folderAction(() => whiteboardApi.renameFolder(id, name))}
                onDeleteFolder={deleteFolder}
                onMoveBoard={(id, f) => {
                    const b = boards.find((x) => x.id === id);
                    if (b && b.folderId !== f) void folderAction(() => whiteboardApi.moveWhiteboard(id, f));
                }}
                onMoveFolder={(id, parent) => {
                    const f = folders.find((x) => x.id === id);
                    if (!f || f.parentId === parent) return;
                    if (parent !== null && folderSubtree(folders, id).has(parent)) {
                        showInfo("不能把資料夾移到它自己裡面");
                        return;
                    }
                    void folderAction(() => whiteboardApi.moveFolder(id, parent));
                }}
            />

            <section className={`wb-main${openCardId !== null ? " panel-open" : ""}`}>
                {mode === "library" ? (
                    <>
                        <div className="pane-header wb-header">
                            <span className="pane-title">🗂 卡片庫</span>
                            <span className="muted wb-tips">所有卡片，包括不在任何白板上的。點卡片在側邊面板開啟。</span>
                        </div>
                        <CardLibrary
                            reloadKey={linksVersion}
                            openCardId={openCardId}
                            onOpen={setOpenCardId}
                            onCreate={() => void createLooseCard()}
                            onError={showError}
                        />
                    </>
                ) : board ? (
                    <>
                        <div className="pane-header wb-header">
                            <span className="pane-title">{board.name}</span>
                            <span className="pane-count">
                                {cards.length} 張卡片 · {links.length} 條連結
                                {sections.length > 0 ? ` · ${sections.length} 個區塊` : ""}
                            </span>
                            <span className="muted wb-tips">
                                拖曳空白處框選 · Shift＋點選多選 · 空白鍵＋拖曳或滾輪平移 · Ctrl＋滾輪縮放 · ↗ 或 Enter 在側邊開啟卡片
                            </span>
                            <button className="small-btn wb-header-btn" title="新增區塊（選取卡片時會包住它們）" onClick={() => void createSection()}>
                                <Icon name="section" /> 區塊
                            </button>
                            <button
                                className="primary-btn"
                                onClick={() => {
                                    const c = canvas.current?.visibleCenter() ?? { x: 0, y: 0 };
                                    createCard(c.x - 120, c.y - 80);
                                }}
                            >
                                ＋ 新卡片
                            </button>
                        </div>
                        <BoardCanvas
                            key={board.id}
                            handle={canvas}
                            cards={cards}
                            links={links}
                            sections={sections}
                            selectedIds={selection}
                            selectedLinkId={selectedLinkId}
                            selectedSectionId={selectedSectionId}
                            openCardId={openCardId}
                            onSelect={setSelection}
                            onSelectLink={setSelectedLinkId}
                            onSelectSection={setSelectedSectionId}
                            onCreateCard={createCard}
                            onMoveCards={moveCards}
                            onPlaceCards={(rects) => void placeCards(rects)}
                            onEditCard={editCard}
                            onSaveCard={saveCard}
                            onDeleteCard={deleteCard}
                            onOpenCard={openPanel}
                            onLink={(a, b) => link(a, b).catch(() => {})}
                            onUnlink={(l) => unlink(l.cardA, l.cardB).catch(() => {})}
                            onEditLink={(id) => {
                                setSelectedLinkId(id);
                                setSelection([]);
                                setNoteFocus((n) => n + 1);
                            }}
                            onOpenItem={onOpenItem}
                            onWikiLink={(t) => void openWikiLink(t)}
                            onSectionChange={sectionChange}
                            onSectionCommit={(s, moved) => void sectionCommit(s, moved)}
                            onSectionEdit={(s) => void sectionEdit(s)}
                            onDeleteSection={(id) => void deleteSection(id)}
                            dropTargetId={dropAt?.kind === "card" ? dropAt.cardId : null}
                        />
                    </>
                ) : (
                    <div className="wb-none">
                        <p className="muted">建立一個白板，開始擺放卡片</p>
                        <button className="primary-btn" onClick={() => void createBoard(null)}>
                            ＋ 新增白板
                        </button>
                    </div>
                )}

                {openCardId !== null && (
                    <CardPanel
                        key={openCardId}
                        cardId={openCardId}
                        boardId={mode === "board" ? boardId : null}
                        reloadKey={linksVersion}
                        onClose={() => setOpenCardId(null)}
                        onSaved={panelSaved}
                        onLocate={locateCard}
                        onOpenCard={openPanel}
                        onOpenItem={onOpenItem}
                        onWikiLink={(t) => void openWikiLink(t)}
                        onDelete={(id) => void deleteCards([id])}
                        onError={showError}
                    />
                )}
            </section>

            {showSidebar && (
                <WhiteboardSidebar
                    boardId={boardId!}
                    onBoard={new Set(cards.map((c) => c.id))}
                    selectedCard={selectedCard}
                    reloadKey={linksVersion}
                    onStartDrag={startDrag}
                    onOpenCard={(id) => !justDropped.current && openPanel(id)}
                    onUnlink={(other) => (selectedCard ? unlink(selectedCard.id, other) : Promise.resolve())}
                    onDelete={deleteCard}
                    onOpenItem={(id) => !justDropped.current && onOpenItem(id)}
                    onItemsChanged={() => selectedCard && refreshCardItems(selectedCard.id)}
                    onError={showError}
                    bottom={sidebarBottom}
                />
            )}

            {drag && (
                <div className="drag-ghost" style={{ left: drag.x + 14, top: drag.y + 10 }}>
                    <div className="drag-ghost-title">
                        <Icon name={drag.payload.kind === "card" ? "note" : "library"} /> {drag.payload.title}
                    </div>
                    <div className="drag-ghost-hint">{dragHint}</div>
                </div>
            )}

            {toast && (
                <div className={`toast${toast.kind === "info" ? " info" : ""}`} onClick={() => setToast(null)}>
                    {toast.text}
                    <span className="toast-close">×</span>
                </div>
            )}
        </div>
    );
}

/** Right pane, bottom, when several cards are selected. */
function MultiSelection({
    count,
    onSection,
    onTag,
    onDelete,
    onClear,
}: {
    count: number;
    onSection: () => void;
    onTag: (tag: string) => void;
    onDelete: () => void;
    onClear: () => void;
}) {
    const [tag, setTag] = useState("");
    return (
        <section className="wb-selected wb-multi">
            <div className="wb-selected-header">
                <span className="wb-selected-title">已選取 {count} 張卡片</span>
                <button className="small-btn" onClick={onClear} title="取消選取（Esc）">取消選取</button>
            </div>
            <div className="wb-selected-body">
                <p className="muted wb-hint">拖曳其中一張卡片的把手可以一起移動。</p>
                <button className="wb-multi-btn" onClick={onSection}><Icon name="section" /> 包成區塊</button>
                <div className="wb-multi-tag">
                    <input
                        className="wb-search"
                        placeholder="為全部加上標籤…"
                        value={tag}
                        onChange={(e) => setTag(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && tag.trim()) {
                                onTag(tag);
                                setTag("");
                            }
                        }}
                    />
                    <button
                        className="small-btn"
                        disabled={!tag.trim()}
                        onClick={() => {
                            onTag(tag);
                            setTag("");
                        }}
                    >
                        加上
                    </button>
                </div>
                <button className="danger-btn wb-multi-delete" onClick={onDelete}>刪除 {count} 張卡片（Delete）</button>
            </div>
        </section>
    );
}

export default WhiteboardView;
