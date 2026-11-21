//! 設定視窗：開關字預測與輔助打字（`engine::options::Options`）。
//!
//! 打開的地方：開始功能表的「Banyan IME Settings」（`rundll32 banyan_ime.dll,Settings`，`dll.rs`）、
//! Windows 設定裡這個鍵盤的「選項」（`ITfFnConfigure::Show`，`service.rs`）、在候選列上按右鍵（另開 rundll32）。
//! 兩個總開關（Word prediction、Typing assist）關掉時底下的細項變灰；按 OK 存到登錄檔，
//! 已經開著的程式在下次切回來（焦點改變）時套用。同時只開一個。

use std::cell::RefCell;

use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CLEARTYPE_QUALITY, CLIP_DEFAULT_PRECIS, COLOR_WINDOW, CreateFontW, DEFAULT_CHARSET, DEFAULT_PITCH, DeleteObject, FF_DONTCARE,
    FW_NORMAL, FW_SEMIBOLD, GetSysColorBrush, HBRUSH, HFONT, HGDIOBJ, OUT_DEFAULT_PRECIS,
};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::Input::KeyboardAndMouse::EnableWindow;
use windows::Win32::UI::WindowsAndMessaging::{
    BM_GETCHECK, BM_SETCHECK, BN_CLICKED, BS_AUTOCHECKBOX, BS_DEFPUSHBUTTON, BS_PUSHBUTTON, CreateWindowExW, DefWindowProcW,
    DestroyWindow, DispatchMessageW, FindWindowW, GetDlgItem, GetMessageW, GetSystemMetrics, HMENU, IDC_ARROW, IDCANCEL, IDOK,
    IsDialogMessageW, LoadCursorW, MSG, PostQuitMessage, RegisterClassExW, SM_CXSCREEN, SM_CYSCREEN, SW_SHOW, SWP_NOZORDER,
    SendMessageW, SetForegroundWindow, SetWindowPos, ShowWindow, TranslateMessage, WINDOW_EX_STYLE, WINDOW_STYLE, WM_CLOSE,
    WM_COMMAND, WM_DESTROY, WM_SETFONT, WNDCLASSEXW, WS_CAPTION, WS_CHILD, WS_EX_DLGMODALFRAME, WS_SYSMENU, WS_TABSTOP,
    WS_VISIBLE, AdjustWindowRectEx,
};
use windows_core::{PCWSTR, w};

use super::dll::module;
use super::settings;
use crate::engine::options::Options;

const CLASS: PCWSTR = w!("BanyanImeSettings");

/// 每個勾選框：id、文字、是不是總開關、讀寫哪個欄位
struct Check {
    id: i32,
    label: &'static str,
    master: bool,
    field: fn(&mut Options) -> &mut bool,
}

const CHECKS: [Check; 8] = [
    Check { id: 101, label: "Word prediction", master: true, field: |o| &mut o.predict },
    Check { id: 102, label: "English: complete words and suggest the next word", master: false, field: |o| &mut o.english },
    Check { id: 103, label: "Chinese: suggest phrases after a character", master: false, field: |o| &mut o.follow },
    Check { id: 201, label: "Typing assist", master: true, field: |o| &mut o.assist },
    Check { id: 202, label: "Chinese punctuation in Chinese sentences", master: false, field: |o| &mut o.cjk_punct },
    Check { id: 203, label: "English punctuation in English sentences", master: false, field: |o| &mut o.en_punct },
    Check { id: 204, label: "Capitalize sentences and a lone \u{201c}i\u{201d}", master: false, field: |o| &mut o.capitalize },
    Check { id: 205, label: "Space between Chinese and English", master: false, field: |o| &mut o.spacing },
];

struct Ui {
    fonts: Vec<HFONT>,
    done: bool,
}

