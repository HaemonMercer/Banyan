import { describe, expect, it } from "vitest";
import { attachmentImages, drawerImages, fileImages, imageAlt, isImageFile, pickImages, searchImages, setImagePicker, urlImage } from "./drawerImages";
import { addFiles, addFolder } from "./files";
import { blankItem, emptyLibrary } from "./model";

const A = "media/0123456789abcdef.png";
const B = "media/fedcba9876543210.jpg";

describe("drawerImages", () => {
  it("只收圖片：檔案庫的檔案＋條目附件，標出在哪裡", () => {
    const f = addFolder(emptyLibrary(), null, "研究");
    let lib = addFiles(f.lib, f.id, [{ name: "chart.png", src: A }, { name: "notes.pdf", src: "media/1111111111111111.pdf" }], 1).lib;
    const it1 = blankItem("article", 2);
    it1.title = "Paper";
    it1.attachments = [
      { id: "a1", name: "figure.jpg", src: B, kind: "file", added: 3 },
      { id: "a2", name: "site.png", src: "https://example.com/x.png", kind: "link", added: 3 },
    ];
    lib = { ...lib, items: [it1] };
    const out = drawerImages(lib);
    expect(out.map((i) => [i.name, i.where])).toEqual([
      ["figure.jpg", "Attached to “Paper”"],
      ["chart.png", "研究"],
    ]);
  });

  it("同樣內容只留一個；垃圾桶裡的條目不算", () => {
    let lib = addFiles(emptyLibrary(), null, [{ name: "a.png", src: A }], 5).lib;
    const it1 = blankItem("article", 1);
    it1.attachments = [{ id: "a1", name: "copy.png", src: A, kind: "file", added: 1 }];
    const it2 = { ...blankItem("article", 1), trashed: true, attachments: [{ id: "a2", name: "b.jpg", src: B, kind: "file" as const, added: 9 }] };
    lib = { ...lib, items: [it1, it2] };
    expect(drawerImages(lib).map((i) => i.name)).toEqual(["a.png"]);
  });

  it("圖片判斷與替代文字", () => {
    expect(isImageFile("x.JPEG", "")).toBe(true);
    expect(isImageFile("blob", "data:image/png;base64,AA")).toBe(true);
    expect(isImageFile("x.mp4", "media/1.mp4")).toBe(false);
    expect(imageAlt({ name: "my.photo.png" })).toBe("my.photo");
  });

  it("My Files 的資料夾、附件分開列；搜尋名稱與位置", () => {
    const f = addFolder(emptyLibrary(), null, "研究");
    let lib = addFiles(f.lib, f.id, [{ name: "chart.png", src: A }], 1).lib;
    lib = addFiles(lib, null, [{ name: "top.jpg", src: B }], 2).lib;
    expect(fileImages(lib, null).map((i) => i.name)).toEqual(["top.jpg"]);
    expect(fileImages(lib, f.id).map((i) => i.name)).toEqual(["chart.png"]);
    expect(attachmentImages(lib)).toEqual([]);
    const all = drawerImages(lib);
    expect(searchImages(all, "研究").map((i) => i.name)).toEqual(["chart.png"]);
    expect(searchImages(all, "TOP jpg").map((i) => i.name)).toEqual(["top.jpg"]);
    expect(searchImages(all, "  ")).toHaveLength(2);
  });

  it("網址的圖片：只接受 http(s)，替代文字是檔名", () => {
    expect(urlImage(" https://example.com/a/My%20Cat.png?x=1 ")).toEqual({ src: "https://example.com/a/My%20Cat.png?x=1", alt: "My Cat" });
    expect(urlImage("ftp://x/y.png")).toBeNull();
    expect(urlImage("not a url")).toBeNull();
  });

  it("pickImages 交給登記的對話框；沒有登記是空陣列", async () => {
    setImagePicker(null);
    expect(await pickImages()).toEqual([]);
    setImagePicker(async (opts) => [{ src: A, alt: opts.tab ?? "" }]);
    expect(await pickImages({ tab: "url" })).toEqual([{ src: A, alt: "url" }]);
    setImagePicker(null);
  });
});
