import { CustomColor } from "../editor/ColorPicker";
import { useEffect, useState } from "react";
import { COLORS, COLOR_LABELS } from "../editor/inline";
import {
  AlignBottomIcon,
  AlignCenterIcon,
  AlignLeftIcon,
  AlignMiddleIcon,
  AlignRightIcon,
  AlignTopIcon,
  BackIcon,
  DistributeHIcon,
  DistributeVIcon,
  FrontIcon,
  ImageIcon,
  SectionIcon,
  SwapIcon,
} from "../editor/icons";
import {
  alignItems,
  ARROWS,
  arrowHead,
  distribute,
  flipEdges,
  FONTS,
  FRAME_PRESETS,
  groupItems,
  MENU_KINDS,
  MIN_SIZE,
  patchShapes,
  radiusOf,
  reorder,
  setEdgeStyle,
  setKind,
  setShapeStyle,
  SHADOWS,
  SHAPE_INFO,
  shapePath,
  ungroupItems,
  type AlignHow,
  type Arrow,
  type Dash,
  type Diagram,
  type Edge,
  type EdgeStyle,
  type Paint,
  type Route,
  type Shadow,
  type Shape,
  type ShapeKind,
  type ShapeStyle,
} from "./draw";
import { usePopup } from "./MindMapStyle";

/**
 * Draw 的樣式列：選取圖形或連線時固定在畫面下方中央，和白板的卡片、心智圖樣式列同一套外觀（`mm-bar`）。
 * 精確的屬性（位置與大小、圓角、任意色碼、字型、字重、行高、字距、陰影、不透明度、圖片）都在往上打開的選單裡。
 * 改了馬上套用；按下時不搶走畫布的焦點（輸入框除外）。
 */

const isHexPaint = (p: Paint): p is `#${string}` => p.startsWith("#");
export const fillCss = (p: Paint) => (p === "none" ? "none" : p === "default" ? "var(--draw-fill)" : isHexPaint(p) ? p : `var(--bg-${p})`);
export const strokeCss = (p: Paint) => (p === "none" ? "none" : p === "default" ? "var(--draw-line)" : isHexPaint(p) ? p : `var(--tc-${p})`);
export const textCss = (p: Paint) => (p === "default" || p === "none" ? "var(--ed-text)" : isHexPaint(p) ? p : `var(--tc-${p})`);
const paintLabel = (p: Paint) => (p === "none" ? "None" : p === "default" ? "Default" : isHexPaint(p) ? p : COLOR_LABELS[p]);

type Pop = "kind" | "size" | "fill" | "stroke" | "text" | "effects" | "image" | "arrange" | "ecolor" | "estroke" | "start" | "end";
const WEIGHTS = [
  [300, "Light"],
  [400, "Regular"],
  [500, "Medium"],
  [600, "Semibold"],
  [700, "Bold"],
  [800, "Extra bold"],
] as const;
const SHADOW_LABEL: Record<Shadow, string> = { none: "None", sm: "S", md: "M", lg: "L" };
const ROUNDABLE = new Set<ShapeKind>(["rect", "rounded", "frame", "image", "text"]);

