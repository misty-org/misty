//! The browser_agent_execute command.

use super::*;

mod operations;
use operations::{request_browser, type_browser, visual_browser};

#[tauri::command]
pub async fn browser_agent_execute(
    app: AppHandle,
    state: State<'_, BrowserSessionState>,
    request: BrowserAgentExecuteRequest,
) -> Result<Value, String> {
    if !is_browser_capability(&request.operation) {
        return Err("Unsupported browser agent operation.".to_owned());
    }
    super::super::agents::workspace::authorize_scope(
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
        super::super::extensions::authorize_agent_url(&view.url().map_err(|e| e.to_string())?)
            .await?;
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
        "browser.visual" => visual_browser(&app, &state, &id, &request).await,
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
            let snapshot = request.input["includeSnapshot"] != false;
            let mark = if snapshot {
                page_agent::mark_document(&app, &id).await
            } else {
                None
            };
            view.navigate(target.clone())
                .map_err(|error| error.to_string())?;
            let mut landed = json!({"ok": true, "url": url});
            // The page it lands on, read once it has loaded, unless the caller only navigates.
            if snapshot {
                if let Some(snapshot) =
                    page_agent::landed(&app, &id, &previous, &target, mark.as_deref()).await
                {
                    if snapshot["url"].is_string() {
                        landed["url"] = snapshot["url"].clone();
                    }
                    landed["snapshot"] = snapshot;
                }
            }
            Ok(landed)
        }
        "browser.click" => click_browser(&app, &state, &id, &agent_id, &request).await,
        "browser.type" => type_browser(&app, &state, &id, &request).await,
        "browser.request" => request_browser(&app, &state, &id, &request).await,
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
