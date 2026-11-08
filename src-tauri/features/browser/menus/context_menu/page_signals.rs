//! Page signals that share the context menu's token: Option-click Peek, swipe and mouse
//! gestures and reports that protected video could not play.
use super::*;
use std::borrow::Cow;

/// Handles a signal path; returns whether it was one.
pub(super) fn forward(
    app: &AppHandle,
    id: &str,
    url: &Url,
    values: &HashMap<Cow<'_, str>, Cow<'_, str>>,
) -> bool {
    let view = || {
        webview_label(id)
            .ok()
            .and_then(|label| app.get_webview(&label))
    };
    match url.path() {
        // The page could not play protected video: offer the system browser.
        "compat" => {
            if values.get("kind").map(|s| s.as_ref()) != Some("protected_media") {
                return true;
            }
            if let Some(page) = view().and_then(|view| view.url().ok()) {
                if matches!(page.scheme(), "http" | "https") {
                    let _ = app.emit(
                        "misty://browser-compatibility",
                        json!({"id": id, "kind": "protected_media", "url": page.as_str()}),
                    );
                }
            }
            true
        }
        // A gesture runs the same page commands as the context menu. A trackpad swipe is
        // always on; a right-drag only while Mouse gestures is.
        "gesture" => {
            let action = values.get("action").map(|s| s.as_ref()).unwrap_or("");
            let allowed = match values.get("source").map(|s| s.as_ref()) {
                Some("swipe") => matches!(action, "back" | "forward"),
                _ => {
                    matches!(action, "back" | "forward" | "reload")
                        && crate::browser::site_settings::style::gestures_enabled()
                }
            };
            if allowed {
                if let Some(view) = view() {
                    let _ = app.emit_to(
                        view.window().label(),
                        "misty://browser-menu-command",
                        json!({"sourceId": id, "command": action}),
                    );
                }
            }
            true
        }
        // Option-click on a link: the browser that owns the page opens it in Peek.
        "peek" => {
            let link = values.get("url").map(|s| s.as_ref()).unwrap_or("");
            if link.len() <= 8192 && external_url(link).is_ok() {
                if let Some(view) = view() {
                    let _ = app.emit_to(
                        view.window().label(),
                        "misty://browser-menu-command",
                        json!({"sourceId": id, "command": "peek-link", "url": link}),
                    );
                }
            }
            true
        }
        _ => false,
    }
}
