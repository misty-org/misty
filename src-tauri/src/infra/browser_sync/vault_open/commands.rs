//! Setting up and connecting the account's sync, and opening a vault for it.
use super::*;

pub(in crate::infra) fn account_api(api_base: &str, account_id: &str) -> Result<SyncApi, String> {
    let url = super::super::super::account::cookies::server(api_base)?;
    let client = super::super::super::account::cookies::current(&url)?;
    client.require_account(&url, account_id)?;
    let refresh_client = client.clone();
    let refresh_url = url.clone();
    let refresh_lock = client.refresh_lock.clone();
    SyncApi::new(api_base, client.http.clone())
        .map(|api| {
            api.with_refresh_lock(refresh_lock)
                .with_refresh_hook(move || {
                    refresh_client
                        .persist(&refresh_url)
                        .map(|_| ())
                        .map_err(|_| misty_browser_sync::Error::SecureStorage)
                })
        })
        .map_err(issue)
}

/// Creates the account's vault, sealed under the Misty password. The password is
/// one the server has not seen in plain form (see `account_credentials`).
#[tauri::command]
pub async fn browser_sync_setup(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    api_base: String,
    account_id: String,
    email: String,
    password: String,
    remember: bool,
) -> Result<SyncView, String> {
    let password = Zeroizing::new(password);
    require_main(&webview)?;
    if let Some(issue) = misty_browser_sync::password::check(&password, &email).err() {
        return Err(issue.message().into());
    }
    open_vault(
        app,
        api_base,
        account_id,
        Some(email),
        Some(password),
        None,
        remember,
        true,
        false,
    )
    .await
}

/// Unlocks the vault. A vault sealed under the Misty password needs `email` and
/// `password`; one made before that (a sync password and a sync secret) also
/// needs `sync_secret`, and stays that way until it is moved to the account
/// password with `browser_sync_use_account_password`.
#[tauri::command]
pub async fn browser_sync_connect(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    api_base: String,
    account_id: String,
    email: Option<String>,
    password: Option<String>,
    sync_secret: Option<String>,
    remember: bool,
    reenroll: Option<bool>,
) -> Result<SyncView, String> {
    let password = password.map(Zeroizing::new);
    let secret = sync_secret.map(Zeroizing::new);
    require_main(&webview)?;
    open_vault(
        app,
        api_base,
        account_id,
        email,
        password,
        secret,
        remember,
        false,
        reenroll.unwrap_or(false),
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn open_vault(
    app: tauri::AppHandle,
    api_base: String,
    account_id: String,
    email: Option<String>,
    password: Option<Zeroizing<String>>,
    secret: Option<Zeroizing<String>>,
    remember: bool,
    create: bool,
    reenroll: bool,
) -> Result<SyncView, String> {
    open_vault_with(
        app, api_base, account_id, email, password, secret, None, remember, create, reenroll,
    )
    .await
}
