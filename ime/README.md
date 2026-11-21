# Banyan 輸入法

把 Banyan 編輯器裡的倉頡／速成、字預測與輔助打字做成 Windows 的輸入法（TSF 文字服務），在所有程式裡都能用（Word、瀏覽器、記事本…）。

## 安裝

需要 Rust（`x86_64-pc-windows-msvc`）。在 `ime/` 執行（會要求系統管理員權限）：

```powershell
.\install.ps1
```

它會編譯 release 版、複製到 `C:\Program Files\Banyan IME\`、用 `regsvr32` 註冊，並加到「中文（台灣）」的鍵盤（沒有這個語言會一起加上）。之後用 Win＋空白鍵切換到「Banyan」。已經開著的程式要重新開啟才會載入新版。移除：`.\uninstall.ps1`。

目前只有 64 位元版：32 位元的程式（少數舊程式）裡不會出現。

## 用法（和 App 裡的 Banyan 輸入一樣）

- **中／英**：單獨按一下 Shift 切換（游標下方閃一下「中」或「英」）；**Alt＋`** 換倉頡／速成。
- **中文**：打 a～y 是碼，組字中顯示字根，下方是候選字。空白鍵、Enter、Tab 選反白的字，1～9 選第幾個，←→ 移動，↑↓（PageUp／PageDown、- =）換頁，Backspace 刪一碼，Esc 取消；打標點等其他字會先選反白的字。碼打滿（倉頡 5 碼、速成 2 碼）繼續打就是下一個字。打大寫字母暫時打英文，打完這個字（空白、標點、Enter）回到中文。
- **聯想**：選好字後列出接下來常接的字，1～9、Enter、Tab 選；Esc 關掉。
- **英文**：補完正在打的字、打完一個字空一格預測下一個字（1～9、Tab 選；補完也可以按 Enter；下一個字要先用 ←→ 移動過 Enter 才選）。打過的英文字會記住，排在前面。
- **Alt＋數字**：候選列開著時直接打數字。
- **輔助打字**：中文句子裡的半形標點換成中文標點、英文句子裡的中文標點換回半形、英文句首大寫、單獨的 i 換成 I、中英之間加空格（預設關）。換完緊接著按 Backspace 還原。

## 設定

**Banyan IME Settings** 視窗可以關掉字預測與輔助打字，三個地方打得開：開始功能表的「Banyan IME Settings」、在候選列上按右鍵、Windows 設定裡這個鍵盤的「選項」（Windows 有顯示這個按鈕時）。

- **Word prediction**（總開關）：English（補完與下一個字）、Chinese（選字後的聯想）。
- **Typing assist**（總開關）：中文標點、英文標點、句首大寫與單獨的 i、中英之間加空格。
- 總開關關掉時底下的細項變灰、不作用（細項的勾選留著，再打開就回來）。兩個都關掉時一般打字直接交給程式，倉頡／速成照常。
- 按 OK 存起來；已經開著的程式在切回去（焦點改變）時套用。

設定存在登錄檔 `HKCU\Software\Banyan IME`（DWORD，0／1）：`Predict`、`English`、`Follow`、`Assist`、`CjkPunct`、`EnPunct`、`Capitalize`、`Spacing`；`Chinese`、`Quick` 記住上次的中／英與倉頡／速成。

記住的英文字在 `%APPDATA%\Banyan IME\learned.tsv`。

## 在 Banyan 裡用

Banyan 自己也有同樣的輸入（`src/editor/predictor.ts`）。用系統的 Banyan 輸入法時，把 App 設定的 Typing → Chinese input method 設成 Off、Word prediction 的 English 關掉，否則兩邊都會出預測列。

## 開發

```powershell
cargo test                                          # 核心邏輯（engine/，任何平台）
cargo build --release
cargo run --release --example smoke                 # 不註冊：載入 DLL、經 COM 建立、在 TSF 上啟用／停用
.\dev-test.ps1                                      # 裝好後：用剛編好的 DLL 在 RichEdit 與 EDIT 文字框裡真的打字（不用重新安裝）
```

`dev-test.ps1` 會開一個小視窗、用 SendInput 打字：跑的時候不要動鍵盤滑鼠（拿不到前景視窗就會停下來，不會打到別的程式）。設環境變數 `BANYAN_IME_LOG=1` 再啟動程式，按鍵與候選視窗的紀錄寫在 `%TEMP%\banyan-ime.log`。原本的 `target\release\banyan_ime.dll` 被開著的程式載入、鎖住時，用 `.\install.ps1 -TargetDir target\dev`。

- `src/engine/`：純邏輯，照 App 的 `src/editor/predict.ts`、`predictor.ts`、`typing.ts`、`punct.ts` 移植；**改 App 的規則時要一起改這裡**。字典直接嵌入 `src/editor/predict/` 的檔案（`include_str!`），和 App 用同一份。
- `src/engine/machine.rs`：按鍵 → 要不要吃掉（`test`，給 OnTestKeyDown，不改狀態）與執行（`key`，在 edit session 裡）；文件操作經過 `Doc` trait，測試用字串。
- `src/tsf/`：COM 註冊（`register.rs`）、文字服務與 sink（`service.rs`）、edit session 與 `Doc` 的 TSF 實作（`session.rs`）、候選視窗（`window.rs`，GDI）。
- 圖示是 `src-tauri/icons/icon.ico`（`build.rs` 用 `embed-resource` 編進 DLL）。
- 除錯：裝好之後在記事本打字最單純；改了程式要 `.\install.ps1` 再重開記事本（舊的 DLL 被載入中會先改名成 `.old`）。
