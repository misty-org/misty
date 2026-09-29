//! Tells Misty the moment a page's address changes without loading anything: the History API,
//! the hash, or a single-page site such as YouTube moving between videos. WebKit reports these
//! only by changing the view's `URL`, so this observes that property (key-value observing) and
//! emits one event per change. Nothing is polled and nothing the page sends is trusted.
#![cfg(target_os = "macos")]
use objc::{
    class, msg_send,
    runtime::{Class, Object, Sel},
    sel, sel_impl,
};
use std::{
    collections::HashMap,
    ffi::CStr,
    os::raw::{c_char, c_void},
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Emitter, Webview};

const OBSERVER_CLASS: &str = "MistyUrlObserver";

struct Target {
    app: AppHandle,
    id: String,
    view: usize,
    last: String,
}

/// Observer object → the tab it serves.
fn targets() -> &'static Mutex<HashMap<usize, Target>> {
    static TARGETS: OnceLock<Mutex<HashMap<usize, Target>>> = OnceLock::new();
    TARGETS.get_or_init(Mutex::default)
}

unsafe fn url_of(view: *mut Object) -> Option<String> {
    let url: *mut Object = msg_send![view, URL];
    if url.is_null() {
        return None;
    }
    let text: *mut Object = msg_send![url, absoluteString];
    if text.is_null() {
        return None;
    }
    let raw: *const c_char = msg_send![text, UTF8String];
    if raw.is_null() {
        return None;
    }
    CStr::from_ptr(raw).to_str().ok().map(str::to_owned)
}

extern "C" fn observe(
    this: &Object,
    _selector: Sel,
    _key_path: *mut Object,
    object: *mut Object,
    _change: *mut Object,
    _context: *mut c_void,
) {
    let Some(url) = (unsafe { url_of(object) }) else {
        return;
    };
    // Only real pages: a blank placeholder or an internal scheme is not an address to show.
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return;
    }
    let (app, id) = {
        let Ok(mut targets) = targets().lock() else {
            return;
        };
        let Some(target) = targets.get_mut(&(this as *const Object as usize)) else {
            return;
        };
        if target.last == url {
            return;
        }
        target.last = url.clone();
        (target.app.clone(), target.id.clone())
    };
    super::emit_navigated(&app, &id, url);
}

/// Starts reporting this tab's address changes.
pub(super) fn install(app: &AppHandle, webview: &Webview, id: &str) -> Result<(), String> {
    let app = app.clone();
    let id = id.to_owned();
    webview
        .with_webview(move |native| unsafe {
            let view = native.inner() as *mut Object;
            let class = Class::get(OBSERVER_CLASS).unwrap_or_else(|| {
                let mut declaration =
                    objc::declare::ClassDecl::new(OBSERVER_CLASS, class!(NSObject)).expect("unique observer class");
                declaration.add_method(
                    sel!(observeValueForKeyPath:ofObject:change:context:),
                    observe as extern "C" fn(&Object, Sel, *mut Object, *mut Object, *mut Object, *mut c_void),
                );
                declaration.register()
            });
            let observer: *mut Object = msg_send![class, new];
            if let Ok(mut targets) = targets().lock() {
                targets.insert(
                    observer as usize,
                    Target { app, id, view: view as usize, last: String::new() },
                );
            }
            let key: *mut Object = msg_send![class!(NSString), stringWithUTF8String: b"URL\0".as_ptr()];
            let _: () = msg_send![view, addObserver: observer forKeyPath: key options: 0usize context: std::ptr::null_mut::<c_void>()];
        })
        .map_err(|error| error.to_string())
}

/// Stops observing a tab. WebKit refuses to free a view that still has observers, so this runs
/// before the view closes.
pub(super) fn remove(webview: &Webview, id: &str) {
    let id = id.to_owned();
    let _ = webview.with_webview(move |native| unsafe {
        let view = native.inner() as *mut Object;
        let observers: Vec<usize> = targets()
            .lock()
            .map(|targets| {
                targets
                    .iter()
                    .filter(|(_, target)| target.id == id && target.view == view as usize)
                    .map(|(observer, _)| *observer)
                    .collect()
            })
            .unwrap_or_default();
        for observer in observers {
            let key: *mut Object = msg_send![class!(NSString), stringWithUTF8String: b"URL\0".as_ptr()];
            let observer_object = observer as *mut Object;
            let _: () = msg_send![view, removeObserver: observer_object forKeyPath: key];
            if let Ok(mut targets) = targets().lock() {
                targets.remove(&observer);
            }
            let _: () = msg_send![observer_object, release];
        }
    });
}
