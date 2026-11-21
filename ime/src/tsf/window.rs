//! 候選視窗：游標下方一列，樣子照 App 的預測列（`PredictBar.tsx`）：左邊是字根（或「中」「英」），
//! 接著是 1～9 的候選字（反白的是綠色），最後是頁數與 ‹ ›。不搶焦點（`WS_EX_NOACTIVATE`），點了交給 `on_hit`，
//! 右鍵打開設定視窗。
//! 一個執行緒一個（文字服務在每個有輸入的執行緒上各自啟用）。

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::OnceLock;

use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, RECT, SIZE, WPARAM};
use windows::Win32::Graphics::Gdi::{
    BeginPaint, BitBlt, CLEARTYPE_QUALITY, CLIP_DEFAULT_PRECIS, CreateCompatibleBitmap, CreateCompatibleDC, CreateFontW,
    CreatePen, CreateSolidBrush, DEFAULT_CHARSET, DEFAULT_PITCH, DeleteDC, DeleteObject, EndPaint, FF_DONTCARE, FW_NORMAL,
    FW_SEMIBOLD, FillRect, GetDC, GetMonitorInfoW, GetTextExtentPoint32W, HDC, HFONT, HGDIOBJ, InvalidateRect,
    MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromRect, OUT_DEFAULT_PRECIS, PAINTSTRUCT, PS_SOLID, ReleaseDC, RoundRect,
    SRCCOPY, SelectObject, SetBkMode, SetTextColor, TRANSPARENT, TextOutW,
};
use windows::Win32::System::Registry::{HKEY_CURRENT_USER, RRF_RT_REG_DWORD, RegGetValueW};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::WindowsAndMessaging::{
    CS_DROPSHADOW, CreateWindowExW, DefWindowProcW, DestroyWindow, HWND_TOPMOST, IDC_ARROW, KillTimer, LoadCursorW,
    MA_NOACTIVATE, RegisterClassExW, SW_HIDE, SWP_NOACTIVATE, SWP_SHOWWINDOW, SetTimer, SetWindowPos, ShowWindow, WM_LBUTTONDOWN,
    WM_MOUSEACTIVATE, WM_PAINT, WM_RBUTTONUP, WM_TIMER, WNDCLASSEXW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
};
use windows_core::{PCWSTR, w};

use super::dll::module;
use crate::engine::machine::{Kind, List};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hit {
    Item(usize),
    Prev,
    Next,
}

const CLASS: PCWSTR = w!("BanyanImeCandidates");
const FLASH_TIMER: usize = 1;

#[derive(Clone, Copy, PartialEq)]
enum Font {
    Big,
    Small,
    Bold,
}

struct Piece {
    rect: RECT,
    text: Vec<u16>,
    font: Font,
    color: COLORREF,
    fill: Option<COLORREF>,
    hit: Option<Hit>,
}

struct Theme {
    bg: COLORREF,
    border: COLORREF,
    text: COLORREF,
    muted: COLORREF,
    accent: COLORREF,
    soft: COLORREF,
}

const fn rgb(r: u8, g: u8, b: u8) -> COLORREF {
    COLORREF(r as u32 | (g as u32) << 8 | (b as u32) << 16)
}

/// 顏色照 App 的 `editor.css`（強調色 `--ed-accent` 是綠色）
const LIGHT: Theme = Theme {
    bg: rgb(255, 255, 255),
    border: rgb(214, 219, 216),
    text: rgb(31, 35, 33),
    muted: rgb(134, 140, 137),
    accent: rgb(43, 122, 82),
    soft: rgb(226, 239, 231),
};
const DARK: Theme = Theme {
    bg: rgb(32, 36, 34),
    border: rgb(62, 69, 65),
    text: rgb(230, 233, 231),
    muted: rgb(143, 151, 146),
    accent: rgb(70, 165, 117),
    soft: rgb(35, 57, 45),
};

fn dark_mode() -> bool {
    let mut v: u32 = 1;
    let mut size = 4u32;
    let r = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            w!("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"),
            w!("AppsUseLightTheme"),
            RRF_RT_REG_DWORD,
            None,
            Some(&mut v as *mut u32 as *mut _),
            Some(&mut size),
        )
    };
    r.is_ok() && v == 0
}

