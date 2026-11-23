#![allow(unexpected_cfgs)]

use std::{
    collections::HashMap,
    ffi::CStr,
    sync::{Mutex, OnceLock},
};

use objc::runtime::{Class, Object, Sel, BOOL, YES};
use objc::{msg_send, sel, sel_impl};
use tauri::{AppHandle, Webview};

use crate::apps::frames::{self, FrameOrigin, Heard};

pub(super) const SENDER: &str = "() => { const handler = window.webkit?.messageHandlers?.mistyAdapter; return handler && typeof handler.postMessage === 'function' ? handler.postMessage.bind(handler) : null; }";
const SCREEN: &str = include_str!("../../../apps/screen.js");
const HANDLER_CLASS: &str = "MistyAdapterChannelHandler";
const AT_DOCUMENT_START: isize = 0;
const UTF8: usize = 4;

fn targets() -> &'static Mutex<HashMap<usize, String>> {
    static TARGETS: OnceLock<Mutex<HashMap<usize, String>>> = OnceLock::new();
    TARGETS.get_or_init(Mutex::default)
}

unsafe fn string(text: &str) -> *mut Object {
    let string: *mut Object = msg_send![Class::get("NSString").unwrap(), alloc];
    msg_send![string, initWithBytes: text.as_ptr() length: text.len() encoding: UTF8]
}

unsafe fn text_of(value: *mut Object) -> Option<String> {
    if value.is_null() {
        return None;
    }
    let raw: *const std::os::raw::c_char = msg_send![value, UTF8String];
    if raw.is_null() {
        return None;
    }
    CStr::from_ptr(raw).to_str().ok().map(str::to_owned)
}

unsafe fn origin_of(frame: *mut Object) -> Option<FrameOrigin> {
    if frame.is_null() {
        return None;
    }
    let origin: *mut Object = msg_send![frame, securityOrigin];
    if origin.is_null() {
        return None;
    }
    let scheme = text_of(msg_send![origin, protocol])?.to_ascii_lowercase();
    let host = text_of(msg_send![origin, host])?.to_ascii_lowercase();
    let port: isize = msg_send![origin, port];
    let default = match scheme.as_str() {
        "https" => 443,
        "http" => 80,
        _ => -1,
    };
    let port = (port > 0 && port != default && port <= u16::MAX as isize).then_some(port as u16);
    Some(FrameOrigin { scheme, host, port })
}

unsafe fn world() -> *mut Object {
    let name = string(frames::ADAPTER_WORLD);
    let world: *mut Object = msg_send![Class::get("WKContentWorld").unwrap(), worldWithName: name];
    let _: () = msg_send![name, release];
    world
}

unsafe fn evaluate(view: *mut Object, script: &str) {
    if view.is_null() {
        return;
    }
    let text = string(script);
    let _: () = msg_send![view, evaluateJavaScript: text inFrame: std::ptr::null_mut::<Object>() inContentWorld: world() completionHandler: std::ptr::null_mut::<Object>()];
    let _: () = msg_send![text, release];
}

fn shortcuts_script(app: &AppHandle) -> String {
    use tauri::Manager;
    let bindings = app
        .try_state::<crate::browser::BrowserSessionState>()
        .map(|state| crate::browser::input::shortcuts::current_shortcut_bindings(&state))
        .unwrap_or_default();
    let payload = serde_json::to_string(&bindings).unwrap_or_else(|_| "[]".to_owned());
    format!("window.__MISTY_SET_SHORTCUTS__&&window.__MISTY_SET_SHORTCUTS__({payload});")
}

unsafe fn run_adapter(app: &AppHandle, view: *mut Object, adapter: Option<&str>) {
    evaluate(view, SCREEN);
    evaluate(
        view,
        &format!(
            "{}\n;if (typeof MistySDK !== \"undefined\") window.MistySDK = MistySDK;",
            frames::SDK_SCRIPT
        ),
    );
    if let Some(adapter) = adapter {
        evaluate(view, adapter);
    }
    evaluate(view, &shortcuts_script(app));
}

pub(crate) fn send_shortcuts(page: &Webview, payload: &str) -> Result<(), String> {
    let script =
        format!("window.__MISTY_SET_SHORTCUTS__&&window.__MISTY_SET_SHORTCUTS__({payload});");
    page.with_webview(move |native| unsafe {
        evaluate(native.inner() as *mut Object, &script);
    })
    .map_err(|error| error.to_string())
}

extern "C" fn receive(
    this: &Object,
    _selector: Sel,
    _controller: *mut Object,
    message: *mut Object,
) {
    let Some(label) = targets()
        .lock()
        .ok()
        .and_then(|targets| targets.get(&(this as *const _ as usize)).cloned())
    else {
        return;
    };
    let Some(app) = frames::app() else {
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
        let Some(text) = text_of(body) else {
            return;
        };
        let frame: *mut Object = msg_send![message, frameInfo];
        if frame.is_null() {
            return;
        }
        let main_frame: BOOL = msg_send![frame, isMainFrame];
        let origin = origin_of(frame);
        if let Heard::Ready(adapter) =
            frames::receive(app, &label, main_frame == YES, origin.as_ref(), &text)
        {
            let view: *mut Object = msg_send![message, webView];
            run_adapter(app, view, adapter.as_deref());
            if let Some(mount) = frames::mount_of(&label) {
                frames::emit_page(app, mount, "ready", None);
            }
        }
    }
}

pub(super) fn install(page: &Webview, relay: &str) -> Result<(), String> {
    let label = page.label().to_owned();
    let relay = relay.to_owned();
    page.with_webview(move |native| unsafe {
        let view = native.inner() as *mut Object;
        let configuration: *mut Object = msg_send![view, configuration];
        let controller: *mut Object = msg_send![configuration, userContentController];
        let world = world();
        let text = string(&relay);
        let script: *mut Object = msg_send![Class::get("WKUserScript").unwrap(), alloc];
        let script: *mut Object = msg_send![script, initWithSource: text injectionTime: AT_DOCUMENT_START forMainFrameOnly: YES inContentWorld: world];
        let _: () = msg_send![controller, addUserScript: script];
        let _: () = msg_send![script, release];
        let _: () = msg_send![text, release];
        let class = Class::get(HANDLER_CLASS).unwrap_or_else(|| {
            let mut declaration = objc::declare::ClassDecl::new(HANDLER_CLASS, Class::get("NSObject").unwrap())
                .expect("unique adapter handler class");
            declaration.add_method(
                sel!(userContentController:didReceiveScriptMessage:),
                receive as extern "C" fn(&Object, Sel, *mut Object, *mut Object),
            );
            declaration.register()
        });
        let handler: *mut Object = msg_send![class, new];
        if let Ok(mut targets) = targets().lock() {
            targets.retain(|_, other| *other != label);
            targets.insert(handler as usize, label);
        }
        let handler_name = string(frames::ADAPTER_HANDLER);
        let _: () = msg_send![controller, addScriptMessageHandler: handler contentWorld: world name: handler_name];
        let _: () = msg_send![handler_name, release];
        let _: () = msg_send![handler, release];
    })
    .map_err(|error| error.to_string())
}

pub(super) fn forget(label: &str) {
    if let Ok(mut targets) = targets().lock() {
        targets.retain(|_, other| other != label);
    }
}
