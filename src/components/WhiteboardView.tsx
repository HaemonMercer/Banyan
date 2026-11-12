import { useCallback, useEffect, useRef, useState } from "react";
import { annotationApi, openAnnotation, parseLocation, placeLabel, refreshAnnotations } from "../annotator/api";
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
    LINKS_CREATED_EVENT,
} from "../whiteboard/api";
import { AUTOSAVE_MS, serial } from "../whiteboard/autosave";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { cardFileBlob, imageSize, primeCardFile } from "../whiteboard/files";
import {
    KINDS,
    fetchYouTubeTitle,
    fileNameOf,
    fitSize,
    kindForFile,
    mindMapOutline,
    newMindMap,
    parseYouTube,
    type CardKind,
} from "../whiteboard/objects";
import { loadPdf } from "../whiteboard/pdf";
import { newTable, readTable as readTableSafe, tableText, tableSize } from "../whiteboard/table";
import { chartText, snapshotFromTable, usedRange } from "../whiteboard/chart";
import InsertToolbar from "./whiteboard/InsertToolbar";
import BoardCanvas, { sectionAt, type BoardCanvasHandle, type Rect } from "./whiteboard/BoardCanvas";
import BoardTree, { folderSubtree } from "./whiteboard/BoardTree";
import CardLibrary from "./whiteboard/CardLibrary";
import CardPanel from "./whiteboard/CardPanel";
import LinkEditor from "./whiteboard/LinkEditor";
import WhiteboardSidebar, { type DragPayload } from "./whiteboard/WhiteboardSidebar";
import "./whiteboard/Whiteboard.css";
import { ask, Toast, useToast } from "./Feedback";
import { isHomeActive } from "../tabs";
import { resolveWikiTarget, WikiLinkProvider } from "../markdown/links";

const untitled = (t: string) => t || "（無標題）";
const samePair = (l: CardLink, a: number, b: number) =>
    (l.cardA === a && l.cardB === b) || (l.cardA === b && l.cardB === a);

interface Props {
    /** Card to open when the view mounts (e.g. coming from a Drawer item). */
    /** Card to show when the view opens; `boardId: 0` opens it in the side panel (a card on no board). */
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
    const { toast, showError, showInfo, close: closeToast } = useToast();

