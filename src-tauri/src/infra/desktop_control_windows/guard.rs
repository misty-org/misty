//! The keyboard guard while Misty has control: Escape, or the stop shortcut,
//! from the person ends control at once. Keys Misty sends carry its tag and
//! pass through.
use super::*;

/// Watches the person's keyboard while Misty controls the desktop: Escape
/// stops control and goes no further; the voice shortcut (Ctrl+Alt) stops it
/// too. Everything else passes through untouched.
pub(super) fn start_guard() -> Result<(), String> {
    if GUARD_THREAD.load(Ordering::Acquire) != 0 {
        return Ok(());
    }
    let (ready, started) = std::sync::mpsc::channel();
    thread::Builder::new()
        .name("misty-desktop-guard".into())
        .spawn(move || {
            // SAFETY: a low-level hook owned by this thread, which runs its
            // message loop until told to quit and then removes it.
            unsafe {
                let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(guard), std::ptr::null_mut(), 0);
                if hook.is_null() {
                    let _ = ready.send(false);
                    return;
                }
                GUARD_THREAD.store(GetCurrentThreadId(), Ordering::Release);
                let _ = ready.send(true);
                let mut message: MSG = std::mem::zeroed();
                while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
                    TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
                UnhookWindowsHookEx(hook);
            }
        })
        .map_err(|_| "Desktop control could not start.".to_owned())?;
    match started.recv_timeout(Duration::from_secs(2)) {
        Ok(true) => Ok(()),
        _ => Err("Desktop control could not watch for Escape, so it did not start.".into()),
    }
}

pub(super) fn end_guard() {
    let thread = GUARD_THREAD.swap(0, Ordering::AcqRel);
    if thread != 0 {
        // SAFETY: asks the guard thread's message loop to end.
        unsafe { PostThreadMessageW(thread, WM_QUIT, 0, 0) };
    }
}

pub(super) static MODIFIERS: Mutex<[bool; 4]> = Mutex::new([false; 4]);

pub(super) unsafe extern "system" fn guard(code: i32, message: WPARAM, data: LPARAM) -> LRESULT {
    if code >= 0 && CONTROLLING.load(Ordering::Acquire) {
        let event = &*(data as *const KBDLLHOOKSTRUCT);
        let person = event.flags & LLKHF_INJECTED == 0 && event.dwExtraInfo != AGENT_TAG;
        let down = matches!(message as u32, WM_KEYDOWN | WM_SYSKEYDOWN);
        let up = matches!(message as u32, WM_KEYUP | WM_SYSKEYUP);
        if person && event.vkCode == u32::from(VK_ESCAPE) {
            if down {
                // Never stop inside the hook: it must return quickly.
                thread::spawn(|| {
                    stop_by_person("Desktop control stopped with Escape. You have control.")
                });
            }
            return 1;
        }
        if person && (down || up) {
            let index = match event.vkCode as VIRTUAL_KEY {
                VK_LCONTROL => Some(0),
                VK_RCONTROL => Some(1),
                VK_LMENU => Some(2),
                VK_RMENU => Some(3),
                _ => None,
            };
            if let Some(index) = index {
                let held = MODIFIERS.lock().map(|mut keys| {
                    keys[index] = down;
                    (keys[0] || keys[1]) && (keys[2] || keys[3])
                });
                if held.unwrap_or(false) {
                    thread::spawn(|| {
                        stop_by_person("Desktop control interrupted by the voice shortcut.")
                    });
                }
            }
        }
    }
    CallNextHookEx(std::ptr::null_mut(), code, message, data)
}
