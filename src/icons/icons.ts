/*
 * Banyan icon set. Every icon is drawn on a 24 × 24 grid as 1.75px strokes with round caps and joins,
 * painted in `currentColor` (see Icon.tsx). Each entry is the SVG markup inside <svg>.
 * Rules for adding icons: Design/UI Style.md → 「圖示」.
 */

/** The Banyan mark: canopy, trunk and aerial roots. Used by the rail and the app icon. */
export const LOGO =
    '<path d="M4.5 11.5a2.5 2.5 0 0 1-.6-4.9A3 3 0 0 1 8 4.3a3.6 3.6 0 0 1 6.4-.6 3 3 0 0 1 4.2 2.6 2.6 2.6 0 0 1 1.5 5.2z" fill="currentColor" stroke="none"/>' +
    '<path d="M11 11c0 3.2-.3 5.8-1.3 9h4.6c-1-3.2-1.3-5.8-1.3-9z" fill="currentColor" stroke="none"/>' +
    '<path d="M6.6 11.5c0 2.6-.3 4.4-.9 6.6M8.9 11.5v4.3M15.1 11.5v5.6M17.5 11.5c0 2.4.3 4.1 1 6.3M4 20.5h16"/>';

/* ---------- modules ---------- */
const MODULE = {
    drawer: '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M4 12h16M10 7.75h4M10 16.25h4"/>',
    whiteboard:
        '<rect x="3" y="3.5" width="8.5" height="6.5" rx="1.5"/><rect x="12.5" y="14" width="8.5" height="6.5" rx="1.5"/><path d="M7.25 10v3a2 2 0 0 0 2 2h3.25"/>',
    graph:
        '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8.5" r="2.5"/><circle cx="10" cy="18" r="2.5"/><path d="M8.45 6.5l7.1 1.5M6.7 8.4l2.6 7.2M16.4 10.5l-4.8 5.5"/>',
    cardHub: '<rect x="7.5" y="3.5" width="13" height="11.5" rx="2"/><path d="M4 8v10a2.5 2.5 0 0 0 2.5 2.5H16M11 7.5h6M11 11h4"/>',
    writer: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5"/><path d="M8.5 16.5l1-3 4.5-4.5 2 2-4.5 4.5z"/>',
    slides: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M12 16v4M8.5 20h7M7 12.5l3-3 2.5 2 4-4"/>',
    publisher: '<path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5z"/><path d="M12 6.5v13"/>',
    draw: '<path d="M4.5 19.5l2.2-7.3L14 5l5 5-7.2 7.3z"/><path d="M4.5 19.5l5.4-5.4"/><circle cx="11" cy="13" r="1.4"/><path d="M14 5l1.5-1.5 5 5L19 10"/>',
    layout: '<rect x="3.5" y="3.5" width="17" height="5" rx="1.2"/><rect x="3.5" y="11" width="8" height="9.5" rx="1.2"/><rect x="14" y="11" width="6.5" height="9.5" rx="1.2"/>',
    base: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M3.5 9h17M3.5 14.5h17M9.5 9v11"/>',
    versions: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4.5v4h4"/><path d="M12 7.5V12l3 2"/>',
};

