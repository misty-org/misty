//! Brings Misty forward when the system's picture-in-picture window goes away.
//!
//! The floating window's back-to-tab button returns the video to its page, and then leaves it to
//! the page's process to say so. With Misty behind another app that word can wait until Misty is
//! next opened, so the video seems stuck. The window itself is seen here at once, in the app's own
//! process, so the moment it disappears Misty activates itself and tells the interface to show the
//! tab that floated. The window is looked for, not waited on, because it is hidden rather than
//! closed, which sends no notification.
#![allow(unexpected_cfgs)]
#![allow(deprecated)]

use std::sync::atomic::{AtomicBool, Ordering};

use cocoa::{
    base::{id, YES},
    foundation::NSString,
};
use objc::{class, msg_send, sel, sel_impl};
use tauri::{AppHandle, Emitter, Manager};

static FLOATING: AtomicBool = AtomicBool::new(false);

fn is_picture_in_picture(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.contains("pip") || lower.contains("pictureinpicture")
}

/// Records whether the floating window is on screen, and brings Misty forward the moment it goes.
fn apply(app: &AppHandle, present: bool) {
    let was = FLOATING.swap(present, Ordering::AcqRel);
    if !was || present {
        return;
    }
    // It was there and now it is gone: back to the tab, or closed. Misty comes forward either way.
    unsafe {
        let shared: id = msg_send![class!(NSApplication), sharedApplication];
        // macOS 14 made activating from the background cooperative: `activate` is honoured when
        // the person has just used one of the app's own windows, as the floating window is, while
        // the older ignore-other-apps form is no longer reliable.
        let modern: bool = msg_send![shared, respondsToSelector: sel!(activate)];
        if modern {
            let _: () = msg_send![shared, activate];
        } else {
            let _: () = msg_send![shared, activateIgnoringOtherApps: YES];
        }
    }
    if let Some(main) = crate::infra::space_windows::primary(app) {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
    let _ = app.emit("misty://pip-window-closed", ());
}

/// Whether `window` is the floating window and is on screen (not hidden or covered entirely).
unsafe fn floating_window_visible(window: id) -> Option<bool> {
    if window.is_null() {
        return None;
    }
    let class_name: id = msg_send![window, className];
    if class_name.is_null() {
        return None;
    }
    let bytes = NSString::UTF8String(class_name);
    if bytes.is_null() {
        return None;
    }
    let name = std::ffi::CStr::from_ptr(bytes)
        .to_string_lossy()
        .to_string();
    if !is_picture_in_picture(&name) {
        return None;
    }
    let visible: bool = msg_send![window, isVisible];
    Some(visible)
}

/// Watches for the floating window being shown or hidden, by notification alone: nothing here
/// looks again on a timer.
pub fn install(app: &AppHandle) {
    let handle = app.clone();
    let block = block2::RcBlock::new(move |notification: *mut std::ffi::c_void| unsafe {
        let window: id = msg_send![notification as id, object];
        if let Some(visible) = floating_window_visible(window) {
            #[cfg(debug_assertions)]
            eprintln!("pip-observer: floating window notification, visible {visible}");
            apply(&handle, visible);
        }
    });
    unsafe {
        let center: id = msg_send![class!(NSNotificationCenter), defaultCenter];
        // A window's occlusion changes when it is ordered out as well as when it is covered, and
        // closing alone sends nothing for this panel.
        for name in [
            "NSWindowDidChangeOcclusionStateNotification",
            "NSWindowWillCloseNotification",
        ] {
            let name = NSString::alloc(cocoa::base::nil).init_str(name);
            let _: id = msg_send![center,
                addObserverForName: name
                object: cocoa::base::nil
                queue: cocoa::base::nil
                usingBlock: &*block as *const _ as id];
        }
    }
    // The observers live as long as the app does.
    std::mem::forget(block);
}
