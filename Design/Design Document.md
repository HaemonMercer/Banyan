# Banyan Note 簡介

# 技術路線
|功能 |工具 |
|---|--|
|核心框架 |Tauri |
|前端框架 |Typescript 的 React |
|資料儲存 |SQLite |
|Markdown 語法 |unified / remark（GFM、KaTeX、directive），自訂語法一律用 directive，只有 `[[wikilink]]` 另做簡寫；卡片編輯器：Milkdown（ProseMirror ＋ remark，所見即所得，與解析共用同一套 remark 外掛） |
|圖表 |自研 |
|畫布 |HTML 的 Canvas |

# 核心功能
|功能 |概括 |參考 |
|---|---|---|
|Drawer | |Zotero |
|Writer | |Scrivener, Microsoft Word, LibreOffice Writer,<br>Pages |
|Slides | |Microsoft PowerPoint, LibreOffice Impress, iA Presenter,<br>Keynote |
|Publisher | |Affinity 的 Layout, InDesign |
|Draw | |Draw.io, Figma |
|Layout |Notion Style 的排版，且是 WYSIWYG 的 Markdown 編輯器。<br>頁面由區塊組成，可以拖曳重排、分欄，並嵌入其他模組的內容。 |Notion |
|Whiteboard |無限白板：把筆記、文獻、圖片以卡片的形式擺放並連線，用來整理想法和知識之間的關係。 |Heptabase, Miro, FigJam |
|Base |資料庫：使用者可以自訂欄位，用表格、看板、日曆、圖庫等視圖瀏覽。<br>支援篩選、排序、分組與公式欄位。 |Notion Database |
|Version Machine |版本控制：自動記錄每一次修改，也能手動建立有名稱的版本。<br>可以比較兩個版本的差異，並還原到任何一個時間點。 |Obsidian 的 Version Control, JetBrains 的 Local History |

# 核心頁面
| | |
|---|---|
|Drawer | |
|Whiteboard | |
|Card Hub | |

# 底層框架
| |功能 |用到它的模組 |
|---|---|---|
|文字模型 |支持Markdown語法、富文字、Latex、多字型 |Writer, Drawer, Publisher |
|2D 畫布引擎 |無限畫布、縮放、圖形、選取 |Draw, Whiteboard, Slides, Publisher |
|排版引擎 |分頁、版面 |Publisher, Writer Export, Slides Export |

# ER Model

# MVP
| | |
|--|---|
|pre-Alpha |基礎的 Drawer| 
|Alpha |完成 Layout, Publisher 和 Slides|
