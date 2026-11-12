/**
 * HTML output in the reference (commonmark.js / cmark-gfm) format. Used by the spec tests and for
 * copying as HTML. Raw HTML passes through unchanged here; the app's React renderer never does that.
 */
import type { Document, MdNode } from "./ast.ts";
import { escapeXml } from "./common.ts";

export interface HtmlOptions {
    /** Render soft line breaks as `<br />` (BFM: a single newline is a line break). */
    breaks?: boolean;
}

export function renderHtml(doc: Document, options: HtmlOptions = {}): string {
    const out: string[] = [];
    let lastOut = "\n";
    const lit = (s: string) => {
        if (s.length === 0) return;
        out.push(s);
        lastOut = s;
    };
    const cr = () => {
        if (lastOut[lastOut.length - 1] !== "\n") lit("\n");
    };

    const plain = (nodes: MdNode[] | undefined): string => {
        let s = "";
        for (const n of nodes ?? []) {
            if (n.type === "text" || n.type === "code" || n.type === "math") s += n.value ?? "";
            else if (n.type === "softBreak" || n.type === "hardBreak") s += "\n";
            else if (n.type === "htmlInline") s += "";
            else if (n.type === "wikiLink") s += n.label || n.target || "";
            else s += plain(n.children);
        }
        return s;
    };

    const inline = (nodes: MdNode[] | undefined) => {
        for (const n of nodes ?? []) {
            switch (n.type) {
                case "text":
                    lit(escapeXml(n.value ?? ""));
                    break;
                case "softBreak":
                    lit(options.breaks ? "<br />\n" : "\n");
                    break;
                case "hardBreak":
                    lit("<br />");
                    cr();
                    break;
                case "code":
                    lit("<code>" + escapeXml(n.value ?? "") + "</code>");
                    break;
                case "htmlInline":
                    lit(n.value ?? "");
                    break;
                case "emphasis":
                    lit("<em>");
                    inline(n.children);
                    lit("</em>");
                    break;
                case "strong":
                    lit("<strong>");
                    inline(n.children);
                    lit("</strong>");
                    break;
                case "strike":
                    lit("<del>");
                    inline(n.children);
                    lit("</del>");
                    break;
                case "highlight":
                    lit(n.color ? `<mark class="${n.color}">` : "<mark>");
                    inline(n.children);
                    lit("</mark>");
                    break;
                case "link":
                    lit('<a href="' + escapeXml(n.url ?? "") + '"' + (n.title ? ' title="' + escapeXml(n.title) + '"' : "") + ">");
                    inline(n.children);
                    lit("</a>");
                    break;
                case "image":
                    lit(
                        '<img src="' +
                            escapeXml(n.url ?? "") +
                            '" alt="' +
                            escapeXml(plain(n.children)) +
                            '"' +
                            (n.title ? ' title="' + escapeXml(n.title) + '"' : "") +
                            " />",
                    );
                    break;
                case "math":
                    lit(`<span class="math ${n.display ? "display" : "inline"}">` + escapeXml(n.value ?? "") + "</span>");
                    break;
                case "wikiLink":
                    lit(
                        `<a class="wikilink${n.embed ? " embed" : ""}" data-target="${escapeXml(n.target ?? "")}">` +
                            escapeXml(n.label || n.target || "") +
                            "</a>",
                    );
                    break;
                case "tag":
                    lit(`<span class="tag">${escapeXml("#" + (n.name ?? ""))}</span>`);
                    break;
                case "footnoteRef":
                    lit(`<sup class="footnote-ref"><a href="#fn-${escapeXml(n.name ?? "")}">${n.label}</a></sup>`);
                    break;
                case "comment":
                    break;
                default:
                    inline(n.children);
            }
        }
    };

    const block = (n: MdNode, tight: boolean) => {
        switch (n.type) {
            case "document":
                n.children?.forEach((c) => block(c, false));
                break;
            case "paragraph":
                if (tight) {
                    inline(n.children);
                } else {
                    cr();
                    lit("<p>");
                    inline(n.children);
                    lit("</p>");
                    cr();
                }
                break;
            case "heading":
                cr();
                lit(`<h${n.level}>`);
                inline(n.children);
                lit(`</h${n.level}>`);
                cr();
                break;
            case "thematicBreak":
                cr();
                lit("<hr />");
                cr();
                break;
            case "blockquote":
                cr();
                lit("<blockquote>");
                cr();
                n.children?.forEach((c) => block(c, false));
                cr();
                lit("</blockquote>");
                cr();
                break;
            case "callout":
                cr();
                lit(`<div class="callout callout-${escapeXml(n.kind ?? "note")}">`);
                cr();
                if (n.titleChildren?.length) {
                    lit('<p class="callout-title">');
                    inline(n.titleChildren);
                    lit("</p>");
                    cr();
                }
                n.children?.forEach((c) => block(c, false));
                cr();
                lit("</div>");
                cr();
                break;
            case "list": {
                const tag = n.ordered ? "ol" : "ul";
                cr();
                lit(n.ordered && n.listStart !== 1 ? `<ol start="${n.listStart}">` : `<${tag}>`);
                cr();
                n.children?.forEach((c) => block(c, n.tight ?? false));
                cr();
                lit(`</${tag}>`);
                cr();
                break;
            }
            case "listItem":
                lit("<li>");
                if (n.checked !== null && n.checked !== undefined) {
                    lit(n.checked ? '<input type="checkbox" checked="" disabled="" /> ' : '<input type="checkbox" disabled="" /> ');
                }
                n.children?.forEach((c) => block(c, tight));
                lit("</li>");
                cr();
                break;
            case "codeBlock": {
                const lang = (n.info ?? "").split(/\s+/)[0];
                cr();
                lit(lang ? `<pre><code class="language-${escapeXml(lang)}">` : "<pre><code>");
                lit(escapeXml(n.value ?? ""));
                lit("</code></pre>");
                cr();
                break;
            }
            case "htmlBlock":
                cr();
                lit(n.value ?? "");
                cr();
                break;
            case "mathBlock":
                cr();
                lit('<div class="math display">' + escapeXml(n.value ?? "") + "</div>");
                cr();
                break;
            case "commentBlock":
                break;
            case "table": {
                cr();
                lit("<table>");
                cr();
                const rows = n.children ?? [];
                const cells = (row: MdNode, tag: string) => {
                    lit("<tr>");
                    cr();
                    row.children?.forEach((cell, i) => {
                        const a = n.align?.[i];
                        lit(a ? `<${tag} align="${a}">` : `<${tag}>`);
                        inline(cell.children);
                        lit(`</${tag}>`);
                        cr();
                    });
                    lit("</tr>");
                    cr();
                };
                if (rows[0]) {
                    lit("<thead>");
                    cr();
                    cells(rows[0], "th");
                    lit("</thead>");
                    cr();
                }
                if (rows.length > 1) {
                    lit("<tbody>");
                    cr();
                    rows.slice(1).forEach((r) => cells(r, "td"));
                    lit("</tbody>");
                    cr();
                }
                lit("</table>");
                cr();
                break;
            }
            default:
                n.children?.forEach((c) => block(c, false));
        }
    };

    block(doc, false);
    if (doc.footnotes.length > 0) {
        cr();
        lit('<section class="footnotes">');
        cr();
        lit("<ol>");
        cr();
        for (const f of doc.footnotes) {
            lit(`<li id="fn-${escapeXml(f.name ?? "")}">`);
            cr();
            f.children?.forEach((c) => block(c, false));
            lit("</li>");
            cr();
        }
        lit("</ol>");
        cr();
        lit("</section>");
        cr();
    }
    return out.join("");
}
