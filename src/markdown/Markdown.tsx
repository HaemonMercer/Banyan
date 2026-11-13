/**
 * Renders Banyan Flavored Markdown as React elements, from the shared syntax tree (`parse`).
 *
 * Safety: raw HTML is shown as text, only http(s)/mailto links open (in the system browser),
 * only http(s)/data images load. Text runs carry `data-o` (their source offset) so a click can be
 * mapped back to the source with `sourceOffsetAt`.
 */
import { openUrl } from "@tauri-apps/plugin-opener";
import katex from "katex";
import "katex/contrib/mhchem";
import "katex/dist/katex.min.css";
import { memo, type ReactNode } from "react";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/icons";
import type { MdNode } from "./ast.ts";
import { bibtexCiteData } from "./bibtex.ts";
import type { CiteData } from "./cite.ts";
import { Bibliography, BibtexBlock, CitationView, CiteEmbed, CiteLink } from "./Citations";
import { useCiteData } from "./citeStore";
import { extractCitations, parse } from "./index.ts";
import { useWikiLinkHandler } from "./links";
import "./markdown.css";

export interface MarkdownProps {
    source: string;
    className?: string;
    /** `[[target]]` / `![[target]]` was clicked. Defaults to the nearest `WikiLinkProvider`; without one, links are inert. */
    onWikiLink?: (target: string) => void;
    /** `#tag` was clicked. */
    onTag?: (name: string) => void;
}

const CALLOUTS: Record<string, { label: string; icon: IconName; tone: string }> = {
    note: { label: "備註", icon: "note", tone: "accent" },
    info: { label: "資訊", icon: "info", tone: "info" },
    tip: { label: "提示", icon: "sparkle", tone: "accent" },
    todo: { label: "待辦", icon: "check", tone: "info" },
    example: { label: "範例", icon: "note", tone: "info" },
    question: { label: "問題", icon: "info", tone: "warning" },
    quote: { label: "引用", icon: "note", tone: "muted" },
    warning: { label: "注意", icon: "warning", tone: "warning" },
    danger: { label: "危險", icon: "warning", tone: "danger" },
};

const mathCache = new Map<string, string>();

function renderMath(tex: string, display: boolean): string {
    const key = (display ? "D" : "I") + tex;
    let html = mathCache.get(key);
    if (html === undefined) {
        try {
            html = katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: "ignore", trust: false });
        } catch {
            html = "";
        }
        if (mathCache.size > 500) mathCache.clear();
        mathCache.set(key, html);
    }
    return html;
}

function safeHref(url: string): string | null {
    return /^(https?:|mailto:)/i.test(url) ? url : null;
}

function safeSrc(url: string): string | null {
    return /^(https?:|data:image\/)/i.test(url) ? url : null;
}

function openExternal(href: string) {
    openUrl(href).catch(() => window.open(href, "_blank", "noopener"));
}

function stop(e: { preventDefault(): void; stopPropagation(): void }) {
    e.preventDefault();
    e.stopPropagation();
}

