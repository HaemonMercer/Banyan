import type { ItemFields } from "./api";

/** Metadata fields that types can choose from (title, creators and abstract are always shown). */
export type FieldKey = Exclude<keyof ItemFields, "itemType" | "title" | "abstractNote" | "fullText">;

export type ItemGroup = "literature" | "media" | "performance" | "art" | "other" | "file";

export const GROUP_LABELS: Record<ItemGroup, string> = {
    literature: "文獻",
    media: "影音",
    performance: "現場表演",
    art: "藝術與圖像",
    other: "其他",
    file: "檔案",
};

/**
 * Drawer holds two libraries in one item table: 文獻庫 (the bibliographic types) and 檔案庫
 * (items that are a file, typed by extension). Each has its own folders; types can't cross over.
 */
export type Library = "literature" | "files";

export const LIBRARY_LABELS: Record<Library, string> = {
    literature: "文獻庫",
    files: "檔案庫",
};

/** Must match `is_file_type` in `src-tauri/src/drawer.rs`: file types start with "file". */
export const libraryOf = (typeId: string): Library => (typeId.startsWith("file") ? "files" : "literature");

export interface ItemTypeDef {
    id: string;
    label: string;
    icon: string;
    group: ItemGroup;
    /** Extra metadata fields shown for this type, in order. */
    fields: FieldKey[];
    /** Per-type label overrides, e.g. `publisher` → 唱片公司. */
    labels?: Partial<Record<FieldKey, string>>;
    /** Placeholder for the title box (default 標題). */
    titleLabel?: string;
    /** Shows the 原文 section, where the item's text can be pasted as-is. */
    fullText?: boolean;
}

