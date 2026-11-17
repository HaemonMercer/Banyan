import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Editor } from "../editor/Editor";
import { isDateKey } from "../journal/journal";
import type { Docs } from "../journal/useJournals";
import { allPages, type Source } from "./refIndex";
import { Backlinks } from "./Backlinks";
import { cleanName, openPage, pageKey } from "./pageRef";
import "./pages.css";

/** 單一頁面：標題、內容、反向連結。 */
export function PageView(props: {
  name: string;
  pages: Docs;
  sources: Source[];
  now: string;
  ready: boolean;
  /** 內容與反向連結之間的額外資訊（放在哪些白板上） */
  extra?: ReactNode;
}) {
  const { name, pages } = props;
  const { load } = pages;
  const exists = !!pages.dates?.has(name);
  useEffect(() => {
    if (exists) load(name);
  }, [exists, name, load]);
  const content = pages.contents[name] ?? (exists ? undefined : "");
  return (
    <div className="page-view">
      <header className="page-head no-box">
        <h1 className="page-title">{name}</h1>
        {!exists && <span className="page-note">This page is empty — start typing to create it</span>}
      </header>
      {content === undefined ? (
        <div className="journal-loading">Loading…</div>
      ) : (
        <Editor key={name} compact value={content} onChange={(md) => pages.update(name, md)} placeholder="Click here to write this page…" />
      )}
      {props.extra}
      <Backlinks name={name} self={{ kind: "page", key: name }} sources={props.sources} now={props.now} ready={props.ready} />
    </div>
  );
}

/** 所有頁面（有內容的，加上被提到但還沒寫的）；上方的輸入框可以搜尋或新增。 */
export function AllPages(props: { pages: Docs; sources: Source[]; ready: boolean }) {
  const [query, setQuery] = useState("");
  const list = useMemo(
    () => allPages(props.pages.dates ?? [], props.sources, isDateKey),
    [props.pages.dates, props.sources],
  );
  const q = pageKey(query);
  const shown = q ? list.filter((p) => pageKey(p.name).includes(q)) : list;
  const name = cleanName(query);
  const exact = list.some((p) => pageKey(p.name) === q);

  return (
    <div className="all-pages">
      <header className="page-head no-box">
        <h1 className="page-title">All pages</h1>
        <span className="page-note">{props.ready ? `${list.length} pages` : "Loading…"}</span>
      </header>
      <form
        className="page-search no-box"
        onSubmit={(e) => {
          e.preventDefault();
          // 已經有同名（不分大小寫）的頁面就開那一頁，否則新增
          if (name) openPage(name);
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search pages, or type a new page name and press Enter"
          spellCheck={false}
        />
      </form>
      <div className="page-list no-box">
        {name && !exact && (
          <button className="page-row create" onClick={() => openPage(name)}>
            <span className="pr-name">+ Create page “{name}”</span>
          </button>
        )}
        {shown.map((p) => (
          <button key={p.name} className="page-row" onClick={() => openPage(p.name)}>
            <span className="pr-name">{p.name}</span>
            {!p.exists && <span className="pr-tag">empty</span>}
            <span className="pr-refs">{p.refs ? `${p.refs} links` : ""}</span>
          </button>
        ))}
        {props.ready && !list.length && !name && (
          <p className="backlinks-empty">
            No pages yet. Type <code>[[</code> plus a name in a journal to create a link, then click it to open the page.
          </p>
        )}
      </div>
    </div>
  );
}
