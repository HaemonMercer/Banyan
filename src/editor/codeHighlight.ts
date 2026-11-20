import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

/**
 * 程式碼區塊的語法上色（highlight.js，只載入常用的語言）與 ``` 區塊的語言、內容。
 *
 * 編輯器的程式碼區塊在顯示時才上色（`highlightBlocksHtml`，和頁面連結一樣不加 markdown-it 規則，
 * 不然 CommonMark 規格測試會失敗）；白板的程式碼卡片也用同一套（`highlightCode`）。
 * 顏色是 editor.css 的 `--hl-*` 變數（淺色、深色各一組）。
 */

const LANGS = {
  bash, c, cpp, csharp, css, diff, go, java, javascript, json, kotlin, markdown,
  php, powershell, python, ruby, rust, sql, swift, typescript, xml, yaml,
};
for (const [name, def] of Object.entries(LANGS)) hljs.registerLanguage(name, def);

/** 語言選單：id 是寫在 ``` 後面的字 */
export const CODE_LANGUAGES: { id: string; label: string }[] = [
  { id: "", label: "Plain text" },
  { id: "bash", label: "Bash" },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++" },
  { id: "csharp", label: "C#" },
  { id: "css", label: "CSS" },
  { id: "diff", label: "Diff" },
  { id: "go", label: "Go" },
  { id: "html", label: "HTML" },
  { id: "java", label: "Java" },
  { id: "javascript", label: "JavaScript" },
  { id: "json", label: "JSON" },
  { id: "kotlin", label: "Kotlin" },
  { id: "markdown", label: "Markdown" },
  { id: "php", label: "PHP" },
  { id: "powershell", label: "PowerShell" },
  { id: "python", label: "Python" },
  { id: "ruby", label: "Ruby" },
  { id: "rust", label: "Rust" },
  { id: "sql", label: "SQL" },
  { id: "swift", label: "Swift" },
  { id: "typescript", label: "TypeScript" },
  { id: "xml", label: "XML" },
  { id: "yaml", label: "YAML" },
];

/** 別名 → 選單的 id */
const ALIASES: Record<string, string> = {
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript", node: "javascript",
  ts: "typescript", tsx: "typescript",
  py: "python", python3: "python",
  sh: "bash", shell: "bash", zsh: "bash", console: "bash",
  ps: "powershell", ps1: "powershell", pwsh: "powershell",
  "c++": "cpp", cc: "cpp", hpp: "cpp", h: "c",
  cs: "csharp", "c#": "csharp",
  golang: "go", rs: "rust", rb: "ruby", kt: "kotlin",
  yml: "yaml", md: "markdown", htm: "html", svg: "xml", vue: "html",
  patch: "diff", text: "", txt: "", plain: "", plaintext: "",
};

/** ``` 後面寫的字（第一個詞）→ 選單的 id；認不得就原樣（小寫），空的就是 ""。 */
export function normLang(info: string): string {
  const w = info.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (w in ALIASES) return ALIASES[w];
  return w;
}

/** 顯示用的語言名稱 */
export function langLabel(lang: string): string {
  const id = normLang(lang);
  return CODE_LANGUAGES.find((l) => l.id === id)?.label ?? (lang.trim() || "Plain text");
}

/** highlight.js 裡的語言名稱（沒有就是 null） */
function hlName(lang: string): string | null {
  const id = normLang(lang);
  const name = id === "html" ? "xml" : id;
  return name && hljs.getLanguage(name) ? name : null;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unescapeHtml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, "&");

/** 一段程式碼 → 上色後的 HTML（已跳脫）；認不得的語言只跳脫。 */
export function highlightCode(code: string, lang: string): string {
  const name = hlName(lang);
  if (!name) return escapeHtml(code);
  try {
    return hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}

const PRE_CODE = /<pre><code(?: class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g;

/** 渲染（並清理）後的 HTML 裡，``` 區塊的內容換成上色後的 HTML；沒有指定語言的不動。 */
export function highlightBlocksHtml(html: string): string {
  if (!html.includes("<pre><code class=")) return html;
  return html.replace(PRE_CODE, (all, lang: string | undefined, body: string) => {
    if (!lang || !hlName(lang)) return all;
    return `<pre><code class="language-${lang} hljs">${highlightCode(unescapeHtml(body), lang)}</code></pre>`;
  });
}

/* ─── ``` 區塊的原始碼 ─── */

const FENCE = /^( {0,3})(`{3,}|~{3,})([^\n]*)\n?([\s\S]*?)(?:\n {0,3}\2[`~]*[ \t]*)?$/;

/** 程式碼區塊（``` 或縮排）的語言與內容；不是程式碼區塊就是 null。 */
export function parseCodeBlock(text: string): { lang: string; code: string } | null {
  const f = FENCE.exec(text);
  if (f) {
    // 只有開頭一行時沒有內容
    const body = text.includes("\n") ? f[4] : "";
    const indent = f[1].length;
    const code = indent ? body.replace(new RegExp(`^ {0,${indent}}`, "gm"), "") : body;
    return { lang: f[3].trim(), code };
  }
  const lines = text.split("\n");
  if (lines.length && lines.every((l) => !l.trim() || /^( {4}|\t)/.test(l))) {
    return { lang: "", code: lines.map((l) => l.replace(/^( {4}|\t)/, "")).join("\n") };
  }
  return null;
}

/** 程式碼 → ``` 區塊（反引號比內容裡最長的一串多一個，至少三個）。 */
export function codeFence(code: string, lang = ""): string {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((r) => r.length));
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return `${ticks}${lang}\n${code}\n${ticks}`;
}

/** 改程式碼區塊的語言（只改開頭那一行；縮排的程式碼區塊改成 ```）；不是程式碼區塊時原樣回傳。 */
export function setCodeLang(text: string, lang: string): string {
  const f = FENCE.exec(text);
  if (f) {
    const nl = text.indexOf("\n");
    const first = f[1] + f[2] + lang;
    // ` 開頭的區塊，語言裡不能有 `
    if (f[2][0] === "`" && lang.includes("`")) return text;
    return nl < 0 ? first : first + text.slice(nl);
  }
  const c = parseCodeBlock(text);
  return c ? codeFence(c.code, lang) : text;
}
