//! Low-level keyboard and mouse hooks. Injected input (including Misty's own
//! paste) is ignored.
use super::{Input, Modifiers};
use std::{cell::RefCell, ptr::null_mut};
use windows_sys::Win32::{
    Foundation::*,
    UI::{Input::KeyboardAndMouse::*, WindowsAndMessaging::*},
};

/// AltGr sends a fake Left Ctrl with this scan code before Right Alt; it must
/// not satisfy a Control chord.
const ALTGR_FAKE_CONTROL_SCAN: u32 = 0x21D;

/// Applies one key event to the held modifiers. Returns false for keys that
/// aren't modifiers.
pub(crate) fn apply(modifiers: &mut Modifiers, vk: u16, scan: u32, down: bool) -> bool {
    match vk {
        VK_LCONTROL if scan == ALTGR_FAKE_CONTROL_SCAN => {}
        VK_LCONTROL => modifiers.left_control = down,
        VK_RCONTROL => modifiers.right_control = down,
        VK_LMENU => modifiers.left_option = down,
        VK_RMENU => modifiers.right_option = down,
        VK_LWIN => modifiers.left_command = down,
        VK_RWIN => modifiers.right_command = down,
        VK_LSHIFT | VK_RSHIFT | VK_SHIFT => modifiers.shift = down,
        _ => return false,
    }
    true
}

pub(crate) fn current_modifiers() -> Modifiers {
    let down = |vk: u16| unsafe { GetAsyncKeyState(vk as i32) } as u16 & 0x8000 != 0;
    Modifiers {
        left_control: down(VK_LCONTROL),
        right_control: down(VK_RCONTROL),
        left_option: down(VK_LMENU),
        right_option: down(VK_RMENU),
        left_command: down(VK_LWIN),
        right_command: down(VK_RWIN),
        shift: down(VK_LSHIFT) || down(VK_RSHIFT),
        function: false,
    }
}

/// The dispatcher and the modifiers it last saw, owned by the hook thread.
type HookState = Option<(fn(Input), Modifiers)>;

thread_local! {
    static STATE: RefCell<HookState> = const { RefCell::new(None) };
}

unsafe extern "system" fn keyboard(code: i32, message: WPARAM, data: LPARAM) -> LRESULT {
    if code >= 0 {
        let event = &*(data as *const KBDLLHOOKSTRUCT);
        if event.flags & LLKHF_INJECTED == 0 {
            let down = matches!(message as u32, WM_KEYDOWN | WM_SYSKEYDOWN);
            STATE.with(|state| {
                if let Some((dispatch, modifiers)) = state.borrow_mut().as_mut() {
                    // A key-up the hook never saw (another hook swallowed it, or focus moved
                    // while Alt was down) would leave a modifier "held" for good, and the chord
                    // could not be pressed again. Drop any modifier the system says is up. The
                    // system's state never sets one: AltGr's fake Control must stay out.
                    let system = current_modifiers();
                    modifiers.left_control &= system.left_control;
                    modifiers.right_control &= system.right_control;
                    modifiers.left_option &= system.left_option;
                    modifiers.right_option &= system.right_option;
                    modifiers.left_command &= system.left_command;
                    modifiers.right_command &= system.right_command;
                    modifiers.shift &= system.shift;
                    if apply(modifiers, event.vkCode as u16, event.scanCode, down) {
                        dispatch(Input::Modifiers(*modifiers));
                    } else if down {
                        dispatch(Input::KeyboardActivity);
                    }
                }
            });
        }
    }
    CallNextHookEx(null_mut(), code, message, data)
}

unsafe extern "system" fn mouse(code: i32, message: WPARAM, data: LPARAM) -> LRESULT {
    if code >= 0 && message as u32 == WM_LBUTTONDOWN {
        let event = &*(data as *const MSLLHOOKSTRUCT);
        if event.flags & LLMHF_INJECTED == 0 {
            STATE.with(|state| {
                if let Some((dispatch, _)) = state.borrow().as_ref() {
                    dispatch(Input::Click(event.pt.x as f64, event.pt.y as f64));
                }
            });
        }
    }
    CallNextHookEx(null_mut(), code, message, data)
}

pub(crate) fn run(dispatch: fn(Input)) {
    STATE.with(|state| *state.borrow_mut() = Some((dispatch, Modifiers::default())));
    unsafe {
        let keys = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard), null_mut(), 0);
        if keys.is_null() {
            dispatch(Input::Error(
                "Voice shortcuts couldn't start. Restart Misty.".into(),
            ));
            return;
        }
        // Walkthroughs fall back to "next" by voice or text without click hints.
        let clicks = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse), null_mut(), 0);
        let mut message: MSG = std::mem::zeroed();
        while GetMessageW(&mut message, null_mut(), 0, 0) > 0 {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        if !clicks.is_null() {
            UnhookWindowsHookEx(clicks);
        }
        UnhookWindowsHookEx(keys);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn altgr_does_not_count_as_control() {
        let mut modifiers = Modifiers::default();
        assert!(apply(
            &mut modifiers,
            VK_LCONTROL,
            ALTGR_FAKE_CONTROL_SCAN,
            true
        ));
        assert!(apply(&mut modifiers, VK_RMENU, 0x138, true));
        assert!(!modifiers.left_control && modifiers.right_option);
        assert!(apply(&mut modifiers, VK_LCONTROL, 0x1D, true));
        assert!(modifiers.left_control);
        assert!(!apply(&mut modifiers, 0x41, 0x1E, true));
    }
}
