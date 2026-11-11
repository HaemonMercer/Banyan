/**
 * Directive renderer registry.
 *
 * To support a new directive, register a renderer for its name:
 *
 *     registerDirective("cite", ({ attributes, children }) => <cite>…</cite>);
 *
 * Unregistered directives fall back to `DefaultDirective`, which keeps their content visible.
 */
import type { ReactNode } from "react";

export type DirectiveKind = "text" | "leaf" | "container";

export interface DirectiveProps {
    name: string;
    kind: DirectiveKind;
    attributes: Record<string, string>;
    /** Rendered `[label]` (text / leaf) or body (container). */
    children?: ReactNode;
}

export type DirectiveRenderer = (props: DirectiveProps) => ReactNode;

const registry = new Map<string, DirectiveRenderer>();

export function registerDirective(name: string, render: DirectiveRenderer) {
    registry.set(name, render);
}

export function DefaultDirective({ name, kind, children }: DirectiveProps) {
    if (kind === "text") {
        return (
            <span className="md-directive" title={`:${name}`}>
                {children}
            </span>
        );
    }
    return (
        <div className={`md-directive md-directive-${kind}`}>
            <div className="md-directive-name">{name}</div>
            {children}
        </div>
    );
}

export function renderDirective(props: DirectiveProps): ReactNode {
    const render = registry.get(props.name) ?? DefaultDirective;
    return render(props);
}

// ---- Built-in directives -------------------------------------------------------------------

/** `:::note` / `:::warning` / `:::tip` callout boxes. */
for (const name of ["note", "tip", "warning"]) {
    registerDirective(name, ({ children, kind }) =>
        kind === "text" ? (
            <span className={`md-callout-inline md-callout-${name}`}>{children}</span>
        ) : (
            <div className={`md-callout md-callout-${name}`}>{children}</div>
        ),
    );
}
