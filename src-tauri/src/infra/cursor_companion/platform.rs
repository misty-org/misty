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
#[cfg(target_os = "macos")]
pub fn shortcut(tx: Sender<Shortcut>) {
    use core_foundation::runloop::{kCFRunLoopCommonModes, kCFRunLoopDefaultMode, CFRunLoop};
    use core_graphics::event::*;
    use std::cell::Cell;
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightListenEventAccess() -> bool;
        fn CGRequestListenEventAccess() -> bool;
    }
    unsafe {
        if !CGPreflightListenEventAccess() {
            CGRequestListenEventAccess();
        }
    }
    loop {
        let held = Cell::new(false);
        let send = tx.clone();
        let tap = CGEventTap::new(
            CGEventTapLocation::Session,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly,
            vec![
                CGEventType::FlagsChanged,
                CGEventType::KeyDown,
                CGEventType::LeftMouseDown,
            ],
            move |_, kind, event| {
                if matches!(kind, CGEventType::KeyDown) {
                    let _ = send.send(Shortcut::KeyboardActivity);
                }
                if matches!(kind, CGEventType::LeftMouseDown) {
                    // Only a position; the host forwards it while a walkthrough waits.
                    let p = event.location();
                    let _ = send.send(Shortcut::Click(p.x, p.y));
                }
                if matches!(kind, CGEventType::FlagsChanged) {
                    let flags = event.get_flags();
                    let next = flags.contains(
                        CGEventFlags::CGEventFlagControl | CGEventFlags::CGEventFlagAlternate,
                    );
                    if next != held.replace(next) {
                        let _ = send.send(Shortcut::Held(next));
                    }
                }
                None // Listen-only taps always preserve the original event.
            },
        );
        match tap {
            Ok(tap) => unsafe {
                if let Ok(source) = tap.mach_port.create_runloop_source(0) {
                    CFRunLoop::get_current().add_source(&source, kCFRunLoopCommonModes);
                    // Re-enable after OS tap timeouts; the monitor never consumes input.
                    loop {
                        tap.enable();
                        CFRunLoop::run_in_mode(
                            kCFRunLoopDefaultMode,
                            std::time::Duration::from_secs(1),
                            false,
                        );
                    }
                }
            },
            Err(_) => {
                let _ = tx.send(Shortcut::Error("Allow Misty in System Settings → Privacy & Security → Input Monitoring to use Control + Option.".into()));
            }
        }
        std::thread::sleep(std::time::Duration::from_secs(3));
    }
}
#[cfg(windows)]
pub fn shortcut(tx: Sender<Shortcut>) {
    use std::{cell::RefCell, ptr::null_mut};
    use windows_sys::Win32::{
        Foundation::*,
        UI::{Input::KeyboardAndMouse::*, WindowsAndMessaging::*},
    };
    thread_local! { static TARGET: RefCell<Option<(Sender<Shortcut>,[bool;4],bool)>> = const { RefCell::new(None) }; }
    unsafe extern "system" fn hook(code: i32, message: WPARAM, data: LPARAM) -> LRESULT {
        if code >= 0 {
            let event = &*(data as *const KBDLLHOOKSTRUCT);
            if event.flags & LLKHF_INJECTED == 0 {
                TARGET.with(|target| {
                    if let Some((tx, keys, held)) = target.borrow_mut().as_mut() {
                        let index = match event.vkCode as u16 {
                            VK_LCONTROL => Some(0),
                            VK_RCONTROL => Some(1),
                            VK_LMENU => Some(2),
                            VK_RMENU => Some(3),
                            _ => None,
                        };
                        if let Some(index) = index {
                            keys[index] =
                                message as u32 == WM_KEYDOWN || message as u32 == WM_SYSKEYDOWN;
                        }
                        if index.is_none()
                            && !matches!(
                                event.vkCode as u16,
                                VK_LSHIFT | VK_RSHIFT | VK_LWIN | VK_RWIN
                            )
                            && matches!(message as u32, WM_KEYDOWN | WM_SYSKEYDOWN)
                        {
                            let _ = tx.send(Shortcut::KeyboardActivity);
                        }
                        let next = (keys[0] || keys[1]) && (keys[2] || keys[3]);
                        if next != *held {
                            *held = next;
                            let _ = tx.send(Shortcut::Held(next));
                        }
                    }
                });
            }
        }
        CallNextHookEx(null_mut(), code, message, data)
    }
    thread_local! { static CLICKS: RefCell<Option<Sender<Shortcut>>> = const { RefCell::new(None) }; }
    // Only a position; the host forwards it while a walkthrough waits.
    unsafe extern "system" fn mouse(code: i32, message: WPARAM, data: LPARAM) -> LRESULT {
        if code >= 0 && message as u32 == WM_LBUTTONDOWN {
            let event = &*(data as *const MSLLHOOKSTRUCT);
            if event.flags & LLMHF_INJECTED == 0 {
                CLICKS.with(|target| {
                    if let Some(tx) = target.borrow().as_ref() {
                        let _ = tx.send(Shortcut::Click(event.pt.x as f64, event.pt.y as f64));
                    }
                });
            }
        }
        CallNextHookEx(null_mut(), code, message, data)
    }
    TARGET.with(|target| *target.borrow_mut() = Some((tx.clone(), [false; 4], false)));
    CLICKS.with(|target| *target.borrow_mut() = Some(tx.clone()));
    unsafe {
        let handle = SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook), null_mut(), 0);
        if handle.is_null() {
            let _ = tx.send(Shortcut::Error(
                "The global voice shortcut could not start. Restart Misty.".into(),
            ));
            return;
        }
        // Walkthroughs fall back to "next" by voice or text without click hints.
        let clicks = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse), null_mut(), 0);
        let mut message: MSG = std::mem::zeroed();
        while GetMessageW(&mut message, null_mut(), 0, 0) > 0 {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        if !clicks.is_null() {
            UnhookWindowsHookEx(clicks);
        }
        UnhookWindowsHookEx(handle);
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
#[cfg(windows)]
pub fn microphone_access() -> Result<(), String> {
    Ok(())
} // WASAPI reports OS privacy denial when opening the input stream.

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
    }
    Ok(())
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
