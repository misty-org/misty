//! Device and workspace controls on the open vault: claiming a workspace, sync now,
//! activating this device, renaming devices, and the page-state worker handles.
use super::*;

/// Quitting allows a little longer, since nothing waits on it.
const EXIT_FLUSH: std::time::Duration = std::time::Duration::from_secs(2);

/// Opens `workspace_id` on this machine: its tabs, editable here while any other
/// machine keeps editing them too. Nobody is displaced; the device's sign-in
/// lease follows `workspaces::lease_to_claim`.
#[tauri::command]
pub async fn browser_sync_claim(
    webview: tauri::Webview,
    session_id: String,
    workspace_id: String,
) -> Result<(), String> {
    require_main(&webview)?;
    let handle = {
        let current = session().lock().await;
        let active = current.as_ref().ok_or("Connect device sync first.")?;
        require_session(active, &session_id)?;
        if !full_sync_enabled(active) {
            return Err("Enable Full sync before switching devices.".into());
        }
        let view = active.handle.workspaces.borrow().clone();
        if !view
            .workspaces
            .iter()
            .any(|t| t.workspace_id == workspace_id && !t.shared)
        {
            return Err("That device's workspace is not available.".into());
        }
        active.handle.clone()
    };
    handle.open_workspace(workspace_id).await.map_err(issue)
}

/// Sync now: sends batched workspace and collection changes without waiting
/// for their batch.
#[tauri::command]
pub async fn browser_sync_flush(webview: tauri::Webview, session_id: String) -> Result<(), String> {
    require_main(&webview)?;
    let handle = {
        let current = session().lock().await;
        let active = current.as_ref().ok_or("Connect device sync first.")?;
        require_session(active, &session_id)?;
        active.handle.clone()
    };
    handle.flush().await.map_err(issue)
}

/// Called once as the app exits, after windows close.
pub fn flush_before_exit() {
    tauri::async_runtime::block_on(async {
        let handle = session()
            .lock()
            .await
            .as_ref()
            .map(|active| active.handle.clone());
        if let Some(handle) = handle {
            let _ = tokio::time::timeout(EXIT_FLUSH, handle.flush()).await;
        }
    });
}

#[tauri::command]
pub async fn browser_sync_activate(
    webview: tauri::Webview,
    session_id: String,
) -> Result<String, String> {
    require_main(&webview)?;
    let current = session().lock().await;
    let session = current.as_ref().ok_or("Connect device sync first.")?;
    require_session(session, &session_id)?;
    if !full_sync_enabled(session) {
        return Err("Enable Full sync before switching to this device.".into());
    }
    // Workspace mode: back to this device's own tabs, and its own sign-in lease.
    if workspaces::workspace_mode(&session.handle.workspaces.borrow()) {
        let handle = session.handle.clone();
        let workspace = session.device_id.clone();
        drop(current);
        handle
            .open_workspace(workspace.clone())
            .await
            .map_err(issue)?;
        // Offline, the lease is claimed on reconnect by the capture pass.
        let _ = handle.claim_workspace(workspace).await;
        return Ok(uuid::Uuid::new_v4().to_string());
    }
    let status = session.handle.status.borrow().clone();
    if !matches!(status.phase, Phase::Ready | Phase::CatchingUp) {
        return Err("Waiting for a sync connection. Try waking Misty again in a moment.".into());
    }
    let document: Document =
        serde_json::from_slice(&session.handle.snapshot().await.map_err(issue)?)
            .map_err(|_| "Could not read the active device")?;
    let payload = Payload::ActiveDevice {
        version: 1,
        active: true,
        previous_epoch: document.active_device.map(|v| v.epoch),
    };
    let bytes =
        Zeroizing::new(serde_json::to_vec(&payload).map_err(|_| "Could not encode active device")?);
    session.handle.enqueue(bytes).await.map_err(issue)
}

/// Names a device on the account. Names are shown to the user only.
#[tauri::command]
pub async fn browser_sync_rename_device(
    webview: tauri::Webview,
    session_id: String,
    device_id: String,
    name: String,
) -> Result<(), String> {
    require_main(&webview)?;
    let name = name.trim().to_owned();
    if name.is_empty() || name.chars().count() > 60 || name.chars().any(char::is_control) {
        return Err("Use a name of 1 to 60 characters.".into());
    }
    let api = {
        let current = session().lock().await;
        let active = current.as_ref().ok_or("Connect device sync first.")?;
        require_session(active, &session_id)?;
        if !active
            .handle
            .devices
            .borrow()
            .iter()
            .any(|d| d.grant.device_id == device_id && d.revoked_at.is_none())
        {
            return Err("That device is not on this account.".into());
        }
        active.api.clone()
    };
    api.rename_device(&device_id, &name).await.map_err(issue)
}

/// Worker handle for page-state writes: slots belong to the workspace this
/// machine is on, and any machine on it may write them.
pub(crate) async fn page_state_worker() -> Result<WorkerHandle, String> {
    page_state_reader().await.map(|(handle, _)| handle)
}

/// Worker handle and the workspace this machine is on, for page-state reads.
pub(crate) async fn page_state_reader() -> Result<(WorkerHandle, String), String> {
    let current = session().lock().await;
    let active = current.as_ref().ok_or("Device sync is locked.")?;
    if !full_sync_enabled(active) {
        return Err("Full sync is off for this device.".into());
    }
    let workspace = active
        .handle
        .workspaces
        .borrow()
        .on_workspace
        .clone()
        .ok_or("This device is not using a workspace right now.")?;
    Ok((active.handle.clone(), workspace))
}

#[tauri::command]
pub async fn browser_sync_control_device(
    webview: tauri::Webview,
    session_id: String,
    device_id: String,
    full_sync: Option<bool>,
    activate: bool,
    workspace_id: Option<String>,
) -> Result<String, String> {
    require_main(&webview)?;
    if activate == full_sync.is_some() || (workspace_id.is_some() && !activate) {
        return Err("Choose one device action.".into());
    }
    let current = session().lock().await;
    let active = current.as_ref().ok_or("Connect device sync first.")?;
    require_session(active, &session_id)?;
    if !active
        .handle
        .devices
        .borrow()
        .iter()
        .any(|d| d.grant.device_id == device_id && d.revoked_at.is_none() && d.control_version >= 1)
    {
        return Err("Update Misty on this device before using device controls.".into());
    }
    active
        .api
        .control_device(&device_id, full_sync, activate, workspace_id.as_deref())
        .await
        .map_err(issue)
}
