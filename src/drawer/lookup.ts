/**
 * 用識別碼加條目（Zotero 的「Add Item by Identifier」）：
 * DOI、arXiv（轉成 DataCite 的 DOI）用 doi.org 的內容協商拿 CSL-JSON；ISBN 用 Open Library；
 * 其他網址直接建一個網頁條目。
 */

import { fromCsl } from "./cite";
import { blankItem, parseName, type Creator, type Item } from "./model";

export type Identifier =
  | { kind: "doi"; value: string }
  | { kind: "isbn"; value: string }
  | { kind: "url"; value: string };

const DOI = /\b(10\.\d{4,9}\/[^\s"<>]+)/i;

/** ISBN-10／13 的檢查碼。 */
export function validIsbn(raw: string): boolean {
  const s = raw.replace(/[-\s]/g, "").toUpperCase();
  if (/^\d{9}[\dX]$/.test(s)) {
    const sum = [...s].reduce((t, c, i) => t + (c === "X" ? 10 : +c) * (10 - i), 0);
    return sum % 11 === 0;
  }
  if (/^\d{13}$/.test(s)) {
    const sum = [...s].reduce((t, c, i) => t + +c * (i % 2 ? 3 : 1), 0);
    return sum % 10 === 0;
  }
  return false;
}

/** 判斷使用者貼上的是什麼（DOI、DOI 網址、arXiv、ISBN、一般網址）。 */
export function parseIdentifier(raw: string): Identifier | null {
  const s = raw.trim();
  if (!s) return null;
  const doi = DOI.exec(s);
  if (doi) return { kind: "doi", value: doi[1].replace(/[.,;)\]]+$/, "") };
  const arxiv = /(?:arxiv(?:\.org\/(?:abs|pdf)\/|:)\s*)?\b(\d{4}\.\d{4,5})(?:v\d+)?\b/i.exec(s);
  if (arxiv && (/arxiv/i.test(s) || /^\d{4}\.\d{4,5}(v\d+)?$/.test(s))) return { kind: "doi", value: `10.48550/arXiv.${arxiv[1]}` };
  const isbn = s.replace(/^isbn[:\s]*/i, "");
  if (validIsbn(isbn)) return { kind: "isbn", value: isbn.replace(/[-\s]/g, "").toUpperCase() };
  if (/^https?:\/\/\S+$/i.test(s)) return { kind: "url", value: s };
  if (/^www\.\S+\.\S+$/i.test(s)) return { kind: "url", value: `https://${s}` };
  return null;
}

/** 今天（當地時間）的 YYYY-MM-DD。 */
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Open Library 的書目 → 條目。 */
export function fromOpenLibrary(o: Record<string, unknown>, isbn: string): Item {
  const it = blankItem("book", 0);
  const names = (v: unknown) => (Array.isArray(v) ? v.map((x) => String((x as { name?: string }).name ?? "")).filter(Boolean) : []);
  it.title = String(o.title ?? "").trim();
  if (o.subtitle) it.title += `: ${String(o.subtitle).trim()}`;
  it.creators = names(o.authors)
    .map((n) => parseName(n))
    .filter((c): c is Creator => !!c);
  it.publisher = names(o.publishers)[0] ?? "";
  it.place = names(o.publish_places)[0] ?? "";
  const y = /\d{4}/.exec(String(o.publish_date ?? ""));
  it.date = y ? y[0] : "";
  it.isbn = isbn;
  it.url = typeof o.url === "string" ? o.url : "";
  return it;
}

type Fetch = typeof fetch;

/** 查書目資料；網路或找不到時丟出錯誤（訊息給使用者看）。 */
export async function lookup(id: Identifier, f: Fetch = fetch): Promise<Item> {
  if (id.kind === "url") {
    const it = blankItem("webpage", 0);
    it.url = id.value;
    it.accessed = todayKey();
    try {
      it.container = new URL(id.value).hostname.replace(/^www\./, "");
    } catch {
      /* 網址怪怪的就不填網站名稱 */
    }
    it.title = id.value;
    return it;
  }
  if (id.kind === "doi") {
    let res: Response;
    try {
      res = await f(`https://doi.org/${encodeURI(id.value)}`, {
        headers: { Accept: "application/vnd.citationstyles.csl+json" },
      });
    } catch {
      throw new Error("Couldn't reach doi.org. Check your internet connection.");
    }
    if (res.status === 404) throw new Error(`No record found for DOI ${id.value}.`);
    if (!res.ok) throw new Error(`doi.org answered ${res.status}. Try again later.`);
    const it = fromCsl(await res.json());
    if (!it.doi) it.doi = id.value;
    it.key = "";
    return it;
  }
  let res: Response;
  try {
    res = await f(`https://openlibrary.org/api/books?bibkeys=ISBN:${id.value}&format=json&jscmd=data`);
  } catch {
    throw new Error("Couldn't reach Open Library. Check your internet connection.");
  }
  if (!res.ok) throw new Error(`Open Library answered ${res.status}. Try again later.`);
  const data = (await res.json()) as Record<string, Record<string, unknown>>;
  const rec = data[`ISBN:${id.value}`];
  if (!rec) throw new Error(`No book found for ISBN ${id.value}.`);
  return fromOpenLibrary(rec, id.value);
}
