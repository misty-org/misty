//! WebKit on macOS: a WKScriptMessageHandler named `kiriHost`.
#![allow(unexpected_cfgs)]

use super::{deliver, HANDLER_NAME};
use objc::runtime::{Class, Object, Sel, BOOL, YES};
use objc::{msg_send, sel, sel_impl};
use std::{
    collections::{HashMap, HashSet},
    ffi::{CStr, CString},
    sync::{Mutex, OnceLock},
};
use tauri::Webview;

const HANDLER_CLASS: &str = "KiriHostChannelHandler";

pub(super) const SENDER_SCRIPT: &str = "() => { const handler = window.webkit?.messageHandlers?.kiriHost; return handler && typeof handler.postMessage === 'function' ? handler.postMessage.bind(handler) : null; }";

/// Handler object → the tab it serves.
fn targets() -> &'static Mutex<HashMap<usize, String>> {
    static TARGETS: OnceLock<Mutex<HashMap<usize, String>>> = OnceLock::new();
    TARGETS.get_or_init(Mutex::default)
}

/// Content controllers that already have the handler; adding a name twice throws.
fn installed() -> &'static Mutex<HashSet<usize>> {
    static INSTALLED: OnceLock<Mutex<HashSet<usize>>> = OnceLock::new();
    INSTALLED.get_or_init(Mutex::default)
}

extern "C" fn receive(this: &Object, _selector: Sel, _controller: *mut Object, message: *mut Object) {
    let Some(label) = targets()
        .lock()
        .ok()
        .and_then(|targets| targets.get(&(this as *const _ as usize)).cloned())
    else {
        return;
    };
    unsafe {
        let body: *mut Object = msg_send![message, body];
        if body.is_null() {
            return;
        }
        let is_string: BOOL = msg_send![body, isKindOfClass: Class::get("NSString").unwrap()];
        if is_string != YES {
            return;
        }
        let raw: *const std::os::raw::c_char = msg_send![body, UTF8String];
        if raw.is_null() {
            return;
        }
        let Ok(text) = CStr::from_ptr(raw).to_str() else {
            return;
        };
        let frame: *mut Object = msg_send![message, frameInfo];
        let main_frame: BOOL = msg_send![frame, isMainFrame];
        deliver(&label, main_frame == YES, text);
    }
}

pub(super) fn install(webview: &Webview) -> Result<(), String> {
    let label = webview.label().to_owned();
    webview
        .with_webview(move |native| unsafe {
            let view = native.inner() as *mut Object;
            let configuration: *mut Object = msg_send![view, configuration];
            let controller: *mut Object = msg_send![configuration, userContentController];
            let first = installed()
                .lock()
                .map(|mut controllers| controllers.insert(controller as usize))
                .unwrap_or(false);
            if !first {
                return;
            }
            let class = Class::get(HANDLER_CLASS).unwrap_or_else(|| {
                let mut declaration =
                    objc::declare::ClassDecl::new(HANDLER_CLASS, Class::get("NSObject").unwrap()).unwrap();
                declaration.add_method(
                    sel!(userContentController:didReceiveScriptMessage:),
                    receive as extern "C" fn(&Object, Sel, *mut Object, *mut Object),
                );
                declaration.register()
            });
            let handler: *mut Object = msg_send![class, new];
            if let Ok(mut targets) = targets().lock() {
                targets.insert(handler as usize, label);
            }
            let name = CString::new(HANDLER_NAME).expect("handler name");
            let name: *mut Object =
                msg_send![Class::get("NSString").unwrap(), stringWithUTF8String: name.as_ptr()];
            let _: () = msg_send![controller, addScriptMessageHandler: handler name: name];
            let _: () = msg_send![handler, release];
        })
        .map_err(|error| error.to_string())
}

pub(super) fn forget(webview: &str) {
    if let Ok(mut targets) = targets().lock() {
        targets.retain(|_, label| label != webview);
    }
}
