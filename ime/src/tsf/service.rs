//! 文字服務本體：TSF 在每個有輸入的執行緒上建立一個 `TextService` 並 `ActivateEx`。
//!
//! - 按鍵（`KeySink`）：OnTestKeyDown 問 `Machine::test` 要不要吃掉，OnKeyDown 開 edit session 執行 `Machine::key`。
//!   單獨按一下 Shift（放開時）切換中／英；保留鍵 Alt＋` 換倉頡／速成、Alt＋數字直接打數字。
//! - 焦點換了（`ThreadSink`）、App 結束了組字（`CompSink`）、使用者移動了游標（`EditSink`）：關掉候選列。
//! - 每次 edit session 結束後依 `Machine::list` 更新候選視窗，位置是組字（或游標）的畫面座標。
//!
//! 所有狀態在一個 `Rc<State>` 裡（文字服務只在建立它的執行緒上被呼叫）；sink 都另外做成小物件拿著它。

use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};
use std::time::{Duration, Instant};

use windows::Win32::Foundation::{LPARAM, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::ClientToScreen;
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::WindowsAndMessaging::{GUITHREADINFO, GetGUIThreadInfo};
use windows::Win32::System::Variant::VT_I4;
use windows::Win32::UI::Input::KeyboardAndMouse::{VK_OEM_3, VK_SHIFT};
use windows::Win32::UI::TextServices::{
    GUID_COMPARTMENT_EMPTYCONTEXT, GUID_COMPARTMENT_KEYBOARD_DISABLED, ITfCompartmentMgr, ITfComposition, ITfCompositionSink,
    ITfCompositionSink_Impl, ITfContext, ITfDocumentMgr, ITfEditRecord, ITfKeyEventSink, ITfKeyEventSink_Impl,
    ITfKeystrokeMgr, ITfRange, ITfSource, ITfTextEditSink, ITfTextEditSink_Impl, ITfTextInputProcessor,
    ITfTextInputProcessor_Impl, ITfTextInputProcessorEx, ITfTextInputProcessorEx_Impl, ITfThreadMgr, ITfThreadMgrEventSink,
    ITfThreadMgrEventSink_Impl, TF_ANCHOR_END, TF_ANCHOR_START, TF_DEFAULT_SELECTION, TF_MOD_ALT, TF_PRESERVEDKEY,
    TF_SELECTION, TS_SD_READONLY,
};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::TextServices::{ITfFnConfigure, ITfFnConfigure_Impl, ITfFunction_Impl};
use windows_core::{BOOL, BSTR, GUID, IUnknown, Interface, Ref, implement};

use super::keys;
use super::session::{TsfDoc, edit};
use super::settings;
use super::window::{CandWindow, Hit};
use super::{KEY_DIGIT_BASE, KEY_SCHEME};
use crate::engine::learn::Learned;
use crate::engine::machine::{Doc, Key, Machine, Prefs};

/// Shift 按住超過這麼久才放開不算「單獨按一下」（可能是 Shift＋點滑鼠選取）
const SHIFT_TAP: Duration = Duration::from_millis(600);

pub struct State {
    thread_mgr: RefCell<Option<ITfThreadMgr>>,
    client: Cell<u32>,
    machine: RefCell<Machine>,
    pub composition: RefCell<Option<ITfComposition>>,
    pub comp_sink: RefCell<Option<ITfCompositionSink>>,
    window: RefCell<Option<CandWindow>>,
    thread_cookie: Cell<Option<u32>>,
    edit_sink: RefCell<Option<(ITfSource, u32)>>,
    /// 最後打字的文件（點候選視窗時用）
    context: RefCell<Option<ITfContext>>,
    /// 上次 edit session 結束時的游標：之後選取改變了而且不是這裡，就是使用者移動了游標
    caret: RefCell<Option<ITfRange>>,
    shift_down: Cell<Option<Instant>>,
    /// 這裡打出去的字（游標移動、換焦點就清掉）：舊的 Win32 程式（EDIT 控制項，經過 CUAS）不給輸入法讀游標前的字，
    /// 輔助打字與預測改看這個
    pub shadow: RefCell<Vec<char>>,
}

fn digit_guid(n: u32) -> GUID {
    GUID::from_u128(KEY_DIGIT_BASE + n as u128)
}

fn preserved() -> Vec<(GUID, TF_PRESERVEDKEY, &'static str)> {
    let mut v = vec![(KEY_SCHEME, TF_PRESERVEDKEY { uVKey: VK_OEM_3.0 as u32, uModifiers: TF_MOD_ALT }, "Cangjie / Quick")];
    for n in 0..10u32 {
        v.push((digit_guid(n), TF_PRESERVEDKEY { uVKey: 0x30 + n, uModifiers: TF_MOD_ALT }, "Type a digit"));
    }
    v
}

impl State {
    /// 在 ctx 上開 edit session：f 改 Machine 與文件，之後更新候選視窗
    fn run(self: &Rc<Self>, ctx: &ITfContext, f: impl FnOnce(&mut Machine, &mut TsfDoc) + 'static) {
        *self.context.borrow_mut() = Some(ctx.clone());
        let st = self.clone();
        let c = ctx.clone();
        edit(ctx, self.client.get(), move |ec| {
            debug!("edit session {ec}");
            let mut doc = TsfDoc::new(ec, &c, &st);
            {
                let Ok(mut m) = st.machine.try_borrow_mut() else { return };
                f(&mut m, &mut doc);
            }
            *st.caret.borrow_mut() = doc.caret();
            let rect = doc.caret_rect();
            debug!("after edit: text rect {rect:?}, list {:?}", st.machine.try_borrow().ok().and_then(|m| m.list().map(|l| (l.kind, l.items.len()))));
            let at = rect.filter(|r| r.bottom > r.top || r.left != 0).or_else(system_caret);
            st.refresh(at);
        });
    }

    /// 依 Machine 的候選列顯示或藏起候選視窗（at 是 None 時位置不變）
    fn refresh(&self, at: Option<RECT>) {
        let list = self.machine.try_borrow().ok().and_then(|m| m.list().cloned());
        if let Ok(w) = self.window.try_borrow() {
            if let Some(w) = w.as_ref() {
                match list {
                    Some(l) => w.show(&l, at),
                    None => w.hide(),
                }
            }
        }
    }

    fn reset(&self) {
        self.shadow.borrow_mut().clear();
        if let Ok(mut m) = self.machine.try_borrow_mut() {
            m.reset();
        }
        self.refresh(None);
    }

    fn on_hit(self: &Rc<Self>, hit: Hit) {
        let Some(ctx) = self.context.borrow().clone() else { return };
        self.run(&ctx, move |m, d| match hit {
            Hit::Item(i) => m.click(i, d),
            Hit::Prev => m.turn_page(-1, d),
            Hit::Next => m.turn_page(1, d),
        });
    }

    /// 監看焦點所在文件的文字改變（使用者移動游標時關掉候選列）
    fn watch(self: &Rc<Self>, dim: Option<&ITfDocumentMgr>) {
        if let Some((src, cookie)) = self.edit_sink.borrow_mut().take() {
            unsafe {
                let _ = src.UnadviseSink(cookie);
            }
        }
        let Some(dim) = dim else { return };
        unsafe {
            let Ok(ctx) = dim.GetTop() else { return };
            let Ok(src) = ctx.cast::<ITfSource>() else { return };
            let sink: IUnknown = EditSink { st: self.clone() }.into();
            if let Ok(cookie) = src.AdviseSink(&ITfTextEditSink::IID, &sink) {
                *self.edit_sink.borrow_mut() = Some((src, cookie));
            }
        }
    }

    /// 重新讀開關（設定視窗改過之後）；中／英、打到一半的碼不動
    fn reload(&self) {
        let (prefs, _) = settings::load();
        if let Ok(mut m) = self.machine.try_borrow_mut() {
            if m.prefs != prefs {
                m.prefs = prefs;
                m.hide();
            }
        }
    }

    fn save(&self) {
        if let Ok(mut m) = self.machine.try_borrow_mut() {
            settings::save_learned(&mut m.learned);
        }
    }
}

/// App 量不出文字的位置（還沒排版好等）時，改用系統的游標位置；也沒有就留在原地
fn system_caret() -> Option<RECT> {
    unsafe {
        let mut gi = GUITHREADINFO { cbSize: std::mem::size_of::<GUITHREADINFO>() as u32, ..Default::default() };
        GetGUIThreadInfo(GetCurrentThreadId(), &mut gi).ok()?;
        if gi.hwndCaret.is_invalid() {
            return None;
        }
        let r = gi.rcCaret;
        let mut a = POINT { x: r.left, y: r.top };
        let mut b = POINT { x: r.right, y: r.bottom };
        if !ClientToScreen(gi.hwndCaret, &mut a).as_bool() || !ClientToScreen(gi.hwndCaret, &mut b).as_bool() {
            return None;
        }
        Some(RECT { left: a.x, top: a.y, right: b.x, bottom: b.y })
    }
}

/// 文件可以打字：有焦點、不是空的文件（沒有可以打字的地方）、沒有停用鍵盤、不是唯讀
fn usable(ctx: &ITfContext) -> bool {
    unsafe {
        if let Ok(cm) = ctx.cast::<ITfCompartmentMgr>() {
            for g in [GUID_COMPARTMENT_KEYBOARD_DISABLED, GUID_COMPARTMENT_EMPTYCONTEXT] {
                if let Ok(c) = cm.GetCompartment(&g) {
                    if let Ok(v) = c.GetValue() {
                        let v = &v.Anonymous.Anonymous;
                        if v.vt == VT_I4 && v.Anonymous.lVal != 0 {
                            return false;
                        }
                    }
                }
            }
        }
        if let Ok(s) = ctx.GetStatus() {
            if s.dwDynamicFlags & TS_SD_READONLY != 0 {
                return false;
            }
        }
    }
    true
}

// ─── 文字服務 ───

#[implement(ITfTextInputProcessorEx, ITfTextInputProcessor, ITfFnConfigure)]
pub struct TextService {
    st: Rc<State>,
}

impl TextService {
    pub fn new() -> TextService {
        TextService {
            st: Rc::new(State {
                thread_mgr: RefCell::new(None),
                client: Cell::new(0),
                machine: RefCell::new(Machine::new(Prefs::default(), true, Learned::default())),
                composition: RefCell::new(None),
                comp_sink: RefCell::new(None),
                window: RefCell::new(None),
                thread_cookie: Cell::new(None),
                edit_sink: RefCell::new(None),
                context: RefCell::new(None),
                caret: RefCell::new(None),
                shift_down: Cell::new(None),
                shadow: RefCell::new(Vec::new()),
            }),
        }
    }
}

impl ITfTextInputProcessor_Impl for TextService_Impl {
    fn Activate(&self, ptim: Ref<ITfThreadMgr>, tid: u32) -> windows_core::Result<()> {
        self.ActivateEx(ptim, tid, 0)
    }

    fn Deactivate(&self) -> windows_core::Result<()> {
        let st = &self.st;
        // 打到一半的碼拿掉
        if st.composition.borrow().is_some() {
            if let Some(ctx) = st.context.borrow().clone() {
                st.run(&ctx, |m, d| {
                    d.cancel();
                    m.reset();
                });
            }
        }
        st.save();
        let tm = st.thread_mgr.borrow_mut().take();
        if let Some(tm) = tm {
            unsafe {
                if let Ok(km) = tm.cast::<ITfKeystrokeMgr>() {
                    for (g, k, _) in preserved() {
                        let _ = km.UnpreserveKey(&g, &k);
                    }
                    let _ = km.UnadviseKeyEventSink(st.client.get());
                }
                if let (Some(cookie), Ok(src)) = (st.thread_cookie.take(), tm.cast::<ITfSource>()) {
                    let _ = src.UnadviseSink(cookie);
                }
            }
        }
        st.watch(None);
        *st.window.borrow_mut() = None;
        *st.comp_sink.borrow_mut() = None;
        *st.composition.borrow_mut() = None;
        *st.context.borrow_mut() = None;
        *st.caret.borrow_mut() = None;
        Ok(())
    }
}

impl ITfTextInputProcessorEx_Impl for TextService_Impl {
    fn ActivateEx(&self, ptim: Ref<ITfThreadMgr>, tid: u32, _flags: u32) -> windows_core::Result<()> {
        let r = start(&self.st, ptim.ok()?, tid);
        // 啟用到一半失敗：已經接上的都拿掉（TSF 不會再呼叫 Deactivate）
        if r.is_err() {
            let _ = self.Deactivate();
        }
        r
    }
}

fn start(st: &Rc<State>, tm: &ITfThreadMgr, tid: u32) -> windows_core::Result<()> {
    *st.thread_mgr.borrow_mut() = Some(tm.clone());
    st.client.set(tid);
    let (prefs, zh) = settings::load();
    *st.machine.borrow_mut() = Machine::new(prefs, zh, settings::load_learned());
    // 字典第一次用到時才解析，先在背景準備好
    std::thread::spawn(|| {
        crate::engine::predict::data();
    });
    *st.comp_sink.borrow_mut() = Some(CompSink { st: st.clone() }.into());
    let weak: Weak<State> = Rc::downgrade(st);
    *st.window.borrow_mut() = CandWindow::new(Rc::new(move |hit| {
        if let Some(st) = weak.upgrade() {
            st.on_hit(hit);
        }
    }));
    unsafe {
        let src = tm.cast::<ITfSource>()?;
        let ts: IUnknown = ThreadSink { st: st.clone() }.into();
        st.thread_cookie.set(Some(src.AdviseSink(&ITfThreadMgrEventSink::IID, &ts)?));
        let focus = tm.GetFocus().ok();
        st.watch(focus.as_ref());
        let km = tm.cast::<ITfKeystrokeMgr>()?;
        let ks: ITfKeyEventSink = KeySink { st: st.clone() }.into();
        km.AdviseKeyEventSink(tid, &ks, true)?;
        for (g, k, desc) in preserved() {
            let d: Vec<u16> = desc.encode_utf16().collect();
            let _ = km.PreserveKey(tid, &g, &k, &d);
        }
    }
    Ok(())
}

/// Windows 設定裡這個鍵盤的「選項」
impl ITfFunction_Impl for TextService_Impl {
    fn GetDisplayName(&self) -> windows_core::Result<BSTR> {
        Ok(BSTR::from("Banyan IME Settings"))
    }
}

impl ITfFnConfigure_Impl for TextService_Impl {
    fn Show(&self, parent: HWND, _langid: u16, _profile: *const GUID) -> windows_core::Result<()> {
        super::config::show((!parent.is_invalid()).then_some(parent));
        self.st.reload();
        Ok(())
    }
}

// ─── 按鍵 ───

#[implement(ITfKeyEventSink)]
struct KeySink {
    st: Rc<State>,
}

impl KeySink {
    /// 這個鍵要不要吃掉；不吃的鍵順便讓 Machine 知道（關掉候選列等）
    fn test(&self, ctx: Option<&ITfContext>, wp: WPARAM, lp: LPARAM) -> bool {
        let st = &self.st;
        if keys::vk(wp) == VK_SHIFT {
            if st.shift_down.get().is_none() {
                st.shift_down.set(Some(Instant::now()));
            }
            return false;
        }
        st.shift_down.set(None);
        if !ctx.is_some_and(usable) {
            debug!("key {:#x} skipped: context {}", wp.0, if ctx.is_some() { "not usable" } else { "none" });
            return false;
        }
        let ev = keys::event(wp, lp);
        let eat = st.machine.try_borrow().is_ok_and(|m| m.test(&ev));
        debug!("key {ev:?} eat={eat}");
        if !eat {
            if let Ok(mut m) = st.machine.try_borrow_mut() {
                m.pass(&ev);
            }
            // App 自己處理的鍵：記住的字跟著改（看不出結果的就清掉）
            if !ev.ctrl && !ev.alt {
                let mut sh = st.shadow.borrow_mut();
                match ev.key {
                    Key::Backspace => {
                        sh.pop();
                    }
                    Key::Enter => sh.push('\n'),
                    Key::Other => {}
                    _ => sh.clear(),
                }
            } else if !matches!(ev.key, Key::Other) {
                st.shadow.borrow_mut().clear();
            }
            st.refresh(None);
        }
        eat
    }

    /// 放開 Shift：單獨按一下就切換中／英（TestKeyUp、KeyUp 可能都會來，用 take 只算一次）
    fn key_up(&self, ctx: Option<&ITfContext>, wp: WPARAM) {
        if keys::vk(wp) != VK_SHIFT {
            return;
        }
        let tap = self.st.shift_down.take().is_some_and(|t| t.elapsed() < SHIFT_TAP);
        let Some(ctx) = ctx.filter(|c| tap && usable(c)) else { return };
        debug!("shift tap: toggle");
        self.st.run(ctx, |m, d| {
            m.toggle(d);
            settings::save_mode(m.zh(), m.prefs.scheme);
        });
    }
}

impl ITfKeyEventSink_Impl for KeySink_Impl {
    /// 程式回到前景：重新讀設定（可能剛在設定視窗改過）
    fn OnSetFocus(&self, fg: BOOL) -> windows_core::Result<()> {
        if fg.as_bool() {
            self.st.reload();
        }
        Ok(())
    }

    fn OnTestKeyDown(&self, pic: Ref<ITfContext>, wp: WPARAM, lp: LPARAM) -> windows_core::Result<BOOL> {
        Ok(self.test(pic.as_ref(), wp, lp).into())
    }

    fn OnKeyDown(&self, pic: Ref<ITfContext>, wp: WPARAM, lp: LPARAM) -> windows_core::Result<BOOL> {
        if !self.test(pic.as_ref(), wp, lp) {
            return Ok(false.into());
        }
        let ev = keys::event(wp, lp);
        self.st.run(pic.ok()?, move |m, d| {
            m.key(&ev, d);
        });
        Ok(true.into())
    }

    /// 放開 Shift 時切換中／英，但不吃掉放開的鍵：吃掉的話 App 收不到，以為 Shift 一直按著（之後打的字全變大寫）
    fn OnTestKeyUp(&self, pic: Ref<ITfContext>, wp: WPARAM, _lp: LPARAM) -> windows_core::Result<BOOL> {
        self.key_up(pic.as_ref(), wp);
        Ok(false.into())
    }

    fn OnKeyUp(&self, pic: Ref<ITfContext>, wp: WPARAM, _lp: LPARAM) -> windows_core::Result<BOOL> {
        self.key_up(pic.as_ref(), wp);
        Ok(false.into())
    }

    fn OnPreservedKey(&self, pic: Ref<ITfContext>, rguid: *const GUID) -> windows_core::Result<BOOL> {
        let Some(ctx) = pic.as_ref().filter(|c| usable(c)) else { return Ok(false.into()) };
        let g = unsafe { *rguid };
        if g == KEY_SCHEME {
            self.st.run(ctx, |m, d| {
                m.switch_scheme(d);
                settings::save_mode(m.zh(), m.prefs.scheme);
            });
            return Ok(true.into());
        }
        let n = g.to_u128().wrapping_sub(KEY_DIGIT_BASE);
        if n < 10 && self.st.machine.try_borrow().is_ok_and(|m| m.digits_pick()) {
            let digit = char::from(b'0' + n as u8);
            self.st.run(ctx, move |m, d| m.type_digit(digit, d));
            return Ok(true.into());
        }
        Ok(false.into())
    }
}

// ─── 焦點、組字、文字改變 ───

#[implement(ITfThreadMgrEventSink)]
struct ThreadSink {
    st: Rc<State>,
}

impl ITfThreadMgrEventSink_Impl for ThreadSink_Impl {
    fn OnInitDocumentMgr(&self, _dim: Ref<ITfDocumentMgr>) -> windows_core::Result<()> {
        Ok(())
    }
    fn OnUninitDocumentMgr(&self, _dim: Ref<ITfDocumentMgr>) -> windows_core::Result<()> {
        Ok(())
    }
    fn OnSetFocus(&self, focus: Ref<ITfDocumentMgr>, _prev: Ref<ITfDocumentMgr>) -> windows_core::Result<()> {
        self.st.reset();
        self.st.save();
        self.st.reload();
        self.st.watch(focus.as_ref());
        Ok(())
    }
    fn OnPushContext(&self, _pic: Ref<ITfContext>) -> windows_core::Result<()> {
        Ok(())
    }
    fn OnPopContext(&self, _pic: Ref<ITfContext>) -> windows_core::Result<()> {
        Ok(())
    }
}

#[implement(ITfCompositionSink)]
struct CompSink {
    st: Rc<State>,
}

impl ITfCompositionSink_Impl for CompSink_Impl {
    /// App 自己結束了組字（點了別的地方、換了焦點）
    fn OnCompositionTerminated(&self, _ec: u32, _comp: Ref<ITfComposition>) -> windows_core::Result<()> {
        *self.st.composition.borrow_mut() = None;
        self.st.reset();
        Ok(())
    }
}

#[implement(ITfTextEditSink)]
struct EditSink {
    st: Rc<State>,
}

impl ITfTextEditSink_Impl for EditSink_Impl {
    fn OnEndEdit(&self, pic: Ref<ITfContext>, ec: u32, rec: Ref<ITfEditRecord>) -> windows_core::Result<()> {
        let st = &self.st;
        let (Some(ctx), Some(rec)) = (pic.as_ref(), rec.as_ref()) else { return Ok(()) };
        if !unsafe { rec.GetSelectionStatus() }.is_ok_and(|b| b.as_bool()) || st.composition.borrow().is_some() {
            return Ok(());
        }
        let busy = st.machine.try_borrow().is_ok_and(|m| m.list().is_some());
        if !busy {
            return Ok(());
        }
        let moved = unsafe {
            let mut sel = [TF_SELECTION::default()];
            let mut n = 0u32;
            let cur = if ctx.GetSelection(ec, TF_DEFAULT_SELECTION, &mut sel, &mut n).is_ok() && n > 0 {
                std::mem::ManuallyDrop::take(&mut sel[0].range)
            } else {
                None
            };
            let last = st.caret.borrow().clone();
            match (cur, last) {
                (Some(c), Some(l)) => {
                    !(c.IsEqualStart(ec, &l, TF_ANCHOR_START).is_ok_and(|b| b.as_bool())
                        && c.IsEqualEnd(ec, &l, TF_ANCHOR_END).is_ok_and(|b| b.as_bool()))
                }
                _ => true,
            }
        };
        if moved {
            st.reset();
        }
        Ok(())
    }
}
