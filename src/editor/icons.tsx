import type { SVGProps } from "react";

/** 介面用的小圖示（16×16，跟著文字顏色）。 */
type IconProps = SVGProps<SVGSVGElement>;

const base = (props: IconProps) => ({
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...props,
});

export const PlusIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>
);

export const GripIcon = (p: IconProps) => (
  <svg {...base({ ...p, stroke: "none", fill: "currentColor" })}>
    {[4, 8, 12].map((y) => (
      <g key={y}>
        <circle cx="6" cy={y} r="1.15" />
        <circle cx="10" cy={y} r="1.15" />
      </g>
    ))}
  </svg>
);

export const TrashIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.2a1 1 0 0 0 1 .8h3.8a1 1 0 0 0 1-.8l.6-8.2" />
  </svg>
);

export const CopyIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.5" />
    <path d="M10.5 3.5V3a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v5.5a1 1 0 0 0 1 1h.5" />
  </svg>
);

export const CodeIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />
  </svg>
);

export const CloseIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </svg>
);

export const DocIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 1.75h5.25L12.5 5v8.25a1 1 0 0 1-1 1h-7.5a1 1 0 0 1-1-1V2.75a1 1 0 0 1 1-1Z" />
    <path d="M9 1.75V5.25h3.5M5.5 8.5h5M5.5 11h3.5" />
  </svg>
);

export const LinkIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6.75 9.25a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-.5.5" />
    <path d="M9.25 6.75a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 0 0 3.5 3.5l.5-.5" />
  </svg>
);

export const IndentIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.5 3.5h11M7.5 6.5h6M7.5 9.5h6M2.5 12.5h11M2.5 6l2.5 2-2.5 2" />
  </svg>
);

export const OutdentIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.5 3.5h11M7.5 6.5h6M7.5 9.5h6M2.5 12.5h11M5 6 2.5 8 5 10" />
  </svg>
);

export const AlignLeftIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.5 3.5h11M2.5 6.5h7M2.5 9.5h11M2.5 12.5h7" />
  </svg>
);

export const AlignCenterIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.5 3.5h11M4.5 6.5h7M2.5 9.5h11M4.5 12.5h7" />
  </svg>
);

export const AlignRightIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.5 3.5h11M6.5 6.5h7M2.5 9.5h11M6.5 12.5h7" />
  </svg>
);

/** 圖說在上方：橫線在圖片框上面 */
export const CaptionTopIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4.5 2.5h7" />
    <rect x="2.5" y="5.5" width="11" height="8" rx="1.5" />
  </svg>
);

/** 圖說在下方：橫線在圖片框下面 */
export const CaptionBottomIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2.5" y="2.5" width="11" height="8" rx="1.5" />
    <path d="M4.5 13.5h7" />
  </svg>
);

/** 日曆（日記） */
export const CalendarIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
    <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
  </svg>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M10 3.5 5.5 8l4.5 4.5" />
  </svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 3.5 10.5 8 6 12.5" />
  </svg>
);

/** 文字（T） */
export const TextIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 4V2.75h10V4M8 2.75v10.5M6 13.25h4" />
  </svg>
);

/** 更多（…） */
export const MoreIcon = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <circle cx="3.5" cy="8" r="1.3" />
    <circle cx="8" cy="8" r="1.3" />
    <circle cx="12.5" cy="8" r="1.3" />
  </svg>
);

/* ─── 側邊欄與頂端列 ─── */

/** 側邊欄開關 */
export const SidebarIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M6 3v10" />
  </svg>
);

/** 今天（日曆上標一天） */
export const TodayIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
    <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
    <rect x="5.5" y="8.5" width="2.5" height="2.5" rx=".5" fill="currentColor" stroke="none" />
  </svg>
);

/** 日記串（一疊紙） */
export const JournalIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 2.5h6.5l2 2v9h-8.5z" />
    <path d="M6.5 7h4M6.5 9.5h4M6.5 12h2.5" />
  </svg>
);

/** 所有頁面（多張頁面） */
export const PagesIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="4.5" y="2.5" width="9" height="9" rx="1.5" />
    <path d="M2.5 5v7a1.5 1.5 0 0 0 1.5 1.5h7" />
  </svg>
);

