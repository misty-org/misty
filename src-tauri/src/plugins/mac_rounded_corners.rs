// Unterdrücke Warnings von veralteten Cocoa APIs
#![allow(unexpected_cfgs)]
#![allow(deprecated)]

use tauri::{AppHandle, Runtime, WebviewWindow};

#[cfg(target_os = "macos")]
use cocoa::{
    appkit::{NSColor, NSView, NSWindow, NSWindowStyleMask, NSWindowTitleVisibility},
    base::{id, nil},
    foundation::{NSPoint, NSString},
};

#[cfg(target_os = "macos")]
use objc::{msg_send, sel, sel_impl};

/// Configuration for Traffic Lights positioning
pub struct TrafficLightsConfig {
    /// Offset in pixels from default position (positive = right, negative = left)
    pub offset_x: f64,
    /// Offset in pixels from default position (positive = down, negative = up)
    pub offset_y: f64,
}

impl Default for TrafficLightsConfig {
    fn default() -> Self {
        Self {
            offset_x: 0.0,
            offset_y: 0.0,
        }
    }
}

/// Enables rounded corners for the window (macOS only)
/// Uses only public APIs - App Store compatible
#[tauri::command]
pub fn enable_rounded_corners<R: Runtime>(
    _app: AppHandle<R>,
    window: WebviewWindow<R>,
    offset_x: Option<f64>,
    offset_y: Option<f64>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let config = TrafficLightsConfig {
            offset_x: offset_x.unwrap_or(0.0),
            offset_y: offset_y.unwrap_or(0.0),
        };

        window
            .with_webview(move |webview| {
                #[cfg(target_os = "macos")]
                unsafe {
                    let ns_window = webview.ns_window() as id;

                    let mut style_mask = ns_window.styleMask();

                    // Add necessary styles for rounded corners
                    style_mask |= NSWindowStyleMask::NSFullSizeContentViewWindowMask;
                    style_mask |= NSWindowStyleMask::NSTitledWindowMask;
                    style_mask |= NSWindowStyleMask::NSClosableWindowMask;
                    style_mask |= NSWindowStyleMask::NSMiniaturizableWindowMask;
                    style_mask |= NSWindowStyleMask::NSResizableWindowMask;

                    ns_window.setStyleMask_(style_mask);
                    ns_window.setTitlebarAppearsTransparent_(cocoa::base::YES);

                    let content_view = ns_window.contentView();
                    content_view.setWantsLayer(cocoa::base::YES);

                    position_traffic_lights(ns_window, config.offset_x, config.offset_y);
                }
            })
            .map_err(|e| e.to_string())?;

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

/// Enables native traffic lights with a transparent titlebar.
#[tauri::command]
pub fn enable_modern_window_style<R: Runtime>(
    _app: AppHandle<R>,
    window: WebviewWindow<R>,
    corner_radius: Option<f64>,
    offset_x: Option<f64>,
    offset_y: Option<f64>,
) -> Result<(), String> {
    let radius = corner_radius.unwrap_or(10.0);
    #[cfg(not(target_os = "macos"))]
    let _ = radius;

    #[cfg(target_os = "macos")]
    {
        let config = TrafficLightsConfig {
            offset_x: offset_x.unwrap_or(0.0),
            offset_y: offset_y.unwrap_or(0.0),
        };

        window
            .with_webview(move |webview| {
                #[cfg(target_os = "macos")]
                unsafe {
                    let ns_window = webview.ns_window() as id;

                    let mut style_mask = ns_window.styleMask();

                    style_mask |= NSWindowStyleMask::NSFullSizeContentViewWindowMask;
                    style_mask |= NSWindowStyleMask::NSTitledWindowMask;
                    style_mask |= NSWindowStyleMask::NSClosableWindowMask;
                    style_mask |= NSWindowStyleMask::NSMiniaturizableWindowMask;
                    style_mask |= NSWindowStyleMask::NSResizableWindowMask;

                    ns_window.setStyleMask_(style_mask);
                    ns_window.setTitlebarAppearsTransparent_(cocoa::base::YES);
                    ns_window.setTitleVisibility_(NSWindowTitleVisibility::NSWindowTitleHidden);
                    ns_window.setHasShadow_(cocoa::base::NO);
                    ns_window.setOpaque_(cocoa::base::NO);
                    ns_window.setBackgroundColor_(NSColor::clearColor(nil));

                    apply_continuous_corner_mask(ns_window, radius);

                    position_traffic_lights(ns_window, config.offset_x, config.offset_y);
                }
            })
            .map_err(|e| e.to_string())?;

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (offset_x, offset_y);
        // Windows 11 rounds custom (decorationless) windows only when asked to.
        #[cfg(windows)]
        apply_windows_rounded_corners(&window);
        Ok(())
    }
}

/// Opts a Windows 11 window into the system's rounded-corner treatment. No-op on
/// Windows 10 (the DWM attribute is simply ignored there).
#[cfg(windows)]
fn apply_windows_rounded_corners<R: Runtime>(window: &WebviewWindow<R>) {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
        DWM_WINDOW_CORNER_PREFERENCE,
    };

    if let Ok(hwnd) = window.hwnd() {
        let preference: DWM_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND;
        unsafe {
            let _ = DwmSetWindowAttribute(
                hwnd.0 as HWND,
                DWMWA_WINDOW_CORNER_PREFERENCE as u32,
                &preference as *const DWM_WINDOW_CORNER_PREFERENCE as *const core::ffi::c_void,
                core::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
            );
        }
    }
}

