/** One piece of a comparison: kept, added or removed. */
export interface DiffPart {
    kind: "same" | "add" | "del";
    text: string;
}

/** Above this many cells the LCS table is skipped and the middle is shown as replaced. */
const MAX_CELLS = 4_000_000;

/**
 * Longest-common-subsequence diff of two token lists. Shared leading and trailing tokens are
 * trimmed first, so typical edits stay cheap even in long texts.
 */
function diffSeq(a: string[], b: string[]): DiffPart[] {
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
        endA--;
        endB--;
    }
    const out: DiffPart[] = a.slice(0, start).map((text) => ({ kind: "same", text }));
    const x = a.slice(start, endA);
    const y = b.slice(start, endB);
    const n = x.length;
    const m = y.length;

    if ((n + 1) * (m + 1) > MAX_CELLS) {
        out.push(...x.map((text): DiffPart => ({ kind: "del", text })), ...y.map((text): DiffPart => ({ kind: "add", text })));
    } else {
        // lcs[i * w + j] = LCS length of x[i..] and y[j..].
        const w = m + 1;
        const lcs = new Uint32Array((n + 1) * w);
        for (let i = n - 1; i >= 0; i--) {
            for (let j = m - 1; j >= 0; j--) {
                lcs[i * w + j] = x[i] === y[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
            }
        }
        let i = 0;
        let j = 0;
        while (i < n && j < m) {
            if (x[i] === y[j]) {
                out.push({ kind: "same", text: x[i] });
                i++;
                j++;
            } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) {
                out.push({ kind: "del", text: x[i++] });
            } else {
                out.push({ kind: "add", text: y[j++] });
            }
        }
        while (i < n) out.push({ kind: "del", text: x[i++] });
        while (j < m) out.push({ kind: "add", text: y[j++] });
    }
    out.push(...a.slice(endA).map((text): DiffPart => ({ kind: "same", text })));
    return out;
}

/** Joins neighbouring parts of the same kind. */
function merge(parts: DiffPart[]): DiffPart[] {
    const out: DiffPart[] = [];
    for (const p of parts) {
        const last = out[out.length - 1];
        if (last && last.kind === p.kind) last.text += p.text;
        else out.push({ ...p });
    }
    return out;
}

/** Words, runs of spaces, and single characters (so Chinese is compared character by character). */
const TOKEN = /[A-Za-z0-9_]+|\s+|[\s\S]/gu;

/** Inline diff of two short texts, as Google Docs shows changes inside a paragraph. */
export function diffInline(before: string, after: string): DiffPart[] {
    return merge(diffSeq(before.match(TOKEN) ?? [], after.match(TOKEN) ?? []));
}

/**
 * Splits Markdown into blocks at blank lines, keeping fenced code and `$$` math blocks whole so
 * each block still renders on its own.
 */
export function markdownBlocks(text: string): string[] {
    const blocks: string[] = [];
    let cur: string[] = [];
    let fence: string | null = null;
    for (const line of text.split("\n")) {
        const t = line.trim();
        if (fence) {
            cur.push(line);
            if (t.startsWith(fence)) fence = null;
            continue;
        }
        const open = /^(`{3,}|~{3,}|\$\$)/.exec(t);
        if (open && !(open[1] === "$$" && t.length > 2 && t.endsWith("$$"))) {
            fence = open[1];
            cur.push(line);
            continue;
        }
        if (t === "") {
            if (cur.length > 0) blocks.push(cur.join("\n"));
            cur = [];
        } else {
            cur.push(line);
        }
    }
    if (cur.length > 0) blocks.push(cur.join("\n"));
    return blocks;
}

/** A block of the compared document: unchanged (rendered as Markdown) or changed (inline diff). */
export type DocBlock = { kind: "same"; text: string } | { kind: "changed"; parts: DiffPart[] };

/** Compares two Markdown texts block by block; changed blocks carry an inline diff. */
export function diffDocument(before: string, after: string): DocBlock[] {
    const parts = diffSeq(markdownBlocks(before), markdownBlocks(after));
    const out: DocBlock[] = [];
    let i = 0;
    while (i < parts.length) {
        if (parts[i].kind === "same") {
            out.push({ kind: "same", text: parts[i++].text });
            continue;
        }
        const del: string[] = [];
        const add: string[] = [];
        while (i < parts.length && parts[i].kind !== "same") {
            (parts[i].kind === "del" ? del : add).push(parts[i].text);
            i++;
        }
        out.push({ kind: "changed", parts: diffInline(del.join("\n\n"), add.join("\n\n")) });
    }
    return out;
}

/** Number of characters added and removed (whitespace not counted). */
export function changeStats(blocks: DocBlock[]): { added: number; removed: number } {
    let added = 0;
    let removed = 0;
    for (const b of blocks) {
        if (b.kind !== "changed") continue;
        for (const p of b.parts) {
            const n = p.text.replace(/\s+/g, "").length;
            if (p.kind === "add") added += n;
            else if (p.kind === "del") removed += n;
        }
    }
    return { added, removed };
}
