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

pub const PERSONAL: &str = "personal";
const WINDOW_PREFIX: &str = "window-";
pub const PROFILES_CHANGED_EVENT: &str = "misty://profiles-changed";
pub const ORPHANS_EVENT: &str = "misty://profile-window-orphans";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProfileWindow {
    pub profile: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct WindowState {
    pub profile: String,
    pub window_id: String,
    pub space: Option<String>,
}

static CURRENT: Mutex<BTreeMap<String, WindowState>> = Mutex::new(BTreeMap::new());
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

pub(crate) fn new_label() -> String {
    let number = NEXT_WINDOW.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("{WINDOW_PREFIX}{number}")
}

pub(crate) fn set_current(label: &str, state: WindowState) {
    if let Ok(mut current) = CURRENT.lock() {
        current.insert(label.to_owned(), state);
    }
}

pub(crate) fn forget_current(label: &str) -> Option<WindowState> {
    CURRENT.lock().ok()?.remove(label)
}

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

pub fn parse(label: &str) -> Option<ProfileWindow> {
    label_number(label, WINDOW_PREFIX)?;
    let profile = window_state(label)?.profile;
    Some(ProfileWindow { profile })
}

pub fn profile_for_window(label: &str) -> Option<String> {
    parse(label).map(|window| window.profile)
}

pub fn is_person_window(label: &str) -> bool {
    label_number(label, WINDOW_PREFIX).is_some()
}

pub fn is_app_window(label: &str) -> bool {
    is_person_window(label)
}

pub(crate) fn derived_store(scope: &str, profile: &str) -> Option<String> {
    let bytes = serde_json::to_vec(&("misty.profile-store.v1", scope, profile)).ok()?;
    Some(hex::encode(Sha256::digest(bytes)))
}

pub fn profile_for_owner(label: &str) -> Option<String> {
    profile_for_window(label)
}
