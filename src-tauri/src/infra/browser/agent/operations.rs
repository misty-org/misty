//! The agent operations that read or prepare a page directly: a visual capture,
//! a typed draft and a provider request.
use super::*;

/// `browser.visual`: the page's inspection with a picture of the page or, for a
/// task with display captures, those instead.
pub(super) async fn visual_browser(
    app: &AppHandle,
    state: &BrowserSessionState,
    id: &str,
    request: &BrowserAgentExecuteRequest,
) -> Result<Value, String> {
    let mut observed = inspect_browser(app, state, id, request).await?;
    if observed["target"]["authentication"] == "required" {
        return Ok(observed);
    }
    #[cfg(any(target_os = "macos", windows))]
    if let Some(captures) = super::super::super::cursor_companion::task_visual(
        app,
        request
            .input
            .get("__mistyTaskId")
            .and_then(Value::as_str)
            .unwrap_or(""),
    )
    .await?
    {
        observed["displayCaptures"] = json!(captures);
        return Ok(observed);
    }
    let view = app
        .get_webview(&webview_label(id)?)
        .ok_or("browser_context_closed")?;
    view.show().map_err(|e| e.to_string())?;
    let size = view
        .size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(view.window().scale_factor().map_err(|e| e.to_string())?);
    #[cfg(target_os = "macos")]
    let capture = super::super::super::browser_macos::capture_webview_region(
        view,
        0.0,
        0.0,
        size.width,
        size.height,
    )
    .await?;
    #[cfg(windows)]
    let capture = super::super::capture_windows::capture(view).await?;
    #[cfg(not(any(target_os = "macos", windows)))]
    let capture: Value =
        return Err("Visual browser inspection requires macOS or Windows".into());
    observed["image"] = capture;
    observed["viewport"] = json!({"width":size.width,"height":size.height});
    Ok(observed)
}

/// `browser.type`: writes draft text into an inspected element.
pub(super) async fn type_browser(
    app: &AppHandle,
    state: &BrowserSessionState,
    id: &str,
    request: &BrowserAgentExecuteRequest,
) -> Result<Value, String> {
    let target = {
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "Browser state is unavailable.")?;
        sessions
            .get(id)
            .and_then(|session| {
                request
                    .input
                    .get("elementRef")
                    .and_then(Value::as_str)
                    .and_then(|key| session.element_targets.get(key))
            })
            .cloned()
            .ok_or("The page changed; inspect it again before typing.")?
    };
    let text = request
        .input
        .get("text")
        .and_then(Value::as_str)
        .filter(|text| text.len() <= 80000)
        .ok_or("Draft text is missing or too long.")?;
    let script = format!(
        "({})({}, {})",
        include_str!("../scripts/inspection_type.js"),
        serde_json::to_string(&target).unwrap(),
        serde_json::to_string(text).unwrap()
    );
    let result = eval_json(
        app.get_webview(&webview_label(id)?)
            .ok_or("Browser tab is not running.")?,
        script,
    )
    .await?;
    resolve_agent_webview(app, state, request)?;
    if result.get("ok").and_then(Value::as_bool) != Some(true) {
        if result.get("errorCode").and_then(Value::as_str) == Some("browser_snapshot_stale")
        {
            return Err(
                "browser_snapshot_stale: inspected content changed before dispatch".into(),
            );
        }
        return Err(result
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Draft preparation failed.")
            .into());
    }
    if let Some(session) = state
        .sessions
        .lock()
        .map_err(|_| "Browser state is unavailable.")?
        .get_mut(id)
    {
        session.element_targets.clear();
    }
    Ok(json!({"prepared": true}))
}

/// `browser.request`: a same-origin request from the provider view the task uses.
pub(super) async fn request_browser(
    app: &AppHandle,
    state: &BrowserSessionState,
    id: &str,
    request: &BrowserAgentExecuteRequest,
) -> Result<Value, String> {
    let origin = request
        .input
        .get("origin")
        .and_then(Value::as_str)
        .ok_or("Provider origin required.")?;
    let path = request
        .input
        .get("path")
        .and_then(Value::as_str)
        .filter(|path| {
            path.starts_with('/') && !path.starts_with("//") && path.len() <= 2048
        })
        .ok_or("A relative provider path is required.")?;
    {
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "Browser state is unavailable.")?;
        let provider = sessions
            .get(id)
            .and_then(|session| session.provider_id.as_deref())
            .ok_or("Requests require an active provider view.")?;
        if !super::super::super::browser_provider::allows(provider, &external_url(origin)?) {
            return Err("Provider origin mismatch.".into());
        }
    }
    let script = format!(
        "const origin = {}; const path = {}; {}",
        serde_json::to_string(origin).unwrap(),
        serde_json::to_string(path).unwrap(),
        include_str!("../scripts/provider_request.js")
    );
    let raw = evaluate_browser_async_javascript(
        app.get_webview(&webview_label(id)?)
            .ok_or("Browser tab is not running.")?,
        script,
    )
    .await?;
    resolve_agent_webview(app, state, request)?;
    serde_json::from_str(&raw).map_err(|_| "Invalid provider response.".into())
}
