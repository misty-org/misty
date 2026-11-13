//! Every Misty window belongs to one profile for its whole life, as in Chrome: its tabs, the
//! store its pages open in and its saved data are that profile's. A profile can
//! have several windows. This module owns the window labels and each window's profile; it is
//! the only place that names a window, and no other native code may spell a label.
//!
//! - `window-<n>`: an app window, with the full workspace.
//!
//! Agents have no windows of their own; their tabs live in the person's window.
//!
//! A window's profile is kept here, natively, and is never taken from anything a renderer
//! sends. Which Space a window shows is the renderer's: Spaces are shared content and own no
//! tabs, so this module only remembers the choice for the next launch.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, EventTarget, Manager, Runtime, Window};

mod commands;
mod lifecycle;
mod registry;
mod routing;
mod saved;
pub(crate) mod window_geometry;
pub use commands::*;
pub use lifecycle::*;
pub use registry::*;
pub use routing::*;
#[cfg(test)]
mod tests;
#[cfg(windows)]
pub mod windows;
pub mod workspace_recovery;

/// The first profile's id, the same on every computer and for every account.
pub const PERSONAL: &str = "personal";
const WINDOW_PREFIX: &str = "window-";
/// Emitted to every window when the list of profiles changes.
pub const PROFILES_CHANGED_EVENT: &str = "misty://profiles-changed";
/// Tells a profile's windows that a closed window left tabs for them to take.
pub const ORPHANS_EVENT: &str = "misty://profile-window-orphans";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProfileWindow {
    /// The profile this window belongs to.
    pub profile: String,
}

/// What this process knows about an open window.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct WindowState {
    pub profile: String,
    /// Names the window's saved tabs. Stable across launches, unlike its label.
    pub window_id: String,
    /// The Space it showed last, kept for the next launch.
    pub space: Option<String>,
}

/// Each open window, by label. Its own lock, never held while the registry's is taken.
static CURRENT: Mutex<BTreeMap<String, WindowState>> = Mutex::new(BTreeMap::new());
/// The number the next window label takes.
static NEXT_WINDOW: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);

pub(crate) fn valid_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 100
        && key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn label_number(label: &str, prefix: &str) -> Option<u32> {
    let number = label.strip_prefix(prefix)?;
    if number.starts_with('0') {
        return None;
    }
    number.parse::<u32>().ok().filter(|n| *n > 0)
}

/// A new label for an app window.
pub(crate) fn new_label() -> String {
    let number = NEXT_WINDOW.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("{WINDOW_PREFIX}{number}")
}

/// Records a window when it opens. Only window creation and an account change call this.
pub(crate) fn set_current(label: &str, state: WindowState) {
    if let Ok(mut current) = CURRENT.lock() {
        current.insert(label.to_owned(), state);
    }
}

/// Forgets a closed window.
pub(crate) fn forget_current(label: &str) -> Option<WindowState> {
    CURRENT.lock().ok()?.remove(label)
}

/// Every open window with its state, in the order the windows opened.
pub(crate) fn current_windows() -> Vec<(String, WindowState)> {
    let mut windows: Vec<_> = CURRENT
        .lock()
        .map(|current| {
            current
                .iter()
                .map(|(l, s)| (l.clone(), s.clone()))
                .collect()
        })
        .unwrap_or_default();
    windows.sort_by_key(|(label, _)| label_number(label, WINDOW_PREFIX).unwrap_or(u32::MAX));
    windows
}

pub(crate) fn window_state(label: &str) -> Option<WindowState> {
    CURRENT.lock().ok()?.get(label).cloned()
}

/// The app window a label names, with its profile; `None` for every other label.
pub fn parse(label: &str) -> Option<ProfileWindow> {
    label_number(label, WINDOW_PREFIX)?;
    let profile = window_state(label)?.profile;
    Some(ProfileWindow { profile })
}

/// The profile a window belongs to. Unknown labels have none.
pub fn profile_for_window(label: &str) -> Option<String> {
    parse(label).map(|window| window.profile)
}

/// A window the person works in. Menus, quitting, session recovery, voice and the machine's
/// background work belong to these alone.
pub fn is_person_window(label: &str) -> bool {
    label_number(label, WINDOW_PREFIX).is_some()
}

/// A window the bundled app runs in. Every one is a person's window.
pub fn is_app_window(label: &str) -> bool {
    is_person_window(label)
}

/// A store identity for a profile of this account, the same every launch.
pub(crate) fn derived_store(scope: &str, profile: &str) -> Option<String> {
    let bytes = serde_json::to_vec(&("misty.profile-store.v1", scope, profile)).ok()?;
    Some(hex::encode(Sha256::digest(bytes)))
}

/// The profile a page-opening window belongs to.
pub fn profile_for_owner(label: &str) -> Option<String> {
    profile_for_window(label)
}
