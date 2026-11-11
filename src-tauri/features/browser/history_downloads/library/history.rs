//! The browsing history recorded while a person had tabs of their own, kept per browser profile
//! in the browser library. Nothing adds to it now; it can still be cleared.

use super::library;
use rusqlite::params;
use serde::Deserialize;
use tauri::AppHandle;

mod removal;
pub use removal::*;

pub(crate) fn store_key(store: Option<String>) -> String {
    store
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .unwrap_or_else(|| "default".to_owned())
}

/// History belongs to the profile of the window asking.
fn window_key(webview: &tauri::Webview) -> Result<String, String> {
    let profile = crate::browser::app_windows::profile_for_window(webview.window().label())
        .ok_or("This window has no profile.")?;
    crate::browser::app_windows::store_for_profile(&profile).map(store_key)
}

// Commands run on the main thread unless they are async, and the main thread also delivers
// keystrokes, so the SQLite work is done on a blocking worker instead.
async fn off_main_thread<R: Send + 'static>(
    work: impl FnOnce() -> Result<R, String> + Send + 'static,
) -> Result<R, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn browser_history_clear(
    app: AppHandle,
    webview: tauri::Webview,
    request: BrowserHistoryClearRequest,
) -> Result<(), String> {
    let profile = window_key(&webview)?;
    off_main_thread(move || browser_history_clear_blocking(app, profile, request)).await
}