export function DrawStyleBar(props: {
  shapes: Shape[];
  edges: Edge[];
  onApply: (fn: (d: Diagram) => Diagram) => void;
  onReplaceImage: () => void;
}) {
  const { shapes, edges, onApply } = props;
  const [open, setOpen] = usePopup<Pop>();
  const toggle = (p: Pop) => setOpen(open === p ? null : p);
  const sIds = shapes.map((s) => s.id);
  const eIds = edges.map((e) => e.id);
  const all = [...sIds, ...eIds];
  const s0 = shapes[0];
  const e0 = edges[0];
  const shapeStyle = (patch: Partial<ShapeStyle>) => onApply((d) => setShapeStyle(d, sIds, patch));
  const edgeStyle = (patch: Partial<EdgeStyle>) => onApply((d) => setEdgeStyle(d, eIds, patch));
  const n = all.length;
  const allFrames = shapes.length > 0 && shapes.every((s) => s.kind === "frame");
  const textShapes = shapes.filter((s) => s.kind !== "frame" && s.kind !== "image");
  const t0 = textShapes[0];
  const images = shapes.filter((s) => s.kind === "image");
  const setTextStyle = (patch: Partial<ShapeStyle>) => onApply((d) => setShapeStyle(d, textShapes.map((s) => s.id), patch));
  const geo = (k: "x" | "y" | "w" | "h", v: number) =>
    onApply((d) => patchShapes(d, sIds, (s) => ({ ...s, [k]: k === "w" || k === "h" ? Math.max(MIN_SIZE, v) : v })));

  return (
    <div
      className="mm-bar board-ui dw-bar"
      onPointerDown={(e) => {
        // 按鈕不搶走畫布的焦點；輸入框照常
        if (!(e.target as Element).closest("input, select, textarea")) e.preventDefault();
      }}
      role="toolbar"
      aria-label="Diagram style"
    >
      {n > 1 && <span className="mmb-count">{n} items</span>}
      {s0 && (
        <>
          {/* 種類，或畫板的尺寸 */}
          {allFrames ? (
            <div className="mmb-group rel">
              <button className={`mmb-btn mmb-open wide${open === "kind" ? " on" : ""}`} onClick={() => toggle("kind")} title="Frame size">
                <span className="mmb-text">{FRAME_PRESETS.find((p) => p.w === s0.w && p.h === s0.h)?.label ?? "Custom"}</span>
                <span className="mmb-caret">▴</span>
              </button>
              {open === "kind" && (
                <div className="popover mmb-pop dwb-list">
                  <div className="popover-title">Frame size</div>
                  {FRAME_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      className={`dwb-item${s0.w === p.w && s0.h === p.h ? " on" : ""}`}
                      onClick={() => {
                        onApply((d) => patchShapes(d, sIds, (s) => ({ ...s, w: p.w, h: p.h })));
                        setOpen(null);
                      }}
                    >
                      <span>{p.label}</span>
                      <span className="dwb-hint">
                        {p.w} × {p.h}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            t0 && (
              <div className="mmb-group rel">
                <button className={`mmb-btn mmb-open${open === "kind" ? " on" : ""}`} onClick={() => toggle("kind")} title="Shape">
                  <KindThumb kind={t0.kind} />
                  <span className="mmb-caret">▴</span>
                </button>
                {open === "kind" && (
                  <div className="popover mmb-pop">
                    <div className="popover-title">Shape</div>
                    <div className="dwb-kinds">
                      {MENU_KINDS.map((k) => (
                        <button
                          key={k}
                          className={`mmb-tile${textShapes.every((s) => s.kind === k) ? " on" : ""}`}
                          onClick={() => {
                            onApply((d) => setKind(d, textShapes.map((s) => s.id), k));
                            setOpen(null);
                          }}
                        >
                          <KindThumb kind={k} />
                          <span>{SHAPE_INFO[k].label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          )}

          {/* 位置與大小 */}
          <div className="mmb-group rel">
            <button className={`mmb-btn mmb-open wide${open === "size" ? " on" : ""}`} onClick={() => toggle("size")} title="Position and size">
              <span className="mmb-text dwb-num">
                {Math.round(s0.w)} × {Math.round(s0.h)}
              </span>
              <span className="mmb-caret">▴</span>
            </button>
            {open === "size" && (
              <div className="popover mmb-pop dwb-form">
                <div className="popover-title">Position and size</div>
                <div className="dwb-grid">
                  <NumField label="X" value={s0.x} disabled={shapes.length > 1} onChange={(v) => geo("x", v)} />
                  <NumField label="Y" value={s0.y} disabled={shapes.length > 1} onChange={(v) => geo("y", v)} />
                  <NumField label="W" value={s0.w} min={MIN_SIZE} onChange={(v) => geo("w", v)} />
                  <NumField label="H" value={s0.h} min={MIN_SIZE} onChange={(v) => geo("h", v)} />
                </div>
                {shapes.some((s) => ROUNDABLE.has(s.kind)) && (
                  <div className="dwb-grid">
                    <NumField
                      label="Radius"
                      value={radiusOf(shapes.find((s) => ROUNDABLE.has(s.kind))!)}
                      min={0}
                      onChange={(radius) => onApply((d) => setShapeStyle(d, shapes.filter((s) => ROUNDABLE.has(s.kind)).map((s) => s.id), { radius }))}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
          <span className="mmb-sep" />

          {/* 填色、外框 */}
          <ColorPick
            open={open === "fill"}
            onOpen={() => toggle("fill")}
            title="Fill"
            mode="fill"
            value={s0.style.fill}
            onPick={(fill) => shapeStyle({ fill })}
          />
          <div className="mmb-group rel">
            <button className={`mmb-btn mmb-open${open === "stroke" ? " on" : ""}`} onClick={() => toggle("stroke")} title="Stroke">
              <span className={`dwb-ring${s0.style.stroke === "none" ? " none" : ""}`} style={s0.style.stroke === "none" ? undefined : { borderColor: strokeCss(s0.style.stroke) }} />
              <span className="mmb-caret">▴</span>
            </button>
            {open === "stroke" && (
              <div className="popover mmb-pop dwb-form">
                <div className="popover-title">Stroke</div>
                <Swatches mode="line" value={s0.style.stroke} onPick={(stroke) => shapeStyle({ stroke })} />
                <HexField value={s0.style.stroke} onPick={(stroke) => shapeStyle({ stroke })} />
                <div className="dwb-grid">
                  <NumField label="Width" value={s0.style.width} min={0.5} max={40} step={0.5} onChange={(width) => shapeStyle({ width })} />
                </div>
                <DashRow value={s0.style.dash} onPick={(dash) => shapeStyle({ dash })} />
              </div>
            )}
          </div>

          {/* 文字 */}
          {t0 && (
            <>
              <span className="mmb-sep" />
              <div className="mmb-group rel">
                <button className={`mmb-btn mmb-open wide${open === "text" ? " on" : ""}`} onClick={() => toggle("text")} title="Text">
                  <span className="dwb-aa" style={{ color: textCss(t0.style.color) }}>
                    Aa
                  </span>
                  <span className="dwb-num">{t0.style.size}</span>
                  <span className="mmb-caret">▴</span>
                </button>
                {open === "text" && (
                  <div className="popover mmb-pop dwb-form wide">
                    <div className="popover-title">Text</div>
                    <select className="dwb-select" value={t0.style.font} onChange={(e) => setTextStyle({ font: e.target.value })} title="Font">
                      {FONTS.map((f) => (
                        <option key={f} value={f}>
                          {f || "App font"}
                        </option>
                      ))}
                    </select>
                    <div className="dwb-grid">
                      <NumField label="Size" value={t0.style.size} min={6} max={400} onChange={(size) => setTextStyle({ size })} />
                      <select className="dwb-select" value={t0.style.weight} onChange={(e) => setTextStyle({ weight: Number(e.target.value) })} title="Weight">
                        {WEIGHTS.map(([w, label]) => (
                          <option key={w} value={w}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <NumField label="Line" value={t0.style.lineHeight} min={0.5} max={4} step={0.1} onChange={(lineHeight) => setTextStyle({ lineHeight })} title="Line height" />
                      <NumField label="Spacing" value={t0.style.spacing} min={-20} max={50} step={0.5} onChange={(spacing) => setTextStyle({ spacing })} title="Letter spacing (px)" />
                    </div>
                    <div className="dwb-row">
                      {(["left", "center", "right"] as const).map((a) => (
                        <button key={a} className={`mmb-btn${t0.style.align === a ? " on" : ""}`} onClick={() => setTextStyle({ align: a })} title={`Align ${a}`}>
                          {a === "left" ? <AlignLeftIcon /> : a === "center" ? <AlignCenterIcon /> : <AlignRightIcon />}
                        </button>
                      ))}
                      <span className="mmb-sep" />
                      {(["top", "middle", "bottom"] as const).map((a) => (
                        <button key={a} className={`mmb-btn${t0.style.valign === a ? " on" : ""}`} onClick={() => setTextStyle({ valign: a })} title={`Align ${a}`}>
                          {a === "top" ? <AlignTopIcon /> : a === "middle" ? <AlignMiddleIcon /> : <AlignBottomIcon />}
                        </button>
                      ))}
                    </div>
                    <div className="popover-title">Color</div>
                    <Swatches mode="text" value={t0.style.color} onPick={(color) => setTextStyle({ color })} />
                    <HexField value={t0.style.color} onPick={(color) => setTextStyle({ color })} />
                  </div>
                )}
              </div>
              <button
                className={`mmb-btn bold${t0.style.weight >= 600 ? " on" : ""}`}
                title="Bold (Ctrl+B)"
                onClick={() => setTextStyle({ weight: t0.style.weight >= 600 ? 400 : 700 })}
              >
                B
              </button>
              <button className={`mmb-btn italic${t0.style.italic ? " on" : ""}`} title="Italic (Ctrl+I)" onClick={() => setTextStyle({ italic: !t0.style.italic })}>
                I
              </button>
            </>
          )}

          {/* 效果 */}
          <div className="mmb-group rel">
            <button className={`mmb-btn mmb-open${open === "effects" ? " on" : ""}`} onClick={() => toggle("effects")} title="Shadow and opacity">
              <ShadowThumb />
              <span className="mmb-caret">▴</span>
            </button>
            {open === "effects" && (
              <div className="popover mmb-pop dwb-form">
                <div className="popover-title">Shadow</div>
                <div className="dwb-row">
                  {SHADOWS.map((sh) => (
                    <button key={sh} className={`mmb-btn wide${s0.style.shadow === sh ? " on" : ""}`} onClick={() => shapeStyle({ shadow: sh })}>
                      {SHADOW_LABEL[sh]}
                    </button>
                  ))}
                </div>
                <div className="popover-title">Opacity</div>
                <div className="dwb-row">
                  <input
                    type="range"
                    className="dwb-range"
                    min={0}
                    max={100}
                    value={Math.round(s0.style.opacity * 100)}
                    onChange={(e) => shapeStyle({ opacity: Number(e.target.value) / 100 })}
                  />
                  <NumField label="" value={Math.round(s0.style.opacity * 100)} min={0} max={100} suffix="%" onChange={(v) => shapeStyle({ opacity: v / 100 })} />
                </div>
              </div>
            )}
          </div>

          {/* 圖片 */}
          {images.length > 0 && (
            <div className="mmb-group rel">
              <button className={`mmb-btn mmb-open${open === "image" ? " on" : ""}`} onClick={() => toggle("image")} title="Image">
                <ImageIcon />
                <span className="mmb-caret">▴</span>
              </button>
              {open === "image" && (
                <div className="popover mmb-pop dwb-form">
                  <div className="popover-title">Image</div>
                  <div className="dwb-row">
                    {(["cover", "contain"] as const).map((f) => (
                      <button
                        key={f}
                        className={`mmb-btn wide${images[0].style.fit === f ? " on" : ""}`}
                        onClick={() => onApply((d) => setShapeStyle(d, images.map((s) => s.id), { fit: f }))}
                        title={f === "cover" ? "Fill the box (crop)" : "Fit inside the box"}
                      >
                        {f === "cover" ? "Fill" : "Fit"}
                      </button>
                    ))}
                  </div>
                  {images.length === 1 && (
                    <button
                      className="mmb-btn wide"
                      onClick={() => {
                        setOpen(null);
                        props.onReplaceImage();
                      }}
                    >
                      <ImageIcon /> Replace image…
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
      {s0 && e0 && <span className="mmb-sep" />}
      {e0 && (
        <>
          <div className="mmb-group" title="Route">
            {(["orthogonal", "straight", "curved"] as Route[]).map((r) => (
              <button
                key={r}
                className={`mmb-btn${e0.style.route === r ? " on" : ""}`}
                onClick={() => edgeStyle({ route: r })}
                title={r === "orthogonal" ? "Elbow" : r === "straight" ? "Straight" : "Curved"}
              >
                <RouteThumb route={r} />
              </button>
            ))}
          </div>
          <span className="mmb-sep" />
          <ArrowPick
            open={open === "start"}
            onOpen={() => toggle("start")}
            flip
            value={e0.style.start}
            onPick={(start) => {
              edgeStyle({ start });
              setOpen(null);
            }}
          />
          <ArrowPick
            open={open === "end"}
            onOpen={() => toggle("end")}
            value={e0.style.end}
            onPick={(end) => {
              edgeStyle({ end });
              setOpen(null);
            }}
          />
          <span className="mmb-sep" />
          <ColorPick open={open === "ecolor"} onOpen={() => toggle("ecolor")} title="Line color" mode="line" noNone value={e0.style.stroke} onPick={(stroke) => edgeStyle({ stroke })} />
          <div className="mmb-group rel">
            <button className={`mmb-btn mmb-open${open === "estroke" ? " on" : ""}`} onClick={() => toggle("estroke")} title="Line style">
              <LineThumb width={e0.style.width} dash={e0.style.dash} />
              <span className="mmb-caret">▴</span>
            </button>
            {open === "estroke" && (
              <div className="popover mmb-pop dwb-form">
                <div className="popover-title">Line</div>
                <div className="dwb-grid">
                  <NumField label="Width" value={e0.style.width} min={0.5} max={12} step={0.5} onChange={(width) => edgeStyle({ width })} />
                </div>
                <DashRow value={e0.style.dash} onPick={(dash) => edgeStyle({ dash })} />
              </div>
            )}
          </div>
          <button className="mmb-btn" title="Reverse direction" onClick={() => onApply((d) => flipEdges(d, eIds))}>
            <SwapIcon />
          </button>
        </>
      )}
      <span className="mmb-sep" />
      <div className="mmb-group rel">
        <button className={`mmb-btn mmb-open${open === "arrange" ? " on" : ""}`} onClick={() => toggle("arrange")} title="Arrange">
          <FrontIcon />
          <span className="mmb-caret">▴</span>
        </button>
        {open === "arrange" && (
          <div className="popover mmb-pop dwb-arrange">
            <div className="popover-title">Order</div>
            <div className="dwb-row">
              <button className="mmb-btn wide" onClick={() => onApply((d) => reorder(d, all, true))} title="Ctrl+Shift+F">
                <FrontIcon /> To front
              </button>
              <button className="mmb-btn wide" onClick={() => onApply((d) => reorder(d, all, false))} title="Ctrl+Shift+B">
                <BackIcon /> To back
              </button>
            </div>
            {(shapes.filter((s) => s.kind !== "frame").length > 1 || shapes.some((s) => s.group)) && (
              <>
                <div className="popover-title">Group</div>
                <div className="dwb-row">
                  {shapes.filter((s) => s.kind !== "frame").length > 1 && (
                    <button className="mmb-btn wide" onClick={() => onApply((d) => groupItems(d, sIds).diagram)} title="Ctrl+G">
                      <SectionIcon /> Group
                    </button>
                  )}
                  {shapes.some((s) => s.group) && (
                    <button className="mmb-btn wide" onClick={() => onApply((d) => ungroupItems(d, sIds))} title="Ctrl+Shift+G">
                      Ungroup
                    </button>
                  )}
                </div>
              </>
            )}
            {shapes.length > 1 && (
              <>
                <div className="popover-title">Align</div>
                <div className="dwb-row">
                  {(
                    [
                      ["left", <AlignLeftIcon key="l" />],
                      ["center", <AlignCenterIcon key="c" />],
                      ["right", <AlignRightIcon key="r" />],
                      ["top", <AlignTopIcon key="t" />],
                      ["middle", <AlignMiddleIcon key="m" />],
                      ["bottom", <AlignBottomIcon key="b" />],
                    ] as [AlignHow, React.ReactNode][]
                  ).map(([a, icon]) => (
                    <button key={a} className="mmb-btn" onClick={() => onApply((d) => alignItems(d, sIds, a))} title={`Align ${a}`}>
                      {icon}
                    </button>
                  ))}
                </div>
              </>
            )}
            {shapes.length > 2 && (
              <>
                <div className="popover-title">Distribute</div>
                <div className="dwb-row">
                  <button className="mmb-btn wide" onClick={() => onApply((d) => distribute(d, sIds, "x"))}>
                    <DistributeHIcon /> Horizontally
                  </button>
                  <button className="mmb-btn wide" onClick={() => onApply((d) => distribute(d, sIds, "y"))}>
                    <DistributeVIcon /> Vertically
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <span
        className="mmb-help"
        title={[
          "F frame · R rectangle · O ellipse · T text (drag on the canvas)",
          "Enter / F2 / double-click: edit text",
          "Drag a blue dot: connect · click it: add a connected copy",
          "Shift+drag a corner: keep proportions · Alt+drag: don't snap",
          "Ctrl+G: group · Ctrl+Shift+G: ungroup",
          "Ctrl+Shift+H: hide · Ctrl+Shift+L: lock",
          "Ctrl+D: duplicate · Ctrl+C / V: copy, paste",
          "Arrows: nudge (Shift: 10px)",
        ].join("\n")}
      >
        ?
      </span>
    </div>
  );
}

/* ─── 輸入欄位 ─── */

/** 數字欄位：Enter 或離開時才套用；↑↓ 加減（Shift 十倍）。 */
function NumField(props: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  title?: string;
  disabled?: boolean;
}) {
  const fmt = (v: number) => String(Math.round(v * 100) / 100);
  const [v, setV] = useState(fmt(props.value));
  useEffect(() => setV(fmt(props.value)), [props.value]);
  const clamp = (n: number) => {
    if (props.min !== undefined) n = Math.max(props.min, n);
    if (props.max !== undefined) n = Math.min(props.max, n);
    return Math.round(n * 100) / 100;
  };
  const commit = () => {
    const n = Number(v);
    if (!v.trim() || !Number.isFinite(n)) return setV(fmt(props.value));
    const c = clamp(n);
    setV(fmt(c));
    if (c !== props.value) props.onChange(c);
  };
  return (
    <label className={`dwb-field${props.disabled ? " disabled" : ""}`} title={props.title}>
      {props.label && <span>{props.label}</span>}
      <input
        value={props.disabled ? "–" : v}
        disabled={props.disabled}
        inputMode="decimal"
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            setV(fmt(props.value));
            e.currentTarget.blur();
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const step = (props.step ?? 1) * (e.shiftKey ? 10 : 1);
            const c = clamp((Number(v) || 0) + (e.key === "ArrowUp" ? step : -step));
            setV(fmt(c));
            props.onChange(c);
          }
        }}
      />
      {props.suffix && <em>{props.suffix}</em>}
    </label>
  );
}

/** 自訂顏色（所有色盤共用的 `CustomColor`：最近用過、色彩方塊、色碼） */
function HexField(props: { value: Paint; onPick: (p: Paint) => void }) {
  return <CustomColor value={isHexPaint(props.value) ? props.value : null} onPick={props.onPick} />;
}

/* ─── 選色 ─── */

function Swatches(props: { mode: "fill" | "line" | "text"; value: Paint; noNone?: boolean; onPick: (p: Paint) => void }) {
  const list: Paint[] = [...(props.mode === "text" || props.noNone ? [] : (["none"] as Paint[])), "default", ...COLORS];
  return (
    <div className="mmb-colors dwb-colors">
      {list.map((p) => (
        <button
          key={p}
          className={`mmb-swatch${p === "none" ? " none" : ""}${props.value === p ? " on" : ""}`}
          style={p === "none" ? undefined : swatchStyle(props.mode, p)}
          title={paintLabel(p)}
          onClick={() => props.onPick(p)}
        />
      ))}
    </div>
  );
}

function swatchStyle(mode: "fill" | "line" | "text", p: Paint): React.CSSProperties {
  if (mode === "fill") return { background: fillCss(p), borderColor: p === "default" || isHexPaint(p) ? "var(--draw-line)" : `var(--tc-${p})` };
  if (mode === "text") return { background: textCss(p) };
  return { background: strokeCss(p) };
}

function ColorPick(props: { open: boolean; onOpen: () => void; title: string; mode: "fill" | "line"; value: Paint; noNone?: boolean; onPick: (p: Paint) => void }) {
  const v = props.value;
  return (
    <div className="mmb-group rel">
      <button className={`mmb-btn mmb-open${props.open ? " on" : ""}`} onClick={props.onOpen} title={props.title}>
        {props.mode === "fill" ? (
          <span className={`mmb-dot${v === "none" ? " none" : ""}`} style={v === "none" ? undefined : swatchStyle("fill", v)} />
        ) : (
          <span className={`dwb-ring${v === "none" ? " none" : ""}`} style={v === "none" ? undefined : { borderColor: strokeCss(v) }} />
        )}
        <span className="mmb-caret">▴</span>
      </button>
      {props.open && (
        <div className="popover mmb-pop dwb-form">
          <div className="popover-title">{props.title}</div>
          <Swatches mode={props.mode} value={v} noNone={props.noNone} onPick={props.onPick} />
          <HexField value={v} onPick={props.onPick} />
        </div>
      )}
    </div>
  );
}

function DashRow(props: { value: Dash; onPick: (d: Dash) => void }) {
  return (
    <div className="dwb-row">
      {(["solid", "dashed", "dotted"] as Dash[]).map((d) => (
        <button key={d} className={`mmb-btn${props.value === d ? " on" : ""}`} onClick={() => props.onPick(d)} title={d[0].toUpperCase() + d.slice(1)}>
          <LineThumb width={1.6} dash={d} />
        </button>
      ))}
    </div>
  );
}

const ARROW_LABEL: Record<Arrow, string> = { none: "None", arrow: "Arrow", open: "Open arrow", diamond: "Diamond", circle: "Circle" };

function ArrowPick(props: { open: boolean; onOpen: () => void; flip?: boolean; value: Arrow; onPick: (a: Arrow) => void }) {
  return (
    <div className="mmb-group rel">
      <button className={`mmb-btn mmb-open${props.open ? " on" : ""}`} onClick={props.onOpen} title={props.flip ? "Start" : "End"}>
        <ArrowThumb a={props.value} flip={props.flip} />
        <span className="mmb-caret">▴</span>
      </button>
      {props.open && (
        <div className="popover mmb-pop">
          <div className="popover-title">{props.flip ? "Start" : "End"}</div>
          <div className="dwb-row">
            {ARROWS.map((a) => (
              <button key={a} className={`mmb-btn${props.value === a ? " on" : ""}`} onClick={() => props.onPick(a)} title={ARROW_LABEL[a]}>
                <ArrowThumb a={a} flip={props.flip} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── 縮圖 ─── */

export function KindThumb({ kind }: { kind: ShapeKind }) {
  const { w, h } = SHAPE_INFO[kind];
  const k = Math.min(22 / w, 15 / h);
  const sw = w * k;
  const sh = h * k;
  if (kind === "text")
    return (
      <svg width="24" height="17" viewBox="0 0 24 17" aria-hidden>
        <text x="12" y="9" textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="700" fill="currentColor">
          T
        </text>
      </svg>
    );
  return (
    <svg width="24" height="17" viewBox={`${-(24 - sw) / 2} ${-(17 - sh) / 2} 24 17`} aria-hidden>
      <path
        d={shapePath(kind, sw, sh)}
        fill={kind === "note" ? "var(--bg-yellow)" : "none"}
        stroke={kind === "note" ? "var(--tc-yellow)" : "currentColor"}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LineThumb({ width, dash }: { width: number; dash: Dash }) {
  return (
    <svg width="24" height="14" viewBox="0 0 24 14" aria-hidden>
      <path
        d="M3 7h18"
        stroke="currentColor"
        strokeWidth={Math.min(width, 4)}
        strokeDasharray={dash === "dashed" ? "4 3" : dash === "dotted" ? "1 3" : undefined}
        strokeLinecap={dash === "dotted" ? "round" : "butt"}
      />
    </svg>
  );
}

function ArrowThumb({ a, flip }: { a: Arrow; flip?: boolean }) {
  const h = arrowHead(a, { x: flip ? 3 : 21, y: 7 }, { x: flip ? -1 : 1, y: 0 }, 1.1);
  return (
    <svg width="24" height="14" viewBox="0 0 24 14" aria-hidden>
      <path d="M3 7h18" stroke="currentColor" strokeWidth="1.3" />
      {h && <path d={h.d} stroke="currentColor" strokeWidth="1.2" fill={h.filled ? "currentColor" : "none"} strokeLinejoin="round" />}
    </svg>
  );
}

function RouteThumb({ route }: { route: Route }) {
  const d = route === "straight" ? "M3 13 21 3" : route === "curved" ? "M3 13C13 13 11 3 21 3" : "M3 13h9V3h9";
  return (
    <svg width="24" height="16" viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function ShadowThumb() {
  return (
    <svg width="22" height="16" viewBox="0 0 22 16" aria-hidden>
      <rect x="6" y="5" width="13" height="9" rx="2" fill="currentColor" opacity="0.25" />
      <rect x="3" y="2" width="13" height="9" rx="2" fill="var(--ed-popover)" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
