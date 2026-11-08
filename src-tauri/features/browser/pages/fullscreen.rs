//! A page with an element in full screen (a video, a game) takes its whole window, not its pane.
//! The window itself goes full screen separately; this keeps the page's view at the window's size
//! while the layout still reports the pane's, then hands the pane back when full screen ends.
use crate::browser::*;
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

fn pages() -> &'static Mutex<HashSet<String>> {
    static PAGES: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    PAGES.get_or_init(|| Mutex::new(HashSet::new()))
}

/// The window's whole area, for a page that is in full screen.
pub(in crate::browser) fn fullscreen_bounds(
    webview: &Webview,
) -> Option<(LogicalPosition<f64>, LogicalSize<f64>)> {
    if !pages().lock().ok()?.contains(webview.label()) {
        return None;
    }
    let window = webview.window();
    let scale = window.scale_factor().ok()?;
    let size = window.inner_size().ok()?.to_logical::<f64>(scale);
    Some((LogicalPosition::new(0.0, 0.0), size))
}

/// The page named by `id` entered or left full screen.
pub(in crate::browser) fn set_page_fullscreen(app: &AppHandle, id: &str, active: bool) {
    let Ok(label) = webview_label(id) else {
        return;
    };
    let changed = pages().lock().is_ok_and(|mut pages| {
        if active {
            pages.insert(label.clone())
        } else {
            pages.remove(&label)
        }
    });
    if !changed {
        return;
    }
    if active {
        if let Some(webview) = app.get_webview(&label) {
            fill_window(&webview);
        }
        // The window finishes changing size a moment after the page says so.
        let (app, label) = (app.clone(), label);
        tauri::async_runtime::spawn(async move {
            for wait in [150u64, 450, 1000] {
                tokio::time::sleep(std::time::Duration::from_millis(wait)).await;
                let Some(webview) = app.get_webview(&label) else {
                    return;
                };
                if fullscreen_bounds(&webview).is_none() {
                    return;
                }
                fill_window(&webview);
            }
        });
    } else {
        // The pane's layout is asked for again, since it was ignored meanwhile.
        let _ = app.emit_to(
            browser_owner_label(app, id),
            "misty://browser-fullscreen",
            json!({ "id": id, "active": false }),
        );
    }
}

fn fill_window(webview: &Webview) {
    let Some((position, size)) = fullscreen_bounds(webview) else {
        return;
    };
    let _ = set_webview_bounds_if_changed(webview.app_handle(), webview, position, size);
    #[cfg(windows)]
    let _ = position_windows_webview(webview, false, false);
}
