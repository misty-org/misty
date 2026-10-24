//! Per-tab browser sessions: what each page is, who may drive it and where its data lives.

use super::*;

/// Where a tab's site permissions live: its profile's store, or its incognito
/// session's.
pub(in crate::infra) fn session_permission_scope(
    app: &AppHandle,
    id: &str,
) -> Option<kiri::engine::StoreScope> {
    let state = app.try_state::<BrowserSessionState>()?;
    let sessions = state.sessions.lock().ok()?;
    let session = sessions.get(id)?;
    if session.private {
        return Some(kiri::engine::StoreScope::Temporary(0));
    }
    crate::infra::site_settings::permissions::profile_key(session.profile_id.as_deref())
        .ok()
        .map(kiri::engine::StoreScope::Persistent)
}

pub struct BrowserSessionState {
    pub(super) context_menu: Mutex<HashMap<String, context_menu::PendingMenu>>,
    pub(super) pending_popups: Mutex<HashSet<String>>,
    pub(super) sessions: Mutex<HashMap<String, BrowserSession>>,
    pub(super) reserved_downloads: Mutex<HashSet<PathBuf>>,
    pub(in crate::infra) shortcut_bindings: Mutex<Vec<BrowserShortcutBinding>>,
    pub(in crate::infra) shortcut_tokens: Mutex<HashMap<String, String>>,
}

impl Default for BrowserSessionState {
    fn default() -> Self {
        Self {
            context_menu: Mutex::default(),
            pending_popups: Mutex::default(),
            sessions: Mutex::default(),
            reserved_downloads: Mutex::default(),
            shortcut_bindings: Mutex::new(crate::infra::browser_shortcuts::default_shortcut_bindings()),
            shortcut_tokens: Mutex::default(),
        }
    }
}

#[derive(Default)]
pub(super) struct BrowserSession {
    pub(super) agent_input_locked: bool,
    // An agent's tab while its run goes on: the ring stays even when the person has taken it
    // over and the lock is off (docs/design/agent-browser/BRIEF.md).
    pub(super) agent_ring: bool,
    pub(super) workspace_tab_id: Option<String>,
    // Native auxiliary windows stay attached to this live integration view.
    pub(super) popup_parent: Option<String>,
    pub(super) origin_space_id: Option<String>,
    pub(super) zoom_factor: Option<f64>,
    pub(super) profile_id: Option<String>,
    // Only this logical identity is included in renderer/agent observations.
    pub(super) logical_profile_id: Option<String>,
    pub(super) profile_provider: Option<String>,
    pub(super) provider_id: Option<String>,
    pub(super) oauth_callback: Option<(crate::infra::browser_provider::OAuthCallback, std::time::Instant)>,
    pub(super) scope_id: String,
    pub(super) grants: HashMap<String, BrowserGrant>,
    pub(super) snapshot_generation: u64,
    pub(super) snapshot_extension: Option<String>,
    pub(super) element_targets: HashMap<String, String>,
    pub(super) downloads: Vec<BrowserDownload>,
    pub(super) pending_agent_download: Option<PendingAgentDownload>,
    /// Private tabs keep no download list and share one throwaway data store.
    pub(super) private: bool,
    /// The agent run a tab works for, when an agent opened it in the person's window
    /// (docs/design/agent-browser/BRIEF.md): the benchmark pictures each run's own tabs.
    pub(super) agent_run_id: Option<String>,
}

impl BrowserSession {
    pub(super) fn context_profile_id(&self) -> Option<&str> {
        self.logical_profile_id
            .as_deref()
            .or(self.profile_id.as_deref())
    }
}

#[derive(Clone)]
pub(super) struct BrowserGrant {
    pub(super) agent_id: String,
    pub(super) capabilities: HashSet<String>,
    pub(super) expires_at: DateTime<Utc>,
}

#[derive(Clone)]
pub(super) struct PendingAgentDownload {
    pub(super) grant_id: String,
    pub(super) agent_id: String,
    pub(super) task_id: Option<String>,
    pub(super) expires_at: DateTime<Utc>,
    pub(super) popup_id: Option<String>,
}

#[cfg(any(target_os = "macos", windows, test))]
pub(super) fn popup_download_authority(
    source: &BrowserSession,
    popup_id: &str,
) -> Option<(String, String, String)> {
    let pending = source.pending_agent_download.as_ref()?;
    let grant = source.grants.get(&pending.grant_id)?;
    let now = Utc::now();
    if pending.popup_id.as_deref() != Some(popup_id)
        || pending.expires_at <= now
        || grant.expires_at <= now
        || grant.agent_id != pending.agent_id
        || !grant.capabilities.contains("browser.click")
    {
        return None;
    }
    Some((
        source.scope_id.clone(),
        pending.agent_id.clone(),
        pending.task_id.clone()?,
    ))
}

pub(super) fn register_session(state: &BrowserSessionState, id: &str, scope_id: &str) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Browser state is unavailable.")?;
    let session = sessions.entry(id.to_owned()).or_default();
    if !scope_id.trim().is_empty() {
        session.scope_id = scope_id.trim().to_owned();
    } else if session.scope_id.is_empty() {
        session.scope_id = format!("browser-{id}");
    }
    Ok(())
}

#[tauri::command]
pub fn browser_runtime_for_scope(
    state: State<'_, BrowserSessionState>,
    scope_id: String,
) -> Result<String, String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "Browser state unavailable")?;
    sessions
        .iter()
        .find(|(_, session)| session.scope_id == scope_id)
        .map(|(id, _)| id.clone())
        .ok_or_else(|| "browser_context_closed".into())
}
