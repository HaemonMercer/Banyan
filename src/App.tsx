import { loadStyles, setRewriteDocs } from "./desk/styleLibrary";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { countWords } from "./editor/words";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarIcon,
  ClockIcon,
  DeskIcon,
  DocIcon,
  DrawerIcon,
  SettingsIcon,
  SidebarIcon,
  StarIcon,
  TrashIcon,
} from "./editor/icons";
import { CalendarButton, JournalDay } from "./journal/Journals";
import { addDays, dayTitle, defaultStore, isDateKey, today, weekday } from "./journal/journal";
import {
  applyTheme,
  FAVORITES_KEY,
  DESK_LAST_KEY,
  DRAWER_TAB_KEY,
  forgetFileTargets,
  renameFileTargets,
  forgetTarget,
  isFavorite,
  loadJson,
  loadTargets,
  loadTheme,
  pushRecent,
  RECENTS_KEY,
  saveJson,
  sameTarget,
  SIDEBAR_KEY,
  targetKey,
  THEME_KEY,
  toggleFavorite,
  type NavTarget,
  type ThemePref,
} from "./shell/nav";
import { matchShortcut, type ShortcutAction } from "./shell/shortcuts";
import { Sidebar, type MainView } from "./shell/Sidebar";
import { ShortcutHelp } from "./shell/ShortcutHelp";
import { ImagePicker } from "./drawer/ImagePicker";
import { setDrawerLibrary, setImagePicker, type PickedImage, type PickOptions } from "./drawer/drawerImages";
import { SettingsView } from "./shell/Settings";
import { useDocs } from "./journal/useJournals";
import { CalendarView } from "./bujo/CalendarView";
import { APPEND_EVENT, appendItems, type AppendRequest } from "./bujo/tasks";
import { allPages, type Source } from "./pages/refIndex";
import { Backlinks } from "./pages/Backlinks";
import { OPEN_PAGE_EVENT, setPageNames } from "./pages/pageRef";
import { setEmbedSources, setSheetSources } from "./pages/embeds";
import { SheetPicker, type SheetBook } from "./sheet/SheetPicker";
import { setSheetPicker } from "./sheet/pickSheet";
import { setSheetWriter } from "./sheet/embedEdit";
import { InputModeBadge, PredictBar } from "./editor/PredictBar";
import { setPredictCorpus, switchInputScheme } from "./editor/predict";
import { installFieldPrediction } from "./editor/fieldPredict";
import { collectDocLinks, docLinkOf, objectRef, docRenames, linkKey, renameDocInLinks, renameFileInLinks, setDocLinks, type DocLink } from "./desk/docLinks";
import { loadDockDoc, renameFileState, saveDockDoc } from "./desk/store";
import { isTauri } from "@tauri-apps/api/core";
import { defaultHistoryFiles, VersionLog } from "./history/store";
import { VersionHistory } from "./history/VersionHistory";
import { copyName } from "./history/versions";
import { defaultPageStore, resolveTarget } from "./pages/pages";
import { PageView } from "./pages/PagesView";
import { pageKey } from "./pages/pageRef";
import { collectTemplates, expandTemplate, findTemplate, JOURNAL_TEMPLATE, setTemplates } from "./pages/templates";
import { isBlank } from "./journal/journal";
import { DeskSwitch, DeskView, FileTitle, FileView, nextDeskTab, type DeskTab } from "./desk/DeskView";
import { defaultDeskStore, defaultDeskTemplateStore, forgetFile } from "./desk/store";
import { cleanFolders, dockOrder, emptyFile, freeTitle, isDataKind, keepFolder, parseFile, serializeFile, updateDoc, type DeskFile } from "./desk/file";
import { parseWorkbook, serializeWorkbook } from "./sheet/model";
import { newId } from "./desk/board";
import { DrawerSwitch, DrawerView, nextDrawerTab, type DrawerFocus, type DrawerTab } from "./drawer/DrawerView";
import { defaultDrawerStore, LIBRARY, loadUi as loadDrawerUi } from "./drawer/store";
import { citeItem, citeRemark, setCiteLibrary, setCiteStyle } from "./drawer/citeRef";
import { notePage, parseLibrary, serializeLibrary, type Item, type Library } from "./drawer/model";
import { noteTemplate } from "./drawer/cite";
import "./App.css";
import "./shell/shell.css";

type View =
  | { kind: "day"; date: string }
  | { kind: "bujo" }
  | { kind: "page"; name: string }
  | { kind: "desk" }
  /** tab：文獻庫或檔案庫 */
  | { kind: "drawer"; tab: DrawerTab }
  | { kind: "settings" }
  /** doc：Dock 開著的文件（沒有就用上次在這個檔案開的，再沒有就是第一份） */
  | { kind: "file"; name: string; tab: DeskTab; doc?: string };

