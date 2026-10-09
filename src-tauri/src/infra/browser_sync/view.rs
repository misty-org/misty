//! The sync view the renderer sees, the account event feed and the state read.
use super::*;

/// What the renderer sees of sync. Records inside are rewritten to renderer
/// names (see `document::renderer`) when this is serialized.
pub struct SyncView(pub(super) SyncViewData);

impl Serialize for SyncView {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut value = serde_json::to_value(&self.0).map_err(serde::ser::Error::custom)?;
        misty_browser_sync::document::renderer::to_renderer(&mut value);
        value.serialize(serializer)
    }
}

#[derive(Serialize)]
pub(super) struct SyncViewData {
    session_id: String,
    deployment: String,
    account_id: String,
    vault_id: String,
    device_id: String,
    profile_id: String,
    supports_cookie_handoff: bool,
    pub(super) browser_profile_ready: bool,
    pub(super) browser_profile_issue: Option<Cow<'static, str>>,
    website_data: Vec<device_data::DeviceWebsiteData>,
    status: Status,
    presence: Vec<Presence>,
    devices: Vec<misty_browser_sync::protocol::Device>,
    full_sync: bool,
    traffic: misty_browser_sync::transport::TrafficSnapshot,
    workspace: WorkspaceView,
    pending_operation_ids: Vec<String>,
    /// Workspaces (roster, lease, pending). `None` before workspace mode.
    sync: Option<misty_browser_sync::workspace::sync::SyncState>,
    /// Spaces whose vault has a problem, on the personal vault's view only.
    /// Sync shows one state for the account and names a Space only here.
    space_problems: Vec<SpaceProblem>,
}

#[derive(Serialize)]
pub(super) struct SpaceProblem {
    space_id: String,
    /// Authored text only, never platform errors or website data.
    issue: Cow<'static, str>,
}

const SPACE_STOPPED: &str = "Sync stopped for this Space. Retry to reconnect it.";

fn space_problems() -> Vec<SpaceProblem> {
    let all = sessions();
    let mut problems: Vec<SpaceProblem> = all
        .failed
        .iter()
        .map(|(space_id, issue)| SpaceProblem {
            space_id: space_id.clone(),
            issue: issue.clone(),
        })
        .collect();
    for entry in all.vaults.values() {
        let Some(space_id) = &entry.space_id else {
            continue;
        };
        let stopped = matches!(
            entry.status.borrow().phase,
            Phase::Attention | Phase::Stopped
        );
        let issue = match (&entry.issue, stopped) {
            (_, true) => Cow::Borrowed(SPACE_STOPPED),
            (Some(issue), false) => issue.clone(),
            (None, false) => continue,
        };
        problems.push(SpaceProblem {
            space_id: space_id.clone(),
            issue,
        });
    }
    problems
}

pub(super) async fn view(active: &mut Session) -> Result<SyncView, String> {
    match active.handle.pending_snapshot().await {
        Ok(pending) => {
            let document: Document = serde_json::from_slice(&pending.snapshot)
                .map_err(|_| "Could not read the local workspace")?;
            let mut workspace = document.workspace_view().map_err(issue)?;
            let committed: Document =
                serde_json::from_slice(&active.handle.snapshot().await.map_err(issue)?)
                    .map_err(|_| "Could not read the active device")?;
            workspace.active_device = committed.active_device;
            // Tentative reducer versions must never become a replay/import cursor.
            workspace.sequence = pending.committed_sequence;
            active.cached_workspace = workspace;
            active.cached_pending = pending.operation_ids;
        }
        Err(_)
            if matches!(
                active.handle.status.borrow().phase,
                misty_browser_sync::worker::Phase::Attention
                    | misty_browser_sync::worker::Phase::Stopped
            ) =>
        {
            // A stopped worker cannot service commands, but its actionable status
            // and last safe projection must remain visible to the user.
        }
        Err(error) => return Err(issue(error)),
    }
    // Workspace mode: project the driven workspace plus the shared workspace instead of the
    // legacy shared workspace, which now only carries credentials.
    let sync_state = active.handle.workspaces.borrow().clone();
    let workspace_mode = workspaces::workspace_mode(&sync_state);
    if workspace_mode {
        active.cached_workspace = workspaces::synthesize(
            &mut active.workspace_projection,
            &active.device_id,
            &sync_state,
        );
        active.cached_pending = Vec::new();
    }
    // A local website-storage failure does not stop workspace transport.
    let status = active.handle.status.borrow().clone();
    let profile = default_profile_id(&active.scope)?;
    let driving = workspace_mode
        .then(|| active.handle.workspaces.borrow().on_workspace.clone())
        .flatten();
    let browser_profile_ready = active.credential_issue.is_none()
        && if workspace_mode {
            active
                .device_browser
                .as_ref()
                .is_some_and(|browser| Some(&browser.workspace) == driving.as_ref())
        } else {
            match active.handle.browser_profile_binding(profile.clone()).await {
                Ok(binding) => match active.handle.browser_import_journal(profile).await {
                    Ok(journal) => {
                        binding.active.is_some()
                            && binding.staged.is_none()
                            && journal.pending.is_none()
                            && !journal.quarantined
                    }
                    Err(_) => false,
                },
                Err(_) => false,
            }
        };
    Ok(SyncView(SyncViewData {
        browser_profile_ready,
        browser_profile_issue: active.credential_issue.clone(),
        website_data: active.website_data.values().cloned().collect(),
        session_id: active.id.clone(),
        deployment: active.scope.deployment.clone(),
        account_id: active.scope.account_id.clone(),
        vault_id: active.scope.vault_id.clone(),
        device_id: active.device_id.clone(),
        profile_id: default_profile_id(&active.scope)?,
        supports_cookie_handoff: handoff::supported(),
        status,
        presence: active.handle.presence.borrow().clone(),
        devices: active.handle.devices.borrow().clone(),
        full_sync: full_sync_enabled(active),
        traffic: active.handle.traffic.snapshot(),
        workspace: active.cached_workspace.clone(),
        pending_operation_ids: active.cached_pending.clone(),
        sync: workspace_mode.then_some(sync_state),
        space_problems: match active.space_id {
            None => space_problems(),
            Some(_) => Vec::new(),
        },
    }))
}

/// Whether the sync socket currently delivers this account's invalidations to
/// the main window. The page re-asks on `misty:browser-sync-changed`.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountFeed {
    account_id: String,
    connected: bool,
}

#[tauri::command]
pub async fn browser_sync_account_feed(
    webview: tauri::Webview,
) -> Result<Option<AccountFeed>, String> {
    require_main(&webview)?;
    let current = personal_session().await;
    Ok(current.as_ref().map(|active| AccountFeed {
        account_id: active.scope.account_id.clone(),
        // A live socket is insufficient if its renderer event forwarder has
        // exited. Let consumers fall back to the authenticated event stream.
        connected: !active.notifications.is_finished()
            && matches!(
                active.handle.status.borrow().phase,
                misty_browser_sync::worker::Phase::CatchingUp
                    | misty_browser_sync::worker::Phase::Ready
            ),
    }))
}

#[tauri::command]
pub async fn browser_sync_state(webview: tauri::Webview) -> Result<Option<SyncView>, String> {
    require_main(&webview)?;
    let mut current = personal_session().await;
    match current.as_mut() {
        Some(active) => view(active).await.map(Some),
        None => Ok(None),
    }
}
