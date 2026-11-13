//! The favicon probe a new browser page runs.
use crate::browser::*;

pub(in crate::browser) fn request_browser_favicon(webview: &Webview, app: &AppHandle, id: &str) {
    let favicon_app = app.clone();
    let favicon_id = id.to_owned();
    let _ = webview.eval_with_callback(BROWSER_FAVICON_SCRIPT, move |value| {
        let Ok(Some(candidate)) = serde_json::from_str::<Option<String>>(&value) else {
            return;
        };
        let Some(url) = validated_favicon_url(&candidate) else {
            return;
        };
        let _ = favicon_app.emit_to(
            browser_owner_label(&favicon_app, &favicon_id).as_str(),
            "misty://browser-favicon",
            BrowserFaviconEvent {
                id: favicon_id.clone(),
                url,
            },
        );
    });
}

pub(in crate::browser) fn validated_favicon_url(value: &str) -> Option<String> {
    if value.len() > 2_048 {
        return None;
    }
    let url = Url::parse(value).ok()?;
    matches!(url.scheme(), "http" | "https").then(|| url.to_string())
}
