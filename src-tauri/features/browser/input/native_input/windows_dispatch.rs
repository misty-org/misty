//! Windows: trusted input through the DevTools protocol, rechecked against the grant.
use super::*;

/// Windows: trusted input through the DevTools protocol, rechecked against
/// the grant before it lands.
#[cfg(windows)]
pub(super) async fn dispatch_windows(
    app: &AppHandle,
    webview: Webview,
    request: &BrowserAgentExecuteRequest,
    input: &Value,
    origin: &str,
    observed: &Value,
    generation: u64,
) -> Result<Value, String> {
    validate(input)?;
    let window = webview.window();
    if !window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(true) {
        return Err("The granted browser must be visible before native input.".into());
    }
    let (width, height) = crate::browser::pages::windows::webview2::css_viewport(&webview)
        .await
        .map_err(String::from)?;
    let observed_size = (
        observed["viewport"]["width"].as_f64().unwrap_or(0.0),
        observed["viewport"]["height"].as_f64().unwrap_or(0.0),
    );
    if (width - observed_size.0).abs() > 2.0 || (height - observed_size.1).abs() > 2.0 {
        return Err("browser_snapshot_stale: browser viewport resized before native input".into());
    }
    let target = cursor_target(input);
    if let Some(script) = cursor_script(input, &observed["viewport"]) {
        // Let the user watch the cursor arrive before the input lands.
        let _ = webview.eval(script);
        tokio::time::sleep(std::time::Duration::from_millis(
            crate::browser::agent_pages::page_agent::CURSOR_GLIDE_MS,
        ))
        .await;
    }
    let authorize: windows::Authorize = {
        let app = app.clone();
        let view = webview.clone();
        let expected_origin = origin.to_owned();
        let request = BrowserAgentExecuteRequest {
            scope_id: request.scope_id.clone(),
            agent_id: request.agent_id.clone(),
            grant_id: request.grant_id.clone(),
            operation: request.operation.clone(),
            input: request.input.clone(),
            policy_call: request.policy_call.clone(),
            policy: request.policy.clone(),
        };
        std::sync::Arc::new(move || {
            authorize_native_input(&app, &view, &request, &expected_origin, generation)
        })
    };
    let editable = observed["editable"].as_bool().unwrap_or(false);
    let mut result = windows::act(&webview, authorize, input, (width, height), editable).await?;
    if let (Some((x, y)), Some(object)) = (target, result.as_object_mut()) {
        object.insert("cursor".into(), json!({"x": x, "y": y}));
    }
    Ok(result)
}
