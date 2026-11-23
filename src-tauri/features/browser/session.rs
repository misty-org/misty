use super::*;

#[derive(Default)]
pub struct BrowserSessionState {
    pub(super) context_menu:
        Mutex<HashMap<String, crate::browser::menus::context_menu::PendingMenu>>,
    pub(super) sessions: Mutex<HashMap<String, BrowserSession>>,
    pub(super) reserved_downloads: Mutex<HashSet<PathBuf>>,
    pub(crate) shortcut_bindings: Mutex<Vec<BrowserShortcutBinding>>,
    pub(crate) shortcut_tokens: Mutex<HashMap<String, String>>,
}

#[derive(Default)]
pub(super) struct BrowserSession {
    pub(super) agent_input_locked: bool,
    pub(super) agent_ring: bool,
    pub(super) popup_parent: Option<String>,
    pub(super) origin_space_id: Option<String>,
    pub(super) store_id: Option<String>,
    pub(super) profile: Option<String>,
    pub(super) scope_id: String,
    pub(super) grants: HashMap<String, BrowserGrant>,
    pub(super) snapshot_generation: u64,
    pub(super) element_targets: HashMap<String, String>,
    pub(super) downloads: Vec<BrowserDownload>,
    pub(super) pending_agent_download: Option<PendingAgentDownload>,
    pub(super) agent_run_id: Option<String>,
}

impl BrowserSession {
    pub(super) fn context_profile_id(&self) -> Option<&str> {
        self.profile.as_deref()
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

#[cfg(any(target_os = "macos", windows, target_os = "linux", test))]
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

pub(super) fn register_session(
    state: &BrowserSessionState,
    id: &str,
    scope_id: &str,
) -> Result<(), String> {
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
