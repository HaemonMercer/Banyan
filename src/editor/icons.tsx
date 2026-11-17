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
