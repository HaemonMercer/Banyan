/**
 * Plain text shown as written (line breaks kept), e.g. mind-map outlines.
 * Card text is Markdown: `src/markdown/Markdown.tsx` / `MarkdownEditor.tsx`.
 */
import "./PlainText.css";

/** Text shown as written. */
export function PlainText({ text, className }: { text: string; className?: string }) {
    return <div className={`plain-text${className ? " " + className : ""}`}>{text}</div>;
}
