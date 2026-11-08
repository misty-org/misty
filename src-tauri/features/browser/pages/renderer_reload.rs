//! A window whose renderer loads again (a full reload of the app) starts over with no
//! pages: the page views the old renderer made are closed, so none keep running behind it and
//! none are adopted by the new one.

use crate::browser::*;

/// Registered on the app builder, so it sees every webview's loads. Only a Misty window's own
/// renderer counts: its webview has the window's label. Page views (`misty-browser-*`) and
/// overlays are left alone.
pub fn close_pages_on_renderer_load(
    webview: &Webview,
    payload: &tauri::webview::PageLoadPayload<'_>,
) {
    if !matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
        return;
    }
    let window = webview.window();
    let label = webview.label();
    if !label.starts_with("space-") || window.label() != label {
        return;
    }
    let app = webview.app_handle().clone();
    let ids = app
        .webviews()
        .into_iter()
        .filter(|(_, page)| page.window().label() == label)
        .filter_map(|(page_label, _)| page_label.strip_prefix("misty-browser-").map(str::to_owned))
        .collect::<Vec<_>>();
    if ids.is_empty() {
        return;
    }
    // Off the UI thread, like `browser_webview_close`; the new renderer is still loading its
    // scripts, so this finishes before it asks for any page.
    tauri::async_runtime::spawn(async move {
        for id in ids {
            let _ = close_browser_webview(
                app.clone(),
                app.state::<BrowserSessionState>(),
                BrowserWebviewIdRequest { id },
            );
        }
    });
}
