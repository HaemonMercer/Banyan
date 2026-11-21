//! 中文標點：正在打中文時，半形標點換成中文（全形）標點。照 `src/editor/punct.ts` 移植，規則要一起改。
//!
//! 所有函式拿「游標前面的文字」（`&[char]`），回傳要換成什麼；`remove` 是先刪掉游標前幾個字。

/// 中文字或中文標點（漢字、注音、假名、CJK 標點、全形字元）
pub fn is_cjk(c: Option<char>) -> bool {
    matches!(c, Some(c) if matches!(c as u32,
        0x3000..=0x303F | 0x3040..=0x30FF | 0x3100..=0x312F | 0x31A0..=0x31BF |
        0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF | 0xFF00..=0xFFEF))
}

pub(crate) fn last(b: &[char]) -> Option<char> {
    b.last().copied()
}

/// 中文的句尾：後面接的是新的一句
fn cjk_end(c: char) -> bool {
    matches!(c, '。' | '！' | '？' | '…')
}

/// 游標前面正在打的這句是不是中文（中文夾英文也算，見 `punct.ts` 的 `inChinese`）
pub fn in_chinese(b: &[char]) -> bool {
    if is_cjk(last(b)) {
        return true;
    }
    let mut n = 0;
    for i in (0..b.len()).rev() {
        if n >= 300 {
            break;
        }
        n += 1;
        let c = b[i];
        if c == '\n' || cjk_end(c) {
            return false;
        }
        if matches!(c, '.' | '!' | '?') && b.get(i + 1).is_some_and(|n| n.is_whitespace()) {
            return false;
        }
        if is_cjk(Some(c)) {
            return true;
        }
    }
    false
}

/// 游標前面這個「字」像網址、路徑、Email：不換
fn in_tech_word(b: &[char]) -> bool {
    let start = b.iter().rposition(|c| c.is_whitespace()).map_or(0, |i| i + 1);
    let word: String = b[start..].iter().collect();
    if word.contains(['/', '@', '\\']) || word.contains(":/") {
        return true;
    }
    let w = word.to_ascii_lowercase();
    matches!(w.as_str(), "http" | "https" | "ftp" | "mailto" | "file" | "www")
}

fn simple(key: char) -> Option<char> {
    Some(match key {
        ',' => '，',
        '.' => '。',
        '?' => '？',
        '!' => '！',
        ':' => '：',
        ';' => '；',
        _ => return None,
    })
}

/// 成對的：(開, 關, 開的鍵, 關的鍵)
const PAIRS: [(char, char, char, char); 3] = [('（', '）', '(', ')'), ('「', '」', '"', '"'), ('『', '』', '\'', '\'')];

fn unclosed(b: &[char], open: char, close: char) -> bool {
    match b.iter().rposition(|&c| c == open) {
        Some(o) => !b[o..].contains(&close),
        None => false,
    }
}

fn line_of(b: &[char]) -> &[char] {
    let s = b.iter().rposition(|&c| c == '\n').map_or(0, |i| i + 1);
    &b[s..]
}

fn find_seq(hay: &[char], pat: &[char]) -> Option<usize> {
    if hay.len() < pat.len() {
        return None;
    }
    (0..=hay.len() - pat.len()).rev().find(|&i| &hay[i..i + pat.len()] == pat)
}

/// 游標在正在打的 Markdown 語法裡面（跳脫、行內程式碼、連結網址、HTML 標籤）：標點是語法的一部分，不換
pub fn in_markdown_syntax(b: &[char]) -> bool {
    if last(b) == Some('\\') {
        return true;
    }
    let line = line_of(b);
    if line.iter().filter(|&&c| c == '`').count() % 2 == 1 {
        return true;
    }
    if let Some(link) = find_seq(line, &[']', '(']) {
        if !line[link + 2..].contains(&')') {
            return true;
        }
    }
    if let Some(lt) = line.iter().rposition(|&c| c == '<') {
        let next = line.get(lt + 1);
        if next.is_some_and(|c| c.is_ascii_alphabetic() || *c == '/' || *c == '!') && !line[lt + 1..].contains(&'>') {
            return true;
        }
    }
    false
}

/// 會被轉換的鍵（`[` 只用來把 `！[` 改回圖片語法 `![`）
pub fn is_punct_key(c: char) -> bool {
    simple(c).is_some() || matches!(c, '(' | ')' | '"' | '\'' | '[')
}

