//! The title bar and taskbar icons, drawn at the size Windows shows them.
//!
//! Tauri makes every window's icon from the first picture in `icons/icon.ico` and leaves
//! Windows to stretch that one picture to the title bar's and taskbar's sizes, which comes out
//! jagged or smeared. The exe carries the whole `.ico` as resource 32512 (tauri-build), so each
//! window loads the picture made for its own size and DPI instead.
use tauri::{plugin::TauriPlugin, Runtime, Window};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, WPARAM},
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi},
        WindowsAndMessaging::{
            LoadImageW, SendMessageW, ICON_BIG, ICON_SMALL, IMAGE_ICON, LR_DEFAULTCOLOR,
            SM_CXICON, SM_CXSMICON, SM_CYICON, SM_CYSMICON, WM_SETICON,
        },
    },
};

/// The resource id tauri-build gives the app's `.ico` (`IDI_APPLICATION`).
const APP_ICON: usize = 32512;

/// Sets each new window's icons; `app::plugins` also calls [`apply`] when a window's DPI changes.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("misty-window-icon")
        .on_window_ready(|window| apply(&window))
        .build()
}

/// Gives `window` the `.ico`'s pictures for its title bar (small) and taskbar (big) at its DPI.
pub fn apply<R: Runtime>(window: &Window<R>) {
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let hwnd = hwnd.0 as HWND;
    unsafe {
        let module = GetModuleHandleW(std::ptr::null());
        let dpi = GetDpiForWindow(hwnd);
        if module.is_null() || dpi == 0 {
            return;
        }
        for (kind, width, height) in [
            (ICON_SMALL, SM_CXSMICON, SM_CYSMICON),
            (ICON_BIG, SM_CXICON, SM_CYICON),
        ] {
            // Icons from LoadImageW without LR_SHARED are the window's to keep; the one it
            // replaces was Tauri's, which Tauri still owns, so nothing is destroyed here.
            let icon = LoadImageW(
                module,
                APP_ICON as *const u16,
                IMAGE_ICON,
                GetSystemMetricsForDpi(width, dpi),
                GetSystemMetricsForDpi(height, dpi),
                LR_DEFAULTCOLOR,
            );
            if !icon.is_null() {
                SendMessageW(hwnd, WM_SETICON, kind as WPARAM, icon as LPARAM);
            }
        }
    }
}
