//! The exclusive pass: loading a device's published sign-ins into this machine's store,
//! and switching stores.
use super::*;

/// One pass for the device this session writes: load it if another session
/// changed it, otherwise capture this machine's store and publish changes.
pub(in crate::infra::browser_sync) async fn reconcile(
    app: &tauri::AppHandle,
    active: &mut Session,
) -> Result<Option<&'static str>, String> {
    if !full_sync_enabled(active) {
        active.capture_view = None;
        return Ok(None);
    }
    if !handoff::supported() {
        return Ok(Some(
            "Website sign-in sync requires macOS 14 or newer, or Windows.",
        ));
    }
    let (workspace, holder) = {
        let view = active.handle.workspaces.borrow();
        let workspace = view.on_workspace.clone().filter(|_| view.seat_confirmed);
        let holder = workspace.is_some() && view.driving_workspace == workspace;
        (workspace, holder)
    };
    let Some(workspace) = workspace else {
        return Ok(None);
    };
    let status = active
        .handle
        .signin_status(workspace.clone())
        .await
        .map_err(issue)?;
    if !holder {
        return open_without_lease(app, active, &workspace, &status).await;
    }
    if !status.writer || !status.current {
        return Ok(None);
    }
    let logical = default_profile_id(&active.scope)?;
    let binding = match status.binding.clone() {
        Some(binding) => binding,
        None => device_data::adopt(active, &workspace, &logical).await?,
    };
    // Changes queued here are still on their way; the server lags behind them.
    if !status.pending && !binding.reflects(&status.server) {
        set_state(active, &workspace, DeviceDataState::Loading);
        let result = load(app, active, &workspace, &logical, binding, &status.server).await;
        set_state(
            active,
            &workspace,
            if result.is_ok() {
                DeviceDataState::Synced
            } else {
                DeviceDataState::Attention
            },
        );
        return result.map(|()| None);
    }
    switch_to(app, active, &workspace, &logical, &binding.physical_id)?;
    let result = capture(app, active, &workspace, &logical, binding, &status).await;
    if result.is_err() {
        set_state(active, &workspace, DeviceDataState::Attention);
    }
    result
}

/// A machine that opened a device without its lease: its pages use that
/// device's published sign-ins (loaded now if this machine's copy is older),
/// and nothing it does in them is published.
async fn open_without_lease(
    app: &tauri::AppHandle,
    active: &mut Session,
    workspace: &str,
    status: &SigninStatus,
) -> Result<Option<&'static str>, String> {
    if !status.current {
        return Ok(None);
    }
    let logical = default_profile_id(&active.scope)?;
    let binding = match status.binding.clone() {
        Some(binding) => binding,
        None => device_data::adopt(active, workspace, &logical).await?,
    };
    if !binding.reflects(&status.server) {
        set_state(active, workspace, DeviceDataState::Loading);
        let result = load(app, active, workspace, &logical, binding, &status.server).await;
        set_state(
            active,
            workspace,
            if result.is_ok() {
                DeviceDataState::Synced
            } else {
                DeviceDataState::Attention
            },
        );
        return result.map(|()| None);
    }
    switch_to(app, active, workspace, &logical, &binding.physical_id)?;
    Ok(None)
}

/// Points new pages at this device's store. Pages of another store close
/// first; the renderer reopens them when the profile-changed event arrives.
fn switch_to(
    app: &tauri::AppHandle,
    active: &mut Session,
    workspace: &str,
    logical: &str,
    physical: &str,
) -> Result<(), String> {
    let wanted = SelectedProfile {
        logical: logical.into(),
        physical: physical.into(),
    };
    let browser = DeviceBrowser {
        workspace: workspace.into(),
        physical: physical.into(),
    };
    let current = selected_profile(&active.scope.vault_id)?;
    if current.as_ref() == Some(&wanted) {
        active.device_browser = Some(browser);
        return Ok(());
    }
    super::super::super::agents::workspace::stop_account_tasks(app)?;
    active.capture_view = None;
    super::super::super::browser::close_profile_views_except(app, logical, None)?;
    set_selected_profile(&active.scope.vault_id, Some(wanted))?;
    active.device_browser = Some(browser);
    let _ = crate::infra::space_windows::emit(&app, "misty:browser-profile-changed", &active.id);
    Ok(())
}

