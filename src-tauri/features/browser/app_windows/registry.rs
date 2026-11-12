//! The profiles this computer knows, per account, and what its windows showed at quit. Kept
//! in `misty.db` (`saved`), with nothing secret in it.
//!
//! Each account (or nobody signed in, `local`) has its own list. The store a profile's pages
//! open in comes from here, and stays on this computer. The store this computer has always
//! browsed in belongs to the first account to ask for it, so nobody is signed out by an upgrade
//! or by signing in.
use super::saved::{self, Saved};
use super::*;
use serde::Deserialize;
use std::sync::atomic::AtomicBool;

/// Who is browsing when nobody is signed in.
pub const LOCAL_SCOPE: &str = "local";

/// What the person sees for a profile in menus and the window's chrome.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileEntry {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default)]
    pub order: f64,
    /// The sites this profile claims for links from other apps (see `links`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sites: Vec<String>,
}

/// A window left open at quit.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenWindow {
    pub profile: String,
    pub window_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space: Option<String>,
    /// Where the window was and how big (`window_geometry`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub geometry: Option<super::window_geometry::SavedGeometry>,
}

#[derive(Default)]
pub(super) struct Registry {
    /// The account the windows belong to now.
    pub(super) scope: String,
    /// The account whose first profile uses this computer's original browser store.
    pub(super) legacy_owner: Option<String>,
    pub(super) profiles: BTreeMap<String, BTreeMap<String, ProfileEntry>>,
    /// What the last launch left open; the windows this launch restores.
    pub(super) open: Vec<OpenWindow>,
    /// Closed windows' saved tabs, by profile, waiting for a window to take them. A closed
    /// window changes nothing about what is in its profile.
    pub(super) orphans: BTreeMap<String, Vec<String>>,
    pub(super) last_focused: Option<String>,
}

static REGISTRY: Mutex<Option<Registry>> = Mutex::new(None);
/// Set once quitting starts: windows closing then are remembered as open.
pub(super) static QUITTING: AtomicBool = AtomicBool::new(false);
/// The last focused app window; never saved.
pub(super) static LAST_FOCUSED: Mutex<Option<String>> = Mutex::new(None);

pub(super) struct RegistryGuard(std::sync::MutexGuard<'static, Option<Registry>>);
impl std::ops::Deref for RegistryGuard {
    type Target = Registry;
    fn deref(&self) -> &Registry {
        self.0.as_ref().expect("registry is initialized")
    }
}
impl std::ops::DerefMut for RegistryGuard {
    fn deref_mut(&mut self) -> &mut Registry {
        self.0.as_mut().expect("registry is initialized")
    }
}

pub(super) fn lock_registry() -> Result<RegistryGuard, ()> {
    let mut guard = REGISTRY.lock().map_err(|_| ())?;
    if guard.is_none() {
        // A list that can't be read stays unloaded, so the next ask tries again and nothing is
        // ever saved over it.
        let loaded = load().map_err(|error| eprintln!("Could not read the profiles: {error}"))?;
        *guard = Some(loaded);
    }
    Ok(RegistryGuard(guard))
}

fn valid_profile(profile: &ProfileEntry) -> bool {
    valid_key(&profile.id)
}

pub(super) fn load() -> Result<Registry, String> {
    let saved = saved::read()?;
    Ok(Registry {
        scope: saved.scope.unwrap_or_else(|| LOCAL_SCOPE.to_owned()),
        legacy_owner: saved.legacy_owner,
        profiles: saved
            .profiles
            .into_iter()
            .map(|(scope, profiles)| {
                let profiles = profiles
                    .into_iter()
                    .filter(|(_, profile)| valid_profile(profile))
                    .collect();
                (scope, profiles)
            })
            .collect(),
        open: saved
            .open
            .into_iter()
            .filter(|open| valid_key(&open.profile) && valid_key(&open.window_id))
            .collect(),
        orphans: saved.orphans,
        last_focused: None,
    })
}

pub(super) fn save(state: &Registry) {
    let open: Vec<OpenWindow> = current_windows()
        .into_iter()
        .filter(|(label, _)| is_person_window(label))
        .map(|(_, window)| OpenWindow {
            profile: window.profile,
            geometry: super::window_geometry::geometry_for(&window.window_id),
            window_id: window.window_id,
            space: window.space,
        })
        .collect();
    saved::write(&Saved {
        scope: Some(state.scope.clone()),
        legacy_owner: state.legacy_owner.clone(),
        profiles: state.profiles.clone(),
        // Before any window opens (or after the last closed), keep what was saved.
        open: if open.is_empty() {
            state.open.clone()
        } else {
            open
        },
        orphans: state.orphans.clone(),
    });
}

/// The palette names a profile color may use, or a custom `#rrggbb`.
const COLORS: [&str; 8] = [
    "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange",
];

pub fn valid_color(color: &str) -> bool {
    COLORS.contains(&color)
        || (color.len() == 7
            && color.starts_with('#')
            && color[1..]
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)))
}

