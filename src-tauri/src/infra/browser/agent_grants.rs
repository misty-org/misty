//! Agent grants, the page ring and capability checks for browser pages.

use super::*;

#[cfg(target_os = "macos")]
extern "C" {
    fn misty_agent_page_ring(view: *mut std::ffi::c_void, active: bool);
}

/// An agent controls a page while its input is locked to the agent or any of
/// its grants can act on it, not only read it.
pub(super) fn agent_controls_page(session: &BrowserSession) -> bool {
    session.agent_input_locked || session.agent_ring || session.grants.values().any(grant_acts)
}

/// Grants that let an agent act on the page, not only read it.
pub(super) fn grant_acts(grant: &BrowserGrant) -> bool {
    [
        "browser.interact",
        "browser.click",
        "browser.type",
        "browser.upload",
        "browser.navigate",
        "browser.steps",
        "browser.fill_form",
        "browser.skill",
    ]
    .iter()
    .any(|capability| grant.capabilities.contains(*capability))
}

/// The control ring glows around a page while an agent controls it.
pub(super) fn sync_agent_ring(app: &AppHandle, id: &str, active: bool) {
    let Some(webview) = webview_label(id)
        .ok()
        .and_then(|label| app.get_webview(&label))
    else {
        return;
    };
    #[cfg(target_os = "macos")]
    let _ = webview.with_webview(move |platform| unsafe {
        misty_agent_page_ring(platform.inner().cast(), active);
    });
    #[cfg(not(target_os = "macos"))]
    draw_agent_ring(&webview, active);
}

/// WebView2 has no native overlay inside the page's view, so the ring is a
/// non-interactive element the page draws itself. A new document drops it, so
/// it is drawn again after each load.
#[cfg(not(target_os = "macos"))]
pub(super) fn draw_agent_ring(webview: &Webview, active: bool) {
    let _ = webview.eval(format!(
        "{}({active})",
        include_str!("scripts/agent_ring.js").trim_end()
    ));
}

#[tauri::command]
pub fn browser_agent_grant_register(
    app: AppHandle,
    state: State<'_, BrowserSessionState>,
    request: BrowserAgentGrantRequest,
) -> Result<(), String> {
    let expires_at = DateTime::parse_from_rfc3339(&request.expires_at)
        .map_err(|_| "Browser grant expiry is invalid.".to_owned())?
        .with_timezone(&Utc);
    if expires_at <= Utc::now()
        || request.scope_id.trim().is_empty()
        || request.grant_id.trim().is_empty()
    {
        return Err("Browser grant is invalid or expired.".to_owned());
    }
    let capabilities = request.capabilities.into_iter().collect::<HashSet<_>>();
    if capabilities.is_empty()
        || capabilities
            .iter()
            .any(|value| !is_browser_capability(value))
    {
        return Err("Browser grant contains an unsupported capability.".to_owned());
    }
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Browser state is unavailable.")?;
    let session = sessions
        .get_mut(&request.id)
        .ok_or_else(|| "Browser tab is not running.".to_owned())?;
    if session.scope_id != request.scope_id {
        return Err("Browser grant does not match this tab.".to_owned());
    }
    session.grants.insert(
        request.grant_id,
        BrowserGrant {
            agent_id: request.agent_id,
            capabilities,
            expires_at,
        },
    );
    let acting = agent_controls_page(session);
    drop(sessions);
    sync_agent_ring(&app, &request.id, acting);
    Ok(())
}

#[tauri::command]
pub fn browser_agent_grant_revoke(
    app: AppHandle,
    state: State<'_, BrowserSessionState>,
    request: BrowserAgentGrantRevokeRequest,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Browser state is unavailable.")?;
    let Some(session) = sessions.get_mut(&request.id) else {
        return Ok(());
    };
    session.grants.remove(&request.grant_id);
    let acting = agent_controls_page(session);
    drop(sessions);
    sync_agent_ring(&app, &request.id, acting);
    Ok(())
}

pub(crate) fn revoke_execution_grant(
    app: &AppHandle,
    state: &BrowserSessionState,
    scope: &str,
    grant: &str,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Browser state is unavailable.")?;
    let mut rings = Vec::new();
    for (id, session) in sessions
        .iter_mut()
        .filter(|(_, session)| session.scope_id == scope)
    {
        session.grants.remove(grant);
        rings.push((id.clone(), agent_controls_page(session)));
    }
    drop(sessions);
    for (id, acting) in rings {
        sync_agent_ring(app, &id, acting);
    }
    Ok(())
}

pub(super) fn is_browser_capability(value: &str) -> bool {
    matches!(
        value,
        "browser.workspace.visual"
            | "browser.workspace.interact"
            | "browser.inspect"
            | "browser.visual"
            | "browser.navigate"
            | "browser.click"
            | "browser.type"
            | "browser.request"
            | "browser.interact"
            | "browser.upload"
            | "browser.downloads.list"
            | "browser.snapshot"
            | "browser.find"
            | "browser.extract"
            | "browser.wait_for"
            | "browser.steps"
            | "browser.fill_form"
            | "browser.skill"
    )
}

pub(super) fn resolve_agent_webview(
    app: &AppHandle,
    state: &BrowserSessionState,
    request: &BrowserAgentExecuteRequest,
) -> Result<(String, String), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Browser state is unavailable.")?;
    let (id, session) = sessions
        .iter_mut()
        .find(|(_, session)| session.scope_id == request.scope_id)
        .ok_or_else(|| "The granted browser tab is not open.".to_owned())?;
    let agent_id = validate_browser_grant(session, request)?;
    if app.get_webview(&webview_label(id)?).is_none() {
        return Err("The granted browser tab is not running.".to_owned());
    }
    Ok((id.clone(), agent_id))
}

pub(super) fn validate_browser_grant(
    session: &mut BrowserSession,
    request: &BrowserAgentExecuteRequest,
) -> Result<String, String> {
    session
        .grants
        .retain(|_, grant| grant.expires_at > Utc::now());
    session
        .grants
        .get(&request.grant_id)
        .filter(|grant| {
            grant.agent_id == request.agent_id && grant.capabilities.contains(&request.operation)
        })
        .map(|grant| grant.agent_id.clone())
        .ok_or_else(|| "Browser agent access is not active for this operation.".to_owned())
}
