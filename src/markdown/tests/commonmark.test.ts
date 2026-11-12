// CommonMark 0.31.2 spec examples (extensions off): every example must match exactly.
// Run: npm test
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { parse, renderHtml } from "../index.ts";

const require = createRequire(import.meta.url);
const spec = require("commonmark-spec") as { tests: { markdown: string; html: string; number: number; section: string }[] };

for (const t of spec.tests) {
    test(`CommonMark #${t.number} ${t.section}`, () => {
        const html = renderHtml(parse(t.markdown.replace(/→/g, "\t"), { gfm: false, bfm: false }));
        assert.equal(html, t.html.replace(/→/g, "\t"));
    });
}
