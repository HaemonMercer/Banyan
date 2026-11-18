import { describe, expect, it } from "vitest";
import {
  addOption,
  addProp,
  addRow,
  addView,
  boardGroups,
  duplicateRow,
  moveProp,
  moveRow,
  newDatabase,
  parseDatabase,
  removeOption,
  removeProp,
  removeView,
  serializeDatabase,
  setCell,
  setPropType,
  TITLE,
  titleOf,
  viewRows,
  type Database,
} from "./model";

/** 固定 id 的小資料庫 */
function sample(): Database {
  return parseDatabase(
    JSON.stringify({
      props: [
        { id: TITLE, name: "Name", type: "title" },
        {
          id: "st",
          name: "Status",
          type: "select",
          options: [
            { id: "a", name: "Todo", color: "gray" },
            { id: "b", name: "Done", color: "green" },
          ],
        },
        { id: "n", name: "Pages", type: "number" },
        { id: "t", name: "Note", type: "text" },
      ],
      rows: [
        { id: "r1", cells: { title: "Beta", st: "b", n: 30 } },
        { id: "r2", cells: { title: "alpha", st: "a", n: 4, t: "x, y" } },
        { id: "r3", cells: { title: "Gamma" } },
      ],
      views: [{ id: "v", name: "Table", type: "table", sort: null, groupBy: null, hidden: [] }],
    }),
  );
}

describe("讀寫", () => {
  it("新的資料庫：標題、狀態、標籤三欄，三列，一個表格", () => {
    const db = newDatabase();
    expect(db.props.map((p) => p.type)).toEqual(["title", "select", "multi"]);
    expect(db.rows).toHaveLength(3);
    expect(db.views.map((v) => v.type)).toEqual(["table"]);
  });

  it("寫出再讀回來不變", () => {
    const db = sample();
    expect(parseDatabase(serializeDatabase(db))).toEqual(db);
  });

  it("壞掉的檔案給新的資料庫", () => {
    expect(parseDatabase("{oops").props[0].id).toBe(TITLE);
    expect(parseDatabase("").views).toHaveLength(1);
  });

  it("標題欄搬到最前面，不合型別的值丟掉", () => {
    const db = parseDatabase(
      JSON.stringify({
        props: [
          { id: "n", name: "N", type: "number" },
          { id: TITLE, name: "Name", type: "title" },
          { id: "bad", name: "?", type: "rollup" },
        ],
        rows: [{ id: "r", cells: { n: "12", title: "A", bad: 1 } }],
      }),
    );
    expect(db.props.map((p) => p.id)).toEqual([TITLE, "n"]);
    expect(db.rows[0].cells).toEqual({ title: "A" });
  });

  it("選項不存在的格子清掉", () => {
    const db = parseDatabase(
      JSON.stringify({
        props: [
          { id: TITLE, name: "Name", type: "title" },
          { id: "s", name: "S", type: "multi", options: [{ id: "o", name: "O", color: "red" }] },
        ],
        rows: [{ id: "r", cells: { s: ["o", "gone", "o"] } }],
      }),
    );
    expect(db.rows[0].cells.s).toEqual(["o"]);
  });
});

