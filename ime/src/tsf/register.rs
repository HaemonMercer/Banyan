//! 註冊：COM 類別（`HKLM\Software\Classes\CLSID\{…}`）、TSF 的輸入法設定檔與類別。要系統管理員權限。

use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, MAX_PATH};
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
};
use windows::Win32::System::LibraryLoader::GetModuleFileNameW;
use windows::Win32::System::Registry::{HKEY_LOCAL_MACHINE, REG_SZ, RegDeleteTreeW, RegSetKeyValueW};
use windows::Win32::UI::Input::KeyboardAndMouse::HKL;
use windows::Win32::UI::TextServices::{
    CLSID_TF_CategoryMgr, CLSID_TF_InputProcessorProfiles, GUID_TFCAT_TIP_KEYBOARD, GUID_TFCAT_TIPCAP_IMMERSIVESUPPORT,
    GUID_TFCAT_TIPCAP_SYSTRAYSUPPORT, ITfCategoryMgr, ITfInputProcessorProfileMgr,
};
use windows_core::{GUID, HSTRING, PCWSTR};

use super::dll::module;
use super::{CLSID_BANYAN_IME, LANGID_ZH_TW, PROFILE_BANYAN_IME};

/// 輸入法清單上的名稱
const NAME: &str = "Banyan";

const CATEGORIES: [GUID; 3] = [GUID_TFCAT_TIP_KEYBOARD, GUID_TFCAT_TIPCAP_IMMERSIVESUPPORT, GUID_TFCAT_TIPCAP_SYSTRAYSUPPORT];

fn clsid_key() -> String {
    format!("Software\\Classes\\CLSID\\{{{:?}}}", CLSID_BANYAN_IME)
}

/// 這個 DLL 的完整路徑（UTF-16，沒有結尾的 0）
pub(crate) fn dll_path() -> Vec<u16> {
    let mut buf = vec![0u16; MAX_PATH as usize * 4];
    let n = unsafe { GetModuleFileNameW(Some(module().into()), &mut buf) } as usize;
    buf.truncate(n);
    buf
}

/// COM 要在這個執行緒初始化（regsvr32 多半已經做了，重複初始化沒關係）
struct Com(bool);
impl Com {
    fn init() -> Com {
        Com(unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.is_ok())
    }
}
impl Drop for Com {
    fn drop(&mut self) {
        if self.0 {
            unsafe { CoUninitialize() };
        }
    }
}

fn set_sz(key: &str, name: Option<&str>, value: &[u16]) -> windows_core::Result<()> {
    let mut v = value.to_vec();
    v.push(0);
    let bytes = unsafe { std::slice::from_raw_parts(v.as_ptr() as *const u8, v.len() * 2) };
    let name = name.map(HSTRING::from);
    unsafe {
        RegSetKeyValueW(
            HKEY_LOCAL_MACHINE,
            &HSTRING::from(key),
            name.as_ref().map_or(PCWSTR::null(), |n| PCWSTR(n.as_ptr())),
            REG_SZ.0,
            Some(bytes.as_ptr() as *const _),
            bytes.len() as u32,
        )
        .ok()
    }
}

pub fn register() -> windows_core::Result<()> {
    let _com = Com::init();
    let path = dll_path();
    let key = clsid_key();
    let name: Vec<u16> = NAME.encode_utf16().collect();
    set_sz(&key, None, &name)?;
    set_sz(&format!("{key}\\InprocServer32"), None, &path)?;
    set_sz(&format!("{key}\\InprocServer32"), Some("ThreadingModel"), &"Apartment".encode_utf16().collect::<Vec<_>>())?;
    unsafe {
        let profiles: ITfInputProcessorProfileMgr = CoCreateInstance(&CLSID_TF_InputProcessorProfiles, None, CLSCTX_INPROC_SERVER)?;
        profiles.RegisterProfile(
            &CLSID_BANYAN_IME,
            LANGID_ZH_TW,
            &PROFILE_BANYAN_IME,
            &name,
            &path,
            0,
            HKL::default(),
            0,
            true,
            0,
        )?;
        let cats: ITfCategoryMgr = CoCreateInstance(&CLSID_TF_CategoryMgr, None, CLSCTX_INPROC_SERVER)?;
        for c in CATEGORIES {
            cats.RegisterCategory(&CLSID_BANYAN_IME, &c, &CLSID_BANYAN_IME)?;
        }
    }
    Ok(())
}

pub fn unregister() -> windows_core::Result<()> {
    let _com = Com::init();
    unsafe {
        if let Ok(profiles) =
            CoCreateInstance::<_, ITfInputProcessorProfileMgr>(&CLSID_TF_InputProcessorProfiles, None, CLSCTX_INPROC_SERVER)
        {
            let _ = profiles.UnregisterProfile(&CLSID_BANYAN_IME, LANGID_ZH_TW, &PROFILE_BANYAN_IME, 0);
        }
        if let Ok(cats) = CoCreateInstance::<_, ITfCategoryMgr>(&CLSID_TF_CategoryMgr, None, CLSCTX_INPROC_SERVER) {
            for c in CATEGORIES {
                let _ = cats.UnregisterCategory(&CLSID_BANYAN_IME, &c, &CLSID_BANYAN_IME);
            }
        }
        let r = RegDeleteTreeW(HKEY_LOCAL_MACHINE, &HSTRING::from(clsid_key()));
        if r.is_err() && r != ERROR_FILE_NOT_FOUND {
            return r.ok();
        }
    }
    Ok(())
}
