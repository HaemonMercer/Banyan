import { describe, expect, it } from "vitest";
import { codeFence, highlightBlocksHtml, highlightCode, langLabel, normLang, parseCodeBlock, setCodeLang } from "./codeHighlight";
import { renderMarkdown } from "./markdown";

describe("code highlighting", () => {
  it("highlights known languages and escapes everything else", () => {
    const js = highlightCode("const a = '<b>';", "js");
    expect(js).toContain('<span class="hljs-keyword">const</span>');
    expect(js).toContain("&lt;b&gt;");
    expect(highlightCode("x < y && z", "klingon")).toBe("x &lt; y &amp;&amp; z");
    expect(highlightCode("<div>", "html")).toContain("hljs-tag");
  });

  it("only touches fenced blocks with a language, after rendering", () => {
    const html = renderMarkdown("```python\nif a < 1:\n    print('hi')\n```\n\n`inline`\n\n```\nplain <x>\n```\n");
    const out = highlightBlocksHtml(html);
    expect(out).toContain('<code class="language-python hljs">');
    expect(out).toContain('<span class="hljs-keyword">if</span> a &lt; ');
    expect(out).toContain("<code>inline</code>");
    expect(out).toContain("<pre><code>plain &lt;x&gt;\n</code></pre>");
    expect(highlightBlocksHtml("<p>nothing</p>")).toBe("<p>nothing</p>");
  });

  it("normalizes aliases and labels", () => {
    expect(normLang("ts")).toBe("typescript");
    expect(normLang("Python {.class}")).toBe("python");
    expect(normLang("")).toBe("");
    expect(normLang("elixir")).toBe("elixir");
    expect(langLabel("sh")).toBe("Bash");
    expect(langLabel("")).toBe("Plain text");
    expect(langLabel("elixir")).toBe("elixir");
  });
});

describe("code block source", () => {
  it("reads fenced and indented blocks", () => {
    expect(parseCodeBlock("```js\nlet a\nlet b\n```")).toEqual({ lang: "js", code: "let a\nlet b" });
    expect(parseCodeBlock("~~~~\nx\n~~~~")).toEqual({ lang: "", code: "x" });
    expect(parseCodeBlock("```py\nunclosed")).toEqual({ lang: "py", code: "unclosed" });
    expect(parseCodeBlock("```")).toEqual({ lang: "", code: "" });
    expect(parseCodeBlock("    a\n      b")).toEqual({ lang: "", code: "a\n  b" });
    expect(parseCodeBlock("just text")).toBeNull();
  });

  it("changes the language on the opening line only", () => {
    expect(setCodeLang("```js\nlet a\n```", "python")).toBe("```python\nlet a\n```");
    expect(setCodeLang("````\nx\n````", "go")).toBe("````go\nx\n````");
    expect(setCodeLang("```ts\nx\n```", "")).toBe("```\nx\n```");
    expect(setCodeLang("    a\n    b", "c")).toBe("```c\na\nb\n```");
    expect(setCodeLang("plain", "c")).toBe("plain");
  });

  it("builds fences longer than any backtick run inside", () => {
    expect(codeFence("a", "js")).toBe("```js\na\n```");
    expect(codeFence("x ```` y")).toBe("`````\nx ```` y\n`````");
    expect(parseCodeBlock(codeFence("a\n```\nb", "md"))).toEqual({ lang: "md", code: "a\n```\nb" });
  });
});
