// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { collectDocLinks, docLinkName, docLinkOf, fileDocLinks, getDocLinks, linkMenu, setDocLinks, suggestDocLinks } from "./docLinks";
import { linkPages } from "../pages/pageRef";

const file = (docs: unknown[]) => JSON.stringify({ board: {}, docs });

describe("Dock 文件連結", () => {
  afterEach(() => setDocLinks([]));

  it("從檔案的 JSON 讀出文件，舊的資料庫算試算表", () => {
    const links = fileDocLinks("Trip", file([
      { id: "a", title: "Budget", kind: "sheet" },
      { id: "b", title: "  ", kind: "word" },
      { id: "c", title: "Old", kind: "database" },
      { title: "no id" },
    ]));
    expect(links.map((l) => [l.name, l.kind])).toEqual([
      ["Trip/Budget", "sheet"],
      ["Trip/Untitled", "word"],
      ["Trip/Old", "sheet"],
    ]);
    expect(fileDocLinks("x", "not json")).toEqual([]);
  });

  it("名稱拿掉方括號與換行", () => {
    expect(docLinkName("A  file", "Plan [v2]\nnext")).toBe("A file/Plan v2 next");
  });

  it("不分大小寫找到，同名取第一個", () => {
    setDocLinks(collectDocLinks(["B", "A"], {
      A: file([{ id: "1", title: "Notes", kind: "note" }, { id: "2", title: "notes", kind: "word" }]),
      B: file([{ id: "3", title: "Deck", kind: "slides" }]),
    }));
    expect(getDocLinks().map((l) => l.name)).toEqual(["A/Notes", "A/notes", "B/Deck"]);
    expect(docLinkOf(" a/NOTES ")?.id).toBe("1");
    expect(docLinkOf("A/Missing")).toBeUndefined();
  });

  it("自動完成：檔案名稱或文件標題開頭相符的排前面", () => {
    const list = collectDocLinks(["Trip", "Work"], {
      Trip: file([{ id: "1", title: "Budget", kind: "sheet" }, { id: "2", title: "Plan", kind: "word" }]),
      Work: file([{ id: "3", title: "Trip budget", kind: "sheet" }]),
    });
    expect(suggestDocLinks("bud", list).map((l) => l.name)).toEqual(["Trip/Budget", "Work/Trip budget"]);
    expect(suggestDocLinks("trip/p", list).map((l) => l.name)).toEqual(["Trip/Plan"]);
    expect(suggestDocLinks("", list)).toHaveLength(3);
  });

  it("分級選單：第一層是頁面與檔案，「檔案/」進到第二層", () => {
    const list = collectDocLinks(["Trip", "Work"], {
      Trip: file([{ id: "1", title: "Budget", kind: "sheet" }, { id: "2", title: "Plan", kind: "word" }]),
      Work: file([{ id: "3", title: "Trip budget", kind: "sheet" }]),
    });
    const pages = (q: string) => ["Travel"].filter((p) => p.toLowerCase().includes(q.toLowerCase()));
    const top = linkMenu("", pages, list);
    expect(top.folder).toBeNull();
    expect(top.pages).toEqual(["Travel"]);
    expect(top.files).toEqual([{ file: "Trip", count: 2 }, { file: "Work", count: 1 }]);
    expect(top.docs).toEqual([]);
    // 打字：檔案名稱相符的檔案，加上標題相符的文件（不重複列出 Trip 裡的每一份）
    const trip = linkMenu("trip", pages, list);
    expect(trip.files.map((f) => f.file)).toEqual(["Trip"]);
    expect(trip.docs.map((d) => d.name)).toEqual(["Work/Trip budget"]);
    // 第二層
    const inTrip = linkMenu("trip/", pages, list);
    expect(inTrip.folder).toBe("Trip");
    expect(inTrip.docs.map((d) => d.title)).toEqual(["Budget", "Plan"]);
    expect(linkMenu("Trip/pl", pages, list).docs.map((d) => d.title)).toEqual(["Plan"]);
    // 斜線前面不是檔案：照第一層
    expect(linkMenu("a/b", pages, list).folder).toBeNull();
  });

  it("顯示時加上 dock-ref 與種類", () => {
    setDocLinks(fileDocLinks("Trip", file([{ id: "1", title: "Budget", kind: "sheet" }])));
    const html = linkPages("<p>See [[Trip/Budget]] and [[Other]]</p>");
    const t = document.createElement("div");
    t.innerHTML = html;
    const refs = t.querySelectorAll("a.page-ref");
    expect(refs).toHaveLength(2);
    expect(refs[0].classList.contains("dock-ref")).toBe(true);
    expect(refs[0].getAttribute("data-kind")).toBe("sheet");
    expect(refs[0].getAttribute("title")).toBe("Excel in Trip");
    expect(refs[1].classList.contains("dock-ref")).toBe(false);
  });
});