export const StarIcon = (p: IconProps & { filled?: boolean }) => {
  const { filled, ...rest } = p;
  return (
    <svg {...base(rest)}>
      <path
        d="m8 2.3 1.75 3.55 3.9.57-2.83 2.76.67 3.89L8 11.24l-3.49 1.83.67-3.89L2.35 6.42l3.9-.57z"
        fill={filled ? "currentColor" : "none"}
      />
    </svg>
  );
};

export const ClockIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 5v3l2 1.5" />
  </svg>
);

export const SunIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="2.75" />
    <path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1 1M11.4 11.4l1 1M3.6 12.4l1-1M11.4 4.6l1-1" />
  </svg>
);

export const MoonIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M13 9.6A5.5 5.5 0 1 1 6.4 3a4.4 4.4 0 0 0 6.6 6.6z" />
  </svg>
);

/** 跟隨系統（螢幕） */
export const MonitorIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2" y="3" width="12" height="8" rx="1.5" />
    <path d="M6 14h4M8 11v3" />
  </svg>
);

export const KeyboardIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="1.75" y="4" width="12.5" height="8" rx="1.5" />
    <path d="M4.5 6.75h.01M7 6.75h.01M9.5 6.75h.01M12 6.75h.01M5.5 9.25h5" />
  </svg>
);

export const ArrowLeftIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M13 8H3.5M7.5 4 3.5 8l4 4" />
  </svg>
);

export const ArrowRightIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 8h9.5M8.5 4l4 4-4 4" />
  </svg>
);

/* ─── 其他 ─── */

/** 開啟（右上箭頭） */
export const OpenIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6.5 3.5h-3v9h9v-3M9 2.5h4.5V7M13.5 2.5 7.5 8.5" />
  </svg>
);

/** 搜尋（放大鏡） */
export const SearchIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="7" cy="7" r="4.25" />
    <path d="m10.25 10.25 3.25 3.25" />
  </svg>
);

/* ─── 稿件（參考 Scrivener） ─── */

/** 排序（上下箭頭） */
export const SortIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 13V3M2.75 5.25 5 3l2.25 2.25M11 3v10M8.75 10.75 11 13l2.25-2.25" />
  </svg>
);

/* ─── 資料庫（參考 Notion） ─── */

/** 資料庫（表格） */
/** 試算表（Excel） */
export const SheetIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2" y="2.75" width="12" height="10.5" rx="1.5" />
    <path d="M2 6.25h12M2 9.75h12M6 2.75v10.5M10 6.25v7" />
  </svg>
);

/** 看板（幾欄卡片） */
export const BoardIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2" y="2.75" width="3.5" height="10.5" rx="1" />
    <rect x="6.25" y="2.75" width="3.5" height="7" rx="1" />
    <rect x="10.5" y="2.75" width="3.5" height="8.75" rx="1" />
  </svg>
);

/** 屬性（幾條滑桿） */
export const PropsIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
    <circle cx="5.5" cy="4.5" r="1.25" fill="currentColor" />
    <circle cx="10.5" cy="8" r="1.25" fill="currentColor" />
    <circle cx="7" cy="11.5" r="1.25" fill="currentColor" />
  </svg>
);

/** 勾選框 */
export const CheckboxIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2.75" y="2.75" width="10.5" height="10.5" rx="2" />
    <path d="m5.5 8 1.75 1.75L10.75 6.25" />
  </svg>
);

/** 數字（#） */
export const HashIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6.25 2.5 5 13.5M11 2.5 9.75 13.5M3 6h10.5M2.5 10H13" />
  </svg>
);

/** 單選（實心圓） */
export const SelectIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="5.25" />
    <path d="m5.75 7 2.25 2.25L10.25 7" />
  </svg>
);

/** 多選（幾條清單） */
export const MultiIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 4.5h7.5M6 8h7.5M6 11.5h7.5" />
    <path d="m2.25 4.5.75.75 1.25-1.5M2.25 8l.75.75 1.25-1.5M2.25 11.5l.75.75 1.25-1.5" />
  </svg>
);


