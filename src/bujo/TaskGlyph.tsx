import type { MouseEvent } from "react";
import { TASK_LABEL, type TaskState } from "./tasks";
import { WEEKDAYS_SHORT } from "../journal/journal";

/**
 * 子彈筆記的符號（SVG，各種字型下大小、位置都一致）。任務是方框，狀態畫在框裡：
 * 任務 □、完成 ☒、已排程（框裡 ←）、取消（劃掉的框）、事件 ○、筆記 –。
 */
export function TaskIcon(props: { state: TaskState | "note"; size?: number }) {
  const size = props.size ?? 14;
  const line = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const box = <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" {...line} strokeWidth={1.5} />;
  let body;
  switch (props.state) {
    case "open":
      body = box;
      break;
    case "done":
      body = (
        <>
          {box}
          <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" {...line} />
        </>
      );
      break;
    case "scheduled":
      body = (
        <>
          {box}
          <path d="M11 8H5.5M7.6 5.8 5.4 8l2.2 2.2" {...line} strokeWidth={1.4} />
        </>
      );
      break;
    case "cancelled":
      body = (
        <>
          {box}
          <path d="M0.8 8h14.4" {...line} strokeWidth={1.4} />
        </>
      );
      break;
    case "event":
      body = <circle cx="8" cy="8" r="5.3" {...line} strokeWidth={1.5} />;
      break;
    case "note":
      body = <path d="M4.5 8h7" {...line} />;
      break;
  }
  return (
    <svg className="task-icon" width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      {body}
    </svg>
  );
}

/** 清單項目前面可以點的符號。點一下切換完成；右鍵開啟狀態選單。 */
export function TaskGlyph(props: {
  state: TaskState;
  /** 待辦清單的核取方塊（只有未完成、完成，沒有右鍵選單） */
  box?: boolean;
  onClick?: () => void;
  onMenu?: (x: number, y: number) => void;
}) {
  const stop = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <span
      className={props.box ? `task-box${props.state === "done" ? " checked" : ""}` : `task-glyph g-${props.state}`}
      role={props.box ? "checkbox" : "button"}
      aria-checked={props.box ? props.state === "done" : undefined}
      aria-label={props.box ? undefined : TASK_LABEL[props.state]}
      contentEditable={false}
      title={props.box ? (props.state === "done" ? "Done (click to undo)" : "Click to check") : `${TASK_LABEL[props.state]}${props.state === "event" ? "" : " (click to toggle done, right-click for more)"}`}
      onMouseDown={stop}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        stop(e);
        props.onClick?.();
      }}
      onContextMenu={(e) => {
        stop(e);
        if (!props.box) props.onMenu?.(e.clientX, e.clientY);
      }}
    >
      {props.box ? (
        props.state === "done" && (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M2.5 6.2l2.4 2.4 4.6-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )
      ) : (
        <TaskIcon state={props.state} />
      )}
    </span>
  );
}

/** 任務附加的日期（`[[2026-11-20]]`）：「11/20 四」；過期（未完成）紅色、今天藍色。點一下開啟那天的日記。 */
export function DateChip(props: { date: string; state: TaskState; onOpen?: (date: string) => void }) {
  const now = localToday();
  const [, m, d] = props.date.split("-").map(Number);
  const wd = WEEKDAYS_SHORT[new Date(`${props.date}T00:00:00`).getDay()];
  const open = props.state === "open" || props.state === "event";
  const cls = !open ? "" : props.date < now ? " overdue" : props.date === now ? " today" : "";
  return (
    <span
      className={`date-chip${cls}`}
      role="button"
      contentEditable={false}
      title={`${props.date} (click to open that day's journal)`}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        props.onOpen?.(props.date);
      }}
    >
      <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden>
        <rect x="2" y="3" width="12" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M2 7h12M5.5 1.5v3M10.5 1.5v3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      {m}/{d} {wd}
    </span>
  );
}

function localToday(): string {
  const t = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}
