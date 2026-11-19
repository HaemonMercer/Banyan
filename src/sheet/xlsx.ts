import { isFormula, type Calc } from "./calc";
import { colName, type Value } from "./formula";
import { key, type Style, type Table, type Workbook } from "./model";

/**
 * 匯出 .xlsx（Office Open XML）：每個表格一張 Excel 工作表（像 Numbers 匯出 Excel）。
 * 公式照寫（Excel 的語法大致相同；指向別的表格的公式只寫算好的值），同時寫入算好的值，
 * 打開不用重算也看得到。zip 不壓縮（`stored`），不用額外的套件。
 */

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

/* ─── 樣式 ─── */

class Styles {
  fonts = ['<font><sz val="11"/><name val="Calibri"/></font>'];
  fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  numFmts: string[] = [];
  xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  borders = ["<border><left/><right/><top/><bottom/><diagonal/></border>"];
  private ids = new Map<string, number>();

  private index(list: string[], item: string): number {
    const i = list.indexOf(item);
    if (i >= 0) return i;
    list.push(item);
    return list.length - 1;
  }

  /** 一格的 xf 編號 */
  xf(s: Style | undefined, v: Value, header: boolean): number {
    const numFmt = this.numFmt(s, v);
    const bold = s?.b || header;
    const color = s?.color ? `<color rgb="FF${s.color.replace("#", "").toUpperCase()}"/>` : "";
    // 字級：畫面的 px 換成 pt（13px ≈ 11pt）
    const sz = s?.fs ? Math.round((s.fs * 11) / 13) : 11;
    const font =
      bold || s?.i || s?.u || s?.st || color || sz !== 11
        ? this.index(this.fonts, `<font>${bold ? "<b/>" : ""}${s?.i ? "<i/>" : ""}${s?.st ? "<strike/>" : ""}${s?.u ? "<u/>" : ""}<sz val="${sz}"/>${color}<name val="Calibri"/></font>`)
        : 0;
    const side = (x: string, tag: string) => (s?.bd?.includes(x) ? `<${tag} style="thin"><color auto="1"/></${tag}>` : `<${tag}/>`);
    const border = s?.bd ? this.index(this.borders, `<border>${side("l", "left")}${side("r", "right")}${side("t", "top")}${side("b", "bottom")}<diagonal/></border>`) : 0;
    const fill = s?.fill
      ? this.index(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${s.fill.replace("#", "").toUpperCase()}"/><bgColor indexed="64"/></patternFill></fill>`)
      : 0;
    const al = [s?.align && `horizontal="${s.align}"`, `vertical="${s?.va === "top" ? "top" : s?.va === "bottom" ? "bottom" : "center"}"`, s?.wrap && 'wrapText="1"'].filter(Boolean).join(" ");
    const align = s?.align || s?.va || s?.wrap ? `<alignment ${al}/>` : "";
    const xml = `<xf numFmtId="${numFmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${numFmt ? ' applyNumberFormat="1"' : ""}${font ? ' applyFont="1"' : ""}${fill ? ' applyFill="1"' : ""}${border ? ' applyBorder="1"' : ""}${align ? ' applyAlignment="1">' + align + "</xf>" : "/>"}`;
    const hit = this.ids.get(xml);
    if (hit !== undefined) return hit;
    this.xfs.push(xml);
    this.ids.set(xml, this.xfs.length - 1);
    return this.xfs.length - 1;
  }

  private numFmt(s: Style | undefined, v: Value): number {
    if (v.t !== "n") return 0;
    const fmt = s?.fmt ?? "auto";
    const kind = fmt === "auto" ? (v.hint === "date" ? "date" : v.hint === "pct" ? "percent" : v.hint === "cur" ? "currency" : "number") : fmt;
    const decs = (d: number) => (d > 0 ? "." + "0".repeat(d) : "");
    let code: string | null = null;
    if (kind === "date") code = Number.isInteger(v.n) ? "mmm d, yyyy" : "mmm d, yyyy h:mm";
    else if (kind === "percent") code = `0${decs(s?.dec ?? 0)}%`;
    else if (kind === "currency") code = `"${(s?.cur ?? "$").replace(/"/g, "")}"#,##0${decs(s?.dec ?? 2)}`;
    else if (kind === "number" && (s?.dec !== undefined || s?.sep)) code = `${s?.sep ? "#,##0" : "0"}${decs(s?.dec ?? 0)}`;
    if (!code) return 0;
    const builtin: Record<string, number> = { "0": 1, "0.00": 2, "#,##0": 3, "#,##0.00": 4, "0%": 9, "0.00%": 10 };
    if (builtin[code]) return builtin[code];
    return 164 + this.index(this.numFmts, code);
  }

  xml(): string {
    const nf = this.numFmts.length
      ? `<numFmts count="${this.numFmts.length}">${this.numFmts.map((c, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(c)}"/>`).join("")}</numFmts>`
      : "";
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${nf}` +
      `<fonts count="${this.fonts.length}">${this.fonts.join("")}</fonts>` +
      `<fills count="${this.fills.length}">${this.fills.join("")}</fills>` +
      `<borders count="${this.borders.length}">${this.borders.join("")}</borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join("")}</cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
    );
  }
}

/* ─── 工作表 ─── */

function sheetXml(t: Table, tid: string, calc: Calc, styles: Styles, strings: Map<string, number>): string {
  const str = (s: string) => {
    let i = strings.get(s);
    if (i === undefined) strings.set(s, (i = strings.size));
    return i;
  };
  const rows: string[] = [];
  for (let r = 0; r < t.rows; r++) {
    const cells: string[] = [];
    for (let c = 0; c < t.cols; c++) {
      const cell = t.cells[key(r, c)];
      if (!cell) continue;
      const ref = `${colName(c)}${r + 1}`;
      const v = calc.value(tid, r, c);
      const header = r < t.hr || c < t.hc || r >= t.rows - t.fr;
      const s = styles.xf(cell.s, v, header);
      const sa = s ? ` s="${s}"` : "";
      // 指向別的表格的公式：Excel 讀不懂 Table::A1，只寫值
      const f = isFormula(cell.v) && !cell.v.includes("::") ? `<f>${esc(cell.v.slice(1))}</f>` : "";
      const checkbox = cell.s?.fmt === "checkbox";
      if (v.t === "empty") {
        if (sa || f) cells.push(`<c r="${ref}"${sa}>${f}</c>`);
      } else if (v.t === "n" && !checkbox) cells.push(`<c r="${ref}"${sa}>${f}<v>${v.n}</v></c>`);
      else if (v.t === "b" || checkbox) {
        const on = v.t === "b" ? v.b : v.t === "n" ? v.n !== 0 : v.t === "s" && v.s.toUpperCase() === "TRUE";
        cells.push(`<c r="${ref}"${sa} t="b">${f}<v>${on ? 1 : 0}</v></c>`);
      } else if (v.t === "e") cells.push(`<c r="${ref}"${sa} t="e">${f}<v>${esc(v.e)}</v></c>`);
      else if (v.t === "s" && f) cells.push(`<c r="${ref}"${sa} t="str">${f}<v>${esc(v.s)}</v></c>`);
      else if (v.t === "s") cells.push(`<c r="${ref}"${sa} t="s"><v>${str(v.s)}</v></c>`);
    }
    const hid = t.hideR?.includes(r);
    const ht = t.rowH[r];
    const attrs = `${ht ? ` ht="${(ht * 0.75).toFixed(2)}" customHeight="1"` : ""}${hid ? ' hidden="1"' : ""}`;
    if (cells.length || attrs) rows.push(`<row r="${r + 1}"${attrs}>${cells.join("")}</row>`);
  }
  const cols = t.colW.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${(w / 7).toFixed(2)}" customWidth="1"${t.hideC?.includes(i) ? ' hidden="1"' : ""}/>`).join("");
  const merges = t.merges?.length
    ? `<mergeCells count="${t.merges.length}">${t.merges.map((m) => `<mergeCell ref="${colName(m.c0)}${m.r0 + 1}:${colName(m.c1)}${m.r1 + 1}"/>`).join("")}</mergeCells>`
    : "";
  // 下拉選單 → 資料驗證（清單）
  const lists = Object.entries(t.cells).filter(([, c]) => c.s?.fmt === "popup" && c.s.opts?.length);
  const validations = lists.length
    ? `<dataValidations count="${lists.length}">${lists
        .map(([k, c]) => {
          const [r, cc] = k.split(",").map(Number);
          return `<dataValidation type="list" allowBlank="1" showDropDown="0" sqref="${colName(cc)}${r + 1}"><formula1>"${esc(c.s!.opts!.join(",").replace(/"/g, ""))}"</formula1></dataValidation>`;
        })
        .join("")}</dataValidations>`
    : "";
  const pane = t.hr
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${t.hr}" topLeftCell="A${t.hr + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : "";
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `${pane}<cols>${cols}</cols><sheetData>${rows.join("")}</sheetData>${merges}${validations}</worksheet>`
  );
}

/** Excel 工作表名稱：最多 31 字、不能有 []:*?/\、不重複 */
function sheetNames(wb: Workbook): string[] {
  const used = new Set<string>();
  const out: string[] = [];
  for (const s of wb.sheets)
    for (const t of s.tables) {
      const raw = (s.tables.length === 1 ? s.name : wb.sheets.length === 1 ? t.name : `${s.name} - ${t.name}`).replace(/[[\]:*?/\\]/g, " ").trim() || "Sheet";
      let name = raw.slice(0, 31);
      for (let i = 2; used.has(name.toLowerCase()); i++) name = `${raw.slice(0, 31 - String(i).length - 1)} ${i}`;
      used.add(name.toLowerCase());
      out.push(name);
    }
  return out;
}

export function toXlsx(wb: Workbook, calc: Calc): Uint8Array {
  const styles = new Styles();
  const strings = new Map<string, number>();
  const tables = wb.sheets.flatMap((s) => s.tables);
  const names = sheetNames(wb);
  const sheets = tables.map((t) => sheetXml(t, t.id, calc, styles, strings));
  const files: [string, string][] = [
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        sheets.map((_s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
        names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
        `</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheets.map((_s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `<Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    ],
    ...sheets.map((x, i) => [`xl/worksheets/sheet${i + 1}.xml`, x] as [string, string]),
    ["xl/styles.xml", styles.xml()],
    [
      "xl/sharedStrings.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.size}" uniqueCount="${strings.size}">` +
        [...strings.keys()].map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("") +
        `</sst>`,
    ],
  ];
  return zip(files.map(([n, s]) => [n, new TextEncoder().encode(s)]));
}

