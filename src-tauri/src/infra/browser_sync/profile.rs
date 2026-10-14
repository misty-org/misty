//! Browser profile selection: which store the account's pages open in, and the
//! lease that keeps that choice steady while a view is created or reused.
use super::*;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct SelectedProfile {
    pub(super) logical: String,
    pub(super) physical: String,
}
// Non-secret native engine identity survives locking the vault, so opening a
// tab while locked cannot silently fall back to the unrelated legacy store.
// Account replacement clears it only after closing the previous browser views.
static SELECTED_PROFILE: OnceLock<std::sync::Mutex<Option<SelectedProfile>>> = OnceLock::new();
pub(super) fn selected_profile() -> &'static std::sync::Mutex<Option<SelectedProfile>> {
    SELECTED_PROFILE.get_or_init(|| std::sync::Mutex::new(None))
}

pub(super) fn select_bound_profile(
    logical: &str,
    binding: &BrowserProfileBinding,
    previous: Option<&SelectedProfile>,
) -> Result<Option<SelectedProfile>, String> {
    if binding.staged.is_some() && binding.active.is_none() {
        return Err(
            "Browser sign-in state is being restored. Wait before opening this page.".into(),
        );
    }
    if let Some(active) = &binding.active {
        if previous.is_some_and(|previous| {
            previous.logical != logical || previous.physical != active.physical_id
        }) {
            return Err("The browser profile changed. Its existing views must close before switching stores.".into());
        }
        return Ok(Some(SelectedProfile {
            logical: logical.into(),
            physical: active.physical_id.clone(),
        }));
    }
    if previous.is_some() || binding.revision != 0 {
        return Err("The browser profile needs recovery. Existing data has been preserved.".into());
    }
    // An unregistered legacy profile has not been migrated yet. Merely unlocking
    // sync must not select a new empty engine store and lose the user's sign-ins.
    Ok(None)
}

pub(in crate::infra) struct BrowserProfileLease {
    _lifecycle: RwLockReadGuard<'static, ()>,
    pub profile_id: Option<String>,
    pub logical_profile_id: Option<String>,
    pub tab_session: Option<serde_json::Value>,
}

/// Debug builds print how long each step of opening a page waited, so a page
/// that never appears can be traced to the lock or call it is stuck behind.
fn trace_lease(started: std::time::Instant, step: &str) {
    if cfg!(debug_assertions) {
        eprintln!(
            "[browser-lease] +{}ms {step}",
            started.elapsed().as_millis()
        );
    }
}

/// Resolve logical/default workspace requests through the encrypted native
/// registry. No renderer may choose a physical generation for this resolution.
/// Keep the returned lease until native view creation/reuse has completed.
pub(in crate::infra) async fn browser_profile_lease(
    app: Option<&tauri::AppHandle>,
    requested: Option<&str>,
    tab: Option<(&str, &str)>,
) -> Result<BrowserProfileLease, String> {
    let started = std::time::Instant::now();
    trace_lease(started, "waiting for the browser lifecycle lock");
    let epoch = BROWSER_ACCOUNT_EPOCH.load(Ordering::Acquire);
    let lifecycle = browser_lifecycle().read().await;
    trace_lease(
        started,
        "got the lifecycle lock; waiting for the sync session",
    );
    if BROWSER_ACCOUNT_EPOCH.load(Ordering::Acquire) != epoch {
        return Err("The browser account changed before this page could open.".into());
    }
    let mut current = session().lock().await;
    trace_lease(
        started,
        if current.is_some() {
            "got the sync session"
        } else {
            "no sync session (locked or signed out)"
        },
    );
    let previous_issue = current
        .as_ref()
        .and_then(|active| active.credential_issue.clone());
    let previous = selected_profile()
        .lock()
        .map_err(|_| "Browser profile state is unavailable")?
        .clone();
    let mut selected = previous.clone();
    if let Some(active) = current.as_mut() {
        let logical = default_profile_id(&active.scope)?;
        if requested.is_none() || requested == Some(logical.as_str()) {
            selected = if workspaces::workspace_mode(&active.handle.workspaces.borrow()) {
                resolve_device_profile(active, &logical, previous.as_ref()).await?
            } else {
                resolve_local_profile(active, &logical, previous.as_ref()).await?
            };
            // The authenticated binding selects local storage, not sync readiness.
            // Live cookies/storage can legitimately differ from an import receipt.
            // Background capture reports those failures through credential_issue;
            // only incoming restores need native read-back before activation.
            *selected_profile()
                .lock()
                .map_err(|_| "Browser profile state is unavailable")? = selected.clone();
            if selected.is_none() && requested.is_some() {
                return Err("The browser profile has not been migrated yet.".into());
            }
        }
    }
    trace_lease(started, "profile resolved");
    let (profile_id, logical_profile_id) = match selected {
        Some(selected) if requested.is_none() || requested == Some(selected.logical.as_str()) => {
            (Some(selected.physical), Some(selected.logical))
        }
        _ => (requested.map(str::to_owned), None),
    };
    let mut tab_session = None;
    if let (Some(active), Some((view_id, url)), Some(logical)) = (
        current.as_mut().filter(|active| full_sync_enabled(active)),
        tab,
        logical_profile_id.as_ref(),
    ) {
        if let Ok(url) = url::Url::parse(url) {
            let area = document::credentials::Area::SessionStorage {
                origin: url.origin().ascii_serialization(),
                view_id: view_id.into(),
            };
            tab_session = local_tab_session(active, logical, &area).await;
        }
    }
    if let (Some(app), Some(active)) = (app, current.as_ref()) {
        if active.credential_issue != previous_issue {
            let _ = app.emit_to("main", "misty:browser-sync-changed", &active.scope.vault_id);
        }
    }
    trace_lease(started, "lease ready");
    Ok(BrowserProfileLease {
        tab_session,
        _lifecycle: lifecycle,
        profile_id,
        logical_profile_id,
    })
}

