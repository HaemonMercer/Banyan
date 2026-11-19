import { describe, expect, it } from "vitest";
import {
  addFiles,
  addFolder,
  checkDuplicates,
  cleanName,
  countRemoved,
  duplicateGroups,
  extraCopies,
  fileKind,
  filesIn,
  fingerprint,
  folderPath,
  formatSize,
  locate,
  moveEntries,
  pathLabel,
  removeEntries,
  renameEntry,
  searchFiles,
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

describe("檔案庫：名稱", () => {
  it("同資料夾撞名加 (2)、(3)，不分大小寫", () => {
    expect(uniqueName("a.pdf", [])).toBe("a.pdf");
    expect(uniqueName("a.pdf", ["A.PDF"])).toBe("a (2).pdf");
    expect(uniqueName("a.pdf", ["a.pdf", "a (2).pdf"])).toBe("a (3).pdf");
    expect(uniqueName("a (2).pdf", ["a (2).pdf"])).toBe("a (3).pdf");
    expect(uniqueName("New folder", ["New folder"])).toBe("New folder (2)");
  });
  it("Windows 不能用的字元換掉", () => {
    expect(cleanName(' a/b:c*?"<>|. ')).toBe("a_b_c______");
  });
  it("資料夾與檔案共用名稱", () => {
    let { lib } = tree();
    lib = addFiles(lib, null, [{ name: "Research", src: A }], 3).lib;
    expect(filesIn(lib, null)[0].name).toBe("Research (2)");
  });
});

describe("檔案庫：資料夾", () => {
  it("路徑與位置", () => {
    const { lib, y2026 } = tree();
    expect(folderPath(lib, y2026).map((f) => f.name)).toEqual(["Research", "2026"]);
    expect(pathLabel(lib, y2026)).toBe("My Files › Research › 2026");
    expect(pathLabel(lib, null)).toBe("My Files");
  });
  it("不能搬進自己的子資料夾；搬動時撞名改名", () => {
    let { lib, research, y2026 } = tree();
    expect(moveEntries(lib, [research], y2026)).toBe(lib);
    lib = addFolder(lib, null, "2026", 4).lib;
    lib = moveEntries(lib, [y2026], null);
    expect(lib.folders.find((f) => f.id === y2026)).toMatchObject({ parent: null, name: "2026 (2)" });
  });
  it("刪資料夾連同裡面的檔案", () => {
    let { lib, research, y2026 } = tree();
    lib = addFiles(lib, y2026, [{ name: "a.pdf", src: A }], 5).lib;
    lib = addFiles(lib, null, [{ name: "b.png", src: B }], 5).lib;
    expect(countRemoved(lib, [research])).toEqual({ folders: 2, files: 1 });
    lib = removeEntries(lib, [research]);
    expect(lib.folders).toEqual([]);
    expect(lib.files.map((f) => f.name)).toEqual(["b.png"]);
  });
  it("改名", () => {
    let { lib, research } = tree();
    lib = renameEntry(lib, research, "Papers");
    expect(lib.folders.find((f) => f.id === research)?.name).toBe("Papers");
    expect(renameEntry(lib, research, "  ")).toBe(lib);
  });
  it("搜尋包含子資料夾", () => {
    let { lib, research, y2026 } = tree();
    lib = addFiles(lib, y2026, [{ name: "Deep Learning.pdf", src: A }], 5).lib;
    lib = addFiles(lib, null, [{ name: "deep sea.png", src: B }], 5).lib;
    expect(searchFiles(lib, research, "deep").files.map((f) => f.name)).toEqual(["Deep Learning.pdf"]);
    expect(searchFiles(lib, null, "deep").files.length).toBe(2);
    expect(searchFiles(lib, null, "20").folders.map((f) => f.name)).toEqual(["2026"]);
  });
});

describe("檔案庫：存檔", () => {
  it("資料夾與檔案寫進 library.json 再讀回來", () => {
    let { lib, y2026 } = tree();
    lib = addFiles(lib, y2026, [{ name: "a.pdf", src: A, size: 1234 }], 5).lib;
    const back = parseLibrary(serializeLibrary(lib));
    expect(back.folders).toEqual(lib.folders);
    expect(back.files).toEqual(lib.files);
  });
  it("壞掉的資料：父資料夾不存在、迴圈、沒有 src", () => {
    const back = parseLibrary(
      JSON.stringify({
        items: [],
        folders: [
          { id: "x", name: "X", parent: "y" },
          { id: "y", name: "Y", parent: "x" },
          { id: "z", name: "Z", parent: "nope" },
        ],
        files: [{ id: "1", name: "a", src: A, folder: "gone" }, { id: "2", name: "b" }],
      }),
    );
    expect(back.folders.find((f) => f.id === "z")?.parent).toBeNull();
    // 迴圈被切斷：至少有一個回到最上層
    expect(back.folders.some((f) => (f.id === "x" || f.id === "y") && f.parent === null)).toBe(true);
    expect(back.files.map((f) => [f.id, f.folder])).toEqual([["1", null]]);
  });
  it("舊的文獻庫（沒有檔案庫）照常讀", () => {
    const back = parseLibrary(JSON.stringify({ items: [], collections: [] }));
    expect(back.folders).toEqual([]);
    expect(back.files).toEqual([]);
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