/// The first palette color no profile uses yet, else the least used one.
pub(super) fn next_color(profiles: &BTreeMap<String, ProfileEntry>) -> String {
    let mut counts: BTreeMap<&str, usize> = COLORS.iter().map(|name| (*name, 0)).collect();
    for entry in profiles.values() {
        if let Some(count) = entry.color.as_deref().and_then(|c| counts.get_mut(c)) {
            *count += 1;
        }
    }
    COLORS
        .iter()
        .min_by_key(|name| (counts[*name], COLORS.iter().position(|c| c == *name)))
        .copied()
        .unwrap_or("blue")
        .into()
}

impl Registry {
    /// The current account's profiles. Every account has at least the first one.
    pub(super) fn current(&mut self) -> &mut BTreeMap<String, ProfileEntry> {
        let scope = self.scope.clone();
        let profiles = self.profiles.entry(scope).or_default();
        if !profiles.contains_key(PERSONAL) {
            let color = next_color(profiles);
            profiles.insert(
                PERSONAL.into(),
                ProfileEntry {
                    id: PERSONAL.into(),
                    name: "Personal".into(),
                    color: Some(color),
                    order: 0.0,
                    sites: Vec::new(),
                },
            );
        }
        profiles
    }

    /// The store a profile's pages open in; `None` is this computer's original store.
    pub(super) fn store(&mut self, profile: &str) -> Option<String> {
        if profile == PERSONAL {
            // Browsing signed out, then signing in, keeps the same sign-ins: the first account
            // to sign in takes the original store from nobody. Signed out, it may ask before any
            // account has been restored at launch, so that claim is only ever provisional.
            let local_owns = self.legacy_owner.as_deref() == Some(LOCAL_SCOPE);
            if self.legacy_owner.is_none() || (local_owns && self.scope != LOCAL_SCOPE) {
                self.legacy_owner = Some(self.scope.clone());
            }
            if self.legacy_owner.as_deref() == Some(self.scope.as_str()) {
                return None;
            }
        }
        derived_store(&self.scope, profile)
    }
}

pub fn entry(key: &str) -> Option<ProfileEntry> {
    let mut state = lock_registry().ok()?;
    let entry = state.current().get(key).cloned();
    save(&state);
    entry
}

/// The current account's profiles, in the order the person put them.
pub fn listed_profiles() -> Vec<ProfileEntry> {
    let Ok(mut state) = lock_registry() else {
        return Vec::new();
    };
    let mut profiles: Vec<_> = state.current().values().cloned().collect();
    profiles.sort_by(|a, b| {
        a.order
            .total_cmp(&b.order)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    profiles
}

/// The store a profile's pages open in, for the current account. `Err` when the registry is
/// unavailable, so no caller ever falls back to a store the person didn't choose.
pub fn store_for_profile(profile: &str) -> Result<Option<String>, String> {
    let mut state = lock_registry().map_err(|_| "Profiles are unavailable.")?;
    let store = state.store(profile);
    save(&state);
    Ok(store)
}

/// Whether an identity is a store some profile on this computer uses.
pub fn is_profile_store(identity: &str) -> bool {
    let Ok(state) = lock_registry() else {
        // Unknown means in use: erasing must never guess.
        return true;
    };
    state.profiles.iter().any(|(scope, profiles)| {
        profiles
            .keys()
            .any(|profile| derived_store(scope, profile).as_deref() == Some(identity))
    })
}

/// The account the windows belong to now, as `<server>|<account id>`, or `local`.
pub fn current_scope() -> String {
    lock_registry()
        .map(|state| state.scope.clone())
        .unwrap_or_else(|_| LOCAL_SCOPE.to_owned())
}

/// The app window used last in this launch.
pub(super) fn last_focused_person() -> Option<String> {
    lock_registry()
        .ok()
        .and_then(|state| state.last_focused.clone())
}

/// The app window used last, even one that has closed since.
pub(super) fn last_focused_any() -> Option<String> {
    LAST_FOCUSED.lock().ok().and_then(|last| last.clone())
}
