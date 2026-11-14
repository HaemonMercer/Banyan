import type { MdNode } from "../markdown/ast.ts";

/**
 * Automatic pages for the Desk preview. The preview measures where each block ends up and starts a
 * new page before the first block that would cross the bottom margin; `::page` still forces one.
 * Breaks are source offsets, so they survive re-rendering; this file has no DOM so it can be tested.
 */

/** Splits the body's top-level blocks at `::page` and before the blocks that hold a break offset. */
export function splitPages(children: MdNode[], breaks: readonly number[] = []): MdNode[][] {
    const pages: MdNode[][] = [[]];
    const wanted = new Set<number>();
    // A break offset may sit inside a block (a list's first paragraph): break before the block that holds it.
    for (const offset of breaks) {
        let index = -1;
        for (let i = 0; i < children.length && children[i].start <= offset; i++) index = i;
        if (index > 0) wanted.add(index);
    }
    children.forEach((block, index) => {
        const current = pages[pages.length - 1];
        if (block.type === "pageBreak") pages.push([]);
        else {
            // Don't open an empty page, or one that holds only ::push/::pop markers.
            if (wanted.has(index) && current.some((node) => !isMarker(node))) pages.push([]);
            pages[pages.length - 1].push(block);
        }
    });
    return pages;
}

const isMarker = (node: MdNode) => node.type === "layout" && (node.kind === "stylePush" || node.kind === "stylePop");

/** A rendered block on a page: its box in pixels and the source offset it starts at (null when unknown). */
export interface PlacedBlock { top: number; bottom: number; offset: number | null }

/** A rendered block on a page with text columns: the first and last column its pieces sit in (0-based). */
export interface ColumnBlock { offset: number | null; startColumn: number; endColumn: number }

/**
 * With text columns, the content area has a fixed height and what doesn't fit flows into columns
 * past the page's last one. The page breaks before the first block that reaches past `columns`.
 * Only the first break of a page is certain (moving a block changes everything after it), so the
 * preview takes one per page and measures again.
 */
export function pickColumnBreak(blocks: readonly ColumnBlock[], columns: number): number[] {
    for (const [index, block] of blocks.entries()) {
        if (index > 0 && block.offset !== null && block.endColumn >= columns) return [block.offset];
    }
    return [];
}

/** The column a horizontal position falls in, for a content area starting at `left`. */
export function columnAt(x: number, left: number, columnWidth: number, gap: number) {
    return Math.max(0, Math.floor((x - left + 1) / (columnWidth + gap)));
}

/**
 * Where to start new pages so no page runs past `height` pixels of content, given the blocks of
 * one rendered page from top to bottom and the top of its content area. A block taller than a
 * page stays whole on its own page; blocks without an offset stay with the one before them.
 */
export function pickBreaks(blocks: readonly PlacedBlock[], contentTop: number, height: number): number[] {
    const breaks: number[] = [];
    let pageTop = contentTop;
    let first = true;
    for (const block of blocks) {
        if (!first && block.offset !== null && block.bottom - pageTop > height + 0.5) {
            breaks.push(block.offset);
            pageTop = block.top;
        }
        first = false;
    }
    return breaks;
}
