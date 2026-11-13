// Citations: syntax, APA formatting, BibTeX reading and writing.
// Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { bibtexCiteData, parseBibtex, splitNames, texToText, toBibtex, toImportItem, type CiteItem } from "../bibtex.ts";
import { formatCitation, formatReference, referenceName, type CiteData } from "../cite.ts";
import { extractCitations, parse } from "../index.ts";

const inline = (md: string) => parse(md).children[0].children!;

test("bracketed citations", () => {
    const [c] = inline("[見 @kahneman2011, p. 33; -@tversky1974]");
    assert.equal(c.type, "citation");
    assert.equal(c.narrative, false);
    assert.deepEqual(c.cites, [
        { prefix: "見", suppressAuthor: false, key: "kahneman2011", locator: "p. 33" },
        { prefix: "", suppressAuthor: true, key: "tversky1974", locator: "" },
    ]);
    assert.deepEqual(inline("[@王2020, 頁 12]")[0].cites![0].key, "王2020");
    assert.equal(inline("[@kahneman2011:h3]")[0].cites![0].key, "kahneman2011:h3");
});

test("not citations", () => {
    for (const md of ["[@x](http://a.com)", "[a; b]", "a@b.com", "x+@y", "[@]", "\\@key"]) {
        const nodes = inline(md);
        assert.ok(!nodes.some((n) => n.type === "citation"), md);
    }
});

test("narrative citations end where the script changes", () => {
    const nodes = inline("@kahneman2011 指出，而@王2020認為 @smith2020.");
    const cites = nodes.filter((n) => n.type === "citation").map((n) => n.cites![0].key);
    assert.deepEqual(cites, ["kahneman2011", "王2020", "smith2020"]);
    assert.ok(nodes.every((n) => n.type !== "citation" || n.narrative));
});

test("::bibliography and extractCitations", () => {
    const doc = parse("文 [@a2020; @b2021] 與 @c2022 與 [[@d2023]]\n\n::bibliography\n");
    assert.equal(doc.children[1].type, "bibliography");
    assert.deepEqual(extractCitations("文 [@a2020; @b2021] 與 @c2022 與 [[@d2023]] [@a2020]"), ["a2020", "b2021", "c2022", "d2023"]);
});

const data = (o: Partial<CiteData>): CiteData => ({
    key: "k",
    itemType: "book",
    title: "",
    authors: [],
    editors: [],
    date: "",
    publication: "",
    volume: "",
    issue: "",
    pages: "",
    publisher: "",
    place: "",
    doi: "",
    url: "",
    isbn: "",
    series: "",
    seriesNumber: "",
    ...o,
});

const LIB: Record<string, CiteData> = {
    kahneman2011: data({ key: "kahneman2011", title: "Thinking, Fast and Slow", authors: ["Kahneman, Daniel"], date: "2011", publisher: "Farrar, Straus and Giroux" }),
    tk1974: data({
        key: "tk1974",
        itemType: "journalArticle",
        title: "Judgment under uncertainty",
        authors: ["Amos Tversky", "Daniel Kahneman"],
        date: "1974-09-27",
        publication: "Science",
        volume: "185",
        issue: "4157",
        pages: "1124-1131",
        doi: "10.1126/science.185.4157.1124",
    }),
    many: data({ key: "many", authors: ["A, X", "B, Y", "C, Z"], date: "2000", title: "T" }),
    王2020: data({ key: "王2020", title: "思考的方法", authors: ["王小明"], date: "2020", publisher: "遠流" }),
    "kahneman2011:h3": data({
        key: "kahneman2011:h3",
        title: "Thinking, Fast and Slow",
        authors: ["Kahneman, Daniel"],
        date: "2011",
        annotation: { id: 1, kind: "highlight", color: "yellow", quote: "…", note: "", locator: "p. 33" },
    }),
};
const lookup = (k: string) => LIB[k] ?? null;
const cite = (md: string) => {
    const n = inline(md).find((x) => x.type === "citation")!;
    return formatCitation(n.cites!, !!n.narrative, lookup);
};

test("APA in-text citations", () => {
    assert.equal(cite("[@kahneman2011, 33]"), "(Kahneman, 2011, p. 33)");
    assert.equal(cite("[@kahneman2011; @tk1974]"), "(Kahneman, 2011; Tversky & Kahneman, 1974)");
    assert.equal(cite("[see @many, ch. 2]"), "(see A et al., 2000, ch. 2)");
    assert.equal(cite("[-@kahneman2011]"), "(2011)");
    assert.equal(cite("@kahneman2011 says"), "Kahneman (2011)");
    assert.equal(cite("[@王2020, 12-15]"), "（王小明，2020，頁 12–15）");
    assert.equal(cite("@王2020認為"), "王小明（2020）");
    assert.equal(cite("[@kahneman2011:h3]"), "(Kahneman, 2011, p. 33)");
    assert.equal(cite("[@missing]"), "(@missing)");
});