#[derive(Default)]
struct View {
    pieces: Vec<Piece>,
    size: SIZE,
    kind: Option<Kind>,
    fonts: Option<(u32, [HFONT; 3])>,
    on_hit: Option<Rc<dyn Fn(Hit)>>,
    dark: bool,
}

thread_local! {
    static VIEW: RefCell<View> = RefCell::new(View::default());
}

fn make_fonts(dpi: u32) -> [HFONT; 3] {
    let px = |p: i32| -(p * dpi as i32 / 96);
    let mk = |size: i32, weight: u32| unsafe {
        CreateFontW(
            px(size),
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
            w!("Microsoft JhengHei UI"),
        )
    };
    [mk(19, FW_NORMAL.0), mk(12, FW_NORMAL.0), mk(18, FW_SEMIBOLD.0)]
}

fn delete_fonts(f: [HFONT; 3]) {
    for h in f {
        unsafe {
            let _ = DeleteObject(HGDIOBJ(h.0));
        }
    }
}

fn measure(dc: HDC, font: HFONT, text: &[u16]) -> SIZE {
    let mut s = SIZE::default();
    unsafe {
        let old = SelectObject(dc, HGDIOBJ(font.0));
        let _ = GetTextExtentPoint32W(dc, text, &mut s);
        SelectObject(dc, old);
    }
    s
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

/// 排版：每一塊的位置（視窗座標）與視窗大小
fn layout(list: &List, dc: HDC, fonts: &[HFONT; 3], dpi: u32, t: &Theme) -> (Vec<Piece>, SIZE) {
    let s = |v: i32| v * dpi as i32 / 96;
    let font_of = |f: Font| fonts[f as usize];
    let (pad_x, pad_y) = (s(9), s(5));
    let mut pieces = Vec::new();
    let big_h = measure(dc, fonts[0], &wide("字")).cy;
    let h = big_h + pad_y * 2;
    let mut x = pad_x;
    let put = |pieces: &mut Vec<Piece>, x: &mut i32, text: &str, font: Font, color: COLORREF, fill: Option<COLORREF>, hit: Option<Hit>, padx: i32| {
        let tw = wide(text);
        let m = measure(dc, font_of(font), &tw);
        let w = m.cx + padx * 2;
        pieces.push(Piece { rect: RECT { left: *x, top: 0, right: *x + w, bottom: h }, text: tw, font, color, fill, hit });
        *x += w;
    };
    if list.kind == Kind::Mode {
        put(&mut pieces, &mut x, &list.head, Font::Bold, t.accent, None, None, s(4));
        return (pieces, SIZE { cx: x + pad_x, cy: h });
    }
    if !list.head.is_empty() {
        put(&mut pieces, &mut x, &list.head, Font::Big, t.muted, None, None, 0);
        x += s(10);
    }
    for (i, item) in list.items.iter().enumerate() {
        let sel = i == list.sel;
        let start = x;
        put(&mut pieces, &mut x, &format!("{}", i + 1), Font::Small, if sel { t.accent } else { t.muted }, None, None, s(3));
        put(&mut pieces, &mut x, item, Font::Big, if sel { t.accent } else { t.text }, None, None, s(1));
        x += s(5);
        // 整個候選（號碼＋字）是一塊可以點、反白的底
        let n = pieces.len();
        let r = RECT { left: start - s(2), top: s(3), right: x - s(2), bottom: h - s(3) };
        pieces.insert(n - 2, Piece { rect: r, text: Vec::new(), font: Font::Small, color: t.text, fill: sel.then_some(t.soft), hit: Some(Hit::Item(i)) });
        x += s(3);
    }
    if let Some(p) = &list.page_info {
        x += s(4);
        put(&mut pieces, &mut x, "‹", Font::Big, t.muted, None, Some(Hit::Prev), s(4));
        put(&mut pieces, &mut x, p, Font::Small, t.muted, None, None, s(2));
        put(&mut pieces, &mut x, "›", Font::Big, t.muted, None, Some(Hit::Next), s(4));
    }
    if list.items.is_empty() && list.page_info.is_none() && !list.head.is_empty() {
        x += s(2);
    }
    (pieces, SIZE { cx: x + pad_x - s(6), cy: h })
}

pub struct CandWindow {
    hwnd: HWND,
}

fn register_class() -> bool {
    static ATOM: OnceLock<u16> = OnceLock::new();
    *ATOM.get_or_init(|| unsafe {
        let wc = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            style: CS_DROPSHADOW,
            lpfnWndProc: Some(wndproc),
            hInstance: module(),
            hCursor: LoadCursorW(None, IDC_ARROW).unwrap_or_default(),
            lpszClassName: CLASS,
            ..Default::default()
        };
        RegisterClassExW(&wc)
    }) != 0
}

