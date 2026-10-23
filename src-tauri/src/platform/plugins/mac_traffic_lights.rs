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

/// The offset the layout last asked for, kept on the window itself so a new window has none.
#[cfg(target_os = "macos")]
static TRAFFIC_LIGHT_PLACEMENT_ASSOCIATION_KEY: u8 = 1;

/// How long a revealed window keeps its buttons hidden waiting for the layout to place them.
#[cfg(target_os = "macos")]
const PLACEMENT_WAIT: std::time::Duration = std::time::Duration::from_secs(10);

/// How long hidden buttons take to fade in once placed.
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHT_FADE_SECONDS: f64 = 0.45;

#[cfg(target_os = "macos")]
const OBJC_ASSOCIATION_RETAIN_NONATOMIC: usize = 1;

/// How far the buttons slid away with the sidebar, kept on the window while they are away, so
/// one window's collapsed sidebar never moves another window's buttons.
#[cfg(target_os = "macos")]
static TRAFFIC_LIGHT_AWAY_ASSOCIATION_KEY: u8 = 2;

/// Where the first button rests, from the window's left edge, before any offset.
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHT_DEFAULT_X: f64 = 20.0;

#[cfg(target_os = "macos")]
const TRAFFIC_LIGHT_SPACING: f64 = 23.0;

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
        let distance = distance.unwrap_or(0.0);
        let seconds = duration_ms.unwrap_or(0.0) / 1000.0;
        window
            .with_webview(move |webview| unsafe {
                let ns_window = webview.ns_window() as id;
                if away_distance(ns_window).is_none() == visible {
                    return;
                }
                remember_away(ns_window, (!visible).then_some(distance));
                // Before the layout first places them they stay hidden, wherever they are.
                let placed = placement(ns_window);
                let rest_x = TRAFFIC_LIGHT_DEFAULT_X + placed.map_or(0.0, |(x, _)| x);
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
                    if placed.is_some() {
                        let _: () = msg_send![button, setHidden: cocoa::base::NO];
                    }
                    let animator: id = msg_send![button, animator];
                    let alpha = if visible { 1.0_f64 } else { 0.0_f64 };
                    let _: () = msg_send![animator, setAlphaValue: alpha];
                    // Each button's constraints are four long; the first is its leading edge.
                    if !constraints.is_null() {
                        let leading: id =
                            msg_send![constraints, objectAtIndex: (kind as usize) * 4];
                        let rest = rest_x + TRAFFIC_LIGHT_SPACING * kind as f64;
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
unsafe fn away_distance(ns_window: id) -> Option<f64> {
    let key = &TRAFFIC_LIGHT_AWAY_ASSOCIATION_KEY as *const u8 as *const c_void;
    let stored = objc_getAssociatedObject(ns_window, key);
    (!stored.is_null()).then(|| msg_send![stored, doubleValue])
}

#[cfg(target_os = "macos")]
unsafe fn remember_away(ns_window: id, distance: Option<f64>) {
    let key = &TRAFFIC_LIGHT_AWAY_ASSOCIATION_KEY as *const u8 as *const c_void;
    let stored: id = match distance {
        Some(distance) => msg_send![class!(NSNumber), numberWithDouble: distance],
        None => cocoa::base::nil,
    };
    objc_setAssociatedObject(ns_window, key, stored, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

#[cfg(target_os = "macos")]
unsafe fn placement(ns_window: id) -> Option<(f64, f64)> {
    let key = &TRAFFIC_LIGHT_PLACEMENT_ASSOCIATION_KEY as *const u8 as *const c_void;
    let stored = objc_getAssociatedObject(ns_window, key);
    if stored.is_null() {
        return None;
    }
    let x: id = msg_send![stored, objectAtIndex: 0_usize];
    let y: id = msg_send![stored, objectAtIndex: 1_usize];
    Some((msg_send![x, doubleValue], msg_send![y, doubleValue]))
}

#[cfg(target_os = "macos")]
unsafe fn remember_placement(ns_window: id, offset_x: f64, offset_y: f64) {
    let key = &TRAFFIC_LIGHT_PLACEMENT_ASSOCIATION_KEY as *const u8 as *const c_void;
    let values: [id; 2] = [
        msg_send![class!(NSNumber), numberWithDouble: offset_x],
        msg_send![class!(NSNumber), numberWithDouble: offset_y],
    ];
    let stored: id = msg_send![class!(NSArray), arrayWithObjects: values.as_ptr() count: 2_usize];
    objc_setAssociatedObject(ns_window, key, stored, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

#[cfg(target_os = "macos")]
unsafe fn hide_buttons(ns_window: id) {
    for kind in 0..3_i64 {
        let button: id = msg_send![ns_window, standardWindowButton: kind];
        if !button.is_null() {
            let _: () = msg_send![button, setHidden: cocoa::base::YES];
        }
    }
}

/// Hidden buttons fade in where they now sit, as the window's content arrives behind the opening
/// screen. Buttons away with a collapsed sidebar come back at no opacity, as they were.
#[cfg(target_os = "macos")]
unsafe fn fade_in_buttons(ns_window: id) {
    use cocoa::foundation::NSString;
    let alpha = if away_distance(ns_window).is_none() {
        1.0_f64
    } else {
        0.0_f64
    };
    let _: () = msg_send![class!(NSAnimationContext), beginGrouping];
    let context: id = msg_send![class!(NSAnimationContext), currentContext];
    let _: () = msg_send![context, setDuration: TRAFFIC_LIGHT_FADE_SECONDS];
    let curve = NSString::alloc(cocoa::base::nil).init_str("easeInEaseOut");
    let timing: id = msg_send![class!(CAMediaTimingFunction), functionWithName: curve];
    let _: () = msg_send![context, setTimingFunction: timing];
    let _: () = msg_send![context, setAllowsImplicitAnimation: cocoa::base::YES];
    for kind in 0..3_i64 {
        let button: id = msg_send![ns_window, standardWindowButton: kind];
        if button.is_null() {
            continue;
        }
        let hidden: cocoa::base::BOOL = msg_send![button, isHidden];
        if hidden == cocoa::base::NO {
            continue;
        }
        let _: () = msg_send![button, setAlphaValue: 0.0_f64];
        let _: () = msg_send![button, setHidden: cocoa::base::NO];
        let animator: id = msg_send![button, animator];
        let _: () = msg_send![animator, setAlphaValue: alpha];
    }
    let _: () = msg_send![class!(NSAnimationContext), endGrouping];
}

/// Before the window is first shown: the buttons wait hidden until the layout places them, so
/// they never show in AppKit's spot and then jump. Returns whether they are waiting.
#[cfg(target_os = "macos")]
pub unsafe fn hold_traffic_lights(ns_window: id) -> bool {
    if placement(ns_window).is_some() {
        return false;
    }
    hide_buttons(ns_window);
    true
}

/// A window whose layout never placed its buttons still gets them, in the usual spot.
#[cfg(target_os = "macos")]
pub fn release_traffic_lights_later<R: Runtime>(webview: Webview<R>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(PLACEMENT_WAIT).await;
        let _ = webview.with_webview(|webview| unsafe {
            let ns_window = webview.ns_window() as id;
            if placement(ns_window).is_none() {
                position_traffic_lights(ns_window, -1.0, 0.0);
            }
        });
    });
}

/// Leaving full screen, AppKit brings the buttons back in its own spot and drops the anchors that
/// held them. They hide as the window leaves and come back already in place once it has.
#[cfg(target_os = "macos")]
pub fn install() {
    unsafe fn observe(name: &str, block: id) {
        use cocoa::foundation::NSString;
        let center: id = msg_send![class!(NSNotificationCenter), defaultCenter];
        let name = NSString::alloc(cocoa::base::nil).init_str(name);
        let _: id = msg_send![center,
            addObserverForName: name
            object: cocoa::base::nil
            queue: cocoa::base::nil
            usingBlock: block];
    }
    let leaving = block2::RcBlock::new(|notification: *mut c_void| unsafe {
        let window: id = msg_send![notification as id, object];
        if !window.is_null() && placement(window).is_some() {
            hide_buttons(window);
        }
    });
    let left = block2::RcBlock::new(|notification: *mut c_void| unsafe {
        let window: id = msg_send![notification as id, object];
        if window.is_null() {
            return;
        }
        if let Some((offset_x, offset_y)) = placement(window) {
            position_traffic_lights(window, offset_x, offset_y);
        }
    });
    let stayed = block2::RcBlock::new(|notification: *mut c_void| unsafe {
        let window: id = msg_send![notification as id, object];
        if !window.is_null() && placement(window).is_some() {
            fade_in_buttons(window);
        }
    });
    unsafe {
        observe(
            "NSWindowWillExitFullScreenNotification",
            &*leaving as *const _ as id,
        );
        observe("NSWindowDidExitFullScreenNotification", &*left as *const _ as id);
        observe(
            "NSWindowDidFailToExitFullScreenNotification",
            &*stayed as *const _ as id,
        );
    }
    // The observers live as long as the app does.
    std::mem::forget((leaving, left, stayed));
}

/// Anchors the buttons `offset_x`/`offset_y` from their usual spot and shows them there. In full
/// screen the offset is only remembered, for when the window leaves it.
#[cfg(target_os = "macos")]
pub unsafe fn position_traffic_lights(ns_window: id, offset_x: f64, offset_y: f64) {
    remember_placement(ns_window, offset_x, offset_y);
    let style_mask = ns_window.styleMask();
    if style_mask.contains(NSWindowStyleMask::NSFullScreenWindowMask) {
        return;
    }

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
    // Laid out again while the sidebar is away, the buttons start where it left them.
    let away_by = away_distance(ns_window).unwrap_or(0.0);
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
            constant: TRAFFIC_LIGHT_DEFAULT_X + offset_x + TRAFFIC_LIGHT_SPACING * index as f64 - away_by]);
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
    // Laid out in place first, so they only ever fade in where they belong.
    fade_in_buttons(ns_window);
}
