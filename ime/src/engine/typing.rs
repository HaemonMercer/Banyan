//! 輔助打字：中文標點、英文標點、句首大寫、中英之間加空格。照 `src/editor/typing.ts` 移植，規則要一起改。

use super::punct::{cjk_punct, is_cjk, is_punct_key, last};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TypingPrefs {
    /// 中文句子裡的半形標點換成中文標點
    pub cjk_punct: bool,
    /// 英文句子裡的中文標點換成半形
    pub en_punct: bool,
    /// 英文句首大寫、單獨的 i 換成 I
    pub capitalize: bool,
    /// 中英之間加空格
    pub spacing: bool,
}

impl Default for TypingPrefs {
    fn default() -> Self {
        TypingPrefs { cjk_punct: true, en_punct: true, capitalize: true, spacing: false }
    }
}

/// 中日韓的「字」（漢字、注音、假名、韓文），不含標點
pub fn is_cjk_letter(c: Option<char>) -> bool {
    matches!(c, Some(c) if matches!(c as u32,
        0x3040..=0x30FF | 0x3100..=0x312F | 0x31A0..=0x31BF | 0x3400..=0x4DBF |
        0x4E00..=0x9FFF | 0xAC00..=0xD7AF | 0xF900..=0xFAFF))
}
fn is_latin(c: Option<char>) -> bool {
    c.is_some_and(|c| c.is_ascii_alphabetic())
}
fn is_alnum(c: Option<char>) -> bool {
    c.is_some_and(|c| c.is_ascii_alphanumeric())
}

/// 游標前面正在打的這句是不是英文
pub fn in_english(b: &[char]) -> bool {
    let mut latin = false;
    let mut n = 0;
    for i in (0..b.len()).rev() {
        if n >= 300 {
            break;
        }
        n += 1;
        let c = b[i];
        if c == '\n' || matches!(c, '。' | '！' | '？') {
            break;
        }
        if matches!(c, '.' | '!' | '?') && b.get(i + 1).is_some_and(|n| n.is_whitespace()) {
            break;
        }
        if is_cjk_letter(Some(c)) {
            return false;
        }
        if c.is_ascii_alphabetic() {
            latin = true;
        }
    }
    latin
}

fn half(c: char) -> Option<char> {
    Some(match c {
        '，' | '、' => ',',
        '。' => '.',
        '？' => '?',
        '！' => '!',
        '：' => ':',
        '；' => ';',
        '（' => '(',
        '）' => ')',
        '「' | '」' | '“' | '”' => '"',
        '『' | '』' | '‘' | '’' => '\'',
        _ => return None,
    })
}

const ABBR: [&str; 22] = [
    "e.g", "i.e", "etc", "vs", "cf", "mr", "mrs", "ms", "dr", "st", "no", "fig", "vol", "p", "pp", "a.m", "p.m", "jr", "sr", "inc",
    "ltd", "co",
];

/// 去掉結尾的空白（至少一個）；沒有空白回傳 None
fn strip_space(b: &[char]) -> Option<&[char]> {
    let n = b.iter().rev().take_while(|c| c.is_whitespace()).count();
    (n > 0).then(|| &b[..b.len() - n])
}

/// 句點後面不是句尾的縮寫（`e.g. `、`Mr. `）
fn abbr(b: &[char]) -> bool {
    let Some(s) = strip_space(b) else { return false };
    let Some((&'.', s)) = s.split_last() else { return false };
    let lower: Vec<char> = s.iter().map(|c| c.to_ascii_lowercase()).collect();
    ABBR.iter().any(|a| {
        let a: Vec<char> = a.chars().collect();
        lower.ends_with(&a) && {
            let p = lower.len() - a.len();
            p == 0 || lower[p - 1].is_whitespace() || lower[p - 1] == '('
        }
    })
}

/// 游標在英文句子的開頭：區塊開頭、行首（輸入法讀到的是整份文件，換行後就是新的一段），或英文句尾 `. ` `! ` `? ` 後面
pub fn sentence_start(b: &[char]) -> bool {
    if b.is_empty() || last(b) == Some('\n') {
        return true;
    }
    let Some(mut s) = strip_space(b) else { return false };
    if let Some((&c, rest)) = s.split_last() {
        if matches!(c, '"' | '\'' | ')' | ']') {
            s = rest;
        }
    }
    let Some((&p, end)) = s.split_last() else { return false };
    if !matches!(p, '.' | '!' | '?') || abbr(b) {
        return false;
    }
    is_latin(last(end)) && in_english(end)
}

/// 換成的文字與先刪掉游標前幾個字
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Change {
    pub text: String,
    pub remove: usize,
}

