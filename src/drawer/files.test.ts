import { describe, expect, it } from "vitest";
import {
  addFiles,
  addFolder,
  addToFolder,
  attachedTo,
  attachFile,
  checkDuplicates,
  cleanName,
  deleteFiles,
  duplicateGroups,
  emptyFileTrash,
  extraCopies,
  fileKind,
  fileLocation,
  fileScopeFrom,
  fileTags,
  filterFiles,
  fingerprint,
  folderCounts,
  folderPath,
  hasUnlinked,
  linkAttachments,
  formatSize,
  locate,
  moveFiles,
  moveFolder,
  pathLabel,
  removeFolder,
  removeFromFolder,
  removePlace,
  renameEntry,
  renameFileTag,
  setFilesTrashed,
  setFileTags,
  sortFiles,
  typeName,
  uniqueName,
} from "./files";
import { blankItem, emptyLibrary, parseLibrary, serializeLibrary, type Library } from "./model";

const A = "media/00000000000000aa.pdf";
const B = "media/00000000000000bb.png";

function tree(): { lib: Library; research: string; y2026: string } {
  let lib = emptyLibrary();
  const r1 = addFolder(lib, null, "Research", 1);
  lib = r1.lib;
  const r2 = addFolder(lib, r1.id, "2026", 2);
  return { lib: r2.lib, research: r1.id, y2026: r2.id };
}
const names = (lib: Library, scope: Parameters<typeof filterFiles>[1], q = "", tags: string[] = []) => filterFiles(lib, scope, q, tags).map((f) => f.name).sort();

describe("檔案庫：名稱", () => {
  it("撞名加 (2)、(3)，不分大小寫", () => {
    expect(uniqueName("a.pdf", [])).toBe("a.pdf");
    expect(uniqueName("a.pdf", ["A.PDF"])).toBe("a (2).pdf");
    expect(uniqueName("a.pdf", ["a.pdf", "a (2).pdf"])).toBe("a (3).pdf");
    expect(uniqueName("a (2).pdf", ["a (2).pdf"])).toBe("a (3).pdf");
    expect(uniqueName("New folder", ["New folder"])).toBe("New folder (2)");
  });
  it("Windows 不能用的字元換掉", () => {
    expect(cleanName(' a/b:c*?"<>|. ')).toBe("a_b_c______");
  });
  it("檔案像條目，名稱可以重複；同一層的資料夾不重名", () => {
    let { lib } = tree();
    lib = addFiles(lib, null, [{ name: "a.pdf", src: A }, { name: "a.pdf", src: B }], 3).lib;
    expect(lib.files.map((f) => f.name)).toEqual(["a.pdf", "a.pdf"]);
    lib = addFolder(lib, null, "research", 4).lib;
    expect(lib.folders.map((f) => f.name)).toContain("research (2)");
  });
});

