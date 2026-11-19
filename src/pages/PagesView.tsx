import { useEffect, type ReactNode } from "react";
import { Editor } from "../editor/Editor";
import type { Docs } from "../journal/useJournals";
import type { Source } from "./refIndex";
import { Backlinks } from "./Backlinks";
import { TemplateIcon } from "../editor/icons";
import { TemplateStart } from "./TemplateStart";
import { isTemplatePage, JOURNAL_TEMPLATE, templateLabel, templateNameFor } from "./templates";
import { openPage, pageKey } from "./pageRef";
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
  const isTemplate = isTemplatePage(name);
  /** 把這一頁複製成新的範本頁面（`Template/名稱`），然後打開它 */
  const saveAsTemplate = () => {
    if (!content?.trim()) return;
    const tpl = templateNameFor(name, pages.dates ?? []);
    pages.update(tpl, content);
    openPage(tpl);
  };
  return (
    <div className="page-view">
      <header className="page-head no-box">
        <h1 className="page-title">{name}</h1>
        {isTemplate && <span className="page-badge">Template</span>}
        {!exists && <span className="page-note">This page is empty — start typing to create it</span>}
        {exists && !isTemplate && content?.trim() && (
          <button className="page-action" title="Copy this page into a new template page" onClick={saveAsTemplate}>
            <TemplateIcon /> Save as template
          </button>
        )}
      </header>
      {isTemplate && (
        <p className="tpl-help no-box">
          {pageKey(name) === pageKey(JOURNAL_TEMPLATE)
            ? "This template fills in each new day's journal. "
            : `Type /${templateLabel(name)} in any page or journal to insert it. `}
          Placeholders: <code>{"{{date}}"}</code> <code>{"{{today}}"}</code> <code>{"{{weekday}}"}</code> <code>{"{{time}}"}</code>{" "}
          <code>{"{{title}}"}</code>
        </p>
      )}
      {!isTemplate && content !== undefined && !content.trim() && (
        <TemplateStart pages={pages} vars={{ title: name }} onPick={(md) => pages.update(name, md)} />
      )}
      {content === undefined ? (
        <div className="journal-loading">Loading…</div>
      ) : (
        <Editor
          key={name}
          compact
          title={name}
          value={content}
          onChange={(md) => pages.update(name, md)}
          placeholder={isTemplate ? "Write what this template should insert…" : "Click here to write this page…"}
        />
      )}
      {props.extra}
      <Backlinks name={name} self={{ kind: "page", key: name }} sources={props.sources} now={props.now} ready={props.ready} />
    </div>
  );
}