function Markdown({ source, className, onWikiLink: onWikiLinkProp, onTag }: MarkdownProps) {
    const fromContext = useWikiLinkHandler();
    const onWikiLink = onWikiLinkProp ?? fromContext ?? undefined;
    const doc = parse(source);

    // Citations: entries written in the document (```bibtex) win over Drawer's.
    const local = new Map<string, CiteData>();
    for (const b of doc.children) {
        if (b.type === "codeBlock" && /^(bibtex|bib|biblatex)$/i.test((b.info ?? "").split(/\s+/)[0])) {
            for (const d of bibtexCiteData(b.value ?? "")) local.set(d.key, d);
        }
    }
    const citedKeys = extractCitations(source);
    const fromStore = useCiteData(citedKeys.filter((k) => !local.has(k)));
    const lookup = (key: string) => local.get(key) ?? fromStore(key);

    const inline = (nodes: MdNode[] | undefined): ReactNode[] =>
        (nodes ?? []).map((n, i) => {
            switch (n.type) {
                case "text":
                    return (
                        <span key={i} data-o={n.start} data-v={n.verbatim ? "" : undefined}>
                            {n.value}
                        </span>
                    );
                case "softBreak":
                case "hardBreak":
                    return <br key={i} />;
                case "code":
                    return (
                        <code key={i} data-o={n.start}>
                            {n.value}
                        </code>
                    );
                case "emphasis":
                    return <em key={i}>{inline(n.children)}</em>;
                case "strong":
                    return <strong key={i}>{inline(n.children)}</strong>;
                case "strike":
                    return <del key={i}>{inline(n.children)}</del>;
                case "highlight":
                    return (
                        <mark key={i} className={`md-mark md-mark-${n.color ?? "yellow"}`}>
                            {inline(n.children)}
                        </mark>
                    );
                case "link": {
                    const href = safeHref(n.url ?? "");
                    return (
                        <a
                            key={i}
                            href={href ?? undefined}
                            title={n.title || n.url}
                            className={href ? undefined : "md-link-inert"}
                            onClick={(e) => {
                                stop(e);
                                if (href) openExternal(href);
                            }}
                        >
                            {inline(n.children)}
                        </a>
                    );
                }
                case "image": {
                    const src = safeSrc(n.url ?? "");
                    const alt = n.children?.map((c) => c.value ?? "").join("") ?? "";
                    return src ? (
                        <img key={i} src={src} alt={alt} title={n.title || undefined} loading="lazy" draggable={false} />
                    ) : (
                        <span key={i} className="md-image-missing" title={n.url}>
                            <Icon name="image" /> {alt || n.url}
                        </span>
                    );
                }
                case "htmlInline":
                    return (
                        <span key={i} className="md-html" data-o={n.start}>
                            {n.value}
                        </span>
                    );
                case "math":
                    return (
                        <span
                            key={i}
                            className={n.display ? "md-math md-math-display" : "md-math"}
                            data-o={n.start}
                            dangerouslySetInnerHTML={{ __html: renderMath(n.value ?? "", !!n.display) }}
                        />
                    );
                case "citation":
                    return <CitationView key={i} node={n} lookup={lookup} />;
                case "wikiLink": {
                    if (n.target?.startsWith("@")) {
                        return n.embed ? <CiteEmbed key={i} node={n} lookup={lookup} /> : <CiteLink key={i} node={n} lookup={lookup} />;
                    }
                    const text = n.label || n.target || "";
                    return (
                        <a
                            key={i}
                            className={`md-wikilink${n.embed ? " md-embed" : ""}${onWikiLink ? "" : " inert"}`}
                            title={n.embed ? `嵌入「${n.target}」` : `開啟「${n.target}」`}
                            data-o={n.start}
                            onClick={(e) => {
                                stop(e);
                                onWikiLink?.(n.target!);
                            }}
                        >
                            {n.embed && <Icon name="link" />}
                            {text}
                        </a>
                    );
                }
                case "tag":
                    return (
                        <span
                            key={i}
                            className={`md-tag${onTag ? "" : " inert"}`}
                            data-o={n.start}
                            onClick={
                                onTag
                                    ? (e) => {
                                          stop(e);
                                          onTag(n.name!);
                                      }
                                    : undefined
                            }
                        >
                            #{n.name}
                        </span>
                    );
                case "footnoteRef":
                    return (
                        <sup key={i} className="md-footnote-ref" data-o={n.start}>
                            {n.label}
                        </sup>
                    );
                case "comment":
                    return null;
                default:
                    return <span key={i}>{inline(n.children)}</span>;
            }
        });

    const block = (n: MdNode, i: number, tight = false): ReactNode => {
        switch (n.type) {
            case "paragraph":
                return tight ? (
                    <span key={i} className="md-tight" data-o={n.start}>
                        {inline(n.children)}
                    </span>
                ) : (
                    <p key={i} data-o={n.start}>
                        {inline(n.children)}
                    </p>
                );
            case "heading": {
                const H = `h${Math.min(6, Math.max(1, n.level ?? 1))}` as "h1";
                return (
                    <H key={i} data-o={n.start}>
                        {inline(n.children)}
                    </H>
                );
            }
            case "thematicBreak":
                return <hr key={i} />;
            case "blockquote":
                return (
                    <blockquote key={i} data-o={n.start}>
                        {blocks(n.children)}
                    </blockquote>
                );
            case "callout": {
                const c = CALLOUTS[n.kind ?? ""] ?? CALLOUTS.note;
                const title = n.titleChildren?.length ? inline(n.titleChildren) : c.label;
                const body = blocks(n.children);
                if (n.fold) {
                    return (
                        <details key={i} className={`md-callout md-tone-${c.tone}`} open={n.fold === "+"} data-o={n.start}>
                            <summary className="md-callout-title" onClick={(e) => e.stopPropagation()}>
                                <Icon name={c.icon} />
                                <span>{title}</span>
                            </summary>
                            {body}
                        </details>
                    );
                }
                return (
                    <div key={i} className={`md-callout md-tone-${c.tone}`} data-o={n.start}>
                        <div className="md-callout-title">
                            <Icon name={c.icon} />
                            <span>{title}</span>
                        </div>
                        {body}
                    </div>
                );
            }
            case "list": {
                const items = (n.children ?? []).map((item, k) => (
                    <li key={k} className={item.checked !== null && item.checked !== undefined ? "md-task" : undefined}>
                        {item.checked !== null && item.checked !== undefined && (
                            <input type="checkbox" checked={item.checked} readOnly tabIndex={-1} />
                        )}
                        {(item.children ?? []).map((c, j) => block(c, j, !!n.tight))}
                    </li>
                ));
                return n.ordered ? (
                    <ol key={i} start={n.listStart !== 1 ? n.listStart : undefined}>
                        {items}
                    </ol>
                ) : (
                    <ul key={i}>{items}</ul>
                );
            }
            case "bibliography":
                return <Bibliography key={i} keys={citedKeys} lookup={lookup} />;
            case "codeBlock": {
                const lang = (n.info ?? "").split(/\s+/)[0];
                if (/^(bibtex|bib|biblatex)$/i.test(lang)) return <BibtexBlock key={i} source={n.value ?? ""} start={n.start} />;
                if (lang === "math") {
                    return (
                        <div
                            key={i}
                            className="md-math-block"
                            data-o={n.start}
                            dangerouslySetInnerHTML={{ __html: renderMath(n.value ?? "", true) }}
                        />
                    );
                }
                return (
                    <pre key={i} data-o={n.start} data-lang={lang || undefined}>
                        <code>{(n.value ?? "").replace(/\n$/, "")}</code>
                    </pre>
                );
            }
            case "htmlBlock":
                return (
                    <pre key={i} className="md-html" data-o={n.start}>
                        {n.value}
                    </pre>
                );
            case "mathBlock":
                return (
                    <div
                        key={i}
                        className="md-math-block"
                        data-o={n.start}
                        dangerouslySetInnerHTML={{ __html: renderMath(n.value ?? "", true) }}
                    />
                );
            case "commentBlock":
                return null;
            case "table": {
                const [head, ...rows] = n.children ?? [];
                const cells = (row: MdNode, Tag: "th" | "td") =>
                    (row.children ?? []).map((cell, k) => (
                        <Tag key={k} style={n.align?.[k] ? { textAlign: n.align[k]! } : undefined}>
                            {inline(cell.children)}
                        </Tag>
                    ));
                return (
                    <div key={i} className="md-table" data-o={n.start}>
                        <table>
                            {head && (
                                <thead>
                                    <tr>{cells(head, "th")}</tr>
                                </thead>
                            )}
                            {rows.length > 0 && (
                                <tbody>
                                    {rows.map((r, k) => (
                                        <tr key={k}>{cells(r, "td")}</tr>
                                    ))}
                                </tbody>
                            )}
                        </table>
                    </div>
                );
            }
            default:
                return <div key={i}>{blocks(n.children)}</div>;
        }
    };

    const blocks = (nodes: MdNode[] | undefined) => (nodes ?? []).map((n, i) => block(n, i));

    return (
        <div className={`md${className ? " " + className : ""}`}>
            {blocks(doc.children)}
            {doc.footnotes.length > 0 && (
                <ol className="md-footnotes">
                    {doc.footnotes.map((f, i) => (
                        <li key={i}>{blocks(f.children)}</li>
                    ))}
                </ol>
            )}
        </div>
    );
}

export default memo(Markdown);

/**
 * Where in the source a click at (x, y) inside rendered Markdown landed, or null.
 * Exact inside plain text runs; elsewhere the start of the nearest element with a known offset.
 */
export function sourceOffsetAt(container: HTMLElement, x: number, y: number): number | null {
    const doc = container.ownerDocument as Document & {
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    };
    let node: Node | null = null;
    let offset = 0;
    const pos = doc.caretPositionFromPoint?.(x, y);
    if (pos) {
        node = pos.offsetNode;
        offset = pos.offset;
    } else {
        const range = doc.caretRangeFromPoint?.(x, y);
        if (range) {
            node = range.startContainer;
            offset = range.startOffset;
        }
    }
    if (!node || !container.contains(node)) return null;
    let el: HTMLElement | null = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
    while (el && el !== container && el.dataset.o === undefined) el = el.parentElement;
    if (!el || el === container || el.dataset.o === undefined) return null;
    const base = Number(el.dataset.o);
    if (node.nodeType === Node.TEXT_NODE && el.dataset.v !== undefined && node.parentElement === el) return base + offset;
    return base;
}
