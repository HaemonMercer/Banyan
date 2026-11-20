// 產生字預測的資料檔（src/editor/predict/）：
//   node scripts/build-predict.mjs <rime 資料夾>
// rime 資料夾要有 rime/rime-cangjie 的 cangjie5.base.dict.yaml、cangjie5.extended.dict.yaml
// 與 rime/rime-essay 的 essay.txt（都是 LGPL-3.0）。
//
// cangjie.txt：每行「字<Tab>倉頡碼」，依字頻由高到低（同一個字有幾個碼就有幾行）
// phrases.txt：每行一個詞（2～4 字），依詞頻由高到低，聯想用
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node scripts/build-predict.mjs <rime folder>");
  process.exit(1);
}
const out = join(import.meta.dirname, "..", "src", "editor", "predict");
mkdirSync(out, { recursive: true });

const weight = new Map();
const phrases = [];
for (const line of readFileSync(join(dir, "essay.txt"), "utf8").split("\n")) {
  const [w, n] = line.split("\t");
  if (!w || !n) continue;
  const c = [...w];
  if (c.length === 1) weight.set(w, Number(n));
  else if (c.length <= 4 && Number(n) >= 200 && !/[〇-〇0-9A-Za-z]/.test(w)) phrases.push([w, Number(n)]);
}

/** 讀 Rime 碼表（YAML 標頭在 `...` 之前） */
function table(file) {
  const text = readFileSync(join(dir, file), "utf8");
  const body = text.slice(text.indexOf("\n...") + 4);
  const rows = [];
  for (const line of body.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [ch, code] = line.split("\t");
    if (!ch || !code || [...ch].length !== 1 || !/^[a-y]{1,5}$/.test(code)) continue;
    rows.push([ch, code]);
  }
  return rows;
}

const seen = new Set();
const rows = [];
let order = 0;
for (const [file, all] of [
  ["cangjie5.base.dict.yaml", true],
  ["cangjie5.extended.dict.yaml", false],
]) {
  for (const [ch, code] of table(file)) {
    const key = ch + code;
    // 擴充碼表只收有字頻的字（其他多半是罕用字）
    if (seen.has(key) || (!all && !weight.has(ch))) continue;
    seen.add(key);
    rows.push({ ch, code, w: weight.get(ch) ?? 0, i: order++ });
  }
}
rows.sort((a, b) => b.w - a.w || a.i - b.i);
writeFileSync(join(out, "cangjie.txt"), rows.map((r) => `${r.ch}\t${r.code}`).join("\n") + "\n");

phrases.sort((a, b) => b[1] - a[1]);
const top = phrases.slice(0, 60000).map((p) => p[0]);
writeFileSync(join(out, "phrases.txt"), top.join("\n") + "\n");
console.log(`cangjie.txt: ${rows.length} rows, phrases.txt: ${top.length} phrases`);
