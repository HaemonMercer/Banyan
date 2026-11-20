/**
 * Dock 的分割視窗畫面（參考 VS Code 的編輯器群組；版面與操作是 `panes.ts` 的純函式）。
 *
 * 每個群組上方一排分頁：點了換文件、按兩下把預覽分頁固定、中鍵關掉、右鍵選單；
 * 拖分頁（指標事件）可以排順序、拖到別的群組的分頁列，或拖到群組內容的一邊分割出新群組
 * （放下的位置用 `paneTargetAt` 依指標下的 DOM 判斷，清單拖文件進來也用它）。
 * 分割中間的分隔線可以拖。文件內容由 Dock 的 `renderDoc` 畫（`DocPane`）。
 */
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon, ReopenIcon, SplitIcon } from "../editor/icons";
import {
  closeGroup,
  closeTab,
  closeTabs,
  findGroup,
  groupsOf,
  MAX_GROUPS,
  moveTab,
  openDoc,
  pinTab,
  resizeSplit,
  tabCount,
  type PaneGroup,
  type PaneNode,
  type Panes,
  type Side,
  type TabTarget,
} from "./panes";

export interface TabInfo {
  title: string;
  icon: React.ReactNode;
  /** 滑鼠停著時的說明（種類） */
  hint: string;
}

/** 拖曳中指標底下的放置位置；`mark` 是分頁列上的插入線位置（相對分頁列左邊） */
export type PaneDrop = TabTarget & { mark?: number };

/** 邊緣多寬（佔群組內容的比例）以內算「分割到那一邊」，再裡面就是放進群組 */
const EDGE = 0.28;

/** 指標底下的放置位置（DOM：`[data-tabs]` 分頁列、`[data-group-body]` 群組內容）；不在分割視窗上就是 null */
export function paneTargetAt(x: number, y: number, container: HTMLElement | null): PaneDrop | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!el || !container?.contains(el)) return null;
  const bar = el.closest<HTMLElement>("[data-tabs]");
  if (bar) {
    const group = bar.dataset.tabs!;
    const tabs = [...bar.querySelectorAll<HTMLElement>("[data-tab]")];
    const box = bar.getBoundingClientRect();
    let index = tabs.findIndex((t) => {
      const r = t.getBoundingClientRect();
      return x < r.left + r.width / 2;
    });
    if (index < 0) index = tabs.length;
    const ref = tabs[index] ?? tabs[tabs.length - 1];
    const r = ref?.getBoundingClientRect();
    const mark = r ? (tabs[index] ? r.left : r.right) - box.left + bar.scrollLeft : 0;
    return { group, index, mark };
  }
  const body = el.closest<HTMLElement>("[data-group-body]");
  if (!body) return null;
  const group = body.dataset.groupBody!;
  const r = body.getBoundingClientRect();
  const rx = (x - r.left) / r.width;
  const ry = (y - r.top) / r.height;
  const edges: [Side, number][] = [
    ["left", rx],
    ["right", 1 - rx],
    ["up", ry],
    ["down", 1 - ry],
  ];
  const [side, d] = edges.reduce((a, b) => (b[1] < a[1] ? b : a));
  return d < EDGE ? { group, side } : { group };
}

