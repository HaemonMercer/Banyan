import { useEffect, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from "../editor/icons";

/**
 * Word 的尋找與取代（Ctrl＋F／Ctrl＋H，Word、Google 文件都有）。
 *
 * - 找：在畫面上排好的文字裡找（不看 Markdown 記號），用 CSS Custom Highlight API 標出來，不動 DOM（打字、輸入法不受影響）。
 * - 取代：改 Markdown 原始碼裡的文字（照原始碼裡出現的順序；格式記號夾在中間的字串找不到就不改）。
 */

export interface FindOpts {
  matchCase: boolean;
  whole: boolean;
}

/** 在一段文字裡找全部出現的位置 */
export function findAll(text: string, q: string, o: FindOpts): number[] {
  if (!q) return [];
  const hay = o.matchCase ? text : text.toLowerCase();
  const needle = o.matchCase ? q : q.toLowerCase();
  const out: number[] = [];
  const word = (i: number) => i < 0 || i >= text.length || !/[\p{L}\p{N}_]/u.test(text[i]);
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) {
    if (!o.whole || (word(i - 1) && word(i + needle.length))) out.push(i);
  }
  return out;
}

/** 取代原始碼裡第 n 個（n 是 -1 時全部）；回傳新的原始碼與改了幾個 */
export function replaceIn(source: string, q: string, by: string, o: FindOpts, n: number): { text: string; count: number } {
  const hits = findAll(source, q, o);
  const pick = n < 0 ? hits : hits[n] === undefined ? [] : [hits[n]];
  let text = source;
  for (const i of [...pick].reverse()) text = text.slice(0, i) + by + text.slice(i + q.length);
  return { text, count: pick.length };
}

type HighlightRegistry = { set: (k: string, v: unknown) => void; delete: (k: string) => void };
const highlights = (): HighlightRegistry | null => (typeof CSS !== "undefined" && "highlights" in CSS ? (CSS as unknown as { highlights: HighlightRegistry }).highlights : null);
const HL = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;

/** root 底下看得到的文字（略過工具、圖說輸入框） */
function textNodes(root: HTMLElement): Text[] {
  const out: Text[] = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => ((n.parentElement?.closest(".gutter, .grip, .tail, textarea, .code-tools") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)),
  });
  for (let n = walk.nextNode(); n; n = walk.nextNode()) out.push(n as Text);
  return out;
}

/** 在 DOM 裡找，傳回每個符合的 Range（同一個文字節點裡的才算，跨格式的字串找不到） */
function domRanges(root: HTMLElement, q: string, o: FindOpts): Range[] {
  const out: Range[] = [];
  for (const t of textNodes(root)) {
    for (const i of findAll(t.data, q, o)) {
      const r = document.createRange();
      r.setStart(t, i);
      r.setEnd(t, i + q.length);
      out.push(r);
    }
  }
  return out;
}

export function DocFind(props: {
  /** 要找的範圍（文件的編輯器） */
  root: () => HTMLElement | null;
  source: string;
  onReplace: (next: string) => void;
  replace: boolean;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [by, setBy] = useState("");
  const [opts, setOpts] = useState<FindOpts>({ matchCase: false, whole: false });
  const [replace, setReplace] = useState(props.replace);
  const [at, setAt] = useState(0);
  const [tick, setTick] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setReplace((r) => r || props.replace), [props.replace]);
  useEffect(() => input.current?.select(), [props.replace]);

  // 文件改了（打字、取代）重新找：等編輯器畫好再量
  const [ranges, setRanges] = useState<Range[]>([]);
  const rootOf = useRef(props.root);
  rootOf.current = props.root;
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const root = rootOf.current();
      setRanges(root ? domRanges(root, q, opts) : []);
    });
    return () => cancelAnimationFrame(raf);
  }, [q, opts, props.source, tick]);
  const cur = ranges.length ? Math.min(at, ranges.length - 1) : -1;

  useEffect(() => {
    const reg = highlights();
    if (!reg || !HL) return;
    reg.set("doc-find", new HL(...ranges));
    if (cur >= 0) reg.set("doc-find-now", new HL(ranges[cur]));
    else reg.delete("doc-find-now");
    return () => {
      reg.delete("doc-find");
      reg.delete("doc-find-now");
    };
  }, [ranges, cur]);

  // 目前這個捲進畫面
  useEffect(() => {
    if (cur < 0) return;
    const el = ranges[cur].startContainer.parentElement;
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [cur, ranges]);

  // 分頁、圖片載入後 DOM 會變：每隔一會兒重找一次
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1500);
    return () => clearInterval(t);
  }, []);

  const step = (d: 1 | -1) => ranges.length && setAt((a) => (Math.min(a, ranges.length - 1) + d + ranges.length) % ranges.length);
  const doReplace = (all: boolean) => {
    if (!q) return;
    const r = replaceIn(props.source, q, by, opts, all ? -1 : Math.max(0, cur));
    if (r.count) props.onReplace(r.text);
  };

  return (
    <div className="doc-find editor-ui" role="search" onMouseDown={(e) => !(e.target as HTMLElement).closest("input") && e.preventDefault()}>
      <div className="doc-find-row">
        <input
          ref={input}
          autoFocus
          value={q}
          placeholder="Find in document"
          onChange={(e) => {
            setQ(e.target.value);
            setAt(0);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") step(e.shiftKey ? -1 : 1);
            if (e.key === "Escape") props.onClose();
          }}
        />
        <span className="doc-find-count">{q ? (ranges.length ? `${cur + 1} of ${ranges.length}` : "Not found") : ""}</span>
        <button title="Previous (Shift+Enter)" disabled={!ranges.length} onClick={() => step(-1)}>
          <ChevronLeftIcon />
        </button>
        <button title="Next (Enter)" disabled={!ranges.length} onClick={() => step(1)}>
          <ChevronRightIcon />
        </button>
        <label title="Match case">
          <input type="checkbox" checked={opts.matchCase} onChange={(e) => setOpts({ ...opts, matchCase: e.target.checked })} /> Aa
        </label>
        <label title="Whole words">
          <input type="checkbox" checked={opts.whole} onChange={(e) => setOpts({ ...opts, whole: e.target.checked })} /> Whole
        </label>
        {!replace && (
          <button className="doc-find-text" onClick={() => setReplace(true)} title="Replace (Ctrl+H)">
            Replace
          </button>
        )}
        <button title="Close (Esc)" onClick={props.onClose}>
          <CloseIcon />
        </button>
      </div>
      {replace && (
        <div className="doc-find-row">
          <input
            value={by}
            placeholder="Replace with"
            onChange={(e) => setBy(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") doReplace(false);
              if (e.key === "Escape") props.onClose();
            }}
          />
          <button className="doc-find-text" disabled={!q || !ranges.length} onClick={() => doReplace(false)}>
            Replace
          </button>
          <button className="doc-find-text" disabled={!q || !ranges.length} onClick={() => doReplace(true)}>
            Replace All
          </button>
        </div>
      )}
    </div>
  );
}
