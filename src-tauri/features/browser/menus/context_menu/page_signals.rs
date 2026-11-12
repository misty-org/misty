//! Page signals that share the context menu's token: trackpad swipes and reports that protected
//! video could not play.
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
        // A trackpad swipe past the page's edge goes back or forward.
        "gesture" => {
            let script = match values.get("action").map(|s| s.as_ref()) {
                Some("back") => Some("history.back()"),
                Some("forward") => Some("history.forward()"),
                _ => None,
            };
            if let (Some(script), Some(view)) = (script, view()) {
                let _ = view.eval(script);
            }
            true
        }
        _ => false,
    }
}
