use super::saved::{self, Saved};
use super::*;
use serde::Deserialize;
use std::sync::atomic::AtomicBool;

pub const LOCAL_SCOPE: &str = "local";

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileEntry {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub order: f64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenWindow {
    pub profile: String,
    pub window_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub geometry: Option<super::window_geometry::SavedGeometry>,
}

#[derive(Default)]
pub(super) struct Registry {
    pub(super) scope: String,
    pub(super) legacy_owner: Option<String>,
    pub(super) profiles: BTreeMap<String, BTreeMap<String, ProfileEntry>>,
    pub(super) open: Vec<OpenWindow>,
    pub(super) orphans: BTreeMap<String, Vec<String>>,
    pub(super) last_focused: Option<String>,
}

static REGISTRY: Mutex<Option<Registry>> = Mutex::new(None);
pub(super) static QUITTING: AtomicBool = AtomicBool::new(false);
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
        open: if open.is_empty() {
            state.open.clone()
        } else {
            open
        },
        orphans: state.orphans.clone(),
    });
}

impl Registry {
    pub(super) fn current(&mut self) -> &mut BTreeMap<String, ProfileEntry> {
        let scope = self.scope.clone();
        let profiles = self.profiles.entry(scope).or_default();
        if !profiles.contains_key(PERSONAL) {
            profiles.insert(
                PERSONAL.into(),
                ProfileEntry {
                    id: PERSONAL.into(),
                    name: "Personal".into(),
                    order: 0.0,
                },
            );
        }
        profiles
    }

    pub(super) fn store(&mut self, profile: &str) -> Option<String> {
        if profile == PERSONAL {
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

pub fn store_for_profile(profile: &str) -> Result<Option<String>, String> {
    let mut state = lock_registry().map_err(|_| "Profiles are unavailable.")?;
    let store = state.store(profile);
    save(&state);
    Ok(store)
}

pub fn current_scope() -> String {
    lock_registry()
        .map(|state| state.scope.clone())
        .unwrap_or_else(|_| LOCAL_SCOPE.to_owned())
}

pub(super) fn last_focused_person() -> Option<String> {
    lock_registry()
        .ok()
        .and_then(|state| state.last_focused.clone())
}

#[cfg(target_os = "macos")]
pub(super) fn last_focused_any() -> Option<String> {
    LAST_FOCUSED.lock().ok().and_then(|last| last.clone())
}
