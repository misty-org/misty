// Unterdrücke Warnings von veralteten Cocoa APIs
#![allow(unexpected_cfgs)]
#![allow(deprecated)]

use tauri::{AppHandle, Runtime, Webview};

#[cfg(target_os = "macos")]
use cocoa::{
    appkit::{
        NSColor, NSView, NSWindow, NSWindowCollectionBehavior, NSWindowStyleMask,
        NSWindowTitleVisibility,
    },
    base::{id, nil},
    foundation::NSString,
};

#[cfg(target_os = "macos")]
use objc::{class, msg_send, sel, sel_impl};

#[cfg(target_os = "macos")]
use std::ffi::c_void;

#[cfg(target_os = "macos")]
use super::mac_traffic_lights::position_traffic_lights;

#[cfg(target_os = "macos")]
#[link(name = "QuartzCore", kind = "framework")]
unsafe extern "C" {}

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
    window: Webview<R>,
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
    window: Webview<R>,
    corner_radius: Option<f64>,
    offset_x: Option<f64>,
    offset_y: Option<f64>,
) -> Result<(), String> {
    let radius = corner_radius.unwrap_or(10.0);

    #[cfg(target_os = "macos")]
    {
        let _ = (radius, offset_x, offset_y);
        // AppKit owns main-renderer geometry during its live-resize loop.
        // Disable Tauri's queued proportional frame writes before opting in.
        window.set_auto_resize(false).map_err(|e| e.to_string())?;

        window
            .with_webview(move |webview| {
                #[cfg(target_os = "macos")]
                unsafe {
                    let ns_window = webview.ns_window() as id;
                    configure_main_renderer_resize(webview.inner() as id);
                    apply_modern_window_style(
                        ns_window,
                        offset_x.unwrap_or(-4.0),
                        offset_y.unwrap_or(0.0),
                    );
                }
            })
            .map_err(|e| e.to_string())?;

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (radius, offset_x, offset_y);
        // Windows 11 rounds custom (decorationless) windows only when asked to.
        #[cfg(windows)]
        apply_windows_rounded_corners(&window);
        Ok(())
    }
}

#[cfg(target_os = "macos")]
unsafe fn apply_modern_window_style(ns_window: id, offset_x: f64, offset_y: f64) {
    ns_window.setTitlebarAppearsTransparent_(cocoa::base::YES);
    ns_window.setTitleVisibility_(NSWindowTitleVisibility::NSWindowTitleHidden);
    ns_window.setMovable_(cocoa::base::YES);
    ns_window.setHasShadow_(cocoa::base::YES);
    // The macOS-specific Tauri config creates a normal titled,
    // resizable overlay window. Do not rewrite its style mask
    // after creation: AppKit may rebuild the content hierarchy,
    // severing the webview's native autoresizing relationship.
    let mut collection_behavior = ns_window.collectionBehavior();
    collection_behavior
        .remove(NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary);
    collection_behavior
        .insert(NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenPrimary);
    ns_window.setCollectionBehavior_(collection_behavior);

    let ox = offset_x;
    let oy = offset_y;
    position_traffic_lights(ns_window, ox, oy);
}

/// With Tauri's `unstable` multi-webview feature, Wry builds the main view
/// as a child with only NSViewMinYMargin. Use native sizing instead of waiting
/// for Tao resize events to write its frame, especially when dragging left.
#[cfg(target_os = "macos")]
unsafe fn configure_main_renderer_resize(webview: id) {
    use objc2_app_kit::{NSAutoresizingMaskOptions, NSView};
    let view: &NSView = &*webview.cast();
    configure_continuous_live_resize(view);
    if let Some(window) = view.window() {
        window.setPreservesContentDuringLiveResize(false);
    }
    if let Some(parent) = view.superview() {
        parent.setAutoresizesSubviews(true);
        view.setFrame(parent.bounds());
        view.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable
                | NSAutoresizingMaskOptions::ViewHeightSizable,
        );
    }
}

