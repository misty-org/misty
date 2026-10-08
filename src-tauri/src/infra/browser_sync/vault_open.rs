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
    let url = super::super::auth_cookies::server(api_base)?;
    let client = super::super::auth_cookies::current(&url)?;
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
    let _lifecycle = browser_lifecycle().write().await;
    let mut current = session().lock().await;
    let api = account_api(&api_base, &account_id)?;
    // Background retries can overlap a manual unlock. Reuse the worker that
    // won that race instead of stopping it and reading the key a second time.
    if !create
        && password.is_none()
        && secret.is_none()
        && provided_root.is_none()
        && current.as_ref().is_some_and(|active| {
            active.scope.deployment == api.deployment()
                && active.scope.account_id == account_id
                && !active.task.is_finished()
        })
    {
        return view(current.as_mut().expect("live session exists")).await;
    }
    stop(current.take()).await;
    let path = database_path(&app, &api.deployment(), &account_id)?;
    let database_lock = lock_database(&path)?;
    let previous = Store::read_cached_vault(&path, &api.deployment(), &account_id);
    // A re-enrolling device ignores its rejected local identity and joins the
    // server's current vault as if it were new.
    let (cached, retired_scope) = if reenroll {
        let retired = previous.ok().flatten().map(|vault| VaultScope {
            deployment: api.deployment(),
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
        deployment: api.deployment(),
        account_id,
        vault_id: cached
            .as_ref()
            .map(|v| &v.vault)
            .or(remote.as_ref())
            .map(|w| w.vault_id.clone())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
    };
    scope.validate().map_err(issue)?;
    let logical = default_profile_id(&scope)?;
    if selected_profile()
        .lock()
        .map_err(|_| "Browser profile state is unavailable")?
        .as_ref()
        .is_some_and(|selected| selected.logical != logical)
    {
        return Err("Switch the active browser account before opening a different vault.".into());
    }
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
                key_envelope: wrapper,
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
                    &server.key_envelope,
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
                retire_database(&path)?;
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
    let pending = store
        .pending_snapshot(&root, document::reduce)
        .map_err(issue)?;
    let document: Document = serde_json::from_slice(&pending.snapshot)
        .map_err(|_| "Could not read the local workspace")?;
    let mut cached_workspace = document.workspace_view().map_err(issue)?;
    let committed: Document =
        serde_json::from_slice(&store.committed_snapshot(&root).map_err(issue)?)
            .map_err(|_| "Could not read the active device")?;
    cached_workspace.active_device = committed.active_device;
    cached_workspace.sequence = pending.committed_sequence;
    let device_id = store.grant().device_id.clone();
    let admission_root = root.duplicate();
    let (worker, handle) = Worker::new(
        api.clone(),
        scope.clone(),
        root,
        device,
        store,
        document::reduce,
    )
    .map_err(issue)?;
    let advertise_api = api.clone();
    let advertise_device = device_id.clone();
    let advertise_os = tokio::task::spawn_blocking(os_version)
        .await
        .unwrap_or_default();
    let advertise_status = handle.status.clone();
    let task = tokio::spawn(worker.run());
    let mut status = handle.status.clone();
    let mut presence = handle.presence.clone();
    let mut devices = handle.devices.clone();
    let mut workspace_changes = handle.workspaces.clone();
    let notify_workspace = scope.vault_id.clone();
    let notify_app = app.clone();
    // The sync socket already carries this account's content-free invalidations.
    // The main window uses them instead of opening its own event stream while
    // this connection is up (see `browser_sync_account_feed`).
    let mut account_events = handle.account_events();
    let feed_account = scope.account_id.clone();
    let notifications = tokio::spawn(async move {
        let advertisement = control_advertisement::advertise(
            advertise_status,
            || advertise_api.advertise_controls(&advertise_device, &advertise_os),
            std::time::Duration::from_secs(30),
        );
        tokio::pin!(advertisement);
        let mut advertised = false;
        loop {
            let alive = tokio::select! {
                _ = &mut advertisement, if !advertised => { advertised = true; continue; },
                result = status.changed() => result.is_ok(),
                result = presence.changed() => result.is_ok(),
                result = devices.changed() => result.is_ok(),
                result = workspace_changes.changed() => result.is_ok(),
                event = account_events.recv() => {
                    let (topic, id) = match event {
                        Ok(event) => (event.topic, event.id),
                        // Dropped invalidations: the page re-reads everything.
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => ("reset".to_owned(), None),
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    };
                    let _ = crate::infra::space_windows::emit(&notify_app,
                        "misty:account-event",
                        serde_json::json!({ "accountId": feed_account, "topic": topic, "id": id }),
                    );
                    continue;
                },
            };
            if !alive {
                break;
            }
            let _ = crate::infra::space_windows::emit(&notify_app, "misty:browser-sync-changed", &notify_workspace);
        }
    });
    let session_id = uuid::Uuid::new_v4().to_string();
    #[cfg(any(target_os = "macos", windows))]
    let credential_task = Some(capture::spawn(app.clone(), session_id.clone()));
    #[cfg(not(any(target_os = "macos", windows)))]
    let credential_task = None;
    let history_task = Some(history::spawn(app.clone(), session_id.clone()));
    *current = Some(Session {
        id: session_id,
        _database_lock: database_lock,
        cached_workspace,
        cached_pending: pending.operation_ids,
        workspace_projection: Default::default(),
        scope,
        device_id,
        api,
        handle,
        task,
        notifications,
        credential_task,
        history_task,
        credential_issue: None,
        website_data: Default::default(),
        device_browser: None,
        baselines: Default::default(),
        held: Default::default(),
        #[cfg(any(target_os = "macos", windows))]
        capture_view: None,
        admission_root,
    });
    let _ = crate::infra::space_windows::emit(&app, "misty:browser-sync-changed", "");
    view(current.as_mut().expect("session was installed")).await
}
