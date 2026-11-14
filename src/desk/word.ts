import { escapeXml } from "../markdown/common";
import { ALIGNMENTS, PAGE_NUMBER, RUNNING_LINE_HEIGHT, SIDES, lineParts, pageInk, pageInsets, paperSize, runningLineOffset, type PageSettings, type RunningLine } from "./paper";

const twips = (mm: number) => Math.round(mm * 1440 / 25.4);
const paragraph = (content: string, properties = "") =>
    `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ""}${content}</w:p>`;

/** Converts the visible Markdown preview to editable Word paragraphs, runs and tables. */
export function wordDocument(root: HTMLElement, page: PageSettings) {
    const paper = paperSize(page);
    const ink = pageInk(page.color).slice(1);
    const color = `<w:color w:val="${ink}"/>`;
    const run = (text: string, styles: string) => {
        const properties = new Map<string, string>();
        for (const [tag, name] of (color + styles).matchAll(/<w:(\w+)\b[^>]*\/>/g)) properties.set(name, tag);
        return `<w:r><w:rPr>${[...properties.values()].join("")}</w:rPr><w:t xml:space="preserve">${escapeXml(text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ""))}</w:t></w:r>`;
    };
    function inline(node: Node, styles = ""): string {
        if (node.nodeType === Node.TEXT_NODE) return run(node.textContent ?? "", styles + deskStyle(node.parentElement));
        if (!(node instanceof HTMLElement)) return "";
        if (node.tagName === "BR") return "<w:r><w:br/></w:r>";
        if (node instanceof HTMLImageElement) return run(node.alt, styles);
        if (node instanceof HTMLInputElement) return run(node.checked ? "☑ " : "☐ ", styles);
        if (node.classList.contains("katex-html") || node.tagName === "SVG") return "";
        const extra: Record<string, string> = {
            U: '<w:u w:val="single"/>', SUP: '<w:vertAlign w:val="superscript"/>', SUB: '<w:vertAlign w:val="subscript"/>',
            STRONG: "<w:b/>", B: "<w:b/>", EM: "<w:i/>", I: "<w:i/>",
            DEL: "<w:strike/>", MARK: '<w:highlight w:val="yellow"/>',
            CODE: '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>',
            A: '<w:color w:val="24587A"/><w:u w:val="single"/>',
        };
        const next = extra[node.tagName] ?? "";
        return Array.from(node.childNodes, (child) => inline(child, styles + next)).join("");
    }

    /** Run properties from Desk styles (`::push` scopes and `::style` spans), read from the rendered preview. */
    function deskStyle(element: Element | null): string {
        if (!element?.closest("[data-desk-scope], [data-desk-text]")) return "";
        const css = getComputedStyle(element);
        // Word has no transparency: blend a translucent colour onto the paper; leave out a fully transparent one.
        const paperRgb = (page.color.match(/[0-9a-f]{2}/gi) ?? ["ff", "ff", "ff"]).map((part) => parseInt(part, 16));
        const hex = (value: string) => {
            const [r, g, b, a = 1] = value.match(/[\d.]+/g)?.map(Number) ?? [];
            if (a === 0 || r === undefined) return null;
            return [r, g, b].map((n, i) => Math.round(n * a + paperRgb[i] * (1 - a)).toString(16).padStart(2, "0")).join("").toUpperCase();
        };
        const size = Math.round(parseFloat(css.fontSize) * 0.75 * 2);
        const family = css.fontFamily.split(",")[0]?.trim().replace(/^["']|["']$/g, "");
        const colour = hex(css.color);
        // Backgrounds aren't inherited: text sits in spans inside <mark> and friends, so look up to the block.
        let shaded: Element | null = element;
        while (shaded && !/^(P|LI|H[1-6]|TD|TH|DIV|BLOCKQUOTE)$/.test(shaded.tagName) && hex(getComputedStyle(shaded).backgroundColor) === null) {
            shaded = shaded.parentElement;
        }
        const background = shaded ? hex(getComputedStyle(shaded).backgroundColor) : null;
        return [
            Number(css.fontWeight) >= 600 ? "<w:b/>" : '<w:b w:val="0"/>',
            css.fontStyle === "italic" ? "<w:i/>" : '<w:i w:val="0"/>',
            css.textDecorationLine.includes("underline") ? '<w:u w:val="single"/>' : "",
            css.textDecorationLine.includes("line-through") ? "<w:strike/>" : "",
            colour ? `<w:color w:val="${colour}"/>` : "",
            size > 0 ? `<w:sz w:val="${size}"/>` : "",
            family ? `<w:rFonts w:ascii="${escapeXml(family)}" w:hAnsi="${escapeXml(family)}" w:eastAsia="${escapeXml(family)}"/>` : "",
            background ? `<w:shd w:val="clear" w:color="auto" w:fill="${background}"/>` : "",
        ].join("");
    }

    function table(rows: HTMLElement[][], width: number, ratios: number[] | undefined, properties: string): string {
        if (!rows.length) return "";
        const count = Math.max(...rows.map((row) => row.length));
        const weights = ratios?.length === count ? ratios : Array.from({ length: count }, () => 1);
        const total = weights.reduce((sum, weight) => sum + weight, 0);
        let used = 0;
        let fraction = 0;
        const widths = weights.map((weight) => {
            fraction += weight / total;
            const next = Math.round(width * fraction);
            const cell = next - used;
            used = next;
            return cell;
        });
        const borders = ["top", "left", "bottom", "right", "insideH", "insideV"]
            .map((side) => `<w:${side} w:val="single" w:sz="4" w:color="B8B8B8"/>`).join("");
        return `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/>${rows[0][0]?.classList.contains("desk-layout-column") ? "" : `<w:tblBorders>${borders}</w:tblBorders>`}<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${
            widths.map((size) => `<w:gridCol w:w="${size}"/>`).join("")
        }</w:tblGrid>${rows.map((row) => `<w:tr>${widths.map((size, i) =>
            `<w:tc><w:tcPr><w:tcW w:w="${size}" w:type="dxa"/></w:tcPr>${row[i] ? blocks(row[i], size, properties) : ""}<w:p/></w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`;
    }

    function blocks(parent: HTMLElement, width: number, properties = ""): string {
        const align = (value: string) => value ? `<w:jc w:val="${value === "justify" ? "both" : value}"/>` : "";
        if (parent.style.textAlign) properties = align(parent.style.textAlign);
        return Array.from(parent.childNodes, (node) => {
            if (!(node instanceof HTMLElement)) return node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
                ? paragraph(inline(node), properties) : "";
            if (node.classList.contains("desk-page-break")) return paragraph('<w:r><w:br w:type="page"/></w:r>');
            if (node.classList.contains("desk-layout-columns")) {
                return table([Array.from(node.children) as HTMLElement[]], width, node.dataset.columnWidths?.split(":").map(Number), properties);
            }
            if (node.classList.contains("desk-layout-box")) return table([[node]], width, undefined, properties);
            if (node instanceof HTMLTableElement) return table(Array.from(node.rows, (row) => Array.from(row.cells)), width, undefined, properties);
            if (node.tagName === "PRE") return paragraph((node.textContent ?? "").split("\n")
                .map((line) => run(line, '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>')).join("<w:r><w:br/></w:r>"), properties);
            if (node.tagName === "UL" || node.tagName === "OL") {
                const start = node instanceof HTMLOListElement ? node.start : 1;
                return Array.from(node.children, (item, i) => paragraph(run(node.tagName === "OL" ? `${start + i}. ` : "• ", "") + inline(item), properties)).join("");
            }
            if (/^H[1-6]$/.test(node.tagName)) {
                const level = Number(node.tagName[1]);
                const heading = `<w:b/><w:sz w:val="${36 - (level - 1) * 3}"/>`;
                return paragraph(inline(node, heading),
                    `<w:keepNext/>${properties}<w:outlineLvl w:val="${level - 1}"/>`);
            }
            if (["DIV", "SECTION", "NAV", "BLOCKQUOTE", "DETAILS"].includes(node.tagName)) return blocks(node, width, properties);
            if (node.tagName === "HR") return paragraph("", '<w:pBdr><w:bottom w:val="single" w:sz="4" w:color="B8B8B8"/></w:pBdr>');
            return paragraph(inline(node), properties);
        }).join("");
    }

    const insets = pageInsets(page);
    const width = twips(paper.width - insets.left - insets.right);
    // Tables and boxes are as wide as one text column.
    const textWidth = Math.floor((width - twips(page.columnGap) * (page.columns - 1)) / page.columns);
    const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const runningText = (tag: string, line: RunningLine) => {
        const style = '<w:sz w:val="18"/>';
        const cells = ALIGNMENTS.map((side) => {
            const content = lineParts(line, side, page.pageNumbers).map((item) => item === PAGE_NUMBER
                ? `<w:fldSimple w:instr=" PAGE ">${run("1", style)}</w:fldSimple>`
                : run(item, style)).join(run(" ", style));
            return `<w:tc><w:tcPr><w:tcW w:w="${Math.floor(width / 3)}" w:type="dxa"/></w:tcPr>${paragraph(content,
                `<w:spacing w:before="0" w:after="0" w:line="${twips(RUNNING_LINE_HEIGHT)}" w:lineRule="exact"/><w:jc w:val="${side}"/>`)}</w:tc>`;
        }).join("");
        return `${xml}<w:${tag} ${ns}><w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${
            ALIGNMENTS.map(() => `<w:gridCol w:w="${Math.floor(width / 3)}"/>`).join("")
        }</w:tblGrid><w:tr>${cells}</w:tr></w:tbl></w:${tag}>`;
    };
    const document = `${xml}<w:document ${ns} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:background w:color="${page.color.slice(1)}"/><w:body>${
        Array.from(root.querySelectorAll(":scope > .desk-paper"), (sheet) => {
            const body = sheet.querySelector<HTMLElement>(".md");
            return body ? blocks(body, textWidth) : "";
        })
            .join(paragraph('<w:r><w:br w:type="page"/></w:r>'))
    }<w:sectPr><w:headerReference w:type="default" r:id="header"/><w:footerReference w:type="default" r:id="footer"/><w:pgSz w:w="${twips(paper.width)}" w:h="${twips(paper.height)}"${page.orientation === "landscape" ? ' w:orient="landscape"' : ""}/><w:pgMar ${SIDES.map((side) => `w:${side}="${twips(insets[side])}"`).join(" ")} w:header="${twips(runningLineOffset(insets.top))}" w:footer="${twips(runningLineOffset(insets.bottom))}" w:gutter="0"/>${page.columns > 1 ? `<w:cols w:num="${page.columns}" w:space="${twips(page.columnGap)}"${page.columnRule ? ' w:sep="1"' : ""}/>` : ""}${page.differentFirstPage ? "<w:titlePg/>" : ""}</w:sectPr></w:body></w:document>`;
    return { document, header: runningText("hdr", page.header), footer: runningText("ftr", page.footer) };
}
