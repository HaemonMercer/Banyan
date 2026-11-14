/**
 * Tab and Shift+Tab on Markdown list items, like a word processor. A sub-item has to start where
 * its parent's text starts (`- ` → 2 spaces, `2. ` → 3, `10. ` → 4), so a fixed two-space indent
 * can't nest numbered lists. These functions move items to exactly that column, take the lines
 * under an item (its continuation and sub-items) along, and number a new sub-list from 1.
 * No DOM or editor: they return changes on the original text, so the editor keeps the cursor.
 */

export interface TextChange { from: number; to: number; insert: string }

const ITEM = /^( *)([-*+]|(\d{1,9})([.)]))( +|$)/;

interface Line { from: number; text: string; indent: number; blank: boolean; item?: Item }
interface Item { marker: string; number?: number; delimiter?: string; content: number }

function readLines(text: string): Line[] {
    const lines: Line[] = [];
    let from = 0;
    for (const raw of text.split("\n")) {
        const line = raw.replace(/\r$/, "");
        const indent = /^ */.exec(line)![0].length;
        const match = ITEM.exec(line);
        const item = match ? {
            marker: match[2],
            number: match[3] !== undefined ? Number(match[3]) : undefined,
            delimiter: match[4],
            // More than four spaces after the marker: the text is indented code, the content starts one space in.
            content: indent + match[2].length + (match[5].length > 4 || !match[5] ? 1 : match[5].length),
        } : undefined;
        lines.push({ from, text: line, indent, blank: !line.trim(), item });
        from += raw.length + 1;
    }
    return lines;
}

/** The lines under item `index`: blank lines and lines indented past the item, up to the next line that isn't. */
function bodyEnd(lines: Line[], index: number) {
    let end = index;
    for (let i = index + 1; i < lines.length; i++) {
        if (lines[i].blank) continue;
        if (lines[i].indent <= lines[index].indent) break;
        end = i;
    }
    return end;
}

/** The nearest list item above `index` at an indent of at most `indent`, skipping deeper lines. */
function itemAbove(lines: Line[], index: number, indent: number) {
    for (let i = index - 1; i >= 0; i--) {
        const line = lines[i];
        if (line.blank || line.indent > indent) continue;
        return line.item ? i : -1;
    }
    return -1;
}

/**
 * Changes that indent (or with `outdent`, outdent) the list items on the lines from `from` to `to`.
 * Returns null when none of those lines is a list item, so Tab keeps its usual meaning there.
 */
export function indentListItems(text: string, from: number, to: number, outdent = false): TextChange[] | null {
    const lines = readLines(text);
    const first = lines.findIndex((_line, i) => from < (lines[i + 1]?.from ?? Infinity));
    const last = lines.findIndex((_line, i) => to < (lines[i + 1]?.from ?? Infinity) || i === lines.length - 1);
    const selected = lines.slice(first, last + 1).map((line, offset) => ({ line, index: first + offset })).filter(({ line }) => line.item);
    if (!selected.length) return null;

    // Work on a copy so each item sees where the ones before it went; changes are on the original text.
    const indents = lines.map((line) => line.indent);
    const numbers = new Map<number, number>();
    const moved = new Set<number>();
    const view = () => lines.map((line, i) => ({ ...line, indent: indents[i] }));
    /** Numbers the numbered items after `start` at its indent on from its number, like a word processor. */
    const renumberFrom = (start: number) => {
        let number = numbers.get(start) ?? lines[start].item?.number;
        if (number === undefined) return;
        for (let i = start + 1; i < lines.length; i++) {
            if (lines[i].blank || indents[i] > indents[start]) continue;
            if (indents[i] < indents[start] || lines[i].item?.number === undefined) break;
            numbers.set(i, ++number);
        }
    };
    for (const { index } of selected) {
        if (moved.has(index)) continue;
        const current = view();
        const line = current[index];
        let target: number;
        let sibling = -1;
        if (outdent) {
            const parent = itemAbove(current, index, line.indent - 1);
            if (parent < 0) continue;
            target = current[parent].indent;
        } else {
            sibling = itemAbove(current, index, line.indent);
            // The first item of a list has nothing to go under.
            if (sibling < 0 || current[sibling].indent !== line.indent) continue;
            target = current[sibling].item!.content;
        }
        const shift = target - line.indent;
        if (!shift) continue;
        const end = bodyEnd(current, index);
        for (let i = index; i <= end; i++) {
            if (i > index) moved.add(i);
            if (!current[i].blank) indents[i] = Math.max(0, indents[i] + shift);
        }
        // A numbered item that now starts a sub-list starts it at 1; one that joins a list follows on.
        if (line.item!.number !== undefined) {
            const above = itemAbove(view(), index, target);
            const previous = above >= 0 && indents[above] === target ? lines[above].item : undefined;
            numbers.set(index, previous?.number !== undefined ? (numbers.get(above) ?? previous.number) + 1 : 1);
            renumberFrom(index);
        }
        if (sibling >= 0) {
            // The items left behind follow on from the one before the moved item.
            renumberFrom(sibling);
        } else if (outdent) {
            // The items that came after it at its old level are now its sub-list, numbered from 1.
            let next = end + 1;
            while (next < lines.length && lines[next].blank) next++;
            if (next < lines.length && indents[next] === line.indent && lines[next].item?.number !== undefined) {
                numbers.set(next, 1);
                renumberFrom(next);
            }
        }
    }

    const changes: TextChange[] = [];
    lines.forEach((line, i) => {
        if (line.blank) return;
        const number = numbers.get(i);
        const prefix = number !== undefined ? line.indent + line.item!.marker.length : line.indent;
        const insert = " ".repeat(indents[i]) + (number !== undefined ? `${number}${line.item!.delimiter}` : "");
        if (insert !== line.text.slice(0, prefix)) changes.push({ from: line.from, to: line.from + prefix, insert });
    });
    return changes;
}
