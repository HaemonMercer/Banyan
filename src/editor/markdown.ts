import MarkdownIt, { type Token } from "markdown-it";

/**
 * CommonMark 解析與渲染。
 *
 * 文件本體永遠是一段 Markdown 字串；「區塊」只是從 markdown-it（CommonMark 模式）
 * 的 token 串切出來的視圖。每個區塊記住自己在原始碼的行範圍，編輯時只改那幾行，
 * 其他行一個字元都不動。
 */

export const md = new MarkdownIt("commonmark");

// markdown-it 對空的 blockquote 輸出 `<blockquote></blockquote>`，
// 規格要求中間有換行（規格範例 218、239、240）。
md.renderer.rules.blockquote_open = (tokens, idx, options, _env, self) => {
  const html = self.renderToken(tokens, idx, options);
  return html.endsWith("\n") ? html : html + "\n";
};

export type UnitKind =
  | "paragraph"
  | "heading"
  | "code"
  | "quote"
  | "item"
  | "hr"
  | "html"
  | "source";

/** 畫面上的一個區塊：頂層區塊，或頂層清單裡的一個項目。 */
export interface Unit {
  kind: UnitKind;
  /** 起始行（含），0 起算 */
  start: number;
  /** 結束行（不含），已去掉尾端空白行 */
  end: number;
  /** 這個區塊自己的 HTML（清單項目是 `<li>` 內部的 HTML） */
  html: string;
  level?: number;
  list?: ListInfo;
}

export interface ListInfo {
  ordered: boolean;
  /** 這個項目在有序清單中的編號 */
  number: number;
  /** 同一份清單的識別（清單起始行） */
  listStart: number;
  index: number;
}

/** 頂層區塊（清單整個算一個），用來組回完整 HTML。 */
interface TopBlock {
  html: string;
  units: Unit[];
}

export interface ParsedDoc {
  lines: string[];
  units: Unit[];
  /** 與 md.render(source) 完全相同的 HTML，由區塊組回來 */
  html: string;
}

const isBlank = (line: string | undefined) => line !== undefined && /^[ \t]*$/.test(line);

function trimEnd(lines: string[], start: number, end: number): number {
  while (end > start + 1 && isBlank(lines[end - 1])) end--;
  return end;
}

function kindOf(token: Token): UnitKind {
  switch (token.type) {
    case "paragraph_open":
      return "paragraph";
    case "heading_open":
      return "heading";
    case "fence":
    case "code_block":
      return "code";
    case "blockquote_open":
      return "quote";
    case "hr":
      return "hr";
    case "html_block":
      return "html";
    default:
      return "paragraph";
  }
}

/** 找出與 tokens[i]（nesting 1）配對的 close token 索引。 */
function closeOf(tokens: Token[], i: number): number {
  const level = tokens[i].level;
  for (let j = i + 1; j < tokens.length; j++) {
    if (tokens[j].level === level && tokens[j].nesting === -1) return j;
  }
  return tokens.length - 1;
}

export function splitLines(source: string): string[] {
  return source.split("\n");
}

export function parseDoc(source: string): ParsedDoc {
  const lines = splitLines(source);
  const env: Record<string, unknown> = {};
  const tokens = md.parse(source, env);
  const opts = md.options;
  const render = (slice: Token[]) => md.renderer.render(slice, opts, env);

  const tops: TopBlock[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const last = t.nesting === 1 ? closeOf(tokens, i) : i;
    const map = t.map ?? [0, 0];

    if (t.type === "bullet_list_open" || t.type === "ordered_list_open") {
      const ordered = t.type === "ordered_list_open";
      const first = Number(t.attrGet("start") ?? 1);
      let html = md.renderer.renderToken(tokens, i, opts);
      const units: Unit[] = [];
      for (let j = i + 1; j < last; j++) {
        if (tokens[j].type !== "list_item_open") continue;
        const close = closeOf(tokens, j);
        const inner = render(tokens.slice(j + 1, close));
        html +=
          md.renderer.renderToken(tokens, j, opts) + inner + md.renderer.renderToken(tokens, close, opts);
        const [s, e] = tokens[j].map ?? [map[0], map[1]];
        units.push({
          kind: "item",
          start: s,
          end: trimEnd(lines, s, e),
          html: inner,
          list: { ordered, number: first + units.length, listStart: map[0], index: units.length },
        });
        j = close;
      }
      html += md.renderer.renderToken(tokens, last, opts);
      tops.push({ html, units });
    } else {
      const html = render(tokens.slice(i, last + 1));
      const unit: Unit = { kind: kindOf(t), start: map[0], end: trimEnd(lines, map[0], map[1]), html };
      if (t.type === "heading_open") unit.level = Number(t.tag.slice(1));
      tops.push({ html, units: [unit] });
    }
    i = last;
  }

  const units = tops.flatMap((b) => b.units);

  // 沒有被任何 token 涵蓋的非空白行（連結參考定義）：做成「原始碼」區塊，才看得到、改得到。
  const covered = new Uint8Array(lines.length);
  for (const u of units) covered.fill(1, u.start, Math.max(u.start, u.end));
  for (const t of tokens) if (t.level === 0 && t.map) covered.fill(1, t.map[0], t.map[1]);
  const extra: Unit[] = [];
  for (let l = 0; l < lines.length; l++) {
    if (covered[l] || isBlank(lines[l])) continue;
    let e = l + 1;
    while (e < lines.length && !covered[e] && !isBlank(lines[e])) e++;
    extra.push({ kind: "source", start: l, end: e, html: "" });
    l = e - 1;
  }

  const all = extra.length ? [...units, ...extra].sort((a, b) => a.start - b.start) : units;
  return { lines, units: all, html: tops.map((b) => b.html).join("") };
}

/** 直接用 CommonMark 渲染整份文件（給匯出／測試對照用）。 */
export function renderMarkdown(source: string): string {
  return md.render(source);
}
