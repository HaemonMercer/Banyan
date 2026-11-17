import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Editor } from "./editor/Editor";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarIcon,
  CloseIcon,
  CodeIcon,
  DocIcon,
  JournalIcon,
  PagesIcon,
  SidebarIcon,
  StarIcon,
  WhiteboardIcon,
} from "./editor/icons";
import { CalendarButton, JournalDay, JournalStream } from "./journal/Journals";
import { addDays, dayTitle, defaultStore, isDateKey, today, weekday } from "./journal/journal";
import {
  applyTheme,
  FAVORITES_KEY,
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
import { AllPages, PageView } from "./pages/PagesView";
import { Whiteboard } from "./board/Whiteboard";
import { BoardsView, OnBoards } from "./board/BoardsView";
import { defaultBoardStore, forgetCamera } from "./board/store";
import { emptyBoard, parseBoard, serializeBoard, type CardRef } from "./board/model";
import { pageKey } from "./pages/pageRef";
import "./App.css";
import "./shell/shell.css";

const STORAGE_KEY = "banyan.document";

const WELCOME = `# Welcome to Banyan

This is a **Notion-style** block editor. The document itself is plain, standard CommonMark Markdown.

Click any block to edit it in place; it is rendered again by the CommonMark spec when you leave.

## How to use it

- Type \`/\` in an empty block to open the block menu
- Or just type Markdown: \`# \` for a heading, \`- \` for a list, \`> \` for a quote
- Hover to the left of a block and use ⋮⋮ to drag it, or click it to delete, duplicate, or change its type
- \`Enter\` adds a block, \`Shift+Enter\` adds a line break, \`Ctrl+Z\` undoes
- Hold \`Ctrl\` and click a link to open it in your browser
- \`Tab\` indents, \`Shift+Tab\` outdents

<div class="indent">

An indented paragraph. Press \`Shift+Tab\` while editing to move it back out.

</div>

<div class="columns">

<div class="column">

### Columns

Drag a block to the **left or right side** of another block to split them into columns.

</div>

<div class="column">

### Resize

Drag the gap between columns to change their width; drag every block out of a column and the column disappears.

</div>

</div>

> All 652 examples in the CommonMark spec pass.

\`\`\`ts
const answer = 42;
\`\`\`

---

Reference links work too: [CommonMark][spec].

[spec]: https://spec.commonmark.org/0.31.2/
`;

function load(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? WELCOME;
  } catch {
    return WELCOME;
  }
}

/** 字數：中日韓文字每字算一個，其他以空白分隔的詞算一個。 */
function countWords(source: string): number {
  // 版面標籤（欄位、縮排）不算字
  const md = source.replace(/^<\/?div\b[^>]*>[ \t]*$/gim, "").replace(/&nbsp;/g, " ");
  const cjk = md.match(/[㐀-鿿豈-﫿぀-ヿ가-힯]/g)?.length ?? 0;
  const words = md.replace(/[㐀-鿿豈-﫿぀-ヿ가-힯]/g, " ").match(/[\p{L}\p{N}]+/gu);
  return cjk + (words?.length ?? 0);
}

type View =
  | { kind: "journals" }
  | { kind: "day"; date: string }
  | { kind: "bujo" }
  | { kind: "pages" }
  | { kind: "page"; name: string }
  | { kind: "boards" }
  | { kind: "board"; name: string }
  | { kind: "doc" };

const VIEW_KEY = "banyan.view";

function loadView(): View {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null");
    if (v?.kind === "doc" || v?.kind === "journals" || v?.kind === "bujo" || v?.kind === "pages" || v?.kind === "boards") {
      return { kind: v.kind };
    }
    if (v?.kind === "day" && typeof v.date === "string" && isDateKey(v.date)) return v;
    if ((v?.kind === "page" || v?.kind === "board") && typeof v.name === "string" && v.name.trim()) return v;
  } catch {
    /* 沒存過或格式不對就從日記開始 */
  }
  return { kind: "journals" };
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

/** 側邊欄「主要畫面」：單日日記算在「日記」，單一頁面算在「頁面」 */
function mainOf(view: View): MainView {
  return view.kind === "day" ? "journals" : view.kind === "page" ? "pages" : view.kind === "board" ? "boards" : view.kind;
}

