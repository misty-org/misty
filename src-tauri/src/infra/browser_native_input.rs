//! Native visual actions stay inside the granted browser view. This is the small
//! device adapter beneath Midscene; it never posts global desktop input.
use super::{BrowserAgentExecuteRequest, BrowserSessionState};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Webview};

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
    let safe_shortcut = input["kind"] != "key"
        || !input["modifiers"]
            .as_array()
            .is_some_and(|mods| mods.iter().any(|v| v == "Meta"))
        || (matches!(
            input["key"]
                .as_str()
                .map(str::to_ascii_lowercase)
                .as_deref(),
            Some("a" | "z")
        ) && input["modifiers"]
            .as_array()
            .is_some_and(|mods| mods.iter().all(|v| v == "Meta" || v == "Shift")));
    if valid && safe_shortcut {
        Ok(())
    } else {
        Err("Invalid native browser input".into())
    }
}

/// Where an action puts the agent cursor, as a fraction of the viewport. Typing
/// and keys act where the cursor already is, so they leave it in place.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(super) fn cursor_target(input: &Value) -> Option<(f64, f64)> {
    let (x, y) = match input["kind"].as_str()? {
        "click" | "scroll" => ("x", "y"),
        "drag" => ("toX", "toY"),
        _ => return None,
    };
    Some((input[x].as_f64()?, input[y].as_f64()?))
}

/// Script that glides the agent's in-page cursor to a viewport point and keeps
/// it there, so the next screenshot shows where the agent is pointing. It is a
/// drawing only: the user's own pointer never moves.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(super) fn cursor_script(input: &Value, viewport: &Value) -> Option<String> {
    let (x, y) = match input["kind"].as_str()? {
        "drag" => (input["fromX"].as_f64()?, input["fromY"].as_f64()?),
        _ => cursor_target(input)?,
    };
    let (width, height) = (viewport["width"].as_f64()?, viewport["height"].as_f64()?);
    Some(format!(
        "window[Symbol.for('misty.browser.agent.cursor')]?.move({:.1},{:.1},{{hold:true}});",
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
    #[cfg(not(target_os = "macos"))]
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
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, webview, request, input, origin, observed, generation);
        return Err("Native browser input is currently available on macOS only.".into());
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
            tokio::time::sleep(std::time::Duration::from_millis(180)).await;
        }
        let (send, receive) = tokio::sync::oneshot::channel();
        webview
            .with_webview(move |platform| {
                let result = (|| {
                    // This closure runs on the main queue. A queued native event
                    // cannot outlive revoked ownership, takeover, or its grant.
                    super::super::agent_workspace::authorize_scope(
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
mod tests {
    use super::*;

    #[test]
    fn the_agent_cursor_follows_pointer_actions_only() {
        let viewport = json!({"width": 1000, "height": 500});
        let click = json!({"kind": "click", "x": 0.25, "y": 0.5});
        assert_eq!(cursor_target(&click), Some((0.25, 0.5)));
        assert!(cursor_script(&click, &viewport)
            .unwrap()
            .contains("move(250.0,250.0,{hold:true})"));
        let drag = json!({"kind": "drag", "fromX": 0.1, "fromY": 0.2, "toX": 0.9, "toY": 0.8});
        assert_eq!(cursor_target(&drag), Some((0.9, 0.8)));
        assert!(cursor_script(&drag, &viewport)
            .unwrap()
            .contains("move(100.0,100.0,"));
        for input in [
            json!({"kind": "type", "text": "hi"}),
            json!({"kind": "key", "key": "Enter"}),
        ] {
            assert_eq!(cursor_target(&input), None);
            assert_eq!(cursor_script(&input, &viewport), None);
        }
        assert_eq!(cursor_script(&click, &json!({})), None);
    }
    #[test]
    fn input_bounds_and_key_names_are_enforced() {
        for input in [
            json!({"kind":"drag","fromX":0.1,"fromY":0.2,"toX":0.8,"toY":0.9}),
            json!({"kind":"key","key":"a","modifiers":["Meta"]}),
            json!({"kind":"click","x":0.5,"y":0.5,"clickCount":2}),
            json!({"kind":"type","text":"house"}),
        ] {
            assert!(validate(&input).is_ok());
        }
        for input in [
            json!({"kind":"drag","fromX":0.1,"fromY":0.2,"toX":1.1,"toY":0.9}),
            json!({"kind":"key","key":"Shell"}),
            json!({"kind":"key","key":"q","modifiers":["Meta"]}),
            json!({"kind":"key","key":"l","modifiers":["Meta"]}),
            json!({"kind":"key","key":"c","modifiers":["Meta"]}),
            json!({"kind":"key","key":"v","modifiers":["Meta"]}),
            json!({"kind":"key","key":"x","modifiers":["Meta"]}),
            json!({"kind":"key","key":"a","modifiers":["Unknown"]}),
            json!({"kind":"click","x":0.5,"y":0.5,"clickCount":3}),
            json!({"kind":"scroll","x":0.5,"y":0.5,"deltaX":0,"deltaY":2001}),
        ] {
            assert!(validate(&input).is_err());
        }
    }
}
