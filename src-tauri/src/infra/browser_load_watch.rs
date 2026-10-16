//! Watches a page's loads: address changes without a load, and loads that never report a finish.
use super::*;

/// The page's address changed without a load (History API, hash, single-page navigation).
#[cfg(target_os = "macos")]
pub(super) fn emit_navigated(app: &AppHandle, id: &str, url: String) {
    let _ = app.emit_to(
        browser_owner_label(app, id),
        "misty://browser-page",
        BrowserPageEvent { id: id.to_owned(), url, phase: "navigated" },
    );
}

/// Each load start and finish moves a page's counter, so a watchdog can tell its load is still
/// the current one.
static LOAD_GENERATIONS: OnceLock<Mutex<HashMap<String, u64>>> = OnceLock::new();
pub(super) fn next_load_generation(id: &str) -> u64 {
    let mut generations = LOAD_GENERATIONS.get_or_init(Mutex::default).lock().unwrap_or_else(|e| e.into_inner());
    let generation = generations.entry(id.to_owned()).or_insert(0);
    *generation = generation.wrapping_add(1);
    *generation
}
fn current_load_generation(id: &str) -> u64 {
    LOAD_GENERATIONS
        .get_or_init(Mutex::default)
        .lock()
        .ok()
        .and_then(|generations| generations.get(id).copied())
        .unwrap_or(0)
}

/// A navigation that fails or is cancelled before its document commits never reports a finish, and
/// the tab would show its loading spinner forever. A load that is still the current one after this
/// long is treated as over.
pub(super) fn watch_load(app: &AppHandle, id: &str, generation: u64) {
    let app = app.clone();
    let id = id.to_owned();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(45)).await;
        if current_load_generation(&id) == generation {
            let _ = app.emit_to(
                browser_owner_label(&app, &id),
                "misty://browser-stopped",
                BrowserFocusEvent { id: id.clone() },
            );
        }
    });
}

/// A page changed its address without a load. It names the new one, which is accepted only within
/// the view's own origin (the History API cannot go further); the view's own URL is the fallback.
pub(super) fn emit_location(app: &AppHandle, owner: &str, id: &str, webview: &str, reported: Option<&str>) {
    let view_url = app.get_webview(webview).and_then(|view| view.url().ok());
    let accepted = reported
        .and_then(|encoded| percent_encoding::percent_decode_str(encoded).decode_utf8().ok())
        .and_then(|decoded| Url::parse(&decoded).ok())
        .filter(|new| {
            matches!(new.scheme(), "http" | "https")
                && view_url.as_ref().is_some_and(|view| view.origin() == new.origin())
        });
    if let Some(url) = accepted.or(view_url) {
        let event = BrowserPageEvent { id: id.to_owned(), url: url.to_string(), phase: "navigated" };
        let _ = app.emit_to(owner, "misty://browser-page", event);
    }
}