function targetOf(view: View): NavTarget | null {
  return view.kind === "day"
    ? { kind: "day", date: view.date }
    : view.kind === "page" || view.kind === "board"
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
  const [markdown, setMarkdown] = useState(load);
  const { view, go, back, forward, canBack, canForward } = useHistoryNav();
  const [showSource, setShowSource] = useState(false);
  const [saved, setSaved] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  const [sidebar, setSidebar] = useState(
    () => !isNarrow() && loadJson(SIDEBAR_KEY, true, (v) => typeof v === "boolean"),
  );
  const [favorites, setFavorites] = useState(() => loadTargets(FAVORITES_KEY));
  const [recents, setRecents] = useState(() => loadTargets(RECENTS_KEY));
  const [theme, setTheme] = useState<ThemePref>(loadTheme);
  const [help, setHelp] = useState(false);
  const lastSaved = useRef(markdown);
  const journalStore = useMemo(defaultStore, []);
  const pageStore = useMemo(defaultPageStore, []);
  const journals = useDocs(journalStore);
  const pages = useDocs(pageStore);
  const boardStore = useMemo(defaultBoardStore, []);
  const boards = useDocs(boardStore);
  const now = useToday();
  const pageRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (markdown === lastSaved.current) return;
    setSaved(false);
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, markdown);
      } catch {
        /* 儲存失敗就算了，不影響編輯 */
      }
      lastSaved.current = markdown;
      setSaved(true);
    }, 400);
    return () => clearTimeout(t);
  }, [markdown]);

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

  // 每份文件放在哪些白板上（頁面、日記下方顯示）
  const boardIndex = useMemo(() => {
    const idx = new Map<string, string[]>();
    for (const [name, json] of Object.entries(boards.contents)) {
      if (!json) continue;
      for (const c of parseBoard(json).cards) {
        const k = c.ref.kind === "page" ? `page:${pageKey(c.ref.name)}` : `day:${c.ref.date}`;
        const list = idx.get(k) ?? [];
        if (!list.includes(name)) list.push(name);
        idx.set(k, list);
      }
    }
    for (const list of idx.values()) list.sort((a, b) => a.localeCompare(b));
    return idx;
  }, [boards.contents]);
  const openBoard = (name: string) => navigate({ kind: "board", name });
  const openRef = (r: CardRef) => navigate(r.kind === "day" ? { kind: "day", date: r.date } : { kind: "page", name: r.name });
  const createBoard = (name: string) => {
    if (!boards.dates?.has(name)) boards.update(name, serializeBoard(emptyBoard()));
    openBoard(name);
  };
  const deleteBoard = (name: string) => {
    boards.update(name, "");
    forgetCamera(name);
    const t: NavTarget = { kind: "board", name };
    setFavorites((f) => (isFavorite(f, t) ? toggleFavorite(f, t) : f));
    setRecents((r) => r.filter((x) => !(x.kind === "board" && x.name === name)));
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
    navigate(t.kind === "day" ? { kind: "day", date: t.date } : { kind: t.kind, name: t.name });

  // 目前畫面的 Markdown（原始碼面板、字數用）；日記串、清單類的畫面不提供原始碼面板
  const day = view.kind === "day" ? view.date : null;
  const pageName = view.kind === "page" ? view.name : null;
  const current =
    view.kind === "doc"
      ? markdown
      : day !== null
        ? (journals.contents[day] ?? "")
        : pageName !== null
          ? (pages.contents[pageName] ?? "")
          : null;
  const setCurrent = (md: string) =>
    day !== null ? journals.update(day, md) : pageName !== null ? pages.update(pageName, md) : setMarkdown(md);
  const sourceOpen = showSource && current !== null;
  const target = targetOf(view);
  const starred = !!target && isFavorite(favorites, target);

  // 快捷鍵：監聽器只裝一次，透過 ref 拿到最新的狀態
  const act = useRef<(a: ShortcutAction) => void>(() => {});
  act.current = (a) => {
    switch (a) {
      case "toggle-sidebar":
        return setSidebar((v) => !v);
      case "today":
        return openDay(now);
      case "view-journals":
        return navigate({ kind: "journals" });
      case "view-bujo":
        return navigate({ kind: "bujo" });
      case "view-pages":
        return navigate({ kind: "pages" });
      case "view-boards":
        return navigate({ kind: "boards" });
      case "view-doc":
        return navigate({ kind: "doc" });
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
      case "source":
        if (current !== null) setShowSource((v) => !v);
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

  const docTitle = /^#\s+(.+?)\s*#*\s*$/m.exec(markdown)?.[1] ?? "Untitled";
  const title =
    view.kind === "doc"
      ? docTitle
      : day !== null
        ? `${weekday(day)}, ${dayTitle(day, now)}`
        : pageName !== null
          ? pageName
          : view.kind === "board"
            ? view.name
            : view.kind === "boards"
              ? "Whiteboards"
              : view.kind === "bujo"
            ? "Calendar"
            : view.kind === "pages"
              ? "All pages"
              : "Journals";
  const isSaved = view.kind === "doc" ? saved : !journals.saving && !pages.saving && !boards.saving;
  const TitleIcon =
    view.kind === "board" || view.kind === "boards"
      ? WhiteboardIcon
      : view.kind === "bujo"
      ? CalendarIcon
      : view.kind === "pages"
        ? PagesIcon
        : view.kind === "journals"
          ? JournalIcon
          : day !== null
            ? CalendarIcon
            : DocIcon;

  return (
    <div className={`app${sourceOpen ? " with-source" : ""}${sidebar ? " with-sidebar" : ""}`}>
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
            <span className={`save-state${isSaved ? "" : " saving"}`}>{isSaved ? "Saved" : "Saving…"}</span>
            {current !== null && <span className="stat">{countWords(current).toLocaleString()} words</span>}
            {view.kind !== "doc" && (
              <CalendarButton dates={journals.dates} now={now} selected={day} onPick={openDay} />
            )}
            {current !== null && (
              <button
                className={`tool${showSource ? " on" : ""}`}
                onClick={() => setShowSource((v) => !v)}
                title="Show/hide Markdown source (Alt+M)"
              >
                <CodeIcon />
                <span>Source</span>
              </button>
            )}
          </div>
        </header>
        <div className="workspace">
          <main ref={pageRef} className={`page${view.kind === "bujo" ? " page-cal" : view.kind === "board" ? " page-board" : ""}`} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}>
            {view.kind === "doc" && <Editor value={markdown} onChange={setMarkdown} />}
            {view.kind === "journals" && <JournalStream journals={journals} pages={pages} now={now} onOpenDay={openDay} />}
            {view.kind === "day" && (
              <>
                <JournalDay journals={journals} pages={pages} date={view.date} now={now} onOpenDay={openDay} />
                <div className="journal-backlinks">
                  <OnBoards names={boardIndex.get(`day:${view.date}`) ?? []} onOpen={openBoard} />
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
            {view.kind === "pages" && <AllPages pages={pages} sources={sources} ready={ready} />}
            {view.kind === "page" && (
              <PageView
                name={view.name}
                pages={pages}
                sources={sources}
                now={now}
                ready={ready}
                extra={<OnBoards names={boardIndex.get(`page:${pageKey(view.name)}`) ?? []} onOpen={openBoard} />}
              />
            )}
            {view.kind === "boards" && (
              <BoardsView boards={boards} onOpen={openBoard} onCreate={createBoard} onDelete={deleteBoard} />
            )}
            {view.kind === "board" && (
              <Whiteboard
                name={view.name}
                boards={boards}
                pages={pages}
                journals={journals}
                pageNames={pageNameList}
                now={now}
                onOpen={openRef}
              />
            )}
          </main>
          {sourceOpen && (
            <aside className="md-source-panel">
              <div className="panel-head">
                <span className="panel-title">Markdown source</span>
                <span className="panel-tag">CommonMark 0.31.2</span>
                <button className="icon-btn" onClick={() => setShowSource(false)} title="Close">
                  <CloseIcon />
                </button>
              </div>
              <textarea value={current} spellCheck={false} onChange={(e) => setCurrent(e.target.value)} />
            </aside>
          )}
        </div>
      </div>
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
    </div>
  );
}

export default App;
