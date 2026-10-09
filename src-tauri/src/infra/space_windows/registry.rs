//! The Spaces this device knows (names and colors), the ones open at quit, the window
//! used last and each Space's incognito session. Kept in `~/.misty/space-windows.json`.
use super::*;
use serde::Deserialize;
use std::collections::BTreeSet;
use std::sync::atomic::{AtomicBool, Ordering};

/// What the person sees for a Space in menus and the window's chrome.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SpaceEntry {
    pub key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space_id: Option<String>,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// The sites the Space claims, copied from its vault so links route while the
    /// vault is locked (see `links`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sites: Vec<String>,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Saved {
    #[serde(default)]
    pub(super) spaces: Vec<SpaceEntry>,
    /// Space keys whose windows were open at quit, in the order they opened.
    #[serde(default)]
    pub(super) open: Vec<String>,
    #[serde(default)]
    pub(super) last_focused: Option<String>,
}

#[derive(Default)]
pub(super) struct Registry {
    pub(super) spaces: BTreeMap<String, SpaceEntry>,
    pub(super) open: Vec<String>,
    pub(super) last_focused: Option<String>,
    /// Incognito windows per Space, and the session their pages share.
    pub(super) incognito: BTreeMap<String, IncognitoSession>,
}

pub(super) struct IncognitoSession {
    pub(super) windows: BTreeSet<u32>,
    pub(super) session: String,
}

static REGISTRY: Mutex<Option<Registry>> = Mutex::new(None);
/// Set once quitting starts: windows closing then are remembered as open.
pub(super) static QUITTING: AtomicBool = AtomicBool::new(false);
/// The last focused app window, incognito included; never saved.
pub(super) static LAST_FOCUSED: Mutex<Option<String>> = Mutex::new(None);
pub(super) static INCOGNITO_GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

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
        *guard = Some(load());
    }
    Ok(RegistryGuard(guard))
}

pub(super) fn saved_path() -> Option<std::path::PathBuf> {
    let home = crate::infra::paths::misty_home_dir()?;
    // A development profile keeps its own Spaces beside the others.
    let name = match std::env::var("MISTY_PROFILE") {
        Ok(dev) if !dev.is_empty() => format!("space-windows-{dev}.json"),
        _ => "space-windows.json".into(),
    };
    Some(home.join(name))
}

pub(super) fn load() -> Registry {
    let saved: Saved = saved_path()
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    Registry {
        spaces: saved
            .spaces
            .into_iter()
            .filter(|entry| valid_key(&entry.key))
            .map(|entry| (entry.key.clone(), entry))
            .collect(),
        open: saved.open.into_iter().filter(|key| valid_key(key)).collect(),
        last_focused: saved.last_focused.filter(|label| is_space_window(label)),
        incognito: BTreeMap::new(),
    }
}

pub(super) fn save(state: &Registry) {
    let Some(path) = saved_path() else { return };
    let saved = Saved {
        spaces: state.spaces.values().cloned().collect(),
        open: state.open.clone(),
        last_focused: state.last_focused.clone(),
    };
    if let Ok(bytes) = serde_json::to_vec_pretty(&saved) {
        let temporary = path.with_extension("json.tmp");
        if std::fs::write(&temporary, bytes).is_ok() {
            let _ = std::fs::rename(&temporary, &path);
        }
    }
}

/// The palette names a Space color may use, or a custom `#rrggbb`.
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

/// The first palette color no Space uses yet, else the least used one.
pub(super) fn next_color(spaces: &BTreeMap<String, SpaceEntry>) -> String {
    let mut counts: BTreeMap<&str, usize> = COLORS.iter().map(|name| (*name, 0)).collect();
    for entry in spaces.values() {
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

/// A Space is always given a color before its first window opens.
pub(super) fn ensure_entry(state: &mut Registry, key: &str) -> SpaceEntry {
    if !state.spaces.contains_key(key) {
        let color = next_color(&state.spaces);
        state.spaces.insert(
            key.into(),
            SpaceEntry {
                key: key.into(),
                space_id: space_id_for_key(key),
                name: if key == PERSONAL {
                    "Personal".into()
                } else {
                    "Space".into()
                },
                color: Some(color),
                sites: Vec::new(),
            },
        );
    }
    if state.spaces[key].color.is_none() {
        let color = next_color(&state.spaces);
        state.spaces.get_mut(key).expect("entry exists").color = Some(color);
    }
    state.spaces[key].clone()
}

pub fn entry(key: &str) -> Option<SpaceEntry> {
    let mut state = lock_registry().ok()?;
    let entry = ensure_entry(&mut state, key);
    save(&state);
    Some(entry)
}

/// The Spaces the menus list, personal first, then by name.
pub fn listed_spaces() -> Vec<SpaceEntry> {
    let Ok(state) = lock_registry() else {
        return Vec::new();
    };
    let mut spaces: Vec<_> = state.spaces.values().cloned().collect();
    spaces.sort_by(|a, b| {
        (a.key != PERSONAL, a.name.to_lowercase()).cmp(&(b.key != PERSONAL, b.name.to_lowercase()))
    });
    spaces
}

/// The temporary session an incognito window's pages share. `None` for other windows.
pub fn incognito_session(label: &str) -> Option<String> {
    let window = parse(label)?;
    let number = window.incognito?;
    let state = lock_registry().ok()?;
    state
        .incognito
        .get(&window.space)
        .filter(|session| session.windows.contains(&number))
        .map(|session| session.session.clone())
}

/// Forgets a closed incognito window. Returns the session to erase when it was the
/// Space's last incognito window.
pub(super) fn forget_incognito(label: &str) -> Option<String> {
    let window = parse(label)?;
    let number = window.incognito?;
    let mut state = lock_registry().ok()?;
    let session = state.incognito.get_mut(&window.space)?;
    session.windows.remove(&number);
    if session.windows.is_empty() {
        return state.incognito.remove(&window.space).map(|ended| ended.session);
    }
    None
}

/// The Space window used last, as saved.
pub(super) fn last_focused_space() -> Option<String> {
    lock_registry().ok().and_then(|state| state.last_focused.clone())
}

/// The app window used last, incognito included.
pub(super) fn last_focused_any() -> Option<String> {
    LAST_FOCUSED.lock().ok().and_then(|last| last.clone())
}
