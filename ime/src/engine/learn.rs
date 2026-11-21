//! 使用者打過的英文字與接法：英文補完、下一個字排前面用（App 從日記、頁面算 `countWords`／`countPairs`，
//! 輸入法看不到文件，改成記住打過的字，存在 `%APPDATA%\Banyan IME\learned.tsv`）。

use std::collections::HashMap;

#[derive(Default)]
pub struct Learned {
    /// 小寫的字（四個字母以上）→ 次數
    pub words: HashMap<String, u32>,
    /// 前一個字（小寫）→ [(下一個字, 次數)]
    pub pairs: HashMap<String, Vec<(String, u32)>>,
    pub dirty: bool,
}

/// 結尾的英文字（可以有一個撇號，`don't`）的開頭位置
fn word_at_end(b: &[char]) -> Option<usize> {
    let letters = |end: usize| b[..end].iter().rev().take_while(|c| c.is_ascii_alphabetic()).count();
    let n1 = letters(b.len());
    if n1 == 0 {
        return None;
    }
    let s1 = b.len() - n1;
    if s1 >= 2 && b[s1 - 1] == '\'' {
        let n0 = letters(s1 - 1);
        if n0 > 0 {
            return Some(s1 - 1 - n0);
        }
    }
    Some(s1)
}

impl Learned {
    /// 在 before 後面打了 c：c 結束了一個英文字就記下它（以及它和前一個字的接法）
    pub fn observe(&mut self, before: &[char], c: char) {
        if c.is_ascii_alphanumeric() || c == '\'' {
            return;
        }
        let Some(s) = word_at_end(before) else { return };
        if s > 0 && before[s - 1].is_ascii_digit() {
            return;
        }
        let w: String = before[s..].iter().collect();
        if w.len() >= 4 && w.chars().all(|c| c.is_ascii_alphabetic()) {
            *self.words.entry(w.to_lowercase()).or_default() += 1;
            self.dirty = true;
        }
        let gap = before[..s].iter().rev().take_while(|&&c| c == ' ' || c == '\t').count();
        if gap == 0 {
            return;
        }
        let Some(ps) = word_at_end(&before[..s - gap]) else { return };
        let a: String = before[ps..s - gap].iter().collect::<String>().to_lowercase();
        let b = if w == "I" || w.starts_with("I'") { w } else { w.to_lowercase() };
        let list = self.pairs.entry(a).or_default();
        match list.iter_mut().find(|(x, _)| *x == b) {
            Some(e) => e.1 += 1,
            None => list.push((b, 1)),
        }
        self.dirty = true;
    }

    pub fn to_text(&self) -> String {
        let mut out = String::new();
        let mut words: Vec<_> = self.words.iter().collect();
        words.sort();
        for (w, n) in words {
            out += &format!("w\t{w}\t{n}\n");
        }
        let mut pairs: Vec<_> = self.pairs.iter().collect();
        pairs.sort_by(|a, b| a.0.cmp(b.0));
        for (a, list) in pairs {
            for (b, n) in list {
                out += &format!("p\t{a}\t{b}\t{n}\n");
            }
        }
        out
    }

    pub fn from_text(text: &str) -> Learned {
        let mut l = Learned::default();
        for line in text.lines() {
            let f: Vec<&str> = line.split('\t').collect();
            match f.as_slice() {
                ["w", w, n] => {
                    l.words.insert(w.to_string(), n.parse().unwrap_or(1));
                }
                ["p", a, b, n] => l.pairs.entry(a.to_string()).or_default().push((b.to_string(), n.parse().unwrap_or(1))),
                _ => {}
            }
        }
        l
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(l: &mut Learned, text: &str) {
        let cs: Vec<char> = text.chars().collect();
        for i in 0..cs.len() {
            l.observe(&cs[..i], cs[i]);
        }
    }

    #[test]
    fn learns_words_and_pairs() {
        let mut l = Learned::default();
        feed(&mut l, "Banyan notes are local. banyan notes, so I said ");
        assert_eq!(l.words.get("banyan"), Some(&2));
        assert_eq!(l.words.get("are"), None);
        assert_eq!(l.pairs.get("banyan").unwrap()[0], ("notes".to_string(), 2));
        assert_eq!(l.pairs.get("so").unwrap()[0].0, "I");
        let back = Learned::from_text(&l.to_text());
        assert_eq!(back.words, l.words);
        assert_eq!(back.pairs.get("banyan"), l.pairs.get("banyan"));
    }
}
