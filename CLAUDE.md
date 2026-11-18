# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Banyan 是由 `create-tauri-app` 產生的 Tauri 2 桌面 App：Rust 後端＋ React 19／TypeScript 前端（Vite），在 Windows 上開發。目前主要功能是 Notion 風格的 Markdown 區塊編輯器、參考 Logseq 的日記與頁面連結、子彈筆記，以及參考 Notion 的資料庫；測試用 Vitest，沒有 lint 或 formatter。Git 預設分支是 `main`。已實作功能記在 `Design/Features.md`，每天的工作記在 `工作紀錄/` 的週檔。

## 指令

```bash
npm install
npm run tauri dev     # 完整 App：先跑 beforeDevCommand（npm run dev），再編譯並開啟 Rust 視窗
npm run dev           # 只有前端（Vite，port 1420）；沒有 Rust 後端，invoke 會失敗
npm run build         # tsc 型別檢查 + vite build → dist/
npm run tauri build   # 打包安裝程式（先跑 npm run build，前端取自 ../dist）
npm test              # Vitest：CommonMark 規格（652 例）＋編輯、版面、所見即所得測試
npx vitest run src/editor/ops.test.ts -t "Enter"   # 單一檔案／依名稱篩選
```

Claude 用 `.claude/launch.json` 的 Vite 預覽測試時會佔用 port 1420，使用者要跑 `npm run tauri dev` 前必須先停掉預覽。

Rust 在 `src-tauri/` 下執行 `cargo check`／`cargo test`。`npm run tauri dev` 開著時會鎖住並重編 `src-tauri/target/debug`，同時跑 cargo 要另用 target 資料夾：`CARGO_TARGET_DIR=target/claude-test cargo check`。

## 架構

