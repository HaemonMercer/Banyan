/**
 * Dock 的分割視窗（參考 VS Code 的編輯器群組）：純函式。
 *
 * 版面是一棵樹：葉子是群組（`PaneGroup`，一排分頁，每個分頁是一份文件），中間的節點是分割
 * （`PaneSplit`，`row` 左右並排、`col` 上下並排，`sizes` 是各子節點的比例，加起來是 1）。
 * 同一份文件只會開在一個群組（兩個編輯器改同一段 Markdown 會互相蓋掉），所以「分割」是把分頁搬到
 * 新群組，不是複製。`focus` 是正在操作的群組，它的 `active` 分頁就是 App 畫面上的 `doc`。
 * 群組的 `preview` 是預覽分頁（斜體，在清單上點一下打開的；下次打開別的文件時被取代，編輯或按兩下
 * 分頁就變成固定的）。關掉的分頁記在 `closed`（最新的在最後），`reopenTab` 放回原來的群組與位置。
 * 群組空了就拿掉（只剩一個群組時留著）。狀態每個 Desk 檔案一份，存在 localStorage
 * （`store.ts` 的 `loadPanes`／`savePanes`）。
 */

export const MAX_GROUPS = 6;
/** 記住幾個關掉的分頁 */
export const MAX_CLOSED = 10;
/** 群組最窄佔所在分割的比例 */
export const MIN_SIZE = 0.1;

export type Side = "left" | "right" | "up" | "down";

export interface PaneGroup {
  type: "group";
  id: string;
  /** 分頁的文件 id（左到右） */
  tabs: string[];
  active: string | null;
  /** 預覽分頁（一個群組最多一個） */
  preview: string | null;
}

export interface PaneSplit {
  type: "split";
  id: string;
  dir: "row" | "col";
  children: PaneNode[];
  sizes: number[];
}

export type PaneNode = PaneGroup | PaneSplit;

export interface ClosedTab {
  /** 文件 id */
  id: string;
  /** 原來的群組 */
  group: string;
  /** 原來是第幾個分頁 */
  at: number;
}

export interface Panes {
  root: PaneNode;
  /** 操作中的群組 id */
  focus: string;
  closed: ClosedTab[];
  /** 產生群組、分割 id 用的流水號 */
  seq: number;
}

/** 放下分頁的位置：群組的分頁列（`index` 是插在第幾個，沒有就是作用中分頁後面），或群組的一邊（分割出新群組） */
export type TabTarget = { group: string; index?: number; side?: undefined } | { group: string; side: Side; index?: undefined };

const group = (id: string, tabs: string[] = [], active: string | null = tabs[0] ?? null, preview: string | null = null): PaneGroup => ({
  type: "group",
  id,
  tabs,
  active,
  preview,
});

export const onePane = (id: string | null): Panes => ({ root: group("g1", id ? [id] : []), focus: "g1", closed: [], seq: 1 });

/* ─── 查詢 ─── */

/** 所有群組（樹的順序：左到右、上到下） */
export function groupsOf(node: PaneNode): PaneGroup[] {
  return node.type === "group" ? [node] : node.children.flatMap(groupsOf);
}

export const findGroup = (p: Panes, id: string): PaneGroup | undefined => groupsOf(p.root).find((g) => g.id === id);
export const groupOfDoc = (p: Panes, doc: string): PaneGroup | undefined => groupsOf(p.root).find((g) => g.tabs.includes(doc));
export const focusedGroup = (p: Panes): PaneGroup => findGroup(p, p.focus) ?? groupsOf(p.root)[0];
/** 操作中群組的作用中分頁（App 的 `doc`） */
export const activeDoc = (p: Panes): string | null => focusedGroup(p).active;
/** 開著的文件（所有分頁） */
export const openDocs = (p: Panes): string[] => groupsOf(p.root).flatMap((g) => g.tabs);
export const tabCount = (p: Panes): number => openDocs(p).length;

/* ─── 樹的操作 ─── */

const even = (n: number) => Array.from({ length: n }, () => 1 / n);

/** 比例調成加起來是 1（壞掉的值平均分） */
function scale(sizes: number[], n: number): number[] {
  if (sizes.length !== n || sizes.some((s) => !(s > 0))) return even(n);
  const sum = sizes.reduce((a, b) => a + b, 0);
  return sizes.map((s) => s / sum);
}