impl CandWindow {
    pub fn new(on_hit: Rc<dyn Fn(Hit)>) -> Option<CandWindow> {
        if !register_class() {
            return None;
        }
        let hwnd = unsafe {
            CreateWindowExW(
                WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                CLASS,
                w!(""),
                WS_POPUP,
                0,
                0,
                0,
                0,
                None,
                None,
                Some(module()),
                None,
            )
            .ok()?
        };
        VIEW.with(|v| v.borrow_mut().on_hit = Some(on_hit));
        Some(CandWindow { hwnd })
    }

    pub fn hide(&self) {
        VIEW.with(|v| v.borrow_mut().kind = None);
        unsafe {
            let _ = ShowWindow(self.hwnd, SW_HIDE);
        }
    }

    /// 顯示 list；at 是組字或游標的畫面座標（None：位置不變，只重畫）
    pub fn show(&self, list: &List, at: Option<RECT>) {
        super::debug!("window show {:?} at {at:?}", list.kind);
        let dpi = unsafe { GetDpiForWindow(self.hwnd) }.max(96);
        let size = VIEW.with(|v| {
            let mut v = v.borrow_mut();
            if v.fonts.map(|f| f.0) != Some(dpi) {
                if let Some((_, f)) = v.fonts.take() {
                    delete_fonts(f);
                }
                v.fonts = Some((dpi, make_fonts(dpi)));
            }
            v.dark = dark_mode();
            let theme = if v.dark { &DARK } else { &LIGHT };
            let fonts = v.fonts.unwrap().1;
            let dc = unsafe { GetDC(None) };
            let (pieces, size) = layout(list, dc, &fonts, dpi, theme);
            unsafe { ReleaseDC(None, dc) };
            v.pieces = pieces;
            v.size = size;
            v.kind = Some(list.kind);
            size
        });
        unsafe {
            if let Some(at) = at {
                let (x, y) = place(at, size, dpi);
                let _ = SetWindowPos(self.hwnd, Some(HWND_TOPMOST), x, y, size.cx, size.cy, SWP_NOACTIVATE | SWP_SHOWWINDOW);
            } else {
                let mut r = RECT::default();
                let _ = windows::Win32::UI::WindowsAndMessaging::GetWindowRect(self.hwnd, &mut r);
                let _ = SetWindowPos(self.hwnd, Some(HWND_TOPMOST), r.left, r.top, size.cx, size.cy, SWP_NOACTIVATE | SWP_SHOWWINDOW);
            }
            let _ = InvalidateRect(Some(self.hwnd), None, false);
            if list.kind == Kind::Mode {
                SetTimer(Some(self.hwnd), FLASH_TIMER, 900, None);
            } else {
                let _ = KillTimer(Some(self.hwnd), FLASH_TIMER);
            }
        }
    }
}

/// 放在 at 下方；下面放不下就放上面，左右不超出螢幕
fn place(at: RECT, size: SIZE, dpi: u32) -> (i32, i32) {
    let gap = 4 * dpi as i32 / 96;
    let mut x = at.left;
    let mut y = at.bottom + gap;
    unsafe {
        let mon = MonitorFromRect(&at, MONITOR_DEFAULTTONEAREST);
        let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if GetMonitorInfoW(mon, &mut mi).as_bool() {
            let w = mi.rcWork;
            if y + size.cy > w.bottom {
                y = at.top - size.cy - gap;
            }
            x = x.min(w.right - size.cx).max(w.left);
            y = y.max(w.top);
        }
    }
    (x, y)
}

