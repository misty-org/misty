//! Every Misty window belongs to one Space, as every Chrome window belongs to one
//! profile. This module owns the window labels and is the only place that names
//! them; no other native code may spell a window label.
//!
//! - `space-<key>`: the Space's window. Its key is `personal` for the personal Space
//!   and the Space id's 32 hex digits for every other Space.
//! - `incognito-<key>-<n>`: an incognito window of that Space. All of a Space's
//!   incognito windows share one temporary session, erased when the last one closes.
//!
//! Which Spaces exist, their names and colors come from the Space windows (the
//! renderer lists them once it has the account's Spaces) and are kept on this device
//! with the Spaces that were open at quit. The Space itself is always read from the
//! window's label, never from anything a renderer sends.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, EventTarget, Manager, Runtime, Window};

mod commands;
mod lifecycle;
mod registry;
pub use commands::*;
pub use lifecycle::*;
pub use registry::*;
#[cfg(test)]
mod tests;

/// The personal Space's key. It has a vault (and store) before the account's Spaces
/// are known, so it never waits for a Space id.
pub const PERSONAL: &str = "personal";
const SPACE_PREFIX: &str = "space-";
const INCOGNITO_PREFIX: &str = "incognito-";
/// Emitted to a Space's windows when its name or color changes.
pub const SPACE_CHANGED_EVENT: &str = "misty://space-window";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpaceWindow {
    pub space: String,
    /// The incognito window's number within its Space; `None` for the Space window.
    pub incognito: Option<u32>,
}

/// A Space's key from its id: `personal`, or the id's 32 lowercase hex digits.
pub fn space_key(space_id: &str, personal: bool) -> Result<String, String> {
    if personal {
        return Ok(PERSONAL.into());
    }
    uuid::Uuid::parse_str(space_id)
        .map(|id| id.simple().to_string())
        .map_err(|_| "Unknown Space.".into())
}

pub(crate) fn valid_key(key: &str) -> bool {
    key == PERSONAL
        || (key.len() == 32
            && key
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)))
}

/// The Space id a key stands for; `None` for the personal Space, whose id the
/// registry learns from the renderer.
pub fn space_id_for_key(key: &str) -> Option<String> {
    (key != PERSONAL)
        .then(|| uuid::Uuid::parse_str(key).ok())
        .flatten()
        .map(|id| id.hyphenated().to_string())
}

pub fn space_label(key: &str) -> String {
    format!("{SPACE_PREFIX}{key}")
}

pub fn incognito_label(key: &str, number: u32) -> String {
    format!("{INCOGNITO_PREFIX}{key}-{number}")
}

/// The Space window or incognito window a label names; `None` for every other label.
pub fn parse(label: &str) -> Option<SpaceWindow> {
    if let Some(key) = label.strip_prefix(SPACE_PREFIX) {
        return valid_key(key).then(|| SpaceWindow {
            space: key.into(),
            incognito: None,
        });
    }
    let rest = label.strip_prefix(INCOGNITO_PREFIX)?;
    let (key, number) = rest.rsplit_once('-')?;
    let number = number
        .parse::<u32>()
        .ok()
        .filter(|n| *n > 0 && !number.starts_with('0'))?;
    valid_key(key).then(|| SpaceWindow {
        space: key.into(),
        incognito: Some(number),
    })
}

/// The Space a window belongs to. Unknown labels belong to none.
pub fn space_for_window(label: &str) -> Option<String> {
    parse(label).map(|window| window.space)
}

/// A Space's own window: the full workspace, with sync, recovery, history, memory and
/// agents. Trust checks for account data accept these and nothing else.
pub fn is_space_window(label: &str) -> bool {
    parse(label).is_some_and(|window| window.incognito.is_none())
}

pub fn is_incognito_window(label: &str) -> bool {
    parse(label).is_some_and(|window| window.incognito.is_some())
}

/// Any Misty app window, incognito included: the bundled app runs in it.
pub fn is_app_window(label: &str) -> bool {
    parse(label).is_some()
}

/// Every open app window, incognito included.
pub fn app_windows<R: Runtime>(app: &AppHandle<R>) -> Vec<Window<R>> {
    // `get_webview_window` cannot see a window that holds page views beside its own.
    app.windows()
        .into_iter()
        .filter(|(label, _)| is_app_window(label))
        .map(|(_, window)| window)
        .collect()
}

/// Every open Space window (no incognito windows).
pub fn space_windows<R: Runtime>(app: &AppHandle<R>) -> Vec<Window<R>> {
    app_windows(app)
        .into_iter()
        .filter(|window| is_space_window(window.label()))
        .collect()
}

/// A Space's open windows, its incognito windows included.
pub fn windows_for_space<R: Runtime>(app: &AppHandle<R>, key: &str) -> Vec<Window<R>> {
    app_windows(app)
        .into_iter()
        .filter(|window| space_for_window(window.label()).as_deref() == Some(key))
        .collect()
}