function mapGroups(node: PaneNode, fn: (g: PaneGroup) => PaneGroup): PaneNode {
  if (node.type === "group") return fn(node);
  return { ...node, children: node.children.map((c) => mapGroups(c, fn)) };
}

/** 整理樹：拿掉空群組（`keep` 除外）、只剩一個子節點的分割換成那個子節點、同方向的分割攤平 */
function tidy(node: PaneNode, keep: (g: PaneGroup) => boolean): PaneNode | null {
  if (node.type === "group") return node.tabs.length || keep(node) ? node : null;
  const children: PaneNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((c, i) => {
    const t = tidy(c, keep);
    if (!t) return;
    const s = node.sizes[i] ?? 0;
    if (t.type === "split" && t.dir === node.dir) {
      t.children.forEach((cc, k) => {
        children.push(cc);
        sizes.push(s * t.sizes[k]);
      });
    } else {
      children.push(t);
      sizes.push(s);
    }
  });
  if (!children.length) return null;
  if (children.length === 1) return children[0];
  return { ...node, children, sizes: scale(sizes, children.length) };
}

/** 整理樹與焦點；整棵都空了就留一個空群組 */
function settle(p: Panes, root: PaneNode, focus = p.focus): Panes {
  const all = groupsOf(root);
  // 只剩一個群組就留著，焦點所在的空群組在還有別的群組時拿掉
  const t = tidy(root, (g) => all.length === 1 && g.id === all[0].id) ?? group(all[0]?.id ?? "g1");
  const left = groupsOf(t);
  if (!left.some((g) => g.id === focus)) {
    // 焦點的群組不見了：換到它在原本順序裡前一個（沒有就是後一個）還在的群組
    const i = all.findIndex((g) => g.id === focus);
    const near = [...all.slice(0, Math.max(0, i)).reverse(), ...all.slice(i + 1)].find((g) => left.some((x) => x.id === g.id));
    focus = near?.id ?? left[0].id;
  }
  return { ...p, root: t, focus };
}

/** 在群組 gid 的 side 邊插入新群組 */
function insertBeside(node: PaneNode, gid: string, side: Side, add: PaneGroup, splitId: () => string): PaneNode {
  const dir = side === "left" || side === "right" ? "row" : "col";
  const before = side === "left" || side === "up";
  if (node.type === "group") {
    if (node.id !== gid) return node;
    return { type: "split", id: splitId(), dir, children: before ? [add, node] : [node, add], sizes: [0.5, 0.5] };
  }
  const i = node.children.findIndex((c) => c.type === "group" && c.id === gid);
  if (i >= 0 && node.dir === dir) {
    // 同方向：分掉那個群組一半的大小
    const half = node.sizes[i] / 2;
    const children = [...node.children];
    const sizes = [...node.sizes];
    sizes[i] = half;
    const at = before ? i : i + 1;
    children.splice(at, 0, add);
    sizes.splice(at, 0, half);
    return { ...node, children, sizes };
  }
  return { ...node, children: node.children.map((c) => insertBeside(c, gid, side, add, splitId)) };
}

/** 從群組拿掉分頁，作用中分頁換成旁邊的（右邊，沒有就左邊） */
function dropTab(g: PaneGroup, doc: string): PaneGroup {
  const i = g.tabs.indexOf(doc);
  if (i < 0) return g;
  const tabs = g.tabs.filter((t) => t !== doc);
  const active = g.active === doc ? (tabs[i] ?? tabs[i - 1] ?? null) : g.active;
  return { ...g, tabs, active, preview: g.preview === doc ? null : g.preview };
}

/* ─── 操作 ─── */

/**
 * 依目前的文件整理：拿掉已經刪掉的文件（分頁與關閉紀錄）、重複的分頁、空群組，修好比例、作用中分頁與焦點。
 * 什麼都沒開時開 `fallback`（App 開著的文件）。
 */
export function cleanPanes(p: Panes, exists: (id: string) => boolean, fallback: string | null): Panes {
  const seen = new Set<string>();
  const root = mapGroups(p.root, (g) => {
    const tabs = g.tabs.filter((t) => exists(t) && !seen.has(t) && (seen.add(t), true));
    const active = g.active && tabs.includes(g.active) ? g.active : (tabs[Math.min(tabs.length - 1, Math.max(0, g.tabs.indexOf(g.active ?? "")))] ?? null);
    const preview = g.preview && tabs.includes(g.preview) ? g.preview : null;
    return { ...g, tabs, active, preview };
  });
  let next = settle({ ...p, closed: p.closed.filter((c) => exists(c.id)).slice(-MAX_CLOSED) }, root);
  if (!tabCount(next) && fallback && exists(fallback)) {
    const f = next.focus;
    next = { ...next, root: mapGroups(next.root, (g) => (g.id === f ? group(g.id, [fallback]) : g)) };
  }
  return next;
}

