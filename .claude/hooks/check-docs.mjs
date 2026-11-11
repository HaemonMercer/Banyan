// Stop hook: before Claude ends a turn, make sure the docs were updated
// when source files changed.
//
// Blocks the stop (once) if any watched source file is newer than
// this week's log in 工作紀錄/, and asks Claude to update the log and
// check Design/Features.md.
import fs from "node:fs";
import path from "node:path";

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();

let input = {};
try { input = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch { /* no stdin */ }
// Already blocked once in this stop sequence: let it end, to avoid a loop.
if (input.stop_hook_active) process.exit(0);

const WATCH = [
    "src",
    "src-tauri/src",
    "src-tauri/tests",
    "src-tauri/Cargo.toml",
    "src-tauri/tauri.conf.json",
    "src-tauri/capabilities",
    "package.json",
    "index.html",
    "Design/Design Document.md",
];
const SKIP = new Set(["node_modules", "target", "dist", "gen"]);

function newest(p) {
    let st;
    try { st = fs.statSync(p); } catch { return { t: 0, f: null }; }
    if (!st.isDirectory()) return { t: st.mtimeMs, f: p };
    let best = { t: 0, f: null };
    for (const name of fs.readdirSync(p)) {
        if (SKIP.has(name)) continue;
        const r = newest(path.join(p, name));
        if (r.t > best.t) best = r;
    }
    return best;
}

// ISO week of the local date, e.g. { year: 2026, week: 46, mon, sun }.
function isoWeek(d) {
    const day = (d.getDay() + 6) % 7; // Mon = 0
    const thu = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day + 3);
    const jan4 = new Date(thu.getFullYear(), 0, 4);
    const week = 1 + Math.round(((thu - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
    const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
    const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
    return { year: thu.getFullYear(), week, mon, sun };
}
const pad = (n) => String(n).padStart(2, "0");

let src = { t: 0, f: null };
for (const w of WATCH) {
    const r = newest(path.join(root, w));
    if (r.t > src.t) src = r;
}
if (!src.f) process.exit(0);

const now = new Date();
const wk = isoWeek(now);
const prefix = `${wk.year}-W${pad(wk.week)}`;
const logDir = path.join(root, "工作紀錄");
let logFile = null;
try { logFile = fs.readdirSync(logDir).find((n) => n.startsWith(prefix) && n.endsWith(".md")) ?? null; } catch { /* no dir */ }

const logTime = logFile ? fs.statSync(path.join(logDir, logFile)).mtimeMs : 0;
// Only care about source changes made this week.
if (src.t < wk.mon.getTime() || src.t <= logTime) process.exit(0);

const expected = `${prefix}（${pad(wk.mon.getMonth() + 1)}-${pad(wk.mon.getDate())} ~ ${pad(wk.sun.getMonth() + 1)}-${pad(wk.sun.getDate())}）.md`;
const changed = path.relative(root, src.f).replaceAll("\\", "/");
const reason = [
    `程式碼在上次更新工作紀錄之後有變動（最新：${changed}）。結束前請：`,
    logFile
        ? `1. 把這次的工作寫進 工作紀錄/${logFile}。`
        : `1. 建立本週的工作紀錄 工作紀錄/${expected}，寫進這次的工作。`,
    `2. 檢查 Design/Features.md：功能有新增或變動時，更新對應段落、模組狀態、已知限制和「更新紀錄」。`,
    `3. 在回覆中告訴使用者更新了哪些文件。`,
].join("\n");

process.stdout.write(JSON.stringify({ decision: "block", reason }));
