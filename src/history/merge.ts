import { parseDoc, type Unit } from "../editor/markdown";
import { diffBlocks } from "./diff";

/**
 * 所見即所得的「Show changes」：把前一個版本刪掉的區塊插回這個版本的原始碼裡（放在原本接著它的區塊前面），
 * 用真正的編輯器畫出來，再依每個區塊的起始行（`.row[data-start]`）標出新增、刪掉、改過的區塊。
 * 不改這個版本本身的任何一行，只是多插幾段。
 */

export type MarkOp = "add" | "del" | "change";

export interface LineMark {
  /** 合併後原始碼裡的起始行 */
  line: number;
  op: MarkOp;
  /** 改過的區塊：前一個版本的那個區塊（字詞層級比較用） */
  old?: Unit;
}

interface Block {
  unit: Unit;
  lines: string[];
}

function blocksOf(md: string): Block[] {
  const d = parseDoc(md);
  return d.blocks.map((unit) => ({ unit, lines: d.lines.slice(unit.start, unit.end) }));
}

const blank = (s: string | undefined) => s === undefined || /^[ \t]*$/.test(s);

export function mergeChanges(before: string, after: string): { source: string; marks: LineMark[] } {
  const ops = diffBlocks(blocksOf(before), blocksOf(after), (b) => b.lines.join("\n"));
  const lines = after.split("\n");
  const out: string[] = [];
  const marks: LineMark[] = [];
  let cursor = 0;
  /** 上一個放出去的區塊是不是清單項目（決定插進去的項目要不要空行） */
  let lastItem = false;
  let dels: Block[] = [];

  const flush = (nextItem: boolean) => {
    for (const d of dels) {
      const item = d.unit.kind === "item";
      // 項目夾在項目之間就直接插（還是同一個清單）；其他前後都要空行，免得被前一段吸進去
      const tight = item && lastItem && nextItem;
      if (!tight && !blank(out[out.length - 1]) && out.length) out.push("");
      marks.push({ line: out.length, op: "del" });
      out.push(...d.lines);
      if (!tight) out.push("");
      lastItem = item;
    }
    dels = [];
  };

  for (const o of ops) {
    if (o.op === "del") {
      dels.push(o.a);
      continue;
    }
    const u = o.b.unit;
    // 先把到這個區塊為止的原始碼照抄（區塊之間的空行、版面標籤）
    const gap = lines.slice(cursor, u.start);
    if (dels.length) {
      // 刪掉的區塊插在空行與標籤後面、這個區塊前面
      out.push(...gap);
      flush(u.kind === "item");
    } else out.push(...gap);
    cursor = u.start;
    if (o.op !== "same") marks.push({ line: out.length, op: o.op, old: o.op === "change" ? o.a.unit : undefined });
    out.push(...lines.slice(u.start, u.end));
    cursor = u.end;
    lastItem = u.kind === "item";
  }
  out.push(...lines.slice(cursor));
  if (dels.length) {
    // 文件最後：後面沒有東西會被吸進去，清單最後的項目可以直接接上
    while (out.length && blank(out[out.length - 1])) out.pop();
    flush(true);
    while (out.length && blank(out[out.length - 1])) out.pop();
    out.push("");
  }
  return { source: out.join("\n"), marks };
}
