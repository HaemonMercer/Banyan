import { addProp, addRow, cellText, TITLE, titleOf, type Database, type Row } from "../database/model";
import { addNote, boundsOf, cardRect, NOTE_W, type Board, type Card } from "./board";
import type { CardSource } from "./file";

/**
 * 白板與 Dock 裡的資料庫互通（純函式）：
 * - 卡片 → 資料列：便利貼的第一行當標題，其餘放進「Notes」文字欄；頁面、日記的標題當列標題（會連到同名頁面）。
 * - 資料列 → 便利貼：粗體標題＋有值的欄位，排在白板既有內容的右邊。
 * - 資料庫 → CSV（匯出）。
 */

const NOTES = "Notes";

/** Markdown 的一行 → 純文字（去掉標題、清單、任務、引言標記與行內格式） */
export function plainLine(line: string): string {
  return line
    .replace(/^\s{0,3}(#{1,6}\s+|>\s*|[-*+]\s+|\d{1,9}[.)]\s+)/, "")
    .replace(/^(\{[ xX<\-oO]?\}|\[[ xX]\])\s*/, "")
    .replace(/\[\[([^\]\n]+)\]\]/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/(\*\*|__|\*|_|`)/g, "")
    .trim();
}

/** 卡片接成資料列（照傳進來的順序加在最後面）。 */
export function cardsToRows(db: Database, cards: Card[], source: CardSource): Database {
  let out = db;
  let notesId = out.props.find((p) => p.type === "text" && p.name.trim().toLowerCase() === NOTES.toLowerCase())?.id ?? null;
  for (const c of cards) {
    const { title, content } = source(c);
    let name = title;
    let rest = "";
    if (c.ref.kind === "note") {
      const lines = content.trim().split("\n");
      const i = lines.findIndex((l) => plainLine(l));
      name = i >= 0 ? plainLine(lines[i]) : "";
      rest = i >= 0 ? lines.slice(i + 1).join("\n").trim() : "";
    }
    const cells: Row["cells"] = { [TITLE]: name };
    if (rest) {
      if (!notesId) {
        const r = addProp(out, "text", NOTES);
        out = r.db;
        notesId = r.id;
      }
      cells[notesId] = rest;
    }
    out = addRow(out, cells).db;
  }
  return out;
}

/** 一列 → 便利貼的 Markdown：粗體標題，下一段是有值的欄位（「Status: Done · Tags: a, b」）。 */
export function rowNote(db: Database, row: Row): string {
  const title = titleOf(row).trim() || "Untitled";
  const fields = db.props
    .filter((p) => p.id !== TITLE)
    .map((p) => [p.name, cellText(p, row.cells[p.id])] as const)
    .filter(([, v]) => v.trim())
    .map(([k, v]) => `${k}: ${v.replace(/\n+/g, " ")}`);
  return fields.length ? `**${title}**\n\n${fields.join(" · ")}` : `**${title}**`;
}

/** 便利貼排在白板既有內容的右邊（一排四張）；回傳新的白板與新卡片的 id。 */
export function placeNotes(board: Board, texts: string[], perRow = 4): { board: Board; ids: string[] } {
  const b0 = boundsOf(board.cards.map((c) => cardRect(c)).concat(board.sections));
  const x0 = b0 ? b0.x + b0.w + 96 : 0;
  const y0 = b0 ? b0.y : 0;
  let out = board;
  const ids: string[] = [];
  texts.forEach((t, i) => {
    const r = addNote(out, x0 + (i % perRow) * (NOTE_W + 28), y0 + Math.floor(i / perRow) * 170, t);
    out = r.board;
    ids.push(r.id);
  });
  return { board: out, ids };
}

const csvCell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** 資料庫 → CSV（第一列是欄名；開頭加 BOM，Excel 才認得 UTF-8）。 */
export function toCsv(db: Database): string {
  const lines = [db.props.map((p) => csvCell(p.name)).join(",")];
  for (const r of db.rows) lines.push(db.props.map((p) => csvCell(cellText(p, r.cells[p.id]))).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}
