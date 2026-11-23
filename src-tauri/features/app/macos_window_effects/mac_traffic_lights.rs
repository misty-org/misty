#![allow(unexpected_cfgs)]
#![allow(deprecated)]

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
static TRAFFIC_LIGHT_PLACEMENT_ASSOCIATION_KEY: u8 = 1;

#[cfg(target_os = "macos")]
const PLACEMENT_WAIT: std::time::Duration = std::time::Duration::from_secs(10);

#[cfg(target_os = "macos")]
const OBJC_ASSOCIATION_RETAIN_NONATOMIC: usize = 1;

#[cfg(target_os = "macos")]
static TRAFFIC_LIGHT_AWAY_ASSOCIATION_KEY: u8 = 2;

#[cfg(target_os = "macos")]
const TRAFFIC_LIGHT_DEFAULT_X: f64 = 20.0;

#[cfg(target_os = "macos")]
const TRAFFIC_LIGHT_DEFAULT_Y: f64 = 19.0;

#[cfg(target_os = "macos")]
const TRAFFIC_LIGHT_SPACING: f64 = 23.0;

#[tauri::command]
pub fn set_traffic_lights_visible<R: Runtime>(
    _app: AppHandle<R>,
    window: Webview<R>,
    visible: bool,
    distance: Option<f64>,
    rise: Option<f64>,
    duration_ms: Option<f64>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let distance = distance.unwrap_or(0.0);
        let rise = rise.unwrap_or(0.0);
        let seconds = duration_ms.unwrap_or(0.0) / 1000.0;
        window
            .with_webview(move |webview| unsafe {
                use cocoa::foundation::{NSRect, NSString};
                let ns_window = webview.ns_window() as id;
                if away_offset(ns_window).is_none() == visible {
                    return;
                }
                remember_away(ns_window, (!visible).then_some((distance, rise)));
                let placed = placement(ns_window);
                let (offset_x, offset_y) = placed.unwrap_or((0.0, 0.0));
                let rest_x = TRAFFIC_LIGHT_DEFAULT_X + offset_x;
                let rest_y = TRAFFIC_LIGHT_DEFAULT_Y + offset_y;
                let key = &TRAFFIC_LIGHT_CONSTRAINTS_ASSOCIATION_KEY as *const u8 as *const c_void;
                let constraints = objc_getAssociatedObject(ns_window, key);
                let _: () = msg_send![class!(NSAnimationContext), beginGrouping];
                let context: id = msg_send![class!(NSAnimationContext), currentContext];
                let _: () = msg_send![context, setDuration: seconds];
                let curve = if rise > 0.0 {
                    "linear"
                } else {
                    "easeInEaseOut"
                };
                let curve = NSString::alloc(cocoa::base::nil).init_str(curve);
                let timing: id = msg_send![class!(CAMediaTimingFunction), functionWithName: curve];
                let _: () = msg_send![context, setTimingFunction: timing];
                let _: () = msg_send![context, setAllowsImplicitAnimation: cocoa::base::YES];
                for kind in 0..3_i64 {
                    let button: id = msg_send![ns_window, standardWindowButton: kind];
                    if button.is_null() {
                        continue;
                    }
                    if placed.is_some() {
                        let _: () = msg_send![button, setHidden: cocoa::base::NO];
                    }
                    if !constraints.is_null() {
                        let leading: id =
                            msg_send![constraints, objectAtIndex: (kind as usize) * 4];
                        let rest = rest_x + TRAFFIC_LIGHT_SPACING * kind as f64;
                        let target = if visible { rest } else { rest - distance };
                        let constraint: id = msg_send![leading, animator];
                        let _: () = msg_send![constraint, setConstant: target];
                        let top: id =
                            msg_send![constraints, objectAtIndex: (kind as usize) * 4 + 1];
                        let frame: NSRect = msg_send![button, frame];
                        let rest = rest_y - frame.size.height / 2.0;
                        let target = if visible { rest } else { rest - rise };
                        let constraint: id = msg_send![top, animator];
                        let _: () = msg_send![constraint, setConstant: target];
                    }
                }
                let _: () = msg_send![class!(NSAnimationContext), endGrouping];
            })
            .map_err(|e| e.to_string())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, visible, distance, rise, duration_ms);
        Ok(())
    }
}