/**
 * 打開文件：已經開在某個群組就換到那裡；否則開在 `group`（預設是操作中的群組）：
 * 預覽打開時取代那個群組的預覽分頁，否則插在作用中分頁後面。不是預覽打開就把它變成固定分頁。
 */
export function openDoc(p: Panes, id: string, opts: { preview?: boolean; group?: string } = {}): Panes {
  const has = groupOfDoc(p, id);
  if (has) {
    const pin = !opts.preview && has.preview === id;
    if (has.id === p.focus && has.active === id && !pin) return p;
    return { ...p, focus: has.id, root: mapGroups(p.root, (g) => (g.id === has.id ? { ...g, active: id, preview: pin ? null : g.preview } : g)) };
  }
  const gid = opts.group && findGroup(p, opts.group) ? opts.group : focusedGroup(p).id;
  const root = mapGroups(p.root, (g) => {
    if (g.id !== gid) return g;
    const tabs = [...g.tabs];
    if (opts.preview && g.preview) {
      tabs[tabs.indexOf(g.preview)] = id;
      return { ...g, tabs, active: id, preview: id };
    }
    const at = g.active ? tabs.indexOf(g.active) + 1 : tabs.length;
    tabs.splice(at, 0, id);
    return { ...g, tabs, active: id, preview: opts.preview ? id : g.preview };
  });
  return { ...p, root, focus: gid };
}

/** 預覽分頁變成固定分頁（不是預覽就不動） */
export function pinTab(p: Panes, id: string): Panes {
  const g = groupOfDoc(p, id);
  if (!g || g.preview !== id) return p;
  return { ...p, root: mapGroups(p.root, (x) => (x.id === g.id ? { ...x, preview: null } : x)) };
}

export const focusGroup = (p: Panes, gid: string): Panes => (gid !== p.focus && findGroup(p, gid) ? { ...p, focus: gid } : p);

/** 操作中群組的上一個／下一個分頁（循環） */
export function cycleTab(p: Panes, delta: number): Panes {
  const g = focusedGroup(p);
  if (g.tabs.length < 2 || !g.active) return p;
  const i = g.tabs.indexOf(g.active);
  return openDoc(p, g.tabs[(i + delta + g.tabs.length) % g.tabs.length]);
}

/** 換到上一個／下一個群組（樹的順序，循環） */
export function cycleGroup(p: Panes, delta: number): Panes {
  const all = groupsOf(p.root);
  if (all.length < 2) return p;
  const i = all.findIndex((g) => g.id === p.focus);
  return focusGroup(p, all[(i + delta + all.length) % all.length].id);
}

/** 關掉分頁（記進 `closed`）。最後一個分頁不能關（Dock 至少開著一份文件）。 */
export function closeTab(p: Panes, id: string): Panes {
  const g = groupOfDoc(p, id);
  if (!g || tabCount(p) <= 1) return p;
  const closed = [...p.closed.filter((c) => c.id !== id), { id, group: g.id, at: g.tabs.indexOf(id) }].slice(-MAX_CLOSED);
  return settle({ ...p, closed }, mapGroups(p.root, (x) => (x.id === g.id ? dropTab(x, id) : x)));
}

/** 一次關掉好幾個分頁（關其他、關右邊、關群組）；至少留一個 */
export function closeTabs(p: Panes, ids: string[]): Panes {
  return ids.reduce(closeTab, p);
}

/** 關掉群組裡的所有分頁（群組跟著拿掉） */
export const closeGroup = (p: Panes, gid: string): Panes => closeTabs(p, findGroup(p, gid)?.tabs ?? []);

/**
 * 重新打開最近關掉的分頁：放回原來的群組與位置（群組已經不在就開在操作中群組的作用中分頁後面）。
 * 已經開著的（之後又從清單打開了）就只換過去；沒有可以重新打開的就不動。
 */
