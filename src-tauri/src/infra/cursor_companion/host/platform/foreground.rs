//! The window the person works in, read from the system.

/// The window the person is working in, in the same global units as
/// displays and cursor samples.
#[derive(Clone, Debug, PartialEq)]
pub struct ForegroundWindow {
    /// HWND on Windows, the window number on macOS.
    pub handle: isize,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub app: String,
    pub title: String,
    /// The bounds of the display the system places the window on, when it says.
    pub monitor: Option<(f64, f64, f64, f64)>,
}

/// A window is usable when it has an area and is not one of Misty's own
/// companion, overlay or panel windows (`ignored`).
pub fn usable_foreground(window: ForegroundWindow, ignored: &[isize]) -> Option<ForegroundWindow> {
    (window.width >= 1. && window.height >= 1. && !ignored.contains(&window.handle))
        .then_some(window)
}

#[cfg(windows)]
pub fn foreground_window(ignored: &[isize]) -> Option<ForegroundWindow> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, RECT},
        Graphics::{
            Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS},
            Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST},
        },
        System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
            PROCESS_QUERY_LIMITED_INFORMATION,
        },
        UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId, IsIconic,
            IsWindowVisible,
        },
    };
    // SAFETY: plain queries on the foreground handle; every buffer outlives its call.
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() || IsWindowVisible(hwnd) == 0 || IsIconic(hwnd) != 0 {
            return None;
        }
        // The extended frame leaves out the invisible resize borders.
        let mut rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS as u32,
            (&mut rect as *mut RECT).cast(),
            std::mem::size_of::<RECT>() as u32,
        ) != 0
            && GetWindowRect(hwnd, &mut rect) == 0
        {
            return None;
        }
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let monitor = (!monitor.is_null() && GetMonitorInfoW(monitor, &mut info) != 0).then(|| {
            let m = info.rcMonitor;
            (
                m.left as f64,
                m.top as f64,
                (m.right - m.left) as f64,
                (m.bottom - m.top) as f64,
            )
        });
        let mut title = [0u16; 512];
        let length = GetWindowTextW(hwnd, title.as_mut_ptr(), title.len() as i32).max(0) as usize;
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        let mut app = String::new();
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if !process.is_null() {
            let mut path = [0u16; 1024];
            let mut size = path.len() as u32;
            if QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, path.as_mut_ptr(), &mut size)
                != 0
            {
                let path =
                    std::path::PathBuf::from(String::from_utf16_lossy(&path[..size as usize]));
                app = path
                    .file_stem()
                    .map(|stem| stem.to_string_lossy().into_owned())
                    .unwrap_or_default();
            }
            CloseHandle(process);
        }
        usable_foreground(
            ForegroundWindow {
                handle: hwnd as isize,
                x: rect.left as f64,
                y: rect.top as f64,
                width: (rect.right - rect.left) as f64,
                height: (rect.bottom - rect.top) as f64,
                app,
                title: String::from_utf16_lossy(&title[..length]),
                monitor,
            },
            ignored,
        )
    }
}

/// The frontmost app's frontmost ordinary window, read from the window list.
#[cfg(target_os = "macos")]
pub fn foreground_window(ignored: &[isize]) -> Option<ForegroundWindow> {
    unsafe extern "C" {
        fn misty_companion_foreground_window(
            ignored: *const i64,
            count: usize,
        ) -> *mut std::ffi::c_char;
    }
    let ignored_numbers: Vec<i64> = ignored.iter().map(|&n| n as i64).collect();
    let raw = unsafe {
        misty_companion_foreground_window(ignored_numbers.as_ptr(), ignored_numbers.len())
    };
    if raw.is_null() {
        return None;
    }
    let decoded = unsafe {
        serde_json::from_slice::<serde_json::Value>(std::ffi::CStr::from_ptr(raw).to_bytes())
    };
    unsafe {
        libc::free(raw.cast());
    }
    let value = decoded.ok()?;
    usable_foreground(
        ForegroundWindow {
            handle: value["number"].as_i64()? as isize,
            x: value["x"].as_f64()?,
            y: value["y"].as_f64()?,
            width: value["width"].as_f64()?,
            height: value["height"].as_f64()?,
            app: value["app"].as_str().unwrap_or_default().to_owned(),
            title: value["title"].as_str().unwrap_or_default().to_owned(),
            monitor: None,
        },
        ignored,
    )
}
