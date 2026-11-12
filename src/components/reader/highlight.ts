/**
 * Finds `query` in the text under `root` (ignoring case; a hit may run across several text nodes,
 * as in a PDF text layer) and wraps each hit in <mark class="reader-hit">. Returns one element per
 * hit, in document order (the first piece of hits that span nodes).
 */
export function markMatches(root: Node, query: string): HTMLElement[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const doc = root.ownerDocument ?? (root as Document);
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) =>
            n.parentElement?.closest("script, style, mark.reader-hit") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const nodes: Text[] = [];
    const starts: number[] = [];
    let text = "";
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        nodes.push(n as Text);
        starts.push(text.length);
        text += (n as Text).data;
    }
    const lower = text.toLowerCase();
    if (lower.length !== text.length) return []; // case folding changed lengths: offsets wouldn't line up
    const hits: [number, number][] = [];
    for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, i + q.length)) hits.push([i, i + q.length]);
    if (hits.length === 0) return [];

    // Pieces per text node, wrapped from the end of each node so earlier offsets stay valid.
    const firstPiece: (HTMLElement | null)[] = hits.map(() => null);
    nodes.forEach((node, ni) => {
        const s0 = starts[ni];
        const s1 = s0 + node.data.length;
        const pieces: { from: number; to: number; hit: number }[] = [];
        hits.forEach(([a, b], hi) => {
            if (b > s0 && a < s1) pieces.push({ from: Math.max(a, s0) - s0, to: Math.min(b, s1) - s0, hit: hi });
        });
        for (const p of pieces.reverse()) {
            const tail = node.splitText(p.to);
            const middle = node.splitText(p.from);
            const mark = doc.createElement("mark");
            mark.className = "reader-hit";
            middle.parentNode!.insertBefore(mark, tail);
            mark.appendChild(middle);
            // Nodes go in document order, so a hit's first piece is the one found first.
            if (!firstPiece[p.hit]) firstPiece[p.hit] = mark;
        }
    });
    return firstPiece.filter((m): m is HTMLElement => m !== null);
}

/** Removes the marks added by `markMatches`. */
export function clearMarks(root: ParentNode) {
    root.querySelectorAll("mark.reader-hit").forEach((m) => {
        const parent = m.parentNode!;
        while (m.firstChild) parent.insertBefore(m.firstChild, m);
        parent.removeChild(m);
        parent.normalize();
    });
}

/** Number of hits of `query` in `text` (ignoring case). */
export function countMatches(text: string, query: string): number {
    const q = query.trim().toLowerCase();
    if (!q) return 0;
    const t = text.toLowerCase();
    let n = 0;
    for (let i = t.indexOf(q); i >= 0; i = t.indexOf(q, i + q.length)) n++;
    return n;
}

// ---------- annotations in book chapters: character offsets in the body's text ----------

/** Offsets of a selection in `root`'s text (as Range.toString counts it), or null if outside. */
export function rangeOffsets(root: Node, range: Range): { start: number; end: number } | null {
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
    const pre = (root.ownerDocument ?? (root as Document)).createRange();
    pre.selectNodeContents(root);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    return { start, end: start + range.toString().length };
}

/**
 * Wraps the text between two offsets (counted like `rangeOffsets`) in elements made by `make`,
 * one per text node it crosses. Returns them in document order.
 */
export function wrapOffsets(root: Node, start: number, end: number, make: () => HTMLElement): HTMLElement[] {
    if (end <= start) return [];
    const doc = root.ownerDocument ?? (root as Document);
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const pieces: { node: Text; from: number; to: number }[] = [];
    let pos = 0;
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
        const len = n.data.length;
        if (pos + len > start && pos < end) pieces.push({ node: n, from: Math.max(start, pos) - pos, to: Math.min(end, pos + len) - pos });
        pos += len;
        if (pos >= end) break;
    }
    return pieces
        .filter((p) => p.to > p.from && p.node.data.slice(p.from, p.to).trim() !== "")
        .map((p) => {
            p.node.splitText(p.to);
            const middle = p.from > 0 ? p.node.splitText(p.from) : p.node;
            const el = make();
            middle.parentNode!.insertBefore(el, middle);
            el.appendChild(middle);
            return el;
        });
}

/** Unwraps elements matching `selector` (keeps their text). */
export function unwrapAll(root: ParentNode, selector: string) {
    root.querySelectorAll(selector).forEach((m) => {
        const parent = m.parentNode!;
        while (m.firstChild) parent.insertBefore(m.firstChild, m);
        parent.removeChild(m);
        parent.normalize();
    });
}

/** The rectangles of the text a range covers (one set per text node, no element boxes). */
export function textRects(range: Range): DOMRect[] {
    const root = range.commonAncestorContainer;
    const doc = root.ownerDocument ?? (root as Document);
    const out: DOMRect[] = [];
    const visit = (n: Text) => {
        const sub = doc.createRange();
        sub.setStart(n, n === range.startContainer ? range.startOffset : 0);
        sub.setEnd(n, n === range.endContainer ? range.endOffset : n.data.length);
        for (const r of Array.from(sub.getClientRects())) if (r.width >= 1 && r.height >= 1) out.push(r);
    };
    if (root.nodeType === Node.TEXT_NODE) {
        visit(root as Text);
        return out;
    }
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
        if (range.intersectsNode(n)) visit(n);
    }
    return out;
}
