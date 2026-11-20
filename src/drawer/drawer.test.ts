import { describe, expect, it } from "vitest";
import {
  bibliography,
  delatex,
  fromCsl,
  initials,
  inText,
  noteTemplate,
  parseBibtex,
  parseImport,
  reference,
  toBibtex,
  toHtml,
  toMarkdown,
  toText,
} from "./cite";
import { fromOpenLibrary, lookup, parseIdentifier, validIsbn } from "./lookup";
import {
  addCollection,
  addItems,
  addToCollection,
  allTags,
  blankItem,
  creatorSummary,
  descendants,
  emptyLibrary,
  emptyTrash,
  filterItems,
  findDuplicate,
  makeKey,
  moveCollection,
  parseLibrary,
  parseName,
  parseNames,
  removeCollection,
  renameTag,
  serializeLibrary,
  setTrashed,
  sortItems,
  updateItem,
  type Item,
  type Library,
} from "./model";
import { localDrawerStore, LIBRARY } from "./store";

function item(p: Partial<Item>): Item {
  return { ...blankItem("article", 1), ...p };
}

const smith = item({
  type: "article",
  title: "Deep learning for sparse signals",
  creators: [
    { family: "Smith", given: "John Ronald", role: "author" },
    { family: "Lee", given: "Ann", role: "author" },
  ],
  date: "2020-05-17",
  container: "Journal of Signals",
  volume: "12",
  issue: "3",
  pages: "45-67",
  doi: "10.1000/xyz123",
});