export const ITEM_TYPES: ItemTypeDef[] = [
    // ---- 文獻 ----
    { id: "journalArticle", label: "期刊論文", icon: "📄", group: "literature",
      labels: { publication: "期刊" },
      fields: ["publication", "volume", "issue", "pages", "date", "doi", "series", "seriesNumber", "url"] },
    { id: "book", label: "書籍", icon: "📕", group: "literature",
      fields: ["publisher", "place", "date", "pages", "series", "seriesNumber", "isbn", "url"],
      labels: { series: "叢書／系列", seriesNumber: "叢書編號", place: "出版地", pages: "頁數" } },
    { id: "bookSection", label: "書籍章節", icon: "📑", group: "literature",
      labels: { series: "叢書／系列", seriesNumber: "叢書編號", publication: "書名" },
      fields: ["publication", "publisher", "pages", "date", "isbn", "series", "seriesNumber", "url"] },
    { id: "magazineArticle", label: "雜誌文章", icon: "📰", group: "literature",
      labels: { publication: "雜誌" },
      fields: ["publication", "issue", "pages", "date", "series", "seriesNumber", "url"] },
    { id: "news", label: "新聞", icon: "🗞️", group: "literature", fullText: true,
      labels: { publication: "媒體", date: "發佈日期", place: "地點", pages: "版次", series: "專欄" },
      fields: ["publication", "date", "place", "pages", "series", "seriesNumber", "url"] },
    { id: "conferencePaper", label: "會議論文", icon: "🎤", group: "literature",
      labels: { series: "論文集系列", seriesNumber: "卷號", publication: "會議名稱" },
      fields: ["publication", "place", "pages", "date", "doi", "series", "seriesNumber", "url"] },
    { id: "thesis", label: "學位論文", icon: "🎓", group: "literature",
      labels: { publication: "學校" },
      fields: ["publication", "date", "pages", "series", "seriesNumber", "url"] },
    { id: "report", label: "報告", icon: "📊", group: "literature",
      labels: { series: "系列", publication: "機構", catalogNumber: "報告編號" },
      fields: ["publication", "catalogNumber", "date", "pages", "series", "seriesNumber", "url"] },

    // ---- 影音 ----
    { id: "music", label: "音樂", icon: "🎵", group: "media",
      titleLabel: "曲名",
      labels: { publication: "專輯", publisher: "唱片公司", date: "發行日期", runningTime: "長度",
                medium: "格式" },
      fields: ["publication", "publisher", "date", "runningTime", "medium", "series", "seriesNumber", "url"] },
    { id: "cd", label: "CD", icon: "💿", group: "media",
      titleLabel: "專輯名稱",
      labels: { series: "系列", publisher: "唱片公司", date: "發行日期", runningTime: "總長度",
                catalogNumber: "目錄編號", place: "發行地區" },
      fields: ["publisher", "date", "catalogNumber", "runningTime", "place", "series", "seriesNumber", "url"] },
    { id: "dvd", label: "DVD / 藍光", icon: "📀", group: "media",
      labels: { series: "系列／套裝", publisher: "發行商", date: "發行日期", runningTime: "片長", medium: "格式",
                catalogNumber: "編號", place: "區碼／地區" },
      fields: ["publisher", "date", "runningTime", "medium", "place", "catalogNumber", "series", "seriesNumber", "url"] },
    { id: "film", label: "電影", icon: "🎬", group: "media",
      titleLabel: "片名",
      labels: { series: "系列", seriesNumber: "第幾部", publisher: "發行公司", date: "上映日期", runningTime: "片長", place: "國家／地區" },
      fields: ["publisher", "date", "runningTime", "place", "series", "seriesNumber", "url"] },
    { id: "tvEpisode", label: "電視節目", icon: "📺", group: "media",
      labels: { seriesNumber: "季", publication: "節目名稱", issue: "集數", publisher: "電視台", date: "播出日期",
                runningTime: "長度" },
      fields: ["publication", "issue", "publisher", "date", "runningTime", "series", "seriesNumber", "url"] },
    { id: "podcast", label: "Podcast", icon: "🎙️", group: "media",
      labels: { publication: "節目名稱", issue: "集數", date: "發佈日期", runningTime: "長度" },
      fields: ["publication", "issue", "date", "runningTime", "series", "seriesNumber", "url"] },
    { id: "video", label: "線上影片", icon: "▶️", group: "media",
      labels: { series: "系列／播放清單", seriesNumber: "集數", publication: "頻道／平台", date: "發佈日期", runningTime: "長度" },
      fields: ["publication", "date", "runningTime", "series", "seriesNumber", "url"] },

    // ---- 現場表演 ----
    { id: "concert", label: "演唱會／音樂會", icon: "🎸", group: "performance",
      titleLabel: "演出名稱",
      labels: { publication: "巡演名稱", publisher: "主辦單位", date: "演出日期", place: "場地",
                runningTime: "演出長度", catalogNumber: "場次" },
      fields: ["publication", "date", "place", "publisher", "runningTime", "catalogNumber", "series", "seriesNumber", "url"] },
    { id: "theater", label: "戲劇", icon: "🎭", group: "performance",
      titleLabel: "劇名",
      labels: { publisher: "劇團／製作單位", date: "演出日期", place: "場地", runningTime: "演出長度",
                catalogNumber: "場次" },
      fields: ["publisher", "date", "place", "runningTime", "catalogNumber", "series", "seriesNumber", "url"] },
    { id: "musical", label: "音樂劇", icon: "🎶", group: "performance",
      titleLabel: "劇名",
      labels: { publisher: "製作單位", date: "演出日期", place: "場地", runningTime: "演出長度",
                catalogNumber: "場次" },
      fields: ["publisher", "date", "place", "runningTime", "catalogNumber", "series", "seriesNumber", "url"] },
    { id: "opera", label: "歌劇", icon: "🎼", group: "performance",
      titleLabel: "劇名",
      labels: { publisher: "歌劇院／製作單位", date: "演出日期", place: "場地", runningTime: "演出長度",
                catalogNumber: "場次" },
      fields: ["publisher", "date", "place", "runningTime", "catalogNumber", "series", "seriesNumber", "url"] },
    { id: "dance", label: "舞蹈", icon: "🩰", group: "performance",
      titleLabel: "作品名稱",
      labels: { publisher: "舞團", date: "演出日期", place: "場地", runningTime: "演出長度",
                catalogNumber: "場次" },
      fields: ["publisher", "date", "place", "runningTime", "catalogNumber", "series", "seriesNumber", "url"] },
    { id: "comedy", label: "喜劇／脫口秀", icon: "😂", group: "performance",
      titleLabel: "演出名稱",
      labels: { publication: "巡演名稱", publisher: "主辦單位", date: "演出日期", place: "場地",
                runningTime: "演出長度" },
      fields: ["publication", "date", "place", "publisher", "runningTime", "series", "seriesNumber", "url"] },
    { id: "festival", label: "音樂節／藝術節", icon: "🎪", group: "performance",
      titleLabel: "活動名稱",
      labels: { publisher: "主辦單位", date: "舉辦日期", place: "地點", issue: "屆次" },
      fields: ["issue", "date", "place", "publisher", "series", "seriesNumber", "url"] },
    { id: "talk", label: "演講／講座", icon: "🗣️", group: "performance",
      titleLabel: "講題",
      labels: { publication: "活動名稱", publisher: "主辦單位", date: "日期", place: "場地",
                runningTime: "長度" },
      fields: ["publication", "date", "place", "publisher", "runningTime", "series", "seriesNumber", "url"] },

    // ---- 藝術與圖像 ----
    { id: "painting", label: "繪畫", icon: "🖼️", group: "art",
      titleLabel: "作品名稱",
      labels: { series: "系列", date: "創作年份", medium: "媒材", place: "收藏地點", catalogNumber: "館藏編號" },
      fields: ["date", "medium", "dimensions", "place", "catalogNumber", "series", "seriesNumber", "url"] },
    { id: "artwork", label: "藝術品", icon: "🗿", group: "art",
      titleLabel: "作品名稱",
      labels: { series: "系列", date: "創作年份", medium: "材質", place: "收藏地點", catalogNumber: "館藏編號" },
      fields: ["date", "medium", "dimensions", "place", "catalogNumber", "series", "seriesNumber", "url"] },
    { id: "photo", label: "照片", icon: "📷", group: "art",
      labels: { series: "系列", date: "拍攝日期", place: "拍攝地點", medium: "器材／底片" },
      fields: ["date", "place", "medium", "dimensions", "series", "seriesNumber", "url"] },
    { id: "map", label: "地圖", icon: "🗺️", group: "art",
      labels: { series: "圖幅系列", seriesNumber: "圖號", place: "地區", medium: "比例尺" },
      fields: ["place", "medium", "publisher", "date", "dimensions", "series", "seriesNumber", "url"] },

    // ---- 其他 ----
    { id: "webpage", label: "網頁", icon: "🌐", group: "other",
      labels: { publication: "網站", date: "發佈日期" },
      fields: ["publication", "date", "series", "seriesNumber", "url"] },
    { id: "software", label: "軟體", icon: "💾", group: "other",
      labels: { publisher: "公司", issue: "版本", medium: "平台" },
      fields: ["issue", "publisher", "medium", "date", "series", "seriesNumber", "url"] },
    { id: "document", label: "文件", icon: "🗒️", group: "other",
      fields: ["publisher", "date", "series", "seriesNumber", "url"] },

    // ---- 檔案（檔案庫；類型依副檔名決定，見 drawer.rs 的 file_type_for） ----
    ...([
        ["fileDocument", "文件", "📄"],
        ["fileEbook", "電子書", "📚"],
        ["fileImage", "圖片", "🖼️"],
        ["fileVideo", "影片", "🎞️"],
        ["fileAudio", "音訊", "🔊"],
        ["fileText", "文字", "📝"],
        ["fileSpreadsheet", "試算表", "📊"],
        ["filePresentation", "簡報", "📽️"],
        ["fileCode", "程式碼", "⌨️"],
        ["fileArchive", "壓縮檔", "🗜️"],
        ["fileOther", "其他檔案", "📦"],
    ] as const).map(([id, label, icon]): ItemTypeDef => ({
        id, label, icon, group: "file", titleLabel: "名稱",
        labels: { date: "日期", url: "來源網址" },
        fields: ["date", "url"],
    })),
];

