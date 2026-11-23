#![allow(unexpected_cfgs)]
#![allow(deprecated)]

use std::sync::atomic::{AtomicBool, Ordering};

use cocoa::{
    base::{id, YES},
    foundation::NSString,
};
use objc::{class, msg_send, sel, sel_impl};
use tauri::{AppHandle, Emitter};

static FLOATING: AtomicBool = AtomicBool::new(false);

fn is_picture_in_picture(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.contains("pip") || lower.contains("pictureinpicture")
}

fn apply(app: &AppHandle, present: bool) {
    let was = FLOATING.swap(present, Ordering::AcqRel);
    if !was || present {
        return;
    }
    unsafe {
        let shared: id = msg_send![class!(NSApplication), sharedApplication];
        let modern: bool = msg_send![shared, respondsToSelector: sel!(activate)];
        if modern {
            let _: () = msg_send![shared, activate];
        } else {
            let _: () = msg_send![shared, activateIgnoringOtherApps: YES];
        }
    }
    if let Some(main) = crate::browser::app_windows::primary(app) {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
    let _ = app.emit("misty://pip-window-closed", ());
}

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
    std::mem::forget(block);
}