/** 區段（虛線框） */
export const SectionIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" strokeDasharray="2 1.6" />
    <path d="M2.5 3.5h5" />
  </svg>
);

export const MinusIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3.5 8h9" />
  </svg>
);

/** 符合畫面（四個角） */
export const FitIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10" />
  </svg>
);

/** 便利貼（折角的方塊） */
export const NoteIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 2.75h10a.25.25 0 0 1 .25.25v6.75L9.75 13.25H3A.25.25 0 0 1 2.75 13V3A.25.25 0 0 1 3 2.75Z" />
    <path d="M13.25 9.75H10a.25.25 0 0 0-.25.25v3.25" />
  </svg>
);

/** 送出（往右上的箭頭進到托盤） */
export const SendIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.5 9.5v3a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3" />
    <path d="M8 10V2.5M5 5.5l3-3 3 3" />
  </svg>
);

/** 簡報（投影幕） */
export const SlidesIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="1.75" y="2.75" width="12.5" height="8.5" rx="1" />
    <path d="M8 11.25v2M5.5 13.75h5" />
  </svg>
);

/** Desk（白板的便利貼＋Dock 的文件） */
export const DeskIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2" y="2.5" width="6.5" height="6.5" rx="1.25" />
    <path d="M8.5 6h3l2.5 2.5v5H8.5a1 1 0 0 1-1-1V9" />
    <path d="M9.75 10.75h2.25" />
  </svg>
);

/** 匯出（下載） */
export const ExportIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 2.5V10M5 7l3 3 3-3" />
    <path d="M2.5 11v1.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V11" />
  </svg>
);

/** 播放（簡報放映） */
export const PlayIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 3.5v9l7-4.5-7-4.5Z" />
  </svg>
);

/** 動畫（簡報的轉場與逐項顯示：閃光） */
export const AnimIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6.5 2.5 7.6 5.9 11 7 7.6 8.1 6.5 11.5 5.4 8.1 2 7l3.4-1.1L6.5 2.5Z" />
    <path d="M12 10v3.5M10.25 11.75h3.5" />
  </svg>
);

/** 往上、往下（搬移） */
export const ArrowUpIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 12.5v-9M4 7.5l4-4 4 4" />
  </svg>
);
export const ArrowDownIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 3.5v9M4 8.5l4 4 4-4" />
  </svg>
);

/** 剪下（剪刀） */
export const CutIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="4.5" cy="11.5" r="2" />
    <circle cx="11.5" cy="11.5" r="2" />
    <path d="M6 10 12 2.5M10 10 4 2.5" />
  </svg>
);

/** 貼上（剪貼板） */
export const PasteIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3.5" y="3" width="9" height="11" rx="1.5" />
    <path d="M6 3V2.2h4V3M6 7h4M6 9.5h4" />
  </svg>
);

/** 白板（畫布上兩張卡片連起來） */
export const WhiteboardIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="1.75" y="2.5" width="6" height="4.5" rx="1" />
    <rect x="8.25" y="9" width="6" height="4.5" rx="1" />
    <path d="M7.75 4.75h2.5a1 1 0 0 1 1 1V9" />
  </svg>
);

/** 範本（四格版型） */
export const TemplateIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
    <path d="M2.5 6.5h11M6.5 6.5v7" />
  </svg>
);

/** 心智圖（中心向外分支） */
export const MindMapIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="2" />
    <circle cx="2.75" cy="3.5" r="1.25" />
    <circle cx="13.25" cy="3.5" r="1.25" />
    <circle cx="2.75" cy="12.5" r="1.25" />
    <circle cx="13.25" cy="12.5" r="1.25" />
    <path d="M6.4 6.7 3.7 4.3M9.6 6.7l2.7-2.4M6.4 9.3l-2.7 2.4M9.6 9.3l2.7 2.4" />
  </svg>
);

/** 電子郵件（@） */
export const AtIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="2.5" />
    <path d="M10.5 8v1a1.75 1.75 0 0 0 3.5 0V8a6 6 0 1 0-2.4 4.8" />
  </svg>
);

