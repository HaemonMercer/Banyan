//! 虛擬鍵 → `KeyEv`：會打出字的鍵依目前的鍵盤配置換成字（`ToUnicodeEx`，不改鍵盤狀態）。

use windows::Win32::Foundation::{LPARAM, WPARAM};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetKeyState, GetKeyboardLayout, GetKeyboardState, ToUnicodeEx, VIRTUAL_KEY, VK_BACK, VK_CONTROL, VK_DELETE, VK_DOWN,
    VK_END, VK_ESCAPE, VK_HOME, VK_LEFT, VK_MENU, VK_NEXT, VK_PRIOR, VK_RETURN, VK_RIGHT, VK_SHIFT, VK_TAB, VK_UP,
};

use crate::engine::machine::{Key, KeyEv};

fn down(vk: VIRTUAL_KEY) -> bool {
    unsafe { GetKeyState(vk.0 as i32) as u16 & 0x8000 != 0 }
}

pub fn vk(wparam: WPARAM) -> VIRTUAL_KEY {
    VIRTUAL_KEY(wparam.0 as u16)
}

pub fn event(wparam: WPARAM, lparam: LPARAM) -> KeyEv {
    let v = vk(wparam);
    let shift = down(VK_SHIFT);
    let ctrl = down(VK_CONTROL);
    let alt = down(VK_MENU);
    let key = match v {
        VK_BACK => Key::Backspace,
        VK_ESCAPE => Key::Escape,
        VK_RETURN => Key::Enter,
        VK_TAB => Key::Tab,
        VK_LEFT => Key::Left,
        VK_RIGHT => Key::Right,
        VK_UP => Key::Up,
        VK_DOWN => Key::Down,
        VK_PRIOR => Key::PageUp,
        VK_NEXT => Key::PageDown,
        VK_HOME => Key::Home,
        VK_END => Key::End,
        VK_DELETE => Key::Delete,
        _ if ctrl || alt => Key::Other,
        _ => to_char(v, lparam).map_or(Key::Other, Key::Char),
    };
    KeyEv { key, shift, ctrl, alt }
}

fn to_char(v: VIRTUAL_KEY, lparam: LPARAM) -> Option<char> {
    let mut state = [0u8; 256];
    unsafe { GetKeyboardState(&mut state).ok()? };
    let scan = ((lparam.0 >> 16) & 0xff) as u32;
    let mut buf = [0u16; 8];
    // 旗標 4：不改變鍵盤狀態（不吃掉 dead key）
    let n = unsafe { ToUnicodeEx(v.0 as u32, scan, &state, &mut buf, 4, Some(GetKeyboardLayout(0))) };
    if n != 1 {
        return None;
    }
    let c = char::from_u32(buf[0] as u32)?;
    (!c.is_control()).then_some(c)
}
