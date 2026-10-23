//! Change notices for drives arriving and leaving.
use std::{mem, ptr, thread};

use tauri::{AppHandle, Emitter, Wry};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    System::LibraryLoader::GetModuleHandleW,
    UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, GetWindowLongPtrW,
        RegisterClassW, SetWindowLongPtrW, TranslateMessage, DBT_DEVICEARRIVAL,
        DBT_DEVICEREMOVECOMPLETE, DBT_DEVTYP_VOLUME, DEV_BROADCAST_HDR, GWLP_USERDATA, MSG,
        WM_DEVICECHANGE, WNDCLASSW, WS_OVERLAPPED,
    },
};

use crate::{infra::drives::DEVICES_CHANGED_EVENT, platform::shared_windows::wide};

/// Emits `DEVICES_CHANGED_EVENT` whenever a volume or network drive arrives or
/// leaves. Volume notices are broadcast only to top-level windows, so this uses
/// a hidden one rather than a message-only window.
pub fn start_device_change_listener(app: AppHandle<Wry>) {
    let _ = thread::Builder::new()
        .name("misty-device-change-listener".to_owned())
        .spawn(move || {
            let class = wide("MistyDeviceChangeListener");
            // SAFETY: a window class and hidden window owned by this thread,
            // which runs its message loop for the life of the app. The app
            // handle lives in a leaked box that the window procedure borrows.
            unsafe {
                let instance = GetModuleHandleW(ptr::null());
                let mut window_class: WNDCLASSW = mem::zeroed();
                window_class.lpfnWndProc = Some(device_window_proc);
                window_class.hInstance = instance;
                window_class.lpszClassName = class.as_ptr();
                if RegisterClassW(&window_class) == 0 {
                    return;
                }
                let window = CreateWindowExW(
                    0,
                    class.as_ptr(),
                    class.as_ptr(),
                    WS_OVERLAPPED,
                    0,
                    0,
                    0,
                    0,
                    ptr::null_mut(),
                    ptr::null_mut(),
                    instance,
                    ptr::null(),
                );
                if window.is_null() {
                    return;
                }
                SetWindowLongPtrW(window, GWLP_USERDATA, Box::into_raw(Box::new(app)) as isize);
                let mut message: MSG = mem::zeroed();
                while GetMessageW(&mut message, ptr::null_mut(), 0, 0) > 0 {
                    TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            }
        });
}

unsafe extern "system" fn device_window_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_DEVICECHANGE
        && matches!(wparam as u32, DBT_DEVICEARRIVAL | DBT_DEVICEREMOVECOMPLETE)
        && lparam != 0
        && (*(lparam as *const DEV_BROADCAST_HDR)).dbch_devicetype == DBT_DEVTYP_VOLUME
    {
        let app = GetWindowLongPtrW(window, GWLP_USERDATA) as *const AppHandle<Wry>;
        if let Some(app) = app.as_ref() {
            let _ = app.emit(DEVICES_CHANGED_EVENT, ());
        }
    }
    DefWindowProcW(window, message, wparam, lparam)
}
