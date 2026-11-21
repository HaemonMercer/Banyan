//! Edit session：TSF 只在 edit session 裡讓文字服務讀寫文件。`edit` 把一個閉包包成 session 送出
//! （先試同步，App 不允許時改非同步），`TsfDoc` 是 `engine::machine::Doc` 的 TSF 實作。

use std::cell::RefCell;
use std::mem::ManuallyDrop;

use windows::Win32::Foundation::RECT;
use windows::Win32::UI::TextServices::{
    ITfContext, ITfContextComposition, ITfEditSession, ITfEditSession_Impl, ITfInsertAtSelection, ITfRange, TF_AE_NONE,
    TF_ANCHOR_END, TF_ANCHOR_START, TF_DEFAULT_SELECTION, TF_ES_ASYNC, TF_ES_READWRITE, TF_ES_SYNC, TF_IAS_QUERYONLY,
    TF_SELECTION, TF_SELECTIONSTYLE, TS_SS_TRANSITORY,
};
use windows_core::{BOOL, Interface, implement};

use super::service::State;
use crate::engine::machine::Doc;

#[implement(ITfEditSession)]
struct Session {
    f: RefCell<Option<Box<dyn FnOnce(u32)>>>,
}

impl ITfEditSession_Impl for Session_Impl {
    fn DoEditSession(&self, ec: u32) -> windows_core::Result<()> {
        let f = self.f.try_borrow_mut().ok().and_then(|mut f| f.take());
        if let Some(f) = f {
            f(ec);
        }
        Ok(())
    }
}

/// 在 ctx 上開一個可以寫的 edit session 執行 f（拿到 edit cookie）
pub fn edit(ctx: &ITfContext, client: u32, f: impl FnOnce(u32) + 'static) {
    let s: ITfEditSession = Session { f: RefCell::new(Some(Box::new(f))) }.into();
    unsafe {
        let sync = ctx.RequestEditSession(client, &s, TF_ES_SYNC | TF_ES_READWRITE);
        debug!("sync session: {sync:?}");
        if !matches!(sync, Ok(hr) if hr.is_ok()) {
            let _ = ctx.RequestEditSession(client, &s, TF_ES_ASYNC | TF_ES_READWRITE);
        }
    }
}

/// 游標前最多讀幾個字
const BEFORE: i32 = 300;

pub struct TsfDoc<'a> {
    pub ec: u32,
    pub ctx: &'a ITfContext,
    pub state: &'a State,
    /// 暫時的文件（CUAS 替舊程式做的）：裡面只有組字，讀不到游標前的字，改用 `State::shadow`
    transitory: bool,
}

impl<'a> TsfDoc<'a> {
    pub fn new(ec: u32, ctx: &'a ITfContext, state: &'a State) -> TsfDoc<'a> {
        let transitory = unsafe { ctx.GetStatus() }.is_ok_and(|s| s.dwStaticFlags & TS_SS_TRANSITORY != 0);
        TsfDoc { ec, ctx, state, transitory }
    }

    /// 送出的字記到 shadow
    fn typed(&self, remove: usize, text: &str) {
        let mut sh = self.state.shadow.borrow_mut();
        let n = sh.len().saturating_sub(remove);
        sh.truncate(n);
        sh.extend(text.chars());
        let over = sh.len().saturating_sub(BEFORE as usize);
        sh.drain(..over);
    }
}

impl TsfDoc<'_> {
    fn selection(&self) -> Option<ITfRange> {
        let mut sel = [TF_SELECTION::default()];
        let mut n = 0u32;
        unsafe { self.ctx.GetSelection(self.ec, TF_DEFAULT_SELECTION, &mut sel, &mut n).ok()? };
        if n == 0 {
            return None;
        }
        unsafe { ManuallyDrop::take(&mut sel[0].range) }
    }

    fn set_caret(&self, r: &ITfRange) {
        unsafe {
            let Ok(c) = r.Clone() else { return };
            let _ = c.Collapse(self.ec, TF_ANCHOR_END);
            let mut s = TF_SELECTION {
                range: ManuallyDrop::new(Some(c)),
                style: TF_SELECTIONSTYLE { ase: TF_AE_NONE, fInterimChar: BOOL(0) },
            };
            let _ = self.ctx.SetSelection(self.ec, std::slice::from_ref(&s));
            ManuallyDrop::drop(&mut s.range);
        }
    }

    fn comp_range(&self) -> Option<ITfRange> {
        let c = self.state.composition.borrow().clone()?;
        unsafe { c.GetRange().ok() }
    }

    fn text(&self, r: &ITfRange) -> Option<String> {
        let mut buf = vec![0u16; BEFORE as usize + 8];
        let mut n = 0u32;
        unsafe { r.GetText(self.ec, 0, &mut buf, &mut n).ok()? };
        Some(String::from_utf16_lossy(&buf[..n as usize]))
    }

    /// 游標前 remove 個字（char）佔幾個 UTF-16 單位（TSF 的位置是 UTF-16）
    fn units(&mut self, remove: usize) -> i32 {
        let b = self.before().unwrap_or_default();
        b[b.len().saturating_sub(remove)..].iter().map(|c| c.len_utf16() as i32).sum()
    }

    /// 組字中的範圍或游標（候選視窗的位置用）的畫面座標
    pub fn caret_rect(&self) -> Option<RECT> {
        let r = self.comp_range().or_else(|| self.selection())?;
        unsafe {
            let view = self.ctx.GetActiveView().ok()?;
            let mut rc = RECT::default();
            let mut clipped = BOOL(0);
            view.GetTextExt(self.ec, &r, &mut rc, &mut clipped).ok()?;
            Some(rc)
        }
    }

    /// 現在的游標（之後比對使用者有沒有移動游標）
    pub fn caret(&self) -> Option<ITfRange> {
        self.selection()
    }
}