/** 電話 */
export const PhoneIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5.2 2.5H3.5a1 1 0 0 0-1 1.1A10.5 10.5 0 0 0 12.4 13.5a1 1 0 0 0 1.1-1v-1.7a1 1 0 0 0-.8-1l-2-.5a1 1 0 0 0-1 .3l-.8.9a7.5 7.5 0 0 1-3.4-3.4l.9-.8a1 1 0 0 0 .3-1l-.5-2a1 1 0 0 0-1-.8Z" />
  </svg>
);

/** 檔案與圖片（迴紋針） */
export const ClipIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m12.5 7.5-4.6 4.6a2.75 2.75 0 0 1-3.9-3.9l5-5a1.75 1.75 0 0 1 2.5 2.5l-4.9 4.9a.75.75 0 0 1-1.1-1.1L10 5" />
  </svg>
);

/** 關聯（右上箭頭） */
export const RelationIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4.5 11.5 11.5 4.5M6 4.5h5.5V10" />
  </svg>
);

/** 公式（Σ） */
export const FormulaIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3.5H4l4 4.5-4 4.5h8" />
  </svg>
);

/** 改名（筆） */
export const PencilIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 13l.6-2.6L10.8 3.2a1.2 1.2 0 0 1 1.7 0l.3.3a1.2 1.2 0 0 1 0 1.7L5.6 12.4Z" />
    <path d="M9.6 4.4l2 2" />
  </svg>
);

/** 最後修改（時鐘＋筆） */
export const EditedIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 13.25A5.25 5.25 0 1 1 12.25 8" />
    <path d="M7 5v3l1.5 1M10 13.5l.4-1.6 2.6-2.6 1.2 1.2-2.6 2.6Z" />
  </svg>
);

/** 畫廊（四格） */
export const GalleryIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2.5" y="2.5" width="4.75" height="4.75" rx="1" />
    <rect x="8.75" y="2.5" width="4.75" height="4.75" rx="1" />
    <rect x="2.5" y="8.75" width="4.75" height="4.75" rx="1" />
    <rect x="8.75" y="8.75" width="4.75" height="4.75" rx="1" />
  </svg>
);

/** 清單 */
export const ListIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5.5 4.5h8M5.5 8h8M5.5 11.5h8" />
    <circle cx="2.75" cy="4.5" r=".6" />
    <circle cx="2.75" cy="8" r=".6" />
    <circle cx="2.75" cy="11.5" r=".6" />
  </svg>
);

/** 時間軸（錯開的長條） */
export const TimelineIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.5 4h6M5.5 8h7M3.5 12h5" strokeWidth="2.2" />
  </svg>
);

export const SettingsIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1.05 1.05M11.35 11.35l1.05 1.05M3.6 12.4l1.05-1.05M11.35 4.65l1.05-1.05" />
    <circle cx="8" cy="8" r="4.25" />
  </svg>
);

export const FolderIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
  </svg>
);

/** 樣式（筆刷） */
export const BrushIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M13.5 2.5 7.6 8.4" />
    <path d="M7.6 8.4l1.1 1.1" />
    <path d="M5.9 9.2c1-.4 2.1.1 2.4 1.1.6 2-1.4 3.9-5.3 3.2 1.2-.9.9-2 1.2-2.8.3-.7 1-1.3 1.7-1.5Z" />
  </svg>
);

/** Draw（流程圖：方塊、菱形與連線） */
export const DrawIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="1.75" y="2" width="5.5" height="4" rx="1" />
    <path d="M11.5 8.75 14.25 11.5 11.5 14.25 8.75 11.5Z" />
    <path d="M4.5 6v5.5h4.25" />
  </svg>
);

export const UndoIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5.5 3.5 2.5 6.5l3 3" />
    <path d="M2.5 6.5h7a4 4 0 0 1 0 8H7" />
  </svg>
);

export const RedoIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m10.5 3.5 3 3-3 3" />
    <path d="M13.5 6.5h-7a4 4 0 0 0 0 8H9" />
  </svg>
);