#[cfg(target_os = "macos")]
unsafe fn stored_pair(stored: id) -> (f64, f64) {
    let x: id = msg_send![stored, objectAtIndex: 0_usize];
    let y: id = msg_send![stored, objectAtIndex: 1_usize];
    (msg_send![x, doubleValue], msg_send![y, doubleValue])
}

#[cfg(target_os = "macos")]
unsafe fn pair_to_store(x: f64, y: f64) -> id {
    let values: [id; 2] = [
        msg_send![class!(NSNumber), numberWithDouble: x],
        msg_send![class!(NSNumber), numberWithDouble: y],
    ];
    msg_send![class!(NSArray), arrayWithObjects: values.as_ptr() count: 2_usize]
}

#[cfg(target_os = "macos")]
unsafe fn away_offset(ns_window: id) -> Option<(f64, f64)> {
    let key = &TRAFFIC_LIGHT_AWAY_ASSOCIATION_KEY as *const u8 as *const c_void;
    let stored = objc_getAssociatedObject(ns_window, key);
    (!stored.is_null()).then(|| stored_pair(stored))
}

#[cfg(target_os = "macos")]
unsafe fn remember_away(ns_window: id, offset: Option<(f64, f64)>) {
    let key = &TRAFFIC_LIGHT_AWAY_ASSOCIATION_KEY as *const u8 as *const c_void;
    let stored = match offset {
        Some((x, y)) => pair_to_store(x, y),
        None => cocoa::base::nil,
    };
    objc_setAssociatedObject(ns_window, key, stored, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

#[cfg(target_os = "macos")]
unsafe fn placement(ns_window: id) -> Option<(f64, f64)> {
    let key = &TRAFFIC_LIGHT_PLACEMENT_ASSOCIATION_KEY as *const u8 as *const c_void;
    let stored = objc_getAssociatedObject(ns_window, key);
    (!stored.is_null()).then(|| stored_pair(stored))
}

#[cfg(target_os = "macos")]
unsafe fn remember_placement(ns_window: id, offset_x: f64, offset_y: f64) {
    let key = &TRAFFIC_LIGHT_PLACEMENT_ASSOCIATION_KEY as *const u8 as *const c_void;
    let stored = pair_to_store(offset_x, offset_y);
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

#[cfg(target_os = "macos")]
unsafe fn show_buttons(ns_window: id) {
    for kind in 0..3_i64 {
        let button: id = msg_send![ns_window, standardWindowButton: kind];
        if !button.is_null() {
            let _: () = msg_send![button, setHidden: cocoa::base::NO];
        }
    }
}

#[cfg(target_os = "macos")]
pub unsafe fn hold_traffic_lights(ns_window: id) -> bool {
    hold_buttons(ns_window)
}

#[cfg(target_os = "macos")]
pub unsafe fn hold_traffic_lights_of(ns_window: *mut c_void) -> bool {
    hold_buttons(ns_window as id)
}

#[cfg(target_os = "macos")]
unsafe fn hold_buttons(ns_window: id) -> bool {
    if placement(ns_window).is_some() {
        return false;
    }
    hide_buttons(ns_window);
    true
}

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
            show_buttons(window);
        }
    });
    unsafe {
        observe(
            "NSWindowWillExitFullScreenNotification",
            &*leaving as *const _ as id,
        );
        observe(
            "NSWindowDidExitFullScreenNotification",
            &*left as *const _ as id,
        );
        observe(
            "NSWindowDidFailToExitFullScreenNotification",
            &*stayed as *const _ as id,
        );
    }
    std::mem::forget((leaving, left, stayed));
}

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

    let content_view = ns_window.contentView();
    if content_view.is_null() {
        return;
    }
    let key = &TRAFFIC_LIGHT_CONSTRAINTS_ASSOCIATION_KEY as *const u8 as *const c_void;
    let previous = objc_getAssociatedObject(ns_window, key);
    if !previous.is_null() {
        let _: () = msg_send![class!(NSLayoutConstraint), deactivateConstraints: previous];
    }
    let (away_x, away_y) = away_offset(ns_window).unwrap_or((0.0, 0.0));
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
            constant: TRAFFIC_LIGHT_DEFAULT_X + offset_x + TRAFFIC_LIGHT_SPACING * index as f64 - away_x]);
        constraints.push(msg_send![button_top,
            constraintEqualToAnchor: top
            constant: TRAFFIC_LIGHT_DEFAULT_Y + offset_y - frame.size.height / 2.0 - away_y]);
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
    show_buttons(ns_window);
}
