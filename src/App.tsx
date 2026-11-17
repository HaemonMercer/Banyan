import { useEffect, useMemo, useRef, useState } from "react";
import { Editor } from "./editor/Editor";
import { CalendarIcon, CloseIcon, CodeIcon, DocIcon } from "./editor/icons";
import { CalendarButton, JournalDay, JournalStream } from "./journal/Journals";
import { dayTitle, defaultStore, isDateKey, today, weekday } from "./journal/journal";
import { useJournals } from "./journal/useJournals";
import "./App.css";

const STORAGE_KEY = "banyan.document";

const WELCOME = `# 歡迎使用 Banyan

這是一個 **Notion 風格**的區塊編輯器，文件本身就是一份標準的 CommonMark Markdown。

點一下任何區塊就能編輯它的原始碼；離開後會依 CommonMark 規格重新渲染。

## 怎麼用

- 在空白區塊輸入 \`/\` 開啟區塊選單
- 也可以直接打 Markdown：\`# \` 變標題、\`- \` 變清單、\`> \` 變引用
- 滑到區塊左邊，用 ⋮⋮ 拖曳搬移，或點它刪除、複製、轉換類型
- \`Enter\` 新增區塊，\`Shift+Enter\` 換行，\`Ctrl+Z\` 復原
- 按住 \`Ctrl\` 點連結可以用瀏覽器開啟
- \`Tab\` 增加縮排、\`Shift+Tab\` 減少縮排

<div class="indent">

縮排的段落。編輯時按 \`Shift+Tab\` 可以移出來。

</div>

<div class="columns">

<div class="column">

### 多欄

把區塊拖到另一個區塊的**右邊或左邊**，就會分成多欄。

</div>

<div class="column">

### 調整

拖曳欄位之間的空隙調整欄寬；把欄裡的區塊全拖出去，那一欄就會消失。

</div>

</div>

> CommonMark 的 652 個規格範例全部通過。

\`\`\`ts
const answer = 42;
\`\`\`

---

參考連結也可以：[CommonMark][spec]。

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

type View = { kind: "journals" } | { kind: "day"; date: string } | { kind: "doc" };

const VIEW_KEY = "banyan.view";

function loadView(): View {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null");
    if (v?.kind === "doc" || v?.kind === "journals") return { kind: v.kind };
    if (v?.kind === "day" && typeof v.date === "string" && isDateKey(v.date)) return v;
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

function App() {
  const [markdown, setMarkdown] = useState(load);
  const [view, setView] = useState<View>(loadView);
  const [showSource, setShowSource] = useState(false);
  const [saved, setSaved] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  const lastSaved = useRef(markdown);
  const store = useMemo(defaultStore, []);
  const journals = useJournals(store);
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
  }, [view]);

  const openDay = (date: string) => setView({ kind: "day", date });

  // 目前畫面的 Markdown（原始碼面板、字數用）；日記串有好幾天，不提供原始碼面板
  const day = view.kind === "day" ? view.date : null;
  const current = view.kind === "doc" ? markdown : day !== null ? journals.contents[day] ?? "" : null;
  const setCurrent = (md: string) => (day !== null ? journals.update(day, md) : setMarkdown(md));
  const sourceOpen = showSource && current !== null;

  const docTitle = /^#\s+(.+?)\s*#*\s*$/m.exec(markdown)?.[1] ?? "未命名";
  const title =
    view.kind === "doc" ? docTitle : day !== null ? `${dayTitle(day, now)} ${weekday(day)}` : "所有日記";
  const isSaved = view.kind === "doc" ? saved : !journals.saving;

  return (
    <div className={`app${sourceOpen ? " with-source" : ""}`}>
      <header className={`topbar${scrolled ? " scrolled" : ""}`}>
        <div className="crumbs">
          <span className="brand">Banyan</span>
          <nav className="view-tabs">
            <button className={view.kind !== "doc" ? "on" : ""} onClick={() => setView({ kind: "journals" })}>
              日記
            </button>
            <button className={view.kind === "doc" ? "on" : ""} onClick={() => setView({ kind: "doc" })}>
              文件
            </button>
          </nav>
          <span className="sep">/</span>
          {view.kind === "doc" ? <DocIcon className="doc-icon" /> : <CalendarIcon className="doc-icon" />}
          <span className="doc-title">{title}</span>
        </div>
        <div className="actions">
          <span className={`save-state${isSaved ? "" : " saving"}`}>{isSaved ? "已儲存" : "儲存中…"}</span>
          {current !== null && <span className="stat">{countWords(current).toLocaleString()} 字</span>}
          {view.kind !== "doc" && (
            <>
              <button
                className={`tool${day === now ? " on" : ""}`}
                onClick={() => openDay(now)}
                title="開啟今天的日記"
              >
                今天
              </button>
              <CalendarButton dates={journals.dates} now={now} selected={day} onPick={openDay} />
            </>
          )}
          {current !== null && (
            <button
              className={`tool${showSource ? " on" : ""}`}
              onClick={() => setShowSource((v) => !v)}
              title="顯示／隱藏 Markdown 原始碼"
            >
              <CodeIcon />
              <span>原始碼</span>
            </button>
          )}
        </div>
      </header>
      <div className="workspace">
        <main ref={pageRef} className="page" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}>
          {view.kind === "doc" && <Editor value={markdown} onChange={setMarkdown} />}
          {view.kind === "journals" && <JournalStream journals={journals} now={now} onOpenDay={openDay} />}
          {view.kind === "day" && <JournalDay journals={journals} date={view.date} now={now} onOpenDay={openDay} />}
        </main>
        {sourceOpen && (
          <aside className="md-source-panel">
            <div className="panel-head">
              <span className="panel-title">Markdown 原始碼</span>
              <span className="panel-tag">CommonMark 0.31.2</span>
              <button className="icon-btn" onClick={() => setShowSource(false)} title="關閉">
                <CloseIcon />
              </button>
            </div>
            <textarea value={current} spellCheck={false} onChange={(e) => setCurrent(e.target.value)} />
          </aside>
        )}
      </div>
    </div>
  );
}

export default App;
