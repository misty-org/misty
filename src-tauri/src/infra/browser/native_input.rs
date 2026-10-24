//! Native visual actions stay inside the granted browser view. This is the small
//! device adapter beneath Midscene; it never posts global desktop input.
use super::{BrowserAgentExecuteRequest, BrowserSessionState};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Webview};

#[cfg(windows)]
use super::native_input_windows as windows;

#[cfg(windows)]
mod windows_dispatch;
#[cfg(windows)]
use windows_dispatch::dispatch_windows;

/// The modifiers that make a key a browser or system shortcut: Command on
/// macOS; Control (and the Windows key) elsewhere.
const COMMAND_MODIFIERS: &[&str] = if cfg!(target_os = "macos") {
    &["Meta"]
} else {
    &["Meta", "Control"]
};

pub(super) fn validate(input: &Value) -> Result<(), String> {
    let point = |key: &str| {
        input[key]
            .as_f64()
            .is_some_and(|v| v.is_finite() && (0.0..=1.0).contains(&v))
    };
    let valid = match input["kind"].as_str().unwrap_or("") {
        "click" => {
            point("x")
                && point("y")
                && input
                    .get("button")
                    .is_none_or(|v| matches!(v.as_str(), Some("left" | "right")))
                && input
                    .get("clickCount")
                    .is_none_or(|v| matches!(v.as_u64(), Some(1 | 2)))
        }
        "move" => point("x") && point("y"),
        "drag" => ["fromX", "fromY", "toX", "toY"]
            .iter()
            .all(|key| point(key)),
        "scroll" => {
            point("x")
                && point("y")
                && ["deltaX", "deltaY"].iter().all(|key| {
                    input[*key]
                        .as_i64()
                        .is_some_and(|v| (-2000..=2000).contains(&v))
                })
        }
        "type" => input["text"]
            .as_str()
            .is_some_and(|text| text.len() <= 16000 && !text.contains('\0')),
        "key" => {
            input["key"].as_str().is_some_and(|key| {
                matches!(
                    key,
                    "Enter"
                        | "Escape"
                        | "Tab"
                        | "Backspace"
                        | "Delete"
                        | "ArrowLeft"
                        | "ArrowRight"
                        | "ArrowUp"
                        | "ArrowDown"
                        | "Home"
                        | "End"
                        | "PageUp"
                        | "PageDown"
                        | "Space"
                ) || (key.len() == 1 && key.as_bytes()[0].is_ascii_graphic())
            }) && input.get("modifiers").is_none_or(|value| {
                value.as_array().is_some_and(|mods| {
                    mods.len() <= 4
                        && mods.iter().all(|v| {
                            matches!(v.as_str(), Some("Shift" | "Control" | "Alt" | "Meta"))
                        })
                })
            })
        }
        _ => false,
    };
    // Command shortcuts are limited to select-all and undo/redo, so an agent
    // can never close tabs, open the address bar or reach the clipboard.
    let is_command = |v: &Value| v.as_str().is_some_and(|m| COMMAND_MODIFIERS.contains(&m));
    let safe_shortcut = input["kind"] != "key"
        || !input["modifiers"]
            .as_array()
            .is_some_and(|mods| mods.iter().any(is_command))
        || (matches!(
            input["key"]
                .as_str()
                .map(str::to_ascii_lowercase)
                .as_deref(),
            Some("a" | "z")
        ) && input["modifiers"]
            .as_array()
            .is_some_and(|mods| mods.iter().all(|v| is_command(v) || v == "Shift")));
    if valid && safe_shortcut {
        Ok(())
    } else {
        Err("Invalid native browser input".into())
    }
}

/// Where an action puts the agent cursor, as a fraction of the viewport. Typing
/// and keys act where the cursor already is, so they leave it in place.
#[cfg_attr(not(any(target_os = "macos", windows)), allow(dead_code))]
pub(super) fn cursor_target(input: &Value) -> Option<(f64, f64)> {
    let (x, y) = match input["kind"].as_str()? {
        "click" | "scroll" | "move" => ("x", "y"),
        "drag" => ("toX", "toY"),
        _ => return None,
    };
    Some((input[x].as_f64()?, input[y].as_f64()?))
}

