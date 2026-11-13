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
    if let Some(captures) = crate::agents::cursor::task_visual(
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
    let capture = crate::browser::pages::macos::capture_webview_region(
        view,
        0.0,
        0.0,
        size.width,
        size.height,
    )
    .await?;
    #[cfg(windows)]
    let capture = crate::browser::pages::windows::capture::capture(view).await?;
    #[cfg(target_os = "linux")]
    let capture = crate::browser::pages::linux::capture(view).await?;
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    let capture: Value =
        return Err("Visual browser inspection isn't available on this system.".into());
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
        include_str!("../../kiri_link/scripts/inspection_type.js"),
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
        if result.get("errorCode").and_then(Value::as_str) == Some("browser_snapshot_stale") {
            return Err("browser_snapshot_stale: inspected content changed before dispatch".into());
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
