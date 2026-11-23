use windows_sys::Win32::{
    System::SystemInformation::{GetVersionExW, OSVERSIONINFOW},
    UI::{
        Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_LWIN,
        },
        WindowsAndMessaging::GetForegroundWindow,
    },
};

fn has_snap_layouts() -> bool {
    // SAFETY: a plain out-structure with its size set.
    let mut version: OSVERSIONINFOW = unsafe { std::mem::zeroed() };
    version.dwOSVersionInfoSize = std::mem::size_of::<OSVERSIONINFOW>() as u32;
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

#[tauri::command]
pub fn window_show_snap_layouts(webview: tauri::Webview) -> Result<(), String> {
    let window = webview.window();
    if !crate::browser::app_windows::is_person_window(window.label()) || !has_snap_layouts() {
        return Ok(());
    }
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    // SAFETY: no arguments.
    if !std::ptr::eq(unsafe { GetForegroundWindow() }, hwnd.0 as _) {
        return Ok(());
    }
    const Z: u16 = b'Z' as u16;
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
