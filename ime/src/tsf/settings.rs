//! 設定存在登錄檔 `HKCU\Software\Banyan IME`（DWORD，0／1）：
//!
//! | 名稱 | 預設 | |
//! |---|---|---|
//! | `Chinese` | 1 | 開始時是中文（Shift 切換後記住） |
//! | `Quick` | 0 | 1＝速成、0＝倉頡（Alt＋` 切換後記住） |
//! | `Predict` | 1 | 字預測的總開關（關掉時下面兩項都不作用） |
//! | `English` | 1 | 英文補完與下一個字 |
//! | `Follow` | 1 | 中文聯想 |
//! | `Assist` | 1 | 輔助打字的總開關（關掉時下面四項都不作用） |
//! | `CjkPunct` | 1 | 中文句子裡的半形標點換成中文標點 |
//! | `EnPunct` | 1 | 英文句子裡的中文標點換成半形 |
//! | `Capitalize` | 1 | 英文句首大寫、單獨的 i 換成 I |
//! | `Spacing` | 0 | 中英之間加空格 |
//!
//! 設定視窗（`config.rs`）改前面八項；改完回到程式（焦點改變）時重新讀。
//!
//! 記住的英文字在 `%APPDATA%\Banyan IME\learned.tsv`。

use std::path::PathBuf;

use windows::Win32::System::Registry::{HKEY_CURRENT_USER, REG_DWORD, RRF_RT_REG_DWORD, RegGetValueW, RegSetKeyValueW};
use windows_core::{HSTRING, w};

use crate::engine::learn::Learned;
use crate::engine::machine::Prefs;
use crate::engine::predict::Scheme;
use crate::engine::options::{FIELDS, Options};

const KEY: windows_core::PCWSTR = w!("Software\\Banyan IME");

fn get(name: &str, default: bool) -> bool {
    let mut v: u32 = 0;
    let mut size = 4u32;
    let r = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            KEY,
            &HSTRING::from(name),
            RRF_RT_REG_DWORD,
            None,
            Some(&mut v as *mut u32 as *mut _),
            Some(&mut size),
        )
    };
    if r.is_ok() { v != 0 } else { default }
}

fn set(name: &str, on: bool) {
    let v: u32 = on.into();
    unsafe {
        let _ = RegSetKeyValueW(HKEY_CURRENT_USER, KEY, &HSTRING::from(name), REG_DWORD.0, Some(&v as *const u32 as *const _), 4);
    }
}

/// 使用者的開關（設定視窗改的）
pub fn load_options() -> Options {
    let def = Options::default();
    let mut o = def;
    for (name, f) in FIELDS {
        let d = *f(&mut def.clone());
        *f(&mut o) = get(name, d);
    }
    o
}

pub fn save_options(o: &Options) {
    let mut o = *o;
    for (name, f) in FIELDS {
        set(name, *f(&mut o));
    }
}

/// Machine 用的設定與開始時是不是中文
pub fn load() -> (Prefs, bool) {
    let mut prefs = Prefs {
        scheme: if get("Quick", false) { Scheme::Quick } else { Scheme::Cangjie },
        ..Prefs::default()
    };
    load_options().apply(&mut prefs);
    (prefs, get("Chinese", true))
}

/// 記住中／英與倉頡／速成
pub fn save_mode(zh: bool, scheme: Scheme) {
    set("Chinese", zh);
    set("Quick", scheme == Scheme::Quick);
}

fn learned_path() -> Option<PathBuf> {
    let dir = PathBuf::from(std::env::var_os("APPDATA")?).join("Banyan IME");
    Some(dir.join("learned.tsv"))
}

pub fn load_learned() -> Learned {
    learned_path().and_then(|p| std::fs::read_to_string(p).ok()).map(|t| Learned::from_text(&t)).unwrap_or_default()
}

pub fn save_learned(l: &mut Learned) {
    if !l.dirty {
        return;
    }
    let Some(p) = learned_path() else { return };
    if let Some(dir) = p.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    // 好幾個程式同時開著時各自記，存檔時先和檔案裡的合併（取比較大的次數）
    let mut merged = std::fs::read_to_string(&p).map(|t| Learned::from_text(&t)).unwrap_or_default();
    for (w, n) in &l.words {
        let e = merged.words.entry(w.clone()).or_default();
        *e = (*e).max(*n);
    }
    for (a, list) in &l.pairs {
        let m = merged.pairs.entry(a.clone()).or_default();
        for (b, n) in list {
            match m.iter_mut().find(|(x, _)| x == b) {
                Some(e) => e.1 = e.1.max(*n),
                None => m.push((b.clone(), *n)),
            }
        }
    }
    let tmp = p.with_extension("tmp");
    if std::fs::write(&tmp, merged.to_text()).is_ok() && std::fs::rename(&tmp, &p).is_ok() {
        l.words = merged.words;
        l.pairs = merged.pairs;
        l.dirty = false;
    }
}
