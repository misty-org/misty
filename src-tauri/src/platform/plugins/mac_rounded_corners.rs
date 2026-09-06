// Unterdrücke Warnings von veralteten Cocoa APIs
#![allow(unexpected_cfgs)]
#![allow(deprecated)]

use tauri::{AppHandle, Runtime, WebviewWindow};

#[cfg(target_os = "macos")]
use cocoa::{
    appkit::{
        NSColor, NSView, NSWindow, NSWindowCollectionBehavior, NSWindowStyleMask,
        NSWindowTitleVisibility,
    },
    base::{id, nil},
    foundation::{NSPoint, NSString},
};

#[cfg(target_os = "macos")]
use objc::{msg_send, sel, sel_impl};

#[cfg(target_os = "macos")]
use std::ffi::c_void;

#[cfg(target_os = "macos")]
#[link(name = "AVFoundation", kind = "framework")]
unsafe extern "C" {}

#[cfg(target_os = "macos")]
#[link(name = "QuartzCore", kind = "framework")]
unsafe extern "C" {}

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn objc_setAssociatedObject(object: id, key: *const c_void, value: id, policy: usize);
    fn objc_getAssociatedObject(object: id, key: *const c_void) -> id;
}

#[cfg(target_os = "macos")]
static WALLPAPER_LOOPER_ASSOCIATION_KEY: u8 = 0;

#[cfg(target_os = "macos")]
static WALLPAPER_VIEW_ASSOCIATION_KEY: u8 = 0;

