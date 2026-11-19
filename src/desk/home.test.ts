import { describe, expect, it } from "vitest";
import { addCard, addEdge, addNote, addSection, emptyBoard } from "./board";
import { addDoc, emptyFile, type DeskFile } from "./file";
import { boardThumb, freeName, matchFile, sortFiles, timeAgo } from "./home";

const withNote = (text: string): DeskFile => ({ ...emptyFile(), board: addNote(emptyBoard(), 0, 0, text).board });

describe("Desk 首頁", () => {
  it("搜尋檔名、文件標題、便利貼文字，每個詞都要出現", () => {
    const f = addDoc(withNote("Launch checklist"), "word", "Press release").file;
    const e = { name: "Q4 plan", file: f };
    expect(matchFile(e, "")).toBe(true);
    expect(matchFile(e, "q4")).toBe(true);
    expect(matchFile(e, "press")).toBe(true);
    expect(matchFile(e, "LAUNCH plan")).toBe(true);
    expect(matchFile(e, "launch budget")).toBe(false);
  });

  it("最近打開或編輯的排前面，沒有紀錄的照名稱", () => {
    const a = { name: "Alpha", file: emptyFile() };
    const b = { name: "Beta", file: emptyFile() };
    const c = { name: "Gamma", file: emptyFile() };
    const d = { name: "Delta", file: emptyFile() };
    const act = { Gamma: { opened: 50 }, Alpha: { opened: 10, edited: 90 } };
    expect(sortFiles([d, b, c, a], act).map((x) => x.name)).toEqual(["Alpha", "Gamma", "Beta", "Delta"]);
  });

  it("相對時間", () => {
    const now = new Date(2026, 10, 19, 12).getTime();
    expect(timeAgo(now - 5_000, now)).toBe("just now");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(timeAgo(now - 3 * 3600_000, now)).toBe("3 h ago");
    expect(timeAgo(now - 30 * 3600_000, now)).toBe("Yesterday");
    expect(timeAgo(now - 4 * 86400_000, now)).toBe("4 days ago");
    expect(timeAgo(new Date(2026, 9, 2).getTime(), now)).toBe("Oct 2");
    expect(timeAgo(new Date(2025, 9, 2).getTime(), now)).toBe("Oct 2, 2025");
  });

  it("新檔名不重複（不分大小寫）", () => {
    const key = (s: string) => s.toLowerCase();
    expect(freeName([], "Untitled", key)).toBe("Untitled");
    expect(freeName(["untitled", "Untitled 2"], "Untitled", key)).toBe("Untitled 3");
  });

  it("白板縮圖：空白板是 null；區段、連線、卡片都在畫面內", () => {
    expect(boardThumb(emptyBoard())).toBeNull();
    let b = addNote(emptyBoard(), 0, 0, "a").board;
    const n1 = b.cards[0].id;
    const r = addCard(b, { kind: "page", name: "P" }, 600, 300);
    b = addEdge(r.board, n1, r.id).board;
    b = addSection(b, { x: -100, y: -100, w: 300, h: 300 }).board;
    const t = boardThumb(b)!;
    expect(t.items.map((i) => i.kind).sort()).toEqual(["card", "card", "edge", "section"]);
    expect(t.view.x).toBeLessThan(-100);
    expect(t.view.x + t.view.w).toBeGreaterThan(600 + r.board.cards[1].w);
    const notes = t.items.filter((i) => i.kind === "card" && i.note);
    expect(notes).toHaveLength(1);
  });
});
