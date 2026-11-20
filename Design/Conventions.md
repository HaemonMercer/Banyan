# Banyan 開發規範

> 寫程式、改功能、提交前要遵守的規則。各模組的架構細節（檔案、函式、資料格式）在 [CLAUDE.md](../CLAUDE.md)；已實作的功能在 [Features.md](Features.md)。本文件只寫「怎麼做」，不重複模組說明。
> 規則改了就更新這份文件。

## 1. 基本原則

1. **不改使用者的原始碼。** 文件本體（Markdown、JSON）是使用者的資料，編輯只動必要的行或欄位，其他內容逐字保留。不要做「解析 → 模型 → 重新序列化」。
2. **邏輯寫成純函式，畫面只管事件。** 每個模組的資料操作放在沒有 React、沒有 DOM 的檔案（`model.ts`、`ops.ts`、`board.ts`、`draw.ts`…），並有對應的 `*.test.ts`。元件（`*.tsx`）只負責事件、狀態與畫面。
3. **參考成熟的軟體，但用 Banyan 的外觀。** 功能參考 Notion、Logseq、Zotero、XMind、draw.io、Figma；畫布類（白板、心智圖、Draw）沿用白板的介面；Dock 的 Word／簡報／Excel 參考 Apple Pages／Keynote／Numbers（`DocChrome.tsx`）。
4. **先找現成的再寫新的。** 對齊（`src/align/`）、範本選擇器（`TemplateGallery.tsx`）、工具列與檢閱器（`DocChrome.tsx`）、日期格式（`journal.ts`）、連結改寫（`rewriteLinks`）都已經有共用的做法。
5. **擴充語法只在顯示時處理。** `[[頁面]]`、`![[嵌入]]`、程式碼上色都不加進 markdown-it 規則，CommonMark 規格測試（652 例）必須保持逐字通過。

## 2. 檔案與命名

| 項目 | 規則 | 例子 |
|---|---|---|
| 模組資料夾 | `src/<模組>/`，一個功能一個資料夾 | `src/desk/`、`src/drawer/` |
| 元件 | PascalCase `.tsx`，一個檔案一個主要元件 | `DeskHome.tsx` |
| 純函式 | camelCase `.ts` | `home.ts`、`slideAnim.ts` |
| 測試 | 和被測檔案同名、放同一資料夾 | `home.test.ts` |
| 樣式 | 每個模組一份 CSS，在元件裡 import | `desk.css`、`board.css` |
| 存檔 | `store.ts` 包裝 Rust 指令與瀏覽器預覽的 localStorage | `src/desk/store.ts` |
| CSS class | 模組前綴＋kebab-case | `desk-switch`、`sv-pop`、`mm-bar` |

- **Windows 不分大小寫**：同一資料夾裡不能有只差大小寫的檔名（例如 `refIndex.ts` 與 `RefIndex.tsx`）。
- 新的資料種類或子資料夾要同時加進 Rust 的 `DATA_SUBDIRS`，並用 `data_root()` 取得位置。

## 3. TypeScript 與 React

- `tsconfig` 是 `strict`，加上 `noUnusedLocals`、`noUnusedParameters`；`npm run build` 必須沒有錯誤。不要用 `any` 和 `// @ts-ignore` 解決型別問題。
- 格式沿用現有程式碼（沒有 formatter）：兩格縮排、雙引號、分號、尾逗號；一行可以長一點，但不要超過能一眼讀完的長度。
- 型別只 import 型別時用 `import type` 或 `{ type X }`。
- 元件用函式元件與 hooks，不用 class。
- 資料一律不可變更新（回傳新物件），讓 `useDocs` 的比對、復原歷史與版本歷史能正常運作。
- 改資料走模組規定的入口，不要自己 `setState` 整份資料：試算表 `modify(fn)`、簡報 `commit`／`editMeta`、文獻庫 `onModify(fn)`、檔案改名 `renameFile`。
- 打字中不要重畫 contenteditable 或搶走輸入框的焦點（游標與輸入法會亂）。
- 動態載入大型套件（`docx`、`pptxgenjs`），不要放進主程式包。

