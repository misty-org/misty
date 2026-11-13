//! The session commands the sign-in flow calls: capture, restore and forget.
use super::{
    activate, credential_io, current, has_active_account, install, key, restore_preserves_scope,
    server, set_account, AccountClient,
};
use crate::browser::profiles;
use std::sync::atomic::{AtomicBool, Ordering};

#[tauri::command]
pub async fn auth_session_capture(
    api_base: String,
    account_id: Option<String>,
) -> Result<String, String> {
    let url = server(&api_base)?;
    let client = current(&url)?;
    let saved = client
        .snapshot(&url)?
        .ok_or("The Misty session is unavailable. Sign in again.")?;
    if account_id
        .as_deref()
        .is_some_and(|expected| expected != saved.account_id)
    {
        return Err("Session account changed during sign-in".into());
    }
    client.persist(&url)?;
    Ok(saved.account_id.clone())
}

#[tauri::command]
pub async fn auth_session_restore(
    app: tauri::AppHandle,
    api_base: String,
    account_id: Option<String>,
) -> Result<bool, String> {
    let url = server(&api_base)?;
    profiles::change_account_if(
        Some(&app),
        |scope| !restore_preserves_scope(&url, account_id.as_deref(), scope),
        || {
            // Additional renderers restore the same account at startup. Keep
            // its current client, refresh lock and native task leases intact. This
            // check and the account-change decision share the lifecycle barrier.
            if has_active_account(&url, account_id.as_deref()) {
                set_account(&url, account_id.as_deref());
                return Ok(true);
            }
            install(&url, AccountClient::new()?)?;
            let Some(account_id) = account_id.as_deref().filter(|id| !id.is_empty()) else {
                set_account(&url, None);
                return Ok(false);
            };
            // Whether or not its session is still good, the windows are this account's: one
            // whose session expired keeps its profiles while it waits to sign in again. A
            // credential read that failed changes nothing.
            let value =
                credential_io(|| misty_credential_store::account::load(&key(&url, &account_id)))?;
            set_account(&url, Some(account_id));
            let Some(value) = value else {
                return Ok(false);
            };
            let value = zeroize::Zeroizing::new(value);
            let Some(client) = AccountClient::restore(&url, &account_id, &value)? else {
                return Ok(false);
            };
            activate(&url, client)?;
            Ok(true)
        },
    )
    .await
}
#[tauri::command]
pub async fn auth_session_forget(
    app: tauri::AppHandle,
    api_base: String,
    account_id: String,
) -> Result<(), String> {
    let url = server(&api_base)?;
    let active = AtomicBool::new(false);
    profiles::change_account_if(
        Some(&app),
        |scope| {
            let is_active = scope == profiles::account_scope(&url, Some(&account_id))
                || current(&url)
                    .is_ok_and(|client| client.require_account(&url, &account_id).is_ok());
            active.store(is_active, Ordering::Relaxed);
            is_active
        },
        || {
            credential_io(|| misty_credential_store::account::delete(&key(&url, &account_id)))?;
            // Its tokens go too, even if the server couldn't be told, so a later refresh can't
            // save the session again.
            let client = current(&url)?;
            if client.require_account(&url, &account_id).is_ok() {
                client.clear()?;
            }
            // Forgetting the account in use signs out: the windows are nobody's now.
            if active.load(Ordering::Relaxed) {
                set_account(&url, None);
            }
            Ok(())
        },
    )
    .await
}
