//! Setting up and connecting the account's sync, and opening a vault for it.
use super::*;

#[tauri::command]
pub fn browser_sync_generate_secret(webview: tauri::Webview) -> Result<String, String> {
    require_main(&webview)?;
    // This secret is shown to the user before setup, so a lost setup response
    // cannot leave them with a vault whose second unlock secret they never saw.
    Ok(generate_sync_secret().to_string())
}

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

#[tauri::command]
pub async fn browser_sync_setup(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    api_base: String,
    account_id: String,
    password: String,
    sync_secret: String,
    remember: bool,
) -> Result<SyncView, String> {
    let password = Zeroizing::new(password);
    let secret = Zeroizing::new(sync_secret);
    require_main(&webview)?;
    open_vault(
        app,
        api_base,
        account_id,
        Some(password),
        Some(secret),
        remember,
        true,
        false,
    )
    .await
}

#[tauri::command]
pub async fn browser_sync_connect(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    api_base: String,
    account_id: String,
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
        password,
        secret,
        remember,
        false,
        reenroll.unwrap_or(false),
    )
    .await
}

pub(super) async fn open_vault(
    app: tauri::AppHandle,
    api_base: String,
    account_id: String,
    password: Option<Zeroizing<String>>,
    secret: Option<Zeroizing<String>>,
    remember: bool,
    create: bool,
    reenroll: bool,
) -> Result<SyncView, String> {
    open_vault_with(
        app, api_base, account_id, password, secret, None, remember, create, reenroll,
    )
    .await
}
