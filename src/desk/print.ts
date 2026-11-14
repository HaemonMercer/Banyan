import { ALIGNMENTS, PAGE_NUMBER, RUNNING_LINE_HEIGHT, SIDES, lineParts, pageInk, pageInsets, paperSize, type PageSettings } from "./paper";

export async function printDocument(root: HTMLElement, title: string, page: PageSettings) {
    const paper = paperSize(page);
    const insets = pageInsets(page);
    const printText = (text: string) => `"${text.replace(/["\\]/g, "\\$&").replace(/[\u0000-\u001f]/g, " ")}"`;
    const marginBoxes = (["header", "footer"] as const).flatMap((part) => ALIGNMENTS.map((side) => {
        const items = lineParts(page[part], side, page.pageNumbers);
        if (!items.length) return "";
        const value = items.map((item) => item === PAGE_NUMBER ? "counter(page)" : printText(item)).join(' " " ');
        return `@${part === "header" ? "top" : "bottom"}-${side} { content: ${value}; color: ${pageInk(page.color)}; font-size: 9pt; line-height: ${RUNNING_LINE_HEIGHT}mm; vertical-align: middle; }`;
    })).join("\n");
    const content = document.createElement("main");
    content.className = "desk-print-content";
    content.dataset.theme = "light";
    // The preview's <style> for Desk styles stays in the page and keeps applying to the copies.
    for (const page of root.querySelectorAll(":scope > .desk-paper")) {
        const section = document.createElement("section");
        section.className = "desk-print-page";
        const body = page.querySelector(".md");
        if (body) section.append(body.cloneNode(true));
        content.append(section);
    }
    const pageStyle = document.createElement("style");
    pageStyle.media = "print";
    pageStyle.textContent = `
        @page {
            size: ${paper.width}mm ${paper.height}mm;
            margin: ${SIDES.map((side) => `${insets[side]}mm`).join(" ")};
            background: ${page.color};
            ${marginBoxes}
        }
        ${page.differentFirstPage ? `@page :first { ${(["top", "bottom"] as const).flatMap((edge) => ALIGNMENTS.map((side) => `@${edge}-${side} { content: none; }`)).join(" ")} }` : ""}
        ${page.columns > 1 ? `.desk-print-page { column-count: ${page.columns}; column-gap: ${page.columnGap}mm; column-fill: auto;
            height: ${paper.height - insets.top - insets.bottom - 1}mm; ${page.columnRule ? "column-rule: 0.3mm solid #b8b8b8;" : ""} }` : ""}
        html, body { height: auto; background: white; color: black; }
        body > :not(.desk-print-content) { display: none !important; }
        .desk-print-content { display: block; color: ${pageInk(page.color)}; background: ${page.color}; font-size: 11pt; overflow-wrap: anywhere; }
        .desk-print-page + .desk-print-page { break-before: page; }
        .desk-layout-columns { display: table; table-layout: fixed; width: 100%; }
        .desk-layout-column { display: table-cell; vertical-align: top; }
        .desk-layout-column + .desk-layout-column { padding-inline-start: 6mm; }
        .desk-layout-columns[data-column-widths] > .desk-layout-column { width: var(--desk-column-width); }
        .desk-page-break { break-after: page; visibility: hidden; margin: 0; }
        img { max-width: 100%; max-height: ${paper.height - insets.top - insets.bottom}mm; object-fit: contain; }
        h1, h2, h3 { break-after: avoid; }
        tr { break-inside: avoid; }
        body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    `;
    const previousTitle = document.title;
    const clean = () => {
        content.remove();
        pageStyle.remove();
        document.title = previousTitle;
        window.removeEventListener("afterprint", clean);
    };
    document.body.append(content);
    document.head.append(pageStyle);
    try {
        const images = [...content.querySelectorAll("img")].map((img) => {
            img.loading = "eager";
            return img.decode().catch(() => undefined);
        });
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                Promise.all([...images, document.fonts.ready]),
                new Promise<void>((resolve) => { timeout = setTimeout(resolve, 5000); }),
            ]);
        } finally {
            clearTimeout(timeout);
        }
        document.title = title;
        window.addEventListener("afterprint", clean, { once: true });
        window.print();
    } catch (e) {
        clean();
        throw e;
    }
}