/* ---------- interface ---------- */
const UI = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    chevronRight: '<path d="M9.5 6l6 6-6 6"/>',
    chevronDown: '<path d="M6 9.5l6 6 6-6"/>',
    chevronUp: '<path d="M6 14.5l6-6 6 6"/>',
    chevronLeft: '<path d="M14.5 6l-6 6 6 6"/>',
    caretRight: '<path d="M10 7.5l5 4.5-5 4.5z" fill="currentColor"/>',
    caretDown: '<path d="M7.5 10l4.5 5 4.5-5z" fill="currentColor"/>',
    arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    arrowBoth: '<path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/>',
    lineUndirected: '<path d="M7 12h10"/><circle cx="5" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>',
    edit: '<path d="M15.5 4.5l4 4L9 19H5v-4z"/><path d="M13 7l4 4"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
    search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
    folder: '<path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
    folderOpen:
        '<path d="M3.5 17V7a2 2 0 0 1 2-2h4l2 2.5h6a2 2 0 0 1 2 2V10"/><path d="M3.5 17l2.4-6a1.5 1.5 0 0 1 1.4-1h13.2l-2.8 7.6a2 2 0 0 1-1.9 1.4H5.5a2 2 0 0 1-2-2z"/>',
    folderPlus: '<path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M12 10.5v5M9.5 13h5"/>',
    tag: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.4 6.4a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8" cy="8" r="1.4"/>',
    library: '<rect x="4" y="4" width="4" height="16" rx="1"/><rect x="10" y="4" width="4" height="16" rx="1"/><path d="M15.6 5.2l3.4-.9 3.3 14.9-3.4.9z"/>',
    inbox: '<path d="M3.5 13.5l2.6-8a1.5 1.5 0 0 1 1.4-1h9a1.5 1.5 0 0 1 1.4 1l2.6 8V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M3.5 13.5h5l1 2h5l1-2h5"/>',
    note: '<rect x="4.5" y="3.5" width="15" height="17" rx="2"/><path d="M8 8.5h8M8 12h8M8 15.5h5"/>',
    noteAdd: '<path d="M19.5 12V5.5a2 2 0 0 0-2-2h-11a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2H12"/><path d="M8 8.5h8M8 12h5M18 15v6M15 18h6"/>',
    board:
        '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><rect x="6.5" y="7.5" width="5" height="4" rx="1"/><rect x="12.5" y="12.5" width="5" height="4" rx="1"/><path d="M9 11.5v3h3.5"/>',
    cards: '<rect x="7.5" y="3.5" width="13" height="11.5" rx="2"/><path d="M4 8v10a2.5 2.5 0 0 0 2.5 2.5H16"/>',
    section: '<rect x="3.5" y="5" width="17" height="14" rx="2" stroke-dasharray="3.2 2.6"/><path d="M7 9h5"/>',
    attachment:
        '<path d="M19.5 11.5l-7.6 7.6a5 5 0 0 1-7.1-7.1l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.4-2.4l7.3-7.3"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3.3-3.3a4 4 0 0 0-5.7-5.7l-1.1 1.1"/><path d="M14 10a4 4 0 0 0-5.7 0L5 13.3a4 4 0 0 0 5.7 5.7l1.1-1.1"/>',
    unlink: '<path d="M10 14a4 4 0 0 0 5.7 0l3.3-3.3a4 4 0 0 0-5.7-5.7l-1.1 1.1"/><path d="M14 10a4 4 0 0 0-5.7 0L5 13.3a4 4 0 0 0 5.7 5.7l1.1-1.1"/><path d="M4 4l16 16"/>',
    related: '<rect x="3.5" y="5" width="7" height="9" rx="1.5"/><rect x="13.5" y="10" width="7" height="9" rx="1.5"/><path d="M10.5 9.5H17v.5M13.5 14.5H7v-.5"/>',
    openExternal: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    zoomIn: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M8 10.5h5M10.5 8v5"/>',
    zoomOut: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M8 10.5h5"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4v4.5H15"/>',
    moreH: '<circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    moreV: '<circle cx="12" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="18" r="1.4" fill="currentColor" stroke="none"/>',
    grip: '<g fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/></g>',
    connect: '<circle cx="6" cy="12" r="2.5"/><path d="M8.5 12h9M14.5 8.5L18 12l-3.5 3.5"/>',
    database: '<ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/>',
    settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    collapseAll: '<path d="M7 4.5l5 5 5-5M7 19.5l5-5 5 5"/>',
    expandAll: '<path d="M7 9l5-5 5 5M7 15l5 5 5-5"/>',
    file: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5"/>',
    fileAdd: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5M12 11.5v6M9 14.5h6"/>',
    reveal: '<path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M10 13.5h5M13 11l2.5 2.5L13 16"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
    contrast: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.75" r="1" fill="currentColor" stroke="none"/>',
    warning: '<path d="M10.3 4.4L2.9 17.5A2 2 0 0 0 4.6 20.5h14.8a2 2 0 0 0 1.7-3L13.7 4.4a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.5"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/>',
    sparkle: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1-5.1-1.9 5.1-1.9z"/><path d="M18.5 16v4M16.5 18h4"/>',
};

