/**
 * 嵌入頁面的內容來源：`![[名稱]]`（Obsidian 的寫法）。
 *
 * App 把所有頁面與日記的內容交給 `setEmbedSources`；編輯器顯示嵌入時用 `embedSource` 查。
 * 只有「被嵌入過」的頁面內容改變時才通知編輯器重畫（`refsChanged`），在別的頁面打字不會讓每個編輯器重畫。
 */
import { refsChanged } from "../drawer/citeRef";
import { pageKey } from "./pageRef";

let sources = new Map<string, string>();
/** 顯示過的嵌入：頁面鍵 → 當時的內容 */
const used = new Map<string, string | undefined>();

/** 設定可以嵌入的內容（鍵是頁面名稱或日記日期 `YYYY-MM-DD`）。 */
export function setEmbedSources(entries: Iterable<[string, string]>): void {
  const next = new Map<string, string>();
  for (const [name, content] of entries) next.set(pageKey(name), content);
  sources = next;
  let changed = false;
  for (const [k, v] of used) if (next.get(k) !== v) changed = true;
  if (changed) {
    used.clear();
    refsChanged();
  }
}

/** 頁面或日記的原始碼（沒有這一頁就是 undefined）。 */
export function embedSource(name: string): string | undefined {
  const k = pageKey(name);
  const v = sources.get(k);
  used.set(k, v);
  return v;
}
