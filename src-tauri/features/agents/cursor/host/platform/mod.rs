use super::Shortcut;
use std::sync::mpsc::Sender;

mod capture;
#[cfg(test)]
use capture::companion_capture_size;
pub use capture::{capture_display, capture_window};
mod foreground;
pub use foreground::*;
#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::{cursor, foreground_window, position_overlay, x11_window_id};

#[cfg(target_os = "macos")]
fn overlay_frame(display: &super::Display, main_height: f64) -> objc2_foundation::NSRect {
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    NSRect::new(
        NSPoint::new(display.x, main_height - display.y - display.height),
        NSSize::new(display.width, display.height),
    )
}

#[cfg(target_os = "macos")]
pub fn position_overlay(
    window: &tauri::WebviewWindow,
    display: &super::Display,
) -> Result<(), String> {
    use core_graphics::display::CGDisplay;
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSWindow;
    let _main_thread =
        MainThreadMarker::new().ok_or("Companion positioning requires the main thread")?;
    let frame = overlay_frame(display, CGDisplay::main().bounds().size.height);
    unsafe {
        let native = &*(window.ns_window().map_err(|e| e.to_string())? as *const NSWindow);
        native.setFrame_display(frame, true);
    }
    Ok(())
}

#[cfg(all(test, target_os = "macos"))]
mod geometry_tests;

#[cfg(target_os = "macos")]
pub fn cursor() -> Option<(f64, f64)> {
    use core_graphics::{
        event::CGEvent,
        event_source::{CGEventSource, CGEventSourceStateID},
    };
    let event =
        CGEvent::new(CGEventSource::new(CGEventSourceStateID::CombinedSessionState).ok()?).ok()?;
    let p = event.location();
    Some((p.x, p.y))
}
#[cfg(windows)]
pub fn cursor() -> Option<(f64, f64)> {
    use windows_sys::Win32::{Foundation::POINT, UI::WindowsAndMessaging::GetCursorPos};
    let mut p = POINT { x: 0, y: 0 };
    unsafe {
        if GetCursorPos(&mut p) == 0 {
            None
        } else {
            Some((p.x as f64, p.y as f64))
        }
    }
}
#[cfg(target_os = "macos")]
pub fn cursor_shown() -> bool {
    extern "C" {
        fn CGCursorIsVisible() -> u32;
    }
    // SAFETY: a plain query with no arguments.
    unsafe { CGCursorIsVisible() != 0 }
}
#[cfg(windows)]
pub fn cursor_shown() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetCursorInfo, CURSORINFO, CURSOR_SHOWING};
    // SAFETY: CURSORINFO is plain data, valid all zeros.
    let mut info: CURSORINFO = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<CURSORINFO>() as u32;
    // SAFETY: `info` is a live CURSORINFO with its size set, as the call requires.
    if unsafe { GetCursorInfo(&mut info) } == 0 {
        return true;
    }
    info.flags & CURSOR_SHOWING != 0
}
#[cfg(target_os = "linux")]
pub fn cursor_shown() -> bool {
    true
}

#[cfg(target_os = "macos")]
pub fn button_held() -> bool {
    extern "C" {
        fn CGEventSourceButtonState(state: i32, button: u32) -> bool;
    }
    // kCGEventSourceStateCombinedSessionState and kCGMouseButtonLeft.
    // SAFETY: a plain query with no pointers.
    unsafe { CGEventSourceButtonState(0, 0) }
}
#[cfg(windows)]
pub fn button_held() -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    // SAFETY: a plain query; the top bit is set while the key is down.
    ((unsafe { GetAsyncKeyState(VK_LBUTTON as i32) } as u16) & 0x8000) != 0
}
#[cfg(target_os = "linux")]
pub fn button_held() -> bool {
    false
}

#[cfg(target_os = "macos")]
pub fn take_pointer(window: &tauri::Window, over: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(!over)
        .map_err(|e| e.to_string())
}
#[cfg(windows)]
pub fn take_pointer(window: &tauri::Window, over: bool) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::*;
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as _;
    // SAFETY: a live window handle; only its extended style changes.
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let next = if over {
            style & !(WS_EX_TRANSPARENT as isize)
        } else {
            style | WS_EX_TRANSPARENT as isize
        };
        if next != style {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next);
        }
    }
    Ok(())
}
#[cfg(target_os = "linux")]
pub fn take_pointer(_window: &tauri::Window, _over: bool) -> Result<(), String> {
    Err("Misty can't take the pointer here.".into())
}

pub fn shortcut(tx: Sender<Shortcut>) {
    use crate::voice::hold_to_talk::{subscribe, Chord, HotkeyEvent};
    let subscription = subscribe(Chord::companion());
    while let Ok(event) = subscription.events.recv() {
        let shortcut = match event {
            HotkeyEvent::Down => Shortcut::Held(true),
            HotkeyEvent::Up => Shortcut::Held(false),
            HotkeyEvent::Click(x, y) => Shortcut::Click(x, y),
            HotkeyEvent::DoubleTap => Shortcut::Type,
            HotkeyEvent::Escape => Shortcut::Escape,
            HotkeyEvent::Error(message) => Shortcut::Error(message),
        };
        if tx.send(shortcut).is_err() {
            break;
        }
    }
}
mod access;
pub use access::{microphone_access, screen_access};

pub fn configure_overlay(window: &tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    crate::agents::desktop_control::linux::overlay::prepare(window)?;
    #[cfg(not(target_os = "linux"))]
    window
        .set_ignore_cursor_events(true)
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    unsafe {
        use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
        let native = &*(window.ns_window().map_err(|e| e.to_string())? as *mut NSWindow);
        native.setLevel(1000);
        native.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::FullScreenAuxiliary,
        );
        native.setHidesOnDeactivate(false);
        native.setHasShadow(false);
    }
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::UI::WindowsAndMessaging::*;
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as _;
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        SetWindowLongPtrW(
            hwnd,
            GWL_EXSTYLE,
            style
                | WS_EX_NOACTIVATE as isize
                | WS_EX_TOOLWINDOW as isize
                | WS_EX_TRANSPARENT as isize,
        );
        SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
    }
    Ok(())
}

pub fn show_overlay(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "linux")]
    crate::agents::desktop_control::linux::overlay::show(window);
    #[cfg(not(target_os = "linux"))]
    let _ = window.show();
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        };
        // SAFETY: a live window handle; only its z-order changes.
        unsafe {
            SetWindowPos(
                hwnd.0 as _,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            )
        };
    }
}

#[cfg(test)]
mod capture_size_tests;
