//! DLL 進入點：`DllMain` 記住模組、`DllGetClassObject` 給 TSF 建立文字服務、`DllRegisterServer`／
//! `DllUnregisterServer` 給 `regsvr32`（`install.ps1`）註冊。

use std::ffi::c_void;
use std::sync::atomic::{AtomicIsize, Ordering};

use windows::Win32::Foundation::{CLASS_E_CLASSNOTAVAILABLE, CLASS_E_NOAGGREGATION, E_POINTER, HINSTANCE, S_FALSE, S_OK};
use windows::Win32::System::Com::{IClassFactory, IClassFactory_Impl};
use windows::Win32::System::LibraryLoader::DisableThreadLibraryCalls;
use windows::Win32::System::SystemServices::DLL_PROCESS_ATTACH;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::HiDpi::{DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, SetThreadDpiAwarenessContext};
use windows_core::{BOOL, GUID, HRESULT, IUnknown, Interface, PCSTR, Ref, implement};

use super::CLSID_BANYAN_IME;
use super::service::TextService;

static MODULE: AtomicIsize = AtomicIsize::new(0);

/// 這個 DLL 的模組（視窗類別、圖示、註冊路徑用）
pub(crate) fn module() -> HINSTANCE {
    HINSTANCE(MODULE.load(Ordering::Relaxed) as *mut c_void)
}

#[unsafe(no_mangle)]
extern "system" fn DllMain(inst: HINSTANCE, reason: u32, _reserved: *mut c_void) -> BOOL {
    if reason == DLL_PROCESS_ATTACH {
        MODULE.store(inst.0 as isize, Ordering::Relaxed);
        unsafe {
            let _ = DisableThreadLibraryCalls(inst.into());
        }
    }
    true.into()
}

#[implement(IClassFactory)]
struct Factory;

impl IClassFactory_Impl for Factory_Impl {
    fn CreateInstance(&self, outer: Ref<IUnknown>, riid: *const GUID, ppv: *mut *mut c_void) -> windows_core::Result<()> {
        if ppv.is_null() {
            return Err(E_POINTER.into());
        }
        unsafe { *ppv = std::ptr::null_mut() };
        if !outer.is_null() {
            return Err(CLASS_E_NOAGGREGATION.into());
        }
        let svc: IUnknown = TextService::new().into();
        unsafe { svc.query(riid, ppv).ok() }
    }

    fn LockServer(&self, _lock: BOOL) -> windows_core::Result<()> {
        Ok(())
    }
}

#[unsafe(no_mangle)]
extern "system" fn DllGetClassObject(rclsid: *const GUID, riid: *const GUID, ppv: *mut *mut c_void) -> HRESULT {
    if ppv.is_null() || rclsid.is_null() {
        return E_POINTER;
    }
    unsafe { *ppv = std::ptr::null_mut() };
    if unsafe { *rclsid } != CLSID_BANYAN_IME {
        return CLASS_E_CLASSNOTAVAILABLE;
    }
    let f: IClassFactory = Factory.into();
    unsafe { f.query(riid, ppv) }
}

/// 文字服務可能還在某個執行緒上用（TSF 自己管），一律不卸載
#[unsafe(no_mangle)]
extern "system" fn DllCanUnloadNow() -> HRESULT {
    S_FALSE
}

#[unsafe(no_mangle)]
extern "system" fn DllRegisterServer() -> HRESULT {
    match super::register::register() {
        Ok(()) => S_OK,
        Err(e) => {
            let _ = super::register::unregister();
            e.code()
        }
    }
}

#[unsafe(no_mangle)]
extern "system" fn DllUnregisterServer() -> HRESULT {
    match super::register::unregister() {
        Ok(()) => S_OK,
        Err(e) => e.code(),
    }
}

/// 設定視窗：`rundll32.exe "…\banyan_ime.dll",Settings`（開始功能表的捷徑、候選列的右鍵）
#[unsafe(no_mangle)]
extern "system" fn Settings(_hwnd: HWND, _inst: HINSTANCE, _cmd: PCSTR, _show: i32) {
    unsafe {
        // rundll32 預設不認 DPI，字會糊
        SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
    super::config::show(None);
}

/// 另開一個 rundll32 打開設定視窗（不要在別的程式的執行緒裡跑自己的訊息迴圈）
pub(crate) fn open_settings() {
    let dll = String::from_utf16_lossy(&super::register::dll_path());
    let sys = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
    let _ = std::process::Command::new(format!(r"{sys}\System32\rundll32.exe")).arg(format!("{dll},Settings")).spawn();
}