/// 在 b 後面打 key：要換成什麼（文字, 先刪幾個字）
pub fn cjk_punct(b: &[char], key: char) -> Option<(String, usize)> {
    let prev = last(b);
    if in_markdown_syntax(b) {
        return None;
    }
    if key == '[' {
        return (prev == Some('！')).then(|| ("![".to_string(), 1));
    }
    if prev.is_some_and(|c| c.is_ascii_digit()) && matches!(key, '.' | ',' | ':') {
        return None;
    }
    let cjk = in_chinese(b) && (is_cjk(prev) || !in_tech_word(b));
    if key == '.' {
        if prev == Some('。') {
            return Some(("……".into(), 1));
        }
        return cjk.then(|| ("。".into(), 0));
    }
    if let Some(s) = simple(key) {
        return cjk.then(|| (s.to_string(), 0));
    }
    let open_ok = is_cjk(prev) || (cjk && prev.is_some_and(|c| c.is_whitespace()));
    for (open, close, ko, kc) in PAIRS {
        if key != ko && key != kc {
            continue;
        }
        let is_open = unclosed(b, open, close);
        if key == kc && is_open {
            return Some((close.to_string(), 0));
        }
        if key == ko && open_ok && (ko != kc || !is_open) {
            return Some((open.to_string(), 0));
        }
        return None;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(before: &str, key: char) -> Option<String> {
        let b: Vec<char> = before.chars().collect();
        cjk_punct(&b, key).map(|r| r.0)
    }
    fn s(x: &str) -> Option<String> {
        Some(x.to_string())
    }

    #[test]
    fn after_chinese_only() {
        assert_eq!(t("你好", ','), s("，"));
        assert_eq!(t("你好", '.'), s("。"));
        assert_eq!(t("真的", '?'), s("？"));
        assert_eq!(t("如下", ':'), s("："));
        assert_eq!(t("hello", ','), None);
        assert_eq!(t("1", '.'), None);
        assert_eq!(t("", ','), None);
        assert_eq!(t("好，", '('), s("（"));
    }

    #[test]
    fn ellipsis_pairs_quotes() {
        let b: Vec<char> = "然後。".chars().collect();
        assert_eq!(cjk_punct(&b, '.'), Some(("……".into(), 1)));
        assert_eq!(t("備註（abc", ')'), s("）"));
        assert_eq!(t("備註", ')'), None);
        assert_eq!(t("（a）b中", ')'), None);
        assert_eq!(t("他說", '"'), s("「"));
        assert_eq!(t("他說「ok", '"'), s("」"));
        assert_eq!(t("「好」中", '"'), s("「"));
        assert_eq!(t("『書名", '\''), s("』"));
        assert_eq!(t("abc", '"'), None);
    }

    #[test]
    fn markdown_and_tech() {
        assert_eq!(t("你好\\", '.'), None);
        assert_eq!(t("執行 `a", ','), None);
        assert_eq!(t("執行 `a,b` 之後", ','), s("，"));
        assert_eq!(t("看[說明](https://a", '.'), None);
        assert_eq!(t("看[說明](a.md)了", ','), s("，"));
        assert_eq!(t("文字<span style=", '"'), None);
        assert_eq!(t("文字<b>粗</b>好", ','), s("，"));
        assert_eq!(t("網址 https", ':'), None);
        assert_eq!(t("寄到 me@mail", '.'), None);
        assert_eq!(t("在 src/editor", '.'), None);
    }

    #[test]
    fn mixed_sentences() {
        assert_eq!(t("我在用 Banyan", ','), s("，"));
        assert_eq!(t("你好 ", ','), s("，"));
        assert_eq!(t("版本 v1.2 很好用，我推薦 Banyan", '!'), s("！"));
        assert_eq!(t("Hello world", ','), None);
        assert_eq!(t("好。Hello world", ','), None);
        assert_eq!(t("我說 Hi. Then", ','), None);
        assert_eq!(t("第一行\nHello", ','), None);
        assert_eq!(t("價格 3", '.'), None);
        assert_eq!(t("第 3", '?'), s("？"));
        assert_eq!(t("我覺得 it", '\''), None);
        assert_eq!(t("函式 f", '('), None);
        assert_eq!(t("他說 ", '"'), s("「"));
    }
}
