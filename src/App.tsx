import { useEffect, useRef, useState } from "react";
import { Editor } from "./editor/Editor";
import { CloseIcon, CodeIcon, DocIcon } from "./editor/icons";
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
function countWords(md: string): number {
  const cjk = md.match(/[㐀-鿿豈-﫿぀-ヿ가-힯]/g)?.length ?? 0;
  const words = md.replace(/[㐀-鿿豈-﫿぀-ヿ가-힯]/g, " ").match(/[\p{L}\p{N}]+/gu);
  return cjk + (words?.length ?? 0);
}

function App() {
  const [markdown, setMarkdown] = useState(load);
  const [showSource, setShowSource] = useState(false);
  const [saved, setSaved] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  const lastSaved = useRef(markdown);

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

  const title = /^#\s+(.+?)\s*#*\s*$/m.exec(markdown)?.[1] ?? "未命名";

  return (
    <div className={`app${showSource ? " with-source" : ""}`}>
      <header className={`topbar${scrolled ? " scrolled" : ""}`}>
        <div className="crumbs">
          <span className="brand">Banyan</span>
          <span className="sep">/</span>
          <DocIcon className="doc-icon" />
          <span className="doc-title">{title}</span>
        </div>
        <div className="actions">
          <span className={`save-state${saved ? "" : " saving"}`}>{saved ? "已儲存" : "儲存中…"}</span>
          <span className="stat">{countWords(markdown).toLocaleString()} 字</span>
          <button
            className={`tool${showSource ? " on" : ""}`}
            onClick={() => setShowSource((v) => !v)}
            title="顯示／隱藏 Markdown 原始碼"
          >
            <CodeIcon />
            <span>原始碼</span>
          </button>
        </div>
      </header>
      <div className="workspace">
        <main className="page" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}>
          <Editor value={markdown} onChange={setMarkdown} />
        </main>
        {showSource && (
          <aside className="md-source-panel">
            <div className="panel-head">
              <span className="panel-title">Markdown 原始碼</span>
              <span className="panel-tag">CommonMark 0.31.2</span>
              <button className="icon-btn" onClick={() => setShowSource(false)} title="關閉">
                <CloseIcon />
              </button>
            </div>
            <textarea value={markdown} spellCheck={false} onChange={(e) => setMarkdown(e.target.value)} />
          </aside>
        )}
      </div>
    </div>
  );
}

export default App;