export function reopenTab(p: Panes, exists: (id: string) => boolean): Panes {
  const closed = p.closed.filter((c) => exists(c.id));
  const last = closed.pop();
  if (!last) return p.closed.length === closed.length ? p : { ...p, closed };
  const rest = { ...p, closed };
  if (groupOfDoc(p, last.id)) return openDoc(rest, last.id);
  const home = findGroup(p, last.group);
  const gid = home ? home.id : focusedGroup(p).id;
  const root = mapGroups(p.root, (g) => {
    if (g.id !== gid) return g;
    const tabs = [...g.tabs];
    // 原來的群組不在了：插在作用中分頁後面
    const at = home ? Math.min(last.at, tabs.length) : g.active ? tabs.indexOf(g.active) + 1 : tabs.length;
    tabs.splice(at, 0, last.id);
    return { ...g, tabs, active: last.id };
  });
  return { ...rest, root, focus: gid };
}

/**
 * 把文件搬到 target（拖曳分頁、清單拖進來、Move to…）。文件還沒開就直接開在那裡。
 * 放在群組的一邊就分割出新群組（群組數到上限時改成放進那個群組）；搬過去的分頁是固定分頁，焦點跟過去。
 */
export function moveTab(p: Panes, id: string, to: TabTarget): Panes {
  const target = findGroup(p, to.group);
  if (!target) return p;
  const from = groupOfDoc(p, id);
  if (to.side) {
    // 群組裡只有它自己：分割了也一樣
    if (from && from.id === target.id && from.tabs.length === 1) return p;
    if (groupsOf(p.root).length >= MAX_GROUPS) return moveTab(p, id, { group: to.group });
    const seq = p.seq + 1;
    const gid = `g${seq}`;
    const base = from ? mapGroups(p.root, (g) => (g.id === from.id ? dropTab(g, id) : g)) : p.root;
    const root = insertBeside(base, target.id, to.side, group(gid, [id]), () => `s${seq}`);
    return settle({ ...p, seq }, root, gid);
  }
  if (from && from.id === target.id) {
    // 同一個群組：排順序
    const i = from.tabs.indexOf(id);
    let at = to.index ?? i;
    if (at > i) at--;
    const tabs = from.tabs.filter((t) => t !== id);
    tabs.splice(Math.max(0, Math.min(at, tabs.length)), 0, id);
    const same = tabs.every((t, k) => t === from.tabs[k]);
    if (same && from.active === id && p.focus === from.id && from.preview !== id) return p;
    return { ...p, focus: from.id, root: mapGroups(p.root, (g) => (g.id === from.id ? { ...g, tabs, active: id, preview: g.preview === id ? null : g.preview } : g)) };
  }
  const root = mapGroups(p.root, (g) => {
    if (from && g.id === from.id) return dropTab(g, id);
    if (g.id !== target.id) return g;
    const tabs = [...g.tabs];
    const at = to.index ?? (g.active ? tabs.indexOf(g.active) + 1 : tabs.length);
    tabs.splice(Math.max(0, Math.min(at, tabs.length)), 0, id);
    return { ...g, tabs, active: id };
  });
  return settle(p, root, target.id);
}

/** 分割時新群組要開的文件：照清單順序，操作中那份之後第一份還沒開著的（都開著就是 null） */
export function nextDoc(p: Panes, order: string[]): string | null {
  const open = openDocs(p);
  const cur = order.indexOf(activeDoc(p) ?? "");
  for (let k = 1; k <= order.length; k++) {
    const id = order[(cur + k + order.length) % order.length];
    if (!open.includes(id)) return id;
  }
  return null;
}

/**
 * 分割操作中的群組（Alt＋\）：群組有好幾個分頁就把作用中分頁搬到新群組；只有一個就在新群組開 `next`
 * （清單上下一份還沒開的）。沒辦法分割就不動。
 */
export function splitGroup(p: Panes, side: Side, next: string | null): Panes {
  const g = focusedGroup(p);
  if (!g.active) return p;
  if (g.tabs.length > 1) return moveTab(p, g.active, { group: g.id, side });
  if (!next || groupOfDoc(p, next) || groupsOf(p.root).length >= MAX_GROUPS) return p;
  return moveTab(p, next, { group: g.id, side });
}

/**
 * 在旁邊打開（清單的 Alt＋點擊）：已經開在別的群組就換過去；否則放進操作中群組右邊（樹的順序的下一個）的群組，
 * 沒有就往右分割出新群組。
 */
export function openToSide(p: Panes, id: string): Panes {
  const has = groupOfDoc(p, id);
  const g = focusedGroup(p);
  if (has && has.id !== g.id) return openDoc(p, id);
  if (has && has.tabs.length === 1) return openDoc(p, id);
  const all = groupsOf(p.root);
  const next = all[all.findIndex((x) => x.id === g.id) + 1];
  if (next) return moveTab(p, id, { group: next.id });
  return moveTab(p, id, { group: g.id, side: "right" });
}