describe("Drawer：文獻庫", () => {
  it("存檔後讀回相同的內容；空的文獻庫是空字串", () => {
    let lib = addItems(emptyLibrary(), [smith], 5);
    const { lib: l2, id } = addCollection(lib, "Thesis");
    lib = addToCollection(l2, [lib.items[0].id], id, 6);
    const back = parseLibrary(serializeLibrary(lib));
    expect(back).toEqual(lib);
    expect(serializeLibrary(emptyLibrary())).toBe("");
    expect(parseLibrary("")).toEqual(emptyLibrary());
    expect(parseLibrary("not json")).toEqual(emptyLibrary());
  });

  it("讀檔時補齊欄位、拿掉不存在的收藏", () => {
    const lib = parseLibrary(
      JSON.stringify({ items: [{ id: "x", title: "T", type: "weird", collections: ["gone"], tags: ["a", "a", " "] }], collections: [{ id: "c", name: "C", parent: "missing" }] }),
    );
    expect(lib.items[0].type).toBe("other");
    expect(lib.items[0].collections).toEqual([]);
    expect(lib.items[0].tags).toEqual(["a"]);
    expect(lib.items[0].creators).toEqual([]);
    expect(lib.collections[0].parent).toBeNull();
  });

  it("作者名字：逗號、空白、中文", () => {
    expect(parseName("Smith, John")).toEqual({ family: "Smith", given: "John", role: "author" });
    expect(parseName("John Ronald Smith")).toEqual({ family: "Smith", given: "John Ronald", role: "author" });
    expect(parseName("王小明")).toEqual({ family: "王小明", given: "", role: "author" });
    expect(parseNames("Smith, J.; Lee, A. and Kim, B.").map((c) => c.family)).toEqual(["Smith", "Lee", "Kim"]);
    expect(creatorSummary(smith)).toBe("Smith and Lee");
    expect(creatorSummary(item({ creators: [...smith.creators, { family: "Kim", given: "", role: "author" }] }))).toBe("Smith et al.");
  });

  it("引用鍵：姓＋年份＋標題第一個有意義的字，重複的加字母", () => {
    expect(makeKey(smith, [])).toBe("smith2020deep");
    expect(makeKey(smith, ["smith2020deep"])).toBe("smith2020deepa");
    expect(makeKey(smith, ["Smith2020Deep", "smith2020deepa"])).toBe("smith2020deepb");
    expect(makeKey(item({ title: "The Art of War", creators: [{ family: "Müller", given: "", role: "author" }], date: "1999" }), [])).toBe("muller1999art");
    expect(makeKey(item({}), [])).toBe("item");
    const lib = addItems(emptyLibrary(), [smith, { ...smith, id: "other" }]);
    expect(lib.items.map((i) => i.key).sort()).toEqual(["smith2020deep", "smith2020deepa"]);
  });

  it("改引用鍵：不能重複、不能是空的", () => {
    let lib = addItems(emptyLibrary(), [item({ id: "a", key: "one" }), item({ id: "b", key: "two" })]);
    lib = updateItem(lib, "a", { key: "TWO" });
    expect(lib.items.find((i) => i.id === "a")!.key).toBe("one");
    lib = updateItem(lib, "a", { key: "  " });
    expect(lib.items.find((i) => i.id === "a")!.key).toBe("one");
    lib = updateItem(lib, "a", { key: "new key[x]" });
    expect(lib.items.find((i) => i.id === "a")!.key).toBe("newkeyx");
  });

  it("收藏：巢狀、刪除連同子收藏、不能搬進自己底下", () => {
    let lib: Library = addItems(emptyLibrary(), [item({ id: "i1" }), item({ id: "i2" })]);
    const a = addCollection(lib, "A");
    const b = addCollection(a.lib, "B", a.id);
    const c = addCollection(b.lib, "C", b.id);
    lib = addToCollection(c.lib, ["i1"], c.id);
    lib = addToCollection(lib, ["i2"], a.id);
    expect([...descendants(lib, a.id)].sort()).toEqual([a.id, b.id, c.id].sort());
    expect(filterItems(lib, { kind: "collection", id: a.id }, "", []).map((i) => i.id).sort()).toEqual(["i1", "i2"]);
    expect(filterItems(lib, { kind: "collection", id: b.id }, "", []).map((i) => i.id)).toEqual(["i1"]);
    expect(moveCollection(lib, a.id, c.id)).toBe(lib);
    lib = removeCollection(lib, b.id);
    expect(lib.collections.map((x) => x.id)).toEqual([a.id]);
    expect(lib.items.find((i) => i.id === "i1")!.collections).toEqual([]);
    expect(filterItems(lib, { kind: "unfiled" }, "", []).map((i) => i.id)).toEqual(["i1"]);
  });

  it("垃圾桶：不在全部裡、還原、清空", () => {
    let lib = addItems(emptyLibrary(), [item({ id: "a" }), item({ id: "b" })]);
    lib = setTrashed(lib, ["a"], true);
    expect(filterItems(lib, { kind: "all" }, "", []).map((i) => i.id)).toEqual(["b"]);
    expect(filterItems(lib, { kind: "trash" }, "", []).map((i) => i.id)).toEqual(["a"]);
    expect(setTrashed(lib, ["a"], false).items.find((i) => i.id === "a")!.trashed).toBeUndefined();
    expect(emptyTrash(lib).items.map((i) => i.id)).toEqual(["b"]);
  });

  it("搜尋與標籤篩選；改標籤名稱與合併", () => {
    let lib = addItems(emptyLibrary(), [
      item({ id: "a", title: "Sparse coding", tags: ["ml", "signals"], creators: [{ family: "Smith", given: "J", role: "author" }] }),
      item({ id: "b", title: "Graph theory", tags: ["math"], date: "2001" }),
    ]);
    expect(filterItems(lib, { kind: "all" }, "smith sparse", []).map((i) => i.id)).toEqual(["a"]);
    expect(filterItems(lib, { kind: "all" }, "2001", []).map((i) => i.id)).toEqual(["b"]);
    expect(filterItems(lib, { kind: "all" }, "", ["ml"]).map((i) => i.id)).toEqual(["a"]);
    lib = renameTag(lib, "signals", "ml");
    expect(lib.items.find((i) => i.id === "a")!.tags).toEqual(["ml"]);
    lib = renameTag(lib, "math", "");
    expect(allTags(lib)).toEqual([{ tag: "ml", count: 1 }]);
  });

  it("排序：空的排在最後", () => {
    const items = [item({ id: "a", date: "2010" }), item({ id: "b", date: "" }), item({ id: "c", date: "2020" })];
    expect(sortItems(items, "year", false).map((i) => i.id)).toEqual(["a", "c", "b"]);
    expect(sortItems(items, "year", true).map((i) => i.id)).toEqual(["c", "a", "b"]);
  });

  it("重複：DOI、ISBN、標題＋年份", () => {
    const lib = addItems(emptyLibrary(), [smith]);
    expect(findDuplicate(lib, item({ doi: "10.1000/XYZ123" }))).toBeTruthy();
    expect(findDuplicate(lib, item({ title: "Deep Learning for Sparse Signals!", date: "2020" }))).toBeTruthy();
    expect(findDuplicate(lib, item({ title: "Deep Learning for Sparse Signals", date: "2021" }))).toBeUndefined();
  });

  it("瀏覽器預覽的儲存", async () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    } as unknown as Storage;
    const store = localDrawerStore(storage);
    expect(await store.list()).toEqual([]);
    await store.write(LIBRARY, "{}");
    expect(await store.list()).toEqual([LIBRARY]);
    expect(await store.read(LIBRARY)).toBe("{}");
    await store.write(LIBRARY, "");
    expect(await store.list()).toEqual([]);
  });
});