#[cfg(target_os = "macos")]
const OBJC_ASSOCIATION_RETAIN_NONATOMIC: usize = 1;

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

    #[cfg(target_os = "macos")]
    {
        let _ = (radius, offset_x, offset_y);

        window
            .with_webview(move |webview| {
                #[cfg(target_os = "macos")]
                unsafe {
                    let ns_window = webview.ns_window() as id;
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

    // Wry owns the main WKWebView's parent, frame, and native
    // autoresizing mask. Reapplying them here creates a second
    // resize owner and can stall its live-resize paint cycle.

    let ox = offset_x;
    let oy = offset_y;
    position_traffic_lights(ns_window, ox, oy);
}

#[cfg(target_os = "macos")]
static MAIN_WINDOW_READY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn main_window_ready() -> bool {
    #[cfg(target_os = "macos")]
    return MAIN_WINDOW_READY.load(std::sync::atomic::Ordering::Acquire);
    #[cfg(not(target_os = "macos"))]
    true
}

/// Completes window preparation after React, fonts, and saved zoom are ready.
/// Native startup already shows the window independently of this callback.
#[tauri::command]
pub async fn reveal_main_window<R: Runtime>(window: WebviewWindow<R>) -> Result<(), String> {
    if window.label() != "main" || main_window_ready() {
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        let (send, receive) = tokio::sync::oneshot::channel();
        window
            .with_webview(move |webview| unsafe {
                if !main_window_ready() {
                    let ns_window = webview.ns_window() as id;
                    apply_modern_window_style(ns_window, -4.0, 0.0);
                    let _: () = msg_send![ns_window, displayIfNeeded];
                    MAIN_WINDOW_READY.store(true, std::sync::atomic::Ordering::Release);
                    ns_window.makeKeyAndOrderFront_(nil);
                }
                let _ = send.send(());
            })
            .map_err(|error| error.to_string())?;
        receive.await.map_err(|error| error.to_string())?;
    }
    Ok(())
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

/// Plays the app wallpaper through AVFoundation on macOS.
///
/// WebKit deliberately requires a real user gesture for video while macOS Low
/// Power Mode is active, even when the video is muted and WKWebView's autoplay
/// policy allows it. A native AVPlayerLayer is not subject to that WebKit-only
/// restriction and can live behind Misty's transparent webview.
#[tauri::command]
pub fn set_native_wallpaper_video<R: Runtime>(
    _app: AppHandle<R>,
    window: WebviewWindow<R>,
    path: Option<String>,
) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        window
            .with_webview(move |webview| unsafe {
                let webview_view = webview.inner() as id;
                let container_view: id = msg_send![webview_view, superview];
                if container_view.is_null() {
                    return;
                }

                remove_native_wallpaper_video(container_view);

                let Some(path) = path.filter(|value| !value.trim().is_empty()) else {
                    return;
                };
                install_native_wallpaper_video(container_view, webview_view, &path);
            })
            .map_err(|error| error.to_string())?;

        Ok(true)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, path);
        Ok(false)
    }
}

#[cfg(target_os = "macos")]
unsafe fn remove_native_wallpaper_video(container_view: id) {
    let wallpaper_view = objc_getAssociatedObject(
        container_view,
        &WALLPAPER_VIEW_ASSOCIATION_KEY as *const u8 as *const c_void,
    );
    if wallpaper_view.is_null() {
        return;
    }

    let layer: id = msg_send![wallpaper_view, layer];
    if !layer.is_null() {
        let player: id = msg_send![layer, player];
        if !player.is_null() {
            let _: () = msg_send![player, pause];
            let _: () = msg_send![player, removeAllItems];
        }
    }

    objc_setAssociatedObject(
        wallpaper_view,
        &WALLPAPER_LOOPER_ASSOCIATION_KEY as *const u8 as *const c_void,
        nil,
        OBJC_ASSOCIATION_RETAIN_NONATOMIC,
    );
    let _: () = msg_send![wallpaper_view, removeFromSuperview];
    objc_setAssociatedObject(
        container_view,
        &WALLPAPER_VIEW_ASSOCIATION_KEY as *const u8 as *const c_void,
        nil,
        OBJC_ASSOCIATION_RETAIN_NONATOMIC,
    );
}

#[cfg(target_os = "macos")]
unsafe fn install_native_wallpaper_video(container_view: id, webview_view: id, path: &str) {
    let ns_path = NSString::alloc(nil).init_str(path);
    let file_url: id = msg_send![objc::class!(NSURL), fileURLWithPath: ns_path];
    let player_item: id = msg_send![objc::class!(AVPlayerItem), playerItemWithURL: file_url];
    let items: id = msg_send![objc::class!(NSArray), arrayWithObject: player_item];
    let player: id = msg_send![objc::class!(AVQueuePlayer), queuePlayerWithItems: items];
    let looper: id = msg_send![
        objc::class!(AVPlayerLooper),
        playerLooperWithPlayer: player
        templateItem: player_item
    ];
    let player_layer: id = msg_send![objc::class!(AVPlayerLayer), playerLayerWithPlayer: player];

    let gravity = NSString::alloc(nil).init_str("AVLayerVideoGravityResizeAspectFill");
    let _: () = msg_send![player_layer, setVideoGravity: gravity];

    let frame: cocoa::foundation::NSRect = msg_send![webview_view, frame];
    let wallpaper_view: id = msg_send![objc::class!(NSView), alloc];
    let wallpaper_view: id = msg_send![wallpaper_view, initWithFrame: frame];
    let _: () = msg_send![wallpaper_view, setAutoresizingMask: 18usize];
    let _: () = msg_send![wallpaper_view, setWantsLayer: cocoa::base::YES];
    let _: () = msg_send![wallpaper_view, setLayer: player_layer];

    let bounds: cocoa::foundation::NSRect = msg_send![wallpaper_view, bounds];
    let _: () = msg_send![player_layer, setFrame: bounds];
    let _: () = msg_send![player_layer, setAutoresizingMask: 18u32];

    objc_setAssociatedObject(
        wallpaper_view,
        &WALLPAPER_LOOPER_ASSOCIATION_KEY as *const u8 as *const c_void,
        looper,
        OBJC_ASSOCIATION_RETAIN_NONATOMIC,
    );

    // NSWindowBelow is -1. Keeping the native layer below WKWebView preserves
    // all existing React interaction while allowing transparent surfaces to
    // reveal the video.
    let _: () = msg_send![
        container_view,
        addSubview: wallpaper_view
        positioned: -1isize
        relativeTo: webview_view
    ];
    objc_setAssociatedObject(
        container_view,
        &WALLPAPER_VIEW_ASSOCIATION_KEY as *const u8 as *const c_void,
        wallpaper_view,
        OBJC_ASSOCIATION_RETAIN_NONATOMIC,
    );

    let _: () = msg_send![player, setMuted: cocoa::base::YES];
    let _: () = msg_send![player, setVolume: 0.0f32];
    let _: () = msg_send![player, setAutomaticallyWaitsToMinimizeStalling: cocoa::base::NO];
    let _: () = msg_send![player, play];

    let _: () = msg_send![ns_path, release];
    let _: () = msg_send![gravity, release];
    let _: () = msg_send![wallpaper_view, release];
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
pub unsafe fn position_traffic_lights(ns_window: id, offset_x: f64, offset_y: f64) {
    let style_mask = ns_window.styleMask();
    if style_mask.contains(NSWindowStyleMask::NSFullScreenWindowMask) {
        return;
    }

    let default_x = 20.0;
    let button_spacing = 23.0;

    let close_button: id = msg_send![ns_window, standardWindowButton: 0];
    let miniaturize_button: id = msg_send![ns_window, standardWindowButton: 1];
    let zoom_button: id = msg_send![ns_window, standardWindowButton: 2];

    if close_button.is_null() {
        return;
    }

    // Match the 38-point HTML titlebar's center, in content coordinates.
    // Converting into each button's superview avoids AppKit titlebar-height
    // and flipped-coordinate assumptions across macOS versions.
    let content_view = ns_window.contentView();
    let bounds: cocoa::foundation::NSRect = msg_send![content_view, bounds];
    let flipped: bool = msg_send![content_view, isFlipped];
    let center_y = if flipped {
        19.0 + offset_y
    } else {
        bounds.size.height - 19.0 - offset_y
    };
    for (index, button) in [close_button, miniaturize_button, zoom_button]
        .iter()
        .enumerate()
    {
        if button.is_null() {
            continue;
        }
        let button = *button;
        let frame: cocoa::foundation::NSRect = msg_send![button, frame];
        let parent: id = msg_send![button, superview];
        if parent.is_null() {
            continue;
        }
        let rect = cocoa::foundation::NSRect::new(
            NSPoint::new(
                default_x + offset_x + button_spacing * index as f64,
                center_y - frame.size.height / 2.0,
            ),
            frame.size,
        );
        let converted: cocoa::foundation::NSRect =
            msg_send![parent, convertRect: rect fromView: content_view];
        let _: () = msg_send![button, setFrame: converted];
    }
}
