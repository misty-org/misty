//! Opening one Space's vault, once at a time.
use super::*;

static OPENING: OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> = OnceLock::new();

/// One open at a time per vault; a second caller finds it open or opening.
pub(super) struct Opening(String);
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
pub(super) async fn open_space(
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