export function PaneLayout(props: {
  panes: Panes;
  /** 改版面（操作中的分頁換了由 Dock 告訴 App） */
  onUpdate: (fn: (p: Panes) => Panes) => void;
  info: (id: string) => TabInfo | null;
  renderDoc: (id: string) => React.ReactNode;
  /** 分割操作中的群組（Alt＋\）：Dock 決定新群組開哪份文件 */
  onSplit: (side: Side) => void;
  onReopen?: () => void;
  /** 清單正在把文件拖進來：放置位置 */
  outside: PaneDrop | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { panes, onUpdate } = props;
  /** 拖曳中的分頁與它的放置位置 */
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; drop: PaneDrop | null } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; group: string; tab?: string } | null>(null);
  const many = groupsOf(panes.root).length > 1;
  const canClose = tabCount(panes) > 1;
  const drop = drag?.drop ?? props.outside;

  const downTab = (e: React.PointerEvent, id: string) => {
    if (e.button === 1) e.preventDefault(); // 中鍵：不要開自動捲動
    if (e.button !== 0 || (e.target as HTMLElement).closest(".dg-close")) return;
    onUpdate((p) => openDoc(p, id));
    const x0 = e.clientX;
    const y0 = e.clientY;
    let started = false;
    let target: PaneDrop | null = null;
    const move = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      if (!started) document.body.classList.add("dock-tab-dragging");
      started = true;
      target = paneTargetAt(ev.clientX, ev.clientY, props.containerRef.current);
      // 放下去版面不會變（拖到自己唯一分頁的群組上）：不標位置
      if (target && target.index === undefined && moveTab(panes, id, target) === panes) target = null;
      setDrag({ id, x: ev.clientX, y: ev.clientY, drop: target });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("dock-tab-dragging");
      setDrag(null);
      const t = target;
      if (started && t) onUpdate((p) => moveTab(p, id, t));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startResize = (node: Extract<PaneNode, { type: "split" }>, i: number) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const box = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
    if (!box) return;
    const row = node.dir === "row";
    const before = node.sizes.slice(0, i).reduce((a, b) => a + b, 0);
    const move = (ev: PointerEvent) => {
      const at = row ? (ev.clientX - box.left) / box.width : (ev.clientY - box.top) / box.height;
      onUpdate((p) => resizeSplit(p, node.id, i, at - before));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("dock-resizing", "split-row", "split-col");
    };
    document.body.classList.add("dock-resizing", `split-${node.dir}`);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const renderNode = (node: PaneNode): React.ReactNode => {
    if (node.type === "group") return renderGroup(node);
    return (
      <div key={node.id} className={`dock-split split-${node.dir}`}>
        {node.children.map((c, i) => (
          <Fragment key={c.id}>
            {i > 0 && <div className={`dock-divider ${node.dir}`} title="Drag to resize" onPointerDown={startResize(node, i - 1)} />}
            <div className="dock-cell" style={{ flex: `${node.sizes[i]} 1 0` }}>
              {renderNode(c)}
            </div>
          </Fragment>
        ))}
      </div>
    );
  };

  // 作用中分頁捲進看得到的地方
  const rootRef = props.containerRef;
  const activeKey = groupsOf(panes.root)
    .map((g) => `${g.id}:${g.active}`)
    .join("|");
  useEffect(() => {
    rootRef.current?.querySelectorAll<HTMLElement>(".dg-tab.active").forEach((t) => t.scrollIntoView({ block: "nearest", inline: "nearest" }));
  }, [activeKey, rootRef]);

  // 不要寫成元件：每次 render 都是新的元件型別，裡面的編輯器會整個重建
  const renderGroup = (g: PaneGroup) => {
    const focused = g.id === panes.focus;
    const here = drop && drop.group === g.id ? drop : null;
    return (
      <div
        key={g.id}
        className={`dock-group${focused ? " focused" : ""}${many ? " many" : ""}`}
        onPointerDownCapture={() => onUpdate((p) => (p.focus === g.id ? p : { ...p, focus: g.id }))}
        onFocusCapture={() => onUpdate((p) => (p.focus === g.id ? p : { ...p, focus: g.id }))}
      >
        <div className="dg-bar editor-ui">
          <div
            className="dg-tabs"
            role="tablist"
            data-tabs={g.id}
            onWheel={(e) => {
              // 直的滾輪也能橫著捲分頁
              if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
            }}
            onContextMenu={(e) => {
              if ((e.target as HTMLElement).closest("[data-tab]")) return;
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, group: g.id });
            }}
          >
            {g.tabs.map((id) => {
              const t = props.info(id);
              if (!t) return null;
              const active = id === g.active;
              return (
                <div
                  key={id}
                  data-tab={id}
                  role="tab"
                  aria-selected={active}
                  className={`dg-tab${active ? " active" : ""}${g.preview === id ? " preview" : ""}${drag?.id === id ? " moving" : ""}`}
                  title={`${t.title} · ${t.hint}${g.preview === id ? " · preview — double-click to keep open" : ""}`}
                  onPointerDown={(e) => downTab(e, id)}
                  onAuxClick={(e) => {
                    if (e.button !== 1) return;
                    e.preventDefault();
                    onUpdate((p) => closeTab(p, id));
                  }}
                  onDoubleClick={() => onUpdate((p) => pinTab(p, id))}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, group: g.id, tab: id });
                  }}
                >
                  <span className="dg-icon">{t.icon}</span>
                  <span className="dg-title">{t.title || "Untitled"}</span>
                  {canClose && (
                    <button className="dg-close" title="Close (Alt+W)" aria-label="Close" onPointerDown={(e) => e.stopPropagation()} onClick={() => onUpdate((p) => closeTab(p, id))}>
                      <CloseIcon />
                    </button>
                  )}
                </div>
              );
            })}
            {here && here.index !== undefined && <span className="dg-insert" style={{ left: here.mark }} />}
          </div>
          <div className="dg-actions">
            <button
              className="icon-btn"
              title="Split right (Alt+\) · Alt+click to split down"
              disabled={groupsOf(panes.root).length >= MAX_GROUPS}
              onClick={(e) => {
                onUpdate((p) => (p.focus === g.id ? p : { ...p, focus: g.id }));
                props.onSplit(e.altKey ? "down" : "right");
              }}
            >
              <SplitIcon />
            </button>
          </div>
        </div>
        <div className="dg-body" data-group-body={g.id}>
          {g.active ? props.renderDoc(g.active) : null}
          {here && here.index === undefined && <div className={`dg-drop ${here.side ?? "center"}`} />}
        </div>
      </div>
    );
  };

  const menuGroup = menu ? findGroup(panes, menu.group) : undefined;
  return (
    <>
      {renderNode(panes.root)}
      {drag
        ? createPortal(
            <div className="dg-ghost" style={{ left: drag.x + 12, top: drag.y + 10 }}>
              {props.info(drag.id)?.icon} {props.info(drag.id)?.title}
            </div>,
            document.body,
          )
        : null}
      {menu && menuGroup && (
        <PopMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {(item, sep) => {
            const g = menuGroup;
            const id = menu.tab;
            if (id) {
              const i = g.tabs.indexOf(id);
              const others = g.tabs.filter((t) => t !== id);
              return (
                <>
                  {item("Close", () => onUpdate((p) => closeTab(p, id)), { hint: "Alt+W", disabled: !canClose })}
                  {item("Close Others", () => onUpdate((p) => closeTabs(p, others)), { disabled: !others.length })}
                  {item("Close to the Right", () => onUpdate((p) => closeTabs(p, g.tabs.slice(i + 1))), { disabled: i === g.tabs.length - 1 })}
                  {many && item("Close Group", () => onUpdate((p) => closeGroup(p, g.id)))}
                  {sep()}
                  {g.preview === id && item("Keep Open", () => onUpdate((p) => pinTab(p, id)), { hint: "Double-click" })}
                  {item("Split Right", () => onUpdate((p) => moveTab(p, id, { group: g.id, side: "right" })), { disabled: g.tabs.length < 2 || groupsOf(panes.root).length >= MAX_GROUPS })}
                  {item("Split Down", () => onUpdate((p) => moveTab(p, id, { group: g.id, side: "down" })), { disabled: g.tabs.length < 2 || groupsOf(panes.root).length >= MAX_GROUPS })}
                  {many &&
                    groupsOf(panes.root)
                      .filter((x) => x.id !== g.id)
                      .map((x) =>
                        item(`Move to Group ${groupsOf(panes.root).indexOf(x) + 1}`, () => onUpdate((p) => moveTab(p, id, { group: x.id })), { key: x.id }),
                      )}
                </>
              );
            }
            return (
              <>
                {item("Split Right", () => props.onSplit("right"), { hint: "Alt+\\" })}
                {item("Split Down", () => props.onSplit("down"), { hint: "Alt+Shift+\\" })}
                {many && sep()}
                {many && item("Close Group", () => onUpdate((p) => closeGroup(p, g.id)))}
                {props.onReopen && sep()}
                {props.onReopen && item("Reopen Closed Tab", props.onReopen, { hint: "Alt+Shift+T", icon: <ReopenIcon /> })}
              </>
            );
          }}
        </PopMenu>
      )}
    </>
  );
}

