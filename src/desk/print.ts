/**
 * 列印／存成 PDF（Word、Google 文件、試算表、簡報都有）：把要印的頁面複製到 body 最外層的 `#print-root`，
 * 列印時只顯示它（`desk.css` 的 `@media print`），印完拿掉。紙張大小用 `@page` 指定，系統的列印對話框可以選「另存為 PDF」。
 */

function printPages(pages: HTMLElement[], size: string) {
  if (!pages.length) return;
  document.getElementById("print-root")?.remove();
  const root = document.createElement("div");
  root.id = "print-root";
  for (const p of pages) {
    p.classList.add("print-page");
    root.appendChild(p);
  }
  document.body.appendChild(root);
  const style = document.createElement("style");
  style.textContent = `@page { size: ${size}; margin: 0; }`;
  document.head.appendChild(style);
  document.body.classList.add("printing");
  const done = () => {
    root.remove();
    style.remove();
    document.body.classList.remove("printing");
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  // 圖片要先載好
  const imgs = [...root.querySelectorAll("img")].filter((i) => !i.complete);
  Promise.all(imgs.map((i) => new Promise((r) => ((i.onload = r), (i.onerror = r))))).then(() => {
    window.print();
    // 有些 WebView 沒有 afterprint：保險起見過一會兒也清掉
    setTimeout(done, 60_000);
  });
}

/** Word：每一頁是整疊紙的複本，往上移到那一頁、裁掉其他頁（頁與頁的空隙不會印出來） */
export function printPaper(scope: HTMLElement) {
  const sheets = scope.querySelector<HTMLElement>(".paper-sheets");
  if (!sheets) return;
  const pages = [...sheets.querySelectorAll<HTMLElement>(":scope > .paper-page")];
  if (!pages.length) return;
  const w = pages[0].offsetWidth;
  const h = pages[0].offsetHeight;
  const out = pages.map((pg) => {
    const box = document.createElement("div");
    box.style.cssText = `position:relative;width:${w}px;height:${h}px;overflow:hidden;`;
    const copy = sheets.cloneNode(true) as HTMLElement;
    copy.style.transform = `translateY(${-pg.offsetTop}px)`;
    copy.style.transformOrigin = "0 0";
    copy.querySelectorAll("[contenteditable]").forEach((el) => el.removeAttribute("contenteditable"));
    box.appendChild(copy);
    return box;
  });
  printPages(out, `${w}px ${h}px`);
}

/** 簡報：每張投影片一頁（從縮圖複製，放大成原本的 960×540） */
export function printSlides(scope: HTMLElement) {
  const slides = [...scope.querySelectorAll<HTMLElement>(".deck-strip .slide, .deck-table .slide")];
  const out = slides.map((s) => {
    const box = document.createElement("div");
    box.style.cssText = "position:relative;width:960px;height:540px;overflow:hidden;";
    const copy = s.cloneNode(true) as HTMLElement;
    copy.style.zoom = "1";
    box.appendChild(copy);
    return box;
  });
  printPages(out, "960px 540px");
}

/** 試算表：目前這張工作表的畫布，縮到一頁橫向 A4 的寬度 */
export function printSheet(scope: HTMLElement) {
  const paper = scope.querySelector<HTMLElement>(".sv-paper");
  if (!paper) return;
  const W = 1123 - 64;
  const copy = paper.cloneNode(true) as HTMLElement;
  copy.querySelectorAll(".st-input, .st-sel, .st-cur, .st-fill, .st-add, .st-corner, .st-colbar, .st-rowbar").forEach((el) => el.remove());
  const k = Math.min(1, W / paper.scrollWidth);
  const box = document.createElement("div");
  box.className = "sv print-sheet";
  box.style.cssText = `position:relative;padding:32px;height:auto;display:block;`;
  copy.style.zoom = String(k);
  copy.style.margin = "0";
  copy.style.background = "none";
  box.appendChild(copy);
  printPages([box], "A4 landscape");
}
