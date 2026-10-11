//! `browser.interact`: an agent's action on an inspected element, scroll, point
//! or native input in a granted browser tab.
use super::*;

pub(super) async fn interact_browser(
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
        "fill" | "select" | "scroll" | "key" | "point" | "extension" | "native"
    ) {
        return Err("Unsupported browser interaction.".to_owned());
    }
    let element_ref = action.get("elementRef").and_then(Value::as_str);
    if element_ref.is_none()
        && kind != "scroll"
        && kind != "point"
        && kind != "extension"
        && kind != "native"
    {
        return Err("An inspected element reference is required.".to_owned());
    }
    let extension_id = request.input.get("extensionId").and_then(Value::as_u64);
    if kind == "native" {
        if extension_id.is_some() {
            return Err("Native input is only available for the granted website viewport.".into());
        }
        native_input::validate(&action["input"])?;
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
        if session.snapshot_extension != extension_id {
            return Err("Inspect the requested page or extension popup again.".into());
        }
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
    let validation_action = json!({"kind":"scroll","x":0,"y":0});
    let encoded_action = serde_json::to_string(if kind == "extension" {
        &validation_action
    } else {
        action
    })
    .map_err(|error| error.to_string())?;
    let encoded_origin = if extension_id.is_some() {
        "location.origin".to_owned()
    } else {
        serde_json::to_string(&origin).map_err(|error| error.to_string())?
    };
    let encoded_document = serde_json::to_string(&request.input.get("documentId"))
        .map_err(|error| error.to_string())?;
    let script = format!(
        "({})({encoded_target}, {encoded_action}, {encoded_origin}, {encoded_document})",
        include_str!("browser_inspection_interact.js")
    );
    let result = if let Some(extension) = extension_id {
        // Evaluate inside the actual popup; it never receives renderer IPC.
        super::super::extensions::agent_action("popup-evaluate", Some(extension), id, Some(script)).await?
            ["result"]
            .clone()
    } else {
        eval_json(webview.clone(), script).await?
    };
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
        return native_input::dispatch(
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
    if kind == "extension" {
        let extension = action
            .get("extensionId")
            .and_then(Value::as_u64)
            .ok_or("An extension action ID is required.")?;
        super::super::extensions::agent_action("invoke", Some(extension), id, None).await?;
    }
    let mut output = json!({"attempted": true});
    for field in ["textRetained", "websiteEditVerified", "scrolled"] {
        if let Some(value) = result.get(field).and_then(Value::as_bool) {
            output[field] = json!(value);
        }
    }
    Ok(output)
}
