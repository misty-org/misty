//! A profile's extension host over its life: made when its window first runs
//! extensions, freed when its last window closes, erased with the profile.
use super::*;
use crate::infra::file_access::fs;

/// Packages installed before profiles lived in `extensions/<account>`; they move
/// under the personal profile once, so the personal profile keeps every extension.
pub(super) fn adopt_account_packages(app: &tauri::AppHandle, account: &str) -> Result<(), String> {
    let base = account_root(app, account)?;
    let personal = base.join(crate::infra::profile_windows::PERSONAL);
    let packages = base.join("packages");
    if fs::exists(&personal) || !fs::exists(&packages) {
        return Ok(());
    }
    fs::create_dir_all(&personal).map_err(|e| e.to_string())?;
    fs::rename(&packages, personal.join("packages")).map_err(|e| e.to_string())?;
    // Unfinished downloads from before are only staging; nothing points at them.
    let _ = fs::remove_dir_all(base.join("staging"));
    Ok(())
}

/// The profile's last window closed: its controller, background pages and tabs go
/// until a window of the profile runs extensions again. Nothing installed changes.
pub(crate) fn release_profile(key: &str) {
    let key = key.to_owned();
    tauri::async_runtime::spawn(async move {
        let _guard = lifecycle().lock().await;
        let account = forget_profile(&key).await;
        if !account.is_empty() {
            let _ = native::request(json!({"operation":"release-space","space":key})).await;
        }
    });
}

/// The profile is gone from this device: its host stops, and its controller's
/// extension storage and its packages are erased.
pub(crate) async fn remove_profile(app: &tauri::AppHandle, key: &str) -> Result<(), String> {
    if key == crate::infra::profile_windows::PERSONAL {
        return Err("The personal profile's extensions can't be removed.".into());
    }
    let _guard = lifecycle().lock().await;
    forget_profile(key).await;
    let account = current_account()
        .lock()
        .map(|account| account.clone())
        .unwrap_or_default();
    if account.is_empty() {
        return Err("Sign in to remove this profile's extensions.".into());
    }
    let mut result = native::request(json!({
        "operation":"remove-space",
        "space":key,
        "controllerId":controller_id(&account, key),
    }))
    .await
    .map(|_| ());
    let folder = root(app, &account, key)?;
    if fs::exists(&folder) {
        if let Err(error) = fs::remove_dir_all(folder) {
            result = result.and(Err(error.to_string()));
        }
    }
    result
}

/// Resets a profile's extension state and returns the account it ran under.
async fn forget_profile(key: &str) -> String {
    let account = {
        let mut state = service(key).lock().await;
        for path in state.prepared.values() {
            let _ = fs::remove_dir_all(path);
        }
        std::mem::take(&mut *state).account
    };
    if let Ok(mut running) = running_profiles().lock() {
        running.remove(key);
    }
    drop_profile_origins(key);
    sync::stop(&account, key);
    account
}
