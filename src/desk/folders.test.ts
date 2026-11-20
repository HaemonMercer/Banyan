import { describe, expect, it } from "vitest";
import {
  addDoc,
  addFolder,
  dockOrder,
  dockOutline,
  emptyFile,
  folderOf,
  keepFolder,
  moveDocs,
  moveFolder,
  parseFile,
  placeDocs,
  removeDocs,
  removeFolder,
  renameFolder,
  serializeFile,
  type DeskFile,
} from "./file";
import { fileDocLinks } from "./docLinks";

/** 三份文件 A、B、C 的檔案 */
function abc(): { f: DeskFile; a: string; b: string; c: string } {
  let f = emptyFile();
  const ids: string[] = [];
  for (const t of ["A", "B", "C"]) {
    const r = addDoc(f, "note", t);
    f = r.file;
    ids.push(r.id);
  }
  return { f, a: ids[0], b: ids[1], c: ids[2] };
}

const titles = (f: DeskFile) => dockOrder(f).map((d) => d.title);

describe("Dock 的資料夾", () => {
  it("新增資料夾：名稱不重複，可以把文件一起搬進去", () => {
    const { f, b, c } = abc();
    const one = addFolder(f, undefined, [c]);
    expect(one.file.folders).toEqual([{ id: one.id, name: "New folder" }]);
    const two = addFolder(one.file);
    expect(two.file.folders?.[1].name).toBe("New folder 2");
    const o = dockOutline(two.file);
    expect(o.folders.map((x) => x.docs.map((d) => d.title))).toEqual([["C"], []]);
    expect(o.loose.map((d) => d.title)).toEqual(["A", "B"]);
    // 資料夾排在前面
    expect(titles(two.file)).toEqual(["C", "A", "B"]);
    expect(folderOf(two.file, two.file.docs.find((d) => d.id === b)!)).toBeNull();
  });

  it("placeDocs：搬進、搬出、排在某份前面", () => {
    const { f, a, b, c } = abc();
    const { file, id } = addFolder(f, "Drafts");
    let g = placeDocs(file, [c, a], id, null);
    expect(dockOutline(g).folders[0].docs.map((d) => d.title)).toEqual(["A", "C"]);
    g = placeDocs(g, [b], id, a);
    expect(dockOutline(g).folders[0].docs.map((d) => d.title)).toEqual(["B", "A", "C"]);
    // 排在自己前面：位置不變
    expect(titles(placeDocs(g, [a], id, a))).toEqual(["B", "A", "C"]);
    g = placeDocs(g, [a], null, null);
    expect(g.docs.find((d) => d.id === a)).not.toHaveProperty("folder");
    expect(titles(g)).toEqual(["B", "C", "A"]);
    // 不存在的資料夾：不動
    expect(placeDocs(g, [a], "nope", null)).toBe(g);
  });

  it("改名、排序資料夾", () => {
    let f = addFolder(emptyFile(), "One").file;
    f = addFolder(f, "Two").file;
    const two = f.folders![1].id;
    f = renameFolder(f, two, "  Second ");
    expect(f.folders!.map((x) => x.name)).toEqual(["One", "Second"]);
    expect(renameFolder(f, two, "  ")).toBe(f);
    f = moveFolder(f, two, 0);
    expect(f.folders!.map((x) => x.name)).toEqual(["Second", "One"]);
  });

  it("刪掉資料夾：文件搬出來或一起刪", () => {
    const { f, a, b } = abc();
    const { file, id } = addFolder(f, "X", [a, b]);
    const out = removeFolder(file, id);
    expect(out.folders).toBeUndefined();
    expect(out.docs.map((d) => d.title)).toEqual(["C", "A", "B"]);
    expect(out.docs.some((d) => d.folder)).toBe(false);
    const gone = removeFolder(file, id, true);
    expect(gone.docs.map((d) => d.title)).toEqual(["C"]);
  });

  it("存檔再讀回來；舊檔案沒有資料夾；指向不存在資料夾的文件算在外面", () => {
    const { f, a } = abc();
    const { file, id } = addFolder(f, "Notes", [a]);
    const back = parseFile(serializeFile(file));
    expect(back.folders).toEqual([{ id, name: "Notes" }]);
    expect(back.docs.find((d) => d.id === a)?.folder).toBe(id);

    const old = parseFile(JSON.stringify({ board: {}, docs: [{ id: "d1", title: "Old", kind: "note", content: "" }] }));
    expect(old.folders).toBeUndefined();
    expect(serializeFile(old)).not.toContain("folders");

    const stray = parseFile(JSON.stringify({ docs: [{ id: "d1", title: "T", kind: "note", content: "", folder: "missing" }], folders: [{ id: 3 }, "x"] }));
    expect(stray.docs[0].folder).toBeUndefined();
    expect(stray.folders).toBeUndefined();
  });

  it("其他文件操作保留資料夾", () => {
    const { f, a, b } = abc();
    const { file, id } = addFolder(f, "K", [a]);
    expect(moveDocs(file, [a], 3).docs.find((d) => d.id === a)?.folder).toBe(id);
    expect(removeDocs(file, [b]).folders).toHaveLength(1);
  });

  it("還原舊版本：保留現在的資料夾", () => {
    const old = { id: "d", title: "T", kind: "note" as const, content: "old", folder: "x" };
    expect(keepFolder(old, { ...old, content: "new", folder: "y" })).toEqual({ ...old, folder: "y" });
    expect(keepFolder(old, { id: "d", title: "T", kind: "note", content: "new" })).not.toHaveProperty("folder");
  });

  it("連結清單照 Dock 的順序，名稱不受資料夾影響", () => {
    const { f, c } = abc();
    const g = addFolder(f, "Box", [c]).file;
    const links = fileDocLinks("Proj", serializeFile(g));
    expect(links.map((l) => l.name)).toEqual(["Proj/C", "Proj/A", "Proj/B"]);
    expect(dockOrder(g).map((d) => d.id)).toEqual(links.map((l) => l.id));
  });
});
