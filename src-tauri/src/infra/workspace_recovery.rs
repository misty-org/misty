//! Account-scoped local recovery, independent of the unlocked sync vault.
use misty_browser_sync::{
    crypto::VaultScope,
    recovery::{RecoveryRecord, RecoveryStore},
    secure_store,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::sync::{Mutex, OnceLock};
use tauri::Manager;

struct Client {
    id: String,
    deployment: String,
    account: String,
    store: RecoveryStore,
    _lock: std::fs::File,
}
static CLIENT: OnceLock<Mutex<Option<Client>>> = OnceLock::new();
fn client() -> &'static Mutex<Option<Client>> {
    CLIENT.get_or_init(|| Mutex::new(None))
}
pub(super) fn close_account() -> Result<(), String> {
    *client()
        .lock()
        .map_err(|_| "Workspace recovery is unavailable")? = None;
    Ok(())
}
fn main_only(view: &tauri::Webview) -> Result<(), String> {
    if view.label() != "main" {
        return Err("Workspace recovery is available only in the main workspace".into());
    }
    Ok(())
}
fn error(_: misty_browser_sync::Error) -> String {
    "Could not save or recover the local workspace. Existing data has been preserved.".into()
}

fn recovery_directory(
    app: &tauri::AppHandle,
    deployment: &str,
    account: &str,
) -> Result<std::path::PathBuf, String> {
    let identity = hex::encode(Sha256::digest(
        serde_json::to_vec(&(deployment, account)).map_err(|_| "Invalid workspace identity")?,
    ));
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Workspace storage is unavailable")?
        .join("workspace-recovery")
        .join(identity))
}

fn remove_recovery_files(directory: &std::path::Path) -> Result<(), String> {
    for name in [
        "recovery.sqlite",
        "recovery.sqlite-wal",
        "recovery.sqlite-shm",
    ] {
        match std::fs::remove_file(directory.join(name)) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => {
                return Err(
                    "Could not remove workspace recovery. Retry removing this account.".into(),
                )
            }
        }
    }
    // Retain the lock inode: deleting it after releasing our process lock could
    // let another process lock the old inode while a third locks a new one.
    Ok(())
}

#[tauri::command]
pub async fn browser_recovery_forget(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    api_base: String,
    account_id: String,
) -> Result<(), String> {
    main_only(&webview)?;
    let lifetime = super::browser_sync::browser_lifecycle().write().await;
    tauri::async_runtime::spawn_blocking(move || {
        let _lifetime = lifetime;
        // This command serves the saved-account chooser after its cookie entry
        // was removed. It can forget only an inactive local recovery identity.
        let http = reqwest::Client::builder()
            .build()
            .map_err(|_| "Could not validate recovery identity")?;
        let deployment = misty_browser_sync::transport::SyncApi::new(&api_base, http)
            .map_err(error)?
            .deployment();
        let scope = VaultScope {
            deployment: deployment.clone(),
            account_id: account_id.clone(),
            workspace_id: "d32b3d14-d7b6-4d4c-a674-d36bb5aefb74".into(),
        };
        scope.validate().map_err(error)?;
        let current = client()
            .lock()
            .map_err(|_| "Workspace recovery is unavailable")?;
        if current
            .as_ref()
            .is_some_and(|v| v.account == account_id && v.deployment == deployment)
        {
            return Err(
                "Switch away from this account before removing its workspace recovery.".into(),
            );
        }
        let directory = recovery_directory(&app, &deployment, &account_id)?;
        let _lock = if directory.exists() {
            Some(super::browser_sync::lock_database(
                &directory.join("recovery.sqlite"),
            )?)
        } else {
            None
        };
        remove_recovery_files(&directory)?;
        secure_store::forget_workspace_recovery_root(&scope).map_err(error)
    })
    .await
    .map_err(|_| "Removing workspace recovery was interrupted")?
}
#[derive(Serialize)]
pub struct RecoverySession {
    session_id: String,
}

#[tauri::command]
pub async fn browser_recovery_open(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    api_base: String,
    account_id: String,
) -> Result<RecoverySession, String> {
    main_only(&webview)?;
    let lifetime = super::browser_sync::browser_lifecycle().read().await;
    // Move the lifetime lease into the blocking task. Cancellation of IPC cannot
    // let an account switch race an outstanding SQLite/Keychain operation.
    tauri::async_runtime::spawn_blocking(move || {
        let _lifetime = lifetime;
        let deployment = super::browser_sync::account_api(&api_base, &account_id)?.deployment();
        let mut current = client()
            .lock()
            .map_err(|_| "Workspace recovery is unavailable")?;
        if let Some(active) = current
            .as_ref()
            .filter(|v| v.account == account_id && v.deployment == deployment)
        {
            return Ok(RecoverySession {
                session_id: active.id.clone(),
            });
        }
        let scope = VaultScope {
            deployment: deployment.clone(),
            account_id: account_id.clone(),
            workspace_id: "d32b3d14-d7b6-4d4c-a674-d36bb5aefb74".into(),
        };
        let directory = recovery_directory(&app, &deployment, &account_id)?;
        let mut builder = std::fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder
            .create(&directory)
            .map_err(|_| "Could not create workspace storage")?;
        let path = directory.join("recovery.sqlite");
        let lock = super::browser_sync::lock_database(&path)?;
        let key = secure_store::workspace_recovery_root(&scope, !path.exists()).map_err(error)?;
        let store = RecoveryStore::open(&path, scope, key).map_err(error)?;
        let id = uuid::Uuid::new_v4().to_string();
        *current = Some(Client {
            id: id.clone(),
            deployment,
            account: account_id,
            store,
            _lock: lock,
        });
        Ok(RecoverySession { session_id: id })
    })
    .await
    .map_err(|_| "Workspace recovery was interrupted")?
}

#[tauri::command]
pub async fn browser_recovery_read(
    webview: tauri::Webview,
    session_id: String,
    key: String,
) -> Result<Option<RecoveryRecord>, String> {
    main_only(&webview)?;
    let lifetime = super::browser_sync::browser_lifecycle().read().await;
    tauri::async_runtime::spawn_blocking(move || {
        let _lifetime = lifetime;
        let current = client()
            .lock()
            .map_err(|_| "Workspace recovery is unavailable")?;
        let active = current
            .as_ref()
            .filter(|v| v.id == session_id)
            .ok_or("The workspace account changed")?;
        super::browser_sync::account_api(&active.deployment, &active.account)?;
        active.store.read(&key).map_err(error)
    })
    .await
    .map_err(|_| "Workspace recovery was interrupted")?
}

#[tauri::command]
pub async fn browser_recovery_write(
    webview: tauri::Webview,
    session_id: String,
    key: String,
    revision: u64,
    value: String,
) -> Result<RecoveryRecord, String> {
    main_only(&webview)?;
    let lifetime = super::browser_sync::browser_lifecycle().read().await;
    tauri::async_runtime::spawn_blocking(move || {
        let _lifetime = lifetime;
        let mut current = client()
            .lock()
            .map_err(|_| "Workspace recovery is unavailable")?;
        let active = current
            .as_mut()
            .filter(|v| v.id == session_id)
            .ok_or("The workspace account changed")?;
        super::browser_sync::account_api(&active.deployment, &active.account)?;
        active.store.write(&key, revision, &value).map_err(error)
    })
    .await
    .map_err(|_| "Workspace recovery was interrupted")?
}
