//! 字預測：倉頡／速成候選字、聯想、英文補完與下一個字。照 `src/editor/predict.ts` 移植，規則要一起改。
//!
//! 資料和 App 用同一份（`src/editor/predict/`，`scripts/build-predict.mjs` 從 Rime 產生），編譯時嵌進 DLL。

use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scheme {
    Cangjie,
    Quick,
}

impl Scheme {
    /// 碼的最長長度：倉頡 5 碼、速成 2 碼
    pub fn max_code(self) -> usize {
        match self {
            Scheme::Cangjie => 5,
            Scheme::Quick => 2,
        }
    }
}

/// 候選字分頁：每頁 9 個（數字鍵 1～9）
pub const PAGE_SIZE: usize = 9;
pub fn page_count(n: usize) -> usize {
    n.div_ceil(PAGE_SIZE).max(1)
}
pub fn page_items<T: Clone>(items: &[T], page: usize) -> Vec<T> {
    items.iter().skip(page * PAGE_SIZE).take(PAGE_SIZE).cloned().collect()
}

/// 倉頡字母 a～y 的字根（x 是「難」）
pub const RADICALS: &str = "日月金木水火土竹戈十大中一弓人心手口尸廿山女田難卜";

/// 碼 → 字根
pub fn code_radicals(code: &str) -> String {
    let r: Vec<char> = RADICALS.chars().collect();
    code.chars()
        .map(|c| if ('a'..='y').contains(&c) { r[(c as u8 - b'a') as usize] } else { c })
        .collect()
}

/// 速成碼：倉頡碼的首碼＋尾碼
pub fn quick_code(code: &str) -> String {
    let c: Vec<char> = code.chars().collect();
    if c.len() <= 2 { code.to_string() } else { [c[0], c[c.len() - 1]].iter().collect() }
}

pub struct CharEntry {
    pub ch: String,
    pub code: String,
    /// 速成碼（先算好）
    pub quick: String,
}

pub struct Data {
    /// 依字頻由高到低
    pub chars: Vec<CharEntry>,
    /// 首字 → 以它開頭的詞（依詞頻由高到低）
    pub phrases: HashMap<char, Vec<String>>,
    /// 常用英文字（依常用程度），小寫
    pub english: Vec<String>,
    /// 內建的英文下一個字
    pub english_next: HashMap<String, Vec<String>>,
}

pub fn parse_chars(text: &str) -> Vec<CharEntry> {
    text.lines()
        .filter_map(|l| {
            let (ch, code) = l.split_once('\t')?;
            if ch.is_empty() {
                return None;
            }
            let code = code.trim().to_string();
            Some(CharEntry { ch: ch.to_string(), quick: quick_code(&code), code })
        })
        .collect()
}

pub fn parse_phrases(text: &str) -> HashMap<char, Vec<String>> {
    let mut out: HashMap<char, Vec<String>> = HashMap::new();
    for raw in text.lines() {
        let w = raw.trim();
        if let Some(first) = w.chars().next() {
            out.entry(first).or_default().push(w.to_string());
        }
    }
    out
}

pub fn parse_words(text: &str) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for raw in text.lines() {
        let w = raw.trim().to_lowercase();
        if !w.is_empty() && w.chars().all(|c| c.is_ascii_lowercase()) && seen.insert(w.clone()) {
            out.push(w);
        }
    }
    out
}

pub fn parse_next_words(text: &str) -> HashMap<String, Vec<String>> {
    let mut out = HashMap::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut it = line.split_whitespace();
        let w = it.next().unwrap().to_lowercase();
        out.insert(w, it.map(String::from).collect());
    }
    out
}

macro_rules! dict {
    ($f:literal) => {
        include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../src/editor/predict/", $f))
    };
}

static DATA: OnceLock<Data> = OnceLock::new();

/// 內建的資料（第一次用到時才解析）
pub fn data() -> &'static Data {
    DATA.get_or_init(|| Data {
        chars: parse_chars(dict!("cangjie.txt")),
        phrases: parse_phrases(dict!("phrases.txt")),
        english: parse_words(dict!("english.txt")),
        english_next: parse_next_words(dict!("english-next.txt")),
    })
}

/// 碼 → 候選字：完整符合的在前，其次是碼以它開頭的（各自依字頻）
pub fn predict_chars(chars: &[CharEntry], code: &str, scheme: Scheme, limit: usize) -> Vec<String> {
    let mut exact = Vec::new();
    let mut more = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for e in chars {
        let c = if scheme == Scheme::Quick { &e.quick } else { &e.code };
        if !c.starts_with(code) || seen.contains(e.ch.as_str()) {
            continue;
        }
        if c == code {
            seen.insert(e.ch.as_str());
            exact.push(e.ch.clone());
            if exact.len() >= limit {
                break;
            }
        } else if more.len() < limit {
            seen.insert(e.ch.as_str());
            more.push(e.ch.clone());
        }
    }
    exact.extend(more);
    exact.truncate(limit);
    exact
}

