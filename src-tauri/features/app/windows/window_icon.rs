use tauri::{plugin::TauriPlugin, Runtime, Window};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, WPARAM},
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi},
        WindowsAndMessaging::{
            LoadImageW, SendMessageW, ICON_BIG, ICON_SMALL, IMAGE_ICON, LR_DEFAULTCOLOR, SM_CXICON,
            SM_CXSMICON, SM_CYICON, SM_CYSMICON, WM_SETICON,
        },
    },
};

const APP_ICON: usize = 32512;

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("misty-window-icon")
        .on_window_ready(|window| apply(&window))
        .build()
}

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
