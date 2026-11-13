/**
 * How citations show in rendered Markdown: in-text citations, `[[@key]]` links and
 * `![[@key]]` embeds, the `::bibliography` list and ```bibtex blocks.
 */
import { useState } from "react";
import { openAnnotation } from "../annotator/api";
import { Icon, TypeIcon } from "../icons/Icon";
import type { CiteRef, MdNode } from "./ast.ts";
import { parseBibtex, toImportItem } from "./bibtex.ts";
import { formatCitation, formatReference, itemKeyOf, referenceSortKey, referenceText, yearOf, type CiteData } from "./cite.ts";
import { citeApi, invalidateCites, openItemInDrawer } from "./citeStore";

export type Lookup = (key: string) => CiteData | null;

function stop(e: { preventDefault(): void; stopPropagation(): void }) {
    e.preventDefault();
    e.stopPropagation();
}

/** Opens what a key cites: the annotation in Annotator, the item in Drawer. */
export function openCited(d: CiteData | null) {
    if (!d) return;
    if (d.annotation) openAnnotation(d.annotation.id);
    else if (d.itemId !== undefined) openItemInDrawer(d.itemId);
}

function Runs({ d }: { d: CiteData }) {
    return (
        <>
            {formatReference(d).map((r, i) => (r.italic ? <i key={i}>{r.text}</i> : <span key={i}>{r.text}</span>))}
        </>
    );
}

/** `[@key, p. 3]` / `@key` */
export function CitationView({ node, lookup }: { node: MdNode; lookup: Lookup }) {
    const cites: CiteRef[] = node.cites ?? [];
    const data = cites.map((c) => lookup(c.key));
    const missing = cites.filter((_, i) => !data[i]);
    // A bare `@word` that names nothing is just text (`@某人`).
    if (node.narrative && missing.length > 0) return <span data-o={node.start}>{node.value}</span>;
    const tip = data
        .map((d, i) => (d ? referenceText(d) + (d.annotation?.quote ? `\n「${d.annotation.quote}」` : "") : `找不到 @${cites[i].key}`))
        .join("\n\n");
    return (
        <span
            className={`md-cite${missing.length ? " missing" : ""}`}
            title={tip}
            data-o={node.start}
            onClick={(e) => {
                const first = data.find(Boolean) ?? null;
                if (!first) return;
                stop(e);
                openCited(first);
            }}
        >
            {missing.length === cites.length ? `找不到 ${cites.map((c) => "@" + c.key).join("、")}` : formatCitation(cites, !!node.narrative, lookup)}
        </span>
    );
}

/** `[[@key]]`: a link showing the title (or the quote of an annotation). */
export function CiteLink({ node, lookup }: { node: MdNode; lookup: Lookup }) {
    const key = node.target!.slice(1);
    const d = lookup(key);
    const text = node.label || (d ? (d.annotation ? `「${short(d.annotation.quote || d.annotation.locator, 40)}」` : d.title || key) : "@" + key);
    return (
        <a
            className={`md-wikilink md-citelink${d ? "" : " missing"}`}
            title={d ? referenceText(d) : `找不到 @${key}`}
            data-o={node.start}
            onClick={(e) => {
                stop(e);
                openCited(d);
            }}
        >
            {d && !d.annotation && <TypeIcon type={d.itemType} />}
            {text}
        </a>
    );
}

function short(s: string, n: number) {
    const t = s.replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

/** `![[@key]]`: an item card, or the quote of an annotation. */
export function CiteEmbed({ node, lookup }: { node: MdNode; lookup: Lookup }) {
    const key = node.target!.slice(1);
    const d = lookup(key);
    if (!d) {
        return (
            <span className="md-cite missing" data-o={node.start}>
                找不到 @{key}
            </span>
        );
    }
    const open = (e: React.MouseEvent) => {
        stop(e);
        openCited(d);
    };
    if (d.annotation) {
        const a = d.annotation;
        return (
            <span className={`md-cite-quote md-mark-${a.color}`} data-o={node.start} onClick={open} title="點一下回到原文">
                <span className="md-cite-quote-text">{a.quote || (a.kind === "bookmark" ? `書籤：${a.locator}` : "")}</span>
                {a.note && <span className="md-cite-quote-note">{a.note}</span>}
                <span className="md-cite-quote-src">
                    — {d.title}
                    {a.locator ? `，${a.locator}` : ""}
                </span>
            </span>
        );
    }
    const year = yearOf(d.date);
    return (
        <span className="md-cite-card" data-o={node.start} onClick={open} title={referenceText(d)}>
            <TypeIcon type={d.itemType} size={18} />
            <span className="md-cite-card-body">
                <span className="md-cite-card-title">{d.title || key}</span>
                <span className="md-cite-card-meta">{[d.authors.join("、"), year].filter(Boolean).join(" · ")}</span>
            </span>
        </span>
    );
}

/** `::bibliography`: every work cited in the document, sorted, APA. */
export function Bibliography({ keys, lookup }: { keys: string[]; lookup: Lookup }) {
    const seen = new Set<string>();
    const works: CiteData[] = [];
    for (const k of keys) {
        const d = lookup(k) ?? lookup(itemKeyOf(k));
        if (!d) continue;
        const id = d.itemId !== undefined ? `#${d.itemId}` : itemKeyOf(d.key);
        if (seen.has(id)) continue;
        seen.add(id);
        works.push({ ...d, annotation: undefined, key: itemKeyOf(d.key) });
    }
    works.sort((a, b) => referenceSortKey(a).localeCompare(referenceSortKey(b), "zh-Hant"));
    return (
        <div className="md-bibliography">
            <div className="md-bibliography-title">參考文獻</div>
            {works.length === 0 ? (
                <p className="md-bibliography-empty">（還沒有引用任何文獻）</p>
            ) : (
                <ul>
                    {works.map((d) => (
                        <li key={d.key} onClick={(e) => (d.itemId !== undefined ? (stop(e), openCited(d)) : undefined)}>
                            <Runs d={d} />
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/** A ```bibtex block: its entries as references, and a button to add them to 文獻庫. */
export function BibtexBlock({ source, start }: { source: string; start: number }) {
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState("");
    const entries = parseBibtex(source);
    const add = async (e: React.MouseEvent) => {
        stop(e);
        setBusy(true);
        try {
            const res = await citeApi.import(entries.map(toImportItem), null);
            invalidateCites();
            setNote(
                res.renamed
                    ? `已加入 ${res.keys.length} 筆；有 ${res.renamed} 個引用鍵已被使用，改成 ${res.keys.join("、")}`
                    : `已加入文獻庫：${res.keys.join("、")}。可以刪掉這個區塊，引用會改用文獻庫的資料`,
            );
        } catch (err) {
            setNote(`無法加入：${String(err)}`);
            setBusy(false);
        }
    };
    return (
        <div className="md-bibtex" data-o={start}>
            <div className="md-bibtex-head">
                <Icon name="library" />
                <span>文件內的書目（{entries.length} 筆）</span>
                {entries.length > 0 && (
                    <button type="button" className="md-bibtex-add" disabled={busy} onClick={(e) => void add(e)}>
                        加入文獻庫
                    </button>
                )}
            </div>
            {note && <div className="md-bibtex-note">{note}</div>}
            <ul>
                {entries.map((en, i) => {
                    const item = toImportItem(en);
                    return (
                        <li key={i}>
                            <code>@{en.key}</code> {item.fields.title || "（無標題）"}
                            {item.creators.length > 0 && <span className="muted">　{item.creators.map((c) => c.name).join("、")}</span>}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
