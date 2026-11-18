import { useMemo, useRef, useState } from "react";
import { PlusIcon, TrashIcon } from "../editor/icons";
import { mediaUrl } from "../editor/media";
import { isDateKey } from "../journal/journal";
import type { Docs } from "../journal/useJournals";
import { LibrarySearch } from "../shell/Library";
import { preview } from "./excerpt";
import { cleanName, openPage, pageKey } from "./pageRef";
import { allPages, type PageInfo, type Source } from "./refIndex";
import "./pages.css";

/**
 * 所有頁面（使用者畫的草圖：上方一條搜尋框，下面一排四張的頁面卡片）：有內容的，加上被提到但還沒寫的。
 * 卡片顯示標題、文字摘要與第一張圖片（像 Heptabase 的卡片庫）。搜尋框篩選，Enter 開啟或新增。
 */
export function AllPages(props: { pages: Docs; sources: Source[]; ready: boolean; onDelete: (name: string) => void }) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const list = useMemo(
    () => allPages(props.pages.dates ?? [], props.sources, isDateKey),
    [props.pages.dates, props.sources],
  );
  const q = pageKey(query);
  const shown = useMemo(() => {
    const hit = q ? list.filter((p) => pageKey(p.name).includes(q)) : [...list];
    // 名稱完全相同的排最前面
    if (q) hit.sort((a, b) => Number(pageKey(b.name) === q) - Number(pageKey(a.name) === q));
    return hit;
  }, [list, q]);
  const name = cleanName(query);
  const exact = list.find((p) => pageKey(p.name) === q);
  const contents = props.pages.contents;

  const del = (p: PageInfo) =>
    p.exists && (
      <button
        className="lib-del"
        title="Delete page"
        onClick={(e) => {
          e.stopPropagation();
          props.onDelete(p.name);
        }}
      >
        <TrashIcon />
      </button>
    );

  return (
    <div className="library card-library">
      <LibrarySearch
        ref={searchRef}
        value={query}
        onChange={setQuery}
        // 已經有同名（不分大小寫）的頁面就開那一頁，否則新增
        onSubmit={() => name && openPage(exact?.name ?? name)}
        placeholder="Search pages, or type a new page name"
        hint={name ? (exact ? "to open" : "to create") : undefined}
      />

      {props.ready && !list.length && !name ? (
        <div className="lib-empty no-box">
          <strong>No pages yet</strong>
          Type a name above and press <kbd>Enter</kbd>, or type <code>[[</code> plus a name in a journal and click the
          link.
        </div>
      ) : (
        <div className="cl-grid no-box">
          {name && !exact && (
            <button className="lib-card create" onClick={() => openPage(name)} title={`Create “${name}”`}>
              <span className="lcc-plus">
                <PlusIcon />
              </span>
              <span className="lcc-name">Create “{name}”</span>
            </button>
          )}
          {shown.map((p) => {
            const parts = p.exists ? preview(contents[p.name] ?? "", p.name) : [];
            return (
              <div
                key={p.name}
                className={`lib-card cl-card${p.exists ? "" : " ghost"}`}
                role="button"
                tabIndex={0}
                onClick={() => openPage(p.name)}
                onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && openPage(p.name)}
              >
                <div className="lc-title">{p.name}</div>
                <div className="cl-body">
                  {parts.length ? (
                    parts.map((part, i) =>
                      part.kind === "text" ? (
                        <p key={i}>{part.text}</p>
                      ) : (
                        <img key={i} src={mediaUrl(part.src)} alt="" loading="lazy" draggable={false} />
                      ),
                    )
                  ) : (
                    <p className="muted">{p.exists ? "Empty page" : "Not written yet"}</p>
                  )}
                </div>
                {del(p)}
              </div>
            );
          })}
          {!shown.length && !name && <div className="cl-none">No matching pages</div>}
        </div>
      )}
    </div>
  );
}