describe("Drawer：引用格式", () => {
  it("名字縮寫", () => {
    expect(initials("John Ronald")).toBe("J. R.");
    expect(initials("Jean-Paul")).toBe("J.-P.");
  });

  it("APA：期刊文章", () => {
    expect(toText(reference(smith, "apa"))).toBe(
      "Smith, J. R., & Lee, A. (2020). Deep learning for sparse signals. Journal of Signals, 12(3), 45–67. https://doi.org/10.1000/xyz123",
    );
    expect(toHtml(reference(smith, "apa"))).toContain("<i>Journal of Signals</i>, <i>12</i>(3)");
    expect(inText(smith, "apa")).toBe("(Smith & Lee, 2020)");
  });

  it("APA：書、沒有日期、沒有作者", () => {
    const book = item({ type: "book", title: "Thinking in Systems", creators: [{ family: "Meadows", given: "Donella H.", role: "author" }], publisher: "Chelsea Green", edition: "2nd" });
    expect(toText(reference(book, "apa"))).toBe("Meadows, D. H. (n.d.). Thinking in Systems (2nd ed.). Chelsea Green.");
    const anon = item({ type: "webpage", title: "Style guide", container: "Example Site", date: "2023-04-02", url: "https://example.com/style" });
    expect(toText(reference(anon, "apa"))).toBe("Style guide. (2023, April 2). Example Site. https://example.com/style");
    expect(inText(anon, "apa")).toBe("(“Style guide”, 2023)");
  });

  it("APA：書的章節（編者）", () => {
    const ch = item({
      type: "chapter",
      title: "On methods",
      creators: [
        { family: "Kim", given: "Bo", role: "author" },
        { family: "Park", given: "Ji Woo", role: "editor" },
      ],
      container: "Handbook of Research",
      pages: "10-20",
      publisher: "Sage",
      date: "2019",
    });
    expect(toText(reference(ch, "apa"))).toBe("Kim, B. (2019). On methods. In J. W. Park (Ed.), Handbook of Research (pp. 10–20). Sage.");
  });

  it("APA：中文作者不縮寫", () => {
    const zh = item({ type: "book", title: "臺灣史", creators: [{ family: "王", given: "小明", role: "author" }], date: "2018", publisher: "聯經" });
    expect(toText(reference(zh, "apa"))).toBe("王小明. (2018). 臺灣史. 聯經.");
  });

  it("MLA：期刊文章", () => {
    expect(toText(reference(smith, "mla"))).toBe(
      "Smith, John Ronald, and Ann Lee. “Deep learning for sparse signals.” Journal of Signals, vol. 12, no. 3, 2020, pp. 45–67, https://doi.org/10.1000/xyz123.",
    );
    expect(inText(smith, "mla")).toBe("(Smith and Lee)");
  });

  it("參考文獻依作者排序；Markdown 的斜體", () => {
    const b = item({ title: "B", creators: [{ family: "Adams", given: "", role: "author" }], date: "2000", container: "J" });
    const refs = bibliography([smith, b], "apa").map(toText);
    expect(refs[0].startsWith("Adams")).toBe(true);
    expect(toMarkdown([{ text: "A " }, { text: "Journal_1 ", italic: true }, { text: "x" }])).toBe("A *Journal\\_1* x");
    expect(noteTemplate(smith)).toMatch(/^> Smith, J\. R\., & Lee, A\. \(2020\)\. .*\*Journal of Signals\*/);
  });

  it("BibTeX：匯出再匯入", () => {
    const withKey = { ...smith, key: "smith2020deep", tags: ["ml"] };
    const bib = toBibtex([withKey]);
    expect(bib).toContain("@article{smith2020deep,");
    expect(bib).toContain("author = {Smith, John Ronald and Lee, Ann}");
    expect(bib).toContain("pages = {45--67}");
    const [back] = parseBibtex(bib);
    expect(back.key).toBe("smith2020deep");
    expect(back.title).toBe(smith.title);
    expect(back.creators).toEqual(smith.creators);
    expect(back.date).toBe("2020-05");
    expect(back.pages).toBe("45–67");
    expect(back.doi).toBe(smith.doi);
    expect(back.tags).toEqual(["ml"]);
  });

  it("BibTeX：巨集、串接、LaTeX 重音、機構作者、註解", () => {
    const src = `
@comment{ignore me}
@string{jsig = "Journal of Signals"}
@inproceedings{k1,
  title = {On {B}ayesian Methods},
  author = {G{\\"o}del, Kurt and {World Health Organization}},
  booktitle = jsig # " Proceedings",
  year = 1931, month = mar,
}
@book{k2, title="A \\& B", author="Doe, J."}`;
    const items = parseBibtex(src);
    expect(items).toHaveLength(2);
    expect(items[0].type).toBe("conference");
    expect(items[0].title).toBe("On Bayesian Methods");
    expect(items[0].creators[0]).toEqual({ family: "Gödel", given: "Kurt", role: "author" });
    expect(items[0].creators[1].family).toBe("World Health Organization");
    expect(items[0].container).toBe("Journal of Signals Proceedings");
    expect(items[0].date).toBe("1931-03");
    expect(items[1].title).toBe("A & B");
    expect(delatex("{\\'e}t{\\'e} -- \\emph{x}")).toBe("été – x");
  });

  it("CSL-JSON（doi.org、Zotero 匯出）", () => {
    const it = fromCsl({
      type: "article-journal",
      title: "Hello",
      subtitle: ["World"],
      author: [{ family: "Doe", given: "Jane" }, { literal: "ACME Lab" }],
      "container-title": "Nature",
      issued: { "date-parts": [[2021, 3, 4]] },
      page: "1-9",
      DOI: "10.1/abc",
      URL: "https://doi.org/10.1/abc",
      abstract: "<jats:p>Some <jats:italic>text</jats:italic></jats:p>",
    });
    expect(it.type).toBe("article");
    expect(it.title).toBe("Hello: World");
    expect(it.creators.map((c) => c.family)).toEqual(["Doe", "ACME Lab"]);
    expect(it.date).toBe("2021-03-04");
    expect(it.pages).toBe("1–9");
    expect(it.url).toBe("");
    expect(it.abstract).toBe("Some text");
    expect(parseImport(JSON.stringify([{ type: "book", title: "X" }]))).toHaveLength(1);
    expect(parseImport("@misc{a, title={Y}}")[0].title).toBe("Y");
    expect(parseImport("[oops")).toEqual([]);
  });
});

