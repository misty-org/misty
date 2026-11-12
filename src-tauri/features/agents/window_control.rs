//! Foreground, task-bound whole-window control. No authority survives Stop or Space changes.
use crate::browser::BrowserAgentExecuteRequest;
use serde_json::{json, Value};
use std::{
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, Webview};

#[derive(Default)]
struct Session {
    task: String,
    context: Value,
    snapshot: Option<Snapshot>,
}
struct Snapshot {
    id: String,
    captured: Instant,
    geometry: Value,
}
static SESSION: OnceLock<Mutex<Session>> = OnceLock::new();
pub(crate) static DESKTOP_APP: OnceLock<AppHandle> = OnceLock::new();
fn session() -> &'static Mutex<Session> {
    SESSION.get_or_init(Mutex::default)
}
#[cfg(target_os = "macos")]
use crate::agents::window_control::macos::*;
pub fn renew(task: &str) {
    #[cfg(target_os = "macos")]
    crate::agents::desktop_control::macos::renew(task);
    #[cfg(windows)]
    crate::agents::desktop_control::windows::renew(task);
    #[cfg(target_os = "linux")]
    crate::agents::desktop_control::linux::control::renew(task);
}
mod commands;
pub use commands::*;
pub fn stop(task: &str) {
    if let Ok(mut state) = session().lock() {
        if state.task == task {
            *state = Session::default();
        } else {
            return;
        }
    }
    #[cfg(target_os = "macos")]
    {
        crate::agents::cursor::macos::ring_views::window_ring(std::ptr::null_mut(), false);
        crate::agents::cursor::macos::ring_views::mist_waiting(false);
        hide_cursor();
        crate::agents::desktop_control::macos::stop(task);
    }
    #[cfg(windows)]
    {
        crate::agents::desktop_control::windows::stop(task);
        if let Some(app) = DESKTOP_APP.get() {
            crate::agents::window_control::windows::release(app);
        }
    }
    #[cfg(target_os = "linux")]
    {
        crate::agents::desktop_control::linux::control::stop(task);
        crate::agents::window_control::linux::release();
    }
}
fn authorize(app: &AppHandle, request: &BrowserAgentExecuteRequest) -> Result<Value, String> {
    let task = request.input["__mistyTaskId"].as_str().unwrap_or("");
    let state = session().lock().map_err(|_| "workspace_unavailable")?;
    if task.is_empty() || state.task != task {
        return Err("Start or resume the task to allow desktop control".into());
    }
    crate::agents::task_scopes::authorize_window_task(
        app,
        task,
        state.context["accountId"].as_str().unwrap_or(""),
        state.context["spaceId"].as_str().unwrap_or(""),
    )?;
    crate::agents::task_scopes::authorize_scope(app, &request.scope_id, &request.agent_id, task)?;
    let window = crate::agents::task_scopes::task_window(app, task)
        .and_then(|label| app.get_window(&label))
        .or_else(|| crate::browser::app_windows::primary(app))
        .ok_or("Misty window closed")?;
    if state.context["desktopControl"] != true && !window.is_focused().unwrap_or(false) {
        #[cfg(target_os = "macos")]
        return decode(focus_reason());
        #[cfg(windows)]
        return Err(crate::agents::window_control::windows::focus_reason());
        #[cfg(target_os = "linux")]
        return Err(crate::agents::window_control::linux::focus_reason());
        #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
        return Err("Bring Misty to the front, then resume the agent".into());
    }
    Ok(state.context.clone())
}
pub async fn execute(
    app: &AppHandle,
    request: &BrowserAgentExecuteRequest,
) -> Result<Value, String> {
    let context = authorize(app, request)?;
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    {
        let _ = context;
        return Err("Misty window control isn't available on this system".into());
    }
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    match request.operation.as_str() {
        "browser.workspace.visual" => {
            let desktop = context["desktopControl"] == true;
            let task = request.input["__mistyTaskId"]
                .as_str()
                .unwrap_or("")
                .to_owned();
            let mut capture = native_capture(app, desktop, task).await?;
            let latest = authorize(app, request)?;
            if context != latest {
                return Err("browser_snapshot_stale: workspace changed while capturing".into());
            }
            let id = uuid::Uuid::new_v4().to_string();
            let image = capture
                .as_object_mut()
                .ok_or("Invalid capture")?
                .remove("image")
                .ok_or("Missing image")?;
            {
                let mut state = session().lock().map_err(|_| "workspace_unavailable")?;
                if state.task != request.input["__mistyTaskId"].as_str().unwrap_or("")
                    || state.context != context
                {
                    return Err("agent_task_paused: task changed during capture".into());
                }
                state.snapshot = Some(Snapshot {
                    id: id.clone(),
                    captured: Instant::now(),
                    geometry: capture,
                });
            }
            Ok(
                json!({"documentId":id,"url":if desktop {"misty://desktop"} else {"misty://workspace"},"title":if desktop {"Current desktop display"} else {"Misty workspace"},"context":context,"image":image,"interactive":[],"contentTrust":"untrusted-screen-content","text":if desktop {"Live ScreenCaptureKit desktop frame. Control is active: use normalized coordinates across this image for native clicks, typing and scrolling. Inspect after every action. Escape and the control strip's Stop button belong to the user; never operate or hide them."} else {"Full Misty window. Choose normalized coordinates from this image. Observe after every action. Stop or account changes end this task's execution ownership."}}),
            )
        }
        "browser.workspace.interact" => {
            // Misty's own Allow and Approve controls are on this screen, and only the person presses them.
            let store = app
                .state::<crate::app::runtime::MistyRuntime>()
                .environment
                .store();
            if crate::browser::agent_pages::action_confirm::question_open()
                || crate::agents::connected_apps::requests::any_pending(&store)
            {
                return Err("workspace_question_open: Misty is waiting for the person to answer a question, so agents can't act on Misty or the desktop until they have. Nothing was done.".into());
            }
            let action = request.input.get("action").ok_or("Missing action")?.clone();
            validate_action(&action)?;
            let document = request.input["documentId"]
                .as_str()
                .ok_or("Inspect the window first")?
                .to_owned();
            let app = app.clone();
            let scope = request.scope_id.clone();
            let agent = request.agent_id.clone();
            let grant = request.grant_id.clone();
            let task = request.input["__mistyTaskId"]
                .as_str()
                .unwrap_or("")
                .to_owned();
            #[cfg(windows)]
            {
                // Checked here, then acted on off the UI thread: UI Automation
                // calls that reach Misty's own windows would wait on it.
                crate::browser::authorize_workspace_dispatch(&app, &scope, &agent, &grant, &task)?;
                let (desktop, input) = take_snapshot(&task, &document, action)?;
                return crate::agents::window_control::windows::perform(&app, desktop, input).await;
            }
            #[cfg(target_os = "linux")]
            {
                crate::browser::authorize_workspace_dispatch(&app, &scope, &agent, &grant, &task)?;
                let (desktop, input) = take_snapshot(&task, &document, action)?;
                return crate::agents::window_control::linux::perform(&app, desktop, input).await;
            }
            #[cfg(target_os = "macos")]
            let (send, receive) = tokio::sync::oneshot::channel();
            #[cfg(target_os = "macos")]
            let main = app.clone();
            #[cfg(target_os = "macos")]
            app.run_on_main_thread(move || {
                let result = (|| {
                    // Recheck inside the dispatch closure: a queued action must not outlive Stop.
                    crate::browser::authorize_workspace_dispatch(
                        &main, &scope, &agent, &grant, &task,
                    )?;
                    // State is released before native events reach the app's handlers.
                    let (desktop, input) = take_snapshot(&task, &document, action)?;
                    decode(if desktop {
                        crate::agents::desktop_control::macos::action(&input)
                    } else {
                        autopilot_action(&input)
                    })
                })();
                let _ = send.send(result);
            })
            .map_err(|e| e.to_string())?;
            #[cfg(target_os = "macos")]
            return receive.await.map_err(|e| e.to_string())?;
        }
        _ => Err("Unsupported workspace operation".into()),
    }
}

