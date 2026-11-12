/**
 * Plain-text books (TXT novels): the encoding is detected (UTF-8, UTF-16, Big5, GB18030), and the
 * text is split into chapters at headings such as 「第十二章」「卷三」「Chapter 4」.
 */
import { esc, htmlPage, type Book, type Chapter, type TocEntry } from "./types";

/** Very common characters (traditional and simplified): text decoded with the right encoding is full of them. */
const COMMON =
    "的一是不了在人有我他這这个個們们中來来上大為为和國国地到以說说時时要就出會会可也你對对生能而子那得於于著着下自之年過过發发後后作里裡用道行所然家種种事成方多經经麼么去法學学如都同現现當当沒没動动面起看定天分還还進进好小部其些主樣样理心她本前開开但因只從从想實实日者意無无力它與与長长把機机十民第公此已工使情明性知全三又關关點点正業业外將将兩两高間间由問问很最重並并物手應应向頭头文體体相見见被利什二等產产或新己身果加月話话合回特代內内信表化老給给世位次度門门任常先海通教兒儿原東东聲声提立及比員员水名真論论處处走義义各入幾几口認认條条平系氣气題题活更別别打女變变四神總总何電电數数安少報报才結结反受目太量再感建做接必場场件計计期市直資资命山金指許许區区至形便空決决治展科司五基眼書书非則则聽听白卻却界達达光放強强即像難难且思王完設设色路記记南品住告類类求據据程北邊边死張张該该交規规萬万取拉格望覺觉術术領领共確确傳传師师觀观清今切院讓让識识候帶带爭争運运笑飛飞風风步改收根造言每快辦办往元英士近失轉转夫令準准布始怎呢存未遠远叫單单影具愛爱流備备兵連连調调深商算質质團团集百需價价花華华城石級级整府離离況况請请技約约示復复病息究線线似官火斷断精滿满支視视消越器容照須须九增研寫写稱称功嗎吗包片史委乎查輕轻易早曾除農农找裝装廣广顯显吧李標标談谈吃圖图念六引歷历首醫医局突專专費费號号盡尽另周較较注語语仍狀状青負负錯错江";
const COMMON_SET = new Set(COMMON);

function score(text: string): number {
    let hits = 0;
    let bad = 0;
    const sample = text.slice(0, 20000);
    for (const ch of sample) {
        if (COMMON_SET.has(ch)) hits++;
        else if (ch === "�") bad++;
    }
    return (hits - bad * 5) / Math.max(1, sample.length);
}

/** Decodes text whose encoding isn't stated: BOM, then valid UTF-8, then the better of Big5 / GB18030. */
export function decodeText(bytes: Uint8Array): { text: string; encoding: string } {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "UTF-8" };
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "UTF-16" };
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "UTF-16" };
    try {
        return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "UTF-8" };
    } catch {
        /* not UTF-8 */
    }
    const head = bytes.subarray(0, 200_000);
    const big5 = new TextDecoder("big5").decode(head);
    const gb = new TextDecoder("gb18030").decode(head);
    const encoding = score(big5) >= score(gb) ? "big5" : "gb18030";
    return { text: new TextDecoder(encoding).decode(bytes), encoding: encoding === "big5" ? "Big5" : "GB18030" };
}

/** A line that starts a chapter. */
const HEADING =
    /^[ \t　]*((第[ \t　]*[0-9０-９一二三四五六七八九十百千萬万零〇两兩]+[ \t　]*[章回節节卷部篇集話话幕])|(序章|序言|序|楔子|引子|前言|後記|后记|尾聲|尾声|番外[^\n]{0,20}|終章|终章)(?=[ \t　:：]|$)|((chapter|part|book)[ \t]+[0-9ivxlc]+\b))[^\n]{0,40}$/i;

/** Pieces of text without headings are cut at this many characters, so long files stay quick. */
const PIECE = 30_000;

export class TxtBook implements Book {
    title: string;
    chapters: Chapter[] = [];
    toc: TocEntry[] = [];
    vertical = false;
    encoding: string;
    private parts: { heading: string; body: string }[] = [];

    constructor(bytes: Uint8Array, title: string) {
        const { text, encoding } = decodeText(bytes);
        this.encoding = encoding;
        this.title = title;
        const lines = text.replace(/\r\n?/g, "\n").split("\n");
        let cur = { heading: "", body: [] as string[] };
        const flush = () => {
            const body = cur.body.join("\n");
            if (cur.heading || body.trim()) this.parts.push({ heading: cur.heading, body });
        };
        for (const line of lines) {
            if (line.length < 50 && HEADING.test(line)) {
                flush();
                cur = { heading: line.trim(), body: [] };
            } else cur.body.push(line);
        }
        flush();
        // Long stretches without headings are cut into pieces at blank lines.
        this.parts = this.parts.flatMap((p) => {
            if (p.body.length <= PIECE * 1.5) return [p];
            const out: { heading: string; body: string }[] = [];
            let rest = p.body;
            let first = true;
            while (rest.length > 0) {
                let cut = rest.length <= PIECE * 1.5 ? rest.length : rest.indexOf("\n", PIECE);
                if (cut < 0) cut = rest.length;
                out.push({ heading: first ? p.heading : "", body: rest.slice(0, cut) });
                rest = rest.slice(cut);
                first = false;
            }
            return out;
        });
        if (this.parts.length === 0) this.parts.push({ heading: "", body: "" });
        this.chapters = this.parts.map((p, i) => ({ path: String(i), label: p.heading || (i === 0 ? "開始" : `第 ${i + 1} 部分`) }));
        this.toc = this.parts.flatMap((p, i) => (p.heading ? [{ label: p.heading, path: String(i), fragment: "", depth: 0 }] : []));
    }

    async chapter(index: number, readerCss: string) {
        const p = this.parts[index];
        const paras = p.body
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l !== "")
            .map((l) => `<p>${esc(l)}</p>`)
            .join("");
        const css = `${readerCss}\np { text-indent: 2em; margin: 0 0 .6em; }`;
        return htmlPage((p.heading ? `<h2>${esc(p.heading)}</h2>` : "") + paras, css, p.heading);
    }

    async chapterText(index: number) {
        const p = this.parts[index];
        return `${p.heading}\n${p.body}`;
    }

    close() {}
}
