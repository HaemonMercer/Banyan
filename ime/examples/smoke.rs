//! 不註冊也能跑的冒煙測試：載入編譯好的 DLL，經過 COM 類別工廠建立文字服務，
//! 在真的 TSF thread manager 上啟用、停用兩次。
//!
//! ```powershell
//! cargo build --release; cargo run --release --example smoke
//! ```

#[cfg(windows)]
fn main() -> windows_core::Result<()> {
    use std::ffi::c_void;
    use windows::Win32::System::Com::{
        CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx, IClassFactory,
    };
    use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
    use windows::Win32::UI::TextServices::{CLSID_TF_ThreadMgr, ITfClientId, ITfTextInputProcessorEx, ITfThreadMgr};
    use windows_core::{GUID, HRESULT, HSTRING, Interface, s};

    const CLSID: GUID = GUID::from_u128(0x77483fa4_b8bd_418a_85e7_90d56cf17ea4);
    type GetClassObject = unsafe extern "system" fn(*const GUID, *const GUID, *mut *mut c_void) -> HRESULT;

    let dll = std::env::current_exe().unwrap().parent().unwrap().parent().unwrap().join("banyan_ime.dll");
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
        let m = LoadLibraryW(&HSTRING::from(dll.as_os_str()))?;
        let f: GetClassObject = std::mem::transmute(GetProcAddress(m, s!("DllGetClassObject")).expect("export"));
        let mut p = std::ptr::null_mut();
        f(&CLSID, &IClassFactory::IID, &mut p).ok()?;
        let factory = IClassFactory::from_raw(p);
        let tip: ITfTextInputProcessorEx = factory.CreateInstance(None)?;
        println!("created text service");
        let tm: ITfThreadMgr = CoCreateInstance(&CLSID_TF_ThreadMgr, None, CLSCTX_INPROC_SERVER)?;
        let app = tm.Activate()?;
        // 文字服務的 client id（TSF 啟用輸入法時給的就是這個）
        let tid = tm.cast::<ITfClientId>()?.GetClientId(&CLSID)?;
        println!("thread manager active (app {app}, text service {tid})");
        for round in 1..=2 {
            // 沒有註冊時 TSF 不把它當成啟用中的輸入法，最後一步 AdviseKeyEventSink 會回 E_INVALIDARG；
            // 前面的（候選視窗、焦點 sink、清理）照樣跑過
            match tip.ActivateEx(&tm, tid, 0) {
                Ok(()) => println!("round {round}: activated"),
                Err(e) if e.code() == windows::Win32::Foundation::E_INVALIDARG => {
                    println!("round {round}: activated up to the key sink (needs install.ps1 for the rest)")
                }
                Err(e) => return Err(e),
            }
            tip.Deactivate()?;
            println!("round {round}: deactivated");
        }
        tm.Deactivate()?;
    }
    println!("smoke test passed: {}", dll.display());
    Ok(())
}

#[cfg(not(windows))]
fn main() {}