### 註解

- 註解用中文，寫「為什麼」與「規則」，不寫程式碼字面上已經看得出的事。
- 匯出的函式、介面與重要欄位寫 `/** … */` 一句話說明。
- 長檔案用區段標題分段：`// ─── 儲存位置 ───`、CSS 用 `/* ─── Desk：首頁 ─── */`。
- 為了繞過 Tauri／WebView2 的問題寫的程式，註解要寫出原因（例如拖曳改用指標事件），避免之後被「簡化」回去。

## 4. 介面

- **介面文字是英文**，原始碼註解與文件是中文。
- 日期顯示一律用 `journal.ts` 的 `dayTitle`、`weekday`、`monthName`、`WEEKDAYS_MIN`；內部日期是當地時間的 `YYYY-MM-DD` 字串。
- **顏色用 CSS 變數**，不要寫死色碼。強調色是 `--ed-accent`（綠色），選取用 `--ed-select`／`--ed-select-box`，品牌色 `--brand`。
- **深色模式**：新的深色變數要同時寫在
  `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }` 與 `:root[data-theme="dark"] { … }`。
- 存檔的顏色存色盤名稱（例如 `Paint`、`red`），畫面才換成變數；匯出檔案時才換成固定值。
- 快捷鍵：App 層級只用 Alt 組合鍵與 Ctrl＋\、Ctrl＋/，不要搶編輯器的 Ctrl 組合鍵；新增快捷鍵要加進快捷鍵一覽。
- 在編輯器外面操作編輯器的元素（工具列、檢閱器、選單）要加 `editor-ui` class，並在 mousedown 時 `preventDefault`。
- 浮動元件（選單、右鍵選單）portal 到 `body`，才不會在縮放的畫布或捲動容器裡跑位、被裁切。

## 5. 互動與事件

- **拖曳一律用指標事件**（pointerdown／move／up，放置目標用 `data-drop`），不要用 HTML5 drag／drop：Tauri 在 Windows 開著原生檔案拖放，網頁收不到 HTML5 拖曳事件。從檔案總管拖檔案進來用 `onDragDropEvent`。
- 列表、符號排在 flex 流裡，不要用 `position: absolute` 疊在會移動的列上（WebView2 會留下殘影）。
- 一頁有好幾個編輯器時，掛在 window／document 上的處理只交給 `currentEditor`，DOM 查詢限定在元件自己的根元素。
- 自由擺放的物件要加進輔助對齊（`snapMove`、`snapResizeGrid`），座標用畫布座標並傳目前的 zoom。
- 跨模組溝通用已有的視窗事件（`openPage()`、`OPEN_PAGE_EVENT`、`requestAppend()`）或 App 傳下來的 callback，不要讓模組直接 import 另一個模組的元件。

## 6. Rust 後端

- 指令寫在 `src-tauri/src/lib.rs`：`#[tauri::command]`，並加進 `generate_handler![...]`。
- 錯誤回傳 `Result<T, String>`（`map_err(|e| e.to_string())`），不要 `unwrap()` 讀檔、寫檔或解析的結果。
- 回傳給前端的 struct 加 `#[derive(serde::Serialize)]` 與 `#[serde(rename_all = "camelCase")]`；前端參數用 camelCase。
- 存檔位置一律從 `data_root()` 開始；檔名用既有的 URL 編碼函式，不要直接拼使用者輸入的名稱。
- 新的外掛功能要在 `src-tauri/capabilities/default.json` 加權限。
- 純邏輯（路徑、解析）寫成不需要 `AppHandle` 的函式，加 `#[cfg(test)]` 測試，用 `cargo test` 跑。
- `npm run tauri dev` 開著時跑 cargo 要另用 target：`CARGO_TARGET_DIR=target/claude-test cargo check`。

## 7. 測試

