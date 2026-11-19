import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { layoutMap, lineHeight, type DropMode, type MindMap, type Topic, type TopicNode } from "./mindmap";

/**
 * 一張心智圖（參考 XMind）：連線與底線畫在 SVG，主題是 div；位置、顏色、形狀、字級全部來自 `layoutMap`，
 * CSS 只管外觀（`.mm-topic` 的 `fill-*`、`s-*`），所以量字寬與畫面一定一致。
 * 選取、拖曳、鍵盤都由 Whiteboard 從畫布根元素分派（`data-topic`、`data-fold`）。
 */
export const MindMapView = memo(function MindMapView(props: {
  map: MindMap;
  /** 選取的主題 */
  selected: string | null;
  /** 整張圖被框選 */
  mapSelected: boolean;
  /** 正在編輯的主題與還沒存的文字 */
  editing: { topic: string; text: string; selectAll: boolean } | null;
  /** 正在拖曳的主題（畫淡一點） */
  dragging: string | null;
  drop: { topic: string; mode: DropMode } | null;
  onDraft: (text: string) => void;
  onEditEnd: (how: "enter" | "tab" | "esc" | "blur") => void;
}) {
  const { map, editing } = props;
  const L = useMemo(
    () => layoutMap(map, editing ? { id: editing.topic, text: editing.text } : null),
    [map, editing],
  );
  const topics = useMemo(() => {
    const out = new Map<string, Topic>();
    const walk = (t: Topic) => {
      out.set(t.id, t);
      t.children.forEach(walk);
    };
    walk(map.root);
    return out;
  }, [map]);

  const b = L.bounds;
  return (
    <div className={`mm st-${L.structure}${props.mapSelected ? " selected" : ""}`} data-map-root={map.id}>
      {props.mapSelected && <div className="mm-frame" style={{ left: b.x - 14, top: b.y - 14, width: b.w + 28, height: b.h + 28 }} />}
      <svg className="mm-links" width="1" height="1">
        {L.links.map((l) => (
          <path key={l.to} d={l.d} className={`mm-link${l.depth === 1 ? " main" : ""}`} style={{ stroke: l.color }} />
        ))}
        {L.order.map((id) => {
          const n = L.nodes.get(id)!;
          if (n.shape !== "underline") return null;
          const y = n.y + n.h;
          return <path key={id} d={`M ${n.x} ${y} L ${n.x + n.w} ${y}`} className="mm-under" style={{ stroke: n.color }} />;
        })}
      </svg>
      {L.order.map((id) => {
        const n = L.nodes.get(id)!;
        const t = topics.get(id);
        if (!t) return null;
        const drop = props.drop?.topic === id ? ` drop-${props.drop.mode}` : "";
        const cls =
          `mm-topic d${Math.min(n.depth, 2)} s-${n.shape} fill-${n.fill}` +
          `${props.selected === id ? " selected" : ""}${props.dragging === id ? " ghosting" : ""}${drop}`;
        return (
          <div key={id} className={cls} data-topic={id} data-map={map.id} style={topicStyle(n)}>
            {editing?.topic === id ? (
              <TopicInput text={editing.text} selectAll={editing.selectAll} onDraft={props.onDraft} onEnd={props.onEditEnd} />
            ) : t.text ? (
              t.text
            ) : (
              <span className="mm-empty">{" "}</span>
            )}
          </div>
        );
      })}
      {L.order.map((id) => {
        const n = L.nodes.get(id)!;
        if (!n.hasChildren || n.depth === 0) return null;
        return (
          <div
            key={id}
            className={`mm-fold${n.hidden ? " shut" : ""}`}
            data-fold={id}
            data-map={map.id}
            style={{ left: n.fold.x, top: n.fold.y, "--mm-c": n.color } as React.CSSProperties}
            title={n.hidden ? "Expand (Ctrl+.)" : "Collapse (Ctrl+.)"}
          >
            {n.hidden ? n.hidden : "−"}
          </div>
        );
      })}
    </div>
  );
});

function topicStyle(n: TopicNode): React.CSSProperties {
  const s = n.style;
  return {
    left: n.x,
    top: n.y,
    width: n.w,
    height: n.h,
    padding: `${s.padY}px ${s.padX}px`,
    fontSize: s.font,
    fontWeight: s.weight,
    lineHeight: `${lineHeight(s.font)}px`,
    "--mm-c": n.color,
    "--mm-on": n.on,
  } as React.CSSProperties;
}

/** 編輯主題的文字框：Enter 完成、Shift＋Enter 換行、Tab 完成並加子主題、Esc 完成。 */
function TopicInput(props: {
  text: string;
  selectAll: boolean;
  onDraft: (t: string) => void;
  onEnd: (how: "enter" | "tab" | "esc" | "blur") => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (props.selectAll) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
    // 只在開始編輯時
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <textarea
      ref={ref}
      className="mm-input"
      value={props.text}
      rows={1}
      spellCheck={false}
      onChange={(e) => props.onDraft(e.target.value)}
      onBlur={() => props.onEnd("blur")}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          props.onEnd("enter");
        } else if (e.key === "Tab") {
          e.preventDefault();
          props.onEnd("tab");
        } else if (e.key === "Escape") {
          e.preventDefault();
          props.onEnd("esc");
        }
      }}
    />
  );
}