/// Enables native shadow for a fully custom titlebar.
/// Unlike `enable_modern_window_style`, this does not add the native macOS traffic lights.
#[tauri::command]
pub fn enable_custom_titlebar_window_style<R: Runtime>(
    _app: AppHandle<R>,
    window: WebviewWindow<R>,
    corner_radius: Option<f64>,
) -> Result<(), String> {
    let radius = corner_radius.unwrap_or(10.0);
    #[cfg(not(target_os = "macos"))]
    let _ = radius;

    #[cfg(target_os = "macos")]
    {
        window
            .with_webview(move |webview| {
                #[cfg(target_os = "macos")]
                unsafe {
                    let ns_window = webview.ns_window() as id;

                    ns_window.setTitleVisibility_(NSWindowTitleVisibility::NSWindowTitleHidden);
                    ns_window.setTitlebarAppearsTransparent_(cocoa::base::YES);
                    ns_window.setHasShadow_(cocoa::base::YES);
                    ns_window.setOpaque_(cocoa::base::NO);
                    ns_window.setBackgroundColor_(NSColor::clearColor(nil));
                    apply_continuous_corner_mask(ns_window, radius);
                }
            })
            .map_err(|e| e.to_string())?;

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

/// Repositions Traffic Lights only (useful after fullscreen toggle)
#[tauri::command]
pub fn reposition_traffic_lights<R: Runtime>(
    _app: AppHandle<R>,
    window: WebviewWindow<R>,
    offset_x: Option<f64>,
    offset_y: Option<f64>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let config = TrafficLightsConfig {
            offset_x: offset_x.unwrap_or(0.0),
            offset_y: offset_y.unwrap_or(0.0),
        };

        window
            .with_webview(move |webview| {
                #[cfg(target_os = "macos")]
                unsafe {
                    let ns_window = webview.ns_window() as id;
                    position_traffic_lights(ns_window, config.offset_x, config.offset_y);
                }
            })
            .map_err(|e| e.to_string())?;

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

#[cfg(target_os = "macos")]
unsafe fn apply_continuous_corner_mask(ns_window: id, radius: f64) {
    let content_view = ns_window.contentView();
    content_view.setWantsLayer(cocoa::base::YES);

    let layer: id = msg_send![content_view, layer];
    if layer.is_null() {
        return;
    }

    let _: () = msg_send![layer, setCornerRadius: radius];
    let _: () = msg_send![layer, setMasksToBounds: cocoa::base::YES];

    let supports_continuous_corners: bool =
        msg_send![layer, respondsToSelector: sel!(setCornerCurve:)];
    if supports_continuous_corners {
        let continuous = NSString::alloc(nil).init_str("continuous");
        let _: () = msg_send![layer, setCornerCurve: continuous];
    }
}

#[cfg(target_os = "macos")]
unsafe fn position_traffic_lights(ns_window: id, offset_x: f64, offset_y: f64) {
    let default_x = 20.0;
    let default_y = 0.0;

    let close_button: id = msg_send![ns_window, standardWindowButton: 0];
    let miniaturize_button: id = msg_send![ns_window, standardWindowButton: 1];
    let zoom_button: id = msg_send![ns_window, standardWindowButton: 2];

    let new_x = default_x + offset_x;
    let new_y = default_y - offset_y;

    if !close_button.is_null() {
        let frame: cocoa::foundation::NSRect = msg_send![close_button, frame];
        let new_frame = cocoa::foundation::NSRect::new(NSPoint::new(new_x, new_y), frame.size);
        let _: () = msg_send![close_button, setFrame: new_frame];
    }

    if !miniaturize_button.is_null() {
        let frame: cocoa::foundation::NSRect = msg_send![miniaturize_button, frame];
        let new_frame =
            cocoa::foundation::NSRect::new(NSPoint::new(new_x + 20.0, new_y), frame.size);
        let _: () = msg_send![miniaturize_button, setFrame: new_frame];
    }

    if !zoom_button.is_null() {
        let frame: cocoa::foundation::NSRect = msg_send![zoom_button, frame];
        let new_frame =
            cocoa::foundation::NSRect::new(NSPoint::new(new_x + 40.0, new_y), frame.size);
        let _: () = msg_send![zoom_button, setFrame: new_frame];
    }
}