/** Creator roles. Ids are stored in the database; labels are only for display. */
export const ROLE_LABELS: Record<string, string> = {
    author: "作者",
    editor: "編者",
    translator: "譯者",
    seriesEditor: "叢書主編",
    illustrator: "插畫者",
    advisor: "指導教授",
    contributor: "其他貢獻者",
    performer: "演出者",
    composer: "作曲者",
    lyricist: "作詞者",
    arranger: "編曲者",
    producer: "製作人",
    director: "導演",
    screenwriter: "編劇",
    castMember: "演員",
    host: "主持人",
    guest: "來賓",
    creator: "創作者",
    painter: "畫家",
    artist: "藝術家",
    photographer: "攝影師",
    cartographer: "製圖者",
    programmer: "開發者",
    conductor: "指揮",
    choreographer: "編舞者",
    dancer: "舞者",
    singer: "歌手",
    musician: "樂手",
    speaker: "講者",
    organizer: "主辦者",
    reporter: "記者",
};

/**
 * Roles offered for each item type; the first is the main role (used for new creators and
 * shown first in the list). Keep the first entries in sync with `primary_role` in `src-tauri/src/db.rs`.
 */
const CREATOR_ROLES: Record<string, string[]> = {
    journalArticle: ["author", "editor", "translator", "contributor"],
    book: ["author", "editor", "translator", "seriesEditor", "illustrator", "contributor"],
    bookSection: ["author", "editor", "translator", "seriesEditor", "contributor"],
    magazineArticle: ["author", "translator", "contributor"],
    news: ["reporter", "author", "editor", "translator", "photographer", "contributor"],
    conferencePaper: ["author", "editor", "translator", "contributor"],
    thesis: ["author", "advisor", "contributor"],
    report: ["author", "editor", "translator", "contributor"],
    music: ["performer", "composer", "lyricist", "arranger", "producer", "contributor"],
    cd: ["performer", "composer", "lyricist", "arranger", "producer", "contributor"],
    dvd: ["director", "screenwriter", "producer", "castMember", "translator", "contributor"],
    film: ["director", "screenwriter", "producer", "castMember", "contributor"],
    tvEpisode: ["director", "screenwriter", "producer", "castMember", "host", "guest", "contributor"],
    podcast: ["host", "guest", "producer", "contributor"],
    video: ["creator", "host", "guest", "contributor"],
    concert: ["performer", "singer", "musician", "conductor", "composer", "organizer", "contributor"],
    theater: ["director", "screenwriter", "castMember", "producer", "contributor"],
    musical: ["director", "composer", "lyricist", "screenwriter", "castMember", "choreographer", "conductor", "producer", "contributor"],
    opera: ["composer", "conductor", "director", "singer", "lyricist", "contributor"],
    dance: ["choreographer", "dancer", "composer", "director", "contributor"],
    comedy: ["performer", "screenwriter", "director", "producer", "contributor"],
    festival: ["organizer", "performer", "contributor"],
    talk: ["speaker", "host", "organizer", "contributor"],
    painting: ["painter", "contributor"],
    artwork: ["artist", "contributor"],
    photo: ["photographer", "contributor"],
    map: ["cartographer", "editor", "contributor"],
    webpage: ["author", "translator", "contributor"],
    software: ["programmer", "contributor"],
    document: ["author", "editor", "translator", "contributor"],
};

