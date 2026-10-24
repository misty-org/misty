//! Forgetting this device's vault key, and deleting a vault.
use super::*;

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
    let api = account_api(&api_base, &account_id)?;
    let open = personal_session().await.as_ref().is_some_and(|active| {
        active.scope.deployment == api.deployment() && active.scope.account_id == account_id
    });
    if open {
        stop_all().await;
        let _ = crate::infra::space_windows::emit(&app, "misty:browser-sync-changed", "");
    }
    // Only the personal vault's root is remembered; it opens every other vault.
    let Some(vault) = personal_vault_id(&app, &api.deployment(), &account_id)? else {
        return Ok(());
    };
    let path = database_path(&api.deployment(), &account_id, &vault)?;
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

/// Deletes the account's vault so a new one can be created: an account has
/// one vault at a time. The server drops it with every Space vault sealed to
/// its root; this device stops syncing, forgets the remembered key and moves
/// its encrypted databases aside rather than erasing them, like a retired
/// enrollment. Other devices are asked to reconnect to the next vault.
#[tauri::command]
pub async fn browser_sync_delete_vault(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    api_base: String,
    account_id: String,
) -> Result<(), String> {
    require_main(&webview)?;
    let _lifecycle = browser_lifecycle().write().await;
    let api = account_api(&api_base, &account_id)?;
    stop_all().await;
    let _ = crate::infra::space_windows::emit(&app, "misty:browser-sync-changed", "");
    // The server goes first: if it cannot delete, this device keeps its vault.
    api.delete_vault().await.map_err(issue)?;
    let deployment = api.deployment();
    let personal = personal_vault_id(&app, &deployment, &account_id)?;
    let pointer = personal_pointer(&deployment, &account_id)?;
    let vaults = vaults_dir(&deployment, &account_id)?;
    tokio::task::spawn_blocking(move || {
        if let Some(vault) = personal {
            let path = database_path(&deployment, &account_id, &vault)?;
            let _lock = lock_database(&path)?;
            if let Ok(Some(cached)) = Store::read_cached_vault(&path, &deployment, &account_id) {
                let scope = VaultScope {
                    deployment: deployment.clone(),
                    account_id: account_id.clone(),
                    vault_id: cached.vault.vault_id,
                };
                secure_store::forget(&scope).map_err(issue)?;
            }
        }
        if vaults.exists() {
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|elapsed| elapsed.as_millis())
                .unwrap_or_default();
            std::fs::rename(
                &vaults,
                vaults.with_file_name(format!("vaults.deleted-{stamp}")),
            )
            .map_err(|_| {
                "Could not clear local sync storage. Close other Misty windows and try again."
            })?;
        }
        match std::fs::remove_file(&pointer) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                Err("Could not clear local sync storage.".to_string())
            }
            _ => Ok(()),
        }
    })
    .await
    .map_err(|_| "Could not clear local sync storage")??;
    let _ = crate::infra::space_windows::emit(&app, "misty:browser-sync-changed", "");
    Ok(())
}
