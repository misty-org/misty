//! Every Misty window belongs to one profile for its whole life, as in Chrome: its tabs, the
//! store its pages open in, its extensions and its saved data are that profile's. A profile can
//! have several windows. This module owns the window labels and each window's profile; it is
//! the only place that names a window, and no other native code may spell a label.
//!
//! - `window-<n>`: an app window, with the full workspace.
//! - `incognito-<n>`: an incognito window. All of a profile's incognito windows share one
//!   temporary session, erased when the last closes.
//!
//! Agents have no windows of their own; their tabs live in the person's window
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
mod diagnostics;
mod lifecycle;
mod links;
mod registry;
mod routing;
mod saved;
pub use commands::*;
pub use diagnostics::*;
pub use lifecycle::*;
pub use links::*;
pub use registry::*;
pub use routing::*;
#[cfg(test)]
mod tests;

/// The first profile's id, the same on every computer, so two computers joining one vault
/// start with the same profile and there is nothing to reconcile.
pub const PERSONAL: &str = "personal";
const WINDOW_PREFIX: &str = "window-";
const INCOGNITO_PREFIX: &str = "incognito-";
/// Emitted to a window's app when its profile's name or color changes.
pub const PROFILE_CHANGED_EVENT: &str = "misty://profile-window";
/// Emitted to every window when the list of profiles changes.
pub const PROFILES_CHANGED_EVENT: &str = "misty://profiles-changed";
/// Tells a profile's windows that a closed window left tabs for them to take.
pub const ORPHANS_EVENT: &str = "misty://profile-window-orphans";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProfileWindow {
    /// The profile this window belongs to.
    pub profile: String,
    /// Whether this is an incognito window.
    pub incognito: bool,
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

/// A new label for an app window or an incognito window.
pub(super) fn new_label(incognito: bool) -> String {
    let number = NEXT_WINDOW.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let prefix = if incognito {
        INCOGNITO_PREFIX
    } else {
        WINDOW_PREFIX
    };
    format!("{prefix}{number}")
}

/// Records a window when it opens. Only window creation and an account change call this.
pub(super) fn set_current(label: &str, state: WindowState) {
    if let Ok(mut current) = CURRENT.lock() {
        current.insert(label.to_owned(), state);
    }
}

/// Forgets a closed window.
pub(super) fn forget_current(label: &str) -> Option<WindowState> {
    CURRENT.lock().ok()?.remove(label)
}

/// Every open window with its state, in the order the windows opened.
pub(super) fn current_windows() -> Vec<(String, WindowState)> {
    let mut windows: Vec<_> = CURRENT
        .lock()
        .map(|current| {
            current
                .iter()
                .map(|(l, s)| (l.clone(), s.clone()))
                .collect()
        })
        .unwrap_or_default();
    windows.sort_by_key(|(label, _)| {
        label_number(label, WINDOW_PREFIX)
            .or_else(|| label_number(label, INCOGNITO_PREFIX))
            .unwrap_or(u32::MAX)
    });
    windows
}

pub(crate) fn window_state(label: &str) -> Option<WindowState> {
    CURRENT.lock().ok()?.get(label).cloned()
}

/// The app window or incognito window a label names, with its profile; `None` for every
/// other label.
pub fn parse(label: &str) -> Option<ProfileWindow> {
    let incognito = if label_number(label, WINDOW_PREFIX).is_some() {
        false
    } else if label_number(label, INCOGNITO_PREFIX).is_some() {
        true
    } else {
        return None;
    };
    let profile = window_state(label)?.profile;
    Some(ProfileWindow { profile, incognito })
}

/// The profile a window belongs to. Unknown labels have none.
pub fn profile_for_window(label: &str) -> Option<String> {
    parse(label).map(|window| window.profile)
}

/// A window the person works in: not incognito. Menus, quitting, session recovery, voice
/// and the machine's background work belong to these alone.
pub fn is_person_window(label: &str) -> bool {
    label_number(label, WINDOW_PREFIX).is_some()
}

pub fn is_incognito_window(label: &str) -> bool {
    label_number(label, INCOGNITO_PREFIX).is_some()
}

/// Any Misty app window, incognito included: the bundled app runs in it.
pub fn is_app_window(label: &str) -> bool {
    is_person_window(label) || is_incognito_window(label)
}

/// A store identity for a profile of this account, the same every launch.
pub(super) fn derived_store(scope: &str, profile: &str) -> Option<String> {
    let bytes = serde_json::to_vec(&("misty.profile-store.v1", scope, profile)).ok()?;
    Some(hex::encode(Sha256::digest(bytes)))
}

/// The 128-bit id the engine knows an incognito session by.
pub fn incognito_store_id(session: &str) -> [u8; 16] {
    let digest = Sha256::digest(format!("misty.incognito-session.v1:{session}").as_bytes());
    let mut id = [0; 16];
    id.copy_from_slice(&digest[..16]);
    id
}

/// Windows a profile's window opened for an agent belong to that profile.
static ADOPTED: Mutex<BTreeMap<String, String>> = Mutex::new(BTreeMap::new());

/// Records that `child` (an agent's own window) works for `parent`'s profile.
pub fn adopt(child: &str, parent: &str) {
    if let (Some(key), Ok(mut adopted)) = (profile_for_window(parent), ADOPTED.lock()) {
        adopted.insert(child.to_owned(), key);
    }
}

/// The profile a page-opening window belongs to: an app window by its label, or an agent
/// window by the window that opened it.
pub fn profile_for_owner(label: &str) -> Option<String> {
    profile_for_window(label).or_else(|| ADOPTED.lock().ok()?.get(label).cloned())
}