/** 拖分割 splitId 裡第 i 與 i+1 個子節點中間的分隔線：第 i 個的比例改成 size，兩邊都不能小於 MIN_SIZE */
export function resizeSplit(p: Panes, splitId: string, i: number, size: number): Panes {
  let changed = false;
  const walk = (node: PaneNode): PaneNode => {
    if (node.type === "group") return node;
    if (node.id !== splitId) return { ...node, children: node.children.map(walk) };
    if (i < 0 || i + 1 >= node.children.length) return node;
    const pair = node.sizes[i] + node.sizes[i + 1];
    const l = Math.min(Math.max(size, MIN_SIZE), pair - MIN_SIZE);
    if (Math.abs(l - node.sizes[i]) < 1e-6) return node;
    changed = true;
    const sizes = [...node.sizes];
    sizes[i] = l;
    sizes[i + 1] = pair - l;
    return { ...node, sizes };
  };
  const root = walk(p.root);
  return changed ? { ...p, root } : p;
}

/* ─── 存檔 ─── */

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function parseNode(v: unknown, depth: number): PaneNode | null {
  if (!v || typeof v !== "object" || depth > 8) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string") return null;
  if (o.type === "group") {
    const tabs = strs(o.tabs);
    const active = typeof o.active === "string" && tabs.includes(o.active) ? o.active : (tabs[0] ?? null);
    const preview = typeof o.preview === "string" && tabs.includes(o.preview) ? o.preview : null;
    return group(o.id, tabs, active, preview);
  }
  if (o.type !== "split" || !Array.isArray(o.children)) return null;
  const pairs = o.children.map((c, i) => [parseNode(c, depth + 1), Number((o.sizes as unknown[] | undefined)?.[i])] as const).filter((x): x is [PaneNode, number] => !!x[0]);
  if (!pairs.length) return null;
  if (pairs.length === 1) return pairs[0][0];
  return { type: "split", id: o.id, dir: o.dir === "col" ? "col" : "row", children: pairs.map((x) => x[0]), sizes: scale(pairs.map((x) => x[1]), pairs.length) };
}

/** localStorage 讀回來的值 → Panes（格式不對的部分略過；舊版的「一排窗格、各一份文件」轉成一排群組） */
export function parsePanes(v: unknown): Panes | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  let root: PaneNode | null;
  let seq = Math.max(1, Math.floor(Number(o.seq) || 0));
  if (o.root) root = parseNode(o.root, 0);
  else {
    // 舊格式：{ docs, sizes, focus（第幾個）, closed: [{ id, at, size }] }
    const docs = strs(o.docs);
    if (!docs.length) return null;
    const groups = docs.map((d, i) => group(`g${i + 1}`, [d]));
    seq = docs.length;
    const sizes = Array.isArray(o.sizes) ? o.sizes.map(Number) : [];
    root = groups.length === 1 ? groups[0] : { type: "split", id: "s0", dir: "row", children: groups, sizes: scale(sizes.slice(0, groups.length), groups.length) };
    const f = groups[Math.max(0, Math.min(Math.floor(Number(o.focus) || 0), groups.length - 1))].id;
    return { root, focus: f, closed: [], seq };
  }
  if (!root) return null;
  const all = groupsOf(root);
  // 流水號要比現有的 id 都大，新群組才不會撞名
  for (const id of [...all.map((g) => g.id), ...collectSplitIds(root)]) {
    const n = Number(id.slice(1));
    if (Number.isFinite(n)) seq = Math.max(seq, n);
  }
  const closed = Array.isArray(o.closed)
    ? o.closed
        .filter((c): c is Record<string, unknown> => !!c && typeof c === "object" && typeof (c as Record<string, unknown>).id === "string")
        .map((c) => ({ id: c.id as string, group: typeof c.group === "string" ? c.group : "", at: Math.max(0, Math.floor(Number(c.at) || 0)) }))
        .slice(-MAX_CLOSED)
    : [];
  const focus = typeof o.focus === "string" && all.some((g) => g.id === o.focus) ? o.focus : all[0].id;
  return { root, focus, closed, seq };
}

function collectSplitIds(node: PaneNode): string[] {
  return node.type === "group" ? [] : [node.id, ...node.children.flatMap(collectSplitIds)];
}
