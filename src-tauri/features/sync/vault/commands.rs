//! What Settings › Sync and the first-run offer ask of the vault.
use super::*;
use browser_data::{vault::keys, Error};
use zeroize::Zeroizing;

const WRONG_PASSWORD: &str = "That password didn't work.";
const NOT_REACHABLE: &str = "Couldn't reach the server. Check your connection and try again.";
const NOT_OPEN: &str = "The vault isn't open on this computer.";

fn only_person(webview: &tauri::Webview) -> Result<(), String> {
    if crate::browser::app_windows::is_person_window(webview.window().label()) {
        Ok(())
    } else {
        Err("Sync is only available in a normal window.".into())
    }
}

fn signed_in() -> Result<String, String> {
    let scope = crate::browser::app_windows::current_scope();
    if scope == crate::browser::app_windows::LOCAL_SCOPE {
        return Err("Sign in to use sync.".into());
    }
    Ok(scope)
}

fn server_error(error: Error) -> String {
    match error {
        Error::Authentication => "Sign in again to use sync.".into(),
        Error::Unlock => WRONG_PASSWORD.into(),
        _ => NOT_REACHABLE.into(),
    }
}

/// Where sync stands. `api_base` lets it ask the server when no vault is open here.
#[tauri::command]
pub async fn vault_state(webview: tauri::Webview, api_base: String) -> Result<VaultState, String> {
    only_person(&webview)?;
    if let Some(active) = ACTIVE.lock().await.as_ref() {
        if let Some(link) = &active.link {
            return Ok(VaultState::On {
                vault_id: active.vault_id.clone(),
                session_id: active.session_id.clone(),
                status: link.status.borrow().clone(),
            });
        }
    }
    let (vault_id, paused, asked) = with_store(|store| {
        Ok((
            store.meta(META_VAULT)?,
            store.meta(META_PAUSED)?.is_some(),
            store.meta(META_ASKED)?.is_some(),
        ))
    })?;
    if let (Some(vault_id), true) = (vault_id, paused) {
        return Ok(VaultState::Paused { vault_id });
    }
    let exists = if crate::browser::app_windows::current_scope()
        == crate::browser::app_windows::LOCAL_SCOPE
    {
        Some(false)
    } else {
        match account_api(&api_base)?.server_vault().await {
            Ok(vault) => Some(vault.is_some()),
            Err(_) => None,
        }
    };
    let notice = NOTICE.lock().ok().and_then(|notice| *notice);
    Ok(VaultState::Off {
        exists,
        asked,
        notice,
    })
}

/// Picks the link back up at launch, if this computer already has the vault open.
#[tauri::command]
pub async fn vault_resume(
    webview: tauri::Webview,
    app: AppHandle,
    api_base: String,
) -> Result<(), String> {
    only_person(&webview)?;
    resume(&app, &api_base).await
}

/// Creates the account's vault, with a password only its clients ever know.
#[tauri::command]
pub async fn vault_create(
    webview: tauri::Webview,
    app: AppHandle,
    api_base: String,
    password: String,
) -> Result<(), String> {
    only_person(&webview)?;
    let scope = signed_in()?;
    let password = Zeroizing::new(password);
    if let Err(problem) = browser_data::password::check(&password) {
        return Err(problem.message().into());
    }
    let api = account_api(&api_base)?;
    let vault_id = uuid::Uuid::new_v4().to_string();
    let sealing_id = vault_id.clone();
    let (root, envelope) = tokio::task::spawn_blocking(move || {
        let root = VaultRoot::generate();
        let envelope = keys::seal_root(&root, &sealing_id, &password)?;
        Ok::<_, Error>((root, envelope))
    })
    .await
    .map_err(|_| "The vault couldn't be created.")?
    .map_err(|_| "The vault couldn't be created.")?;
    // A vault from before, gone or not: everything here uploads to this one from the start.
    shut_down(ACTIVE.lock().await.take()).await;
    let (session_id, key) = with_store(|store| {
        store.unlink()?;
        session_identity(store)
    })?;
    match api
        .create_server_vault(
            &root,
            &vault_id,
            &envelope,
            &session_id,
            &key,
            &session_info(),
        )
        .await
    {
        Ok(()) => {}
        // Another signed-in session got there first. Its vault is the account's vault now.
        Err(Error::Recovery) => {
            return Err("This account already has a vault. Enter its password instead.".into())
        }
        Err(error) => return Err(server_error(error)),
    }
    open_here(&app, &api_base, &scope, root, vault_id).await
}

