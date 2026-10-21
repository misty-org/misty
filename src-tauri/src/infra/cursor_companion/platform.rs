use super::Shortcut;
use std::sync::mpsc::Sender;

#[cfg(target_os = "macos")]
pub fn capture_display(monitor: &xcap::Monitor) -> Result<(Vec<u8>, u32, u32), String> {
    use base64::Engine;
    unsafe extern "C" {
        fn misty_companion_capture_display(display_id: u32) -> *mut std::ffi::c_char;
    }
    let raw = unsafe { misty_companion_capture_display(monitor.id().map_err(|e| e.to_string())?) };
    if raw.is_null() {
        return Err("Screen capture returned no image".into());
    }
    let decoded = unsafe {
        serde_json::from_slice::<serde_json::Value>(std::ffi::CStr::from_ptr(raw).to_bytes())
    };
    unsafe {
        libc::free(raw.cast());
    }
    let value = decoded.map_err(|e| e.to_string())?;
    if value["legacy_capture"].as_bool() == Some(true) {
        return capture_legacy_display(monitor);
    }
    if let Some(error) = value["error"].as_str() {
        return Err(error.into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(
            value["jpeg"]
                .as_str()
                .ok_or("Screen capture returned no image")?,
        )
        .map_err(|e| e.to_string())?;
    let width = value["width"].as_u64().ok_or("Invalid capture width")? as u32;
    let height = value["height"].as_u64().ok_or("Invalid capture height")? as u32;
    Ok((bytes, width, height))
}

#[cfg(windows)]
pub fn capture_display(monitor: &xcap::Monitor) -> Result<(Vec<u8>, u32, u32), String> {
    capture_legacy_display(monitor)
}

/// The size a display is sent at. Vision providers resize larger images before
/// the model sees them (OpenAI to a 768px short side, Anthropic to a 1568px
/// long side), which would shift every point, so stay inside both bounds.
/// Matches `CompanionCaptureScale` in MistyCompanionCapture.m.
pub fn companion_capture_size(width: u32, height: u32) -> (u32, u32) {
    let (w, h) = (width.max(1) as f64, height.max(1) as f64);
    let scale = (768.0 / w.min(h)).min(1568.0 / w.max(h)).min(1.0);
    (((w * scale) as u32).max(1), ((h * scale) as u32).max(1))
}

// Windows and macOS 12–13 retain xcap: SCScreenshotManager requires macOS 14.
fn capture_legacy_display(monitor: &xcap::Monitor) -> Result<(Vec<u8>, u32, u32), String> {
    let image =
        image::DynamicImage::ImageRgba8(monitor.capture_image().map_err(|e| e.to_string())?);
    encode_capture(image)
}

fn encode_capture(image: image::DynamicImage) -> Result<(Vec<u8>, u32, u32), String> {
    let (width, height) = companion_capture_size(image.width(), image.height());
    let resized = image
        .resize_exact(width, height, image::imageops::FilterType::Lanczos3)
        .to_rgb8();
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 80)
        .encode_image(&resized)
        .map_err(|e| e.to_string())?;
    Ok((bytes, resized.width(), resized.height()))
}

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

/// The window's area of `display`, in pixels of the display's own image.
fn window_crop(
    display: &super::Display,
    window: &ForegroundWindow,
    scale: f64,
) -> Option<(u32, u32, u32, u32)> {
    let left = window.x.max(display.x);
    let top = window.y.max(display.y);
    let right = (window.x + window.width).min(display.x + display.width);
    let bottom = (window.y + window.height).min(display.y + display.height);
    if right - left < 1. || bottom - top < 1. {
        return None;
    }
    Some((
        ((left - display.x) * scale).round() as u32,
        ((top - display.y) * scale).round() as u32,
        ((right - left) * scale).round().max(1.) as u32,
        ((bottom - top) * scale).round().max(1.) as u32,
    ))
}

/// The focused window at the display's full resolution, cropped to the part
/// on `display`, then fitted to `companion_capture_size`. Returns the image and
/// the captured area in global units.
#[cfg(windows)]
pub fn capture_window(
    monitor: &xcap::Monitor,
    display: &super::Display,
    window: &ForegroundWindow,
) -> Result<(Vec<u8>, u32, u32, super::Display), String> {
    capture_window_legacy(monitor, display, window)
}

#[cfg(target_os = "macos")]
pub fn capture_window(
    monitor: &xcap::Monitor,
    display: &super::Display,
    window: &ForegroundWindow,
) -> Result<(Vec<u8>, u32, u32, super::Display), String> {
    use base64::Engine;
    unsafe extern "C" {
        fn misty_companion_capture_rect(
            display_id: u32,
            x: f64,
            y: f64,
            width: f64,
            height: f64,
            scale: f64,
        ) -> *mut std::ffi::c_char;
    }
    let (x, y, width, height) =
        window_crop(display, window, 1.).ok_or("The focused window is off this display")?;
    let raw = unsafe {
        misty_companion_capture_rect(
            display.id,
            x as f64,
            y as f64,
            width as f64,
            height as f64,
            display.scale,
        )
    };
    if raw.is_null() {
        return Err("Window capture returned no image".into());
    }
    let decoded = unsafe {
        serde_json::from_slice::<serde_json::Value>(std::ffi::CStr::from_ptr(raw).to_bytes())
    };
    unsafe {
        libc::free(raw.cast());
    }
    let value = decoded.map_err(|e| e.to_string())?;
    if value["legacy_capture"].as_bool() == Some(true) {
        return capture_window_legacy(monitor, display, window);
    }
    if let Some(error) = value["error"].as_str() {
        return Err(error.into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(
            value["jpeg"]
                .as_str()
                .ok_or("Window capture returned no image")?,
        )
        .map_err(|e| e.to_string())?;
    let image_width = value["width"].as_u64().ok_or("Invalid capture width")? as u32;
    let image_height = value["height"].as_u64().ok_or("Invalid capture height")? as u32;
    Ok((
        bytes,
        image_width,
        image_height,
        super::Display {
            x: display.x + x as f64,
            y: display.y + y as f64,
            width: width as f64,
            height: height as f64,
            ..display.clone()
        },
    ))
}

fn capture_window_legacy(
    monitor: &xcap::Monitor,
    display: &super::Display,
    window: &ForegroundWindow,
) -> Result<(Vec<u8>, u32, u32, super::Display), String> {
    let full = monitor.capture_image().map_err(|e| e.to_string())?;
    // Display units are points on macOS and pixels on Windows; the image is pixels.
    let scale = full.width() as f64 / display.width.max(1.);
    let (x, y, width, height) =
        window_crop(display, window, scale).ok_or("The focused window is off this display")?;
    let width = width.min(full.width().saturating_sub(x));
    let height = height.min(full.height().saturating_sub(y));
    if width == 0 || height == 0 {
        return Err("The focused window is off this display".into());
    }
    let cropped = image::DynamicImage::ImageRgba8(full).crop_imm(x, y, width, height);
    let (bytes, image_width, image_height) = encode_capture(cropped)?;
    Ok((
        bytes,
        image_width,
        image_height,
        super::Display {
            x: display.x + x as f64 / scale,
            y: display.y + y as f64 / scale,
            width: width as f64 / scale,
            height: height as f64 / scale,
            ..display.clone()
        },
    ))
}

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
mod geometry_tests {
    use super::*;

    #[test]
    fn retina_overlay_covers_the_display_in_points_without_a_pixel_offset() {
        let display = super::super::Display {
            id: 1,
            x: 0.,
            y: 0.,
            width: 1728.,
            height: 1117.,
            scale: 2.,
        };
        let frame = overlay_frame(&display, 1117.);
        assert_eq!(frame.origin.x, 0.);
        assert_eq!(frame.origin.y, 0.);
        assert_eq!(frame.size.width, 1728.);
        assert_eq!(frame.size.height, 1117.);
    }

    #[test]
    fn secondary_displays_keep_their_global_origins_at_mixed_scales() {
        for (x, y, scale, expected_y) in [
            (-1440., 0., 1., 217.),
            (1728., 150., 2., 67.),
            (0., -900., 1., 1117.),
            (0., 1117., 2., -900.),
        ] {
            let display = super::super::Display {
                id: 2,
                x,
                y,
                width: 1440.,
                height: 900.,
                scale,
            };
            let frame = overlay_frame(&display, 1117.);
            assert_eq!(frame.origin.x, x);
            assert_eq!(frame.origin.y, expected_y);
            assert_eq!(frame.size.height, 900.);
        }
    }
}

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
#[cfg(target_os = "macos")]
pub fn microphone_access() -> Result<(), String> {
    use objc2::{msg_send, runtime::AnyClass};
    use objc2_foundation::NSString;
    #[link(name = "AVFoundation", kind = "framework")]
    extern "C" {
        static AVMediaTypeAudio: *const NSString;
    }
    let device_class =
        AnyClass::get(c"AVCaptureDevice").ok_or("The microphone capture API is unavailable.")?;
    unsafe {
        let status: isize =
            msg_send![device_class, authorizationStatusForMediaType: AVMediaTypeAudio];
        if status == 3 {
            return Ok(());
        }
        if status != 0 {
            return Err("Allow Misty in System Settings → Privacy & Security → Microphone.".into());
        }
        let (tx, rx) = std::sync::mpsc::channel();
        let block = block2::RcBlock::new(move |allowed: objc2::runtime::Bool| {
            let _ = tx.send(allowed.as_bool());
        });
        let _: () = msg_send![device_class, requestAccessForMediaType: AVMediaTypeAudio, completionHandler: &*block];
        if rx
            .recv_timeout(std::time::Duration::from_secs(60))
            .unwrap_or(false)
        {
            Ok(())
        } else {
            Err("Microphone access was not granted. Hold the shortcut again after enabling it in System Settings.".into())
        }
    }
}
/// Windows keeps the microphone switches in the capability consent store:
/// one for the whole device and one for desktop apps such as Misty. Either
/// set to "Deny" blocks the input stream with an unhelpful error, so the
/// person is told which switch to turn on instead.
#[cfg(windows)]
pub fn microphone_access() -> Result<(), String> {
    use crate::platform::windows::registry::read_string;
    const STORE: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";
    let denied = |key: &str| {
        read_string(key, "Value")
            .ok()
            .flatten()
            .is_some_and(|value| value.eq_ignore_ascii_case("Deny"))
    };
    if denied(STORE) {
        return Err("Microphone access is off. Turn it on in Windows Settings → Privacy & security → Microphone.".into());
    }
    if denied(&format!(r"{STORE}\NonPackaged")) {
        return Err("Desktop apps can't use the microphone. Turn on \"Let desktop apps access your microphone\" in Windows Settings → Privacy & security → Microphone.".into());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn screen_access() -> Result<(), String> {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
        fn CGRequestScreenCaptureAccess() -> bool;
    }
    unsafe {
        if CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() {
            Ok(())
        } else {
            Err("Allow Misty in System Settings → Privacy & Security → Screen Recording, then retry.".into())
        }
    }
}
#[cfg(windows)]
pub fn screen_access() -> Result<(), String> {
    Ok(())
}

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
mod capture_size_tests {
    use super::companion_capture_size;

    #[test]
    fn captures_stay_inside_the_sizes_vision_providers_keep() {
        for (display, expected) in [
            ((1496, 967), (1188, 768)),
            ((2992, 1934), (1188, 768)),
            ((1920, 1080), (1365, 768)),
            ((3440, 1440), (1568, 656)),
            ((1080, 1920), (768, 1365)),
            ((800, 600), (800, 600)),
        ] {
            let (width, height) = companion_capture_size(display.0, display.1);
            assert_eq!((width, height), expected, "{display:?}");
            assert!(width.min(height) <= 768 && width.max(height) <= 1568);
        }
    }
}