    // Saving `[[…]]` (here, in the side panel or in Drawer) made new card links: draw them.
    useEffect(() => {
        const onCreated = (e: Event) => {
            const created = (e as CustomEvent<CardLink[]>).detail;
            setLinks((list) => [...list, ...created.filter((c) => !list.some((l) => l.id === c.id))]);
            showInfo(`已依 [[ ]] 建立 ${created.length} 條卡片連結`);
        };
        window.addEventListener(LINKS_CREATED_EVENT, onCreated);
        return () => window.removeEventListener(LINKS_CREATED_EVENT, onCreated);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const canvas = useRef<BoardCanvasHandle>(null);
    const cardsRef = useRef(cards);
    cardsRef.current = cards;
    const sectionsRef = useRef(sections);
    sectionsRef.current = sections;
    /** Cards whose title or content changed since the last save. */
    const dirty = useRef(new Set<number>());
    const autosaveTimers = useRef(new Map<number, number>());
    const queueSave = useRef(serial()).current;
    /** Card to select and scroll to once the next board has loaded. */
    const pendingFocus = useRef<number | null>(initialCard?.cardId ?? null);

    const selectedCardId = selection.length === 1 ? selection[0] : null;
    const selectOne = (id: number | null) => setSelection(id === null ? [] : [id]);

    const bumpLinks = () => setLinksVersion((n) => n + 1);
    /** Bumped to load the open board again (e.g. a card placed from elsewhere). */
    const [boardLoad, setBoardLoad] = useState(0);


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

    // Load the open board — also every time it is shown again after the card library, where cards
    // may have been deleted, retagged or put on this board.
    useEffect(() => {
        if (mode !== "board") return;
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
    }, [boardId, mode, boardLoad, showError]);

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
        if (!(await ask({ title: `刪除白板「${b.name}」？`, message: `上面的 ${b.cardCount} 張卡片和它們的連結也會一併刪除，無法復原。`, confirm: "刪除", danger: true }))) return;
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

    const deleteFolder = async (f: BoardFolder) => {
        if (!(await ask({ title: `刪除資料夾「${f.name}」和它的子資料夾？`, message: "裡面的白板會保留，移到最上層。", confirm: "刪除", danger: true }))) return;
        void folderAction(() => whiteboardApi.deleteFolder(f.id));
    };

    // ---------- cards ----------

    const createCard = async (x: number, y: number) => {
        if (boardId === null) return;
        try {
            const c = await whiteboardApi.createCard(boardId, Math.round(x), Math.round(y));
            setCards((list) => [...list, c]);
            selectOne(c.id);
            void joinSections(new Map([[c.id, c]]));
            setSelectedLinkId(null);
            refreshBoards();
            bumpLinks(); // the right-hand card list shows it right away
            requestAnimationFrame(() =>
                document.querySelector<HTMLInputElement>(`[data-card-input="${c.id}"]`)?.focus(),
            );
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    const moveCards = (rects: Map<number, Rect>) =>
        setCards((list) => list.map((c) => (rects.has(c.id) ? { ...c, ...rects.get(c.id)! } : c)));

    /**
     * Saves where cards ended up (positions come from the gesture, not possibly stale state).
     * Cards dropped into a section join it (see `joinSections`), unless `join` is false.
     */
    const placeCards = async (rects: Map<number, Rect>, join = true) => {
        if (boardId === null || rects.size === 0) return;
        moveCards(rects);
        const places = [...rects].map(([cardId, r]) => ({ cardId, x: r.x, y: r.y, width: r.width, height: r.height }));
        try {
            await whiteboardApi.placeCards(boardId, places);
            if (join) await joinSections(rects);
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    /**
     * Drag-to-join: a card whose center lands in a section belongs to it. Membership is "entirely
     * inside", so a section grows to take in a card that sticks out of it (room is kept for the
     * section's title bar). Dragging the card's center out of the section leaves it.
     */
    const joinSections = async (rects: Map<number, Rect>) => {
        const grown = new Map<number, Section>();
        for (const [, r] of rects) {
            const target = sectionAt([...sectionsRef.current.map((x) => grown.get(x.id) ?? x)], r);
            if (!target) continue;
            const PAD = 20;
            const HEAD = 44;
            const left = Math.min(target.x, r.x - PAD);
            const top = Math.min(target.y, r.y - HEAD);
            const right = Math.max(target.x + target.width, r.x + r.width + PAD);
            const bottom = Math.max(target.y + target.height, r.y + r.height + PAD);
            if (left === target.x && top === target.y && right === target.x + target.width && bottom === target.y + target.height) continue;
            grown.set(target.id, { ...target, x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) });
        }
        if (grown.size === 0) return;
        setSections((list) => list.map((x) => grown.get(x.id) ?? x));
        sectionsRef.current = sectionsRef.current.map((x) => grown.get(x.id) ?? x);
        for (const sec of grown.values()) await whiteboardApi.updateSection(sec);
        bumpLinks();
    };

    const editCard = (id: number, title: string, content: string) => {
        dirty.current.add(id);
        setCards((list) => list.map((c) => (c.id === id ? { ...c, title, content } : c)));
        window.clearTimeout(autosaveTimers.current.get(id));
        autosaveTimers.current.set(
            id,
            window.setTimeout(() => {
                autosaveTimers.current.delete(id);
                void persistCard(id);
            }, AUTOSAVE_MS),
        );
    };

    /** Writes a card's title and content (autosave). */
    const persistCard = (id: number) =>
        queueSave(async () => {
            if (!dirty.current.has(id)) return;
            dirty.current.delete(id);
            const c = cardsRef.current.find((c) => c.id === id);
            if (!c) return;
            try {
                // Objects other than notes keep their kind's data (mind map tree, sticky colour…) too.
                if (c.kind && c.kind !== "note") await whiteboardApi.updateCardData(id, c.title, c.content, c.data);
                else await whiteboardApi.updateCard(id, c.title, c.content);
                if (!c.kind || c.kind === "note" || c.kind === "sticky") await whiteboardApi.syncWikiLinks(id, c.content);
                bumpLinks(); // titles and previews in the right-hand list and the card library
            } catch (e) {
                dirty.current.add(id);
                showError(errorMessage(e));
            }
        });

    /** An object's kind data changed (and with it, for mind maps, its title and outline): autosave. */
    const editData = (id: number, data: string, title?: string, content?: string) => {
        dirty.current.add(id);
        setCards((list) =>
            list.map((c) => (c.id === id ? { ...c, data, title: title ?? c.title, content: content ?? c.content } : c)),
        );
        cardsRef.current = cardsRef.current.map((c) =>
            c.id === id ? { ...c, data, title: title ?? c.title, content: content ?? c.content } : c,
        );
        window.clearTimeout(autosaveTimers.current.get(id));
        autosaveTimers.current.set(
            id,
            window.setTimeout(() => {
                autosaveTimers.current.delete(id);
                void persistCard(id).then(bumpLinks);
            }, AUTOSAVE_MS),
        );
    };

    // ---------- other objects: sticky notes, images, videos, PDFs, mind maps ----------

    /** Where a new object goes: centered on `at` (board coordinates), else the middle of the view. */
    const placeFor = (kind: CardKind, size?: { width: number; height: number }, at?: { x: number; y: number }) => {
        const { width, height } = size ?? KINDS[kind];
        const c = at ?? canvas.current?.visibleCenter() ?? { x: 0, y: 0 };
        return { x: Math.round(c.x - width / 2), y: Math.round(c.y - height / 2), width, height };
    };

    const addObject = async (
        kind: CardKind,
        rect: { x: number; y: number; width: number; height: number },
        title = "",
        content = "",
        data = "",
    ) => {
        if (boardId === null) return null;
        const c = await whiteboardApi.createObject(boardId, kind, rect, title, content, data);
        setCards((list) => [...list, c]);
        cardsRef.current = [...cardsRef.current, c];
        selectOne(c.id);
        void joinSections(new Map([[c.id, c]]));
        setSelectedLinkId(null);
        refreshBoards();
        bumpLinks(); // the right-hand card list shows it right away
        return c;
    };

    /** Writes an object's data right away (after a file was added to it). */
    const setObjectData = async (id: number, data: string, rect?: Rect, title?: string) => {
        const c = cardsRef.current.find((x) => x.id === id);
        if (!c) return;
        const next = { ...c, data, ...(rect ?? {}), title: title ?? c.title };
        setCards((list) => list.map((x) => (x.id === id ? next : x)));
        cardsRef.current = cardsRef.current.map((x) => (x.id === id ? next : x));
        await whiteboardApi.updateCardData(id, next.title, next.content, data);
        if (rect && boardId !== null) await whiteboardApi.placeCards(boardId, [{ cardId: id, ...rect }]);
    };

    const createSticky = async (at?: { x: number; y: number }) => {
        try {
            const c = await addObject("sticky", placeFor("sticky", undefined, at), "", "", JSON.stringify({ color: "yellow" }));
            if (c) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-card-content="${c.id}"]`)?.focus());
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    const createMindMap = async () => {
        try {
            const m = newMindMap();
            await addObject("mindmap", placeFor("mindmap"), m.root.text, mindMapOutline(m), JSON.stringify(m));
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    const createTable = async () => {
        try {
            const t = newTable();
            await addObject("table", placeFor("table", tableSize(t)), "表格", tableText(t), JSON.stringify(t));
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    /** A chart of a range of a table on this board, placed to the table's right. */
    const createChart = async (tableId: number, range: string) => {
        const t = cardsRef.current.find((c) => c.id === tableId);
        if (!t) return;
        const snapshot = snapshotFromTable(t.data, range, "col") ?? { labels: [], series: [] };
        const data = { type: "column", source: { cardId: tableId, range }, seriesBy: "col", legend: true, snapshot };
        // To the table's right; below any chart (or card) already there.
        const rect = { x: Math.round(t.x + t.width + 40), y: Math.round(t.y), width: KINDS.chart.width, height: KINDS.chart.height };
        const hits = (r: typeof rect) =>
            cardsRef.current.some((c) => c.id !== tableId && r.x < c.x + c.width && c.x < r.x + r.width && r.y < c.y + c.height && c.y < r.y + r.height);
        for (let i = 0; i < 50 && hits(rect); i++) rect.y += 40;
        try {
            await addObject(
                "chart",
                rect,
                `${t.title || "表格"} 圖表`,
                chartText(snapshot),
                JSON.stringify(data),
            );
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    /** Toolbar "圖表": a chart of the selected table; with no table selected, a sample table and its chart. */
    const createChartFromToolbar = async () => {
        const sel = selection.length === 1 ? cardsRef.current.find((c) => c.id === selection[0]) : undefined;
        if (sel?.kind === "table") {
            await createChart(sel.id, usedRange(readTableSafe(sel.data)));
            return;
        }
        const t = newTable(3, 5);
        const rows = [["月份", "收入", "支出"], ["一月", "120", "80"], ["二月", "150", "95"], ["三月", "135", "110"], ["四月", "180", "120"]];
        rows.forEach((row, r) => row.forEach((v, c) => (t.rows[r].cells[t.cols[c].id] = v)));
        try {
            const size = tableSize(t);
            // The pair (table, then its chart) is centred in the view.
            const pair = placeFor("table", { width: size.width + KINDS.chart.width + 40, height: Math.max(size.height, KINDS.chart.height) });
            const table = await addObject("table", { x: pair.x, y: pair.y, ...size }, "範例資料", tableText(t), JSON.stringify(t));
            if (table) await createChart(table.id, usedRange(t));
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    const createVideo = async (url: string, at?: { x: number; y: number }) => {
        const v = parseYouTube(url);
        if (!v) {
            showError("看不懂這個連結：請貼上 YouTube 影片的網址（youtube.com/watch?v=…、youtu.be/…、shorts/…）");
            return false;
        }
        try {
            const c = await addObject("video", placeFor("video", undefined, at), "", "", JSON.stringify(v));
            // The title comes from YouTube when it can be reached.
            if (c) {
                const title = await fetchYouTubeTitle(v);
                if (title && !cardsRef.current.find((x) => x.id === c.id)?.title) editData(c.id, c.data, title);
            }
            return true;
        } catch (e) {
            showError(errorMessage(e));
            return false;
        }
    };

    /** Image or PDF from a path on disk (picked or dropped). */
    const createFileObject = async (path: string, at?: { x: number; y: number }) => {
        const kind = kindForFile(path);
        if (!kind) {
            showError(`「${fileNameOf(path)}」不是圖片或 PDF，不能放到白板上`);
            return;
        }
        let card: BoardCard | null = null;
        try {
            card = await addObject(kind, placeFor(kind, undefined, at));
            if (!card) return;
            const file = await whiteboardApi.importCardFile(card.id, path);
            await finishFileObject(card, kind, file);
        } catch (e) {
            showError(errorMessage(e));
            if (card) await whiteboardApi.deleteCards([card.id]).catch(() => {});
            if (card) setCards((list) => list.filter((c) => c.id !== card!.id));
        }
    };

    /** After the file is stored: read its size (or pages) and fit the object to it. */
    const finishFileObject = async (card: BoardCard, kind: "image" | "pdf", file: string, blob?: Blob) => {
        const cx = card.x + card.width / 2;
        const cy = card.y + card.height / 2;
        if (kind === "image") {
            if (blob) primeCardFile(card.id, file, blob);
            const natural = await imageSize(blob ?? (await cardFileBlob(card.id, file)));
            const s = fitSize(natural.width, natural.height);
            await setObjectData(card.id, JSON.stringify({ file, width: natural.width, height: natural.height }), {
                x: Math.round(cx - s.width / 2),
                y: Math.round(cy - s.height / 2),
                ...s,
            });
        } else {
            const doc = await loadPdf(card.id, file);
            const page = await doc.getPage(1);
            const vp = page.getViewport({ scale: 1 });
            const width = KINDS.pdf.width;
            // Grip (18) + page + page bar (30).
            const height = Math.round((vp.height / vp.width) * width + 48);
            await setObjectData(
                card.id,
                JSON.stringify({ file, pages: doc.numPages, page: 1 }),
                { x: Math.round(cx - width / 2), y: Math.round(cy - height / 2), width, height },
                fileNameOf(file).replace(/\.pdf$/i, ""),
            );
        }
        bumpLinks();
    };

    /** A pasted image (screenshot) becomes an image object. */
    const createPastedImage = async (blob: Blob, at?: { x: number; y: number }) => {
        let card: BoardCard | null = null;
        try {
            card = await addObject("image", placeFor("image", undefined, at));
            if (!card) return;
            const ext = (blob.type.split("/")[1] ?? "png").replace("jpeg", "jpg").replace("svg+xml", "svg");
            const name = blob instanceof File && blob.name && blob.name !== "image.png" ? blob.name : `貼上的圖片.${ext}`;
            const file = await whiteboardApi.saveCardFile(card.id, name, new Uint8Array(await blob.arrayBuffer()));
            await finishFileObject(card, "image", file, blob);
        } catch (e) {
            showError(errorMessage(e));
            if (card) await whiteboardApi.deleteCards([card.id]).catch(() => {});
            if (card) setCards((list) => list.filter((c) => c.id !== card!.id));
        }
    };

    const pickFile = async (kind: "image" | "pdf") => {
        try {
            const path = await whiteboardApi.pickCardFile(kind);
            if (path) await createFileObject(path);
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    // Paste on the board: images become image objects, YouTube links become videos.
    const pasteRef = useRef<(e: ClipboardEvent) => void>(() => {});
    pasteRef.current = (e: ClipboardEvent) => {
        if (mode !== "board" || boardId === null) return;
        const el = document.activeElement;
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable)) return;
        const dt = e.clipboardData;
        if (!dt) return;
        const images = [...dt.files].filter((f) => f.type.startsWith("image/"));
        if (images.length > 0) {
            e.preventDefault();
            const c = canvas.current?.visibleCenter() ?? { x: 0, y: 0 };
            images.forEach((f, i) => void createPastedImage(f, { x: c.x + i * 40, y: c.y + i * 40 }));
            return;
        }
        const text = dt.getData("text/plain").trim();
        if (text && parseYouTube(text) && !/\s/.test(text)) {
            e.preventDefault();
            void createVideo(text);
        }
    };
    useEffect(() => {
        const onPaste = (e: ClipboardEvent) => pasteRef.current(e);
        window.addEventListener("paste", onPaste);
        return () => window.removeEventListener("paste", onPaste);
    }, []);

    // Image and PDF files dropped onto the board become objects where they were dropped.
    const fileDropRef = useRef<(paths: string[], x: number, y: number) => void>(() => {});
    fileDropRef.current = (paths, x, y) => {
        if (mode !== "board" || boardId === null || !canvas.current) return;
        const at = canvas.current.toBoard(x, y);
        const usable = paths.filter((p) => kindForFile(p));
        if (usable.length === 0) {
            showInfo("只能把圖片或 PDF 拖到白板上");
            return;
        }
        usable.forEach((p, i) => void createFileObject(p, { x: at.x + i * 40, y: at.y + i * 40 }));
    };
    const [fileOver, setFileOver] = useState(false);
    useEffect(() => {
        let unlisten: (() => void) | undefined;
        let cancelled = false;
        try {
            getCurrentWebview()
                .onDragDropEvent((event) => {
                    const p = event.payload;
                    if (p.type === "enter" || p.type === "over") setFileOver(true);
                    else if (p.type === "leave") setFileOver(false);
                    else if (p.type === "drop") {
                        setFileOver(false);
                        // Positions are physical pixels.
                        const k = window.devicePixelRatio || 1;
                        fileDropRef.current(p.paths, p.position.x / k, p.position.y / k);
                    }
                })
                .then((fn) => {
                    if (cancelled) fn();
                    else unlisten = fn;
                })
                .catch(() => {});
        } catch {
            // Not running inside Tauri (e.g. a plain browser preview).
        }
        return () => {
            cancelled = true;
            unlisten?.();
        };
    }, []);

    /** The editor closed: save what is left. */
    const saveCard = async (id: number) => {
        window.clearTimeout(autosaveTimers.current.get(id));
        autosaveTimers.current.delete(id);
        await persistCard(id);
    };

    /** Deletes cards (on this board or not) after confirming. */
    const deleteCards = async (ids: number[], title?: string) => {
        if (ids.length === 0) return;
        const n = links.filter((l) => ids.includes(l.cardA) || ids.includes(l.cardB)).length;
        // Links to cards on other boards are not drawn here, so only count what is visible as a hint.
        const extra = n > 0 ? `連結（這個白板上有 ${n} 條）也會一併移除，` : "連結也會一併移除，";
        const name =
            ids.length > 1
                ? `這 ${ids.length} 張卡片`
                : `卡片「${untitled(title ?? cardsRef.current.find((c) => c.id === ids[0])?.title ?? "")}」`;
        if (
            !(await ask({
                title: `完全刪除${name}？`,
                message: `${ids.length > 1 ? "它們" : "它"}會從所有白板和卡片庫中消失，${extra}無法復原。\n\n只想從這個白板拿掉的話，請改用「從白板移除」（×、Delete）。`,
                confirm: "完全刪除",
                danger: true,
            }))
        )
            return;
        try {
            ids.forEach((id) => {
                dirty.current.delete(id);
                window.clearTimeout(autosaveTimers.current.get(id));
            });
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

    /** Takes cards off the open board only; they stay in the card library and on other boards. */
    const removeFromBoard = async (ids: number[]) => {
        if (boardId === null || ids.length === 0) return;
        try {
            ids.forEach((id) => {
                // Save pending edits first: the card lives on after leaving the board.
                if (dirty.current.has(id)) void saveCard(id);
            });
            const n = await whiteboardApi.removeCardsFromBoard(boardId, ids);
            setCards((list) => list.filter((c) => !ids.includes(c.id)));
            setLinks((list) => list.filter((l) => !ids.includes(l.cardA) && !ids.includes(l.cardB)));
            setSelection((s) => s.filter((x) => !ids.includes(x)));
            refreshBoards();
            bumpLinks();
            showInfo(n > 1 ? `已從白板移除 ${n} 張卡片（仍在卡片庫中）` : "已從白板移除（卡片仍在卡片庫中）");
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    /** Reloads the Drawer items a card refers to. */
    /** Reloads what a card cites (Drawer items and annotations). */
    const refreshCardItems = async (cardId: number) => {
        try {
            const { items, annotations } = await whiteboardApi.getCard(cardId);
            setCards((list) => list.map((c) => (c.id === cardId ? { ...c, items, annotations } : c)));
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
            await placeCards(movedCards, false); // they moved with their section
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
            if (!isHomeActive()) return; // a file tab is shown
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
                // Delete: off this board (safe); Shift+Delete: delete everywhere (asks first).
                e.preventDefault();
                if (e.shiftKey) void deleteCards(selection);
                else void removeFromBoard(selection);
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
                } else if (payload.kind === "annotation") {
                    if (!(await annotationApi.linkCard(target.cardId, payload.id))) {
                        showInfo("這張卡片已經引用了這段註解");
                        return;
                    }
                    await refreshCardItems(target.cardId);
                    refreshAnnotations();
                    selectOne(target.cardId);
                    showInfo(`「${titleOf(target.cardId)}」已引用「${payload.title}」`);
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
                const placed = cardsRef.current.find((c) => c.id === payload.id);
                if (placed) await joinSections(new Map([[placed.id, placed]]));
            } else if (payload.kind === "annotation") {
                // The card made from the annotation (made now, or the one made before).
                const a = await annotationApi.get(payload.id);
                const cardId = await annotationApi.toCard(a.id, placeLabel(parseLocation(a)));
                refreshAnnotations();
                if (cardsRef.current.some((c) => c.id === cardId)) {
                    locateCard(cardId, boardId);
                    showInfo("這段註解的卡片已經在這個白板上");
                    return;
                }
                await whiteboardApi.addCardToBoard(boardId, cardId, x, y);
                await reloadBoard(cardId);
                const placed = cardsRef.current.find((c) => c.id === cardId);
                if (placed) await joinSections(new Map([[placed.id, placed]]));
                showInfo(`已放上註解的卡片「${payload.title}」`);
            } else {
                const note = await whiteboardApi.createItemCard(payload.id);
                await whiteboardApi.addCardToBoard(boardId, note.cardId, x, y);
                await reloadBoard(note.cardId);
                const placed = cardsRef.current.find((c) => c.id === note.cardId);
                if (placed) await joinSections(new Map([[placed.id, placed]]));
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
            if (p.kind === "annotation") return "放開：放上這段註解的卡片";
            return cards.some((c) => c.id === p.id) ? "已在這個白板上" : "放開：放到白板上";
        }
        const target = untitled(cards.find((c) => c.id === dropAt.cardId)?.title ?? "");
        if (p.kind === "card") {
            if (p.id === dropAt.cardId) return "就是這張卡片";
            return links.some((l) => samePair(l, p.id, dropAt.cardId)) ? "已經連結了" : `連結到「${target}」`;
        }
        const cited =
            p.kind === "annotation"
                ? cards.find((c) => c.id === dropAt.cardId)?.annotations.some((a) => a.annotationId === p.id)
                : cards.find((c) => c.id === dropAt.cardId)?.items.some((i) => i.itemId === p.id);
        return cited ? "已經引用了" : `讓「${target}」引用`;
    })();

    // ---------- opening and locating cards ----------

    /** Shows the card on a board: select it and scroll to it (switching boards if needed). */
    const locateCard = (cardId: number, onBoard: number | null) => {
        if (mode === "board" && cardsRef.current.some((c) => c.id === cardId)) {
            selectOne(cardId);
            setSelectedLinkId(null);
            canvas.current?.centerOn(cardId);
        } else if (onBoard !== null) {
            // The board loads (again) and then selects and scrolls to the card.
            pendingFocus.current = cardId;
            setMode("board");
            setBoardId(onBoard);
            setBoardLoad((n) => n + 1);
        } else {
            showInfo("這張卡片不在任何白板上");
        }
    };

    // A card from elsewhere that isn't on a board (e.g. made from an annotation): the side panel.
    useEffect(() => {
        if (initialCard && initialCard.boardId === 0) setOpenCardId(initialCard.cardId);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    /** Opens the card in the side panel; on the open board it is also selected and scrolled to. */
    const openPanel = (cardId: number) => {
        setOpenCardId(cardId);
        if (mode === "board" && cardsRef.current.some((c) => c.id === cardId)) {
            selectOne(cardId);
            setSelectedLinkId(null);
            canvas.current?.centerOn(cardId);
        }
    };

    /** `[[link]]` in a card: open the linked card in the side panel. */
    const openWikiLink = async (target: string) => {
        try {
            const r = await resolveWikiTarget(target);
            if ("error" in r) showInfo(r.error);
            else openPanel(r.cardId);
        } catch (e) {
            showError(errorMessage(e));
        }
    };

    /** The side panel saved a card: mirror it on the board. */
    const panelSaved = (c: CardDetail) => {
        setCards((list) =>
            list.map((x) => (x.id === c.id ? { ...x, title: c.title, content: c.content, data: c.data ?? x.data, tags: c.tags } : x)),
        );
        bumpLinks();
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
            onRemove={() => void removeFromBoard(selection)}
            onClear={() => setSelection([])}
        />
    ) : undefined;

    return (
        <WikiLinkProvider onWikiLink={(t) => void openWikiLink(t)}>
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
                        </div>
                        <CardLibrary
                            reloadKey={linksVersion}
                            openCardId={openCardId}
                            onOpen={setOpenCardId}
                            onCloseCard={() => setOpenCardId(null)}
                            onCreate={() => void createLooseCard()}
                            boards={boards}
                            onChanged={() => {
                                bumpLinks();
                                refreshBoards();
                            }}
                            onError={showError}
                            onInfo={showInfo}
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
                            onRemoveCard={(id) => void removeFromBoard([id])}
                            onOpenCard={openPanel}
                            onLink={(a, b) => link(a, b).catch(() => {})}
                            onUnlink={(l) => unlink(l.cardA, l.cardB).catch(() => {})}
                            onEditLink={(id) => {
                                setSelectedLinkId(id);
                                setSelection([]);
                                setNoteFocus((n) => n + 1);
                            }}
                            onOpenItem={onOpenItem}
                            onSectionChange={sectionChange}
                            onSectionCommit={(s, moved) => void sectionCommit(s, moved)}
                            onSectionEdit={(s) => void sectionEdit(s)}
                            onDeleteSection={(id) => void deleteSection(id)}
                            dropTargetId={dropAt?.kind === "card" ? dropAt.cardId : null}
                            onEditData={editData}
                            onError={showError}
                            onInsertChart={(tableId, range) => void createChart(tableId, range)}
                            toolbar={
                                <InsertToolbar
                                    onCard={() => {
                                        const c = canvas.current?.visibleCenter() ?? { x: 0, y: 0 };
                                        void createCard(c.x - 120, c.y - 80);
                                    }}
                                    onSticky={() => void createSticky()}
                                    onSection={() => void createSection()}
                                    onImage={() => void pickFile("image")}
                                    onVideo={createVideo}
                                    onPdf={() => void pickFile("pdf")}
                                    onMindMap={() => void createMindMap()}
                                    onTable={() => void createTable()}
                                    onChart={() => void createChartFromToolbar()}
                                />
                            }
                        />
                        {fileOver && <div className="wb-file-over">圖片／PDF</div>}
                    </>
                ) : (
                    <div className="wb-none">
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
                        onDelete={(id) => void deleteCards([id])}
                        onRemoveFromBoard={
                            mode === "board" && boardId !== null ? (id) => void removeFromBoard([id]) : undefined
                        }
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
                    onRemove={(id) => void removeFromBoard([id])}
                    onOpenItem={(id) => !justDropped.current && onOpenItem(id)}
                    onOpenAnnotation={(id) => !justDropped.current && openAnnotation(id)}
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

            <Toast toast={toast} onClose={closeToast} />
        </div>
        </WikiLinkProvider>
    );
}

/** Right pane, bottom, when several cards are selected. */
function MultiSelection({
    count,
    onSection,
    onTag,
    onDelete,
    onRemove,
    onClear,
}: {
    count: number;
    onSection: () => void;
    onTag: (tag: string) => void;
    onDelete: () => void;
    onRemove: () => void;
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
                <div className="wb-delete-choices">
                    <button className="wb-multi-btn" onClick={onRemove} title="卡片仍保留在卡片庫和其他白板">
                        <Icon name="close" /> 從白板移除 {count} 張（Delete）
                    </button>
                    <button className="danger-btn wb-multi-delete" onClick={onDelete} title="從所有白板和卡片庫中刪除">
                        <Icon name="trash" /> 完全刪除 {count} 張（Shift＋Delete）
                    </button>
                </div>
            </div>
        </section>
    );
}

export default WhiteboardView;
