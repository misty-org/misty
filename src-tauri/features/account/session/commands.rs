use super::{
    activate, credential_io, current, has_active_account, install, key, restore_preserves_scope,
    server, set_account, AccountClient,
};
use crate::browser::profiles;
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tauri::Manager;

const ROOM_TOKEN_LASTING: Duration = Duration::from_secs(60);
const SIGNED_OUT: &str = "signed_out";

#[tauri::command]
pub async fn auth_room_token(
    webview: tauri::Webview,
    api_base: String,
    fresh: Option<bool>,
) -> Result<String, String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Only the trusted Misty shell can open a live room.".into());
    }
    let url = server(&api_base)?;
    let client = current(&url)?;
    if !fresh.unwrap_or(false) {
        if let Some(token) = client.access_token(&url, ROOM_TOKEN_LASTING) {
            return Ok(token);
        }
    }
    let used = client.access_header();
    let answer = client
        .rotate(super::refresh::refresh_endpoint(&url), used)
        .await?;
    if answer.ended {
        crate::account::http::session_ended(webview.app_handle(), &url).await?;
        return Err(SIGNED_OUT.into());
    }
    if !(200..300).contains(&answer.status) {
        return Err("Could not refresh the Misty session".into());
    }
    client
        .access_token(&url, Duration::ZERO)
        .ok_or_else(|| SIGNED_OUT.into())
}

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
            if has_active_account(&url, account_id.as_deref()) {
                set_account(&url, account_id.as_deref());
                return Ok(true);
            }
            install(&url, AccountClient::new()?)?;
            let Some(account_id) = account_id.as_deref().filter(|id| !id.is_empty()) else {
                set_account(&url, None);
                return Ok(false);
            };
            let value =
                credential_io(|| misty_credential_store::account::load(&key(&url, account_id)))?;
            set_account(&url, Some(account_id));
            let Some(value) = value else {
                return Ok(false);
            };
            let value = zeroize::Zeroizing::new(value);
            let Some(client) = AccountClient::restore(&url, account_id, &value)? else {
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
            let client = current(&url)?;
            if client.require_account(&url, &account_id).is_ok() {
                client.clear()?;
            }
            if active.load(Ordering::Relaxed) {
                set_account(&url, None);
            }
            Ok(())
        },
    )
    .await
}
