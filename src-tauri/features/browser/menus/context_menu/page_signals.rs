use super::*;
use std::borrow::Cow;

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
