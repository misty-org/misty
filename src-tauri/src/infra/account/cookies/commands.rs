//! The cookie commands the sign-in flow calls: capture, restore and forget.
use super::{
    activate, credential_io, current, has_active_account, key, restore_preserves_scope, server,
    AccountClient,
};

#[tauri::command]
pub async fn auth_cookie_capture(
    api_base: String,
    account_id: Option<String>,
) -> Result<String, String> {
    let url = server(&api_base)?;
    let client = current(&url)?;
    let saved = client
        .snapshot(&url)?
        .ok_or("Misty session cookies are unavailable. Sign in again.")?;
    if account_id
        .as_deref()
        .is_some_and(|expected| expected != saved.account_id)
    {
        return Err("Session account changed during sign-in".into());
    }
    client.persist(&url)?;
    Ok(saved.account_id)
}

#[tauri::command]
pub async fn auth_cookie_restore(
    app: tauri::AppHandle,
    api_base: String,
    account_id: Option<String>,
) -> Result<bool, String> {
    let url = server(&api_base)?;
    crate::infra::browser_sync::change_account_if(
        Some(&app),
        |scope| !restore_preserves_scope(&url, account_id.as_deref(), scope),
        || {
            // Additional renderers restore the same account at startup. Keep
            // its current jar/refresh lock and native task leases intact. This
            // check and the account-change decision share the lifecycle barrier.
            if has_active_account(&url, account_id.as_deref()) {
                return Ok(true);
            }
            activate(&url, AccountClient::new()?)?;
            let Some(account_id) = account_id.as_deref().filter(|id| !id.is_empty()) else {
                return Ok(false);
            };
            let Some(value) =
                credential_io(|| misty_credential_store::account::load(&key(&url, &account_id)))?
            else {
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
pub async fn auth_cookie_forget(
    app: tauri::AppHandle,
    api_base: String,
    account_id: String,
) -> Result<(), String> {
    let url = server(&api_base)?;
    crate::infra::browser_sync::change_account_if(
        Some(&app),
        |scope| {
            scope.is_some_and(|scope| {
                scope.account_id == account_id
                    && scope.deployment == url.as_str().trim_end_matches('/')
            }) || current(&url)
                .is_ok_and(|client| client.require_account(&url, &account_id).is_ok())
        },
        || credential_io(|| misty_credential_store::account::delete(&key(&url, &account_id))),
    )
    .await
}
