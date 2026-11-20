import { parseDoc, type Unit } from "../editor/markdown";
import { extractRefs, lineMentions, pageKey } from "./pageRef";

/** 一份可以提到別頁的文件：某天的日記或某個頁面。 */
export interface Source {
  kind: "day" | "page";
  /** 日期或頁面名稱 */
  key: string;
  content: string;
}

export interface Mention {
  source: Source;
  /** 提到目標的區塊 */
  blocks: Unit[];
}

const refCache = new Map<string, string[]>();

/** 文件提到的頁面（依內容快取）。 */
export function refsOf(content: string): string[] {
  let r = refCache.get(content);
  if (!r) {
    if (refCache.size > 1000) refCache.clear();
    r = content.includes("[[") ? extractRefs(content) : [];
    refCache.set(content, r);
  }
  return r;
}

/**
 * 反向連結：哪些文件的哪些區塊提到 `name`（不分大小寫）。
 * 日記新的在前，頁面依名稱；目標自己不算。
 */
export function findBacklinks(name: string, sources: Source[], self?: { kind: string; key: string }): Mention[] {
  const key = pageKey(name);
  const out: Mention[] = [];
  for (const src of sources) {
    if (self && src.kind === self.kind && pageKey(src.key) === pageKey(self.key)) continue;
    if (!refsOf(src.content).some((r) => pageKey(r) === key)) continue;
    const doc = parseDoc(src.content);
    const blocks = doc.blocks.filter((u) => {
      for (let l = u.start; l < u.end; l++) if (lineMentions(doc.lines[l], key)) return true;
      return false;
    });
    if (blocks.length) out.push({ source: src, blocks });
  }
  return out.sort((a, b) => {
    if (a.source.kind !== b.source.kind) return a.source.kind === "day" ? -1 : 1;
    return a.source.kind === "day" ? b.source.key.localeCompare(a.source.key) : a.source.key.localeCompare(b.source.key);
  });
}

export interface PageInfo {
  name: string;
  /** 有沒有內容（檔案） */
  exists: boolean;
  /** 被幾份文件提到 */
  refs: number;
}

/** 所有頁面：有檔案的頁面，加上被提到但還沒有內容的頁面（像 Logseq）；日期連結不算。 */
export function allPages(pageNames: Iterable<string>, sources: Source[], isDate: (s: string) => boolean): PageInfo[] {
  const map = new Map<string, PageInfo>();
  for (const n of pageNames) map.set(pageKey(n), { name: n, exists: true, refs: 0 });
  for (const src of sources) {
    for (const r of refsOf(src.content)) {
      if (isDate(r)) continue;
      const k = pageKey(r);
      if (src.kind === "page" && pageKey(src.key) === k) continue;
      const info = map.get(k) ?? { name: r, exists: false, refs: 0 };
      info.refs++;
      map.set(k, info);
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
}