/// Keep both the shell and embedded pages on the same live-redraw policy.
/// Configure at setup, not on every resize: repeated invalidation can itself
/// introduce paint work and jitter during AppKit's tracking loop.
#[cfg(target_os = "macos")]
pub(crate) unsafe fn configure_continuous_live_resize(view: &objc2_app_kit::NSView) {
    use objc2_app_kit::NSViewLayerContentsRedrawPolicy;

    view.setLayerContentsRedrawPolicy(NSViewLayerContentsRedrawPolicy::DuringViewResize);
    view.setNeedsDisplay(true);
    for child in view.subviews().iter() {
        configure_continuous_live_resize(&child);
    }
}

/// Windows whose first frame is ready. Each Space window reveals itself once.
#[cfg(any(target_os = "macos", windows))]
static READY_WINDOWS: std::sync::Mutex<std::collections::BTreeSet<String>> =
    std::sync::Mutex::new(std::collections::BTreeSet::new());

#[cfg(any(target_os = "macos", windows))]
fn window_ready(label: &str) -> bool {
    READY_WINDOWS
        .lock()
        .is_ok_and(|ready| ready.contains(label))
}

#[cfg(any(target_os = "macos", windows))]
fn mark_ready(label: &str) {
    if let Ok(mut ready) = READY_WINDOWS.lock() {
        ready.insert(label.to_owned());
    }
}

/// A closed window reveals itself again when its Space reopens.
pub fn forget_window(label: &str) {
    #[cfg(any(target_os = "macos", windows))]
    if let Ok(mut ready) = READY_WINDOWS.lock() {
        ready.remove(label);
    }
    let _ = label;
}

/// Whether any Misty window has shown its first frame.
pub fn main_window_ready() -> bool {
    #[cfg(any(target_os = "macos", windows))]
    return READY_WINDOWS.lock().is_ok_and(|ready| !ready.is_empty());
    #[cfg(not(any(target_os = "macos", windows)))]
    true
}

/// Completes window preparation after React, fonts, and saved zoom are ready.
/// The window starts hidden so its first frame already has the theme's
/// background (and, on macOS, positioned traffic lights).
#[tauri::command]
pub async fn reveal_main_window<R: Runtime>(webview: tauri::Webview<R>) -> Result<(), String> {
    // The main window can already contain embedded provider views on reload.
    // Command injection as WebviewWindow rejects any multi-webview window.
    let label = webview.label().to_owned();
    if !crate::infra::space_windows::is_app_window(&label) || window_ready(&label) {
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        webview
            .set_auto_resize(false)
            .map_err(|error| error.to_string())?;
        let (send, receive) = tokio::sync::oneshot::channel();
        webview
            .with_webview(move |webview| unsafe {
                if !window_ready(&label) {
                    let ns_window = webview.ns_window() as id;
                    configure_main_renderer_resize(webview.inner() as id);
                    apply_modern_window_style(ns_window, -1.0, 0.0);
                    let _: () = msg_send![ns_window, displayIfNeeded];
                    mark_ready(&label);
                    ns_window.makeKeyAndOrderFront_(nil);
                }
                let _ = send.send(());
            })
            .map_err(|error| error.to_string())?;
        receive.await.map_err(|error| error.to_string())?;
    }
    #[cfg(windows)]
    {
        let window = webview.window();
        mark_ready(&label);
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Opts a Windows 11 window into the system's rounded-corner treatment. No-op on
/// Windows 10 (the DWM attribute is simply ignored there).
#[cfg(windows)]
fn apply_windows_rounded_corners<R: Runtime>(window: &Webview<R>) {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
        DWM_WINDOW_CORNER_PREFERENCE,
    };

    if let Ok(hwnd) = window.window().hwnd() {
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
    window: Webview<R>,
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
    window: Webview<R>,
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