fn is_han(c: char) -> bool {
    matches!(c as u32, 0x3400..=0x9FFF | 0xF900..=0xFAFF)
}

/// 聯想：游標前的文字 → 接下來可能打的字（詞的其餘部分）；先用最後兩個字，再用最後一個字
pub fn predict_next(phrases: &HashMap<char, Vec<String>>, before: &[char], limit: usize) -> Vec<String> {
    let tail = &before[before.len().saturating_sub(2)..];
    let mut out: Vec<String> = Vec::new();
    let mut add = |stem: &[char]| {
        if stem.is_empty() || !stem.iter().all(|&c| is_han(c)) {
            return;
        }
        for w in phrases.get(&stem[0]).map(|v| v.as_slice()).unwrap_or(&[]) {
            if out.len() >= limit {
                return;
            }
            let wc: Vec<char> = w.chars().collect();
            if wc.len() <= stem.len() || !wc.starts_with(stem) {
                continue;
            }
            let rest: String = wc[stem.len()..].iter().collect();
            if !out.contains(&rest) {
                out.push(rest);
            }
        }
    };
    if tail.len() == 2 {
        add(tail);
    }
    if let Some(l) = tail.last() {
        add(std::slice::from_ref(l));
    }
    out
}

fn word_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '\''
}

/// 游標前面正在打的英文單字（一個字母以上，前面不能緊接數字或撇號）
pub fn word_before(b: &[char]) -> Option<String> {
    let n = b.iter().rev().take_while(|c| c.is_ascii_alphabetic()).count();
    if n == 0 {
        return None;
    }
    let start = b.len() - n;
    if start > 0 && word_char(b[start - 1]) {
        return None;
    }
    Some(b[start..].iter().collect())
}

/// 游標前面剛打完的英文字（後面空一格）：預測下一個字用；回傳小寫
pub fn word_after(b: &[char]) -> Option<String> {
    let (&' ', b) = b.split_last()? else { return None };
    let letters = |end: usize| b[..end].iter().rev().take_while(|c| c.is_ascii_alphabetic()).count();
    let n1 = letters(b.len());
    if n1 == 0 {
        return None;
    }
    let s1 = b.len() - n1;
    let ok = |start: usize| start == 0 || !word_char(b[start - 1]);
    // 有撇號：don't
    if s1 >= 2 && b[s1 - 1] == '\'' {
        let n0 = letters(s1 - 1);
        let s0 = s1 - 1 - n0;
        if n0 > 0 && ok(s0) {
            return Some(b[s0..].iter().collect::<String>().to_lowercase());
        }
    }
    ok(s1).then(|| b[s1..].iter().collect::<String>().to_lowercase())
}

/// 依分數排序（同分照加入的順序），取前 limit 個
fn ranked(score: Vec<(String, f64)>, limit: usize) -> Vec<String> {
    let mut s = score;
    s.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    s.into_iter().take(limit).map(|(w, _)| w).collect()
}

fn bump(score: &mut Vec<(String, f64)>, w: &str, n: f64) {
    match score.iter_mut().find(|(x, _)| x == w) {
        Some(e) => e.1 += n,
        None => score.push((w.to_string(), n)),
    }
}

/// 下一個字：使用者寫過的接法排前面（次數多的先），其次是內建的
pub fn predict_after(
    common: &HashMap<String, Vec<String>>,
    mine: &HashMap<String, Vec<(String, u32)>>,
    prev: &str,
    limit: usize,
) -> Vec<String> {
    let mut score: Vec<(String, f64)> = Vec::new();
    for (i, w) in common.get(prev).into_iter().flatten().enumerate() {
        bump(&mut score, w, 1.0 / (i as f64 + 10.0));
    }
    for (w, n) in mine.get(prev).into_iter().flatten() {
        bump(&mut score, w, *n as f64);
    }
    ranked(score, limit)
}

