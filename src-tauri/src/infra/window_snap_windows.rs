//! The Snap Layouts flyout for Misty's own maximize button. Windows shows it
//! when the pointer rests on a window's maximize button, but Misty draws its
//! own caption buttons in the page, where Windows can't see them. Win+Z, the
//! system's shortcut for the same flyout, opens it for the window the person
//! is using.
use windows_sys::Win32::{
    System::SystemInformation::{GetVersionExW, OSVERSIONINFOW},
    UI::{
        Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_LWIN,
        },
        WindowsAndMessaging::GetForegroundWindow,
    },
};

/// Windows 11, whose first build is 22000, introduced Snap Layouts.
fn has_snap_layouts() -> bool {
    // SAFETY: a plain out-structure with its size set.
    let mut version: OSVERSIONINFOW = unsafe { std::mem::zeroed() };
    version.dwOSVersionInfoSize = std::mem::size_of::<OSVERSIONINFOW>() as u32;
    // Misty's manifest declares Windows 10 and 11, so the real build comes back.
    (unsafe { GetVersionExW(&mut version) } != 0) && version.dwBuildNumber >= 22000
}

fn key(code: u16, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: code,
                wScan: 0,
                dwFlags: if up { KEYEVENTF_KEYUP } else { 0 },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

/// Opens Snap Layouts for Misty's main window while it is the window in use.
#[tauri::command]
pub fn window_show_snap_layouts(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" || !has_snap_layouts() {
        return Ok(());
    }
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    // SAFETY: no arguments.
    if !std::ptr::eq(unsafe { GetForegroundWindow() }, hwnd.0 as _) {
        return Ok(());
    }
    const Z: u16 = b'Z' as u16;
    // One call, so nothing the person types lands between the keys.
    let keys = [
        key(VK_LWIN, false),
        key(Z, false),
        key(Z, true),
        key(VK_LWIN, true),
    ];
    // SAFETY: a live array of initialized inputs.
    let sent = unsafe {
        SendInput(
            keys.len() as u32,
            keys.as_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        )
    };
    if sent as usize != keys.len() {
        return Err("Windows didn't open Snap Layouts.".into());
    }
    Ok(())
}
