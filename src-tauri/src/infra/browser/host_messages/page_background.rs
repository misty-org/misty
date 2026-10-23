//! Each page's reported background color, kept and replayed on its native view.
use super::*;

/// Each page's last reported color. Pages survive renderer reloads, but only
/// report a color when it changes, so the shell replays it on reattachment.
static PAGE_BACKGROUNDS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
pub(super) fn page_backgrounds() -> &'static Mutex<HashMap<String, String>> {
    PAGE_BACKGROUNDS.get_or_init(Mutex::default)
}

/// A new document reports its own color; never show the previous page's.
pub(in crate::infra::browser) fn forget_page_background(id: &str) {
    if let Ok(mut values) = page_backgrounds().lock() {
        values.remove(id);
    }
}

/// The page's last reported color, if it has reported one.
pub(in crate::infra::browser) fn reported_page_background(id: &str) -> Option<String> {
    page_backgrounds()
        .lock()
        .ok()
        .and_then(|values| values.get(id).cloned())
}

/// Re-applies a reported page color to the native view.
#[cfg(any(target_os = "macos", windows))]
pub(in crate::infra::browser) fn apply_page_background(webview: &Webview, hex: String) {
    set_under_page_background(webview, hex);
}

#[cfg(target_os = "macos")]
pub(in crate::infra::browser) fn replay_page_background(app: &AppHandle, id: &str) {
    let color = page_backgrounds()
        .lock()
        .ok()
        .and_then(|values| values.get(id).cloned());
    if let Some(color) = color {
        let _ = app.emit_to(
            super::super::browser_owner_label(app, id),
            "misty://browser-background",
            json!({ "id": id, "color": color }),
        );
    }
}

/// WebKit fills area it has not painted yet, such as the strip a live window
/// resize exposes before the page lays out again, with its under-page color.
/// Match the page so that strip blends in instead of flashing gray.
#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
pub(super) fn set_under_page_background(webview: &Webview, hex: String) {
    use objc::runtime::{Class, Object, BOOL, NO, YES};
    use objc::{msg_send, sel, sel_impl};
    let _ = webview.with_webview(move |native| unsafe {
        let view = native.inner() as *mut Object;
        let channel = |start: usize| {
            u8::from_str_radix(&hex[start..start + 2], 16).map_or(0.0, |value| f64::from(value) / 255.0)
        };
        let responds: BOOL = if view.is_null() {
            NO
        } else {
            msg_send![view, respondsToSelector: sel!(setUnderPageBackgroundColor:)]
        };
        if responds != YES {
            return;
        }
        let color: *mut Object = msg_send![Class::get("NSColor").unwrap(), colorWithSRGBRed: channel(1) green: channel(3) blue: channel(5) alpha: 1.0f64];
        let _: () = msg_send![view, setUnderPageBackgroundColor: color];
    });
}

/// WebView2 fills unpainted area with its default background color.
#[cfg(windows)]
pub(super) fn set_under_page_background(webview: &Webview, hex: String) {
    let channel = |start: usize| u8::from_str_radix(&hex[start..start + 2], 16).unwrap_or(0);
    let _ = webview.set_background_color(Some(tauri::window::Color(
        channel(1),
        channel(3),
        channel(5),
        255,
    )));
}