describe("檔案庫：資料夾（像收藏）", () => {
  it("路徑與位置", () => {
    const { lib, y2026 } = tree();
    expect(folderPath(lib, y2026).map((f) => f.name)).toEqual(["Research", "2026"]);
    expect(pathLabel(lib, y2026)).toBe("Research › 2026");
    expect(pathLabel(lib, null)).toBe("My Files");
  });
  it("一個檔案可以在好幾個資料夾；拿掉一個不影響其他", () => {
    let { lib, research, y2026 } = tree();
    const r = addFiles(lib, y2026, [{ name: "a.pdf", src: A }], 5);
    lib = addToFolder(r.lib, r.ids, research);
    expect(lib.files[0].folders).toEqual([y2026, research]);
    expect(fileLocation(lib, lib.files[0])).toBe("Research › 2026, Research");
    expect(addToFolder(lib, r.ids, research).files[0].folders).toEqual([y2026, research]);
    lib = removeFromFolder(lib, r.ids, y2026);
    expect(lib.files[0].folders).toEqual([research]);
    lib = removeFromFolder(lib, r.ids, research);
    expect(fileLocation(lib, lib.files[0])).toBe("Unfiled");
  });
  it("剪下貼上：從一個資料夾搬到另一個", () => {
    let { lib, research, y2026 } = tree();
    const r = addFiles(lib, research, [{ name: "a.pdf", src: A }], 5);
    lib = moveFiles(r.lib, r.ids, research, y2026);
    expect(lib.files[0].folders).toEqual([y2026]);
    lib = moveFiles(lib, r.ids, null, research);
    expect(lib.files[0].folders).toEqual([y2026, research]);
  });
  it("範圍：全部、Unfiled、資料夾含子資料夾、垃圾桶", () => {
    let { lib, research, y2026 } = tree();
    lib = addFiles(lib, y2026, [{ name: "deep.pdf", src: A }], 5).lib;
    const r = addFiles(lib, null, [{ name: "loose.png", src: B }, { name: "old.png", src: B }], 5);
    lib = setFilesTrashed(r.lib, [r.ids[1]], true, 6);
    expect(names(lib, { kind: "all" })).toEqual(["deep.pdf", "loose.png"]);
    expect(names(lib, { kind: "unfiled" })).toEqual(["loose.png"]);
    expect(names(lib, { kind: "folder", id: research })).toEqual(["deep.pdf"]);
    expect(names(lib, { kind: "folder", id: y2026 })).toEqual(["deep.pdf"]);
    expect(names(lib, { kind: "trash" })).toEqual(["old.png"]);
    expect(folderCounts(lib).get(research)).toBe(1);
  });
  it("搬資料夾：不能搬進自己的子資料夾；撞名改名", () => {
    let { lib, research, y2026 } = tree();
    expect(moveFolder(lib, research, y2026)).toBe(lib);
    lib = addFolder(lib, null, "2026", 4).lib;
    lib = moveFolder(lib, y2026, null);
    expect(lib.folders.find((f) => f.id === y2026)).toMatchObject({ parent: null, name: "2026 (2)" });
  });
  it("刪資料夾（連同子資料夾）：檔案留著，只是不再屬於它們", () => {
    let { lib, research, y2026 } = tree();
    lib = addFiles(lib, y2026, [{ name: "a.pdf", src: A }], 5).lib;
    lib = removeFolder(lib, research);
    expect(lib.folders).toEqual([]);
    expect(lib.files.map((f) => [f.name, f.folders])).toEqual([["a.pdf", []]]);
  });
  it("改名", () => {
    let { lib, research } = tree();
    lib = renameEntry(lib, research, "Papers");
    expect(lib.folders.find((f) => f.id === research)?.name).toBe("Papers");
    expect(renameEntry(lib, research, "  ")).toBe(lib);
  });
});

describe("檔案庫：垃圾桶、標籤、搜尋、排序", () => {
  it("刪除先進垃圾桶，可以還原；永久刪除與清空垃圾桶", () => {
    const r = addFiles(emptyLibrary(), null, [{ name: "a.pdf", src: A }, { name: "b.png", src: B }], 1);
    let lib = setFilesTrashed(r.lib, r.ids, true, 2);
    expect(lib.files.every((f) => f.trashed)).toBe(true);
    lib = setFilesTrashed(lib, [r.ids[0]], false, 3);
    expect(lib.files[0].trashed).toBeUndefined();
    expect(deleteFiles(lib, [r.ids[0]]).files.map((f) => f.name)).toEqual(["b.png"]);
    expect(emptyFileTrash(lib).files.map((f) => f.name)).toEqual(["a.pdf"]);
  });
  it("標籤：篩選、計數（垃圾桶不算）、改名合併與刪除", () => {
    const r = addFiles(emptyLibrary(), null, [{ name: "a.pdf", src: A }, { name: "b.png", src: B }, { name: "c.png", src: B }], 1);
    let lib = setFileTags(r.lib, r.ids[0], ["paper", " draft ", "paper"]);
    lib = setFileTags(lib, r.ids[1], ["figure"]);
    lib = setFileTags(lib, r.ids[2], ["figure"]);
    lib = setFilesTrashed(lib, [r.ids[2]], true);
    expect(lib.files[0].tags).toEqual(["paper", "draft"]);
    expect(fileTags(lib)).toEqual([
      { tag: "draft", count: 1 },
      { tag: "figure", count: 1 },
      { tag: "paper", count: 1 },
    ]);
    expect(names(lib, { kind: "all" }, "", ["figure"])).toEqual(["b.png"]);
    expect(names(lib, { kind: "all" }, "draft")).toEqual(["a.pdf"]);
    lib = renameFileTag(lib, "draft", "paper");
    expect(lib.files[0].tags).toEqual(["paper"]);
    lib = renameFileTag(lib, "figure", "");
    expect(lib.files[1].tags).toEqual([]);
  });
  it("排序：名稱、加入日期、大小", () => {
    let lib = addFiles(emptyLibrary(), null, [{ name: "b.pdf", src: A, size: 10 }], 2).lib;
    lib = addFiles(lib, null, [{ name: "a10.png", src: B, size: 30 }, { name: "a9.png", src: B, size: 20 }], 1).lib;
    const by = (k: Parameters<typeof sortFiles>[1], desc = false) => sortFiles(lib.files, k, desc).map((f) => f.name);
    expect(by("name")).toEqual(["a9.png", "a10.png", "b.pdf"]);
    expect(by("added", true)[0]).toBe("b.pdf");
    expect(by("size", true)).toEqual(["a10.png", "a9.png", "b.pdf"]);
  });
});

