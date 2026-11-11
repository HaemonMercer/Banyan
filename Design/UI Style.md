# Banyan Note UI 風格指南

> 整個軟體共用的視覺規範。所有數值都定義在 `src/styles/tokens.css`，新功能請**只使用變數**，不要在模組 CSS 寫死顏色、字級、圓角或陰影。

## 設計原則

| 原則 | 說明 |
|---|---|
| 安靜的工作環境 | 介面是放內容的紙，不搶內容的風頭：暖灰中性色、細線、低對比的陰影 |
| 一個強調色 | 榕樹綠（`--accent`）只用在「主要動作」「選取」「焦點」三件事，不拿來裝飾 |
| 密度適中 | 13px 內文、28px 列高，適合長時間整理大量資料（參考 Zotero、Heptabase） |
| 平常隱藏、需要時出現 | 次要操作（✎、🗑、↑↓、×）滑鼠停留才出現；欄位平時沒有框線，停留時出現細框，聚焦時出現綠框與光暈 |
| 淺色與深色同等重要 | 每個顏色都有深色版本；元件只用語意變數，切換主題不需改元件 |

## 檔案結構

| 檔案 | 內容 |
|---|---|
| `src/styles/tokens.css` | 設計變數：顏色、字型、字級、間距、尺寸、圓角、陰影、動畫、圖層；淺色與深色兩組 |
| `src/styles/base.css` | 全域基礎：`box-sizing`、字型、捲軸、鍵盤焦點框、選取色、`[hidden]` |
| `src/styles/components.css` | 共用元件：窗格標題、按鈕、輸入框、樹狀清單、選單、標籤、分段按鈕、對話框、提示、拖曳 |
| `src/styles/index.css` | 依序匯入以上三個檔案；只在 `main.tsx` 匯入一次 |
| `src/theme.ts` | 主題切換（跟隨系統／淺色／深色），存在 `localStorage` 的 `banyan.theme` |
| 各模組 CSS | 只寫該模組的版面與專屬元件（`Drawer.css`、`Whiteboard.css`、`Graph.css`、`markdown.css`…） |

## 顏色

### 表面（由下到上）
| 變數 | 淺色 | 深色 | 用途 |
|---|---|---|---|
| `--bg` | `#f6f5f1` | `#1a1a19` | 視窗底色、白板與關係圖畫布 |
| `--sidebar` | `#efeee9` | `#1e1e1d` | 左側直欄、左欄 |
| `--pane` | `#ffffff` | `#232322` | 中欄、右欄、卡片 |
| `--raised` | `#ffffff` | `#2a2a28` | 選單、對話框、浮動面板（縮放列、節點資訊） |
| `--hover` / `--active` | `#ebe9e3` / `#e2e0d9` | `#2e2e2c` / `#383735` | 滑鼠停留／按下 |

### 文字
| 變數 | 用途 |
|---|---|
| `--text` | 主要文字 |
| `--text-2` | 次要內容（作者、日期、按鈕圖示） |
| `--muted` | 標籤、提示、數量 |
| `--faint` | 佔位文字、停用 |

### 線條
`--border`（分隔線、輸入框）、`--border-strong`（按鈕外框、停留時的輸入框、捲軸）。

### 強調色：榕樹綠
| 變數 | 用途 |
|---|---|
| `--accent` / `--accent-hover` | 主要按鈕、聚焦框、連結、選取的連線 |
| `--accent-soft` | 選取的列、標籤、資料夾路徑、提示框底色 |
| `--accent-text` | 放在 `--accent-soft` 上的文字 |
| `--on-accent` | 放在 `--accent` 上的文字 |

### 狀態
| 變數（各有 `-soft` 底色） | 用途 |
|---|---|
| `--danger` | 刪除、錯誤提示、`:::danger` |
| `--warning` | 警告、`:::warning` |
| `--info` | 資訊、`:::info` |

