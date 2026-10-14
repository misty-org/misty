//! The browser_agent_execute command.

use super::*;

#[tauri::command]
pub async fn browser_agent_execute(
    app: AppHandle,
    state: State<'_, BrowserSessionState>,
    request: BrowserAgentExecuteRequest,
) -> Result<Value, String> {
    if !is_browser_capability(&request.operation) {
        return Err("Unsupported browser agent operation.".to_owned());
    }
    super::super::agent_workspace::authorize_scope(
        &app,
        &request.scope_id,
        &request.agent_id,
        request
            .input
            .get("__mistyTaskId")
            .and_then(Value::as_str)
            .unwrap_or(""),
    )?;
    let (id, agent_id) = resolve_agent_webview(&app, &state, &request)?;
    // Workspace control uses an inert webview as its task/grant carrier. Its
    // unloaded about:blank URL is unrelated to the desktop being captured;
    // querying it can fail before ScreenCaptureKit is ever reached.
    if request.operation.starts_with("browser.workspace.") {
        return super::super::workspace_autopilot::execute(&app, &request).await;
    }
    if let Some(view) = app.get_webview(&webview_label(&id)?) {
        super::super::extensions::authorize_agent_url(&view.url().map_err(|e| e.to_string())?).await?;
    }
    if let Some(url) = request
        .input
        .get("url")
        .and_then(Value::as_str)
        .and_then(|value| Url::parse(value).ok())
    {
        super::super::extensions::authorize_agent_url(&url).await?;
    }
    if matches!(
        request.operation.as_str(),
        "browser.click"
            | "browser.type"
            | "browser.interact"
            | "browser.upload"
            | "browser.request"
            | "browser.steps"
            | "browser.fill_form"
            | "browser.skill"
    ) {
        let url = app
            .get_webview(&webview_label(&id)?)
            .ok_or("Browser tab is not running.")?
            .url()
            .map_err(|error| error.to_string())?;
        // Nothing reaches a blocked site: the device refuses before any input.
        if let Some(reason) =
            page_agent::site_blocked(&url, &request.site_blocks.clone().unwrap_or_default())
        {
            return Err(reason);
        }
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "Browser state is unavailable.")?;
        let target = sessions
            .get(&id)
            .map(|session| browser_target_observation(session, &url))
            .ok_or("Browser tab is not running.")?;
        if target["authentication"] == "required" {
            return Err("browser_authentication_required: complete sign-in in the original browser before continuing".into());
        }
    }
    if request
        .input
        .get("__mistyTaskId")
        .and_then(Value::as_str)
        .is_some_and(|id| !id.is_empty())
    {
        let _ = app.emit_to(
            browser_owner_label(&app, &id),
            "misty://agent-target",
            json!({"id":id}),
        );
    }
    if page_agent::handles(&request.operation) {
        return page_agent::execute(&app, &state, &id, &request).await;
    }
    match request.operation.as_str() {
        "browser.inspect" => inspect_browser(&app, &state, &id, &request).await,
        "browser.visual" => {
            let mut observed = inspect_browser(&app, &state, &id, &request).await?;
            if observed["target"]["authentication"] == "required" {
                return Ok(observed);
            }
            #[cfg(any(target_os = "macos", windows))]
            if let Some(captures) = super::super::cursor_companion::task_visual(
                &app,
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
                .get_webview(&webview_label(&id)?)
                .ok_or("browser_context_closed")?;
            view.show().map_err(|e| e.to_string())?;
            let size = view
                .size()
                .map_err(|e| e.to_string())?
                .to_logical::<f64>(view.window().scale_factor().map_err(|e| e.to_string())?);
            #[cfg(target_os = "macos")]
            let capture = super::super::browser_macos::capture_webview_region(
                view,
                0.0,
                0.0,
                size.width,
                size.height,
            )
            .await?;
            #[cfg(windows)]
            let capture = super::super::browser_capture_windows::capture(view).await?;
            #[cfg(not(any(target_os = "macos", windows)))]
            let capture: Value =
                return Err("Visual browser inspection requires macOS or Windows".into());
            observed["image"] = capture;
            observed["viewport"] = json!({"width":size.width,"height":size.height});
            Ok(observed)
        }
        "browser.navigate" => {
            let url = request
                .input
                .get("url")
                .and_then(Value::as_str)
                .ok_or_else(|| "A URL is required.".to_owned())?;
            let view = app
                .get_webview(&webview_label(&id)?)
                .ok_or_else(|| "Browser tab is not running.".to_owned())?;
            let previous = view.url().map_err(|error| error.to_string())?;
            let target = external_url(url)?;
            view.navigate(target.clone()).map_err(|error| error.to_string())?;
            let mut landed = json!({"ok": true, "url": url});
            // The page it lands on, read once it has loaded, unless the caller only navigates.
            if request.input["includeSnapshot"] != false {
                if let Some(snapshot) = page_agent::landed(&app, &id, &previous, &target).await {
                    if snapshot["url"].is_string() {
                        landed["url"] = snapshot["url"].clone();
                    }
                    landed["snapshot"] = snapshot;
                }
            }
            Ok(landed)
        }
        "browser.click" => click_browser(&app, &state, &id, &agent_id, &request).await,
        "browser.type" => {
            let target = {
                let sessions = state
                    .sessions
                    .lock()
                    .map_err(|_| "Browser state is unavailable.")?;
                sessions
                    .get(&id)
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
                include_str!("browser_inspection_type.js"),
                serde_json::to_string(&target).unwrap(),
                serde_json::to_string(text).unwrap()
            );
            let result = eval_json(
                app.get_webview(&webview_label(&id)?)
                    .ok_or("Browser tab is not running.")?,
                script,
            )
            .await?;
            resolve_agent_webview(&app, &state, &request)?;
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
                .get_mut(&id)
            {
                session.element_targets.clear();
            }
            Ok(json!({"prepared": true}))
        }
        "browser.request" => {
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
                    .get(&id)
                    .and_then(|session| session.provider_id.as_deref())
                    .ok_or("Requests require an active provider view.")?;
                if !super::super::browser_provider::allows(provider, &external_url(origin)?) {
                    return Err("Provider origin mismatch.".into());
                }
            }
            let script = format!(
                "const origin = {}; const path = {}; {}",
                serde_json::to_string(origin).unwrap(),
                serde_json::to_string(path).unwrap(),
                include_str!("browser_provider_request.js")
            );
            let raw = evaluate_browser_async_javascript(
                app.get_webview(&webview_label(&id)?)
                    .ok_or("Browser tab is not running.")?,
                script,
            )
            .await?;
            resolve_agent_webview(&app, &state, &request)?;
            serde_json::from_str(&raw).map_err(|_| "Invalid provider response.".into())
        }
        "browser.upload" => upload_browser(&app, &state, &id, &request).await,
        "browser.interact" => interact_browser(&app, &state, &id, &request).await,
        "browser.downloads.list" => {
            let task = request
                .input
                .get("__mistyTaskId")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty());
            let sessions = state
                .sessions
                .lock()
                .map_err(|_| "Browser state is unavailable.")?;
            let downloads = sessions
                .get(&id)
                .map(|session| {
                    session
                        .downloads
                        .iter()
                        .filter(|item| {
                            task.is_none_or(|task| item.task_id.as_deref() == Some(task))
                        })
                        .cloned()
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            Ok(json!({"sourceScopeId": request.scope_id, "downloads": downloads}))
        }
        _ => Err("Unsupported browser agent operation.".to_owned()),
    }
}
