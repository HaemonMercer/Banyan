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
export const DatabaseIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2" y="2.75" width="12" height="10.5" rx="1.5" />
    <path d="M2 6.25h12M2 9.75h12M6.25 6.25v7" />
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

/** Desk（書桌） */
export const DeskIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M1.75 6.25h12.5M3 6.25v7M13 6.25v7M9 6.25v4h4" />
    <rect x="4.25" y="2" width="4.5" height="4.25" rx=".5" />
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

/** 白板（畫布上兩張卡片連起來） */
export const WhiteboardIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="1.75" y="2.5" width="6" height="4.5" rx="1" />
    <rect x="8.25" y="9" width="6" height="4.5" rx="1" />
    <path d="M7.75 4.75h2.5a1 1 0 0 1 1 1V9" />
  </svg>
);