const VIEW_KEY = "banyan.view";

function loadView(): View {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null");
    if (v?.kind === "bujo" || v?.kind === "desk" || v?.kind === "settings") return { kind: v.kind };
    if (v?.kind === "drawer") return { kind: "drawer", tab: v.tab === "files" ? "files" : "library" };
    // 舊的資料庫畫面已經併進 Desk
    if (v?.kind === "databases" || v?.kind === "database") return { kind: "desk" };
    if (v?.kind === "day" && typeof v.date === "string" && isDateKey(v.date)) return v;
    if (v?.kind === "page" && typeof v.name === "string" && v.name.trim()) return v;
    if (v?.kind === "file" && typeof v.name === "string" && v.name.trim()) {
      return v.tab === "dock"
        ? { kind: "file", name: v.name, tab: "dock", ...(typeof v.doc === "string" && v.doc ? { doc: v.doc } : {}) }
        : { kind: "file", name: v.name, tab: v.tab === "tasks" ? "tasks" : "board" };
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
  return view.kind === "file" ? "desk" : view.kind === "bujo" || view.kind === "desk" || view.kind === "drawer" ? view.kind : null;
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
  /** 改寫目前與上一頁／下一頁裡的畫面（Desk 檔案改名時） */
  const mapViews = useCallback(
    (fn: (v: View) => View) => setNav((n) => ({ view: fn(n.view), back: n.back.map(fn), forward: n.forward.map(fn) })),
    [],
  );
  return { view: nav.view, canBack: nav.back.length > 0, canForward: nav.forward.length > 0, go, back, forward, mapViews };
}

function App() {
  const { view, go, back, forward, canBack, canForward, mapViews } = useHistoryNav();
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
  // 版本歷史：每次存檔後記錄（同一段編輯合併成一個版本）
  const logs = useMemo(() => {
    const f = defaultHistoryFiles();
    return { journals: new VersionLog("journals", f), pages: new VersionLog("pages", f), desk: new VersionLog("desk", f) };
  }, []);
  const [history, setHistory] = useState(false);
  const journals = useDocs(journalStore, (k, c, p) => void logs.journals.record(k, c, p));
  const pages = useDocs(pageStore, (k, c, p) => void logs.pages.record(k, c, p));
  const deskStore = useMemo(defaultDeskStore, []);
  const files = useDocs(deskStore, (k, c, p) => void logs.desk.record(k, c, p));
  const drawerStore = useMemo(defaultDrawerStore, []);
  const drawer = useDocs(drawerStore);
  const now = useToday();
  const pageRef = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(view));
    } catch {
      /* 記不住上次的畫面也沒關係 */
    }
    pageRef.current?.scrollTo({ top: 0 });
    setHistory(false);
    // Desk 記住上次停在哪裡（首頁或某個檔案），再按 Desk 時直接回去
    if (view.kind === "desk" || view.kind === "file") saveJson(DESK_LAST_KEY, view);
    if (view.kind === "drawer") saveJson(DRAWER_TAB_KEY, view.tab);
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

  // Drawer 的文獻庫（只有一份；沒有檔案時也先「讀進來」成空的，之後的修改才是同步的）
  const { load: loadDrawer, modify: modifyDrawer } = drawer;
  useEffect(() => loadDrawer(LIBRARY), [loadDrawer]);
  const libraryJson = drawer.contents[LIBRARY];
  const library = useMemo(() => parseLibrary(libraryJson ?? ""), [libraryJson]);
  const libraryItems = library.items;
  // 編輯器、Word、簡報的「插入圖片」對話框（`drawer/drawerImages.ts`、`ImagePicker.tsx`）
  useEffect(() => setDrawerLibrary(library), [library]);
  const [imagePick, setImagePick] = useState<{ opts: PickOptions; done: (list: PickedImage[]) => void } | null>(null);
  useEffect(() => {
    setImagePicker((opts) => new Promise((done) => setImagePick({ opts, done })));
    return () => setImagePicker(null);
  }, []);
  const citeKeys = useMemo(() => libraryItems.filter((i) => !i.trashed && i.key).map((i) => notePage(i)), [libraryItems]);
  // 編輯器把 [[@引用鍵]] 顯示成文中引用（格式跟著 Drawer 上次選的 APA／MLA）
  useEffect(() => setCiteLibrary(libraryItems), [libraryItems]);
  useEffect(() => setCiteStyle(loadDrawerUi().style === "mla" ? "mla" : "apa"), []);
  /** 點了備註的引用：Drawer 要選取的條目與備註 */
  const [drawerFocus, setDrawerFocus] = useState<DrawerFocus | null>(null);
  const onModifyLibrary = useCallback(
    (fn: (lib: Library) => Library) => modifyDrawer(LIBRARY, (j) => serializeLibrary(fn(parseLibrary(j)))),
    [modifyDrawer],
  );

  // Dock 文件的連結 [[檔案/標題]]：和既有頁面同名的不算（頁面優先）
  const allDocs = useMemo(() => collectDocLinks(files.dates ?? [], files.contents), [files.dates, files.contents]);
  const docLinks = useMemo(() => {
    const have = new Set([...(pages.dates ?? [])].map(linkKey));
    return allDocs.filter((l) => !have.has(linkKey(l.name)));
  }, [allDocs, pages.dates]);
  /** 「檔案\0id」→ Dock 文件（側邊欄的收藏、最近用） */
  const docById = useMemo(() => new Map<string, DocLink>(allDocs.map((l) => [`${l.file}\u0000${l.id}`, l])), [allDocs]);
  const docInfo = useCallback(
    (file: string, id: string) => {
      const d = docById.get(`${file}\u0000${id}`);
      if (d) return { title: d.title, kind: d.kind };
      // 檔案還沒讀完時先不要藏起來；讀完了還找不到就是刪掉了
      return files.ready && files.contents[file] !== undefined ? null : { title: "Untitled", kind: "note" };
    },
    [docById, files.ready, files.contents],
  );
  // 清單變了會通知編輯器重畫（和 Drawer 的引用一樣）
  useEffect(() => setDocLinks(docLinks), [docLinks]);

  // 自動完成用的頁面名稱：有內容的頁面＋被提到的頁面＋ Drawer 條目的筆記頁面（[[@引用鍵]]）；
  // 連到 Dock 文件的 [[檔案/標題]] 不是頁面
  const pageNameList = useMemo(() => {
    const docNames = new Set(docLinks.map((l) => linkKey(l.name)));
    const names = allPages(pages.dates ?? [], sources, isDateKey)
      .map((p) => p.name)
      .filter((n) => !docNames.has(linkKey(objectRef(n)?.doc ?? n)));
    const have = new Set(names.map(pageKey));
    return [...names, ...citeKeys.filter((k) => !have.has(pageKey(k)))];
  }, [pages.dates, sources, citeKeys, docLinks]);
  useEffect(() => setPageNames(pageNameList), [pageNameList]);
  // ![[名稱]] 嵌入的內容：Dock 的 Markdown 文件（Note、Word、簡報）、頁面與日記（同名時頁面優先，放在後面蓋過）
  const docSources = useMemo(() => {
    const parsed = new Map<string, DeskFile>();
    const out: [string, string][] = [];
    const seen = new Set<string>();
    for (const l of docLinks) {
      const k = linkKey(l.name);
      if (seen.has(k) || isDataKind(l.kind)) continue;
      seen.add(k);
      let f = parsed.get(l.file);
      if (!f) parsed.set(l.file, (f = parseFile(files.contents[l.file] ?? "")));
      const doc = f.docs.find((d) => d.id === l.id);
      if (doc) out.push([l.name, doc.content]);
    }
    return out;
  }, [docLinks, files.contents]);
  useEffect(
    () => setEmbedSources([...docSources, ...sources.map((s): [string, string] => [s.key, s.content])]),
    [docSources, sources],
  );
  // ![[檔案/標題#^id]] 嵌入 Excel 的表格、圖表：所有 Excel 文件的活頁簿 JSON（插入的對話框也用）
  const sheetBooks = useMemo(() => {
    const parsed = new Map<string, DeskFile>();
    const out: (SheetBook & { name: string })[] = [];
    const seen = new Set<string>();
    for (const l of allDocs) {
      const k = linkKey(l.name);
      if (seen.has(k) || l.kind !== "sheet") continue;
      seen.add(k);
      let f = parsed.get(l.file);
      if (!f) parsed.set(l.file, (f = parseFile(files.contents[l.file] ?? "")));
      const doc = f.docs.find((d) => d.id === l.id);
      if (doc) out.push({ name: l.name, file: l.file, title: l.title, json: doc.content });
    }
    return out;
  }, [allDocs, files.contents]);
  useEffect(() => setSheetSources(sheetBooks.map((b): [string, string] => [b.name, b.json])), [sheetBooks]);
  const [sheetPick, setSheetPick] = useState<{ done: (md: string | null) => void } | null>(null);
  useEffect(() => {
    setSheetPicker(() => new Promise((done) => setSheetPick({ done })));
    return () => setSheetPicker(null);
  }, []);

  // 字預測：文字框、輸入框（便利貼、格子、標題、搜尋…）也有預測
  useEffect(() => installFieldPrediction(), []);
  // 字預測：英文補完優先用使用者寫過的字（日記與頁面）
  useEffect(
    () => setPredictCorpus([...Object.values(journals.contents), ...Object.values(pages.contents)]),
    [journals.contents, pages.contents],
  );

  // 頁面範本（名稱 `Template/…` 的頁面）：給編輯器的斜線選單
  const templates = useMemo(() => collectTemplates(pages.contents), [pages.contents]);
  useEffect(() => setTemplates(templates), [templates]);
  // 今天還沒有日記、又有 `Template/Journal`：用它寫上今天的日記（每天只做一次，刪掉今天的日記不會馬上又寫回來）
  const journalFilled = useRef(new Set<string>());
  const { update: updateJournal } = journals;
  useEffect(() => {
    if (!journals.ready || !pages.ready || journalFilled.current.has(now)) return;
    journalFilled.current.add(now);
    const t = findTemplate(JOURNAL_TEMPLATE, templates);
    if (!t || journals.dates?.has(now) || !isBlank(journals.contents[now] ?? "")) return;
    updateJournal(now, expandTemplate(t.content, { date: now }) + "\n");
  }, [journals.ready, pages.ready, now, templates, journals.dates, journals.contents, updateJournal]);

  // Desk 的檔案（名稱不分大小寫）
  const openFile = (name: string, tab: DeskTab = "board") => navigate({ kind: "file", name, tab });
  /** 新增 Desk 檔案；content 是範本產生的內容（`deskTemplates.ts`），沒有就是空白檔案 */
  const createFile = (raw: string, content?: string) => {
    const name = raw.trim();
    if (!name) return;
    const had = [...(files.dates ?? [])].find((n) => pageKey(n) === pageKey(name));
    if (!had) files.update(name, content ?? serializeFile(emptyFile()));
    openFile(had ?? name);
  };
  // 使用者存的 Desk 檔案範本（desk-templates/）
  const deskTemplateStore = useMemo(defaultDeskTemplateStore, []);
  const fileTemplates = useDocs(deskTemplateStore);
  const modifyFile = files.modify;
  const changeFile = useCallback(
    (name: string, fn: (f: DeskFile) => DeskFile) => modifyFile(name, (j) => serializeFile(fn(parseFile(j)))),
    [modifyFile],
  );
  // 文件裡改嵌入的 Excel 表格的格子：改那份 Excel（`sheet/embedEdit.ts`）
  const sheetDocsRef = useRef(allDocs);
  sheetDocsRef.current = allDocs;
  useEffect(() => {
    setSheetWriter((doc, change) => {
      const l = sheetDocsRef.current.find((x) => x.kind === "sheet" && linkKey(x.name) === linkKey(doc));
      if (!l) return false;
      changeFile(l.file, (f) => {
        const x = f.docs.find((d) => d.id === l.id);
        return x ? updateDoc(f, x.id, { content: serializeWorkbook(change(parseWorkbook(x.content))) }) : f;
      });
      return true;
    });
    return () => setSheetWriter(null);
  }, [changeFile]);
  // 已存的樣式（styleLibrary.ts，所有文件共用）：段落樣式的更新、改名、刪除與字元樣式的改名、刪除，
  // 改所有 Desk 檔案裡的 Word、簡報（hint：內容裡沒有這串字的檔案跳過）
  const rewriteDocsRef = useRef<(rewrite: (src: string) => string, hint: string) => void>(() => {});
  rewriteDocsRef.current = (rewrite, hint) => {
    for (const [k, c] of Object.entries(files.contents)) {
      if (!c.includes(hint)) continue;
      changeFile(k, (f) => {
        let changed = false;
        const docs = f.docs.map((d) => {
          if (d.kind !== "word" && d.kind !== "slides") return d;
          const out = rewrite(d.content);
          if (out === d.content) return d;
          changed = true;
          return { ...d, content: out };
        });
        return changed ? { ...f, docs } : f;
      });
    }
  };
  useEffect(() => {
    setRewriteDocs((rewrite, hint) => rewriteDocsRef.current(rewrite, hint));
    // 字元樣式的樣子在共用的樣式表裡：一開始就讀
    void loadStyles();
  }, []);
  const fileName = view.kind === "file" ? view.name : null;
  const onModifyFile = useCallback(
    (fn: (f: DeskFile) => DeskFile) =>
      fileName &&
      changeFile(fileName, (f) => {
        const next = fn(f);
        // 改了文件標題：等這次修改寫進去之後再改寫連結（連結可能在同一個檔案裡）
        const renames = next.docs === f.docs ? [] : docRenames(f, next);
        if (renames.length) queueMicrotask(() => relinkDocs.current(fileName, renames));
        return next;
      }),
    [fileName, changeFile],
  );
  const { load: loadFile } = files;
  useEffect(() => {
    if (fileName && files.dates?.has(fileName)) loadFile(fileName);
  }, [fileName, files.dates, loadFile]);

  // 名稱連到同名頁面（不分大小寫）
  const pageByKey = useMemo(() => new Map([...(pages.dates ?? [])].map((n) => [pageKey(n), n])), [pages.dates]);
  const hasPage = useCallback((t: string) => pageByKey.has(pageKey(t)), [pageByKey]);
  const openPageNamed = (t: string) => navigate({ kind: "page", name: pageByKey.get(pageKey(t)) ?? t });
  /** Drawer 條目的筆記：頁面 `@引用鍵`，第一次打開時寫上參考文獻。 */
  const openNotes = (it: Item) => {
    const name = notePage(it);
    const had = pageByKey.get(pageKey(name));
    if (!had) pages.update(name, noteTemplate(it));
    navigate({ kind: "page", name: had ?? name });
  };
  const openNotesRef = useRef(openNotes);
  openNotesRef.current = openNotes;

  /**
   * 刪除頁面、一天的日記或 Desk 的檔案：內容寫成空的（Rust 端會刪掉檔案），並從收藏、最近拿掉。
   * 連到它的 [[連結]] 保留（再點一次就是新的空白頁）。
   */
  const deleteDoc = (t: NavTarget) => {
    // Dock 的文件在 Dock 裡刪；側邊欄會自動不列出刪掉的文件
    if (t.kind === "doc") return;
    if (t.kind === "file") {
      files.update(t.name, "");
      forgetFile(t.name);
      // 連同它 Dock 裡的文件一起從收藏、最近拿掉
      setFavorites((f) => forgetFileTargets(f, t.name));
      setRecents((r) => forgetFileTargets(r, t.name));
    }
    else if (t.kind === "page") pages.update(t.name, "");
    else journals.update(t.date, "");
    setFavorites((f) => forgetTarget(f, t));
    setRecents((r) => forgetTarget(r, t));
  };
  const confirmDelete = (t: NavTarget): boolean => {
    if (t.kind === "doc") return false;
    if (t.kind === "file") {
      return window.confirm(`Delete “${t.name}” with its whiteboard and every Dock document? Pages and journals on the whiteboard are kept. This can't be undone.`);
    }
    const what = t.kind === "day" ? `the journal for ${dayTitle(t.date, now)}` : `the page “${t.name}”`;
    return window.confirm(`Delete ${what}? Links to it are kept. This can't be undone.`);
  };
  /** 從側邊欄、白板卡片刪除：確認後刪掉；正開著它就先回到行事曆（以免空白頁又被記進最近）。回傳是否刪了。 */
  const askDelete = (t: NavTarget): boolean => {
    if (!confirmDelete(t)) return false;
    const open = targetOf(view);
    if (open && sameTarget(open, t)) navigate(t.kind === "file" ? { kind: "desk" } : { kind: "bujo" });
    deleteDoc(t);
    return true;
  };

  // 點頁面連結、反向連結：開啟日記的某一天或某個頁面
  const pageNames = useRef<Set<string> | null>(null);
  pageNames.current = pages.dates;
  useEffect(() => {
    const open = (e: Event) => {
      // [[@引用鍵#r1]]：在 Drawer 打開條目的那個備註
      const remark = citeRemark(String((e as CustomEvent).detail ?? ""));
      if (remark) {
        setDrawerFocus({ item: remark.item.id, remark: remark.remark.id, stamp: Date.now() });
        navigate({ kind: "drawer", tab: "library" });
        return;
      }
      // [[@引用鍵]]：開啟條目的筆記（第一次打開時寫上參考文獻）
      const cited = citeItem(String((e as CustomEvent).detail ?? ""));
      if (cited) return openNotesRef.current(cited);
      // [[檔案/標題]]：打開那個檔案的 Dock、選取那份文件
      const dock = docLinkOf(String((e as CustomEvent).detail ?? ""));
      if (dock) {
        saveDockDoc(dock.file, dock.id);
        navigate({ kind: "file", name: dock.file, tab: "dock", doc: dock.id });
        return;
      }
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
          : t.kind === "doc"
            ? { kind: "file", name: t.file, tab: "dock", doc: t.id }
            : { kind: t.kind, name: t.name },
    );

  /**
   * 側邊欄的 Desk（Alt+Shift+2）：在 Desk 的檔案裡 → 回到首頁；在首頁 → 不動；
   * 從別的畫面來 → 回到上次停的地方（檔案已經刪掉就回首頁）。
   */
  /** 側邊欄的 Drawer（Alt+Shift+3）：回到上次看的那一頁（文獻庫或檔案庫） */
  const openDrawer = () => {
    if (view.kind === "drawer") return;
    navigate({ kind: "drawer", tab: loadJson<string>(DRAWER_TAB_KEY, "library", (v) => typeof v === "string") === "files" ? "files" : "library" });
  };
  const openDesk = () => {
    if (view.kind === "file") return navigate({ kind: "desk" });
    if (view.kind === "desk") return;
    const last = loadJson<View | null>(DESK_LAST_KEY, null, (v) => !!v && typeof v === "object");
    if (last?.kind === "file" && typeof last.name === "string" && (!files.ready || files.dates?.has(last.name))) {
      return navigate(
        last.tab === "dock"
          ? { kind: "file", name: last.name, tab: "dock", ...(typeof last.doc === "string" && last.doc ? { doc: last.doc } : {}) }
          : { kind: "file", name: last.name, tab: last.tab === "tasks" ? "tasks" : "board" },
      );
    }
    navigate({ kind: "desk" });
  };

  // 目前畫面的 Markdown（字數用）；日記串、清單類的畫面不顯示字數
  const day = view.kind === "day" ? view.date : null;
  const pageName = view.kind === "page" ? view.name : null;
  const current =
    day !== null
      ? (journals.contents[day] ?? "")
      : pageName !== null
        ? (pages.contents[pageName] ?? "")
        : null;
  // Dock 開著的文件：畫面指定的、上次在這個檔案開的，或第一份
  const fileDocs = view.kind === "file" && view.tab === "dock" ? allDocs.filter((d) => d.file === view.name) : [];
  const dockId =
    view.kind === "file" && view.tab === "dock"
      ? ([view.doc, loadDockDoc(view.name)].find((id) => id && fileDocs.some((d) => d.id === id)) ?? fileDocs[0]?.id ?? null)
      : null;
  const target: NavTarget | null =
    view.kind === "file" && dockId
      ? { kind: "doc", file: view.name, id: dockId }
      : view.kind === "file" && view.tab === "dock" && !files.ready
        ? null // 還沒讀完，不知道開的是哪份文件
        : targetOf(view);
  // 最近：日記、頁面、白板，以及 Dock 打開的文件
  const targetId = target ? targetKey(target) : "";
  useEffect(() => {
    if (target) setRecents((r) => pushRecent(r, target));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);
  const starred = !!target && isFavorite(favorites, target);
  // 有內容（存成檔案）的日記才能刪；頁面一律可以（空白頁刪掉就是從收藏、最近拿掉）
  const deletable =
    (day !== null && !!journals.dates?.has(day)) ||
    pageName !== null ||
    (view.kind === "file" && !!files.dates?.has(view.name));

  // 版本歷史：存成檔案的日記、頁面、Desk 檔案才有
  const hasHistory =
    (day !== null && !!journals.dates?.has(day)) ||
    (pageName !== null && !!pages.dates?.has(pageName)) ||
    (view.kind === "file" && !!files.dates?.has(view.name));
  const historyOf = () =>
    day !== null
      ? { log: logs.journals, docs: journals, key: day }
      : pageName !== null
        ? { log: logs.pages, docs: pages, key: pageName }
        : view.kind === "file"
          ? { log: logs.desk, docs: files, key: view.name }
          : null;
  const historyView = () => {
    const h = historyOf();
    if (!h) return null;
    const content = h.docs.contents[h.key] ?? "";
    // Desk 檔案只看正在處理的部分：Dock 開著的文件、Tasks，或白板
    const deskFile = view.kind === "file" ? parseFile(content) : null;
    const part =
      view.kind === "file" && view.tab === "dock" && deskFile?.docs.length
        ? (deskFile.docs.find((d) => d.id === dockId) ?? dockOrder(deskFile)[0]).id
        : view.kind === "file" && view.tab === "tasks"
          ? "tasks"
          : "board";
    /** 打開 Dock 的某份文件 */
    const showDoc = (file: string, id: string) => {
      saveDockDoc(file, id);
      navigate({ kind: "file", name: file, tab: "dock", doc: id });
    };
    const restore = (text: string, at: number) => {
      h.log.markRestore(h.key, at);
      if (view.kind === "file") {
        // 只放回這一部分，檔案的其他部分維持現在的樣子
        const old = parseFile(text);
        const doc = old.docs.find((d) => d.id === part);
        changeFile(view.name, (f) =>
          part === "board"
            ? { ...f, board: old.board }
            : part === "tasks"
              ? { ...f, tasks: old.tasks }
              : !doc
              ? f
              : f.docs.some((d) => d.id === doc.id)
                ? { ...f, docs: f.docs.map((d) => (d.id === doc.id ? keepFolder(doc, d) : d)) }
                : cleanFolders({ ...f, docs: [...f.docs, doc] }),
        );
      } else h.docs.update(h.key, text);
      setHistory(false);
    };
    // 副本：頁面與日記做成新頁面；Dock 文件在同一個檔案裡多一份；白板做成只有白板的新檔案
    const copy = (text: string) => {
      if (view.kind === "file") {
        const old = parseFile(text);
        const doc = old.docs.find((d) => d.id === part);
        if (part !== "board" && doc) {
          const id = newId();
          changeFile(view.name, (f) => cleanFolders({ ...f, docs: [...f.docs, { ...doc, id, title: freeTitle(f, `${doc.title} (copy)`) }] }));
          setHistory(false);
          showDoc(view.name, id);
          return;
        }
        const taken = (n: string) => [...(files.dates ?? [])].some((x) => pageKey(x) === pageKey(n));
        const name = copyName(view.name, taken);
        files.update(name, serializeFile(part === "tasks" ? { board: emptyFile().board, docs: [], tasks: old.tasks } : { board: old.board, docs: [] }));
        openFile(name, part === "tasks" ? "tasks" : "board");
      } else {
        const base = day !== null ? `Journal ${day}` : (pageName ?? "Untitled");
        const name = copyName(base, hasPage);
        pages.update(name, text);
        navigate({ kind: "page", name });
      }
    };
    return (
      <VersionHistory
        key={h.log.kind + ":" + h.key + ":" + part}
        log={h.log}
        docKey={h.key}
        kind={view.kind === "file" ? "desk" : "markdown"}
        current={content}
        now={now}
        part={view.kind === "file" ? part : undefined}
        title={day !== null ? `${weekday(day)}, ${dayTitle(day, now)}` : (pageName ?? undefined)}
        board={view.kind === "file" ? { name: view.name, pages, journals, pageNames: pageNameList } : undefined}
        onRestore={restore}
        onCopy={copy}
        onClose={() => setHistory(false)}
      />
    );
  };

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
        return openDesk();
      case "view-drawer":
        return openDrawer();
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
      case "desk-switch":
        if (view.kind === "file") navigate({ kind: "file", name: view.name, tab: nextDeskTab(view.tab) });
        else if (view.kind === "drawer") navigate({ kind: "drawer", tab: nextDrawerTab(view.tab) });
        return;
      case "settings":
        return navigate({ kind: "settings" });
      case "help":
        return setHelp((v) => !v);
      case "input-scheme":
        return switchInputScheme();
      case "history":
        if (hasHistory) setHistory((v) => !v);
        return;
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

  /**
   * 改寫所有日記、頁面與 Desk 檔案 Markdown 文件（筆記、Word、簡報）裡的連結；rewrite 沒改就回傳原字串。
   * fileName：Desk 檔案目前的名稱（剛改名時舊鍵換成新鍵）。
   */
  const rewriteLinks = (rewrite: (src: string) => string, fileName: (k: string) => string = (k) => k) => {
    for (const docs of [journals, pages]) {
      for (const [k, c] of Object.entries(docs.contents)) {
        if (rewrite(c) !== c) docs.modify(k, rewrite);
      }
    }
    for (const [k, c] of Object.entries(files.contents)) {
      if (!c.includes("[[")) continue;
      changeFile(fileName(k), (f) => {
        let changed = false;
        const docs = f.docs.map((d) => {
          if (isDataKind(d.kind)) return d;
          const out = rewrite(d.content);
          if (out === d.content) return d;
          changed = true;
          return { ...d, content: out };
        });
        return changed ? { ...f, docs } : f;
      });
    }
  };
  // Dock 文件改了標題（Dock 清單、文件標題列、還原版本……）：連到它的 [[檔案/舊標題]] 跟著改
  const relinkDocs = useRef<(file: string, renames: { from: string; to: string }[]) => void>(() => {});
  relinkDocs.current = (file, renames) => rewriteLinks((src) => renameDocInLinks(src, file, renames));

  /**
   * Desk 檔案改名：搬檔案（App 裡連版本歷史一起搬）、改寫連到它文件的 [[舊名/文件]]、
   * 收藏與最近、上一頁／下一頁、Desk 上次的地方與畫面位置等個人狀態。回傳錯誤訊息（成功是 null）。
   */
  const renameFile = async (from: string, raw: string): Promise<string | null> => {
    const to = raw.replace(/[[\]\n\r]/g, "").trim().replace(/\s+/g, " ");
    if (!to || to === from) return null;
    if ([...(files.dates ?? [])].some((n) => n !== from && pageKey(n) === pageKey(to))) return `A file named “${to}” already exists.`;
    const titles = allDocs.filter((d) => d.file === from).map((d) => d.title);
    try {
      await files.rename(from, to);
    } catch (err) {
      return `Couldn't rename “${from}”: ${err instanceof Error ? err.message : String(err)}`;
    }
    // 只差大小寫時 App 裡是同一個資料夾，不用搬
    await logs.desk.move(from, to, !isTauri()).catch((err) => console.error("Couldn't move the version history", err));
    renameFileState(from, to);
    setFavorites((f) => renameFileTargets(f, from, to));
    setRecents((r) => renameFileTargets(r, from, to));
    const fix = (v: View): View => (v.kind === "file" && v.name === from ? { ...v, name: to } : v);
    mapViews(fix);
    const last = loadJson<View | null>(DESK_LAST_KEY, null, (v) => !!v && typeof v === "object");
    if (last?.kind === "file" && last.name === from) saveJson(DESK_LAST_KEY, fix(last));
    // 日記、頁面、Desk 檔案裡 Markdown 文件的 [[舊名/文件]] 改成新名稱（改過名的檔案自己的文件也可能連到自己）
    if (titles.length) rewriteLinks((src) => renameFileInLinks(src, from, to, titles), (k) => (k === from ? to : k));
    return null;
  };

  const title =
    day !== null
      ? `${weekday(day)}, ${dayTitle(day, now)}`
      : pageName !== null
        ? pageName
        : view.kind === "file"
          ? view.name
          : view.kind === "desk"
            ? "Desk"
            : view.kind === "drawer"
              ? "Drawer"
            : view.kind === "settings"
              ? "Settings"
              : "Calendar";
  const isSaved = !journals.saving && !pages.saving && !files.saving && !drawer.saving;
  const TitleIcon =
    view.kind === "desk" || view.kind === "file"
      ? DeskIcon
      : view.kind === "drawer"
        ? DrawerIcon
        : view.kind === "bujo" || day !== null
        ? CalendarIcon
        : view.kind === "settings"
          ? SettingsIcon
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
        settings={view.kind === "settings"}
        onSettings={() => navigate({ kind: "settings" })}
        onMain={(kind) => (kind === "desk" ? openDesk() : kind === "drawer" ? openDrawer() : navigate({ kind }))}
        onToday={() => openDay(now)}
        onOpen={openTarget}
        onDelete={askDelete}
        docInfo={docInfo}
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
            {view.kind === "file" ? (
              <FileTitle key={view.name} name={view.name} onRename={(to) => renameFile(view.name, to)} />
            ) : (
              <span className="doc-title">{title}</span>
            )}
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
            {view.kind === "file" && <DeskSwitch tab={view.tab} onTab={(tab) => navigate({ kind: "file", name: view.name, tab })} />}
            {view.kind === "drawer" && <DrawerSwitch tab={view.tab} onTab={(tab) => navigate({ kind: "drawer", tab })} />}
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
            {hasHistory && (
              <button
                className={`icon-btn${history ? " on" : ""}`}
                onClick={() => setHistory((v) => !v)}
                title="Version history (Alt+H)"
                aria-pressed={history}
              >
                <ClockIcon />
              </button>
            )}
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
          {history && hasHistory ? historyView() : (
          <main ref={pageRef} className={`page${view.kind === "bujo" ? " page-cal" : view.kind === "file" ? " page-board" : view.kind === "drawer" ? " page-drawer" : ""}`} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}>
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
            {view.kind === "bujo" && (
              <CalendarView journals={journals} now={now} desks={files} onOpenTasks={(name) => openFile(name, "tasks")} />
            )}
            {view.kind === "settings" && <SettingsView theme={theme} onTheme={setTheme} saving={!isSaved} />}
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
                templates={fileTemplates}
                onOpen={(n) => openFile(n)}
                onCreate={createFile}
                onDelete={(name) => {
                  const t: NavTarget = { kind: "file", name };
                  if (confirmDelete(t)) deleteDoc(t);
                }}
                onRename={renameFile}
              />
            )}
            {view.kind === "drawer" && (
              <DrawerView
                json={drawer.ready ? (libraryJson ?? "") : undefined}
                onModify={onModifyLibrary}
                sources={sources}
                now={now}
                onOpenNotes={openNotes}
                onOpenSource={(s) => (s.kind === "day" ? openDay(s.key) : navigate({ kind: "page", name: s.key }))}
                focus={drawerFocus}
                tab={view.tab}
                onTab={(tab) => navigate({ kind: "drawer", tab })}
              />
            )}
            {view.kind === "file" && (
              <FileView
                key={view.name}
                name={view.name}
                json={files.dates?.has(view.name) ? files.contents[view.name] : files.ready ? (files.contents[view.name] ?? "") : undefined}
                tab={view.tab}
                doc={dockId}
                onDoc={(id) => navigate({ kind: "file", name: view.name, tab: "dock", doc: id })}
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
                onDeleteRef={(r) =>
                  r.kind === "page" ? askDelete({ kind: "page", name: r.name }) : r.kind === "day" ? askDelete({ kind: "day", date: r.date }) : false
                }
                onOpenPage={openPageNamed}
                hasPage={hasPage}
              />
            )}
          </main>
          )}
        </div>
      </div>
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
      {imagePick && (
        <ImagePicker lib={library} tab={imagePick.opts.tab} multiple={imagePick.opts.multiple} onDone={(list) => (setImagePick(null), imagePick.done(list))} />
      )}
      {sheetPick && <SheetPicker books={sheetBooks} onDone={(md) => (setSheetPick(null), sheetPick.done(md))} />}
      <PredictBar />
      <InputModeBadge />
    </div>
  );
}

export default App;
