//! Running the benchmark's page tools in a tab, reading page state for its checks, and closing tabs.
use super::*;

pub(super) async fn execute(
    AxumState(bridge): AxumState<Bridge>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let body = match request::<Execute>(&bridge, &headers, &body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let task = match bridge.tabs.lock().await.get(&body.scope_id) {
        Some(tab) => tab.task.clone(),
        None => return reply(Err("The benchmark tab is not open.".into())),
    };
    if !CAPABILITIES.contains(&body.operation.as_str()) {
        return reply(Err(format!("{} is not a benchmark tool.", body.operation)));
    }
    let mut input = if body.input.is_object() {
        body.input
    } else {
        json!({})
    };
    input["__mistyTaskId"] = json!(task);
    let call = serde_json::from_value(json!({
        "scopeId": body.scope_id, "grantId": grant(&body.scope_id), "agentId": AGENT,
        "operation": body.operation, "input": input,
    }));
    reply(match call {
        Ok(call) => {
            browser_agent_execute(
                bridge.app.clone(),
                bridge.app.state::<BrowserSessionState>(),
                call,
            )
            .await
        }
        Err(error) => Err(error.to_string()),
    })
}

/// Reads the page's own state for the benchmark's checks: an expression in
/// the page, never shown to the model.
pub(super) async fn evaluate(
    AxumState(bridge): AxumState<Bridge>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let body = match request::<Evaluate>(&bridge, &headers, &body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let id = match bridge.tabs.lock().await.get(&body.scope_id) {
        Some(tab) => tab.id.clone(),
        None => return reply(Err("The benchmark tab is not open.".into())),
    };
    let view = match webview_label(&id)
        .ok()
        .and_then(|label| bridge.app.get_webview(&label))
    {
        Some(view) => view,
        None => return reply(Err("The benchmark tab is not running.".into())),
    };
    let script = format!(
        "(() => {{ try {{ return ({}); }} catch {{ return null; }} }})()",
        body.expression
    );
    // A page that navigates mid-evaluation never answers it; ask again.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while tokio::time::Instant::now() < deadline {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let sender = Mutex::new(Some(sender));
        if let Err(error) = view.eval_with_callback(script.clone(), move |value| {
            if let Some(sender) = sender.lock().ok().and_then(|mut sender| sender.take()) {
                let _ = sender.send(value);
            }
        }) {
            return reply(Err(error.to_string()));
        }
        if let Ok(Ok(raw)) = tokio::time::timeout(Duration::from_secs(2), receiver).await {
            return reply(serde_json::from_str(&raw).map_err(|error| error.to_string()));
        }
    }
    reply(Err("The page did not answer.".into()))
}

pub(super) async fn close(
    AxumState(bridge): AxumState<Bridge>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let body = match request::<Scoped>(&bridge, &headers, &body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let Some(tab) = bridge.tabs.lock().await.remove(&body.scope_id) else {
        return reply(Ok(json!({})));
    };
    tab.renew.abort();
    let app = &bridge.app;
    let closed = serde_json::from_value(json!({ "id": tab.id }))
        .map_err(|e| e.to_string())
        .and_then(|close| {
            close_browser_webview(app.clone(), app.state::<BrowserSessionState>(), close)
        });
    if let Ok(view) = main_view(app) {
        let _ =
            workspace::agent_workspace_release(view, app.state::<AgentWorkspaceState>(), tab.task);
    }
    reply(closed.map(|_| json!({})))
}
