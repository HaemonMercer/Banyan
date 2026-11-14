# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Banyan Note 是 Tauri 2 桌面 App（Rust 後端＋ React/TypeScript 前端＋ SQLite），在 Windows 上開發。介面文字與所有文件用繁體中文；程式碼註解用英文。

## 指令

```bash
npm install
npm run tauri dev        # 完整 App（會自動啟動 Vite，port 1420）
npm run dev              # 只有前端（沒有 Rust 後端，invoke 會失敗）
npm run build            # tsc 型別檢查 + vite build → dist/
npm test                 # 前端測試（node --test 跑 src/**/*.test.ts：Markdown 引擎含 CommonMark 規格 652 例、編輯器、Desk）
node --test src/desk/tests/paper.test.ts              # 一個測試檔
node --test --test-name-pattern "<名稱>" "src/**/*.test.ts"   # 單一測試
```

前端測試由 node 直接執行 TypeScript，需要 Node.js 24。

Rust（在 `src-tauri/` 下執行）：

```bash
cargo test                          # 全部
cargo test --test drawer            # 一個測試檔（tests/ 下每個模組一個：drawer、whiteboard、annotations、citations、item_graph、desk、upgrade）
cargo test --test drawer <函式名>    # 單一測試
```

- 沒有設定 lint／formatter；縮排用四個空白，其餘跟著鄰近檔案的寫法。
- `.claude/launch.json` 有 `vite`（port 1420）與 `vite-alt`（port 1430）兩個只有前端的預覽設定。
- 改了 `src/icons/icons.ts` 後執行 `node scripts/build-icons.ts`，重新產生 `Design/Icons.html`、`src-tauri/icons/app-icon.svg`、`public/banyan.svg`。
- 發佈：用簽章金鑰 `npm run tauri build`，再執行 `node scripts/make-latest-json.mjs OWNER/REPO` 產生 updater 的 `latest.json`（步驟寫在腳本開頭）。版本號要同時改 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`。`src-tauri/installer-hooks.nsh`（NSIS hook，由 `tauri.conf.json` 引用）讓更新時的安裝程式等 Banyan 的執行檔釋放後再覆寫。
- Commit 標題用簡短的繁體中文；發版的 commit 用 `v0.1.3：…` 的格式。

## 架構

### 後端（`src-tauri/src/`）
- **單一狀態**：`drawer::DrawerState` 持有 `Mutex<Library>`，所有模組（`drawer`、`whiteboard`、`annotations`、`citations`、`item_graph`、`desk`、`history`、`card_files`、`library`）的指令都透過它存取同一個 SQLite 連線。共用的錯誤型別是 `drawer::Error(String)`／`drawer::Result`，訊息會直接顯示給使用者，所以用中文寫。
- **新增指令**：寫 `#[tauri::command]` 之後，一定要加進 `lib.rs` 的 `generate_handler!`。回傳給前端的 struct 用 `#[serde(rename_all = "camelCase")]`；前端用 camelCase 參數名呼叫（Tauri 會轉成 snake_case）。
- **資料庫位置**（`library.rs`）：一個資料庫是一個資料夾，裡面有 `banyan.db` 和 `storage/`（附件；白板檔案放在 `storage/cards/<card id>/`）。目前用哪個資料夾記在 app config 目錄的 `config.json`，可以在設定頁更換。
- **Schema 遷移**（`db.rs`）：`SCHEMA_VERSION` 存在 `PRAGMA user_version`。開啟時：完整性檢查 → 備份到 `backups/`（保留 5 份）→ 在**同一個交易**中跑 `migrate_steps`，失敗全部還原；版本比 App 新的資料庫會拒絕開啟。要改 schema：把 `SCHEMA_VERSION` 加一，在 `migrate_steps` 加一段 `if version < N`（步驟中不可自己 BEGIN/COMMIT），並在 `tests/upgrade.rs` 補測試。
- **`attachment:` 協定**（`file_protocol.rs`）：閱讀器依附件 id 串流讀取檔案（支援 Range），只能讀到資料庫裡的附件。
- **測試**：`tests/*.rs` 用 `tauri::test::mock_builder()` 加上暫存資料夾裡的 `Library`，像前端一樣傳 JSON 呼叫指令。