/// Script that glides the agent's in-page cursor to a viewport point and keeps
/// it there, so the next screenshot shows where the agent is pointing. It is a
/// drawing only: the user's own pointer never moves.
#[cfg_attr(not(any(target_os = "macos", windows)), allow(dead_code))]
pub(super) fn cursor_script(input: &Value, viewport: &Value) -> Option<String> {
    let (x, y) = match input["kind"].as_str()? {
        "drag" => (input["fromX"].as_f64()?, input["fromY"].as_f64()?),
        _ => cursor_target(input)?,
    };
    let (width, height) = (viewport["width"].as_f64()?, viewport["height"].as_f64()?);
    Some(format!(
        "{}\nwindow[Symbol.for('misty.browser.agent.cursor')]?.move({:.1},{:.1},{{hold:true}});",
        include_str!("scripts/agent_cursor.js"),
        x * width,
        y * height
    ))
}

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn misty_browser_native_action(
        view: *mut std::ffi::c_void,
        input: *const std::ffi::c_char,
    ) -> *mut std::ffi::c_char;
    fn misty_browser_native_set_locked(view: *mut std::ffi::c_void, locked: bool);
}

pub(super) fn set_locked(webview: &Webview, locked: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return webview
        .with_webview(move |platform| unsafe {
            misty_browser_native_set_locked(platform.inner().cast(), locked);
        })
        .map_err(|error| error.to_string());
    #[cfg(windows)]
    return windows::set_locked(webview, locked);
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = (webview, locked);
        Ok(())
    }
}

pub(super) async fn dispatch(
    app: &AppHandle,
    webview: Webview,
    request: &BrowserAgentExecuteRequest,
    input: &Value,
    origin: &str,
    observed: &Value,
    generation: u64,
) -> Result<Value, String> {
    #[cfg(windows)]
    return dispatch_windows(app, webview, request, input, origin, observed, generation).await;
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = (app, webview, request, input, origin, observed, generation);
        return Err("Native browser input is not available on this platform.".into());
    }
    #[cfg(target_os = "macos")]
    {
        validate(input)?;
        let app = app.clone();
        let expected_origin = origin.to_owned();
        let request = BrowserAgentExecuteRequest {
            scope_id: request.scope_id.clone(),
            agent_id: request.agent_id.clone(),
            grant_id: request.grant_id.clone(),
            operation: request.operation.clone(),
            input: request.input.clone(),
            site_blocks: request.site_blocks.clone(),
            confirm_kinds: request.confirm_kinds.clone(),
            grant_set: request.grant_set.clone(),
        };
        let encoded = std::ffi::CString::new(
            json!({"action": input, "viewport": observed["viewport"], "editable": observed["editable"]}).to_string(),
        )
        .map_err(|e| e.to_string())?;
        let url_view = webview.clone();
        let target = cursor_target(input);
        if let Some(script) = cursor_script(input, &observed["viewport"]) {
            // Let the user watch the cursor arrive before the input lands.
            let _ = webview.eval(script);
            tokio::time::sleep(std::time::Duration::from_millis(
                super::page_agent::CURSOR_GLIDE_MS,
            ))
            .await;
        }
        let (send, receive) = tokio::sync::oneshot::channel();
        webview
            .with_webview(move |platform| {
                let result = (|| {
                    // This closure runs on the main queue. A queued native event
                    // cannot outlive revoked ownership, takeover, or its grant.
                    super::super::agents::workspace::authorize_scope(
                        &app,
                        &request.scope_id,
                        &request.agent_id,
                        request.input["__mistyTaskId"].as_str().unwrap_or(""),
                    )?;
                    let state = app.state::<BrowserSessionState>();
                    let (id, _) = super::resolve_agent_webview(&app, &state, &request)?;
                    let current_generation = state.sessions.lock().map_err(|_| "Browser state unavailable")?
                        .get(&id).map(|session| session.snapshot_generation);
                    if current_generation != Some(generation) {
                        return Err("browser_snapshot_stale: browser navigated or observation changed before native input".into());
                    }
                    if super::browser_page_origin(&url_view.url().map_err(|e| e.to_string())?)
                        != expected_origin
                    {
                        return Err(
                            "browser_snapshot_stale: browser origin changed before native input"
                                .into(),
                        );
                    }
                    unsafe {
                        let raw =
                            misty_browser_native_action(platform.inner().cast(), encoded.as_ptr());
                        if raw.is_null() {
                            return Err("Native browser input failed".into());
                        }
                        let result = serde_json::from_slice::<Value>(
                            std::ffi::CStr::from_ptr(raw).to_bytes(),
                        );
                        libc::free(raw.cast());
                        let result = result.map_err(|e| e.to_string())?;
                        if let Some(error) = result["error"].as_str() {
                            return Err(error.to_owned());
                        }
                        let mut result = result;
                        if let (Some((x, y)), Some(object)) = (target, result.as_object_mut()) {
                            object.insert("cursor".into(), json!({"x": x, "y": y}));
                        }
                        Ok(result)
                    }
                })();
                let _ = send.send(result);
            })
            .map_err(|e| e.to_string())?;
        receive.await.map_err(|e| e.to_string())?
    }
}

#[cfg(test)]
mod tests;
