import type { ReactNode } from "react";
import {
  DeskIcon,
  CalendarIcon,
  ClockIcon,
  DocIcon,
  DrawIcon,
  DrawerIcon,
  NoteIcon,
  SheetIcon,
  SlidesIcon,
  KeyboardIcon,
  SettingsIcon,
  SidebarIcon,
  BanyanMark,
  StarIcon,
  TodayIcon,
  TrashIcon,
} from "../editor/icons";
import { dayTitle, relativeLabel } from "../journal/journal";
import { sameTarget, targetKey, type NavTarget } from "./nav";

export type MainView = "bujo" | "desk" | "drawer";

const MAIN: { kind: MainView; label: string; icon: ReactNode; keys: string }[] = [
  { kind: "bujo", label: "Calendar", icon: <CalendarIcon />, keys: "Alt+Shift+1" },
  { kind: "desk", label: "Desk", icon: <DeskIcon />, keys: "Alt+Shift+2" },
  { kind: "drawer", label: "Drawer", icon: <DrawerIcon />, keys: "Alt+Shift+3" },
];

/** Dock 文件的標題與種類（App 從 Desk 檔案查；查不到是 null：文件已經刪掉） */
export type DocInfo = (file: string, id: string) => { title: string; kind: string } | null;

/** 側邊欄項目的文字：日記顯示「11 月 17 日」與「今天」之類的提示；Dock 文件提示所在的檔案。 */
function targetLabel(t: NavTarget, now: string, docInfo?: DocInfo): { text: string; hint: string } {
  if (t.kind === "doc") return { text: docInfo?.(t.file, t.id)?.title ?? "Untitled", hint: t.file };
  if (t.kind !== "day") return { text: t.name, hint: "" };
  return { text: dayTitle(t.date, now), hint: relativeLabel(t.date, now) };
}

function docIcon(kind: string | undefined) {
  return kind === "sheet" ? <SheetIcon /> : kind === "slides" ? <SlidesIcon /> : kind === "draw" ? <DrawIcon /> : kind === "note" ? <NoteIcon /> : <DocIcon />;
}

function TargetRow(props: {
  target: NavTarget;
  now: string;
  active: boolean;
  onOpen: () => void;
  onDelete?: (t: NavTarget) => void;
  docInfo?: DocInfo;
}) {
  const { text, hint } = targetLabel(props.target, props.now, props.docInfo);
  const t = props.target;
  const del = props.onDelete;
  // 頁面在列尾有刪除鈕（滑過才出現）；按鈕不能套按鈕，所以包一層
  if (del && props.target.kind === "page") {
    return (
      <div className="sb-row">
        <TargetRow {...props} onDelete={undefined} />
        <button className="sb-del" onClick={() => del(props.target)} title="Delete this page" aria-label={`Delete ${text}`}>
          <TrashIcon />
        </button>
      </div>
    );
  }
  return (
    <button className={`sb-item${props.active ? " on" : ""}`} onClick={props.onOpen} title={t.kind === "doc" ? `${text} — ${t.file}` : text}>
      <span className="sb-icon">{t.kind === "day" ? (
          <CalendarIcon />
        ) : t.kind === "file" ? (
          <DeskIcon />
        ) : t.kind === "doc" ? (
          docIcon(props.docInfo?.(t.file, t.id)?.kind)
        ) : (
          <DocIcon />
        )}</span>
      <span className="sb-label">{text}</span>
      {hint && <span className="sb-hint">{hint}</span>}
    </button>
  );
}

export function Sidebar(props: {
  open: boolean;
  main: MainView | null;
  current: NavTarget | null;
  isToday: boolean;
  now: string;
  favorites: NavTarget[];
  recents: NavTarget[];
  settings: boolean;
  onSettings: () => void;
  onMain: (v: MainView) => void;
  onToday: () => void;
  onOpen: (t: NavTarget) => void;
  /** 刪除收藏／最近裡的頁面（App 負責確認） */
  onDelete?: (t: NavTarget) => void;
  /** Dock 文件的標題與種類；回傳 null 的（刪掉的文件）不列出 */
  docInfo?: DocInfo;
  onClose: () => void;
  onHelp: () => void;
}) {
  const { current, now } = props;
  const active = (t: NavTarget) => !!current && sameTarget(t, current);
  // 刪掉的 Dock 文件不列出
  const shown = (t: NavTarget) => t.kind !== "doc" || !props.docInfo || props.docInfo(t.file, t.id) !== null;
  const favorites = props.favorites.filter(shown);
  // 「最近」不重複列出已經收藏的
  const recents = props.recents.filter((r) => shown(r) && !props.favorites.some((f) => sameTarget(f, r)));

  return (
    <aside className={`sidebar${props.open ? "" : " closed"}`} aria-hidden={!props.open}>
      <div className="sb-inner">
        <div className="sb-head">
          <span className="sb-brand">
            <BanyanMark className="sb-logo" />
            Banyan
          </span>
          <button className="icon-btn" onClick={props.onClose} title="Hide sidebar (Ctrl+\)">
            <SidebarIcon />
          </button>
        </div>

        <nav className="sb-section">
          <button className={`sb-item${props.isToday ? " on" : ""}`} onClick={props.onToday} title="Alt+T">
            <span className="sb-icon">
              <TodayIcon />
            </span>
            <span className="sb-label">Today</span>
            <kbd className="sb-kbd">Alt T</kbd>
          </button>
          {MAIN.map((m) => (
            <button
              key={m.kind}
              className={`sb-item${props.main === m.kind ? " on" : ""}`}
              onClick={() => props.onMain(m.kind)}
              title={m.keys}
            >
              <span className="sb-icon">{m.icon}</span>
              <span className="sb-label">{m.label}</span>
              <kbd className="sb-kbd">{m.keys.split("+").join(" ")}</kbd>
            </button>
          ))}
        </nav>

        <div className="sb-scroll">
          <section className="sb-section">
            <h2 className="sb-title">
              <StarIcon /> Favorites
            </h2>
            {favorites.length ? (
              favorites.map((t) => (
                <TargetRow key={targetKey(t)} target={t} now={now} active={active(t)} onOpen={() => props.onOpen(t)} onDelete={props.onDelete} docInfo={props.docInfo} />
              ))
            ) : (
              <p className="sb-empty">
                Click <StarIcon className="inline-icon" /> on a journal, page, Desk file or document (or press Alt+S) to add it here
              </p>
            )}
          </section>

          {recents.length > 0 && (
            <section className="sb-section">
              <h2 className="sb-title">
                <ClockIcon /> Recent
              </h2>
              {recents.map((t) => (
                <TargetRow key={targetKey(t)} target={t} now={now} active={active(t)} onOpen={() => props.onOpen(t)} onDelete={props.onDelete} docInfo={props.docInfo} />
              ))}
            </section>
          )}
        </div>

        <div className="sb-foot">
          <button className={`sb-item sb-settings${props.settings ? " on" : ""}`} onClick={props.onSettings} title="Alt+,">
            <span className="sb-icon">
              <SettingsIcon />
            </span>
            <span className="sb-label">Settings</span>
          </button>
          <button className="icon-btn" onClick={props.onHelp} title="Keyboard shortcuts (Ctrl+/)">
            <KeyboardIcon />
          </button>
        </div>
      </div>
    </aside>
  );
}
