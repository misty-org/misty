//! Space vaults: every vault other than the personal one opens with the
//! personal root after one unlock, and a Space's window keeps its socket open.
use super::*;
use misty_browser_sync::protocol::SpaceVault;

/// Listing the account's vaults must not hold up an unlock for long; offline,
/// the Space vaults this device already has open from their local caches.
const LIST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// What the personal session lends to open its Space vaults.
struct Keys {
    session_id: String,
    api: SyncApi,
    scope: VaultScope,
    root: VaultRoot,
    device: DeviceKey,
    device_id: String,
}

async fn personal_keys() -> Option<Keys> {
    personal_session().await.as_ref().map(|active| Keys {
        session_id: active.id.clone(),
        api: active.api.clone(),
        scope: active.scope.clone(),
        root: active.admission_root.duplicate(),
        device: active.device_key.clone(),
        device_id: active.device_id.clone(),
    })
}

/// Opens every Space vault of the unlocked account, in the background.
pub(super) fn open_all(app: tauri::AppHandle) {
    tokio::spawn(async move {
        let Some(keys) = personal_keys().await else {
            return;
        };
        retire_stopped().await;
        let spaces = match tokio::time::timeout(LIST_TIMEOUT, keys.api.vaults()).await {
            Ok(Ok(listed)) => listed
                .into_iter()
                .filter(|vault| {
                    vault.vault_id != keys.scope.vault_id && vault.space_key_envelope.is_some()
                })
                .map(|vault| (vault.space_id.clone(), Vault::from(vault)))
                .collect(),
            _ => cached(&keys).unwrap_or_default(),
        };
        let mut changed = false;
        for (space_id, vault) in spaces {
            if let Err(error) = open_space(&app, &keys, &space_id, vault).await {
                space_failed(&space_id, error.into());
            }
            changed = true;
        }
        if changed {
            let _ = crate::infra::space_windows::emit(&app, "misty:browser-sync-changed", "");
        }
    });
}

/// Space sessions whose worker stopped are closed, so they can open again.
async fn retire_stopped() {
    let stopped: Vec<Slot> = {
        let mut all = sessions();
        let vaults: Vec<String> = all
            .vaults
            .iter()
            .filter(|(_, entry)| {
                entry.space_id.is_some()
                    && matches!(
                        entry.status.borrow().phase,
                        Phase::Attention | Phase::Stopped
                    )
            })
            .map(|(vault, _)| vault.clone())
            .collect();
        vaults
            .iter()
            .filter_map(|vault| all.vaults.remove(vault))
            .map(|entry| entry.slot)
            .collect()
    };
    for slot in stopped {
        stop(slot.lock_owned().await.take()).await;
    }
}

/// The Space vaults this device has a database for, from their caches.
fn cached(keys: &Keys) -> Result<Vec<(String, Vault)>, String> {
    let directory = database::vaults_dir(&keys.scope.deployment, &keys.scope.account_id)?;
    let Ok(entries) = std::fs::read_dir(&directory) else {
        return Ok(Vec::new());
    };
    let mut spaces = Vec::new();
    for entry in entries.take(1024).flatten() {
        let path = entry.path().join("workspace.sqlite");
        let Ok(space_id) = std::fs::read_to_string(space_marker(&path)) else {
            continue;
        };
        let Ok(_lock) = lock_database(&path) else {
            continue;
        };
        if let Ok(Some(cached)) =
            Store::read_cached_vault(&path, &keys.scope.deployment, &keys.scope.account_id)
        {
            if cached.vault.is_space() && cached.vault.vault_id != keys.scope.vault_id {
                spaces.push((space_id.trim().to_owned(), cached.vault));
            }
        }
    }
    Ok(spaces)
}

/// Names the Space a vault's database belongs to, so it can open offline.
fn space_marker(path: &std::path::Path) -> PathBuf {
    path.with_file_name("space")
}

static OPENING: OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> = OnceLock::new();

/// One open at a time per vault; a second caller finds it open or opening.
struct Opening(String);
impl Opening {
    fn claim(vault: &str) -> Option<Self> {
        let mut opening = OPENING
            .get_or_init(Default::default)
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        (!sessions().vaults.contains_key(vault) && opening.insert(vault.to_owned()))
            .then(|| Self(vault.to_owned()))
    }
}
impl Drop for Opening {
    fn drop(&mut self) {
        if let Some(opening) = OPENING.get() {
            opening
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .remove(&self.0);
        }
    }
}

