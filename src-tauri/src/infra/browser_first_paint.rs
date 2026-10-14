//! Views created but not yet painted stay parked offscreen, so Misty's own
//! canvas (or the previous page) shows instead of the engine's blank surface,
//! like a browser that holds the previous frame until the new page paints.
use serde_json::json;
use std::{
    collections::HashSet,
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Emitter, LogicalPosition, Webview};

/// Where a held or inactive page waits, far outside the app's window.
pub(super) const PARKED_POSITION: LogicalPosition<f64> = LogicalPosition::new(-32_000.0, -32_000.0);

/// A page that never paints must still appear.
const HOLD_TIMEOUT_MS: u64 = 2000;

fn held_views() -> &'static Mutex<HashSet<String>> {
    static HELD: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    HELD.get_or_init(Default::default)
}

pub(super) fn is_held_id(id: &str) -> bool {
    held_views().lock().is_ok_and(|held| held.contains(id))
}

pub(super) fn is_held_view(webview: &Webview) -> bool {
    webview
        .label()
        .strip_prefix("misty-browser-")
        .is_some_and(is_held_id)
}

pub(super) fn hold_until_first_paint(app: &AppHandle, id: &str) {
    if let Ok(mut held) = held_views().lock() {
        held.insert(id.to_owned());
    }
    let app = app.clone();
    let id = id.to_owned();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(HOLD_TIMEOUT_MS));
        release_first_paint(&app, &id);
    });
}

/// Lets a held view appear. Safe to call for any view, any number of times.
pub(super) fn release_first_paint(app: &AppHandle, id: &str) {
    let was_held = held_views()
        .lock()
        .map(|mut held| held.remove(id))
        .unwrap_or(false);
    if was_held {
        let _ = app.emit_to(
            super::browser_owner_label(app, id),
            "misty://browser-reveal",
            json!({ "id": id }),
        );
    }
}