### 畫布
`--canvas-dot`（白板點格）、`--link-line`（白板與關係圖的連線）。

## 文字

- 字型：`--font-sans` = Segoe UI Variable／Segoe UI ＋ 微軟正黑體（macOS 為 PingFang TC）；程式碼 `--font-mono` = Cascadia Code。
- 字級：

| 變數 | 大小 | 用途 |
|---|---|---|
| `--fs-xs` | 11px | 數量、徽章、提示、欄位標題 |
| `--fs-sm` | 12px | 欄位名稱、次要列、小按鈕 |
| `--fs-md` | 13px | 內文（預設） |
| `--fs-lg` | 14px | 卡片標題 |
| `--fs-xl` | 16px | 條目標題、對話框標題 |
| `--fs-2xl` | 20px | 頁面標題（保留） |

- 字重只用 400／500／600／700（`--fw-*`）；區塊標題（資料夾、標籤、清單欄名）用 11px 半粗體＋ 0.04em 字距。
- 行高：介面 `--lh-tight`（1.3），段落與 Markdown `--lh-body`（1.5）。數字欄位用等寬數字（`tabular-nums`）。

## 間距與尺寸

- 4px 格線：`--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16 · `--sp-5` 20 · `--sp-6` 24 · `--sp-8` 32。
- 窗格內距 12px；窗格標題高 `--header-h` 44px；清單列高 `--row-h` 28px；按鈕與輸入框高 `--control-h` 28px；左側直欄寬 `--rail-w` 64px；樹狀清單每層縮排 14px。

## 圓角與陰影

| 圓角 | 用途 |
|---|---|
| `--r-sm` 4px | 列、小按鈕、行內標記 |
| `--r-md` 6px | 按鈕、輸入框、分段按鈕 |
| `--r-lg` 8px | 卡片、選單、浮動面板 |
| `--r-xl` 12px | 對話框、拖放覆蓋層 |
| `--r-pill` | 標籤、徽章、數量 |

| 陰影 | 用途 |
|---|---|
| `--shadow-xs` | 卡片、主要按鈕、分段按鈕的選取項 |
| `--shadow-sm` | 浮動工具列（縮放列） |
| `--shadow-md` | 選單、拖曳中的提示、選取的卡片、提示訊息 |
| `--shadow-lg` | 對話框 |
| `--ring` | 輸入框聚焦時的綠色光暈 |

## 元件

| 元件 | class | 規則 |
|---|---|---|
| 主要按鈕 | `.primary-btn` | 綠底白字；一個窗格或對話框最多一個 |
| 次要按鈕 | `.secondary-btn` | 外框、窗格底色 |
| 刪除按鈕 | `.danger-btn` | 外框、紅字；停留時淡紅底 |
| 圖示按鈕 | `.icon-btn` | 無框，26 × 26，停留時出現底色 |
| 文字按鈕 | `.small-btn` | 綠色文字（「＋ 新增」） |
| 輸入框 | `.input`、`.search input`、`.wb-search` | 28px 高；停留加深框線；聚焦綠框＋光暈 |
| 行內欄位 | 右欄條目詳情 | 平時無框，停留細框，聚焦綠框 |
| 樹狀列 | `.tree-row` | 左右留 4px、圓角；選取為淡綠底＋深綠字 |
| 選單 | `.menu`、`.wb-mini-menu`、`.wiki-complete` | `--raised` 底、8px 圓角、`--shadow-md`，出現時淡入下滑 3px |
| 分段按鈕／分頁 | `.wb-seg`、`.wb-tabs` | 灰底膠囊，選取項為白底＋小陰影 |
| 標籤 | `.tag`、`.badge` | 膠囊形、淡綠底、深綠字 |
| 對話框 | `.modal` | 12px 圓角、`--shadow-lg`、背景遮罩 `--overlay` |
| 提示訊息 | `.toast`（錯誤）、`.toast.info` | 畫面底部置中，從下方淡入 |
| 拖曳提示 | `.drag-ghost` | 游標旁的小卡，說明放開後會發生什麼（綠字） |

## 互動與動畫

- 停留、按下的顏色變化 100ms（`--dur-fast`）；選單、對話框出現 160ms（`--dur`）；曲線 `--ease`。
- 系統開啟「減少動態效果」時關閉所有動畫。
- 鍵盤焦點：所有可聚焦元素以 2px 綠框標示（`:focus-visible`），滑鼠點擊不顯示。
- 捲軸：細、圓角、與底色融合。

## 主題

- 預設跟隨系統（`prefers-color-scheme`）；左側直欄最下方的按鈕依序切換「跟隨系統 → 淺色 → 深色」。
- 實作：`<html data-theme="light|dark">` 強制主題；跟隨系統時移除這個屬性。啟動時在第一次繪製前套用，避免閃爍。

## 圖示

自繪的線條圖示，原始碼在 `src/icons/icons.ts`，預覽在 [Icons.html](Icons.html)（用瀏覽器開啟，可切換淺色／深色）。

| 規格 | 值 |
|---|---|
| 網格 | 24 × 24，主要內容在 3–21 之間 |
| 線條 | 1.75px，圓角端點與轉角（`stroke-linecap/linejoin: round`） |
| 顏色 | `currentColor`，跟著文字顏色；條目類型依分類著色（`--type-literature` 藍、`--type-media` 紫、`--type-performance` 橘、`--type-art` 玫瑰、`--type-other` 灰） |
| 大小 | 預設 1em（跟著字級）；模組列 20px、樹狀清單 16px、條目清單 15px、按鈕內 14–15px |
| 填色 | 只用在很小的實心部位（⋯ 的點、資訊符號的點、Logo 的樹冠） |

| 分組 | 數量 | 內容 |
|---|---|---|
| Logo | 1 | 榕樹：樹冠、樹幹與垂下的氣根。App 圖示是綠色圓角方塊上的白色 Logo |
| 模組 | 11 | Drawer、Whiteboard、Graph、Card Hub，以及規劃中的 Writer、Slides、Publisher、Draw、Layout、Base、Version Machine |
| 介面 | 56 | 新增、刪除、編輯、搜尋、資料夾、標籤、附件、連結、縮放、主題等 |
| 條目類型 | 29 | 每種 Drawer 條目類型一個 |

使用方式：

```tsx
import { Icon, TypeIcon } from "../icons/Icon";
<Icon name="folder" />                 // 介面與模組圖示
<TypeIcon type={item.itemType} />      // 條目類型（自動依分類著色）
```

- 新增圖示：在 `icons.ts` 對應分組加一筆（只寫 `<svg>` 內的內容），再執行 `node scripts/build-icons.ts` 重新產生預覽頁。
- 下拉選單 `<option>` 和純文字（提示訊息、標題）無法放 SVG，這些地方仍使用 `itemTypes.ts` 裡的 emoji。
- 改了 Logo 之後：`node scripts/build-icons.ts` 會更新 `src-tauri/icons/app-icon.svg`；再把它轉成 1024 × 1024 的 `app-icon.png`，執行 `npx tauri icon src-tauri/icons/app-icon.png` 產生各尺寸的 App 圖示（產生的 `android/`、`ios/` 資料夾目前用不到，可刪除）。Windows 的 exe 圖示在編譯時嵌入，換完後要重新編譯（`cargo build` 或重新啟動 `tauri dev`）。

## 新增介面時的檢查清單

1. 顏色、字級、圓角、陰影、間距都用 `tokens.css` 的變數。
2. 先找 `components.css` 有沒有現成元件；需要新的共用元件就加在那裡，不要複製到模組 CSS。
3. 在淺色與深色主題都看一次。
4. 次要操作預設隱藏，滑鼠停留或選取時出現。
5. 圖示用 `<Icon name="…" />`（見下方「圖示」），不要再用 emoji。