/// Takes the inspected snapshot an action acts on: the one the agent saw, and
/// recent. Whether it shows the desktop, and its geometry with the action.
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
fn take_snapshot(task: &str, document: &str, action: Value) -> Result<(bool, Value), String> {
    let mut state = session().lock().map_err(|_| "workspace_unavailable")?;
    if state.task != task {
        return Err("agent_task_paused".into());
    }
    let snapshot = state
        .snapshot
        .take()
        .ok_or("browser_snapshot_stale: inspect before acting")?;
    let desktop = state.context["desktopControl"] == true;
    let limit = Duration::from_secs(if desktop { 20 } else { 90 });
    if snapshot.id != document || snapshot.captured.elapsed() > limit {
        return Err("browser_snapshot_stale: inspect before acting".into());
    }
    let mut input = snapshot.geometry;
    input["action"] = action;
    Ok((desktop, input))
}

/// One capture of the display under control, or of the Misty window.
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
async fn native_capture(app: &AppHandle, desktop: bool, task: String) -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        tauri::async_runtime::spawn_blocking(move || {
            decode(if desktop {
                crate::agents::desktop_control::macos::capture_desktop(&task)
            } else {
                autopilot_capture()
            })
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(windows)]
    return crate::agents::window_control::windows::native_capture(app, desktop, task).await;
    #[cfg(target_os = "linux")]
    return crate::agents::window_control::linux::native_capture(app, desktop, task).await;
}
fn validate_action(action: &Value) -> Result<(), String> {
    let coordinate = |key: &str| {
        action[key]
            .as_f64()
            .is_some_and(|v| v.is_finite() && (0.0..=1.0).contains(&v))
    };
    let valid = match action["kind"].as_str().unwrap_or("") {
        "point" => coordinate("x") && coordinate("y"),
        "scroll" => {
            coordinate("x")
                && coordinate("y")
                && ["deltaX", "deltaY"].iter().all(|key| {
                    action[*key]
                        .as_i64()
                        .is_some_and(|v| (-2000..=2000).contains(&v))
                })
        }
        "type" => action["text"].as_str().is_some_and(|v| v.len() <= 16000),
        "key" => action["key"].as_str().is_some_and(|v| {
            matches!(
                v,
                "Enter"
                    | "Escape"
                    | "Tab"
                    | "Backspace"
                    | "ArrowLeft"
                    | "ArrowRight"
                    | "ArrowUp"
                    | "ArrowDown"
                    | "SelectAll"
                    | "Undo"
                    | "AddressBar"
                    | "NewTab"
                    | "Find"
            )
        }),
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err("Invalid workspace action".into())
    }
}
#[cfg(target_os = "macos")]
pub(crate) mod macos;
#[cfg(test)]
mod tests;
#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(windows)]
pub mod windows;