### 前端（`src/`）
- `App.tsx`：左側模組列（Drawer、Whiteboard、Annotator、Desk、設定）＋分頁（`tabs.ts`；PDF 與電子書開在各自的分頁）。狀態用 `localStorage` 的 `banyan.*` key 記住。
- 每個模組有一個 `api.ts`（`src/drawer/`、`src/whiteboard/`、`src/annotator/`、`src/desk/`），把 `invoke` 包成有型別的函式；元件放在 `src/components/<模組>/`。
- **Markdown 引擎**（`src/markdown/`，自己寫，不用 remark）：語法規格是 `Design/Markdown Language.md`（BFM）。`blocks.ts`（區塊）→ `inlines.ts`（行內）→ `ast.ts` 的語法樹，每個節點有原文位置；`index.ts` 的 `parse()` 是唯一的解析入口（有快取），另有 `summarize`、`plainText`、`extractLinks`。顯示用 `Markdown.tsx`（React；原始 HTML 只顯示成文字），`html.ts` 輸出參考格式的 HTML 給測試用。`[[ ]]` 點擊由 `links.tsx` 的 `WikiLinkProvider` 決定。測試在 `src/markdown/tests/`，用 node 直接跑 TypeScript，所以引擎內 import 要寫 `.ts` 副檔名、不能用 enum。`entities.ts` 由 `node scripts/build-entities.mjs` 產生。
- **編輯器**（ProseMirror）：`editorCore.ts`（schema、`load` 原文 → 文件、`save` 文件 → 原文；沒有 DOM，可在 node 測試）、`editorCommands.ts`（輸入規則、按鍵）、`MarkdownEditor.tsx`（元件、node view、`[[` 建議）。存檔原則：沒改的頂層區塊用原文的切片寫回（以節點身分或 `eq` 比對），只產生改過的區塊；沒有專屬節點的語法存成 `md_block`／`md_inline` 保留原文。改 `save` 時跑 `npm test` 的往返測試（`tests/editor.test.ts`）。
- **引用文獻**：條目與註解的 BibTeX 式引用鍵在 `src-tauri/src/citations.rs`（產生規則、`resolve_cite_keys`、`search_citables`、`set_cite_key` 改鍵時改寫卡片、`import_items`、存檔對話框）；前端 `cite.ts`（APA 格式，純函式）、`bibtex.ts`（.bib 讀寫，純函式）、`citeStore.ts`（向後端批次查詢並快取，`useCiteData`；條目改了要 `invalidateCites()`）、`Citations.tsx`（引用、`[[@鍵]]`、嵌入、參考文獻清單、文件內書目的顯示）。打開條目用 `banyan:open-item` 事件。
- **卡片內容**：顯示用 `<Markdown source=…>`，編輯用 `<MarkdownEditor>`；點擊位置用 `sourceOffsetAt` 換算回原文、`positionForOffset` 換成編輯器位置。存檔後呼叫 `whiteboardApi.syncWikiLinks` 依 `[[ ]]` 建立卡片連結（後端 `sync_wiki_links`，失敗只記錄）。卡片連結與引用也可用拖曳建立。
- **Desk**（Markdown 文件與簡報）：一份檔案是 `desk_documents` 的一列（資料庫 v22），整份內容就是一段 Markdown 原文，只有原始碼編輯（CodeMirror，`DeskCodeEditor.tsx`）和預覽／放映，不用 ProseMirror 編輯器。版面與樣式寫在文件開頭的 YAML front matter（`paper.ts` 的 `readPage`／`writePage`，用 `yaml` 套件）；`::cols`、`::box`、`::push()` 等排版指令由 `src/desk/markdown.ts` 的 `parseDesk` 疊在 `parse()` 之上解析（行內 `::style(){}` 在 `inlines.ts`，只在 `deskDecorations` 開啟時）。樣式組（YAML `Style:`）在 `src/desk/styles.ts`：`readStyles` 讀設定，`applyStyleScopes` 把 `::push`／`::pop` 變成巢狀節點並為每個範圍產生一段 CSS（內層較晚輸出所以優先），`scanStyles` 給編輯器警告與補全；語法寫在 `Design/Markdown Language.md` 的「Desk 已實作語法」。匯出都從預覽的 DOM 產生：`print.ts`（PDF，CSS `@page`）、`word.ts`（組出 Word XML，後端 `export_desk_word` 壓成 .docx）。`paper.ts`、`markdown.ts`、`sourceTools.ts` 不碰 DOM，在 `src/desk/tests/` 測試，同樣要寫 `.ts` 副檔名。改引用鍵時 `citations.rs` 也會改寫 Desk 文件。
- 電子書解析器（`src/drawer/books/`：EPUB、MOBI/AZW、FB2、TXT、ZIP）自己寫，不用外部套件。PDF 用 pdf.js；`vite.config.ts` 的 `pdfjsAssets` 外掛提供 `/pdfjs/` 下的 wasm、CMap、字型。