/// Saves that the vault is open here, and starts syncing. The key goes to the OS-protected store
/// before anything else, so a crash can't leave the vault open with nothing to reopen it.
async fn open_here(
    app: &AppHandle,
    api_base: &str,
    scope: &str,
    root: VaultRoot,
    vault_id: String,
) -> Result<(), String> {
    let identity = key_identity(scope);
    let remembered = root.duplicate();
    tokio::task::spawn_blocking(move || secure_store::remember_vault_root(&identity, &remembered))
        .await
        .map_err(|_| "This computer's key storage is unavailable.")?
        .map_err(|_| "This computer's key storage is unavailable.")?;
    with_store(|store| {
        store.set_meta(META_VAULT, &vault_id)?;
        store.set_meta(META_ASKED, "1")
    })?;
    if let Ok(mut notice) = NOTICE.lock() {
        *notice = None;
    }
    start(app, api_base, root, vault_id).await
}

/// Opens the account's vault on this computer with its password. Asked once per computer.
#[tauri::command]
pub async fn vault_unlock(
    webview: tauri::Webview,
    app: AppHandle,
    api_base: String,
    password: String,
) -> Result<(), String> {
    only_person(&webview)?;
    let scope = signed_in()?;
    let password = Zeroizing::new(password);
    let api = account_api(&api_base)?;
    let vault = api
        .server_vault()
        .await
        .map_err(server_error)?
        .ok_or("This account has no vault yet.")?;
    let (envelope, vault_id, public) = (
        vault.key_envelope.clone(),
        vault.vault_id.clone(),
        vault.root_public_key.clone(),
    );
    let root = tokio::task::spawn_blocking(move || {
        keys::open_root(&envelope, &vault_id, &password, &public)
    })
    .await
    .map_err(|_| WRONG_PASSWORD)?
    .map_err(|error| match error {
        Error::Unlock => WRONG_PASSWORD.to_owned(),
        _ => "This vault couldn't be opened.".to_owned(),
    })?;
    let stored_vault = with_store(|store| store.meta(META_VAULT))?;
    if stored_vault.as_deref() != Some(vault.vault_id.as_str()) {
        // This computer joins with what it has: everything local uploads, and merges.
        with_store(|store| store.unlink())?;
    }
    let (session_id, key) = with_store(|store| session_identity(store))?;
    api.enroll_session(&root, &vault.vault_id, &session_id, &key, &session_info())
        .await
        .map_err(server_error)?;
    open_here(&app, &api_base, &scope, root, vault.vault_id).await
}

/// Stops sync on this computer. Local changes keep being saved and merge on Start.
#[tauri::command]
pub async fn vault_pause(webview: tauri::Webview, app: AppHandle) -> Result<(), String> {
    only_person(&webview)?;
    let active = ACTIVE.lock().await.take();
    if active.is_none() {
        return Err(NOT_OPEN.into());
    }
    with_store(|store| store.set_meta(META_PAUSED, "1"))?;
    shut_down(active).await;
    announce_status(&app);
    Ok(())
}

/// Starts sync again on this computer, after a pause.
#[tauri::command]
pub async fn vault_start(
    webview: tauri::Webview,
    app: AppHandle,
    api_base: String,
) -> Result<(), String> {
    only_person(&webview)?;
    with_store(|store| store.delete_meta(META_PAUSED))?;
    resume(&app, &api_base).await?;
    announce_status(&app);
    Ok(())
}

/// The person answered the offer to create a vault with Not now. Misty doesn't ask again.
#[tauri::command]
pub fn vault_decline(webview: tauri::Webview, app: AppHandle) -> Result<(), String> {
    only_person(&webview)?;
    with_store(|store| store.set_meta(META_ASKED, "1"))?;
    announce_status(&app);
    Ok(())
}

/// Sets a new vault password, from a computer with the vault open. Other sessions keep working;
/// anyone joining from now on uses the new one.
#[tauri::command]
pub async fn vault_change_password(
    webview: tauri::Webview,
    api_base: String,
    password: String,
) -> Result<(), String> {
    only_person(&webview)?;
    let password = Zeroizing::new(password);
    if let Err(problem) = browser_data::password::check(&password) {
        return Err(problem.message().into());
    }
    let identity = key_identity(&signed_in()?);
    let api = account_api(&api_base)?;
    let vault = api
        .server_vault()
        .await
        .map_err(server_error)?
        .ok_or("This account has no vault yet.")?;
    let root = {
        let identity = identity.clone();
        tokio::task::spawn_blocking(move || secure_store::recall_vault_root(&identity))
            .await
            .map_err(|_| NOT_OPEN)?
            .map_err(|_| NOT_OPEN)?
            .ok_or(NOT_OPEN)?
    };
    if keys::public_key(&root).ok().as_deref() != Some(vault.root_public_key.as_slice()) {
        return Err(NOT_OPEN.into());
    }
    let sealing = root.duplicate();
    let vault_id = vault.vault_id.clone();
    let envelope =
        tokio::task::spawn_blocking(move || keys::seal_root(&sealing, &vault_id, &password))
            .await
            .map_err(|_| "The password couldn't be changed.")?
            .map_err(|_| "The password couldn't be changed.")?;
    api.replace_sealed_root(&root, &vault, &envelope)
        .await
        .map_err(server_error)
}

