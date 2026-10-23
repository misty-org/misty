//! The Misty password never reaches the server. The app derives two unrelated
//! values from it on this device (`AccountKeys`): a login credential, which is
//! sent where the password used to go, and a vault wrapping key, which stays
//! here and opens the sync vault. These commands expose the credential and the
//! password rules, and re-seal an unlocked vault under a new password.
use super::*;
use misty_browser_sync::{crypto::AccountKeys, password};

fn require_app(webview: &tauri::Webview) -> Result<(), String> {
    if crate::infra::space_windows::is_app_window(webview.label()) {
        Ok(())
    } else {
        Err("Account sign-in is available only in Misty's own windows".into())
    }
}

async fn derive(
    deployment: String,
    email: String,
    password: Zeroizing<String>,
) -> Result<AccountKeys, String> {
    tokio::task::spawn_blocking(move || AccountKeys::derive(&deployment, &email, &password))
        .await
        .map_err(|_| "Could not prepare your password.".to_owned())?
        .map_err(|_| "Check your email and password.".to_owned())
}

/// The value sent to the server in place of the password: 43 characters that
/// reveal nothing the wrapping key could be derived from.
#[tauri::command]
pub async fn account_login_credential(
    webview: tauri::Webview,
    deployment: String,
    email: String,
    password: String,
) -> Result<String, String> {
    require_app(&webview)?;
    let keys = derive(deployment, email, Zeroizing::new(password)).await?;
    Ok(keys.login_credential().to_owned())
}

/// Why a new password is not acceptable, in words for the person; None when it is.
#[tauri::command]
pub fn account_check_password(
    webview: tauri::Webview,
    email: String,
    password: String,
) -> Result<Option<String>, String> {
    require_app(&webview)?;
    let password = Zeroizing::new(password);
    Ok(password::check(&password, &email)
        .err()
        .map(|issue| issue.message().to_owned()))
}

/// Re-seals the open personal vault under the account password, replacing a
/// sync password and secret or an older account password. The new wrapper goes
/// to the server with a transition signed by the vault root; other devices
/// accept it only for the next generation, and sign in with the new password.
///
/// The caller must only pass a password the server has never seen in plain
/// form: one set through the app, which sends the server a derived credential.
#[tauri::command]
pub async fn browser_sync_use_account_password(
    webview: tauri::Webview,
    api_base: String,
    account_id: String,
    email: String,
    password: String,
) -> Result<(), String> {
    require_main(&webview)?;
    let password = Zeroizing::new(password);
    if let Some(message) = password::check(&password, &email)
        .err()
        .map(|issue| issue.message())
    {
        return Err(message.into());
    }
    let api = account_api(&api_base, &account_id)?;
    let keys = derive(api.deployment(), email, password).await?;
    let session = personal_session().await;
    let session = session
        .as_ref()
        .ok_or("Unlock sync on this device first.")?;
    if session.scope.account_id != account_id || session.scope.deployment != api.deployment() {
        return Err("Your account changed. Reopen sync.".into());
    }
    let remote = api
        .vault()
        .await
        .map_err(issue)?
        .ok_or("This account has no sync vault.")?;
    if remote.vault_id != session.scope.vault_id {
        return Err("Your account changed. Reopen sync.".into());
    }
    // The next generation follows the server's, and must stay within what a counter can hold.
    let generation = remote
        .key_generation()
        .checked_add(1)
        .ok_or("This vault's password cannot be changed again.")?;
    let wrapper = session
        .admission_root
        .wrap_account(&session.scope, &keys)
        .map_err(issue)?;
    let transition = session
        .admission_root
        .sign_key_transition(&session.scope, generation, &wrapper)
        .map_err(issue)?;
    api.rotate_key(&wrapper, &transition).await.map_err(issue)?;
    Ok(())
}
