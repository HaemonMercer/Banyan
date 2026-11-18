import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { countWords } from "./editor/words";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarIcon,
  DeskIcon,
  DocIcon,
  SidebarIcon,
  StarIcon,
  TrashIcon,
} from "./editor/icons";
import { CalendarButton, JournalDay } from "./journal/Journals";
import { addDays, dayTitle, defaultStore, isDateKey, today, weekday } from "./journal/journal";
import {
  applyTheme,
  FAVORITES_KEY,
  forgetTarget,
  isFavorite,
  loadJson,
  loadTargets,
  loadTheme,
  pushRecent,
  RECENTS_KEY,
  saveJson,
  SIDEBAR_KEY,
  THEME_KEY,
  toggleFavorite,
  type NavTarget,
  type ThemePref,
} from "./shell/nav";
import { matchShortcut, type ShortcutAction } from "./shell/shortcuts";
import { Sidebar, type MainView } from "./shell/Sidebar";
import { ShortcutHelp } from "./shell/ShortcutHelp";
import { useDocs } from "./journal/useJournals";
import { CalendarView } from "./bujo/CalendarView";
import { APPEND_EVENT, appendItems, type AppendRequest } from "./bujo/tasks";
import { allPages, type Source } from "./pages/refIndex";
import { Backlinks } from "./pages/Backlinks";
import { OPEN_PAGE_EVENT, setPageNames } from "./pages/pageRef";
import { defaultPageStore, resolveTarget } from "./pages/pages";
import { PageView } from "./pages/PagesView";
import { defaultDatabaseStore } from "./database/store";
import { pageKey } from "./pages/pageRef";
import { DeskView, FileView, type DeskTab } from "./desk/DeskView";
import { defaultDeskStore, forgetFile } from "./desk/store";
import { emptyFile, importDatabases, parseFile, serializeFile, type DeskFile } from "./desk/file";
import "./App.css";
import "./shell/shell.css";

type View =
  | { kind: "day"; date: string }
  | { kind: "bujo" }
  | { kind: "page"; name: string }
  | { kind: "desk" }
  | { kind: "file"; name: string; tab: DeskTab };

const VIEW_KEY = "banyan.view";
/** 舊的獨立資料庫已經搬進 Desk */
const DB_MIGRATED_KEY = "banyan.databasesMigrated";

function loadView(): View {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null");
    if (v?.kind === "bujo" || v?.kind === "desk") return { kind: v.kind };
    // 舊的資料庫畫面已經併進 Desk
    if (v?.kind === "databases" || v?.kind === "database") return { kind: "desk" };
    if (v?.kind === "day" && typeof v.date === "string" && isDateKey(v.date)) return v;
    if (v?.kind === "page" && typeof v.name === "string" && v.name.trim()) return v;
    if (v?.kind === "file" && typeof v.name === "string" && v.name.trim()) {
      return { kind: "file", name: v.name, tab: v.tab === "dock" ? "dock" : "board" };
    }
  } catch {
    /* 沒存過或格式不對就從今天的日記開始 */
  }
  return { kind: "day", date: today() };
}

/** 今天的日期鍵；跨過午夜時自動換成新的一天。 */
function useToday(): string {
  const [now, setNow] = useState(today);
  useEffect(() => {
    const tick = () => setNow(today());
    const t = setInterval(tick, 60_000);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", tick);
    };
  }, []);
  return now;
}

/** 側邊欄「主要畫面」：Desk 的檔案算在「Desk」；日記與頁面不屬於任何主要畫面 */
function mainOf(view: View): MainView | null {
  return view.kind === "file" ? "desk" : view.kind === "day" || view.kind === "page" ? null : view.kind;
}

function targetOf(view: View): NavTarget | null {
  return view.kind === "day"
    ? { kind: "day", date: view.date }
    : view.kind === "page" || view.kind === "file"
      ? { kind: view.kind, name: view.name }
      : null;
}

const sameView = (a: View, b: View) => JSON.stringify(a) === JSON.stringify(b);