/// 英文補完：以 prefix 開頭、比它長的字。使用者打過兩次以上的字排前面，其次是常用字；大小寫跟著打的字
pub fn predict_words(common: &[String], mine: &HashMap<String, u32>, prefix: &str, limit: usize) -> Vec<String> {
    let p = prefix.to_lowercase();
    let mut score: Vec<(String, f64)> = Vec::new();
    for (i, w) in common.iter().enumerate() {
        if w.len() > p.len() && w.starts_with(&p) {
            score.push((w.clone(), 1.0 / (i as f64 + 10.0)));
        }
    }
    let mut mine: Vec<(&String, &u32)> = mine.iter().collect();
    mine.sort();
    for (w, &n) in mine {
        if n < 2 || w.len() <= p.len() || !w.starts_with(&p) {
            continue;
        }
        bump(&mut score, w, n as f64);
    }
    let upper = prefix.len() >= 2 && prefix == prefix.to_uppercase();
    let cap = prefix.chars().next().is_some_and(|c| c.is_ascii_uppercase());
    ranked(score, limit)
        .into_iter()
        .map(|w| {
            let w = format!("{prefix}{}", &w[p.len()..]);
            if upper {
                w.to_uppercase()
            } else if cap {
                let mut c = w.chars();
                c.next().map(|f| f.to_ascii_uppercase().to_string() + c.as_str()).unwrap_or_default()
            } else {
                w
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cs(s: &str) -> Vec<char> {
        s.chars().collect()
    }

    #[test]
    fn codes() {
        assert_eq!(quick_code("hqi"), "hi");
        assert_eq!(quick_code("ab"), "ab");
        assert_eq!(code_radicals("hqi"), "竹手戈");
        assert_eq!(Scheme::Cangjie.max_code(), 5);
        assert_eq!(page_count(0), 1);
        assert_eq!(page_count(10), 2);
    }

    #[test]
    fn chars() {
        let d = data();
        let got = predict_chars(&d.chars, "hqi", Scheme::Cangjie, 9);
        assert_eq!(got[0], "我");
        let a = predict_chars(&d.chars, "a", Scheme::Cangjie, 9);
        assert_eq!(a[0], "日");
        assert!(a.contains(&"是".to_string()));
        assert!(predict_chars(&d.chars, "hi", Scheme::Quick, 9).contains(&"我".to_string()));
        let h = predict_chars(&d.chars, "h", Scheme::Cangjie, 9);
        assert_eq!(h.len(), 9);
        let set: std::collections::HashSet<_> = h.iter().collect();
        assert_eq!(set.len(), 9);
    }

    #[test]
    fn next() {
        let d = data();
        assert!(predict_next(&d.phrases, &cs("我們明"), 9).contains(&"天".to_string()));
        let mut tiny = HashMap::new();
        tiny.insert('天', vec!["天氣".to_string(), "天空".to_string()]);
        tiny.insert('明', vec!["明天見".to_string()]);
        assert_eq!(predict_next(&tiny, &cs("明天"), 9), vec!["見", "氣", "空"]);
        assert!(predict_next(&d.phrases, &cs("hello"), 9).is_empty());
        assert!(predict_next(&d.phrases, &cs("，"), 9).is_empty());
    }

    #[test]
    fn words() {
        assert_eq!(word_before(&cs("I am wri")).as_deref(), Some("wri"));
        assert_eq!(word_before(&cs("x")).as_deref(), Some("x"));
        assert_eq!(word_before(&cs("I am ")), None);
        assert_eq!(word_before(&cs("中文ab")).as_deref(), Some("ab"));
        assert_eq!(word_before(&cs("abc1")), None);
        let d = data();
        assert_eq!(predict_words(&d.english, &HashMap::new(), "beca", 5)[0], "because");
        let mut mine = HashMap::new();
        mine.insert("banyan".to_string(), 3);
        mine.insert("bandwidth".to_string(), 1);
        assert_eq!(predict_words(&d.english, &mine, "ban", 5)[0], "banyan");
        assert_eq!(predict_words(&d.english, &mine, "Ban", 5)[0], "Banyan");
        assert_eq!(predict_words(&d.english, &mine, "BAN", 5)[0], "BANYAN");
        assert!(!predict_words(&d.english, &mine, "ban", 5).contains(&"bandwidth".to_string()));
    }

    #[test]
    fn after() {
        assert_eq!(word_after(&cs("I want ")).as_deref(), Some("want"));
        assert_eq!(word_after(&cs("I don't ")).as_deref(), Some("don't"));
        assert_eq!(word_after(&cs("I want")), None);
        assert_eq!(word_after(&cs("I want  ")), None);
        assert_eq!(word_after(&cs("end. ")), None);
        assert_eq!(word_after(&cs("page3 ")), None);
        let d = data();
        let none = HashMap::new();
        assert_eq!(predict_after(&d.english_next, &none, "want", 5)[0], "to");
        assert_eq!(predict_after(&d.english_next, &none, "thank", 5), vec!["you"]);
        assert!(predict_after(&d.english_next, &none, "zebra", 5).is_empty());
        let mut mine = HashMap::new();
        mine.insert("banyan".to_string(), vec![("notes".to_string(), 2), ("app".to_string(), 1)]);
        assert_eq!(predict_after(&d.english_next, &mine, "banyan", 5), vec!["notes", "app"]);
    }
}
