//! 使用者可以開關的功能：兩個總開關（字預測、輔助打字），各自底下有細項。
//! 存在登錄檔（`tsf/settings.rs`），設定視窗（`tsf/config.rs`）改的就是這些；`apply` 算出 `Machine` 實際用的 `Prefs`。

use super::machine::Prefs;
use super::typing::TypingPrefs;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Options {
    /// 字預測（總開關）
    pub predict: bool,
    /// 英文補完與下一個字
    pub english: bool,
    /// 中文聯想
    pub follow: bool,
    /// 輔助打字（總開關）
    pub assist: bool,
    pub cjk_punct: bool,
    pub en_punct: bool,
    pub capitalize: bool,
    pub spacing: bool,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            predict: true,
            english: true,
            follow: true,
            assist: true,
            cjk_punct: true,
            en_punct: true,
            capitalize: true,
            spacing: false,
        }
    }
}

/// 每個開關：登錄檔的名稱、讀寫哪一個欄位
pub type Field = (&'static str, fn(&mut Options) -> &mut bool);

pub const FIELDS: [Field; 8] = [
    ("Predict", |o| &mut o.predict),
    ("English", |o| &mut o.english),
    ("Follow", |o| &mut o.follow),
    ("Assist", |o| &mut o.assist),
    ("CjkPunct", |o| &mut o.cjk_punct),
    ("EnPunct", |o| &mut o.en_punct),
    ("Capitalize", |o| &mut o.capitalize),
    ("Spacing", |o| &mut o.spacing),
];

impl Options {
    /// 總開關關掉時，底下的細項都不作用（細項本身的設定留著，再打開總開關就回來）
    pub fn apply(&self, p: &mut Prefs) {
        p.english = self.predict && self.english;
        p.follow = self.predict && self.follow;
        let a = self.assist;
        p.typing = TypingPrefs {
            cjk_punct: a && self.cjk_punct,
            en_punct: a && self.en_punct,
            capitalize: a && self.capitalize,
            spacing: a && self.spacing,
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masters_turn_off_children() {
        let mut p = Prefs::default();
        let o = Options { predict: false, assist: false, ..Options::default() };
        o.apply(&mut p);
        assert!(!p.english && !p.follow);
        assert_eq!(p.typing, TypingPrefs { cjk_punct: false, en_punct: false, capitalize: false, spacing: false });
        let o = Options { follow: false, spacing: true, ..Options::default() };
        o.apply(&mut p);
        assert!(p.english && !p.follow);
        assert!(p.typing.spacing && p.typing.cjk_punct);
    }

    #[test]
    fn fields_cover_every_switch() {
        let mut o = Options::default();
        for (_, f) in FIELDS {
            *f(&mut o) = false;
        }
        assert_eq!(
            o,
            Options {
                predict: false,
                english: false,
                follow: false,
                assist: false,
                cjk_punct: false,
                en_punct: false,
                capitalize: false,
                spacing: false
            }
        );
    }
}