// A stopped transport may no longer answer worker commands. Reuse only the
// already selected identity for this account; never guess a different store.
pub(super) async fn resolve_local_profile(
    active: &mut Session,
    logical: &str,
    previous: Option<&SelectedProfile>,
) -> Result<Option<SelectedProfile>, String> {
    match active.handle.browser_profile_binding(logical.into()).await {
        Ok(binding) => select_bound_profile(logical, &binding, previous),
        Err(error) => {
            if let Some(previous) = previous.filter(|previous| previous.logical == logical) {
                active.credential_issue = Some(
                    "Website sign-in sync is unavailable. You can keep browsing with this device's existing data.".into(),
                );
                Ok(Some(previous.clone()))
            } else {
                Err(issue(error))
            }
        }
    }
}

/// Workspaces: pages open in the store of the device this session drives.
/// Stores never switch under open pages; the capture loop closes them first.
pub(super) async fn resolve_device_profile(
    active: &mut Session,
    logical: &str,
    previous: Option<&SelectedProfile>,
) -> Result<Option<SelectedProfile>, String> {
    match device_data::device_store(active, logical).await {
        Ok(selected) => {
            if previous.is_some_and(|previous| *previous != selected) {
                return Err("The browser profile changed. Its existing views must close before switching stores.".into());
            }
            Ok(Some(selected))
        }
        // A stopped worker cannot answer; keep using the store already open.
        Err(error) => match previous.filter(|previous| previous.logical == logical) {
            Some(previous)
                if active.handle.status.borrow().phase == Phase::Attention
                    || active.handle.status.borrow().phase == Phase::Stopped =>
            {
                active.credential_issue = Some(
                    "Website sign-in sync is unavailable. You can keep browsing with this device's existing data.".into(),
                );
                Ok(Some(previous.clone()))
            }
            _ => Err(error),
        },
    }
}

pub(super) async fn local_tab_session(
    active: &mut Session,
    logical: &str,
    area: &document::credentials::Area,
) -> Option<serde_json::Value> {
    if workspaces::workspace_mode(&active.handle.workspaces.borrow()) {
        return device_data::tab_session(active, area);
    }
    let result = async {
        let document: Document =
            serde_json::from_slice(&active.handle.snapshot().await.map_err(issue)?)
                .map_err(|_| "Could not read tab session".to_string())?;
        Ok::<_, String>(
            document
                .credentials
                .get(&area.key(logical).map_err(issue)?)
                .map(|record| record.payload.clone()),
        )
    }
    .await;
    match result {
        Ok(value) => value,
        Err(_) => {
            // Session restoration is optional; a failed sync read must not
            // prevent a new local browsing session or clear persistent storage.
            active.credential_issue = Some(
                "Synced tab sessions could not be restored. You can keep browsing with this device's existing data.".into(),
            );
            None
        }
    }
}

/// Engines request popup creation synchronously on their UI thread. Never block
/// that thread behind account shutdown; decline and let the user retry.
#[cfg(any(target_os = "macos", windows))]
pub(in crate::infra) fn popup_lifecycle_lease() -> Option<RwLockReadGuard<'static, ()>> {
    browser_lifecycle().try_read().ok()
}

pub(super) fn default_profile_id(scope: &VaultScope) -> Result<String, String> {
    let bytes = serde_json::to_vec(&(
        "misty.default-browser-profile.v1",
        &scope.deployment,
        &scope.account_id,
        &scope.vault_id,
    ))
    .map_err(|_| "Invalid sync scope")?;
    Ok(Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}
