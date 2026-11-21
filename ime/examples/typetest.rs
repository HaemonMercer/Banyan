//! 裝好之後的實際打字測試：開一個有文字框的小視窗，這個程式改用 Banyan 輸入法，
//! 用 SendInput 送按鍵，最後讀文字框的內容和預期比對。
//!
//! ```powershell
//! cargo run --release --example typetest
//! ```
//!
//! 不用 SendInput，所以不用搶前景，按鍵也不會跑到別的程式。用 Error 0x80070006: 控制代碼無效。 參數改測舊的 EDIT 控制項（經過 CUAS）。
//! 測試會切換中／英，結束時切回原本的狀態。

#[cfg(windows)]
fn main() {
    use std::time::{Duration, Instant};
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::Input::KeyboardAndMouse::*;
    use windows::Win32::UI::TextServices::{
        CLSID_TF_InputProcessorProfiles, ITfInputProcessorProfileMgr, TF_IPPMF_DONTCARECURRENTINPUTLANGUAGE, TF_IPPMF_FORPROCESS,
        TF_PROFILETYPE_INPUTPROCESSOR,
    };
    use windows::Win32::UI::WindowsAndMessaging::*;
    use windows_core::{GUID, w};

    const CLSID: GUID = GUID::from_u128(0x77483fa4_b8bd_418a_85e7_90d56cf17ea4);
    const PROFILE: GUID = GUID::from_u128(0xaf153006_e6d0_4fcc_a497_a2b082afab5e);

    unsafe extern "system" fn proc(h: HWND, m: u32, w: WPARAM, l: LPARAM) -> LRESULT {
        unsafe { DefWindowProcW(h, m, w, l) }
    }

    fn pump(ms: u64) {
        let end = Instant::now() + Duration::from_millis(ms);
        while Instant::now() < end {
            unsafe {
                let mut msg = MSG::default();
                while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().unwrap();
        let inst = GetModuleHandleW(None).unwrap();
        let wc = WNDCLASSW { lpfnWndProc: Some(proc), hInstance: inst.into(), lpszClassName: w!("BanyanTypeTest"), ..Default::default() };
        RegisterClassW(&wc);
        let top = CreateWindowExW(
            WS_EX_TOPMOST,
            w!("BanyanTypeTest"),
            w!("Banyan IME test"),
            WS_OVERLAPPEDWINDOW | WS_VISIBLE,
            200,
            200,
            700,
            220,
            None,
            None,
            Some(inst.into()),
            None,
        )
        .unwrap();
        // 預設用 RichEdit（記事本、寫字板用的，原生支援 TSF）；參數 edit 改用舊的 EDIT（經過 CUAS）
        let plain = std::env::args().any(|a| a == "edit");
        windows::Win32::System::LibraryLoader::LoadLibraryW(w!("Msftedit.dll")).unwrap();
        let edit = CreateWindowExW(
            Default::default(),
            if plain { w!("EDIT") } else { w!("RICHEDIT50W") },
            w!(""),
            WS_CHILD | WS_VISIBLE | WS_BORDER | WINDOW_STYLE(ES_MULTILINE as u32),
            10,
            10,
            660,
            150,
            Some(top),
            None,
            Some(inst.into()),
            None,
        )
        .unwrap();
        if !plain {
            // EM_SETEDITSTYLE：SES_USECTF，讓 RichEdit 直接用 TSF
            SendMessageW(edit, WM_USER + 204, Some(WPARAM(0x10000)), Some(LPARAM(0x10000)));
        }
        let profiles: ITfInputProcessorProfileMgr =
            CoCreateInstance(&CLSID_TF_InputProcessorProfiles, None, CLSCTX_INPROC_SERVER).unwrap();
        profiles
            .ActivateProfile(
                TF_PROFILETYPE_INPUTPROCESSOR,
                0x0404,
                &CLSID,
                &PROFILE,
                HKL::default(),
                TF_IPPMF_FORPROCESS | TF_IPPMF_DONTCARECURRENTINPUTLANGUAGE,
            )
            .expect("activate Banyan profile");
        let _ = SetFocus(Some(edit));
        pump(800);

        // 送真的按鍵（SendInput）：TSF 只把按鍵交給有焦點的文件，焦點跟著前景視窗。
        // 每個鍵送出前確認前景是測試視窗，不是就停下來，按鍵不會跑到別的程式。
        let _ = SetForegroundWindow(top);
        let _ = SetFocus(Some(edit));
        pump(300);
        let input = |vk: VIRTUAL_KEY, up: bool| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT { wVk: vk, dwFlags: if up { KEYEVENTF_KEYUP } else { Default::default() }, ..Default::default() },
            },
        };
        let front = || {
            if GetForegroundWindow() == top {
                return true;
            }
            let _ = SetForegroundWindow(top);
            pump(200);
            let ok = GetForegroundWindow() == top;
            if !ok {
                eprintln!("測試視窗不在前景，停止（按鍵沒有送出）");
            }
            ok
        };
        let send = |vk: VIRTUAL_KEY, _shift: bool| -> bool {
            if !front() {
                return false;
            }
            SendInput(&[input(vk, false), input(vk, true)], std::mem::size_of::<INPUT>() as i32);
            pump(80);
            true
        };
        let text = |s: &str| -> bool {
            for c in s.chars() {
                let (vk, shift) = match c {
                    ' ' => (VK_SPACE, false),
                    '.' => (VK_OEM_PERIOD, false),
                    ',' => (VK_OEM_COMMA, false),
                    '\u{1b}' => (VK_ESCAPE, false),
                    c if c.is_ascii_uppercase() => (VIRTUAL_KEY(c as u16), true),
                    c if c.is_ascii_alphanumeric() => (VIRTUAL_KEY(c.to_ascii_uppercase() as u16), false),
                    _ => panic!("{c:?}"),
                };
                if !send(vk, shift) {
                    return false;
                }
            }
            true
        };
        let shift_tap = || -> bool {
            if !front() {
                return false;
            }
            SendInput(&[input(VK_SHIFT, false), input(VK_SHIFT, true)], std::mem::size_of::<INPUT>() as i32);
            pump(200);
            true
        };
        let read = || {
            let mut buf = [0u16; 512];
            let n = GetWindowTextW(edit, &mut buf);
            String::from_utf16_lossy(&buf[..n as usize]).replace("\r\n", "\n").replace('\r', "\n")
        };
        // 這個程式自己的候選視窗（其他程式也可能載入了 Banyan，各有一個藏起來的）
        let cand_visible = || {
            let me = windows::Win32::System::Threading::GetCurrentProcessId();
            let mut prev: Option<HWND> = None;
            while let Ok(h) = FindWindowExW(None, prev, w!("BanyanImeCandidates"), None) {
                let mut pid = 0u32;
                GetWindowThreadProcessId(h, Some(&mut pid));
                if pid == me {
                    return IsWindowVisible(h).as_bool();
                }
                prev = Some(h);
            }
            false
        };

        // 現在是中文還是英文（輸入法記在登錄檔；EDIT 的組字顯示在另外的視窗，從文字看不出來）
        let reg_zh = || {
            let mut v: u32 = 1;
            let mut size = 4u32;
            let r = windows::Win32::System::Registry::RegGetValueW(
                windows::Win32::System::Registry::HKEY_CURRENT_USER,
                w!(r"Software\Banyan IME"),
                w!("Chinese"),
                windows::Win32::System::Registry::RRF_RT_REG_DWORD,
                None,
                Some(&mut v as *mut u32 as *mut _),
                Some(&mut size),
            );
            r.is_err() || v != 0
        };
        let was_zh = reg_zh();
        let mut ok = true;
        if !was_zh {
            ok = shift_tap();
        }
        let zh = ok && reg_zh();
        println!("中文模式：{zh}");
        let mut steps: Vec<(&str, String, &str)> = vec![];
        if ok && zh {
            ok = text("hqi");
            println!("  打 hqi 時候選視窗：{}", cand_visible());
            ok = ok && text(" ");
            steps.push(("倉頡 hqi＋空白", read(), "我"));
            println!("  聯想的候選視窗：{}", cand_visible());
            ok = ok && text("\u{1b},");
            steps.push(("中文後打 ,", read(), "我，"));
            ok = ok && shift_tap();
            // 中文句子裡的英文照 App 的規則：標點仍是中文、不大寫
            ok = ok && text("ok.");
            steps.push(("英文模式、中文句子裡", read(), "我，ok。"));
            ok = ok && send(VK_RETURN, false) && text("hello world. this");
            steps.push(("換行後的英文：句首大寫", read(), "我，ok。\nHello world. This"));
            ok = ok && text("\u{1b}") && shift_tap();
        }
        if !was_zh && reg_zh() {
            shift_tap();
        }
        DestroyWindow(top).ok();
        let mut pass = ok && zh;
        for (name, got, want) in &steps {
            let good = got == want;
            pass &= good;
            println!("{} {name}: {got:?}{}", if good { "✓" } else { "✗" }, if good { String::new() } else { format!("（預期 {want:?}）") });
        }
        println!("{}", if pass { "typetest passed" } else { "typetest FAILED" });
        std::process::exit(if pass { 0 } else { 1 });
    }
}

#[cfg(not(windows))]
fn main() {}
