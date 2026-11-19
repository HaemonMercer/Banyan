import { useEffect, useRef, useState } from "react";
import {
  SHAPES,
  STRUCTURES,
  THEMES,
  TOPIC_COLORS,
  findTopic,
  structureOf,
  themeOf,
  type MapStyle,
  type MindMap,
  type Shape,
  type Structure,
  type Theme,
  type TopicColor,
  type TopicLook,
} from "./mindmap";
import { CARD_FILLS, type CardFill, type CardLook } from "./board";
import type { Color } from "../editor/inline";

/**
 * 心智圖的樣式列：選取心智圖的主題時固定在畫面下方中央。
 * 左邊是整張圖（結構、配色主題），右邊是選取的主題（顏色、形狀、粗體、重設）。
 * 改了馬上套用；按下時不搶走畫布的焦點（鍵盤操作照常）。配色主題與顏色的選單往上打開。
 */
export function MindMapStyleBar(props: {
  map: MindMap;
  topic: string;
  onMap: (patch: MapStyle) => void;
  onTopic: (patch: Partial<Record<keyof TopicLook, unknown>> | null) => void;
}) {
  const [open, setOpen] = usePopup<"theme" | "color">();
  const ref = useRef<HTMLDivElement>(null);

  const structure = structureOf(props.map);
  const theme = themeOf(props.map.style?.theme);
  const found = findTopic(props.map, props.topic);
  const look = found?.topic.look ?? {};
  // 沒指定形狀時，畫面上用的預設形狀
  const defaultShape: Shape = (found?.depth ?? 0) >= 2 && (structure === "map" || structure === "right") ? "underline" : "rounded";
  const shape = look.shape ?? defaultShape;
  const colorName = (c: TopicColor) => c[0].toUpperCase() + c.slice(1);

  return (
    <div
      className="mm-bar board-ui"
      ref={ref}
      onPointerDown={(e) => e.preventDefault()}
      role="toolbar"
      aria-label="Mind map style"
    >
      <div className="mmb-group" title="Structure">
        {STRUCTURES.map((s) => (
          <button
            key={s.id}
            className={`mmb-btn thumb${structure === s.id ? " on" : ""}`}
            onClick={() => props.onMap({ structure: s.id })}
            title={s.label}
            aria-label={s.label}
          >
            <StructureThumb id={s.id} />
          </button>
        ))}
      </div>
      <span className="mmb-sep" />
      <div className="mmb-group rel">
        <button
          className={`mmb-btn mmb-open wide${open === "theme" ? " on" : ""}`}
          onClick={() => setOpen(open === "theme" ? null : "theme")}
          title="Color theme"
        >
          <ThemeChips t={theme} />
          <span className="mmb-text">{theme.label}</span>
          <span className="mmb-caret">▴</span>
        </button>
        {open === "theme" && (
          <div className="popover mmb-pop themes">
            <div className="popover-title">Theme</div>
            <div className="mmb-themes">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  className={`mmb-tile${theme.id === t.id ? " on" : ""}`}
                  onClick={() => {
                    props.onMap({ theme: t.id });
                    setOpen(null);
                  }}
                >
                  <ThemeChips t={t} />
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {found && (
        <>
          <span className="mmb-sep" />
          <div className="mmb-group rel">
            <button
              className={`mmb-btn mmb-open${open === "color" ? " on" : ""}`}
              onClick={() => setOpen(open === "color" ? null : "color")}
              title="Topic color"
            >
              <span
                className={`mmb-dot${look.color ? "" : " auto"}`}
                style={look.color ? { background: TOPIC_COLORS[look.color] } : undefined}
              />
              <span className="mmb-caret">▴</span>
            </button>
            {open === "color" && (
              <div className="popover mmb-pop colors">
                <div className="popover-title">Topic color</div>
                <div className="mmb-colors">
                  <button
                    className={`mmb-swatch auto${!look.color ? " on" : ""}`}
                    title="Theme color"
                    onClick={() => {
                      props.onTopic({ color: undefined });
                      setOpen(null);
                    }}
                  />
                  {(Object.keys(TOPIC_COLORS) as TopicColor[]).map((c) => (
                    <button
                      key={c}
                      className={`mmb-swatch${look.color === c ? " on" : ""}`}
                      style={{ background: TOPIC_COLORS[c] }}
                      title={colorName(c)}
                      onClick={() => {
                        props.onTopic({ color: c });
                        setOpen(null);
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="mmb-group" title="Shape">
            {SHAPES.map((s) => (
              <button
                key={s.id}
                className={`mmb-btn${shape === s.id ? " on" : ""}`}
                title={s.label}
                aria-label={s.label}
                onClick={() => props.onTopic({ shape: s.id === defaultShape ? undefined : s.id })}
              >
                <ShapeThumb id={s.id} />
              </button>
            ))}
          </div>
          <button className={`mmb-btn bold${look.bold ? " on" : ""}`} title="Bold" onClick={() => props.onTopic({ bold: !look.bold })}>
            B
          </button>
          {(look.color || look.shape || look.bold) && (
            <button className="mmb-btn" title="Reset topic style" aria-label="Reset topic style" onClick={() => props.onTopic(null)}>
              ↺
            </button>
          )}
        </>
      )}
      <span className="mmb-sep" />
      <span
        className="mmb-help"
        title={[
          "Tab: subtopic",
          "Enter: next topic (Shift+Enter: before)",
          "Space / F2: edit",
          "Delete: remove",
          "Arrows: move between topics",
          "Ctrl+.: collapse",
          "Drag onto a topic to move it",
        ].join("\n")}
      >
        ?
      </span>
    </div>
  );
}

function ThemeChips({ t }: { t: Theme }) {
  return (
    <span className="mms-theme">
      <i className="root" style={{ background: t.rootBg }} />
      {[0, 1, 2].map((i) => (
        <i key={i} className={`main ${t.mainFill}`} style={{ "--mm-c": t.branches[i % t.branches.length] } as React.CSSProperties} />
      ))}
    </span>
  );
}

/** 結構的縮圖 */
function StructureThumb({ id }: { id: Structure }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" as const };
  const box = (x: number, y: number, w = 10, h = 5, solid = false) => (
    <rect x={x} y={y} width={w} height={h} rx={1.5} fill={solid ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.2} />
  );
  return (
    <svg width="34" height="22" viewBox="0 0 48 30" aria-hidden>
      {id === "map" && (
        <>
          {box(18, 12, 12, 6, true)}
          <path d="M30 15 C34 15 34 7 38 7 M30 15 C34 15 34 23 38 23 M18 15 C14 15 14 7 10 7 M18 15 C14 15 14 23 10 23" {...p} />
          {box(38, 4.5, 8)}
          {box(38, 20.5, 8)}
          {box(2, 4.5, 8)}
          {box(2, 20.5, 8)}
        </>
      )}
      {id === "right" && (
        <>
          {box(3, 12, 12, 6, true)}
          <path d="M15 15 C20 15 20 5 25 5 M15 15 H25 M15 15 C20 15 20 25 25 25" {...p} />
          {box(25, 2.5, 14)}
          {box(25, 12.5, 14)}
          {box(25, 22.5, 14)}
        </>
      )}
      {id === "org" && (
        <>
          {box(18, 2, 12, 6, true)}
          <path d="M24 8 V13 M8 13 H40 M8 13 V18 M24 13 V18 M40 13 V18" {...p} />
          {box(3, 18, 10, 6)}
          {box(19, 18, 10, 6)}
          {box(35, 18, 10, 6)}
        </>
      )}
      {id === "tree" && (
        <>
          {box(4, 2, 14, 6, true)}
          <path d="M8 8 V11.5 H16 M8 11.5 V19.5 H16 M8 19.5 V27 H16" {...p} />
          {box(16, 9, 14, 5)}
          {box(16, 17, 14, 5)}
          {box(16, 24.5, 14, 5)}
        </>
      )}
    </svg>
  );
}

/** 形狀的縮圖 */
function ShapeThumb({ id }: { id: Shape }) {
  const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.4 };
  return (
    <svg width="24" height="16" viewBox="0 0 26 16" aria-hidden>
      {id === "rounded" && <rect x="2" y="3" width="22" height="10" rx="3" {...s} />}
      {id === "rect" && <rect x="2" y="3" width="22" height="10" rx="0.5" {...s} />}
      {id === "pill" && <rect x="2" y="3" width="22" height="10" rx="5" {...s} />}
      {id === "underline" && (
        <>
          <path d="M5 8 H21" stroke="currentColor" strokeWidth="1" opacity="0.45" />
          <path d="M2 13 H24" {...s} strokeLinecap="round" />
        </>
      )}
      {id === "plain" && <path d="M5 8 H21" stroke="currentColor" strokeWidth="1.4" opacity="0.7" strokeLinecap="round" />}
    </svg>
  );
}

/** 往上打開的小選單：點選單外面或按 Esc 關掉（Esc 不再傳給白板） */
export function usePopup<T extends string>(): [T | null, (v: T | null) => void] {
  const [open, setOpen] = useState<T | null>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest?.(".mmb-pop, .mmb-open")) setOpen(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(null);
      }
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [open]);
  return [open, setOpen];
}

const CARD_COLORS: Color[] = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** 樣式列能改的東西：卡片或區段（都有顏色與外觀） */
export interface Styled {
  color: Color | null;
  look?: CardLook;
}

/**
 * 卡片與區段的樣式列（和心智圖的樣式列同一個樣子）：選取卡片或區段時固定在畫面下方中央，一次改所有選取的。
 * 填色（淡色底、實心、外框）、顏色、形狀、粗體（區段是標題）、重設。顯示的是第一個目前的樣式。
 */
export function CardStyleBar(props: {
  items: Styled[];
  /** 選了幾張卡片、幾個區段（顯示「3 cards」「2 sections」「4 items」） */
  cards: number;
  sections: number;
  onLook: (patch: (Partial<Record<keyof CardLook, unknown>> & { color?: Color | null }) | null) => void;
}) {
  const [open, setOpen] = usePopup<"color">();
  const first = props.items[0];
  if (!first) return null;
  const n = props.cards + props.sections;
  const count = !props.sections ? `${n} cards` : !props.cards ? `${n} sections` : `${n} items`;
  const what = !props.cards ? "Section" : !props.sections ? "Card" : "Item";
  const look = first.look ?? {};
  const fill: CardFill = look.fill ?? "soft";
  const shape: Shape = look.shape ?? "rounded";
  const styled = props.items.some((c) => c.look);
  return (
    <div className="mm-bar card-bar board-ui" onPointerDown={(e) => e.preventDefault()} role="toolbar" aria-label={`${what} style`}>
      {n > 1 && <span className="mmb-count">{count}</span>}
      <div className="mmb-group" title="Fill">
        {CARD_FILLS.map((f) => (
          <button
            key={f.id}
            className={`mmb-btn${fill === f.id ? " on" : ""}`}
            title={f.label}
            aria-label={f.label}
            onClick={() => props.onLook({ fill: f.id === "soft" ? undefined : f.id })}
          >
            <FillThumb id={f.id} />
          </button>
        ))}
      </div>
      <span className="mmb-sep" />
      <div className="mmb-group rel">
        <button className={`mmb-btn mmb-open${open === "color" ? " on" : ""}`} onClick={() => setOpen(open ? null : "color")} title={`${what} color`}>
          <span className={`mmb-dot${first.color ? "" : " none"}`} style={first.color ? { background: `var(--tc-${first.color})` } : undefined} />
          <span className="mmb-caret">▴</span>
        </button>
        {open === "color" && (
          <div className="popover mmb-pop colors">
            <div className="popover-title">{what} color</div>
            <div className="mmb-colors">
              <button
                className={`mmb-swatch none${!first.color ? " on" : ""}`}
                title="Default"
                onClick={() => {
                  props.onLook({ color: null });
                  setOpen(null);
                }}
              />
              {CARD_COLORS.map((c) => (
                <button
                  key={c}
                  className={`mmb-swatch${first.color === c ? " on" : ""}`}
                  style={{ background: `var(--tc-${c})` }}
                  title={cap(c)}
                  onClick={() => {
                    props.onLook({ color: c });
                    setOpen(null);
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="mmb-group" title="Shape">
        {SHAPES.map((s) => (
          <button
            key={s.id}
            className={`mmb-btn${shape === s.id ? " on" : ""}`}
            title={s.label}
            aria-label={s.label}
            onClick={() => props.onLook({ shape: s.id === "rounded" ? undefined : s.id })}
          >
            <ShapeThumb id={s.id} />
          </button>
        ))}
      </div>
      <button className={`mmb-btn bold${look.bold ? " on" : ""}`} title={props.cards ? "Bold text" : "Bold title"} onClick={() => props.onLook({ bold: !look.bold })}>
        B
      </button>
      {styled && (
        <button className="mmb-btn" title="Reset style (keeps the color)" aria-label="Reset style" onClick={() => props.onLook(null)}>
          ↺
        </button>
      )}
    </div>
  );
}

/** 填色的縮圖 */
function FillThumb({ id }: { id: CardFill }) {
  return (
    <svg width="24" height="16" viewBox="0 0 24 16" aria-hidden>
      {id === "soft" && <rect x="2" y="2.5" width="20" height="11" rx="2.5" fill="currentColor" opacity="0.18" stroke="currentColor" strokeOpacity="0.35" />}
      {id === "solid" && <rect x="2" y="2.5" width="20" height="11" rx="2.5" fill="currentColor" />}
      {id === "outline" && <rect x="2.75" y="3.25" width="18.5" height="9.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />}
    </svg>
  );
}