impl Drop for CandWindow {
    fn drop(&mut self) {
        unsafe {
            let _ = DestroyWindow(self.hwnd);
        }
        VIEW.with(|v| {
            let mut v = v.borrow_mut();
            if let Some((_, f)) = v.fonts.take() {
                delete_fonts(f);
            }
            v.on_hit = None;
            v.pieces.clear();
        });
    }
}

fn paint(hwnd: HWND) {
    unsafe {
        let mut ps = PAINTSTRUCT::default();
        let dc = BeginPaint(hwnd, &mut ps);
        VIEW.with(|v| {
            let Ok(v) = v.try_borrow() else { return };
            let Some((_, fonts)) = v.fonts else { return };
            let t = if v.dark { &DARK } else { &LIGHT };
            let (w, h) = (v.size.cx, v.size.cy);
            let mem = CreateCompatibleDC(Some(dc));
            let bmp = CreateCompatibleBitmap(dc, w, h);
            let old_bmp = SelectObject(mem, HGDIOBJ(bmp.0));
            let bg = CreateSolidBrush(t.bg);
            let pen = CreatePen(PS_SOLID, 1, t.border);
            let old_pen = SelectObject(mem, HGDIOBJ(pen.0));
            let old_brush = SelectObject(mem, HGDIOBJ(bg.0));
            let _ = RoundRect(mem, 0, 0, w, h, 8, 8);
            SetBkMode(mem, TRANSPARENT);
            for p in &v.pieces {
                if let Some(fill) = p.fill {
                    let b = CreateSolidBrush(fill);
                    FillRect(mem, &p.rect, b);
                    let _ = DeleteObject(HGDIOBJ(b.0));
                }
                if p.text.is_empty() {
                    continue;
                }
                let font = fonts[p.font as usize];
                let old = SelectObject(mem, HGDIOBJ(font.0));
                let m = measure(mem, font, &p.text);
                SetTextColor(mem, p.color);
                let x = p.rect.left + (p.rect.right - p.rect.left - m.cx) / 2;
                let y = (h - m.cy) / 2;
                let _ = TextOutW(mem, x, y, &p.text);
                SelectObject(mem, old);
            }
            let _ = BitBlt(dc, 0, 0, w, h, Some(mem), 0, 0, SRCCOPY);
            SelectObject(mem, old_pen);
            SelectObject(mem, old_brush);
            SelectObject(mem, old_bmp);
            let _ = DeleteObject(HGDIOBJ(pen.0));
            let _ = DeleteObject(HGDIOBJ(bg.0));
            let _ = DeleteObject(HGDIOBJ(bmp.0));
            let _ = DeleteDC(mem);
        });
        let _ = EndPaint(hwnd, &ps);
    }
}

fn point(lp: LPARAM) -> POINT {
    POINT { x: (lp.0 & 0xffff) as i16 as i32, y: ((lp.0 >> 16) & 0xffff) as i16 as i32 }
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    match msg {
        WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE as isize),
        WM_PAINT => {
            paint(hwnd);
            LRESULT(0)
        }
        WM_TIMER if wp.0 == FLASH_TIMER => {
            unsafe {
                let _ = KillTimer(Some(hwnd), FLASH_TIMER);
            }
            let flash = VIEW.with(|v| v.borrow().kind == Some(Kind::Mode));
            if flash {
                unsafe {
                    let _ = ShowWindow(hwnd, SW_HIDE);
                }
            }
            LRESULT(0)
        }
        // 右鍵：設定（開關字預測與輔助打字）
        WM_RBUTTONUP => {
            super::dll::open_settings();
            LRESULT(0)
        }
        WM_LBUTTONDOWN => {
            let pt = point(lp);
            let hit = VIEW.with(|v| {
                let v = v.try_borrow().ok()?;
                let hit = v
                    .pieces
                    .iter()
                    .find(|p| p.hit.is_some() && pt.x >= p.rect.left && pt.x < p.rect.right)
                    .and_then(|p| p.hit)?;
                Some((hit, v.on_hit.clone()?))
            });
            if let Some((hit, f)) = hit {
                f(hit);
            }
            LRESULT(0)
        }
        _ => unsafe { DefWindowProcW(hwnd, msg, wp, lp) },
    }
}
