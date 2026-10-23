//! Space data in the sync tree: extensions, site permissions, search engines
//! and bangs, and the downloads list. Each lives in its own collection of the
//! Space's vault; this finds that vault, tells the owners when another device
//! changed one, and seeds the personal Space from this device once.
use super::*;
use misty_browser_sync::collections::{DOWNLOADS, EXTENSIONS, SEARCH, SITE_PERMISSIONS};

/// One Space's vault as the owners of its data see it.
#[derive(Clone)]
pub(crate) struct SpaceVault {
    pub handle: WorkerHandle,
    /// This device's id in the vault, which marks the downloads it holds.
    pub device_id: String,
    /// The Space; None for the personal Space.
    pub space_id: Option<String>,
}

async fn open_vault(slot: Slot, space_id: Option<String>) -> Option<SpaceVault> {
    let session = slot.lock_owned().await;
    let active = session.as_ref()?;
    Some(SpaceVault {
        handle: active.handle.clone(),
        device_id: active.device_id.clone(),
        space_id,
    })
}

/// The Space a window shows, from its label; `None` is the personal Space.
pub(crate) fn window_space(window_label: &str) -> Option<String> {
    crate::infra::space_windows::space_for_window(window_label)
        .and_then(|key| crate::infra::space_windows::space_id_for_key(&key))
}

/// A Space's open vault; `None` names the personal Space. A Space whose vault
/// is not open has none: its data never falls back to another Space.
pub(crate) async fn space_vault(space_id: Option<&str>) -> Option<SpaceVault> {
    let slot = {
        let all = sessions();
        match space_id {
            None => all
                .personal
                .as_ref()
                .and_then(|vault| all.vaults.get(vault)),
            Some(space) => all
                .vaults
                .values()
                .find(|entry| entry.space_id.as_deref() == Some(space)),
        }
        .map(|entry| entry.slot.clone())?
    };
    open_vault(slot, space_id.map(str::to_owned)).await
}

/// The vault whose pages use the browser store `store_key` (as
/// `browser_site_permissions::profile_key` names it). Stores of no open vault
/// (device profiles, private sessions, a locked vault) have none.
pub(crate) async fn store_vault(store_key: &str) -> Option<SpaceVault> {
    let found = vault_store_keys()
        .into_iter()
        .find(|(_, key, _, _)| key == store_key);
    let (_, _, slot, space_id) = found?;
    open_vault(slot, space_id).await
}

/// Each open vault with the store key its pages use. The personal vault also
/// answers for the store a profile-less page opens in.
fn vault_store_keys() -> Vec<(String, String, Slot, Option<String>)> {
    let entries: Vec<(String, Slot, Option<String>, bool)> = {
        let all = sessions();
        all.vaults
            .iter()
            .map(|(vault, entry)| {
                (
                    vault.clone(),
                    entry.slot.clone(),
                    entry.space_id.clone(),
                    all.personal.as_deref() == Some(vault),
                )
            })
            .collect()
    };
    let mut keys = Vec::new();
    for (vault, slot, space_id, personal) in entries {
        if let Ok(Some(selected)) = selected_profile(&vault) {
            if let Ok(key) =
                crate::infra::site_settings::permissions::profile_key(Some(&selected.physical))
            {
                keys.push((vault.clone(), key, slot.clone(), space_id.clone()));
            }
        }
        if personal {
            if let Ok(key) = crate::infra::site_settings::permissions::profile_key(None) {
                keys.push((vault, key, slot, space_id));
            }
        }
    }
    keys
}

/// The store key a vault's pages use, once its profile is selected.
fn store_key_of(vault: &str) -> Option<String> {
    let selected = selected_profile(vault).ok()??;
    crate::infra::site_settings::permissions::profile_key(Some(&selected.physical)).ok()
}

/// A device's name in a Space, for "On <device>".
pub(crate) fn device_name(vault: &SpaceVault, device_id: &str) -> Option<String> {
    vault
        .handle
        .devices
        .borrow()
        .iter()
        .find(|device| device.grant.device_id == device_id)
        .map(|device| device.display_name.clone())
        .filter(|name| !name.trim().is_empty())
}

