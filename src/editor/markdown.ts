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
  /** 版面標籤（`<div class="columns">` 等單行 HTML 區塊） */
  tag?: Tag;
}

// ─── 版面：縮排與多欄 ─────────────────────────────────────────────
//
// CommonMark 沒有欄位與縮排，用 HTML 區塊包起來（每個標籤自成一行、前後空行，
// 中間的內容照常當 Markdown 解析）：
//
//   <div class="columns">          <div class="indent">
//                                  
//   <div class="column">           內容
//                                  
//   內容                            </div>
//
//   </div>
//
//   </div>
//
// 標籤仍是 CommonMark 的 HTML 區塊，渲染結果與規格一致；編輯器只是把它們藏起來，
// 改用欄位與縮排顯示。

export type ContainerKind = "columns" | "column" | "indent";

export type Tag = { type: "open"; kind: ContainerKind | "div"; width?: number } | { type: "close" };

const LAYOUT_OPEN = /^<div class="(columns|column|indent)"(?: style="flex: ?(\d+(?:\.\d+)?)")?>[ \t]*$/;
const DIV_OPEN = /^<div\b[^>]*>[ \t]*$/i;
const DIV_CLOSE = /^<\/div>[ \t]*$/i;

export function parseTag(line: string): Tag | undefined {
  const m = LAYOUT_OPEN.exec(line);
  if (m) return { type: "open", kind: m[1] as ContainerKind, width: m[2] ? Number(m[2]) : undefined };
  if (DIV_OPEN.test(line)) return { type: "open", kind: "div" };
  if (DIV_CLOSE.test(line)) return { type: "close" };
  return undefined;
}

export function openTag(kind: ContainerKind, width?: number): string {
  return width !== undefined && Math.abs(width - 1) > 0.005
    ? `<div class="${kind}" style="flex: ${+width.toFixed(2)}">`
    : `<div class="${kind}">`;
}

export interface Container {
  type: "container";
  kind: ContainerKind;
  open: Unit;
  close: Unit;
  /** 欄寬比例（flex-grow），預設 1 */
  width: number;
  children: TreeNode[];
}

export interface Leaf {
  type: "leaf";
  unit: Unit;
}

export type TreeNode = Container | Leaf;

/** 依標籤把區塊組成樹；沒配對的標籤當一般 HTML 區塊。 */
export function buildTree(units: Unit[]): TreeNode[] {
  interface Frame {
    kind: ContainerKind | "div";
    open: Unit | null;
    width: number;
    children: TreeNode[];
  }
  const stack: Frame[] = [{ kind: "div", open: null, width: 1, children: [] }];
  const leaf = (unit: Unit): Leaf => ({ type: "leaf", unit });
  for (const u of units) {
    const top = stack[stack.length - 1];
    if (u.tag?.type === "open") {
      stack.push({ kind: u.tag.kind, open: u, width: u.tag.width ?? 1, children: [] });
    } else if (u.tag?.type === "close" && stack.length > 1) {
      stack.pop();
      const parent = stack[stack.length - 1];
      if (top.kind === "div") parent.children.push(leaf(top.open!), ...top.children, leaf(u));
      else
        parent.children.push({
          type: "container",
          kind: top.kind,
          open: top.open!,
          close: u,
          width: top.width,
          children: top.children,
        });
    } else {
      top.children.push(leaf(u));
    }
  }
  while (stack.length > 1) {
    const f = stack.pop()!;
    stack[stack.length - 1].children.push(leaf(f.open!), ...f.children);
  }
  return stack[0].children;
}

/** 樹中所有看得到的區塊（不含版面標籤），依文件順序。 */
export function leaves(nodes: TreeNode[], out: Unit[] = []): Unit[] {
  for (const n of nodes) {
    if (n.type === "leaf") out.push(n.unit);
    else leaves(n.children, out);
  }
  return out;
}

export interface Located {
  leaf: Leaf;
  siblings: TreeNode[];
  index: number;
  /** 由外到內的容器 */
  ancestors: Container[];
}

/** 找出起始行為 start 的區塊在樹中的位置。 */
export function locate(nodes: TreeNode[], start: number, ancestors: Container[] = []): Located | null {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.type === "leaf") {
      if (n.unit.start === start) return { leaf: n, siblings: nodes, index: i, ancestors };
    } else {
      const found = locate(n.children, start, [...ancestors, n]);
      if (found) return found;
    }
  }
  return null;
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
  /** 所有區塊，包含版面標籤 */
  units: Unit[];
  /** 依版面標籤組成的樹 */
  tree: TreeNode[];
  /** 看得到的區塊（不含版面標籤），依文件順序 */
  blocks: Unit[];
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
  for (const u of all) {
    if (u.kind === "html" && u.end - u.start === 1) u.tag = parseTag(lines[u.start]);
  }
  const tree = buildTree(all);
  return { lines, units: all, tree, blocks: leaves(tree), html: tops.map((b) => b.html).join("") };
}

/** 直接用 CommonMark 渲染整份文件（給匯出／測試對照用）。 */
export function renderMarkdown(source: string): string {
  return md.render(source);
}
