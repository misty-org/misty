//! Renderer edits to the workspace and the queue that publishes them.
use super::*;

#[tauri::command]
pub async fn browser_sync_edit(
    webview: tauri::Webview,
    session_id: String,
    operation_id: String,
    changes: Vec<serde_json::Value>,
    active_epoch: String,
) -> Result<String, String> {
    require_main(&webview)?;
    let changes = changes
        .into_iter()
        .map(|mut change| {
            misty_browser_sync::document::renderer::from_renderer(&mut change);
            serde_json::from_value::<Change>(change)
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "The workspace change is invalid.")?;
    if changes.iter().any(|change| {
        let (Change::Create { kind, .. }
        | Change::Patch { kind, .. }
        | Change::Delete { kind, .. }) = change;
        matches!(
            kind,
            document::entities::Kind::ExtensionSyncKey
                | document::entities::Kind::ExtensionRemoval
                | document::entities::Kind::Login
        )
    }) {
        return Err("Extension storage and passwords are managed natively.".into());
    }
    if let Some(result) = workspace_edit(
        &session_id,
        &active_epoch,
        WorkspaceEdit::Changes(changes.clone()),
    )
    .await
    {
        return result.map(|()| operation_id);
    }
    enqueue(
        &session_id,
        operation_id,
        Payload::Workspace {
            version: 1,
            changes,
        }
        .published(active_epoch),
    )
    .await
}

enum WorkspaceEdit {
    Changes(Vec<Change>),
}

/// Routes a renderer edit to the workspace this machine is on. `None` means the
/// workspace is not in workspace mode yet and the legacy path applies. An edit
/// captured on a workspace this machine has since left is refused, never applied
/// to a different workspace.
async fn workspace_edit(
    session_id: &str,
    epoch: &str,
    edit: WorkspaceEdit,
) -> Option<Result<(), String>> {
    let current = session_by_id(session_id).await;
    let active = match current.as_ref() {
        Some(active) => active,
        None => return Some(Err("Unlock browser sync first.".into())),
    };
    let view = active.handle.workspaces.borrow().clone();
    if !workspaces::workspace_mode(&view) {
        return None;
    }
    let result = async {
        require_session(active, session_id)?;
        if !full_sync_enabled(active) {
            return Err("Full sync is off for this device.".to_string());
        }
        if workspaces::writer_epoch(&view) != Some(epoch) {
            return Err("This edit was made in another workspace.".to_string());
        }
        match edit {
            WorkspaceEdit::Changes(changes) => active.handle.workspace_changes(changes).await,
        }
        .map_err(issue)
    }
    .await;
    Some(result)
}

pub(super) async fn enqueue(
    session_id: &str,
    operation_id: String,
    payload: Payload,
) -> Result<String, String> {
    payload.validate().map_err(issue)?;
    let current = session_by_id(session_id).await;
    let active = current.as_ref().ok_or("Unlock browser sync first.")?;
    require_session(active, session_id)?;
    if !full_sync_enabled(active) {
        return Err("Full sync is off for this device.".into());
    }
    let bytes = Zeroizing::new(
        serde_json::to_vec(&payload).map_err(|_| "Could not encode workspace change")?,
    );
    active
        .handle
        .enqueue_identified(operation_id, bytes)
        .await
        .map_err(issue)
}