/// Watches one vault's Space data for other devices' changes, until its
/// worker stops. The personal vault first seeds its collections from this
/// device's own values, once.
pub(super) fn spawn(app: tauri::AppHandle, slot: Slot, vault_id: String, space_id: Option<String>) {
    tokio::spawn(async move {
        let Some(vault) = open_vault(slot, space_id).await else {
            return;
        };
        if vault.space_id.is_none() {
            seed_personal_space(&vault, &vault_id).await;
        }
        let vault_id = Some(vault_id);
        let mut sync_state = vault.handle.workspaces.clone();
        let mut seen: std::collections::BTreeMap<String, u64> = Default::default();
        // Site choices made while the vault was locked go up before the
        // vault's copy replaces the cache.
        let mut first = true;
        loop {
            let revisions = sync_state.borrow_and_update().revisions.clone();
            for collection in [SITE_PERMISSIONS, SEARCH, DOWNLOADS, EXTENSIONS] {
                let revision = revisions.get(collection).copied().unwrap_or_default();
                if !first && seen.get(collection) == Some(&revision) {
                    continue;
                }
                seen.insert(collection.to_owned(), revision);
                changed(&app, &vault, vault_id.as_deref(), collection, first).await;
            }
            first = false;
            if sync_state.changed().await.is_err() {
                break;
            }
        }
    });
}

/// Another device changed `collection` (or the vault just opened).
async fn changed(
    app: &tauri::AppHandle,
    vault: &SpaceVault,
    vault_id: Option<&str>,
    collection: &str,
    opened: bool,
) {
    let space = serde_json::json!({ "spaceId": vault.space_id });
    match collection {
        SITE_PERMISSIONS => {
            if let Some(store_key) = vault_id.and_then(store_key_of) {
                crate::infra::site_settings::permissions::space_changed(
                    app, vault, store_key, opened,
                )
                .await;
            }
        }
        SEARCH => {
            crate::infra::space_windows::emit(app, "misty:space-search-changed", space);
        }
        DOWNLOADS => {
            crate::infra::space_windows::emit(app, "misty:space-downloads-changed", space);
        }
        EXTENSIONS => crate::infra::extensions::space::changed(vault).await,
        _ => {}
    }
}

/// Copies this device's site choices, downloads list and search shortcuts into
/// the personal Space, once per vault. Extensions arrive with the next
/// reconcile, which writes every installed one.
async fn seed_personal_space(vault: &SpaceVault, vault_id: &str) {
    let Some(home) = crate::infra::paths::misty_home_dir() else {
        return;
    };
    // The personal store must be known, or the site choices to copy are too.
    let Some(store_key) = store_key_of(vault_id) else {
        return;
    };
    let store = crate::infra::store::Store::at(home.join(".local").join("data").join("misty.db"));
    let device_id = vault.device_id.clone();
    let name = format!("space-collections:{vault_id}");
    let seed = tokio::task::spawn_blocking(move || {
        let mut seed = None;
        let legacy = crate::infra::site_settings::permissions::profile_key(None).ok();
        let result = store.import_once(&name, |connection| -> rusqlite::Result<()> {
            seed = Some(Seed::read(
                connection,
                &store_key,
                legacy.as_deref(),
                &device_id,
            ));
            Ok(())
        });
        result.ok().and(seed)
    })
    .await
    .ok()
    .flatten();
    let Some(seed) = seed else {
        return;
    };
    for (collection, writes) in seed.writes() {
        if !writes.is_empty() {
            let _ = vault.handle.records_write(collection.into(), writes).await;
        }
    }
}

/// This device's values the personal Space starts from.
struct Seed {
    sites: Vec<misty_browser_sync::document::ViewRecord>,
    downloads: Vec<misty_browser_sync::document::ViewRecord>,
    search: Vec<misty_browser_sync::document::ViewRecord>,
}

impl Seed {
    fn read(
        connection: &rusqlite::Connection,
        store_key: &str,
        legacy_key: Option<&str>,
        device_id: &str,
    ) -> Self {
        Self {
            sites: crate::infra::site_settings::permissions::seed_records(
                connection, store_key, legacy_key,
            ),
            downloads: crate::infra::browser_library::seed_download_records(connection, device_id),
            search: crate::infra::search::space::seed_records(connection),
        }
    }

    fn writes(
        self,
    ) -> [(
        &'static str,
        Vec<(String, Option<misty_browser_sync::document::ViewRecord>)>,
    ); 3] {
        let writes = |records: Vec<misty_browser_sync::document::ViewRecord>| {
            records
                .into_iter()
                .map(|record| (record.id.clone(), Some(record)))
                .collect()
        };
        [
            (SITE_PERMISSIONS, writes(self.sites)),
            (DOWNLOADS, writes(self.downloads)),
            (SEARCH, writes(self.search)),
        ]
    }
}

/// A stable record id for text that may not be one (an origin, a download id).
pub(crate) fn hashed_id(prefix: &str, value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    let hex: String = digest[..16].iter().map(|b| format!("{b:02x}")).collect();
    format!("{prefix}:{hex}")
}