/// Opens one Space vault with the personal root. A device not in it yet joins
/// with the key it uses in the personal vault; its worker enrolls it.
async fn open_space(
    app: &tauri::AppHandle,
    keys: &Keys,
    space_id: &str,
    vault: Vault,
) -> Result<(), String> {
    let Some(_opening) = Opening::claim(&vault.vault_id) else {
        return Ok(());
    };
    let scope = VaultScope {
        deployment: keys.scope.deployment.clone(),
        account_id: keys.scope.account_id.clone(),
        vault_id: vault.vault_id.clone(),
    };
    scope.validate().map_err(issue)?;
    let sealed = vault
        .space_key_envelope
        .as_ref()
        .ok_or("This Space's vault cannot be opened with the sync password.")?;
    let root = keys
        .root
        .open_space_root(&keys.scope, &scope, sealed, &vault.root_public_key)
        .map_err(issue)?;
    let path = database_path(&scope.deployment, &scope.account_id, &scope.vault_id)?;
    let database_lock = lock_database(&path)?;
    std::fs::write(space_marker(&path), space_id)
        .map_err(|_| "Could not record the Space's sync storage")?;
    let native_scope = scope.clone();
    let device = keys.device.clone();
    let device_id = keys.device_id.clone();
    let (root, store, device, database_lock) = tokio::task::spawn_blocking(move || {
        let cached = CachedVault {
            vault,
            bootstrap_pending: false,
            enrollment_pending: true,
        };
        let existing =
            Store::belongs_to_account(&path, &native_scope.deployment, &native_scope.account_id)?;
        let (store, device) = if existing {
            let (mut store, device) = Store::unlock(&path, native_scope.clone(), &root)?;
            store.cache_verified_vault(&root, &cached)?;
            (store, device)
        } else {
            let grant = root.grant(&native_scope, &device_id, cached.vault.key_epoch, &device)?;
            let store = Store::initialize_vault(
                &path,
                native_scope.clone(),
                grant,
                &root,
                &device,
                &Document::default().encode()?,
                Some(&cached),
            )?;
            (store, device)
        };
        Ok::<_, misty_browser_sync::Error>((root, store, device, database_lock))
    })
    .await
    .map_err(|_| "Could not open the Space's sync vault")?
    .map_err(issue)?;
    // Install under the account lifecycle: a lock or account change since the
    // keys were lent stopped the personal session, and this vault must not
    // outlive it.
    let _lifecycle = browser_lifecycle().read().await;
    let current = personal_session().await;
    if current.as_ref().map(|active| active.id.as_str()) != Some(keys.session_id.as_str()) {
        return Ok(());
    }
    drop(current);
    session_start::start_session(
        app,
        session_start::Opened {
            api: keys.api.for_vault(&scope.vault_id),
            scope,
            root,
            device,
            store,
            database_lock,
            space_id: Some(space_id.to_owned()),
        },
    )
    .await?;
    Ok(())
}

/// Creates the account's vault for a Space that has none yet, its root sealed
/// to the personal root and this device granted into it.
async fn create_space_vault(keys: &Keys, space_id: &str) -> Result<Vault, String> {
    let root = VaultRoot::generate();
    let scope = VaultScope {
        deployment: keys.scope.deployment.clone(),
        account_id: keys.scope.account_id.clone(),
        vault_id: uuid::Uuid::new_v4().to_string(),
    };
    let sealed = keys
        .root
        .seal_space_root(&keys.scope, &scope, &root)
        .map_err(issue)?;
    let grant = root
        .grant(&scope, &keys.device_id, 1, &keys.device)
        .map_err(issue)?;
    let public = root.public_key().map_err(issue)?;
    keys.api
        .create_space_vault(space_id, &public, &sealed, &grant)
        .await
        .map_err(issue)?;
    Ok(Vault {
        vault_id: scope.vault_id,
        key_epoch: 1,
        head_sequence: 0,
        root_public_key: public,
        key_envelope: None,
        space_key_envelope: Some(sealed),
    })
}

fn vault_for_space(space_id: &str) -> Option<String> {
    sessions()
        .vaults
        .iter()
        .find(|(_, entry)| entry.space_id.as_deref() == Some(space_id))
        .map(|(vault, _)| vault.clone())
}

/// A window showing `space_id` opened or closed. Opening one creates the
/// Space's vault if the person has none and keeps its socket open; once no
/// window shows it, the vault pulls on the sync batching interval instead.
/// The personal Space's vault is always open.
#[tauri::command]
pub async fn browser_sync_space_window(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    space_id: String,
    open: bool,
) -> Result<(), String> {
    require_main(&webview)?;
    if let Some(vault) = vault_for_space(&space_id) {
        set_vault_open(&vault, open).await;
        return Ok(());
    }
    if !open {
        return Ok(());
    }
    let keys = personal_keys()
        .await
        .ok_or("Unlock sync before opening this Space.")?;
    let listed: Vec<SpaceVault> = keys.api.vaults().await.map_err(issue)?;
    let vault = match listed.into_iter().find(|vault| vault.space_id == space_id) {
        Some(vault) if vault.space_key_envelope.is_some() => Vault::from(vault),
        Some(_) => return Ok(()),
        None => create_space_vault(&keys, &space_id).await?,
    };
    if let Err(error) = open_space(&app, &keys, &space_id, vault).await {
        space_failed(&space_id, error.clone().into());
        return Err(error);
    }
    if let Some(vault) = vault_for_space(&space_id) {
        set_vault_open(&vault, true).await;
    }
    let _ = crate::infra::space_windows::emit(&app, "misty:browser-sync-changed", "");
    Ok(())
}
