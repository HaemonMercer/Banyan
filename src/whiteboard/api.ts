import { invoke } from "@tauri-apps/api/core";
import type { CardKind } from "./objects";
import { extractWikiLinks } from "../markdown";

export interface Whiteboard {
    id: number;
    name: string;
    /** Folder the board is in; null = top level. */
    folderId: number | null;
    cardCount: number;
    updatedAt: number;
}

/** A card as placed on one board (position and size are in board coordinates). */
export interface BoardCard {
    id: number;
    /** What the object is: a Markdown note (default), sticky note, image, video, PDF or mind map. */
    kind: CardKind;
    title: string;
    content: string;
    /** The kind's JSON (see `objects.ts`); "" for notes. */
    data: string;
    x: number;
    y: number;
    width: number;
    height: number;
    updatedAt: number;
    /** Drawer items this card refers to. */
    items: ItemRef[];
    tags: string[];
}

/** A named region on a board; the cards inside move with it. */
export interface Section {
    id: number;
    boardId: number;
    title: string;
    /** "" (default), "blue", "green", "yellow", "red" or "purple". */
    color: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

export const SECTION_COLORS = ["", "blue", "green", "yellow", "red", "purple"] as const;

/** A section a card is in (card library). */
export interface SectionRef {
    id: number;
    title: string;
    color: string;
    boardId: number;
    boardName: string;
}

export interface BoardRef {
    id: number;
    name: string;
}

/** Everything about one card (side panel). */
export interface CardDetail {
    id: number;
    kind: CardKind;
    title: string;
    content: string;
    data: string;
    tags: string[];
    items: ItemRef[];
    boards: BoardRef[];
    createdAt: number;
    updatedAt: number;
}

/** A saved state of a card (Version Machine). */
export interface CardVersion {
    id: number;
    cardId: number;
    title: string;
    content: string;
    data: string;
    /** "" for an automatic version. */
    name: string;
    createdAt: number;
    /** Last time edits were folded into this version. */
    updatedAt: number;
}

/** A row of the card library. */
export interface LibraryCard {
    id: number;
    kind: CardKind;
    title: string;
    content: string;
    data: string;
    tags: string[];
    boards: BoardRef[];
    /** Sections it sits in (entirely inside), on any board. */
    sections: SectionRef[];
    /** Drawer items it cites (drawn on the card face). */
    items: ItemRef[];
    /** Size on its first board; null when it is on no board. */
    width: number | null;
    height: number | null;
    linkCount: number;
    itemCount: number;
    createdAt: number;
    updatedAt: number;
}

export interface CardQuery {
    query?: string;
    tag?: string | null;
    placement?: "all" | "placed" | "unplaced";
    sort?: "updated" | "created" | "title";
}

export interface TagCount {
    name: string;
    count: number;
}

/** A Drawer item referenced by a card. */
export interface ItemRef {
    itemId: number;
    itemType: string;
    title: string;
    authors: string;
    date: string;
}

/** A card that refers to a Drawer item (shown in the item's detail pane). */
export interface ItemCard {
    cardId: number;
    title: string;
    content: string;
    /** A board the card is on, for opening it there. */
    boardId: number | null;
    boards: string[];
    updatedAt: number;
}

/**
 * A link between two cards; `cardA` is always the smaller id.
 * `direction`: 0 no arrow, 1 cardA → cardB, 2 cardB → cardA, 3 both ways.
 */
export interface CardLink {
    id: number;
    cardA: number;
    cardB: number;
    direction: LinkDirection;
    /** Short label shown on the line. */
    note: string;
}

export type LinkDirection = 0 | 1 | 2 | 3;

/** Does the link have an arrow pointing at `cardId`? */
export function pointsTo(l: CardLink, cardId: number): boolean {
    return l.direction === 3 || (l.direction === 1 && l.cardB === cardId) || (l.direction === 2 && l.cardA === cardId);
}

/** Direction value for "from → to" (or both / none), whatever the id order. */
export function directionFor(l: CardLink, from: number, kind: "none" | "forward" | "backward" | "both"): LinkDirection {
    if (kind === "none") return 0;
    if (kind === "both") return 3;
    const forwardIsAB = from === l.cardA;
    return (kind === "forward") === forwardIsAB ? 1 : 2;
}

export interface BoardFolder {
    id: number;
    name: string;
    parentId: number | null;
}

export interface GraphNode {
    id: number;
    kind: CardKind;
    title: string;
    tags: string[];
    boardIds: number[];
}

export interface Graph {
    cards: GraphNode[];
    /** Links between two of the cards. */
    links: CardLink[];
    /** Drawer items the cards refer to. */
    items: ItemRef[];
    refs: { cardId: number; itemId: number }[];
}

export interface BoardContents {
    board: Whiteboard;
    cards: BoardCard[];
    /** Links whose two cards are both on this board. */
    links: CardLink[];
    sections: Section[];
}

/** The other end of a link, seen from one card. */
export interface LinkedCard {
    linkId: number;
    cardId: number;
    title: string;
    /** Seen from the card asked about: it points to the other ("out"), is pointed at ("in"), both, or no arrow. */
    direction: "out" | "in" | "both" | "none";
    note: string;
    /** A board that card is on, for jumping to it. */
    boardId: number | null;
    /** Names of the boards that card is on. */
    boards: string[];
}

/** A card found by `searchCards`. */
export interface CardHit {
    cardId: number;
    kind: CardKind;
    title: string;
    /** The card's Markdown (for previews). */
    content: string;
    boardId: number | null;
    boards: string[];
}

export const whiteboardApi = {
    listWhiteboards: () => invoke<Whiteboard[]>("list_whiteboards"),
    createWhiteboard: (name: string, folderId: number | null = null) =>
        invoke<Whiteboard>("create_whiteboard", { name, folderId }),
    moveWhiteboard: (id: number, folderId: number | null) => invoke<void>("move_whiteboard", { id, folderId }),

    listFolders: () => invoke<BoardFolder[]>("list_whiteboard_folders"),
    createFolder: (name: string, parentId: number | null) =>
        invoke<BoardFolder>("create_whiteboard_folder", { name, parentId }),
    renameFolder: (id: number, name: string) => invoke<void>("rename_whiteboard_folder", { id, name }),
    /** Deletes the folder and sub-folders; their boards move to the top level. */
    deleteFolder: (id: number) => invoke<void>("delete_whiteboard_folder", { id }),
    moveFolder: (id: number, parentId: number | null) => invoke<void>("move_whiteboard_folder", { id, parentId }),

    /** Cards on these boards (all cards when null), their links and the Drawer items they cite. */
    getGraph: (boardIds: number[] | null, tag: string | null = null) => invoke<Graph>("get_graph", { boardIds, tag }),

    createSection: (boardId: number, title: string, x: number, y: number, width: number, height: number) =>
        invoke<Section>("create_section", { boardId, title, x, y, width, height }),
    updateSection: (s: Section) =>
        invoke<void>("update_section", { id: s.id, title: s.title, color: s.color, x: s.x, y: s.y, width: s.width, height: s.height }),
    /** Deletes the section only; its cards stay. */
    deleteSection: (id: number) => invoke<void>("delete_section", { id }),

    /** Moves or resizes several cards on a board at once. */
    placeCards: (boardId: number, places: { cardId: number; x: number; y: number; width: number; height: number }[]) =>
        invoke<void>("place_cards", { boardId, places }),
    /** Deletes cards everywhere: every board and the card library. */
    deleteCards: (ids: number[]) => invoke<void>("delete_cards", { ids }),
    /** Takes cards off one board only; they stay in the library and on other boards. Returns how many. */
    removeCardsFromBoard: (boardId: number, ids: number[]) =>
        invoke<number>("remove_cards_from_board", { boardId, ids }),

    /** Replaces a card's tags; returns them as stored. */
    setCardTags: (cardId: number, tags: string[]) => invoke<string[]>("set_card_tags", { cardId, tags }),
    listCardTags: () => invoke<TagCount[]>("list_card_tags"),
    getCard: (id: number) => invoke<CardDetail>("get_card", { id }),
    /** A new empty card on no board. */
    createLooseCard: () => invoke<CardDetail>("create_loose_card"),
    listCards: (filter: CardQuery) => invoke<LibraryCard[]>("list_cards", { filter }),
    renameWhiteboard: (id: number, name: string) => invoke<void>("rename_whiteboard", { id, name }),
    deleteWhiteboard: (id: number) => invoke<void>("delete_whiteboard", { id }),
    getWhiteboard: (id: number) => invoke<BoardContents>("get_whiteboard", { id }),

    createCard: (boardId: number, x: number, y: number) => invoke<BoardCard>("create_card", { boardId, x, y }),
    updateCard: (id: number, title: string, content: string) =>
        invoke<void>("update_card", { id, title, content }),
    /** A board object of any kind at the rectangle (files are added afterwards). */
    createObject: (boardId: number, kind: CardKind, r: { x: number; y: number; width: number; height: number }, title = "", content = "", data = "") =>
        invoke<BoardCard>("create_board_object", { boardId, kind, ...r, title, content, data }),
    /** Saves title, content and the kind's data together. */
    updateCardData: (id: number, title: string, content: string, data: string) =>
        invoke<void>("update_card_data", { id, title, content, data }),

    /** System picker for an image or a PDF; null when cancelled. */
    pickCardFile: (kind: "image" | "pdf") => invoke<string | null>("pick_card_file", { kind }),
    /** Copies a file into the card's folder; returns its stored name. */
    importCardFile: (cardId: number, path: string) => invoke<string>("import_card_file", { cardId, path }),
    /** Saves bytes (e.g. a pasted screenshot) as a file of the card; returns its stored name. */
    saveCardFile: (cardId: number, name: string, bytes: Uint8Array) =>
        invoke<string>("save_card_file", bytes, {
            headers: { "x-card-id": String(cardId), "x-file-name": encodeURIComponent(name) },
        }),
    readCardFile: (cardId: number, name: string) => invoke<ArrayBuffer>("read_card_file", { cardId, name }),
    openCardFile: (cardId: number, name: string) => invoke<void>("open_card_file", { cardId, name }),
    revealCardFile: (cardId: number, name: string) => invoke<void>("reveal_card_file", { cardId, name }),
    placeCard: (boardId: number, cardId: number, x: number, y: number, width: number, height: number) =>
        invoke<void>("place_card", { boardId, cardId, x, y, width, height }),
    deleteCard: (id: number) => invoke<void>("delete_card", { id }),

    /** With `directed`, a new link points from `a` to `b`. An existing link is returned unchanged. */
    linkCards: (a: number, b: number, directed = false) => invoke<CardLink>("link_cards", { a, b, directed }),
    updateLink: (id: number, direction: LinkDirection, note: string) =>
        invoke<CardLink>("update_link", { id, direction, note }),
    unlinkCards: (a: number, b: number) => invoke<void>("unlink_cards", { a, b }),
    /**
     * After saving a card: links it to the cards its `[[titles]]` name, and to cards that already
     * mention `[[its title]]`. Only adds links; returns the new ones.
     */
    syncWikiLinks: (cardId: number, content: string) =>
        invoke<CardLink[]>("sync_wiki_links", { cardId, titles: extractWikiLinks(content) }),
    listCardLinks: (cardId: number) => invoke<LinkedCard[]>("list_card_links", { cardId }),
    /** Cards whose title or content matches; `exclude` is the card being linked from. */
    searchCards: (query: string, exclude: number | null) =>
        invoke<CardHit[]>("search_cards", { query, exclude }),

    /** A card's versions, newest first; the newest is the card as saved now. */
    listCardVersions: (cardId: number) => invoke<CardVersion[]>("list_card_versions", { cardId }),
    /** Saves the card as it is now under a name. */
    createCardVersion: (cardId: number, name: string) => invoke<CardVersion>("create_card_version", { cardId, name }),
    /** An empty name makes it an automatic version again. */
    renameCardVersion: (id: number, name: string) => invoke<CardVersion>("rename_card_version", { id, name }),
    deleteCardVersion: (id: number) => invoke<void>("delete_card_version", { id }),
    /** Puts the card back to this version; the restore is recorded as a new version. */
    restoreCardVersion: (id: number) => invoke<CardDetail>("restore_card_version", { id }),

    listCardItems: (cardId: number) => invoke<ItemRef[]>("list_card_items", { cardId }),
    linkCardItem: (cardId: number, itemId: number) => invoke<void>("link_card_item", { cardId, itemId }),
    unlinkCardItem: (cardId: number, itemId: number) => invoke<void>("unlink_card_item", { cardId, itemId }),
    listItemCards: (itemId: number) => invoke<ItemCard[]>("list_item_cards", { itemId }),
    /** New note card "筆記：<item title>", linked to the item, on no board. */
    createItemCard: (itemId: number) => invoke<ItemCard>("create_item_card", { itemId }),
    /** Puts an existing card on a board: at (x, y) when given, else right of the cards already there. */
    addCardToBoard: (boardId: number, cardId: number, x?: number, y?: number) =>
        invoke<void>("add_card_to_board", { boardId, cardId, x: x ?? null, y: y ?? null }),
};

export const MIN_CARD_WIDTH = 120;
export const MIN_CARD_HEIGHT = 60;