/* ─── zip（不壓縮） ─── */

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files: [string, Uint8Array][]): Uint8Array {
  const enc = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nb = enc.encode(name);
    const crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true); // 檔名是 UTF-8
    head.setUint16(8, 0, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, data.length, true);
    head.setUint32(22, data.length, true);
    head.setUint16(26, nb.length, true);
    local.push(new Uint8Array(head.buffer), nb, data);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, nb.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), nb);
    offset += 30 + nb.length + data.length;
  }
  const size = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** 測試用：zip 裡的檔名（讀中央目錄） */
export function unzipNames(b: Uint8Array): string[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let e = b.length - 22;
  while (e > 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  const n = v.getUint16(e + 10, true);
  let at = v.getUint32(e + 16, true);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const len = v.getUint16(at + 28, true);
    const extra = v.getUint16(at + 30, true) + v.getUint16(at + 32, true);
    out.push(new TextDecoder().decode(b.subarray(at + 46, at + 46 + len)));
    at += 46 + len + extra;
  }
  return out;
}

/** 一個表格匯出成 CSV（顯示的文字；逗號、引號、換行的格子用引號包起來） */
export function toCsv(t: Table, calc: Calc): string {
  const quote = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const textOf = (r: number, c: number) => {
    const v = calc.value(t.id, r, c);
    return v.t === "n" ? String(v.n) : v.t === "b" ? (v.b ? "TRUE" : "FALSE") : v.t === "s" ? v.s : v.t === "e" ? v.e : "";
  };
  // 右邊全空的欄不寫
  let cols = 0;
  for (let r = 0; r < t.rows; r++) for (let c = cols; c < t.cols; c++) if (textOf(r, c)) cols = c + 1;
  const lines: string[] = [];
  for (let r = 0; r < t.rows; r++) lines.push(Array.from({ length: Math.max(1, cols) }, (_x, c) => quote(textOf(r, c))).join(","));
  // 結尾的空白列不寫
  while (lines.length > 1 && /^,*$/.test(lines[lines.length - 1])) lines.pop();
  return lines.join("\r\n") + "\r\n";
}
