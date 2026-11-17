# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Banyan 是由 `create-tauri-app` 產生的 Tauri 2 桌面 App：Rust 後端＋ React 19／TypeScript 前端（Vite），在 Windows 上開發。目前仍是範本狀態，沒有測試、lint 或 formatter。Git 預設分支是 `main`。

## 指令

```bash
npm install
npm run tauri dev     # 完整 App：先跑 beforeDevCommand（npm run dev），再編譯並開啟 Rust 視窗
npm run dev           # 只有前端（Vite，port 1420）；沒有 Rust 後端，invoke 會失敗
npm run build         # tsc 型別檢查 + vite build → dist/
npm run tauri build   # 打包安裝程式（先跑 npm run build，前端取自 ../dist）
```

Rust 在 `src-tauri/` 下執行 `cargo check`／`cargo test`。`npm run tauri dev` 開著時會鎖住並重編 `src-tauri/target/debug`，同時跑 cargo 要另用 target 資料夾：`CARGO_TARGET_DIR=target/claude-test cargo check`。

## 架構

- **前端 → 後端**：前端用 `@tauri-apps/api/core` 的 `invoke("指令名", { 參數 })` 呼叫 Rust。參數用 camelCase，Tauri 會轉成 Rust 端的 snake_case。
- **新增指令**：在 `src-tauri/src/lib.rs` 寫 `#[tauri::command]` 函式，並加進 `run()` 裡的 `tauri::generate_handler![...]`，否則前端呼叫會失敗。回傳給前端的 struct 要 `Serialize`（serde 已是相依套件）。
- **進入點**：`src-tauri/src/main.rs` 只呼叫 `banyan_lib::run()`；程式邏輯放在 lib crate（`banyan_lib`，名稱加 `_lib` 是為了避開 Windows 上 bin／lib 同名的問題）。`main.rs` 的 `windows_subsystem` 屬性讓 release 版不開主控台視窗，不要刪。
- **權限**：外掛功能（目前只有 `tauri-plugin-opener`）要在 `src-tauri/capabilities/default.json` 加權限，套用到 label 為 `main` 的視窗。
- **設定**：`src-tauri/tauri.conf.json` 管視窗、識別碼（`com.banyan`）、打包圖示（`src-tauri/icons/`）；CSP 目前關閉（`null`）。Vite 固定用 port 1420（`strictPort`），不要改成別的 port，除非同時改 `tauri.conf.json` 的 `devUrl`。
- **版本號**：同時記在 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`，改版時三處一起改。
