//! `browser.interact`: an agent's action on an inspected element, scroll, point
//! or native input in a granted browser tab.
use crate::browser::*;

pub(in crate::browser) async fn interact_browser(
    app: &AppHandle,
    state: &BrowserSessionState,
    id: &str,
    request: &BrowserAgentExecuteRequest,
) -> Result<Value, String> {
    let action = request
        .input
        .get("action")
        .ok_or_else(|| "A browser action is required.".to_owned())?;
    let kind = action.get("kind").and_then(Value::as_str).unwrap_or("");
    if !matches!(
        kind,
        "fill" | "select" | "scroll" | "key" | "point" | "native"
    ) {
        return Err("Unsupported browser interaction.".to_owned());
    }
    let element_ref = action.get("elementRef").and_then(Value::as_str);
    if element_ref.is_none() && kind != "scroll" && kind != "point" && kind != "native" {
        return Err("An inspected element reference is required.".to_owned());
    }
    if request
        .input
        .get("extensionId")
        .is_some_and(|id| !id.is_null())
    {
        return Err("Extensions are not available.".into());
    }
    if kind == "native" {
        crate::browser::input::native_input::validate(&action["input"])?;
        if request.input["documentId"]
            .as_str()
            .filter(|id| !id.is_empty())
            .is_none()
        {
            return Err("Inspect the browser before native input.".into());
        }
    }
    let (target, generation) = {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "Browser state is unavailable.".to_owned())?;
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| "Browser tab is not running.".to_owned())?;
        validate_browser_grant(session, request)?;
        let target = match element_ref {
            Some(reference) => Some(
                session
                    .element_targets
                    .get(reference)
                    .cloned()
                    .ok_or_else(|| "The page changed; inspect it again.".to_owned())?,
            ),
            None => {
                if session.snapshot_generation == 0 {
                    return Err("Inspect the page before scrolling.".to_owned());
                }
                None
            }
        };
        session.element_targets.clear();
        (target, session.snapshot_generation)
    };
    let webview = app
        .get_webview(&webview_label(id)?)
        .ok_or_else(|| "Browser tab is not running.".to_owned())?;
    let origin = browser_page_origin(&webview.url().map_err(|error| error.to_string())?);
    let encoded_target = serde_json::to_string(&target).map_err(|error| error.to_string())?;
    let encoded_action = serde_json::to_string(action).map_err(|error| error.to_string())?;
    let encoded_origin = serde_json::to_string(&origin).map_err(|error| error.to_string())?;
    let encoded_document = serde_json::to_string(&request.input.get("documentId"))
        .map_err(|error| error.to_string())?;
    let script = format!(
        "({})({encoded_target}, {encoded_action}, {encoded_origin}, {encoded_document})",
        include_str!("../kiri_link/scripts/inspection_interact.js")
    );
    let result = eval_json(webview.clone(), script).await?;
    if result.get("ok").and_then(Value::as_bool) != Some(true) {
        if result.get("errorCode").and_then(Value::as_str) == Some("browser_snapshot_stale") {
            return Err("browser_snapshot_stale: inspected content changed before dispatch".into());
        }
        return Err(result
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Browser interaction failed.")
            .to_owned());
    }
    if kind == "native" {
        if let Some(stopped) = crate::browser::agent_pages::page_agent::judge_point(
            app,
            &webview,
            request,
            &action["input"],
        )
        .await?
        {
            return Ok(stopped);
        }
        return crate::browser::input::native_input::dispatch(
            app,
            webview,
            request,
            &action["input"],
            &origin,
            &result,
            generation,
        )
        .await;
    }
    let mut output = json!({"attempted": true});
    for field in ["textRetained", "websiteEditVerified", "scrolled"] {
        if let Some(value) = result.get(field).and_then(Value::as_bool) {
            output[field] = json!(value);
        }
    }
    Ok(output)
}