/// Reads and verifies every published shard of the device.
async fn read_shards(
    active: &Session,
    workspace: &str,
    server: &BTreeMap<i16, [u8; 32]>,
) -> Result<(Vec<Vec<u8>>, BTreeMap<i16, String>), String> {
    let mut shards = Vec::new();
    let mut written = BTreeMap::new();
    for kind in server.keys() {
        let plaintext = tokio::time::timeout(
            READ_TIMEOUT,
            active.handle.read_signin(workspace.into(), *kind),
        )
        .await
        .map_err(|_| "Reading this device's sign-ins timed out. Retrying automatically.")?
        .map_err(issue)?
        // The slot moved on since this pass started; the next pass retries.
        .ok_or("This device's sign-ins changed while loading. Retrying automatically.")?;
        written.insert(*kind, signin_digest_hex(&signin::digest(&plaintext)));
        shards.push(plaintext);
    }
    Ok((shards, written))
}

/// Replaces this machine's copy of the device's sign-in data with what the
/// device published, and verifies the browser read it back exactly. Origins
/// the device never published keep their local data.
async fn load(
    app: &tauri::AppHandle,
    active: &mut Session,
    workspace: &str,
    logical: &str,
    binding: DeviceSignin,
    server: &BTreeMap<i16, [u8; 32]>,
) -> Result<(), String> {
    let (shards, written) = read_shards(active, workspace, server).await?;
    let observations = signin::unpack(shards.iter().map(Vec::as_slice))
        .map_err(|_| "This device's published sign-in data is invalid.")?;
    let target = records(logical, observations);
    // Pages using the store close before its contents are replaced, and are
    // reopened afterwards whether or not loading succeeded.
    super::super::super::agents::workspace::stop_account_tasks(app)?;
    active.capture_view = None;
    active.device_browser = None;
    super::super::super::browser::close_profile_views_except(app, logical, None)?;
    let physical = binding.physical_id.clone();
    let result = replace(
        app, active, workspace, logical, binding, server, written, target,
    )
    .await;
    // Pages open in this device's store either way. After a failed load it is
    // not captured from: its binding still differs from the published slots,
    // so the next pass loads again before anything is published.
    set_selected_profile(
        &active.scope.vault_id,
        Some(SelectedProfile {
            logical: logical.into(),
            physical: physical.clone(),
        }),
    )?;
    active.device_browser = Some(DeviceBrowser {
        workspace: workspace.into(),
        physical,
    });
    let _ = crate::infra::space_windows::emit(&app, "misty:browser-profile-changed", &active.id);
    result
}

#[allow(clippy::too_many_arguments)]
async fn replace(
    app: &tauri::AppHandle,
    active: &mut Session,
    workspace: &str,
    logical: &str,
    mut binding: DeviceSignin,
    server: &BTreeMap<i16, [u8; 32]>,
    written: BTreeMap<i16, String>,
    target: Vec<CredentialRecord>,
) -> Result<(), String> {
    let observer = capture::CaptureView::open(app, &binding.physical_id)?;
    let mut backend = super::super::super::website_data::storage_restore::BrowserProfile::for_generation(
        observer.view.clone(),
        logical.into(),
        binding.physical_id.clone(),
    );
    backend.preflight(&target).await.map_err(engine)?;
    backend.apply(&target).await.map_err(engine)?;
    let observed = backend.readback(&target).await.map_err(engine)?;
    if !credentials_equivalent(&observed, &target).map_err(issue)? {
        return Err(engine(EngineError::Invalid));
    }
    drop(observer);
    binding.applied = server
        .iter()
        .map(|(kind, hash)| (*kind, signin_digest_hex(hash)))
        .collect();
    binding.written = written.clone();
    active
        .handle
        .bind_signin(workspace.into(), binding.clone())
        .await
        .map_err(issue)?;
    active.baselines.insert(
        workspace.into(),
        Baseline {
            written,
            server: server.clone(),
            records: target,
            observed: None,
        },
    );
    Ok(())
}

/// The device's data as last published, so origins without an open page are
/// kept instead of read as deleted. After a restart it is re-read once.
pub(super) async fn baseline(
    active: &mut Session,
    workspace: &str,
    binding: &DeviceSignin,
    status: &SigninStatus,
) -> Result<Vec<CredentialRecord>, String> {
    if let Some(cached) = active.baselines.get(workspace).filter(|cached| {
        cached.written == binding.written
            || (!cached.server.is_empty() && cached.server == status.server)
    }) {
        return Ok(cached.records.clone());
    }
    if status.server.is_empty() {
        return migrated_baseline(active, workspace).await;
    }
    let (shards, written) = read_shards(active, workspace, &status.server).await?;
    let observations = signin::unpack(shards.iter().map(Vec::as_slice))
        .map_err(|_| "This device's published sign-in data is invalid.")?;
    let records = records(&default_profile_id(&active.scope)?, observations);
    active.baselines.insert(
        workspace.into(),
        Baseline {
            written,
            server: status.server.clone(),
            records: records.clone(),
            observed: None,
        },
    );
    Ok(records)
}