export function creatorRoles(typeId: string): string[] {
    return CREATOR_ROLES[typeId] ?? CREATOR_ROLES.document;
}

export function roleLabel(role: string): string {
    return ROLE_LABELS[role] ?? role;
}

export const FIELD_LABELS: Record<FieldKey, string> = {
    publication: "出處",
    volume: "卷",
    issue: "期",
    pages: "頁碼",
    publisher: "出版社",
    date: "日期",
    doi: "DOI",
    isbn: "ISBN",
    url: "網址",
    runningTime: "長度",
    medium: "媒介",
    dimensions: "尺寸",
    place: "地點",
    catalogNumber: "編號",
    series: "系列",
    seriesNumber: "系列編號",
};

/** Types a gallery folder accepts (must match IMAGE_TYPES in drawer.rs). */
export const IMAGE_TYPES = ["painting", "artwork", "photo", "map", "fileImage"];
export const isImageType = (id: string) => IMAGE_TYPES.includes(id);

export function itemType(id: string): ItemTypeDef {
    return ITEM_TYPES.find((t) => t.id === id) ?? ITEM_TYPES[ITEM_TYPES.length - 1];
}

export function fieldLabel(type: ItemTypeDef, key: FieldKey): string {
    return type.labels?.[key] ?? FIELD_LABELS[key];
}

/** Item types grouped for menus, in display order; only those of `library` when given. */
export function groupedTypes(library?: Library): [ItemGroup, ItemTypeDef[]][] {
    return (Object.keys(GROUP_LABELS) as ItemGroup[])
        .filter((g) => !library || (g === "file") === (library === "files"))
        .map((g) => [g, ITEM_TYPES.filter((t) => t.group === g)]);
}

/** "王小明\nJane Doe\nJohn Roe" -> "王小明 等" */
export function shortAuthors(authors: string): string {
    const list = authors.split("\n").map((a) => a.trim()).filter(Boolean);
    if (list.length === 0) return "";
    return list.length > 1 ? `${list[0]} 等` : list[0];
}

export function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