impl Doc for TsfDoc<'_> {
    fn before(&mut self) -> Option<Vec<char>> {
        if self.transitory {
            return Some(self.state.shadow.borrow().clone());
        }
        let anchor = match self.comp_range() {
            Some(r) => r,
            None => {
                let Some(s) = self.selection() else {
                    debug!("before: no selection");
                    return None;
                };
                if !unsafe { s.IsEmpty(self.ec).ok()? }.as_bool() {
                    return None;
                }
                s
            }
        };
        unsafe {
            let r = anchor.Clone().ok()?;
            r.Collapse(self.ec, TF_ANCHOR_START).ok()?;
            let mut moved = 0i32;
            if let Err(e) = r.ShiftStart(self.ec, -BEFORE, &mut moved, std::ptr::null()) {
                debug!("before: ShiftStart {e:?}");
                return None;
            }
            let t = self.text(&r);
            debug!("before: {:?}", t.as_ref().map(|t| t.chars().rev().take(20).collect::<String>()));
            // RichEdit 的段落結尾是 \r：當成換行（字數不變，刪字的位置才對得上）
            Some(t?.chars().map(|c| if c == '\r' { '\n' } else { c }).collect())
        }
    }

    fn compose(&mut self, text: &str) {
        let w: Vec<u16> = text.encode_utf16().collect();
        unsafe {
            if self.state.composition.borrow().is_none() {
                let Ok(ias) = self.ctx.cast::<ITfInsertAtSelection>() else { return };
                let Ok(range) = ias.InsertTextAtSelection(self.ec, TF_IAS_QUERYONLY, &[]) else { return };
                let Ok(cc) = self.ctx.cast::<ITfContextComposition>() else { return };
                let sink = self.state.comp_sink.borrow().clone();
                let Ok(c) = cc.StartComposition(self.ec, &range, sink.as_ref()) else { return };
                *self.state.composition.borrow_mut() = Some(c);
            }
            let Some(r) = self.comp_range() else { return };
            let _ = r.SetText(self.ec, 0, &w);
            self.set_caret(&r);
        }
    }

    fn commit(&mut self, text: &str) {
        let Some(c) = self.state.composition.borrow_mut().take() else {
            self.insert(0, text);
            return;
        };
        self.typed(0, text);
        let w: Vec<u16> = text.encode_utf16().collect();
        unsafe {
            if let Ok(r) = c.GetRange() {
                let _ = r.SetText(self.ec, 0, &w);
                self.set_caret(&r);
            }
            let _ = c.EndComposition(self.ec);
        }
    }

    fn cancel(&mut self) {
        let Some(c) = self.state.composition.borrow_mut().take() else { return };
        unsafe {
            if let Ok(r) = c.GetRange() {
                let _ = r.SetText(self.ec, 0, &[]);
            }
            let _ = c.EndComposition(self.ec);
        }
    }

    fn can_remove(&self) -> bool {
        !self.transitory
    }

    fn insert(&mut self, remove: usize, text: &str) {
        self.typed(remove, text);
        let w: Vec<u16> = text.encode_utf16().collect();
        let units = if remove > 0 { self.units(remove) } else { 0 };
        unsafe {
            if units == 0 {
                // 一般打字：交給 App 插在選取的地方（必要時 TSF 會自己開一個組字，舊的 IMM32 程式也收得到）
                let Ok(ias) = self.ctx.cast::<ITfInsertAtSelection>() else { return };
                if let Ok(r) = ias.InsertTextAtSelection(self.ec, Default::default(), &w) {
                    self.set_caret(&r);
                }
                return;
            }
            let Some(s) = self.selection() else { return };
            let Ok(r) = s.Clone() else { return };
            let mut moved = 0i32;
            let _ = r.ShiftStart(self.ec, -units, &mut moved, std::ptr::null());
            if r.SetText(self.ec, 0, &w).is_ok() {
                self.set_caret(&r);
            } else if let Ok(ias) = self.ctx.cast::<ITfInsertAtSelection>() {
                // 刪不掉前面的字（唯讀範圍等）：至少把字打出來
                if let Ok(r) = ias.InsertTextAtSelection(self.ec, Default::default(), &w) {
                    self.set_caret(&r);
                }
            }
        }
    }
}