/** 分頁的右鍵選單（放到 body，樣式跟清單的選單一樣） */
function PopMenu(props: {
  x: number;
  y: number;
  onClose: () => void;
  children: (
    item: (label: string, fn: () => void, opts?: { hint?: string; disabled?: boolean; key?: string; icon?: React.ReactNode }) => React.ReactNode,
    sep: () => React.ReactNode,
  ) => React.ReactNode;
}) {
  const { onClose } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: props.x, top: props.y });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ left: Math.max(8, Math.min(props.x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(props.y, window.innerHeight - r.height - 8)) });
  }, [props.x, props.y]);
  useEffect(() => {
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);
  useEffect(() => ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(), []);
  let n = 0;
  const item = (label: string, fn: () => void, opts: { hint?: string; disabled?: boolean; key?: string; icon?: React.ReactNode } = {}) => (
    <button
      key={opts.key ?? label}
      role="menuitem"
      disabled={opts.disabled}
      onClick={() => {
        onClose();
        fn();
      }}
    >
      <span className="glyph">{opts.icon}</span>
      <span className="label">{label}</span>
      {opts.hint && <span className="hint">{opts.hint}</span>}
    </button>
  );
  const sep = () => <div key={`sep${n++}`} className="popover-sep" />;
  return createPortal(
    <div
      className="popover block-menu dl-menu editor-ui"
      ref={ref}
      style={pos}
      role="menu"
      onMouseDown={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        e.stopPropagation();
        const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const k = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(k + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }}
    >
      {props.children(item, sep)}
    </div>,
    document.body,
  );
}