- **前端 → 後端**：前端用 `@tauri-apps/api/core` 的 `invoke("指令名", { 參數 })` 呼叫 Rust。參數用 camelCase，Tauri 會轉成 Rust 端的 snake_case。
- **新增指令**：在 `src-tauri/src/lib.rs` 寫 `#[tauri::command]` 函式，並加進 `run()` 裡的 `tauri::generate_handler![...]`，否則前端呼叫會失敗。回傳給前端的 struct 要 `Serialize`（serde 已是相依套件）。
- **進入點**：`src-tauri/src/main.rs` 只呼叫 `banyan_lib::run()`；程式邏輯放在 lib crate（`banyan_lib`，名稱加 `_lib` 是為了避開 Windows 上 bin／lib 同名的問題）。`main.rs` 的 `windows_subsystem` 屬性讓 release 版不開主控台視窗，不要刪。
- **權限**：外掛功能（目前只有 `tauri-plugin-opener`）要在 `src-tauri/capabilities/default.json` 加權限，套用到 label 為 `main` 的視窗。
- **設定**：`src-tauri/tauri.conf.json` 管視窗、識別碼（`com.banyan`）、打包圖示（`src-tauri/icons/`）；CSP 目前關閉（`null`）。Vite 固定用 port 1420（`strictPort`），不要改成別的 port，除非同時改 `tauri.conf.json` 的 `devUrl`。
- **編輯器（`src/editor/`）**：文件本體永遠是 Markdown 字串，區塊只是視圖。`markdown.ts` 用 markdown-it（`commonmark` 預設）解析，把 token 切成區塊（`Unit`，記住行範圍 `[start, end)`；頂層清單每個項目一個區塊），並把各區塊 HTML 組回整份文件——測試要求它與規格逐字相同，改渲染規則後要跑 `npm test`。`ops.ts` 是純函式的編輯操作（以行為單位，只動必要的行，其他原始碼保持不變）；`Editor.tsx` 只負責事件與畫面。縮排與多欄存成單行 HTML 區塊標籤（`<div class="columns|column|indent">`，前後空行），`markdown.ts` 把它們組成樹（`ParsedDoc.tree`；`blocks` 是不含標籤的可見區塊，導覽用它）；`layout.ts` 的操作用 `LineBuf` 追蹤行號，改完一律呼叫 `normalize()` 清掉空容器與單欄。編輯是所見即所得：`RichBlock.tsx` 的 contenteditable 顯示渲染後的行內內容，`wysiwyg.ts` 負責區塊語法拆合、DOM→Markdown（含跳脫）與選取位置對照；編輯器只透過 `Surface` 介面讀寫文字與選取（位置一律是區塊原始碼中的位置），原始碼文字框（程式碼、複雜區塊）也實作同一介面。打字時不要重畫 contenteditable，否則游標與輸入法會亂。DOM 相關測試用 `// @vitest-environment jsdom`。不要改成「解析→文件模型→重新序列化」，那會改掉使用者的原始碼。
- **媒體檔案**：圖片、影片存在 App 資料夾的 `media/`（Rust 指令 `media_dir`、`save_media`、`import_media`），Markdown 寫相對路徑 `media/檔名`，`media.ts` 的 `resolveMedia` 顯示時換成 asset protocol 網址（需要 Cargo 的 `protocol-asset` 功能與 `tauri.conf.json` 的 `assetProtocol` 範圍）。影片與表格都存成 CommonMark 的 HTML 區塊（表格每列一行、不能有空行）。
- **日記（`src/journal/`）**：每天一份 Markdown，存在 App 資料夾的 `journals/YYYY_MM_DD.md`（Rust 指令 `journal_list`、`journal_read`、`journal_write`；瀏覽器預覽時用 localStorage）。前端日期一律用當地時間的 `YYYY-MM-DD` 字串。日記串一頁有好幾個 `Editor`：掛在 window／document 上的處理（復原、選取按鍵、剪貼簿、框選、檔案拖放）只交給「最後操作的編輯器」（`Editor.tsx` 的 `currentEditor`），DOM 查詢一律限定在編輯器自己的根元素，新增全域處理時要照這個規則。
- **頁面連結（`src/pages/`）**：`[[名稱]]` 不是 CommonMark 語法，渲染結果仍是文字；只在顯示時用 `linkPages()` 把文字換成 `<a class="page-ref">`（Editor 的 `clean()`、wysiwyg 的 `contentHtml()`），不要加 markdown-it 規則（會讓規格測試失敗）。所見即所得轉回 Markdown 時 `escapeWithRefs` 保留完整的 `[[…]]`。頁面存在 `pages/名稱.md`（`page_*` 指令，檔名 URL 編碼）。日記與頁面都用 `useDocs`（`src/journal/useJournals.ts`），啟動時全部讀進記憶體，反向連結（`refIndex.ts`）從記憶體計算。開啟頁面用 `openPage()` 發出視窗事件，由 App 切換畫面。檔名注意 Windows 不分大小寫：`refIndex.ts` 與 `Backlinks.tsx` 不能同名。
- **子彈筆記（`src/bujo/`）**：任務是清單項目加上大括號標記 `{ }`、`{x}`、`{<}`、`{-}`、`{o}`（沒有「已遷移」，使用者拿掉了）；方括號 `[ ]`／`[x]`（任何清單標記）是待辦清單的核取方塊（`LineTask.check`、`Unit.check`）（`tasks.ts`）。`parseDoc` 在清單項目的 `Unit.task` 記住狀態；wysiwyg 的 `decompose` 把標記當成區塊語法（`Shape.task`），畫面上用 `TaskGlyph` 顯示符號。排程把任務加到別天的日記：編輯器發出 `requestAppend()` 事件，由 App 用 `journals.modify()` 處理。排程不搬動任務：同一行標成 `{<}`、行尾寫上 `[[YYYY-MM-DD]]`（`scheduleAt`，`TaskItem.due`）；沒有手動附加日期的操作。只有一行的任務，行首時間與行尾日期在畫面上藏起來、改用 `WhenChip` 標籤（`Unit.when`、`Shape.when`，編輯時時間放在前綴、日期放在 `Shape.suffix`；`time.ts` 的 `lineWhen`／`stripWhenHtml`），點標籤由 Editor 的 `WhenMenu`／`setWhen` 改寫原始碼。清單項目的任務符號與核取方塊排在 flex 流裡（`.content li.task`），不要改回 `position: absolute`：Tauri（WebView2）裡編輯中的列往下移時，絕對定位的符號舊位置不會重畫，留下一串殘影（瀏覽器預覽看不到）。日記每天上方的「該做的事」是 `DayAgenda.tsx`（`agenda.ts` 從日記與頁面收集，依 contents 物件快取；JournalStream／JournalDay 要傳 `pages`）。總覽畫面是 `CalendarView.tsx`（行事曆，月／週／日檢視，App 內部的畫面代號仍是 `bujo`）；時間寫在內容開頭（`14:00-15:30`，`time.ts`），行事曆拖到別天就是排程（改日期），同一天只改時間。行事曆的拖曳用指標事件（`startDrag`、`data-drop`／`data-date` 標記放置目標），不要用 HTML5 drag／drop：Tauri 在 Windows 開著原生檔案拖放（編輯器用 `onDragDropEvent` 接檔案），網頁收不到 HTML5 拖曳事件。
- **資料庫（`src/database/`，參考 Notion 的 Database）**：側邊欄「Databases」的獨立畫面（App 的畫面 `databases` 是清單 `DatabasesView.tsx`、`database` 是一個資料庫），內容存在 `databases/名稱.json`（`database_*` 指令，`store.ts`，App 用 `useDocs` 讀進記憶體），名稱不分大小寫。`model.ts` 是純函式（第一欄永遠是標題 `TITLE`）；`DatabaseView.tsx` 改資料一律用 `onModify(fn)`（拿最新的資料庫改）。選單 portal 到 `body`（`.db-pop`、`RowMenu.tsx` 的 `.prop-menu`；`.popover button` 預設整列寬，資料庫選單裡的小按鈕要用 `.db-pop` 開頭的選擇器蓋掉）；拖曳用指標事件（不用 HTML5 drag／drop）。白板與長文寫作（Desk）已經拿掉，不要再引用 `src/board/`、`src/writing/`。
- **介面外殼（`src/shell/`）**：側邊欄、收藏／最近、主題、全域快捷鍵。App 的快捷鍵只用 Alt 組合鍵與 Ctrl＋\、Ctrl＋/，不要搶編輯器的 Ctrl 組合鍵。主題用 `<html data-theme>` 覆蓋系統設定：`editor.css`、`shell.css` 的深色變數要同時寫在 `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` 與 `:root[data-theme="dark"]`。
- **介面語言**：介面文字是英文，原始碼註解與文件是中文。日期顯示用 `journal.ts` 的 `dayTitle`（`Nov 18`）、`weekday`、`monthName`、`WEEKDAYS_MIN` 等，不要在元件裡自己組日期字串。
- **版本號**：同時記在 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`，改版時三處一起改。