thread_local! {
    static UI: RefCell<Option<Ui>> = const { RefCell::new(None) };
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

fn checked(hwnd: HWND, id: i32) -> bool {
    unsafe { GetDlgItem(Some(hwnd), id).is_ok_and(|h| SendMessageW(h, BM_GETCHECK, None, None).0 == 1) }
}

/// 總開關關掉時底下的細項變灰
fn update_enabled(hwnd: HWND) {
    let mut on = true;
    for c in &CHECKS {
        if c.master {
            on = checked(hwnd, c.id);
        } else if let Ok(h) = unsafe { GetDlgItem(Some(hwnd), c.id) } {
            unsafe {
                let _ = EnableWindow(h, on);
            }
        }
    }
}

fn save(hwnd: HWND) {
    let mut o = settings::load_options();
    for c in &CHECKS {
        *(c.field)(&mut o) = checked(hwnd, c.id);
    }
    settings::save_options(&o);
}

fn build(hwnd: HWND) {
    let dpi = unsafe { GetDpiForWindow(hwnd) }.max(96) as i32;
    let s = |v: i32| v * dpi / 96;
    let font = |size: i32, weight: u32| unsafe {
        CreateFontW(
            -s(size),
            0,
            0,
            0,
            weight as i32,
            0,
            0,
            0,
            DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS,
            CLIP_DEFAULT_PRECIS,
            CLEARTYPE_QUALITY,
            (DEFAULT_PITCH.0 | FF_DONTCARE.0) as u32,
            w!("Segoe UI"),
        )
    };
    let normal = font(12, FW_NORMAL.0);
    let bold = font(12, FW_SEMIBOLD.0);
    let child = |class: PCWSTR, text: &str, style: u32, id: i32, x: i32, y: i32, w: i32, h: i32, f: HFONT| unsafe {
        let t = wide(text);
        if let Ok(c) = CreateWindowExW(
            WINDOW_EX_STYLE(0),
            class,
            PCWSTR(t.as_ptr()),
            WS_CHILD | WS_VISIBLE | WINDOW_STYLE(style),
            s(x),
            s(y),
            s(w),
            s(h),
            Some(hwnd),
            Some(HMENU(id as usize as *mut _)),
            Some(module()),
            None,
        ) {
            SendMessageW(c, WM_SETFONT, Some(WPARAM(f.0 as usize)), Some(LPARAM(1)));
        }
    };
    let o = settings::load_options();
    let mut y = 14;
    for c in &CHECKS {
        if c.master && c.id != CHECKS[0].id {
            y += 10;
        }
        let x = if c.master { 16 } else { 36 };
        child(w!("BUTTON"), c.label, (BS_AUTOCHECKBOX as u32) | WS_TABSTOP.0, c.id, x, y, 340 - x, 22, if c.master { bold } else { normal });
        let mut copy = o;
        if *(c.field)(&mut copy) {
            if let Ok(h) = unsafe { GetDlgItem(Some(hwnd), c.id) } {
                unsafe { SendMessageW(h, BM_SETCHECK, Some(WPARAM(1)), None) };
            }
        }
        y += 24;
    }
    y += 6;
    child(w!("STATIC"), "Open apps use the new settings when you switch back to them.", 0, -1, 16, y, 330, 20, normal);
    y += 30;
    child(w!("BUTTON"), "OK", (BS_DEFPUSHBUTTON as u32) | WS_TABSTOP.0, IDOK.0, 168, y, 84, 26, normal);
    child(w!("BUTTON"), "Cancel", (BS_PUSHBUTTON as u32) | WS_TABSTOP.0, IDCANCEL.0, 260, y, 84, 26, normal);
    y += 26 + 14;
    // 視窗大小照內容（工作區 360 × y），放在畫面中間
    let style = WS_CAPTION | WS_SYSMENU;
    let mut r = RECT { left: 0, top: 0, right: s(360), bottom: s(y) };
    unsafe {
        let _ = AdjustWindowRectEx(&mut r, style, false, WS_EX_DLGMODALFRAME);
        let (w, h) = (r.right - r.left, r.bottom - r.top);
        let x = (GetSystemMetrics(SM_CXSCREEN) - w) / 2;
        let yy = (GetSystemMetrics(SM_CYSCREEN) - h) / 3;
        let _ = SetWindowPos(hwnd, None, x, yy, w, h, SWP_NOZORDER);
    }
    UI.with(|u| {
        if let Some(u) = u.borrow_mut().as_mut() {
            u.fonts = vec![normal, bold];
        }
    });
    update_enabled(hwnd);
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    match msg {
        WM_COMMAND => {
            let id = (wp.0 & 0xffff) as i32;
            let code = ((wp.0 >> 16) & 0xffff) as u32;
            if id == IDOK.0 {
                save(hwnd);
                unsafe {
                    let _ = DestroyWindow(hwnd);
                }
            } else if id == IDCANCEL.0 {
                unsafe {
                    let _ = DestroyWindow(hwnd);
                }
            } else if code == BN_CLICKED && CHECKS.iter().any(|c| c.id == id && c.master) {
                update_enabled(hwnd);
            }
            LRESULT(0)
        }
        WM_CLOSE => {
            unsafe {
                let _ = DestroyWindow(hwnd);
            }
            LRESULT(0)
        }
        WM_DESTROY => {
            UI.with(|u| {
                if let Some(u) = u.borrow_mut().as_mut() {
                    u.done = true;
                    for f in u.fonts.drain(..) {
                        unsafe {
                            let _ = DeleteObject(HGDIOBJ(f.0));
                        }
                    }
                }
            });
            LRESULT(0)
        }
        _ => unsafe { DefWindowProcW(hwnd, msg, wp, lp) },
    }
}

/// 打開設定視窗，關掉才回來（parent 在開著的時候停用）
pub fn show(parent: Option<HWND>) {
    unsafe {
        // 已經開著：拿到前面
        if let Ok(h) = FindWindowW(CLASS, None) {
            let _ = SetForegroundWindow(h);
            return;
        }
        let wc = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            lpfnWndProc: Some(wndproc),
            hInstance: module(),
            hCursor: LoadCursorW(None, IDC_ARROW).unwrap_or_default(),
            hbrBackground: HBRUSH(GetSysColorBrush(COLOR_WINDOW).0),
            lpszClassName: CLASS,
            ..Default::default()
        };
        RegisterClassExW(&wc);
        UI.with(|u| *u.borrow_mut() = Some(Ui { fonts: Vec::new(), done: false }));
        let Ok(hwnd) = CreateWindowExW(
            WS_EX_DLGMODALFRAME,
            CLASS,
            w!("Banyan IME Settings"),
            WS_CAPTION | WS_SYSMENU,
            0,
            0,
            100,
            100,
            parent,
            None,
            Some(module()),
            None,
        ) else {
            return;
        };
        build(hwnd);
        if let Some(p) = parent {
            let _ = EnableWindow(p, false);
        }
        let _ = ShowWindow(hwnd, SW_SHOW);
        let _ = SetForegroundWindow(hwnd);
        let mut msg = MSG::default();
        loop {
            if UI.with(|u| u.borrow().as_ref().is_none_or(|u| u.done)) {
                break;
            }
            let r = GetMessageW(&mut msg, None, 0, 0);
            if r.0 == 0 {
                // 程式要結束了：把 WM_QUIT 留給外面的訊息迴圈
                PostQuitMessage(msg.wParam.0 as i32);
                break;
            }
            if r.0 == -1 {
                break;
            }
            if !IsDialogMessageW(hwnd, &msg).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
        if let Some(p) = parent {
            let _ = EnableWindow(p, true);
            let _ = SetForegroundWindow(p);
        }
        UI.with(|u| *u.borrow_mut() = None);
    }
}
