import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initMedia } from "./editor/media";
import { applyTheme, loadTheme } from "./shell/nav";

// 畫面出來之前先套用主題，深色模式啟動時才不會先閃一下白
applyTheme(loadTheme());

// 先取得媒體資料夾位置，文件裡的圖片、影片一開始就能顯示
void initMedia().finally(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
