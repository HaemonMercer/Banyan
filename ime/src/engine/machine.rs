//! 輸入法的打字邏輯：一個按鍵進來要不要吃掉、吃掉後怎麼改文件、候選列顯示什麼。
//! 照 `src/editor/predictor.ts` 的 Banyan 輸入移植（中文模式打 a～y 是倉頡／速成的碼；空白、Enter、Tab
//! 選反白的字，1～9 選第幾個，左右鍵移動，上下鍵或 - = 換頁，Backspace 刪一碼，Esc 取消；打大寫字母暫時打英文），
//! 加上輔助打字（`typing.rs`）與字預測（`predict.rs`）。
//!
//! 文件操作經過 `Doc`（TSF 的實作在 `tsf/session.rs`，測試用字串），所以整個狀態機是可以測試的純邏輯。

use super::learn::Learned;
use super::predict::{
    Scheme, code_radicals, data, page_count, page_items, predict_after, predict_chars, predict_next, predict_words, word_after,
    word_before,
};
use super::typing::{TypingPrefs, assist_text};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Key {
    /// 會打出字的鍵（已經依鍵盤配置與 Shift 換成字）
    Char(char),
    Backspace,
    Escape,
    Enter,
    Tab,
    Left,
    Right,
    Up,
    Down,
    PageUp,
    PageDown,
    Home,
    End,
    Delete,
    Other,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct KeyEv {
    pub key: Key,
    pub shift: bool,
    pub ctrl: bool,
    pub alt: bool,
}

impl KeyEv {
    pub fn plain(key: Key) -> KeyEv {
        KeyEv { key, shift: false, ctrl: false, alt: false }
    }
}

/// 文件：游標前的文字、組字（顯示打了哪些字根）、送出
pub trait Doc {
    /// 游標前的文字（最多幾百字）；讀不到或有選取範圍時回傳 None
    fn before(&mut self) -> Option<Vec<char>>;
    /// 組字中的文字（字根）；還沒開始組字就開始
    fn compose(&mut self, text: &str);
    /// 結束組字，換成 text（沒在組字就直接插入）
    fn commit(&mut self, text: &str);
    /// 取消組字（組字中的字根拿掉）
    fn cancel(&mut self);
    /// 刪掉游標前 remove 個字，插入 text
    fn insert(&mut self, remove: usize, text: &str);
    /// 能不能刪掉游標前的字（舊程式經過 CUAS 時不能：只換不用刪字的）
    fn can_remove(&self) -> bool {
        true
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// 倉頡／速成候選字
    Ime,
    /// 英文補完
    Word,
    /// 英文的下一個字
    After,
    /// 聯想
    Next,
    /// 切換中／英、倉頡／速成時在游標下方閃一下
    Mode,
}

#[derive(Clone, Debug, PartialEq)]
pub struct List {
    pub kind: Kind,
    pub items: Vec<String>,
    pub sel: usize,
    /// 用左右鍵移動過（英文的下一個字要移動過 Enter 才選）
    pub moved: bool,
    /// 左邊的字（字根、「中」「英」）
    pub head: String,
    /// 第幾頁（`2/5`）
    pub page_info: Option<String>,
    /// 英文補完時正在打的字
    word: String,
}

impl List {
    fn new(kind: Kind, items: Vec<String>) -> List {
        List { kind, items, sel: 0, moved: false, head: String::new(), page_info: None, word: String::new() }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Prefs {
    pub scheme: Scheme,
    /// 英文補完與下一個字
    pub english: bool,
    /// 中文聯想
    pub follow: bool,
    pub typing: TypingPrefs,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs { scheme: Scheme::Cangjie, english: true, follow: true, typing: TypingPrefs::default() }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Act {
    Append(char),
    Back,
    Cancel,
    CommitSel,
    Commit(usize),
    Move(i32),
    Page(i32),
    Nop,
    CommitThenType(char),
    Upper(char),
    Pick(usize),
    Hide,
    Type(char),
    Undo,
}

struct Decision {
    act: Option<Act>,
    end_temp: bool,
}

pub struct Machine {
    pub prefs: Prefs,
    zh: bool,
    /// 中文模式裡暫時打英文（打了大寫字母），打完這個字回到中文
    temp: bool,
    code: String,
    all: Vec<String>,
    page: usize,
    list: Option<List>,
    /// 輔助打字剛換掉的字：緊接著按 Backspace 還原（刪幾個字, 換回什麼）
    undo: Option<(usize, String)>,
    pub learned: Learned,
}

impl Machine {
    pub fn new(prefs: Prefs, zh: bool, learned: Learned) -> Machine {
        Machine { prefs, zh, temp: false, code: String::new(), all: Vec::new(), page: 0, list: None, undo: None, learned }
    }

    pub fn zh(&self) -> bool {
        self.zh
    }
    pub fn temp(&self) -> bool {
        self.temp && self.zh
    }
    pub fn code(&self) -> &str {
        &self.code
    }
    pub fn list(&self) -> Option<&List> {
        self.list.as_ref()
    }

    fn decide(&self, ev: &KeyEv) -> Decision {
        let none = |end_temp| Decision { act: None, end_temp };
        let eat = |act, end_temp| Decision { act: Some(act), end_temp };
        if ev.ctrl || ev.alt {
            return none(false);
        }
        let k = ev.key;
        let mut end_temp = false;
        if self.zh && self.temp {
            // 暫時打英文：字母、數字照常打；空白、標點、Enter、Tab、移動游標、Esc 結束（那個鍵照常作用）
            end_temp = match k {
                Key::Char(c) => !(c.is_ascii_alphanumeric() || "'’-".contains(c)),
                Key::Backspace | Key::Other | Key::Delete => false,
                _ => true,
            };
        } else if self.zh {
            match k {
                Key::Char(c) if c.is_ascii_uppercase() => return eat(Act::Upper(c), false),
                Key::Char(c @ 'a'..='y') => return eat(Act::Append(c), false),
                _ => {}
            }
            if !self.code.is_empty() {
                let act = match k {
                    Key::Backspace => Act::Back,
                    Key::Escape => Act::Cancel,
                    Key::Char(' ') | Key::Enter | Key::Tab => Act::CommitSel,
                    Key::Right => Act::Move(1),
                    Key::Left => Act::Move(-1),
                    Key::Down | Key::PageDown | Key::Char('=') => Act::Page(1),
                    Key::Up | Key::PageUp | Key::Char('-') => Act::Page(-1),
                    Key::Char(d @ '1'..='9') => Act::Commit(d as usize - '1' as usize),
                    Key::Char(c) => Act::CommitThenType(c),
                    _ => Act::Nop,
                };
                return eat(act, false);
            }
        }
        if let Some(l) = self.list.as_ref().filter(|l| l.kind != Kind::Mode && l.kind != Kind::Ime) {
            match k {
                Key::Char(d @ '1'..='9') if !ev.shift && (d as usize - '1' as usize) < l.items.len() => {
                    return eat(Act::Pick(d as usize - '1' as usize), end_temp);
                }
                Key::Right => return eat(Act::Move(1), end_temp),
                Key::Left => return eat(Act::Move(-1), end_temp),
                Key::Enter if matches!(l.kind, Kind::Word | Kind::Next) || l.moved => return eat(Act::Pick(l.sel), end_temp),
                Key::Tab => return eat(Act::Pick(l.sel), end_temp),
                Key::Escape => return eat(Act::Hide, end_temp),
                _ => {}
            }
        }
        match k {
            // 字預測、輔助打字都關掉時，一般打字直接交給程式（不經過輸入法插入）
            Key::Char(c) if self.assists() => eat(Act::Type(c), end_temp),
            Key::Backspace if self.undo.is_some() => eat(Act::Undo, false),
            _ => none(end_temp),
        }
    }

    /// 這個鍵要不要吃掉（TSF 的 OnTestKeyDown；不改狀態）
    pub fn test(&self, ev: &KeyEv) -> bool {
        self.decide(ev).act.is_some()
    }

    /// 不吃的鍵：結束暫時英文、關掉候選列（游標可能移動了）
    pub fn pass(&mut self, ev: &KeyEv) {
        let d = self.decide(ev);
        if d.act.is_some() {
            return;
        }
        if d.end_temp {
            self.temp = false;
        }
        if !matches!(ev.key, Key::Other) || self.list.as_ref().is_some_and(|l| l.kind == Kind::Mode) {
            self.list = None;
        }
        self.undo = None;
    }

    /// 按鍵；回傳 true 表示吃掉了
    pub fn key(&mut self, ev: &KeyEv, doc: &mut dyn Doc) -> bool {
        let d = self.decide(ev);
        let Some(act) = d.act else {
            self.pass(ev);
            return false;
        };
        if d.end_temp {
            self.temp = false;
        }
        let undo = self.undo.take();
        match act {
            Act::Append(c) => {
                if self.code.chars().count() >= self.prefs.scheme.max_code() {
                    // 碼已經打滿還繼續打：先選反白的字，這個字母開始下一個字（連打）
                    self.commit_index(self.sel(), doc);
                }
                self.code.push(c);
                self.page = 0;
                self.show_ime(doc);
            }
            Act::Back => {
                self.code.pop();
                self.page = 0;
                if self.code.is_empty() {
                    self.reset_code();
                    doc.cancel();
                } else {
                    self.show_ime(doc);
                }
            }
            Act::Cancel => {
                self.reset_code();
                doc.cancel();
            }
            Act::CommitSel => self.commit_index(self.sel(), doc),
            Act::Commit(i) => {
                if i < page_items(&self.all, self.page).len() {
                    self.commit_index(i, doc);
                }
            }
            Act::Move(d) => self.move_sel(d),
            Act::Page(d) => {
                let next = self.page as i64 + d as i64;
                if next >= 0 && (next as usize) < page_count(self.all.len()) {
                    self.page = next as usize;
                    self.show_ime(doc);
                }
            }
            Act::Nop => {}
            Act::CommitThenType(c) => {
                self.commit_index(self.sel(), doc);
                self.type_char(c, doc);
            }
            Act::Upper(c) => {
                if !self.code.is_empty() {
                    self.commit_index(self.sel(), doc);
                }
                self.temp = true;
                self.type_char(c, doc);
            }
            Act::Pick(i) => self.pick(i, doc),
            Act::Hide => self.list = None,
            Act::Type(c) => self.type_char(c, doc),
            Act::Undo => {
                self.list = None;
                if let Some((n, text)) = undo {
                    doc.insert(n, &text);
                }
            }
        }
        true
    }

    /// 點了候選列的第 i 個
    pub fn click(&mut self, i: usize, doc: &mut dyn Doc) {
        self.undo = None;
        match self.list.as_ref().map(|l| l.kind) {
            Some(Kind::Ime) => self.commit_index(i, doc),
            Some(Kind::Mode) | None => {}
            Some(_) => self.pick(i, doc),
        }
    }

    /// 換頁（候選列上的 ‹ ›）
    pub fn turn_page(&mut self, d: i32, doc: &mut dyn Doc) {
        if !self.code.is_empty() {
            self.key(&KeyEv::plain(if d > 0 { Key::PageDown } else { Key::PageUp }), doc);
        }
    }

    /// 切換中／英（單獨按一下 Shift）：打到一半的碼不要了
    pub fn toggle(&mut self, doc: &mut dyn Doc) {
        self.zh = !self.zh;
        self.temp = false;
        self.drop_code(doc);
        self.flash(if self.zh { "中" } else { "英" });
    }

    /// 倉頡、速成互換（Alt＋`），同時切到中文
    pub fn switch_scheme(&mut self, doc: &mut dyn Doc) {
        self.prefs.scheme = match self.prefs.scheme {
            Scheme::Cangjie => Scheme::Quick,
            Scheme::Quick => Scheme::Cangjie,
        };
        self.zh = true;
        self.temp = false;
        self.drop_code(doc);
        self.flash(match self.prefs.scheme {
            Scheme::Cangjie => "倉頡",
            Scheme::Quick => "速成",
        });
    }

    /// 組字被 App 結束了（點了別的地方）、焦點換了：打到一半的碼與候選列都不要了
    pub fn reset(&mut self) {
        self.reset_code();
        self.list = None;
        self.undo = None;
    }

    pub fn hide(&mut self) {
        self.list = None;
    }

    /// 數字鍵正在用來選字（打到一半的碼、候選列開著）：Alt＋數字才直接打數字
    pub fn digits_pick(&self) -> bool {
        !self.code.is_empty() || self.list.as_ref().is_some_and(|l| l.kind != Kind::Mode)
    }

    /// Alt＋數字：直接打數字；打到一半的碼先選反白的字
    pub fn type_digit(&mut self, d: char, doc: &mut dyn Doc) {
        if !self.code.is_empty() {
            self.commit_index(self.sel(), doc);
        }
        self.list = None;
        self.undo = None;
        doc.insert(0, &d.to_string());
    }

    // ─── 內部 ───

    fn flash(&mut self, head: &str) {
        let mut l = List::new(Kind::Mode, Vec::new());
        l.head = head.to_string();
        self.list = Some(l);
    }

    fn drop_code(&mut self, doc: &mut dyn Doc) {
        if !self.code.is_empty() {
            self.reset_code();
            doc.cancel();
        }
    }

    /// 一般打字要不要經過輸入法（有任何預測或輔助打字開著）
    fn assists(&self) -> bool {
        let t = &self.prefs.typing;
        self.prefs.english || t.cjk_punct || t.en_punct || t.capitalize || t.spacing
    }

    fn sel(&self) -> usize {
        self.list.as_ref().filter(|l| l.kind == Kind::Ime).map_or(0, |l| l.sel)
    }

    fn reset_code(&mut self) {
        self.code.clear();
        self.all.clear();
        self.page = 0;
        if self.list.as_ref().is_some_and(|l| l.kind == Kind::Ime) {
            self.list = None;
        }
    }

    fn show_ime(&mut self, doc: &mut dyn Doc) {
        self.all = predict_chars(&data().chars, &self.code, self.prefs.scheme, 90);
        let pages = page_count(self.all.len());
        self.page = self.page.min(pages - 1);
        let mut l = List::new(Kind::Ime, page_items(&self.all, self.page));
        l.head = code_radicals(&self.code);
        l.page_info = (pages > 1).then(|| format!("{}/{}", self.page + 1, pages));
        doc.compose(&l.head);
        self.list = Some(l);
    }

    fn move_sel(&mut self, d: i32) {
        if let Some(l) = self.list.as_mut() {
            let n = l.items.len() as i32;
            if n > 0 {
                l.sel = (l.sel as i32 + d).rem_euclid(n) as usize;
                l.moved = true;
            }
        }
    }

    /// 選了這一頁第 i 個字：送出、聯想
    fn commit_index(&mut self, i: usize, doc: &mut dyn Doc) {
        let it = page_items(&self.all, self.page).get(i).cloned();
        self.reset_code();
        self.list = None;
        match it {
            Some(t) => {
                doc.commit(&t);
                self.follow(doc);
            }
            None => doc.cancel(),
        }
    }

    fn pick(&mut self, i: usize, doc: &mut dyn Doc) {
        let Some(l) = self.list.take() else { return };
        let Some(text) = l.items.get(i) else { return };
        match l.kind {
            Kind::Word => {
                // 補完的字開頭就是打的字（大小寫也跟著打的）：只插入後面的部分，不用刪字
                let n = l.word.chars().count();
                match text.strip_prefix(l.word.as_str()) {
                    Some(rest) => doc.insert(0, rest),
                    None => doc.insert(n, text),
                }
            }
            Kind::After => doc.insert(0, text),
            Kind::Next => {
                doc.insert(0, text);
                self.follow(doc);
            }
            Kind::Ime | Kind::Mode => {}
        }
    }

    /// 聯想：選好字後接下來可能打的字
    fn follow(&mut self, doc: &mut dyn Doc) {
        if !self.prefs.follow {
            return;
        }
        let Some(b) = doc.before() else { return };
        let items = predict_next(&data().phrases, &b, 9);
        if !items.is_empty() {
            self.list = Some(List::new(Kind::Next, items));
        }
    }

    /// 打一個字：輔助打字（換標點、大寫…），再預測英文
    fn type_char(&mut self, c: char, doc: &mut dyn Doc) {
        self.list = None;
        let Some(b) = doc.before() else {
            doc.insert(0, &c.to_string());
            return;
        };
        self.learned.observe(&b, c);
        let mut after = b.clone();
        let change = assist_text(&b, &c.to_string(), &self.prefs.typing).filter(|ch| ch.remove == 0 || doc.can_remove());
        match change {
            Some(ch) => {
                let removed: String = b[b.len() - ch.remove..].iter().collect();
                doc.insert(ch.remove, &ch.text);
                if doc.can_remove() {
                    self.undo = Some((ch.text.chars().count(), format!("{removed}{c}")));
                }
                after.truncate(after.len() - ch.remove);
                after.extend(ch.text.chars());
            }
            None => {
                doc.insert(0, &c.to_string());
                after.push(c);
            }
        }
        if self.prefs.english {
            self.predict_word(&after);
        }
    }

    /// 英文：正在打的字補完；打完一個字空一格，預測下一個字
    fn predict_word(&mut self, b: &[char]) {
        let d = data();
        if let Some(w) = word_before(b) {
            let items = predict_words(&d.english, &self.learned.words, &w, 5);
            if !items.is_empty() {
                let mut l = List::new(Kind::Word, items);
                l.word = w;
                self.list = Some(l);
            }
        } else if let Some(prev) = word_after(b) {
            let items = predict_after(&d.english_next, &self.learned.pairs, &prev, 5);
            if !items.is_empty() {
                self.list = Some(List::new(Kind::After, items));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 測試用文件：text 是已經送出的字，comp 是組字中的字（接在後面）
    #[derive(Default)]
    struct Fake {
        text: String,
        comp: Option<String>,
    }
    impl Doc for Fake {
        fn before(&mut self) -> Option<Vec<char>> {
            Some(self.text.chars().collect())
        }
        fn compose(&mut self, t: &str) {
            self.comp = Some(t.into());
        }
        fn commit(&mut self, t: &str) {
            self.comp = None;
            self.text += t;
        }
        fn cancel(&mut self) {
            self.comp = None;
        }
        fn insert(&mut self, remove: usize, t: &str) {
            let mut c: Vec<char> = self.text.chars().collect();
            c.truncate(c.len() - remove);
            self.text = c.into_iter().collect::<String>() + t;
        }
    }

    fn m() -> Machine {
        Machine::new(Prefs::default(), true, Learned::default())
    }
    fn typ(m: &mut Machine, d: &mut Fake, s: &str) {
        for c in s.chars() {
            let k = match c {
                ' ' => Key::Char(' '),
                '\n' => Key::Enter,
                '\t' => Key::Tab,
                '\u{8}' => Key::Backspace,
                '\u{1b}' => Key::Escape,
                c => Key::Char(c),
            };
            m.key(&KeyEv { key: k, shift: c.is_ascii_uppercase(), ctrl: false, alt: false }, d);
        }
    }

    #[test]
    fn cangjie_compose_and_commit() {
        let (mut m, mut d) = (m(), Fake::default());
        typ(&mut m, &mut d, "hqi");
        assert_eq!(d.comp.as_deref(), Some("竹手戈"));
        assert_eq!(m.list().unwrap().items[0], "我");
        typ(&mut m, &mut d, " ");
        assert_eq!(d.text, "我");
        assert_eq!(d.comp, None);
        // 聯想
        assert_eq!(m.list().unwrap().kind, Kind::Next);
    }

    #[test]
    fn digits_backspace_escape() {
        let (mut m, mut d) = (m(), Fake::default());
        typ(&mut m, &mut d, "a");
        let second = m.list().unwrap().items[1].clone();
        typ(&mut m, &mut d, "2");
        assert_eq!(d.text, second);
        let (mut m, mut d) = (self::m(), Fake::default());
        typ(&mut m, &mut d, "ab\u{8}");
        assert_eq!(d.comp.as_deref(), Some("日"));
        typ(&mut m, &mut d, "\u{8}");
        assert_eq!(d.comp, None);
        typ(&mut m, &mut d, "hq\u{1b}");
        assert_eq!(d.comp, None);
        assert_eq!(d.text, "");
    }

    #[test]
    fn punct_after_code_commits_and_converts() {
        let (mut m, mut d) = (m(), Fake::default());
        typ(&mut m, &mut d, "hqi,");
        assert_eq!(d.text, "我，");
    }

    #[test]
    fn quick_full_code_continues() {
        let mut m = Machine::new(Prefs { scheme: Scheme::Quick, ..Prefs::default() }, true, Learned::default());
        let mut d = Fake::default();
        typ(&mut m, &mut d, "hio");
        assert_eq!(d.text.chars().count(), 1);
        assert_eq!(m.code(), "o");
    }

    #[test]
    fn uppercase_types_english_until_space() {
        let (mut m, mut d) = (m(), Fake::default());
        typ(&mut m, &mut d, "Banyan");
        assert_eq!(d.text, "Banyan");
        assert!(m.temp());
        // 空白結束暫時英文；英文補完的候選列不會吃掉空白
        typ(&mut m, &mut d, "\u{1b} ");
        assert!(!m.temp());
        typ(&mut m, &mut d, "a");
        assert_eq!(d.comp.as_deref(), Some("日"));
    }

    #[test]
    fn english_mode_assist_and_predict() {
        let mut m = Machine::new(Prefs::default(), false, Learned::default());
        let mut d = Fake::default();
        typ(&mut m, &mut d, "beca");
        assert_eq!(d.text, "Beca");
        assert_eq!(m.list().unwrap().items[0], "Because");
        typ(&mut m, &mut d, "\t");
        assert_eq!(d.text, "Because");
        typ(&mut m, &mut d, " i");
        typ(&mut m, &mut d, "\u{1b} ");
        assert_eq!(d.text, "Because I ");
        // 剛換成大寫的 I：緊接著 Backspace 還原
        typ(&mut m, &mut d, "\u{8}");
        assert_eq!(d.text, "Because i ");
    }

    #[test]
    fn everything_off_passes_plain_typing() {
        let mut p = Prefs::default();
        crate::engine::options::Options { predict: false, assist: false, ..Default::default() }.apply(&mut p);
        let mut m = Machine::new(p, false, Learned::default());
        let mut d = Fake::default();
        // 英文模式的一般打字不吃（程式自己打）
        assert!(!m.test(&KeyEv::plain(Key::Char('h'))));
        assert!(!m.test(&KeyEv::plain(Key::Char(','))));
        // 中文：碼照常，選字後沒有聯想，標點不換
        let mut m = Machine::new(p, true, Learned::default());
        typ(&mut m, &mut d, "hqi ");
        assert_eq!(d.text, "我");
        assert!(m.list().is_none());
        assert!(!m.test(&KeyEv::plain(Key::Char(','))));
        typ(&mut m, &mut d, "hqi,");
        assert_eq!(d.text, "我我,");
    }

    #[test]
    fn shift_toggle_drops_code() {
        let (mut m, mut d) = (m(), Fake::default());
        typ(&mut m, &mut d, "hq");
        m.toggle(&mut d);
        assert!(!m.zh());
        assert_eq!(d.comp, None);
        assert_eq!(m.list().unwrap().head, "英");
        typ(&mut m, &mut d, "x");
        assert_eq!(d.text, "X");
    }

    #[test]
    fn test_matches_key() {
        let mut m = m();
        let mut d = Fake::default();
        for c in "hqi 1a,Hi there\u{8}\u{1b}\n".chars() {
            let k = match c {
                '\n' => Key::Enter,
                '\u{8}' => Key::Backspace,
                '\u{1b}' => Key::Escape,
                c => Key::Char(c),
            };
            let ev = KeyEv::plain(k);
            let t = m.test(&ev);
            assert_eq!(t, m.key(&ev, &mut d), "key {c:?}");
        }
    }
}
