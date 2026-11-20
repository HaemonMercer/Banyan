const PREFIX = /^ {0,3}(#{1,6}[ \t]+|[-+*][ \t]+|\d{1,9}[.)][ \t]+|>[ \t]?|`{3,}.*\n|~{3,}.*\n)/;

/**
 * 點擊渲染後的區塊時，估計游標該放在原始碼的哪裡。
 * 取點擊位置前的可見文字尾巴，到原始碼裡找最接近預估位置的相同片段。
 */
export function caretFromPoint(el: HTMLElement, x: number, y: number, source: string): number {
  const prefix = PREFIX.exec(source)?.[0].length ?? 0;
  let node: Node | null = null;
  let offset = 0;
  const d = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    if (p) [node, offset] = [p.offsetNode, p.offset];
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (r) [node, offset] = [r.startContainer, r.startOffset];
  }
  if (!node || !el.contains(node)) return source.length;

  const range = document.createRange();
  range.setStart(el, 0);
  range.setEnd(node, offset);
  const before = range.toString().replace(/\s+/g, " ").trimStart();
  if (!before) return prefix;

  const estimate = prefix + before.length;
  for (let n = Math.min(before.length, 12); n >= 1; n--) {
    const tail = before.slice(-n);
    let best = -1;
    for (let i = source.indexOf(tail); i !== -1; i = source.indexOf(tail, i + 1)) {
      if (best === -1 || Math.abs(i + n - estimate) < Math.abs(best + n - estimate)) best = i;
    }
    if (best !== -1) return best + n;
  }
  return Math.min(estimate, source.length);
}
