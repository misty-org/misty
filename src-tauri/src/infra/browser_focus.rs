#![allow(unexpected_cfgs)]
use super::*;
use objc::{msg_send, sel, sel_impl};
use objc::runtime::{Class, Object, Sel, BOOL, YES};
use std::sync::OnceLock;

type Target = (AppHandle, String);
static TARGETS: OnceLock<Mutex<HashMap<usize, Target>>> = OnceLock::new();
fn targets() -> &'static Mutex<HashMap<usize, Target>> { TARGETS.get_or_init(Mutex::default) }

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct PointerMessage {
    token: String,
    pointer: PointerPosition,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct PointerPosition {
    x: f64,
    y: f64,
    inside: bool,
}

fn pointer_message(raw: &str) -> Option<PointerMessage> {
    if raw.len() > 1024 { return None; }
    let message: PointerMessage = serde_json::from_str(raw).ok()?;
    let p = &message.pointer;
    if !p.x.is_finite() || !p.y.is_finite() || !(0.0..=100_000.0).contains(&p.x) || !(0.0..=100_000.0).contains(&p.y) {
        return None;
    }
    Some(message)
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct BackgroundMessage {
    token: String,
    background: String,
}
fn background_message(raw: &str) -> Option<BackgroundMessage> {
    if raw.len() > 1024 { return None; }
    let message: BackgroundMessage = serde_json::from_str(raw).ok()?;
    let color = message.background.as_bytes();
    if color.len() != 7 || color[0] != b'#' || !color[1..].iter().all(u8::is_ascii_hexdigit) {
        return None;
    }
    Some(message)
}

pub(super) fn forget(id: &str) {
    if let Ok(mut values) = targets().lock() { values.retain(|_, (_, target)| target != id); }
}
extern "C" fn receive(this: &Object, _: Sel, _: *mut Object, message: *mut Object) {
    let target = targets().lock().ok().and_then(|values| values.get(&(this as *const _ as usize)).cloned());
    let Some((app, id)) = target else { return; };
    unsafe {
        let body: *mut Object = msg_send![message, body];
        if body.is_null() { return; }
        let is_string: BOOL = msg_send![body, isKindOfClass: Class::get("NSString").unwrap()];
        if is_string != YES { return; }
        let raw: *const std::os::raw::c_char = msg_send![body, UTF8String];
        if raw.is_null() { return; }
        let Ok(token) = std::ffi::CStr::from_ptr(raw).to_str() else { return; };
        if let Some(background) = background_message(token) {
            let frame: *mut Object = msg_send![message, frameInfo];
            let main_frame: BOOL = msg_send![frame, isMainFrame];
            if main_frame != YES || !super::shortcut_token_matches(&app.state::<BrowserSessionState>(), &id, &background.token) { return; }
            let _ = app.emit_to(super::browser_owner_label(&app, &id), "misty://browser-background", json!({ "id": id, "color": background.background }));
            return;
        }
        // Companion tracking shares the authenticated native channel with focus.
        // URL-based telemetry cancels WebKit loads while the user moves the mouse.
        if let Some(message) = pointer_message(token) {
            if !super::shortcut_token_matches(&app.state::<BrowserSessionState>(), &id, &message.token) { return; }
            super::emit_browser_pointer(&app, &id, super::super::browser_scripts::BrowserPointerNavigation {
                x: message.pointer.x, y: message.pointer.y, inside: message.pointer.inside,
            });
            return;
        }
        if !super::shortcut_token_matches(&app.state::<BrowserSessionState>(), &id, token) { return; }
    }
    let _ = app.emit_to(super::browser_owner_label(&app,&id), "misty://browser-focus", BrowserFocusEvent { id });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_background_messages_accept_only_bounded_hex_colors() {
        assert!(background_message(r##"{"token":"test","background":"#202124"}"##).is_some());
        for raw in [
            r##"{"background":"#202124"}"##,
            r##"{"token":"test","background":"#20212400"}"##,
            r##"{"token":"test","background":"red"}"##,
            r##"{"token":"test","background":"#gggggg"}"##,
            r##"{"token":"test","background":"#202124","extra":true}"##,
        ] {
            assert!(background_message(raw).is_none(), "{raw}");
        }
    }

    #[test]
    fn native_pointer_messages_require_bounded_coordinates_and_a_token() {
        assert!(pointer_message(r#"{"token":"test","pointer":{"x":12.5,"y":40,"inside":true}}"#).is_some());
        assert!(pointer_message(r#"{"token":"test","pointer":{"x":0,"y":0,"inside":false}}"#).is_some());
        for raw in [
            r#"{"pointer":{"x":0,"y":0,"inside":true}}"#,
            r#"{"token":"test","pointer":{"x":-1,"y":0,"inside":true}}"#,
            r#"{"token":"test","pointer":{"x":100001,"y":0,"inside":true}}"#,
            r#"{"token":"test","pointer":{"x":0,"y":null,"inside":true}}"#,
        ] {
            assert!(pointer_message(raw).is_none(), "{raw}");
        }
    }
}
pub(super) fn install(app: &AppHandle, view: &Webview, id: &str) -> Result<(), String> {
    let app = app.clone();
    let id = id.to_owned();
    view.with_webview(move |native| unsafe {
        let class = Class::get("MistyBrowserFocusHandler").unwrap_or_else(|| {
            let mut declaration = objc::declare::ClassDecl::new("MistyBrowserFocusHandler", Class::get("NSObject").unwrap()).unwrap();
            declaration.add_method(sel!(userContentController:didReceiveScriptMessage:), receive as extern "C" fn(&Object, Sel, *mut Object, *mut Object));
            declaration.register()
        });
        let handler: *mut Object = msg_send![class, new];
        targets().lock().unwrap().insert(handler as usize, (app, id));
        let webview = native.inner() as *mut Object;
        let configuration: *mut Object = msg_send![webview, configuration];
        let controller: *mut Object = msg_send![configuration, userContentController];
        let name: *mut Object = msg_send![Class::get("NSString").unwrap(), stringWithUTF8String: c"mistyFocus".as_ptr()];
        let _: () = msg_send![controller, addScriptMessageHandler: handler name: name];
        let _: () = msg_send![handler, release];
    }).map_err(|error| error.to_string())
}
