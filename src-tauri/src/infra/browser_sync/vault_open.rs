//! Opening the vault: setup, connect and unlock, and the session worker they start.
use super::*;

#[tauri::command]
pub fn browser_sync_generate_secret(webview: tauri::Webview) -> Result<String, String> {
    require_main(&webview)?;
    // This secret is shown to the user before setup, so a lost setup response
    // cannot leave them with a vault whose second unlock secret they never saw.
    Ok(generate_sync_secret().to_string())
}

pub(in crate::infra) fn account_api(api_base: &str, account_id: &str) -> Result<SyncApi, String> {
    let url = super::super::account::cookies::server(api_base)?;
    let client = super::super::account::cookies::current(&url)?;
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

async fn open_vault(
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

#[allow(clippy::too_many_arguments)]
pub(super) async fn open_vault_with(
    app: tauri::AppHandle,
    api_base: String,
    account_id: String,
    password: Option<Zeroizing<String>>,
    secret: Option<Zeroizing<String>>,
    provided_root: Option<VaultRoot>,
    remember: bool,
    create: bool,
    reenroll: bool,
) -> Result<SyncView, String> {
    // Re-enrolling registers a new device identity, so it must be authorized by
    // the vault password and sync secret, never by a remembered key alone.
    let reenroll = reenroll && !create;
    if reenroll && (password.is_none() || secret.is_none()) {
        return Err("Enter your sync password and secret to reconnect this device.".into());
    }
    let lifecycle = browser_lifecycle().write().await;
    let api = account_api(&api_base, &account_id)?;
    // Background retries can overlap a manual unlock. Reuse the worker that
    // won that race instead of stopping it and reading the key a second time.
    if !create && password.is_none() && secret.is_none() && provided_root.is_none() {
        let mut current = personal_session().await;
        if current.as_ref().is_some_and(|active| {
            active.scope.deployment == api.deployment()
                && active.scope.account_id == account_id
                && !active.task.is_finished()
        }) {
            // A retry also reopens Space vaults that failed or stopped.
            space_vaults::open_all(app.clone());
            return view(current.as_mut().expect("live session exists")).await;
        }
    }
    stop_all().await;
    let deployment = api.deployment();
    // The personal vault opens first; its root opens every Space vault.
    let known = personal_vault_id(&app, &deployment, &account_id)?;
    let known_path = known
        .as_deref()
        .map(|vault| database_path(&deployment, &account_id, vault))
        .transpose()?;
    let known_lock = known_path.as_deref().map(lock_database).transpose()?;
    let previous = match &known_path {
        Some(path) => Store::read_cached_vault(path, &deployment, &account_id),
        None => Ok(None),
    };
    // A re-enrolling device ignores its rejected local identity and joins the
    // server's current vault as if it were new.
    let (cached, retired_scope) = if reenroll {
        let retired = previous.ok().flatten().map(|vault| VaultScope {
            deployment: deployment.clone(),
            account_id: account_id.clone(),
            vault_id: vault.vault.vault_id,
        });
        (None, retired)
    } else {
        (previous.map_err(issue)?, None)
    };

    // Retrying setup after a lost response reopens the persisted root using the
    // same credentials. It must never generate a replacement root or device.
    let create = create && cached.is_none();
    // Cached vaults can unlock without a network request. Authorization and remote
    // identity are checked when the reconnecting worker obtains a fresh ticket.
    let remote = if cached.is_none() {
        api.vault().await.map_err(issue)?
    } else {
        None
    };
    if create && remote.is_some() {
        return Err("This account already has browser sync. Unlock the existing vault.".into());
    }
    if !create && cached.is_none() && remote.is_none() {
        return Err("Set up browser sync before connecting this device.".into());
    }
    let scope = VaultScope {
        deployment: deployment.clone(),
        account_id,
        vault_id: cached
            .as_ref()
            .map(|v| &v.vault)
            .or(remote.as_ref())
            .map(|w| w.vault_id.clone())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
    };
    scope.validate().map_err(issue)?;
    if profile_selection::selected_for_other_account(&scope)? {
        return Err("Switch the active browser account before opening a different vault.".into());
    }
    let path = database_path(&scope.deployment, &scope.account_id, &scope.vault_id)?;
    let (database_lock, retire) = if known_path.as_ref() == Some(&path) {
        (known_lock.expect("locked with its path"), None)
    } else {
        (lock_database(&path)?, known_path.zip(known_lock))
    };
    let existing_identity = !reenroll
        && Store::belongs_to_account(&path, &scope.deployment, &scope.account_id).map_err(issue)?;
    if create && existing_identity {
        return Err("The server vault is missing, but local encrypted data still exists. Recovery is required.".into());
    }
    let native_scope = scope.clone();
    let (root, store, device, database_lock) = tokio::task::spawn_blocking(move || {
        let database_lock = database_lock;
        let (root, vault) = if create {
            let password = password.ok_or(misty_browser_sync::Error::Invalid)?;
            let secret = secret.ok_or(misty_browser_sync::Error::Invalid)?;
            let root = VaultRoot::generate();
            let wrapper = root.wrap(&native_scope, &password, &secret)?;
            let server = Vault {
                vault_id: native_scope.vault_id.clone(),
                key_epoch: 1,
                head_sequence: 0,
                root_public_key: root.public_key()?,
                key_envelope: Some(wrapper),
                space_key_envelope: None,
            };
            (
                root,
                CachedVault {
                    vault: server,
                    bootstrap_pending: true,
                    enrollment_pending: true,
                },
            )
        } else {
            let vault = match cached.clone() {
                Some(vault) => vault,
                None => CachedVault {
                    vault: remote.ok_or(misty_browser_sync::Error::Recovery)?,
                    bootstrap_pending: false,
                    enrollment_pending: true,
                },
            };
            let server = &vault.vault;
            let root = match (password, secret, provided_root) {
                (Some(password), Some(secret), None) => VaultRoot::unlock(
                    &native_scope,
                    server
                        .key_envelope
                        .as_ref()
                        .ok_or(misty_browser_sync::Error::Identity)?,
                    &password,
                    &secret,
                    &server.root_public_key,
                )?,
                // Sealed to this device by an approving one; it must match the
                // vault the server names before anything is opened with it.
                (None, None, Some(root)) => {
                    if root.public_key()? != server.root_public_key {
                        return Err(misty_browser_sync::Error::Identity);
                    }
                    root
                }
                (None, None, None) => secure_store::recall(&native_scope, &server.root_public_key)?
                    .ok_or(misty_browser_sync::Error::Unlock)?,
                _ => return Err(misty_browser_sync::Error::Invalid),
            };
            // Only retire the old identity once the password has proven access
            // to the server's vault; a typo must leave this device untouched.
            if reenroll {
                if let Some(retired) = &retired_scope {
                    secure_store::forget(retired)?;
                }
                match &retire {
                    Some((old, _lock)) => retire_database(old)?,
                    None => retire_database(&path)?,
                }
            }
            (root, vault)
        };
        let (store, device) = if existing_identity {
            let (mut store, device) = Store::unlock(&path, native_scope.clone(), &root)?;
            store.cache_verified_vault(&root, &vault)?;
            (store, device)
        } else {
            let device = DeviceKey::generate();
            let grant = root.grant(
                &native_scope,
                &uuid::Uuid::new_v4().to_string(),
                vault.vault.key_epoch,
                &device,
            )?;
            let store = Store::initialize_vault(
                &path,
                native_scope.clone(),
                grant,
                &root,
                &device,
                &Document::default().encode()?,
                Some(&vault),
            )?;
            (store, device)
        };
        store.pending_snapshot(&root, document::reduce)?;
        if remember {
            secure_store::remember(&native_scope, &root)?;
        }
        Ok::<_, misty_browser_sync::Error>((root, store, device, database_lock))
    })
    .await
    .map_err(|_| "Could not unlock the native sync vault")?
    .map_err(issue)?;
    remember_personal_vault(&scope.deployment, &scope.account_id, &scope.vault_id)?;
    profile_selection::remember_personal_vault(&scope.vault_id)?;
    let slot = session_start::start_session(
        &app,
        session_start::Opened {
            scope,
            api,
            root,
            device,
            store,
            database_lock,
            space_id: None,
        },
    )
    .await?;
    drop(lifecycle);
    // Every Space vault opens with the personal root, after the personal
    // vault is usable; one failing never closes the others.
    space_vaults::open_all(app.clone());
    let _ = crate::infra::space_windows::emit(&app, "misty:browser-sync-changed", "");
    let mut current = slot.lock_owned().await;
    view(current.as_mut().ok_or("The sync session closed.")?).await
}
