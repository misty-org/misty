// Unterdrücke Warnings von veralteten Cocoa APIs
#![allow(unexpected_cfgs)]
#![allow(deprecated)]

//! The native window buttons: where they rest, and sliding them away with a collapsing sidebar.

use tauri::{AppHandle, Runtime, Webview};

#[cfg(target_os = "macos")]
use cocoa::{
    appkit::{NSWindow, NSWindowStyleMask},
    base::id,
};

#[cfg(target_os = "macos")]
use objc::{class, msg_send, sel, sel_impl};

#[cfg(target_os = "macos")]
use std::ffi::c_void;

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn objc_setAssociatedObject(object: id, key: *const c_void, value: id, policy: usize);
    fn objc_getAssociatedObject(object: id, key: *const c_void) -> id;
}

#[cfg(target_os = "macos")]
static TRAFFIC_LIGHT_CONSTRAINTS_ASSOCIATION_KEY: u8 = 0;

#[cfg(target_os = "macos")]
const OBJC_ASSOCIATION_RETAIN_NONATOMIC: usize = 1;

/// Where the first button rests, as f64 bits, so sliding never depends on the current constant.
#[cfg(target_os = "macos")]
static TRAFFIC_LIGHTS_REST_X: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// How far the buttons slide away, as f64 bits.
#[cfg(target_os = "macos")]
static TRAFFIC_LIGHTS_AWAY_BY: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[cfg(target_os = "macos")]
static TRAFFIC_LIGHTS_SHOWN: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(true);

/// Brings the native window buttons in with the sidebar they sit beside, or sends them out with
/// it: they slide `distance` points sideways while they fade, over `duration_ms`.
#[tauri::command]
pub fn set_traffic_lights_visible<R: Runtime>(
    _app: AppHandle<R>,
    window: Webview<R>,
    visible: bool,
    distance: Option<f64>,
    duration_ms: Option<f64>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::sync::atomic::Ordering;
        if TRAFFIC_LIGHTS_SHOWN.swap(visible, Ordering::AcqRel) == visible {
            return Ok(());
        }
        let distance = distance.unwrap_or(0.0);
        if !visible {
            TRAFFIC_LIGHTS_AWAY_BY.store(distance.to_bits(), Ordering::Release);
        }
        let seconds = duration_ms.unwrap_or(0.0) / 1000.0;
        window
            .with_webview(move |webview| unsafe {
                let ns_window = webview.ns_window() as id;
                let key = &TRAFFIC_LIGHT_CONSTRAINTS_ASSOCIATION_KEY as *const u8 as *const c_void;
                let constraints = objc_getAssociatedObject(ns_window, key);
                let _: () = msg_send![class!(NSAnimationContext), beginGrouping];
                let context: id = msg_send![class!(NSAnimationContext), currentContext];
                let _: () = msg_send![context, setDuration: seconds];
                let _: () = msg_send![context, setAllowsImplicitAnimation: cocoa::base::YES];
                for kind in 0..3_i64 {
                    let button: id = msg_send![ns_window, standardWindowButton: kind];
                    if button.is_null() {
                        continue;
                    }
                    let enabled = if visible {
                        cocoa::base::YES
                    } else {
                        cocoa::base::NO
                    };
                    // Gone buttons must not take clicks, and keep their place in the layout.
                    let _: () = msg_send![button, setEnabled: enabled];
                    let _: () = msg_send![button, setHidden: cocoa::base::NO];
                    let animator: id = msg_send![button, animator];
                    let alpha = if visible { 1.0_f64 } else { 0.0_f64 };
                    let _: () = msg_send![animator, setAlphaValue: alpha];
                    // Each button's constraints are four long; the first is its leading edge.
                    if !constraints.is_null() {
                        let leading: id =
                            msg_send![constraints, objectAtIndex: (kind as usize) * 4];
                        let rest = f64::from_bits(TRAFFIC_LIGHTS_REST_X.load(Ordering::Acquire))
                            + 23.0 * kind as f64;
                        let target = if visible { rest } else { rest - distance };
                        let constraint: id = msg_send![leading, animator];
                        let _: () = msg_send![constraint, setConstant: target];
                    }
                }
                let _: () = msg_send![class!(NSAnimationContext), endGrouping];
            })
            .map_err(|e| e.to_string())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, visible, distance, duration_ms);
        Ok(())
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

    // Pin the native controls to the 38-point custom titlebar. One-time frame
    // writes are replaced by AppKit's next layout; resize callbacks correcting
    // those frames in turn cause jitter. Native anchors keep the same position
    // as part of layout, without a Misty resize handler or frame rewrites.
    let content_view = ns_window.contentView();
    if content_view.is_null() {
        return;
    }
    let key = &TRAFFIC_LIGHT_CONSTRAINTS_ASSOCIATION_KEY as *const u8 as *const c_void;
    let previous = objc_getAssociatedObject(ns_window, key);
    if !previous.is_null() {
        let _: () = msg_send![class!(NSLayoutConstraint), deactivateConstraints: previous];
    }
    TRAFFIC_LIGHTS_REST_X.store(
        (default_x + offset_x).to_bits(),
        std::sync::atomic::Ordering::Release,
    );
    // Laid out again while the sidebar is away, the buttons start where it left them.
    let away_by = if TRAFFIC_LIGHTS_SHOWN.load(std::sync::atomic::Ordering::Acquire) {
        0.0
    } else {
        f64::from_bits(TRAFFIC_LIGHTS_AWAY_BY.load(std::sync::atomic::Ordering::Acquire))
    };
    let leading: id = msg_send![content_view, leadingAnchor];
    let top: id = msg_send![content_view, topAnchor];
    let mut constraints: Vec<id> = Vec::with_capacity(12);
    for (index, button) in [close_button, miniaturize_button, zoom_button]
        .iter()
        .enumerate()
    {
        if button.is_null() {
            continue;
        }
        let button = *button;
        let frame: cocoa::foundation::NSRect = msg_send![button, frame];
        let _: () =
            msg_send![button, setTranslatesAutoresizingMaskIntoConstraints: cocoa::base::NO];
        let button_leading: id = msg_send![button, leadingAnchor];
        let button_top: id = msg_send![button, topAnchor];
        let width: id = msg_send![button, widthAnchor];
        let height: id = msg_send![button, heightAnchor];
        constraints.push(msg_send![button_leading,
            constraintEqualToAnchor: leading
            constant: default_x + offset_x + button_spacing * index as f64 - away_by]);
        constraints.push(msg_send![button_top,
            constraintEqualToAnchor: top
            constant: 19.0 + offset_y - frame.size.height / 2.0]);
        constraints.push(msg_send![width, constraintEqualToConstant: frame.size.width]);
        constraints.push(msg_send![height, constraintEqualToConstant: frame.size.height]);
    }
    let constraints: id = msg_send![class!(NSArray),
        arrayWithObjects: constraints.as_ptr() count: constraints.len()];
    let _: () = msg_send![class!(NSLayoutConstraint), activateConstraints: constraints];
    objc_setAssociatedObject(
        ns_window,
        key,
        constraints,
        OBJC_ASSOCIATION_RETAIN_NONATOMIC,
    );
    let root: id = msg_send![content_view, superview];
    if !root.is_null() {
        let _: () = msg_send![root, layoutSubtreeIfNeeded];
    }
}