/* ---------- Drawer item types (one per type in src/drawer/itemTypes.ts) ---------- */
const BOOK = '<path d="M5 19V5.5a2 2 0 0 1 2-2h12V17H7a2 2 0 0 0-2 2zm0 0a2 2 0 0 0 2 1.5h12"/>';
const STAGE = '<path d="M3.5 3.5h17M4.5 3.5v17M19.5 3.5v17"/><path d="M4.5 3.5c.4 4.2 2 7 4.8 8M19.5 3.5c-.4 4.2-2 7-4.8 8"/>';

const TYPE = {
    // 文獻
    journalArticle:
        '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5M8.5 12.5h7M8.5 16h7"/>',
    book: BOOK + '<path d="M9.5 7.5h6"/>',
    bookSection: BOOK + '<path d="M12.5 3.5v6.5l2-1.5 2 1.5V3.5"/>',
    magazineArticle:
        '<path d="M4 5.5a1 1 0 0 1 1-1h11.5a1 1 0 0 1 1 1V18a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2z"/><path d="M17.5 9H19a1 1 0 0 1 1 1v8a2 2 0 0 1-2 2"/><rect x="7" y="7.5" width="4.5" height="4" rx=".6"/><path d="M14 8h.5M14 11h.5M7 14.5h7.5M7 17h7.5"/>',
    conferencePaper: '<rect x="3" y="3.5" width="18" height="11" rx="1.5"/><path d="M7 7.5h10M7 10.5h6M12 14.5v2M8.5 20.5l3.5-4 3.5 4"/>',
    thesis: '<path d="M2.5 9.5L12 5l9.5 4.5L12 14z"/><path d="M6.5 11.6V16c1.5 1.4 3.5 2 5.5 2s4-.6 5.5-2v-4.4M21.5 9.5V15"/>',
    report: '<rect x="4.5" y="3.5" width="15" height="17" rx="2"/><path d="M9 16.5v-4M12 16.5v-7.5M15 16.5V14"/>',
    // 影音
    music: '<circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17" cy="15.5" r="2.5"/><path d="M10 17.5V6.5L19.5 4v11.5M10 10l9.5-2.5"/>',
    cd: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 6.5A5.5 5.5 0 0 0 6.5 12"/>',
    dvd: '<rect x="5" y="3.5" width="14" height="17" rx="1.5"/><circle cx="12" cy="11" r="4"/><circle cx="12" cy="11" r=".9"/><path d="M8.5 17.5h7"/>',
    film: '<path d="M4 10h16v8.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z"/><path d="M4 10l-.5-2.6a1.5 1.5 0 0 1 1.2-1.7l12.6-2.4a1.5 1.5 0 0 1 1.8 1.2L19.5 7z"/><path d="M8.2 5.4l2.3 3.3M12.9 4.5l2.3 3.3"/>',
    tvEpisode: '<rect x="3" y="7" width="18" height="12.5" rx="2"/><path d="M8.5 3l3.5 4 3.5-4"/>',
    podcast: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/>',
    video: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9v6l5-3z"/>',
    // 現場表演
    concert:
        '<path d="M14.5 9.5l5-5M17.5 3l3.5 3.5"/><path d="M13.2 10.8a3.5 3.5 0 0 0-4.6-.4c-.6.5-.8 1.3-1.5 1.7-.8.4-1.8.3-2.5 1a3.8 3.8 0 0 0 0 5.3l1 1a3.8 3.8 0 0 0 5.3 0c.7-.7.6-1.7 1-2.5.4-.7 1.2-.9 1.7-1.5a3.5 3.5 0 0 0-.4-4.6z"/><circle cx="10" cy="14" r="1.3"/>',
    theater:
        '<path d="M3.5 4.5h10v5.5a5 5 0 0 1-10 0z"/><path d="M6.5 8h.01M10.5 8h.01M6.8 11.5a2.5 2.5 0 0 0 3.4 0"/><path d="M15.5 9.5h5V14a5 5 0 0 1-8.2 3.8"/><path d="M16.5 13h.01M19 13h.01"/>',
    musical: STAGE + '<ellipse cx="11" cy="18" rx="1.6" ry="1.3" fill="currentColor" stroke="none"/><path d="M12.6 18v-4.5l2 .7"/>',
    opera: '<rect x="4.5" y="3.5" width="15" height="17" rx="2"/><path d="M7.5 7.5h9M7.5 10h9M7.5 12.5h9"/><ellipse cx="10" cy="16.5" rx="1.8" ry="1.4" fill="currentColor" stroke="none"/><path d="M11.8 16.5V7.5"/>',
    dance: '<circle cx="13" cy="4.5" r="1.8"/><path d="M12.5 8L9.5 13l3 2-1 5.5M12.5 8l3.5 3.5 3.5-1M12.5 8L8 7.5 5 9.5M12.5 15l4 2.5 1.5 3"/>',
    comedy: '<circle cx="12" cy="12" r="8.5"/><path d="M7.8 13.5a4.5 4.5 0 0 0 8.4 0z"/><path d="M8 10q1-1.6 2 0M14 10q1-1.6 2 0"/>',
    festival: '<path d="M3.5 20L12 6l8.5 14z"/><path d="M12 6c-.8 5-2.5 9.5-4.5 14M12 6c.8 5 2.5 9.5 4.5 14M12 6V2.5l3 1.2-3 1.2"/>',
    talk: '<circle cx="9" cy="7" r="3"/><path d="M3.5 20v-2.5A4.5 4.5 0 0 1 8 13h2a4.5 4.5 0 0 1 4.5 4.5V20"/><path d="M17 7.5a3.5 3.5 0 0 1 0 5M19.5 5a7 7 0 0 1 0 10"/>',
    // 藝術與圖像
    painting: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><circle cx="9" cy="9.5" r="1.5"/><path d="M3.5 16.5l5-4.5 4 3.5 3-2.5 5 4"/>',
    artwork: '<path d="M6.5 20.5h11M8.5 20.5v-3.5h7v3.5"/><path d="M12 3.5c2.8 2 4.5 4.5 4.5 7.2A4.5 4.5 0 0 1 12 15a4.5 4.5 0 0 1-4.5-4.3C7.5 8 9.2 5.5 12 3.5z"/>',
    photo: '<path d="M3.5 8.5a2 2 0 0 1 2-2h2l1.5-2h6l1.5 2h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.5" r="3.5"/>',
    map: '<path d="M3.5 6.5l5.5-2 6 2 5.5-2v13l-5.5 2-6-2-5.5 2z"/><path d="M9 4.5v13M15 6.5v13"/>',
    // 其他
    webpage: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.5 3.5 5.3 3.5 8.5s-1.1 6-3.5 8.5c-2.4-2.5-3.5-5.3-3.5-8.5s1.1-6 3.5-8.5z"/>',
    software: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M3 8.5h18M9.5 12l-2.5 2.5 2.5 2.5M14.5 12l2.5 2.5-2.5 2.5"/>',
    document: '<path d="M6.5 3.5h11A1.5 1.5 0 0 1 19 5v14.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M8.5 8h7M8.5 11.5h7M8.5 15h4"/>',
};

export const ICONS = { ...MODULE, ...UI, logo: LOGO } as const;
export type IconName = keyof typeof ICONS;

export const TYPE_ICONS: Record<string, string> = TYPE;
/** Icon groups, for the preview sheet and docs. */
export const ICON_GROUPS = {
    module: Object.keys(MODULE) as IconName[],
    ui: Object.keys(UI) as IconName[],
    type: Object.keys(TYPE),
};
