//! Local sync databases, one per vault: where each file lives, how it is
//! locked, retired after a rejected enrollment, and how a remembered key is
//! forgotten.
use super::*;

mod removal;
pub use removal::*;

/// The account's sync folder under Misty's data folder. A development profile
/// has its own sync storage, even for the same account.
pub(super) fn account_identity(deployment: &str, account_id: &str) -> Result<String, String> {
    let hash = Sha256::digest(
        match std::env::var("MISTY_PROFILE").ok() {
            Some(profile) => serde_json::to_vec(&(deployment, account_id, profile)),
            None => serde_json::to_vec(&(deployment, account_id)),
        }
        .map_err(|_| "Could not identify sync storage")?,
    );
    Ok(hash.iter().map(|byte| format!("{byte:02x}")).collect())
}

pub(super) fn sync_base() -> Result<PathBuf, String> {
    Ok(super::super::paths::misty_home_dir()
        .ok_or("Local application storage is unavailable")?
        .join(".local")
        .join("sync"))
}

fn create_private_dir(directory: &std::path::Path) -> Result<(), String> {
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder
        .create(directory)
        .map_err(|_| "Could not create sync storage".into())
}

/// Each vault (one per Space) has its own encrypted local store and lock.
pub(super) fn database_path(
    deployment: &str,
    account_id: &str,
    vault_id: &str,
) -> Result<PathBuf, String> {
    let vault: String = Sha256::digest(vault_id.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let directory = vaults_dir(deployment, account_id)?.join(vault);
    create_private_dir(&directory)?;
    Ok(directory.join("workspace.sqlite"))
}

/// Holds one folder per vault this device has a database for.
pub(super) fn vaults_dir(deployment: &str, account_id: &str) -> Result<PathBuf, String> {
    Ok(sync_base()?
        .join(account_identity(deployment, account_id)?)
        .join("vaults"))
}

/// Names the personal vault, whose database opens before any Space's.
fn personal_pointer(deployment: &str, account_id: &str) -> Result<PathBuf, String> {
    Ok(sync_base()?
        .join(account_identity(deployment, account_id)?)
        .join("personal-vault"))
}

pub(super) fn remember_personal_vault(
    deployment: &str,
    account_id: &str,
    vault_id: &str,
) -> Result<(), String> {
    let pointer = personal_pointer(deployment, account_id)?;
    if let Some(directory) = pointer.parent() {
        create_private_dir(directory)?;
    }
    std::fs::write(&pointer, vault_id).map_err(|_| "Could not record the sync vault".into())
}

/// The personal vault this device already has a database for. On the first
/// launch after vaults per Space, the account's single older database moves
/// to the personal vault's path, with its WAL, while it is locked and closed.
pub(super) fn personal_vault_id(
    app: &tauri::AppHandle,
    deployment: &str,
    account_id: &str,
) -> Result<Option<String>, String> {
    let pointer = personal_pointer(deployment, account_id)?;
    if let Ok(vault) = std::fs::read_to_string(&pointer) {
        let vault = vault.trim();
        if vault.is_empty() || vault.len() > 128 {
            return Err("Local sync storage is unavailable.".into());
        }
        return Ok(Some(vault.to_owned()));
    }
    let Some(legacy) = database_legacy::legacy_database(app, deployment, account_id)? else {
        return Ok(None);
    };
    let lock = lock_database(&legacy)?;
    let Some(vault) = database_legacy::stored_vault_id(&legacy, deployment, account_id)? else {
        return Ok(None);
    };
    let path = database_path(deployment, account_id, &vault)?;
    if path.exists() {
        return Err("Local sync storage needs recovery before sync can open it.".into());
    }
    for suffix in ["", "-wal", "-shm"] {
        let from = PathBuf::from(format!("{}{suffix}", legacy.display()));
        if from.exists() {
            std::fs::rename(&from, format!("{}{suffix}", path.display()))
                .map_err(|_| "Could not move local sync storage")?;
        }
    }
    remember_personal_vault(deployment, account_id, &vault)?;
    drop(lock);
    let _ = std::fs::remove_file(legacy.with_extension("lock"));
    Ok(Some(vault))
}

pub(in crate::infra) fn lock_database(path: &std::path::Path) -> Result<std::fs::File, String> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options
        .open(path.with_extension("lock"))
        .map_err(|_| "Could not lock sync storage")?;
    file.try_lock()
        .map_err(|_| "Another Misty process owns this device's sync storage")?;
    Ok(file)
}

#[derive(Serialize)]
pub struct VaultAvailability {
    local: bool,
    remote: Option<bool>,
}

/// Local metadata can be inspected without fetching or decrypting credentials.
#[tauri::command]
pub async fn browser_sync_availability(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    api_base: String,
    account_id: String,
) -> Result<VaultAvailability, String> {
    require_main(&webview)?;
    let current = personal_session().await;
    let api = account_api(&api_base, &account_id)?;
    if current.as_ref().is_some_and(|active| {
        active.scope.deployment == api.deployment() && active.scope.account_id == account_id
    }) {
        return Ok(VaultAvailability {
            local: true,
            remote: None,
        });
    }
    if let Some(vault) = personal_vault_id(&app, &api.deployment(), &account_id)? {
        let path = database_path(&api.deployment(), &account_id, &vault)?;
        let _lock = lock_database(&path)?;
        if Store::read_cached_vault(&path, &api.deployment(), &account_id)
            .map_err(issue)?
            .is_some()
        {
            return Ok(VaultAvailability {
                local: true,
                remote: None,
            });
        }
    }
    Ok(VaultAvailability {
        local: false,
        remote: Some(api.vault().await.map_err(issue)?.is_some()),
    })
}

/// Keep a rejected device's database beside the new one instead of deleting
/// it: its outbox is signed by the revoked identity and cannot be replayed, but
/// it may still hold edits worth recovering by hand.
pub(super) fn retire_database(path: &std::path::Path) -> misty_browser_sync::Result<()> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default();
    let retired = path.with_file_name(format!("workspace.retired-{stamp}.sqlite"));
    let storage = || misty_browser_sync::Error::Storage(rusqlite::Error::InvalidPath(path.into()));
    for suffix in ["", "-wal", "-shm"] {
        let from = std::path::PathBuf::from(format!("{}{suffix}", path.display()));
        if from.exists() {
            let to = format!("{}{suffix}", retired.display());
            std::fs::rename(&from, to).map_err(|_| storage())?;
        }
    }
    Ok(())
}
