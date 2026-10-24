use super::Shortcut;
use std::sync::mpsc::Sender;

mod capture;
#[cfg(test)]
use capture::companion_capture_size;
pub use capture::{capture_display, capture_window};
mod foreground;
pub use foreground::*;

#[cfg(target_os = "macos")]
fn overlay_frame(display: &super::Display, main_height: f64) -> objc2_foundation::NSRect {
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    // CG display/cursor coordinates start at the main display's top-left;
    // AppKit window frames start at its bottom-left. Both are display points.
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
        // Apply origin and size together. Resizing after positioning preserves
        // the bottom edge and lifts the top edge away from the cursor's origin.
        // Use the same display-point bounds as cursor samples on every screen.
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
/// Control+Option for the agent at your cursor, through the shared global
/// hotkey hook so dictation's chord can run beside it.
pub fn shortcut(tx: Sender<Shortcut>) {
    use crate::infra::global_hotkey::{subscribe, Chord, HotkeyEvent};
    let subscription = subscribe(Chord::companion());
    while let Ok(event) = subscription.events.recv() {
        let shortcut = match event {
            HotkeyEvent::Down => Shortcut::Held(true),
            HotkeyEvent::Up => Shortcut::Held(false),
            HotkeyEvent::KeyboardActivity => Shortcut::KeyboardActivity,
            HotkeyEvent::Click(x, y) => Shortcut::Click(x, y),
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
        // Kept out of every screen capture, Misty's own included, as macOS
        // keeps these panels out (Windows 10 2004 and later).
        SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
    }
    Ok(())
}

/// Shows an overlay above every other window, fullscreen apps included,
/// without taking focus. Windows applies "always on top" once, and an app
/// that goes fullscreen afterwards can cover it, so it is asserted again on
/// every show.
pub fn show_overlay(window: &tauri::WebviewWindow) {
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