test("APA reference entries", () => {
    const text = (k: string) => formatReference(LIB[k]).map((r) => (r.italic ? `*${r.text}*` : r.text)).join("");
    assert.equal(text("kahneman2011"), "Kahneman, D. (2011). *Thinking, Fast and Slow*. Farrar, Straus and Giroux.");
    assert.equal(
        text("tk1974"),
        "Tversky, A., & Kahneman, D. (1974). Judgment under uncertainty. *Science*, *185*(4157), 1124–1131. https://doi.org/10.1126/science.185.4157.1124",
    );
    assert.equal(text("王2020"), "王小明（2020）。《思考的方法》。遠流。");
    assert.equal(referenceName("Jean-Paul Sartre"), "Sartre, J.-P.");
});

const ITEM: CiteItem = {
    id: 1,
    citeKey: "smith2020",
    itemType: "journalArticle",
    primaryRole: "author",
    title: "Profits & {Losses}: 50% of_all",
    creators: [
        { role: "author", name: "Smith, John" },
        { role: "author", name: "Doe, Jane" },
        { role: "translator", name: "王小明" },
    ],
    date: "2020-05",
    publication: "Journal of Things",
    volume: "3",
    issue: "2",
    pages: "10-20",
    publisher: "",
    place: "",
    doi: "10.1/x",
    isbn: "",
    url: "",
    series: "",
    seriesNumber: "",
    runningTime: "",
    medium: "",
    dimensions: "",
    catalogNumber: "",
    abstractNote: "",
    tags: ["經濟", "統計"],
};

test("BibTeX round trip", () => {
    const bib = toBibtex(ITEM);
    assert.match(bib, /^@article\{smith2020,\n/);
    assert.match(bib, /title\s+= \{Profits \\& \\\{Losses\\\}: 50\\% of\\_all\}/);
    assert.match(bib, /author\s+= \{Smith, John and Doe, Jane\}/);
    assert.match(bib, /journaltitle = \{Journal of Things\}/);
    const [entry] = parseBibtex(bib);
    const item = toImportItem(entry);
    assert.equal(item.itemType, "journalArticle");
    assert.equal(item.citeKey, "smith2020");
    assert.equal(item.fields.title, "Profits & {Losses}: 50% of_all".replace(/[{}]/g, ""));
    assert.equal(item.fields.publication, "Journal of Things");
    assert.equal(item.fields.issue, "2");
    assert.equal(item.fields.date, "2020-05");
    assert.deepEqual(item.creators, ITEM.creators);
    assert.deepEqual(item.tags, ["經濟", "統計"]);
});

test("reading real-world BibTeX", () => {
    const text = `
% a comment
@string{ sci = "Science" }
@comment{ ignored @book{x, title={no}} }
@Article{Tversky1974,
  author  = {Tversky, Amos and Kahneman, Daniel and {Barnes and Noble}},
  title   = "{Judgment} under Uncertainty: Heuristics and Biases",
  journal = sci # " Magazine",
  year    = 1974, month = sep,
  volume  = {185}, number = {4157},
  pages   = {1124--1131}
}
@phdthesis{garcia2001, author={Garc{\\'\\i}a, Jos{\\'e}}, title={Tesis}, school={UNAM}, year={2001}}
@misc{talk1, title = {A talk}, type = {talk}, author = {Lee, Ann}}
@online{w1, title={Site}, url={https://a.com/x_y}, urldate={2020-01-01}}
`;
    const entries = parseBibtex(text);
    assert.deepEqual(entries.map((e) => e.key), ["Tversky1974", "garcia2001", "talk1", "w1"]);
    const t = toImportItem(entries[0]);
    assert.equal(t.fields.publication, "Science Magazine");
    assert.equal(t.fields.date, "1974-09");
    assert.equal(t.fields.pages, "1124–1131");
    assert.deepEqual(t.creators.map((c) => c.name), ["Tversky, Amos", "Kahneman, Daniel", "Barnes and Noble"]);
    assert.equal(t.fields.title, "Judgment under Uncertainty: Heuristics and Biases");
    const g = toImportItem(entries[1]);
    assert.equal(g.itemType, "thesis");
    assert.equal(g.fields.publisher, "UNAM");
    assert.equal(toImportItem(entries[2]).itemType, "talk");
    assert.equal(toImportItem(entries[2]).creators[0].role, "speaker");
    assert.equal(toImportItem(entries[3]).itemType, "webpage");
    assert.equal(toImportItem(entries[3]).fields.url, "https://a.com/x_y");
    assert.deepEqual(splitNames("A and {B and C}"), ["A", "B and C"]);
    assert.equal(texToText("\\\"{o}\\c{c} --- x~y"), "öç — x y");
});

test("bibtex blocks in a document", () => {
    const [d] = bibtexCiteData("@book{local1, author={Lee, Ann}, title={Local}, year={2019}}");
    assert.equal(d.key, "local1");
    assert.equal(d.local, true);
    assert.deepEqual(d.authors, ["Lee, Ann"]);
});
