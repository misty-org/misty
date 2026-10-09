//! Remembered page zoom per site, keyed by host like Chrome.
//!
//! The account setting `browser.siteZoom` is the source of truth; the renderer
//! pushes it here so every page load applies its site's level natively.
//! Private tabs never read or write these levels.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

fn levels() -> &'static Mutex<HashMap<String, f64>> {
    static LEVELS: OnceLock<Mutex<HashMap<String, f64>>> = OnceLock::new();
    LEVELS.get_or_init(Mutex::default)
}

fn valid_factor(factor: f64) -> bool {
    factor.is_finite() && (0.25..=5.0).contains(&factor)
}

/// The host a level is stored under; only web pages have one.
pub(crate) fn site_key(url: &url::Url) -> Option<String> {
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    url.host_str()
        .filter(|host| !host.is_empty())
        .map(str::to_ascii_lowercase)
}

/// The saved level for this page's site, if one differs from 100%.
pub(crate) fn level_for(url: &url::Url) -> Option<f64> {
    let key = site_key(url)?;
    levels().lock().ok()?.get(&key).copied()
}

/// The zoom a page loads with: its site's saved level, or for a private tab
/// (`session` is `(private, tab_factor)`) the level set on that tab alone.
pub(crate) fn page_factor(webview: &tauri::Webview, session: Option<(bool, Option<f64>)>) -> f64 {
    let (private, tab_factor) = session.unwrap_or((false, None));
    if private {
        tab_factor
    } else {
        webview.url().ok().and_then(|url| level_for(&url))
    }
    .unwrap_or(1.0)
}

/// Saves a level the person just chose for the page's site; private tabs keep none.
pub(crate) fn remember_unless_private(webview: &tauri::Webview, private: bool, factor: f64) {
    if !private {
        if let Ok(url) = webview.url() {
            remember(&url, factor);
        }
    }
}

/// Records a level immediately, before the renderer saves the setting, so a page
/// load that finishes in between does not reset the zoom.
pub(crate) fn remember(url: &url::Url, factor: f64) {
    let Some(key) = site_key(url) else { return };
    if let Ok(mut levels) = levels().lock() {
        if (factor - 1.0).abs() < f64::EPSILON {
            levels.remove(&key);
        } else if valid_factor(factor) {
            levels.insert(key, factor);
        }
    }
}

/// Replaces every level from the account setting and re-zooms open pages to match.
#[tauri::command]
pub fn browser_set_site_zoom_levels(
    app: tauri::AppHandle,
    levels_by_site: HashMap<String, f64>,
) -> Result<(), String> {
    let next: HashMap<String, f64> = levels_by_site
        .into_iter()
        .filter(|(host, factor)| {
            !host.is_empty() && valid_factor(*factor) && (factor - 1.0).abs() >= f64::EPSILON
        })
        .map(|(host, factor)| (host.to_ascii_lowercase(), factor))
        .collect();
    *levels()
        .lock()
        .map_err(|_| "Zoom levels are unavailable.")? = next;
    // Re-zoom every open browser page to its site's new level.
    for (label, webview) in tauri::Manager::webviews(&app) {
        if let Some(id) = label.strip_prefix("misty-browser-") {
            super::browser::apply_page_zoom_policy(&webview, &app, id);
        }
    }
    Ok(())
}
