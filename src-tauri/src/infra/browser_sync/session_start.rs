//! Starting one vault's session: its worker, the task that forwards its
//! changes to the renderer, and its sign-in capture and history loops.
use super::*;

/// An unlocked vault, ready for its worker.
pub(super) struct Opened {
    pub scope: VaultScope,
    pub api: SyncApi,
    pub root: VaultRoot,
    pub device: DeviceKey,
    pub store: Store,
    pub database_lock: std::fs::File,
    /// The Space this vault belongs to; None for the personal vault.
    pub space_id: Option<String>,
}

/// Starts the vault's worker and registers its session. The personal vault
/// also advertises device controls and forwards the account's events; a
/// Space vault starts dormant until a window shows it.
pub(super) async fn start_session(app: &tauri::AppHandle, opened: Opened) -> Result<Slot, String> {
    let Opened {
        scope,
        api,
        root,
        device,
        store,
        database_lock,
        space_id,
    } = opened;
    let personal = space_id.is_none();
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
    let device_key = device.clone();
    let (worker, handle) = Worker::new(
        api.clone(),
        scope.clone(),
        root,
        device,
        store,
        document::reduce,
    )
    .map_err(issue)?;
    if !personal {
        handle.set_live(false);
    }
    let task = tokio::spawn(worker.run());
    let notifications = notifications(app, &api, &scope, &device_id, &handle, personal).await;
    let session_id = uuid::Uuid::new_v4().to_string();
    let slot = install(
        Session {
            id: session_id.clone(),
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
            credential_task: None,
            history_task: None,
            credential_issue: None,
            website_data: Default::default(),
            device_browser: None,
            baselines: Default::default(),
            held: Default::default(),
            #[cfg(any(target_os = "macos", windows))]
            capture_view: None,
            admission_root,
            device_key,
            space_id,
        },
        personal,
    )?;
    // Each vault captures and restores sign-ins in its own store.
    #[cfg(any(target_os = "macos", windows))]
    let credential_task = Some(capture::spawn(
        app.clone(),
        slot.clone(),
        session_id.clone(),
    ));
    #[cfg(not(any(target_os = "macos", windows)))]
    let credential_task = None;
    let history_task = Some(history::spawn(app.clone(), slot.clone(), session_id));
    if let Some(active) = slot.lock().await.as_mut() {
        active.credential_task = credential_task;
        active.history_task = history_task;
        // The sites this Space claims for links from other apps.
        space_sites::watch(active.handle.clone(), active.space_id.clone());
    }
    Ok(slot)
}

/// Forwards the vault's status changes to the renderer. The personal vault's
/// socket also carries the account's content-free invalidations, which the
/// main window uses instead of opening its own event stream while this
/// connection is up (see `browser_sync_account_feed`), and it alone
/// advertises this device's controls.
async fn notifications(
    app: &tauri::AppHandle,
    api: &SyncApi,
    scope: &VaultScope,
    device_id: &str,
    handle: &WorkerHandle,
    personal: bool,
) -> JoinHandle<()> {
    let advertise_api = api.clone();
    let advertise_device = device_id.to_owned();
    let advertise_os = if personal {
        tokio::task::spawn_blocking(os_version)
            .await
            .unwrap_or_default()
    } else {
        Default::default()
    };
    let advertise_status = handle.status.clone();
    let mut status = handle.status.clone();
    let mut presence = handle.presence.clone();
    let mut devices = handle.devices.clone();
    let mut workspace_changes = handle.workspaces.clone();
    let notify_workspace = scope.vault_id.clone();
    let notify_app = app.clone();
    let mut account_events = handle.account_events();
    let feed_account = scope.account_id.clone();
    tokio::spawn(async move {
        let advertisement = control_advertisement::advertise(
            advertise_status,
            || advertise_api.advertise_controls(&advertise_device, &advertise_os),
            std::time::Duration::from_secs(30),
        );
        tokio::pin!(advertisement);
        let mut advertised = !personal;
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
                    if personal {
                        crate::infra::space_windows::emit(
                            &notify_app,
                            "misty:account-event",
                            serde_json::json!({ "accountId": feed_account, "topic": topic, "id": id }),
                        );
                    }
                    continue;
                },
            };
            if !alive {
                break;
            }
            crate::infra::space_windows::emit(&notify_app, "misty:browser-sync-changed", &notify_workspace);
        }
    })
}
