import { useEffect, type ReactNode } from "react";
import { Editor } from "../editor/Editor";
import type { Docs } from "../journal/useJournals";
import type { Source } from "./refIndex";
import { Backlinks } from "./Backlinks";
import "./pages.css";

/** 單一頁面：標題、內容、反向連結。 */
export function PageView(props: {
  name: string;
  pages: Docs;
  sources: Source[];
  now: string;
  ready: boolean;
  /** 內容與反向連結之間的額外資訊 */
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