- 新增或修改純函式一定要加測試；修 bug 先寫一個會失敗的測試再修。
- 測試名稱用中文寫成「規則」：`it("最近打開或編輯的排前面，沒有紀錄的照名稱", …)`，一個 `describe` 對應一個模組或功能。
- 需要 DOM 的測試檔案第一行加 `// @vitest-environment jsdom`。
- 時間相關的測試傳入固定的 `now`，不要依賴執行時的日期。
- 提交前跑：

  ```bash
  npm test          # 全部測試（含 CommonMark 規格）
  npm run build     # 型別檢查與打包
  ```

  有改 Rust 再跑 `cargo check`／`cargo test`。

## 8. 實際驗證

測試通過不代表功能正常，畫面上看得到的改動要實際操作：

1. 用瀏覽器預覽（`.claude/launch.json`，Vite port 1420）操作一次，檢查主控台沒有錯誤，淺色與深色都看過。
2. 瀏覽器預覽沒有 Rust 後端，也看不到 WebView2 的問題（原生拖放、重畫殘影、剪貼簿）。牽涉到存檔、檔案、拖曳或剪貼簿時，要在 `npm run tauri dev` 裡再確認一次。
3. 要跑 `npm run tauri dev` 前先停掉預覽，否則 port 1420 被佔用。
4. 工作紀錄裡寫清楚驗證了什麼、用什麼方式驗證（真實滑鼠、模擬事件、只有測試）。

## 9. Git

- 預設分支 `main`，開發在功能分支（目前是 `rewrite`）。不要直接在 `main` 上提交。
- **提交訊息用中文**：第一行是這次做了什麼，用「、」與「；」串起來，不加句號，例如
  `Desk：白板發想＋Dock 整理；資料庫併進 Desk`。需要時空一行寫細節（`- ` 開頭的清單）。
- 一次提交一件完整的事，測試要能通過。
- 不能進 git：簽章私鑰（`~/.tauri/banyan.key`）、`.env`、`target/`、`dist/`、`node_modules/`、使用者資料。
- 不要用 `--no-verify` 或強制推送改寫共用分支的歷史。

## 10. 文件

每次工作結束前檢查：

| 文件 | 什麼時候更新 |
|---|---|
| `Design/Features.md` | 功能新增、修改、刪除：模組內容、狀態總覽、已知限制、最後的更新紀錄 |
| `工作紀錄/<ISO 週>.md` | 每次有實際工作：當天做了什麼、遇到的問題與原因、怎麼驗證、測試數量。新的一週新建檔案，檔名如 `2026-W47（11-16 ~ 11-22）.md`，用本地時間（UTC+8） |
| `CLAUDE.md` | 架構、檔案位置、必須遵守的規則改變時 |
| `Design/OfficeParity.md` | Word／簡報／Excel 加了功能 |
| `Design/Conventions.md` | 開發規則改變時 |

## 11. 版本與發佈

- 版本號同時改 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 三處。
- 打包前設定 `TAURI_SIGNING_PRIVATE_KEY`（有密碼再設 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`），再 `npm run tauri build`。
- 在 GitHub 建 Release，上傳安裝檔、`.sig` 與 `latest.json`（詳細欄位見 CLAUDE.md 的「更新」）。
- 改了標誌要重產圖示（`npx tauri icon src-tauri/app-icon.svg`，刪掉 android／ios），`public/favicon.svg` 與 `BanyanMark` 一起改。

## 12. 提交前檢查清單

- [ ] 沒有改到使用者原始碼中不相關的部分
- [ ] 邏輯在純函式裡，並有測試
- [ ] `npm test` 全部通過
- [ ] `npm run build` 沒有型別錯誤
- [ ] 有改 Rust：`cargo check`／`cargo test` 通過，新指令已加進 `generate_handler!`
- [ ] 介面文字是英文，顏色用 CSS 變數，深色模式兩處都寫了
- [ ] 拖曳用指標事件；編輯器外的控制項有 `editor-ui`＋`preventDefault`
- [ ] 在預覽（必要時在 Tauri）實際操作過
- [ ] 更新了 Features.md、工作紀錄，必要時更新 CLAUDE.md
