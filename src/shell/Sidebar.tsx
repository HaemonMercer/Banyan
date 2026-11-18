import type { ReactNode } from "react";
import {
  DatabaseIcon,
  CalendarIcon,
  ClockIcon,
  DocIcon,
  JournalIcon,
  KeyboardIcon,
  MonitorIcon,
  MoonIcon,
  PagesIcon,
  SidebarIcon,
  StarIcon,
  SunIcon,
  TodayIcon,
} from "../editor/icons";
import { dayTitle, relativeLabel } from "../journal/journal";
import { sameTarget, targetKey, type NavTarget, type ThemePref } from "./nav";

export type MainView = "journals" | "bujo" | "pages" | "databases" | "doc";

const MAIN: { kind: MainView; label: string; icon: ReactNode; keys: string }[] = [
  { kind: "journals", label: "Journals", icon: <JournalIcon />, keys: "Alt+1" },
  { kind: "bujo", label: "Calendar", icon: <CalendarIcon />, keys: "Alt+2" },
  { kind: "pages", label: "All pages", icon: <PagesIcon />, keys: "Alt+3" },
  { kind: "databases", label: "Databases", icon: <DatabaseIcon />, keys: "Alt+5" },
  { kind: "doc", label: "Document", icon: <DocIcon />, keys: "Alt+4" },
];

const THEMES: { pref: ThemePref; label: string; icon: ReactNode }[] = [
  { pref: "system", label: "System", icon: <MonitorIcon /> },
  { pref: "light", label: "Light", icon: <SunIcon /> },
  { pref: "dark", label: "Dark", icon: <MoonIcon /> },
];

/** 側邊欄項目的文字：日記顯示「11 月 17 日」與「今天」之類的提示。 */
function targetLabel(t: NavTarget, now: string): { text: string; hint: string } {
  if (t.kind !== "day") return { text: t.name, hint: "" };
  return { text: dayTitle(t.date, now), hint: relativeLabel(t.date, now) };
}

function TargetRow(props: { target: NavTarget; now: string; active: boolean; onOpen: () => void }) {
  const { text, hint } = targetLabel(props.target, props.now);
  return (
    <button className={`sb-item${props.active ? " on" : ""}`} onClick={props.onOpen} title={text}>
      <span className="sb-icon">{props.target.kind === "day" ? (
          <CalendarIcon />
        ) : props.target.kind === "database" ? (
          <DatabaseIcon />
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
  theme: ThemePref;
  onTheme: (t: ThemePref) => void;
  onMain: (v: MainView) => void;
  onToday: () => void;
  onOpen: (t: NavTarget) => void;
  onClose: () => void;
  onHelp: () => void;
}) {
  const { current, now } = props;
  const active = (t: NavTarget) => !!current && sameTarget(t, current);
  // 「最近」不重複列出已經收藏的
  const recents = props.recents.filter((r) => !props.favorites.some((f) => sameTarget(f, r)));

  return (
    <aside className={`sidebar${props.open ? "" : " closed"}`} aria-hidden={!props.open}>
      <div className="sb-inner">
        <div className="sb-head">
          <span className="sb-brand">
            <span className="sb-logo" aria-hidden>
              B
            </span>
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
              <kbd className="sb-kbd">{m.keys.replace("+", " ")}</kbd>
            </button>
          ))}
        </nav>

        <div className="sb-scroll">
          <section className="sb-section">
            <h2 className="sb-title">
              <StarIcon /> Favorites
            </h2>
            {props.favorites.length ? (
              props.favorites.map((t) => (
                <TargetRow key={targetKey(t)} target={t} now={now} active={active(t)} onOpen={() => props.onOpen(t)} />
              ))
            ) : (
              <p className="sb-empty">
                Click <StarIcon className="inline-icon" /> on a journal, page or database (or press Alt+S) to add it here
              </p>
            )}
          </section>

          {recents.length > 0 && (
            <section className="sb-section">
              <h2 className="sb-title">
                <ClockIcon /> Recent
              </h2>
              {recents.map((t) => (
                <TargetRow key={targetKey(t)} target={t} now={now} active={active(t)} onOpen={() => props.onOpen(t)} />
              ))}
            </section>
          )}
        </div>

        <div className="sb-foot">
          <div className="theme-switch" role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => (
              <button
                key={t.pref}
                role="radio"
                aria-checked={props.theme === t.pref}
                className={props.theme === t.pref ? "on" : ""}
                onClick={() => props.onTheme(t.pref)}
                title={t.label}
              >
                {t.icon}
              </button>
            ))}
          </div>
          <button className="icon-btn" onClick={props.onHelp} title="Keyboard shortcuts (Ctrl+/)">
            <KeyboardIcon />
          </button>
        </div>
      </div>
    </aside>
  );
}
