//! Each profile's cookies and localStorage, kept in its local records so the vault link can carry
//! them between a person's computers. It runs with or without a vault, silently, and never closes
//! or reloads a page. People use one computer at a time, so there are no CRDTs: per cookie and per
//! whole origin, the newest edit wins. Incognito is never read or written, and no value, key or
//! site ever reaches a log, an error or an event.
//!
//! Two background tasks do the work, one for each kind of data. Tauri tells them what's happening
//! through a plugin, which needs no line of code anywhere else: pages finishing, windows opening
//! and closing, focus, and quitting.

#[cfg(any(target_os = "macos", windows))]
mod backfill;
#[cfg(any(target_os = "macos", windows))]
mod baseline;
#[cfg(any(target_os = "macos", windows))]
mod baseline_observe;
#[cfg(any(target_os = "macos", windows))]
mod cookie_apply;
#[cfg(any(target_os = "macos", windows))]
mod cookie_records;
#[cfg(any(target_os = "macos", windows))]
mod cookie_sync;
#[cfg(any(target_os = "macos", windows))]
mod engine;
#[cfg(any(target_os = "macos", windows))]
mod entries;
#[cfg(any(target_os = "macos", windows))]
mod hooks;
#[cfg(any(target_os = "macos", windows))]
mod last_input;
#[cfg(any(target_os = "macos", windows))]
mod parts;
#[cfg(any(target_os = "macos", windows))]
mod scope;
#[cfg(any(target_os = "macos", windows))]
pub(crate) mod skips;
#[cfg(any(target_os = "macos", windows))]
mod storage_capture;
#[cfg(any(target_os = "macos", windows))]
mod storage_restore;
#[cfg(any(target_os = "macos", windows))]
mod storage_sync;
#[cfg(all(test, any(target_os = "macos", windows)))]
mod tests;

#[cfg(any(target_os = "macos", windows))]
pub(crate) use hooks::start;
#[cfg(any(target_os = "macos", windows))]
use hooks::{any_focused, backfill_due, idle_now, now_ms, open_profiles, recently_loaded, Signal};

/// The sites in a profile that couldn't sync, for Settings to list.
#[cfg(any(target_os = "macos", windows))]
pub(crate) fn coverage(profile: &str) -> Vec<skips::SiteSkip> {
    skips::coverage(profile)
}

/// Lets what a page needs land first: a profile's first read of its cookies, and any held data for
/// the page's site. Takes about a second at most, then the page loads regardless.
#[cfg(any(target_os = "macos", windows))]
pub(crate) async fn prepare_page(profile: &str, url: &str) {
    hooks::prepare_page(profile, url, None).await;
}

/// The same for a page already open that's about to load again. It doesn't count as a tab of the
/// site, so being the only one is enough for held data to land first.
#[cfg(any(target_os = "macos", windows))]
pub(crate) async fn prepare_own_page(webview: &tauri::Webview, url: &url::Url) {
    if let Some((profile, Some(_))) = hooks::page_of(webview, url) {
        hooks::prepare_page(&profile, url.as_str(), Some(webview.label().to_owned())).await;
    }
}

/// This platform has no way to reach a browser store yet.
#[cfg(not(any(target_os = "macos", windows)))]
pub(crate) fn start(_app: &tauri::AppHandle) {}
