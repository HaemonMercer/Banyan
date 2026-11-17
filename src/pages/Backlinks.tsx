import { TaskGlyph } from "../bujo/TaskGlyph";
import { unitDisplayHtml } from "../editor/Editor";
import { dayTitle, weekday } from "../journal/journal";
import { findBacklinks, type Source } from "./refIndex";
import { openPage } from "./pageRef";

/**
 * 頁面（或某天日記）最下面的「反向連結」：哪些日記、頁面提到這裡，以及提到的那幾個區塊。
 * 點區塊裡的頁面連結開啟那一頁；點來源標題開啟來源。
 */
export function Backlinks(props: {
  name: string;
  self: { kind: "day" | "page"; key: string };
  sources: Source[];
  now: string;
  ready: boolean;
}) {
  const mentions = props.ready ? findBacklinks(props.name, props.sources, props.self) : [];
  const count = mentions.reduce((n, m) => n + m.blocks.length, 0);
  return (
    <section className="backlinks no-box">
      <h2 className="backlinks-head">
        <span className="bl-icon">↩</span>
        {props.ready ? (count ? `${count} linked reference${count > 1 ? "s" : ""}` : "No linked references yet") : "Loading linked references…"}
      </h2>
      {props.ready && !count && (
        <p className="backlinks-empty">
          Type <code>[[{props.name}]]</code> in any journal or page to link here.
        </p>
      )}
      {mentions.map((m) => (
        <div key={m.source.kind + m.source.key} className="bl-source">
          <button className="bl-title" onClick={() => openPage(m.source.key)}>
            {m.source.kind === "day"
              ? `${weekday(m.source.key)}, ${dayTitle(m.source.key, props.now)}`
              : m.source.key}
          </button>
          <div className="bl-blocks">
            {m.blocks.map((u) => (
              <div
                key={u.start}
                className="bl-block content"
                onClick={(e) => {
                  const a = (e.target as HTMLElement).closest("a");
                  if (a?.classList.contains("page-ref")) {
                    e.preventDefault();
                    openPage(a.getAttribute("data-page") ?? "");
                  } else if (!a) openPage(m.source.key);
                  else e.preventDefault();
                }}
              >
                {u.kind === "item" ? (
                  <ul>
                    <li className={u.task ? `task t-${u.task}` : undefined}>
                      {u.task && <TaskGlyph state={u.task} />}
                      <div dangerouslySetInnerHTML={{ __html: unitDisplayHtml(u) }} />
                    </li>
                  </ul>
                ) : (
                  <div dangerouslySetInnerHTML={{ __html: unitDisplayHtml(u) }} />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
