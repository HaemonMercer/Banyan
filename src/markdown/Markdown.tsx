import { openUrl } from "@tauri-apps/plugin-opener";
import "katex/dist/katex.min.css";
import { memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import { renderDirective, type DirectiveKind } from "./directives";
import { remarkPlugins } from "./index";
import "./markdown.css";

interface Props {
    source: string;
    /** Clicked `[[target]]`. Without it wiki links render as plain text. */
    onWikiLink?: (target: string) => void;
    className?: string;
    /** Render inside a line (a `<span>`, paragraphs unwrapped), e.g. a chip in the editor. */
    inline?: boolean;
}

const rehypePlugins = [rehypeKatex];

function openExternal(href: string) {
    openUrl(href).catch(() => window.open(href, "_blank", "noopener"));
}

function directive(props: Record<string, unknown>, children: ReactNode): ReactNode | null {
    const name = props["data-directive"];
    if (typeof name !== "string") return null;
    let attributes: Record<string, string> = {};
    try {
        attributes = JSON.parse(String(props["data-attrs"] ?? "{}"));
    } catch {
        /* keep empty */
    }
    return renderDirective({ name, kind: props["data-directive-kind"] as DirectiveKind, attributes, children });
}

/** Renders Banyan Markdown (GFM, math, directives, wiki links). Raw HTML is not rendered. */
function Markdown({ source, onWikiLink, className, inline }: Props) {
    const components: Components = {
        a: ({ node: _node, href, children, ...rest }) => {
            const target = (rest as Record<string, unknown>)["data-wikilink"];
            if (typeof target === "string") {
                return (
                    <a
                        className={`md-wikilink${onWikiLink ? "" : " inert"}`}
                        href="#"
                        title={`開啟卡片「${target}」`}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onWikiLink?.(target);
                        }}
                    >
                        {children}
                    </a>
                );
            }
            return (
                <a
                    href={href}
                    title={href}
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (href) openExternal(href);
                    }}
                >
                    {children}
                </a>
            );
        },
        span: ({ node: _node, children, ...rest }) =>
            directive(rest as Record<string, unknown>, children) ?? <span {...rest}>{children}</span>,
        div: ({ node: _node, children, ...rest }) =>
            directive(rest as Record<string, unknown>, children) ?? <div {...rest}>{children}</div>,
    };

    if (inline) components.p = ({ children }) => <>{children}</>;
    const body = (
        <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
            {source}
        </ReactMarkdown>
    );
    const cls = `md${inline ? " md-inline" : ""}${className ? " " + className : ""}`;
    return inline ? <span className={cls}>{body}</span> : <div className={cls}>{body}</div>;
}

export default memo(Markdown);
