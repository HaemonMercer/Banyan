import { describe, expect, it } from "vitest";
import { addOption, newDatabase, parseDatabase, serializeDatabase, setCell, TITLE, titleOf } from "../database/model";
import { addNote, emptyBoard } from "./board";
import { cardsToRows, placeNotes, plainLine, rowNote, toCsv } from "./bridge";
import { addDoc, emptyFile, importDatabases, parseFile, serializeFile } from "./file";

describe("Dock 的資料庫文件", () => {
  it("存檔時寫成物件、讀回來一樣", () => {
    const f = addDoc(emptyFile(), "database").file;
    expect(f.docs[0].title).toBe("Database");
    const j = JSON.parse(serializeFile(f));
    expect(typeof j.docs[0].database).toBe("object");
    expect(j.docs[0].content).toBeUndefined();
    const back = parseFile(serializeFile(f));
    expect(back.docs[0].kind).toBe("database");
    expect(parseDatabase(back.docs[0].content).props.map((p) => p.name)).toEqual(["Name", "Status", "Tags"]);
    expect(serializeFile(back)).toBe(serializeFile(f));
  });

  it("舊的資料庫搬進來：用原本的名稱，重複執行不會多出來", () => {
    const db = serializeDatabase(newDatabase());
    let f = importDatabases(emptyFile(), [
      ["Reading list", db],
      ["空的", ""],
    ]);
    f = importDatabases(f, [["reading LIST", db]]);
    expect(f.docs.map((d) => [d.title, d.kind])).toEqual([["Reading list", "database"]]);
  });
});

describe("白板與資料庫互通", () => {
  const src = (c: { ref: { kind: string }; text: string }) =>
    c.ref.kind === "note" ? { title: "", content: c.text } : { title: "研究", content: "內容" };

  it("一行 Markdown 變純文字", () => {
    expect(plainLine("## **重點** [[頁面]]")).toBe("重點 頁面");
    expect(plainLine("- { } 買書")).toBe("買書");
    expect(plainLine("[連結](https://a.b) `碼`")).toBe("連結 碼");
  });

  it("卡片變成列：第一行是標題，其餘放進 Notes 欄；頁面卡片用頁面名稱", () => {
    const b = addNote(addNote(emptyBoard(), 0, 0, "**第一**\n\n細節一").board, 0, 200, "第二").board;
    const page = { ...b.cards[0], id: "p", ref: { kind: "page" as const, name: "研究" }, text: "" };
    const db = cardsToRows({ ...newDatabase(), rows: [] }, [...b.cards, page], src);
    expect(db.rows.map(titleOf)).toEqual(["第一", "第二", "研究"]);
    const notes = db.props.find((p) => p.name === "Notes")!;
    expect(notes.type).toBe("text");
    expect(db.rows[0].cells[notes.id]).toBe("細節一");
    expect(db.rows[1].cells[notes.id]).toBeUndefined();
    // 已經有 Notes 欄就用它，不再加
    const again = cardsToRows(db, [b.cards[0]], src);
    expect(again.props.filter((p) => p.name === "Notes")).toHaveLength(1);
  });

  it("列變成便利貼文字", () => {
    let db = newDatabase();
    const status = db.props[1];
    const r = addOption(db, status.id, "Doing")!;
    db = setCell(setCell(r.db, db.rows[0].id, TITLE, "寫報告"), db.rows[0].id, status.id, r.id);
    expect(rowNote(db, db.rows[0])).toBe("**寫報告**\n\nStatus: Doing");
    expect(rowNote(db, db.rows[1])).toBe("**Untitled**");
  });

  it("便利貼排在既有內容的右邊，一排四張", () => {
    const b = addNote(emptyBoard(), 0, 0, "原本的").board;
    const { board, ids } = placeNotes(b, ["a", "b", "c", "d", "e"]);
    expect(ids).toHaveLength(5);
    const added = board.cards.filter((c) => ids.includes(c.id));
    expect(Math.min(...added.map((c) => c.x))).toBeGreaterThan(b.cards[0].x + b.cards[0].w);
    expect(new Set(added.slice(0, 4).map((c) => c.y)).size).toBe(1);
    expect(added[4].y).toBeGreaterThan(added[0].y);
    expect(added[4].x).toBe(added[0].x);
  });

  it("CSV：欄名、選項文字、需要時加引號", () => {
    let db = newDatabase();
    db = setCell(db, db.rows[0].id, TITLE, 'a, "b"');
    const csv = toCsv(db);
    expect(csv.startsWith("﻿Name,Status,Tags\r\n")).toBe(true);
    expect(csv).toContain('"a, ""b""",,\r\n');
  });
});