fn assist_char(ctx: &[char], c: char, p: &TypingPrefs) -> Option<Change> {
    let mut r: Option<Change> = None;
    if p.cjk_punct && is_punct_key(c) {
        r = cjk_punct(ctx, c).map(|(text, remove)| Change { text, remove });
    }
    if r.is_none() && p.en_punct {
        if let Some(h) = half(c) {
            if in_english(ctx) && !is_cjk(last(ctx)) {
                r = Some(Change { text: h.to_string(), remove: 0 });
            }
        }
    }
    if r.is_none() && p.capitalize && c.is_ascii_lowercase() && sentence_start(ctx) {
        r = Some(Change { text: c.to_ascii_uppercase().to_string(), remove: 0 });
    }
    if r.is_none() && p.capitalize && (c.is_whitespace() || ",.!?;:'".contains(c)) && lone_i(ctx) {
        r = Some(Change { text: format!("I{c}"), remove: 1 });
    }
    if p.spacing {
        let (ch, base): (char, Vec<char>) = match &r {
            Some(r) => {
                let mut base = ctx[..ctx.len() - r.remove].to_vec();
                let t: Vec<char> = r.text.chars().collect();
                base.extend_from_slice(&t[..t.len() - 1]);
                (*t.last().unwrap(), base)
            }
            None => (c, ctx.to_vec()),
        };
        let prev = last(&base);
        if (is_cjk_letter(prev) && is_alnum(Some(ch))) || (is_alnum(prev) && is_cjk_letter(Some(ch))) {
            r = Some(match r {
                Some(r) => {
                    let mut t: Vec<char> = r.text.chars().collect();
                    t.pop();
                    Change { text: format!("{} {ch}", t.into_iter().collect::<String>()), remove: r.remove }
                }
                None => Change { text: format!(" {c}"), remove: 0 },
            });
        }
    }
    r
}

/// 單獨的 i（`i am`、`i'm`）：`(^|[\s"(])i$`，而且 i 前面不是中文
fn lone_i(ctx: &[char]) -> bool {
    let n = ctx.len();
    if n == 0 || ctx[n - 1] != 'i' {
        return false;
    }
    let ok = n == 1 || ctx[n - 2].is_whitespace() || ctx[n - 2] == '"' || ctx[n - 2] == '(';
    ok && !(n >= 2 && is_cjk(Some(ctx[n - 2])))
}

/// 在 before 後面輸入 data：逐字依設定換。有換才回傳
pub fn assist_text(before: &[char], data: &str, p: &TypingPrefs) -> Option<Change> {
    let mut out: Vec<char> = Vec::new();
    let mut remove = 0usize;
    let mut changed = false;
    for c in data.chars() {
        let mut ctx = before[..before.len() - remove].to_vec();
        ctx.extend_from_slice(&out);
        match assist_char(&ctx, c, p) {
            None => out.push(c),
            Some(r) => {
                changed = true;
                let from_out = r.remove.min(out.len());
                out.truncate(out.len() - from_out);
                remove += r.remove - from_out;
                out.extend(r.text.chars());
            }
        }
    }
    changed.then(|| Change { text: out.into_iter().collect(), remove })
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: TypingPrefs = TypingPrefs { cjk_punct: true, en_punct: true, capitalize: true, spacing: true };
    fn go_p(before: &str, data: &str, p: TypingPrefs) -> Option<String> {
        let b: Vec<char> = before.chars().collect();
        assist_text(&b, data, &p).map(|r| r.text)
    }
    fn go(before: &str, data: &str) -> Option<String> {
        go_p(before, data, TypingPrefs::default())
    }
    fn s(x: &str) -> Option<String> {
        Some(x.into())
    }

    #[test]
    fn english_punct() {
        assert_eq!(go("Hello world", "，"), s(","));
        assert_eq!(go("It works", "。"), s("."));
        assert_eq!(go("call ", "（"), s("("));
        assert_eq!(go("say ", "「"), s("\""));
        assert_eq!(go("你好", "，"), None);
        assert_eq!(go("我在用 Banyan", "，"), None);
        assert_eq!(go("", "，"), None);
        assert_eq!(go("好的。Then we go", "，"), s(","));
    }

    #[test]
    fn capitalize() {
        assert_eq!(go("", "h"), s("H"));
        assert_eq!(go("第一行。\n", "h"), s("H"));
        assert_eq!(go("It works. ", "t"), s("T"));
        assert_eq!(go("Really? ", "y"), s("Y"));
        assert_eq!(go("It works", "t"), None);
        assert_eq!(go("For example, e.g. ", "t"), None);
        assert_eq!(go("Ask Mr. ", "s"), None);
        assert_eq!(go("Step 3. ", "t"), None);
        assert_eq!(go("好的. ", "t"), None);
        assert_eq!(go("example.", "c"), None);
        assert_eq!(go("so i", " "), s("I "));
        assert_eq!(go("i", "'"), s("I'"));
        assert_eq!(go("Hi", " "), None);
        assert_eq!(go("", "hello world. this is fine"), s("Hello world. This is fine"));
    }

    #[test]
    fn spacing() {
        assert_eq!(go_p("我用", "B", ALL), s(" B"));
        assert_eq!(go_p("用 Banyan", "寫", ALL), s(" 寫"));
        assert_eq!(go_p("第", "3", ALL), s(" 3"));
        assert_eq!(go_p("我用", "Banyan寫", ALL), s(" Banyan 寫"));
        assert_eq!(go_p("我用，", "B", ALL), None);
        assert_eq!(go_p("我用 ", "B", ALL), None);
        assert_eq!(go("我用", "B"), None);
    }

    #[test]
    fn cjk_punct_still() {
        assert_eq!(go("你好", ","), s("，"));
        assert_eq!(go_p("你好", ",", TypingPrefs { cjk_punct: false, ..Default::default() }), None);
        assert_eq!(go("你", ",他說\"今天(晴)\".."), s("，他說「今天（晴）」……"));
        assert_eq!(go("好。", "."), s("……"));
    }
}
