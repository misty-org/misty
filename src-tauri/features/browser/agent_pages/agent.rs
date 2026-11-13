//! The browser_agent_execute command.

use crate::browser::*;

mod operations;
use operations::{type_browser, visual_browser};

#[tauri::command]
pub async fn browser_agent_execute(
    caller: Webview,
    app: AppHandle,
    state: State<'_, BrowserSessionState>,
    request: BrowserAgentExecuteRequest,
) -> Result<Value, String> {
    // An incognito window has the rest of this command's set, for browsing; agents aren't part of it.
    if !crate::browser::app_windows::is_person_window(caller.label()) {
        return Err("Only a profile's window can run agents.".to_owned());
    }
    execute_agent_request(app, state, request).await
}

pub(crate) async fn execute_agent_request(
    app: AppHandle,
    state: State<'_, BrowserSessionState>,
    mut request: BrowserAgentExecuteRequest,
) -> Result<Value, String> {
    if !is_browser_capability(&request.operation) {
        return Err("Unsupported browser agent operation.".to_owned());
    }
    let store = app
        .state::<crate::app::runtime::MistyRuntime>()
        .environment
        .store();
    request.policy =
        crate::agents::run_control::tool_gate::page_policy(&store, request.policy_call.as_deref());
    crate::agents::task_scopes::authorize_scope(
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
        return crate::agents::window_control::execute(&app, &request).await;
    }
    if matches!(
        request.operation.as_str(),
        "browser.click"
            | "browser.type"
            | "browser.interact"
            | "browser.upload"
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
        if let Some(reason) = crate::browser::agent_pages::page_agent::site_blocked(
            &url,
            &request.policy.site_blocks.clone().unwrap_or_default(),
        ) {
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
    if crate::browser::agent_pages::page_agent::handles(&request.operation) {
        return crate::browser::agent_pages::page_agent::execute(&app, &state, &id, &request).await;
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
            // A program builds addresses as it runs, so each is judged as it opens.
            if let Some(active) = request
                .policy
                .call
                .as_ref()
                .filter(|call| call.tool == "browser.run")
            {
                crate::agents::run_control::tool_gate::program_opens(&app, &store, active, url)
                    .await?;
            }
            let snapshot = request.input["includeSnapshot"] != false;
            let mark = if snapshot {
                crate::browser::agent_pages::page_agent::mark_document(&app, &id).await
            } else {
                None
            };
            view.navigate(target.clone())
                .map_err(|error| error.to_string())?;
            let mut landed = json!({"ok": true, "url": url});
            // The page it lands on, read once it has loaded, unless the caller only navigates.
            if snapshot {
                if let Some(snapshot) = crate::browser::agent_pages::page_agent::landed(
                    &app,
                    &id,
                    &previous,
                    &target,
                    mark.as_deref(),
                )
                .await
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
