/**
 * 版本比較（Show changes）用的差異：區塊層級（Markdown 的區塊原始碼）與字詞層級（區塊的文字）。
 * 都是 LCS，先去掉相同的開頭與結尾；太大的時候退回整段取代，不會卡住畫面。
 */

export type Op<T> = { op: "same"; a: T; b: T } | { op: "add"; b: T } | { op: "del"; a: T };

const LIMIT = 4_000_000;

export function diffSeq<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean = (x, y) => x === y): Op<T>[] {
  let pre = 0;
  while (pre < a.length && pre < b.length && eq(a[pre], b[pre])) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && eq(a[a.length - 1 - suf], b[b.length - 1 - suf])) suf++;
  const out: Op<T>[] = [];
  for (let i = 0; i < pre; i++) out.push({ op: "same", a: a[i], b: b[i] });
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);
  const n = A.length;
  const m = B.length;
  if (n * m > LIMIT) {
    for (const x of A) out.push({ op: "del", a: x });
    for (const y of B) out.push({ op: "add", b: y });
  } else if (n || m) {
    // dp[i][j]：A[i..] 與 B[j..] 的 LCS 長度
    const w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = eq(A[i], B[j]) ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (eq(A[i], B[j])) {
        out.push({ op: "same", a: A[i++], b: B[j++] });
      } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
        out.push({ op: "del", a: A[i++] });
      } else {
        out.push({ op: "add", b: B[j++] });
      }
    }
    while (i < n) out.push({ op: "del", a: A[i++] });
    while (j < m) out.push({ op: "add", b: B[j++] });
  }
  for (let i = suf; i > 0; i--) out.push({ op: "same", a: a[a.length - i], b: b[b.length - i] });
  return out;
}

/** 斷詞：中日文一個字一個詞，其他是連續的字母數字、連續空白或單一符號。 */
export function words(text: string): string[] {
  return text.match(/[぀-ヿ㐀-鿿豈-﫿가-힯]|[\p{L}\p{N}_'’]+|\s+|[^\s]/gu) ?? [];
}

/** 文字片段的差異：相鄰同種的合併成一段。 */
export type TextPart = { op: "same" | "add" | "del"; text: string };

export function diffText(a: string, b: string): TextPart[] {
  const out: TextPart[] = [];
  for (const o of diffSeq(words(a), words(b))) {
    const text = o.op === "add" ? o.b : o.a;
    const last = out[out.length - 1];
    if (last && last.op === o.op) last.text += text;
    else out.push({ op: o.op, text });
  }
  return mergeNoise(out);
}

/** 「改、同、改」中間只隔一個空白時，把空白也算進改的部分，讀起來比較順。 */
function mergeNoise(parts: TextPart[]): TextPart[] {
  const out: TextPart[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const prev = out[out.length - 1];
    const next = parts[i + 1];
    if (p.op === "same" && /^\s$/.test(p.text) && prev && prev.op !== "same" && next && next.op !== "same") {
      out.push({ op: "del", text: p.text }, { op: "add", text: p.text });
      continue;
    }
    out.push({ ...p });
  }
  // 重新整理成「刪、加」交替、同種合併
  const merged: TextPart[] = [];
  let dels = "";
  let adds = "";
  const flush = () => {
    if (dels) merged.push({ op: "del", text: dels });
    if (adds) merged.push({ op: "add", text: adds });
    dels = adds = "";
  };
  for (const p of out) {
    if (p.op === "del") dels += p.text;
    else if (p.op === "add") adds += p.text;
    else {
      flush();
      const last = merged[merged.length - 1];
      if (last && last.op === "same") last.text += p.text;
      else merged.push(p);
    }
  }
  flush();
  return merged;
}

/** 兩段文字有多像（相同字詞占比，0～1）。 */
export function similarity(a: string, b: string): number {
  const wa = words(a).filter((w) => w.trim());
  const wb = words(b).filter((w) => w.trim());
  if (!wa.length && !wb.length) return 1;
  if (!wa.length || !wb.length) return 0;
  if (wa.length * wb.length > LIMIT) return 0;
  const same = diffSeq(wa, wb).filter((o) => o.op === "same").length;
  return (2 * same) / (wa.length + wb.length);
}

/** 區塊層級的差異：刪掉的區塊後面接著新增的區塊，夠像的配成「改」。 */
export type BlockOp<T> = { op: "same"; a: T; b: T } | { op: "add"; b: T } | { op: "del"; a: T } | { op: "change"; a: T; b: T };

export function diffBlocks<T>(a: T[], b: T[], text: (x: T) => string, min = 0.35): BlockOp<T>[] {
  const ops = diffSeq(a, b, (x, y) => text(x) === text(y));
  const out: BlockOp<T>[] = [];
  for (let i = 0; i < ops.length; ) {
    if (ops[i].op === "same") {
      out.push(ops[i++] as BlockOp<T>);
      continue;
    }
    const dels: T[] = [];
    const adds: T[] = [];
    while (i < ops.length && ops[i].op !== "same") {
      const o = ops[i++];
      if (o.op === "del") dels.push(o.a);
      else if (o.op === "add") adds.push(o.b);
    }
    // 依順序配對：新增的區塊找後面第一個夠像的刪掉區塊，配成「改」（跳過的刪掉區塊照樣是刪）
    let d = 0;
    for (const add of adds) {
      let k = d;
      while (k < dels.length && similarity(text(dels[k]), text(add)) < min) k++;
      if (k < dels.length) {
        while (d < k) out.push({ op: "del", a: dels[d++] });
        out.push({ op: "change", a: dels[d++], b: add });
      } else out.push({ op: "add", b: add });
    }
    while (d < dels.length) out.push({ op: "del", a: dels[d++] });
  }
  return out;
}
