//! Every Misty window shows one Space at a time and can switch it in place, as Arc
//! does. This module owns the window labels and each window's current Space; it is the
//! only place that names a window, and no other native code may spell a label.
//!
//! - `window-<n>`: an app window. It shows its current Space's tabs, opens pages in that
//!   Space's store and works with its extensions, sync, memory and agents.
//! - `incognito-<n>`: an incognito window. It also shows one Space at a time; all of a
//!   Space's incognito windows share one temporary session, erased when the last closes.
//!
//! The current Space is kept here, natively, and changes only through
//! [`switch_space`]; it is never taken from anything a renderer sends. Which Spaces exist,
//! their names and colors come from the renderer's account Spaces and are kept on this
//! device with the Spaces that were open at quit.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, EventTarget, Manager, Runtime, Window};

mod commands;
mod lifecycle;
mod links;
mod registry;
pub use commands::*;
pub use lifecycle::*;
pub use links::*;
pub use registry::*;
#[cfg(test)]
mod tests;

/// The personal Space's key. It has a vault (and store) before the account's Spaces
/// are known, so it never waits for a Space id.
pub const PERSONAL: &str = "personal";
const WINDOW_PREFIX: &str = "window-";
const INCOGNITO_PREFIX: &str = "incognito-";
/// Emitted to a window's app when its current Space's name or color changes, or when
/// the window switches to another Space.
pub const SPACE_CHANGED_EVENT: &str = "misty://space-window";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpaceWindow {
    /// The Space the window shows now.
    pub space: String,
    /// Whether this is an incognito window.
    pub incognito: bool,
}

/// Each open window's current Space, by label. Its own lock, never held while the
/// registry's is taken.
static CURRENT: Mutex<BTreeMap<String, String>> = Mutex::new(BTreeMap::new());
/// The number the next window label takes.
static NEXT_WINDOW: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);

/// A Space's key: `personal` for the personal Space, otherwise the Space's id itself
/// (`space_<uuid>`). Keys never appear in window labels.
pub fn space_key(space_id: &str, personal: bool) -> Result<String, String> {
    if personal {
        return Ok(PERSONAL.into());
    }
    if space_id != PERSONAL && valid_key(space_id) {
        Ok(space_id.to_owned())
    } else {
        Err("Unknown Space.".into())
    }
}

pub(crate) fn valid_key(key: &str) -> bool {
    key == PERSONAL
        || (!key.is_empty()
            && key.len() <= 100
            && key
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'))
}

/// The Space id a key stands for; `None` for the personal Space, whose id the
/// registry learns from the renderer.
pub fn space_id_for_key(key: &str) -> Option<String> {
    (key != PERSONAL && valid_key(key)).then(|| key.to_owned())
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
    let prefix = if incognito { INCOGNITO_PREFIX } else { WINDOW_PREFIX };
    format!("{prefix}{number}")
}

/// Sets the Space a window shows. Only window creation and [`switch_space`] call this.
pub(super) fn set_current(label: &str, key: &str) {
    if let Ok(mut current) = CURRENT.lock() {
        current.insert(label.to_owned(), key.to_owned());
    }
}

/// Forgets a closed window's Space.
pub(super) fn forget_current(label: &str) -> Option<String> {
    CURRENT.lock().ok()?.remove(label)
}

/// Every open window with the Space it shows, in the order the windows opened.
pub(super) fn current_windows() -> Vec<(String, String)> {
    let mut windows: Vec<_> = CURRENT
        .lock()
        .map(|current| current.iter().map(|(l, k)| (l.clone(), k.clone())).collect())
        .unwrap_or_default();
    windows.sort_by_key(|(label, _)| {
        label_number(label, WINDOW_PREFIX)
            .or_else(|| label_number(label, INCOGNITO_PREFIX))
            .unwrap_or(u32::MAX)
    });
    windows
}

/// The app window or incognito window a label names, with the Space it shows now;
/// `None` for every other label.
pub fn parse(label: &str) -> Option<SpaceWindow> {
    let incognito = if label_number(label, WINDOW_PREFIX).is_some() {
        false
    } else if label_number(label, INCOGNITO_PREFIX).is_some() {
        true
    } else {
        return None;
    };
    let space = CURRENT.lock().ok()?.get(label).cloned()?;
    Some(SpaceWindow { space, incognito })
}

/// The Space a window shows now. Unknown labels show none.
pub fn space_for_window(label: &str) -> Option<String> {
    parse(label).map(|window| window.space)
}

/// An app window (not incognito): the full workspace, with sync, recovery, history,
/// memory and agents. Trust checks for account data accept these and nothing else.
pub fn is_space_window(label: &str) -> bool {
    label_number(label, WINDOW_PREFIX).is_some()
}

pub fn is_incognito_window(label: &str) -> bool {
    label_number(label, INCOGNITO_PREFIX).is_some()
}

/// Any Misty app window, incognito included: the bundled app runs in it.
pub fn is_app_window(label: &str) -> bool {
    is_space_window(label) || is_incognito_window(label)
}

/// Emitted to the window that becomes the host after the host closes.
pub const HOST_EVENT: &str = "misty://space-window-host";

/// The window that runs this device's own background work (agent jobs): the oldest
/// open app window. Incognito windows never host it.
pub fn host_window() -> Option<String> {
    current_windows()
        .into_iter()
        .map(|(label, _)| label)
        .find(|label| is_space_window(label))
}

/// Whether any open window shows the Space now.
pub fn space_is_open(key: &str) -> bool {
    current_windows().iter().any(|(_, shown)| shown == key)
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
        .or_else(|| {
            windows_for_space(app, PERSONAL)
                .into_iter()
                .find(|window| is_space_window(window.label()))
        })
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