describe("檔案庫：存檔", () => {
  it("資料夾與檔案寫進 library.json 再讀回來", () => {
    let { lib, y2026, research } = tree();
    const r = addFiles(lib, y2026, [{ name: "a.pdf", src: A, size: 1234 }], 5);
    lib = setFileTags(addToFolder(r.lib, r.ids, research), r.ids[0], ["x"]);
    lib = setFilesTrashed(lib, r.ids, true);
    const back = parseLibrary(serializeLibrary(lib));
    expect(back.folders).toEqual(lib.folders);
    expect(back.files).toEqual(lib.files);
  });
  it("舊版的 folder（一個）變成 folders；壞掉的資料：父資料夾不存在、迴圈、沒有 src", () => {
    const back = parseLibrary(
      JSON.stringify({
        items: [],
        folders: [
          { id: "x", name: "X", parent: "y" },
          { id: "y", name: "Y", parent: "x" },
          { id: "z", name: "Z", parent: "nope" },
        ],
        files: [{ id: "1", name: "a", src: A, folder: "gone" }, { id: "2", name: "b" }, { id: "3", name: "c", src: B, folder: "z", tags: ["t", 3] }],
      }),
    );
    expect(back.folders.find((f) => f.id === "z")?.parent).toBeNull();
    // 迴圈被切斷：至少有一個回到最上層
    expect(back.folders.some((f) => (f.id === "x" || f.id === "y") && f.parent === null)).toBe(true);
    expect(back.files.map((f) => [f.id, f.folders, f.tags])).toEqual([
      ["1", [], []],
      ["3", ["z"], ["t"]],
    ]);
  });
  it("舊的文獻庫（沒有檔案庫）照常讀；記住的範圍讀回來", () => {
    const back = parseLibrary(JSON.stringify({ items: [], collections: [] }));
    expect(back.folders).toEqual([]);
    expect(back.files).toEqual([]);
    const { lib, research } = tree();
    expect(fileScopeFrom(`f:${research}`, lib)).toEqual({ kind: "folder", id: research });
    expect(fileScopeFrom(research, lib)).toEqual({ kind: "folder", id: research });
    expect(fileScopeFrom("f:gone", lib)).toEqual({ kind: "all" });
    expect(fileScopeFrom("trash", lib)).toEqual({ kind: "trash" });
  });
});

describe("重複內容", () => {
  it("指紋：media 的雜湊不看副檔名；data URL 看資料", () => {
    expect(fingerprint("media/00000000000000AA.pdf")).toBe(fingerprint("media/00000000000000aa.PDF"));
    expect(fingerprint("media/00000000000000aa.pdf")).not.toBe(fingerprint("media/00000000000000ab.pdf"));
    expect(fingerprint("data:application/pdf;base64,QUJD")).toBe(fingerprint("data:application/octet-stream;base64,QUJD"));
    expect(fingerprint("data:image/png;base64,QUJD")).not.toBe(fingerprint("data:image/png;base64,QUJE"));
  });
  it("找到檔案庫與條目附件裡的同一份檔案", () => {
    let { lib, y2026 } = tree();
    lib = addFiles(lib, y2026, [{ name: "paper.pdf", src: A }], 5).lib;
    const it1 = blankItem("article", 6);
    it1.title = "Paper";
    it1.attachments = [{ id: "a1", name: "paper-final.pdf", src: A, kind: "file", added: 6 }];
    lib = { ...lib, items: [it1] };
    const where = locate(lib, A);
    expect(where.map((p) => p.kind)).toEqual(["file", "attachment"]);
    expect(locate(lib, B)).toEqual([]);
  });
  it("加入前檢查：已經有的、同一批重複的", () => {
    let lib = addFiles(emptyLibrary(), null, [{ name: "a.pdf", src: A }], 1).lib;
    const checks = checkDuplicates(lib, [
      { name: "copy of a.pdf", src: A },
      { name: "b.png", src: B },
      { name: "b again.png", src: B },
    ]);
    expect(checks.map((c) => [c.entry.name, c.sameBatch])).toEqual([
      ["copy of a.pdf", false],
      ["b again.png", true],
    ]);
  });
  it("重複群組與要拿掉的多餘副本（留最早的）", () => {
    let lib = addFiles(emptyLibrary(), null, [{ name: "a.pdf", src: A }], 1).lib;
    const { research } = (() => {
      const r = addFolder(lib, null, "R", 2);
      lib = r.lib;
      return { research: r.id };
    })();
    lib = addFiles(lib, research, [{ name: "a copy.pdf", src: A }], 3).lib;
    lib = addFiles(lib, research, [{ name: "b.png", src: B }], 3).lib;
    const groups = duplicateGroups(lib);
    expect(groups.length).toBe(1);
    expect(groups[0].map((p) => (p.kind === "file" ? p.file.name : ""))).toEqual(["a.pdf", "a copy.pdf"]);
    expect(extraCopies(groups[0]).map((f) => f.name)).toEqual(["a copy.pdf"]);
  });
  it("垃圾桶裡的檔案不算重複；重複工具拿掉檔案是移到垃圾桶", () => {
    let lib = addFiles(emptyLibrary(), null, [{ name: "a.pdf", src: A }, { name: "a copy.pdf", src: A }], 1).lib;
    const g = duplicateGroups(lib)[0];
    lib = removePlace(lib, g[1]);
    expect(lib.files[1].trashed).toBe(true);
    expect(duplicateGroups(lib)).toEqual([]);
    expect(locate(lib, A).length).toBe(2);
  });
});

