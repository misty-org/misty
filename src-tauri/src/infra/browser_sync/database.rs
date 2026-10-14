//! Local sync database: where a vault's file lives, how it is locked, retired
//! after a rejected enrollment, and how a remembered key is forgotten.
use super::*;

pub(super) fn database_path(
    app: &tauri::AppHandle,
    deployment: &str,
    account_id: &str,
) -> Result<PathBuf, String> {
    // A development profile has its own sync storage, even for the same account.
    let hash = Sha256::digest(
        match std::env::var("MISTY_PROFILE").ok() {
            Some(profile) => serde_json::to_vec(&(deployment, account_id, profile)),
            None => serde_json::to_vec(&(deployment, account_id)),
        }
        .map_err(|_| "Could not identify sync storage")?,
    );
    let identity: String = hash.iter().map(|byte| format!("{byte:02x}")).collect();
    // Vault databases live under Misty's data folder. One an earlier layout kept in the
    // app's own data folder stays where it is (see below).
    let base = super::super::paths::misty_home_dir()
        .ok_or("Local application storage is unavailable")?
        .join(".local")
        .join("sync");
    let earlier_base = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Local application storage is unavailable")?
        .join("browser-sync");
    let directory = base.join(&identity);
    let path = directory.join("workspace.sqlite");
    if path.is_file() {
        return Ok(path);
    }
    let earlier = earlier_base.join(&identity).join("workspace.sqlite");
    if earlier.is_file() {
        return Ok(earlier);
    }
    let base_for_scan = earlier_base;
    // Reuse earlier workspace-scoped databases in place. Moving/copying a live
    // WAL or reenrolling would risk losing pending edits or cloning counters.
    let mut previous = None;
    if base_for_scan.is_dir() {
        let entries =
            std::fs::read_dir(&base_for_scan).map_err(|_| "Could not inspect sync storage")?;
        for (index, entry) in entries.enumerate() {
            if index >= 1024 {
                return Err("Too many local vaults to select safely".into());
            }
            let entry = entry.map_err(|_| "Could not inspect sync storage")?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            if name.len() != 64 || !name.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                continue;
            }
            let candidate = entry.path().join("workspace.sqlite");
            if Store::belongs_to_account(&candidate, deployment, account_id).map_err(issue)? {
                if previous.is_some() {
                    return Err(
                        "Multiple older vaults need recovery before sync can select one.".into(),
                    );
                }
                previous = Some(candidate);
            }
        }
    }
    if let Some(path) = previous {
        return Ok(path);
    }
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder
        .create(&directory)
        .map_err(|_| "Could not create sync storage")?;
    Ok(directory.join("workspace.sqlite"))
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
    let current = session().lock().await;
    let api = account_api(&api_base, &account_id)?;
    if current.as_ref().is_some_and(|active| {
        active.scope.deployment == api.deployment() && active.scope.account_id == account_id
    }) {
        return Ok(VaultAvailability {
            local: true,
            remote: None,
        });
    }
    let path = database_path(&app, &api.deployment(), &account_id)?;
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

/// Remove OS remembering even while the vault is locked. Encrypted local data
/// remains available for a later password + sync-secret unlock.
#[tauri::command]
pub async fn browser_sync_forget_key(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    api_base: String,
    account_id: String,
) -> Result<(), String> {
    require_main(&webview)?;
    let _lifecycle = browser_lifecycle().write().await;
    let mut current = session().lock().await;
    let api = account_api(&api_base, &account_id)?;
    if current.as_ref().is_some_and(|active| {
        active.scope.deployment == api.deployment() && active.scope.account_id == account_id
    }) {
        stop(current.take()).await;
        let _ = app.emit_to("main", "misty:browser-sync-changed", "");
    }
    let path = database_path(&app, &api.deployment(), &account_id)?;
    let database_lock = lock_database(&path)?;
    let deployment = api.deployment();
    tokio::task::spawn_blocking(move || {
        let _database_lock = database_lock;
        if let Some(cached) = Store::read_cached_vault(&path, &deployment, &account_id)? {
            let scope = VaultScope {
                deployment,
                account_id,
                vault_id: cached.vault.vault_id,
            };
            secure_store::forget(&scope)?;
        }
        Ok::<_, misty_browser_sync::Error>(())
    })
    .await
    .map_err(|_| "Could not remove the remembered sync key")?
    .map_err(issue)
}
