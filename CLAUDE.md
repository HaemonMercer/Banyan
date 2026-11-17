# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Banyan 是由 `create-tauri-app` 產生的 Tauri 2 桌面 App：Rust 後端＋ React 19／TypeScript 前端（Vite），在 Windows 上開發。目前主要功能是 Notion 風格的 Markdown 區塊編輯器與參考 Logseq 的日記；測試用 Vitest，沒有 lint 或 formatter。Git 預設分支是 `main`。已實作功能記在 `Design/Features.md`，每天的工作記在 `工作紀錄/` 的週檔。

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
- **版本號**：同時記在 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`，改版時三處一起改。