describe("顯示", () => {
  it("類型與大小", () => {
    expect(fileKind("x.PDF")).toBe("pdf");
    expect(typeName("x.pdf")).toBe("PDF Document");
    expect(typeName("x.png")).toBe("PNG Image");
    expect(typeName("x.xyz")).toBe("XYZ File");
    expect(typeName("README")).toBe("File");
    expect(formatSize(0)).toBe("");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("附件與檔案庫", () => {
  const withItem = (lib: Library, att?: { name: string; src: string; file?: string }) => {
    const it = blankItem("article", 5);
    it.title = "Paper";
    if (att) it.attachments = [{ id: "a1", kind: "file", added: 4, ...att }];
    return { lib: { ...lib, items: [...lib.items, it] }, id: it.id };
  };

  it("檔案附件自動存進檔案庫（Unfiled），連到那一筆；已經連好的不動", () => {
    const { lib } = withItem(emptyLibrary(), { name: "paper.pdf", src: A });
    expect(hasUnlinked(lib)).toBe(true);
    const out = linkAttachments(lib, 9);
    expect(out.files.map((f) => [f.name, f.folders, f.added])).toEqual([["paper.pdf", [], 4]]);
    expect(out.items[0].attachments[0].file).toBe(out.files[0].id);
    expect(hasUnlinked(out)).toBe(false);
    expect(linkAttachments(out)).toBe(out);
    // 存檔再讀回來，連結還在
    expect(parseLibrary(serializeLibrary(out)).items[0].attachments[0].file).toBe(out.files[0].id);
  });
  it("檔案庫已經有同樣內容就連到它（不另外存；在垃圾桶就拿出來）", () => {
    const r = addFiles(emptyLibrary(), null, [{ name: "final.pdf", src: A }], 1);
    let { lib } = withItem(setFilesTrashed(r.lib, r.ids, true), { name: "paper.pdf", src: A });
    lib = linkAttachments(lib);
    expect(lib.files.length).toBe(1);
    expect(lib.files[0].trashed).toBeUndefined();
    expect(lib.items[0].attachments[0].file).toBe(r.ids[0]);
    expect(duplicateGroups(lib)).toEqual([]);
    expect(checkDuplicates(lib, [{ name: "x.pdf", src: A }])[0].existing.map((p) => p.kind)).toEqual(["file"]);
  });
  it("檔案庫的檔案附加到條目；同一個條目不重複加", () => {
    const r = addFiles(emptyLibrary(), null, [{ name: "a.pdf", src: A }], 1);
    let { lib, id } = withItem(r.lib);
    lib = attachFile(lib, id, r.ids[0], 7);
    expect(lib.items[0].attachments.map((a) => [a.name, a.src, a.file])).toEqual([["a.pdf", A, r.ids[0]]]);
    expect(attachFile(lib, id, r.ids[0])).toBe(lib);
    expect(attachedTo(lib, r.ids[0]).map((x) => x.item.id)).toEqual([id]);
  });
  it("拿掉附件檔案留著；永久刪除檔案連同附件", () => {
    const linked = linkAttachments(withItem(emptyLibrary(), { name: "paper.pdf", src: A }).lib);
    const fid = linked.files[0].id;
    const trashed = setFilesTrashed(linked, [fid], true);
    expect(trashed.items[0].attachments.length).toBe(1);
    const gone = emptyFileTrash(trashed);
    expect(gone.files).toEqual([]);
    expect(gone.items[0].attachments).toEqual([]);
    expect(hasUnlinked(gone)).toBe(false);
  });
});