const NARROW = 760;
const isNarrow = () => window.innerWidth < NARROW;

/** 畫面切換，加上上一頁／下一頁。 */
function useHistoryNav() {
  const [nav, setNav] = useState<{ view: View; back: View[]; forward: View[] }>(() => ({
    view: loadView(),
    back: [],
    forward: [],
  }));
  const go = useCallback(
    (v: View) =>
      setNav((n) => (sameView(n.view, v) ? n : { view: v, back: [...n.back, n.view].slice(-50), forward: [] })),
    [],
  );
  const back = useCallback(
    () =>
      setNav((n) =>
        n.back.length
          ? { view: n.back[n.back.length - 1], back: n.back.slice(0, -1), forward: [n.view, ...n.forward] }
          : n,
      ),
    [],
  );
  const forward = useCallback(
    () =>
      setNav((n) =>
        n.forward.length ? { view: n.forward[0], back: [...n.back, n.view], forward: n.forward.slice(1) } : n,
      ),
    [],
  );
  return { view: nav.view, canBack: nav.back.length > 0, canForward: nav.forward.length > 0, go, back, forward };
}

function App() {
  const { view, go, back, forward, canBack, canForward } = useHistoryNav();
  const [scrolled, setScrolled] = useState(false);
  const [sidebar, setSidebar] = useState(
    () => !isNarrow() && loadJson(SIDEBAR_KEY, true, (v) => typeof v === "boolean"),
  );
  const [favorites, setFavorites] = useState(() => loadTargets(FAVORITES_KEY));
  const [recents, setRecents] = useState(() => loadTargets(RECENTS_KEY));
  const [theme, setTheme] = useState<ThemePref>(loadTheme);
  const [help, setHelp] = useState(false);
  const journalStore = useMemo(defaultStore, []);
  const pageStore = useMemo(defaultPageStore, []);
  const journals = useDocs(journalStore);
  const pages = useDocs(pageStore);
  // 舊的獨立資料庫（databases/*.json）：只在第一次啟動時讀來搬進 Desk
  const databaseStore = useMemo(defaultDatabaseStore, []);
  const databases = useDocs(databaseStore);
  const deskStore = useMemo(defaultDeskStore, []);
  const files = useDocs(deskStore);
  const now = useToday();
  const pageRef = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(view));
    } catch {
      /* 記不住上次的畫面也沒關係 */
    }
    pageRef.current?.scrollTo({ top: 0 });
    const t = targetOf(view);
    if (t) setRecents((r) => pushRecent(r, t));
  }, [view]);

  useEffect(() => saveJson(RECENTS_KEY, recents), [recents]);
  useEffect(() => saveJson(FAVORITES_KEY, favorites), [favorites]);
  useEffect(() => {
    saveJson(THEME_KEY, theme);
    applyTheme(theme);
  }, [theme]);
  // 窄視窗的側邊欄是蓋在內容上的抽屜，不記住開關
  useEffect(() => {
    if (!isNarrow()) saveJson(SIDEBAR_KEY, sidebar);
  }, [sidebar]);

  /** 切換畫面；窄視窗時順便收起側邊欄抽屜。 */
  const navigate = useCallback(
    (v: View) => {
      go(v);
      if (isNarrow()) setSidebar(false);
    },
    [go],
  );

  // 所有可以互相連結的文件（反向連結、頁面清單用）
  const sources = useMemo<Source[]>(
    () => [
      ...Object.entries(journals.contents).map(([key, content]) => ({ kind: "day" as const, key, content })),
      ...Object.entries(pages.contents).map(([key, content]) => ({ kind: "page" as const, key, content })),
    ],
    [journals.contents, pages.contents],
  );
  const ready = journals.ready && pages.ready;

  // 自動完成用的頁面名稱：有內容的頁面＋被提到的頁面
  const pageNameList = useMemo(
    () => allPages(pages.dates ?? [], sources, isDateKey).map((p) => p.name),
    [pages.dates, sources],
  );
  useEffect(() => setPageNames(pageNameList), [pageNameList]);

  // Desk 的檔案（名稱不分大小寫）
  const openFile = (name: string, tab: DeskTab = "board") => navigate({ kind: "file", name, tab });
  const createFile = (raw: string) => {
    const name = raw.trim();
    if (!name) return;
    const had = [...(files.dates ?? [])].find((n) => pageKey(n) === pageKey(name));
    if (!had) files.update(name, serializeFile(emptyFile()));
    openFile(had ?? name);
  };
  const modifyFile = files.modify;
  const changeFile = useCallback(
    (name: string, fn: (f: DeskFile) => DeskFile) => modifyFile(name, (j) => serializeFile(fn(parseFile(j)))),
    [modifyFile],
  );
  const fileName = view.kind === "file" ? view.name : null;
  const onModifyFile = useCallback((fn: (f: DeskFile) => DeskFile) => fileName && changeFile(fileName, fn), [fileName, changeFile]);
  const { load: loadFile } = files;
  useEffect(() => {
    if (fileName && files.dates?.has(fileName)) loadFile(fileName);
  }, [fileName, files.dates, loadFile]);

  // 資料庫併進 Desk：舊的 databases/*.json 第一次啟動時搬進檔案「Databases」的 Dock（原檔留著，不再讀）
  useEffect(() => {
    if (!databases.ready || !files.ready || !databases.dates?.size) return;
    if (loadJson(DB_MIGRATED_KEY, false, (v) => typeof v === "boolean")) return;
    saveJson(DB_MIGRATED_KEY, true);
    const target = [...(files.dates ?? [])].find((n) => pageKey(n) === pageKey("Databases")) ?? "Databases";
    const entries = [...databases.dates].sort().map((n) => [n, databases.contents[n] ?? ""] as [string, string]);
    changeFile(target, (f) => importDatabases(f, entries));
  }, [databases.ready, databases.dates, databases.contents, files.ready, files.dates, changeFile]);

  // 資料庫的列標題連到同名頁面（不分大小寫）
  const pageByKey = useMemo(() => new Map([...(pages.dates ?? [])].map((n) => [pageKey(n), n])), [pages.dates]);
  const hasPage = useCallback((t: string) => pageByKey.has(pageKey(t)), [pageByKey]);
  const openPageNamed = (t: string) => navigate({ kind: "page", name: pageByKey.get(pageKey(t)) ?? t });

  /**
   * 刪除頁面、一天的日記或 Desk 的檔案：內容寫成空的（Rust 端會刪掉檔案），並從收藏、最近拿掉。
   * 連到它的 [[連結]] 保留（再點一次就是新的空白頁）。
   */
  const deleteDoc = (t: NavTarget) => {
    if (t.kind === "file") {
      files.update(t.name, "");
      forgetFile(t.name);
    }
    else if (t.kind === "page") pages.update(t.name, "");
    else journals.update(t.date, "");
    setFavorites((f) => forgetTarget(f, t));
    setRecents((r) => forgetTarget(r, t));
  };
  const confirmDelete = (t: NavTarget): boolean => {
    if (t.kind === "file") {
      return window.confirm(`Delete “${t.name}” with its whiteboard and every Dock document? Pages and journals on the whiteboard are kept. This can't be undone.`);
    }
    const what = t.kind === "day" ? `the journal for ${dayTitle(t.date, now)}` : `the page “${t.name}”`;
    return window.confirm(`Delete ${what}? Links to it are kept. This can't be undone.`);
  };

  // 點頁面連結、反向連結：開啟日記的某一天或某個頁面
  const pageNames = useRef<Set<string> | null>(null);
  pageNames.current = pages.dates;
  useEffect(() => {
    const open = (e: Event) => {
      const t = resolveTarget(String((e as CustomEvent).detail ?? ""), pageNames.current ?? []);
      if (!t) return;
      navigate(t.kind === "day" ? { kind: "day", date: t.date } : { kind: "page", name: t.name });
    };
    window.addEventListener(OPEN_PAGE_EVENT, open);
    return () => window.removeEventListener(OPEN_PAGE_EVENT, open);
  }, [navigate]);

  // 排程：把任務加到那天日記的最後面
  const { modify } = journals;
  useEffect(() => {
    const append = (e: Event) => {
      const { date, item } = (e as CustomEvent<AppendRequest>).detail;
      if (isDateKey(date)) modify(date, (src) => appendItems(src, [item]));
    };
    window.addEventListener(APPEND_EVENT, append);
    return () => window.removeEventListener(APPEND_EVENT, append);
  }, [modify]);

  const openDay = (date: string) => navigate({ kind: "day", date });
  const openTarget = (t: NavTarget) =>
    navigate(
      t.kind === "day"
        ? { kind: "day", date: t.date }
        : t.kind === "file"
          ? { kind: "file", name: t.name, tab: "board" }
          : { kind: t.kind, name: t.name },
    );

  // 目前畫面的 Markdown（字數用）；日記串、清單類的畫面不顯示字數
  const day = view.kind === "day" ? view.date : null;
  const pageName = view.kind === "page" ? view.name : null;
  const current =
    day !== null
      ? (journals.contents[day] ?? "")
      : pageName !== null
        ? (pages.contents[pageName] ?? "")
        : null;
  const target = targetOf(view);
  const starred = !!target && isFavorite(favorites, target);
  // 有內容（存成檔案）的頁面、日記才能刪
  const deletable =
    (day !== null && !!journals.dates?.has(day)) ||
    (pageName !== null && !!pages.dates?.has(pageName)) ||
    (view.kind === "file" && !!files.dates?.has(view.name));

  // 快捷鍵：監聽器只裝一次，透過 ref 拿到最新的狀態
  const act = useRef<(a: ShortcutAction) => void>(() => {});
  act.current = (a) => {
    switch (a) {
      case "toggle-sidebar":
        return setSidebar((v) => !v);
      case "today":
        return openDay(now);
      case "view-bujo":
        return navigate({ kind: "bujo" });
      case "view-desk":
        return navigate({ kind: "desk" });
      case "back":
        return back();
      case "forward":
        return forward();
      case "newer-day":
        return openDay(day ? addDays(day, 1) : now);
      case "older-day":
        return openDay(addDays(day ?? now, -1));
      case "favorite":
        if (target) setFavorites((f) => toggleFavorite(f, target));
        return;
      case "help":
        return setHelp((v) => !v);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const a = matchShortcut(e);
      if (!a) return;
      e.preventDefault();
      act.current(a);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const title =
    day !== null
      ? `${weekday(day)}, ${dayTitle(day, now)}`
      : pageName !== null
        ? pageName
        : view.kind === "file"
          ? view.name
          : view.kind === "desk"
            ? "Desk"
            : "Calendar";
  const isSaved = !journals.saving && !pages.saving && !files.saving;
  const TitleIcon =
    view.kind === "desk" || view.kind === "file"
      ? DeskIcon
      : view.kind === "bujo" || day !== null
        ? CalendarIcon
        : DocIcon;

  return (
    <div className={`app${sidebar ? " with-sidebar" : ""}`}>
      <Sidebar
        open={sidebar}
        main={target ? null : mainOf(view)}
        current={target}
        isToday={day === now}
        now={now}
        favorites={favorites}
        recents={recents}
        theme={theme}
        onTheme={setTheme}
        onMain={(kind) => navigate({ kind })}
        onToday={() => openDay(now)}
        onOpen={openTarget}
        onClose={() => setSidebar(false)}
        onHelp={() => setHelp(true)}
      />
      {sidebar && <div className="sidebar-scrim" onClick={() => setSidebar(false)} />}
      <div className="main-col">
        <header className={`topbar${scrolled ? " scrolled" : ""}`}>
          <div className="crumbs">
            {!sidebar && (
              <button className="icon-btn" onClick={() => setSidebar(true)} title="Show sidebar (Ctrl+\)">
                <SidebarIcon />
              </button>
            )}
            <div className="history-btns">
              <button className="icon-btn" disabled={!canBack} onClick={back} title="Back (Alt+←)">
                <ArrowLeftIcon />
              </button>
              <button className="icon-btn" disabled={!canForward} onClick={forward} title="Forward (Alt+→)">
                <ArrowRightIcon />
              </button>
            </div>
            <TitleIcon className="doc-icon" />
            <span className="doc-title">{title}</span>
            {target && (
              <button
                className={`icon-btn star-btn${starred ? " on" : ""}`}
                onClick={() => setFavorites((f) => toggleFavorite(f, target))}
                title={starred ? "Remove from favorites (Alt+S)" : "Add to favorites (Alt+S)"}
                aria-pressed={starred}
              >
                <StarIcon filled={starred} />
              </button>
            )}
          </div>
          <div className="actions">
            {/* 儲存狀態只剩圓點：綠色是已儲存、灰色閃爍是儲存中（文字在提示與螢幕閱讀器裡） */}
            <span
              className={`save-state${isSaved ? "" : " saving"}`}
              role="status"
              aria-label={isSaved ? "Saved" : "Saving…"}
              title={isSaved ? "Saved" : "Saving…"}
            />
            {current !== null && <span className="stat">{countWords(current).toLocaleString()} words</span>}
            <CalendarButton dates={journals.dates} now={now} selected={day} onPick={openDay} />
            {deletable && (
              <button
                className="icon-btn delete-btn"
                onClick={() => {
                  if (!target || !confirmDelete(target)) return;
                  // 先離開畫面再刪，以免刪完的空白頁又被記進最近
                  if (target.kind === "page" || target.kind === "day") navigate({ kind: "bujo" });
                  else navigate({ kind: "desk" });
                  deleteDoc(target);
                }}
                title={day !== null ? "Delete this journal" : view.kind === "file" ? "Delete this file" : "Delete this page"}
              >
                <TrashIcon />
              </button>
            )}
          </div>
        </header>
        <div className="workspace">
          <main ref={pageRef} className={`page${view.kind === "bujo" ? " page-cal" : view.kind === "file" ? " page-board" : ""}`} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}>
            {view.kind === "day" && (
              <>
                <JournalDay journals={journals} pages={pages} date={view.date} now={now} onOpenDay={openDay} />
                <div className="journal-backlinks">
                  <Backlinks
                    name={view.date}
                    self={{ kind: "day", key: view.date }}
                    sources={sources}
                    now={now}
                    ready={ready}
                  />
                </div>
              </>
            )}
            {view.kind === "bujo" && <CalendarView journals={journals} now={now} />}
            {view.kind === "page" && (
              <PageView
                name={view.name}
                pages={pages}
                sources={sources}
                now={now}
                ready={ready}
              />
            )}
            {view.kind === "desk" && (
              <DeskView
                files={files}
                onOpen={(n) => openFile(n)}
                onCreate={createFile}
                onDelete={(name) => {
                  const t: NavTarget = { kind: "file", name };
                  if (confirmDelete(t)) deleteDoc(t);
                }}
              />
            )}
            {view.kind === "file" && (
              <FileView
                key={view.name}
                name={view.name}
                json={files.dates?.has(view.name) ? files.contents[view.name] : files.ready ? (files.contents[view.name] ?? "") : undefined}
                tab={view.tab}
                onTab={(tab) => navigate({ kind: "file", name: view.name, tab })}
                onModify={onModifyFile}
                pages={pages}
                journals={journals}
                pageNames={pageNameList}
                now={now}
                onOpenRef={(r) => {
                  if (r.kind === "page") navigate({ kind: "page", name: r.name });
                  else if (r.kind === "day") openDay(r.date);
                }}
                onOpenPage={openPageNamed}
                hasPage={hasPage}
              />
            )}
          </main>
        </div>
      </div>
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
    </div>
  );
}

export default App;