/** 移到最上層 */
export const FrontIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2" y="2" width="8" height="8" rx="1.25" fill="currentColor" fillOpacity="0.25" />
    <path d="M12.5 6.5H13a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H7.5a1 1 0 0 1-1-1v-.5" />
  </svg>
);

/** 移到最下層 */
export const BackIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9.5 6V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v5.5a1 1 0 0 0 1 1h3" />
    <rect x="6" y="6" width="8" height="8" rx="1.25" fill="currentColor" fillOpacity="0.25" />
  </svg>
);

/** 右邊的面板（格式） */
/** 分割視窗（左右兩個窗格） */
export const SplitIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
    <path d="M8 2.5v11" />
  </svg>
);

/** 重新打開關掉的窗格 */
export const ReopenIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="5.5" y="5.5" width="9" height="8" rx="1.5" />
    <path d="M3.5 9.5v-6a1 1 0 0 1 1-1h6" />
    <path d="M10 8v3M8.5 9.5h3" />
  </svg>
);

export const PanelRightIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <path d="M10 2.5v11" />
  </svg>
);

/** 圖形庫（左邊的面板） */
export const ShapesIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2" y="2" width="5" height="5" rx="1" />
    <circle cx="11.5" cy="4.5" r="2.5" />
    <path d="M4.5 9 7 13.5H2Z" />
    <path d="m11.5 9 2.5 2.25-2.5 2.25L9 11.25Z" />
  </svg>
);

export const AlignTopIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2 2.5h12" />
    <rect x="3.5" y="4.5" width="3.5" height="9" rx="0.75" />
    <rect x="9" y="4.5" width="3.5" height="5" rx="0.75" />
  </svg>
);

export const AlignMiddleIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2 8h12" />
    <rect x="3.5" y="3" width="3.5" height="10" rx="0.75" />
    <rect x="9" y="5.5" width="3.5" height="5" rx="0.75" />
  </svg>
);

export const AlignBottomIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2 13.5h12" />
    <rect x="3.5" y="2.5" width="3.5" height="9" rx="0.75" />
    <rect x="9" y="6.5" width="3.5" height="5" rx="0.75" />
  </svg>
);

export const DistributeHIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2 2v12M14 2v12" />
    <rect x="5.75" y="4.5" width="4.5" height="7" rx="0.75" />
  </svg>
);

export const DistributeVIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2 2h12M2 14h12" />
    <rect x="4.5" y="5.75" width="7" height="4.5" rx="0.75" />
  </svg>
);

/** 反轉方向 */
export const SwapIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.5 5.5h10l-2.5-2.5M13.5 10.5h-10l2.5 2.5" />
  </svg>
);

/** 畫板（Draw 的 Frame） */
export const FrameIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 1.5v13M11 1.5v13M1.5 5h13M1.5 11h13" />
  </svg>
);

export const ImageIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <circle cx="5.75" cy="6" r="1.25" />
    <path d="m2.5 12 3.5-3.5 2.5 2.5 2-2 3 3" />
  </svg>
);

/** 圖層 */
export const LayersIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 2 14 5.25 8 8.5 2 5.25Z" />
    <path d="m2 8 6 3.25L14 8" />
    <path d="m2 10.75 6 3.25 6-3.25" />
  </svg>
);

export const EyeIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" />
    <circle cx="8" cy="8" r="2" />
  </svg>
);

export const EyeOffIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6.2 3.75A6.6 6.6 0 0 1 8 3.5c4 0 6.5 4.5 6.5 4.5a11 11 0 0 1-1.7 2.2M10.3 11.9A6.3 6.3 0 0 1 8 12.5C4 12.5 1.5 8 1.5 8a11.3 11.3 0 0 1 2.4-2.8" />
    <path d="M2 2l12 12" />
  </svg>
);

export const LockIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="7" width="10" height="7" rx="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </svg>
);

export const UnlockIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="7" width="10" height="7" rx="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7" />
  </svg>
);

/** Drawer（文獻庫：抽屜） */
export const DrawerIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <path d="M2 8h12M6.5 5.25h3M6.5 10.75h3" />
  </svg>
);