### UI 規範（完整內容見 `Design/UI Style.md`）
- 顏色、字級、間距、圓角、陰影只用 `src/styles/tokens.css` 的變數；共用元件放 `src/styles/components.css`。
- 要使用者確認時用 `await ask({…})`，不要用 `window.confirm`；訊息用 `useToast()`（`src/components/Feedback.tsx`）。
- 圖示用 `<Icon name="…" />`／`<TypeIcon />`，不用 emoji（`<option>` 和純文字除外）。
- 淺色、深色主題都要能用。

## 文件與工作紀錄

- `Design/Design Document.md`：規劃（模組、技術路線、MVP）。`Design/Features.md`：**已實作**的功能、模組狀態、已知限制，以及最後的「更新紀錄」表（schema 有變時寫上「資料庫 vN」）。
- 每次工作後都要檢查、更新 `Design/Features.md`，並把當天做的事寫進 `工作紀錄/` 的本週檔案（ISO 週，檔名如 `2026-W46（11-09 ~ 11-15）.md`，本地時間 UTC+8；新的一週新建檔案）。
- `.claude/hooks/check-docs.mjs`（Stop hook）：程式碼比本週工作紀錄新時，會擋下一次結束。

<!-- imported-from: codex:project:instructions -->
# Repository Guidelines

## Project Structure

Banyan Note is a Windows-developed Tauri 2 desktop app with a React/TypeScript frontend and a Rust/SQLite backend. The app shell lives in `src/App.tsx`, feature views in `src/components/`, and typed Tauri calls in each feature's `api.ts`. The Markdown parser and editor live in `src/markdown/`. Native commands and database code live in `src-tauri/src/`. Static assets live in `public/`, desktop icons in `src-tauri/icons/`, and design references in `Design/`.

## Build, Test, and Development

- `npm ci` installs dependencies from the lockfile. Use Node.js 24 for the TypeScript test runner.
- `npm run tauri dev` launches the desktop app with Vite on port 1420. Use `npm run dev` for browser-only UI work. Tauri commands require the desktop runtime.
- `npm run build` type-checks TypeScript and bundles the frontend into `dist/`. Use `npm run tauri build` to package the desktop app.
- `npm test` runs the frontend tests. `cargo test --manifest-path src-tauri/Cargo.toml` runs the Rust tests from the repository root.

## Coding Style

Use four-space indentation, PascalCase for React components, camelCase for TypeScript functions, and snake_case for Rust functions and modules. Follow neighboring files for formatting. The project has no configured linter or frontend formatter. Use shared CSS tokens from `src/styles/tokens.css`. Write user-facing text and error messages in Traditional Chinese and code identifiers in English. Register new Tauri commands in `src-tauri/src/lib.rs` and expose camelCase fields to the frontend.

## Testing Guidelines

Name frontend tests `*.test.ts` and place them in feature-level `tests/` directories. Use `node:test` and explicit `.ts` extensions for local test imports. Keep Rust integration tests in `src-tauri/tests/`, using Tauri's mock runtime and temporary libraries for command tests. Add migration regression cases to `src-tauri/tests/upgrade.rs`. No numeric coverage threshold is configured.

## Commits and Pull Requests

Use short Traditional Chinese commit subjects. Follow the existing `v0.1.3：…` pattern for versioned changes. In pull requests, summarize behavior changes, report verification, link relevant issues, and include screenshots for visible UI changes. Update `Design/Features.md` when implemented behavior changes and record completed work in the current weekly log under `工作紀錄/`.
