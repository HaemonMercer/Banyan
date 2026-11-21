//! Windows 的部分：TSF 文字服務（Text Input Processor）。
//!
//! - `dll`：DLL 進入點與 COM 類別工廠（`regsvr32` 呼叫 `DllRegisterServer`）。
//! - `register`：註冊 COM 類別、輸入法設定檔（中文（台灣））與 TSF 類別。
//! - `service`：文字服務本體與各種 sink（按鍵、焦點、組字、文字改變）。
//! - `session`：edit session 與 `Doc` 的 TSF 實作（讀游標前的字、組字、送出）。
//! - `window`：候選視窗（游標下方，樣子照 App 的預測列 `PredictBar.tsx`）。
//! - `keys`：虛擬鍵 → `KeyEv`。
//! - `config`：設定視窗（開關字預測與輔助打字）。
//! - `settings`：設定（登錄檔 `HKCU\Software\Banyan IME`）與記住的英文字。

/// 除錯紀錄：環境變數 `BANYAN_IME_LOG` 有設時寫到 `%TEMP%\banyan-ime.log`（裝好後在一般程式裡預設不寫）
pub(crate) fn log_line(s: &str) {
    use std::io::Write;
    use std::sync::OnceLock;
    static ON: OnceLock<bool> = OnceLock::new();
    if !*ON.get_or_init(|| std::env::var_os("BANYAN_IME_LOG").is_some()) {
        return;
    }
    let p = std::env::temp_dir().join("banyan-ime.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(p) {
        let _ = writeln!(f, "{s}");
    }
}

macro_rules! debug {
    ($($t:tt)*) => { $crate::tsf::log_line(&format!($($t)*)) };
}
pub(crate) use debug;

mod config;
pub mod dll;
mod keys;
mod register;
mod service;
mod session;
mod settings;
mod window;

use windows_core::GUID;

/// 文字服務的 COM 類別
pub const CLSID_BANYAN_IME: GUID = GUID::from_u128(0x77483fa4_b8bd_418a_85e7_90d56cf17ea4);
/// 輸入法設定檔（中文（台灣）下的「Banyan」）
pub const PROFILE_BANYAN_IME: GUID = GUID::from_u128(0xaf153006_e6d0_4fcc_a497_a2b082afab5e);
/// 保留的按鍵：Alt＋` 換倉頡／速成
pub const KEY_SCHEME: GUID = GUID::from_u128(0xa5f96d51_1e80_47fb_ba6c_8f9109302300);
/// 保留的按鍵：Alt＋0～9 直接打數字（`KEY_DIGIT_BASE + n`）
pub const KEY_DIGIT_BASE: u128 = 0xa5f96d51_1e80_47fb_ba6c_8f9109302310;

/// 中文（台灣）
pub const LANGID_ZH_TW: u16 = 0x0404;