describe("欄位", () => {
  it("加欄、搬欄（標題不動）、刪欄連同值與排序", () => {
    let db = sample();
    const made = addProp(db, "date", "Due", "st");
    db = made.db;
    expect(db.props.map((p) => p.id)).toEqual([TITLE, "st", made.id, "n", "t"]);
    db = moveProp(db, "t", 1);
    expect(db.props.map((p) => p.id)).toEqual([TITLE, "t", "st", made.id, "n"]);
    expect(moveProp(db, TITLE, 3)).toBe(db);
    db = { ...db, views: db.views.map((v) => ({ ...v, sort: { prop: "n", desc: false }, hidden: ["n"] })) };
    db = removeProp(db, "n");
    expect(db.props.some((p) => p.id === "n")).toBe(false);
    expect(db.rows.every((r) => !("n" in r.cells))).toBe(true);
    expect(db.views[0].sort).toBeNull();
    expect(db.views[0].hidden).toEqual([]);
    expect(removeProp(db, TITLE)).toBe(db);
  });

  it("文字換成多選：逗號分開建立選項", () => {
    const db = setPropType(sample(), "t", "multi");
    const p = db.props.find((x) => x.id === "t")!;
    expect(p.options.map((o) => o.name)).toEqual(["x", "y"]);
    expect(db.rows[1].cells.t).toEqual(p.options.map((o) => o.id));
  });

  it("單選換成文字是選項名稱；數字換成文字再換回數字", () => {
    let db = setPropType(sample(), "st", "text");
    expect(db.rows.map((r) => r.cells.st)).toEqual(["Done", "Todo", undefined]);
    db = setPropType(setPropType(db, "n", "text"), "n", "number");
    expect(db.rows.map((r) => r.cells.n)).toEqual([30, 4, undefined]);
  });

  it("分組的欄位不是單選了，看板就不分組", () => {
    let db = sample();
    db = { ...db, views: [{ ...db.views[0], type: "board", groupBy: "st" }] };
    expect(setPropType(db, "st", "multi").views[0].groupBy).toBeNull();
  });
});

describe("選項", () => {
  it("同名不重複加；刪選項清掉格子", () => {
    let db = sample();
    expect(addOption(db, "st", "done")!.id).toBe("b");
    const made = addOption(db, "st", "Later")!;
    db = made.db;
    expect(db.props[1].options.map((o) => o.name)).toEqual(["Todo", "Done", "Later"]);
    db = removeOption(db, "st", "b");
    expect(db.rows[0].cells.st).toBeUndefined();
  });
});

describe("資料列", () => {
  it("加、改、清空、複製、搬", () => {
    let db = sample();
    const made = addRow(db, { [TITLE]: "Delta", st: "a" }, 1);
    db = made.db;
    expect(db.rows.map(titleOf)).toEqual(["Beta", "Delta", "alpha", "Gamma"]);
    db = setCell(db, made.id, "n", 7);
    db = setCell(db, made.id, "st", null);
    expect(db.rows[1].cells).toEqual({ title: "Delta", n: 7 });
    db = duplicateRow(db, made.id)!.db;
    expect(db.rows.map(titleOf)).toEqual(["Beta", "Delta", "Delta (copy)", "alpha", "Gamma"]);
    db = moveRow(db, db.rows[0].id, 5);
    expect(db.rows.map(titleOf)).toEqual(["Delta", "Delta (copy)", "alpha", "Gamma", "Beta"]);
  });
});

describe("檢視", () => {
  it("搜尋任一欄、排序（空的排最後）", () => {
    const db = sample();
    const v = db.views[0];
    expect(viewRows(db, v, "done").map(titleOf)).toEqual(["Beta"]);
    expect(viewRows(db, { ...v, sort: { prop: TITLE, desc: false } }).map(titleOf)).toEqual(["alpha", "Beta", "Gamma"]);
    expect(viewRows(db, { ...v, sort: { prop: "n", desc: true } }).map(titleOf)).toEqual(["Beta", "alpha", "Gamma"]);
    expect(viewRows(db, { ...v, sort: { prop: "st", desc: false } }).map(titleOf)).toEqual(["alpha", "Beta", "Gamma"]);
  });

  it("看板依單選分組，最後是沒有值的", () => {
    let db = sample();
    const made = addView(db, "board");
    db = made.db;
    const v = db.views.find((x) => x.id === made.id)!;
    expect(v.groupBy).toBe("st");
    const g = boardGroups(db, v, db.rows);
    expect(g.map((x) => [x.option?.name ?? null, x.rows.map(titleOf)])).toEqual([
      ["Todo", ["alpha"]],
      ["Done", ["Beta"]],
      [null, ["Gamma"]],
    ]);
  });

  it("至少留一個檢視", () => {
    const db = sample();
    expect(removeView(db, db.views[0].id)).toBe(db);
  });
});
