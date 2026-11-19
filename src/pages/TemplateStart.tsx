import { useMemo } from "react";
import { TemplateIcon } from "../editor/icons";
import type { Docs } from "../journal/useJournals";
import { collectTemplates, expandTemplate, type TemplateVars } from "./templates";

/**
 * 空白的頁面或日記上方：「Start from a template」＋每個範本一顆按鈕，點了用範本的內容開始。
 * 沒有範本時不顯示（範本是名稱 `Template/…` 的頁面）。
 */
export function TemplateStart(props: { pages: Docs; vars: TemplateVars; onPick: (markdown: string) => void }) {
  const list = useMemo(() => collectTemplates(props.pages.contents), [props.pages.contents]);
  if (!list.length) return null;
  return (
    <div className="tpl-start no-box">
      <span className="tpl-start-label">Start from a template</span>
      {list.map((t) => (
        <button key={t.page} className="tpl-chip" title={t.page} onClick={() => props.onPick(expandTemplate(t.content, props.vars) + "\n")}>
          <TemplateIcon />
          {t.label}
        </button>
      ))}
    </div>
  );
}