/** 匯入（上傳） */
export const ImportIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 10V2.5M5 5.5l3-3 3 3" />
    <path d="M2.5 11v1.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V11" />
  </svg>
);

/** 引用（引號） */
export const QuoteIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 10.5c0-2.5 1-4.5 3-5.5M3 10.5a1.75 1.75 0 1 0 3.5 0 1.75 1.75 0 0 0-3.5 0M9.5 10.5c0-2.5 1-4.5 3-5.5M9.5 10.5a1.75 1.75 0 1 0 3.5 0 1.75 1.75 0 0 0-3.5 0" />
  </svg>
);

/** 用識別碼新增（魔杖） */
export const WandIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m2.5 13.5 7.5-7.5M9 3V1.75M12.25 4.25l.9-.9M13 7.5h1.25M11.5 2.5l2 2" />
  </svg>
);

/** 項目符號清單 */
export const BulletListIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6.5 4h7M6.5 8h7M6.5 12h7" />
    <circle cx="3" cy="4" r=".9" fill="currentColor" stroke="none" />
    <circle cx="3" cy="8" r=".9" fill="currentColor" stroke="none" />
    <circle cx="3" cy="12" r=".9" fill="currentColor" stroke="none" />
  </svg>
);

/** 編號清單 */
export const NumberListIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6.5 4h7M6.5 8h7M6.5 12h7" />
    <path d="M2.4 3.2 3.3 2.7v3M2.3 9.6c.2-.6 1.7-.8 1.7.1 0 .6-1.6 1.3-1.7 2h1.8" strokeWidth="1.1" />
  </svg>
);

/** 影片 */
export const VideoIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="1.8" y="3.5" width="9" height="9" rx="1.6" />
    <path d="m10.8 6.6 3.4-2v6.8l-3.4-2" />
  </svg>
);

/** 表格 */
export const TableIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <path d="M2 6.2h12M2 9.9h12M6.3 6.2v7.3M10 6.2v7.3" />
  </svg>
);

/** 分隔線 */
export const RuleIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2 8h12" />
    <path d="M4.5 4.5h7M4.5 11.5h7" opacity=".4" />
  </svg>
);

/** 邊界（頁面上的版心） */
export const MarginIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="1.8" width="10" height="12.4" rx="1" />
    <rect x="5.2" y="4" width="5.6" height="8" rx=".3" strokeDasharray="1.4 1.2" />
  </svg>
);

/** 行距 */
export const SpacingIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 4h7M7 8h7M7 12h7M3.5 2.5v11M2 4l1.5-1.5L5 4M2 12l1.5 1.5L5 12" />
  </svg>
);

/** 字型 */
export const FontIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m2.5 13 4-10 4 10M4 9.5h5M11.5 13V8.5M10 8.5h3" />
  </svg>
);

/** 幻燈片放映（螢幕上一個播放鍵） */
export const ShowIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="1.8" y="2.5" width="12.4" height="8.5" rx="1.2" />
    <path d="M8 11v2.5M5.5 13.5h5M7 5.2v3.1l2.5-1.55L7 5.2Z" />
  </svg>
);

/** Banyan 的標誌（層層起伏的寬樹冠、粗樹幹與垂下的氣根，單色剪影）；與 src-tauri/app-icon.svg、public/favicon.svg 同一個圖形。 */
export const BanyanMark = ({ size = 22, ...p }: IconProps & { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden {...p}>
    <rect width="120" height="120" rx="27" fill="var(--brand)" />
    <path d="M8 62Q8 48 22 46Q24 32 42 32Q48 18 64 21Q80 15 90 29Q108 29 110 45Q114 54 112 62Z" fill="#fff" />
    <path d="M51 62H69V86Q69 97 84 102H36Q51 97 51 86Z" fill="#fff" />
    <path d="M22 62V98M34 62V92M86 62V92M98 62V98" fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" />
  </svg>
);

/** 圖表（直條） */
export const ChartIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.5 13.5h11" />
    <path d="M4.5 13.5V8.5M8 13.5V4M11.5 13.5V6.5" strokeWidth={2.2} />
  </svg>
);