/// The app window that answers for the app as a whole: the last focused Space window,
/// else the personal Space's, else any. Incognito windows never stand in for the app.
pub fn primary<R: Runtime>(app: &AppHandle<R>) -> Option<Window<R>> {
    let last = registry::last_focused_space();
    last.and_then(|label| app.get_window(&label))
        .filter(|window| is_space_window(window.label()))
        .or_else(|| app.get_window(&space_label(PERSONAL)))
        .or_else(|| space_windows(app).into_iter().next())
}

/// The app window the person used last, incognito included: menu choices act there.
pub fn focused<R: Runtime>(app: &AppHandle<R>) -> Option<Window<R>> {
    let last = registry::last_focused_any();
    last.and_then(|label| app.get_window(&label))
        .or_else(|| primary(app))
}

/// Sends a menu choice to the window the person used last, incognito included.
pub fn emit_to_focused<R: Runtime, S: Serialize + Clone>(
    app: &AppHandle<R>,
    event: &str,
    payload: S,
) {
    if let Some(window) = focused(app) {
        let _ = app.emit_to(window.label(), event, payload);
    }
}

pub fn primary_label<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    primary(app).map(|window| window.label().to_owned())
}

/// The app's own webview inside an app window (it shares the window's label).
pub fn app_webview<R: Runtime>(app: &AppHandle<R>, label: &str) -> Option<tauri::Webview<R>> {
    is_app_window(label).then(|| app.get_webview(label)).flatten()
}

/// The primary window's app webview.
pub fn primary_webview<R: Runtime>(app: &AppHandle<R>) -> Option<tauri::Webview<R>> {
    primary_label(app).and_then(|label| app.get_webview(&label))
}

pub(super) fn targets(target: &EventTarget, accept: impl Fn(&str) -> bool) -> bool {
    match target {
        EventTarget::Window { label }
        | EventTarget::Webview { label }
        | EventTarget::WebviewWindow { label }
        | EventTarget::AnyLabel { label } => accept(label),
        _ => false,
    }
}

/// Sends an account-wide event (sync, extensions, devices) to every Space window.
/// Incognito windows never hear about account data.
pub fn emit<R: Runtime, S: Serialize + Clone>(app: &AppHandle<R>, event: &str, payload: S) {
    let _ = app.emit_filter(event, payload, |target| targets(target, is_space_window));
}

/// Sends an event to one Space's windows, incognito windows included.
pub fn emit_to_space<R: Runtime, S: Serialize + Clone>(
    app: &AppHandle<R>,
    key: &str,
    event: &str,
    payload: S,
) {
    let _ = app.emit_filter(event, payload, |target| {
        targets(target, |label| space_for_window(label).as_deref() == Some(key))
    });
}

/// Sends an event the person acts on (a menu choice, dictation, the cursor agent) to
/// the window they use: the last focused Space window.
pub fn emit_to_primary<R: Runtime, S: Serialize + Clone>(
    app: &AppHandle<R>,
    event: &str,
    payload: S,
) {
    if let Some(label) = primary_label(app) {
        let _ = app.emit_to(label.as_str(), event, payload);
    }
}

/// A Space window's website data identity, derived natively from its Space. The
/// personal Space has none here: its store comes from the account's vault scope
/// (`browser_sync::browser_profile_lease`). Every other Space gets its own named store.
pub fn space_store_identity(key: &str) -> Option<String> {
    let id = space_id_for_key(key)?;
    let bytes = serde_json::to_vec(&("misty.space-browser-profile.v1", id)).ok()?;
    Some(hex::encode(Sha256::digest(bytes)))
}

/// Whether an identity is a Space's own store (not the personal one).
pub fn is_space_store(identity: &str) -> bool {
    listed_spaces()
        .iter()
        .any(|space| space_store_identity(&space.key).as_deref() == Some(identity))
}

/// The 128-bit id the engine knows an incognito session by.
pub fn incognito_store_id(session: &str) -> [u8; 16] {
    let digest = Sha256::digest(format!("misty.incognito-session.v1:{session}").as_bytes());
    let mut id = [0; 16];
    id.copy_from_slice(&digest[..16]);
    id
}

/// Windows a Space window opened for an agent belong to that Space.
static ADOPTED: Mutex<BTreeMap<String, String>> = Mutex::new(BTreeMap::new());

/// Records that `child` (an agent's own window) works for `parent`'s Space.
pub fn adopt(child: &str, parent: &str) {
    if let (Some(key), Ok(mut adopted)) = (space_for_window(parent), ADOPTED.lock()) {
        adopted.insert(child.to_owned(), key);
    }
}

/// The Space a page-opening window belongs to: a Space or incognito window by its
/// label, or an agent window by the Space window that opened it.
pub fn space_for_owner(label: &str) -> Option<String> {
    space_for_window(label).or_else(|| ADOPTED.lock().ok()?.get(label).cloned())
}