/// How someone proves they mean to destroy the vault.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DestroyProof {
    /// The vault password. It opens the sealed root, which signs the request.
    vault_password: Option<String>,
    /// For someone who has lost the vault password: their account password. An account with none
    /// signs in again first.
    account_password: Option<String>,
}

/// Permanently deletes the vault from the server and stops sync everywhere. Every computer keeps
/// what it has, as local data.
#[tauri::command]
pub async fn vault_destroy(
    webview: tauri::Webview,
    app: AppHandle,
    api_base: String,
    proof: DestroyProof,
) -> Result<(), String> {
    only_person(&webview)?;
    let scope = signed_in()?;
    let api = account_api(&api_base)?;
    let result = if let Some(password) = proof.vault_password.map(Zeroizing::new) {
        let vault = api
            .server_vault()
            .await
            .map_err(server_error)?
            .ok_or("This account has no vault.")?;
        let (envelope, vault_id, public) = (
            vault.key_envelope.clone(),
            vault.vault_id.clone(),
            vault.root_public_key.clone(),
        );
        let root = tokio::task::spawn_blocking(move || {
            keys::open_root(&envelope, &vault_id, &password, &public)
        })
        .await
        .map_err(|_| WRONG_PASSWORD)?
        .map_err(|_| WRONG_PASSWORD)?;
        api.destroy_vault_with_root(&root, &vault.vault_id).await
    } else {
        api.destroy_vault_with_password(proof.account_password.as_deref().unwrap_or_default())
            .await
    };
    result.map_err(server_error)?;
    shut_down(ACTIVE.lock().await.take()).await;
    let identity = key_identity(&scope);
    let _ = tokio::task::spawn_blocking(move || secure_store::forget_vault_root(&identity)).await;
    with_store(|store| store.unlink())?;
    announce_status(&app);
    Ok(())
}

/// Forgets the vault key on this computer when its account signs out. Local browsing data stays.
pub(crate) async fn forget_on_sign_out(scope: &str) {
    let mut active = ACTIVE.lock().await;
    if active.as_ref().is_some_and(|active| active.scope == scope) {
        shut_down(active.take()).await;
    }
    drop(active);
    let identity = key_identity(scope);
    let _ = tokio::task::spawn_blocking(move || secure_store::forget_vault_root(&identity)).await;
}

#[tauri::command]
pub async fn vault_sessions(
    webview: tauri::Webview,
    api_base: String,
) -> Result<Vec<browser_data::vault::client::ServerSession>, String> {
    only_person(&webview)?;
    account_api(&api_base)?
        .sessions()
        .await
        .map_err(server_error)
}

#[tauri::command]
pub async fn vault_rename_session(
    webview: tauri::Webview,
    app: AppHandle,
    api_base: String,
    session_id: String,
    name: String,
) -> Result<(), String> {
    only_person(&webview)?;
    let name: String = name.trim().chars().take(60).collect();
    if name.is_empty() {
        return Err("Use a name of 1 to 60 characters.".into());
    }
    account_api(&api_base)?
        .rename_session(&session_id, &name)
        .await
        .map_err(server_error)?;
    announce_status(&app);
    Ok(())
}

/// Removes a signed-in session for good. It stops at once and can't come back as itself.
#[tauri::command]
pub async fn vault_remove_session(
    webview: tauri::Webview,
    app: AppHandle,
    api_base: String,
    session_id: String,
) -> Result<(), String> {
    only_person(&webview)?;
    let (root, vault_id) = {
        let active = ACTIVE.lock().await;
        let active = active.as_ref().ok_or(NOT_OPEN)?;
        (active.root.duplicate(), active.vault_id.clone())
    };
    account_api(&api_base)?
        .remove_session(&root, &vault_id, &session_id)
        .await
        .map_err(server_error)?;
    announce_status(&app);
    Ok(())
}
