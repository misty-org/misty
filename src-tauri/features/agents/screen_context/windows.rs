//! Screen context for a Misty ask on Windows: the window the person was
//! using when they brought Misty up.
//!
//! A foreground hook remembers the last window that wasn't Misty's. When
//! Misty comes to the front, that window becomes the source, as on macOS;
//! focusing Misty's own workspace clears it. A capture takes the source, or
//! else the most recent window that wasn't Misty's.
use std::{
    sync::atomic::{AtomicIsize, Ordering},
    thread,
};

use base64::{engine::general_purpose::STANDARD, Engine};
use windows_sys::Win32::{
    Foundation::HWND,
    UI::{
        Accessibility::{SetWinEventHook, HWINEVENTHOOK},
        WindowsAndMessaging::{
            DispatchMessageW, GetMessageW, GetWindowThreadProcessId, IsIconic, IsWindow,
            IsWindowVisible, TranslateMessage, EVENT_SYSTEM_FOREGROUND, MSG, WINEVENT_OUTOFCONTEXT,
        },
    },
};

/// The window Misty was brought up over, if any.
static SOURCE: AtomicIsize = AtomicIsize::new(0);
/// The last window in front that wasn't Misty's.
static LAST_OTHER: AtomicIsize = AtomicIsize::new(0);
/// The longest edge of a capture, as on macOS.
const MAX_EDGE: u32 = 1600;

fn is_misty(window: HWND) -> bool {
    let mut pid = 0u32;
    // SAFETY: plain query on a window handle; a stale handle yields pid 0.
    unsafe { GetWindowThreadProcessId(window, &mut pid) };
    pid == std::process::id()
}

/// Whether the handle still names a visible, unminimized window.
fn usable(window: isize) -> bool {
    let window = window as HWND;
    // SAFETY: plain queries; a stale handle answers false.
    window as isize != 0
        && unsafe { IsWindow(window) != 0 && IsWindowVisible(window) != 0 && IsIconic(window) == 0 }
}

unsafe extern "system" fn foreground_changed(
    _hook: HWINEVENTHOOK,
    _event: u32,
    window: HWND,
    _object: i32,
    _child: i32,
    _thread: u32,
    _time: u32,
) {
    if window.is_null() {
        return;
    }
    if is_misty(window) {
        let other = LAST_OTHER.load(Ordering::Acquire);
        if usable(other) {
            SOURCE.store(other, Ordering::Release);
        }
    } else {
        LAST_OTHER.store(window as isize, Ordering::Release);
    }
}

/// Starts remembering which window was in front; for the life of the app.
pub fn start_foreground_watch() {
    let _ = thread::Builder::new()
        .name("misty-foreground-watch".into())
        .spawn(|| {
            // SAFETY: an out-of-context hook delivered to this thread's
            // message loop, which runs for the life of the app.
            unsafe {
                let hook = SetWinEventHook(
                    EVENT_SYSTEM_FOREGROUND,
                    EVENT_SYSTEM_FOREGROUND,
                    std::ptr::null_mut(),
                    Some(foreground_changed),
                    0,
                    0,
                    WINEVENT_OUTOFCONTEXT,
                );
                if hook.is_null() {
                    return;
                }
                let mut message: MSG = std::mem::zeroed();
                while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
                    TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            }
        });
}

/// Misty's own workspace has focus: no other window is the source now.
pub fn workspace_focused() {
    SOURCE.store(0, Ordering::Release);
}

pub fn status() -> serde_json::Value {
    serde_json::json!({
        "supported": true,
        // Windows asks no permission to capture another app's window.
        "allowed": true,
        "shortcutRegistered": false,
        "external": usable(SOURCE.load(Ordering::Acquire)),
    })
}

/// Captures the source window as a JPEG data URL, with its title and app.
pub fn capture() -> serde_json::Value {
    match capture_window() {
        Ok(value) => value,
        Err(error) => serde_json::json!({ "error": error }),
    }
}

fn capture_window() -> Result<serde_json::Value, String> {
    let target = [
        SOURCE.load(Ordering::Acquire),
        LAST_OTHER.load(Ordering::Acquire),
    ]
    .into_iter()
    .find(|window| usable(*window));
    let windows = xcap::Window::all().map_err(|_| "Misty could not list your open windows.")?;
    let own = std::process::id();
    let window = match target {
        Some(target) => windows
            .into_iter()
            .find(|window| window.id().is_ok_and(|id| id as isize == target)),
        // Front to back: the first window that isn't Misty's.
        None => windows.into_iter().find(|window| {
            window.pid().is_ok_and(|pid| pid != own)
                && !window.is_minimized().unwrap_or(true)
                && window.width().unwrap_or(0) > 0
                && window
                    .title()
                    .is_ok_and(|title| !title.trim().is_empty() && title != "Program Manager")
        }),
    }
    .ok_or("The source window is unavailable. Return to it and try again.")?;
    let image = window
        .capture_image()
        .map_err(|_| "This window cannot be captured.")?;
    let image = image::DynamicImage::ImageRgba8(image);
    let image = if image.width().max(image.height()) > MAX_EDGE {
        image.resize(MAX_EDGE, MAX_EDGE, image::imageops::FilterType::Triangle)
    } else {
        image
    };
    let mut jpeg = std::io::Cursor::new(Vec::new());
    image
        .to_rgb8()
        .write_to(&mut jpeg, image::ImageFormat::Jpeg)
        .map_err(|_| "Misty could not encode that capture.")?;
    Ok(serde_json::json!({
        "dataUrl": format!("data:image/jpeg;base64,{}", STANDARD.encode(jpeg.into_inner())),
        "width": image.width(),
        "height": image.height(),
        "title": window.title().ok().filter(|title| !title.is_empty()).unwrap_or_else(|| "Window".into()),
        "appName": window.app_name().ok().filter(|name| !name.is_empty()).unwrap_or_else(|| "App".into()),
    }))
}
