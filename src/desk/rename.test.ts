// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { docRenames, renameDocInLinks, renameFileInLinks } from "./docLinks";
import { localDeskStore, renameFileState, loadDockDoc, saveDockDoc } from "./store";
import { renameFileTargets, type NavTarget } from "../shell/nav";
import { localHistoryFiles, VersionLog } from "../history/store";

describe("Desk 檔案改名", () => {
  it("改寫連到這個檔案文件的連結，別的不動", () => {
    const src = [
      "See [[Trip/Budget]] and [[trip/plan v2]].",
      "Page [[Trip/Notes]] is a page, [[Other/Budget]] another file.",
      "```",
      "[[Trip/Budget]] in code",
      "```",
    ].join("\n");
    const out = renameFileInLinks(src, "Trip", "Japan_2026", ["Budget", "Plan v2"]);
    expect(out.split("\n")[0]).toBe("See [[Japan\\_2026/Budget]] and [[Japan\\_2026/plan v2]].");
    expect(out.split("\n")[1]).toBe("Page [[Trip/Notes]] is a page, [[Other/Budget]] another file.");
    expect(out.split("\n")[3]).toBe("[[Trip/Budget]] in code");
    const same = "Nothing [[Here]]";
    expect(renameFileInLinks(same, "Trip", "X", ["Budget"])).toBe(same);
  });

  it("Dock 文件改名：找出改了標題的文件，改寫連結", () => {
    const before = { docs: [{ id: "a", title: "Budget" }, { id: "b", title: "Plan" }, { id: "c", title: "budget" }] };
    // c 和 a 同名，連結連到 a，所以 c 改名不算
    const after = { docs: [{ id: "a", title: "Costs" }, { id: "b", title: "Plan" }, { id: "c", title: "Other" }] };
    const renames = docRenames(before, after);
    expect(renames).toEqual([{ from: "Budget", to: "Costs" }]);
    expect(docRenames(before, before)).toEqual([]);
    const src = "See [[trip/budget]], [[Trip/Plan]], [[Work/Budget]] and [[Trip/Budget\\_x]].";
    expect(renameDocInLinks(src, "Trip", renames)).toBe("See [[trip/Costs]], [[Trip/Plan]], [[Work/Budget]] and [[Trip/Budget\\_x]].");
    expect(renameDocInLinks(src, "Trip", [{ from: "Plan", to: "My_plan" }])).toBe(
      "See [[trip/budget]], [[Trip/My\\_plan]], [[Work/Budget]] and [[Trip/Budget\\_x]].",
    );
  });

  it("收藏、最近換成新名稱", () => {
    const list: NavTarget[] = [{ kind: "file", name: "Trip" }, { kind: "doc", file: "Trip", id: "a" }, { kind: "page", name: "Trip" }];
    expect(renameFileTargets(list, "Trip", "Japan")).toEqual([
      { kind: "file", name: "Japan" },
      { kind: "doc", file: "Japan", id: "a" },
      { kind: "page", name: "Trip" },
    ]);
    expect(renameFileTargets(list, "None", "X")).toBe(list);
  });

  it("瀏覽器的儲存：搬內容，新名稱已經有檔案就失敗", async () => {
    const store = localDeskStore(localStorage, "t.desk.");
    await store.write("A", "{}");
    await store.write("B", "{}");
    await expect(store.rename!("A", "B")).rejects.toThrow();
    await store.rename!("A", "C");
    expect(await store.list()).toEqual(["B", "C"]);
    localStorage.clear();
  });

  it("個人狀態跟著搬", () => {
    saveDockDoc("Trip", "d1");
    renameFileState("Trip", "Japan");
    expect(loadDockDoc("Japan")).toBe("d1");
    expect(loadDockDoc("Trip")).toBeNull();
    localStorage.clear();
  });

  it("版本歷史搬到新名稱", async () => {
    let t = 1_000_000;
    const log = new VersionLog("desk", localHistoryFiles(localStorage), () => (t += 60 * 60_000));
    await log.record("Trip", "one");
    await log.record("Trip", "two");
    const before = await log.list("Trip");
    expect(before.length).toBeGreaterThan(0);
    await log.move("Trip", "Japan", true);
    expect(await log.list("Trip")).toEqual([]);
    const after = await log.list("Japan");
    expect(after).toEqual(before);
    expect(await log.read("Japan", after[after.length - 1].id)).toBe("two");
    localStorage.clear();
  });
});
