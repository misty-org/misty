//! Agent input lock, uploads, task downloads and workspace dispatch.

use super::*;

pub(super) fn apply_agent_input_lock(webview: &Webview, locked: bool) -> Result<(), String> {
    native_input::set_locked(webview, locked)?;
    if !locked {
        webview
            .eval("window[Symbol.for('misty.browser.agent.cursor')]?.hide()")
            .map_err(|e| e.to_string())?;
    }
    let script = format!(
        "({})({locked}, window, 0, {})",
        include_str!("browser_agent_input_guard.js"),
        // A native lock already keeps the person's own input out.
        cfg!(any(target_os = "macos", windows))
    );
    webview.eval(&script).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn browser_agent_set_locked(
    caller: Webview,
    app: AppHandle,
    state: State<'_, BrowserSessionState>,
    request: BrowserWebviewIdRequest,
    locked: bool,
    // Set by the agent browser: whether its run goes on, ringing the tab whether locked or not.
    ring: Option<bool>,
) -> Result<(), String> {
    let view = app
        .get_webview(&webview_label(&request.id)?)
        .ok_or("browser_context_closed")?;
    if view.window().label() != caller.window().label() {
        return Err("browser_window_mismatch".into());
    }
    let controlled = {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "browser_state_unavailable")?;
        sessions.get_mut(&request.id).map(|session| {
            session.agent_input_locked = locked;
            if let Some(ring) = ring {
                session.agent_ring = ring;
            }
            agent_controls_page(session)
        })
    };
    sync_agent_ring(&app, &request.id, controlled.unwrap_or(locked));
    apply_agent_input_lock(&view, locked)
}

pub(super) async fn upload_browser(
    app: &AppHandle,
    state: &BrowserSessionState,
    id: &str,
    request: &BrowserAgentExecuteRequest,
) -> Result<Value, String> {
    let mut input = request.input.clone();
    if input
        .get("downloadId")
        .is_some_and(|value| !value.is_null())
    {
        input["file"] = task_files::prepare_upload(app, state, request)?;
    }
    if request.input.get("ref").and_then(Value::as_str).is_some() {
        // A file input from browser_snapshot rather than browser_inspect.
        return page_agent::upload(app, state, id, request, &input).await;
    }
    let reference = request
        .input
        .get("elementRef")
        .and_then(Value::as_str)
        .ok_or("An inspected file input is required.")?;
    let target = {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "browser_state_unavailable")?;
        let session = sessions.get_mut(id).ok_or("browser_context_closed")?;
        let target = session
            .element_targets
            .get(reference)
            .cloned()
            .ok_or("browser_snapshot_stale: inspect the file input again")?;
        session.element_targets.clear();
        target
    };
    let webview = app
        .get_webview(&webview_label(id)?)
        .ok_or("browser_context_closed")?;
    let origin = browser_page_origin(&webview.url().map_err(|e| e.to_string())?);
    // Reading a file must not extend a revoked task or execution grant.
    super::super::agent_workspace::authorize_scope(
        app,
        &request.scope_id,
        &request.agent_id,
        input
            .get("__mistyTaskId")
            .and_then(Value::as_str)
            .unwrap_or(""),
    )?;
    resolve_agent_webview(app, state, request)?;
    let script = format!(
        "({})({},{},{})",
        include_str!("browser_inspection_upload.js"),
        serde_json::to_string(&target).unwrap(),
        serde_json::to_string(&input).map_err(|e| e.to_string())?,
        serde_json::to_string(&origin).unwrap()
    );
    let result = eval_json(webview, script).await?;
    if result["ok"] != true {
        return Err(result["error"]
            .as_str()
            .unwrap_or("File upload failed")
            .to_owned());
    }
    Ok(result)
}

pub(crate) fn resume_task_downloads(
    app: &AppHandle,
    scope: &str,
    agent: &str,
    previous: &str,
    next: &str,
) -> Result<(), String> {
    let state = app.state::<BrowserSessionState>();
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "browser_state_unavailable")?;
    let session = sessions
        .values_mut()
        .find(|session| session.scope_id == scope)
        .ok_or("browser_context_closed")?;
    task_files::resume_downloads(&mut session.downloads, agent, previous, next);
    // An old delayed download is never attributed to the resumed task.
    session.pending_agent_download = None;
    Ok(())
}

pub(crate) fn authorize_workspace_dispatch(
    app: &AppHandle,
    scope: &str,
    agent: &str,
    grant: &str,
    task: &str,
) -> Result<(), String> {
    super::super::agent_workspace::authorize_scope(app, scope, agent, task)?;
    let state = app.state::<BrowserSessionState>();
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Browser state unavailable")?;
    let session = sessions
        .values_mut()
        .find(|s| s.scope_id == scope)
        .ok_or("Browser scope closed")?;
    let request = BrowserAgentExecuteRequest {
        scope_id: scope.into(),
        agent_id: agent.into(),
        grant_id: grant.into(),
        operation: "browser.workspace.interact".into(),
        input: json!({}),
        site_blocks: None,
        confirm_kinds: None,
        grant_set: None,
    };
    validate_browser_grant(session, &request)?;
    Ok(())
}

/// Enumerate only registered website views in the actual selected native profile.
#[cfg(any(target_os = "macos", windows))]
pub(crate) fn sync_storage_views(
    app: &AppHandle,
    physical: &str,
) -> Result<Vec<(String, Webview)>, String> {
    let state = app.state::<BrowserSessionState>();
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "Browser state is unavailable")?;
    let legacy = super::super::browser_profile::legacy_profile_identity();
    Ok(sessions
        .iter()
        .filter(|(_, session)| session.profile_id.as_deref().unwrap_or(&legacy) == physical)
        .filter_map(|(id, session)| {
            webview_label(id)
                .ok()
                .and_then(|label| app.get_webview(&label))
                .map(|view| {
                    (
                        session
                            .workspace_tab_id
                            .clone()
                            .unwrap_or_else(|| id.clone()),
                        view,
                    )
                })
        })
        .collect())
}