describe("Drawer：識別碼", () => {
  it("辨認 DOI、arXiv、ISBN、網址", () => {
    expect(parseIdentifier("https://doi.org/10.1038/nphys1170.")).toEqual({ kind: "doi", value: "10.1038/nphys1170" });
    expect(parseIdentifier("doi:10.1000/xyz123")).toEqual({ kind: "doi", value: "10.1000/xyz123" });
    expect(parseIdentifier("arXiv:2301.01234v2")).toEqual({ kind: "doi", value: "10.48550/arXiv.2301.01234" });
    expect(parseIdentifier("https://arxiv.org/abs/1706.03762")).toEqual({ kind: "doi", value: "10.48550/arXiv.1706.03762" });
    expect(parseIdentifier("978-0-306-40615-7")).toEqual({ kind: "isbn", value: "9780306406157" });
    expect(parseIdentifier("ISBN 0-306-40615-2")).toEqual({ kind: "isbn", value: "0306406152" });
    expect(parseIdentifier("978-0-306-40615-8")).toBeNull();
    expect(parseIdentifier("www.example.com/a")).toEqual({ kind: "url", value: "https://www.example.com/a" });
    expect(parseIdentifier("hello")).toBeNull();
    expect(validIsbn("080442957X")).toBe(true);
  });

  it("DOI 查詢用 doi.org 的 CSL-JSON；找不到時丟出看得懂的錯誤", async () => {
    let asked = "";
    const ok = (async (url: string, init?: RequestInit) => {
      asked = `${url} ${(init?.headers as Record<string, string>).Accept}`;
      return new Response(JSON.stringify({ type: "article-journal", title: "T", DOI: "10.1/x" }), { status: 200 });
    }) as typeof fetch;
    const it = await lookup({ kind: "doi", value: "10.1/x" }, ok);
    expect(asked).toBe("https://doi.org/10.1/x application/vnd.citationstyles.csl+json");
    expect(it.title).toBe("T");
    const missing = (async () => new Response("", { status: 404 })) as typeof fetch;
    await expect(lookup({ kind: "doi", value: "10.1/none" }, missing)).rejects.toThrow("No record found");
    const offline = (async () => {
      throw new TypeError("network");
    }) as typeof fetch;
    await expect(lookup({ kind: "doi", value: "10.1/x" }, offline)).rejects.toThrow("Couldn't reach doi.org");
  });

  it("ISBN 查詢（Open Library）與網址", async () => {
    const ol = (async () =>
      new Response(
        JSON.stringify({ "ISBN:9780306406157": { title: "Book", subtitle: "Sub", authors: [{ name: "Jane Doe" }], publishers: [{ name: "Pub" }], publish_date: "May 1999" } }),
      )) as typeof fetch;
    const it = await lookup({ kind: "isbn", value: "9780306406157" }, ol);
    expect(it).toMatchObject({ type: "book", title: "Book: Sub", publisher: "Pub", date: "1999", isbn: "9780306406157" });
    expect(it.creators[0]).toEqual({ family: "Doe", given: "Jane", role: "author" });
    expect(fromOpenLibrary({}, "1").title).toBe("");
    const web = await lookup({ kind: "url", value: "https://www.example.com/x" });
    expect(web).toMatchObject({ type: "webpage", container: "example.com", url: "https://www.example.com/x" });
  });
});
